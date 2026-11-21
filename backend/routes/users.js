const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { Op } = require('sequelize');
const db = require('../models');
const auth = require('../middleware/auth');
const { MODULES, PRESETS, requireAccess, invalidateAccess, sanitiseGrants } = require('../services/access');

function grantsForRows(rows) {
  const grants = {};
  for (const module of MODULES) grants[module.key] = {};
  for (const row of rows) {
    const rights = row.rights && typeof row.rights === 'object' ? row.rights : {};
    grants[row.module] = {
      view: !!row.canView,
      create: !!row.canCreate,
      update: !!row.canUpdate,
      delete: !!row.canDelete,
      ...rights
    };
  }
  return grants;
}

async function loadUserWithGrants(user) {
  const rows = await db.UserModuleAccess.findAll({ where: { userId: user.id } });
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    createdAt: user.createdAt,
    isAdmin: user.role === 'admin',
    grants: grantsForRows(rows)
  };
}

async function countBusinessRecords(userId) {
  const references = [
    ['raw products', db.RawProduct, 'createdBy'],
    ['batches', db.Batch, 'createdBy'],
    ['vendors', db.Vendor, 'createdBy'],
    ['purchase orders', db.PurchaseOrder, 'createdBy'],
    ['goods receipts', db.GoodsReceipt, 'createdBy'],
    ['purchase returns', db.PurchaseReturn, 'createdBy'],
    ['vendor payments', db.VendorPayment, 'createdBy'],
    ['ledger entries', db.VendorLedgerEntry, 'createdBy'],
    ['stock transactions', db.InventoryTransaction, 'userId']
  ];
  const found = {};
  for (const [label, model, column] of references) {
    const count = await model.count({ where: { [column]: userId } });
    if (count > 0) found[label] = count;
  }
  return found;
}

async function audit(req, targetUserId, action, changes) {
  await db.AccessAuditLog.create({
    actorUserId: req.access.userId,
    targetUserId,
    module: 'users',
    action,
    changes: changes || null
  });
}

