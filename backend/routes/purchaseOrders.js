const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const db = require('../models');
const auth = require('../middleware/auth');
const ledger = require('../services/vendorLedger');

// SQLite and MySQL LIKE already ignore case, Postgres LIKE does not — without
// this a PO number search would silently return nothing for lowercase input.
const containsOp = db.sequelize.getDialect() === 'postgres' ? Op.iLike : Op.like;

function computeTotals(items, discountAmount, taxPercent) {
  const subtotal = ledger.round2(items.reduce((sum, item) => {
    return sum + Number(item.quantityOrdered) * Number(item.unitRate);
  }, 0));

  const discount = ledger.round2(Math.min(Math.max(Number(discountAmount) || 0, 0), subtotal));
  const tax = ledger.round2(Math.min(Math.max(Number(taxPercent) || 0, 0), 100)) / 100;
  const taxable = subtotal - discount;
  const taxAmount = ledger.round2(taxable * tax);

  return {
    subtotal,
    discountAmount: discount,
    taxPercent: ledger.round2(tax * 100),
    taxAmount,
    totalAmount: ledger.round2(taxable + taxAmount)
  };
}

const asPlain = (row) => (typeof row.get === 'function' ? row.get({ plain: true }) : row);

/**
 * Adds receipt/return/payable figures to purchase order rows.
 */
async function decorate(orders) {
  if (orders.length === 0) return [];

  const orderIds = orders.map((order) => order.id);

  const receiptTotals = await db.GoodsReceiptItem.findAll({
    attributes: [
      'purchaseOrderItemId',
      [db.sequelize.fn('SUM', db.sequelize.col('quantityReceived')), 'qty'],
      [db.sequelize.fn('SUM', db.sequelize.col('lineAmount')), 'value']
    ],
    include: [{
      model: db.GoodsReceipt,
      as: 'goodsReceipt',
      where: { purchaseOrderId: { [Op.in]: orderIds } },
      attributes: []
    }],
    group: ['purchaseOrderItemId'],
    raw: true
  });

  const returnTotals = await db.PurchaseReturnItem.findAll({
    attributes: [
      'purchaseOrderItemId',
      [db.sequelize.fn('SUM', db.sequelize.col('quantityReturned')), 'qty'],
      [db.sequelize.fn('SUM', db.sequelize.col('lineAmount')), 'value']
    ],
    include: [{
      model: db.PurchaseReturn,
      as: 'purchaseReturn',
      where: { purchaseOrderId: { [Op.in]: orderIds } },
      attributes: []
    }],
    group: ['purchaseOrderItemId'],
    raw: true
  });

  const receivedByItem = {};
  receiptTotals.forEach((row) => {
    receivedByItem[row.purchaseOrderItemId] = { qty: Number(row.qty || 0), value: Number(row.value || 0) };
  });
  const returnedByItem = {};
  returnTotals.forEach((row) => {
    returnedByItem[row.purchaseOrderItemId] = { qty: Number(row.qty || 0), value: Number(row.value || 0) };
  });

  const { byOrder, billedByOrder, settledByOrder } = await ledger.getOrderPayables();

  return orders.map((rawOrder) => {
    const order = asPlain(rawOrder);
    const items = (order.items || []).map((item) => {
      const receivedQty = Number(item.quantityReceived) || 0;
      const returnedQty = Number(item.quantityReturned) || 0;
      const orderedQty = Number(item.quantityOrdered) || 0;
      return {
        ...item,
        lineAmount: ledger.round2(orderedQty * Number(item.unitRate)),
        remainingQuantity: ledger.round2(orderedQty - receivedQty),
        returnableQuantity: ledger.round2(receivedQty - returnedQty),
        receivedValue: ledger.round2((receivedByItem[item.id] || {}).value || 0),
        returnedValue: ledger.round2((returnedByItem[item.id] || {}).value || 0)
      };
    });

    const totalOrderedQty = ledger.round2(items.reduce((sum, i) => sum + Number(i.quantityOrdered), 0));
    const totalReceivedQty = ledger.round2(items.reduce((sum, i) => sum + Number(i.quantityReceived), 0));
    const totalReturnedQty = ledger.round2(items.reduce((sum, i) => sum + Number(i.quantityReturned), 0));
    const billedAmount = billedByOrder[order.id] || 0;
    const settledAmount = settledByOrder[order.id] || 0;
    const payable = byOrder[order.id] !== undefined
      ? byOrder[order.id]
      : ledger.round2(items.reduce((sum, i) => sum + i.receivedValue - i.returnedValue, 0));

    return {
      ...order,
      items,
      totalOrderedQty,
      totalReceivedQty,
      totalReturnedQty,
      receiptCount: (order.receipts || []).length,
      returnCount: (order.returns || []).length,
      paymentCount: (order.payments || []).length,
      receivedPercent: totalOrderedQty > 0 ? ledger.round2((totalReceivedQty / totalOrderedQty) * 100) : 0,
      billedAmount: ledger.round2(billedAmount),
      settledAmount: ledger.round2(settledAmount),
      outstanding: payable,
      isFullyReceived: totalOrderedQty > 0 && totalReceivedQty >= totalOrderedQty,
      isSettled: Math.abs(payable) < 0.005
    };
  });
}

