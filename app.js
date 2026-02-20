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
let auth = null;
let currentAuthUser = null;

if (USE_FIREBASE) {
  try {
    firebase.initializeApp(FIREBASE_CONFIG);
    db = firebase.firestore();
    db.enablePersistence({ synchronizeTabs: true }).catch(() => {});
    auth = firebase.auth();
    auth.onAuthStateChanged(async user => {
      try {
        currentAuthUser = user;
        updateAuthUI();
        if (document.readyState === 'loading') {
          pendingScreenId = user ? 'home-screen' : 'start-screen';
          return;
        }
        // ログイン済みならホーム画面へ、未ログインなら最初の画面（登録から）へ
        if (user) {
          if (pendingInviteToken) {
            await startInviteJoinFlow(pendingInviteToken);
            return;
          }
          showHomeScreen();
        } else {
          showStartScreen();
        }
        ensureVisibleScreen();
      } catch (e) {
        console.error('Auth state handler error:', e);
        showStartScreen();
        ensureVisibleScreen();
      }
    });
  } catch (e) {
    console.error('Firebase init error:', e);
    db = null;
    auth = null;
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
const INVITE_TTL_MS = 10 * 60 * 1000;

let groups = [];
let currentGroupId = null;
let appData = { users: { user1: '', user2: '' }, members: [], expenses: [], groupName: '' };
const _now = new Date();
let currentMonth = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, '0')}`;
let editingExpenseId = null;
let selectedCategory = 'other';
let unsubRoom = null;
let unsubExpenses = null;
let currentTab = 'record';
let trendCategoryFilter = 'all';
let actionGroupId = null;
let pendingMode = 'pair'; // 'solo' | 'pair' — セットアップ中の選択を保持
let pendingInviteToken = null;
let pendingScreenId = null;

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

function generateInviteToken() {
  const bytes = new Uint8Array(16);
  if (window.crypto && window.crypto.getRandomValues) {
    window.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function getInviteTokenFromUrl() {
  const params = new URLSearchParams(window.location.search || '');
  return params.get('invite') || '';
}

function clearInviteTokenFromUrl() {
  const url = new URL(window.location.href);
  url.searchParams.delete('invite');
  history.replaceState(null, '', url.pathname + (url.search ? url.search : '') + (url.hash || ''));
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    showToast('コピーしました', { type: 'success' });
  } catch {
    showToast(text);
  }
}

// ==================== ソロモード判定 ====================
function isSoloMode(groupId) {
  const gid = groupId || currentGroupId;
  if (!gid) return false;
  const group = groups.find(g => g.id === gid);
  return group && group.mode === 'solo';
}

function isGroupMode(groupId) {
  const gid = groupId || currentGroupId;
  if (!gid) return false;
  const group = groups.find(g => g.id === gid);
  return group && group.mode === 'group';
}

// ==================== グループモード: 清算計算 ====================
function calcGroupSummary() {
  const exps = getMonthExpenses();
  const members = appData.members || [];
  const paid = {};
  const owed = {};
  let total = 0;
  members.forEach(m => { paid[m.id] = 0; owed[m.id] = 0; });
  exps.forEach(e => {
    total += e.amount;
    paid[e.paidBy] = (paid[e.paidBy] || 0) + e.amount;
    if (e.splits) {
      Object.entries(e.splits).forEach(([mid, amt]) => {
        owed[mid] = (owed[mid] || 0) + amt;
      });
    }
  });
  const balances = members.map(m => ({
    id: m.id, name: m.name,
    paid: paid[m.id] || 0,
    owed: owed[m.id] || 0,
    net: (paid[m.id] || 0) - (owed[m.id] || 0)
  }));
  return { total, balances, transfers: calcMinTransfers(balances) };
}

function calcMinTransfers(balances) {
  const debtors = [];
  const creditors = [];
  balances.forEach(b => {
    if (b.net < -0.5) debtors.push({ id: b.id, name: b.name, amount: Math.round(-b.net) });
    if (b.net > 0.5) creditors.push({ id: b.id, name: b.name, amount: Math.round(b.net) });
  });
  debtors.sort((a, b) => b.amount - a.amount);
  creditors.sort((a, b) => b.amount - a.amount);
  const transfers = [];
  let di = 0, ci = 0;
  while (di < debtors.length && ci < creditors.length) {
    const transfer = Math.min(debtors[di].amount, creditors[ci].amount);
    if (transfer > 0) {
      transfers.push({ from: debtors[di].name, fromId: debtors[di].id, to: creditors[ci].name, toId: creditors[ci].id, amount: transfer });
    }
    debtors[di].amount -= transfer;
    creditors[ci].amount -= transfer;
    if (debtors[di].amount <= 0) di++;
    if (creditors[ci].amount <= 0) ci++;
  }
  return transfers;
}

// ==================== グループモード: Firestore ルーム作成 ====================
async function createGroupRoom(ownerName) {
  const code = generateRoomCode();
  const ref = db.collection('rooms').doc(code);
  const existing = await ref.get();
  if (existing.exists) return createGroupRoom(ownerName);
  const creatorId = 'm' + uid();
  await ref.set({
    mode: 'group',
    members: [{ id: creatorId, name: ownerName, uid: currentAuthUser.uid }],
    memberUids: [currentAuthUser.uid],
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
  return code;
}

function applySoloFormMode() {
  const solo = isSoloMode();
  // 支払った人セクション
  const payerGroup = $('expense-form').querySelectorAll('.form-group')[4]; // 5番目 = 支払った人
  const splitGroup = $('expense-form').querySelectorAll('.form-group')[5]; // 6番目 = 負担割合
  if (payerGroup) payerGroup.classList.toggle('hidden', solo);
  if (splitGroup) splitGroup.classList.toggle('hidden', solo);
  $('custom-split').classList.add('hidden');
  $('full-split').classList.add('hidden');
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
  return { users: { user1: '', user2: '' }, members: [], expenses: [], groupName: '' };
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
  const target = $(screenId);
  if (!target) return;
  ['start-screen', 'home-screen', 'setup-screen', 'main-screen'].forEach(id => {
    const el = $(id);
    if (el) el.classList.add('hidden');
  });
  target.classList.remove('hidden');
}

function ensureVisibleScreen() {
  const ids = ['start-screen', 'home-screen', 'setup-screen', 'main-screen'];
  const visible = ids.some(id => {
    const el = $(id);
    return el && !el.classList.contains('hidden');
  });
  if (visible) return;
  if (currentAuthUser) showScreen('home-screen');
  else showScreen('start-screen');
}

function showStartScreen() {
  showScreen('start-screen');
}

function showSetupStep(stepId) {
  ['step-mode', 'step-choice', 'step-create', 'step-code', 'step-join', 'step-loading', 'step-local', 'step-solo-create', 'step-local-solo', 'step-group-create', 'step-group-choice', 'step-local-group', 'step-invite-name']
    .forEach(k => { const el = $(k); if (el) el.classList.add('hidden'); });
  $(stepId).classList.remove('hidden');
}

// ==================== localStorage 保存 ====================
function saveLocal() {
  if (currentGroupId) {
    saveGroupData(currentGroupId, appData);
  }
}

// ==================== Firebase ルーム操作 ====================
async function createRoom(user1) {
  const code = generateRoomCode();
  const ref = db.collection('rooms').doc(code);
  const existing = await ref.get();
  if (existing.exists) return createRoom(user1);

  await ref.set({
    users: { user1, user2: '' },
    memberUids: [currentAuthUser.uid],
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
  return code;
}

async function joinRoom(code, userName) {
  const upperCode = (code || '').toUpperCase().trim();
  const normalizedName = (userName || '').trim();
  const roomRef = db.collection('rooms').doc(upperCode);
  let finalRoomData = null;

  await db.runTransaction(async tx => {
    const snap = await tx.get(roomRef);
    if (!snap.exists) throw new Error('ルームが見つかりません。合言葉を確認してください');

    const roomData = snap.data();
    const updates = {};

    if (currentAuthUser) {
      updates.memberUids = firebase.firestore.FieldValue.arrayUnion(currentAuthUser.uid);
    }

    if (roomData.mode === 'group') {
      if (!normalizedName) throw new Error('あなたの名前を入力してください');
      const members = Array.isArray(roomData.members) ? [...roomData.members] : [];
      const joined = currentAuthUser
        ? members.some(m => m && m.uid === currentAuthUser.uid)
        : false;
      if (!joined) {
        if (members.length >= 10) throw new Error('このグループは満員です（最大10人）');
        members.push({
          id: 'm' + uid(),
          name: normalizedName,
          uid: currentAuthUser ? currentAuthUser.uid : null
        });
        updates.members = members;
        roomData.members = members;
      }
    } else if (normalizedName) {
      const users = roomData.users || { user1: '', user2: '' };
      let nextUsers = null;
      if (!users.user1) {
        nextUsers = { ...users, user1: normalizedName };
      } else if (!users.user2) {
        nextUsers = { ...users, user2: normalizedName };
      }
      if (nextUsers) {
        updates.users = nextUsers;
        roomData.users = nextUsers;
      }
    }

    if (Object.keys(updates).length > 0) {
      tx.update(roomRef, updates);
    }
    finalRoomData = roomData;
  });

  return { code: upperCode, users: finalRoomData.users, members: finalRoomData.members, mode: finalRoomData.mode };
}

async function createInviteLink(roomCode) {
  if (!db || !currentAuthUser) throw new Error('ログインしてから招待リンクを作成してください');
  const token = generateInviteToken();
  const expiresAt = firebase.firestore.Timestamp.fromMillis(Date.now() + INVITE_TTL_MS);
  await db.collection('invites').doc(token).set({
    roomCode,
    createdByUid: currentAuthUser.uid,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    expiresAt
  });
  return `${window.location.origin}${window.location.pathname}?invite=${encodeURIComponent(token)}`;
}

async function resolveInviteToken(token) {
  if (!db) throw new Error('招待リンクは現在利用できません');
  const normalized = (token || '').trim();
  if (!normalized) throw new Error('招待リンクが無効です');
  const snap = await db.collection('invites').doc(normalized).get();
  if (!snap.exists) throw new Error('招待リンクが見つかりません');
  const data = snap.data();
  const expiresMs = data && data.expiresAt && data.expiresAt.toMillis ? data.expiresAt.toMillis() : 0;
  if (!expiresMs || Date.now() > expiresMs) throw new Error('招待リンクの有効期限が切れています');
  if (!data.roomCode) throw new Error('招待リンクが無効です');
  return data;
}

function upsertJoinedGroup(result, preferredName) {
  const joinMode = result.mode || 'pair';
  let group = groups.find(g => g.roomCode === result.code);
  if (!group) {
    group = {
      id: uid(),
      name: preferredName || 'グループ',
      roomCode: result.code,
      archived: false,
      createdAt: Date.now(),
      mode: joinMode
    };
    groups.push(group);
  } else if (preferredName) {
    group.name = preferredName;
  }
  saveGroups();

  const gData = joinMode === 'group'
    ? { users: { user1: '', user2: '' }, members: result.members || [], expenses: [], groupName: group.name || 'グループ' }
    : { users: result.users || { user1: '', user2: '' }, members: [], expenses: [], groupName: group.name || 'グループ' };
  saveGroupData(group.id, gData);
  currentGroupId = group.id;
  appData = gData;
  openGroup(group.id);
}

async function startInviteJoinFlow(token) {
  if (!currentAuthUser) return;
  try {
    await resolveInviteToken(token);
    showScreen('setup-screen');
    showSetupStep('step-invite-name');
  } catch (e) {
    console.error('Invite flow error:', e);
    showToast(e.message || '招待リンクを開けませんでした', { type: 'error' });
    pendingInviteToken = null;
    clearInviteTokenFromUrl();
    showHomeScreen();
  }
}

function startListening() {
  if (!db || !currentGroupId) return;
  const group = groups.find(g => g.id === currentGroupId);
  if (!group || !group.roomCode) return;

  if (unsubRoom) unsubRoom();
  if (unsubExpenses) unsubExpenses();

  unsubRoom = db.collection('rooms').doc(group.roomCode)
    .onSnapshot(snap => {
      if (snap.exists) {
        const data = snap.data();
        if (isGroupMode()) {
          if (data.members) {
            appData.members = data.members;
            saveLocal();
            renderSummary();
          }
        } else if (data.users) {
          appData.users = data.users;
          syncNames();
          renderSummary();
        }
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
  pendingInviteToken = getInviteTokenFromUrl();
  if (pendingInviteToken && currentAuthUser) {
    await startInviteJoinFlow(pendingInviteToken);
    return;
  }
  // Firebase 認証がない環境ではそのままホームへ。ある場合は最初に登録画面を表示し、onAuthStateChanged でログイン済みならホームへ
  if (!USE_FIREBASE || !auth) {
    showHomeScreen();
  } else {
    showStartScreen();
  }
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

  const effectiveMax = currentAuthUser ? MAX_GROUPS : 1;
  if (activeGroups.length >= effectiveMax) {
    addBtn.disabled = true;
    if (!currentAuthUser && activeGroups.length >= 1) {
      limitText.textContent = 'ログインするとグループを追加できます（最大3つ）';
    } else {
      limitText.textContent = `アクティブグループは最大${MAX_GROUPS}つまでです`;
    }
  } else {
    addBtn.disabled = false;
    limitText.textContent = '';
  }
}

function createGroupCard(group, index, isArchived) {
  const data = loadGroupData(group.id);
  const isSolo = group.mode === 'solo';
  const isGroup = group.mode === 'group';
  const el = document.createElement('div');
  el.className = 'group-card' + (isArchived ? ' group-card-archived' : '') + (isSolo ? ' group-card-solo' : '') + (isGroup ? ' group-card-group' : '');
  el.style.setProperty('--item-i', index);

  const memberNames = isSolo
    ? (data.users.user1 || '個人')
    : isGroup
      ? ((data.members || []).map(m => m.name).join('・') || 'メンバー未設定')
      : (data.users.user1 && data.users.user2
        ? `${data.users.user1} & ${data.users.user2}`
        : 'メンバー未設定');

  const modeBadge = isSolo ? '<span class="group-card-badge">個人</span>'
    : isGroup ? `<span class="group-card-badge group-badge">${(data.members || []).length}人</span>`
    : '';
  const syncBadge = group.roomCode
    ? '<span class="group-card-sync">同期</span>'
    : '<span class="group-card-badge">ローカル</span>';

  el.innerHTML = `
    <div class="group-card-body">
      <div class="group-card-name">${escapeHtml(group.name || 'グループ')}</div>
      <div class="group-card-members">
        ${escapeHtml(memberNames)}
        ${modeBadge}${syncBadge}
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

  // モード用クラス切替
  const solo = isSoloMode(groupId);
  const groupMode = isGroupMode(groupId);
  $('main-screen').classList.toggle('solo-mode', solo);
  $('main-screen').classList.toggle('group-mode', groupMode);

  // レジャーセクション切替
  const pairLedger = $('main-screen').querySelector('.ledger:not(.group-ledger)');
  const groupLedger = $('group-ledger');
  if (groupMode) {
    if (pairLedger) pairLedger.classList.add('hidden');
    if (groupLedger) groupLedger.classList.remove('hidden');
  } else {
    if (pairLedger) pairLedger.classList.remove('hidden');
    if (groupLedger) groupLedger.classList.add('hidden');
  }

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
  showSetupStep('step-mode');
  if (hasGroups) {
    $('btn-mode-back').classList.remove('hidden');
  } else {
    $('btn-mode-back').classList.add('hidden');
  }
}

