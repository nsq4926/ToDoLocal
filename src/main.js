'use strict';

/* ---------- 启动痕迹 ----------
   必须在 require('electron') 之前执行：即使之后 Chromium 初始化失败、主进程崩溃，
   也能确认“进程到底有没有执行到 JS”。绿色版写在 <软件目录>/ToDoLocal-Data/launch.log，
   开发态写系统临时目录。 */
function appendLog(dir, message) {
  try {
    const fs = require('fs');
    const path = require('path');
    const file = path.join(dir, 'launch.log');
    try { if (fs.statSync(file).size > 64 * 1024) fs.truncateSync(file, 0); } catch (_) { /* 首次写入 */ }
    fs.appendFileSync(file, `${new Date().toISOString()} ${message}\n`, 'utf8');
    return true;
  } catch (_) {
    return false;
  }
}

function traceBoot(message) {
  try {
    const fs = require('fs');
    const path = require('path');
    const os = require('os');
    const dirs = [];
    if (!process.defaultApp) dirs.push(path.join(path.dirname(process.execPath), 'ToDoLocal-Data'));
    dirs.push(os.tmpdir());
    for (const dir of dirs) {
      try { fs.mkdirSync(dir, { recursive: true }); } catch (_) { /* 已存在或不可写 */ }
      if (appendLog(dir, message)) return;
    }
  } catch (_) { /* 诊断日志失败不影响启动 */ }
}

let appVersion = '?';
try { appVersion = require('../package.json').version || '?'; } catch (_) { /* 读不到版本不影响启动 */ }

traceBoot(`boot v${appVersion} electron=${process.versions.electron || '-'} node=${process.versions.node} `
  + `runAsNode=${process.env.ELECTRON_RUN_AS_NODE || ''} packaged=${!process.defaultApp} `
  + `exec=${process.execPath} argv=${JSON.stringify(process.argv.slice(1))}`);

/* 部分宿主（IDE、自动化壳、注入了 ELECTRON_RUN_AS_NODE=1 的终端）会让 Electron 退化成纯 Node，
   表现为双击后进程秒退、没有任何窗口。检测到后以干净环境重新拉起自身。 */
if (process.env.ELECTRON_RUN_AS_NODE && process.versions.electron) {
  traceBoot('run-as-node：以干净环境重启自身');
  const { spawn } = require('child_process');
  const env = Object.assign({}, process.env);
  delete env.ELECTRON_RUN_AS_NODE;
  const args = process.argv.slice(1).filter((a) => !/\.(c|m)?js$/i.test(a));
  try {
    const child = spawn(process.execPath, args, { env, detached: true, stdio: 'ignore' });
    traceBoot(`run-as-node：已拉起新进程 pid=${child.pid}`);
    child.unref();
  } catch (err) {
    traceBoot(`run-as-node：自动重启失败 ${err.message}`);
  }
  process.exit(0);
}

