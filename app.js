/* =============================================
   割り勘帳 — App Logic (Multi-group + Firebase)
   Multi-member support (2-4 people)
   ============================================= */

// ==================== Firebase 設定 ====================
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCOZlp4MGNOb0lxE1AHhS1Vvdg1qcXPDpA",
  authDomain: "warikan-253f7.firebaseapp.com",
  projectId: "warikan-253f7",
  storageBucket: "warikan-253f7.firebasestorage.app",
  messagingSenderId: "366544943601",
  appId: "1:366544943601:web:5a1a2119f6b26a72e2ec50"
};

// ==================== Firebase 初期化 ====================
const USE_FIREBASE = typeof firebase !== 'undefined' &&
  FIREBASE_CONFIG.projectId &&
  !FIREBASE_CONFIG.projectId.startsWith('YOUR');

let db = null;
if (USE_FIREBASE) {
  try {
    firebase.initializeApp(FIREBASE_CONFIG);
    db = firebase.firestore();
    db.enablePersistence({ synchronizeTabs: true }).catch(() => {});
  } catch (e) {
    console.error('Firebase init error:', e);
    db = null;
  }
}

// ==================== カテゴリ定義 ====================
const CATEGORIES = [
  { id: 'travel',  name: '旅行',     emoji: '✈️',   color: '#4A7FB5' },
  { id: 'dining',  name: '外食',     emoji: '🍽️', color: '#D4854A' },
  { id: 'rent',    name: '家賃',     emoji: '🏠',   color: '#8B6F4E' },
  { id: 'daily',   name: '日用品',   emoji: '🧴',   color: '#7B8F5E' },
  { id: 'grocery', name: '食材',     emoji: '🥬',   color: '#4A8B5E' },
  { id: 'utility', name: '光熱費',   emoji: '💡',   color: '#C6993E' },
  { id: 'other',   name: 'その他',   emoji: '📝',   color: '#8B8580' },
];

function getCategoryById(id) {
  return CATEGORIES.find(c => c.id === id) || CATEGORIES[CATEGORIES.length - 1];
}

// ==================== 定数・グローバル状態 ====================
const GROUPS_KEY = 'warikan-groups';
const MAX_GROUPS = 3;

