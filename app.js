import {
  beginDropboxConnect,
  disconnectDropbox,
  downloadBoard,
  finishDropboxCallback,
  getRedirectUri,
  isConnected,
  uploadBoard,
} from './dropbox.js';

const VERSION = '0.1.10';
const STORAGE_KEY = 'chatboard.board.v1';
const FONT_KEY = 'chatboard.fontScale.v1';
const VIEW_KEY = 'chatboard.view.v1';

const icons = {
  logo: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/><path d="M15 8h-6"/><path d="M13 12H9"/></svg>',
  menu: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg>',
  search: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/></svg>',
  plus: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  more: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg>',
  chevronDown: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>',
  chevronRight: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>',
  back: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>',
  grip: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/></svg>',
  arrange: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7h-9"/><path d="M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/></svg>',
  close: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>',
};

const app = document.querySelector('#app');
let state = loadBoard();
let currentView = localStorage.getItem(VIEW_KEY) || 'active';
let query = '';
let menuOpen = false;
let searchOpen = false;
let arrangeMode = false;
let popover = null;
let sheet = null;
let toastTimer = null;
let syncTimer = null;
let syncing = false;
let syncMessage = isConnected() ? 'Dropbox connected' : 'Local cache';
let dragging = null;
let pointerDrag = null;

function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function bookmarkletCode() {
  const base = new URL('./', location.href).href;
  return `javascript:(()=>{const b=${JSON.stringify(base)};const u=location.href;const t=(document.title||'ChatGPT conversation').replace(/^\s*ChatGPT\s*[-|:]\s*/i,'').replace(/\s*[-|:]\s*ChatGPT\s*$/i,'').trim()||'ChatGPT conversation';location.href=b+'?add=1&url='+encodeURIComponent(u)+'&title='+encodeURIComponent(t)+'&return='+encodeURIComponent(u)})()`;
}

function captureReturnUrl() {
  const value = new URLSearchParams(location.search).get('return');
  if (!value) return '';
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch { return ''; }
}

function returnFromCapture() {
  const target = captureReturnUrl();
  if (!target) return false;
  clearCaptureParams();
  if (document.referrer) {
    try {
      if (new URL(document.referrer).href === target && history.length > 1) {
        history.back();
        return true;
      }
    } catch {}
  }
  location.replace(target);
  return true;
}

async function copyText(text, successMessage = 'Copied.') {
  try {
    await navigator.clipboard.writeText(text);
    toast(successMessage);
    return;
  } catch {}
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.append(area);
  area.select();
  try { document.execCommand('copy'); toast(successMessage); }
  catch { toast('Copy failed. Select the code manually.'); }
  area.remove();
}

function defaultBoard() {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    updatedAt: now,
    categories: [
      { id: uid('cat'), name: 'Current Projects', collapsed: false },
    ],
    bookmarks: [],
  };
}

function normalizeBoard(board) {
  const base = board && typeof board === 'object' ? board : defaultBoard();
  if (!Array.isArray(base.categories)) base.categories = [];
  if (!Array.isArray(base.bookmarks)) base.bookmarks = [];
  if (!base.categories.length) base.categories.push({ id: uid('cat'), name: 'Current Projects', collapsed: false });
  base.schemaVersion = 1;
  base.updatedAt ||= new Date().toISOString();
  base.categories = base.categories.map(c => ({ id: c.id || uid('cat'), name: c.name || 'Untitled', collapsed: Boolean(c.collapsed) }));
  base.bookmarks = base.bookmarks.map(b => ({
    id: b.id || uid('bm'),
    title: b.title || 'Untitled chat',
    url: b.url || '',
    categoryId: b.categoryId || base.categories[0].id,
    status: ['active', 'hidden', 'archived'].includes(b.status) ? b.status : 'active',
    createdAt: b.createdAt || base.updatedAt,
    updatedAt: b.updatedAt || base.updatedAt,
  }));
  return base;
}

