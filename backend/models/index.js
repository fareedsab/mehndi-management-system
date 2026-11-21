const sequelize = require('../config/database');
const User = require('./User');
const RawProduct = require('./RawProduct');
const FinishedProduct = require('./FinishedProduct');
const Batch = require('./Batch');
const BatchRawProduct = require('./BatchRawProduct');
const InventoryTransaction = require('./InventoryTransaction');
const Vendor = require('./Vendor');
const PurchaseOrder = require('./PurchaseOrder');
const PurchaseOrderItem = require('./PurchaseOrderItem');
const GoodsReceipt = require('./GoodsReceipt');
const GoodsReceiptItem = require('./GoodsReceiptItem');
const PurchaseReturn = require('./PurchaseReturn');
const PurchaseReturnItem = require('./PurchaseReturnItem');
const VendorLedgerEntry = require('./VendorLedgerEntry');
const VendorPayment = require('./VendorPayment');
const UserModuleAccess = require('./UserModuleAccess');
const AccessAuditLog = require('./AccessAuditLog');

// Define Relationships

// User & RawProduct
User.hasMany(RawProduct, { foreignKey: 'createdBy', as: 'createdRawProducts' });
RawProduct.belongsTo(User, { foreignKey: 'createdBy', as: 'creator' });

// User & Batch
User.hasMany(Batch, { foreignKey: 'createdBy', as: 'createdBatches' });
Batch.belongsTo(User, { foreignKey: 'createdBy', as: 'creator' });
User.hasMany(Batch, { foreignKey: 'deletedBy', as: 'deletedBatches' });
Batch.belongsTo(User, { foreignKey: 'deletedBy', as: 'deleter' });

// User & InventoryTransaction
User.hasMany(InventoryTransaction, { foreignKey: 'userId', as: 'transactions' });
InventoryTransaction.belongsTo(User, { foreignKey: 'userId', as: 'user' });

// RawProduct & InventoryTransaction
RawProduct.hasMany(InventoryTransaction, { foreignKey: 'rawProductId', as: 'transactions' });
InventoryTransaction.belongsTo(RawProduct, { foreignKey: 'rawProductId', as: 'rawProduct' });

// FinishedProduct & Batch
FinishedProduct.hasMany(Batch, { foreignKey: 'finishedProductId', as: 'batches' });
Batch.belongsTo(FinishedProduct, { foreignKey: 'finishedProductId', as: 'finishedProduct' });

// Batch & BatchRawProduct (Many-to-Many Bridge)
Batch.hasMany(BatchRawProduct, { foreignKey: 'batchId', as: 'rawProductsConsumed', onDelete: 'CASCADE' });
BatchRawProduct.belongsTo(Batch, { foreignKey: 'batchId', as: 'batch' });

RawProduct.hasMany(BatchRawProduct, { foreignKey: 'rawProductId', as: 'batchUsages' });
BatchRawProduct.belongsTo(RawProduct, { foreignKey: 'rawProductId', as: 'rawProduct' });

// ---- Purchase / Vendor module ----

// Vendor & PurchaseOrder
User.hasMany(Vendor, { foreignKey: 'createdBy', as: 'createdVendors' });
Vendor.belongsTo(User, { foreignKey: 'createdBy', as: 'creator' });
Vendor.hasMany(PurchaseOrder, { foreignKey: 'vendorId', as: 'purchaseOrders' });
PurchaseOrder.belongsTo(Vendor, { foreignKey: 'vendorId', as: 'vendor' });

// PurchaseOrder & its line items
User.hasMany(PurchaseOrder, { foreignKey: 'createdBy', as: 'createdPurchaseOrders' });
PurchaseOrder.belongsTo(User, { foreignKey: 'createdBy', as: 'creator' });
PurchaseOrder.belongsTo(User, { foreignKey: 'confirmedBy', as: 'confirmer' });
PurchaseOrder.belongsTo(User, { foreignKey: 'cancelledBy', as: 'canceller' });
PurchaseOrder.hasMany(PurchaseOrderItem, { foreignKey: 'purchaseOrderId', as: 'items', onDelete: 'CASCADE' });
PurchaseOrderItem.belongsTo(PurchaseOrder, { foreignKey: 'purchaseOrderId', as: 'purchaseOrder' });
RawProduct.hasMany(PurchaseOrderItem, { foreignKey: 'rawProductId', as: 'purchaseOrderItems' });
PurchaseOrderItem.belongsTo(RawProduct, { foreignKey: 'rawProductId', as: 'rawProduct' });