let groups = [];
let currentGroupId = null;
let appData = { users: { user1: '', user2: '' }, expenses: [], groupName: '' };
const _now = new Date();
let currentMonth = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, '0')}`;
let editingExpenseId = null;
let selectedCategory = 'other';
let unsubRoom = null;
let unsubExpenses = null;
let currentTab = 'record';
let trendCategoryFilter = 'all';
let actionGroupId = null;

// ==================== DOM ====================
const $ = id => document.getElementById(id);

// ==================== ユーティリティ ====================
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function yen(n) {
  return '¥' + Math.abs(Math.round(n)).toLocaleString('ja-JP');
}

function fmtMonth(s) {
  const [y, m] = s.split('-');
  return `${y}年${parseInt(m)}月`;
}

function shiftMonth(monthStr, offset) {
  const [y, m] = monthStr.split('-').map(Number);
  const d = new Date(y, m - 1 + offset, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function escapeHtml(t) {
  const d = document.createElement('div');
  d.textContent = t;
  return d.innerHTML;
}

function showToast(msg, opts) {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const el = document.createElement('div');
  el.className = 'toast';
  if (opts && opts.category) {
    el.classList.add('toast-category');
    const cat = getCategoryById(opts.category);
    el.innerHTML = `<span class="toast-emoji">${cat.emoji}</span>${escapeHtml(msg)}`;
  } else if (opts && opts.type === 'error') {
    el.classList.add('toast-error');
    el.textContent = msg;
  } else if (opts && opts.type === 'success') {
    el.classList.add('toast-success');
    el.textContent = msg;
  } else {
    el.textContent = msg;
  }
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2500);
}

function generateRoomCode() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    showToast('コピーしました', { type: 'success' });
  } catch {
    showToast(text);
  }
}

// ==================== グループ管理 (localStorage) ====================
function loadGroups() {
  try {
    const raw = localStorage.getItem(GROUPS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return [];
}

function saveGroups() {
  try {
    localStorage.setItem(GROUPS_KEY, JSON.stringify(groups));
  } catch {}
}

function getGroupDataKey(groupId) {
  return `warikan-group-${groupId}`;
}

function loadGroupData(groupId) {
  try {
    const raw = localStorage.getItem(getGroupDataKey(groupId));
    if (raw) return JSON.parse(raw);
  } catch {}
  return { users: { user1: '', user2: '' }, expenses: [], groupName: '' };
}

function saveGroupData(groupId, data) {
  try {
    localStorage.setItem(getGroupDataKey(groupId), JSON.stringify(data));
  } catch {}
}

function getActiveGroups() {
  return groups.filter(g => !g.archived);
}

function getArchivedGroups() {
  return groups.filter(g => g.archived);
}

// ==================== 画面遷移 ====================
function showScreen(screenId) {
  ['home-screen', 'setup-screen', 'main-screen'].forEach(id => {
    $(id).classList.add('hidden');
  });
  $(screenId).classList.remove('hidden');
}

function showSetupStep(stepId) {
  ['step-choice', 'step-create', 'step-code', 'step-join', 'step-loading', 'step-local']
    .forEach(k => $(k).classList.add('hidden'));
  $(stepId).classList.remove('hidden');
}

// ==================== localStorage 保存 ====================
function saveLocal() {
  if (currentGroupId) {
    saveGroupData(currentGroupId, appData);
  }
}

// ==================== Firebase ルーム操作 ====================
async function createRoom(user1, user2) {
  const code = generateRoomCode();
  const ref = db.collection('rooms').doc(code);
  const existing = await ref.get();
  if (existing.exists) return createRoom(user1, user2);

  await ref.set({
    users: { user1, user2 },
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
  return code;
}

async function joinRoom(code) {
  const upperCode = code.toUpperCase().trim();
  const snap = await db.collection('rooms').doc(upperCode).get();
  if (!snap.exists) throw new Error('ルームが見つかりません。合言葉を確認してください');
  return { code: upperCode, users: snap.data().users };
}

function startListening() {
  if (!db || !currentGroupId) return;
  const group = groups.find(g => g.id === currentGroupId);
  if (!group || !group.roomCode) return;

  if (unsubRoom) unsubRoom();
  if (unsubExpenses) unsubExpenses();

  unsubRoom = db.collection('rooms').doc(group.roomCode)
    .onSnapshot(snap => {
      if (snap.exists && snap.data().users) {
        appData.users = snap.data().users;
        syncNames();
        renderSummary();
      }
    }, err => console.warn('Room listener error:', err));

  unsubExpenses = db.collection('rooms').doc(group.roomCode)
    .collection('expenses')
    .onSnapshot(snap => {
      appData.expenses = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      saveLocal();
      renderMonth();
    }, err => console.warn('Expenses listener error:', err));

  $('sync-badge').classList.remove('hidden');
}

function stopListening() {
  if (unsubRoom) { unsubRoom(); unsubRoom = null; }
  if (unsubExpenses) { unsubExpenses(); unsubExpenses = null; }
  $('sync-badge').classList.add('hidden');
}

// ==================== 初期化 ====================
async function initApp() {
  groups = loadGroups();
  showHomeScreen();
}

// ==================== ホーム画面 ====================
function showHomeScreen() {
  stopListening();
  currentGroupId = null;
  showScreen('home-screen');
  renderGroupList();
}

function renderGroupList() {
  const activeGroups = getActiveGroups();
  const archivedGroups = getArchivedGroups();
  const listEl = $('group-list');
  const archivedSection = $('archived-section');
  const archivedList = $('archived-list');
  const onboarding = $('onboarding');
  const addBtn = $('add-group-btn');
  const limitText = $('home-limit-text');

  if (activeGroups.length === 0 && archivedGroups.length === 0) {
    onboarding.classList.remove('hidden');
    listEl.innerHTML = '';
  } else {
    onboarding.classList.add('hidden');
    listEl.innerHTML = '';
    activeGroups.forEach((g, i) => {
      listEl.appendChild(createGroupCard(g, i, false));
    });
  }

  if (archivedGroups.length > 0) {
    archivedSection.classList.remove('hidden');
    archivedList.innerHTML = '';
    archivedGroups.forEach((g, i) => {
      archivedList.appendChild(createGroupCard(g, i, true));
    });
  } else {
    archivedSection.classList.add('hidden');
  }

  if (activeGroups.length >= MAX_GROUPS) {
    addBtn.disabled = true;
    limitText.textContent = `アクティブグループは最大${MAX_GROUPS}つまでです`;
  } else {
    addBtn.disabled = false;
    limitText.textContent = '';
  }
}

function createGroupCard(group, index, isArchived) {
  const data = loadGroupData(group.id);
  const el = document.createElement('div');
  el.className = 'group-card' + (isArchived ? ' group-card-archived' : '');
  el.style.setProperty('--item-i', index);

  const memberNames = data.users.user1 && data.users.user2
    ? `${data.users.user1} & ${data.users.user2}`
    : 'メンバー未設定';

  const syncBadge = group.roomCode
    ? '<span class="group-card-sync">同期</span>'
    : '<span class="group-card-badge">ローカル</span>';

  el.innerHTML = `
    <div class="group-card-body">
      <div class="group-card-name">${escapeHtml(group.name || 'グループ')}</div>
      <div class="group-card-members">
        ${escapeHtml(memberNames)}
        ${syncBadge}
      </div>
    </div>
    <button class="btn-icon group-card-action" data-group-id="${group.id}" title="操作">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>
    </button>
  `;

  el.querySelector('.group-card-body').addEventListener('click', () => openGroup(group.id));
  el.querySelector('.group-card-action').addEventListener('click', (e) => {
    e.stopPropagation();
    openGroupAction(group.id);
  });

  return el;
}

function openGroup(groupId) {
  currentGroupId = groupId;
  const group = groups.find(g => g.id === groupId);
  if (!group) return;

  appData = loadGroupData(groupId);
  appData.groupName = group.name || '';

  $('header-group-name').textContent = group.name || '割り勘帳';
  buildCategoryGrid();
  showScreen('main-screen');
  syncNames();
  renderMonth();

  if (USE_FIREBASE && db && group.roomCode) {
    startListening();
  }
}

// ==================== グループアクション ====================
function openGroupAction(groupId) {
  actionGroupId = groupId;
  const group = groups.find(g => g.id === groupId);
  if (!group) return;

  $('group-action-name').textContent = group.name || 'グループ操作';
  $('action-archive-label').textContent = group.archived ? 'アーカイブ解除' : 'アーカイブ';
  showModal($('group-action-modal'));
}

function renameGroup() {
  hideModal($('group-action-modal'));
  const group = groups.find(g => g.id === actionGroupId);
  if (!group) return;
  $('rename-input').value = group.name || '';
  showModal($('rename-modal'));
}

function confirmRename() {
  const newName = $('rename-input').value.trim();
  if (!newName) { showToast('グループ名を入力してください', { type: 'error' }); return; }
  const group = groups.find(g => g.id === actionGroupId);
  if (group) {
    group.name = newName;
    saveGroups();
    const data = loadGroupData(group.id);
    data.groupName = newName;
    saveGroupData(group.id, data);
  }
  hideModal($('rename-modal'));
  renderGroupList();
  showToast('名前を変更しました', { type: 'success' });
}

function archiveGroup() {
  const group = groups.find(g => g.id === actionGroupId);
  if (!group) return;
  group.archived = !group.archived;
  saveGroups();
  hideModal($('group-action-modal'));
  renderGroupList();
  showToast(group.archived ? 'アーカイブしました' : 'アーカイブを解除しました', { type: 'success' });
}

function deleteGroup() {
  hideModal($('group-action-modal'));
  showConfirm('このグループを削除しますか？\nデータは元に戻せません。', () => {
    groups = groups.filter(g => g.id !== actionGroupId);
    saveGroups();
    try { localStorage.removeItem(getGroupDataKey(actionGroupId)); } catch {}
    renderGroupList();
    showToast('削除しました', { type: 'success' });
  });
}

// ==================== セットアップ ====================
function goToSetup(hasGroups) {
  showScreen('setup-screen');
  if (USE_FIREBASE && db) {
    showSetupStep('step-choice');
    if (hasGroups) {
      $('btn-setup-back').classList.remove('hidden');
    } else {
      $('btn-setup-back').classList.add('hidden');
    }
  } else {
    showSetupStep('step-local');
    if (hasGroups) {
      $('btn-setup-back-local').classList.remove('hidden');
    } else {
      $('btn-setup-back-local').classList.add('hidden');
    }
  }
}

// ==================== 名前同期 ====================
function syncNames() {
  const { user1, user2 } = appData.users;
  const u1El = $('ledger-user1-name');
  const u2El = $('ledger-user2-name');
  if (u1El) u1El.textContent = user1 || '—';
  if (u2El) u2El.textContent = user2 || '—';
  const pu1 = $('payer-user1-name');
  const pu2 = $('payer-user2-name');
  if (pu1) pu1.textContent = user1 || 'ひとりめ';
  if (pu2) pu2.textContent = user2 || 'ふたりめ';
  const su1 = $('split-user1-name');
  const su2 = $('split-user2-name');
  if (su1) su1.textContent = user1 || 'ひとりめ';
  if (su2) su2.textContent = user2 || 'ふたりめ';
  const fu1 = $('full-user1-name');
  const fu2 = $('full-user2-name');
  if (fu1) fu1.textContent = user1 || 'ひとりめ';
  if (fu2) fu2.textContent = user2 || 'ふたりめ';
}

// ==================== カテゴリグリッド ====================
function buildCategoryGrid() {
  const grid = $('category-grid');
  if (!grid) return;
  grid.innerHTML = '';
  CATEGORIES.forEach(cat => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'category-chip' + (cat.id === selectedCategory ? ' active' : '');
    btn.dataset.cat = cat.id;
    btn.innerHTML = `<span class="category-chip-emoji">${cat.emoji}</span><span class="category-chip-name">${cat.name}</span>`;
    btn.addEventListener('click', () => selectCategory(cat.id));
    grid.appendChild(btn);
  });
}

function selectCategory(id) {
  selectedCategory = id;
  const grid = $('category-grid');
  if (!grid) return;
  grid.querySelectorAll('.category-chip').forEach(el => {
    el.classList.toggle('active', el.dataset.cat === id);
  });
}

// ==================== 月表示 ====================
function renderMonth() {
  $('current-month').textContent = fmtMonth(currentMonth);
  renderExpenses();
  renderSummary();
  renderCategoryChart();
  if (currentTab === 'analytics') {
    renderDonutChart();
    renderTrendChart();
  }
}

function navigateMonth(offset) {
  currentMonth = shiftMonth(currentMonth, offset);
  renderMonth();
}

// ==================== サマリー計算 ====================
function getMonthExpenses() {
  return appData.expenses.filter(e => e.date && e.date.startsWith(currentMonth));
}

function calcSummary() {
  const exps = getMonthExpenses();
  let total = 0, u1Paid = 0, u2Paid = 0, u1Should = 0, u2Should = 0;
  exps.forEach(e => {
    total += e.amount;
    if (e.paidBy === 'user1') u1Paid += e.amount; else u2Paid += e.amount;
    u1Should += Math.round(e.amount * e.splitUser1 / 100);
    u2Should += Math.round(e.amount * e.splitUser2 / 100);
  });
  const gap = total - (u1Should + u2Should);
  u1Should += gap;
  return { total, u1Paid, u2Paid, u1Should, u2Should, settlement: u1Should - u1Paid };
}

function renderSummary() {
  const s = calcSummary();
  $('ledger-total').textContent = yen(s.total);
  $('ledger-user1-paid').textContent = yen(s.u1Paid);
  $('ledger-user2-paid').textContent = yen(s.u2Paid);
  const { user1, user2 } = appData.users;
  const stEl = $('settlement-text');
  const actionsEl = $('settlement-actions');
  if (s.total === 0) {
    stEl.innerHTML = '<span style="color:var(--ink-light)">まだ支出がありません</span>';
    actionsEl.classList.add('hidden');
  } else if (s.settlement === 0) {
    stEl.innerHTML = '<span class="settlement-clear">&#10003; ぴったり精算済み</span>';
    actionsEl.classList.add('hidden');
  } else if (s.settlement > 0) {
    stEl.innerHTML = `<strong>${escapeHtml(user1)}</strong> が <strong>${escapeHtml(user2)}</strong> へ <span class="settlement-amount">${yen(s.settlement)}</span>`;
    actionsEl.classList.remove('hidden');
  } else {
    stEl.innerHTML = `<strong>${escapeHtml(user2)}</strong> が <strong>${escapeHtml(user1)}</strong> へ <span class="settlement-amount">${yen(s.settlement)}</span>`;
    actionsEl.classList.remove('hidden');
  }
}

// ==================== カテゴリバーチャート ====================
function renderCategoryChart() {
  const catSection = $('category-section');
  const catBar = $('category-bar');
  const catLegend = $('category-legend');
  const exps = getMonthExpenses();
  if (exps.length === 0) { catSection.classList.add('hidden'); return; }
  catSection.classList.remove('hidden');
  const totals = {};
  let grandTotal = 0;
  exps.forEach(e => { const c = e.category || 'other'; totals[c] = (totals[c] || 0) + e.amount; grandTotal += e.amount; });
  const sorted = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  catBar.innerHTML = '';
  sorted.forEach(([catId, amt]) => {
    const cat = getCategoryById(catId);
    const seg = document.createElement('div');
    seg.className = 'category-bar-seg';
    seg.style.width = (amt / grandTotal * 100) + '%';
    seg.style.background = cat.color;
    catBar.appendChild(seg);
  });
  catLegend.innerHTML = '';
  sorted.forEach(([catId, amt]) => {
    const cat = getCategoryById(catId);
    const item = document.createElement('span');
    item.className = 'category-legend-item';
    item.innerHTML = `<span class="category-dot" style="background:${cat.color}"></span>${cat.emoji} ${cat.name} <span class="category-legend-amount">${yen(amt)}</span>`;
    catLegend.appendChild(item);
  });
}

// ==================== タブ切り替え ====================
function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  $('panel-record').classList.toggle('hidden', tab !== 'record');
  $('panel-analytics').classList.toggle('hidden', tab !== 'analytics');
  if (tab === 'analytics') {
    renderDonutChart();
    buildTrendFilters();
    renderTrendChart();
  }
}

// ==================== ドーナツチャート ====================
function renderDonutChart() {
  const exps = getMonthExpenses();
  const svg = $('donut-svg');
  const legend = $('donut-legend');
  const emptyEl = $('donut-empty');
  const totalEl = $('donut-total');

  if (exps.length === 0) {
    svg.innerHTML = '';
    legend.innerHTML = '';
    totalEl.textContent = '¥0';
    emptyEl.classList.remove('hidden');
    svg.parentElement.style.display = 'none';
    return;
  }
  emptyEl.classList.add('hidden');
  svg.parentElement.style.display = '';

  const totals = {};
  let grandTotal = 0;
  exps.forEach(e => {
    const c = e.category || 'other';
    totals[c] = (totals[c] || 0) + e.amount;
    grandTotal += e.amount;
  });
  totalEl.textContent = yen(grandTotal);

  const sorted = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  const cx = 95, cy = 95, r = 70;
  const circumference = 2 * Math.PI * r;
  const strokeWidth = 26;
  const gapAngle = 1.5;
  const gapLen = (gapAngle / 360) * circumference;
  const segCount = sorted.length;
  const totalGap = segCount > 1 ? gapLen * segCount : 0;
  const availableLen = circumference - totalGap;

  let circles = '';
  let offset = 0;
  sorted.forEach(([catId, amt]) => {
    const cat = getCategoryById(catId);
    const pct = amt / grandTotal;
    const arcLen = Math.max(pct * availableLen, 2);
    circles += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none"
      stroke="${cat.color}" stroke-width="${strokeWidth}"
      stroke-dasharray="${arcLen} ${circumference}"
      stroke-dashoffset="${-offset}"
      stroke-linecap="round"
      transform="rotate(-90 ${cx} ${cy})"
      style="transition: stroke-dasharray .5s ease, stroke-dashoffset .5s ease;"/>`;
    offset += arcLen + (segCount > 1 ? gapLen : 0);
  });

  const bgCircle = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none"
    stroke="var(--cream-deep)" stroke-width="${strokeWidth}" opacity="0.5"/>`;
  svg.innerHTML = bgCircle + circles;

  legend.innerHTML = '';
  sorted.forEach(([catId, amt]) => {
    const cat = getCategoryById(catId);
    const pct = (amt / grandTotal * 100).toFixed(1);
    const item = document.createElement('div');
    item.className = 'donut-legend-item';
    item.innerHTML = `
      <span class="donut-legend-dot" style="background:${cat.color}"></span>
      <span class="donut-legend-emoji">${cat.emoji}</span>
      <span class="donut-legend-name">${cat.name}</span>
      <span class="donut-legend-pct">${pct}%</span>
      <span class="donut-legend-amount">${yen(amt)}</span>
    `;
    legend.appendChild(item);
  });
}

// ==================== トレンドチャート ====================
function buildTrendFilters() {
  const container = $('trend-filters');
  container.innerHTML = '';
  const allBtn = document.createElement('button');
  allBtn.className = 'trend-filter-btn' + (trendCategoryFilter === 'all' ? ' active' : '');
  allBtn.textContent = 'すべて';
  allBtn.addEventListener('click', () => { trendCategoryFilter = 'all'; buildTrendFilters(); renderTrendChart(); });
  container.appendChild(allBtn);

  CATEGORIES.forEach(cat => {
    const btn = document.createElement('button');
    btn.className = 'trend-filter-btn' + (trendCategoryFilter === cat.id ? ' active' : '');
    btn.textContent = cat.emoji + ' ' + cat.name;
    btn.addEventListener('click', () => { trendCategoryFilter = cat.id; buildTrendFilters(); renderTrendChart(); });
    container.appendChild(btn);
  });
}

function getTrendData() {
  const months = [];
  for (let i = 5; i >= 0; i--) {
    months.push(shiftMonth(currentMonth, -i));
  }

  return months.map(m => {
    const mExps = appData.expenses.filter(e => e.date && e.date.startsWith(m));
    let total = 0;
    const catTotals = {};

    mExps.forEach(e => {
      const catId = e.category || 'other';
      const matchFilter = trendCategoryFilter === 'all' || catId === trendCategoryFilter;
      if (matchFilter) {
        total += e.amount;
        catTotals[catId] = (catTotals[catId] || 0) + e.amount;
      }
    });

    const [, mm] = m.split('-');
    return { month: m, label: parseInt(mm) + '月', total, catTotals };
  });
}

function renderTrendChart() {
  const container = $('trend-chart');
  const data = getTrendData();
  const maxTotal = Math.max(...data.map(d => d.total), 1);

  container.innerHTML = '';
  data.forEach((d, i) => {
    const col = document.createElement('div');
    col.className = 'trend-col';

    const barWrap = document.createElement('div');
    barWrap.className = 'trend-bar-wrap';

    if (d.total > 0) {
      if (trendCategoryFilter === 'all') {
        const sorted = Object.entries(d.catTotals).sort((a, b) => b[1] - a[1]);
        sorted.forEach(([catId, amt]) => {
          const cat = getCategoryById(catId);
          const seg = document.createElement('div');
          seg.className = 'trend-bar-seg';
          seg.style.height = (amt / maxTotal * 100) + '%';
          seg.style.background = cat.color;
          barWrap.appendChild(seg);
        });
      } else {
        const cat = getCategoryById(trendCategoryFilter);
        const seg = document.createElement('div');
        seg.className = 'trend-bar-seg';
        seg.style.height = (d.total / maxTotal * 100) + '%';
        seg.style.background = cat.color;
        barWrap.appendChild(seg);
      }

      const amtLabel = document.createElement('span');
      amtLabel.className = 'trend-bar-amount';
      amtLabel.textContent = d.total >= 10000 ? Math.round(d.total / 10000) + '万' : yen(d.total);
      col.appendChild(amtLabel);
    }

    col.appendChild(barWrap);

    const label = document.createElement('span');
    label.className = 'trend-label';
    label.textContent = d.label;
    if (d.month === currentMonth) label.classList.add('trend-label-current');
    col.appendChild(label);

    col.style.setProperty('--bar-i', i);
    container.appendChild(col);
  });
}

// ==================== 支出リスト ====================
function renderExpenses() {
  const exps = getMonthExpenses();
  exps.sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.id || '').localeCompare(a.id || ''));
  $('expense-count').textContent = `${exps.length}件`;
  const listEl = $('expense-list');
  const emptyState = $('empty-state');
  if (exps.length === 0) {
    listEl.innerHTML = '';
    listEl.appendChild(emptyState);
    emptyState.classList.remove('hidden');
    return;
  }
  emptyState.classList.add('hidden');
  listEl.innerHTML = '';
  exps.forEach((exp, i) => {
    const cat = getCategoryById(exp.category || 'other');
    const payerName = exp.paidBy === 'user1' ? appData.users.user1 : appData.users.user2;
    const payerColor = exp.paidBy === 'user1' ? 'var(--terracotta)' : 'var(--slate)';
    const dateStr = (exp.date || '').slice(5).replace('-', '/');
    let splitLabel = '';
    if (exp.splitUser1 === 50 && exp.splitUser2 === 50) splitLabel = '50:50';
    else if (exp.splitUser1 === 100) splitLabel = `${appData.users.user1}負担`;
    else if (exp.splitUser2 === 100) splitLabel = `${appData.users.user2}負担`;
    else splitLabel = `${exp.splitUser1}:${exp.splitUser2}`;

    const el = document.createElement('div');
    el.className = 'expense-item';
    el.style.setProperty('--item-i', i);
    el.style.borderLeftColor = cat.color;
    el.innerHTML = `
      <div class="expense-cat-icon" style="background:${cat.color}18">${cat.emoji}</div>
      <div class="expense-body">
        <div class="expense-title">${escapeHtml(exp.description)}</div>
        <div class="expense-meta">
          <span>${dateStr}</span>
          <span class="expense-meta-divider"></span>
          <span class="expense-payer-dot" style="background:${payerColor}"></span>
          <span>${escapeHtml(payerName)}</span>
          <span class="expense-split-tag">${splitLabel}</span>
        </div>
      </div>
      <div class="expense-amount">${yen(exp.amount)}</div>
    `;
    el.addEventListener('click', () => openEditExpense(exp.id));
    listEl.appendChild(el);
  });
}

// ==================== 支出 CRUD ====================
function clearFormErrors() {
  ['error-desc', 'error-amount', 'error-date', 'error-split'].forEach(id => {
    const el = $(id);
    if (el) { el.textContent = ''; el.classList.add('hidden'); }
  });
  $('expense-desc').classList.remove('input-error');
  $('expense-amount').classList.remove('input-error');
  $('expense-date').classList.remove('input-error');
}

function showFieldError(fieldId, errorId, msg) {
  const field = $(fieldId);
  const error = $(errorId);
  if (field) field.classList.add('input-error');
  if (error) { error.textContent = msg; error.classList.remove('hidden'); }
}

function openAddExpense() {
  editingExpenseId = null;
  $('modal-title').textContent = '支出を追加';
  $('delete-expense-btn').classList.add('hidden');
  $('expense-form').reset();
  clearFormErrors();
  selectCategory('other');
  buildCategoryGrid();
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  $('expense-date').value = todayStr.startsWith(currentMonth) ? todayStr : currentMonth + '-01';
  document.querySelector('input[name="paid-by"][value="user1"]').checked = true;
  document.querySelector('input[name="split-type"][value="equal"]').checked = true;
  $('split-user1-pct').value = 50;
  $('split-user2-pct').value = 50;
  updateSplitVis();
  showModal($('expense-modal'));
}

function openEditExpense(id) {
  const exp = appData.expenses.find(e => e.id === id);
  if (!exp) return;
  editingExpenseId = id;
  $('modal-title').textContent = '支出を編集';
  $('delete-expense-btn').classList.remove('hidden');
  clearFormErrors();
  selectCategory(exp.category || 'other');
  buildCategoryGrid();
  $('expense-desc').value = exp.description;
  $('expense-amount').value = exp.amount;
  $('expense-date').value = exp.date;
  document.querySelector(`input[name="paid-by"][value="${exp.paidBy}"]`).checked = true;
  if (exp.splitUser1 === 50 && exp.splitUser2 === 50) {
    document.querySelector('input[name="split-type"][value="equal"]').checked = true;
  } else if (exp.splitUser1 === 100 || exp.splitUser2 === 100) {
    document.querySelector('input[name="split-type"][value="full"]').checked = true;
    document.querySelector(`input[name="full-payer"][value="${exp.splitUser1 === 100 ? 'user1' : 'user2'}"]`).checked = true;
  } else {
    document.querySelector('input[name="split-type"][value="custom"]').checked = true;
  }
  $('split-user1-pct').value = exp.splitUser1;
  $('split-user2-pct').value = exp.splitUser2;
  updateSplitVis();
  updateSplitHint();
  showModal($('expense-modal'));
}

async function saveExpense() {
  clearFormErrors();
  const description = $('expense-desc').value.trim();
  const amount = parseInt($('expense-amount').value, 10);
  const date = $('expense-date').value;
  const paidBy = document.querySelector('input[name="paid-by"]:checked').value;
  const splitType = document.querySelector('input[name="split-type"]:checked').value;

  let hasError = false;
  if (!description) { showFieldError('expense-desc', 'error-desc', '内容を入力してください'); hasError = true; }
  if (!amount || amount <= 0) { showFieldError('expense-amount', 'error-amount', '正しい金額を入力してください'); hasError = true; }
  if (!date) { showFieldError('expense-date', 'error-date', '日付を選択してください'); hasError = true; }
  if (hasError) return;

  let splitUser1, splitUser2;
  if (splitType === 'equal') { splitUser1 = 50; splitUser2 = 50; }
  else if (splitType === 'full') {
    const fp = document.querySelector('input[name="full-payer"]:checked').value;
    splitUser1 = fp === 'user1' ? 100 : 0;
    splitUser2 = fp === 'user2' ? 100 : 0;
  } else {
    splitUser1 = parseInt($('split-user1-pct').value, 10) || 0;
    splitUser2 = parseInt($('split-user2-pct').value, 10) || 0;
    if (splitUser1 + splitUser2 !== 100) {
      showFieldError('split-user1-pct', 'error-split', '合計が100%になるようにしてください');
      return;
    }
  }

  const data = { category: selectedCategory, description, amount, date, paidBy, splitUser1, splitUser2 };

  try {
    const group = groups.find(g => g.id === currentGroupId);
    if (USE_FIREBASE && db && group && group.roomCode) {
      if (editingExpenseId) {
        await db.collection('rooms').doc(group.roomCode).collection('expenses').doc(editingExpenseId).set(data);
      } else {
        await db.collection('rooms').doc(group.roomCode).collection('expenses').add(data);
      }
    } else {
      if (editingExpenseId) {
        const idx = appData.expenses.findIndex(e => e.id === editingExpenseId);
        if (idx >= 0) appData.expenses[idx] = { id: editingExpenseId, ...data };
      } else {
        appData.expenses.push({ id: uid(), ...data });
      }
      saveLocal();
      renderMonth();
    }
    hideModal($('expense-modal'));
    const cat = getCategoryById(selectedCategory);
    showToast(editingExpenseId ? '更新しました' : '追加しました', { category: selectedCategory, type: 'success' });
  } catch (e) {
    console.error('Save error:', e);
    showToast('保存に失敗しました', { type: 'error' });
  }
}

async function deleteExpense() {
  if (!editingExpenseId) return;
  showConfirm('この支出を削除しますか？', async () => {
    try {
      const group = groups.find(g => g.id === currentGroupId);
      if (USE_FIREBASE && db && group && group.roomCode) {
        await db.collection('rooms').doc(group.roomCode).collection('expenses').doc(editingExpenseId).delete();
      } else {
        appData.expenses = appData.expenses.filter(e => e.id !== editingExpenseId);
        saveLocal();
        renderMonth();
      }
      hideModal($('expense-modal'));
      showToast('削除しました', { type: 'success' });
    } catch (e) {
      console.error('Delete error:', e);
      showToast('削除に失敗しました', { type: 'error' });
    }
  });
}

// ==================== 割合表示切替 ====================
function updateSplitVis() {
  const type = document.querySelector('input[name="split-type"]:checked').value;
  $('custom-split').classList.toggle('hidden', type !== 'custom');
  $('full-split').classList.toggle('hidden', type !== 'full');
}

function updateSplitHint() {
  const u1 = parseInt($('split-user1-pct').value, 10) || 0;
  const u2 = parseInt($('split-user2-pct').value, 10) || 0;
  const sum = u1 + u2;
  const hint = $('split-hint');
  if (sum === 100) {
    hint.textContent = `${appData.users.user1}: ${u1}%  /  ${appData.users.user2}: ${u2}%`;
    hint.style.color = 'var(--sage)';
  } else {
    hint.textContent = `合計 ${sum}%（100%にしてください）`;
    hint.style.color = '#C0392B';
  }
}

// ==================== モーダル表示 ====================
function showModal(m) { m.classList.remove('hidden'); document.body.style.overflow = 'hidden'; }
function hideModal(m) { m.classList.add('hidden'); document.body.style.overflow = ''; }

let confirmCb = null;
function showConfirm(msg, onOk) {
  $('confirm-message').textContent = msg;
  confirmCb = onOk;
  showModal($('confirm-dialog'));
}

// ==================== 設定 ====================
function openSettings() {
  $('settings-user1').value = appData.users.user1;
  $('settings-user2').value = appData.users.user2;
  const sgn = $('settings-group-name');
  if (sgn) sgn.value = appData.groupName || '';
  const group = groups.find(g => g.id === currentGroupId);
  if (USE_FIREBASE && group && group.roomCode) {
    $('settings-room-section').classList.remove('hidden');
    $('settings-room-code').textContent = group.roomCode;
  } else {
    $('settings-room-section').classList.add('hidden');
  }
  showModal($('settings-modal'));
}

async function saveSettings() {
  const u1 = $('settings-user1').value.trim();
  const u2 = $('settings-user2').value.trim();
  const gn = $('settings-group-name') ? $('settings-group-name').value.trim() : '';
  if (!u1 || !u2) { showToast('名前を入力してください', { type: 'error' }); return; }

  try {
    const group = groups.find(g => g.id === currentGroupId);
    if (USE_FIREBASE && db && group && group.roomCode) {
      await db.collection('rooms').doc(group.roomCode).update({
        users: { user1: u1, user2: u2 }
      });
    } else {
      appData.users = { user1: u1, user2: u2 };
      saveLocal();
      syncNames();
      renderMonth();
    }
    if (gn && group) {
      group.name = gn;
      appData.groupName = gn;
      saveGroups();
      saveLocal();
      $('header-group-name').textContent = gn;
    }
    hideModal($('settings-modal'));
    showToast('設定を保存しました', { type: 'success' });
  } catch (e) {
    console.error('Settings save error:', e);
    showToast('保存に失敗しました', { type: 'error' });
  }
}

function exportData() {
  const blob = new Blob([JSON.stringify(appData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `warikan-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('エクスポートしました', { type: 'success' });
}

