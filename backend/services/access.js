const db = require('../models');

// The permission matrix the whole app is built on. Every module the UI can show,
// with the actions it supports. 'view/create/update/delete' are stored as columns,
// anything else is a switch inside the `rights` JSON.
const MODULES = [
  {
    key: 'dashboard',
    label: 'Dashboard',
    actions: ['view'],
    extras: []
  },
  {
    key: 'raw-products',
    label: 'Raw Products',
    actions: ['view', 'create', 'update', 'delete'],
    extras: [
      { key: 'stockIn', label: 'Add stock (Stock In)' },
      { key: 'stockOut', label: 'Issue stock (Stock Out)' }
    ]
  },
  {
    key: 'finished-products',
    label: 'Finished Products',
    actions: ['view', 'create', 'update', 'delete'],
    extras: []
  },
  {
    key: 'batches',
    label: 'Batch Production',
    actions: ['view', 'create', 'update', 'delete'],
    extras: []
  },
  {
    key: 'vendors',
    label: 'Vendors',
    actions: ['view', 'create', 'update', 'delete'],
    extras: [
      { key: 'creditLimit', label: 'Change credit limit / payment terms' }
    ]
  },
  {
    key: 'purchase-orders',
    label: 'Purchase Orders',
    actions: ['view', 'create', 'update', 'delete'],
    extras: [
      { key: 'approve', label: 'Confirm order' },
      { key: 'cancel', label: 'Cancel order' },
      { key: 'receive', label: 'Receive goods (GRN)' },
      { key: 'returnGoods', label: 'Purchase return' }
    ]
  },
  {
    key: 'vendor-ledger',
    label: 'Vendor Ledger',
    actions: ['view'],
    extras: [
      { key: 'payment', label: 'Post payment' },
      { key: 'adjust', label: 'Manual ledger adjustment' }
    ]
  },
  {
    key: 'reports',
    label: 'Reports & Logs',
    actions: ['view'],
    extras: []
  },
  {
    key: 'users',
    label: 'Users & Access',
    actions: ['view', 'create', 'update', 'delete'],
    extras: []
  }
];

const PRESETS = [
  {
    key: 'viewer',
    label: 'Read only',
    build: () => grantAll(['dashboard', 'raw-products', 'finished-products', 'batches', 'vendors', 'purchase-orders', 'vendor-ledger', 'reports'], ['view'])
  },
  {
    key: 'purchase-clerk',
    label: 'Purchase / order entry',
    build: () => ({
      ...grantAll(['dashboard', 'reports', 'vendors', 'vendor-ledger', 'raw-products'], ['view']),
      'purchase-orders': { view: true, create: true, receive: true }
    })
  },
  {
    key: 'store-keeper',
    label: 'Store / production',
    build: () => ({
      ...grantAll(['dashboard', 'reports', 'vendors', 'finished-products', 'purchase-orders'], ['view']),
      'raw-products': { view: true, create: true, update: true, stockIn: true, stockOut: true },
      'batches': { view: true, create: true, update: true }
    })
  },
  {
    key: 'accounts',
    label: 'Accounts / payments',
    build: () => ({
      ...grantAll(['dashboard', 'reports', 'purchase-orders', 'vendors'], ['view']),
      'vendor-ledger': { view: true, payment: true, adjust: true },
      'vendors': { view: true, creditLimit: true }
    })
  },
  {
    key: 'full',
    label: 'Everything except user management',
    build: () => grantAll(MODULES.filter((m) => m.key !== 'users').map((m) => m.key), null)
  }
];

function grantAll(moduleKeys, actions) {
  const grants = {};
  for (const key of moduleKeys) {
    const module = MODULES.find((m) => m.key === key);
    if (!module) continue;
    const wanted = actions || [...module.actions, ...module.extras.map((e) => e.key)];
    grants[key] = wanted.reduce((acc, action) => ({ ...acc, [action]: true }), {});
  }
  return grants;
}

function emptyGrants() {
  return MODULES.reduce((acc, module) => ({ ...acc, [module.key]: {} }), {});
}

function rowToGrants(row) {
  const rights = row.rights && typeof row.rights === 'object' ? row.rights : {};
  return {
    view: !!row.canView,
    create: !!row.canCreate,
    update: !!row.canUpdate,
    delete: !!row.canDelete,
    ...Object.fromEntries(Object.entries(rights).map(([key, value]) => [key, !!value]))
  };
}

// A 15s cache keeps permission reads off every request while still making an
// access change visible to a signed-in user within a few clicks.
const CACHE_TTL_MS = 15000;
const cache = new Map();

function invalidateAccess(userId) {
  cache.delete(Number(userId));
}

async function loadAccess(userId) {
  const key = Number(userId);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  // Read the user every time the cache is cold so a demotion or a deleted account
  // takes effect even though the JWT still carries the old role.
  const user = await db.User.findByPk(key, { attributes: ['id', 'username', 'role'] });
  if (!user) return null;

  const isAdmin = user.role === 'admin';
  const grants = emptyGrants();

  if (!isAdmin) {
    const rows = await db.UserModuleAccess.findAll({ where: { userId: user.id } });
    for (const row of rows) {
      grants[row.module] = rowToGrants(row);
    }
  } else {
    for (const module of MODULES) {
      grants[module.key] = grantAll([module.key], null)[module.key];
    }
  }

  const value = {
    userId: user.id,
    username: user.username,
    role: user.role,
    isAdmin,
    grants
  };
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

function hasAccess(access, moduleKey, action = 'view') {
  if (!access) return false;
  if (access.isAdmin) return true;
  return !!access.grants?.[moduleKey]?.[action];
}

// Sends the current grants to the browser; the same object shape powers AccessService.
function serializeAccess(access) {
  return {
    userId: access.userId,
    username: access.username,
    role: access.role,
    isAdmin: access.isAdmin,
    grants: access.grants
  };
}

function requireAccess(moduleKey, action = 'view') {
  return (req, res, next) => {
    if (!req.access) {
      return res.status(401).json({ error: 'Session expired. Please log in again.' });
    }
    if (hasAccess(req.access, moduleKey, action)) return next();
    return res.status(403).json({
      error: `Not allowed: ${action} on ${moduleKey}. Ask an administrator for this right.`,
      module: moduleKey,
      action
    });
  };
}

// Normalises a submitted matrix into rows to upsert, ignoring unknown modules/actions.
function sanitiseGrants(moduleKey, payload) {
  const module = MODULES.find((m) => m.key === moduleKey);
  if (!module) return null;
  const source = payload && typeof payload === 'object' ? payload : {};
  const row = {
    module: moduleKey,
    canView: !!source.view,
    canCreate: !!source.create,
    canUpdate: !!source.update,
    canDelete: !!source.delete,
    rights: {}
  };
  if (row.canCreate && !row.canView) row.canView = true;
  if (row.canUpdate && !row.canView) row.canView = true;
  if (row.canDelete && !row.canView) row.canView = true;
  for (const extra of module.extras) {
    row.rights[extra.key] = !!source[extra.key];
    if (row.rights[extra.key]) row.canView = true;
  }
  return row;
}

module.exports = {
  MODULES,
  PRESETS,
  loadAccess,
  hasAccess,
  requireAccess,
  serializeAccess,
  sanitiseGrants,
  invalidateAccess
};
