const jwt = require('jsonwebtoken');
const path = require('path');
const { loadAccess } = require('../services/access');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 16) {
  throw new Error('JWT_SECRET is missing or too short. Set a long random JWT_SECRET in the project .env before starting the server.');
}

module.exports = async (req, res, next) => {
  const authHeader = req.headers['authorization'];

  if (!authHeader) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }

  const token = authHeader.split(' ')[1]; // "Bearer <token>"

  if (!token) {
    return res.status(401).json({ error: 'Access denied. Invalid token format.' });
  }

  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return res.status(401).json({ error: 'Session expired. Please log in again.' });
  }

  try {
    // Grants come from the database, not the token, so removing a right takes
    // effect without waiting for the 24h token to expire.
    const access = await loadAccess(decoded.id);
    if (!access) {
      return res.status(401).json({ error: 'This account no longer exists. Please log in again.' });
    }
    req.user = decoded;
    req.access = access;
    return next();
  } catch (error) {
    return res.status(500).json({ error: 'Could not load user permissions.' });
  }
};