// GET /api/purchase-orders - Purchase order register
router.get('/', auth, async (req, res) => {
  try {
    const { status, vendorId, startDate, endDate, search } = req.query;

    const where = {};
    if (status) where.status = status;
    if (vendorId) where.vendorId = vendorId;
    if (startDate && endDate) where.orderDate = { [Op.between]: [startDate, endDate] };
    else if (startDate) where.orderDate = { [Op.gte]: startDate };
    else if (endDate) where.orderDate = { [Op.lte]: endDate };
    if (search) where.poNumber = { [containsOp]: `%${search}%` };

    const orders = await db.PurchaseOrder.findAll({
      where,
      include: [
        { model: db.Vendor, as: 'vendor', attributes: ['id', 'name', 'code', 'phone'] },
        { model: db.User, as: 'creator', attributes: ['id', 'username'] },
        {
          model: db.PurchaseOrderItem,
          as: 'items',
          include: [{ model: db.RawProduct, as: 'rawProduct', attributes: ['id', 'name', 'unitType'] }]
        }
      ],
      order: [['orderDate', 'DESC'], ['id', 'DESC']]
    });

    res.json(await decorate(orders));
  } catch (error) {
    console.error('Fetch purchase orders error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/purchase-orders/:id - Full order document
router.get('/:id', auth, async (req, res) => {
  try {
    const order = await db.PurchaseOrder.findByPk(req.params.id, {
      include: [
        { model: db.Vendor, as: 'vendor' },
        { model: db.User, as: 'creator', attributes: ['id', 'username'] },
        { model: db.User, as: 'confirmer', attributes: ['id', 'username'] },
        {
          model: db.PurchaseOrderItem,
          as: 'items',
          include: [{ model: db.RawProduct, as: 'rawProduct', attributes: ['id', 'name', 'unitType', 'currentStock'] }]
        },
        {
          model: db.GoodsReceipt,
          as: 'receipts',
          include: [{
            model: db.GoodsReceiptItem,
            as: 'items',
            include: [{ model: db.RawProduct, as: 'rawProduct', attributes: ['id', 'name', 'unitType'] }]
          }]
        },
        {
          model: db.PurchaseReturn,
          as: 'returns',
          include: [{
            model: db.PurchaseReturnItem,
            as: 'items',
            include: [{ model: db.RawProduct, as: 'rawProduct', attributes: ['id', 'name', 'unitType'] }]
          }]
        },
        { model: db.VendorPayment, as: 'payments' },
        {
          model: db.VendorLedgerEntry,
          as: 'ledgerEntries',
          include: [{ model: db.User, as: 'creator', attributes: ['id', 'username'] }]
        }
      ]
    });

    if (!order) {
      return res.status(404).json({ error: 'Purchase order not found.' });
    }

    // Sequelize ignores include-level `order` once this many associations are
    // eager loaded together, so the document lists are sorted here instead.
    const byDateThenId = (dateKey) => (a, b) =>
      String(a[dateKey]).localeCompare(String(b[dateKey])) || a.id - b.id;
    order.receipts.sort(byDateThenId('receivedDate'));
    order.returns.sort(byDateThenId('returnDate'));
    order.payments.sort(byDateThenId('paymentDate'));
    order.ledgerEntries.sort(byDateThenId('entryDate'));

    const [decorated] = await decorate([order]);
    res.json(decorated);
  } catch (error) {
    console.error('Fetch purchase order detail error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/purchase-orders - Raise a purchase order against a vendor
router.post('/', auth, async (req, res) => {
  const transaction = await db.sequelize.transaction();
  try {
    const {
      vendorId, orderDate, expectedDate, items, discountAmount, taxPercent,
      paymentMode, vendorInvoiceNumber, vendorInvoiceDate, remarks, confirm
    } = req.body;

    if (!vendorId) {
      await transaction.rollback();
      return res.status(400).json({ error: 'Vendor is required.' });
    }

    const vendor = await db.Vendor.findByPk(vendorId, { transaction });
    if (!vendor) {
      await transaction.rollback();
      return res.status(404).json({ error: 'Vendor not found.' });
    }
    if (vendor.status !== 'Active') {
      await transaction.rollback();
      return res.status(400).json({ error: `Vendor "${vendor.name}" is inactive. Select an active vendor.` });
    }

    if (!Array.isArray(items) || items.length === 0) {
      await transaction.rollback();
      return res.status(400).json({ error: 'Add at least one raw product line to the order.' });
    }

    const cleanItems = [];
    const seenProducts = new Set();
    for (const item of items) {
      const rawProductId = Number(item.rawProductId);
      const quantity = Number(item.quantityOrdered);
      const rate = Number(item.unitRate);

      if (!rawProductId || seenProducts.has(rawProductId)) {
        await transaction.rollback();
        return res.status(400).json({ error: 'Every line needs a different raw product.' });
      }
      if (!(quantity > 0)) {
        await transaction.rollback();
        return res.status(400).json({ error: 'Ordered quantity must be greater than zero on every line.' });
      }
      if (!(rate >= 0)) {
        await transaction.rollback();
        return res.status(400).json({ error: 'Unit rate cannot be negative.' });
      }

      const product = await db.RawProduct.findByPk(rawProductId, { transaction });
      if (!product) {
        await transaction.rollback();
        return res.status(404).json({ error: `Raw product with ID ${rawProductId} not found.` });
      }

      seenProducts.add(rawProductId);
      cleanItems.push({ rawProductId, quantityOrdered: quantity, unitRate: rate, remarks: item.remarks || null });
    }

    const totals = computeTotals(cleanItems, discountAmount, taxPercent);
    const date = orderDate || ledger.todayDateOnly();

    if (confirm) {
      const current = await ledger.getVendorBalance(vendor, transaction);
      const limitError = ledger.checkCreditLimit(vendor, current.balance + totals.totalAmount);
      if (limitError) {
        await transaction.rollback();
        return res.status(400).json({ error: limitError });
      }
    }

    const poNumber = await ledger.nextDocumentNumber(db.PurchaseOrder, 'poNumber', 'PO', date, transaction);

    const order = await db.PurchaseOrder.create({
      poNumber,
      vendorId: vendor.id,
      orderDate: date,
      expectedDate: expectedDate || null,
      status: confirm ? 'Ordered' : 'Draft',
      vendorInvoiceNumber: vendorInvoiceNumber || null,
      vendorInvoiceDate: vendorInvoiceDate || null,
      subtotal: totals.subtotal,
      discountAmount: totals.discountAmount,
      taxPercent: totals.taxPercent,
      taxAmount: totals.taxAmount,
      totalAmount: totals.totalAmount,
      paymentMode: ['Credit', 'Advance', 'Cash on Delivery'].includes(paymentMode) ? paymentMode : 'Credit',
      remarks: remarks || null,
      createdBy: req.user.id,
      confirmedBy: confirm ? req.user.id : null,
      confirmedAt: confirm ? new Date() : null
    }, { transaction });

    for (const item of cleanItems) {
      await db.PurchaseOrderItem.create({
        ...item,
        purchaseOrderId: order.id
      }, { transaction });
    }

    await transaction.commit();

    const created = await db.PurchaseOrder.findByPk(order.id, {
      include: [
        { model: db.Vendor, as: 'vendor', attributes: ['id', 'name', 'code'] },
        {
          model: db.PurchaseOrderItem,
          as: 'items',
          include: [{ model: db.RawProduct, as: 'rawProduct', attributes: ['id', 'name', 'unitType'] }]
        }
      ]
    });
    const [decorated] = await decorate([created]);
    res.status(201).json(decorated);
  } catch (error) {
    await transaction.rollback();
    console.error('Create purchase order error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/purchase-orders/:id - Edit a draft order (lines are replaced as a whole)
router.put('/:id', auth, async (req, res) => {
  const transaction = await db.sequelize.transaction();
  try {
    const order = await db.PurchaseOrder.findByPk(req.params.id, { transaction });
    if (!order) {
      await transaction.rollback();
      return res.status(404).json({ error: 'Purchase order not found.' });
    }
    if (order.status !== 'Draft') {
      await transaction.rollback();
      return res.status(400).json({ error: `Only a Draft order can be edited. ${order.poNumber} is ${order.status}.` });
    }

    const {
      vendorId, orderDate, expectedDate, items, discountAmount, taxPercent,
      paymentMode, vendorInvoiceNumber, vendorInvoiceDate, remarks
    } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      await transaction.rollback();
      return res.status(400).json({ error: 'Add at least one raw product line to the order.' });
    }

    const targetVendorId = vendorId || order.vendorId;
    const vendor = await db.Vendor.findByPk(targetVendorId, { transaction });
    if (!vendor) {
      await transaction.rollback();
      return res.status(404).json({ error: 'Vendor not found.' });
    }

    const cleanItems = [];
    const seenProducts = new Set();
    for (const item of items) {
      const rawProductId = Number(item.rawProductId);
      const quantity = Number(item.quantityOrdered);
      const rate = Number(item.unitRate);

      if (!rawProductId || seenProducts.has(rawProductId)) {
        await transaction.rollback();
        return res.status(400).json({ error: 'Every line needs a different raw product.' });
      }
      if (!(quantity > 0)) {
        await transaction.rollback();
        return res.status(400).json({ error: 'Ordered quantity must be greater than zero on every line.' });
      }
      if (!(rate >= 0)) {
        await transaction.rollback();
        return res.status(400).json({ error: 'Unit rate cannot be negative.' });
      }

      const product = await db.RawProduct.findByPk(rawProductId, { transaction });
      if (!product) {
        await transaction.rollback();
        return res.status(404).json({ error: `Raw product with ID ${rawProductId} not found.` });
      }

      seenProducts.add(rawProductId);
      cleanItems.push({ rawProductId, quantityOrdered: quantity, unitRate: rate, remarks: item.remarks || null });
    }

    const totals = computeTotals(cleanItems, discountAmount, taxPercent);

    order.vendorId = vendor.id;
    if (orderDate) order.orderDate = orderDate;
    if (expectedDate !== undefined) order.expectedDate = expectedDate || null;
    if (vendorInvoiceNumber !== undefined) order.vendorInvoiceNumber = vendorInvoiceNumber || null;
    if (vendorInvoiceDate !== undefined) order.vendorInvoiceDate = vendorInvoiceDate || null;
    if (paymentMode !== undefined) order.paymentMode = paymentMode;
    if (remarks !== undefined) order.remarks = remarks;
    order.subtotal = totals.subtotal;
    order.discountAmount = totals.discountAmount;
    order.taxPercent = totals.taxPercent;
    order.taxAmount = totals.taxAmount;
    order.totalAmount = totals.totalAmount;
    await order.save({ transaction });

    await db.PurchaseOrderItem.destroy({ where: { purchaseOrderId: order.id }, transaction });
    for (const item of cleanItems) {
      await db.PurchaseOrderItem.create({ ...item, purchaseOrderId: order.id }, { transaction });
    }

    await transaction.commit();

    const updated = await db.PurchaseOrder.findByPk(order.id, {
      include: [
        { model: db.Vendor, as: 'vendor', attributes: ['id', 'name', 'code'] },
        {
          model: db.PurchaseOrderItem,
          as: 'items',
          include: [{ model: db.RawProduct, as: 'rawProduct', attributes: ['id', 'name', 'unitType'] }]
        }
      ]
    });
    const [decorated] = await decorate([updated]);
    res.json(decorated);
  } catch (error) {
    await transaction.rollback();
    console.error('Update purchase order error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/purchase-orders/:id/status - Confirm or cancel an order
router.patch('/:id/status', auth, async (req, res) => {
  const transaction = await db.sequelize.transaction();
  try {
    const order = await db.PurchaseOrder.findByPk(req.params.id, {
      include: [{ model: db.Vendor, as: 'vendor' }],
      transaction
    });
    if (!order) {
      await transaction.rollback();
      return res.status(404).json({ error: 'Purchase order not found.' });
    }

    const { action, reason } = req.body;

    if (action === 'confirm') {
      if (order.status !== 'Draft') {
        await transaction.rollback();
        return res.status(400).json({ error: `Only a Draft order can be confirmed. ${order.poNumber} is ${order.status}.` });
      }

      const current = await ledger.getVendorBalance(order.vendor, transaction);
      const limitError = ledger.checkCreditLimit(order.vendor, current.balance + Number(order.totalAmount));
      if (limitError) {
        await transaction.rollback();
        return res.status(400).json({ error: limitError });
      }

      order.status = 'Ordered';
      order.confirmedBy = req.user.id;
      order.confirmedAt = new Date();
      await order.save({ transaction });
    } else if (action === 'cancel') {
      if (order.status === 'Cancelled') {
        await transaction.rollback();
        return res.status(400).json({ error: 'This order is already cancelled.' });
      }
      if (order.status === 'Received') {
        await transaction.rollback();
        return res.status(400).json({ error: 'A fully received order cannot be cancelled. Use Purchase Return instead.' });
      }

      const receiptCount = await db.GoodsReceipt.count({ where: { purchaseOrderId: order.id }, transaction });
      if (receiptCount > 0) {
        await transaction.rollback();
        return res.status(400).json({
          error: `${order.poNumber} already has ${receiptCount} goods receipt(s). Return the received stock first, then cancel.`
        });
      }

      const payable = await ledger.getOrderPayable(order.id, transaction);
      if (Math.abs(payable.outstanding) > 0.004) {
        await transaction.rollback();
        return res.status(400).json({ error: `${order.poNumber} still shows Rs. ${payable.outstanding.toLocaleString('en-PK')} outstanding. Settle it before cancelling.` });
      }

      order.status = 'Cancelled';
      order.cancelledBy = req.user.id;
      order.cancelledAt = new Date();
      order.cancelReason = reason || null;
      await order.save({ transaction });
    } else {
      await transaction.rollback();
      return res.status(400).json({ error: "Action must be either 'confirm' or 'cancel'." });
    }

    await transaction.commit();

    const updated = await db.PurchaseOrder.findByPk(order.id, {
      include: [
        { model: db.Vendor, as: 'vendor', attributes: ['id', 'name', 'code'] },
        {
          model: db.PurchaseOrderItem,
          as: 'items',
          include: [{ model: db.RawProduct, as: 'rawProduct', attributes: ['id', 'name', 'unitType'] }]
        }
      ]
    });
    const [decorated] = await decorate([updated]);
    res.json(decorated);
  } catch (error) {
    await transaction.rollback();
    console.error('Purchase order status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/purchase-orders/:id - Remove a draft order
router.delete('/:id', auth, async (req, res) => {
  try {
    const order = await db.PurchaseOrder.findByPk(req.params.id);
    if (!order) {
      return res.status(404).json({ error: 'Purchase order not found.' });
    }
    if (order.status !== 'Draft') {
      return res.status(400).json({ error: 'Only Draft orders can be deleted. Cancel a confirmed order instead.' });
    }

    await db.PurchaseOrderItem.destroy({ where: { purchaseOrderId: order.id } });
    await order.destroy();
    res.json({ message: `Draft order ${order.poNumber} deleted.` });
  } catch (error) {
    console.error('Delete purchase order error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/purchase-orders/:id/receipts - Receive goods: raises stock and credits the vendor
router.post('/:id/receipts', auth, async (req, res) => {
  const transaction = await db.sequelize.transaction();
  try {
    const order = await db.PurchaseOrder.findByPk(req.params.id, {
      include: [
        { model: db.Vendor, as: 'vendor' },
        { model: db.PurchaseOrderItem, as: 'items' }
      ],
      transaction
    });
    if (!order) {
      await transaction.rollback();
      return res.status(404).json({ error: 'Purchase order not found.' });
    }
    if (!['Ordered', 'Partially Received'].includes(order.status)) {
      await transaction.rollback();
      return res.status(400).json({ error: `Goods can only be received against an Ordered purchase order. ${order.poNumber} is ${order.status}.` });
    }

    const { items, receivedDate, vendorInvoiceNumber, otherCharges, remarks } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      await transaction.rollback();
      return res.status(400).json({ error: 'Select at least one order line to receive.' });
    }

    const date = receivedDate || ledger.todayDateOnly();
    const extraCharges = ledger.round2(Math.max(Number(otherCharges) || 0, 0));
    const pricing = ledger.buildPricingFactors(order);

    // Validate every line before touching stock
    const lines = [];
    for (const line of items) {
      const orderItem = order.items.find((item) => item.id === Number(line.purchaseOrderItemId));
      if (!orderItem) {
        await transaction.rollback();
        return res.status(400).json({ error: `Order line ${line.purchaseOrderItemId} does not belong to ${order.poNumber}.` });
      }

      const qty = Number(line.quantityReceived);
      const remaining = Number(orderItem.quantityOrdered) - Number(orderItem.quantityReceived);
      if (!(qty > 0)) {
        await transaction.rollback();
        return res.status(400).json({ error: 'Received quantity must be greater than zero.' });
      }
      if (qty > remaining + 0.004) {
        await transaction.rollback();
        return res.status(400).json({
          error: `Cannot receive ${qty} of this item. Only ${ledger.round2(remaining)} still pending on ${order.poNumber}.`
        });
      }

      const product = await db.RawProduct.findByPk(orderItem.rawProductId, { transaction });
      if (!product) {
        await transaction.rollback();
        return res.status(404).json({ error: `Raw product with ID ${orderItem.rawProductId} not found.` });
      }

      lines.push({ orderItem, product, qty });
    }

    const goodsValue = ledger.round2(lines.reduce((sum, line) => {
      return sum + line.qty * Number(line.orderItem.unitRate);
    }, 0));
    const creditedAmount = ledger.round2(pricing.price(goodsValue) + extraCharges);

    const current = await ledger.getVendorBalance(order.vendor, transaction);
    const limitError = ledger.checkCreditLimit(order.vendor, current.balance + creditedAmount);
    if (limitError) {
      await transaction.rollback();
      return res.status(400).json({ error: limitError });
    }

    const grnNumber = await ledger.nextDocumentNumber(db.GoodsReceipt, 'grnNumber', 'GRN', date, transaction);

    const receipt = await db.GoodsReceipt.create({
      grnNumber,
      purchaseOrderId: order.id,
      vendorId: order.vendorId,
      receivedDate: date,
      vendorInvoiceNumber: vendorInvoiceNumber || order.vendorInvoiceNumber || null,
      otherCharges: extraCharges,
      goodsValue: pricing.price(goodsValue),
      creditedAmount,
      remarks: remarks || null,
      createdBy: req.user.id
    }, { transaction });

    for (const line of lines) {
      const { orderItem, product, qty } = line;
      const lineAmount = ledger.round2(qty * Number(orderItem.unitRate));

      await db.GoodsReceiptItem.create({
        goodsReceiptId: receipt.id,
        purchaseOrderItemId: orderItem.id,
        rawProductId: product.id,
        quantityReceived: qty,
        unitRate: Number(orderItem.unitRate),
        lineAmount
      }, { transaction });

      orderItem.quantityReceived = ledger.round2(Number(orderItem.quantityReceived) + qty);
      await orderItem.save({ transaction });

      const previousStock = Number(product.currentStock);
      const newStock = ledger.round2(previousStock + qty);
      product.currentStock = newStock;
      await product.save({ transaction });

      await db.InventoryTransaction.create({
        rawProductId: product.id,
        transactionType: 'Stock In',
        quantity: qty,
        previousStock,
        newStock,
        referenceType: 'purchase-order',
        referenceId: order.id,
        purchaseReference: grnNumber,
        remarks: `Received against ${order.poNumber} from ${order.vendor.name}`,
        userId: req.user.id
      }, { transaction });
    }

    const totalOrdered = ledger.round2(order.items.reduce((sum, item) => sum + Number(item.quantityOrdered), 0));
    const totalReceived = ledger.round2(order.items.reduce((sum, item) => sum + Number(item.quantityReceived), 0));
    order.status = totalReceived >= totalOrdered ? 'Received' : 'Partially Received';
    await order.save({ transaction });

    await ledger.postLedgerEntry({
      vendorId: order.vendorId,
      entryDate: date,
      voucherNumber: grnNumber,
      entryType: 'Purchase Invoice',
      direction: 'Credit',
      amount: creditedAmount,
      referenceType: 'goods-receipt',
      referenceId: receipt.id,
      purchaseOrderId: order.id,
      narration: `Goods received against ${order.poNumber}${extraCharges > 0 ? ` incl. Rs. ${extraCharges.toLocaleString('en-PK')} charges` : ''}`,
      createdBy: req.user.id
    }, transaction);

    await transaction.commit();

    const updated = await db.PurchaseOrder.findByPk(order.id, {
      include: [
        { model: db.Vendor, as: 'vendor', attributes: ['id', 'name', 'code'] },
        {
          model: db.PurchaseOrderItem,
          as: 'items',
          include: [{ model: db.RawProduct, as: 'rawProduct', attributes: ['id', 'name', 'unitType'] }]
        },
        { model: db.GoodsReceipt, as: 'receipts' }
      ]
    });
    const [decorated] = await decorate([updated]);
    res.status(201).json({
      ...decorated,
      message: `${grnNumber} recorded. Stock updated and Rs. ${creditedAmount.toLocaleString('en-PK')} credited to ${order.vendor.name}.`
    });
  } catch (error) {
    await transaction.rollback();
    console.error('Goods receipt error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/purchase-orders/:id/returns - Send goods back: lowers stock and debits the vendor
router.post('/:id/returns', auth, async (req, res) => {
  const transaction = await db.sequelize.transaction();
  try {
    const order = await db.PurchaseOrder.findByPk(req.params.id, {
      include: [
        { model: db.Vendor, as: 'vendor' },
        { model: db.PurchaseOrderItem, as: 'items' }
      ],
      transaction
    });
    if (!order) {
      await transaction.rollback();
      return res.status(404).json({ error: 'Purchase order not found.' });
    }
    if (!['Partially Received', 'Received'].includes(order.status)) {
      await transaction.rollback();
      return res.status(400).json({ error: `Nothing has been received against ${order.poNumber} yet, so there is nothing to return.` });
    }

    const { items, returnDate, reason, remarks } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      await transaction.rollback();
      return res.status(400).json({ error: 'Select at least one order line to return.' });
    }

    const date = returnDate || ledger.todayDateOnly();
    const pricing = ledger.buildPricingFactors(order);

    const lines = [];
    for (const line of items) {
      const orderItem = order.items.find((item) => item.id === Number(line.purchaseOrderItemId));
      if (!orderItem) {
        await transaction.rollback();
        return res.status(400).json({ error: `Order line ${line.purchaseOrderItemId} does not belong to ${order.poNumber}.` });
      }

      const qty = Number(line.quantityReturned);
      const returnable = Number(orderItem.quantityReceived) - Number(orderItem.quantityReturned);
      if (!(qty > 0)) {
        await transaction.rollback();
        return res.status(400).json({ error: 'Return quantity must be greater than zero.' });
      }
      if (qty > returnable + 0.004) {
        await transaction.rollback();
        return res.status(400).json({
          error: `Only ${ledger.round2(returnable)} is available to return on this line of ${order.poNumber}.`
        });
      }

      const product = await db.RawProduct.findByPk(orderItem.rawProductId, { transaction });
      if (!product) {
        await transaction.rollback();
        return res.status(404).json({ error: `Raw product with ID ${orderItem.rawProductId} not found.` });
      }
      if (Number(product.currentStock) < qty) {
        await transaction.rollback();
        return res.status(400).json({
          error: `Cannot return ${qty} of "${product.name}". Only ${Number(product.currentStock)} available in store (some may already be consumed in production).`
        });
      }

      lines.push({ orderItem, product, qty });
    }

    const goodsValue = ledger.round2(lines.reduce((sum, line) => {
      return sum + line.qty * Number(line.orderItem.unitRate);
    }, 0));
    const debitedAmount = pricing.price(goodsValue);

    const returnNumber = await ledger.nextDocumentNumber(db.PurchaseReturn, 'returnNumber', 'PR', date, transaction);

    const purchaseReturn = await db.PurchaseReturn.create({
      returnNumber,
      purchaseOrderId: order.id,
      vendorId: order.vendorId,
      returnDate: date,
      reason: ['Damaged', 'Wrong Item', 'Excess Quantity', 'Quality Issue', 'Expired', 'Other'].includes(reason) ? reason : 'Other',
      goodsValue: debitedAmount,
      debitedAmount,
      remarks: remarks || null,
      createdBy: req.user.id
    }, { transaction });

    for (const line of lines) {
      const { orderItem, product, qty } = line;

      await db.PurchaseReturnItem.create({
        purchaseReturnId: purchaseReturn.id,
        purchaseOrderItemId: orderItem.id,
        rawProductId: product.id,
        quantityReturned: qty,
        unitRate: Number(orderItem.unitRate),
        lineAmount: ledger.round2(qty * Number(orderItem.unitRate))
      }, { transaction });

      orderItem.quantityReturned = ledger.round2(Number(orderItem.quantityReturned) + qty);
      await orderItem.save({ transaction });

      const previousStock = Number(product.currentStock);
      const newStock = ledger.round2(previousStock - qty);
      product.currentStock = newStock;
      await product.save({ transaction });

      await db.InventoryTransaction.create({
        rawProductId: product.id,
        transactionType: 'Stock Out',
        quantity: qty,
        previousStock,
        newStock,
        referenceType: 'purchase-order',
        referenceId: order.id,
        reason: purchaseReturn.reason,
        remarks: `Returned to ${order.vendor.name} against ${order.poNumber} (${returnNumber})`,
        userId: req.user.id
      }, { transaction });
    }

    await ledger.postLedgerEntry({
      vendorId: order.vendorId,
      entryDate: date,
      voucherNumber: returnNumber,
      entryType: 'Purchase Return',
      direction: 'Debit',
      amount: debitedAmount,
      referenceType: 'purchase-return',
      referenceId: purchaseReturn.id,
      purchaseOrderId: order.id,
      narration: `Goods returned against ${order.poNumber} - ${purchaseReturn.reason}`,
      createdBy: req.user.id
    }, transaction);

    await transaction.commit();

    const updated = await db.PurchaseOrder.findByPk(order.id, {
      include: [
        { model: db.Vendor, as: 'vendor', attributes: ['id', 'name', 'code'] },
        {
          model: db.PurchaseOrderItem,
          as: 'items',
          include: [{ model: db.RawProduct, as: 'rawProduct', attributes: ['id', 'name', 'unitType'] }]
        },
        { model: db.PurchaseReturn, as: 'returns' }
      ]
    });
    const [decorated] = await decorate([updated]);
    res.status(201).json({
      ...decorated,
      message: `${returnNumber} recorded. Stock reduced and Rs. ${debitedAmount.toLocaleString('en-PK')} debited to ${order.vendor.name}.`
    });
  } catch (error) {
    await transaction.rollback();
    console.error('Purchase return error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
