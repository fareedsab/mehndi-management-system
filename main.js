const { app, BrowserWindow } = require('electron');
const path = require('path');

let mainWindow;

// Start the Express backend server
try {
  require('./backend/server.js');
  console.log('Backend server initialized successfully in Electron main process.');
} catch (error) {
  console.error('Error starting Express backend server:', error);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    title: "Mehndi Business Management System",
    autoHideMenuBar: true
  });

  // Check if we are running in dev mode
  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

  if (isDev) {
    mainWindow.loadURL('http://localhost:4200');
    // Open the DevTools.
    mainWindow.webContents.openDevTools();
  } else {
    // In production, load the built Angular index.html
    mainWindow.loadFile(path.join(__dirname, 'frontend/dist/frontend/browser/index.html'));
  }

  mainWindow.on('closed', function () {
    mainWindow = null;
  });
}

app.on('ready', createWindow);

app.on('window-all-closed', function () {
  // On OS X it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', function () {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (mainWindow === null) {
    createWindow();
  }
});
