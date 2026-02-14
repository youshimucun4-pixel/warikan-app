/* =============================================
   ふたりの割り勘帳 — App Logic (Firebase Sync)
   ============================================= */

// ==================== Firebase 設定 ====================
// ★★★ 以下の手順で Firebase を設定してください ★★★
// 1. https://console.firebase.google.com/ にアクセス（Google アカウントでログイン）
// 2. 「プロジェクトを追加」→ 好きな名前（例: warikan）→ 作成
// 3. 左メニュー「構築」→「Firestore Database」→「データベースを作成」
// 4. ロケーション: asia-northeast1 (東京) → 「テストモードで開始」→ 作成
// 5. プロジェクト設定（左上の歯車）→「全般」タブ下の「マイアプリ」→「</>（ウェブ）」
// 6. アプリのニックネーム（例: warikan-web）→ 登録
// 7. 表示される firebaseConfig の値を下記に貼り付け
//
// 設定しない場合はオフライン（localStorage）モードで動作します
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
  { id: 'travel',  name: '旅行',   emoji: '✈️',  color: '#4A7FB5' },
  { id: 'dining',  name: '外食',   emoji: '🍽️', color: '#D4854A' },
  { id: 'rent',    name: '家賃',   emoji: '🏠',  color: '#8B6F4E' },
  { id: 'daily',   name: '日用品', emoji: '🧴',  color: '#7B8F5E' },
  { id: 'grocery', name: '食材',   emoji: '🥬',  color: '#4A8B5E' },
  { id: 'utility', name: '光熱費', emoji: '⚡',  color: '#C6993E' },
  { id: 'other',   name: 'その他', emoji: '📦',  color: '#8B8580' },
];

function getCategoryById(id) {
  return CATEGORIES.find(c => c.id === id) || CATEGORIES[CATEGORIES.length - 1];
}

// ==================== グローバル変数 ====================
const ROOM_KEY = 'warikan-room-code';
const LOCAL_KEY = 'warikan-app-data';

