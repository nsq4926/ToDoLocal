'use strict';

const { app, BrowserWindow, ipcMain, Menu, Notification, dialog, session, shell, Tray, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

// 禁止 Electron 自身的后台联网行为（更新探测、组件更新、DNS 预取等）。
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-component-update');
app.commandLine.appendSwitch('disable-domain-reliability');
app.commandLine.appendSwitch('no-first-run');
app.setAppUserModelId('cn.local.todolist.app');

const LARGE = { width: 1280, height: 820 };
const MINI = { width: 380, height: 620 };

let win = null;
let tray = null;
let DATA_FILE = null;
let isQuitting = false;
let trayHintShown = false;

function iconFile() {
  const packaged = path.join(process.resourcesPath || '', 'icon.ico');
  if (app.isPackaged && fs.existsSync(packaged)) return packaged;
  const local = path.join(__dirname, 'icon.ico');
  if (fs.existsSync(local)) return local;
  return path.join(__dirname, '..', 'build', 'icon.ico');
}

/** 绿色版数据强制固定在软件目录；开发态使用 userData，避免污染依赖目录。 */
function pickDataFile() {
  const exeDir = path.dirname(app.getPath('exe'));
  const hasBundle = fs.existsSync(path.join(exeDir, 'resources', 'app.asar'))
    || fs.existsSync(path.join(exeDir, 'resources', 'app'));
  if (app.isPackaged || hasBundle) {
    const dir = path.join(exeDir, 'ToDoLocal-Data');
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.accessSync(dir, fs.constants.W_OK);
      return path.join(dir, 'data.json');
    } catch (_) { /* 只读安装目录时回退到用户目录 */ }
  }

  const dirs = [];
  if (process.env.PORTABLE_EXECUTABLE_DIR) {
    dirs.push(path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'ToDoLocal-Data'));
  }
  dirs.push(path.join(app.getPath('userData'), 'data'));
  dirs.push(path.join(app.getPath('documents'), 'ToDoLocal'));

  for (const dir of dirs) {
    try { if (fs.existsSync(path.join(dir, 'data.json'))) return path.join(dir, 'data.json'); } catch (_) { /* 忽略 */ }
  }
  for (const dir of dirs) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.accessSync(dir, fs.constants.W_OK);
      return path.join(dir, 'data.json');
    } catch (_) { /* 尝试下一个位置 */ }
  }
  return path.join(app.getPath('temp'), 'ToDoLocal-data.json');
}

function readData() {
  try {
    if (!fs.existsSync(DATA_FILE)) return null;
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    if (!raw.trim()) return null;
    return JSON.parse(raw);
  } catch (err) {
    console.error('[data] 读取失败:', err.message);
    return null;
  }
}

function writeData(data) {
  const dir = path.dirname(DATA_FILE);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, DATA_FILE);
  return true;
}

function setAutoStart(enable) {
  app.setLoginItemSettings({
    openAtLogin: Boolean(enable),
    enabled: Boolean(enable),
    path: app.getPath('exe'),
  });
  return Boolean(app.getLoginItemSettings().openAtLogin);
}

function showWindow() {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function toggleWindow() {
  if (!win || win.isDestroyed()) return;
  if (win.isVisible()) win.hide();
  else showWindow();
}

function createTray() {
  try {
    tray = new Tray(nativeImage.createFromPath(iconFile()));
    tray.setToolTip('To Do · 本地版');
    refreshTrayMenu();
    tray.on('click', toggleWindow);
  } catch (err) {
    console.error('[tray] 创建失败:', err.message);
    tray = null;
  }
}

function refreshTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示 / 隐藏主窗口', click: toggleWindow },
    { label: '切换到小面板', click: () => { if (win && !win.isDestroyed()) win.webContents.send('tray:toggle-mini'); showWindow(); } },
    { type: 'separator' },
    {
      label: '开机自启', type: 'checkbox', checked: Boolean(app.getLoginItemSettings().openAtLogin),
      click: (item) => { setAutoStart(item.checked); refreshTrayMenu(); },
    },
    { type: 'separator' },
    { label: '退出', click: () => { isQuitting = true; app.quit(); } },
  ]));
}

function createWindow() {
  win = new BrowserWindow({
    width: LARGE.width,
    height: LARGE.height,
    minWidth: 940,
    minHeight: 560,
    show: false,
    frame: false,
    icon: iconFile(),
    backgroundColor: '#f4f6fb',
    title: 'To Do · 本地版',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      devTools: false,
    },
  });

  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, 'index.html'));
  win.once('ready-to-show', () => win.show());

  const notifyMax = (value) => {
    if (win && !win.isDestroyed()) win.webContents.send('win:maximized-changed', value);
  };
  win.on('maximize', () => notifyMax(true));
  win.on('unmaximize', () => notifyMax(false));

  // 关闭按钮 = 隐藏到托盘，保持进程常驻；仅托盘“退出”触发真正关闭。
  win.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    if (win && !win.isDestroyed()) win.webContents.send('app:flush');
    win.hide();
    if (!trayHintShown) {
      trayHintShown = true;
      if (Notification.isSupported()) {
        new Notification({ title: 'To Do 已常驻任务栏', body: '点击托盘图标重新打开，右键托盘可退出程序。' }).show();
      }
    }
  });
}