// GET /api/users
router.get('/', auth, requireAccess('users', 'view'), async (req, res) => {
  try {
    const users = await db.User.findAll({ order: [['id', 'ASC']] });
    const withGrants = [];
    for (const user of users) {
      withGrants.push(await loadUserWithGrants(user));
    }
    res.json(withGrants);
  } catch (error) {
    console.error('List users error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/users/access-catalog — what the matrix editor should render
router.get('/access-catalog', auth, requireAccess('users', 'view'), (req, res) => {
  res.json({ modules: MODULES, presets: PRESETS.map((p) => ({ key: p.key, label: p.label, grants: p.build() })) });
});

// GET /api/users/audit — who changed which account
router.get('/audit', auth, requireAccess('users', 'view'), async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const entries = await db.AccessAuditLog.findAll({
      order: [['id', 'DESC']],
      limit,
      include: [
        { model: db.User, as: 'actor', attributes: ['id', 'username'] },
        { model: db.User, as: 'target', attributes: ['id', 'username'] }
      ]
    });
    res.json(entries);
  } catch (error) {
    console.error('Audit list error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/users
router.post('/', auth, requireAccess('users', 'create'), async (req, res) => {
  const transaction = await db.sequelize.transaction();
  try {
    const { username, password, role, grants } = req.body;

    if (!username || !password) {
      await transaction.rollback();
      return res.status(400).json({ error: 'Username and password are required.' });
    }
    if (String(password).length < 8) {
      await transaction.rollback();
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }
    const safeRole = role === 'admin' ? 'admin' : 'user';

    const existing = await db.User.findOne({ where: { username } });
    if (existing) {
      await transaction.rollback();
      return res.status(400).json({ error: 'Username is already taken.' });
    }

    const user = await db.User.create({
      username,
      passwordHash: await bcrypt.hash(password, 10),
      role: safeRole
    }, { transaction });

    if (safeRole === 'user' && grants && typeof grants === 'object') {
      for (const module of MODULES) {
        const row = sanitiseGrants(module.key, grants[module.key]);
        if (row) await db.UserModuleAccess.create({ ...row, userId: user.id }, { transaction });
      }
    }

    await transaction.commit();
    await audit(req, user.id, 'created', { username: user.username, role: safeRole });
    res.status(201).json(await loadUserWithGrants(user));
  } catch (error) {
    await transaction.rollback();
    console.error('Create user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/users/:id/permissions — write the whole matrix for one user
router.put('/:id/permissions', auth, requireAccess('users', 'update'), async (req, res) => {
  const transaction = await db.sequelize.transaction();
  try {
    const user = await db.User.findByPk(Number(req.params.id));
    if (!user) {
      await transaction.rollback();
      return res.status(404).json({ error: 'User not found.' });
    }
    const incoming = req.body && req.body.grants;
    if (!incoming || typeof incoming !== 'object') {
      await transaction.rollback();
      return res.status(400).json({ error: 'Send { grants: { module: { view, create, update, delete, ... } } }.' });
    }

    // A master account needs no matrix; refuse to store rights that would be ignored.
    if (user.role === 'admin') {
      await transaction.rollback();
      return res.status(400).json({ error: `${user.username} is a master account and already has every right.` });
    }

    const before = grantsForRows(await db.UserModuleAccess.findAll({ where: { userId: user.id }, transaction }));

    for (const module of MODULES) {
      const row = sanitiseGrants(module.key, incoming[module.key]);
      if (!row) continue;
      const existing = await db.UserModuleAccess.findOne({ where: { userId: user.id, module: module.key }, transaction });
      if (existing) {
        await existing.update(row, { transaction });
      } else {
        await db.UserModuleAccess.create({ ...row, userId: user.id }, { transaction });
      }
    }

    await transaction.commit();
    invalidateAccess(user.id);

    const after = await loadUserWithGrants(user);
    const changed = MODULES
      .filter((module) => JSON.stringify(before[module.key]) !== JSON.stringify(after.grants[module.key]))
      .map((module) => module.key);
    await audit(req, user.id, 'permissions-updated', { changedModules: changed });

    res.json(after);
  } catch (error) {
    await transaction.rollback();
    console.error('Update permissions error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/users/:id/role — promote to master or bring back to a normal account
router.put('/:id/role', auth, requireAccess('users', 'update'), async (req, res) => {
  try {
    const user = await db.User.findByPk(Number(req.params.id));
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }
    const { role } = req.body;
    if (!['admin', 'user'].includes(role)) {
      return res.status(400).json({ error: "Role must be 'admin' or 'user'." });
    }
    if (user.role === 'admin' && role !== 'admin') {
      const otherAdmins = await db.User.count({ where: { role: 'admin', id: { [Op.ne]: user.id } } });
      if (otherAdmins === 0) {
        return res.status(400).json({ error: 'This is the last master account. Promote another user first.' });
      }
    }

    const previousRole = user.role;
    user.role = role;
    await user.save();
    invalidateAccess(user.id);
    await audit(req, user.id, 'role-changed', { from: previousRole, to: role });

    res.json(await loadUserWithGrants(user));
  } catch (error) {
    console.error('Update role error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/users/:id/password — administrator reset, current password not required
router.post('/:id/password', auth, requireAccess('users', 'update'), async (req, res) => {
  try {
    const user = await db.User.findByPk(Number(req.params.id));
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }
    const { password } = req.body;
    if (!password || String(password).length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }

    user.passwordHash = await bcrypt.hash(password, 10);
    await user.save();
    await audit(req, user.id, 'password-reset', null);

    res.json({ message: `Password updated for ${user.username}.` });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/users/:id
router.delete('/:id', auth, requireAccess('users', 'delete'), async (req, res) => {
  try {
    const user = await db.User.findByPk(Number(req.params.id));
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }
    if (user.id === req.access.userId) {
      return res.status(400).json({ error: 'You cannot delete the account you are signed in with.' });
    }
    if (user.role === 'admin') {
      const otherAdmins = await db.User.count({ where: { role: 'admin', id: { [Op.ne]: user.id } } });
      if (otherAdmins === 0) {
        return res.status(400).json({ error: 'This is the last master account and cannot be deleted.' });
      }
    }

    const referencedBy = await countBusinessRecords(user.id);
    if (Object.keys(referencedBy).length > 0) {
      return res.status(400).json({
        error: `${user.username} has business records attached and cannot be deleted. Reset the password instead.`,
        referencedBy
      });
    }

    await db.UserModuleAccess.destroy({ where: { userId: user.id } });
    await user.destroy();
    invalidateAccess(user.id);
    await audit(req, null, 'user-deleted', { username: user.username });

    res.json({ message: `${user.username} deleted.` });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