let roomCode = localStorage.getItem(ROOM_KEY) || '';
let appData = { users: { user1: '', user2: '' }, expenses: [] };
const _now = new Date();
let currentMonth = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, '0')}`;
let editingExpenseId = null;
let selectedCategory = 'other';
let unsubRoom = null;
let unsubExpenses = null;

// ==================== DOM ====================
const $ = id => document.getElementById(id);

const dom = {
  setupScreen: $('setup-screen'),
  mainScreen: $('main-screen'),
  // Setup steps
  stepChoice: $('step-choice'),
  stepCreate: $('step-create'),
  stepCode: $('step-code'),
  stepJoin: $('step-join'),
  stepLoading: $('step-loading'),
  stepLocal: $('step-local'),
  // Setup inputs
  user1Name: $('user1-name'),
  user2Name: $('user2-name'),
  joinCodeInput: $('join-code-input'),
  displayCode: $('display-code'),
  localUser1: $('local-user1'),
  localUser2: $('local-user2'),
  // Header
  settingsBtn: $('settings-btn'),
  syncBadge: $('sync-badge'),
  // Month nav
  prevMonth: $('prev-month'),
  nextMonth: $('next-month'),
  currentMonth: $('current-month'),
  // Ledger
  ledgerTotal: $('ledger-total'),
  ledgerUser1Name: $('ledger-user1-name'),
  ledgerUser2Name: $('ledger-user2-name'),
  ledgerUser1Paid: $('ledger-user1-paid'),
  ledgerUser2Paid: $('ledger-user2-paid'),
  settlementText: $('settlement-text'),
  // Category
  categoryBar: $('category-bar'),
  categoryLegend: $('category-legend'),
  categorySection: $('category-section'),
  // Expenses
  expenseList: $('expense-list'),
  expenseCount: $('expense-count'),
  emptyState: $('empty-state'),
  addBtn: $('add-btn'),
  // Expense modal
  expenseModal: $('expense-modal'),
  modalTitle: $('modal-title'),
  modalClose: $('modal-close'),
  expenseForm: $('expense-form'),
  expenseDesc: $('expense-desc'),
  expenseAmount: $('expense-amount'),
  expenseDate: $('expense-date'),
  deleteExpenseBtn: $('delete-expense-btn'),
  categoryGrid: $('category-grid'),
  customSplit: $('custom-split'),
  fullSplit: $('full-split'),
  splitUser1Pct: $('split-user1-pct'),
  splitUser2Pct: $('split-user2-pct'),
  splitHint: $('split-hint'),
  // Settings modal
  settingsModal: $('settings-modal'),
  settingsClose: $('settings-close'),
  settingsUser1: $('settings-user1'),
  settingsUser2: $('settings-user2'),
  settingsSave: $('settings-save'),
  settingsRoomSection: $('settings-room-section'),
  settingsRoomCode: $('settings-room-code'),
  exportBtn: $('export-btn'),
  resetBtn: $('reset-btn'),
  // Confirm
  confirmDialog: $('confirm-dialog'),
  confirmMessage: $('confirm-message'),
  confirmCancel: $('confirm-cancel'),
  confirmOk: $('confirm-ok'),
};

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

function showToast(msg) {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
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
    showToast('コピーしました');
  } catch {
    showToast(text);
  }
}

// ==================== 画面制御 ====================
function showScreen(screen) {
  dom.setupScreen.classList.add('hidden');
  dom.mainScreen.classList.add('hidden');
  screen.classList.remove('hidden');
}

function showSetupStep(step) {
  ['stepChoice', 'stepCreate', 'stepCode', 'stepJoin', 'stepLoading', 'stepLocal']
    .forEach(k => dom[k].classList.add('hidden'));
  step.classList.remove('hidden');
}

// ==================== localStorage 管理 ====================
function saveLocal() {
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(appData)); } catch {}
}

function loadLocal() {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { users: { user1: '', user2: '' }, expenses: [] };
}

// ==================== Firebase ルーム管理 ====================
async function createRoom(user1, user2) {
  const code = generateRoomCode();
  const ref = db.collection('rooms').doc(code);
  const existing = await ref.get();
  if (existing.exists) return createRoom(user1, user2); // 衝突時リトライ

  await ref.set({
    users: { user1, user2 },
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
  });

  roomCode = code;
  localStorage.setItem(ROOM_KEY, code);
  appData.users = { user1, user2 };
  return code;
}

async function joinRoom(code) {
  const upperCode = code.toUpperCase().trim();
  const snap = await db.collection('rooms').doc(upperCode).get();
  if (!snap.exists) throw new Error('この合言葉の帳簿は見つかりません');

  roomCode = upperCode;
  localStorage.setItem(ROOM_KEY, upperCode);
  appData.users = snap.data().users;
  return upperCode;
}

function startListening() {
  if (!db || !roomCode) return;

  // 既存リスナーを停止
  if (unsubRoom) unsubRoom();
  if (unsubExpenses) unsubExpenses();

  // ルーム情報（名前の変更など）をリッスン
  unsubRoom = db.collection('rooms').doc(roomCode)
    .onSnapshot(snap => {
      if (snap.exists && snap.data().users) {
        appData.users = snap.data().users;
        syncNames();
        renderSummary();
      }
    }, err => console.warn('Room listener error:', err));

  // 支出をリアルタイムでリッスン
  unsubExpenses = db.collection('rooms').doc(roomCode)
    .collection('expenses')
    .onSnapshot(snap => {
      appData.expenses = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderMonth();
    }, err => console.warn('Expenses listener error:', err));

  // 同期バッジ表示
  dom.syncBadge.classList.remove('hidden');
}

function stopListening() {
  if (unsubRoom) { unsubRoom(); unsubRoom = null; }
  if (unsubExpenses) { unsubExpenses(); unsubExpenses = null; }
  dom.syncBadge.classList.add('hidden');
}

// ==================== 初期化 ====================
async function initApp() {
  buildCategoryGrid();

  if (USE_FIREBASE && db) {
    // Firebase モード
    if (roomCode) {
      // 既にルームに接続済み → メイン画面へ
      showSetupStep(dom.stepLoading);
      try {
        const snap = await db.collection('rooms').doc(roomCode).get();
        if (snap.exists && snap.data().users) {
          appData.users = snap.data().users;
          startListening();
          showScreen(dom.mainScreen);
          syncNames();
          renderMonth();
        } else {
          // ルームが存在しない → セットアップへ
          roomCode = '';
          localStorage.removeItem(ROOM_KEY);
          showScreen(dom.setupScreen);
          showSetupStep(dom.stepChoice);
        }
      } catch {
        // オフライン時: Firestoreのキャッシュから読む
        startListening();
        showScreen(dom.mainScreen);
        syncNames();
        renderMonth();
      }
    } else {
      showScreen(dom.setupScreen);
      showSetupStep(dom.stepChoice);
    }
  } else {
    // localStorage モード
    appData = loadLocal();
    if (appData.users.user1 && appData.users.user2) {
      showScreen(dom.mainScreen);
      syncNames();
      renderMonth();
    } else {
      showScreen(dom.setupScreen);
      showSetupStep(dom.stepLocal);
    }
  }
}

// ==================== 名前の同期 ====================
function syncNames() {
  const { user1, user2 } = appData.users;
  dom.ledgerUser1Name.textContent = user1;
  dom.ledgerUser2Name.textContent = user2;
  $('payer-user1-name').textContent = user1;
  $('payer-user2-name').textContent = user2;
  $('split-user1-name').textContent = user1;
  $('split-user2-name').textContent = user2;
  $('full-user1-name').textContent = user1;
  $('full-user2-name').textContent = user2;
}

// ==================== カテゴリグリッド ====================
function buildCategoryGrid() {
  dom.categoryGrid.innerHTML = '';
  CATEGORIES.forEach(cat => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'category-chip' + (cat.id === selectedCategory ? ' active' : '');
    btn.dataset.cat = cat.id;
    btn.innerHTML = `<span class="category-chip-emoji">${cat.emoji}</span><span class="category-chip-name">${cat.name}</span>`;
    btn.addEventListener('click', () => selectCategory(cat.id));
    dom.categoryGrid.appendChild(btn);
  });
}

function selectCategory(id) {
  selectedCategory = id;
  dom.categoryGrid.querySelectorAll('.category-chip').forEach(el => {
    el.classList.toggle('active', el.dataset.cat === id);
  });
}

// ==================== 月表示 ====================
function renderMonth() {
  dom.currentMonth.textContent = fmtMonth(currentMonth);
  renderExpenses();
  renderSummary();
  renderCategoryChart();
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
  dom.ledgerTotal.textContent = yen(s.total);
  dom.ledgerUser1Paid.textContent = yen(s.u1Paid);
  dom.ledgerUser2Paid.textContent = yen(s.u2Paid);
  const { user1, user2 } = appData.users;
  if (s.total === 0) {
    dom.settlementText.innerHTML = '<span style="color:var(--ink-light)">まだ支出がありません</span>';
  } else if (s.settlement === 0) {
    dom.settlementText.innerHTML = '<span class="settlement-clear">&#10003; ぴったり清算済み</span>';
  } else if (s.settlement > 0) {
    dom.settlementText.innerHTML = `<strong>${escapeHtml(user1)}</strong> → <strong>${escapeHtml(user2)}</strong> へ <span class="settlement-amount">${yen(s.settlement)}</span>`;
  } else {
    dom.settlementText.innerHTML = `<strong>${escapeHtml(user2)}</strong> → <strong>${escapeHtml(user1)}</strong> へ <span class="settlement-amount">${yen(s.settlement)}</span>`;
  }
}

// ==================== カテゴリチャート ====================
function renderCategoryChart() {
  const exps = getMonthExpenses();
  if (exps.length === 0) { dom.categorySection.classList.add('hidden'); return; }
  dom.categorySection.classList.remove('hidden');
  const totals = {};
  let grandTotal = 0;
  exps.forEach(e => { const c = e.category || 'other'; totals[c] = (totals[c] || 0) + e.amount; grandTotal += e.amount; });
  const sorted = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  dom.categoryBar.innerHTML = '';
  sorted.forEach(([catId, amt]) => {
    const cat = getCategoryById(catId);
    const seg = document.createElement('div');
    seg.className = 'category-bar-seg';
    seg.style.width = (amt / grandTotal * 100) + '%';
    seg.style.background = cat.color;
    dom.categoryBar.appendChild(seg);
  });
  dom.categoryLegend.innerHTML = '';
  sorted.forEach(([catId, amt]) => {
    const cat = getCategoryById(catId);
    const item = document.createElement('span');
    item.className = 'category-legend-item';
    item.innerHTML = `<span class="category-dot" style="background:${cat.color}"></span>${cat.emoji} ${cat.name} <span class="category-legend-amount">${yen(amt)}</span>`;
    dom.categoryLegend.appendChild(item);
  });
}

// ==================== 支出リスト ====================
function renderExpenses() {
  const exps = getMonthExpenses();
  exps.sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.id || '').localeCompare(a.id || ''));
  dom.expenseCount.textContent = `${exps.length}件`;
  if (exps.length === 0) {
    dom.expenseList.innerHTML = '';
    dom.expenseList.appendChild(dom.emptyState);
    dom.emptyState.classList.remove('hidden');
    return;
  }
  dom.emptyState.classList.add('hidden');
  dom.expenseList.innerHTML = '';
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
    dom.expenseList.appendChild(el);
  });
}

// ==================== 支出 CRUD ====================
function openAddExpense() {
  editingExpenseId = null;
  dom.modalTitle.textContent = '支出を追加';
  dom.deleteExpenseBtn.classList.add('hidden');
  dom.expenseForm.reset();
  selectCategory('other');
  buildCategoryGrid();
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  dom.expenseDate.value = todayStr.startsWith(currentMonth) ? todayStr : currentMonth + '-01';
  document.querySelector('input[name="paid-by"][value="user1"]').checked = true;
  document.querySelector('input[name="split-type"][value="equal"]').checked = true;
  dom.splitUser1Pct.value = 50;
  dom.splitUser2Pct.value = 50;
  updateSplitVis();
  showModal(dom.expenseModal);
}

function openEditExpense(id) {
  const exp = appData.expenses.find(e => e.id === id);
  if (!exp) return;
  editingExpenseId = id;
  dom.modalTitle.textContent = '支出を編集';
  dom.deleteExpenseBtn.classList.remove('hidden');
  selectCategory(exp.category || 'other');
  buildCategoryGrid();
  dom.expenseDesc.value = exp.description;
  dom.expenseAmount.value = exp.amount;
  dom.expenseDate.value = exp.date;
  document.querySelector(`input[name="paid-by"][value="${exp.paidBy}"]`).checked = true;
  if (exp.splitUser1 === 50 && exp.splitUser2 === 50) {
    document.querySelector('input[name="split-type"][value="equal"]').checked = true;
  } else if (exp.splitUser1 === 100 || exp.splitUser2 === 100) {
    document.querySelector('input[name="split-type"][value="full"]').checked = true;
    document.querySelector(`input[name="full-payer"][value="${exp.splitUser1 === 100 ? 'user1' : 'user2'}"]`).checked = true;
  } else {
    document.querySelector('input[name="split-type"][value="custom"]').checked = true;
  }
  dom.splitUser1Pct.value = exp.splitUser1;
  dom.splitUser2Pct.value = exp.splitUser2;
  updateSplitVis();
  updateSplitHint();
  showModal(dom.expenseModal);
}

async function saveExpense() {
  const description = dom.expenseDesc.value.trim();
  const amount = parseInt(dom.expenseAmount.value, 10);
  const date = dom.expenseDate.value;
  const paidBy = document.querySelector('input[name="paid-by"]:checked').value;
  const splitType = document.querySelector('input[name="split-type"]:checked').value;

  if (!description || !amount || amount <= 0 || !date) {
    showToast('すべての項目を入力してください'); return;
  }

  let splitUser1, splitUser2;
  if (splitType === 'equal') { splitUser1 = 50; splitUser2 = 50; }
  else if (splitType === 'full') {
    const fp = document.querySelector('input[name="full-payer"]:checked').value;
    splitUser1 = fp === 'user1' ? 100 : 0;
    splitUser2 = fp === 'user2' ? 100 : 0;
  } else {
    splitUser1 = parseInt(dom.splitUser1Pct.value, 10) || 0;
    splitUser2 = parseInt(dom.splitUser2Pct.value, 10) || 0;
    if (splitUser1 + splitUser2 !== 100) {
      showToast('負担割合の合計を100%にしてください'); return;
    }
  }

  const data = { category: selectedCategory, description, amount, date, paidBy, splitUser1, splitUser2 };

  try {
    if (USE_FIREBASE && db && roomCode) {
      if (editingExpenseId) {
        await db.collection('rooms').doc(roomCode).collection('expenses').doc(editingExpenseId).set(data);
      } else {
        await db.collection('rooms').doc(roomCode).collection('expenses').add(data);
      }
      // onSnapshot が renderMonth() を自動で呼ぶ
    } else {
      // localStorage モード
      if (editingExpenseId) {
        const idx = appData.expenses.findIndex(e => e.id === editingExpenseId);
        if (idx >= 0) appData.expenses[idx] = { id: editingExpenseId, ...data };
      } else {
        appData.expenses.push({ id: uid(), ...data });
      }
      saveLocal();
      renderMonth();
    }
    hideModal(dom.expenseModal);
    showToast(editingExpenseId ? '更新しました' : '追加しました');
  } catch (e) {
    console.error('Save error:', e);
    showToast('保存に失敗しました');
  }
}

async function deleteExpense() {
  if (!editingExpenseId) return;
  showConfirm('この支出を削除しますか？', async () => {
    try {
      if (USE_FIREBASE && db && roomCode) {
        await db.collection('rooms').doc(roomCode).collection('expenses').doc(editingExpenseId).delete();
      } else {
        appData.expenses = appData.expenses.filter(e => e.id !== editingExpenseId);
        saveLocal();
        renderMonth();
      }
      hideModal(dom.expenseModal);
      showToast('削除しました');
    } catch (e) {
      console.error('Delete error:', e);
      showToast('削除に失敗しました');
    }
  });
}

// ==================== 分割タイプ ====================
function updateSplitVis() {
  const type = document.querySelector('input[name="split-type"]:checked').value;
  dom.customSplit.classList.toggle('hidden', type !== 'custom');
  dom.fullSplit.classList.toggle('hidden', type !== 'full');
}

function updateSplitHint() {
  const u1 = parseInt(dom.splitUser1Pct.value, 10) || 0;
  const u2 = parseInt(dom.splitUser2Pct.value, 10) || 0;
  const sum = u1 + u2;
  if (sum === 100) {
    dom.splitHint.textContent = `${appData.users.user1}: ${u1}%  /  ${appData.users.user2}: ${u2}%`;
    dom.splitHint.style.color = 'var(--sage)';
  } else {
    dom.splitHint.textContent = `合計 ${sum}%（100%にしてください）`;
    dom.splitHint.style.color = '#C0392B';
  }
}

// ==================== モーダル制御 ====================
function showModal(m) { m.classList.remove('hidden'); document.body.style.overflow = 'hidden'; }
function hideModal(m) { m.classList.add('hidden'); document.body.style.overflow = ''; }

let confirmCb = null;
function showConfirm(msg, onOk) {
  dom.confirmMessage.textContent = msg;
  confirmCb = onOk;
  showModal(dom.confirmDialog);
}

// ==================== 設定 ====================
function openSettings() {
  dom.settingsUser1.value = appData.users.user1;
  dom.settingsUser2.value = appData.users.user2;
  if (USE_FIREBASE && roomCode) {
    dom.settingsRoomSection.classList.remove('hidden');
    dom.settingsRoomCode.textContent = roomCode;
  } else {
    dom.settingsRoomSection.classList.add('hidden');
  }
  showModal(dom.settingsModal);
}

async function saveSettings() {
  const u1 = dom.settingsUser1.value.trim();
  const u2 = dom.settingsUser2.value.trim();
  if (!u1 || !u2) { showToast('名前を入力してください'); return; }

  try {
    if (USE_FIREBASE && db && roomCode) {
      await db.collection('rooms').doc(roomCode).update({
        users: { user1: u1, user2: u2 }
      });
      // onSnapshot が syncNames() を自動で呼ぶ
    } else {
      appData.users = { user1: u1, user2: u2 };
      saveLocal();
      syncNames();
      renderMonth();
    }
    hideModal(dom.settingsModal);
    showToast('設定を保存しました');
  } catch (e) {
    console.error('Settings save error:', e);
    showToast('保存に失敗しました');
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
  showToast('エクスポートしました');
}

function resetRoom() {
  showConfirm('この帳簿から退出しますか？\nデータはサーバーに残ります。', () => {
    stopListening();
    roomCode = '';
    localStorage.removeItem(ROOM_KEY);
    localStorage.removeItem(LOCAL_KEY);
    appData = { users: { user1: '', user2: '' }, expenses: [] };
    hideModal(dom.confirmDialog);
    hideModal(dom.settingsModal);
    showScreen(dom.setupScreen);
    if (USE_FIREBASE) {
      showSetupStep(dom.stepChoice);
    } else {
      showSetupStep(dom.stepLocal);
    }
    showToast('退出しました');
  });
}

// ==================== イベントリスナー ====================
function setupEvents() {
  // === セットアップ: Firebase モード ===
  $('btn-to-create').addEventListener('click', () => showSetupStep(dom.stepCreate));
  $('btn-to-join').addEventListener('click', () => showSetupStep(dom.stepJoin));
  $('btn-back-create').addEventListener('click', () => showSetupStep(dom.stepChoice));
  $('btn-back-join').addEventListener('click', () => showSetupStep(dom.stepChoice));

  // 帳簿をつくる
  $('btn-create-room').addEventListener('click', async () => {
    const u1 = dom.user1Name.value.trim();
    const u2 = dom.user2Name.value.trim();
    if (!u1 || !u2) { showToast('ふたりの名前を入力してください'); return; }
    showSetupStep(dom.stepLoading);
    try {
      const code = await createRoom(u1, u2);
      dom.displayCode.textContent = code;
      showSetupStep(dom.stepCode);
    } catch (e) {
      console.error(e);
      showToast('作成に失敗しました。もう一度お試しください。');
      showSetupStep(dom.stepCreate);
    }
  });

  // コピー
  $('btn-copy-code').addEventListener('click', () => copyToClipboard(roomCode));
  $('settings-copy-code').addEventListener('click', () => copyToClipboard(roomCode));

  // はじめる
  $('btn-start').addEventListener('click', () => {
    startListening();
    showScreen(dom.mainScreen);
    syncNames();
    renderMonth();
  });

  // 帳簿に参加する
  $('btn-join-room').addEventListener('click', async () => {
    const code = dom.joinCodeInput.value.trim();
    if (!code || code.length < 4) { showToast('合言葉を入力してください'); return; }
    showSetupStep(dom.stepLoading);
    try {
      await joinRoom(code);
      startListening();
      showScreen(dom.mainScreen);
      syncNames();
      renderMonth();
      showToast('帳簿に参加しました！');
    } catch (e) {
      console.error(e);
      showToast(e.message || '参加に失敗しました');
      showSetupStep(dom.stepJoin);
    }
  });

  // 合言葉入力を自動大文字化
  dom.joinCodeInput.addEventListener('input', () => {
    dom.joinCodeInput.value = dom.joinCodeInput.value.toUpperCase();
  });

  // === セットアップ: ローカルモード ===
  $('local-start-btn').addEventListener('click', () => {
    const u1 = dom.localUser1.value.trim();
    const u2 = dom.localUser2.value.trim();
    if (!u1 || !u2) { showToast('ふたりの名前を入力してください'); return; }
    appData.users = { user1: u1, user2: u2 };
    saveLocal();
    showScreen(dom.mainScreen);
    syncNames();
    renderMonth();
  });

  // === 月ナビ ===
  dom.prevMonth.addEventListener('click', () => navigateMonth(-1));
  dom.nextMonth.addEventListener('click', () => navigateMonth(1));

  // === 支出 ===
  dom.addBtn.addEventListener('click', openAddExpense);
  dom.modalClose.addEventListener('click', () => hideModal(dom.expenseModal));
  dom.expenseModal.querySelector('.modal-overlay').addEventListener('click', () => hideModal(dom.expenseModal));
  dom.expenseForm.addEventListener('submit', e => { e.preventDefault(); saveExpense(); });
  dom.deleteExpenseBtn.addEventListener('click', deleteExpense);

  // 分割タイプ
  document.querySelectorAll('input[name="split-type"]').forEach(r =>
    r.addEventListener('change', updateSplitVis)
  );
  dom.splitUser1Pct.addEventListener('input', () => {
    dom.splitUser2Pct.value = 100 - (parseInt(dom.splitUser1Pct.value, 10) || 0);
    updateSplitHint();
  });
  dom.splitUser2Pct.addEventListener('input', () => {
    dom.splitUser1Pct.value = 100 - (parseInt(dom.splitUser2Pct.value, 10) || 0);
    updateSplitHint();
  });

  // === 設定 ===
  dom.settingsBtn.addEventListener('click', openSettings);
  dom.settingsClose.addEventListener('click', () => hideModal(dom.settingsModal));
  dom.settingsModal.querySelector('.modal-overlay').addEventListener('click', () => hideModal(dom.settingsModal));
  dom.settingsSave.addEventListener('click', saveSettings);
  dom.exportBtn.addEventListener('click', exportData);
  dom.resetBtn.addEventListener('click', resetRoom);

  // === 確認 ===
  dom.confirmCancel.addEventListener('click', () => { hideModal(dom.confirmDialog); confirmCb = null; });
  dom.confirmOk.addEventListener('click', () => { hideModal(dom.confirmDialog); if (confirmCb) { confirmCb(); confirmCb = null; } });
  dom.confirmDialog.querySelector('.modal-overlay').addEventListener('click', () => { hideModal(dom.confirmDialog); confirmCb = null; });

  // ESC
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (!dom.confirmDialog.classList.contains('hidden')) { hideModal(dom.confirmDialog); confirmCb = null; }
      else if (!dom.expenseModal.classList.contains('hidden')) hideModal(dom.expenseModal);
      else if (!dom.settingsModal.classList.contains('hidden')) hideModal(dom.settingsModal);
    }
  });
}

// ==================== 起動 ====================
document.addEventListener('DOMContentLoaded', () => {
  setupEvents();
  initApp();
});
