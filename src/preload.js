'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Electron 32+ 通过 webUtils 获取拖入文件的真实路径；更早的版本由渲染层用 file.path 兜底。
let webUtils = null;
try { ({ webUtils } = require('electron')); } catch (_) { webUtils = null; }

contextBridge.exposeInMainWorld('todoAPI', {
  isElectron: true,
  load: () => ipcRenderer.invoke('data:load'),
  save: (data) => ipcRenderer.invoke('data:save', data),
  saveSync: (data) => ipcRenderer.sendSync('data:save-sync', data),
  exportData: (json) => ipcRenderer.invoke('data:export', json),
  importData: () => ipcRenderer.invoke('data:import'),
  exportExcel: (payload) => ipcRenderer.invoke('data:export-excel', payload),
  notify: (title, body) => ipcRenderer.invoke('notify', title, body),
  info: () => ipcRenderer.invoke('app:info'),
  win: (action) => ipcRenderer.send('win:action', action),
  winMode: (mode) => ipcRenderer.send('win:mode', mode),
  isMaximized: () => ipcRenderer.invoke('win:isMaximized'),
  setPin: (flag) => ipcRenderer.invoke('win:set-pin', flag),
  log: (message) => ipcRenderer.send('app:log', String(message || '')),
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
  onMaximizedChange: (callback) => {
    ipcRenderer.on('win:maximized-changed', (_event, value) => callback(value));
  },
  onFlush: (callback) => ipcRenderer.on('app:flush', () => callback()),
  onTrayAction: (callback) => ipcRenderer.on('tray:toggle-mini', () => callback('toggle-mini')),
  getAutoStart: () => ipcRenderer.invoke('settings:get-autostart'),
  setAutoStart: (enable) => ipcRenderer.invoke('settings:set-autostart', enable),
  pickFolder: () => ipcRenderer.invoke('dialog:pick-folder'),
  pickWorkspace: (mode) => ipcRenderer.invoke('dialog:pick-workspace', mode),
  statPaths: (targets) => ipcRenderer.invoke('fs:stat-paths', targets),
  openFolder: (target) => ipcRenderer.invoke('shell:open-path', target),
  openPath: (target) => ipcRenderer.invoke('shell:open-path', target),
  pathForFile: (file) => {
    try {
      if (webUtils && typeof webUtils.getPathForFile === 'function') {
        const p = webUtils.getPathForFile(file);
        if (p) return p;
      }
    } catch (_) { /* 回退到 file.path */ }
    try { return (file && file.path) || ''; } catch (_) { return ''; }
  },
});