const { app, BrowserWindow, ipcMain, Menu, Notification, dialog, session, shell, Tray, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { buildWorkbook } = require('./xlsx');

// 禁止 Electron 自身的后台联网行为（更新探测、组件更新、DNS 预取等）。
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-component-update');
app.commandLine.appendSwitch('disable-domain-reliability');
app.commandLine.appendSwitch('no-first-run');
// 部分机器/受限环境下 Chromium 子进程（GPU、渲染器）创建会被拒绝，表现为双击后秒退且不留日志。
// 本应用严格离线、只加载本地文件，这里关闭 Chromium 沙箱以保证能启动。
if (process.env.TODOLOCAL_KEEP_SANDBOX !== '1') {
  app.commandLine.appendSwitch('no-sandbox');
  app.commandLine.appendSwitch('disable-gpu-sandbox');
}
app.setAppUserModelId('cn.local.todolist.app');

const LARGE = { width: 1280, height: 820 };
const MINI = { width: 380, height: 620 };

let win = null;
let tray = null;
let DATA_FILE = null;
let isQuitting = false;
let trayHintShown = false;

/** 运行期日志：与启动痕迹写同一个文件；数据文件尚未确定时退回临时目录。 */
function logLine(message) {
  if (DATA_FILE) appendLog(path.dirname(DATA_FILE), message);
  else traceBoot(message);
}

/** 是否以管理员身份运行。提权进程会被 Windows（UIPI）拦截来自普通资源管理器的拖放。
    只在需要时探测一次并缓存——whoami 是同步子进程，放在启动路径上会拖慢冷启动。 */
let elevatedCache = null;
function detectElevated() {
  if (elevatedCache !== null) return elevatedCache;
  if (process.platform !== 'win32') { elevatedCache = false; return elevatedCache; }
  try {
    const { execFileSync } = require('child_process');
    const out = execFileSync('whoami.exe', ['/groups'], { encoding: 'utf8', windowsHide: true });
    elevatedCache = out.includes('S-1-16-12288'); // High Mandatory Level
  } catch (_) {
    elevatedCache = false;
  }
  return elevatedCache;
}

function iconFile() {
  const packaged = path.join(process.resourcesPath || '', 'icon.ico');
  if (app.isPackaged && fs.existsSync(packaged)) return packaged;
  const local = path.join(__dirname, 'icon.ico');
  if (fs.existsSync(local)) return local;
  return path.join(__dirname, '..', 'build', 'icon.ico');
}

/** 在注册表登记任务栏身份（显示名 + 图标），让任务栏按钮使用应用自己的名称与图标。 */
function registerAppIdentity() {
  if (process.platform !== 'win32') return;
  const appId = 'cn.local.todolist.app';
  const icon = iconFile();
  const display = 'To Do · 本地版';
  const key = `HKCU\\Software\\Classes\\AppUserModelId\\${appId}`;
  try {
    const { execFile } = require('child_process');
    const run = (args) => new Promise((resolve) => execFile('reg', args, { windowsHide: true }, resolve));
    run(['add', key, '/v', 'DisplayName', '/t', 'REG_SZ', '/d', display, '/f'])
      .then(() => run(['add', key, '/v', 'IconUri', '/t', 'REG_SZ', '/d', icon, '/f']))
      .then(() => logLine('任务栏身份已登记'))
      .catch((err) => logLine(`登记任务栏身份失败：${err.message}`));
  } catch (err) {
    logLine(`登记任务栏身份失败：${err.message}`);
  }
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
  if (!win || win.isDestroyed()) { createWindow(); return; }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function toggleWindow() {
  if (!win || win.isDestroyed()) return;
  if (win.isVisible()) win.hide();
  else showWindow();
}

/** 托盘用 PNG 更稳（ICO 的多尺寸帧交给系统缩放时偶发空白）。 */
function trayIconFile() {
  const base = path.dirname(iconFile());
  for (const name of ['tray.png', 'tray-32.png']) {
    const p = path.join(base, name);
    if (fs.existsSync(p)) return p;
  }
  return iconFile();
}

function createTray() {
  try {
    const src = trayIconFile();
    const img = nativeImage.createFromPath(src);
    logLine(`托盘图标：${src} empty=${img.isEmpty()} size=${JSON.stringify(img.getSize())}`);
    tray = new Tray(img);
    tray.setToolTip('To Do · 本地版');
    refreshTrayMenu();
    tray.on('click', toggleWindow);
    logLine('托盘已创建');
  } catch (err) {
    console.error('[tray] 创建失败:', err.message);
    logLine(`托盘创建失败：${err.message}`);
    tray = null;
  }
}

/** 托盘丢失（被系统回收、创建失败）时重建，避免应用只能靠进程管理器关掉。 */
function ensureTray() {
  try {
    if (tray && !tray.isDestroyed()) return;
  } catch (_) { /* 继续重建 */ }
  createTray();
}

/** Windows 11 默认把新托盘图标收进「^」溢出区；把 NotifyIconSettings 中本程序的项标记为常驻显示。 */
function promoteTrayIcon() {
  if (process.platform !== 'win32') return;
  try {
    const { execFileSync } = require('child_process');
    const base = 'HKCU\\Control Panel\\NotifyIconSettings';
    let out = '';
    try {
      out = execFileSync('reg', ['query', base, '/s'], { encoding: 'utf8', windowsHide: true });
    } catch (_) {
      return; // 键还不存在，下次再试
    }
    const exe = process.execPath.toLowerCase();
    let currentKey = '';
    let matched = 0;
    for (const raw of out.split(/\r?\n/)) {
      const line = raw.trim();
      if (/^HKEY_/i.test(line)) { currentKey = line; continue; }
      if (!currentKey) continue;
      if (!line.toLowerCase().includes(exe)) continue;
      try {
        execFileSync('reg', ['add', currentKey, '/v', 'IsPromoted', '/t', 'REG_DWORD', '/d', '1', '/f'], { windowsHide: true });
        matched += 1;
      } catch (_) { /* 忽略单项失败 */ }
    }
    if (matched) logLine(`托盘图标已设为常驻显示（${matched} 项）`);
  } catch (err) {
    logLine(`设置托盘常驻失败：${err.message}`);
  }
}

function refreshTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示 / 隐藏主窗口', click: toggleWindow },
    {
      label: '在任务栏显示托盘图标…',
      click: () => { shell.openExternal('ms-settings:taskbar').catch(() => {}); },
    },
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
  logLine(`窗口已创建，开始加载界面：${path.join(__dirname, 'index.html')}`);
  // Windows 任务栏按钮取窗口图标：显式设置一次，避免回退到 electron.exe 自带的 Electron 图标。
  try {
    const img = nativeImage.createFromPath(iconFile()).resize({ width: 48, height: 48 });
    if (!img.isEmpty()) win.setIcon(img);
  } catch (err) {
    console.error('[icon] 设置窗口图标失败:', err.message);
  }
  // 界面迟迟不 ready 时也把窗口显示出来，避免“进程在跑但看不到窗口”。
  const showFallback = setTimeout(() => {
    if (win && !win.isDestroyed() && !win.isVisible()) {
      logLine('界面 3 秒内未就绪，强制显示窗口');
      win.show();
    }
  }, 3000);
  win.once('ready-to-show', () => {
    clearTimeout(showFallback);
    logLine('界面就绪，显示窗口');
    win.show();
  });

  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    logLine(`页面加载失败 code=${code} desc=${desc} url=${url}`);
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    logLine(`渲染进程退出 reason=${details && details.reason} exitCode=${details && details.exitCode}`);
  });
  win.webContents.on('preload-error', (_e, preloadPath, error) => {
    logLine(`preload 出错 ${preloadPath} ${error && error.message}`);
  });

  const notifyMax = (value) => {
    if (win && !win.isDestroyed()) win.webContents.send('win:maximized-changed', value);
  };
  win.on('maximize', () => notifyMax(true));
  win.on('unmaximize', () => notifyMax(false));

  // 关闭按钮 = 隐藏到托盘，保持进程常驻；仅托盘“退出”触发真正关闭。
  win.on('close', (event) => {
    if (isQuitting) return;
    if (!tray || tray.isDestroyed()) {
      // 没有可用托盘时隐藏窗口会让应用彻底失联，这里直接退出。
      logLine('托盘不可用，关闭窗口即退出应用');
      isQuitting = true;
      return;
    }
    event.preventDefault();
    if (win && !win.isDestroyed()) win.webContents.send('app:flush');
    win.hide();
    if (!trayHintShown) {
      trayHintShown = true;
      if (Notification.isSupported()) {
        new Notification({
          title: 'To Do 仍在后台运行',
          body: '已最小化到系统托盘（任务栏右下角「^」里）。右键托盘图标可退出；若看不到图标，可在「设置 → 个性化 → 任务栏 → 其他系统托盘图标」中打开。',
        }).show();
      }
    }
  });
}

