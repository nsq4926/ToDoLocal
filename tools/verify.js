'use strict';
/* 真实 Electron 入口的自动化验收：启动窗口、执行交互、截图、核对数据落盘。 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { app, BrowserWindow } = require('electron');

const tmpData = path.join(os.tmpdir(), 'todo-verify-' + Date.now());
app.setPath('userData', tmpData);
const outDir = path.join(__dirname, '..', 'verify-out');
fs.mkdirSync(outDir, { recursive: true });

require('../src/main.js');

const results = [];
const check = (name, ok, detail) => results.push({ name, ok: !!ok, detail });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function step(wc, name, code) {
  try {
    const value = await wc.executeJavaScript(`(async () => { const wait = ms => new Promise(r => setTimeout(r, ms)); ${code} })()`, true);
    check(name, value && value.ok !== false, value);
    return value;
  } catch (err) {
    check(name, false, String(err));
    return null;
  }
}

async function shot(wc, file) {
  const img = await wc.capturePage();
  fs.writeFileSync(path.join(outDir, file), img.toPNG());
}

async function run() {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) { check('窗口创建', false, '未找到 BrowserWindow'); return finish(); }
  const wc = win.webContents;
  const consoleErrors = [];
  wc.on('console-message', (...args) => {
    const text = args.map((a) => (a && typeof a === 'object' ? (a.message || JSON.stringify(a)) : String(a))).join(' ');
    if (/error|Uncaught|失败/i.test(text)) consoleErrors.push(text);
  });

  if (wc.isLoading()) { await wait(800); }
  await wait(700);
  check('窗口创建', !win.isDestroyed(), { title: win.getTitle(), size: win.getSize() });

  await step(wc, '初始渲染', `
    return {
      ok: typeof state !== 'undefined' && state.tasks.length === 4
        && document.getElementById('pageTitle').textContent === '我的一天'
        && document.querySelectorAll('#taskList .task-item').length === 3,
      tasks: typeof state !== 'undefined' ? state.tasks.length : -1,
      cards: document.querySelectorAll('#taskList .task-item').length
    };`);
  await shot(wc, '01-initial.png');

  await step(wc, '添加任务', `
    const inp = document.getElementById('addInput');
    inp.value = '自动化验证任务';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await wait(80);
    return { ok: state.tasks.some(t => t.title === '自动化验证任务'), count: state.tasks.length };`);

  await step(wc, '完成任务', `
    const before = state.tasks.filter(t => t.completed).length;
    document.querySelector('#taskList .task-item .checkbox').click();
    await wait(80);
    return { ok: state.tasks.filter(t => t.completed).length === before + 1 };`);

  await step(wc, '标记重要', `
    const item = document.querySelector('#taskList .task-item');
    const id = item.dataset.id;
    item.querySelector('.task-star').click();
    await wait(80);
    return { ok: getTask(id).important === true };`);

  await step(wc, '打开任务详情', `
    document.querySelector('#taskList .task-item .task-body').click();
    await wait(450);
    const el = document.getElementById('detail');
    return { ok: el.classList.contains('open') && !!document.getElementById('dTitle') && el.getBoundingClientRect().width > 300,
      width: el.getBoundingClientRect().width, flexBasis: getComputedStyle(el).flexBasis };`);
  await shot(wc, '02-detail.png');

  await step(wc, '添加步骤与备注', `
    const id = selectedId;
    const before = getTask(id).steps.length;
    const inp = document.getElementById('dStepInput');
    inp.value = '验证步骤';
    inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await wait(100);
    const note = document.getElementById('dNote');
    note.value = '本地持久化验证备注';
    note.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(80);
    return { ok: getTask(id).steps.length === before + 1 && getTask(id).note.includes('本地持久化'), steps: getTask(id).steps.length };`);

  await step(wc, '切换智能视图', `
    document.querySelector('.nav-item[data-view="important"]').click();
    await wait(80);
    return { ok: document.getElementById('pageTitle').textContent === '重要', title: document.getElementById('pageTitle').textContent };`);

  await step(wc, '搜索任务', `
    const s = document.getElementById('searchInput');
    s.value = '自动化验证'; s.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(100);
    const ok = document.getElementById('pageTitle').textContent === '搜索结果' && currentTasks().length >= 1;
    document.getElementById('searchClear').click();
    await wait(60);
    return { ok };`);

  await step(wc, '新建自定义列表', `
    document.getElementById('btnNewList').click();
    await wait(80);
    document.getElementById('newListName').value = '工作';
    document.getElementById('nleCreate').click();
    await wait(100);
    return { ok: state.lists.length === 2 && state.lists.some(l => l.name === '工作'), lists: state.lists.length };`);

  await step(wc, '切换深色主题', `
    document.getElementById('btnSettings').click();
    await wait(200);
    document.querySelector('#popMenu [data-cmd="theme-menu"]').click();
    await wait(160);
    document.querySelector('#popMenu [data-cmd="theme"][data-value="dark"]').click();
    await wait(100);
    return { ok: document.documentElement.dataset.theme === 'dark' };`);
  await shot(wc, '03-dark.png');

  await step(wc, '开机自启接口与主进程信息', `
    document.documentElement.dataset.theme = 'blue';
    state.settings.theme = 'blue';
    view = 'myday'; searchText = ''; selectedId = null; detailEditor = null; renderAll();
    await wait(100);
    const cur = await API.getAutoStart();
    const back = await API.setAutoStart(false);
    const info = await API.info();
    return { ok: typeof cur === 'boolean' && back === false && !!info.appDir && !!info.electron,
      cur, back, appDir: info.appDir, electron: info.electron };`);

  await step(wc, '侧栏清理与设置按钮位置', `
    const btn = document.getElementById('btnSettings');
    return { ok: !document.querySelector('.account') && !document.querySelector('.offline-note')
      && !!btn && !!btn.closest('.tb-actions')
      && btn.nextElementSibling.id === 'btnMini'
      && !!document.getElementById('btnNewListFoot') };`);

  await step(wc, '设置菜单无数据文件行', `
    document.getElementById('btnSettings').click();
    await wait(180);
    const menu = document.getElementById('popMenu');
    const text = menu.textContent;
    return { ok: !menu.classList.contains('hidden') && !text.includes('数据文件')
      && text.includes('开机自启') && text.includes('清空所有数据') };`);
  await shot(wc, '08-settings-menu.png');

  await step(wc, '关于本应用描述文案', `
    document.querySelector('#popMenu [data-cmd="about"]').click();
    await wait(180);
    const body = document.getElementById('modalBody').textContent;
    const info = await API.info();
    const ok = !document.getElementById('modalMask').classList.contains('hidden')
      && body.includes('类Microsoft To Do的离线版任务清单,无需联网。')
      && body.includes('数据文件:' + info.dataFile)
      && !body.includes('*****') && !body.includes('Electron');
    return { ok, body };`);
  await shot(wc, '09-about.png');
  await wc.executeJavaScript("document.getElementById('modalOk').click()");
  await wait(100);

  await step(wc, '更多菜单无重复项', `
    document.getElementById('btnMore').click();
    await wait(140);
    const menu = document.getElementById('popMenu');
    const text = menu.textContent;
    const ok = !menu.classList.contains('hidden')
      && text.includes('排序方式') && text.includes('清除已完成任务')
      && !text.includes('更改主题') && !text.includes('切换到小面板')
      && !text.includes('设置与数据');
    menu.classList.add('hidden');
    return { ok };`);

  await step(wc, '任务右键菜单完整项', `
    const item = document.querySelector('#taskList .task-item');
    const r = item.getBoundingClientRect();
    item.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + 20, clientY: r.top + 10 }));
    await wait(100);
    const menu = document.getElementById('popMenu');
    const text = menu.textContent;
    const patterns = [/我的一天/, /标记为重要|取消重要标记/, /标记为已完成|标记为未完成/,
      /今天到期/, /明天到期/, /根据此任务创建新列表/, /将任务移动到/, /将任务复制到/, /删除任务/];
    return { ok: !menu.classList.contains('hidden') && patterns.every(p => p.test(text)),
      missing: patterns.filter(p => !p.test(text)).map(String), items: menu.querySelectorAll('.pm-item').length };`);
  await shot(wc, '07-context-menu.png');

  await step(wc, '右键移动子菜单与返回', `
    document.querySelector('#popMenu [data-cmd="task-move-sub"]').click();
    await wait(140);
    const sub = document.getElementById('popMenu').textContent;
    const hasLists = state.lists.every(l => sub.includes(l.name));
    document.querySelector('#popMenu [data-cmd="task-sub-back"]').click();
    await wait(140);
    const back = document.getElementById('popMenu').textContent;
    return { ok: hasLists && sub.includes('将任务移动到') && back.includes('删除任务') };`);

  await step(wc, '右键设置到期与据此建列表', `
    const first = document.querySelector('#taskList .task-item');
    const id = first.dataset.id;
    let r = first.getBoundingClientRect();
    first.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + 20, clientY: r.top + 10 }));
    await wait(80);
    document.querySelector('#popMenu [data-cmd="task-due-today"]').click();
    await wait(120);
    const dueOk = getTask(id).dueDate === today();
    const beforeLists = state.lists.length;
    const again = document.querySelector('#taskList .task-item');
    r = again.getBoundingClientRect();
    again.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + 20, clientY: r.top + 10 }));
    await wait(80);
    document.querySelector('#popMenu [data-cmd="task-new-list"]').click();
    await wait(140);
    return { ok: dueOk && state.lists.length === beforeLists + 1 && getTask(id).listId !== 'inbox',
      due: getTask(id).dueDate, lists: state.lists.length };`);

  await step(wc, '卡片内步骤展开与圆圈完成', `
    const t = state.tasks.find(x => !x.completed) || state.tasks[0];
    t.steps = [{ id: 's1', title: '步骤 A', done: false }, { id: 's2', title: '步骤 B', done: false }];
    persist(); renderAll();
    await wait(100);
    const card = document.querySelector('.task-item[data-id="' + t.id + '"]');
    const hasToggle = !!card && !!card.querySelector('.steps-toggle');
    card.querySelector('.steps-toggle').click();
    await wait(100);
    const card2 = document.querySelector('.task-item[data-id="' + t.id + '"]');
    const steps = card2.querySelectorAll('.task-step');
    card2.querySelector('.task-step .checkbox').click();
    await wait(100);
    return { ok: hasToggle && steps.length === 2 && getTask(t.id).steps[0].done === true,
      steps: steps.length };`);
  await wait(280);
  await shot(wc, '06-steps-expanded.png');

  await step(wc, '详情工作文件夹与资源管理器接口', `
    const t = state.tasks.find(x => x.title === '自动化验证任务') || state.tasks[0];
    updateTask(t.id, { folder: 'D:/APP/BuddyWork/ToDoList' });
    selectedId = t.id; detailEditor = null; renderAll();
    await wait(120);
    const detailText = document.getElementById('detailInner').textContent;
    const invalid = await API.openFolder('Z:/__不存在的目录__');
    return { ok: detailText.includes('ToDoList') && !detailText.includes('设置工作文件夹')
      && invalid.ok === false && typeof API.pickFolder === 'function',
      detailHasFolder: detailText.includes('ToDoList'), invalidOpen: invalid.ok };`);

  await step(wc, '切换到小面板', `
    view = 'myday'; selectedId = null; renderAll();
    await wait(80);
    setMiniMode(true);
    await wait(160);
    return { ok: miniMode === true && document.body.classList.contains('mini-mode')
      && !document.getElementById('miniView').classList.contains('hidden')
      && document.getElementById('miniList').querySelectorAll('.mini-task').length > 0
      && state.settings.miniMode === true,
      tasks: document.getElementById('miniList').querySelectorAll('.mini-task').length };`);
  await wait(450);
  await shot(wc, '04-mini-list.png');

  await step(wc, '小面板平推到任务详情', `
    document.querySelector('#miniList .mini-task').click();
    await wait(340);
    return { ok: miniDetail === true
      && document.getElementById('miniPages').classList.contains('show-detail')
      && !document.getElementById('miniBack').classList.contains('hidden')
      && !!document.getElementById('miniTitleInput') };`);
  await shot(wc, '05-mini-detail.png');

  await step(wc, '左上箭头返回并切回大面板', `
    document.getElementById('miniBack').click();
    await wait(280);
    const backOk = miniDetail === false && !document.getElementById('miniPages').classList.contains('show-detail');
    setMiniMode(false);
    await wait(160);
    return { ok: backOk && miniMode === false
      && !document.getElementById('appShell').classList.contains('hidden')
      && state.settings.miniMode === false };`);
  await wait(350);

  await step(wc, '无外部资源引用', `
    const urls = [...document.querySelectorAll('[src],[href]')].map(e => e.getAttribute('src') || e.getAttribute('href'));
    return { ok: urls.every(u => !/^https?:\\/\\//i.test(u)), urls };`);

  // 等待防抖写入完成，核对真实文件
  await wait(500);
  const dataFile = path.join(tmpData, 'data', 'data.json');
  try {
    const raw = fs.readFileSync(dataFile, 'utf8');
    const data = JSON.parse(raw);
    check('本地数据落盘', data.tasks.length >= 5 && data.tasks.some((t) => t.title === '自动化验证任务')
      && 'miniMode' in data.settings && data.tasks.some((t) => 'folder' in t), {
      file: dataFile, tasks: data.tasks.length, lists: data.lists.length,
      theme: data.settings.theme, miniMode: data.settings.miniMode,
    });
  } catch (err) {
    check('本地数据落盘', false, String(err));
  }
  // 关闭按钮 = 隐藏到托盘，窗口与进程保持常驻
  try {
    await wc.executeJavaScript("window.todoAPI.win('close')");
    await wait(420);
    check('关闭隐藏到托盘（进程常驻）', !win.isVisible() && !win.isDestroyed(), {
      visible: win.isVisible(), destroyed: win.isDestroyed(),
    });
    win.show();
    await wait(150);
  } catch (err) {
    check('关闭隐藏到托盘（进程常驻）', false, String(err));
  }
  const iconPath = path.join(__dirname, '..', 'src', 'icon.ico');
  try {
    const { nativeImage } = require('electron');
    check('托盘图标资源', fs.existsSync(iconPath) && !nativeImage.createFromPath(iconPath).isEmpty(), { path: iconPath });
  } catch (err) {
    check('托盘图标资源', false, String(err));
  }
  check('页面运行无报错', consoleErrors.length === 0, consoleErrors.slice(0, 5));
  finish();
}

function finish() {
  const report = { time: new Date().toISOString(), passed: results.filter((r) => r.ok).length, total: results.length, results };
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
  console.log('VERIFY_REPORT=' + JSON.stringify(report));
  setTimeout(() => app.exit(report.passed === report.total ? 0 : 1), 120);
}

app.whenReady().then(() => setTimeout(() => {
  run().catch((err) => { check('验证脚本异常', false, String(err && err.stack || err)); finish(); });
}, 1500));
