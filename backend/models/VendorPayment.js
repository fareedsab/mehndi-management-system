const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const VendorPayment = sequelize.define('VendorPayment', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  voucherNumber: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  vendorId: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  purchaseOrderId: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  paymentDate: {
    type: DataTypes.DATEONLY,
    allowNull: false,
    defaultValue: DataTypes.NOW
  },
  amount: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false,
    defaultValue: 0.00
  },
  paymentType: {
    type: DataTypes.ENUM('Payment', 'Advance', 'Refund Received'),
    allowNull: false,
    defaultValue: 'Payment'
  },
  method: {
    type: DataTypes.ENUM('Cash', 'Bank Transfer', 'Cheque', 'Journal', 'EasyPaisa', 'JazzCash', 'Other'),
    allowNull: false,
    defaultValue: 'Cash'
  },
  referenceNumber: {
    type: DataTypes.STRING,
    allowNull: true
  },
  remarks: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  createdBy: {
    type: DataTypes.INTEGER,
    allowNull: true
  }
}, {
  tableName: 'vendor_payments',
  timestamps: true
});

module.exports = VendorPayment;
