const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const db = require('../models');
const auth = require('../middleware/auth');
const { requireAccess, hasAccess } = require('../services/access');
const ledger = require('../services/vendorLedger');

const ADJUSTMENT_TYPES = ['Credit Note', 'Debit Note', 'Manual Adjustment'];

// GET /api/vendors - Vendor master with live credit position
router.get('/', auth, requireAccess('vendors', 'view'), async (req, res) => {
  try {
    const vendors = await db.Vendor.findAll({
      include: [{ model: db.User, as: 'creator', attributes: ['id', 'username'] }],
      order: [['name', 'ASC']]
    });

    const totals = await db.VendorLedgerEntry.findAll({
      attributes: [
        'vendorId',
        'direction',
        [db.sequelize.fn('SUM', db.sequelize.col('amount')), 'total']
      ],
      group: ['vendorId', 'direction'],
      raw: true
    });

    const poStats = await db.PurchaseOrder.findAll({
      attributes: [
        'vendorId',
        [db.sequelize.fn('COUNT', db.sequelize.col('PurchaseOrder.id')), 'totalOrders'],
        [db.sequelize.fn('MAX', db.sequelize.col('orderDate')), 'lastOrderDate']
      ],
      where: { status: { [Op.ne]: 'Cancelled' } },
      group: ['vendorId'],
      raw: true
    });

    const { openByVendor } = await ledger.getOrderPayables();

    const ledgerByVendor = {};
    totals.forEach((row) => {
      ledgerByVendor[row.vendorId] = ledgerByVendor[row.vendorId] || { credit: 0, debit: 0 };
      if (row.direction === 'Credit') ledgerByVendor[row.vendorId].credit = Number(row.total);
      else ledgerByVendor[row.vendorId].debit = Number(row.total);
    });

    const poByVendor = {};
    poStats.forEach((row) => {
      poByVendor[row.vendorId] = row;
    });

    const formatted = vendors.map((vendor) => {
      const plain = vendor.get({ plain: true });
      const sums = ledgerByVendor[plain.id] || { credit: 0, debit: 0 };
      const balance = ledger.round2(Number(plain.openingBalance) + sums.credit - sums.debit);
      const limit = Number(plain.creditLimit) || 0;
      return {
        ...plain,
        totalPurchases: ledger.round2(sums.credit),
        totalPaid: ledger.round2(sums.debit),
        payableBalance: balance,
        availableCredit: limit > 0 ? ledger.round2(limit - balance) : null,
        creditUsagePercent: limit > 0 ? ledger.round2((balance / limit) * 100) : null,
        overLimit: limit > 0 && balance > limit,
        totalOrders: Number((poByVendor[plain.id] || {}).totalOrders || 0),
        openOrders: openByVendor[plain.id] || 0,
        lastOrderDate: (poByVendor[plain.id] || {}).lastOrderDate || null
      };
    });

    res.json(formatted);
  } catch (error) {
    console.error('Fetch vendors error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/vendors/:id - Single vendor with its credit position
router.get('/:id', auth, requireAccess('vendors', 'view'), async (req, res) => {
  try {
    const vendor = await db.Vendor.findByPk(req.params.id, {
      include: [{ model: db.User, as: 'creator', attributes: ['id', 'username'] }]
    });
    if (!vendor) {
      return res.status(404).json({ error: 'Vendor not found.' });
    }

    const sums = await ledger.getVendorBalance(vendor);
    const limit = Number(vendor.creditLimit) || 0;
    const recentOrders = await db.PurchaseOrder.findAll({
      where: { vendorId: vendor.id },
      order: [['orderDate', 'DESC'], ['id', 'DESC']],
      limit: 5
    });

    res.json({
      ...vendor.get({ plain: true }),
      totalPurchases: sums.totalCredit,
      totalPaid: sums.totalDebit,
      payableBalance: sums.balance,
      availableCredit: limit > 0 ? ledger.round2(limit - sums.balance) : null,
      creditUsagePercent: limit > 0 ? ledger.round2((sums.balance / limit) * 100) : null,
      overLimit: limit > 0 && sums.balance > limit,
      recentOrders
    });
  } catch (error) {
    console.error('Fetch vendor error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/vendors - Create vendor (optionally with an opening payable balance)
router.post('/', auth, requireAccess('vendors', 'create'), async (req, res) => {
  const transaction = await db.sequelize.transaction();
  try {
    const {
      name, code, contactPerson, phone, email, address, city, ntn,
      creditLimit, paymentTermsDays, openingBalance, remarks, status
    } = req.body;

    if (!name || !String(name).trim()) {
      await transaction.rollback();
      return res.status(400).json({ error: 'Vendor name is required.' });
    }

    const duplicate = await db.Vendor.findOne({ where: { name }, transaction });
    if (duplicate) {
      await transaction.rollback();
      return res.status(400).json({ error: `A vendor named "${name}" already exists.` });
    }

    const limit = Number(creditLimit) || 0;
    const opening = ledger.round2(openingBalance || 0);
    const terms = Number(paymentTermsDays) || 0;

    if (limit < 0 || terms < 0) {
      await transaction.rollback();
      return res.status(400).json({ error: 'Credit limit and payment terms cannot be negative.' });
    }

    // Creating a vendor can open real money: an opening payable posts to the ledger
    // and a credit limit sets how much the business may owe. Both need their own right.
    if (limit > 0 && !hasAccess(req.access, 'vendors', 'creditLimit')) {
      await transaction.rollback();
      return res.status(403).json({
        error: 'Not allowed: creditLimit on vendors. Create the vendor without a credit limit and ask an administrator to set one.',
        module: 'vendors',
        action: 'creditLimit'
      });
    }
    if (opening !== 0 && !hasAccess(req.access, 'vendor-ledger', 'adjust')) {
      await transaction.rollback();
      return res.status(403).json({
        error: 'Not allowed: adjust on vendor-ledger. Create the vendor without an opening balance and ask an administrator to post it.',
        module: 'vendor-ledger',
        action: 'adjust'
      });
    }

    const vendor = await db.Vendor.create({
      name: String(name).trim(),
      code: code ? String(code).trim() : null,
      contactPerson: contactPerson || null,
      phone: phone || null,
      email: email || null,
      address: address || null,
      city: city || null,
      ntn: ntn || null,
      creditLimit: limit,
      paymentTermsDays: terms,
      openingBalance: opening,
      remarks: remarks || null,
      status: status === 'Inactive' ? 'Inactive' : 'Active',
      createdBy: req.user.id
    }, { transaction });

    if (opening !== 0) {
      await ledger.postLedgerEntry({
        vendorId: vendor.id,
        entryType: 'Opening Balance',
        direction: opening > 0 ? 'Credit' : 'Debit',
        amount: Math.abs(opening),
        referenceType: 'opening',
        narration: 'Opening payable balance on vendor creation',
        createdBy: req.user.id
      }, transaction);
    }

    await transaction.commit();
    res.status(201).json(vendor);
  } catch (error) {
    await transaction.rollback();
    console.error('Create vendor error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/vendors/:id - Update vendor master data
router.put('/:id', auth, requireAccess('vendors', 'update'), async (req, res) => {
  try {
    const vendor = await db.Vendor.findByPk(req.params.id);
    if (!vendor) {
      return res.status(404).json({ error: 'Vendor not found.' });
    }

    const {
      name, code, contactPerson, phone, email, address, city, ntn,
      creditLimit, paymentTermsDays, openingBalance, remarks, status
    } = req.body;

    // Credit limit and payment terms decide how much the business may owe a vendor,
    // so they need their own right plus an audit row even for someone with 'update'.
    const touchesCreditTerms =
      (creditLimit !== undefined && Number(creditLimit) !== Number(vendor.creditLimit)) ||
      (paymentTermsDays !== undefined && Number(paymentTermsDays) !== Number(vendor.paymentTermsDays));

    if (touchesCreditTerms && !hasAccess(req.access, 'vendors', 'creditLimit')) {
      return res.status(403).json({
        error: 'Not allowed: creditLimit on vendors. Ask an administrator to change a credit limit or payment terms.',
        module: 'vendors',
        action: 'creditLimit'
      });
    }

    const previousCreditTerms = {
      creditLimit: Number(vendor.creditLimit),
      paymentTermsDays: Number(vendor.paymentTermsDays)
    };

    if (name && name !== vendor.name) {
      const duplicate = await db.Vendor.findOne({ where: { name } });
      if (duplicate) {
        return res.status(400).json({ error: `A vendor named "${name}" already exists.` });
      }
      vendor.name = String(name).trim();
    }

    if (openingBalance !== undefined && Number(openingBalance) !== Number(vendor.openingBalance)) {
      const entryCount = await db.VendorLedgerEntry.count({ where: { vendorId: vendor.id } });
      if (entryCount > 0) {
        return res.status(400).json({
          error: 'Opening balance cannot be changed once this vendor has ledger entries. Post a Manual Adjustment instead.'
        });
      }
      vendor.openingBalance = ledger.round2(openingBalance || 0);
    }

    const limit = Number(creditLimit) || 0;
    if (limit < 0) {
      return res.status(400).json({ error: 'Credit limit cannot be negative.' });
    }
    if (creditLimit !== undefined) vendor.creditLimit = limit;
    if (paymentTermsDays !== undefined) {
      const terms = Number(paymentTermsDays) || 0;
      if (terms < 0) return res.status(400).json({ error: 'Payment terms cannot be negative.' });
      vendor.paymentTermsDays = terms;
    }

    if (code !== undefined) vendor.code = code ? String(code).trim() : null;
    if (contactPerson !== undefined) vendor.contactPerson = contactPerson;
    if (phone !== undefined) vendor.phone = phone;
    if (email !== undefined) vendor.email = email;
    if (address !== undefined) vendor.address = address;
    if (city !== undefined) vendor.city = city;
    if (ntn !== undefined) vendor.ntn = ntn;
    if (remarks !== undefined) vendor.remarks = remarks;
    if (status !== undefined) vendor.status = status === 'Inactive' ? 'Inactive' : 'Active';

    await vendor.save();

    if (touchesCreditTerms) {
      await db.AccessAuditLog.create({
        actorUserId: req.user.id,
        targetUserId: null,
        module: 'vendors',
        action: 'credit-terms-changed',
        changes: {
          vendorId: vendor.id,
          vendorName: vendor.name,
          before: previousCreditTerms,
          after: {
            creditLimit: Number(vendor.creditLimit),
            paymentTermsDays: Number(vendor.paymentTermsDays)
          }
        }
      });
    }

    const sums = await ledger.getVendorBalance(vendor);
    res.json({
      ...vendor.get({ plain: true }),
      payableBalance: sums.balance,
      availableCredit: limit > 0 ? ledger.round2(limit - sums.balance) : null
    });
  } catch (error) {
    console.error('Update vendor error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/vendors/:id - Remove a vendor that has no history
router.delete('/:id', auth, requireAccess('vendors', 'delete'), async (req, res) => {
  try {
    const vendor = await db.Vendor.findByPk(req.params.id);
    if (!vendor) {
      return res.status(404).json({ error: 'Vendor not found.' });
    }

    const orderCount = await db.PurchaseOrder.count({ where: { vendorId: vendor.id } });
    const entryCount = await db.VendorLedgerEntry.count({ where: { vendorId: vendor.id } });
    if (orderCount > 0 || entryCount > 0) {
      return res.status(400).json({
        error: `Vendor "${vendor.name}" has ${orderCount} order(s) and ${entryCount} ledger entry/entries. Mark it Inactive instead of deleting.`
      });
    }

    await vendor.destroy();
    res.json({ message: `Vendor "${vendor.name}" deleted.` });
  } catch (error) {
    console.error('Delete vendor error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/vendors/:id/ledger - Vendor statement with running balance
router.get('/:id/ledger', auth, requireAccess('vendor-ledger', 'view'), async (req, res) => {
  try {
    const vendor = await db.Vendor.findByPk(req.params.id);
    if (!vendor) {
      return res.status(404).json({ error: 'Vendor not found.' });
    }

    const { startDate, endDate } = req.query;

    const whereClause = { vendorId: vendor.id };
    if (startDate && endDate) whereClause.entryDate = { [Op.between]: [startDate, endDate] };
    else if (startDate) whereClause.entryDate = { [Op.gte]: startDate };
    else if (endDate) whereClause.entryDate = { [Op.lte]: endDate };

    const entries = await db.VendorLedgerEntry.findAll({
      where: whereClause,
      include: [
        { model: db.PurchaseOrder, as: 'purchaseOrder', attributes: ['id', 'poNumber', 'status'] },
        { model: db.User, as: 'creator', attributes: ['id', 'username'] }
      ],
      order: [['entryDate', 'ASC'], ['id', 'ASC']]
    });

    // Balance brought down = everything dated before the requested window.
    // Without a start date the window reaches back to the opening balance itself,
    // so nothing may be pre-accumulated here or the statement double counts.
    let prior = [];
    if (startDate) {
      prior = await db.VendorLedgerEntry.findAll({
        where: { vendorId: vendor.id, entryDate: { [Op.lt]: startDate } },
        attributes: ['direction', 'amount'],
        raw: true
      });
    }

    let balance = Number(vendor.openingBalance) || 0;
    prior.forEach((row) => {
      balance += row.direction === 'Credit' ? Number(row.amount) : -Number(row.amount);
    });
    const openingBalance = ledger.round2(balance);

    let totalCredit = 0;
    let totalDebit = 0;
    const rows = entries.map((entry) => {
      const plain = entry.get({ plain: true });
      const amount = Number(plain.amount);
      if (plain.direction === 'Credit') {
        totalCredit += amount;
        balance += amount;
      } else {
        totalDebit += amount;
        balance -= amount;
      }
      return { ...plain, runningBalance: ledger.round2(balance) };
    });

    res.json({
      vendor: {
        id: vendor.id,
        name: vendor.name,
        code: vendor.code,
        phone: vendor.phone,
        address: vendor.address,
        creditLimit: Number(vendor.creditLimit),
        paymentTermsDays: vendor.paymentTermsDays
      },
      openingBalance,
      totalCredit: ledger.round2(totalCredit),
      totalDebit: ledger.round2(totalDebit),
      closingBalance: ledger.round2(balance),
      entries: rows
    });
  } catch (error) {
    console.error('Vendor ledger error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/vendors/:id/open-orders - Orders still unpaid, used by the payment screen
router.get('/:id/open-orders', auth, requireAccess('vendors', 'view'), async (req, res) => {
  try {
    const vendor = await db.Vendor.findByPk(req.params.id);
    if (!vendor) {
      return res.status(404).json({ error: 'Vendor not found.' });
    }

    const orders = await db.PurchaseOrder.findAll({
      where: { vendorId: vendor.id, status: { [Op.ne]: 'Cancelled' } },
      order: [['orderDate', 'ASC'], ['id', 'ASC']]
    });

    const { byOrder } = await ledger.getOrderPayables();
    const open = orders
      .filter((order) => (byOrder[order.id] || 0) > 0.004)
      .map((order) => ({
        ...order.get({ plain: true }),
        outstanding: byOrder[order.id]
      }));

    res.json(open);
  } catch (error) {
    console.error('Vendor open orders error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/vendors/:id/payments - Pay a vendor, optionally settled against an order number
router.post('/:id/payments', auth, requireAccess('vendor-ledger', 'payment'), async (req, res) => {
  const transaction = await db.sequelize.transaction();
  try {
    const vendor = await db.Vendor.findByPk(req.params.id, { transaction });
    if (!vendor) {
      await transaction.rollback();
      return res.status(404).json({ error: 'Vendor not found.' });
    }
    if (vendor.status !== 'Active') {
      await transaction.rollback();
      return res.status(400).json({ error: 'Cannot record payments for an inactive vendor.' });
    }

    const { amount, paymentDate, paymentType, method, referenceNumber, remarks, purchaseOrderId } = req.body;

    const paymentAmount = ledger.round2(amount);
    if (!(paymentAmount > 0)) {
      await transaction.rollback();
      return res.status(400).json({ error: 'Payment amount must be greater than zero.' });
    }

    let order = null;
    if (purchaseOrderId) {
      order = await db.PurchaseOrder.findByPk(purchaseOrderId, { transaction });
      if (!order) {
        await transaction.rollback();
        return res.status(404).json({ error: 'Purchase order not found.' });
      }
      if (order.vendorId !== vendor.id) {
        await transaction.rollback();
        return res.status(400).json({ error: `Order ${order.poNumber} does not belong to this vendor.` });
      }
      if (order.status === 'Cancelled') {
        await transaction.rollback();
        return res.status(400).json({ error: `Order ${order.poNumber} is cancelled and cannot be paid.` });
      }

      const payable = await ledger.getOrderPayable(order.id, transaction);
      if (paymentAmount > payable.outstanding + 0.004) {
        await transaction.rollback();
        return res.status(400).json({
          error: `Payment of Rs. ${paymentAmount.toLocaleString('en-PK')} is more than the outstanding Rs. ${payable.outstanding.toLocaleString('en-PK')} on ${order.poNumber}. Record it as a vendor-level advance instead.`
        });
      }
    }

    const date = paymentDate || ledger.todayDateOnly();
    const voucherNumber = await ledger.nextDocumentNumber(db.VendorPayment, 'voucherNumber', 'PAY', date, transaction);

    const payment = await db.VendorPayment.create({
      voucherNumber,
      vendorId: vendor.id,
      purchaseOrderId: order ? order.id : null,
      paymentDate: date,
      amount: paymentAmount,
      paymentType: ['Payment', 'Advance', 'Refund Received'].includes(paymentType) ? paymentType : 'Payment',
      method: method || 'Cash',
      referenceNumber: referenceNumber || null,
      remarks: remarks || null,
      createdBy: req.user.id
    }, { transaction });

    const entry = await ledger.postLedgerEntry({
      vendorId: vendor.id,
      entryDate: date,
      voucherNumber,
      entryType: 'Payment',
      direction: 'Debit',
      amount: paymentAmount,
      referenceType: 'vendor-payment',
      referenceId: payment.id,
      purchaseOrderId: order ? order.id : null,
      narration: order
        ? `${payment.paymentType} against ${order.poNumber} (${payment.method})`
        : `${payment.paymentType} to vendor account (${payment.method})`,
      createdBy: req.user.id
    }, transaction);

    await transaction.commit();
    res.status(201).json({ ...payment.get({ plain: true }), ledgerEntry: entry });
  } catch (error) {
    await transaction.rollback();
    console.error('Vendor payment error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/vendors/:id/payments - Payment history of a vendor
router.get('/:id/payments', auth, requireAccess('vendor-ledger', 'view'), async (req, res) => {
  try {
    const payments = await db.VendorPayment.findAll({
      where: { vendorId: req.params.id },
      include: [
        { model: db.PurchaseOrder, as: 'purchaseOrder', attributes: ['id', 'poNumber'] },
        { model: db.User, as: 'creator', attributes: ['id', 'username'] }
      ],
      order: [['paymentDate', 'DESC'], ['id', 'DESC']]
    });
    res.json(payments);
  } catch (error) {
    console.error('Fetch vendor payments error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/vendors/:id/adjustments - Manual credit/debit note against the vendor account
router.post('/:id/adjustments', auth, requireAccess('vendor-ledger', 'adjust'), async (req, res) => {
  const transaction = await db.sequelize.transaction();
  try {
    const vendor = await db.Vendor.findByPk(req.params.id, { transaction });
    if (!vendor) {
      await transaction.rollback();
      return res.status(404).json({ error: 'Vendor not found.' });
    }

    const { entryType, direction, amount, entryDate, narration, purchaseOrderId } = req.body;

    const adjustAmount = ledger.round2(amount);
    if (!(adjustAmount > 0)) {
      await transaction.rollback();
      return res.status(400).json({ error: 'Adjustment amount must be greater than zero.' });
    }
    if (!ADJUSTMENT_TYPES.includes(entryType)) {
      await transaction.rollback();
      return res.status(400).json({ error: `Entry type must be one of: ${ADJUSTMENT_TYPES.join(', ')}.` });
    }
    if (!['Credit', 'Debit'].includes(direction)) {
      await transaction.rollback();
      return res.status(400).json({ error: 'Direction must be Credit or Debit.' });
    }

    let order = null;
    if (purchaseOrderId) {
      order = await db.PurchaseOrder.findByPk(purchaseOrderId, { transaction });
      if (!order || order.vendorId !== vendor.id) {
        await transaction.rollback();
        return res.status(400).json({ error: 'Purchase order not found for this vendor.' });
      }
    }

    if (direction === 'Credit') {
      const current = await ledger.getVendorBalance(vendor, transaction);
      const limitError = ledger.checkCreditLimit(vendor, current.balance + adjustAmount);
      if (limitError) {
        await transaction.rollback();
        return res.status(400).json({ error: limitError });
      }
    }

    const date = entryDate || ledger.todayDateOnly();
    const entry = await ledger.postLedgerEntry({
      vendorId: vendor.id,
      entryDate: date,
      voucherNumber: `ADJ-${Date.now()}`,
      entryType,
      direction,
      amount: adjustAmount,
      referenceType: 'adjustment',
      purchaseOrderId: order ? order.id : null,
      narration: narration || `${entryType} recorded manually`,
      createdBy: req.user.id
    }, transaction);

    await transaction.commit();
    res.status(201).json(entry);
  } catch (error) {
    await transaction.rollback();
    console.error('Vendor adjustment error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