// 单实例：避免多个进程同时写同一份数据文件。
// 注意：受限环境里命名对象可能创建失败，requestSingleInstanceLock() 会误报“已有实例”，
// 所以再用自己的 PID 文件复核一次，只有确实存在存活实例时才退出。
DATA_FILE = pickDataFile();
const instancePidFile = path.join(path.dirname(DATA_FILE), 'instance.pid');
const wakeFile = path.join(path.dirname(DATA_FILE), 'wake.flag');

/** 请求已运行的实例把窗口唤到前台（不依赖 second-instance 事件是否送达）。 */
function requestWake() {
  try { fs.writeFileSync(wakeFile, String(Date.now()), 'utf8'); } catch (_) { /* 忽略 */ }
}

/** 读取实例 PID 文件，返回仍存活的 PID（0 表示没有）。 */
function liveInstancePid(file) {
  try {
    const raw = fs.readFileSync(file, 'utf8').trim();
    const pid = Number(raw.split(/\s+/)[0]);
    if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return 0;
    process.kill(pid, 0); // 进程不存在时会抛错
    return pid;
  } catch (_) {
    return 0;
  }
}

/** 退出时删除自己写的 PID 文件，避免留下假实例。 */
function clearInstancePid() {
  try {
    const raw = fs.readFileSync(instancePidFile, 'utf8').trim();
    if (Number(raw.split(/\s+/)[0]) === process.pid) fs.unlinkSync(instancePidFile);
  } catch (_) { /* 文件不存在或被占用，忽略 */ }
}

