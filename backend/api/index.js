const app = require('../app');
const initializeDatabase = require('../config/initDb');

// Every cold serverless instance is a fresh process, so sync + seeding must run
// once per instance and finish before the first request reaches the router.
let initialization = null;

module.exports = async (req, res) => {
  if (!initialization) initialization = initializeDatabase();
  await initialization;
  return app(req, res);
};
