const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// One row per (user, module). `users` cannot be altered (SQLite sync only creates
// new tables), so every permission lives here instead of on the user row.
const UserModuleAccess = sequelize.define('UserModuleAccess', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  userId: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  module: {
    type: DataTypes.STRING,
    allowNull: false
  },
  canView: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  },
  canCreate: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  },
  canUpdate: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  },
  canDelete: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  },
  // Module specific switches, e.g. { approve: true, receive: false }
  rights: {
    type: DataTypes.JSON,
    allowNull: false,
    defaultValue: {}
  }
}, {
  tableName: 'user_module_access',
  timestamps: true,
  indexes: [{ unique: true, fields: ['userId', 'module'] }]
});

module.exports = UserModuleAccess;