function loadBoard() {
  try { return normalizeBoard(JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')); }
  catch { return defaultBoard(); }
}

function persist({ sync = true } = {}) {
  state.updatedAt = new Date().toISOString();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  render();
  if (sync) scheduleSync();
}

function compareUpdated(a, b) {
  return new Date(a?.updatedAt || 0).getTime() - new Date(b?.updatedAt || 0).getTime();
}

function setSyncMessage(message) {
  syncMessage = message;
  const el = document.querySelector('[data-sync-message]');
  if (el) el.textContent = message;
}

async function syncFromDropbox() {
  if (!isConnected() || syncing) return;
  syncing = true;
  setSyncMessage('Syncing…');
  try {
    const remote = await downloadBoard();
    if (!remote) {
      await uploadBoard(state);
    } else {
      const normalized = normalizeBoard(remote);
      if (compareUpdated(normalized, state) > 0) {
        state = normalized;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        render();
      } else if (compareUpdated(state, normalized) > 0) {
        await uploadBoard(state);
      }
    }
    setSyncMessage('✓ Synced');
  } catch (error) {
    console.error(error);
    setSyncMessage('Offline · saved locally');
  } finally {
    syncing = false;
  }
}

function scheduleSync() {
  if (!isConnected()) { setSyncMessage('Local cache'); return; }
  setSyncMessage('Saving…');
  clearTimeout(syncTimer);
  syncTimer = setTimeout(async () => {
    if (syncing) return scheduleSync();
    syncing = true;
    try {
      await uploadBoard(state);
      setSyncMessage('✓ Synced');
    } catch (error) {
      console.error(error);
      setSyncMessage('Offline · saved locally');
    } finally {
      syncing = false;
    }
  }, 550);
}

function toast(message) {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    document.body.append(el);
  }
  el.textContent = message;
  requestAnimationFrame(() => el.classList.add('toast--visible'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('toast--visible'), 1800);
}

function escapeForTitle(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.includes('chatgpt.com') ? 'ChatGPT conversation' : parsed.hostname;
  } catch { return 'Untitled chat'; }
}

function button(className, label, html, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = className;
  b.setAttribute('aria-label', label);
  b.innerHTML = html;
  b.addEventListener('click', onClick);
  return b;
}

function setView(view) {
  currentView = view;
  localStorage.setItem(VIEW_KEY, view);
  menuOpen = false;
  popover = null;
  arrangeMode = false;
  render();
}

function visibleBookmarks(categoryId, status = currentView) {
  const q = query.trim().toLowerCase();
  return state.bookmarks.filter(b => b.categoryId === categoryId && b.status === status && (!q || b.title.toLowerCase().includes(q)));
}

function totalFor(status) {
  return state.bookmarks.filter(b => b.status === status).length;
}

function expandAllCategories() {
  state.categories.forEach(category => { category.collapsed = false; });
  menuOpen = false;
  persist();
  toast('All categories expanded.');
}

function collapseAllCategories() {
  state.categories.forEach(category => { category.collapsed = true; });
  menuOpen = false;
  persist();
  toast('All categories collapsed.');
}

function sortCategoryAlphabetically(category) {
  const matches = bookmark => bookmark.status === 'active' && bookmark.categoryId === category.id;
  const sorted = state.bookmarks
    .filter(matches)
    .slice()
    .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true }));
  if (sorted.length < 2) {
    toast('Nothing to sort.');
    render();
    return;
  }
  let index = 0;
  state.bookmarks = state.bookmarks.map(bookmark => matches(bookmark) ? sorted[index++] : bookmark);
  persist();
  toast('Sorted A–Z.');
}

function render() {
  document.querySelectorAll('.scrim,.menu-panel,.popover-scrim,.popover,.sheet-scrim,.sheet').forEach(el => el.remove());
  const storedFont = localStorage.getItem(FONT_KEY) || '22';
  const legacyFontMap = { small: '20', medium: '22', large: '24' };
  document.documentElement.dataset.fontScale = legacyFontMap[storedFont] || storedFont;
  app.innerHTML = '';

  const shell = document.createElement('main');
  shell.className = 'chatboard-app';
  shell.append(renderHeader());
  shell.append(renderSyncLine());
  if (searchOpen) shell.append(renderSearch());

  if (currentView === 'active') shell.append(renderBoard('active'));
  else shell.append(renderSecondaryView(currentView));

  app.append(shell);

  if (menuOpen) renderMenu();
  if (popover) renderPopover();
  if (sheet) renderSheet();
  if (arrangeMode) attachDragListeners();
}

function renderHeader() {
  const header = document.createElement('header');
  header.className = 'app-header';

  const brand = document.createElement('div');
  brand.className = 'brand';
  brand.innerHTML = `<span class="brand-icon">${icons.logo}</span><span>Chatboard</span>`;

  const actions = document.createElement('div');
  actions.className = 'header-actions';
  const arrangeButton = button(`icon-button arrange-toggle${arrangeMode ? ' arrange-toggle--active' : ''}`, arrangeMode ? 'Done arranging' : 'Arrange', icons.arrange, () => {
    arrangeMode = !arrangeMode;
    menuOpen = false;
    popover = null;
    render();
  });
  arrangeButton.setAttribute('aria-pressed', String(arrangeMode));

  actions.append(
    button('icon-button', 'Add chat', icons.plus, () => openAddSheet()),
    arrangeButton,
    button('icon-button', 'Search', icons.search, () => { searchOpen = !searchOpen; query = searchOpen ? query : ''; render(); if (searchOpen) setTimeout(() => document.querySelector('.search-field')?.focus(), 0); }),
    button('icon-button', 'Menu', icons.menu, () => { menuOpen = !menuOpen; popover = null; render(); }),
  );

  header.append(brand, actions);
  return header;
}

function renderSyncLine() {
  const line = document.createElement('div');
  line.className = 'sync-line';
  const span = document.createElement('span');
  span.dataset.syncMessage = '';
  span.textContent = syncMessage;
  const right = document.createElement('span');
  if (isConnected()) {
    const syncBtn = document.createElement('button');
    syncBtn.type = 'button';
    syncBtn.textContent = 'Sync now';
    syncBtn.addEventListener('click', syncFromDropbox);
    right.append(syncBtn);
  }
  line.append(span, right);
  return line;
}

