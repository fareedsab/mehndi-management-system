const { Sequelize } = require('sequelize');
const path = require('path');

// Load environment variables from backend/.env or root .env
require('dotenv').config({ path: path.join(__dirname, '../.env') });
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const dialect = (process.env.DB_DIALECT || '').toLowerCase();
// Neon, Render and friends hand out one connection URL. Its scheme is
// authoritative: a leftover DB_DIALECT=sqlite in .env must not silently keep a
// deployed app pointed at a local file.
const connectionUrl = process.env.DATABASE_URL || '';
const urlDialect = connectionUrl.startsWith('postgres') ? 'postgres'
  : connectionUrl.startsWith('mysql') ? 'mysql'
  : connectionUrl.startsWith('mariadb') ? 'mariadb' : '';

if (connectionUrl && !urlDialect) {
  throw new Error('DATABASE_URL has an unrecognised scheme. Use a postgres:// or mysql:// connection string.');
}

const resolvedDialect = connectionUrl ? urlDialect : (dialect || 'sqlite');

let sequelize;

if (resolvedDialect === 'sqlite') {
  const dbPath = process.env.DB_STORAGE || path.join(__dirname, '../mehndi_inventory.sqlite');
  console.log(`Database Dialect: SQLite. Database storage path: ${dbPath}`);
  sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: dbPath,
    logging: false
  });
} else if (resolvedDialect === 'mysql' || resolvedDialect === 'postgres' || resolvedDialect === 'mariadb') {
  // Managed hosts usually require TLS; without it the connection is rejected.
  const sslEnabled = String(process.env.DB_SSL).toLowerCase() === 'true';

  if (connectionUrl) {
    console.log(`Database Dialect: ${resolvedDialect.toUpperCase()} via DATABASE_URL${sslEnabled ? ' (SSL)' : ''}`);
    sequelize = new Sequelize(connectionUrl, {
      dialect: resolvedDialect,
      logging: false,
      ssl: sslEnabled,
      dialectOptions: sslEnabled ? { ssl: { require: true, rejectUnauthorized: false } } : {},
      pool: { max: 5, min: 0, acquire: 30000, idle: 10000 }
    });
  } else {
    console.log(`Database Dialect: ${resolvedDialect.toUpperCase()}. Server: ${process.env.DB_HOST}:${process.env.DB_PORT || (resolvedDialect === 'postgres' ? 5432 : 3306)}, DB: ${process.env.DB_NAME}`);

    sequelize = new Sequelize(
      process.env.DB_NAME,
      process.env.DB_USER,
      process.env.DB_PASSWORD,
      {
        host: process.env.DB_HOST || 'localhost',
        port: process.env.DB_PORT || (resolvedDialect === 'postgres' ? 5432 : 3306),
        dialect: resolvedDialect,
        logging: false,
        pool: {
          max: 5,
          min: 0,
          acquire: 30000,
          idle: 10000
        }
      }
    );
  }
} else {
  throw new Error(`Unsupported DB_DIALECT: ${resolvedDialect}. Use 'sqlite', 'mysql', or 'postgres'.`);
}

module.exports = sequelize;

module.exports = sequelize;
