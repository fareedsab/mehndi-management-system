const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const InventoryTransaction = sequelize.define('InventoryTransaction', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  rawProductId: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  transactionType: {
    type: DataTypes.ENUM('Stock In', 'Stock Out', 'Batch Creation', 'Batch Update', 'Batch Reversal'),
    allowNull: false
  },
  quantity: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    defaultValue: 0.00
  },
  previousStock: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    defaultValue: 0.00
  },
  newStock: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    defaultValue: 0.00
  },
  referenceType: {
    type: DataTypes.STRING, // 'batch', 'manual'
    allowNull: false,
    defaultValue: 'manual'
  },
  referenceId: {
    type: DataTypes.INTEGER, // e.g. batchId, or null
    allowNull: true
  },
  purchaseReference: {
    type: DataTypes.STRING, // For Stock In
    allowNull: true
  },
  reason: {
    type: DataTypes.STRING, // For Stock Out
    allowNull: true
  },
  remarks: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  userId: {
    type: DataTypes.INTEGER,
    allowNull: true
  }
}, {
  tableName: 'inventory_transactions',
  timestamps: true
});

module.exports = InventoryTransaction;
