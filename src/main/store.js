'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { normalizeHotkey } = require('./shortcut-hotkeys');
const { rateModelPerformance } = require('../shared/model-performance');
const {
  DEFAULT_CATEGORIES,
  LEGACY_CATEGORIES,
  classifyShortcut,
  displayNameFromTarget,
  inferType,
  normalizeTarget
} = require('../shared/classifier');

const DEFAULT_SETTINGS = {
  theme: 'system',
  accent: '#171717',
  panelOpacity: 0.98,
  panelWidth: 1040,
  panelHeight: 720,
  petScale: 1,
  petAlwaysOnTop: true,
  autoWalk: true,
  petWalkSpeed: 46,
  launchAtLogin: false,
  petImageData: '',
  petOriginalImageData: '',
  petImagePath: '',
  petOriginalImagePath: '',
  petImageName: '',
  petModelName: '',
  petModelPreset: 'fox',
  activeModelId: '',
  petBackgroundRemoved: false,
  autoRemoveBackground: true,
  petRenderMode: '2d',
  naturalBehavior: true,
  nightSleep: true,
  petScreenMode: 'current',
  hideOnFullscreen: true,
  edgeSnap: true,
  activityPadding: 12,
  globalSearchShortcut: 'Alt+Space',
  quickLaunchShortcut: 'CommandOrControl+Alt+Space',
  clipboardMonitor: true,
  notificationsEnabled: true,
  performanceMode: 'efficient',
  sortBy: 'recent',
  autoCheckUpdates: true,
  portableCacheCleanupPrompt: true
};

const DEFAULT_PET_STATUS = {
  name: '暖暖',
  mood: 82,
  hunger: 76,
  affection: 20,
  lastUpdatedAt: 0
};

function freshData() {
  return {
    version: 3,
    shortcuts: [],
    categories: DEFAULT_CATEGORIES.map((item) => ({ ...item })),
    settings: { ...DEFAULT_SETTINGS },
    models: [],
    petStatus: { ...DEFAULT_PET_STATUS, lastUpdatedAt: Date.now() },
    rules: [],
    reminders: [],
    watchedFolders: [],
    notifications: [],
    companions: []
  };
}

function normalizeKey(target) {
  return String(target).trim().replace(/[\\/]+$/, '').toLowerCase();
}

function cleanAssetReference(value) {
  const normalized = String(value || '').replaceAll('\\', '/');
  return normalized && !normalized.startsWith('/') && !normalized.split('/').includes('..')
    ? normalized.slice(0, 260)
    : '';
}

function legacyCategoryDestination(item) {
  const match = LEGACY_CATEGORIES.find((legacy) => legacy.id === String(item?.id || ''));
  if (!match) return '';
  return match.name === String(item.name) && match.icon === String(item.icon) && match.color.toLowerCase() === String(item.color).toLowerCase()
    ? match.destination
    : '';
}

function ruleMatches(rule, item) {
  if (rule.enabled === false) return false;
  const value = String(rule.value || '').trim().toLowerCase();
  if (!value) return false;
  const fieldValue = rule.field === 'name'
    ? String(item.name || '').toLowerCase()
    : rule.field === 'type'
      ? String(item.type || '').toLowerCase()
      : rule.field === 'extension'
        ? path.extname(String(item.target || '')).slice(1).toLowerCase()
        : String(item.target || '').toLowerCase();
  if (rule.operator === 'equals') return fieldValue === value;
  if (rule.operator === 'starts') return fieldValue.startsWith(value);
  return fieldValue.includes(value);
}

class Store {
  constructor(filePath, { assetStore = null } = {}) {
    this.filePath = filePath;
    this.assetStore = assetStore;
    this.saveTimer = null;
    this.data = freshData();
    this.load();
  }

  load() {
    try {
      if (!fs.existsSync(this.filePath)) {
        this.save();
        return;
      }
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      this.data = this.validate(parsed);
      const migratedData = JSON.stringify(parsed) !== JSON.stringify(this.data);
      const migratedAssets = this.migrateInlineAssets();
      if (this.refreshPetStatus() || migratedAssets || migratedData) this.save();
    } catch (error) {
      const backup = `${this.filePath}.broken-${Date.now()}`;
      try { fs.copyFileSync(this.filePath, backup); } catch {}
      this.data = freshData();
      this.save();
    }
  }

