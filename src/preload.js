'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('todoAPI', {
  isElectron: true,
  load: () => ipcRenderer.invoke('data:load'),
  save: (data) => ipcRenderer.invoke('data:save', data),
  saveSync: (data) => ipcRenderer.sendSync('data:save-sync', data),
  exportData: (json) => ipcRenderer.invoke('data:export', json),
  importData: () => ipcRenderer.invoke('data:import'),
  notify: (title, body) => ipcRenderer.invoke('notify', title, body),
  info: () => ipcRenderer.invoke('app:info'),
  win: (action) => ipcRenderer.send('win:action', action),
  winMode: (mode) => ipcRenderer.send('win:mode', mode),
  isMaximized: () => ipcRenderer.invoke('win:isMaximized'),
  onMaximizedChange: (callback) => {
    ipcRenderer.on('win:maximized-changed', (_event, value) => callback(value));
  },
  onFlush: (callback) => ipcRenderer.on('app:flush', () => callback()),
  onTrayAction: (callback) => ipcRenderer.on('tray:toggle-mini', () => callback('toggle-mini')),
  getAutoStart: () => ipcRenderer.invoke('settings:get-autostart'),
  setAutoStart: (enable) => ipcRenderer.invoke('settings:set-autostart', enable),
  pickFolder: () => ipcRenderer.invoke('dialog:pick-folder'),
  openFolder: (target) => ipcRenderer.invoke('shell:open-path', target),
});