// 提前确保 userData 目录存在：部分环境下该目录缺失会让 requestSingleInstanceLock 直接崩溃。
try { fs.mkdirSync(app.getPath('userData'), { recursive: true }); } catch (_) { /* 忽略 */ }
let lockAcquired = false;
try { lockAcquired = app.requestSingleInstanceLock(); } catch (err) { traceBoot('single-instance lock failed: ' + err.message); lockAcquired = false; }
const otherInstancePid = lockAcquired ? 0 : liveInstancePid(instancePidFile);

if (!lockAcquired && otherInstancePid) {
  requestWake();
  logLine(`已有实例在运行（pid=${otherInstancePid}），已请求它显示窗口，本次启动退出`);
  app.quit();
} else {
  if (!lockAcquired) logLine('单实例锁不可用但未发现存活实例，按无实例继续启动');
  try {
    fs.mkdirSync(path.dirname(instancePidFile), { recursive: true });
    fs.writeFileSync(instancePidFile, `${process.pid} ${Date.now()}`, 'utf8');
  } catch (_) { /* 写不了 PID 文件不影响启动 */ }

  app.on('second-instance', () => { logLine('检测到重复启动，唤起已有窗口'); ensureTray(); showWindow(); });
  app.on('before-quit', () => { isQuitting = true; clearInstancePid(); logLine('应用退出'); });
  app.on('child-process-gone', (_event, details) => {
    logLine(`子进程退出 type=${details && details.type} reason=${details && details.reason}`);
  });
  // 只观察、不改变 Electron 默认的异常处理（仍会弹出系统错误框）。
  process.on('uncaughtExceptionMonitor', (err) => {
    logLine(`未捕获异常 ${err && err.stack ? err.stack : err}`);
  });
  process.on('unhandledRejection', (reason) => logLine(`未处理的 Promise 拒绝 ${reason}`));

  app.whenReady().then(() => {
    logLine(`启动 v${app.getVersion()} name=${app.getName()} electron=${process.versions.electron} node=${process.versions.node} packaged=${app.isPackaged} data=${DATA_FILE}`);
    // 任务栏身份：部分 Electron 版本在 ready 之前调用不生效，这里在创建窗口前再设一次。
    app.setAppUserModelId('cn.local.todolist.app');

    // 严格离线：仅允许本地资源，任何外部网络请求一律拦截。
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      const url = details.url || '';
      const local = /^(file|data|blob|devtools|about|chrome-extension):/i.test(url);
      callback({ cancel: !local });
    });

    createWindow();
    createTray();
    setTimeout(promoteTrayIcon, 3000);
    setTimeout(promoteTrayIcon, 9000);
    registerAppIdentity();

    // 另一个进程通过 wake.flag 请求唤起窗口（second-instance 不可靠时的兜底）。
    setInterval(() => {
      try {
        if (!fs.existsSync(wakeFile)) return;
        fs.unlinkSync(wakeFile);
        logLine('收到唤醒请求，显示窗口');
        ensureTray();
        showWindow();
      } catch (_) { /* 忽略读取失败 */ }
    }, 800);

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
      elevated: detectElevated(),
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
        title: '选择工作区目录',
        properties: ['openDirectory'],
      });
      if (result.canceled || !result.filePaths[0]) return null;
      return result.filePaths[0];
    });

    // 工作区：可多选文件或目录（Windows 不支持同一次对话框混选，故由渲染层指定模式）。
    ipcMain.handle('dialog:pick-workspace', async (_event, mode) => {
      const dir = mode === 'dir';
      const result = await dialog.showOpenDialog(win, {
        title: dir ? '选择工作区目录（可多选）' : '选择工作区文件（可多选）',
        properties: dir ? ['openDirectory', 'multiSelections'] : ['openFile', 'multiSelections'],
      });
      if (result.canceled) return [];
      return result.filePaths || [];
    });

    // 拖入的路径需要判断是文件还是目录，并顺带过滤重复项。
    ipcMain.handle('fs:stat-paths', (_event, targets) => {
      const list = Array.isArray(targets) ? targets : [];
      const out = [];
      const seen = new Set();
      for (const raw of list) {
        const p = String(raw || '').trim();
        if (!p) continue;
        const key = p.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        try {
          const st = fs.statSync(p);
          out.push({ path: p, kind: st.isDirectory() ? 'dir' : 'file', name: path.basename(p), exists: true });
        } catch (_) {
          out.push({ path: p, kind: 'file', name: path.basename(p), exists: false });
        }
      }
      return out;
    });

    // 打开工作区条目：目录用资源管理器，文件用系统默认程序；打不开时退回“在文件夹中显示”。
    ipcMain.handle('shell:open-path', async (_event, target) => {
      const p = String(target || '').trim();
      if (!p) return { ok: false, error: 'empty' };
      try {
        const st = fs.statSync(p);
        const err = await shell.openPath(p);
        if (!err) return { ok: true, kind: st.isDirectory() ? 'dir' : 'file' };
        if (!st.isDirectory()) {
          shell.showItemInFolder(p);
          return { ok: true, kind: 'file', revealed: true };
        }
        return { ok: false, error: err };
      } catch (err) {
        return { ok: false, error: 'not-found' };
      }
    });

    ipcMain.handle('data:export-excel', async (_event, payload) => {
      let buffer;
      try {
        buffer = buildWorkbook(payload || {});
      } catch (err) {
        return { ok: false, error: err.message || '生成失败' };
      }
      const d = new Date();
      const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
      // 默认保存到「文档」，避免对话框停在上次那个没有写入权限的位置（例如只读盘 / 受限目录）。
      const defaultDir = (() => {
        const candidates = [];
        try { candidates.push(app.getPath('documents')); } catch (_) { /* 取不到就跳过 */ }
        try { candidates.push(app.getPath('desktop')); } catch (_) { /* 同上 */ }
        if (DATA_FILE) candidates.push(path.dirname(DATA_FILE));
        for (const dir of candidates) {
          try {
            fs.mkdirSync(dir, { recursive: true });
            fs.accessSync(dir, fs.constants.W_OK);
            return dir;
          } catch (_) { /* 尝试下一个 */ }
        }
        return '';
      })();
      const result = await dialog.showSaveDialog(win, {
        title: '导出到 Excel',
        defaultPath: path.join(defaultDir || '.', `ToDoLocal-任务清单-${stamp}.xlsx`),
        filters: [{ name: 'Excel 工作簿', extensions: ['xlsx'] }],
      });
      if (result.canceled || !result.filePath) return { ok: false, canceled: true };
      try {
        fs.writeFileSync(result.filePath, buffer);
        return { ok: true, path: result.filePath };
      } catch (err) {
        const denied = err.code === 'EACCES' || err.code === 'EPERM';
        return {
          ok: false,
          error: denied
            ? `没有写入权限：${path.dirname(result.filePath)}，请换到「文档」或桌面后再试`
            : (err.message || '写入失败'),
        };
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
    // 渲染层的诊断日志（拖放、导出等），写到同一个 launch.log，方便排查。
    ipcMain.on('app:log', (_event, message) => logLine(`[ui] ${message}`));
    // 只允许打开 http(s) 链接（关于页的 GitHub 地址），其它一律忽略。
    ipcMain.handle('shell:open-external', async (_event, url) => {
      const target = String(url || '');
      if (!/^https?:\/\//i.test(target)) return false;
      try { await shell.openExternal(target); return true; } catch (err) { logLine(`打开链接失败：${err.message}`); return false; }
    });
    ipcMain.handle('win:set-pin', (_event, flag) => {
      if (!win || win.isDestroyed()) return false;
      win.setAlwaysOnTop(Boolean(flag));
      return win.isAlwaysOnTop();
    });
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
