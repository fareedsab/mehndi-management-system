const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const PurchaseReturn = sequelize.define('PurchaseReturn', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  returnNumber: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  purchaseOrderId: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  vendorId: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  returnDate: {
    type: DataTypes.DATEONLY,
    allowNull: false,
    defaultValue: DataTypes.NOW
  },
  reason: {
    type: DataTypes.ENUM('Damaged', 'Wrong Item', 'Excess Quantity', 'Quality Issue', 'Expired', 'Other'),
    allowNull: false,
    defaultValue: 'Damaged'
  },
  goodsValue: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false,
    defaultValue: 0.00
  },
  debitedAmount: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false,
    defaultValue: 0.00
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
  tableName: 'purchase_returns',
  timestamps: true
});

module.exports = PurchaseReturn;