// Goods receipts against a purchase order
PurchaseOrder.hasMany(GoodsReceipt, { foreignKey: 'purchaseOrderId', as: 'receipts', onDelete: 'CASCADE' });
GoodsReceipt.belongsTo(PurchaseOrder, { foreignKey: 'purchaseOrderId', as: 'purchaseOrder' });
Vendor.hasMany(GoodsReceipt, { foreignKey: 'vendorId', as: 'receipts' });
GoodsReceipt.belongsTo(Vendor, { foreignKey: 'vendorId', as: 'vendor' });
User.hasMany(GoodsReceipt, { foreignKey: 'createdBy', as: 'createdReceipts' });
GoodsReceipt.belongsTo(User, { foreignKey: 'createdBy', as: 'creator' });
GoodsReceipt.hasMany(GoodsReceiptItem, { foreignKey: 'goodsReceiptId', as: 'items', onDelete: 'CASCADE' });
GoodsReceiptItem.belongsTo(GoodsReceipt, { foreignKey: 'goodsReceiptId', as: 'goodsReceipt' });
PurchaseOrderItem.hasMany(GoodsReceiptItem, { foreignKey: 'purchaseOrderItemId', as: 'receiptLines' });
GoodsReceiptItem.belongsTo(PurchaseOrderItem, { foreignKey: 'purchaseOrderItemId', as: 'purchaseOrderItem' });
RawProduct.hasMany(GoodsReceiptItem, { foreignKey: 'rawProductId', as: 'receiptLines' });
GoodsReceiptItem.belongsTo(RawProduct, { foreignKey: 'rawProductId', as: 'rawProduct' });

// Purchase returns against a purchase order
PurchaseOrder.hasMany(PurchaseReturn, { foreignKey: 'purchaseOrderId', as: 'returns', onDelete: 'CASCADE' });
PurchaseReturn.belongsTo(PurchaseOrder, { foreignKey: 'purchaseOrderId', as: 'purchaseOrder' });
Vendor.hasMany(PurchaseReturn, { foreignKey: 'vendorId', as: 'returns' });
PurchaseReturn.belongsTo(Vendor, { foreignKey: 'vendorId', as: 'vendor' });
User.hasMany(PurchaseReturn, { foreignKey: 'createdBy', as: 'createdReturns' });
PurchaseReturn.belongsTo(User, { foreignKey: 'createdBy', as: 'creator' });
PurchaseReturn.hasMany(PurchaseReturnItem, { foreignKey: 'purchaseReturnId', as: 'items', onDelete: 'CASCADE' });
PurchaseReturnItem.belongsTo(PurchaseReturn, { foreignKey: 'purchaseReturnId', as: 'purchaseReturn' });
PurchaseOrderItem.hasMany(PurchaseReturnItem, { foreignKey: 'purchaseOrderItemId', as: 'returnLines' });
PurchaseReturnItem.belongsTo(PurchaseOrderItem, { foreignKey: 'purchaseOrderItemId', as: 'purchaseOrderItem' });
RawProduct.hasMany(PurchaseReturnItem, { foreignKey: 'rawProductId', as: 'returnLines' });
PurchaseReturnItem.belongsTo(RawProduct, { foreignKey: 'rawProductId', as: 'rawProduct' });

// Vendor ledger (credit / debit)
Vendor.hasMany(VendorLedgerEntry, { foreignKey: 'vendorId', as: 'ledgerEntries' });
VendorLedgerEntry.belongsTo(Vendor, { foreignKey: 'vendorId', as: 'vendor' });
PurchaseOrder.hasMany(VendorLedgerEntry, { foreignKey: 'purchaseOrderId', as: 'ledgerEntries' });
VendorLedgerEntry.belongsTo(PurchaseOrder, { foreignKey: 'purchaseOrderId', as: 'purchaseOrder' });
User.hasMany(VendorLedgerEntry, { foreignKey: 'createdBy', as: 'ledgerEntries' });
VendorLedgerEntry.belongsTo(User, { foreignKey: 'createdBy', as: 'creator' });

// Vendor payments
Vendor.hasMany(VendorPayment, { foreignKey: 'vendorId', as: 'payments' });
VendorPayment.belongsTo(Vendor, { foreignKey: 'vendorId', as: 'vendor' });
PurchaseOrder.hasMany(VendorPayment, { foreignKey: 'purchaseOrderId', as: 'payments' });
VendorPayment.belongsTo(PurchaseOrder, { foreignKey: 'purchaseOrderId', as: 'purchaseOrder' });
User.hasMany(VendorPayment, { foreignKey: 'createdBy', as: 'createdPayments' });
VendorPayment.belongsTo(User, { foreignKey: 'createdBy', as: 'creator' });

// ---- User access control ----
User.hasMany(UserModuleAccess, { foreignKey: 'userId', as: 'moduleAccess', onDelete: 'CASCADE' });
UserModuleAccess.belongsTo(User, { foreignKey: 'userId', as: 'user' });
User.hasMany(AccessAuditLog, { foreignKey: 'actorUserId', as: 'auditEntries' });
AccessAuditLog.belongsTo(User, { foreignKey: 'actorUserId', as: 'actor' });
AccessAuditLog.belongsTo(User, { foreignKey: 'targetUserId', as: 'target' });

// Export everything
module.exports = {
  sequelize,
  User,
  RawProduct,
  FinishedProduct,
  Batch,
  BatchRawProduct,
  InventoryTransaction,
  Vendor,
  PurchaseOrder,
  PurchaseOrderItem,
  GoodsReceipt,
  GoodsReceiptItem,
  PurchaseReturn,
  PurchaseReturnItem,
  VendorLedgerEntry,
  VendorPayment,
  UserModuleAccess,
  AccessAuditLog
};