// ==================== 名前同期 ====================
function syncNames() {
  if (isGroupMode()) return; // グループモードは動的生成のため不要
  const { user1, user2 } = appData.users;
  const solo = isSoloMode();
  const u1El = $('ledger-user1-name');
  const u2El = $('ledger-user2-name');
  if (u1El) u1El.textContent = user1 || '—';
  if (u2El) u2El.textContent = solo ? '' : (user2 || '—');
  const pu1 = $('payer-user1-name');
  const pu2 = $('payer-user2-name');
  if (pu1) pu1.textContent = user1 || 'ひとりめ';
  if (pu2) pu2.textContent = solo ? '' : (user2 || 'ふたりめ');
  const su1 = $('split-user1-name');
  const su2 = $('split-user2-name');
  if (su1) su1.textContent = user1 || 'ひとりめ';
  if (su2) su2.textContent = solo ? '' : (user2 || 'ふたりめ');
  const fu1 = $('full-user1-name');
  const fu2 = $('full-user2-name');
  if (fu1) fu1.textContent = user1 || 'ひとりめ';
  if (fu2) fu2.textContent = solo ? '' : (user2 || 'ふたりめ');
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
  if (isGroupMode()) { renderGroupSummary(); return; }
  const s = calcSummary();
  const solo = isSoloMode();
  $('ledger-total').textContent = yen(s.total);
  $('ledger-user1-paid').textContent = yen(s.u1Paid);
  $('ledger-user2-paid').textContent = yen(s.u2Paid);
  const { user1, user2 } = appData.users;
  const stEl = $('settlement-text');
  const actionsEl = $('settlement-actions');

  if (solo) {
    // ソロモード：清算セクションはCSS非表示だがテキストもクリア
    stEl.innerHTML = '';
    actionsEl.classList.add('hidden');
    return;
  }

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
  const solo = isSoloMode();
  const groupMode = isGroupMode();
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
    const dateStr = (exp.date || '').slice(5).replace('-', '/');
    let payerName, payerColor, splitLabel;
    if (groupMode) {
      const member = (appData.members || []).find(m => m.id === exp.paidBy);
      payerName = member ? member.name : '?';
      payerColor = 'var(--terracotta)';
      if (exp.splits) {
        const splitCount = Object.keys(exp.splits).length;
        const totalMembers = (appData.members || []).length;
        splitLabel = splitCount === totalMembers ? `${splitCount}人で均等` : `${splitCount}人`;
      } else {
        splitLabel = '';
      }
    } else {
      payerName = exp.paidBy === 'user1' ? appData.users.user1 : appData.users.user2;
      payerColor = exp.paidBy === 'user1' ? 'var(--terracotta)' : 'var(--slate)';
      splitLabel = '';
      if (exp.splitUser1 === 50 && exp.splitUser2 === 50) splitLabel = '50:50';
      else if (exp.splitUser1 === 100) splitLabel = `${appData.users.user1}負担`;
      else if (exp.splitUser2 === 100) splitLabel = `${appData.users.user2}負担`;
      else splitLabel = `${exp.splitUser1}:${exp.splitUser2}`;
    }

    const el = document.createElement('div');
    el.className = 'expense-item';
    el.style.setProperty('--item-i', i);
    el.style.borderLeftColor = cat.color;

    // ソロモードでは支払者・割合を非表示
    const payerMeta = solo ? '' : `
          <span class="expense-meta-divider"></span>
          <span class="expense-payer-dot" style="background:${payerColor}"></span>
          <span>${escapeHtml(payerName)}</span>
          <span class="expense-split-tag">${splitLabel}</span>`;

    el.innerHTML = `
      <div class="expense-cat-icon" style="background:${cat.color}18">${cat.emoji}</div>
      <div class="expense-body">
        <div class="expense-title">${escapeHtml(exp.description)}</div>
        <div class="expense-meta">
          <span>${dateStr}</span>${payerMeta}
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
  if (isGroupMode()) {
    applyGroupFormMode();
  } else {
    hideGroupFormSections();
    applySoloFormMode();
  }
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
  if (isGroupMode()) {
    applyGroupFormMode();
    // 支払者を選択
    const payerRadio = document.querySelector(`input[name="group-payer"][value="${exp.paidBy}"]`);
    if (payerRadio) payerRadio.checked = true;
    // 割り方を判定
    if (exp.splits) {
      const splitMembers = Object.keys(exp.splits);
      const totalMembers = (appData.members || []).length;
      const allEqual = splitMembers.length > 1 && new Set(Object.values(exp.splits)).size <= 2; // 均等（端数差1円以内）
      if (splitMembers.length === totalMembers && allEqual) {
        document.querySelector('input[name="group-split-type"][value="equal-all"]').checked = true;
      } else if (allEqual) {
        document.querySelector('input[name="group-split-type"][value="equal-select"]').checked = true;
        updateGroupSplitVis();
        // チェックボックスを設定
        $('group-split-checkboxes').querySelectorAll('input').forEach(cb => {
          const checked = splitMembers.includes(cb.value);
          cb.checked = checked;
          cb.closest('.group-member-check').classList.toggle('checked', checked);
        });
      } else {
        document.querySelector('input[name="group-split-type"][value="custom"]').checked = true;
        updateGroupSplitVis();
        // カスタム金額を設定
        Object.entries(exp.splits).forEach(([mid, amt]) => {
          const inp = document.getElementById('group-custom-' + mid);
          if (inp) inp.value = amt;
        });
      }
    }
  } else {
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
    hideGroupFormSections();
    applySoloFormMode();
  }
  showModal($('expense-modal'));
}

async function saveExpense() {
  clearFormErrors();
  const description = $('expense-desc').value.trim();
  const amount = parseInt($('expense-amount').value, 10);
  const date = $('expense-date').value;
  const paidBy = isGroupMode()
    ? document.querySelector('input[name="group-payer"]:checked')?.value
    : document.querySelector('input[name="paid-by"]:checked').value;
  const splitType = isGroupMode()
    ? document.querySelector('input[name="group-split-type"]:checked')?.value
    : document.querySelector('input[name="split-type"]:checked').value;

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

  let data;
  if (isGroupMode()) {
    // グループモード: splits を計算
    const members = appData.members || [];
    let splits = {};
    if (splitType === 'equal-all') {
      const perPerson = Math.floor(amount / members.length);
      const remainder = amount - (perPerson * members.length);
      members.forEach((m, i) => { splits[m.id] = perPerson + (i < remainder ? 1 : 0); });
    } else if (splitType === 'equal-select') {
      const checked = [...$('group-split-checkboxes').querySelectorAll('input:checked')].map(cb => cb.value);
      if (checked.length === 0) { showToast('負担する人を選んでください', { type: 'error' }); return; }
      const perPerson = Math.floor(amount / checked.length);
      const remainder = amount - (perPerson * checked.length);
      checked.forEach((mid, i) => { splits[mid] = perPerson + (i < remainder ? 1 : 0); });
    } else {
      // custom
      let customTotal = 0;
      members.forEach(m => {
        const val = parseInt(document.getElementById('group-custom-' + m.id)?.value, 10) || 0;
        if (val > 0) splits[m.id] = val;
        customTotal += val;
      });
      if (customTotal !== amount) {
        showToast(`合計が金額と一致しません（差額: ${yen(Math.abs(amount - customTotal))}）`, { type: 'error' });
        return;
      }
    }
    data = { category: selectedCategory, description, amount, date, paidBy, splits };
  } else {
    // ソロモードでは強制的に user1 / 100:0
    if (isSoloMode()) {
      splitUser1 = 100; splitUser2 = 0;
    }
    data = { category: selectedCategory, description, amount, date, paidBy: isSoloMode() ? 'user1' : paidBy, splitUser1, splitUser2 };
  }

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

// ==================== グループモード: 表示・フォーム ====================
function renderGroupSummary() {
  const s = calcGroupSummary();
  $('group-ledger-total').textContent = yen(s.total);

  const grid = $('group-members-grid');
  grid.innerHTML = '';
  s.balances.forEach(b => {
    const el = document.createElement('div');
    el.className = 'group-member-stat';
    el.innerHTML = `
      <span class="group-member-name">${escapeHtml(b.name)}</span>
      <span class="group-member-sub">支払い済</span>
      <span class="group-member-amount">${yen(b.paid)}</span>
    `;
    grid.appendChild(el);
  });

  const stEl = $('group-settlement');
  const actionsEl = $('group-settlement-actions');
  if (s.total === 0) {
    stEl.innerHTML = '<span style="color:var(--ink-light)">まだ支出がありません</span>';
    actionsEl.classList.add('hidden');
  } else if (s.transfers.length === 0) {
    stEl.innerHTML = '<span class="settlement-clear">&#10003; ぴったり精算済み</span>';
    actionsEl.classList.add('hidden');
  } else {
    stEl.innerHTML = s.transfers.map(t =>
      `<div class="group-transfer-row">
        <strong>${escapeHtml(t.from)}</strong> → <strong>${escapeHtml(t.to)}</strong>
        <span class="settlement-amount">${yen(t.amount)}</span>
      </div>`
    ).join('');
    actionsEl.classList.remove('hidden');
  }
}

function applyGroupFormMode() {
  // ペアモード用セクションを非表示
  const formGroups = $('expense-form').querySelectorAll(':scope > .form-group');
  if (formGroups[4]) formGroups[4].classList.add('hidden'); // 支払った人(pair)
  if (formGroups[5]) formGroups[5].classList.add('hidden'); // 負担割合(pair)
  $('custom-split').classList.add('hidden');
  $('full-split').classList.add('hidden');
  // グループモード用セクションを表示
  $('group-payer-section').classList.remove('hidden');
  $('group-split-section').classList.remove('hidden');
  $('group-split-select').classList.add('hidden');
  $('group-split-custom').classList.add('hidden');
  buildGroupPayerGrid();
  buildGroupSplitCheckboxes();
  const eqAll = document.querySelector('input[name="group-split-type"][value="equal-all"]');
  if (eqAll) eqAll.checked = true;
}

function hideGroupFormSections() {
  $('group-payer-section').classList.add('hidden');
  $('group-split-section').classList.add('hidden');
  $('group-split-select').classList.add('hidden');
  $('group-split-custom').classList.add('hidden');
  // ペアモード用セクションを再表示
  const formGroups = $('expense-form').querySelectorAll(':scope > .form-group');
  if (formGroups[4]) formGroups[4].classList.remove('hidden');
  if (formGroups[5]) formGroups[5].classList.remove('hidden');
}

function buildGroupPayerGrid() {
  const grid = $('group-payer-grid');
  grid.innerHTML = '';
  (appData.members || []).forEach((m, i) => {
    const label = document.createElement('label');
    label.className = 'payer-option';
    label.innerHTML = `<input type="radio" name="group-payer" value="${m.id}" ${i === 0 ? 'checked' : ''}><span class="payer-label">${escapeHtml(m.name)}</span>`;
    grid.appendChild(label);
  });
}

function buildGroupSplitCheckboxes() {
  const container = $('group-split-checkboxes');
  container.innerHTML = '';
  (appData.members || []).forEach(m => {
    const label = document.createElement('label');
    label.className = 'group-member-check checked';
    label.innerHTML = `<input type="checkbox" value="${m.id}" checked><span>${escapeHtml(m.name)}</span>`;
    const cb = label.querySelector('input');
    cb.addEventListener('change', () => label.classList.toggle('checked', cb.checked));
    container.appendChild(label);
  });
}

function buildGroupCustomInputs() {
  const list = $('group-split-custom-list');
  list.innerHTML = '';
  (appData.members || []).forEach(m => {
    const row = document.createElement('div');
    row.className = 'group-split-custom-row';
    row.innerHTML = `<span class="split-name">${escapeHtml(m.name)}</span>
      <div class="input-yen"><span class="yen-mark">¥</span><input type="number" id="group-custom-${m.id}" placeholder="0" min="0"></div>`;
    list.appendChild(row);
    row.querySelector('input').addEventListener('input', updateGroupSplitHint);
  });
}

function updateGroupSplitVis() {
  const type = document.querySelector('input[name="group-split-type"]:checked').value;
  $('group-split-select').classList.toggle('hidden', type !== 'equal-select');
  $('group-split-custom').classList.toggle('hidden', type !== 'custom');
  if (type === 'custom') buildGroupCustomInputs();
}

function updateGroupSplitHint() {
  const members = appData.members || [];
  let total = 0;
  members.forEach(m => {
    total += parseInt(document.getElementById('group-custom-' + m.id)?.value, 10) || 0;
  });
  const hint = $('group-split-hint');
  const expAmount = parseInt($('expense-amount').value, 10) || 0;
  if (expAmount > 0 && total === expAmount) {
    hint.textContent = `合計 ${yen(total)} ✓`;
    hint.style.color = 'var(--sage)';
  } else if (expAmount > 0) {
    hint.textContent = `合計 ${yen(total)}（金額: ${yen(expAmount)}、差額: ${yen(Math.abs(expAmount - total))}）`;
    hint.style.color = '#C0392B';
  } else {
    hint.textContent = `合計 ${yen(total)}`;
    hint.style.color = 'var(--ink-light)';
  }
}

function getGroupSettlementText() {
  const s = calcGroupSummary();
  if (s.total === 0) return '';
  if (s.transfers.length === 0) return `${fmtMonth(currentMonth)}の清算：精算済み ✓`;
  let text = `${fmtMonth(currentMonth)}の清算\n`;
  s.transfers.forEach(t => { text += `${t.from} → ${t.to}: ${yen(t.amount)}\n`; });
  text += `合計: ${yen(s.total)}`;
  return text;
}

function shareGroupByLINE() {
  const text = getGroupSettlementText();
  if (!text) { showToast('清算情報がありません'); return; }
  const url = `https://line.me/R/share?text=${encodeURIComponent(text)}`;
  window.open(url, '_blank');
}

