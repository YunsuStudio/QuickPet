'use strict';

const $ = (selector) => document.querySelector(selector);
const elements = {
  libraryView: $('#libraryView'),
  settingsView: $('#settingsView'),
  automationView: $('#automationView'),
  quickNav: $('#quickNav'),
  categoryNav: $('#categoryNav'),
  shortcutGrid: $('#shortcutGrid'),
  emptyState: $('#emptyState'),
  allCount: $('#allCount'),
  favoriteCount: $('#favoriteCount'),
  viewTitle: $('#viewTitle'),
  currentEyebrow: $('#currentEyebrow'),
  summaryText: $('#summaryText'),
  searchInput: $('#searchInput'),
  sortSelect: $('#sortSelect'),
  modal: $('#shortcutModal'),
  form: $('#shortcutForm'),
  modalTitle: $('#modalTitle'),
  editId: $('#editIdInput'),
  nameInput: $('#nameInput'),
  targetInput: $('#targetInput'),
  typeInput: $('#typeInput'),
  categoryInput: $('#categoryInput'),
  hotkeyInput: $('#hotkeyInput'),
  tagsInput: $('#tagsInput'),
  favoriteInput: $('#favoriteInput'),
  launcherInput: $('#launcherInput'),
  toast: $('#toast'),
  dropOverlay: $('#dropOverlay'),
  categoryManager: $('#categoryManager'),
  confirmModal: $('#confirmModal'),
  confirmTitle: $('#confirmTitle'),
  confirmMessage: $('#confirmMessage'),
  confirmButton: $('#confirmButton')
};

let state = { shortcuts: [], categories: [], settings: {} };
let currentView = 'all';
let searchTerm = '';
let dragDepth = 0;
let toastTimer;
let checking = false;
let scannedCandidates = [];
let modelPreview = null;
let modelPreviewRenderer = null;
let draggedShortcutId = '';
let dragIndicatorCard = null;
let dragInsertAfter = false;
let confirmResolver = null;
let confirmRestoreFocus = null;
let backups = [];
let storageReport = null;
let cacheCleanupRunning = false;
let cacheCleanupProgress = null;
let calendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let reminderFilter = 'all';

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function cleanError(error) {
  return String(error?.message || error || '操作失败')
    .replace(/^Error invoking remote method '[^']+': Error: /, '')
    .replace(/^Error: /, '');
}

function formatHotkey(value = '') {
  return String(value).replace('CommandOrControl', 'Ctrl').replace('Super', 'Win');
}

