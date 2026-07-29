'use strict';

const input = document.querySelector('#globalSearchInput');
const results = document.querySelector('#globalSearchResults');
const hint = document.querySelector('#searchHint');
let state = { shortcuts: [], categories: [], settings: {} };
let visibleItems = [];
let selectedIndex = 0;

function escapeHtml(value = '') {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

function iconFor(type) {
  return { website: '◉', app: '▣', folder: '▤', file: '◇' }[type] || '✦';
}

function render() {
  const query = input.value.trim().toLowerCase();
  const commandMode = query.startsWith('>');
  const commandQuery = commandMode ? query.slice(1).trim() : query;
  const commands = (state.commands || [])
    .filter((item) => (commandMode || query) && (!commandQuery || `${item.name} ${item.detail} ${item.keywords}`.toLowerCase().includes(commandQuery)))
    .map((item) => ({ ...item, kind: 'command' }));
  const shortcuts = [...state.shortcuts]
    .map((item) => ({ ...item, kind: 'shortcut' }))
    .filter(() => !commandMode)
    .filter((item) => !query || `${item.name} ${item.target} ${(item.tags || []).join(' ')}`.toLowerCase().includes(query))
    .sort((a, b) => Number(b.favorite) - Number(a.favorite) || b.useCount - a.useCount || b.lastUsedAt - a.lastUsedAt)
  visibleItems = [...commands, ...shortcuts].slice(0, 8);
  selectedIndex = Math.min(selectedIndex, Math.max(0, visibleItems.length - 1));
  hint.textContent = visibleItems.length ? `${visibleItems.length} 个结果${commandMode ? ' · 命令' : ''}` : '没有匹配的快捷方式或命令';
  results.innerHTML = visibleItems.length ? visibleItems.map((item, index) => {
    if (item.kind === 'command') return `<button class="result command-result ${index === selectedIndex ? 'active' : ''}" data-index="${index}"><span class="result-icon">${escapeHtml(item.icon)}</span><span class="result-copy"><b>${escapeHtml(item.name)}</b><small>${escapeHtml(item.detail)}</small></span><span class="result-source">命令</span></button>`;
    const category = state.categories.find((entry) => entry.id === item.category);
    return `<button class="result ${index === selectedIndex ? 'active' : ''}" data-index="${index}"><span class="result-icon">${iconFor(item.type)}</span><span class="result-copy"><b>${escapeHtml(item.name)}</b><small>${escapeHtml(item.target)}</small></span><span class="result-source">${escapeHtml(category?.name || '其他')}</span></button>`;
  }).join('') : '<div class="empty">换个关键词，或输入 &gt; 查看全部命令。</div>';
  results.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
}

async function openSelected(index = selectedIndex) {
  const item = visibleItems[index];
  if (!item) return;
  try {
    if (item.kind === 'command') await window.quickPet.executeCommand(item.id);
    else await window.quickPet.openShortcut(item.id);
    window.quickPet.hideSearch();
  } catch (error) {
    hint.textContent = String(error?.message || error).replace(/^Error invoking remote method '[^']+': Error: /, '');
  }
}

input.addEventListener('input', () => { selectedIndex = 0; render(); });
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') return window.quickPet.hideSearch();
  if (event.key === 'ArrowDown') selectedIndex = Math.min(visibleItems.length - 1, selectedIndex + 1);
  else if (event.key === 'ArrowUp') selectedIndex = Math.max(0, selectedIndex - 1);
  else if (event.key === 'Enter') return openSelected();
  else return;
  event.preventDefault();
  render();
});
results.addEventListener('click', (event) => {
  const button = event.target.closest('.result');
  if (button) openSelected(Number(button.dataset.index));
});

window.quickPet.getState().then((next) => { state = next; render(); input.focus(); });
window.quickPet.onStateChanged((next) => { state = next; render(); });
window.quickPet.onSearchFocus(() => { input.value = ''; selectedIndex = 0; render(); setTimeout(() => input.focus(), 20); });