function resetRoom() {
  showConfirm('このグループから退出しますか？\nローカルデータは削除されます。', () => {
    stopListening();
    if (currentGroupId) {
      try { localStorage.removeItem(getGroupDataKey(currentGroupId)); } catch {}
      groups = groups.filter(g => g.id !== currentGroupId);
      saveGroups();
    }
    currentGroupId = null;
    appData = { users: { user1: '', user2: '' }, expenses: [], groupName: '' };
    hideModal($('confirm-dialog'));
    hideModal($('settings-modal'));
    showHomeScreen();
    showToast('退出しました', { type: 'success' });
  });
}

// ==================== ワンタップ清算 & LINE共有 ====================
function getSettlementText() {
  const s = calcSummary();
  const { user1, user2 } = appData.users;
  if (s.total === 0) return '';
  if (s.settlement === 0) return `${fmtMonth(currentMonth)}の清算：精算済み ✓`;
  const from = s.settlement > 0 ? user1 : user2;
  const to = s.settlement > 0 ? user2 : user1;
  return `${fmtMonth(currentMonth)}の清算\n${from} → ${to}: ${yen(s.settlement)}\n合計: ${yen(s.total)}`;
}

function shareByLINE() {
  const text = getSettlementText();
  if (!text) { showToast('清算情報がありません'); return; }
  const url = `https://line.me/R/share?text=${encodeURIComponent(text)}`;
  window.open(url, '_blank');
}