function hotkeyFromKeyboardEvent(event) {
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return null;
  if ((event.key === 'Backspace' || event.key === 'Delete') && !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey) return '';
  const modifiers = [];
  if (event.ctrlKey) modifiers.push('Ctrl');
  if (event.altKey) modifiers.push('Alt');
  if (event.shiftKey) modifiers.push('Shift');
  if (event.metaKey) modifiers.push('Win');
  if (!modifiers.length) return null;
  const aliases = { ' ': 'Space', Escape: 'Escape', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right' };
  const key = aliases[event.key] || (/^[a-z0-9]$/i.test(event.key) ? event.key.toUpperCase() : /^F(?:[1-9]|1\d|2[0-4])$/.test(event.key) ? event.key : ['Tab', 'Enter', 'Home', 'End', 'PageUp', 'PageDown', 'Insert', 'Delete', 'Backspace'].includes(event.key) ? event.key : '');
  return key ? [...modifiers, key].join('+') : null;
}

function showToast(message, type = 'success') {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.className = `toast ${type === 'error' ? 'error' : ''}`;
  requestAnimationFrame(() => elements.toast.classList.add('show'));
  toastTimer = setTimeout(() => {
    elements.toast.classList.remove('show');
    setTimeout(() => elements.toast.classList.add('hidden'), 220);
  }, 2600);
  elements.toast.classList.remove('hidden');
}

function closeConfirm(result = false) {
  if (elements.confirmModal.classList.contains('hidden')) return;
  elements.confirmModal.classList.add('hidden');
  document.querySelector('.app-shell').inert = false;
  const resolve = confirmResolver;
  const restoreFocus = confirmRestoreFocus;
  confirmResolver = null;
  confirmRestoreFocus = null;
  resolve?.(Boolean(result));
  requestAnimationFrame(() => restoreFocus?.focus?.());
}

function confirmAction({ title = '确认操作', message = '', confirmLabel = '确认', danger = true } = {}) {
  if (confirmResolver) closeConfirm(false);
  confirmRestoreFocus = document.activeElement;
  elements.confirmTitle.textContent = title;
  elements.confirmMessage.textContent = message;
  elements.confirmButton.textContent = confirmLabel;
  elements.confirmButton.classList.toggle('danger-button', danger);
  elements.confirmModal.classList.remove('hidden');
  document.querySelector('.app-shell').inert = true;
  return new Promise((resolve) => {
    confirmResolver = resolve;
    requestAnimationFrame(() => elements.confirmButton.focus());
  });
}

function disposeModelPreviewRenderer() {
  modelPreviewRenderer?.dispose?.();
  modelPreviewRenderer = null;
}

async function closeModelPreview(cancel = true) {
  disposeModelPreviewRenderer();
  if (cancel && modelPreview?.token) await window.quickPet.cancelPetModelPreview(modelPreview.token);
  modelPreview = null;
  $('#modelPreviewModal').classList.add('hidden');
}

async function chooseAndPreviewModel() {
  try {
    const preview = await window.quickPet.choosePetModelPreview();
    if (!preview) return;
    modelPreview = preview;
    $('#modelPreviewTitle').textContent = `${preview.format.toUpperCase()} 模型体检`;
    $('#modelPreviewName').value = preview.name;
    $('#modelInspectionMetrics').innerHTML = [
      ['性能', `${preview.performance?.grade || 'B'} · ${preview.performance?.label || '适中'}`],
      ['大小', `${(preview.size / 1024 / 1024).toFixed(1)} MB`],
      ['纹理', `${preview.textureCount || 0} 张`],
      ['动作', `${preview.animationNames?.length || 0} 个`],
      ['表情', `${preview.expressionNames?.length || 0} 个`],
      ...(preview.vertexCount ? [['顶点', preview.vertexCount.toLocaleString('zh-CN')]] : []),
      ...(preview.materialCount ? [['材质', `${preview.materialCount} 个`]] : []),
      ...(preview.format !== 'live2d' ? [['骨骼', preview.hasSkeleton ? '已检测' : '未检测']] : [])
    ].map(([label, value]) => `<div><span>${label}</span><b>${value}</b></div>`).join('');
    const issues = [
      ...(preview.missingFiles || []).map((item) => ({ type: 'error', text: `缺少文件：${item}` })),
      ...(preview.warnings || []).map((text) => ({ type: 'warning', text }))
    ];
    $('#modelInspectionIssues').innerHTML = issues.length
      ? issues.map((item) => `<p class="${item.type}">${item.type === 'error' ? '×' : '!'} ${escapeHtml(item.text)}</p>`).join('')
      : '<p class="success">✓ 模型结构完整，可以导入</p>';
    $('#modelPreviewConfirmButton').disabled = Boolean(preview.missingFiles?.length);
    $('#modelPreview3dCanvas').classList.toggle('hidden', preview.format === 'live2d');
    $('#modelPreviewLive2dCanvas').classList.toggle('hidden', preview.format !== 'live2d');
    $('#modelPreviewModal').classList.remove('hidden');
    await new Promise((resolve) => requestAnimationFrame(resolve));
    if (preview.format === 'live2d') {
      modelPreviewRenderer = window.QuickPetLive2DBundle.mount($('#modelPreviewLive2dCanvas'), {
        modelUrl: preview.previewUrl,
        modelConfig: preview,
        performanceMode: state.settings?.performanceMode || 'efficient',
        onModelError: (error) => showToast(`Live2D 预览失败：${cleanError(error)}`, 'error')
      });
    } else {
      const modelBytes = await window.quickPet.getPetModelPreviewBytes(preview.token);
      modelPreviewRenderer = window.QuickPet3DBundle.mount($('#modelPreview3dCanvas'), {
        modelBytes,
        modelConfig: { transform: { scale: 1, rotationY: 0, verticalOffset: 0, flip: false }, animationMap: {} },
        performanceMode: state.settings?.performanceMode || 'efficient',
        onModelError: (error) => showToast(`3D 预览失败：${cleanError(error)}`, 'error')
      });
      modelPreviewRenderer.setMotion({ mode: 'walk', direction: 1, action: '' });
    }
  } catch (error) { showToast(cleanError(error), 'error'); }
}

function categoryById(id) {
  return state.categories.find((category) => category.id === id) || { name: '未分类', icon: '◇', color: '#777770' };
}

function flattenedCategories() {
  const categories = [...state.categories].sort((a, b) => (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0));
  const children = new Map();
  for (const category of categories) {
    const parentId = categories.some((item) => item.id === category.parentId) ? category.parentId : '';
    if (!children.has(parentId)) children.set(parentId, []);
    children.get(parentId).push(category);
  }
  const result = [];
  const visited = new Set();
  const visit = (parentId, depth) => {
    for (const category of children.get(parentId) || []) {
      if (visited.has(category.id)) continue;
      visited.add(category.id);
      result.push({ ...category, depth });
      visit(category.id, depth + 1);
    }
  };
  visit('', 0);
  for (const category of categories) {
    if (!visited.has(category.id)) result.push({ ...category, parentId: '', depth: 0 });
  }
  return result;
}

function categoryFamilyIds(id) {
  const ids = new Set([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const category of state.categories) {
      if (ids.has(category.parentId) && !ids.has(category.id)) {
        ids.add(category.id);
        changed = true;
      }
    }
  }
  return ids;
}

function typeIcon(type) {
  return {
    website: '◉', app: '▣', folder: '📁', image: '▧', video: '▶', audio: '♫',
    document: '▤', archive: '▦', code: '{ }', design: '◇', file: '□'
  }[type] || '✦';
}

function displayTarget(item) {
  if (item.type === 'website') {
    try { return new URL(item.target).hostname.replace(/^www\./, ''); } catch {}
  }
  return item.target;
}

function faviconFor(item) {
  if (item.type !== 'website') return '';
  try { return `${new URL(item.target).origin}/favicon.ico`; } catch { return ''; }
}

function applyAppearance() {
  const settings = state.settings || {};
  document.documentElement.dataset.theme = settings.theme || 'system';
  document.documentElement.style.setProperty('--accent', settings.accent || '#171717');
}

function sortedAndFilteredShortcuts() {
  let items = [...state.shortcuts];
  if (currentView === 'favorites') items = items.filter((item) => item.favorite);
  else if (currentView === 'recent') items = items.filter((item) => item.lastUsedAt > 0);
  else if (currentView !== 'all') {
    const categoryIds = categoryFamilyIds(currentView);
    items = items.filter((item) => categoryIds.has(item.category));
  }

  if (searchTerm) {
    const query = searchTerm.toLowerCase();
    items = items.filter((item) => `${item.name} ${item.target} ${(item.tags || []).join(' ')}`.toLowerCase().includes(query));
  }

  const sortBy = state.settings.sortBy || 'recent';
  const smartScore = (item) => {
    const daysSinceUse = item.lastUsedAt ? Math.max(0, (Date.now() - item.lastUsedAt) / 86400000) : 90;
    return Number(item.favorite) * 500 + Math.log2((item.useCount || 0) + 1) * 100 + Math.max(0, 45 - daysSinceUse) * 4;
  };
  const sorters = {
    name: (a, b) => a.name.localeCompare(b.name, 'zh-CN'),
    created: (a, b) => b.createdAt - a.createdAt,
    used: (a, b) => b.useCount - a.useCount || b.lastUsedAt - a.lastUsedAt,
    manual: (a, b) => (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0),
    recent: (a, b) => smartScore(b) - smartScore(a) || b.lastUsedAt - a.lastUsedAt || b.createdAt - a.createdAt
  };
  return items.sort(sorters[sortBy] || sorters.recent);
}

function renderCategories() {
  const counts = state.shortcuts.reduce((result, item) => {
    result[item.category] = (result[item.category] || 0) + 1;
    return result;
  }, {});
  elements.allCount.textContent = state.shortcuts.length;
  elements.favoriteCount.textContent = state.shortcuts.filter((item) => item.favorite).length;
  const flatCategories = flattenedCategories();
  const categoryMap = new Map(flatCategories.map((category) => [category.id, category]));
  const parentIds = new Set(flatCategories.map((category) => category.parentId).filter(Boolean));
  const collapsedCategoryIds = new Set(state.settings?.collapsedCategoryIds || []);
  const isVisible = (category) => {
    let parentId = category.parentId;
    const visited = new Set();
    while (parentId && !visited.has(parentId)) {
      if (collapsedCategoryIds.has(parentId)) return false;
      visited.add(parentId);
      parentId = categoryMap.get(parentId)?.parentId || '';
    }
    return true;
  };
  elements.categoryNav.innerHTML = flatCategories.length ? flatCategories.filter(isVisible).map((category) => {
    const familyCount = [...categoryFamilyIds(category.id)].reduce((sum, id) => sum + (counts[id] || 0), 0);
    const hasChildren = parentIds.has(category.id);
    const expanded = hasChildren && !collapsedCategoryIds.has(category.id);
    return `
    <div class="category-nav-row" style="--category-depth:${category.depth}">
      <button class="category-toggle ${hasChildren ? '' : 'is-empty'}" type="button" data-category-toggle="${escapeHtml(category.id)}" aria-label="${expanded ? '收起' : '展开'} ${escapeHtml(category.name)}" aria-expanded="${expanded}">${hasChildren ? '›' : ''}</button>
      <button class="nav-item category-nav-item ${currentView === category.id ? 'active' : ''}" data-view="${escapeHtml(category.id)}" data-category-drop="${escapeHtml(category.id)}">
        <span><i class="category-dot" style="background:${escapeHtml(category.color)};color:${escapeHtml(category.color)}"></i></span>
        <span>${escapeHtml(category.icon)} ${escapeHtml(category.name)}</span>
        <b>${familyCount}</b>
      </button>
    </div>
  `;
  }).join('') : '<p class="category-nav-empty">还没有分类</p>';
  document.querySelectorAll('#quickNav .nav-item, .settings-nav').forEach((button) => button.classList.toggle('active', button.dataset.view === currentView));
}

function renderShortcutCard(item) {
  const category = categoryById(item.category);
  const manualSort = state.settings?.sortBy === 'manual';
  const favicon = faviconFor(item);
  const tags = (item.tags || []).slice(0, 1).map((tag) => `<span class="tag-chip">#${escapeHtml(tag)}</span>`).join('');
  const hotkeyStatus = state.hotkeyRegistrations?.[item.id];
  const hotkey = item.hotkey ? `<kbd class="shortcut-hotkey ${hotkeyStatus && hotkeyStatus.status !== 'registered' ? 'unavailable' : ''}" title="${escapeHtml(hotkeyStatus?.message || '快捷启动组合键')}">${escapeHtml(formatHotkey(item.hotkey))}</kbd>` : '';
  const icon = item.iconData
    ? `<span class="shortcut-icon custom-shortcut-icon" style="background:${escapeHtml(item.iconBackground || '#f1efff')}"><img src="${escapeHtml(item.iconData)}" alt=""></span>`
    : favicon
    ? `<span class="shortcut-icon"><span class="icon-fallback">${typeIcon(item.type)}</span><img class="favicon" src="${escapeHtml(favicon)}" alt=""></span>`
    : `<span class="shortcut-icon">${typeIcon(item.type)}</span>`;
  return `
    <article class="shortcut-card" data-id="${escapeHtml(item.id)}" draggable="${manualSort}" style="--category-color:${escapeHtml(category.color)}">
      <div class="card-top">
        ${icon}
        <div class="card-actions">
          ${manualSort ? `<button class="card-icon-button drag-handle" title="拖动排序" aria-label="拖动 ${escapeHtml(item.name)} 排序">⠿</button>` : ''}
          <button class="card-icon-button launcher-button ${item.showInLauncher ? 'favorite' : ''}" title="${item.showInLauncher ? '移出快捷启动台' : '加入快捷启动台'}">▦</button>
          <button class="card-icon-button favorite-button ${item.favorite ? 'favorite' : ''}" title="${item.favorite ? '取消收藏' : '收藏'}">★</button>
          <button class="card-icon-button edit-button" title="编辑">✎</button>
          <button class="card-icon-button delete-button" title="删除">×</button>
        </div>
      </div>
      <button class="shortcut-open" title="打开 ${escapeHtml(item.name)}">
        <h3>${escapeHtml(item.name)}</h3>
        <p>${escapeHtml(displayTarget(item))}</p>
      </button>
      <div class="card-footer">
        <span class="category-chip" style="--chip-color:${escapeHtml(category.color)}">${escapeHtml(category.icon)} ${escapeHtml(category.name)}</span>
        ${tags}
        ${hotkey}
        <span class="status-dot ${escapeHtml(item.status)}" title="${item.status === 'broken' ? '可能已失效' : item.status === 'ok' ? '可正常访问' : '尚未检查'}"></span>
      </div>
    </article>
  `;
}

function renderLibrary() {
  const titles = {
    all: ['快捷收纳', '全部快捷方式'],
    favorites: ['常用收藏', '我的收藏'],
    recent: ['使用记录', '最近使用']
  };
  const currentCategory = categoryById(currentView);
  const [eyebrow, title] = titles[currentView] || ['自定义分类', `${currentCategory.icon} ${currentCategory.name}`];
  elements.currentEyebrow.textContent = eyebrow;
  elements.viewTitle.textContent = title;

  const items = sortedAndFilteredShortcuts();
  elements.summaryText.textContent = searchTerm
    ? `找到 ${items.length} 个结果`
    : `${items.length} 个快捷方式 · 点击卡片即可打开`;
  elements.shortcutGrid.innerHTML = items.map(renderShortcutCard).join('');
  elements.emptyState.classList.toggle('hidden', items.length > 0);
  elements.shortcutGrid.classList.toggle('hidden', items.length === 0);
  document.querySelectorAll('.favicon').forEach((image) => {
    image.addEventListener('load', () => image.previousElementSibling?.classList.add('hidden'));
    image.addEventListener('error', () => image.classList.add('hidden'));
  });
}

function renderCategoryOptions() {
  const selected = elements.categoryInput.value;
  const categories = flattenedCategories();
  elements.categoryInput.innerHTML = '<option value="">未分类</option>' + categories.map((category) =>
    `<option value="${escapeHtml(category.id)}">${'　'.repeat(category.depth)}${escapeHtml(category.icon)} ${escapeHtml(category.name)}</option>`
  ).join('');
  elements.categoryInput.value = state.categories.some((category) => category.id === selected) ? selected : '';
  const newParent = $('#newCategoryParent');
  const selectedParent = newParent.value;
  newParent.innerHTML = '<option value="">顶级分类</option>' + categories.map((category) =>
    `<option value="${escapeHtml(category.id)}">${'　'.repeat(category.depth)}${escapeHtml(category.icon)} ${escapeHtml(category.name)}</option>`
  ).join('');
  newParent.value = state.categories.some((category) => category.id === selectedParent) ? selectedParent : '';
}

function renderCategoryManager() {
  const categories = flattenedCategories();
  elements.categoryManager.innerHTML = categories.length ? categories.map((category, index) => {
    const parentOptions = categories.filter((item) => item.id !== category.id).map((item) =>
      `<option value="${escapeHtml(item.id)}" ${category.parentId === item.id ? 'selected' : ''}>${'　'.repeat(item.depth)}${escapeHtml(item.icon)} ${escapeHtml(item.name)}</option>`
    ).join('');
    return `
    <div class="category-edit-row" data-id="${escapeHtml(category.id)}" style="--category-depth:${category.depth}">
      <input class="tiny-input category-icon-input" maxlength="4" value="${escapeHtml(category.icon)}" aria-label="图标">
      <input class="text-control category-name-input" maxlength="16" value="${escapeHtml(category.name)}" aria-label="名称">
      <select class="select-control category-parent-input" aria-label="上级分类"><option value="">顶级分类</option>${parentOptions}</select>
      <input class="category-color-input" type="color" value="${escapeHtml(category.color)}" aria-label="颜色">
      <div class="row-buttons">
        <button data-action="up" title="上移" ${index === 0 ? 'disabled' : ''}>↑</button>
        <button data-action="down" title="下移" ${index === state.categories.length - 1 ? 'disabled' : ''}>↓</button>
        <button data-action="delete" class="danger" title="删除">×</button>
      </div>
    </div>
  `;
  }).join('') : '<div class="category-manager-empty"><b>还没有分类</b><span>在下方创建第一个分类，之后可以继续添加下级分类。</span></div>';
}

function activeCustomModel() {
  return (state.models || []).find((item) => item.id === state.settings?.activeModelId) || null;
}

function renderModelLibrary() {
  const settings = state.settings || {};
  const customModels = state.models || [];
  const cards = [
    { preset: 'fox', name: '内置动画狐狸', meta: '有贴图 · 3 个动作 · 官方示例资产' },
    ...customModels.map((model) => ({
      id: model.id,
      name: model.name,
      meta: `${(model.format || 'glb').toUpperCase()} · 性能 ${model.performance?.grade || 'B'} · ${model.materialStatus === 'fixed-legacy' ? '旧材质已修复' : model.textureCount ? `${model.textureCount} 张贴图` : '模型无贴图'} · ${model.animationNames.length} 个动作`,
      thumbnailData: model.thumbnailData
    }))
  ];
  $('#modelLibraryList').innerHTML = cards.map((model) => {
    const active = model.id ? settings.petModelPreset === 'custom' && settings.activeModelId === model.id : settings.petModelPreset === model.preset;
    return `<button class="model-card ${active ? 'active' : ''}" ${model.id ? `data-model-id="${escapeHtml(model.id)}"` : `data-model-preset="${escapeHtml(model.preset)}"`}><span class="model-card-icon"><img src="${model.thumbnailData ? escapeHtml(model.thumbnailData) : '../../assets/app-icon.png'}" alt=""></span><span><b>${escapeHtml(model.name)}</b><small>${escapeHtml(model.meta)}</small></span><em>${active ? '使用中' : '切换'}</em></button>`;
  }).join('');

  const model = activeCustomModel();
  $('#activeModelEditor').classList.toggle('hidden', !model);
  if (!model) return;
  $('#petModelName').textContent = model.name;
  $('#modelNameInput').value = model.name;
  $('#modelScaleInput').value = Math.round(model.transform.scale * 100);
  $('#modelScaleValue').textContent = `${$('#modelScaleInput').value}%`;
  $('#modelRotationInput').value = model.transform.rotationY;
  $('#modelRotationValue').textContent = `${model.transform.rotationY}°`;
  $('#modelVerticalInput').value = Math.round(model.transform.verticalOffset * 100);
  $('#modelVerticalValue').textContent = Number(model.transform.verticalOffset).toFixed(2);
  $('#modelFlipInput').checked = model.transform.flip;
  document.querySelectorAll('[data-animation]').forEach((select) => {
    const key = select.dataset.animation;
    select.innerHTML = '<option value="">自动匹配 / 待机回退</option>' + model.animationNames.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');
    select.value = model.animationMap[key] || '';
  });
}

function formatBytes(value) {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function renderHotkeyCenter() {
  const list = $('#hotkeyCenterList');
  const select = $('#hotkeyShortcutSelect');
  const selectedId = select.value;
  const allShortcuts = [...state.shortcuts].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  select.innerHTML = `<option value="">选择快捷项目</option>${allShortcuts.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join('')}`;
  if (allShortcuts.some((item) => item.id === selectedId)) select.value = selectedId;
  const selected = allShortcuts.find((item) => item.id === select.value);
  $('#hotkeyCenterInput').value = formatHotkey(selected?.hotkey || '');
  $('#saveHotkeyCenterButton').disabled = !selected;
  const shortcuts = allShortcuts.filter((item) => item.hotkey);
  list.innerHTML = shortcuts.length ? shortcuts.map((item) => {
    const registration = state.hotkeyRegistrations?.[item.id];
    const status = registration?.status === 'registered' ? '已生效' : registration?.message || '等待注册';
    return `<div class="hotkey-center-row" data-hotkey-id="${escapeHtml(item.id)}"><span><b>${escapeHtml(item.name)}</b><small>${escapeHtml(status)}</small></span><kbd class="${registration?.status !== 'registered' ? 'unavailable' : ''}">${escapeHtml(formatHotkey(item.hotkey))}</kbd><button data-hotkey-action="select">修改</button><button data-hotkey-action="clear">清除</button></div>`;
  }).join('') : '<p class="empty-inline">尚未给任何快捷项目设置组合键。</p>';
}

function renderUsageStats() {
  const list = $('#usageStatsList');
  const items = [...state.shortcuts].filter((item) => item.useCount > 0).sort((a, b) => b.useCount - a.useCount || b.lastUsedAt - a.lastUsedAt).slice(0, 6);
  const max = Math.max(1, ...items.map((item) => item.useCount));
  list.innerHTML = items.length ? items.map((item) => `<div class="usage-row"><span><b>${escapeHtml(item.name)}</b><small>${item.useCount} 次</small></span><i><em style="width:${Math.max(6, item.useCount / max * 100)}%"></em></i></div>`).join('') : '<p class="empty-inline">打开快捷项目后会在这里生成本地统计。</p>';
}

function cacheCleanupPresentation(progress = {}) {
  const index = Math.max(0, Number(progress.index) || 0);
  const total = Math.max(0, Number(progress.total) || 0);
  const failedCount = Math.max(0, Number(progress.failedCount) || 0);
  const skippedCount = Math.max(0, Number(progress.skippedCount) || 0);
  const itemPercent = total ? Math.round(10 + (Math.min(index, total) / total) * 64) : 74;
  const name = String(progress.name || '旧版运行文件');
  const completeStatus = progress.runtimeCacheTimedOut
    ? '清理结束，Electron 缓存未响应'
    : failedCount
      ? `清理结束，${failedCount} 份未能处理`
      : skippedCount
        ? `清理结束，已跳过 ${skippedCount} 份`
        : '缓存清理完成';
  const completeDetail = failedCount || skippedCount || progress.runtimeCacheTimedOut
    ? `已释放 ${formatBytes(progress.releasedBytes)} · 未处理内容可稍后重试`
    : `本次共释放 ${formatBytes(progress.releasedBytes)}`;
  const presentations = {
    scan: { percent: 4, status: '正在扫描缓存', detail: '检查旧版运行文件和 Electron 缓存' },
    'portable-start': { percent: total ? 8 : 74, status: total ? `准备清理 ${total} 份旧版文件` : '没有旧版运行文件', detail: total ? '逐份检查占用状态和访问权限' : '继续处理 Electron 缓存' },
    'portable-item-start': { percent: Math.max(10, itemPercent - Math.ceil(64 / Math.max(1, total))), status: `正在处理第 ${index}/${total} 份`, detail: name },
    'portable-item-done': { percent: itemPercent, status: `已清理第 ${index}/${total} 份`, detail: name },
    'portable-item-skipped': { percent: itemPercent, status: `已跳过第 ${index}/${total} 份`, detail: `${name} · 正在被旧版程序使用` },
    'portable-item-failed': { percent: itemPercent, status: `第 ${index}/${total} 份未能清理`, detail: `${name} · ${progress.message || '文件被占用或没有权限'}` },
    'portable-complete': { percent: 76, status: '旧版运行文件处理完成', detail: `已删除 ${progress.removedCount || 0} 份 · 跳过 ${progress.skippedCount || 0} 份 · 失败 ${progress.failedCount || 0} 份` },
    'runtime-start': { percent: 82, status: '正在清理 Electron 缓存', detail: '清理网页缓存和代码缓存' },
    'runtime-complete': { percent: 96, status: 'Electron 缓存已清理', detail: `本阶段释放 ${formatBytes(progress.runtimeReleasedBytes)}` },
    'runtime-timeout': { percent: 96, status: 'Electron 缓存暂时忙碌', detail: '已停止等待，可稍后重新清理' },
    complete: { percent: 100, status: completeStatus, detail: completeDetail },
    error: { percent: 100, status: '缓存清理中断', detail: progress.message || '未能完成清理' }
  };
  return presentations[progress.stage] || presentations.scan;
}

function updateMaintenanceButtons() {
  const clearButton = $('#clearCacheButton');
  const refreshButton = $('#refreshStorageButton');
  if (!clearButton || !refreshButton) return;
  const cleanableBytes = storageReport?.cleanableCacheBytes || 0;
  const presentation = cacheCleanupPresentation(cacheCleanupProgress || { stage: 'scan' });
  clearButton.disabled = cacheCleanupRunning || !cleanableBytes;
  refreshButton.disabled = cacheCleanupRunning;
  clearButton.textContent = cacheCleanupRunning
    ? `清理中 · ${presentation.percent}%`
    : cleanableBytes
      ? `一键清理缓存 · ${formatBytes(cleanableBytes)}`
      : '没有可清理缓存';
}

function renderCacheCleanupProgress() {
  const container = $('#cacheCleanupProgress');
  if (!container || !cacheCleanupProgress) return;
  const presentation = cacheCleanupPresentation(cacheCleanupProgress);
  container.classList.remove('hidden');
  container.dataset.stage = cacheCleanupProgress.stage || 'scan';
  container.dataset.result = cacheCleanupProgress.stage === 'error'
    ? 'error'
    : cacheCleanupProgress.stage === 'complete' && (cacheCleanupProgress.failedCount || cacheCleanupProgress.skippedCount || cacheCleanupProgress.runtimeCacheTimedOut)
      ? 'warning'
      : 'normal';
  $('#cacheCleanupStatus').textContent = presentation.status;
  $('#cacheCleanupPercent').textContent = `${presentation.percent}%`;
  $('#cacheCleanupBar').style.width = `${presentation.percent}%`;
  $('#cacheCleanupCurrent').textContent = presentation.detail;
  $('#cacheCleanupReleased').textContent = `已释放 ${formatBytes(cacheCleanupProgress.releasedBytes)}`;
  updateMaintenanceButtons();
}

function renderStorageReport() {
  const report = $('#storageReport');
  if (!storageReport) {
    report.innerHTML = '<p class="empty-inline">正在读取存储占用…</p>';
    return;
  }
  report.innerHTML = [
    ['个人数据', storageReport.userDataBytes],
    ['模型文件', storageReport.modelBytes],
    ['本地备份', storageReport.backupBytes],
    ['当前运行文件', storageReport.currentPortableCacheBytes],
    ['Electron 缓存', storageReport.runtimeCacheBytes],
    ['旧版运行文件', storageReport.stalePortableCacheBytes],
    ['合计可清理', storageReport.cleanableCacheBytes]
  ].map(([label, value]) => `<div><span>${label}</span><b>${formatBytes(value)}</b></div>`).join('');
  updateMaintenanceButtons();
  $('#removeProgramButton').textContent = storageReport.portable ? '清理便携运行文件' : '移除快捷宠';
}

function renderUpdateStatus() {
  const update = state.runtime?.update || { status: 'idle' };
  const notes = String(update.notes || '').split(/\r?\n/).find(Boolean)?.slice(0, 140) || '';
  const text = {
    idle: '尚未检查',
    checking: '正在检查…',
    unavailable: update.message || 'GitHub 更新仓库暂不可用',
    current: `当前 ${state.appVersion || ''} 已是最新版本`,
    available: `发现 ${update.version}${notes ? ` · ${notes}` : ''}`,
    error: `检查失败：${update.message || '无法连接 GitHub'}`
  }[update.status] || '尚未检查';
  $('#updateStatus').textContent = text;
  $('#downloadUpdateButton').classList.toggle('hidden', update.status !== 'available');
  $('#downloadUpdateButton').textContent = update.downloadUrl ? '下载新版本' : '查看发布页';
}

function organizeSettingsLayout() {
  const grid = document.querySelector('#settingsView .settings-grid');
  const groups = [
    ['常用入口', '搜索、面板与界面', ['globalHotkeysCard', 'appearanceCard']],
    ['桌宠与动作', '形象、行为与活动范围', ['petProfileCard', 'petBehaviorCard', 'petRangeCard', 'modelCenterCard']],
    ['整理与效率', '分类、批量收纳与项目快捷键', ['categorySettingsCard', 'batchImportCard', 'itemHotkeysCard', 'usageStatsCard']],
    ['数据与程序', '备份、迁移、维护与版本信息', ['startupDataCard', 'migrationCard', 'maintenanceToolsCard', 'aboutUpdateCard', 'storageCleanupCard']]
  ];
  grid.querySelectorAll('.settings-section-divider').forEach((element) => element.remove());
  for (const [title, detail, cardIds] of groups) {
    const divider = document.createElement('div');
    divider.className = 'settings-section-divider';
    divider.innerHTML = `<b>${title}</b><span>${detail}</span>`;
    grid.append(divider);
    for (const id of cardIds) {
      const card = document.getElementById(id);
      if (card) grid.append(card);
    }
  }
}

function renderSettings() {
  const settings = state.settings || {};
  const status = state.petStatus || { name: '快捷宠', mood: 82, hunger: 76, affection: 20 };
  $('#themeSelect').value = settings.theme || 'system';
  $('#accentInput').value = /^#[0-9a-f]{6}$/i.test(settings.accent || '') ? settings.accent : '#171717';
  $('#opacityInput').value = Math.round((settings.panelOpacity || .98) * 100);
  $('#opacityValue').textContent = `${$('#opacityInput').value}%`;
  const panelSize = `${settings.panelWidth || 1040}x${settings.panelHeight || 720}`;
  $('#panelSizeSelect').value = [...$('#panelSizeSelect').options].some((option) => option.value === panelSize) ? panelSize : '1040x720';
  $('#performanceModeSelect').value = settings.performanceMode || 'efficient';
  $('#performanceModeHint').textContent = {
    efficient: '待机约 30 帧、睡眠约 15 帧，互动时自动提速。',
    balanced: '提高模型清晰度与待机流畅度。',
    quality: '优先画质与抗锯齿，显卡占用会增加。'
  }[$('#performanceModeSelect').value];
  $('#petScaleInput').value = Math.round((settings.petScale || 1) * 100);
  $('#petScaleValue').textContent = `${$('#petScaleInput').value}%`;
  $('#petNameInput').value = status.name;
  for (const key of ['mood', 'hunger', 'affection']) {
    $(`#${key}Value`).textContent = Math.round(status[key]);
    $(`#${key}Bar`).style.width = `${Math.round(status[key])}%`;
  }
  $('#alwaysOnTopInput').checked = settings.petAlwaysOnTop !== false;
  $('#hideOnFullscreenInput').checked = settings.hideOnFullscreen !== false;
  $('#edgeSnapInput').checked = settings.edgeSnap !== false;
  $('#naturalBehaviorInput').checked = settings.naturalBehavior !== false;
  $('#nightSleepInput').checked = settings.nightSleep !== false;
  $('#petScreenModeSelect').value = settings.petScreenMode || 'current';
  $('#activityPaddingInput').value = settings.activityPadding || 0;
  $('#activityPaddingValue').textContent = `${$('#activityPaddingInput').value}px`;
  $('#petRenderModeSelect').value = settings.petRenderMode === '3d' ? '3d' : '2d';
  $('#autoWalkInput').checked = settings.autoWalk !== false;
  $('#walkSpeedInput').value = settings.petWalkSpeed || 46;
  const speed = Number($('#walkSpeedInput').value);
  $('#walkSpeedValue').textContent = speed < 36 ? '慢' : speed < 72 ? '正常' : '快';
  $('#launchAtLoginInput').checked = Boolean(settings.launchAtLogin);
  $('#autoCheckUpdatesInput').checked = settings.autoCheckUpdates !== false;
  $('#portableCacheCleanupPromptInput').checked = settings.portableCacheCleanupPrompt !== false;
  $('#globalSearchShortcutInput').value = formatHotkey(settings.globalSearchShortcut || 'Alt+Space');
  $('#quickLaunchShortcutInput').value = formatHotkey(settings.quickLaunchShortcut || 'CommandOrControl+Alt+Space');
  $('#panelShortcutInput').value = formatHotkey(settings.panelShortcut || 'CommandOrControl+Shift+Space');
  const registrations = state.runtime?.globalShortcutRegistrations || {};
  $('#globalSearchShortcutStatus').textContent = registrations.search ? '已生效' : '未注册，可能被其他程序占用';
  $('#quickLaunchShortcutStatus').textContent = registrations.launcher ? '已生效' : '未注册，可能被其他程序占用';
  $('#panelShortcutStatus').textContent = registrations.panel ? '已生效' : '未注册，可能被其他程序占用';
  const is3dMode = settings.petRenderMode === '3d';
  const model = activeCustomModel();
  const modelDisplayName = settings.petModelPreset === 'custom' ? (model?.name || '自定义模型不存在') : '内置动画狐狸';
  $('#skinPreview').src = settings.petImageData || '../../assets/app-icon.png';
  $('#skinName').textContent = is3dMode ? modelDisplayName : (settings.petImageName || '快捷宠程序图标');
  $('#autoRemoveBackgroundInput').checked = settings.autoRemoveBackground !== false;
  const hasCustomSkin = Boolean(settings.petOriginalImageData);
  const isAnimatedSkin = /\.gif$/i.test(settings.petImageName || '');
  const skinStatus = $('#skinStatus');
  skinStatus.className = 'skin-status';
  if (is3dMode) {
    skinStatus.textContent = model?.materialStatus === 'fixed-legacy'
      ? `✓ 已自动修复 ${model.convertedMaterials} 个旧材质，贴图已恢复`
      : `✓ 当前使用 ${modelDisplayName}`;
    skinStatus.classList.add('success');
  } else if (!hasCustomSkin) skinStatus.textContent = '默认皮肤已经是透明背景';
  else if (isAnimatedSkin) { skinStatus.textContent = 'GIF 动图保持原动画，暂不自动抠图'; skinStatus.classList.add('warning'); }
  else if (settings.petBackgroundRemoved) { skinStatus.textContent = '✓ 已在本机自动生成透明背景'; skinStatus.classList.add('success'); }
  else skinStatus.textContent = '当前使用原图，可以点击“重新抠图”';
  $('#processSkinButton').disabled = !hasCustomSkin || isAnimatedSkin;
  $('#useOriginalSkinButton').disabled = !hasCustomSkin || !settings.petBackgroundRemoved;
  $('#versionText').textContent = `v${state.appVersion || '0.1.0'}`;
  $('#safeModeBanner').classList.toggle('hidden', !state.runtime?.safeMode);
  elements.sortSelect.value = settings.sortBy || 'recent';
  renderModelLibrary();
  renderCategoryManager();
  renderBackups();
  renderHotkeyCenter();
  renderUsageStats();
  renderStorageReport();
  renderUpdateStatus();
}

async function refreshStorageReport() {
  storageReport = await window.quickPet.getStorageReport();
  renderStorageReport();
  return storageReport;
}

function renderBackups() {
  const list = $('#backupList');
  if (!list) return;
  list.innerHTML = backups.length ? backups.slice(0, 5).map((backup) => `
    <div class="backup-row" data-backup-id="${escapeHtml(backup.id)}">
      <span><b>${new Date(backup.createdAt).toLocaleString('zh-CN')}</b><small>${Math.max(1, Math.round(backup.size / 1024))} KB</small></span>
      <button data-action="restore-backup" title="恢复这份备份">↻</button>
      <button data-action="delete-backup" title="删除这份备份">×</button>
    </div>
  `).join('') : '<p class="empty-inline">自动备份会在每天首次启动时生成。</p>';
}

async function refreshBackups() {
  backups = await window.quickPet.listBackups();
  renderBackups();
}

function localDateKey(value) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function filteredReminders() {
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startTomorrow = startToday + 86400000;
  const endOfWeek = startToday + (8 - (now.getDay() || 7)) * 86400000;
  return (state.reminders || []).filter((reminder) => {
    if (reminderFilter === 'today') return reminder.dueAt >= startToday && reminder.dueAt < startTomorrow;
    if (reminderFilter === 'tomorrow') return reminder.dueAt >= startTomorrow && reminder.dueAt < startTomorrow + 86400000;
    if (reminderFilter === 'week') return reminder.dueAt >= startToday && reminder.dueAt < endOfWeek;
    return true;
  }).sort((a, b) => Number(Boolean(a.completedAt)) - Number(Boolean(b.completedAt)) || a.dueAt - b.dueAt);
}

function renderReminderCalendar() {
  const year = calendarMonth.getFullYear();
  const month = calendarMonth.getMonth();
  $('#calendarTitle').textContent = `${year} 年 ${month + 1} 月`;
  const firstDay = new Date(year, month, 1);
  const gridStart = new Date(year, month, 1 - ((firstDay.getDay() + 6) % 7));
  const todayKey = localDateKey(Date.now());
  const counts = (state.reminders || []).filter((item) => !item.completedAt).reduce((result, item) => {
    const key = localDateKey(item.dueAt);
    result[key] = (result[key] || 0) + 1;
    return result;
  }, {});
  $('#reminderCalendar').innerHTML = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + index);
    const key = localDateKey(date);
    return `<button data-calendar-date="${key}" class="calendar-day ${date.getMonth() === month ? '' : 'outside'} ${key === todayKey ? 'today' : ''}" title="${counts[key] ? `${counts[key]} 个提醒` : '在这一天添加提醒'}"><span>${date.getDate()}</span>${counts[key] ? `<i>${Math.min(9, counts[key])}</i>` : ''}</button>`;
  }).join('');
  document.querySelectorAll('[data-reminder-filter]').forEach((button) => button.classList.toggle('active', button.dataset.reminderFilter === reminderFilter));
}

