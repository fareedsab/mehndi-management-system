const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// Written whenever access or a sensitive, otherwise-unattributed field changes.
const AccessAuditLog = sequelize.define('AccessAuditLog', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  actorUserId: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  targetUserId: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  module: {
    type: DataTypes.STRING,
    allowNull: false
  },
  action: {
    type: DataTypes.STRING,
    allowNull: false
  },
  changes: {
    type: DataTypes.JSON,
    allowNull: true
  }
}, {
  tableName: 'access_audit_logs',
  timestamps: true,
  updatedAt: false
});

module.exports = AccessAuditLog;