function renderSettingsMembers() {
  const list = $('settings-members-list');
  list.innerHTML = '';
  (appData.members || []).forEach((m, i) => {
    const row = document.createElement('div');
    row.className = 'settings-member-row';
    const canRemove = (appData.members.length > 3);
    row.innerHTML = `<input type="text" class="settings-member-input" data-mid="${m.id}" value="${escapeHtml(m.name)}" maxlength="10" placeholder="メンバー${i + 1}">
      ${canRemove ? `<button type="button" class="settings-member-remove" data-mid="${m.id}" title="削除">✕</button>` : ''}`;
    list.appendChild(row);
  });
  list.querySelectorAll('.settings-member-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const mid = btn.dataset.mid;
      const hasExpenses = appData.expenses.some(e => e.paidBy === mid || (e.splits && e.splits[mid]));
      if (hasExpenses) { showToast('支出があるメンバーは削除できません', { type: 'error' }); return; }
      appData.members = appData.members.filter(m => m.id !== mid);
      renderSettingsMembers();
    });
  });
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

// ==================== 認証（メール登録・ログイン） ====================
function updateAuthUI() {
  const guest = $('settings-account-guest');
  const userBlock = $('settings-account-user');
  const emailEl = $('settings-account-email');
  if (!guest || !userBlock) return;
  if (currentAuthUser) {
    guest.classList.add('hidden');
    userBlock.classList.remove('hidden');
    if (emailEl) emailEl.textContent = currentAuthUser.displayName ? `${currentAuthUser.displayName} (${currentAuthUser.email || ''})` : (currentAuthUser.email || '');
  } else {
    guest.classList.remove('hidden');
    userBlock.classList.add('hidden');
  }
}