function renderAutomation() {
  if (!elements.automationView) return;
  const categoryOptions = state.categories.map((category) => `<option value="${escapeHtml(category.id)}">${escapeHtml(category.icon)} ${escapeHtml(category.name)}</option>`).join('');
  const currentCategory = $('#ruleCategory').value;
  $('#ruleCategory').innerHTML = categoryOptions;
  if (state.categories.some((item) => item.id === currentCategory)) $('#ruleCategory').value = currentCategory;
  $('#clipboardMonitorInput').checked = state.settings?.clipboardMonitor !== false;

  $('#ruleList').innerHTML = (state.rules || []).map((rule) => `<div class="automation-row" data-rule-id="${escapeHtml(rule.id)}"><span><b>${escapeHtml(rule.name)}</b><small>${escapeHtml(rule.field)} · ${escapeHtml(rule.operator)} “${escapeHtml(rule.value)}” → ${escapeHtml(categoryById(rule.category).name)}</small></span><label><input class="rule-enabled" type="checkbox" ${rule.enabled ? 'checked' : ''}> 启用</label><button class="row-delete" data-action="delete-rule">×</button></div>`).join('') || '<p class="empty-inline">还没有规则，新收纳内容仍会使用内置自动分类。</p>';

  $('#watchedFolderList').innerHTML = (state.watchedFolders || []).map((folder) => `<div class="automation-row" data-folder-id="${escapeHtml(folder.id)}"><span><b>${escapeHtml(folder.name)}</b><small>${escapeHtml(folder.path)}</small></span><label><input class="folder-enabled" type="checkbox" ${folder.enabled ? 'checked' : ''}> 监控</label><button class="row-delete" data-action="delete-folder">×</button></div>`).join('') || '<p class="empty-inline">尚未选择动态文件夹。</p>';

  renderReminderCalendar();
  $('#reminderList').innerHTML = filteredReminders().map((reminder) => `<div class="automation-row reminder-row ${reminder.completedAt ? 'completed' : ''}" data-reminder-id="${escapeHtml(reminder.id)}"><span><b>${escapeHtml(reminder.title)}</b><small>${new Date(reminder.dueAt).toLocaleString('zh-CN')} · ${{ none: '一次', daily: '每天', weekdays: '工作日', weekly: '每周', monthly: '每月' }[reminder.repeat]}</small></span><button data-action="complete-reminder" title="${reminder.completedAt ? '恢复待办' : '标记完成'}">${reminder.completedAt ? '↶' : '✓'}</button><button data-action="snooze-reminder" title="延后 10 分钟" ${reminder.completedAt ? 'disabled' : ''}>+10</button><button class="row-delete" data-action="delete-reminder" title="删除">×</button></div>`).join('') || '<p class="empty-inline">这个时间范围内没有提醒。</p>';
  $('#notificationList').innerHTML = (state.notifications || []).slice(0, 12).map((item) => `<div class="notification-row ${item.read ? '' : 'unread'}"><i></i><span><b>${escapeHtml(item.title)}</b><small>${escapeHtml(item.message)} · ${new Date(item.createdAt).toLocaleString('zh-CN')}</small></span></div>`).join('') || '<p class="empty-inline">通知会出现在这里。</p>';
  const unread = (state.notifications || []).filter((item) => !item.read).length;
  $('#notificationBadge').textContent = unread;
  $('#notificationBadge').classList.toggle('hidden', !unread);

  const modelOptions = [`<option value="">内置狐狸</option>`, ...(state.models || []).map((model) => `<option value="${escapeHtml(model.id)}">${escapeHtml(model.name)} · ${escapeHtml((model.format || 'glb').toUpperCase())}</option>`)].join('');
  $('#companionList').innerHTML = (state.companions || []).map((companion) => `<div class="companion-card" data-companion-id="${escapeHtml(companion.id)}"><div class="companion-avatar">${companion.personality === 'sleepy' ? '☾' : companion.personality === 'calm' ? '◇' : '✦'}</div><input class="text-control companion-name" value="${escapeHtml(companion.name)}" maxlength="20"><select class="select-control companion-model">${modelOptions}</select><select class="select-control companion-personality"><option value="lively">活泼</option><option value="calm">安静</option><option value="sleepy">爱睡觉</option></select><label>大小 <input class="companion-scale" type="range" min="70" max="145" step="5" value="${Math.round(companion.scale * 100)}"></label><div><label><input class="companion-enabled" type="checkbox" ${companion.enabled ? 'checked' : ''}> 显示</label><button class="row-delete" data-action="delete-companion">删除</button></div></div>`).join('') || '<p class="empty-inline">目前只有主桌宠，可以再添加最多四个伙伴。</p>';
  document.querySelectorAll('.companion-card').forEach((card) => {
    const companion = state.companions.find((item) => item.id === card.dataset.companionId);
    card.querySelector('.companion-model').value = companion.activeModelId || '';
    card.querySelector('.companion-personality').value = companion.personality;
  });
}