// 单实例：避免多个进程同时写同一份数据文件。
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  app.on('before-quit', () => { isQuitting = true; });

  app.whenReady().then(() => {
    DATA_FILE = pickDataFile();

    // 严格离线：仅允许本地资源，任何外部网络请求一律拦截。
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      const url = details.url || '';
      const local = /^(file|data|blob|devtools|about|chrome-extension):/i.test(url);
      callback({ cancel: !local });
    });

    createWindow();
    createTray();

    ipcMain.handle('data:load', () => readData());
    ipcMain.handle('data:save', (_event, data) => writeData(data));
    ipcMain.on('data:save-sync', (event, data) => {
      try { writeData(data); event.returnValue = true; }
      catch (err) { console.error('[data] 写入失败:', err.message); event.returnValue = false; }
    });

    ipcMain.handle('app:info', () => ({
      version: app.getVersion(),
      dataFile: DATA_FILE,
      appDir: app.isPackaged ? path.dirname(app.getPath('exe')) : path.join(__dirname, '..'),
      portable: Boolean(process.env.PORTABLE_EXECUTABLE_DIR),
      packaged: app.isPackaged,
      autoStart: Boolean(app.getLoginItemSettings().openAtLogin),
      electron: process.versions.electron,
    }));

    ipcMain.handle('data:export', async (_event, json) => {
      const result = await dialog.showSaveDialog(win, {
        title: '导出本地数据',
        defaultPath: 'ToDoLocal-backup.json',
        filters: [{ name: 'JSON 数据文件', extensions: ['json'] }],
      });
      if (result.canceled || !result.filePath) return { ok: false };
      fs.writeFileSync(result.filePath, json, 'utf8');
      return { ok: true, path: result.filePath };
    });

    ipcMain.handle('data:import', async () => {
      const result = await dialog.showOpenDialog(win, {
        title: '导入本地数据',
        properties: ['openFile'],
        filters: [{ name: 'JSON 数据文件', extensions: ['json'] }],
      });
      if (result.canceled || !result.filePaths[0]) return { ok: false };
      return { ok: true, content: fs.readFileSync(result.filePaths[0], 'utf8') };
    });

    ipcMain.handle('dialog:pick-folder', async () => {
      const result = await dialog.showOpenDialog(win, {
        title: '选择工作文件夹',
        properties: ['openDirectory'],
      });
      if (result.canceled || !result.filePaths[0]) return null;
      return result.filePaths[0];
    });

    ipcMain.handle('shell:open-path', async (_event, target) => {
      const p = String(target || '').trim();
      if (!p) return { ok: false, error: 'empty' };
      try {
        if (!fs.existsSync(p) || !fs.statSync(p).isDirectory()) return { ok: false, error: 'not-found' };
        const err = await shell.openPath(p);
        return { ok: !err, error: err || '' };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    });

    ipcMain.handle('notify', (_event, title, body) => {
      if (Notification.isSupported()) {
        new Notification({ title, body, silent: false }).show();
        return true;
      }
      return false;
    });

    ipcMain.handle('settings:get-autostart', () => Boolean(app.getLoginItemSettings().openAtLogin));
    ipcMain.handle('settings:set-autostart', (_event, enable) => {
      const result = setAutoStart(enable);
      refreshTrayMenu();
      return result;
    });

    ipcMain.handle('win:isMaximized', () => (win ? win.isMaximized() : false));
    ipcMain.on('win:action', (_event, action) => {
      if (!win || win.isDestroyed()) return;
      if (action === 'min') win.minimize();
      else if (action === 'max') win.isMaximized() ? win.unmaximize() : win.maximize();
      else if (action === 'close') win.close();
    });
    ipcMain.on('win:mode', (_event, mode) => {
      if (!win || win.isDestroyed()) return;
      if (win.isMaximized()) win.unmaximize();
      const s = mode === 'mini' ? MINI : LARGE;
      win.setMinimumSize(mode === 'mini' ? 320 : 940, mode === 'mini' ? 420 : 560);
      win.setSize(s.width, s.height);
      win.center();
    });

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
      else showWindow();
    });
  });

  app.on('window-all-closed', () => { if (isQuitting) app.quit(); });
}
