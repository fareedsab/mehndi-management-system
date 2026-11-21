// Preload script to safely expose select APIs to the renderer process
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // We can add secure IPC handlers here in the future if needed
});