function renderAll() {
  applyAppearance();
  renderCategories();
  renderCategoryOptions();
  if (currentView === 'settings') renderSettings();
  else if (currentView === 'automation') renderAutomation();
  else renderLibrary();
}

function navigate(view) {
  currentView = view;
  const isSettings = view === 'settings';
  const isAutomation = view === 'automation';
  elements.libraryView.classList.toggle('hidden', isSettings || isAutomation);
  elements.settingsView.classList.toggle('hidden', !isSettings);
  elements.automationView.classList.toggle('hidden', !isAutomation);
  const activeView = isSettings
    ? elements.settingsView
    : isAutomation
      ? elements.automationView
      : elements.libraryView;
  activeView.classList.remove('view-enter');
  requestAnimationFrame(() => {
    if (currentView !== view || activeView.classList.contains('hidden')) return;
    activeView.classList.add('view-enter');
  });
  renderCategories();
  if (isSettings) renderSettings();
  else if (isAutomation) renderAutomation();
  else renderLibrary();
}

function openModal(item = null) {
  elements.form.reset();
  elements.editId.value = item?.id || '';
  elements.modalTitle.textContent = item ? '编辑快捷方式' : '添加快捷方式';
  elements.nameInput.value = item?.name || '';
  elements.targetInput.value = item?.target || '';
  elements.typeInput.value = item?.type || 'auto';
  renderCategoryOptions();
  elements.categoryInput.value = item?.category || '';
  elements.hotkeyInput.value = formatHotkey(item?.hotkey || '');
  elements.tagsInput.value = (item?.tags || []).join(', ');
  elements.favoriteInput.checked = Boolean(item?.favorite);
  elements.launcherInput.checked = Boolean(item?.showInLauncher);
  $('#iconTools').classList.toggle('hidden', !item);
  $('#iconBackgroundInput').value = item?.iconBackground || '#f1efff';
  elements.modal.classList.remove('hidden');
  setTimeout(() => (item ? elements.nameInput : elements.targetInput).focus(), 30);
}