function renderSearch() {
  const wrap = document.createElement('div');
  wrap.className = 'search-wrap';
  const input = document.createElement('input');
  input.className = 'search-field';
  input.type = 'search';
  input.placeholder = 'Find a chat';
  input.value = query;
  input.addEventListener('input', e => { query = e.target.value; render(); requestAnimationFrame(() => { const f = document.querySelector('.search-field'); if (f) { f.focus(); f.setSelectionRange(query.length, query.length); } }); });
  wrap.append(input);
  return wrap;
}

function renderBoard(status) {
  const board = document.createElement('section');
  board.className = 'board-view';
  let shown = 0;

  for (const [categoryIndex, category] of state.categories.entries()) {
    const bookmarks = visibleBookmarks(category.id, status);
    if (status !== 'active' && !bookmarks.length) continue;
    if (status === 'active' && query && !bookmarks.length) continue;
    shown += bookmarks.length;
    board.append(renderCategory(category, categoryIndex, bookmarks, status));
  }

  if (!shown && status === 'active' && state.bookmarks.filter(b => b.status === 'active').length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-board';
    empty.innerHTML = '<strong>No chats yet.</strong>Tap + to add the first conversation. Chatboard titles are independent of the titles inside ChatGPT.';
    board.append(empty);
  } else if (!shown && query) {
    const empty = document.createElement('div');
    empty.className = 'empty-board';
    empty.textContent = 'No matching chats.';
    board.append(empty);
  }

  return board;
}

function renderCategory(category, categoryIndex, bookmarks, status) {
  const section = document.createElement('section');
  section.className = 'category-section';
  section.dataset.categoryId = category.id;

  const head = document.createElement('div');
  head.className = 'category-heading-row';

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'category-toggle';
  const visuallyCollapsed = category.collapsed && !query;
  toggle.innerHTML = `<span class="category-title-wrap"><span class="category-title"></span><span class="category-count">${bookmarks.length}</span></span>${visuallyCollapsed ? icons.chevronRight : icons.chevronDown}`;
  toggle.querySelector('.category-title').textContent = category.name.toUpperCase();
  toggle.addEventListener('click', () => {
    if (arrangeMode) return;
    category.collapsed = !category.collapsed;
    persist();
  });
  head.append(toggle);

  if (arrangeMode && status === 'active') {
    const tools = document.createElement('div');
    tools.className = 'category-tools';
    const drag = button('category-drag-handle', 'Drag category', icons.grip, () => {});
    drag.dataset.dragCategoryId = category.id;
    tools.append(
      drag,
      button('category-tool', 'Category actions', icons.more, e => openCategoryMenu(category, e.currentTarget)),
    );
    head.append(tools);
  }

  section.append(head);
  if (!category.collapsed || query) {
    const list = document.createElement('div');
    list.className = 'bookmark-list';
    list.dataset.categoryId = category.id;
    for (const [index, bookmark] of bookmarks.entries()) list.append(renderBookmark(bookmark, index, bookmarks, status));
    if (!bookmarks.length && status === 'active' && !query) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = 'No chats in this category.';
      list.append(empty);
    }
    section.append(list);
  }
  return section;
}

function renderBookmark(bookmark, index, siblings, status) {
  const row = document.createElement('div');
  row.className = 'bookmark-row';
  row.dataset.bookmarkId = bookmark.id;

  if (arrangeMode && status === 'active') {
    const drag = button('drag-handle', 'Drag chat', icons.grip, () => {});
    drag.dataset.dragBookmarkId = bookmark.id;
    row.append(drag);
  }

  if (bookmark._renaming) {
    const input = document.createElement('input');
    input.className = 'rename-input';
    input.value = bookmark.title;
    input.setAttribute('aria-label', 'Bookmark title');
    const saveRename = () => {
      const title = input.value.trim();
      delete bookmark._renaming;
      if (title && title !== bookmark.title) { bookmark.title = title; bookmark.updatedAt = new Date().toISOString(); persist(); }
      else render();
    };
    input.addEventListener('keydown', e => { if (e.key === 'Enter') saveRename(); if (e.key === 'Escape') { delete bookmark._renaming; render(); } });
    input.addEventListener('blur', saveRename);
    row.append(input);
    setTimeout(() => { input.focus(); input.select(); }, 0);
  } else {
    const link = document.createElement('a');
    link.className = 'bookmark-link';
    link.href = bookmark.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    const text = document.createElement('span');
    text.className = 'bookmark-link-text';
    text.textContent = bookmark.title;
    link.append(text);
    row.append(link);
  }

  row.append(button('bookmark-actions', 'Chat actions', icons.more, e => openBookmarkMenu(bookmark, e.currentTarget)));
  return row;
}