  validate(input) {
    const base = freshData();
    if (!input || typeof input !== 'object') return base;
    const rawCategories = Array.isArray(input.categories) && input.categories.length
      ? input.categories.filter((item) => item && item.id && item.name)
      : [];
    const categoryRedirects = new Map(rawCategories.map((item) => [String(item.id), legacyCategoryDestination(item)]).filter(([, destination]) => destination));
    const categories = rawCategories.length
      ? rawCategories.filter((item) => !categoryRedirects.has(String(item.id))).map((item, index) => ({
        id: String(item.id),
        name: String(item.name).slice(0, 16),
        icon: String(item.icon || '✨').slice(0, 4),
        color: /^#[0-9a-f]{6}$/i.test(item.color || '') ? item.color : '#9aa0b5',
        parentId: String(item.parentId || ''),
        sortOrder: Number.isFinite(Number(item.sortOrder)) ? Number(item.sortOrder) : index
      }))
      : base.categories.map((item, index) => ({ ...item, parentId: '', sortOrder: index }));
    const categoryIds = new Set(categories.map((item) => item.id));
    if (!categoryIds.has('other')) {
      categories.push({ ...DEFAULT_CATEGORIES.at(-1), parentId: '', sortOrder: categories.length });
      categoryIds.add('other');
    }
    categories.forEach((item, index) => {
      if (!categoryIds.has(item.parentId) || item.parentId === item.id) item.parentId = '';
      if (!Number.isFinite(item.sortOrder)) item.sortOrder = index;
    });

    const rawModels = Array.isArray(input.models) ? input.models : [];
    const models = rawModels.filter((item) => item && item.id && item.fileName).map((item) => {
      const model = {
        id: String(item.id),
        name: String(item.name || '自定义模型').trim().slice(0, 80),
        fileName: path.basename(String(item.fileName)),
        entryFile: path.basename(String(item.entryFile || item.fileName)),
        format: ['glb', 'vrm', 'live2d'].includes(item.format) ? item.format : 'glb',
        size: Math.max(0, Number(item.size) || 0),
        createdAt: Number(item.createdAt) || Date.now(),
        materialStatus: ['standard', 'fixed-legacy', 'unknown'].includes(item.materialStatus) ? item.materialStatus : 'unknown',
        convertedMaterials: Math.max(0, Number(item.convertedMaterials) || 0),
        textureCount: Math.max(0, Number(item.textureCount) || 0),
        materialCount: Math.max(0, Number(item.materialCount) || 0),
        thumbnailData: /^data:image\//.test(item.thumbnailData || '') ? String(item.thumbnailData).slice(0, 3_000_000) : '',
        thumbnailPath: cleanAssetReference(item.thumbnailPath),
        animationNames: Array.isArray(item.animationNames) ? item.animationNames.map(String).slice(0, 100) : [],
        expressionNames: Array.isArray(item.expressionNames) ? item.expressionNames.map(String).slice(0, 100) : [],
        inspection: {
          warnings: Array.isArray(item.inspection?.warnings) ? item.inspection.warnings.map(String).slice(0, 20) : [],
          hasSkeleton: Boolean(item.inspection?.hasSkeleton),
          vertexCount: Math.max(0, Number(item.inspection?.vertexCount) || 0),
          missingFiles: Array.isArray(item.inspection?.missingFiles) ? item.inspection.missingFiles.map(String).slice(0, 50) : []
        },
        transform: {
          scale: Math.min(3, Math.max(0.25, Number(item.transform?.scale) || 1)),
          rotationY: Math.min(180, Math.max(-180, Number(item.transform?.rotationY) || 0)),
          flip: Boolean(item.transform?.flip),
          verticalOffset: Math.min(1.5, Math.max(-1.5, Number(item.transform?.verticalOffset) || 0))
        },
        animationMap: {
          idle: String(item.animationMap?.idle || ''),
          walk: String(item.animationMap?.walk || ''),
          run: String(item.animationMap?.run || ''),
          sit: String(item.animationMap?.sit || ''),
          sleep: String(item.animationMap?.sleep || ''),
          stretch: String(item.animationMap?.stretch || '')
        }
      };
      model.performance = rateModelPerformance({
        format: model.format,
        size: model.size,
        textureCount: model.textureCount,
        materialCount: model.materialCount,
        vertexCount: model.inspection.vertexCount,
        hasSkeleton: model.inspection.hasSkeleton
      });
      return model;
    });

    const status = input.petStatus && typeof input.petStatus === 'object' ? input.petStatus : {};
    const settings = { ...base.settings, ...(input.settings || {}) };
    settings.globalSearchShortcut = normalizeHotkey(settings.globalSearchShortcut) || DEFAULT_SETTINGS.globalSearchShortcut;
    settings.quickLaunchShortcut = normalizeHotkey(settings.quickLaunchShortcut) || DEFAULT_SETTINGS.quickLaunchShortcut;
    const existingItemHotkeys = new Set((Array.isArray(input.shortcuts) ? input.shortcuts : []).map((item) => normalizeHotkey(item?.hotkey)).filter(Boolean));
    if (settings.quickLaunchShortcut === settings.globalSearchShortcut || existingItemHotkeys.has(settings.quickLaunchShortcut)) {
      settings.quickLaunchShortcut = [DEFAULT_SETTINGS.quickLaunchShortcut, 'CommandOrControl+Shift+Space', 'Alt+F10']
        .find((hotkey) => hotkey !== settings.globalSearchShortcut && !existingItemHotkeys.has(hotkey)) || 'Alt+F10';
    }
    delete settings.updateFeedUrl;
    settings.petImagePath = cleanAssetReference(settings.petImagePath);
    settings.petOriginalImagePath = cleanAssetReference(settings.petOriginalImagePath);
    if (['#df5b3f', '#3f66d4'].includes(String(settings.accent).toLowerCase())) settings.accent = DEFAULT_SETTINGS.accent;
    if (!['fox', 'custom'].includes(settings.petModelPreset)) {
      settings.petModelPreset = 'fox';
      settings.activeModelId = '';
      settings.petModelName = '';
    }
    const rules = (Array.isArray(input.rules) ? input.rules : []).filter((item) => item && item.value).map((item) => ({
      id: String(item.id || crypto.randomUUID()),
      name: String(item.name || '自动分类规则').slice(0, 40),
      field: ['name', 'target', 'type', 'extension'].includes(item.field) ? item.field : 'target',
      operator: ['contains', 'equals', 'starts'].includes(item.operator) ? item.operator : 'contains',
      value: String(item.value).slice(0, 120),
      category: categoryIds.has(categoryRedirects.get(String(item.category)) || item.category) ? (categoryRedirects.get(String(item.category)) || item.category) : 'other',
      tags: Array.isArray(item.tags) ? item.tags.map(String).filter(Boolean).slice(0, 8) : [],
      enabled: item.enabled !== false
    }));
    const reminders = (Array.isArray(input.reminders) ? input.reminders : []).filter((item) => item && item.title).map((item) => ({
      id: String(item.id || crypto.randomUUID()),
      title: String(item.title).slice(0, 80),
      note: String(item.note || '').slice(0, 240),
      dueAt: Math.max(0, Number(item.dueAt) || 0),
      repeat: ['none', 'daily', 'weekdays', 'weekly', 'monthly'].includes(item.repeat) ? item.repeat : 'none',
      enabled: item.enabled !== false,
      lastTriggeredAt: Math.max(0, Number(item.lastTriggeredAt) || 0),
      completedAt: Math.max(0, Number(item.completedAt) || 0)
    }));
    const watchedFolders = (Array.isArray(input.watchedFolders) ? input.watchedFolders : []).filter((item) => item && item.path).map((item) => ({
      id: String(item.id || crypto.randomUUID()),
      name: String(item.name || path.basename(item.path)).slice(0, 80),
      path: path.resolve(String(item.path)),
      category: categoryIds.has(categoryRedirects.get(String(item.category)) || item.category) ? (categoryRedirects.get(String(item.category)) || item.category) : 'other',
      tags: Array.isArray(item.tags) ? item.tags.map(String).filter(Boolean).slice(0, 8) : ['动态文件夹'],
      enabled: item.enabled !== false
    }));
    const notifications = (Array.isArray(input.notifications) ? input.notifications : []).filter((item) => item && item.message).map((item) => ({
      id: String(item.id || crypto.randomUUID()),
      title: String(item.title || '快捷宠').slice(0, 60),
      message: String(item.message).slice(0, 240),
      kind: ['info', 'success', 'warning', 'reminder'].includes(item.kind) ? item.kind : 'info',
      createdAt: Number(item.createdAt) || Date.now(),
      read: Boolean(item.read)
    })).slice(0, 100);
    const companions = (Array.isArray(input.companions) ? input.companions : []).filter((item) => item && item.id).map((item) => ({
      id: String(item.id),
      name: String(item.name || '新伙伴').slice(0, 20),
      modelPreset: item.modelPreset === 'custom' ? 'custom' : 'fox',
      activeModelId: models.some((model) => model.id === item.activeModelId) ? String(item.activeModelId) : '',
      renderMode: item.renderMode === '2d' ? '2d' : '3d',
      scale: Math.min(1.45, Math.max(0.7, Number(item.scale) || 1)),
      screenMode: item.screenMode === 'all' ? 'all' : 'current',
      personality: ['calm', 'lively', 'sleepy'].includes(item.personality) ? item.personality : 'lively',
      enabled: item.enabled !== false
    })).slice(0, 4);
    return {
      version: 3,
      categories,
      shortcuts: Array.isArray(input.shortcuts) ? input.shortcuts.filter((item) => item && item.target).map((item) => ({
        id: String(item.id || crypto.randomUUID()),
        name: String(item.name || displayNameFromTarget(item.target)).slice(0, 100),
        target: normalizeTarget(item.target),
        type: inferType(item.target, item.type),
        category: categoryIds.has(categoryRedirects.get(String(item.category)) || item.category) ? (categoryRedirects.get(String(item.category)) || item.category) : 'other',
        tags: Array.isArray(item.tags) ? item.tags.map(String).slice(0, 12) : [],
        favorite: Boolean(item.favorite),
        createdAt: Number(item.createdAt) || Date.now(),
        updatedAt: Number(item.updatedAt) || Date.now(),
        lastUsedAt: Number(item.lastUsedAt) || 0,
        useCount: Number(item.useCount) || 0,
        status: ['ok', 'broken', 'unknown'].includes(item.status) ? item.status : 'unknown',
        lastCheckedAt: Number(item.lastCheckedAt) || 0,
        iconData: /^data:image\//.test(item.iconData || '') ? String(item.iconData).slice(0, 1_500_000) : '',
        iconPath: cleanAssetReference(item.iconPath),
        iconBackground: /^#[0-9a-f]{6}$/i.test(item.iconBackground || '') ? item.iconBackground : '',
        hotkey: normalizeHotkey(item.hotkey),
        sortOrder: Number.isFinite(Number(item.sortOrder)) ? Number(item.sortOrder) : 0
      })) : [],
      settings,
      models,
      rules,
      reminders,
      watchedFolders,
      notifications,
      companions,
      petStatus: {
        name: String(status.name || DEFAULT_PET_STATUS.name).trim().slice(0, 20) || DEFAULT_PET_STATUS.name,
        mood: Math.min(100, Math.max(0, Number.isFinite(Number(status.mood)) ? Number(status.mood) : DEFAULT_PET_STATUS.mood)),
        hunger: Math.min(100, Math.max(0, Number.isFinite(Number(status.hunger)) ? Number(status.hunger) : DEFAULT_PET_STATUS.hunger)),
        affection: Math.min(100, Math.max(0, Number.isFinite(Number(status.affection)) ? Number(status.affection) : 0)),
        lastUpdatedAt: Number(status.lastUpdatedAt) || Date.now()
      }
    };
  }