function closeModal() {
  elements.modal.classList.add('hidden');
}

async function browseAndAdd(kind = 'file') {
  try {
    const paths = await window.quickPet.chooseTargets(kind);
    if (!paths.length) return;
    if (kind === 'folder') elements.typeInput.value = 'folder';
    if (paths.length === 1 && !elements.editId.value) {
      elements.targetInput.value = paths[0];
      if (!elements.nameInput.value) {
        const clean = paths[0].replace(/[\\/]+$/, '').split(/[\\/]/).pop();
        elements.nameInput.value = clean.replace(/\.[^.]+$/, '');
      }
      return;
    }
    const result = await window.quickPet.addPaths(paths);
    closeModal();
    showToast(`已收纳 ${result.added.length} 个项目${result.errors.length ? `，${result.errors.length} 个未添加` : ''}`);
  } catch (error) {
    showToast(cleanError(error), 'error');
  }
}

async function submitShortcut(event) {
  event.preventDefault();
  const input = {
    name: elements.nameInput.value.trim(),
    target: elements.targetInput.value.trim(),
    type: elements.typeInput.value,
    category: elements.categoryInput.value,
    hotkey: elements.hotkeyInput.value,
    tags: elements.tagsInput.value.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean),
    favorite: elements.favoriteInput.checked,
    showInLauncher: elements.launcherInput.checked
  };
  try {
    if (elements.editId.value) {
      await window.quickPet.updateShortcut(elements.editId.value, input);
      showToast('快捷方式已更新');
    } else {
      await window.quickPet.addShortcut(input);
      showToast('已收纳并自动分类');
    }
    closeModal();
  } catch (error) {
    showToast(cleanError(error), 'error');
  }
}

async function checkAll() {
  if (checking || !state.shortcuts.length) {
    if (!state.shortcuts.length) showToast('还没有需要检查的快捷方式');
    return;
  }
  checking = true;
  $('#checkButton').textContent = '检查中…';
  $('#settingsCheckButton').textContent = '检查中…';
  try {
    const results = await window.quickPet.checkAll();
    const broken = results.filter((item) => item.status === 'broken').length;
    showToast(broken ? `检查完成，发现 ${broken} 个可能失效的项目` : '检查完成，没有发现明确失效的项目');
  } catch (error) {
    showToast(cleanError(error), 'error');
  } finally {
    checking = false;
    $('#checkButton').textContent = '检查可用性';
    $('#settingsCheckButton').textContent = '检查全部快捷方式';
  }
}

function renderScanPreview() {
  const list = $('#scanPreviewList');
  list.innerHTML = scannedCandidates.length ? scannedCandidates.map((item, index) => `
    <label class="scan-preview-row">
      <input type="checkbox" data-scan-index="${index}" ${item.selected !== false ? 'checked' : ''}>
      <span class="scan-kind">${typeIcon(item.type)}</span>
      <span><b>${escapeHtml(item.name)}</b><small>${escapeHtml(item.target)}</small></span>
      <em>${escapeHtml(item.source)}</em>
    </label>
  `).join('') : '<div class="empty-scan">没有发现尚未收纳的新项目。</div>';
  const selected = scannedCandidates.filter((item) => item.selected !== false).length;
  $('#scanSelectionSummary').textContent = `已选择 ${selected} / ${scannedCandidates.length} 个`;
  $('#scanSelectAllInput').checked = Boolean(scannedCandidates.length) && selected === scannedCandidates.length;
  $('#scanSelectAllInput').indeterminate = selected > 0 && selected < scannedCandidates.length;
  $('#scanImportButton').disabled = selected === 0;
}

async function scanAndPreview(kind) {
  try {
    showToast('正在扫描本机快捷方式，请稍候…');
    scannedCandidates = (await window.quickPet.scanShortcuts(kind)).map((item) => ({ ...item, selected: true }));
    renderScanPreview();
    $('#scanModal').classList.remove('hidden');
  } catch (error) {
    showToast(cleanError(error), 'error');
  }
}

async function handleDrop(event) {
  event.preventDefault();
  dragDepth = 0;
  elements.dropOverlay.classList.add('hidden');
  try {
    const paths = [...event.dataTransfer.files].map((file) => window.quickPet.pathForFile(file)).filter(Boolean);
    if (paths.length) {
      const result = await window.quickPet.addPaths(paths);
      showToast(`已收纳 ${result.added.length} 个项目${result.errors.length ? `，${result.errors.length} 个已存在或无法读取` : ''}`);
      return;
    }
    const text = event.dataTransfer.getData('text/uri-list') || event.dataTransfer.getData('text/plain');
    const urls = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => /^https?:\/\//i.test(line));
    if (!urls.length) throw new Error('没有识别到可添加的网址或文件');
    let added = 0;
    for (const target of urls) {
      try { await window.quickPet.addShortcut({ target, type: 'website' }); added += 1; } catch {}
    }
    showToast(added ? `已收纳 ${added} 个网址` : '这些网址已经收纳过了', added ? 'success' : 'error');
  } catch (error) {
    showToast(cleanError(error), 'error');
  }
}

