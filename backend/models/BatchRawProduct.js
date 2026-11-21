const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const BatchRawProduct = sequelize.define('BatchRawProduct', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  batchId: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  rawProductId: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  quantityUsed: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    defaultValue: 0.00
  }
}, {
  tableName: 'batch_raw_products',
  timestamps: true
});

module.exports = BatchRawProduct;
