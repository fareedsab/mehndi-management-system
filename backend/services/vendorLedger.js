const { Op } = require('sequelize');
const db = require('../models');

const round2 = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

const todayDateOnly = () => new Date().toISOString().slice(0, 10);

/**
 * Builds the next sequence number for a document, e.g. PO-20260623-0001.
 * Mirrors the batch numbering rule already used in the project.
 */
async function nextDocumentNumber(model, column, prefix, dateOnly, transaction) {
  const compactDate = String(dateOnly).replace(/-/g, '');
  const countToday = await model.count({
    where: { [Op.and]: [{ [column]: { [Op.like]: `${prefix}-${compactDate}-%` } }] },
    transaction
  });
  return `${prefix}-${compactDate}-${String(countToday + 1).padStart(4, '0')}`;
}

/**
 * Balance the business owes a vendor.
 * Credit entries raise the payable, Debit entries lower it.
 */
async function getVendorBalance(vendor, transaction) {
  const totals = await db.VendorLedgerEntry.findAll({
    where: { vendorId: vendor.id, entryType: { [Op.ne]: 'Opening Balance' } },
    attributes: ['direction', 'amount'],
    raw: true,
    transaction
  });

  let totalCredit = 0;
  let totalDebit = 0;
  totals.forEach((row) => {
    const amount = Number(row.amount);
    if (row.direction === 'Credit') totalCredit += amount;
    else totalDebit += amount;
  });

  const opening = Number(vendor.openingBalance) || 0;
  return {
    opening,
    totalCredit: round2(totalCredit),
    totalDebit: round2(totalDebit),
    balance: round2(opening + totalCredit - totalDebit)
  };
}

async function postLedgerEntry(payload, transaction) {
  const vendor = await db.Vendor.findByPk(payload.vendorId, { transaction });
  if (!vendor) {
    throw new Error(`Vendor with ID ${payload.vendorId} not found.`);
  }

  const amount = round2(payload.amount);
  if (!(amount > 0)) {
    throw new Error('Ledger amount must be greater than zero.');
  }
  if (payload.direction === 'Credit' && payload.entryType === 'Payment') {
    throw new Error('Payments must be posted as Debit entries.');
  }

  const current = await getVendorBalance(vendor, transaction);
  const balanceAfter = payload.direction === 'Credit'
    ? round2(current.balance + amount)
    : round2(current.balance - amount);

  return db.VendorLedgerEntry.create({
    vendorId: vendor.id,
    entryDate: payload.entryDate || todayDateOnly(),
    voucherNumber: payload.voucherNumber || null,
    entryType: payload.entryType,
    direction: payload.direction,
    amount,
    balanceAfter,
    referenceType: payload.referenceType || 'manual',
    referenceId: payload.referenceId ?? null,
    purchaseOrderId: payload.purchaseOrderId ?? null,
    narration: payload.narration || null,
    createdBy: payload.createdBy ?? null
  }, { transaction });
}

/**
 * Credit limit guard. A limit of 0 means "no limit".
 * Returns null when allowed, otherwise a ready-to-send error message.
 */
function checkCreditLimit(vendor, projectedBalance) {
  const limit = Number(vendor.creditLimit) || 0;
  if (limit <= 0) return null;
  if (round2(projectedBalance) > limit) {
    return `Credit limit exceeded for vendor "${vendor.name}". `
      + `Limit: Rs. ${limit.toLocaleString('en-PK')}, `
      + `projected payable: Rs. ${round2(projectedBalance).toLocaleString('en-PK')}. `
      + `Increase the vendor credit limit or reduce the amount.`;
  }
  return null;
}

/**
 * Outstanding amount for every purchase order in one grouped query, so list
 * screens do not need one query per order.
 */
async function getOrderPayables(transaction) {
  const rows = await db.VendorLedgerEntry.findAll({
    attributes: [
      'vendorId',
      'purchaseOrderId',
      [db.sequelize.literal("SUM(CASE WHEN direction = 'Credit' THEN amount ELSE 0 END)"), 'billed'],
      [db.sequelize.literal("SUM(CASE WHEN direction = 'Debit' THEN amount ELSE 0 END)"), 'settled']
    ],
    where: { purchaseOrderId: { [Op.ne]: null } },
    group: ['vendorId', 'purchaseOrderId'],
    raw: true,
    transaction
  });

  const byOrder = {};
  const billedByOrder = {};
  const settledByOrder = {};
  const openByVendor = {};
  rows.forEach((row) => {
    const billed = round2(row.billed);
    const settled = round2(row.settled);
    const outstanding = round2(billed - settled);
    billedByOrder[row.purchaseOrderId] = billed;
    settledByOrder[row.purchaseOrderId] = settled;
    byOrder[row.purchaseOrderId] = outstanding;
    if (outstanding > 0.004) {
      openByVendor[row.vendorId] = (openByVendor[row.vendorId] || 0) + 1;
    }
  });

  return { byOrder, billedByOrder, settledByOrder, openByVendor };
}

/**
 * What is still outstanding on one purchase order, read straight from the ledger
 * so the vendor account and the order view can never disagree.
 */
async function getOrderPayable(purchaseOrderId, transaction) {
  const entries = await db.VendorLedgerEntry.findAll({
    where: { purchaseOrderId },
    attributes: ['direction', 'amount', 'entryType'],
    raw: true,
    transaction
  });

  let billed = 0;
  let settled = 0;
  entries.forEach((row) => {
    const amount = Number(row.amount);
    if (row.direction === 'Credit') billed += amount;
    else settled += amount;
  });

  return {
    billedAmount: round2(billed),
    settledAmount: round2(settled),
    outstanding: round2(billed - settled)
  };
}

/**
 * Purchase orders carry a header-level discount and tax rate. Every goods receipt
 * and return is valued with the same factor so that stock, ledger and PO totals
 * can never drift apart.
 */
function buildPricingFactors(purchaseOrder) {
  const subtotal = Number(purchaseOrder.subtotal) || 0;
  const discount = Number(purchaseOrder.discountAmount) || 0;
  const taxPercent = Number(purchaseOrder.taxPercent) || 0;
  const netRatio = subtotal > 0 ? Math.max((subtotal - discount) / subtotal, 0) : 1;
  const taxMultiplier = 1 + taxPercent / 100;
  return {
    netRatio,
    taxMultiplier,
    price: (grossLineAmount) => round2(grossLineAmount * netRatio * taxMultiplier)
  };
}

module.exports = {
  round2,
  todayDateOnly,
  nextDocumentNumber,
  getVendorBalance,
  getOrderPayable,
  getOrderPayables,
  postLedgerEntry,
  checkCreditLimit,
  buildPricingFactors
};