function renderSecondaryView(status) {
  const wrap = document.createElement('div');
  const header = document.createElement('div');
  header.className = 'view-header';
  header.append(button('back-button', 'Back', icons.back, () => setView('active')));
  const h1 = document.createElement('h1');
  h1.textContent = status === 'hidden' ? 'Hidden' : 'Archive';
  header.append(h1);
  wrap.append(header);

  const board = renderBoard(status);
  if (!totalFor(status)) {
    board.innerHTML = '';
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = status === 'hidden' ? 'No hidden chats.' : 'No archived chats.';
    board.append(empty);
  }
  wrap.append(board);
  return wrap;
}

function renderFloatingAdd() {
  const pill = document.createElement('div');
  pill.className = 'floating-pill';
  pill.append(button('floating-button', 'Add chat', icons.plus, () => openAddSheet()));
  return pill;
}

function renderMenu() {
  const scrim = document.createElement('div');
  scrim.className = 'scrim';
  scrim.addEventListener('click', () => { menuOpen = false; render(); });
  document.body.append(scrim);

  const panel = document.createElement('div');
  panel.className = 'menu-panel';

  const item = (label, note, fn) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'menu-item';
    const l = document.createElement('span'); l.textContent = label;
    const n = document.createElement('small'); n.textContent = note || '';
    b.append(l, n);
    b.addEventListener('click', fn);
    return b;
  };

  panel.append(
    item('Hidden', totalFor('hidden') ? `${totalFor('hidden')} · Temporary` : 'Temporary', () => setView('hidden')),
    item('Archive', totalFor('archived') ? `${totalFor('archived')} · Long-term` : 'Long-term', () => setView('archived')),
    item('Add category', 'Organize', () => openCategorySheet()),
    item('Expand all', 'Sections', expandAllCategories),
    item('Collapse all', 'Sections', collapseAllCategories),
    item('Bookmarklet', 'Setup', () => openBookmarkletSheet()),
    item(isConnected() ? 'Dropbox' : 'Connect Dropbox', isConnected() ? 'Connected' : '', () => openDropboxSheet()),
  );

  const controls = document.createElement('div');
  controls.className = 'menu-control-row';
  const label = document.createElement('div');
  label.className = 'menu-label';
  label.textContent = 'Font size';
  const sizes = document.createElement('div');
  sizes.className = 'font-size-controls';
  const rawCurrent = localStorage.getItem(FONT_KEY) || '22';
  const legacyFontMap = { small: '20', medium: '22', large: '24' };
  const current = legacyFontMap[rawCurrent] || rawCurrent;
  ['18','20','22','24','26','28'].forEach(value => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = value;
    b.setAttribute('aria-label', `${value} pixel base font`);
    b.setAttribute('aria-pressed', String(current === value));
    b.addEventListener('click', () => { localStorage.setItem(FONT_KEY, value); render(); });
    sizes.append(b);
  });
  controls.append(label, sizes);
  panel.append(controls);

  const version = document.createElement('div');
  version.className = 'menu-version';
  version.textContent = `Chatboard v${VERSION}`;
  panel.append(version);
  document.body.append(panel);
}

function openBookmarkMenu(bookmark, anchor) {
  const rect = anchor.getBoundingClientRect();
  popover = { type: 'bookmark', bookmarkId: bookmark.id, x: Math.min(rect.right, innerWidth - 12), y: Math.min(rect.bottom + 6, innerHeight - 250) };
  menuOpen = false;
  render();
}

function openCategoryMenu(category, anchor) {
  const rect = anchor.getBoundingClientRect();
  popover = { type: 'category', categoryId: category.id, x: Math.min(rect.right, innerWidth - 12), y: Math.min(rect.bottom + 6, innerHeight - 180) };
  render();
}

function renderPopover() {
  const scrim = document.createElement('div');
  scrim.className = 'popover-scrim';
  scrim.addEventListener('click', () => { popover = null; render(); });
  document.body.append(scrim);

  const p = document.createElement('div');
  p.className = 'popover';
  p.style.top = `${Math.max(10, popover.y)}px`;
  p.style.left = `${Math.max(10, popover.x - Math.min(238, innerWidth - 30))}px`;

  const action = (label, fn, cls='') => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.textContent = label;
    b.addEventListener('click', () => { popover = null; p.remove(); scrim.remove(); fn(); });
    p.append(b);
  };

  if (popover.type === 'bookmark') {
    const bookmark = state.bookmarks.find(b => b.id === popover.bookmarkId);
    if (!bookmark) return;
    action('Rename', () => { bookmark._renaming = true; render(); });
    action('Edit', () => openEditSheet(bookmark));
    if (bookmark.status === 'active') {
      action('Hide for now', () => changeStatus(bookmark, 'hidden'));
      action('Archive as finished', () => changeStatus(bookmark, 'archived'));
    } else if (bookmark.status === 'hidden') {
      action('Restore', () => changeStatus(bookmark, 'active'));
      action('Archive as finished', () => changeStatus(bookmark, 'archived'));
    } else {
      action('Restore', () => changeStatus(bookmark, 'active'));
      action('Delete permanently', () => deleteBookmark(bookmark), 'danger');
    }
  } else {
    const category = state.categories.find(c => c.id === popover.categoryId);
    if (!category) return;
    action('Sort chats A–Z', () => sortCategoryAlphabetically(category));
    action('Rename category', () => openCategorySheet(category));
    action('Delete empty category', () => deleteCategory(category), 'danger');
  }

  document.body.append(p);
}

