const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const FinishedProduct = sequelize.define('FinishedProduct', {
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
  description: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  status: {
    type: DataTypes.ENUM('Active', 'Inactive'),
    allowNull: false,
    defaultValue: 'Active'
  }
}, {
  tableName: 'finished_products',
  timestamps: true
});

module.exports = FinishedProduct;
