const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const db = require('../models');
const auth = require('../middleware/auth');
const ledger = require('../services/vendorLedger');
const { requireAccess, hasAccess } = require('../services/access');

// SQLite and MySQL LIKE already ignore case, Postgres LIKE does not — without
// this a search box would silently return nothing for lowercase input.
const containsOp = db.sequelize.getDialect() === 'postgres' ? Op.iLike : Op.like;

// The dashboard renders vendor balances, so a user with dashboard access but no
// Reports tab must still be able to load that one endpoint.
const viewBalances = (req, res, next) => {
  if (hasAccess(req.access, 'reports', 'view') || hasAccess(req.access, 'dashboard', 'view')) return next();
  return res.status(403).json({
    error: 'Not allowed: view on reports. Ask an administrator for this right.',
    module: 'reports',
    action: 'view'
  });
};

// GET /api/reports/batch-production - Batch Production Report
// Filters: startDate, endDate, finishedProductId, batchNumber
router.get('/batch-production', auth, requireAccess('reports', 'view'), async (req, res) => {
  try {
    const { startDate, endDate, finishedProductId, batchNumber } = req.query;

    const whereClause = { isDeleted: false };

    // Apply filters
    if (startDate && endDate) {
      whereClause.creationDate = {
        [Op.between]: [startDate, endDate]
      };
    } else if (startDate) {
      whereClause.creationDate = {
        [Op.gte]: startDate
      };
    } else if (endDate) {
      whereClause.creationDate = {
        [Op.lte]: endDate
      };
    }

    if (finishedProductId) {
      whereClause.finishedProductId = finishedProductId;
    }

    if (batchNumber) {
      whereClause.batchNumber = {
        [containsOp]: `%${batchNumber}%`
      };
    }

    const batches = await db.Batch.findAll({
      where: whereClause,
      include: [
        { model: db.FinishedProduct, as: 'finishedProduct', attributes: ['id', 'name'] },
        { model: db.User, as: 'creator', attributes: ['id', 'username'] }
      ],
      order: [['creationDate', 'DESC'], ['creationTime', 'DESC']]
    });

    res.json(batches);
  } catch (error) {
    console.error('Batch production report error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/reports/raw-consumption - Raw Material Consumption Report
// Filters: startDate, endDate, rawProductId
router.get('/raw-consumption', auth, requireAccess('reports', 'view'), async (req, res) => {
  try {
    const { startDate, endDate, rawProductId } = req.query;

    // Build filter for transactions
    const txWhereClause = {};
    if (startDate && endDate) {
      txWhereClause.createdAt = {
        [Op.between]: [new Date(startDate), new Date(endDate + 'T23:59:59.999Z')]
      };
    } else if (startDate) {
      txWhereClause.createdAt = {
        [Op.gte]: new Date(startDate)
      };
    } else if (endDate) {
      txWhereClause.createdAt = {
        [Op.lte]: new Date(endDate + 'T23:59:59.999Z')
      };
    }

    // Build filter for products
    const prodWhereClause = {};
    if (rawProductId) {
      prodWhereClause.id = rawProductId;
    }

    // Fetch all relevant products
    const products = await db.RawProduct.findAll({
      where: prodWhereClause,
      attributes: ['id', 'name', 'unitType'],
      order: [['name', 'ASC']]
    });

    const reportData = [];

    // For each product, analyze transactions to calculate consumed, returned, net
    for (const prod of products) {
      const txs = await db.InventoryTransaction.findAll({
        where: {
          rawProductId: prod.id,
          ...txWhereClause
        }
      });

      let quantityConsumed = 0;
      let quantityReturned = 0;

      txs.forEach(t => {
        const qty = Number(t.quantity);
        const prev = Number(t.previousStock);
        const curr = Number(t.newStock);

        if (t.transactionType === 'Batch Creation') {
          // Direct consumption
          quantityConsumed += qty;
        } else if (t.transactionType === 'Batch Reversal') {
          // Direct return due to deletion
          quantityReturned += qty;
        } else if (t.transactionType === 'Batch Update') {
          // Check direction based on stock difference
          if (curr < prev) {
            // Deducted extra stock (consumption)
            quantityConsumed += qty;
          } else {
            // Returned stock (return)
            quantityReturned += qty;
          }
        }
        // Note: Manual Stock In and Stock Out are not counted as Batch Consumption,
        // as they represent manual adjustments, not batch-specific run consumption.
      });

      reportData.push({
        productId: prod.id,
        productName: prod.name,
        unitType: prod.unitType,
        quantityConsumed,
        quantityReturned,
        netConsumption: quantityConsumed - quantityReturned
      });
    }

    res.json(reportData);
  } catch (error) {
    console.error('Raw consumption report error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/reports/ledger/:productId - Inventory Ledger Report
// Filters: startDate, endDate (Query params)
router.get('/ledger/:productId', auth, requireAccess('reports', 'view'), async (req, res) => {
  try {
    const { productId } = req.params;
    const { startDate, endDate } = req.query;

    const whereClause = { rawProductId: productId };

    // Apply date filters if available
    if (startDate && endDate) {
      whereClause.createdAt = {
        [Op.between]: [new Date(startDate), new Date(endDate + 'T23:59:59.999Z')]
      };
    } else if (startDate) {
      whereClause.createdAt = {
        [Op.gte]: new Date(startDate)
      };
    } else if (endDate) {
      whereClause.createdAt = {
        [Op.lte]: new Date(endDate + 'T23:59:59.999Z')
      };
    }

    const transactions = await db.InventoryTransaction.findAll({
      where: whereClause,
      include: [
        { model: db.RawProduct, as: 'rawProduct', attributes: ['id', 'name', 'unitType'] },
        { model: db.User, as: 'user', attributes: ['id', 'username'] }
      ],
      order: [['createdAt', 'DESC'], ['id', 'DESC']]
    });

    res.json(transactions);
  } catch (error) {
    console.error('Fetch inventory ledger error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

const daysOverdue = (dueDate) => {
  const due = new Date(`${dueDate}T00:00:00`);
  if (Number.isNaN(due.getTime())) return 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.floor((today - due) / 86400000);
};

// GET /api/reports/purchase-orders - Purchase order register with summary totals
router.get('/purchase-orders', auth, requireAccess('reports', 'view'), async (req, res) => {
  try {
    const { startDate, endDate, vendorId, status, search } = req.query;

    const where = {};
    if (startDate && endDate) where.orderDate = { [Op.between]: [startDate, endDate] };
    else if (startDate) where.orderDate = { [Op.gte]: startDate };
    else if (endDate) where.orderDate = { [Op.lte]: endDate };
    if (vendorId) where.vendorId = vendorId;
    if (status) where.status = status;
    if (search) where.poNumber = { [containsOp]: `%${search}%` };

    const orders = await db.PurchaseOrder.findAll({
      where,
      include: [
        { model: db.Vendor, as: 'vendor', attributes: ['id', 'name', 'code'] },
        {
          model: db.PurchaseOrderItem,
          as: 'items',
          include: [{ model: db.RawProduct, as: 'rawProduct', attributes: ['id', 'name', 'unitType'] }]
        }
      ],
      order: [['orderDate', 'DESC'], ['id', 'DESC']]
    });

    const { byOrder, billedByOrder } = await ledger.getOrderPayables();

    const rows = orders.map((order) => {
      const plain = order.get({ plain: true });
      const quantityOrdered = ledger.round2((plain.items || []).reduce((sum, i) => sum + Number(i.quantityOrdered), 0));
      const quantityReceived = ledger.round2((plain.items || []).reduce((sum, i) => sum + Number(i.quantityReceived), 0));
      const outstanding = byOrder[plain.id] || 0;

      return {
        poNumber: plain.poNumber,
        purchaseOrderId: plain.id,
        orderDate: plain.orderDate,
        expectedDate: plain.expectedDate,
        status: plain.status,
        vendorId: plain.vendorId,
        vendorName: plain.vendor ? plain.vendor.name : '',
        lineCount: (plain.items || []).length,
        productNames: [...new Set((plain.items || []).map((i) => (i.rawProduct ? i.rawProduct.name : '')))],
        quantityOrdered,
        quantityReceived,
        receivedPercent: quantityOrdered > 0 ? ledger.round2((quantityReceived / quantityOrdered) * 100) : 0,
        orderValue: Number(plain.totalAmount),
        billedValue: ledger.round2(billedByOrder[plain.id] || 0),
        outstanding: ledger.round2(outstanding)
      };
    });

    const active = rows.filter((row) => row.status !== 'Cancelled');
    const summary = {
      totalOrders: rows.length,
      draft: rows.filter((r) => r.status === 'Draft').length,
      ordered: rows.filter((r) => r.status === 'Ordered').length,
      partiallyReceived: rows.filter((r) => r.status === 'Partially Received').length,
      received: rows.filter((r) => r.status === 'Received').length,
      cancelled: rows.filter((r) => r.status === 'Cancelled').length,
      openOrders: active.filter((r) => r.receivedPercent < 100).length,
      unpaidOrders: active.filter((r) => r.outstanding > 0.004).length,
      orderValue: ledger.round2(active.reduce((sum, r) => sum + r.orderValue, 0)),
      billedValue: ledger.round2(active.reduce((sum, r) => sum + r.billedValue, 0)),
      totalOutstanding: ledger.round2(active.reduce((sum, r) => sum + r.outstanding, 0))
    };

    res.json({ rows, summary });
  } catch (error) {
    console.error('Purchase order report error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/reports/vendor-balances - Payable position and credit ageing per vendor
router.get('/vendor-balances', auth, viewBalances, async (req, res) => {
  try {
    const vendors = await db.Vendor.findAll({ order: [['name', 'ASC']] });
    const { byOrder, openByVendor } = await ledger.getOrderPayables();

    const orders = await db.PurchaseOrder.findAll({
      where: { status: { [Op.ne]: 'Cancelled' } },
      attributes: ['id', 'vendorId', 'orderDate']
    });
    const orderMeta = {};
    orders.forEach((order) => {
      orderMeta[order.id] = order.get({ plain: true });
    });

    const ledgerTotals = await db.VendorLedgerEntry.findAll({
      attributes: [
        'vendorId',
        'direction',
        [db.sequelize.fn('SUM', db.sequelize.col('amount')), 'total']
      ],
      group: ['vendorId', 'direction'],
      raw: true
    });
    const totalsByVendor = {};
    ledgerTotals.forEach((row) => {
      totalsByVendor[row.vendorId] = totalsByVendor[row.vendorId] || { credit: 0, debit: 0 };
      if (row.direction === 'Credit') totalsByVendor[row.vendorId].credit = Number(row.total);
      else totalsByVendor[row.vendorId].debit = Number(row.total);
    });

    const rows = vendors.map((vendor) => {
      const plain = vendor.get({ plain: true });
      const sums = totalsByVendor[plain.id] || { credit: 0, debit: 0 };
      const payableBalance = ledger.round2(Number(plain.openingBalance) + sums.credit - sums.debit);
      const limit = Number(plain.creditLimit) || 0;
      const terms = Number(plain.paymentTermsDays) || 0;

      const aging = { notDue: 0, d1to30: 0, d31to60: 0, d61to90: 0, d90Plus: 0 };
      let oldestOverdueDays = 0;
      Object.entries(byOrder).forEach(([orderId, outstanding]) => {
        const meta = orderMeta[orderId];
        if (!meta || meta.vendorId !== plain.id || outstanding <= 0.004) return;
        const dueDate = new Date(meta.orderDate);
        dueDate.setDate(dueDate.getDate() + terms);
        const dueStr = dueDate.toISOString().slice(0, 10);
        const overdue = daysOverdue(dueStr);

        if (overdue <= 0) aging.notDue = ledger.round2(aging.notDue + outstanding);
        else if (overdue <= 30) aging.d1to30 = ledger.round2(aging.d1to30 + outstanding);
        else if (overdue <= 60) aging.d31to60 = ledger.round2(aging.d31to60 + outstanding);
        else if (overdue <= 90) aging.d61to90 = ledger.round2(aging.d61to90 + outstanding);
        else aging.d90Plus = ledger.round2(aging.d90Plus + outstanding);

        if (overdue > oldestOverdueDays) oldestOverdueDays = overdue;
      });

      return {
        vendorId: plain.id,
        name: plain.name,
        code: plain.code,
        phone: plain.phone,
        status: plain.status,
        creditLimit: limit,
        openingBalance: Number(plain.openingBalance),
        totalPurchases: ledger.round2(sums.credit),
        totalPaid: ledger.round2(sums.debit),
        payableBalance,
        availableCredit: limit > 0 ? ledger.round2(limit - payableBalance) : null,
        utilizationPercent: limit > 0 ? ledger.round2((payableBalance / limit) * 100) : null,
        overLimit: limit > 0 && payableBalance > limit,
        openOrders: openByVendor[plain.id] || 0,
        paymentTermsDays: terms,
        aging,
        oldestOverdueDays
      };
    });

    res.json({
      rows,
      totals: {
        totalPurchases: ledger.round2(rows.reduce((sum, r) => sum + r.totalPurchases, 0)),
        totalPaid: ledger.round2(rows.reduce((sum, r) => sum + r.totalPaid, 0)),
        totalPayable: ledger.round2(rows.reduce((sum, r) => sum + r.payableBalance, 0)),
        totalOverdue: ledger.round2(rows.reduce((sum, r) => {
          return sum + r.aging.d1to30 + r.aging.d31to60 + r.aging.d61to90 + r.aging.d90Plus;
        }, 0)),
        vendorsOverLimit: rows.filter((r) => r.overLimit).length
      }
    });
  } catch (error) {
    console.error('Vendor balances report error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/reports/purchase-summary - What was bought, from whom, at what average rate
router.get('/purchase-summary', auth, requireAccess('reports', 'view'), async (req, res) => {
  try {
    const { startDate, endDate, vendorId } = req.query;

    const orderWhere = { status: { [Op.ne]: 'Cancelled' } };
    if (startDate && endDate) orderWhere.orderDate = { [Op.between]: [startDate, endDate] };
    else if (startDate) orderWhere.orderDate = { [Op.gte]: startDate };
    else if (endDate) orderWhere.orderDate = { [Op.lte]: endDate };
    if (vendorId) orderWhere.vendorId = vendorId;

    const orders = await db.PurchaseOrder.findAll({
      where: orderWhere,
      attributes: ['id', 'vendorId', 'orderDate', 'discountAmount', 'taxPercent', 'subtotal'],
      include: [
        { model: db.Vendor, as: 'vendor', attributes: ['id', 'name'] },
        {
          model: db.PurchaseOrderItem,
          as: 'items',
          include: [{ model: db.RawProduct, as: 'rawProduct', attributes: ['id', 'name', 'unitType'] }]
        }
      ]
    });

    const itemIds = [];
    orders.forEach((order) => {
      order.get({ plain: true }).items.forEach((item) => itemIds.push(item.id));
    });

    const receiptItems = itemIds.length
      ? await db.GoodsReceiptItem.findAll({ where: { purchaseOrderItemId: { [Op.in]: itemIds } }, raw: true })
      : [];
    const returnItems = itemIds.length
      ? await db.PurchaseReturnItem.findAll({ where: { purchaseOrderItemId: { [Op.in]: itemIds } }, raw: true })
      : [];

    const receivedByItem = {};
    receiptItems.forEach((row) => {
      const key = row.purchaseOrderItemId;
      receivedByItem[key] = receivedByItem[key] || { qty: 0, value: 0 };
      receivedByItem[key].qty += Number(row.quantityReceived);
      receivedByItem[key].value += Number(row.lineAmount);
    });
    const returnedByItem = {};
    returnItems.forEach((row) => {
      const key = row.purchaseOrderItemId;
      returnedByItem[key] = returnedByItem[key] || { qty: 0, value: 0 };
      returnedByItem[key].qty += Number(row.quantityReturned);
      returnedByItem[key].value += Number(row.lineAmount);
    });

    const byProduct = {};
    const byVendor = {};

    orders.forEach((order) => {
      const plain = order.get({ plain: true });
      const pricing = ledger.buildPricingFactors(plain);

      const vendorKey = plain.vendorId;
      byVendor[vendorKey] = byVendor[vendorKey] || {
        vendorId: vendorKey,
        vendorName: plain.vendor ? plain.vendor.name : '',
        orders: 0,
        orderValue: 0,
        receivedValue: 0,
        returnedValue: 0
      };
      byVendor[vendorKey].orders += 1;
      byVendor[vendorKey].orderValue = ledger.round2(byVendor[vendorKey].orderValue + Number(plain.subtotal));

      (plain.items || []).forEach((item) => {
        const key = item.rawProductId;
        const productName = item.rawProduct ? item.rawProduct.name : `Product #${key}`;
        byProduct[key] = byProduct[key] || {
          rawProductId: key,
          productName,
          unitType: item.rawProduct ? item.rawProduct.unitType : '',
          timesOrdered: 0,
          qtyOrdered: 0,
          orderedValue: 0,
          qtyReceived: 0,
          receivedValue: 0,
          qtyReturned: 0,
          returnedValue: 0,
          vendors: new Set(),
          lastOrderDate: null
        };

        const bucket = byProduct[key];
        const received = receivedByItem[item.id] || { qty: 0, value: 0 };
        const returned = returnedByItem[item.id] || { qty: 0, value: 0 };
        const grossReceived = received.value - returned.value;

        bucket.timesOrdered += 1;
        bucket.qtyOrdered = ledger.round2(bucket.qtyOrdered + Number(item.quantityOrdered));
        bucket.orderedValue = ledger.round2(bucket.orderedValue + Number(item.quantityOrdered) * Number(item.unitRate));
        bucket.qtyReceived = ledger.round2(bucket.qtyReceived + received.qty - returned.qty);
        bucket.receivedValue = ledger.round2(bucket.receivedValue + pricing.price(received.value));
        bucket.qtyReturned = ledger.round2(bucket.qtyReturned + returned.qty);
        bucket.returnedValue = ledger.round2(bucket.returnedValue + pricing.price(returned.value));
        bucket.vendors.add(plain.vendor ? plain.vendor.name : '');
        if (!bucket.lastOrderDate || plain.orderDate > bucket.lastOrderDate) {
          bucket.lastOrderDate = plain.orderDate;
        }
        byVendor[vendorKey].receivedValue = ledger.round2(byVendor[vendorKey].receivedValue + pricing.price(grossReceived));
        byVendor[vendorKey].returnedValue = ledger.round2(byVendor[vendorKey].returnedValue + pricing.price(returned.value));
      });
    });

    const productRows = Object.values(byProduct).map((bucket) => ({
      ...bucket,
      vendorCount: bucket.vendors.size,
      vendorNames: [...bucket.vendors],
      averageNetRate: bucket.qtyReceived > 0 ? ledger.round2(bucket.receivedValue / bucket.qtyReceived) : 0,
      vendors: undefined
    })).sort((a, b) => b.receivedValue - a.receivedValue);

    res.json({
      byProduct: productRows,
      byVendor: Object.values(byVendor).sort((a, b) => b.receivedValue - a.receivedValue),
      totals: {
        orders: orders.length,
        productsPurchased: productRows.length,
        orderedValue: ledger.round2(productRows.reduce((sum, r) => sum + r.orderedValue, 0)),
        receivedValue: ledger.round2(productRows.reduce((sum, r) => sum + r.receivedValue, 0)),
        returnedValue: ledger.round2(productRows.reduce((sum, r) => sum + r.returnedValue, 0))
      }
    });
  } catch (error) {
    console.error('Purchase summary report error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
