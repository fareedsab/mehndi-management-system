const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const fs = require('fs');
const path = require('path');
const db = require('./models');
const initializeDatabase = require('./config/initDb');

// Import routes
const authRoutes = require('./routes/auth');
const rawProductRoutes = require('./routes/rawProducts');
const finishedProductRoutes = require('./routes/finishedProducts');
const batchRoutes = require('./routes/batches');
const vendorRoutes = require('./routes/vendors');
const purchaseOrderRoutes = require('./routes/purchaseOrders');
const reportRoutes = require('./routes/reports');
const userRoutes = require('./routes/users');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

// Serve frontend build files in production
const frontendBuildPath = path.join(__dirname, '../frontend/dist/frontend/browser');
const frontendIndexPath = path.join(frontendBuildPath, 'index.html');
// An API-only host (Render) deploys backend/ without the Angular build beside it,
// so the static middleware and SPA fallback may not assume index.html exists.
const servesFrontend = fs.existsSync(frontendIndexPath);
if (servesFrontend) {
  app.use(express.static(frontendBuildPath));
}

// Wire API routes
app.use('/api/auth', authRoutes);
app.use('/api/raw-products', rawProductRoutes);
app.use('/api/finished-products', finishedProductRoutes);
app.use('/api/batches', batchRoutes);
app.use('/api/vendors', vendorRoutes);
app.use('/api/purchase-orders', purchaseOrderRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/users', userRoutes);

// Fallback to Angular index.html for spa routing in production
app.get('*', (req, res, next) => {
  if (req.url.startsWith('/api/')) {
    return next();
  }
  if (!servesFrontend) {
    return res.json({ status: 'ok', api: '/api', note: 'This origin serves the API only; the Angular app is hosted separately.' });
  }
  res.sendFile(frontendIndexPath);
});

// Sync database and start server
async function startServer() {
  try {
    // Run DB initialization and seeders
    await initializeDatabase();
    
    app.listen(PORT, () => {
      console.log(`Express JS backend server running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('Failed to initialize database or start Express server:', error);
  }
}

// Start the server
startServer();

module.exports = app; // Expose for testing/importing
