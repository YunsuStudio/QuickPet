'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('quickPet', {
  rendererReady: () => ipcRenderer.send('renderer:ready'),
  getState: () => ipcRenderer.invoke('state:get'),
  onStateChanged: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('state:changed', listener);
    return () => ipcRenderer.removeListener('state:changed', listener);
  },
  onNavigateSettings: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('navigate:settings', listener);
    return () => ipcRenderer.removeListener('navigate:settings', listener);
  },
  onNavigateAutomation: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('navigate:automation', listener);
    return () => ipcRenderer.removeListener('navigate:automation', listener);
  },
  onPetMotion: (callback) => {
    const listener = (_event, motion) => callback(motion);
    ipcRenderer.on('pet:motion', listener);
    return () => ipcRenderer.removeListener('pet:motion', listener);
  },
  onSearchFocus: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('search:focus', listener);
    return () => ipcRenderer.removeListener('search:focus', listener);
  },
  onClipboardCandidate: (callback) => {
    const listener = (_event, candidate) => callback(candidate);
    ipcRenderer.on('clipboard:candidate', listener);
    return () => ipcRenderer.removeListener('clipboard:candidate', listener);
  },
  pathForFile: (file) => webUtils.getPathForFile(file),
  togglePanel: (force) => ipcRenderer.invoke('panel:toggle', force),
  hideWindow: () => ipcRenderer.invoke('window:hide'),
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  chooseTargets: (kind) => ipcRenderer.invoke('shortcut:choose-targets', kind),
  addPaths: (paths) => ipcRenderer.invoke('shortcut:add-paths', paths),
  addShortcut: (input) => ipcRenderer.invoke('shortcut:add', input),
  updateShortcut: (id, changes) => ipcRenderer.invoke('shortcut:update', id, changes),
  reorderShortcut: (id, beforeId, category) => ipcRenderer.invoke('shortcut:reorder', id, beforeId, category),
  refreshShortcutIcon: (id) => ipcRenderer.invoke('shortcut:refresh-icon', id),
  chooseShortcutIcon: (id) => ipcRenderer.invoke('shortcut:choose-icon', id),
  clearShortcutIcon: (id) => ipcRenderer.invoke('shortcut:clear-icon', id),
  removeShortcut: (id) => ipcRenderer.invoke('shortcut:remove', id),
  openShortcut: (id) => ipcRenderer.invoke('shortcut:open', id),
  checkAll: () => ipcRenderer.invoke('shortcut:check-all'),
  resetUsage: () => ipcRenderer.invoke('shortcut:reset-usage'),
  scanShortcuts: (kind) => ipcRenderer.invoke('shortcut:scan', kind),
  importScannedShortcuts: (candidates) => ipcRenderer.invoke('shortcut:import-scan', candidates),
  addCategory: (input) => ipcRenderer.invoke('category:add', input),
  updateCategory: (id, changes) => ipcRenderer.invoke('category:update', id, changes),
  removeCategory: (id) => ipcRenderer.invoke('category:remove', id),
  moveCategory: (id, direction) => ipcRenderer.invoke('category:move', id, direction),
  updateSettings: (changes) => ipcRenderer.invoke('settings:update', changes),
  chooseSkin: () => ipcRenderer.invoke('skin:choose'),
  processSkinBackground: () => ipcRenderer.invoke('skin:process-background'),
  useOriginalSkin: () => ipcRenderer.invoke('skin:use-original'),
  resetSkin: () => ipcRenderer.invoke('skin:reset'),
  choosePetModel: () => ipcRenderer.invoke('model:choose'),
  choosePetModelPreview: () => ipcRenderer.invoke('model:choose-preview'),
  getPetModelPreviewBytes: (token) => ipcRenderer.invoke('model:preview-bytes', token),
  confirmPetModelImport: (token, name) => ipcRenderer.invoke('model:confirm-import', token, name),
  cancelPetModelPreview: (token) => ipcRenderer.invoke('model:cancel-preview', token),
  getPetModel: (companionId) => ipcRenderer.invoke('model:get', companionId),
  selectPetModel: (id) => ipcRenderer.invoke('model:select', id),
  updatePetModel: (id, changes) => ipcRenderer.invoke('model:update', id, changes),
  removePetModel: (id) => ipcRenderer.invoke('model:remove', id),
  resetPetModel: () => ipcRenderer.invoke('model:reset'),
  openPetModelLibrary: () => ipcRenderer.invoke('model:open-library'),
  updatePetStatus: (changes) => ipcRenderer.invoke('pet:status-update', changes),
  interactWithPet: (kind) => ipcRenderer.invoke('pet:interact', kind),
  exportBackup: () => ipcRenderer.invoke('backup:export'),
  importBackup: () => ipcRenderer.invoke('backup:import'),
  listBackups: () => ipcRenderer.invoke('backup:list'),
  createBackup: () => ipcRenderer.invoke('backup:create'),
  restoreBackup: (id) => ipcRenderer.invoke('backup:restore-auto', id),
  removeBackup: (id) => ipcRenderer.invoke('backup:remove', id),
  exportMigration: () => ipcRenderer.invoke('migration:export'),
  importMigration: () => ipcRenderer.invoke('migration:import'),
  getStorageReport: () => ipcRenderer.invoke('maintenance:report'),
  clearRuntimeCache: () => ipcRenderer.invoke('maintenance:clear-cache'),
  clearOldPortableCaches: () => ipcRenderer.invoke('maintenance:clear-old-portable-caches'),
  openDataFolder: () => ipcRenderer.invoke('maintenance:open-data'),
  exitSafeMode: () => ipcRenderer.invoke('maintenance:exit-safe-mode'),
  removeProgram: (removeUserData) => ipcRenderer.invoke('maintenance:remove-program', removeUserData),
  checkForUpdates: (feedUrl) => ipcRenderer.invoke('update:check', feedUrl),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  executeCommand: (id) => ipcRenderer.invoke('command:execute', id),
  showPetMenu: () => ipcRenderer.invoke('pet:context-menu'),
  setPetClickThrough: (ignore) => ipcRenderer.send('pet:set-click-through', Boolean(ignore)),
  beginPetDrag: (x, y) => ipcRenderer.send('pet:drag-begin', Number(x), Number(y)),
  activatePetDrag: () => ipcRenderer.send('pet:drag-activate'),
  movePetDrag: (x, y) => ipcRenderer.send('pet:drag-move', Number(x), Number(y)),
  endPetDrag: () => ipcRenderer.send('pet:drag-end'),
  hideSearch: () => ipcRenderer.invoke('search:hide'),
  toggleSearch: (force) => ipcRenderer.invoke('search:toggle', force),
  addRule: (input) => ipcRenderer.invoke('rule:add', input),
  updateRule: (id, changes) => ipcRenderer.invoke('rule:update', id, changes),
  removeRule: (id) => ipcRenderer.invoke('rule:remove', id),
  addReminder: (input) => ipcRenderer.invoke('reminder:add', input),
  updateReminder: (id, changes) => ipcRenderer.invoke('reminder:update', id, changes),
  removeReminder: (id) => ipcRenderer.invoke('reminder:remove', id),
  markNotificationsRead: () => ipcRenderer.invoke('notification:read-all'),
  clearNotifications: () => ipcRenderer.invoke('notification:clear'),
  openNotifications: () => ipcRenderer.invoke('notification:open'),
  chooseWatchedFolder: () => ipcRenderer.invoke('watched-folder:choose'),
  addWatchedFolder: (input) => ipcRenderer.invoke('watched-folder:add', input),
  updateWatchedFolder: (id, changes) => ipcRenderer.invoke('watched-folder:update', id, changes),
  removeWatchedFolder: (id) => ipcRenderer.invoke('watched-folder:remove', id),
  addCompanion: (input) => ipcRenderer.invoke('companion:add', input),
  updateCompanion: (id, changes) => ipcRenderer.invoke('companion:update', id, changes),
  removeCompanion: (id) => ipcRenderer.invoke('companion:remove', id),
  acceptClipboardCandidate: (candidate) => ipcRenderer.invoke('clipboard:accept', candidate),
  dismissClipboardCandidate: (target) => ipcRenderer.invoke('clipboard:dismiss', target)
});
