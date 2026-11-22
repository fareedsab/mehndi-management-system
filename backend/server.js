const app = require('./app');
const initializeDatabase = require('./config/initDb');

const PORT = process.env.PORT || 3001;

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
