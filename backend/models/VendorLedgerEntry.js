const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// Payable-side ledger. 'Credit' raises what we owe the vendor, 'Debit' lowers it.
const VendorLedgerEntry = sequelize.define('VendorLedgerEntry', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  vendorId: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  entryDate: {
    type: DataTypes.DATEONLY,
    allowNull: false,
    defaultValue: DataTypes.NOW
  },
  voucherNumber: {
    type: DataTypes.STRING,
    allowNull: true
  },
  entryType: {
    type: DataTypes.ENUM(
      'Opening Balance',
      'Purchase Invoice',
      'Purchase Return',
      'Payment',
      'Credit Note',
      'Debit Note',
      'Manual Adjustment'
    ),
    allowNull: false
  },
  direction: {
    type: DataTypes.ENUM('Credit', 'Debit'),
    allowNull: false
  },
  amount: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false,
    defaultValue: 0.00
  },
  balanceAfter: {
    type: DataTypes.DECIMAL(14, 2),
    allowNull: false,
    defaultValue: 0.00
  },
  referenceType: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'manual'
  },
  referenceId: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  purchaseOrderId: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  narration: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  createdBy: {
    type: DataTypes.INTEGER,
    allowNull: true
  }
}, {
  tableName: 'vendor_ledger_entries',
  timestamps: true
});

module.exports = VendorLedgerEntry;