// ==================== イベントリスナー ====================
function setupEvents() {
  // === ホーム画面 ===
  $('add-group-btn').addEventListener('click', () => {
    if (getActiveGroups().length >= MAX_GROUPS) {
      showToast(`グループは最大${MAX_GROUPS}つまでです`, { type: 'error' });
      return;
    }
    goToSetup(groups.length > 0);
  });

  $('onboard-start-btn').addEventListener('click', () => {
    goToSetup(false);
  });

  $('toggle-archived').addEventListener('click', () => {
    const list = $('archived-list');
    const icon = $('archived-toggle-icon');
    const isHidden = list.classList.contains('hidden');
    list.classList.toggle('hidden');
    icon.textContent = isHidden ? '▾' : '▸';
  });

  $('back-to-home').addEventListener('click', () => {
    stopListening();
    showHomeScreen();
  });

  // === セットアップ: Firebase モード ===
  $('btn-to-create').addEventListener('click', () => showSetupStep('step-create'));
  $('btn-to-join').addEventListener('click', () => showSetupStep('step-join'));
  $('btn-back-create').addEventListener('click', () => showSetupStep('step-choice'));
  $('btn-back-join').addEventListener('click', () => showSetupStep('step-choice'));
  $('btn-setup-back').addEventListener('click', () => showHomeScreen());
  $('btn-setup-back-local').addEventListener('click', () => showHomeScreen());

  // ルーム作成
  $('btn-create-room').addEventListener('click', async () => {
    const groupName = $('group-name-input').value.trim() || 'グループ';
    const u1 = $('user1-name').value.trim();
    const u2 = $('user2-name').value.trim();
    if (!u1 || !u2) { showToast('ふたりの名前を入力してください', { type: 'error' }); return; }
    showSetupStep('step-loading');
    try {
      const code = await createRoom(u1, u2);
      const groupId = uid();
      const newGroup = { id: groupId, name: groupName, roomCode: code, archived: false, createdAt: Date.now() };
      groups.push(newGroup);
      saveGroups();
      const gData = { users: { user1: u1, user2: u2 }, expenses: [], groupName: groupName };
      saveGroupData(groupId, gData);

      currentGroupId = groupId;
      appData = gData;
      $('display-code').textContent = code;
      showSetupStep('step-code');
    } catch (e) {
      console.error(e);
      showToast('作成に失敗しました。ネットワークを確認してください', { type: 'error' });
      showSetupStep('step-create');
    }
  });

  // コピー
  $('btn-copy-code').addEventListener('click', () => {
    const group = groups.find(g => g.id === currentGroupId);
    if (group) copyToClipboard(group.roomCode);
  });
  $('settings-copy-code').addEventListener('click', () => {
    const group = groups.find(g => g.id === currentGroupId);
    if (group) copyToClipboard(group.roomCode);
  });

  // はじめる
  $('btn-start').addEventListener('click', () => {
    openGroup(currentGroupId);
  });

  // ルームに参加
  $('btn-join-room').addEventListener('click', async () => {
    const groupName = $('join-group-name') ? $('join-group-name').value.trim() : '';
    const code = $('join-code-input').value.trim();
    if (!code || code.length < 4) { showToast('合言葉を入力してください', { type: 'error' }); return; }
    showSetupStep('step-loading');
    try {
      const result = await joinRoom(code);
      const groupId = uid();
      const newGroup = { id: groupId, name: groupName || 'グループ', roomCode: result.code, archived: false, createdAt: Date.now() };
      groups.push(newGroup);
      saveGroups();
      const gData = { users: result.users, expenses: [], groupName: groupName || 'グループ' };
      saveGroupData(groupId, gData);

      currentGroupId = groupId;
      appData = gData;
      openGroup(groupId);
      showToast('参加しました！', { type: 'success' });
    } catch (e) {
      console.error(e);
      showToast(e.message || '参加に失敗しました', { type: 'error' });
      showSetupStep('step-join');
    }
  });

  // 合言葉自動大文字変換
  $('join-code-input').addEventListener('input', () => {
    $('join-code-input').value = $('join-code-input').value.toUpperCase();
  });

  // === セットアップ: ローカルモード ===
  $('local-start-btn').addEventListener('click', () => {
    const groupName = $('local-group-name') ? $('local-group-name').value.trim() : '';
    const u1 = $('local-user1').value.trim();
    const u2 = $('local-user2').value.trim();
    if (!u1 || !u2) { showToast('ふたりの名前を入力してください', { type: 'error' }); return; }

    const groupId = uid();
    const newGroup = { id: groupId, name: groupName || 'グループ', roomCode: '', archived: false, createdAt: Date.now() };
    groups.push(newGroup);
    saveGroups();
    const gData = { users: { user1: u1, user2: u2 }, expenses: [], groupName: groupName || 'グループ' };
    saveGroupData(groupId, gData);

    currentGroupId = groupId;
    appData = gData;
    openGroup(groupId);
  });

  // === タブ ===
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // === 月ナビ ===
  $('prev-month').addEventListener('click', () => navigateMonth(-1));
  $('next-month').addEventListener('click', () => navigateMonth(1));

  // === 支出 ===
  $('add-btn').addEventListener('click', openAddExpense);
  $('modal-close').addEventListener('click', () => hideModal($('expense-modal')));
  $('expense-modal').querySelector('.modal-overlay').addEventListener('click', () => hideModal($('expense-modal')));
  $('expense-form').addEventListener('submit', e => { e.preventDefault(); saveExpense(); });
  $('delete-expense-btn').addEventListener('click', deleteExpense);

  // 割合切替
  document.querySelectorAll('input[name="split-type"]').forEach(r =>
    r.addEventListener('change', updateSplitVis)
  );
  $('split-user1-pct').addEventListener('input', () => {
    $('split-user2-pct').value = 100 - (parseInt($('split-user1-pct').value, 10) || 0);
    updateSplitHint();
  });
  $('split-user2-pct').addEventListener('input', () => {
    $('split-user1-pct').value = 100 - (parseInt($('split-user2-pct').value, 10) || 0);
    updateSplitHint();
  });

  // === LINE共有 ===
  $('btn-line-share').addEventListener('click', shareByLINE);

  // === 設定 ===
  $('settings-btn').addEventListener('click', openSettings);
  $('settings-close').addEventListener('click', () => hideModal($('settings-modal')));
  $('settings-modal').querySelector('.modal-overlay').addEventListener('click', () => hideModal($('settings-modal')));
  $('settings-save').addEventListener('click', saveSettings);
  $('export-btn').addEventListener('click', exportData);
  $('reset-btn').addEventListener('click', resetRoom);

  // === グループアクション ===
  $('group-action-close').addEventListener('click', () => hideModal($('group-action-modal')));
  $('group-action-modal').querySelector('.modal-overlay').addEventListener('click', () => hideModal($('group-action-modal')));
  $('action-rename').addEventListener('click', renameGroup);
  $('action-archive').addEventListener('click', archiveGroup);
  $('action-delete').addEventListener('click', deleteGroup);

  // === リネーム ===
  $('rename-cancel').addEventListener('click', () => hideModal($('rename-modal')));
  $('rename-ok').addEventListener('click', confirmRename);
  $('rename-modal').querySelector('.modal-overlay').addEventListener('click', () => hideModal($('rename-modal')));

  // === 確認 ===
  $('confirm-cancel').addEventListener('click', () => { hideModal($('confirm-dialog')); confirmCb = null; });
  $('confirm-ok').addEventListener('click', () => { hideModal($('confirm-dialog')); if (confirmCb) { confirmCb(); confirmCb = null; } });
  $('confirm-dialog').querySelector('.modal-overlay').addEventListener('click', () => { hideModal($('confirm-dialog')); confirmCb = null; });

  // ESC
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (!$('confirm-dialog').classList.contains('hidden')) { hideModal($('confirm-dialog')); confirmCb = null; }
      else if (!$('rename-modal').classList.contains('hidden')) hideModal($('rename-modal'));
      else if (!$('group-action-modal').classList.contains('hidden')) hideModal($('group-action-modal'));
      else if (!$('expense-modal').classList.contains('hidden')) hideModal($('expense-modal'));
      else if (!$('settings-modal').classList.contains('hidden')) hideModal($('settings-modal'));
    }
  });
}

// ==================== 起動 ====================
document.addEventListener('DOMContentLoaded', () => {
  setupEvents();
  initApp();
});