function bindNavigation() {
  document.addEventListener('click', (event) => {
    const nav = event.target.closest('[data-view]');
    if (nav) navigate(nav.dataset.view);
  });
  $('#settingsButton').addEventListener('click', () => navigate('settings'));
  $('#manageCategoriesButton').addEventListener('click', () => {
    navigate('settings');
    setTimeout(() => $('#categorySettingsCard').scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  });
  elements.categoryNav.addEventListener('click', async (event) => {
    const toggle = event.target.closest('[data-category-toggle]');
    if (!toggle) return;
    event.preventDefault();
    event.stopPropagation();
    const collapsed = new Set(state.settings?.collapsedCategoryIds || []);
    if (collapsed.has(toggle.dataset.categoryToggle)) collapsed.delete(toggle.dataset.categoryToggle);
    else collapsed.add(toggle.dataset.categoryToggle);
    state.settings.collapsedCategoryIds = [...collapsed];
    renderCategories();
    try {
      await window.quickPet.updateSettings({ collapsedCategoryIds: [...collapsed] });
    } catch (error) {
      showToast(cleanError(error), 'error');
    }
  });
}

function bindLibraryActions() {
  ['#addButton', '#addFromSidebar', '#emptyAddButton'].forEach((selector) => $(selector).addEventListener('click', () => openModal()));
  elements.searchInput.addEventListener('input', () => { searchTerm = elements.searchInput.value.trim(); renderLibrary(); });
  elements.sortSelect.addEventListener('change', async () => {
    await window.quickPet.updateSettings({ sortBy: elements.sortSelect.value });
  });
  elements.shortcutGrid.addEventListener('click', async (event) => {
    const card = event.target.closest('.shortcut-card');
    if (!card) return;
    const item = state.shortcuts.find((entry) => entry.id === card.dataset.id);
    if (!item) return;
    try {
      if (event.target.closest('.drag-handle')) return;
      if (event.target.closest('.shortcut-open')) await window.quickPet.openShortcut(item.id);
      else if (event.target.closest('.launcher-button')) await window.quickPet.updateShortcut(item.id, { showInLauncher: !item.showInLauncher });
      else if (event.target.closest('.favorite-button')) await window.quickPet.updateShortcut(item.id, { favorite: !item.favorite });
      else if (event.target.closest('.edit-button')) openModal(item);
      else if (event.target.closest('.delete-button')) {
        if (await confirmAction({ title: '移除快捷方式', message: `确定移除“${item.name}”吗？\n只会删除快捷记录，不会删除原文件。`, confirmLabel: '移除' })) {
          await window.quickPet.removeShortcut(item.id);
          showToast('已移除快捷方式');
        }
      } else await window.quickPet.openShortcut(item.id);
    } catch (error) {
      showToast(cleanError(error), 'error');
    }
  });
  $('#clearAllShortcutsButton').addEventListener('click', async () => {
    const count = state.shortcuts.length;
    if (!count) return showToast('当前没有快捷方式');
    if (!await confirmAction({ title: '清空全部快捷方式', message: `将移除全部 ${count} 个快捷记录。\n本地原文件不会被删除。`, confirmLabel: `清空 ${count} 项` })) return;
    try {
      const removed = await window.quickPet.removeAllShortcuts();
      showToast(`已清空 ${removed} 个快捷方式`);
    } catch (error) { showToast(cleanError(error), 'error'); }
  });
  elements.shortcutGrid.addEventListener('dragstart', (event) => {
    const card = event.target.closest('.shortcut-card');
    if (state.settings?.sortBy !== 'manual' || !card || !event.target.closest('.drag-handle')) {
      event.preventDefault();
      return;
    }
    draggedShortcutId = card.dataset.id;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/x-quickpet-shortcut', draggedShortcutId);
    card.classList.add('dragging');
  });
  elements.shortcutGrid.addEventListener('dragover', (event) => {
    if (!draggedShortcutId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const nextIndicator = event.target.closest('.shortcut-card');
    if (nextIndicator?.dataset.id === draggedShortcutId) return;
    const bounds = nextIndicator?.getBoundingClientRect();
    const nextInsertAfter = Boolean(bounds && (
      event.clientY > bounds.top + bounds.height * 0.65
      || (event.clientY > bounds.top + bounds.height * 0.35 && event.clientX > bounds.left + bounds.width / 2)
    ));
    if (nextIndicator === dragIndicatorCard && nextInsertAfter === dragInsertAfter) return;
    dragIndicatorCard?.classList.remove('drag-before', 'drag-after');
    dragIndicatorCard = nextIndicator;
    dragInsertAfter = nextInsertAfter;
    dragIndicatorCard?.classList.add(dragInsertAfter ? 'drag-after' : 'drag-before');
  });
  elements.shortcutGrid.addEventListener('drop', async (event) => {
    if (!draggedShortcutId) return;
    event.preventDefault();
    event.stopPropagation();
    const targetCard = event.target.closest('.shortcut-card');
    const targetItem = state.shortcuts.find((item) => item.id === targetCard?.dataset.id);
    const category = targetItem?.category || (state.categories.some((item) => item.id === currentView) ? currentView : state.shortcuts.find((item) => item.id === draggedShortcutId)?.category);
    const visibleCards = [...elements.shortcutGrid.querySelectorAll('.shortcut-card')];
    const targetIndex = targetCard ? visibleCards.indexOf(targetCard) : -1;
    const beforeCard = dragInsertAfter && targetIndex >= 0
      ? visibleCards.slice(targetIndex + 1).find((card) => state.shortcuts.find((item) => item.id === card.dataset.id)?.category === category && card.dataset.id !== draggedShortcutId)
      : targetCard;
    await window.quickPet.reorderShortcut(draggedShortcutId, beforeCard?.dataset.id || '', category || 'tools');
  });
  elements.shortcutGrid.addEventListener('dragend', () => {
    draggedShortcutId = '';
    dragIndicatorCard?.classList.remove('drag-before', 'drag-after');
    dragIndicatorCard = null;
    dragInsertAfter = false;
    document.querySelector('.shortcut-card.dragging')?.classList.remove('dragging');
  });
  elements.categoryNav.addEventListener('dragover', (event) => {
    const target = event.target.closest('[data-category-drop]');
    if (!draggedShortcutId || !target) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    target.classList.add('drop-target');
  });
  elements.categoryNav.addEventListener('dragleave', (event) => event.target.closest('[data-category-drop]')?.classList.remove('drop-target'));
  elements.categoryNav.addEventListener('drop', async (event) => {
    const target = event.target.closest('[data-category-drop]');
    if (!draggedShortcutId || !target) return;
    event.preventDefault();
    event.stopPropagation();
    target.classList.remove('drop-target');
    await window.quickPet.reorderShortcut(draggedShortcutId, '', target.dataset.categoryDrop);
    showToast('快捷方式已移动到新分类');
  });
  $('#checkButton').addEventListener('click', checkAll);
  $('#settingsCheckButton').addEventListener('click', checkAll);
}

function bindModal() {
  elements.form.addEventListener('submit', submitShortcut);
  $('#browseFileButton').addEventListener('click', () => browseAndAdd('file'));
  $('#browseFolderButton').addEventListener('click', () => browseAndAdd('folder'));
  $('#modalCloseButton').addEventListener('click', closeModal);
  $('#cancelButton').addEventListener('click', closeModal);
  elements.hotkeyInput.addEventListener('focus', () => elements.hotkeyInput.closest('.hotkey-recorder').classList.add('recording'));
  elements.hotkeyInput.addEventListener('blur', () => elements.hotkeyInput.closest('.hotkey-recorder').classList.remove('recording'));
  elements.hotkeyInput.addEventListener('keydown', (event) => {
    event.preventDefault();
    const hotkey = hotkeyFromKeyboardEvent(event);
    if (hotkey === null) return;
    elements.hotkeyInput.value = hotkey;
    elements.hotkeyInput.closest('.hotkey-recorder').classList.remove('recording');
    elements.hotkeyInput.blur();
  });
  $('#clearHotkeyButton').addEventListener('click', () => { elements.hotkeyInput.value = ''; elements.hotkeyInput.focus(); });
  elements.modal.addEventListener('mousedown', (event) => { if (event.target === elements.modal) closeModal(); });
  $('#confirmCancelButton').addEventListener('click', () => closeConfirm(false));
  elements.confirmButton.addEventListener('click', () => closeConfirm(true));
  elements.confirmModal.addEventListener('mousedown', (event) => { if (event.target === elements.confirmModal) closeConfirm(false); });
  document.addEventListener('keydown', (event) => {
    if (!elements.confirmModal.classList.contains('hidden')) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeConfirm(false);
      } else if (event.key === 'Tab') {
        const controls = [$('#confirmCancelButton'), elements.confirmButton];
        const index = controls.indexOf(document.activeElement);
        const nextIndex = event.shiftKey ? (index <= 0 ? controls.length - 1 : index - 1) : (index + 1) % controls.length;
        event.preventDefault();
        controls[nextIndex].focus();
      }
      return;
    }
    if (event.key === 'Escape' && !elements.modal.classList.contains('hidden')) closeModal();
    if (event.key === 'Escape' && !$('#scanModal').classList.contains('hidden')) $('#scanModal').classList.add('hidden');
  });
  $('#scanModalCloseButton').addEventListener('click', () => $('#scanModal').classList.add('hidden'));
  $('#scanCancelButton').addEventListener('click', () => $('#scanModal').classList.add('hidden'));
  $('#scanSelectAllInput').addEventListener('change', () => {
    scannedCandidates.forEach((item) => { item.selected = $('#scanSelectAllInput').checked; });
    renderScanPreview();
  });
  $('#scanPreviewList').addEventListener('change', (event) => {
    const index = Number(event.target.dataset.scanIndex);
    if (Number.isInteger(index) && scannedCandidates[index]) scannedCandidates[index].selected = event.target.checked;
    renderScanPreview();
  });
  $('#scanImportButton').addEventListener('click', async () => {
    const selected = scannedCandidates.filter((item) => item.selected !== false);
    try {
      const result = await window.quickPet.importScannedShortcuts(selected);
      $('#scanModal').classList.add('hidden');
      showToast(`已批量收纳 ${result.added.length} 个项目${result.errors.length ? `，跳过 ${result.errors.length} 个` : ''}`);
    } catch (error) { showToast(cleanError(error), 'error'); }
  });
  $('#refreshIconButton').addEventListener('click', async () => {
    try { await window.quickPet.refreshShortcutIcon(elements.editId.value); showToast('已自动提取高清图标'); } catch (error) { showToast(cleanError(error), 'error'); }
  });
  $('#chooseIconButton').addEventListener('click', async () => {
    try { await window.quickPet.chooseShortcutIcon(elements.editId.value); showToast('自定义图标已更新'); } catch (error) { showToast(cleanError(error), 'error'); }
  });
  $('#clearIconButton').addEventListener('click', async () => { await window.quickPet.clearShortcutIcon(elements.editId.value); showToast('已恢复默认图标'); });
  $('#iconBackgroundInput').addEventListener('change', () => window.quickPet.updateShortcut(elements.editId.value, { iconBackground: $('#iconBackgroundInput').value }));
  $('#modelPreviewCloseButton').addEventListener('click', () => closeModelPreview(true));
  $('#modelPreviewCancelButton').addEventListener('click', () => closeModelPreview(true));
  $('#modelPreviewModal').addEventListener('mousedown', (event) => { if (event.target.id === 'modelPreviewModal') closeModelPreview(true); });
  $('#modelPreviewConfirmButton').addEventListener('click', async () => {
    if (!modelPreview) return;
    try {
      const model = await window.quickPet.confirmPetModelImport(modelPreview.token, $('#modelPreviewName').value);
      await closeModelPreview(false);
      showToast(`模型已导入：${model.name}`);
    } catch (error) { showToast(cleanError(error), 'error'); }
  });
}

function bindDrop() {
  document.addEventListener('dragenter', (event) => {
    event.preventDefault();
    if (draggedShortcutId || event.dataTransfer?.types?.includes('application/x-quickpet-shortcut')) return;
    dragDepth += 1;
    elements.dropOverlay.classList.remove('hidden');
  });
  document.addEventListener('dragover', (event) => event.preventDefault());
  document.addEventListener('dragleave', (event) => {
    event.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) elements.dropOverlay.classList.add('hidden');
  });
  document.addEventListener('drop', handleDrop);
}

