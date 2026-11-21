const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const GoodsReceiptItem = sequelize.define('GoodsReceiptItem', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  goodsReceiptId: {
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
  quantityReceived: {
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
  tableName: 'goods_receipt_items',
  timestamps: true
});

module.exports = GoodsReceiptItem;