function setAuthTab(mode) {
  const isSignup = mode === 'signup';
  $('auth-tab-signup').classList.toggle('active', isSignup);
  $('auth-tab-login').classList.toggle('active', !isSignup);
  $('auth-modal-title').textContent = isSignup ? 'アカウント登録' : 'ログイン';
  $('auth-submit').textContent = isSignup ? '登録する' : 'ログイン';
  const wrap = $('auth-confirm-wrap');
  if (wrap) wrap.classList.toggle('hidden', !isSignup);
  $('auth-password-confirm').required = isSignup;
  [$('auth-error-email'), $('auth-error-password'), $('auth-error-confirm'), $('auth-error-general')].forEach(el => {
    if (el) { el.classList.add('hidden'); el.textContent = ''; }
  });
}

function openAuthModal(mode) {
  setAuthTab(mode || 'signup');
  $('auth-email').value = '';
  $('auth-password').value = '';
  $('auth-password-confirm').value = '';
  showModal($('auth-modal'));
}

function closeAuthModal() {
  hideModal($('auth-modal'));
}

async function authFormSubmit(e) {
  e.preventDefault();
  const email = ($('auth-email').value || '').trim();
  const password = $('auth-password').value || '';
  const confirm = $('auth-password-confirm').value || '';
  const isSignup = $('auth-tab-signup').classList.contains('active');
  const errEmail = $('auth-error-email');
  const errPass = $('auth-error-password');
  const errConfirm = $('auth-error-confirm');
  const errGeneral = $('auth-error-general');
  [errEmail, errPass, errConfirm, errGeneral].forEach(el => { if (el) { el.classList.add('hidden'); el.textContent = ''; } });

  if (!email) {
    errEmail.textContent = 'メールアドレスを入力してください';
    errEmail.classList.remove('hidden');
    return;
  }
  if (!password) {
    errPass.textContent = 'パスワードを入力してください';
    errPass.classList.remove('hidden');
    return;
  }
  if (password.length < 6) {
    errPass.textContent = 'パスワードは6文字以上にしてください';
    errPass.classList.remove('hidden');
    return;
  }
  if (isSignup && password !== confirm) {
    errConfirm.textContent = 'パスワードが一致しません';
    errConfirm.classList.remove('hidden');
    return;
  }

  if (!auth) {
    showToast('認証機能が利用できません', { type: 'error' });
    return;
  }

  try {
    if (isSignup) {
      await auth.createUserWithEmailAndPassword(email, password);
      showToast('アカウントを登録しました', { type: 'success' });
    } else {
      await auth.signInWithEmailAndPassword(email, password);
      showToast('ログインしました', { type: 'success' });
    }
    closeAuthModal();
  } catch (err) {
    const code = err.code || '';
    let msg = err.message || 'エラーが発生しました';
    if (code === 'auth/configuration-not-found') msg = '認証の設定が有効になっていません。Firebase コンソールの「Authentication」→「Sign-in method」で「メール/パスワード」を有効にしてください。';
    else if (code === 'auth/email-already-in-use') msg = 'このメールアドレスは既に登録されています';
    else if (code === 'auth/invalid-email') msg = '有効なメールアドレスを入力してください';
    else if (code === 'auth/weak-password') msg = 'パスワードは6文字以上にしてください';
    else if (code === 'auth/user-not-found' || code === 'auth/wrong-password') msg = 'メールアドレスまたはパスワードが違います';
    errGeneral.textContent = msg;
    errGeneral.classList.remove('hidden');
  }
}