function bindSettings() {
  $('#themeSelect').addEventListener('change', () => window.quickPet.updateSettings({ theme: $('#themeSelect').value }));
  $('#accentInput').addEventListener('change', () => window.quickPet.updateSettings({ accent: $('#accentInput').value }));
  $('#opacityInput').addEventListener('input', () => { $('#opacityValue').textContent = `${$('#opacityInput').value}%`; });
  $('#opacityInput').addEventListener('change', () => window.quickPet.updateSettings({ panelOpacity: Number($('#opacityInput').value) / 100 }));
  $('#panelSizeSelect').addEventListener('change', () => {
    const [panelWidth, panelHeight] = $('#panelSizeSelect').value.split('x').map(Number);
    window.quickPet.updateSettings({ panelWidth, panelHeight });
  });
  $('#performanceModeSelect').addEventListener('change', async () => {
    await window.quickPet.updateSettings({ performanceMode: $('#performanceModeSelect').value });
    showToast('性能模式已切换，模型渲染已自动更新');
  });
  $('#petScaleInput').addEventListener('input', () => { $('#petScaleValue').textContent = `${$('#petScaleInput').value}%`; });
  $('#petScaleInput').addEventListener('change', () => window.quickPet.updateSettings({ petScale: Number($('#petScaleInput').value) / 100 }));
  $('#petNameInput').addEventListener('change', () => window.quickPet.updatePetStatus({ name: $('#petNameInput').value }));
  $('#feedPetButton').addEventListener('click', async () => { await window.quickPet.interactWithPet('feed'); showToast(`已经给${state.petStatus.name}喂食`); });
  $('#playPetButton').addEventListener('click', async () => { await window.quickPet.interactWithPet('play'); showToast(`${state.petStatus.name}玩得很开心`); });
  $('#alwaysOnTopInput').addEventListener('change', () => window.quickPet.updateSettings({ petAlwaysOnTop: $('#alwaysOnTopInput').checked }));
  $('#hideOnFullscreenInput').addEventListener('change', () => window.quickPet.updateSettings({ hideOnFullscreen: $('#hideOnFullscreenInput').checked }));
  $('#edgeSnapInput').addEventListener('change', () => window.quickPet.updateSettings({ edgeSnap: $('#edgeSnapInput').checked }));
  $('#naturalBehaviorInput').addEventListener('change', () => window.quickPet.updateSettings({ naturalBehavior: $('#naturalBehaviorInput').checked }));
  $('#nightSleepInput').addEventListener('change', () => window.quickPet.updateSettings({ nightSleep: $('#nightSleepInput').checked }));
  $('#petScreenModeSelect').addEventListener('change', () => window.quickPet.updateSettings({ petScreenMode: $('#petScreenModeSelect').value }));
  $('#activityPaddingInput').addEventListener('input', () => { $('#activityPaddingValue').textContent = `${$('#activityPaddingInput').value}px`; });
  $('#activityPaddingInput').addEventListener('change', () => window.quickPet.updateSettings({ activityPadding: Number($('#activityPaddingInput').value) }));
  const bindSettingsHotkey = (inputSelector, resetSelector, key, fallback, label) => {
    const input = $(inputSelector);
    input.addEventListener('focus', () => input.closest('.hotkey-recorder').classList.add('recording'));
    input.addEventListener('blur', () => input.closest('.hotkey-recorder').classList.remove('recording'));
    input.addEventListener('keydown', async (event) => {
      event.preventDefault();
      const hotkey = hotkeyFromKeyboardEvent(event);
      if (!hotkey) return;
      try {
        const settings = await window.quickPet.updateSettings({ [key]: hotkey });
        input.value = formatHotkey(settings[key]);
        input.blur();
        showToast(`${label}已更新`);
      } catch (error) { showToast(cleanError(error), 'error'); }
    });
    $(resetSelector).addEventListener('click', async () => {
      try {
        const settings = await window.quickPet.updateSettings({ [key]: fallback });
        input.value = formatHotkey(settings[key]);
        showToast(`${label}已恢复默认`);
      } catch (error) { showToast(cleanError(error), 'error'); }
    });
  };
  bindSettingsHotkey('#globalSearchShortcutInput', '#clearGlobalSearchShortcutButton', 'globalSearchShortcut', 'Alt+Space', '快捷搜索组合键');
  bindSettingsHotkey('#quickLaunchShortcutInput', '#clearQuickLaunchShortcutButton', 'quickLaunchShortcut', 'CommandOrControl+Alt+Space', '快捷启动台组合键');
  bindSettingsHotkey('#panelShortcutInput', '#clearPanelShortcutButton', 'panelShortcut', 'CommandOrControl+Shift+Space', '主快捷面板组合键');
  $('#petRenderModeSelect').addEventListener('change', async () => {
    await window.quickPet.updateSettings({ petRenderMode: $('#petRenderModeSelect').value });
    showToast($('#petRenderModeSelect').value === '3d' ? '已经切换为 3D 动态动物' : '已经切换为 2D 自定义皮肤');
  });
  $('#autoWalkInput').addEventListener('change', () => window.quickPet.updateSettings({ autoWalk: $('#autoWalkInput').checked }));
  $('#walkSpeedInput').addEventListener('input', () => {
    const speed = Number($('#walkSpeedInput').value);
    $('#walkSpeedValue').textContent = speed < 36 ? '慢' : speed < 72 ? '正常' : '快';
  });
  $('#walkSpeedInput').addEventListener('change', () => window.quickPet.updateSettings({ petWalkSpeed: Number($('#walkSpeedInput').value) }));
  $('#launchAtLoginInput').addEventListener('change', () => window.quickPet.updateSettings({ launchAtLogin: $('#launchAtLoginInput').checked }));
  $('#autoRemoveBackgroundInput').addEventListener('change', () => window.quickPet.updateSettings({ autoRemoveBackground: $('#autoRemoveBackgroundInput').checked }));
  $('#chooseSkinButton').addEventListener('click', async () => {
    try {
      showToast($('#autoRemoveBackgroundInput').checked ? '正在本机识别主体并抠图，请稍候…' : '正在读取图片…');
      const result = await window.quickPet.chooseSkin();
      if (!result) return;
      if (result.status === 'removed') showToast('自动抠图完成，已经换上透明桌宠');
      else if (result.status === 'already-transparent') showToast('图片本身已有透明背景，已经直接使用');
      else if (result.status === 'animated-original') showToast('GIF 已换上；为保留动画，本次没有抠图');
      else if (result.status === 'fallback') showToast(`已使用原图：${result.message || '没有可靠识别出主体'}`, 'error');
      else showToast('桌宠皮肤已更换');
    } catch (error) { showToast(cleanError(error), 'error'); }
  });
  $('#processSkinButton').addEventListener('click', async () => {
    try {
      showToast('正在本机重新抠图，请稍候…');
      await window.quickPet.processSkinBackground();
      showToast('重新抠图完成');
    } catch (error) { showToast(cleanError(error), 'error'); }
  });
  $('#useOriginalSkinButton').addEventListener('click', async () => {
    try { await window.quickPet.useOriginalSkin(); showToast('已经切换回原图'); } catch (error) { showToast(cleanError(error), 'error'); }
  });
  $('#resetSkinButton').addEventListener('click', async () => { await window.quickPet.resetSkin(); showToast('已经恢复默认桌宠'); });
  $('#chooseModelButton').addEventListener('click', async () => {
    await chooseAndPreviewModel();
  });
  $('#openModelLibraryButton').addEventListener('click', () => window.quickPet.openPetModelLibrary());
  $('#modelLibraryList').addEventListener('click', async (event) => {
    const card = event.target.closest('.model-card');
    if (!card) return;
    try {
      if (card.dataset.modelId) await window.quickPet.selectPetModel(card.dataset.modelId);
      else await window.quickPet.updateSettings({ petModelPreset: card.dataset.modelPreset, petRenderMode: '3d' });
      showToast('桌宠模型已切换');
    } catch (error) { showToast(cleanError(error), 'error'); }
  });
  const updateModelTransform = () => {
    const model = activeCustomModel();
    if (!model) return;
    return window.quickPet.updatePetModel(model.id, {
      name: $('#modelNameInput').value,
      transform: {
        scale: Number($('#modelScaleInput').value) / 100,
        rotationY: Number($('#modelRotationInput').value),
        verticalOffset: Number($('#modelVerticalInput').value) / 100,
        flip: $('#modelFlipInput').checked
      }
    });
  };
  $('#modelScaleInput').addEventListener('input', () => { $('#modelScaleValue').textContent = `${$('#modelScaleInput').value}%`; });
  $('#modelRotationInput').addEventListener('input', () => { $('#modelRotationValue').textContent = `${$('#modelRotationInput').value}°`; });
  $('#modelVerticalInput').addEventListener('input', () => { $('#modelVerticalValue').textContent = (Number($('#modelVerticalInput').value) / 100).toFixed(2); });
  ['#modelNameInput', '#modelScaleInput', '#modelRotationInput', '#modelVerticalInput', '#modelFlipInput'].forEach((selector) => $(selector).addEventListener('change', updateModelTransform));
  $('#animationMapEditor').addEventListener('change', async (event) => {
    const select = event.target.closest('[data-animation]');
    const model = activeCustomModel();
    if (!select || !model) return;
    await window.quickPet.updatePetModel(model.id, { animationMap: { [select.dataset.animation]: select.value } });
    showToast('动作映射已更新');
  });
  $('#deleteModelButton').addEventListener('click', async () => {
    const model = activeCustomModel();
    if (!model || !await confirmAction({ title: '删除模型副本', message: `确定删除“${model.name}”吗？\n不会删除你原来的 GLB 文件。`, confirmLabel: '删除模型' })) return;
    await window.quickPet.removePetModel(model.id);
    showToast('模型副本已删除，已切换为内置狐狸');
  });
  document.querySelectorAll('.scan-button').forEach((button) => button.addEventListener('click', () => scanAndPreview(button.dataset.scan)));
  $('#exportButton').addEventListener('click', async () => {
    try { const file = await window.quickPet.exportBackup(); if (file) showToast('备份已导出'); } catch (error) { showToast(cleanError(error), 'error'); }
  });
  $('#importButton').addEventListener('click', async () => {
    if (!await confirmAction({ title: '恢复备份', message: '当前快捷方式和设置将被备份内容替换。', confirmLabel: '恢复备份' })) return;
    try { const result = await window.quickPet.importBackup(); if (result) showToast('备份恢复成功'); } catch (error) { showToast('备份文件无法读取：' + cleanError(error), 'error'); }
  });
  $('#createBackupButton').addEventListener('click', async () => {
    try { await window.quickPet.createBackup(); await refreshBackups(); showToast('本地备份已创建'); } catch (error) { showToast(cleanError(error), 'error'); }
  });
  $('#backupList').addEventListener('click', async (event) => {
    const row = event.target.closest('[data-backup-id]');
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (!row || !action) return;
    try {
      if (action === 'restore-backup') {
        if (!await confirmAction({ title: '恢复这份备份', message: '当前快捷方式和设置将被这份备份替换。', confirmLabel: '恢复' })) return;
        await window.quickPet.restoreBackup(row.dataset.backupId);
        showToast('备份恢复成功');
      } else if (action === 'delete-backup') {
        await window.quickPet.removeBackup(row.dataset.backupId);
        showToast('备份已删除');
      }
      await refreshBackups();
    } catch (error) { showToast(cleanError(error), 'error'); }
  });

  $('#hotkeyCenterList').addEventListener('click', async (event) => {
    const row = event.target.closest('[data-hotkey-id]');
    const action = event.target.closest('[data-hotkey-action]')?.dataset.hotkeyAction;
    const item = state.shortcuts.find((entry) => entry.id === row?.dataset.hotkeyId);
    if (!item || !action) return;
    if (action === 'select') {
      $('#hotkeyShortcutSelect').value = item.id;
      $('#hotkeyCenterInput').value = formatHotkey(item.hotkey);
      $('#hotkeyCenterInput').focus();
    }
    else if (action === 'clear') {
      await window.quickPet.updateShortcut(item.id, { hotkey: '' });
      showToast('组合键已清除');
    }
  });
  $('#hotkeyShortcutSelect').addEventListener('change', () => {
    const item = state.shortcuts.find((entry) => entry.id === $('#hotkeyShortcutSelect').value);
    $('#hotkeyCenterInput').value = formatHotkey(item?.hotkey || '');
    $('#saveHotkeyCenterButton').disabled = !item;
  });
  $('#hotkeyCenterInput').addEventListener('focus', () => $('#hotkeyCenterInput').closest('.hotkey-recorder').classList.add('recording'));
  $('#hotkeyCenterInput').addEventListener('blur', () => $('#hotkeyCenterInput').closest('.hotkey-recorder').classList.remove('recording'));
  $('#hotkeyCenterInput').addEventListener('keydown', (event) => {
    event.preventDefault();
    const hotkey = hotkeyFromKeyboardEvent(event);
    if (hotkey === null) return;
    $('#hotkeyCenterInput').value = hotkey;
  });
  $('#clearHotkeyCenterInputButton').addEventListener('click', () => { $('#hotkeyCenterInput').value = ''; });
  $('#saveHotkeyCenterButton').addEventListener('click', async () => {
    const id = $('#hotkeyShortcutSelect').value;
    if (!id) return;
    try {
      await window.quickPet.updateShortcut(id, { hotkey: $('#hotkeyCenterInput').value });
      showToast($('#hotkeyCenterInput').value ? '项目组合键已应用' : '项目组合键已清除');
    } catch (error) { showToast(cleanError(error), 'error'); }
  });
  $('#resetUsageButton').addEventListener('click', async () => {
    if (!await confirmAction({ title: '清零使用统计', message: '所有本地打开次数和最近使用时间将被清空。', confirmLabel: '清零' })) return;
    await window.quickPet.resetUsage();
    showToast('本地使用统计已清零');
  });
  $('#exportMigrationButton').addEventListener('click', async () => {
    try { const file = await window.quickPet.exportMigration(); if (file) showToast('完整迁移包已导出'); } catch (error) { showToast(cleanError(error), 'error'); }
  });
  $('#importMigrationButton').addEventListener('click', async () => {
    if (!await confirmAction({ title: '导入完整迁移包', message: '当前快捷方式、分类和设置将被迁移包替换。', confirmLabel: '导入并替换' })) return;
    try { const result = await window.quickPet.importMigration(); if (result) showToast('快捷方式、设置和模型已迁入'); } catch (error) { showToast(cleanError(error), 'error'); }
  });
  $('#refreshStorageButton').addEventListener('click', () => refreshStorageReport().catch((error) => showToast(cleanError(error), 'error')));
  $('#openDataButton').addEventListener('click', () => window.quickPet.openDataFolder());
  $('#clearCacheButton').addEventListener('click', async () => {
    if (cacheCleanupRunning) return;
    const bytes = storageReport?.cleanableCacheBytes || 0;
    if (!bytes) return showToast('当前没有可清理缓存');
    if (!await confirmAction({ title: '清理便携缓存', message: `预计释放 ${formatBytes(bytes)}。\n当前版本、个人设置、快捷方式和模型都会保留。`, confirmLabel: '开始清理', danger: false })) return;
    cacheCleanupRunning = true;
    cacheCleanupProgress = { stage: 'scan', releasedBytes: 0 };
    renderCacheCleanupProgress();
    try {
      const result = await window.quickPet.clearRuntimeCache();
      storageReport = result.report;
      renderStorageReport();
      const skipped = result.skippedCount ? `，${result.skippedCount} 份正在使用，已跳过` : '';
      if (result.elevationRequested) {
        showToast('已请求管理员权限；完成后点击“刷新占用”查看结果');
      } else if (result.failures.length) {
        showToast(`清理未完成：${result.failures[0].name} · ${result.failures[0].message}`, 'error');
      } else if (!result.releasedBytes && result.skippedCount) {
        showToast(`有 ${result.skippedCount} 份旧缓存仍在运行，请退出旧版后重试`, 'error');
      } else if (result.runtimeCacheTimedOut) {
        showToast(`已释放 ${formatBytes(result.portableReleasedBytes)} 旧版文件；Electron 缓存忙碌，稍后可重试`);
      } else {
        showToast(`已释放 ${formatBytes(result.releasedBytes)}（Electron ${formatBytes(result.runtimeReleasedBytes)}，旧版 ${formatBytes(result.portableReleasedBytes)}）${skipped}`);
      }
    } catch (error) {
      cacheCleanupProgress = { stage: 'error', message: cleanError(error), releasedBytes: cacheCleanupProgress?.releasedBytes || 0 };
      renderCacheCleanupProgress();
      showToast(cleanError(error), 'error');
    } finally {
      cacheCleanupRunning = false;
      updateMaintenanceButtons();
    }
  });
  $('#exitSafeModeButton').addEventListener('click', async () => { await window.quickPet.exitSafeMode(); showToast('已恢复异常退出前的配置'); });
  $('#removeProgramButton').addEventListener('click', async () => {
    const removeData = $('#removeDataInput').checked;
    const action = state.runtime?.portable ? '清理当前便携运行文件并退出' : '移除快捷宠程序与快捷方式';
    if (!await confirmAction({ title: '移除快捷宠', message: `${action}${removeData ? '，同时永久删除个人数据、模型和备份' : '，保留个人数据'}。`, confirmLabel: '确认移除' })) return;
    try { await window.quickPet.removeProgram(removeData); } catch (error) { showToast(cleanError(error), 'error'); }
  });
  $('#autoCheckUpdatesInput').addEventListener('change', () => window.quickPet.updateSettings({ autoCheckUpdates: $('#autoCheckUpdatesInput').checked }));
  $('#portableCacheCleanupPromptInput').addEventListener('change', async () => {
    const enabled = $('#portableCacheCleanupPromptInput').checked;
    await window.quickPet.updateSettings({ portableCacheCleanupPrompt: enabled });
    showToast(enabled ? '旧版缓存提醒已开启' : '旧版缓存提醒已关闭');
  });
  $('#checkUpdateButton').addEventListener('click', async () => {
    $('#checkUpdateButton').disabled = true;
    try {
      const result = await window.quickPet.checkForUpdates();
      showToast(result.status === 'available' ? `发现新版本 ${result.version}` : result.status === 'unavailable' ? result.message : '当前已经是最新版本');
    } catch (error) { showToast(cleanError(error), 'error'); }
    finally { $('#checkUpdateButton').disabled = false; }
  });
  $('#downloadUpdateButton').addEventListener('click', async () => {
    try {
      const result = await window.quickPet.downloadUpdate();
      if (result) showToast(/^https:\/\//i.test(result) ? '已打开 GitHub 发布页' : '更新包已下载并通过校验');
    } catch (error) { showToast(cleanError(error), 'error'); }
  });
  $('#openProjectButton').addEventListener('click', () => window.quickPet.openProjectPage());

  $('#addCategoryForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await window.quickPet.addCategory({ name: $('#newCategoryName').value, icon: $('#newCategoryIcon').value, color: $('#newCategoryColor').value, parentId: $('#newCategoryParent').value });
      $('#newCategoryName').value = '';
      showToast('新分类已添加');
    } catch (error) { showToast(cleanError(error), 'error'); }
  });
  elements.categoryManager.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-action]');
    const row = event.target.closest('.category-edit-row');
    if (!button || !row || button.disabled) return;
    try {
      if (button.dataset.action === 'delete') {
        if (!await confirmAction({ title: '删除分类', message: '此分类中的快捷方式会变为未分类，下级分类会提升为顶级分类。', confirmLabel: '删除分类' })) return;
        await window.quickPet.removeCategory(row.dataset.id);
      } else {
        await window.quickPet.moveCategory(row.dataset.id, button.dataset.action);
      }
    } catch (error) { showToast(cleanError(error), 'error'); }
  });
  elements.categoryManager.addEventListener('change', async (event) => {
    const row = event.target.closest('.category-edit-row');
    if (!row) return;
    try {
      await window.quickPet.updateCategory(row.dataset.id, {
        icon: row.querySelector('.category-icon-input').value,
        name: row.querySelector('.category-name-input').value,
        color: row.querySelector('.category-color-input').value,
        parentId: row.querySelector('.category-parent-input').value
      });
    } catch (error) { showToast(cleanError(error), 'error'); }
  });
}