function closeSheet() {
  if (sheet?.type === 'add' && captureReturnUrl()) {
    returnFromCapture();
    return;
  }
  sheet = null;
  render();
}

function renderSheet() {
  const scrim = document.createElement('div');
  scrim.className = 'sheet-scrim';
  scrim.addEventListener('click', e => { if (e.target === scrim) closeSheet(); });
  document.body.append(scrim);

  const panel = document.createElement('div');
  panel.className = (sheet.type === 'add' || sheet.type === 'edit') ? 'sheet sheet--modal' : 'sheet';
  panel.append(sheetContent());
  document.body.append(panel);
}

function sheetHeader(title) {
  const head = document.createElement('div');
  head.className = 'sheet-header';
  const h = document.createElement('h2'); h.textContent = title;
  head.append(h, button('icon-button', 'Close', icons.close, closeSheet));
  return head;
}

function field(labelText, input) {
  const wrap = document.createElement('div');
  const label = document.createElement('label');
  label.className = 'field-label';
  label.textContent = labelText;
  label.append(input);
  wrap.append(label);
  return wrap;
}

function textInput(value='', placeholder='') {
  const input = document.createElement('input');
  input.className = 'text-field';
  input.value = value;
  input.placeholder = placeholder;
  return input;
}

function categorySelect(selected) {
  const select = document.createElement('select');
  select.className = 'select-field';
  for (const category of state.categories) {
    const option = document.createElement('option');
    option.value = category.id;
    option.textContent = category.name;
    option.selected = category.id === selected;
    select.append(option);
  }
  const newOption = document.createElement('option');
  newOption.value = '__new__';
  newOption.textContent = '+ New category…';
  select.append(newOption);
  return select;
}

function openAddSheet(prefill = {}) {
  const params = new URLSearchParams(location.search);
  const url = prefill.url || params.get('url') || '';
  const title = prefill.title || params.get('title') || '';
  sheet = { type: 'add', url, title };
  menuOpen = false;
  render();
}

function openEditSheet(bookmark) { sheet = { type: 'edit', bookmarkId: bookmark.id }; render(); }
function openCategorySheet(category = null) { sheet = { type: 'category', categoryId: category?.id || null }; menuOpen = false; render(); }
function openBookmarkletSheet() { sheet = { type: 'bookmarklet' }; menuOpen = false; render(); }
function openDropboxSheet() { sheet = { type: 'dropbox' }; menuOpen = false; render(); }