async function signInWithGoogle() {
  if (!auth) {
    showToast('認証機能が利用できません', { type: 'error' });
    return;
  }
  const provider = new firebase.auth.GoogleAuthProvider();
  try {
    await auth.signInWithPopup(provider);
    showToast('ログインしました', { type: 'success' });
    closeAuthModal();
  } catch (err) {
    const code = err.code || '';
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
      return; // ユーザーが閉じただけなら何もしない
    }
    if (code === 'auth/popup-blocked') {
      showToast('ポップアップがブロックされました。ブラウザでポップアップを許可してください。', { type: 'error' });
      return;
    }
    console.error('Google sign-in error:', err);
    showToast(err.message || 'Googleログインに失敗しました', { type: 'error' });
  }
}

async function logout() {
  if (!auth) return;
  try {
    await auth.signOut();
    showToast('ログアウトしました', { type: 'success' });
    updateAuthUI();
  } catch (e) {
    showToast('ログアウトに失敗しました', { type: 'error' });
  }
}

// ==================== 設定 ====================
function openSettings() {
  updateAuthUI();
  const solo = isSoloMode();
  const groupMode = isGroupMode();
  $('settings-user1').value = appData.users.user1;
  $('settings-user2').value = appData.users.user2;
  // グループモードではpair/soloのユーザーフィールドを非表示、メンバー管理を表示
  const u1Group = $('settings-user1').closest('.form-group');
  if (u1Group) u1Group.classList.toggle('hidden', groupMode);
  const u2Group = $('settings-user2-group');
  if (u2Group) u2Group.classList.toggle('hidden', solo || groupMode);
  const groupMembersSection = $('settings-group-members');
  if (groupMembersSection) groupMembersSection.classList.toggle('hidden', !groupMode);
  if (groupMode) {
    renderSettingsMembers();
    // メンバー追加ボタン
    const addBtn = $('settings-add-member');
    addBtn.onclick = () => {
      if ((appData.members || []).length >= 10) { showToast('メンバーは最大10人までです', { type: 'error' }); return; }
      const newId = 'm' + (Date.now().toString(36));
      appData.members.push({ id: newId, name: '' });
      renderSettingsMembers();
    };
  }
  // ひとりめのラベルを切替
  const u1Label = $('settings-user1').previousElementSibling || $('settings-user1').parentElement.querySelector('label');
  if (u1Label && !groupMode) u1Label.textContent = solo ? 'あなたの名前' : 'ひとりめの名前';

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
  const solo = isSoloMode();
  const groupMode = isGroupMode();
  const gn = $('settings-group-name') ? $('settings-group-name').value.trim() : '';

  if (groupMode) {
    // グループモード: メンバー名を収集
    const inputs = $('settings-members-list').querySelectorAll('.settings-member-input');
    const updatedMembers = [];
    let hasEmpty = false;
    const beforeById = {};
    (appData.members || []).forEach(m => { beforeById[m.id] = m; });
    inputs.forEach(inp => {
      const name = inp.value.trim();
      const mid = inp.dataset.mid;
      if (!name) hasEmpty = true;
      const prev = beforeById[mid] || {};
      updatedMembers.push({
        id: mid,
        name,
        ...(prev.uid ? { uid: prev.uid } : {})
      });
    });
    if (hasEmpty) { showToast('メンバー名を入力してください', { type: 'error' }); return; }
    appData.members = updatedMembers;
  }

  const u1 = groupMode ? '' : $('settings-user1').value.trim();
  const u2 = (solo || groupMode) ? '' : $('settings-user2').value.trim();
  if (!groupMode && !u1) { showToast('名前を入力してください', { type: 'error' }); return; }
  if (!groupMode && !solo && !u2) { showToast('名前を入力してください', { type: 'error' }); return; }

  try {
    const group = groups.find(g => g.id === currentGroupId);
    if (USE_FIREBASE && db && group && group.roomCode) {
      if (groupMode) {
        await db.collection('rooms').doc(group.roomCode).update({
          members: appData.members
        });
      } else {
        await db.collection('rooms').doc(group.roomCode).update({
          users: { user1: u1, user2: u2 }
        });
      }
    } else {
      if (!groupMode) appData.users = { user1: u1, user2: u2 };
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
    appData = { users: { user1: '', user2: '' }, members: [], expenses: [], groupName: '' };
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
    const effectiveMax = currentAuthUser ? MAX_GROUPS : 1;
    if (getActiveGroups().length >= effectiveMax) {
      if (!currentAuthUser) {
        showToast('ログインするとグループを追加できます', { type: 'error' });
      } else {
        showToast(`グループは最大${MAX_GROUPS}つまでです`, { type: 'error' });
      }
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

  // === セットアップ: モード選択 ===
  $('btn-mode-solo').addEventListener('click', () => {
    pendingMode = 'solo';
    if (USE_FIREBASE && db) {
      showSetupStep('step-solo-create');
    } else {
      showSetupStep('step-local-solo');
    }
  });
  $('btn-mode-pair').addEventListener('click', () => {
    pendingMode = 'pair';
    if (USE_FIREBASE && db) {
      showSetupStep('step-choice');
    } else {
      showSetupStep('step-local');
    }
  });
  $('btn-mode-back').addEventListener('click', () => showHomeScreen());

  // === セットアップ: Firebase モード ===
  $('btn-to-create').addEventListener('click', () => showSetupStep('step-create'));
  $('btn-to-join').addEventListener('click', () => showSetupStep('step-join'));
  $('btn-back-create').addEventListener('click', () => showSetupStep('step-choice'));
  $('btn-back-join').addEventListener('click', () => showSetupStep('step-choice'));
  $('btn-setup-back').addEventListener('click', () => showSetupStep('step-mode'));
  $('btn-setup-back-local').addEventListener('click', () => showSetupStep('step-mode'));

  // ルーム作成
  $('btn-create-room').addEventListener('click', async () => {
    const groupName = $('group-name-input').value.trim() || 'グループ';
    const u1 = $('user1-name').value.trim();
    if (!u1) { showToast('名前を入力してください', { type: 'error' }); return; }
    showSetupStep('step-loading');
    try {
      const code = await createRoom(u1);
      const groupId = uid();
      const newGroup = { id: groupId, name: groupName, roomCode: code, archived: false, createdAt: Date.now(), mode: 'pair' };
      groups.push(newGroup);
      saveGroups();
      const gData = { users: { user1: u1, user2: '' }, expenses: [], groupName: groupName };
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
  $('btn-copy-invite-link').addEventListener('click', async () => {
    const group = groups.find(g => g.id === currentGroupId);
    if (!group || !group.roomCode) { showToast('同期グループでのみ利用できます', { type: 'error' }); return; }
    try {
      const inviteUrl = await createInviteLink(group.roomCode);
      await copyToClipboard(inviteUrl);
    } catch (e) {
      console.error(e);
      showToast(e.message || '招待リンクの作成に失敗しました', { type: 'error' });
    }
  });
  $('settings-copy-code').addEventListener('click', () => {
    const group = groups.find(g => g.id === currentGroupId);
    if (group) copyToClipboard(group.roomCode);
  });
  $('settings-copy-invite-link').addEventListener('click', async () => {
    const group = groups.find(g => g.id === currentGroupId);
    if (!group || !group.roomCode) { showToast('同期グループでのみ利用できます', { type: 'error' }); return; }
    try {
      const inviteUrl = await createInviteLink(group.roomCode);
      await copyToClipboard(inviteUrl);
    } catch (e) {
      console.error(e);
      showToast(e.message || '招待リンクの作成に失敗しました', { type: 'error' });
    }
  });

  // はじめる
  $('btn-start').addEventListener('click', () => {
    openGroup(currentGroupId);
  });

  // ルームに参加
  $('btn-join-room').addEventListener('click', async () => {
    const groupName = $('join-group-name') ? $('join-group-name').value.trim() : '';
    const joinUserName = $('join-user-name') ? $('join-user-name').value.trim() : '';
    const code = $('join-code-input').value.trim();
    if (!code || code.length < 4) { showToast('合言葉を入力してください', { type: 'error' }); return; }
    if (!joinUserName) { showToast('あなたの名前を入力してください', { type: 'error' }); return; }
    showSetupStep('step-loading');
    try {
      const result = await joinRoom(code, joinUserName);
      upsertJoinedGroup(result, groupName || 'グループ');
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
    const newGroup = { id: groupId, name: groupName || 'グループ', roomCode: '', archived: false, createdAt: Date.now(), mode: 'pair' };
    groups.push(newGroup);
    saveGroups();
    const gData = { users: { user1: u1, user2: u2 }, expenses: [], groupName: groupName || 'グループ' };
    saveGroupData(groupId, gData);

    currentGroupId = groupId;
    appData = gData;
    openGroup(groupId);
  });

  // === セットアップ: ソロモード (Firebase有り) ===
  $('btn-solo-create').addEventListener('click', () => {
    const groupName = $('solo-group-name').value.trim() || '家計簿';
    const userName = $('solo-user-name').value.trim();
    if (!userName) { showToast('名前を入力してください', { type: 'error' }); return; }

    const groupId = uid();
    const newGroup = { id: groupId, name: groupName, roomCode: '', archived: false, createdAt: Date.now(), mode: 'solo' };
    groups.push(newGroup);
    saveGroups();
    const gData = { users: { user1: userName, user2: '' }, expenses: [], groupName: groupName };
    saveGroupData(groupId, gData);

    currentGroupId = groupId;
    appData = gData;
    openGroup(groupId);
  });
  $('btn-back-solo').addEventListener('click', () => showSetupStep('step-mode'));

  // === セットアップ: ソロモード (ローカル) ===
  $('local-solo-start-btn').addEventListener('click', () => {
    const groupName = $('local-solo-group-name').value.trim() || '家計簿';
    const userName = $('local-solo-user-name').value.trim();
    if (!userName) { showToast('名前を入力してください', { type: 'error' }); return; }

    const groupId = uid();
    const newGroup = { id: groupId, name: groupName, roomCode: '', archived: false, createdAt: Date.now(), mode: 'solo' };
    groups.push(newGroup);
    saveGroups();
    const gData = { users: { user1: userName, user2: '' }, expenses: [], groupName: groupName };
    saveGroupData(groupId, gData);

    currentGroupId = groupId;
    appData = gData;
    openGroup(groupId);
  });
  $('btn-back-local-solo').addEventListener('click', () => showSetupStep('step-mode'));

  // === セットアップ: グループモード ===
  $('btn-mode-group').addEventListener('click', () => {
    pendingMode = 'group';
    if (USE_FIREBASE && db) {
      showSetupStep('step-group-choice');
    } else {
      showSetupStep('step-local-group');
    }
  });
  $('btn-to-group-create').addEventListener('click', () => showSetupStep('step-group-create'));
  $('btn-to-group-join').addEventListener('click', () => showSetupStep('step-join'));
  $('btn-back-group-choice').addEventListener('click', () => showSetupStep('step-mode'));
  $('btn-back-group-create').addEventListener('click', () => {
    if (USE_FIREBASE && db) showSetupStep('step-group-choice');
    else showSetupStep('step-mode');
  });
  $('btn-back-local-group').addEventListener('click', () => showSetupStep('step-mode'));

  // メンバー追加ボタン
  function setupAddMemberBtn(btnId, containerId) {
    const btn = $(btnId);
    const container = $(containerId);
    if (!btn || !container) return;
    btn.addEventListener('click', () => {
      const container = $(containerId);
      const count = container.querySelectorAll('input').length;
      if (count >= 10) { showToast('メンバーは最大10人までです', { type: 'error' }); return; }
      const field = document.createElement('div');
      field.className = 'setup-field group-member-field';
      field.innerHTML = `<input type="text" placeholder="メンバー${count + 1}の名前" maxlength="10"><button type="button" class="member-remove-btn" title="削除">✕</button>`;
      container.appendChild(field);
      field.querySelector('.member-remove-btn').addEventListener('click', () => {
        if (container.querySelectorAll('input').length > 3) field.remove();
      });
    });
  }
  setupAddMemberBtn('btn-add-member', 'group-members-inputs');
  setupAddMemberBtn('btn-add-local-member', 'local-group-members-inputs');

  // グループ作成ヘルパー
  function collectGroupMembers(containerId) {
    const inputs = $(containerId).querySelectorAll('input');
    const names = [];
    inputs.forEach(inp => { const n = inp.value.trim(); if (n) names.push(n); });
    return names;
  }

  // Firebase グループ作成
  $('btn-create-group-room').addEventListener('click', async () => {
    const groupName = $('group-mode-name-input').value.trim() || 'グループ';
    const ownerName = $('group-owner-name').value.trim();
    if (!ownerName) { showToast('あなたの名前を入力してください', { type: 'error' }); return; }
    showSetupStep('step-loading');
    try {
      const code = await createGroupRoom(ownerName);
      const groupId = uid();
      const newGroup = { id: groupId, name: groupName, roomCode: code, archived: false, createdAt: Date.now(), mode: 'group' };
      groups.push(newGroup);
      saveGroups();
      const members = [{ id: 'm-local-owner', name: ownerName, uid: currentAuthUser ? currentAuthUser.uid : null }];
      const gData = { users: { user1: '', user2: '' }, members, expenses: [], groupName };
      saveGroupData(groupId, gData);
      currentGroupId = groupId;
      appData = gData;
      $('display-code').textContent = code;
      showSetupStep('step-code');
    } catch (e) {
      console.error(e);
      showToast('作成に失敗しました。ネットワークを確認してください', { type: 'error' });
      showSetupStep('step-group-create');
    }
  });

  // 招待リンクから参加（コード不要）
  $('btn-invite-join').addEventListener('click', async () => {
    const groupName = $('invite-group-name') ? $('invite-group-name').value.trim() : '';
    const userName = $('invite-user-name') ? $('invite-user-name').value.trim() : '';
    if (!pendingInviteToken) { showToast('招待リンクが見つかりません', { type: 'error' }); return; }
    if (!userName) { showToast('あなたの名前を入力してください', { type: 'error' }); return; }
    showSetupStep('step-loading');
    try {
      const invite = await resolveInviteToken(pendingInviteToken);
      const result = await joinRoom(invite.roomCode, userName);
      upsertJoinedGroup(result, groupName || 'グループ');
      pendingInviteToken = null;
      clearInviteTokenFromUrl();
      showToast('参加しました！', { type: 'success' });
    } catch (e) {
      console.error(e);
      showToast(e.message || '参加に失敗しました', { type: 'error' });
      showSetupStep('step-invite-name');
    }
  });
  $('btn-invite-cancel').addEventListener('click', () => {
    pendingInviteToken = null;
    clearInviteTokenFromUrl();
    showHomeScreen();
  });

  // ローカル グループ作成
  $('btn-create-local-group').addEventListener('click', () => {
    const groupName = $('local-group-mode-name').value.trim() || 'グループ';
    const names = collectGroupMembers('local-group-members-inputs');
    if (names.length < 3) { showToast('3人以上のメンバー名を入力してください', { type: 'error' }); return; }
    const members = names.map((n, i) => ({ id: 'm' + (i + 1), name: n }));
    const groupId = uid();
    const newGroup = { id: groupId, name: groupName, roomCode: '', archived: false, createdAt: Date.now(), mode: 'group' };
    groups.push(newGroup);
    saveGroups();
    const gData = { users: { user1: '', user2: '' }, members, expenses: [], groupName };
    saveGroupData(groupId, gData);
    currentGroupId = groupId;
    appData = gData;
    openGroup(groupId);
  });

  // グループモード: 割合切替
  document.querySelectorAll('input[name="group-split-type"]').forEach(r =>
    r.addEventListener('change', updateGroupSplitVis)
  );

  // グループモード: LINE共有
  $('btn-group-line-share').addEventListener('click', shareGroupByLINE);

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

  // === アカウント（認証） ===
  if ($('btn-open-signup')) $('btn-open-signup').addEventListener('click', () => openAuthModal('signup'));
  if ($('btn-open-login')) $('btn-open-login').addEventListener('click', () => openAuthModal('login'));
  if ($('start-google-btn')) $('start-google-btn').addEventListener('click', signInWithGoogle);
  if ($('start-signup-btn')) $('start-signup-btn').addEventListener('click', () => openAuthModal('signup'));
  if ($('start-login-btn')) $('start-login-btn').addEventListener('click', () => openAuthModal('login'));
  if ($('btn-google-login')) $('btn-google-login').addEventListener('click', signInWithGoogle);
  if ($('btn-logout')) $('btn-logout').addEventListener('click', logout);
  if ($('auth-modal')) {
    if ($('auth-modal-close')) $('auth-modal-close').addEventListener('click', closeAuthModal);
    $('auth-modal').querySelector('.modal-overlay')?.addEventListener('click', closeAuthModal);
    if ($('auth-tab-signup')) $('auth-tab-signup').addEventListener('click', () => setAuthTab('signup'));
    if ($('auth-tab-login')) $('auth-tab-login').addEventListener('click', () => setAuthTab('login'));
    if ($('auth-form')) $('auth-form').addEventListener('submit', authFormSubmit);
  }

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
      else if ($('auth-modal') && !$('auth-modal').classList.contains('hidden')) closeAuthModal();
      else if (!$('settings-modal').classList.contains('hidden')) hideModal($('settings-modal'));
    }
  });
}

// ==================== 起動 ====================
document.addEventListener('DOMContentLoaded', () => {
  setupEvents();
  initApp();
  if (pendingScreenId) {
    showScreen(pendingScreenId);
    pendingScreenId = null;
  }
  ensureVisibleScreen();
});

window.addEventListener('error', (e) => {
  console.error('Unhandled error:', e.error || e.message || e);
  ensureVisibleScreen();
});

window.addEventListener('unhandledrejection', (e) => {
  console.error('Unhandled rejection:', e.reason || e);
  ensureVisibleScreen();
});
