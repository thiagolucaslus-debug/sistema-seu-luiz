'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('AdminFinanceiraDesktop', {
  isDesktopApp: true,
  version: '2.0.0',
  restartBackend: () => ipcRenderer.invoke('desktop:restart-backend'),
  openDataFolder: () => ipcRenderer.invoke('desktop:open-data-folder'),
  getDesktopInfo: () => ipcRenderer.invoke('desktop:get-info'),
});
