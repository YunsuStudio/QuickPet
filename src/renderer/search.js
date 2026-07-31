'use strict';

const input = document.querySelector('#globalSearchInput');
const inputWrap = document.querySelector('#searchInputWrap');
const results = document.querySelector('#globalSearchResults');
const hint = document.querySelector('#searchHint');
const shortcutHint = document.querySelector('#shortcutHint');
const title = document.querySelector('#windowTitle');
const modeButtons = [...document.querySelectorAll('[data-mode]')];
let state = { shortcuts: [], categories: [], settings: {} };
let visibleItems = [];
let selectedIndex = 0;
let mode = 'search';

function escapeHtml(value = '') {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

function iconFor(type) {
  return { website: '◎', app: '▣', folder: '▤', file: '◇' }[type] || '◆';
}

function formatHotkey(value = '') {
  return String(value).replace('CommandOrControl', 'Ctrl').replaceAll('+', ' + ');
}

function sortedShortcuts() {
  return [...state.shortcuts].sort((a, b) => Number(b.favorite) - Number(a.favorite) || b.useCount - a.useCount || b.lastUsedAt - a.lastUsedAt || a.name.localeCompare(b.name, 'zh-CN'));
}

function renderSearch() {
  const query = input.value.trim().toLowerCase();
  const commandMode = query.startsWith('>');
  const commandQuery = commandMode ? query.slice(1).trim() : query;
  const commands = (state.commands || [])
    .filter((item) => (commandMode || query) && (!commandQuery || `${item.name} ${item.detail} ${item.keywords}`.toLowerCase().includes(commandQuery)))
    .map((item) => ({ ...item, kind: 'command' }));
  const shortcuts = sortedShortcuts()
    .map((item) => ({ ...item, kind: 'shortcut' }))
    .filter(() => !commandMode)
    .filter((item) => !query || `${item.name} ${item.target} ${(item.tags || []).join(' ')}`.toLowerCase().includes(query));
  visibleItems = [...commands, ...shortcuts].slice(0, 7);
  selectedIndex = Math.min(selectedIndex, Math.max(0, visibleItems.length - 1));
  hint.textContent = visibleItems.length ? `${visibleItems.length} 个结果${commandMode ? ' · 命令' : ''}` : '没有匹配的项目';
  results.className = 'search-results';
  results.innerHTML = visibleItems.length ? visibleItems.map((item, index) => {
    if (item.kind === 'command') return `<button class="result command-result ${index === selectedIndex ? 'active' : ''}" data-index="${index}"><span class="result-icon">${escapeHtml(item.icon)}</span><span class="result-copy"><b>${escapeHtml(item.name)}</b><small>${escapeHtml(item.detail)}</small></span><span class="result-source">命令</span></button>`;
    const category = state.categories.find((entry) => entry.id === item.category);
    return `<button class="result ${index === selectedIndex ? 'active' : ''}" data-index="${index}"><span class="result-icon">${iconFor(item.type)}</span><span class="result-copy"><b>${escapeHtml(item.name)}</b><small>${escapeHtml(item.target)}</small></span><span class="result-source">${escapeHtml(category?.name || '其他')}</span></button>`;
  }).join('') : '<div class="empty"><i>⌕</i><b>没有找到</b><span>试试名称、标签或路径中的其他文字</span></div>';
}

function renderLauncher() {
  visibleItems = sortedShortcuts().slice(0, 12).map((item) => ({ ...item, kind: 'shortcut' }));
  selectedIndex = Math.min(selectedIndex, Math.max(0, visibleItems.length - 1));
  hint.textContent = visibleItems.length ? `${visibleItems.length} 个常用项目` : '启动台还是空的';
  results.className = 'search-results launcher-grid';
  results.innerHTML = visibleItems.length ? visibleItems.map((item, index) => `
    <button class="launcher-item ${index === selectedIndex ? 'active' : ''}" data-index="${index}">
      <span class="launcher-icon">${iconFor(item.type)}</span>
      <span><b>${escapeHtml(item.name)}</b><small>${escapeHtml(item.favorite ? '收藏' : state.categories.find((entry) => entry.id === item.category)?.name || '其他')}</small></span>
      ${item.hotkey ? `<kbd>${escapeHtml(formatHotkey(item.hotkey))}</kbd>` : ''}
    </button>`).join('') : '<div class="empty launcher-empty"><i>▦</i><b>暂无快捷项目</b><span>在主面板添加后会自动显示在这里</span></div>';
}

function render() {
  title.textContent = mode === 'launcher' ? '快捷启动台' : '快捷搜索';
  inputWrap.classList.toggle('hidden', mode !== 'search');
  shortcutHint.textContent = formatHotkey(mode === 'launcher' ? state.settings.quickLaunchShortcut : state.settings.globalSearchShortcut);
  modeButtons.forEach((button) => {
    const active = button.dataset.mode === mode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  if (mode === 'launcher') renderLauncher();
  else renderSearch();
  results.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
}

function setMode(nextMode, { focus = true } = {}) {
  mode = nextMode === 'launcher' ? 'launcher' : 'search';
  input.value = '';
  selectedIndex = 0;
  render();
  if (focus && mode === 'search') setTimeout(() => input.focus(), 20);
}

async function openSelected(index = selectedIndex) {
  const item = visibleItems[index];
  if (!item) return;
  window.quickPet.hideSearch();
  try {
    if (item.kind === 'command') await window.quickPet.executeCommand(item.id);
    else await window.quickPet.openShortcut(item.id);
  } catch {}
}

input.addEventListener('input', () => { selectedIndex = 0; render(); });
modeButtons.forEach((button) => button.addEventListener('click', () => setMode(button.dataset.mode)));
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') return window.quickPet.hideSearch();
  const columns = mode === 'launcher' ? 3 : 1;
  if (event.key === 'ArrowDown') selectedIndex = Math.min(visibleItems.length - 1, selectedIndex + columns);
  else if (event.key === 'ArrowUp') selectedIndex = Math.max(0, selectedIndex - columns);
  else if (event.key === 'ArrowRight' && mode === 'launcher') selectedIndex = Math.min(visibleItems.length - 1, selectedIndex + 1);
  else if (event.key === 'ArrowLeft' && mode === 'launcher') selectedIndex = Math.max(0, selectedIndex - 1);
  else if (event.key === 'Enter') return openSelected();
  else return;
  event.preventDefault();
  render();
});
results.addEventListener('click', (event) => {
  const button = event.target.closest('[data-index]');
  if (button) openSelected(Number(button.dataset.index));
});

window.quickPet.getState().then((next) => { state = next; render(); input.focus(); });
window.quickPet.onStateChanged((next) => { state = next; render(); });
window.quickPet.onSearchFocus((nextMode) => setMode(nextMode));
