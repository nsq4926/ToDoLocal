'use strict';

/* ============================ 运行宿主适配 ============================
   Electron 下使用 preload 暴露的本地文件 API；
   直接用浏览器打开 index.html 时降级到 localStorage，便于离线预览。 */
const API = window.todoAPI || {
  isElectron: false,
  load: async () => {
    try { return JSON.parse(localStorage.getItem('todo-local-v1') || 'null'); } catch (_) { return null; }
  },
  save: async (data) => localStorage.setItem('todo-local-v1', JSON.stringify(data)),
  saveSync: (data) => localStorage.setItem('todo-local-v1', JSON.stringify(data)),
  exportData: async (json) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    a.download = 'ToDoLocal-backup.json'; a.click();
    return { ok: true };
  },
  importData: async () => ({ ok: false }),
  notify: async (title, body) => console.log('[提醒]', title, body),
  info: async () => ({ version: '1.1.0', dataFile: '浏览器预览模式（localStorage）', portable: false, autoStart: false }),
  win: () => {}, winMode: () => {}, isMaximized: async () => false, onMaximizedChange: () => {},
  onFlush: () => {}, onTrayAction: () => {},
  getAutoStart: async () => false, setAutoStart: async (v) => !!v,
  pickFolder: async () => null, openFolder: async () => ({ ok: false }),
};

/* ============================ 工具函数 ============================ */
const $ = (id) => document.getElementById(id);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const pad2 = (n) => String(n).padStart(2, '0');
const dateStr = (d = new Date()) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const today = () => dateStr();
const shiftDate = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return dateStr(d); };
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ico = (name, cls = 'ic ic-16') => `<svg class="${cls}"><use href="#i-${name}"/></svg>`;
const WEEK = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
const longToday = () => { const d = new Date(); return `${d.getMonth() + 1}月${d.getDate()}日，${WEEK[d.getDay()]}`; };
const shortDate = (s) => { const [, m, d] = String(s).split('-'); return `${Number(m)}月${Number(d)}日`; };
const dueLabel = (s) => s === today() ? '今天' : s === shiftDate(1) ? '明天' : s === shiftDate(-1) ? '昨天' : shortDate(s);
const dtLabel = (iso) => {
  const d = new Date(iso);
  return `${shortDate(dateStr(d))} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};
const toLocalInput = (iso) => {
  const d = new Date(iso);
  return `${dateStr(d)}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};
const basename = (p) => String(p || '').split(/[\\/]/).filter(Boolean).pop() || '';

const COLORS = ['#2563c9', '#6a4fc0', '#b8467e', '#c4314b', '#c1622a', '#237a55', '#00838f', '#5c6470'];
const THEMES = [
  { id: 'blue', name: '经典蓝', color: '#dbe7f8' },
  { id: 'purple', name: '薰衣草', color: '#e5d9f6' },
  { id: 'green', name: '薄荷绿', color: '#d7eddf' },
  { id: 'peach', name: '暖阳橙', color: '#f8ddc4' },
  { id: 'pink', name: '樱花粉', color: '#f4d8e7' },
  { id: 'dark', name: '深色', color: '#272b33' },
];
const SMART = [
  { id: 'myday', label: '我的一天', icon: 'sun' },
  { id: 'important', label: '重要', icon: 'star' },
  { id: 'planned', label: '已计划', icon: 'calendar' },
];
const REPEATS = [
  { id: 'none', label: '不重复' }, { id: 'daily', label: '每天' },
  { id: 'weekly', label: '每周' }, { id: 'monthly', label: '每月' },
];

/* ============================ 状态 ============================ */
let state = null;
let view = 'myday';
let searchText = '';
let selectedId = null;
let detailEditor = null;
let completedOpen = false;
let suggestOpen = false;
let addOpts = { due: null, remind: null, repeat: 'none' };
let listEditor = null;           // { id?: string, color: string }
let saveTimer = null;
let toastTimer = null;
let modalOkFn = null;
let dragId = null;
let expandedSteps = new Set();
let miniMode = false;
let miniDetail = false;
let ctxTaskId = null;
let ctxSub = null;
let ctxXY = { x: 0, y: 0 };

function defaultState() {
  const now = Date.now();
  return {
    version: 1,
    settings: { theme: 'blue', collapsed: false, sort: 'manual', showCompleted: true, miniMode: false },
    lists: [{ id: 'inbox', name: '任务', color: '#2563c9', builtin: true }],
    tasks: [
      mkTask('欢迎使用 To Do 本地版', { myDay: today(), note: '这是一个完全离线的单机版任务管理器。所有数据只保存在本机，不会连接网络、邮箱或任何外部服务。', order: 0, createdAt: now }),
      mkTask('点击左侧圆圈即可完成任务', { myDay: today(), order: 1, createdAt: now + 1 }),
      mkTask('点击任务可添加步骤、提醒、截止日期和备注', { myDay: today(), order: 2, createdAt: now + 2 }),
      mkTask('已完成的示例任务', { myDay: today(), completed: true, completedAt: now - 3600000, order: 3, createdAt: now - 7200000 }),
    ],
  };
}

function mkTask(title, extra = {}) {
  return Object.assign({
    id: uid(), title, listId: 'inbox', completed: false, completedAt: null,
    important: false, myDay: null, dueDate: null, remindAt: null, reminded: false,
    repeat: 'none', note: '', steps: [], folder: '', createdAt: Date.now(), updatedAt: Date.now(), order: Date.now(),
  }, extra);
}

function normalize(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.tasks)) return null;
  const s = {
    version: 1,
    settings: Object.assign({ theme: 'blue', collapsed: false, sort: 'manual', showCompleted: true, miniMode: false }, raw.settings || {}),
    lists: Array.isArray(raw.lists) ? raw.lists : [],
    tasks: raw.tasks,
  };
  if (!s.lists.some((l) => l.id === 'inbox')) {
    s.lists.unshift({ id: 'inbox', name: '任务', color: '#2563c9', builtin: true });
  }
  s.tasks = s.tasks.map((t) => {
    const base = mkTask('');
    const o = Object.assign({}, base, t);
    o.steps = Array.isArray(t.steps) ? t.steps.map((st) => Object.assign({ id: uid(), title: '', done: false }, st)) : [];
    o.order = Number.isFinite(t.order) ? t.order : 0;
    return o;
  });
  return s;
}

function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { try { API.save(state); } catch (e) { console.error(e); } }, 140);
}

/* ============================ 数据访问 ============================ */
const getList = (id) => state.lists.find((l) => l.id === id);
const getTask = (id) => state.tasks.find((t) => t.id === id);
const isSearching = () => searchText.trim().length > 0;
const listIdOfView = () => (view.startsWith('list:') ? view.slice(5) : null);

function matchTask(t, q) {
  const text = [t.title, t.note, ...(t.steps || []).map((s) => s.title)].join(' ').toLowerCase();
  return text.includes(q);
}

function currentTasks() {
  let arr;
  if (isSearching()) arr = state.tasks.filter((t) => matchTask(t, searchText.trim().toLowerCase()));
  else if (view === 'myday') arr = state.tasks.filter((t) => t.myDay === today());
  else if (view === 'important') arr = state.tasks.filter((t) => t.important);
  else if (view === 'planned') arr = state.tasks.filter((t) => t.dueDate || t.remindAt);
  else arr = state.tasks.filter((t) => t.listId === listIdOfView());
  return arr;
}