function sheetContent() {
  const frag = document.createDocumentFragment();

  if (sheet.type === 'add' || sheet.type === 'edit') {
    const editing = sheet.type === 'edit';
    const bookmark = editing ? state.bookmarks.find(b => b.id === sheet.bookmarkId) : null;
    frag.append(sheetHeader(editing ? 'Edit chat' : 'Add chat'));

    const title = textInput(bookmark?.title || sheet.title || '', 'Chatboard title');
    const url = textInput(bookmark?.url || sheet.url || '', 'https://chatgpt.com/c/…');
    url.type = 'url';
    const category = categorySelect(bookmark?.categoryId || state.categories[0]?.id);
    const newCategory = textInput('', 'New category name');
    newCategory.style.display = 'none';
    category.addEventListener('change', () => { newCategory.style.display = category.value === '__new__' ? 'block' : 'none'; });

    frag.append(field('Title', title), field('Chat URL', url), field('Category', category), newCategory);
    const note = document.createElement('div');
    note.className = 'sheet-note';
    note.textContent = 'The title here is only for Chatboard. Renaming it never changes the conversation inside ChatGPT.';
    frag.append(note);

    const actions = document.createElement('div');
    actions.className = 'sheet-actions';
    const save = document.createElement('button');
    save.type = 'button'; save.className = 'primary-button'; save.textContent = editing ? 'Save changes' : 'Add chat';
    save.addEventListener('click', async () => {
      const cleanUrl = url.value.trim();
      let parsed;
      try { parsed = new URL(cleanUrl); if (!['http:','https:'].includes(parsed.protocol)) throw new Error(); }
      catch { toast('Enter a valid chat URL.'); url.focus(); return; }
      let categoryId = category.value;
      if (categoryId === '__new__') {
        const name = newCategory.value.trim();
        if (!name) { toast('Name the new category.'); newCategory.focus(); return; }
        const newCat = { id: uid('cat'), name, collapsed: false };
        state.categories.push(newCat);
        categoryId = newCat.id;
      }
      const cleanTitle = title.value.trim() || escapeForTitle(cleanUrl);
      if (editing) {
        bookmark.title = cleanTitle;
        bookmark.url = cleanUrl;
        bookmark.categoryId = categoryId;
        bookmark.updatedAt = new Date().toISOString();
      } else {
        state.bookmarks.push({ id: uid('bm'), title: cleanTitle, url: cleanUrl, categoryId, status: 'active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      }
      const returnTarget = !editing ? captureReturnUrl() : '';
      sheet = null;
      if (returnTarget) {
        persist({ sync: false });
        if (isConnected()) {
          setSyncMessage('Saving…');
          try {
            await uploadBoard(state);
            setSyncMessage('✓ Synced');
          } catch (error) {
            console.error(error);
            setSyncMessage('Offline · saved locally');
          }
        }
        returnFromCapture();
        return;
      }
      clearCaptureParams();
      persist();
      toast(editing ? 'Chat updated.' : 'Chat added.');
    });
    actions.append(save);
    if (editing) {
      const renameHint = document.createElement('button');
      renameHint.type = 'button'; renameHint.className = 'text-button'; renameHint.textContent = 'Cancel'; renameHint.addEventListener('click', closeSheet); actions.append(renameHint);
    }
    frag.append(actions);
    setTimeout(() => (title.value ? url : title).focus(), 0);
    return frag;
  }

  if (sheet.type === 'category') {
    const category = sheet.categoryId ? state.categories.find(c => c.id === sheet.categoryId) : null;
    frag.append(sheetHeader(category ? 'Rename category' : 'Add category'));
    const name = textInput(category?.name || '', 'Category name');
    frag.append(field('Name', name));
    const save = document.createElement('button');
    save.type = 'button'; save.className = 'primary-button'; save.textContent = category ? 'Save name' : 'Add category';
    save.addEventListener('click', () => {
      const clean = name.value.trim();
      if (!clean) { toast('Enter a category name.'); return; }
      if (category) category.name = clean;
      else state.categories.push({ id: uid('cat'), name: clean, collapsed: false });
      sheet = null; persist();
    });
    frag.append(save);
    setTimeout(() => { name.focus(); name.select(); }, 0);
    return frag;
  }

  if (sheet.type === 'bookmarklet') {
    frag.append(sheetHeader('Bookmarklet'));
    const code = bookmarkletCode();

    const intro = document.createElement('div');
    intro.className = 'sheet-note bookmarklet-intro';
    intro.textContent = 'Save to Chatboard temporarily opens Chatboard in the current tab. After you add or cancel, it returns to the same ChatGPT conversation. It never changes the conversation in ChatGPT.';
    frag.append(intro);

    const desktopTitle = document.createElement('div');
    desktopTitle.className = 'settings-subheading';
    desktopTitle.textContent = 'Mac / desktop';
    frag.append(desktopTitle);

    const dragLink = document.createElement('a');
    dragLink.className = 'bookmarklet-link';
    dragLink.href = code;
    dragLink.textContent = 'Save to Chatboard';
    dragLink.title = 'Drag this link to your bookmarks bar';
    dragLink.addEventListener('click', event => {
      event.preventDefault();
      toast('Drag this button to the bookmarks bar.');
    });
    frag.append(dragLink);

    const desktopHelp = document.createElement('div');
    desktopHelp.className = 'sheet-note';
    desktopHelp.textContent = 'Drag the button above to the bookmarks bar. While viewing a ChatGPT conversation, click it to open Chatboard in the same tab; Save or Cancel returns you to the conversation.';
    frag.append(desktopHelp);

    const mobileTitle = document.createElement('div');
    mobileTitle.className = 'settings-subheading';
    mobileTitle.textContent = 'iPhone / iPad Safari';
    frag.append(mobileTitle);

    const steps = document.createElement('ol');
    steps.className = 'setup-steps';
    for (const text of [
      'Tap Copy bookmarklet below.',
      'Create a normal Safari bookmark for this Chatboard page.',
      'Open Bookmarks, tap Edit, and choose that bookmark.',
      'Rename it “Save to Chatboard” and replace its address with the copied bookmarklet code.',
      'While viewing a ChatGPT conversation in Safari, run Save to Chatboard from your bookmarks. Save or Cancel returns to the conversation.'
    ]) {
      const li = document.createElement('li');
      li.textContent = text;
      steps.append(li);
    }
    frag.append(steps);

    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'primary-button';
    copy.textContent = 'Copy bookmarklet';
    copy.addEventListener('click', () => copyText(code, 'Bookmarklet copied.'));
    frag.append(copy);

    const mobileNote = document.createElement('div');
    mobileNote.className = 'sheet-note bookmarklet-footnote';
    mobileNote.textContent = 'Bookmarklets run from browser pages. For capture directly from the ChatGPT iPhone/iPad app, an iOS Share Sheet Shortcut is a separate option we can add.';
    frag.append(mobileNote);
    return frag;
  }

  if (sheet.type === 'dropbox') {
    frag.append(sheetHeader('Dropbox'));
    const redirect = getRedirectUri();

    const status = document.createElement('div');
    status.className = 'sheet-note dropbox-status';
    status.textContent = isConnected()
      ? 'Dropbox is connected. Chatboard syncs this board through its private Dropbox app folder.'
      : 'Dropbox is ready to connect. Chatboard will only use its private Dropbox app folder.';
    frag.append(status);

    const note = document.createElement('div');
    note.className = 'sheet-note';
    note.textContent = `Registered redirect: ${redirect}`;
    frag.append(note);

    const actions = document.createElement('div'); actions.className = 'sheet-actions';
    const connect = document.createElement('button');
    connect.type = 'button';
    connect.className = 'primary-button';
    connect.textContent = isConnected() ? 'Reconnect Dropbox' : 'Connect Dropbox';
    connect.addEventListener('click', async () => {
      try { await beginDropboxConnect(location.href); } catch (error) { toast(error.message); }
    });
    actions.append(connect);

    if (isConnected()) {
      const disconnect = document.createElement('button');
      disconnect.type = 'button'; disconnect.className = 'secondary-button'; disconnect.textContent = 'Disconnect Dropbox';
      disconnect.addEventListener('click', () => { disconnectDropbox(); syncMessage = 'Local cache'; sheet = null; render(); toast('Dropbox disconnected.'); });
      actions.append(disconnect);
    }
    frag.append(actions);
    return frag;
  }

  return frag;
}

function clearCaptureParams() {
  const url = new URL(location.href);
  ['add','url','title','return'].forEach(k => url.searchParams.delete(k));
  history.replaceState({}, '', url.toString());
}

function changeStatus(bookmark, status) {
  bookmark.status = status;
  bookmark.updatedAt = new Date().toISOString();
  persist();
  toast(status === 'active' ? 'Restored.' : status === 'hidden' ? 'Hidden.' : 'Archived.');
}

function deleteBookmark(bookmark) {
  if (!confirm(`Delete “${bookmark.title}” from Chatboard permanently? This will not delete the ChatGPT conversation.`)) { render(); return; }
  state.bookmarks = state.bookmarks.filter(b => b.id !== bookmark.id);
  persist();
  toast('Bookmark deleted.');
}

function deleteCategory(category) {
  if (state.bookmarks.some(b => b.categoryId === category.id)) { toast('Move or delete its chats first.'); render(); return; }
  if (state.categories.length === 1) { toast('Keep at least one category.'); render(); return; }
  state.categories = state.categories.filter(c => c.id !== category.id);
  persist();
}

function clearDropIndicators() {
  document.querySelectorAll('.drop-before,.drop-after,.drop-end,.category-drop-before,.category-drop-after,.bookmark-drop-target').forEach(el => {
    el.classList.remove('drop-before','drop-after','drop-end','category-drop-before','category-drop-after','bookmark-drop-target');
  });
}

function startPointerDrag(event, type, id, sourceEl, handle) {
  if (event.button !== undefined && event.button !== 0) return;
  event.preventDefault();
  pointerDrag = { type, id, sourceEl, handle, pointerId: event.pointerId, drop: null };
  dragging = pointerDrag;
  sourceEl.classList.add(type === 'bookmark' ? 'bookmark-row--dragging' : 'category-section--dragging');
  document.body.classList.add('arrange-dragging');
  try { handle.setPointerCapture(event.pointerId); } catch {}
}

function maybeAutoScroll(clientY) {
  const edge = 72;
  const speed = 14;
  if (clientY < edge) window.scrollBy(0, -speed);
  else if (clientY > innerHeight - edge) window.scrollBy(0, speed);
}

function updateBookmarkDrop(clientX, clientY) {
  clearDropIndicators();
  const under = document.elementFromPoint(clientX, clientY);
  if (!under) return null;

  const row = under.closest('.bookmark-row');
  if (row) {
    if (row.dataset.bookmarkId === pointerDrag.id) return null;
    const list = row.closest('.bookmark-list');
    if (!list) return null;
    const rect = row.getBoundingClientRect();
    const position = clientY < rect.top + rect.height / 2 ? 'before' : 'after';
    row.classList.add(position === 'before' ? 'drop-before' : 'drop-after');
    return { categoryId: list.dataset.categoryId, targetId: row.dataset.bookmarkId, position };
  }

  const list = under.closest('.bookmark-list');
  if (list) {
    list.classList.add('drop-end');
    return { categoryId: list.dataset.categoryId, targetId: null, position: 'end' };
  }

  const section = under.closest('.category-section');
  if (section) {
    section.querySelector('.category-heading-row')?.classList.add('bookmark-drop-target');
    return { categoryId: section.dataset.categoryId, targetId: null, position: 'end' };
  }
  return null;
}

function updateCategoryDrop(clientX, clientY) {
  clearDropIndicators();
  const under = document.elementFromPoint(clientX, clientY);
  if (!under) return null;
  const section = under.closest('.category-section');
  if (!section || section.dataset.categoryId === pointerDrag.id) return null;
  const rect = section.getBoundingClientRect();
  const position = clientY < rect.top + rect.height / 2 ? 'before' : 'after';
  section.classList.add(position === 'before' ? 'category-drop-before' : 'category-drop-after');
  return { targetId: section.dataset.categoryId, position };
}

function onPointerMove(event) {
  if (!pointerDrag || event.pointerId !== pointerDrag.pointerId) return;
  event.preventDefault();
  maybeAutoScroll(event.clientY);
  pointerDrag.drop = pointerDrag.type === 'bookmark'
    ? updateBookmarkDrop(event.clientX, event.clientY)
    : updateCategoryDrop(event.clientX, event.clientY);
}

function applyBookmarkDrop(bookmarkId, drop) {
  if (!drop?.categoryId) return false;
  const dragged = state.bookmarks.find(b => b.id === bookmarkId);
  if (!dragged) return false;

  const filtered = state.bookmarks.filter(b => b.id !== bookmarkId);
  dragged.categoryId = drop.categoryId;
  dragged.updatedAt = new Date().toISOString();

  let insertIndex = filtered.length;
  if (drop.targetId) {
    const targetIndex = filtered.findIndex(b => b.id === drop.targetId);
    if (targetIndex >= 0) insertIndex = targetIndex + (drop.position === 'after' ? 1 : 0);
  } else {
    const targetItems = filtered.filter(b => b.status === 'active' && b.categoryId === drop.categoryId);
    if (targetItems.length) insertIndex = filtered.indexOf(targetItems[targetItems.length - 1]) + 1;
  }

  filtered.splice(Math.max(0, insertIndex), 0, dragged);
  state.bookmarks = filtered;
  return true;
}

function applyCategoryDrop(categoryId, drop) {
  if (!drop?.targetId || drop.targetId === categoryId) return false;
  const dragged = state.categories.find(c => c.id === categoryId);
  if (!dragged) return false;
  const filtered = state.categories.filter(c => c.id !== categoryId);
  const targetIndex = filtered.findIndex(c => c.id === drop.targetId);
  if (targetIndex < 0) return false;
  const insertIndex = targetIndex + (drop.position === 'after' ? 1 : 0);
  filtered.splice(insertIndex, 0, dragged);
  state.categories = filtered;
  return true;
}

function finishPointerDrag(event) {
  if (!pointerDrag || event.pointerId !== pointerDrag.pointerId) return;
  const active = pointerDrag;
  const changed = active.type === 'bookmark'
    ? applyBookmarkDrop(active.id, active.drop)
    : applyCategoryDrop(active.id, active.drop);

  try { active.handle.releasePointerCapture(event.pointerId); } catch {}
  active.sourceEl.classList.remove('bookmark-row--dragging','category-section--dragging');
  document.body.classList.remove('arrange-dragging');
  clearDropIndicators();
  pointerDrag = null;
  dragging = null;
  if (changed) persist();
  else render();
}

function cancelPointerDrag(event) {
  if (!pointerDrag || (event.pointerId !== undefined && event.pointerId !== pointerDrag.pointerId)) return;
  const active = pointerDrag;
  active.sourceEl.classList.remove('bookmark-row--dragging','category-section--dragging');
  document.body.classList.remove('arrange-dragging');
  clearDropIndicators();
  pointerDrag = null;
  dragging = null;
  render();
}

function attachDragListeners() {
  document.querySelectorAll('[data-drag-bookmark-id]').forEach(handle => {
    const row = handle.closest('.bookmark-row');
    handle.addEventListener('pointerdown', event => startPointerDrag(event, 'bookmark', handle.dataset.dragBookmarkId, row, handle));
    handle.addEventListener('pointermove', onPointerMove);
    handle.addEventListener('pointerup', finishPointerDrag);
    handle.addEventListener('pointercancel', cancelPointerDrag);
  });

  document.querySelectorAll('[data-drag-category-id]').forEach(handle => {
    const section = handle.closest('.category-section');
    handle.addEventListener('pointerdown', event => startPointerDrag(event, 'category', handle.dataset.dragCategoryId, section, handle));
    handle.addEventListener('pointermove', onPointerMove);
    handle.addEventListener('pointerup', finishPointerDrag);
    handle.addEventListener('pointercancel', cancelPointerDrag);
  });
}

async function exportBackup() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `chatboard-backup-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function init() {
  try {
    const completed = await finishDropboxCallback();
    if (completed) { syncMessage = 'Dropbox connected'; toast('Dropbox connected.'); }
  } catch (error) {
    console.error(error);
    toast(error.message || 'Dropbox connection failed.');
  }

  const params = new URLSearchParams(location.search);
  if (params.get('add') === '1' || params.get('url')) {
    currentView = 'active';
    sheet = { type: 'add', url: params.get('url') || '', title: params.get('title') || '' };
  }

  render();
  if (isConnected()) syncFromDropbox();
  window.addEventListener('online', syncFromDropbox);
  window.addEventListener('beforeunload', () => clearTimeout(syncTimer));

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(console.warn);
}

init();
