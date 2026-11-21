const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const PurchaseReturnItem = sequelize.define('PurchaseReturnItem', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  purchaseReturnId: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  purchaseOrderItemId: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  rawProductId: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  quantityReturned: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    defaultValue: 0.00
  },
  unitRate: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false,
    defaultValue: 0.00
  },
  lineAmount: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false,
    defaultValue: 0.00
  }
}, {
  tableName: 'purchase_return_items',
  timestamps: true
});

module.exports = PurchaseReturnItem;
