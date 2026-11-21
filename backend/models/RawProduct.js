const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const RawProduct = sequelize.define('RawProduct', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  category: {
    type: DataTypes.STRING,
    allowNull: true
  },
  unitType: {
    type: DataTypes.ENUM('Piece', 'Packet', 'Box', 'Other'),
    allowNull: false,
    defaultValue: 'Piece'
  },
  openingStock: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    defaultValue: 0.00
  },
  currentStock: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    defaultValue: 0.00
  },
  minimumStockLevel: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    defaultValue: 0.00
  },
  createdBy: {
    type: DataTypes.INTEGER,
    allowNull: true
  }
}, {
  tableName: 'raw_products',
  timestamps: true
});

module.exports = RawProduct;