function bindWindowControls() {
  $('#minimizeButton').addEventListener('click', () => window.quickPet.minimizeWindow());
  $('#closeButton').addEventListener('click', () => window.quickPet.hideWindow());
}

function bindAutomation() {
  $('#notificationButton').addEventListener('click', () => navigate('automation'));
  $('#clipboardMonitorInput').addEventListener('change', () => window.quickPet.updateSettings({ clipboardMonitor: $('#clipboardMonitorInput').checked }));
  $('#ruleForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await window.quickPet.addRule({ name: $('#ruleName').value, field: $('#ruleField').value, operator: $('#ruleOperator').value, value: $('#ruleValue').value, category: $('#ruleCategory').value, tags: $('#ruleTags').value.split(/[,，]/).map((item) => item.trim()).filter(Boolean) });
      event.target.reset(); showToast('智能规则已添加');
    } catch (error) { showToast(cleanError(error), 'error'); }
  });
  $('#ruleList').addEventListener('click', async (event) => {
    const row = event.target.closest('[data-rule-id]'); if (!row) return;
    if (event.target.dataset.action === 'delete-rule') await window.quickPet.removeRule(row.dataset.ruleId);
  });
  $('#ruleList').addEventListener('change', async (event) => {
    const row = event.target.closest('[data-rule-id]'); if (row && event.target.classList.contains('rule-enabled')) await window.quickPet.updateRule(row.dataset.ruleId, { enabled: event.target.checked });
  });
  $('#addWatchedFolderButton').addEventListener('click', async () => {
    try { const folderPath = await window.quickPet.chooseWatchedFolder(); if (folderPath) await window.quickPet.addWatchedFolder({ path: folderPath, category: 'other', tags: ['动态文件夹'] }); } catch (error) { showToast(cleanError(error), 'error'); }
  });
  $('#watchedFolderList').addEventListener('click', async (event) => { const row = event.target.closest('[data-folder-id]'); if (row && event.target.dataset.action === 'delete-folder') await window.quickPet.removeWatchedFolder(row.dataset.folderId); });
  $('#watchedFolderList').addEventListener('change', async (event) => { const row = event.target.closest('[data-folder-id]'); if (row && event.target.classList.contains('folder-enabled')) await window.quickPet.updateWatchedFolder(row.dataset.folderId, { enabled: event.target.checked }); });
  $('#reminderForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const dueAt = new Date($('#reminderTime').value).getTime();
    if (!dueAt || dueAt <= Date.now()) return showToast('提醒时间需要晚于现在', 'error');
    try { await window.quickPet.addReminder({ title: $('#reminderTitle').value, note: $('#reminderNote').value, dueAt, repeat: $('#reminderRepeat').value }); event.target.reset(); showToast('提醒已添加'); } catch (error) { showToast(cleanError(error), 'error'); }
  });
  $('#reminderList').addEventListener('click', async (event) => { const row = event.target.closest('[data-reminder-id]'); if (row && event.target.dataset.action === 'delete-reminder') await window.quickPet.removeReminder(row.dataset.reminderId); });
  $('#reminderList').addEventListener('click', async (event) => {
    const row = event.target.closest('[data-reminder-id]');
    const action = event.target.dataset.action;
    if (!row || !action || action === 'delete-reminder') return;
    const reminder = state.reminders.find((item) => item.id === row.dataset.reminderId);
    if (!reminder) return;
    if (action === 'complete-reminder') await window.quickPet.updateReminder(reminder.id, { completedAt: reminder.completedAt ? 0 : Date.now(), enabled: Boolean(reminder.completedAt) });
    if (action === 'snooze-reminder') await window.quickPet.updateReminder(reminder.id, { dueAt: Date.now() + 10 * 60 * 1000, lastTriggeredAt: 0, enabled: true });
  });
  $('#reminderFilters').addEventListener('click', (event) => {
    const filter = event.target.dataset.reminderFilter;
    if (!filter) return;
    reminderFilter = filter;
    renderAutomation();
  });
  $('#calendarPreviousButton').addEventListener('click', () => { calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1); renderAutomation(); });
  $('#calendarNextButton').addEventListener('click', () => { calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1); renderAutomation(); });
  $('#calendarTodayButton').addEventListener('click', () => { const now = new Date(); calendarMonth = new Date(now.getFullYear(), now.getMonth(), 1); renderAutomation(); });
  $('#reminderCalendar').addEventListener('click', (event) => {
    const key = event.target.closest('[data-calendar-date]')?.dataset.calendarDate;
    if (!key) return;
    const selected = new Date(`${key}T09:00:00`);
    if (selected.getTime() <= Date.now()) selected.setTime(Date.now() + 60 * 60 * 1000);
    $('#reminderTime').value = new Date(selected.getTime() - selected.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    $('#reminderTitle').focus();
  });
  $('#readNotificationsButton').addEventListener('click', () => window.quickPet.markNotificationsRead());
  $('#clearNotificationsButton').addEventListener('click', () => window.quickPet.clearNotifications());
  $('#addCompanionButton').addEventListener('click', async () => { try { await window.quickPet.addCompanion({ name: `伙伴 ${(state.companions || []).length + 1}`, renderMode: '3d', personality: 'lively' }); } catch (error) { showToast(cleanError(error), 'error'); } });
  $('#companionList').addEventListener('click', async (event) => { const card = event.target.closest('[data-companion-id]'); if (card && event.target.dataset.action === 'delete-companion') await window.quickPet.removeCompanion(card.dataset.companionId); });
  $('#companionList').addEventListener('change', async (event) => {
    const card = event.target.closest('[data-companion-id]'); if (!card) return;
    const modelId = card.querySelector('.companion-model').value;
    const model = state.models.find((item) => item.id === modelId);
    await window.quickPet.updateCompanion(card.dataset.companionId, { name: card.querySelector('.companion-name').value, modelPreset: modelId ? 'custom' : 'fox', activeModelId: modelId, renderMode: model?.format === 'live2d' ? '2d' : '3d', personality: card.querySelector('.companion-personality').value, scale: Number(card.querySelector('.companion-scale').value) / 100, enabled: card.querySelector('.companion-enabled').checked });
  });
}

async function initialize() {
  try {
    [state, backups, storageReport] = await Promise.all([
      window.quickPet.getState(),
      window.quickPet.listBackups(),
      window.quickPet.getStorageReport()
    ]);
    organizeSettingsLayout();
    renderAll();
    bindNavigation();
    bindLibraryActions();
    bindModal();
    bindDrop();
    bindSettings();
    bindAutomation();
    bindWindowControls();
    window.quickPet.onStateChanged((nextState) => { state = nextState; renderAll(); });
    window.quickPet.onCacheCleanupProgress((progress) => {
      cacheCleanupProgress = progress;
      renderCacheCleanupProgress();
    });
    window.quickPet.onNavigateSettings(() => navigate('settings'));
    window.quickPet.onNavigateAutomation(() => navigate('automation'));
    window.quickPet.rendererReady();
  } catch (error) {
    showToast('启动失败：' + cleanError(error), 'error');
  }
}

initialize();