  save() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(this.data, null, 2), 'utf8');
    fs.renameSync(tempPath, this.filePath);
  }

  scheduleSave(delay = 250) {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), Math.max(25, Number(delay) || 250));
  }

  flushScheduledSave() {
    if (this.saveTimer) this.save();
  }

  snapshot() {
    if (this.refreshPetStatus()) this.save();
    return JSON.parse(JSON.stringify(this.data));
  }

  rendererSnapshot() {
    const snapshot = this.snapshot();
    if (!this.assetStore) return snapshot;
    snapshot.settings.petImageData = this.assetStore.url(snapshot.settings.petImagePath) || snapshot.settings.petImageData;
    snapshot.settings.petOriginalImageData = this.assetStore.url(snapshot.settings.petOriginalImagePath) || snapshot.settings.petOriginalImageData;
    for (const item of snapshot.shortcuts) item.iconData = this.assetStore.url(item.iconPath) || item.iconData;
    for (const model of snapshot.models) model.thumbnailData = this.assetStore.url(model.thumbnailPath) || model.thumbnailData;
    return snapshot;
  }

  migrateInlineAssets() {
    if (!this.assetStore) return false;
    let changed = false;
    const migrate = (owner, dataKey, pathKey, group, name) => {
      if (!/^data:image\//.test(owner[dataKey] || '')) return;
      owner[pathKey] = this.assetStore.saveDataUrl(owner[dataKey], group, name);
      owner[dataKey] = '';
      changed = true;
    };
    migrate(this.data.settings, 'petImageData', 'petImagePath', 'skins', 'pet-image');
    migrate(this.data.settings, 'petOriginalImageData', 'petOriginalImagePath', 'skins', 'pet-original');
    for (const item of this.data.shortcuts) migrate(item, 'iconData', 'iconPath', 'shortcuts', item.id);
    for (const model of this.data.models) migrate(model, 'thumbnailData', 'thumbnailPath', 'models', model.id);
    return changed;
  }

  refreshPetStatus(now = Date.now()) {
    const current = this.data.petStatus;
    const elapsed = Math.max(0, now - Number(current.lastUpdatedAt || now));
    if (elapsed < 10 * 60 * 1000) return false;
    const hours = elapsed / 3600000;
    current.hunger = Math.max(0, current.hunger - hours * 2.2);
    if (current.hunger < 35) current.mood = Math.max(0, current.mood - hours * 0.7);
    current.lastUpdatedAt = now;
    return true;
  }

  addShortcut(input, { persist = true } = {}) {
    const target = normalizeTarget(input.target);
    if (!target) throw new Error('请输入网址或选择文件');
    if (this.data.shortcuts.some((item) => normalizeKey(item.target) === normalizeKey(target))) {
      const error = new Error('这个快捷方式已经收纳过了');
      error.code = 'DUPLICATE';
      throw error;
    }
    const type = inferType(target, input.type);
    const autoCategory = classifyShortcut({ name: input.name, target, type });
    const availableCategories = new Set(this.data.categories.map((item) => item.id));
    const baseItem = { name: input.name || displayNameFromTarget(target), target, type };
    const matchedRule = this.data.rules.find((rule) => ruleMatches(rule, baseItem));
    const hotkey = normalizeHotkey(input.hotkey);
    if (input.hotkey && !hotkey) throw new Error('组合键需要包含 Ctrl、Alt、Shift 或 Win，并搭配一个按键');
    if ([this.data.settings.globalSearchShortcut, this.data.settings.quickLaunchShortcut].map(normalizeHotkey).includes(hotkey) || this.data.shortcuts.some((entry) => normalizeHotkey(entry.hotkey) === hotkey && hotkey)) throw new Error('这个组合键已经被占用');
    const item = {
      id: crypto.randomUUID(),
      name: String(input.name || displayNameFromTarget(target)).trim().slice(0, 100),
      target,
      type,
      category: availableCategories.has(input.category)
        ? input.category
        : matchedRule?.category || autoCategory,
      tags: [...new Set([
        ...(Array.isArray(input.tags) ? input.tags : []),
        ...(matchedRule?.tags || [])
      ].map((tag) => String(tag).trim()).filter(Boolean))].slice(0, 12),
      favorite: Boolean(input.favorite),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastUsedAt: 0,
      useCount: 0,
      status: 'unknown',
      lastCheckedAt: 0,
      iconData: /^data:image\//.test(input.iconData || '') ? String(input.iconData).slice(0, 1_500_000) : '',
      iconPath: cleanAssetReference(input.iconPath),
      iconBackground: /^#[0-9a-f]{6}$/i.test(input.iconBackground || '') ? input.iconBackground : '',
      hotkey,
      sortOrder: Math.max(-1, ...this.data.shortcuts.filter((entry) => entry.category === (availableCategories.has(input.category) ? input.category : matchedRule?.category || autoCategory)).map((entry) => Number(entry.sortOrder) || 0)) + 1
    };
    if (this.assetStore && item.iconData) {
      item.iconPath = this.assetStore.saveDataUrl(item.iconData, 'shortcuts', item.id);
      item.iconData = '';
    }
    this.data.shortcuts.unshift(item);
    if (persist) this.save();
    return item;
  }

  updateShortcut(id, changes) {
    const item = this.data.shortcuts.find((entry) => entry.id === id);
    if (!item) throw new Error('没有找到这个快捷方式');
    if (changes.target && normalizeKey(changes.target) !== normalizeKey(item.target)) {
      if (this.data.shortcuts.some((entry) => entry.id !== id && normalizeKey(entry.target) === normalizeKey(changes.target))) {
        throw new Error('这个快捷方式已经存在');
      }
      item.target = normalizeTarget(changes.target);
      item.type = inferType(item.target, changes.type);
    } else if (typeof changes.type === 'string') item.type = inferType(item.target, changes.type);
    if (typeof changes.name === 'string' && changes.name.trim()) item.name = changes.name.trim().slice(0, 100);
    if (typeof changes.category === 'string' && this.data.categories.some((entry) => entry.id === changes.category)) item.category = changes.category;
    if (Array.isArray(changes.tags)) item.tags = changes.tags.map((tag) => String(tag).trim()).filter(Boolean).slice(0, 12);
    if (typeof changes.favorite === 'boolean') item.favorite = changes.favorite;
    if (typeof changes.iconData === 'string') {
      item.iconData = /^data:image\//.test(changes.iconData) ? changes.iconData.slice(0, 1_500_000) : '';
      item.iconPath = '';
      if (this.assetStore && item.iconData) {
        item.iconPath = this.assetStore.saveDataUrl(item.iconData, 'shortcuts', item.id);
        item.iconData = '';
      }
    }
    if (typeof changes.iconBackground === 'string') item.iconBackground = /^#[0-9a-f]{6}$/i.test(changes.iconBackground) ? changes.iconBackground : '';
    if (typeof changes.hotkey === 'string') {
      const hotkey = normalizeHotkey(changes.hotkey);
      if (changes.hotkey && !hotkey) throw new Error('组合键需要包含 Ctrl、Alt、Shift 或 Win，并搭配一个按键');
      if ([this.data.settings.globalSearchShortcut, this.data.settings.quickLaunchShortcut].map(normalizeHotkey).includes(hotkey) || this.data.shortcuts.some((entry) => entry.id !== id && normalizeHotkey(entry.hotkey) === hotkey && hotkey)) throw new Error('这个组合键已经被占用');
      item.hotkey = hotkey;
    }
    item.updatedAt = Date.now();
    this.save();
    return item;
  }

  reorderShortcut(id, beforeId = '', category = '') {
    const item = this.data.shortcuts.find((entry) => entry.id === id);
    if (!item) throw new Error('没有找到这个快捷方式');
    const nextCategory = this.data.categories.some((entry) => entry.id === category) ? category : item.category;
    const siblings = this.data.shortcuts
      .filter((entry) => entry.id !== id && entry.category === nextCategory)
      .sort((a, b) => (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0));
    const targetIndex = beforeId ? siblings.findIndex((entry) => entry.id === beforeId) : siblings.length;
    siblings.splice(targetIndex < 0 ? siblings.length : targetIndex, 0, item);
    item.category = nextCategory;
    siblings.forEach((entry, index) => { entry.sortOrder = index; });
    item.updatedAt = Date.now();
    this.save();
    return item;
  }

  removeShortcut(id) {
    const removed = this.data.shortcuts.find((item) => item.id === id);
    const before = this.data.shortcuts.length;
    this.data.shortcuts = this.data.shortcuts.filter((item) => item.id !== id);
    if (this.data.shortcuts.length === before) return false;
    if (removed?.iconPath) this.assetStore?.remove(removed.iconPath);
    this.save();
    return true;
  }

  removeAllShortcuts() {
    const count = this.data.shortcuts.length;
    if (!count) return 0;
    for (const item of this.data.shortcuts) if (item.iconPath) this.assetStore?.remove(item.iconPath);
    this.data.shortcuts = [];
    this.save();
    return count;
  }

  recordUse(id) {
    const item = this.data.shortcuts.find((entry) => entry.id === id);
    if (!item) return;
    item.lastUsedAt = Date.now();
    item.useCount += 1;
    this.scheduleSave();
  }

  resetUsage() {
    this.data.shortcuts.forEach((item) => {
      item.useCount = 0;
      item.lastUsedAt = 0;
    });
    this.save();
    return true;
  }

  setCheckResult(id, status) {
    const item = this.data.shortcuts.find((entry) => entry.id === id);
    if (!item) return;
    item.status = status;
    item.lastCheckedAt = Date.now();
  }

  updateSettings(changes) {
    const next = { ...this.data.settings, ...changes };
    for (const key of ['globalSearchShortcut', 'quickLaunchShortcut']) {
      if (!Object.hasOwn(changes, key)) continue;
      const hotkey = normalizeHotkey(changes[key]);
      if (!hotkey) throw new Error('组合键需要包含 Ctrl、Alt、Shift 或 Win，并搭配一个按键');
      next[key] = hotkey;
    }
    if (normalizeHotkey(next.globalSearchShortcut) === normalizeHotkey(next.quickLaunchShortcut)) throw new Error('搜索和启动台的快捷键不能相同');
    const reserved = new Set([normalizeHotkey(next.globalSearchShortcut), normalizeHotkey(next.quickLaunchShortcut)]);
    if (this.data.shortcuts.some((item) => item.hotkey && reserved.has(normalizeHotkey(item.hotkey)))) throw new Error('这个组合键已经被快捷项目占用');
    for (const [dataKey, pathKey, name] of [
      ['petImageData', 'petImagePath', 'pet-image'],
      ['petOriginalImageData', 'petOriginalImagePath', 'pet-original']
    ]) {
      if (typeof changes[dataKey] !== 'string') continue;
      next[pathKey] = '';
      if (this.assetStore && /^data:image\//.test(changes[dataKey])) {
        next[pathKey] = this.assetStore.saveDataUrl(changes[dataKey], 'skins', name);
        next[dataKey] = '';
      }
    }
    next.panelOpacity = Math.min(1, Math.max(0.72, Number(next.panelOpacity) || 0.98));
    next.panelWidth = Math.min(1500, Math.max(820, Number(next.panelWidth) || 1040));
    next.panelHeight = Math.min(1000, Math.max(580, Number(next.panelHeight) || 720));
    next.petScale = Math.min(1.45, Math.max(0.7, Number(next.petScale) || 1));
    next.petWalkSpeed = Math.min(110, Math.max(18, Number(next.petWalkSpeed) || 46));
    next.activityPadding = Math.min(300, Math.max(0, Number(next.activityPadding) || 0));
    if (!['light', 'dark', 'system'].includes(next.theme)) next.theme = 'system';
    if (!['2d', '3d'].includes(next.petRenderMode)) next.petRenderMode = '2d';
    if (!['fox', 'custom'].includes(next.petModelPreset)) next.petModelPreset = 'fox';
    if (!['current', 'all'].includes(next.petScreenMode)) next.petScreenMode = 'current';
    if (!['recent', 'name', 'created', 'used', 'manual'].includes(next.sortBy)) next.sortBy = 'recent';
    if (!['efficient', 'balanced', 'quality'].includes(next.performanceMode)) next.performanceMode = 'efficient';
    next.autoCheckUpdates = next.autoCheckUpdates !== false;
    next.portableCacheCleanupPrompt = next.portableCacheCleanupPrompt !== false;
    delete next.updateFeedUrl;
    this.data.settings = next;
    this.save();
    return next;
  }

  addModel(input) {
    const prepared = { ...input };
    if (this.assetStore && /^data:image\//.test(prepared.thumbnailData || '')) {
      prepared.thumbnailPath = this.assetStore.saveDataUrl(prepared.thumbnailData, 'models', prepared.id || 'model');
      prepared.thumbnailData = '';
    }
    const model = this.validate({ models: [prepared] }).models[0];
    if (!model) throw new Error('模型资料不完整');
    this.data.models.push(model);
    this.data.settings.activeModelId = model.id;
    this.data.settings.petModelName = model.name;
    this.data.settings.petModelPreset = 'custom';
    this.data.settings.petRenderMode = '3d';
    this.save();
    return model;
  }

  updateModel(id, changes) {
    const current = this.data.models.find((item) => item.id === id);
    if (!current) throw new Error('没有找到这个模型');
    const merged = {
      ...current,
      ...changes,
      id: current.id,
      fileName: current.fileName,
      transform: { ...current.transform, ...(changes.transform || {}) },
      animationMap: { ...current.animationMap, ...(changes.animationMap || {}) }
    };
    if (this.assetStore && /^data:image\//.test(merged.thumbnailData || '')) {
      merged.thumbnailPath = this.assetStore.saveDataUrl(merged.thumbnailData, 'models', id);
      merged.thumbnailData = '';
    }
    const validated = this.validate({ models: [merged] }).models[0];
    Object.assign(current, validated);
    if (this.data.settings.activeModelId === id) this.data.settings.petModelName = current.name;
    this.save();
    return current;
  }

  removeModel(id) {
    const index = this.data.models.findIndex((item) => item.id === id);
    if (index < 0) return null;
    const [removed] = this.data.models.splice(index, 1);
    if (this.data.settings.activeModelId === id) {
      this.data.settings.activeModelId = '';
      this.data.settings.petModelName = '';
      this.data.settings.petModelPreset = 'fox';
    }
    this.save();
    return removed;
  }

  selectModel(id) {
    const model = this.data.models.find((item) => item.id === id);
    if (!model) throw new Error('没有找到这个模型');
    this.data.settings.activeModelId = id;
    this.data.settings.petModelName = model.name;
    this.data.settings.petModelPreset = 'custom';
    this.data.settings.petRenderMode = model.format === 'live2d' ? '2d' : '3d';
    this.save();
    return model;
  }

  updatePetStatus(changes) {
    const current = this.data.petStatus;
    if (typeof changes.name === 'string') current.name = changes.name.trim().slice(0, 20) || DEFAULT_PET_STATUS.name;
    for (const key of ['mood', 'hunger', 'affection']) {
      if (changes[key] !== undefined) current[key] = Math.min(100, Math.max(0, Number(changes[key]) || 0));
    }
    current.lastUpdatedAt = Date.now();
    this.scheduleSave();
    return current;
  }

  interactWithPet(kind) {
    const current = this.data.petStatus;
    if (kind === 'feed') {
      current.hunger = Math.min(100, current.hunger + 24);
      current.mood = Math.min(100, current.mood + 8);
      current.affection = Math.min(100, current.affection + 3);
    } else if (kind === 'play') {
      current.hunger = Math.max(0, current.hunger - 5);
      current.mood = Math.min(100, current.mood + 16);
      current.affection = Math.min(100, current.affection + 5);
    } else {
      current.mood = Math.min(100, current.mood + 5);
      current.affection = Math.min(100, current.affection + 2);
    }
    current.lastUpdatedAt = Date.now();
    this.scheduleSave();
    return current;
  }

  addRule(input) {
    const rule = this.validate({ categories: this.data.categories, rules: [{ ...input, id: crypto.randomUUID() }] }).rules[0];
    if (!rule) throw new Error('请填写规则内容');
    this.data.rules.push(rule);
    this.save();
    return rule;
  }

  updateRule(id, changes) {
    const current = this.data.rules.find((item) => item.id === id);
    if (!current) throw new Error('没有找到这条规则');
    const next = this.validate({ categories: this.data.categories, rules: [{ ...current, ...changes, id }] }).rules[0];
    Object.assign(current, next);
    this.save();
    return current;
  }

  removeRule(id) {
    const before = this.data.rules.length;
    this.data.rules = this.data.rules.filter((item) => item.id !== id);
    if (this.data.rules.length === before) return false;
    this.save();
    return true;
  }

  addReminder(input) {
    const reminder = this.validate({ reminders: [{ ...input, id: crypto.randomUUID() }] }).reminders[0];
    if (!reminder) throw new Error('请填写提醒内容');
    this.data.reminders.push(reminder);
    this.save();
    return reminder;
  }

  updateReminder(id, changes) {
    const current = this.data.reminders.find((item) => item.id === id);
    if (!current) throw new Error('没有找到这个提醒');
    const next = this.validate({ reminders: [{ ...current, ...changes, id }] }).reminders[0];
    Object.assign(current, next);
    this.save();
    return current;
  }

  removeReminder(id) {
    const before = this.data.reminders.length;
    this.data.reminders = this.data.reminders.filter((item) => item.id !== id);
    if (this.data.reminders.length === before) return false;
    this.save();
    return true;
  }

  addWatchedFolder(input) {
    const folder = this.validate({ categories: this.data.categories, watchedFolders: [{ ...input, id: crypto.randomUUID() }] }).watchedFolders[0];
    if (!folder) throw new Error('请选择要监控的文件夹');
    if (this.data.watchedFolders.some((item) => normalizeKey(item.path) === normalizeKey(folder.path))) throw new Error('这个文件夹已经在监控');
    this.data.watchedFolders.push(folder);
    this.save();
    return folder;
  }

  updateWatchedFolder(id, changes) {
    const current = this.data.watchedFolders.find((item) => item.id === id);
    if (!current) throw new Error('没有找到这个动态文件夹');
    const next = this.validate({ categories: this.data.categories, watchedFolders: [{ ...current, ...changes, id }] }).watchedFolders[0];
    if (this.data.watchedFolders.some((item) => item.id !== id && normalizeKey(item.path) === normalizeKey(next.path))) {
      throw new Error('这个文件夹已经在监控');
    }
    Object.assign(current, next);
    this.save();
    return current;
  }

  removeWatchedFolder(id) {
    const before = this.data.watchedFolders.length;
    this.data.watchedFolders = this.data.watchedFolders.filter((item) => item.id !== id);
    if (this.data.watchedFolders.length === before) return false;
    this.save();
    return true;
  }

  addNotification(input) {
    const notification = this.validate({ notifications: [{ ...input, id: crypto.randomUUID(), createdAt: Date.now() }] }).notifications[0];
    if (!notification) return null;
    this.data.notifications.unshift(notification);
    this.data.notifications = this.data.notifications.slice(0, 100);
    this.save();
    return notification;
  }

  markNotificationsRead() {
    this.data.notifications.forEach((item) => { item.read = true; });
    this.save();
    return true;
  }

  clearNotifications() {
    this.data.notifications = [];
    this.save();
    return true;
  }

  addCompanion(input = {}) {
    if (this.data.companions.length >= 4) throw new Error('最多可以同时添加 4 个伙伴');
    const companion = this.validate({ models: this.data.models, companions: [{ ...input, id: crypto.randomUUID() }] }).companions[0];
    if (!companion) throw new Error('伙伴资料不完整');
    this.data.companions.push(companion);
    this.save();
    return companion;
  }

  updateCompanion(id, changes) {
    const current = this.data.companions.find((item) => item.id === id);
    if (!current) throw new Error('没有找到这个伙伴');
    const next = this.validate({ models: this.data.models, companions: [{ ...current, ...changes, id }] }).companions[0];
    Object.assign(current, next);
    this.save();
    return current;
  }

  removeCompanion(id) {
    const before = this.data.companions.length;
    this.data.companions = this.data.companions.filter((item) => item.id !== id);
    if (this.data.companions.length === before) return false;
    this.save();
    return true;
  }

  addCategory(input) {
    const name = String(input.name || '').trim().slice(0, 16);
    if (!name) throw new Error('请填写分类名称');
    const id = `custom-${crypto.randomUUID()}`;
    const category = {
      id,
      name,
      icon: String(input.icon || '✨').slice(0, 4),
      color: /^#[0-9a-f]{6}$/i.test(input.color || '') ? input.color : '#4a4a46',
      parentId: this.data.categories.some((item) => item.id === input.parentId) ? input.parentId : '',
      sortOrder: Math.max(-1, ...this.data.categories.map((item) => Number(item.sortOrder) || 0)) + 1
    };
    this.data.categories.push(category);
    this.save();
    return category;
  }

  updateCategory(id, changes) {
    const item = this.data.categories.find((entry) => entry.id === id);
    if (!item) throw new Error('分类不存在');
    if (changes.name) item.name = String(changes.name).trim().slice(0, 16);
    if (changes.icon) item.icon = String(changes.icon).slice(0, 4);
    if (/^#[0-9a-f]{6}$/i.test(changes.color || '')) item.color = changes.color;
    if (typeof changes.parentId === 'string') {
      const parentId = changes.parentId;
      if (!parentId) item.parentId = '';
      else if (parentId !== id && this.data.categories.some((entry) => entry.id === parentId)) {
        let cursor = this.data.categories.find((entry) => entry.id === parentId);
        while (cursor) {
          if (cursor.id === id) throw new Error('不能把分类放进自己的子分类');
          cursor = this.data.categories.find((entry) => entry.id === cursor.parentId);
        }
        item.parentId = parentId;
      }
    }
    this.save();
    return item;
  }

  removeCategory(id) {
    if (id === 'other') throw new Error('“其他”分类不能删除');
    if (!this.data.categories.some((item) => item.id === id)) return false;
    this.data.categories = this.data.categories.filter((item) => item.id !== id);
    for (const category of this.data.categories) {
      if (category.parentId === id) category.parentId = '';
    }
    for (const shortcut of this.data.shortcuts) {
      if (shortcut.category === id) shortcut.category = 'other';
    }
    this.save();
    return true;
  }

  moveCategory(id, direction) {
    const item = this.data.categories.find((entry) => entry.id === id);
    if (!item) return false;
    const siblings = this.data.categories
      .filter((entry) => entry.parentId === item.parentId)
      .sort((a, b) => (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0));
    const index = siblings.findIndex((entry) => entry.id === id);
    const nextIndex = direction === 'up' ? index - 1 : index + 1;
    if (index < 0 || nextIndex < 0 || nextIndex >= siblings.length) return false;
    [siblings[index], siblings[nextIndex]] = [siblings[nextIndex], siblings[index]];
    siblings.forEach((entry, order) => { entry.sortOrder = order; });
    this.save();
    return true;
  }

  replaceData(input) {
    this.data = this.validate(input);
    this.migrateInlineAssets();
    this.save();
    return this.snapshot();
  }
}

module.exports = { Store, DEFAULT_SETTINGS, freshData, ruleMatches };