function sortTasks(arr) {
  const mode = state.settings.sort;
  const cmp = {
    manual: (a, b) => a.order - b.order,
    created: (a, b) => b.createdAt - a.createdAt,
    alpha: (a, b) => a.title.localeCompare(b.title, 'zh-CN'),
    importance: (a, b) => (b.important ? 1 : 0) - (a.important ? 1 : 0) || a.order - b.order,
    due: (a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999') || a.order - b.order,
  }[mode] || ((a, b) => a.order - b.order);
  return arr.slice().sort(cmp);
}

/* ============================ 渲染 ============================ */
function pageMeta() {
  if (isSearching()) return { title: '搜索结果', sub: `“${searchText.trim()}” · 共 ${currentTasks().length} 项`, icon: 'search', color: 'var(--accent)' };
  if (view === 'myday') return { title: '我的一天', sub: longToday(), icon: 'sun', color: 'var(--accent)' };
  if (view === 'important') return { title: '重要', sub: '标记为重要的任务', icon: 'star', color: 'var(--star)' };
  if (view === 'planned') return { title: '已计划', sub: '设置了截止日期或提醒的任务', icon: 'calendar', color: 'var(--accent)' };
  const l = getList(listIdOfView());
  return { title: l ? l.name : '任务', sub: `${currentTasks().filter((t) => !t.completed).length} 项待办`, icon: null, color: l ? l.color : 'var(--accent)' };
}

function renderSidebar() {
  const active = isSearching() ? '' : view;
  $('smartNav').innerHTML = SMART.map((s) => {
    const n = state.tasks.filter((t) => !t.completed && (
      s.id === 'myday' ? t.myDay === today() : s.id === 'important' ? t.important : (t.dueDate || t.remindAt)
    )).length;
    return `<div class="nav-item ${active === s.id ? 'active' : ''}" data-act="view" data-view="${s.id}" title="${s.label}">
      <span class="nav-icon">${ico(s.icon, 'ic ic-18')}</span>
      <span class="nav-label">${s.label}</span><span class="nav-count">${n || ''}</span></div>`;
  }).join('');

  $('listsNav').innerHTML = state.lists.map((l) => {
    const n = state.tasks.filter((t) => !t.completed && t.listId === l.id).length;
    return `<div class="list-item ${active === 'list:' + l.id ? 'active' : ''}" data-act="view" data-view="list:${l.id}" data-list="${l.id}" title="${esc(l.name)}">
      <span class="list-dot" style="background:${esc(l.color)}"></span>
      <span class="nav-label list-name">${esc(l.name)}</span><span class="list-count">${n || ''}</span></div>`;
  }).join('');
}

function renderHeader() {
  const m = pageMeta();
  $('pageTitle').textContent = m.title;
  $('pageDate').textContent = m.sub;
  $('pageIcon').innerHTML = m.icon
    ? ico(m.icon, 'ic ic-26')
    : `<span class="list-dot" style="background:${esc(m.color)};width:15px;height:15px;margin:0"></span>`;
  $('pageIcon').style.color = m.color;
  $('btnSuggest').classList.toggle('on', suggestOpen);
  $('btnSuggest').classList.toggle('hidden', isSearching() || view !== 'myday');
}

function taskSubHTML(t) {
  const parts = [];
  const showList = isSearching() || !view.startsWith('list:') || listIdOfView() !== t.listId;
  if (showList) {
    const l = getList(t.listId);
    if (l) parts.push(`<span class="ts-part">${esc(l.name)}</span>`);
  }
  if (view !== 'myday' && t.myDay === today()) parts.push(`<span class="ts-part">${ico('sun', 'ic ic-12')} 我的一天</span>`);
  if (t.dueDate) {
    const overdue = !t.completed && t.dueDate < today();
    parts.push(`<span class="ts-part ${overdue ? 'ts-overdue' : ''}">${ico('calendar', 'ic ic-12')} ${dueLabel(t.dueDate)}到期</span>`);
  }
  if (t.remindAt && !t.completed) parts.push(`<span class="ts-part">${ico('bell', 'ic ic-12')} ${dtLabel(t.remindAt)}</span>`);
  if (t.repeat && t.repeat !== 'none') parts.push(`<span class="ts-part">${ico('repeat', 'ic ic-12')} ${REPEATS.find((r) => r.id === t.repeat).label}</span>`);
  const st = t.steps || [];
  if (st.length) parts.push(`<button class="steps-toggle" data-act="expand-steps" data-id="${t.id}" title="展开或收起步骤">${ico(expandedSteps.has(t.id) ? 'down' : 'right', 'ic ic-12')} 步骤 ${st.filter((s) => s.done).length}/${st.length}</button>`);
  if (t.note) parts.push(`<span class="ts-part">${ico('note', 'ic ic-12')} 备注</span>`);
  if (t.folder) parts.push(`<span class="ts-part">${ico('folder', 'ic ic-12')} ${esc(basename(t.folder))}</span>`);
  return parts.length ? `<div class="task-sub">${parts.join('<span class="ts-dot">·</span>')}</div>` : '';
}

function taskHTML(t) {
  return `<div class="task-item ${t.completed ? 'done' : ''} ${selectedId === t.id ? 'selected' : ''}" data-id="${t.id}" data-act="select" draggable="true">
    <button class="checkbox" data-act="toggle" data-id="${t.id}" title="${t.completed ? '标记为未完成' : '标记为已完成'}">${ico('check', 'ic')}</button>
    <div class="task-body">
      <div class="task-title" data-act="select">${esc(t.title)}</div>
      ${taskSubHTML(t)}
    </div>
    <button class="task-star ${t.important ? 'on' : ''}" data-act="star" data-id="${t.id}" title="${t.important ? '取消重要' : '标记为重要'}">${ico(t.important ? 'star-fill' : 'star', 'ic ic-18')}</button>
    <span class="task-drag">${ico('grip', 'ic ic-16')}</span>
    ${stepsBlockHTML(t)}
  </div>`;
}

function renderTasks() {
  const all = currentTasks();
  const open = sortTasks(all.filter((t) => !t.completed));
  const done = all.filter((t) => t.completed).sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
  $('taskList').innerHTML = open.map(taskHTML).join('');

  const showDone = state.settings.showCompleted;
  $('completedSection').classList.toggle('hidden', !showDone || done.length === 0);
  $('completedCount').textContent = done.length ? `(${done.length})` : '';
  $('completedChevron').innerHTML = `<use href="#i-${completedOpen ? 'down' : 'right'}"/>`;
  $('completedList').innerHTML = completedOpen ? done.map(taskHTML).join('') : '';
  $('completedList').classList.toggle('hidden', !completedOpen);

  const empty = $('emptyState');
  if (all.length === 0) {
    const meta = isSearching()
      ? { icon: 'search', title: '没有找到匹配的任务', desc: '尝试使用其他关键词，或检查任务标题、步骤和备注。' }
      : view === 'myday'
        ? { icon: 'sun', title: '专注今天', desc: '添加任务，或使用右上角灯泡从建议中挑选。' }
        : view === 'important'
          ? { icon: 'star', title: '没有重要的任务', desc: '点击任务右侧的星标，即可将它标记为重要。' }
          : view === 'planned'
            ? { icon: 'calendar', title: '暂无计划', desc: '为任务设置截止日期或提醒后，会显示在这里。' }
            : { icon: 'check-circle', title: '这里还没有任务', desc: '在上方输入框中添加第一项任务。' };
    empty.innerHTML = `<div class="empty-art">${ico(meta.icon, 'ic')}</div><div class="empty-title">${meta.title}</div><div class="empty-desc">${meta.desc}</div>`;
    empty.classList.remove('hidden');
  } else empty.classList.add('hidden');

  renderSuggest();
  renderFooter(open.length, done.length);
}

function renderSuggest() {
  const panel = $('suggestPanel');
  panel.classList.toggle('hidden', !suggestOpen || isSearching() || view !== 'myday');
  if (!suggestOpen || isSearching() || view !== 'myday') return;
  const pool = state.tasks.filter((t) => !t.completed && t.myDay !== today())
    .sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999') || a.order - b.order).slice(0, 6);
  panel.innerHTML = `<div class="sp-head">建议 · 添加到我的一天</div>` + (pool.length
    ? pool.map((t) => `<div class="sp-item"><span class="sp-title">${esc(t.title)}</span><span class="sp-add" data-act="suggest-add" data-id="${t.id}">${ico('plus', 'ic ic-14')} 添加</span></div>`).join('')
    : `<div class="sp-item" style="color:var(--text-sub)">暂时没有可建议的任务</div>`);
}

function renderFooter(openCount, doneCount) {
  const isList = !isSearching() && view.startsWith('list:');
  const l = isList ? getList(listIdOfView()) : null;
  const left = `${openCount} 项待办${doneCount ? ` · ${doneCount} 项已完成` : ''}`;
  $('mainFooter').innerHTML = `<span>${left}</span><div style="display:flex;gap:2px;align-items:center">
    <button class="footer-link" data-act="toggle-completed">${ico('eye', 'ic ic-14')} ${state.settings.showCompleted ? '隐藏已完成' : '显示已完成'}</button>
    ${isList ? `<button class="footer-link" data-act="list-menu" data-list="${l ? l.id : ''}">${ico('dots', 'ic ic-14')} 列表选项</button>` : ''}
  </div>`;
}

function renderDetail() {
  const d = $('detail');
  const t = selectedId ? getTask(selectedId) : null;
  d.classList.toggle('open', !!t);
  $('appShell').classList.toggle('detail-open', !!t);
  if (!t) { $('detailInner').innerHTML = ''; return; }
  const l = getList(t.listId);
  const steps = t.steps || [];

  const row = (field, iconName, label, value, active) => `<div class="d-row ${active ? 'active' : ''}" data-act="d-edit" data-field="${field}">
    <span class="dr-icon">${ico(iconName, 'ic ic-18')}</span><span class="dr-label">${label}</span>
    ${value ? `<span class="dr-value">${value}</span>` : ''}</div>`;

  let editorHTML = '';
  if (detailEditor === 'due') {
    editorHTML = `<div class="d-editor">
      <input type="date" data-field="due" data-act="de-date" value="${t.dueDate || ''}">
      <div class="de-preset">
        <button class="ao-chip" data-act="de-due" data-value="${today()}">今天</button>
        <button class="ao-chip" data-act="de-due" data-value="${shiftDate(1)}">明天</button>
        <button class="ao-chip" data-act="de-due" data-value="${shiftDate(7)}">下周</button>
        <button class="ao-chip" data-act="de-due" data-value="">清除</button>
      </div></div>`;
  } else if (detailEditor === 'remind') {
    editorHTML = `<div class="d-editor">
      <input type="datetime-local" data-act="de-remind" value="${t.remindAt ? toLocalInput(t.remindAt) : ''}">
      <div class="de-preset">
        <button class="ao-chip" data-act="de-remind-preset" data-value="1">1 小时后</button>
        <button class="ao-chip" data-act="de-remind-preset" data-value="tomorrow">明天 9:00</button>
        <button class="ao-chip" data-act="de-remind-preset" data-value="">清除</button>
      </div></div>`;
  } else if (detailEditor === 'repeat') {
    editorHTML = `<div class="d-editor"><select data-act="de-repeat">
      ${REPEATS.map((r) => `<option value="${r.id}" ${t.repeat === r.id ? 'selected' : ''}>${r.label}</option>`).join('')}
    </select></div>`;
  } else if (detailEditor === 'move') {
    editorHTML = `<div class="d-editor"><select data-act="de-move">
      ${state.lists.map((x) => `<option value="${x.id}" ${t.listId === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}
    </select></div>`;
  } else if (detailEditor === 'folder') {
    editorHTML = `<div class="d-editor">
      <input type="text" id="deFolderPath" value="${esc(t.folder || '')}" placeholder="文件夹路径，例如 D:\\Work">
      <div class="de-preset">
        <button class="ao-chip" data-act="de-pick-folder">浏览…</button>
        <button class="ao-chip" data-act="de-open-folder">打开</button>
        <button class="ao-chip" data-act="de-folder-save">保存</button>
        <button class="ao-chip" data-act="de-folder-clear">清除</button>
      </div></div>`;
  }

  $('detailInner').innerHTML = `
    <div class="detail-top"><span class="dt-label">任务详情</span>
      <button class="icon-btn" data-act="d-close" title="关闭">${ico('close', 'ic ic-16')}</button></div>
    <div class="detail-scroll">
      <div class="d-card">
        <div class="d-main">
          <button class="checkbox ${t.completed ? 'done' : ''}" data-act="d-toggle">${ico('check', 'ic')}</button>
          <textarea class="d-title-input" id="dTitle" rows="1" spellcheck="false">${esc(t.title)}</textarea>
          <button class="task-star ${t.important ? 'on' : ''}" data-act="d-star" title="重要">${ico(t.important ? 'star-fill' : 'star', 'ic ic-18')}</button>
        </div>
        ${row('myday', 'sun', t.myDay === today() ? '已添加到我的一天' : '添加到我的一天', '', t.myDay === today())}
        ${row('due', 'calendar', t.dueDate ? '截止日期' : '添加截止日期', t.dueDate ? dueLabel(t.dueDate) : '', !!t.dueDate)}
        ${editorHTML && ['due', 'remind', 'repeat', 'move', 'folder'].includes(detailEditor) ? `<div id="editorSlot"></div>` : ''}
        ${row('remind', 'bell', t.remindAt ? '提醒' : '提醒我', t.remindAt ? dtLabel(t.remindAt) : '', !!t.remindAt)}
        ${row('repeat', 'repeat', '重复', t.repeat !== 'none' ? REPEATS.find((r) => r.id === t.repeat).label : '', t.repeat !== 'none')}
        ${row('move', 'move', '所属列表', l ? esc(l.name) : '', false)}
        ${folderRowHTML(t)}
      </div>

      <div class="d-card">
        <div class="d-section-title" style="padding:10px 12px 0">步骤${steps.length ? ` · ${steps.filter((s) => s.done).length}/${steps.length}` : ''}</div>
        ${steps.map((s) => `<div class="step-item ${s.done ? 'done' : ''}">
          <button class="checkbox" data-act="d-step-toggle" data-sid="${s.id}">${ico('check', 'ic')}</button>
          <span class="step-text">${esc(s.title)}</span>
          <button class="step-del" data-act="d-step-del" data-sid="${s.id}" title="删除步骤">${ico('close', 'ic ic-12')}</button>
        </div>`).join('')}
        <div class="step-add">${ico('plus', 'ic ic-16')}<input id="dStepInput" type="text" placeholder="添加步骤" maxlength="200"></div>
      </div>

      <div class="d-card">
        <div class="d-section-title" style="padding:10px 12px 0">备注</div>
        <textarea class="d-note" id="dNote" placeholder="添加备注…" spellcheck="false">${esc(t.note)}</textarea>
      </div>
    </div>
    <div class="detail-bottom"><span>创建于 ${new Date(t.createdAt).toLocaleDateString('zh-CN')}</span>
      <button class="d-delete" data-act="d-delete" title="删除任务">${ico('trash', 'ic ic-18')}</button></div>`;

  // 编辑器插入到对应行的下方
  if (editorHTML) {
    const slot = $('editorSlot');
    if (slot) {
      const map = { due: 'due', remind: 'remind', repeat: 'repeat', move: 'move', folder: 'folder' };
      const rows = $('detailInner').querySelectorAll('.d-row');
      let anchor = null;
      for (const r of rows) if (r.dataset.field === map[detailEditor]) anchor = r;
      slot.remove();
      const wrap = document.createElement('div');
      wrap.innerHTML = editorHTML;
      const node = wrap.firstElementChild;
      if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(node, anchor.nextSibling);
      else $('detailInner').querySelector('.d-card').appendChild(node);
      const input = node.querySelector('input, select');
      if (input && detailEditor !== 'repeat' && detailEditor !== 'move') setTimeout(() => input.focus(), 30);
    }
  }
  const ta = $('dTitle');
  if (ta) { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; }
}

function renderAll() {
  renderSidebar(); renderHeader(); renderTasks(); renderDetail(); renderMini();
}

/* ============================ 任务操作 ============================ */
function newOrder() {
  return state.tasks.reduce((m, t) => Math.max(m, Number(t.order) || 0), 0) + 1;
}

function addTask() {
  const input = $('addInput');
  const title = input.value.trim();
  if (!title) { input.focus(); return; }
  const extra = { title, order: newOrder(), dueDate: addOpts.due, remindAt: addOpts.remind, repeat: addOpts.repeat, listId: listIdOfView() || 'inbox' };
  if (view === 'myday' && !isSearching()) extra.myDay = today();
  if (view === 'important' && !isSearching()) extra.important = true;
  if (view === 'planned' && !isSearching()) extra.dueDate = extra.dueDate || today();
  const t = mkTask(title, extra);
  state.tasks.push(t);
  input.value = '';
  $('addSubmit').classList.add('hidden');
  addOpts = { due: null, remind: null, repeat: 'none' };
  $('addOptions').classList.add('hidden');
  document.querySelectorAll('.add-tool').forEach((b) => b.classList.remove('on'));
  persist(); renderAll();
  $('addInput').focus();
}

function toggleTask(id) {
  const t = getTask(id); if (!t) return;
  t.completed = !t.completed;
  t.completedAt = t.completed ? Date.now() : null;
  t.updatedAt = Date.now();
  if (t.completed && t.repeat !== 'none') spawnRepeat(t);
  persist(); renderAll();
  showToast(t.completed ? '已完成' : '已恢复为待办');
}

function spawnRepeat(t) {
  const base = t.dueDate ? new Date(t.dueDate + 'T12:00:00') : new Date();
  if (t.repeat === 'daily') base.setDate(base.getDate() + 1);
  else if (t.repeat === 'weekly') base.setDate(base.getDate() + 7);
  else base.setMonth(base.getMonth() + 1);
  const next = mkTask(t.title, {
    listId: t.listId, important: t.important, dueDate: dateStr(base), repeat: t.repeat,
    note: t.note, steps: (t.steps || []).map((s) => ({ id: uid(), title: s.title, done: false })),
    order: newOrder(),
  });
  if (t.remindAt) {
    const r = new Date(t.remindAt);
    r.setDate(r.getDate() + (t.repeat === 'daily' ? 1 : t.repeat === 'weekly' ? 7 : 0));
    if (t.repeat === 'monthly') r.setMonth(r.getMonth() + 1);
    next.remindAt = r.toISOString();
  }
  state.tasks.push(next);
  showToast(`已完成，下一次「${REPEATS.find((x) => x.id === t.repeat).label}」任务已创建`);
}

function starTask(id) {
  const t = getTask(id); if (!t) return;
  t.important = !t.important; t.updatedAt = Date.now();
  persist(); renderAll();
}

function deleteTask(id) {
  const t = getTask(id); if (!t) return;
  showModal({
    title: '删除任务', body: `确定要删除「${esc(t.title)}」吗？此操作无法撤销。`, okText: '删除',
    onOk: () => {
      state.tasks = state.tasks.filter((x) => x.id !== id);
      if (selectedId === id) selectedId = null;
      persist(); renderAll(); showToast('任务已删除');
    },
  });
}

function updateTask(id, patch) {
  const t = getTask(id); if (!t) return;
  Object.assign(t, patch, { updatedAt: Date.now() });
  persist();
}

function reindexDragOrder(orderedIds) {
  orderedIds.forEach((id, i) => { const t = getTask(id); if (t) t.order = i; });
}

/* ============================ 列表操作 ============================ */
function openListEditor(id) {
  const editing = id ? getList(id) : null;
  listEditor = { id: id || null, color: editing ? editing.color : COLORS[Math.floor(Math.random() * COLORS.length)] };
  $('newListEditor').classList.remove('hidden');
  $('newListEditor').querySelector('.nle-title').textContent = editing ? '编辑列表' : '新建列表';
  $('newListName').value = editing ? editing.name : '';
  $('nleCreate').textContent = editing ? '保存' : '创建列表';
  $('nleColors').innerHTML = COLORS.map((c) => `<span class="nle-color ${c === listEditor.color ? 'sel' : ''}" data-act="pick-color" data-color="${c}" style="background:${c}"></span>`).join('');
  setTimeout(() => { $('newListName').focus(); $('newListName').select(); }, 30);
}

function closeListEditor() { listEditor = null; $('newListEditor').classList.add('hidden'); }

function commitListEditor() {
  const name = $('newListName').value.trim();
  if (!name) { $('newListName').focus(); return; }
  if (listEditor.id) {
    const l = getList(listEditor.id);
    if (l) { l.name = name; l.color = listEditor.color; }
  } else {
    const id = 'l_' + uid();
    state.lists.push({ id, name, color: listEditor.color, builtin: false });
    view = 'list:' + id;
  }
  closeListEditor(); persist(); renderAll();
}

function deleteList(id) {
  const l = getList(id); if (!l || l.builtin) return;
  const count = state.tasks.filter((t) => t.listId === id).length;
  showModal({
    title: '删除列表', body: `确定删除列表「${esc(l.name)}」吗？其中的 ${count} 项任务也会一并删除。`, okText: '删除列表',
    onOk: () => {
      state.tasks = state.tasks.filter((t) => t.listId !== id);
      state.lists = state.lists.filter((x) => x.id !== id);
      if (view === 'list:' + id) view = 'myday';
      selectedId = null; persist(); renderAll(); showToast('列表已删除');
    },
  });
}

/* ============================ 菜单 / 弹层 ============================ */
function showMenu(html, x, y) {
  const m = $('popMenu');
  m.innerHTML = html;
  m.classList.remove('hidden');
  const r = m.getBoundingClientRect();
  x = Math.max(8, Math.min(x, innerWidth - r.width - 8));
  y = Math.max(8, Math.min(y, innerHeight - r.height - 8));
  m.style.left = x + 'px'; m.style.top = y + 'px';
}
function menuAt(anchor, html) { const r = anchor.getBoundingClientRect(); showMenu(html, r.left, r.bottom + 4); }
function closeMenu() { $('popMenu').classList.add('hidden'); }
const pmItem = (cmd, iconName, label, value = '', extra = '') =>
  `<div class="pm-item ${extra}" data-cmd="${cmd}" data-value="${esc(value)}"><span class="pm-icon">${ico(iconName, 'ic ic-16')}</span><span class="pm-label">${label}</span></div>`;

function themeMenuHTML() {
  return `<div class="pm-head">更改主题</div><div class="theme-grid">${THEMES.map((t) =>
    `<span class="theme-swatch ${state.settings.theme === t.id ? 'sel' : ''}" title="${t.name}" data-cmd="theme" data-value="${t.id}" style="background:${t.color}"></span>`).join('')}</div>`;
}

function moreMenuHTML() {
  const sorts = [
    ['manual', '我的顺序'], ['importance', '重要性'], ['due', '截止日期'],
    ['alpha', '按字母顺序'], ['created', '创建日期'],
  ];
  return `<div class="pm-head">排序方式</div>${sorts.map(([v, n]) =>
    `<div class="pm-item" data-cmd="sort" data-value="${v}"><span class="pm-icon">${ico('sort', 'ic ic-16')}</span><span class="pm-label">${n}</span>${state.settings.sort === v ? `<span class="pm-check">${ico('check', 'ic ic-14')}</span>` : ''}</div>`).join('')}
    <div class="pm-sep"></div>
    ${pmItem('toggle-completed', 'eye', state.settings.showCompleted ? '隐藏已完成任务' : '显示已完成任务')}
    ${pmItem('clear-completed', 'check-circle', '清除已完成任务')}`;
}

function listMenuHTML(id) {
  const l = getList(id); if (!l) return '';
  return `${pmItem('rename-list', 'note', '重命名列表', id)}
    <div class="pm-head">列表颜色</div><div class="theme-grid">${COLORS.map((c) =>
      `<span class="theme-swatch ${l.color === c ? 'sel' : ''}" data-cmd="list-color" data-value="${c}" data-list="${id}" style="background:${c}"></span>`).join('')}</div>
    ${l.builtin ? '' : `<div class="pm-sep"></div>${pmItem('delete-list', 'trash', '删除此列表', id, 'danger')}`}`;
}

async function settingsMenuHTML() {
  const auto = await API.getAutoStart().catch(() => false);
  return `<div class="pm-head">设置与数据</div>
    ${pmItem('theme-menu', 'theme', '更改主题')}
    ${pmItem('toggle-mini', 'mini', miniMode ? '切换到大面板' : '切换到小面板')}
    <div class="pm-item" data-cmd="toggle-autostart"><span class="pm-icon">${ico('clock', 'ic ic-16')}</span><span class="pm-label">开机自启</span>${auto ? `<span class="pm-check">${ico('check', 'ic ic-14')}</span>` : ''}</div>
    <div class="pm-sep"></div>
    ${pmItem('export', 'export', '导出数据备份')}
    ${pmItem('import', 'import', '导入数据备份')}
    ${pmItem('about', 'info', '关于本应用')}
    <div class="pm-sep"></div>
    ${pmItem('clear-all', 'trash', '清空所有数据', '', 'danger')}`;
}

function showToast(text) {
  if (!text) return;
  const el = $('toast'); el.textContent = text; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 1900);
}

function showModal({ title, body, okText = '确定', onOk = null, info = false }) {
  $('modalTitle').textContent = title;
  $('modalBody').innerHTML = body;
  $('modalOk').textContent = okText;
  $('modalOk').className = info ? 'btn ghost' : 'btn danger';
  $('modalCancel').classList.toggle('hidden', info);
  modalOkFn = onOk;
  $('modalMask').classList.remove('hidden');
}
function closeModal() { $('modalMask').classList.add('hidden'); modalOkFn = null; }

/* ============================ 命令 ============================ */
async function handleCommand(cmd, ds) {
  const v = ds.value;
  switch (cmd) {
    case 'toggle-mini': setMiniMode(!miniMode); break;
    case 'toggle-autostart': {
      const cur = await API.getAutoStart();
      const next = await API.setAutoStart(!cur);
      showToast(next ? '已开启开机自启' : '已关闭开机自启');
      break;
    }
    case 'task-myday': {
      const t = getTask(ds.task); if (!t) break;
      updateTask(t.id, { myDay: t.myDay === today() ? null : today() });
      renderAll();
      break;
    }
    case 'task-important': starTask(ds.task); break;
    case 'task-complete': toggleTask(ds.task); break;
    case 'task-due-today': updateTask(ds.task, { dueDate: today() }); renderAll(); break;
    case 'task-due-tomorrow': updateTask(ds.task, { dueDate: shiftDate(1) }); renderAll(); break;
    case 'task-new-list': {
      const t = getTask(ds.task); if (!t) break;
      let name = (t.title || '新列表').slice(0, 40);
      if (state.lists.some((l) => l.name === name)) name = `${name} ${state.lists.length + 1}`;
      const lid = 'l_' + uid();
      state.lists.push({ id: lid, name, color: COLORS[state.lists.length % COLORS.length], builtin: false });
      updateTask(t.id, { listId: lid });
      view = 'list:' + lid;
      persist(); renderAll(); showToast(`已创建列表「${name}」`);
      break;
    }
    case 'task-move-sub':
      ctxTaskId = ds.task; ctxSub = 'move';
      showMenu(taskSubMenuHTML(ctxTaskId, 'move'), ctxXY.x, ctxXY.y);
      break;
    case 'task-copy-sub':
      ctxTaskId = ds.task; ctxSub = 'copy';
      showMenu(taskSubMenuHTML(ctxTaskId, 'copy'), ctxXY.x, ctxXY.y);
      break;
    case 'task-sub-back':
      showMenu(taskMenuHTML(ctxTaskId), ctxXY.x, ctxXY.y);
      break;
    case 'task-move':
      updateTask(ds.task, { listId: v }); persist(); renderAll(); showToast('任务已移动');
      break;
    case 'task-copy': {
      const src = getTask(ds.task); if (!src) break;
      const copy = mkTask(src.title, {
        listId: v, important: src.important, dueDate: src.dueDate, remindAt: src.remindAt,
        repeat: src.repeat, note: src.note, folder: src.folder, order: newOrder(),
        steps: (src.steps || []).map((s) => ({ id: uid(), title: s.title, done: false })),
      });
      state.tasks.push(copy);
      persist(); renderAll();
      const target = getList(v);
      showToast(`已复制到「${target ? target.name : '列表'}」`);
      break;
    }
    case 'task-delete': deleteTask(ds.task); break;
    case 'mini-view':
      view = v; selectedId = null; miniDetail = false; detailEditor = null;
      if (isSearching()) { searchText = ''; $('searchInput').value = ''; }
      renderAll();
      break;
    case 'sort':
      state.settings.sort = v; persist(); renderTasks(); showToast('排序已更新'); break;
    case 'toggle-completed':
      state.settings.showCompleted = !state.settings.showCompleted; persist(); renderTasks(); break;
    case 'clear-completed': {
      const n = state.tasks.filter((t) => t.completed).length;
      if (!n) { showToast('没有已完成的任务'); break; }
      showModal({ title: '清除已完成任务', body: `将永久删除 ${n} 项已完成的任务，无法撤销。`, okText: '清除', onOk: () => {
        const ids = state.tasks.filter((t) => t.completed).map((t) => t.id);
        state.tasks = state.tasks.filter((t) => !t.completed);
        if (ids.includes(selectedId)) selectedId = null;
        persist(); renderAll(); showToast(`已清除 ${n} 项任务`);
      } });
      break;
    }
    case 'theme':
      state.settings.theme = v; document.documentElement.dataset.theme = v; persist(); showToast('主题已更换'); break;
    case 'theme-menu':
      menuAt($('btnMore'), themeMenuHTML()); break;
    case 'settings':
      menuAt($('btnSettings'), await settingsMenuHTML()); break;
    case 'rename-list': openListEditor(v); break;
    case 'list-color': {
      const l = getList(ds.list); if (l) { l.color = v; persist(); renderAll(); }
      break;
    }
    case 'delete-list': deleteList(v); break;
    case 'export': {
      const r = await API.exportData(JSON.stringify(state, null, 2));
      showToast(r && r.ok ? `备份已导出${r.path ? '：' + r.path : ''}` : '导出已取消');
      break;
    }
    case 'import': {
      const r = await API.importData();
      if (!r || !r.ok) break;
      let parsed;
      try { parsed = normalize(JSON.parse(r.content)); } catch (_) { parsed = null; }
      if (!parsed) { showToast('导入失败：文件格式不正确'); break; }
      showModal({ title: '导入数据', body: '导入会覆盖当前所有任务与列表，确定继续吗？', okText: '导入并覆盖', onOk: () => {
        state = parsed; selectedId = null; searchText = ''; $('searchInput').value = '';
        document.documentElement.dataset.theme = state.settings.theme;
        $('appShell').classList.toggle('collapsed', !!state.settings.collapsed);
        persist(); renderAll(); showToast('数据已导入');
      } });
      break;
    }
    case 'about': {
      const info = await API.info();
      showModal({
        title: '关于 To Do · 本地版', info: true, okText: '关闭',
        body: `类Microsoft To Do的离线版任务清单,无需联网。<br>数据文件:<span style="word-break:break-all">${esc(info.dataFile)}</span>`,
      });
      break;
    }
    case 'clear-all':
      showModal({ title: '清空所有数据', body: '将删除全部任务与自定义列表，恢复到初始状态。此操作无法撤销。', okText: '清空', onOk: () => {
        state = defaultState(); state.tasks = []; state.lists = [{ id: 'inbox', name: '任务', color: '#2563c9', builtin: true }];
        selectedId = null; view = 'myday'; persist(); renderAll(); showToast('数据已清空');
      } });
      break;
  }
}

/* ============================ 交互事件 ============================ */
function handleAction(el, ev) {
  const act = el.dataset.act;
  const id = el.dataset.id;
  switch (act) {
    case 'expand-steps':
      if (expandedSteps.has(id)) expandedSteps.delete(id); else expandedSteps.add(id);
      renderTasks();
      break;
    case 'step-toggle': {
      const t = getTask(id); if (!t) break;
      const s = (t.steps || []).find((x) => x.id === el.dataset.sid);
      if (s) { s.done = !s.done; persist(); renderAll(); }
      break;
    }
    case 'd-open-folder': {
      const t = getTask(selectedId);
      if (t && t.folder) API.openFolder(t.folder).then((r) => { if (!r || !r.ok) showToast('无法打开：文件夹不存在'); });
      break;
    }
    case 'de-pick-folder':
      API.pickFolder().then((p) => {
        if (!p) return;
        updateTask(selectedId, { folder: p });
        detailEditor = null; renderAll(); showToast('工作文件夹已设置');
      });
      break;
    case 'de-open-folder': {
      const inp = $('deFolderPath');
      const t = getTask(selectedId);
      const p = (inp && inp.value.trim()) || (t && t.folder) || '';
      if (!p) { showToast('请先设置文件夹'); break; }
      API.openFolder(p).then((r) => { if (!r || !r.ok) showToast('无法打开该文件夹'); });
      break;
    }
    case 'de-folder-save': {
      const inp = $('deFolderPath');
      updateTask(selectedId, { folder: inp ? inp.value.trim() : '' });
      detailEditor = null; renderAll(); showToast('工作文件夹已保存');
      break;
    }
    case 'de-folder-clear': updateTask(selectedId, { folder: '' }); detailEditor = null; renderAll(); break;
    case 'mini-select': selectedId = id; miniDetail = true; detailEditor = null; renderAll(); break;
    case 'mini-back': miniDetail = false; renderAll(); break;
    case 'mini-toggle': toggleTask(selectedId); break;
    case 'mini-star': starTask(selectedId); break;
    case 'mini-step-toggle': {
      const t = getTask(selectedId); if (!t) break;
      const s = (t.steps || []).find((x) => x.id === el.dataset.sid);
      if (s) { s.done = !s.done; persist(); renderAll(); }
      break;
    }
    case 'mini-myday': {
      const t = getTask(selectedId); if (!t) break;
      updateTask(t.id, { myDay: t.myDay === today() ? null : today() }); renderAll();
      break;
    }
    case 'mini-folder-open': {
      const t = getTask(selectedId);
      if (!t) break;
      if (!t.folder) { showToast('请在大面板的任务详情中设置工作文件夹'); break; }
      API.openFolder(t.folder).then((r) => { if (!r || !r.ok) showToast('无法打开：文件夹不存在'); });
      break;
    }
    case 'mini-delete': deleteTask(selectedId); break;
    case 'to-mini': setMiniMode(true); break;
    case 'to-large': setMiniMode(false); break;
    case 'view':
      view = el.dataset.view; selectedId = null; detailEditor = null; suggestOpen = false;
      if (isSearching()) { searchText = ''; $('searchInput').value = ''; $('searchClear').classList.add('hidden'); }
      renderAll(); break;
    case 'select': {
      const item = el.closest('.task-item');
      if (!item) break;
      selectedId = item.dataset.id; detailEditor = null;
      // 只更新选中态与详情面板，避免重建 DOM 导致双击事件丢失
      document.querySelectorAll('.task-item.selected').forEach((x) => x.classList.remove('selected'));
      item.classList.add('selected');
      renderDetail();
      break;
    }
    case 'toggle': toggleTask(id); break;
    case 'star': starTask(id); break;
    case 'add-task': addTask(); break;
    case 'suggest-add': {
      const t = getTask(id); if (t) { t.myDay = today(); persist(); renderAll(); showToast('已添加到我的一天'); }
      break;
    }
    case 'toggle-completed':
      state.settings.showCompleted = !state.settings.showCompleted; persist(); renderTasks(); break;
    case 'completed-toggle':
      completedOpen = !completedOpen; renderTasks(); break;
    case 'list-menu': menuAt(el, listMenuHTML(el.dataset.list)); break;
    case 'pick-color':
      if (listEditor) {
        listEditor.color = el.dataset.color;
        $('nleColors').querySelectorAll('.nle-color').forEach((c) => c.classList.toggle('sel', c.dataset.color === listEditor.color));
      }
      break;
    case 'd-close': selectedId = null; detailEditor = null; renderAll(); break;
    case 'd-toggle': toggleTask(selectedId); break;
    case 'd-star': starTask(selectedId); break;
    case 'd-delete': deleteTask(selectedId); break;
    case 'd-edit': {
      const field = el.dataset.field;
      if (field === 'myday') {
        const t = getTask(selectedId);
        updateTask(selectedId, { myDay: t.myDay === today() ? null : today() });
        renderAll(); break;
      }
      detailEditor = detailEditor === field ? null : field; renderDetail(); break;
    }
    case 'd-step-toggle': {
      const t = getTask(selectedId); if (!t) break;
      const s = t.steps.find((x) => x.id === el.dataset.sid);
      if (s) { s.done = !s.done; persist(); renderAll(); }
      break;
    }
    case 'd-step-del': {
      const t = getTask(selectedId); if (!t) break;
      t.steps = t.steps.filter((x) => x.id !== el.dataset.sid); persist(); renderAll(); break;
    }
    case 'de-due': updateTask(selectedId, { dueDate: el.dataset.value || null }); detailEditor = null; renderAll(); break;
    case 'de-remind-preset': {
      let val = null;
      if (el.dataset.value === '1') val = new Date(Date.now() + 3600000).toISOString();
      else if (el.dataset.value === 'tomorrow') {
        const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); val = d.toISOString();
      }
      updateTask(selectedId, { remindAt: val, reminded: false }); detailEditor = null; renderAll(); break;
    }
    case 'de-remove': updateTask(selectedId, { [el.dataset.field]: null }); detailEditor = null; renderAll(); break;
    case 'add-tool': showAddOptions(el.dataset.add); break;
    case 'ao-due': setAddOption('due', el.dataset.value); break;
    case 'ao-remind': setAddOption('remind', el.dataset.value); break;
    case 'ao-repeat': setAddOption('repeat', el.dataset.value); break;
  }
}

function showAddOptions(kind) {
  const box = $('addOptions');
  const open = !box.classList.contains('hidden') && box.dataset.kind === kind;
  document.querySelectorAll('.add-tool').forEach((b) => b.classList.toggle('on', !open && b.dataset.add === kind));
  if (open) { box.classList.add('hidden'); return; }
  box.dataset.kind = kind;
  if (kind === 'due') {
    box.innerHTML = `<div class="ao-title">添加任务的截止日期</div><div class="ao-row">
      <button class="ao-chip ${addOpts.due === today() ? 'sel' : ''}" data-act="ao-due" data-value="${today()}">今天</button>
      <button class="ao-chip ${addOpts.due === shiftDate(1) ? 'sel' : ''}" data-act="ao-due" data-value="${shiftDate(1)}">明天</button>
      <button class="ao-chip ${addOpts.due === shiftDate(7) ? 'sel' : ''}" data-act="ao-due" data-value="${shiftDate(7)}">下周</button>
      <button class="ao-chip" data-act="ao-due" data-value="">不限</button></div>
      <input class="ao-input" type="date" data-ao="due" value="${addOpts.due || ''}" style="margin-top:8px">`;
  } else if (kind === 'remind') {
    box.innerHTML = `<div class="ao-title">添加任务的提醒（应用运行时生效）</div><div class="ao-row">
      <button class="ao-chip" data-act="ao-remind" data-value="1h">1 小时后</button>
      <button class="ao-chip" data-act="ao-remind" data-value="tomorrow">明天 9:00</button>
      <button class="ao-chip" data-act="ao-remind" data-value="none">不限</button></div>
      <input class="ao-input" type="datetime-local" data-ao="remind" value="${addOpts.remind ? toLocalInput(addOpts.remind) : ''}" style="margin-top:8px">`;
  } else {
    box.innerHTML = `<div class="ao-title">添加任务的重复规则</div><div class="ao-row">
      ${REPEATS.map((r) => `<button class="ao-chip ${addOpts.repeat === r.id ? 'sel' : ''}" data-act="ao-repeat" data-value="${r.id}">${r.label}</button>`).join('')}</div>`;
  }
  box.classList.remove('hidden');
}

function setAddOption(kind, value) {
  if (kind === 'due') addOpts.due = value || null;
  if (kind === 'remind') {
    if (value === '1h') addOpts.remind = new Date(Date.now() + 3600000).toISOString();
    else if (value === 'tomorrow') { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); addOpts.remind = d.toISOString(); }
    else addOpts.remind = null;
  }
  if (kind === 'repeat') addOpts.repeat = value;
  $('addOptions').classList.add('hidden');
  document.querySelectorAll('.add-tool').forEach((b) => b.classList.remove('on'));
  showToast('已设置，添加任务时生效');
}

function bindEvents() {
  // 统一的点击委托
  document.addEventListener('click', async (e) => {
    const menuItem = e.target.closest('#popMenu [data-cmd]');
    if (menuItem) {
      const cmd = menuItem.dataset.cmd;
      await handleCommand(cmd, menuItem.dataset);
      const keepOpen = ['theme-menu', 'settings', 'task-move-sub', 'task-copy-sub', 'task-sub-back'];
      if (!keepOpen.includes(cmd)) closeMenu();
      return;
    }
    if (!e.target.closest('#popMenu')) closeMenu();
    if (e.target.closest('#modalMask')) return;
    const el = e.target.closest('[data-act]');
    if (el) handleAction(el, e);
  });

  // 右键任务：完整任务菜单；右键列表：列表选项
  document.addEventListener('contextmenu', (e) => {
    const ti = e.target.closest('.task-item, .mini-task');
    if (ti && ti.dataset.id) {
      e.preventDefault();
      ctxTaskId = ti.dataset.id; ctxSub = null;
      ctxXY = { x: e.clientX, y: e.clientY };
      showMenu(taskMenuHTML(ctxTaskId), e.clientX, e.clientY);
      return;
    }
    const li = e.target.closest('.list-item');
    if (!li) return;
    e.preventDefault();
    showMenu(listMenuHTML(li.dataset.list), e.clientX, e.clientY);
  });

  $('searchInput').addEventListener('input', (e) => {
    searchText = e.target.value;
    $('searchClear').classList.toggle('hidden', !searchText);
    selectedId = null; renderAll();
  });
  $('searchClear').addEventListener('click', () => {
    searchText = ''; $('searchInput').value = ''; $('searchClear').classList.add('hidden'); renderAll(); $('searchInput').focus();
  });

  $('addInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addTask(); } });
  $('addPlus').addEventListener('click', addTask);
  $('addSubmit').addEventListener('click', addTask);
  $('addInput').addEventListener('input', (e) => $('addSubmit').classList.toggle('hidden', !e.target.value.trim()));

  $('btnMore').addEventListener('click', (e) => { e.stopPropagation(); menuAt($('btnMore'), moreMenuHTML()); });
  $('btnSettings').addEventListener('click', async (e) => { e.stopPropagation(); menuAt($('btnSettings'), await settingsMenuHTML()); });
  $('btnSuggest').addEventListener('click', () => { suggestOpen = !suggestOpen; renderHeader(); renderSuggest(); });
  $('btnCompletedToggle').addEventListener('click', () => { completedOpen = !completedOpen; renderTasks(); });

  $('btnNewList').addEventListener('click', () => openListEditor(null));
  $('btnNewListFoot').addEventListener('click', () => openListEditor(null));
  $('nleCancel').addEventListener('click', closeListEditor);
  $('nleCreate').addEventListener('click', commitListEditor);
  $('newListName').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') commitListEditor();
    if (e.key === 'Escape') closeListEditor();
  });

  $('modalCancel').addEventListener('click', closeModal);
  $('modalOk').addEventListener('click', () => { const fn = modalOkFn; closeModal(); if (fn) fn(); });

  // 详情面板输入
  document.addEventListener('input', (e) => {
    const el = e.target;
    if (el.id === 'dTitle' && selectedId) {
      el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px';
      updateTask(selectedId, { title: el.value });
      const card = document.querySelector(`.task-item[data-id="${selectedId}"] .task-title`);
      if (card) card.textContent = el.value;
      const h = $('pageDate'); if (h) { /* 副标题不变，避免频繁重绘 */ }
    }
    if (el.id === 'dNote' && selectedId) {
      updateTask(selectedId, { note: el.value });
    }
    if (el.id === 'miniTitleInput' && selectedId) updateTask(selectedId, { title: el.value });
    if (el.id === 'miniNote' && selectedId) updateTask(selectedId, { note: el.value });
    if (el.dataset && el.dataset.ao === 'due') {
      addOpts.due = el.value || null; showToast('已设置截止日期');
    }
    if (el.dataset && el.dataset.ao === 'remind') {
      addOpts.remind = el.value ? new Date(el.value).toISOString() : null; showToast('已设置提醒');
    }
  });
  document.addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset.act === 'de-date') { updateTask(selectedId, { dueDate: el.value || null }); detailEditor = null; renderAll(); }
    if (el.dataset.act === 'de-remind') { updateTask(selectedId, { remindAt: el.value ? new Date(el.value).toISOString() : null, reminded: false }); detailEditor = null; renderAll(); }
    if (el.dataset.act === 'de-repeat') { updateTask(selectedId, { repeat: el.value }); detailEditor = null; renderAll(); }
    if (el.dataset.act === 'de-move') { updateTask(selectedId, { listId: el.value }); detailEditor = null; renderAll(); }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.id === 'dStepInput') {
      e.preventDefault();
      const val = e.target.value.trim();
      if (!val || !selectedId) return;
      const t = getTask(selectedId);
      t.steps.push({ id: uid(), title: val, done: false });
      persist(); renderAll();
      setTimeout(() => { const i = $('dStepInput'); if (i) i.focus(); }, 20);
    }
    if (e.key === 'Escape') {
      if (!$('modalMask').classList.contains('hidden')) { closeModal(); return; }
      if (!$('popMenu').classList.contains('hidden')) { closeMenu(); return; }
      if (!$('newListEditor').classList.contains('hidden')) { closeListEditor(); return; }
      if (selectedId) { selectedId = null; detailEditor = null; renderAll(); return; }
      if (searchText) { $('searchClear').click(); }
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') { e.preventDefault(); $('addInput').focus(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); $('searchInput').focus(); }
    if (e.key === 'Delete' && selectedId && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
      deleteTask(selectedId);
    }
  });

  // 双击任务标题内联编辑
  document.addEventListener('dblclick', (e) => {
    const title = e.target.closest('.task-title');
    if (!title) return;
    const item = title.closest('.task-item');
    const t = getTask(item.dataset.id); if (!t) return;
    const input = document.createElement('input');
    input.className = 'inline-edit'; input.value = t.title; input.maxLength = 300;
    title.replaceWith(input); input.focus(); input.select();
    let done = false;
    const commit = () => {
      if (done) return; done = true;
      const v = input.value.trim();
      if (v) { updateTask(t.id, { title: v }); }
      renderAll();
    };
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') input.blur();
      if (ev.key === 'Escape') { input.value = t.title; input.blur(); }
    });
  });

  // 拖拽排序（仅“我的顺序”模式生效）
  document.addEventListener('dragstart', (e) => {
    const item = e.target.closest('.task-item');
    if (!item || state.settings.sort !== 'manual') return;
    dragId = item.dataset.id; item.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragId);
  });
  document.addEventListener('dragover', (e) => {
    const item = e.target.closest('.task-item');
    if (!item || !dragId) return;
    e.preventDefault();
    document.querySelectorAll('.drop-target').forEach((x) => x.classList.remove('drop-target'));
    if (item.dataset.id !== dragId) item.classList.add('drop-target');
  });
  document.addEventListener('drop', (e) => {
    const item = e.target.closest('.task-item');
    if (!item || !dragId) return;
    e.preventDefault();
    const ids = sortTasks(currentTasks().filter((t) => !t.completed)).map((t) => t.id);
    const from = ids.indexOf(dragId);
    const target = ids.indexOf(item.dataset.id);
    if (from >= 0 && target >= 0 && from !== target) {
      ids.splice(from, 1);
      ids.splice(target, 0, dragId);
      reindexDragOrder(ids);
      persist(); renderAll();
    }
    dragId = null;
  });
  document.addEventListener('dragend', () => {
    dragId = null;
    document.querySelectorAll('.dragging, .drop-target').forEach((x) => x.classList.remove('dragging', 'drop-target'));
  });

  // 窗口控制
  $('btnSidebar').addEventListener('click', () => {
    const collapsed = $('appShell').classList.toggle('collapsed');
    $('btnSidebar').title = collapsed ? '展开侧边栏' : '折叠侧边栏';
    state.settings.collapsed = collapsed; persist();
  });
  $('btnMini').addEventListener('click', () => setMiniMode(true));
  $('btnMin').addEventListener('click', () => API.win('min'));
  $('btnMax').addEventListener('click', () => API.win('max'));
  $('btnClose').addEventListener('click', () => API.win('close'));
  $('miniToLarge').addEventListener('click', () => setMiniMode(false));
  $('miniBack').addEventListener('click', () => { miniDetail = false; renderAll(); });
  $('miniMin').addEventListener('click', () => API.win('min'));
  $('miniClose').addEventListener('click', () => API.win('close'));
  $('miniViewMenu').addEventListener('click', (e) => { e.stopPropagation(); menuAt($('miniViewMenu'), miniViewMenuHTML()); });
  $('miniAddBtn').addEventListener('click', addMiniTask);
  $('miniAddInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addMiniTask(); } });
  API.onMaximizedChange((max) => {
    $('maxIcon').innerHTML = `<use href="#i-${max ? 'restore' : 'max'}"/>`;
    $('btnMax').title = max ? '向下还原' : '最大化';
  });
  API.onFlush(() => {
    clearTimeout(saveTimer);
    try { API.saveSync(state); } catch (_) { /* 退出时尽力保存 */ }
  });
  API.onTrayAction((action) => { if (action === 'toggle-mini') setMiniMode(!miniMode); });

  window.addEventListener('beforeunload', () => {
    clearTimeout(saveTimer);
    try { API.saveSync(state); } catch (_) { /* 退出时尽力保存 */ }
  });
}

/* ============================ 卡片步骤 / 工作文件夹 / 任务右键菜单 ============================ */
function stepsBlockHTML(t) {
  const st = t.steps || [];
  if (!st.length || !expandedSteps.has(t.id)) return '';
  return `<div class="task-steps">${st.map((s) => `<div class="task-step ${s.done ? 'done' : ''}">
    <button class="checkbox" data-act="step-toggle" data-id="${t.id}" data-sid="${s.id}" title="完成步骤">${ico('check', 'ic')}</button>
    <span class="task-step-text">${esc(s.title)}</span></div>`).join('')}</div>`;
}

function folderRowHTML(t) {
  const name = t.folder ? basename(t.folder) : '';
  return `<div class="d-row ${t.folder ? 'active' : ''}" data-field="folder" data-act="${t.folder ? 'd-open-folder' : 'd-edit'}">
    <span class="dr-icon">${ico('folder', 'ic ic-18')}</span>
    <span class="dr-label">${t.folder ? esc(name) : '设置工作文件夹'}</span>
    <span class="dr-value">${t.folder ? '点击打开' : ''}</span>
    ${t.folder ? `<button class="dr-edit" data-act="d-edit" data-field="folder" title="更改文件夹">${ico('note', 'ic ic-14')}</button>` : ''}
  </div>`;
}

function taskMenuHTML(id) {
  const t = getTask(id);
  if (!t) return '';
  const item = (cmd, icon, label, extra = '') => `<div class="pm-item ${extra}" data-cmd="${cmd}" data-task="${id}"><span class="pm-icon">${ico(icon, 'ic ic-16')}</span><span class="pm-label">${label}</span></div>`;
  const parent = (cmd, icon, label) => `<div class="pm-item" data-cmd="${cmd}" data-task="${id}"><span class="pm-icon">${ico(icon, 'ic ic-16')}</span><span class="pm-label">${label}</span><span class="pm-arrow">${ico('right', 'ic ic-14')}</span></div>`;
  return [
    item('task-myday', 'sun', t.myDay === today() ? '从“我的一天”中移除' : '添加到“我的一天”'),
    item('task-important', 'star', t.important ? '取消重要标记' : '标记为重要'),
    item('task-complete', 'check-circle', t.completed ? '标记为未完成' : '标记为已完成'),
    '<div class="pm-sep"></div>',
    item('task-due-today', 'today', '今天到期'),
    item('task-due-tomorrow', 'calendar', '明天到期'),
    '<div class="pm-sep"></div>',
    item('task-new-list', 'plus', '根据此任务创建新列表'),
    parent('task-move-sub', 'move', '将任务移动到…'),
    parent('task-copy-sub', 'copy', '将任务复制到…'),
    '<div class="pm-sep"></div>',
    item('task-delete', 'trash', '删除任务', 'danger'),
  ].join('');
}

function taskSubMenuHTML(id, kind) {
  const t = getTask(id);
  if (!t) return '';
  return `<div class="pm-item pm-back" data-cmd="task-sub-back"><span class="pm-icon">${ico('back', 'ic ic-16')}</span><span class="pm-label">返回</span></div>
    <div class="pm-head">${kind === 'move' ? '将任务移动到…' : '将任务复制到…'}</div>` +
    state.lists.map((l) => `<div class="pm-item" data-cmd="task-${kind}" data-task="${id}" data-value="${l.id}">
      <span class="pm-icon"><span class="list-dot" style="background:${esc(l.color)};margin:0"></span></span>
      <span class="pm-label">${esc(l.name)}</span>
      ${t.listId === l.id ? `<span class="pm-check">${ico('check', 'ic ic-14')}</span>` : ''}</div>`).join('');
}

/* ============================ 迷你小面板 ============================ */
function miniViewMenuHTML() {
  const row = (val, label, icon, color) => `<div class="pm-item" data-cmd="mini-view" data-value="${val}">
    <span class="pm-icon">${icon === 'dot'
      ? `<span class="list-dot" style="background:${esc(color)};margin:0"></span>`
      : ico(icon, 'ic ic-16')}</span>
    <span class="pm-label">${esc(label)}</span>
    ${view === val ? `<span class="pm-check">${ico('check', 'ic ic-14')}</span>` : ''}</div>`;
  return `<div class="pm-head">切换视图</div>` +
    SMART.map((s) => row(s.id, s.label, s.icon, '')).join('') +
    `<div class="pm-sep"></div>` +
    state.lists.map((l) => row('list:' + l.id, l.name, 'dot', l.color)).join('');
}

function miniTaskHTML(t) {
  const sub = [];
  const l = getList(t.listId);
  if (l && !view.startsWith('list:')) sub.push(l.name);
  if (t.dueDate) sub.push(dueLabel(t.dueDate) + '到期');
  if ((t.steps || []).length) sub.push(`步骤 ${t.steps.filter((s) => s.done).length}/${t.steps.length}`);
  return `<div class="mini-task ${t.completed ? 'done' : ''}" data-id="${t.id}" data-act="mini-select">
    <button class="checkbox ${t.completed ? 'done' : ''}" data-act="toggle" data-id="${t.id}" title="完成">${ico('check', 'ic')}</button>
    <div style="flex:1;min-width:0">
      <div class="mini-task-title">${esc(t.title)}</div>
      ${sub.length ? `<div class="mini-task-sub">${esc(sub.join(' · '))}</div>` : ''}
    </div>
    <button class="task-star ${t.important ? 'on' : ''}" data-act="star" data-id="${t.id}" title="重要">${ico(t.important ? 'star-fill' : 'star', 'ic ic-16')}</button>
  </div>`;
}

function renderMiniDetail() {
  const t = selectedId ? getTask(selectedId) : null;
  if (!t) return '<div class="mini-empty">任务已不存在</div>';
  const l = getList(t.listId);
  const steps = t.steps || [];
  const meta = [];
  if (l) meta.push(l.name);
  if (t.dueDate) meta.push(dueLabel(t.dueDate) + '到期');
  if (t.remindAt) meta.push(dtLabel(t.remindAt));
  return `
    <div class="mini-d-card">
      <div class="mini-d-main">
        <button class="checkbox ${t.completed ? 'done' : ''}" data-act="mini-toggle" title="完成">${ico('check', 'ic')}</button>
        <input class="mini-d-title" id="miniTitleInput" value="${esc(t.title)}" spellcheck="false">
        <button class="task-star ${t.important ? 'on' : ''}" data-act="mini-star" title="重要">${ico(t.important ? 'star-fill' : 'star', 'ic ic-18')}</button>
      </div>
      <div class="mini-d-row" data-act="mini-myday"><span class="dr-icon">${ico('sun', 'ic ic-16')}</span><span class="dr-label">${t.myDay === today() ? '已在我的一天' : '添加到我的一天'}</span></div>
      <div class="mini-d-row" data-act="mini-folder-open"><span class="dr-icon">${ico('folder', 'ic ic-16')}</span><span class="dr-label">${t.folder ? esc(basename(t.folder)) : '未设置工作文件夹'}</span><span class="dr-value">${t.folder ? '打开' : ''}</span></div>
      <div class="mini-d-row" style="cursor:default"><span class="dr-icon">${ico('calendar', 'ic ic-16')}</span><span class="dr-label">${t.dueDate ? dueLabel(t.dueDate) + '到期' : '无截止日期'}</span></div>
    </div>
    <div class="mini-d-card">
      <div class="mini-d-label">步骤 · ${steps.filter((s) => s.done).length}/${steps.length}</div>
      ${steps.map((s) => `<div class="mini-d-step ${s.done ? 'done' : ''}"><button class="checkbox" data-act="mini-step-toggle" data-sid="${s.id}">${ico('check', 'ic')}</button><span>${esc(s.title)}</span></div>`).join('')}
      ${steps.length ? '' : '<div class="mini-d-row" style="cursor:default">暂无步骤，可在大面板详情中添加</div>'}
    </div>
    <div class="mini-d-card">
      <div class="mini-d-label">备注 · ${esc(meta.join(' · ') || '无附加信息')}</div>
      <textarea class="mini-d-note" id="miniNote" placeholder="添加备注…" spellcheck="false">${esc(t.note)}</textarea>
    </div>
    <div class="mini-d-bottom"><span>创建于 ${new Date(t.createdAt).toLocaleDateString('zh-CN')}</span>
      <button class="mini-d-delete" data-act="mini-delete">删除任务</button></div>`;
}

function renderMini() {
  if (!miniMode) return;
  const m = pageMeta();
  $('miniCaption').textContent = miniDetail ? '任务详情' : 'To Do · 本地版';
  $('miniBack').classList.toggle('hidden', !miniDetail);
  $('miniListTitle').textContent = m.title;
  $('miniListSub').textContent = m.sub;
  const all = currentTasks();
  const open = sortTasks(all.filter((t) => !t.completed));
  const done = all.filter((t) => t.completed);
  $('miniList').innerHTML = [...open, ...done].map(miniTaskHTML).join('') ||
    '<div class="mini-empty">这里还没有任务<br>在上方输入框添加一项吧</div>';
  $('miniFoot').textContent = `${open.length} 项待办 · ${done.length} 项已完成`;
  $('miniDetailInner').innerHTML = miniDetail ? renderMiniDetail() : '';
  $('miniPages').classList.toggle('show-detail', miniDetail);
}

function applyMiniMode() {
  document.body.classList.toggle('mini-mode', miniMode);
  $('appShell').classList.toggle('hidden', miniMode);
  $('miniView').classList.toggle('hidden', !miniMode);
}

function setMiniMode(flag) {
  miniMode = Boolean(flag);
  state.settings.miniMode = miniMode;
  miniDetail = false;
  applyMiniMode();
  API.winMode(miniMode ? 'mini' : 'large');
  persist(); renderAll();
  showToast(miniMode ? '已切换到小面板' : '已切换到大面板');
}

function addMiniTask() {
  const inp = $('miniAddInput');
  const title = inp.value.trim();
  if (!title) { inp.focus(); return; }
  const extra = { title, order: newOrder(), listId: listIdOfView() || 'inbox' };
  if (view === 'myday' && !isSearching()) extra.myDay = today();
  if (view === 'important' && !isSearching()) extra.important = true;
  if (view === 'planned' && !isSearching()) extra.dueDate = today();
  state.tasks.push(mkTask(title, extra));
  inp.value = '';
  persist(); renderAll();
  $('miniAddInput').focus();
}

/* ============================ 提醒 ============================ */
function checkReminders() {
  const now = Date.now();
  let changed = false;
  for (const t of state.tasks) {
    if (t.completed || !t.remindAt || t.reminded) continue;
    const ts = new Date(t.remindAt).getTime();
    if (Number.isFinite(ts) && ts <= now) {
      t.reminded = true; changed = true;
      try { API.notify('To Do · 任务提醒', t.title); } catch (_) { /* 系统通知不可用时静默 */ }
    }
  }
  if (changed) { persist(); renderTasks(); }
}

/* ============================ 启动 ============================ */
async function boot() {
  const loaded = await API.load();
  state = normalize(loaded) || defaultState();
  document.documentElement.dataset.theme = state.settings.theme || 'blue';
  $('appShell').classList.toggle('collapsed', !!state.settings.collapsed);
  if (state.settings.collapsed) $('btnSidebar').title = '展开侧边栏';
  miniMode = !!state.settings.miniMode;
  applyMiniMode();
  bindEvents();
  renderAll();
  API.winMode(miniMode ? 'mini' : 'large');
  try { await API.save(state); } catch (_) { /* 只读环境下忽略 */ }
  API.isMaximized().then((m) => {
    if (m) { $('maxIcon').innerHTML = '<use href="#i-restore"/>'; $('btnMax').title = '向下还原'; }
  }).catch(() => {});
  checkReminders();
  setInterval(checkReminders, 20000);
  // 跨零点时刷新“我的一天”
  let lastDay = today();
  setInterval(() => { if (today() !== lastDay) { lastDay = today(); renderAll(); } }, 60000);
  setTimeout(() => $('addInput').focus(), 120);
}

boot();
