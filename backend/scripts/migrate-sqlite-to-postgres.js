/**
 * Copies backend/mehndi_inventory.sqlite into the Postgres database given by
 * DATABASE_URL. Run it once, before pointing the app at the hosted database.
 *
 *   DATABASE_URL=postgres://... node scripts/migrate-sqlite-to-postgres.js [path/to/source.sqlite]
 *
 * The SQLite file is authoritative: rows already in Postgres with the same id are
 * overwritten, so re-running after new local entries is safe.
 */
const path = require('path');
const sqlite3 = require('sqlite3');
const db = require('../models');

const SOURCE = process.argv[2] || path.join(__dirname, '../mehndi_inventory.sqlite');

// Parents before children so foreign keys are never pointing at a missing row.
const TABLES_IN_ORDER = [
  'users',
  'raw_products',
  'finished_products',
  'batches',
  'batch_raw_products',
  'inventory_transactions',
  'vendors',
  'purchase_orders',
  'purchase_order_items',
  'goods_receipts',
  'goods_receipt_items',
  'purchase_returns',
  'purchase_return_items',
  'vendor_ledger_entries',
  'vendor_payments',
  'user_module_access',
  'access_audit_logs'
];

function openSource() {
  return new Promise((resolve, reject) => {
    const handle = new sqlite3.Database(SOURCE, sqlite3.OPEN_READONLY, (error) => {
      if (error) return reject(error);
      resolve(handle);
    });
  });
}

function selectAll(handle, table) {
  return new Promise((resolve, reject) => {
    handle.all(`SELECT * FROM "${table}"`, (error, rows) => (error ? reject(error) : resolve(rows)));
  });
}

/** SQLite hands back 0/1 for booleans and text for JSON; Postgres needs real types. */
function toTargetValue(attribute, value) {
  if (value === null || value === undefined) return null;
  switch (attribute.type.key) {
    case 'BOOLEAN':
      return Boolean(value);
    case 'JSON':
    case 'JSONB':
      return typeof value === 'string' ? value : JSON.stringify(value);
    default:
      return value;
  }
}

function modelForTable(tableName) {
  return Object.values(db).find((model) => typeof model === 'function' && model.getTableName && model.getTableName() === tableName);
}

async function copyTable(handle, tableName) {
  const model = modelForTable(tableName);
  if (!model) throw new Error(`No Sequelize model maps to table "${tableName}".`);

  const rows = await selectAll(handle, tableName);
  if (rows.length === 0) {
    console.log(`  ${tableName}: 0 rows`);
    return;
  }

  const columns = Object.keys(rows[0]).filter((column) => model.rawAttributes[column]);
  const quoted = columns.map((column) => `"${column}"`).join(', ');
  const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');
  const updates = columns.map((column) => `"${column}" = EXCLUDED."${column}"`).join(', ');
  const sql = `INSERT INTO "${tableName}" (${quoted}) VALUES (${placeholders}) ON CONFLICT (id) DO UPDATE SET ${updates}`;

  for (const row of rows) {
    const bind = columns.map((column) => toTargetValue(model.rawAttributes[column], row[column]));
    await db.sequelize.query(sql, { bind });
  }

  // Postgres sequences still point at 1 because every id arrived explicitly.
  const primaryKey = model.primaryKeyAttribute || 'id';
  if (model.rawAttributes[primaryKey] && model.rawAttributes[primaryKey].autoIncrement) {
    await db.sequelize.query(
      `SELECT setval(pg_get_serial_sequence('"${tableName}"', '${primaryKey}'), ` +
      `(SELECT COALESCE(MAX("${primaryKey}"), 1) FROM "${tableName}"), true)`
    );
  }

  console.log(`  ${tableName}: ${rows.length} rows`);
}

async function main() {
  const dialect = db.sequelize.getDialect();
  if (dialect !== 'postgres') {
    throw new Error(`Target database is "${dialect}". Set DATABASE_URL to the Neon postgres:// connection string first.`);
  }

  const handle = await openSource();
  console.log(`Source: ${SOURCE}`);

  await db.sequelize.sync();
  console.log('Target schema ready. Copying rows...');

  for (const tableName of TABLES_IN_ORDER) {
    await copyTable(handle, tableName);
  }

  console.log('\nRow counts in Postgres:');
  for (const tableName of TABLES_IN_ORDER) {
    const [result] = await db.sequelize.query(`SELECT COUNT(*)::int AS count FROM "${tableName}"`);
    console.log(`  ${tableName}: ${result[0].count}`);
  }

  handle.close();
  await db.sequelize.close();
  console.log('\nMigration finished.');
}

main().catch(async (error) => {
  console.error('Migration failed:', error.message || error);
  process.exit(1);
});
