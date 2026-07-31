'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, Tray, Menu, nativeImage, screen, globalShortcut, clipboard, Notification, protocol, net, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { Store } = require('./store');
const { AssetStore } = require('./asset-store');
const { loginLaunchTarget, programRemovalTarget } = require('./portable-runtime');
const { removeBackground, removeBackgroundFromDataUrl } = require('./background-removal');
const { PetMotionController } = require('./pet-motion');
const { ModelLibrary } = require('./model-library');
const { scanSources } = require('./shortcut-scanner');
const { FullscreenWatcher } = require('./fullscreen-detector');
const { WatchedFolderManager } = require('./watched-folder-manager');
const { ReminderScheduler } = require('./reminder-scheduler');
const { centeredBounds } = require('./window-layout');
const { BackupManager } = require('./backup-manager');
const { ShortcutHotkeyRegistry } = require('./shortcut-hotkeys');
const { createLaunchPlan, launchTarget } = require('./shortcut-launcher');
const { StartupRecovery } = require('./startup-recovery');
const { MaintenanceManager, isPathInside } = require('./maintenance-manager');
const { MigrationManager } = require('./migration-manager');
const { UpdateManager } = require('./update-manager');
const { inferType, isProtocolTarget, isUrl, isWebUrl } = require('../shared/classifier');
const { COMMANDS } = require('../shared/commands');

const APP_NAME = '快捷宠';
const isLaunchProbe = process.argv.includes('--launch-probe');
const isSmokeTest = process.argv.includes('--smoke-test');
const isBackgroundRemovalTest = process.argv.includes('--background-removal-test');
const isMotionTest = process.argv.includes('--motion-test');
const is3dTest = process.argv.includes('--3d-test');
const is3dModelTest = process.argv.includes('--3d-model-test');
const isUiTest = process.argv.includes('--ui-test');
const isPerformanceTest = process.argv.includes('--performance-test');
const isClickThroughTest = process.argv.includes('--click-through-test');
const isDirectDragTest = process.argv.includes('--direct-drag-test');
const isCrossScreenTest = process.argv.includes('--cross-screen-test');
const isCrossScreenDragTest = process.argv.includes('--cross-screen-drag-test');
const isAcceptanceTest = process.argv.includes('--acceptance-test');
const isCacheCleanupTest = process.argv.includes('--cache-cleanup-test');
const isCacheProgressUiTest = process.argv.includes('--cache-progress-ui-test');
const isAutomatedTest = isSmokeTest || isBackgroundRemovalTest || isMotionTest || is3dTest || is3dModelTest || isUiTest || isPerformanceTest || isClickThroughTest || isDirectDragTest || isCrossScreenTest || isCrossScreenDragTest || isAcceptanceTest || isCacheCleanupTest || isCacheProgressUiTest;
const automatedSessionDirectory = isAutomatedTest ? path.join(os.tmpdir(), `quick-pet-test-session-${process.pid}`) : '';
if (automatedSessionDirectory) app.setPath('sessionData', automatedSessionDirectory);
if (is3dModelTest) app.setPath('userData', path.join(process.cwd(), 'tests', '.quick-pet-model-test-data'));
if (isUiTest) app.setPath('userData', path.join(process.cwd(), 'tests', '.quick-pet-ui-test-data'));
if (isPerformanceTest) app.setPath('userData', path.join(process.cwd(), 'tests', '.quick-pet-performance-test-data'));
if (isClickThroughTest) app.setPath('userData', path.join(process.cwd(), 'tests', '.quick-pet-click-through-test-data'));
if (isDirectDragTest) app.setPath('userData', path.join(process.cwd(), 'tests', '.quick-pet-direct-drag-test-data'));
if (isCrossScreenTest) app.setPath('userData', path.join(process.cwd(), 'tests', '.quick-pet-cross-screen-test-data'));
if (isCrossScreenDragTest) app.setPath('userData', path.join(process.cwd(), 'tests', '.quick-pet-cross-screen-drag-test-data'));
if (isAcceptanceTest) app.setPath('userData', path.join(process.cwd(), 'tests', '.quick-pet-acceptance-test-data'));
if (isCacheProgressUiTest) app.setPath('userData', path.join(process.cwd(), 'tests', '.quick-pet-cache-progress-test-data'));
if (isSmokeTest) app.setPath('userData', path.join(process.cwd(), 'tests', '.quick-pet-smoke-test-data'));
if (isMotionTest) app.setPath('userData', path.join(process.cwd(), 'tests', '.quick-pet-motion-test-data'));
if (is3dTest) app.setPath('userData', path.join(process.cwd(), 'tests', '.quick-pet-3d-test-data'));
if (isBackgroundRemovalTest) app.setPath('userData', path.join(process.cwd(), 'tests', '.quick-pet-background-test-data'));
let petWindow;
let panelWindow;
let searchWindow;
let tray;
let store;
let modelLibrary;
let motionController;
let fullscreenWatcher;
let watchedFolderManager;
let reminderScheduler;
let backupManager;
let shortcutHotkeyRegistry;
let startupRecovery;
let maintenanceManager;
let migrationManager;
let updateManager;
let safeMode = false;
let safeModeRestore = null;
let clipboardTimer;
let lastClipboardText = '';
let cacheCleanupInFlight = null;
const cacheCleanupProgressListeners = new Set();
const companionWindows = new Map();
const companionControllers = new Map();
const pendingModelPreviews = new Map();
const petClickThroughStates = new WeakMap();
const petDragStates = new WeakMap();
const crossScreenDragDiagnostics = [];

protocol.registerSchemesAsPrivileged([
  { scheme: 'quickpet-model', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
  { scheme: 'quickpet-preview', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }
]);
let registeredSearchShortcut = '';
let registeredLauncherShortcut = '';
let registeredPanelShortcut = '';
let searchWindowMode = 'search';
let snapTimer;
let hiddenByFullscreen = false;
let isQuitting = false;
let panelRendererReady = false;
let pendingPanelNavigation = '';

function exitAutomatedTest(code) {
  motionController?.stop();
  startupRecovery?.markClean();
  try { petWindow?.destroy(); } catch {}
  try { panelWindow?.destroy(); } catch {}
  try { searchWindow?.destroy(); } catch {}
  try { fs.rmSync(automatedSessionDirectory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }); } catch {}
  app.exit(code);
  setTimeout(() => process.exit(code), 250);
}

function whenPetShown(callback) {
  if (petWindow?.isVisible()) setImmediate(callback);
  else petWindow?.once('show', callback);
}

function whenWebContentsLoaded(webContents, callback) {
  if (webContents.getURL() && !webContents.isLoadingMainFrame()) setImmediate(callback);
  else webContents.once('did-finish-load', callback);
}

function assetPath(name) {
  return path.join(__dirname, '..', '..', 'assets', name);
}

function customPetModelPath() {
  return path.join(app.getPath('userData'), 'custom-pet.glb');
}

function createAppIcon() {
  try {
    const svg = fs.readFileSync(assetPath('app-icon.svg'), 'utf8');
    return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);
  } catch {
    return nativeImage.createEmpty();
  }
}

function secureWindowNavigation(window) {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isUrl(url)) shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event) => event.preventDefault());
}

function petBoundsForScale(scale = 1, renderMode = '2d') {
  const baseWidth = renderMode === '3d' ? 420 : 190;
  const baseHeight = renderMode === '3d' ? 290 : 230;
  return {
    width: Math.round(baseWidth * scale),
    height: Math.round(baseHeight * scale)
  };
}

function resizePetWindow(settings) {
  if (!petWindow || petWindow.isDestroyed()) return;
  const previous = petWindow.getBounds();
  const size = petBoundsForScale(settings.petScale, settings.petRenderMode);
  petWindow.setBounds({
    x: Math.round(previous.x + previous.width - size.width),
    y: Math.round(previous.y + previous.height - size.height),
    width: size.width,
    height: size.height
  }, false);
  motionController?.syncToWindow(size);
}

function placePetAtBottomRight() {
  if (!petWindow || petWindow.isDestroyed()) return;
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const { width, height } = petWindow.getBounds();
  const { x, y, width: areaWidth, height: areaHeight } = display.workArea;
  petWindow.setPosition(x + areaWidth - width - 18, y + areaHeight - height - 12, false);
  motionController?.syncToWindow(petBoundsForScale(store.data.settings.petScale, store.data.settings.petRenderMode));
}

function createPetWindow() {
  const settings = store.data.settings;
  const size = petBoundsForScale(settings.petScale, settings.petRenderMode);
  petWindow = new BrowserWindow({
    ...size,
    transparent: true,
    frame: false,
    resizable: false,
    show: false,
    alwaysOnTop: settings.petAlwaysOnTop,
    skipTaskbar: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    icon: createAppIcon(),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  petWindow.setAlwaysOnTop(settings.petAlwaysOnTop, 'floating');
  secureWindowNavigation(petWindow);
  petWindow.loadFile(path.join(__dirname, '..', 'renderer', 'pet.html'));
  petWindow.once('ready-to-show', () => {
    placePetAtBottomRight();
    if (!isSmokeTest && !isBackgroundRemovalTest) petWindow.showInactive();
  });
  petWindow.on('will-move', (_event, newBounds) => motionController?.handleUserMove(newBounds));
  petWindow.on('moved', () => {
    clearTimeout(snapTimer);
    snapTimer = setTimeout(() => motionController?.snapToEdge(), 180);
  });
  petWindow.on('closed', () => {
    motionController?.stop();
    petWindow = null;
  });
}

function showPanelWindow() {
  if (!panelWindow || panelWindow.isDestroyed()) return;
  positionPanel();
  panelWindow.show();
  panelWindow.focus();
}

function createPanelWindow(showWhenReady = false) {
  if (panelWindow && !panelWindow.isDestroyed()) return panelWindow;
  const settings = store.data.settings;
  panelRendererReady = false;
  panelWindow = new BrowserWindow({
    width: settings.panelWidth,
    height: settings.panelHeight,
    minWidth: 820,
    minHeight: 580,
    show: false,
    frame: false,
    transparent: false,
    backgroundColor: '#111426',
    icon: createAppIcon(),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  panelWindow.setOpacity(settings.panelOpacity);
  secureWindowNavigation(panelWindow);
  panelWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  if (showWhenReady) panelWindow.once('ready-to-show', showPanelWindow);
  panelWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      panelWindow.hide();
    }
  });
  panelWindow.on('closed', () => { panelWindow = null; panelRendererReady = false; });
  return panelWindow;
}

function showSearchWindow(mode = searchWindowMode) {
  if (!searchWindow || searchWindow.isDestroyed()) return;
  searchWindowMode = mode === 'launcher' ? 'launcher' : 'search';
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const bounds = searchWindow.getBounds();
  searchWindow.setPosition(
    Math.round(display.workArea.x + (display.workArea.width - bounds.width) / 2),
    Math.round(display.workArea.y + Math.min(130, display.workArea.height * 0.16)),
    false
  );
  searchWindow.show();
  searchWindow.focus();
  searchWindow.webContents.send('search:focus', searchWindowMode);
}

function createSearchWindow(showWhenReady = false, mode = 'search') {
  if (searchWindow && !searchWindow.isDestroyed()) return searchWindow;
  searchWindowMode = mode === 'launcher' ? 'launcher' : 'search';
  searchWindow = new BrowserWindow({
    width: 680,
    height: 460,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    icon: createAppIcon(),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  secureWindowNavigation(searchWindow);
  searchWindow.loadFile(path.join(__dirname, '..', 'renderer', 'search.html'));
  if (showWhenReady) searchWindow.once('ready-to-show', () => showSearchWindow(searchWindowMode));
  searchWindow.on('blur', () => searchWindow?.hide());
  searchWindow.on('closed', () => { searchWindow = null; });
  return searchWindow;
}

function toggleSearch(force, mode = 'search') {
  const shouldShow = typeof force === 'boolean' ? force : !searchWindow?.isVisible();
  if (!shouldShow) return searchWindow?.hide();
  if (!searchWindow || searchWindow.isDestroyed()) {
    createSearchWindow(true, mode);
    return;
  }
  showSearchWindow(mode);
}

function registerSearchShortcut(preferred = 'Alt+Space') {
  if (registeredSearchShortcut) globalShortcut.unregister(registeredSearchShortcut);
  if (registeredLauncherShortcut) globalShortcut.unregister(registeredLauncherShortcut);
  if (registeredPanelShortcut) globalShortcut.unregister(registeredPanelShortcut);
  registeredSearchShortcut = '';
  registeredLauncherShortcut = '';
  registeredPanelShortcut = '';
  const searchAccelerator = preferred || store.data.settings.globalSearchShortcut;
  const launcherAccelerator = store.data.settings.quickLaunchShortcut;
  const panelAccelerator = store.data.settings.panelShortcut;
  try {
    if (searchAccelerator && globalShortcut.register(searchAccelerator, () => toggleSearch(undefined, 'search'))) registeredSearchShortcut = searchAccelerator;
  } catch {}
  try {
    if (launcherAccelerator && launcherAccelerator !== searchAccelerator && globalShortcut.register(launcherAccelerator, () => toggleSearch(undefined, 'launcher'))) registeredLauncherShortcut = launcherAccelerator;
  } catch {}
  try {
    if (panelAccelerator && ![searchAccelerator, launcherAccelerator].includes(panelAccelerator) && globalShortcut.register(panelAccelerator, () => togglePanel(true))) registeredPanelShortcut = panelAccelerator;
  } catch {}
  return { search: registeredSearchShortcut, launcher: registeredLauncherShortcut, panel: registeredPanelShortcut };
}

function syncShortcutHotkeys() {
  return shortcutHotkeyRegistry?.sync(store.data.shortcuts, [store.data.settings.globalSearchShortcut, store.data.settings.quickLaunchShortcut, store.data.settings.panelShortcut]) || {};
}

function positionPanel() {
  if (!panelWindow || panelWindow.isDestroyed()) return;
  const settings = store.data.settings;
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const bounds = centeredBounds(display.workArea, settings.panelWidth, settings.panelHeight);
  panelWindow.setMinimumSize(Math.min(820, bounds.width), Math.min(580, bounds.height));
  panelWindow.setBounds(bounds, false);
}

function togglePanel(force) {
  const shouldShow = typeof force === 'boolean' ? force : !panelWindow?.isVisible();
  if (!shouldShow) return panelWindow?.hide();
  if (!panelWindow || panelWindow.isDestroyed()) {
    createPanelWindow(true);
    return;
  }
  if (shouldShow) {
    showPanelWindow();
  }
}

function navigatePanel(view) {
  togglePanel(true);
  const channel = view === 'automation' ? 'navigate:automation' : 'navigate:settings';
  if (panelRendererReady && panelWindow && !panelWindow.isDestroyed()) panelWindow.webContents.send(channel);
  else pendingPanelNavigation = view;
}

function applicationState(scope = 'panel') {
  const snapshot = store.rendererSnapshot();
  const shared = {
    appVersion: app.getVersion(),
    hotkeyRegistrations: shortcutHotkeyRegistry?.snapshot() || {},
    commands: COMMANDS,
    runtime: {
      safeMode,
      portable: process.env.QUICKPET_PORTABLE === '1',
      globalShortcutRegistrations: {
        search: registeredSearchShortcut === store.data.settings.globalSearchShortcut,
        launcher: registeredLauncherShortcut === store.data.settings.quickLaunchShortcut,
        panel: registeredPanelShortcut === store.data.settings.panelShortcut
      },
      update: updateManager?.lastResult || { status: 'idle', currentVersion: app.getVersion() }
    }
  };
  if (scope === 'pet') {
    return {
      settings: snapshot.settings,
      models: snapshot.models,
      companions: snapshot.companions,
      petStatus: snapshot.petStatus,
      ...shared
    };
  }
  if (scope === 'search') {
    return {
      shortcuts: snapshot.shortcuts.map(({ iconData, ...item }) => item),
      categories: snapshot.categories,
      settings: {
        globalSearchShortcut: snapshot.settings.globalSearchShortcut,
        quickLaunchShortcut: snapshot.settings.quickLaunchShortcut,
        panelShortcut: snapshot.settings.panelShortcut
      },
      ...shared
    };
  }
  return { ...snapshot, ...shared };
}

function stateScopeForWindow(window) {
  if (window === searchWindow) return 'search';
  if (window === petWindow || [...companionWindows.values()].includes(window)) return 'pet';
  return 'panel';
}

function broadcastState() {
  for (const window of [petWindow, panelWindow, searchWindow, ...companionWindows.values()]) {
    if (window && !window.isDestroyed()) window.webContents.send('state:changed', applicationState(stateScopeForWindow(window)));
  }
}

function formatStorageSize(bytes) {
  const value = Math.max(0, Number(bytes) || 0);
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(2)} GB`;
  return `${Math.max(1, Math.round(value / 1024 ** 2))} MB`;
}

function launchElevatedCacheCleanup(targets) {
  const safeTargets = [...new Set(targets.map((target) => path.resolve(target)))];
  const payload = Buffer.from(JSON.stringify(safeTargets), 'utf8').toString('base64');
  const scriptPath = path.join(os.tmpdir(), `quick-pet-elevated-clean-${process.pid}-${Date.now()}.ps1`);
  const script = "param([string]$Payload)\n$targets = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Payload)) | ConvertFrom-Json\nforeach ($target in $targets) { if ($target -and (Test-Path -LiteralPath $target)) { Remove-Item -LiteralPath $target -Recurse -Force -ErrorAction Stop } }\nRemove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue\n";
  fs.writeFileSync(scriptPath, script, 'utf8');
  const quotedScript = scriptPath.replaceAll("'", "''");
  const command = `$arguments = @('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File','${quotedScript}','-Payload','${payload}'); Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList $arguments`;
  const encoded = Buffer.from(command, 'utf16le').toString('base64');
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
}

async function requestCacheCleanupElevation(result) {
  const permissionFailures = result.failures.filter((failure) => failure.code === 'permission' && failure.path);
  if (!permissionFailures.length) return result;
  const options = {
    type: 'question',
    title: '需要管理员权限',
    message: '部分旧缓存位于受保护目录',
    detail: '可以打开 Windows 权限确认窗口完成清理。只会删除上方列出的旧版运行缓存。',
    buttons: ['使用管理员权限清理', '取消'],
    defaultId: 0,
    cancelId: 1,
    noLink: true
  };
  const choice = panelWindow
    ? await dialog.showMessageBox(panelWindow, options)
    : await dialog.showMessageBox(options);
  if (choice.response === 0) {
    launchElevatedCacheCleanup(permissionFailures.map((failure) => failure.path));
    result.elevationRequested = true;
  }
  return result;
}

async function clearOldPortableCachesWithElevation() {
  return requestCacheCleanupElevation(await maintenanceManager.clearOldPortableCaches());
}

async function clearRuntimeCacheWithElevation(onProgress) {
  if (typeof onProgress === 'function') cacheCleanupProgressListeners.add(onProgress);
  if (!cacheCleanupInFlight) {
    cacheCleanupInFlight = maintenanceManager.clearCache((progress) => {
      for (const listener of cacheCleanupProgressListeners) {
        try { listener(progress); } catch {}
      }
    }).then((result) => requestCacheCleanupElevation(result)).finally(() => {
      cacheCleanupInFlight = null;
      cacheCleanupProgressListeners.clear();
    });
  }
  return cacheCleanupInFlight;
}

async function promptForOldPortableCaches() {
  if (process.env.QUICKPET_PORTABLE !== '1' || store.data.settings.portableCacheCleanupPrompt === false) return;
  const report = await maintenanceManager.report();
  if (!report.stalePortableCacheCount) return;
  const result = await dialog.showMessageBox({
    type: 'question',
    title: '清理旧版便携缓存',
    message: `发现 ${report.stalePortableCacheCount} 份旧版缓存`,
    detail: `可释放约 ${formatStorageSize(report.stalePortableCacheBytes)}。只会删除旧版运行文件，不会影响快捷方式、模型或个人设置。`,
    buttons: ['立即清理', '暂不清理'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
    checkboxLabel: '以后不再提示',
    checkboxChecked: false
  });
  if (result.checkboxChecked) store.updateSettings({ portableCacheCleanupPrompt: false });
  if (result.response !== 0) {
    broadcastState();
    return;
  }
  const cleanup = await clearOldPortableCachesWithElevation();
  const skipped = cleanup.skippedCount ? `，${cleanup.skippedCount} 份正在使用，已跳过` : '';
  const failed = cleanup.failures.length;
  const cleanupMessage = failed
    ? `清理未完成：${cleanup.failures[0].name}`
    : !cleanup.releasedBytes && cleanup.skippedCount
      ? '旧版缓存仍在使用'
      : `已释放 ${formatStorageSize(cleanup.releasedBytes)}`;
  const cleanupDetail = failed
    ? cleanup.failures[0].message
    : !cleanup.releasedBytes && cleanup.skippedCount
      ? '请完全退出旧版快捷宠，再到“设置 - 存储与卸载”重试。'
      : `旧版运行文件已删除${skipped}，个人设置、快捷方式和模型均已保留。`;
  await dialog.showMessageBox({
    type: failed || (!cleanup.releasedBytes && cleanup.skippedCount) ? 'warning' : 'info',
    title: '便携缓存清理结果',
    message: cleanupMessage,
    detail: cleanupDetail,
    buttons: ['知道了'],
    defaultId: 0,
    noLink: true
  });
  store.addNotification({
    title: failed ? '旧版缓存清理未完成' : '旧版缓存清理结果',
    message: `${cleanupMessage}${skipped}`,
    kind: failed ? 'warning' : 'success'
  });
  broadcastState();
}

async function openShortcut(id) {
  const item = store.data.shortcuts.find((entry) => entry.id === id);
  if (!item) throw new Error('快捷方式不存在');
  createLaunchPlan(item.target);
  setImmediate(async () => {
    try {
      await launchTarget(item.target, { openExternal: shell.openExternal, openPath: shell.openPath });
      store.recordUse(id);
      setTimeout(broadcastState, 60);
    } catch (error) {
      store.setCheckResult(id, 'broken');
      store.save();
      pushNotification({ title: '快捷方式启动失败', message: `${item.name}：${error.message}`, kind: 'warning' });
    }
  });
  return true;
}

async function checkAllShortcuts() {
  const items = [...store.data.shortcuts];
  const results = [];
  for (let index = 0; index < items.length; index += 5) {
    results.push(...await Promise.all(items.slice(index, index + 5).map(checkShortcut)));
  }
  store.save();
  broadcastState();
  return results;
}

function pushNotification(input) {
  const item = store.addNotification(input);
  if (item && store.data.settings.notificationsEnabled && Notification.isSupported()) {
    try { new Notification({ title: item.title, body: item.message, icon: createAppIcon() }).show(); } catch {}
  }
  broadcastState();
  return item;
}

function startClipboardMonitor() {
  clearInterval(clipboardTimer);
  clipboardTimer = setInterval(() => {
    if (!store?.data.settings.clipboardMonitor) return;
    const text = clipboard.readText().trim();
    if (!text || text === lastClipboardText) return;
    lastClipboardText = text;
    const isLocal = /^[a-z]:[\\/]/i.test(text) && fs.existsSync(text);
    if (!isProtocolTarget(text) && !isLocal) return;
    if (store.data.shortcuts.some((item) => item.target.toLowerCase() === text.toLowerCase())) return;
    petWindow?.webContents.send('clipboard:candidate', { target: text, type: isLocal ? inferType(text) : 'website' });
  }, 1500);
}

function closeCompanionWindows() {
  for (const controller of companionControllers.values()) controller.stop();
  for (const window of companionWindows.values()) {
    try { window.destroy(); } catch {}
  }
  companionControllers.clear();
  companionWindows.clear();
}

function syncCompanionWindows() {
  const enabled = new Map(store.data.companions.filter((item) => item.enabled).map((item) => [item.id, item]));
  for (const [id, window] of companionWindows) {
    if (!enabled.has(id)) {
      companionControllers.get(id)?.stop();
      companionControllers.delete(id);
      window.destroy();
      companionWindows.delete(id);
    }
  }
  let offset = 1;
  for (const companion of enabled.values()) {
    if (companionWindows.has(companion.id)) continue;
    const size = petBoundsForScale(companion.scale, companion.renderMode);
    const window = new BrowserWindow({
      ...size,
      transparent: true,
      frame: false,
      resizable: false,
      show: false,
      alwaysOnTop: store.data.settings.petAlwaysOnTop,
      skipTaskbar: true,
      hasShadow: false,
      backgroundColor: '#00000000',
      icon: createAppIcon(),
      webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
    });
    secureWindowNavigation(window);
    window.loadFile(path.join(__dirname, '..', 'renderer', 'pet.html'), { query: { companionId: companion.id } });
    window.once('ready-to-show', () => {
      const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
      window.setPosition(display.workArea.x + display.workArea.width - size.width - 18 - offset * 90, display.workArea.y + display.workArea.height - size.height - 12, false);
      window.showInactive();
      controller.syncToWindow(size);
      offset += 1;
    });
    window.on('closed', () => {
      companionControllers.get(companion.id)?.stop();
      companionControllers.delete(companion.id);
      companionWindows.delete(companion.id);
    });
    const controller = new PetMotionController({
      getWindow: () => window,
      getSettings: () => ({
        ...store.data.settings,
        petScale: companion.scale,
        petRenderMode: companion.renderMode,
        petScreenMode: companion.screenMode,
        naturalBehavior: companion.personality !== 'calm',
        petWalkSpeed: companion.personality === 'lively' ? 68 : companion.personality === 'sleepy' ? 28 : 44,
        petStatus: store.data.petStatus
      }),
      screen
    });
    companionWindows.set(companion.id, window);
    companionControllers.set(companion.id, controller);
    controller.start();
  }
}

async function chooseTargets(_event, kind = 'file') {
  const result = await dialog.showOpenDialog(panelWindow, {
    title: '选择要收纳的程序、文件或文件夹',
    properties: [kind === 'folder' ? 'openDirectory' : 'openFile', 'multiSelections']
  });
  return result.canceled ? [] : result.filePaths;
}

async function beautifyLocalIcon(item) {
  if (!item || isProtocolTarget(item.target) || !fs.existsSync(item.target)) return item;
  try {
    const icon = await app.getFileIcon(item.target, { size: 'large' });
    if (!icon.isEmpty()) return store.updateShortcut(item.id, { iconData: icon.toDataURL(), iconBackground: '#f1efff' });
  } catch {}
  return item;
}

async function addLocalPaths(paths) {
  const added = [];
  const errors = [];
  for (const target of paths) {
    try {
      const stat = fs.statSync(target);
      const item = store.addShortcut({ target, type: stat.isDirectory() ? 'folder' : inferType(target) });
      added.push(await beautifyLocalIcon(item));
    } catch (error) {
      errors.push({ target, message: error.message });
    }
  }
  if (added.length) broadcastState();
  return { added, errors };
}

async function checkShortcut(item) {
  let status = 'broken';
  if (isWebUrl(item.target)) {
    try {
      const response = await fetch(item.target, {
        method: 'HEAD',
        redirect: 'follow',
        signal: AbortSignal.timeout(5000),
        headers: { 'User-Agent': 'QuickPet-Link-Checker/1.0' }
      });
      status = response.ok || response.status < 500 ? 'ok' : 'broken';
    } catch {
      status = 'unknown';
    }
  } else if (isProtocolTarget(item.target)) {
    status = 'unknown';
  } else {
    status = fs.existsSync(item.target) ? 'ok' : 'broken';
  }
  store.setCheckResult(item.id, status);
  return { id: item.id, status };
}

function safeProtocolFile(baseDirectory, pathname) {
  const base = path.resolve(baseDirectory);
  const relative = decodeURIComponent(pathname).replace(/^[/\\]+/, '').replaceAll('/', path.sep);
  const resolved = path.resolve(base, relative);
  return resolved === base || resolved.startsWith(`${base}${path.sep}`) ? resolved : '';
}

function registerModelProtocols() {
  protocol.handle('quickpet-model', (request) => {
    const url = new URL(request.url);
    const model = store.data.models.find((item) => item.id === url.hostname && item.format === 'live2d');
    if (!model) return new Response('Model not found', { status: 404 });
    const baseDirectory = path.join(modelLibrary.directory, 'live2d', model.id);
    const filePath = safeProtocolFile(baseDirectory, url.pathname);
    if (!filePath || !fs.existsSync(filePath)) return new Response('File not found', { status: 404 });
    return net.fetch(pathToFileURL(filePath).toString());
  });
  protocol.handle('quickpet-preview', (request) => {
    const url = new URL(request.url);
    const preview = pendingModelPreviews.get(url.hostname);
    if (!preview) return new Response('Preview expired', { status: 404 });
    const filePath = safeProtocolFile(preview.baseDirectory, url.pathname);
    if (!filePath || !fs.existsSync(filePath)) return new Response('File not found', { status: 404 });
    return net.fetch(pathToFileURL(filePath).toString());
  });
}

async function exportMigrationBundle() {
  const result = await dialog.showSaveDialog(panelWindow, {
    title: '导出完整迁移包',
    defaultPath: `快捷宠完整迁移-${new Date().toISOString().slice(0, 10)}.quickpet`,
    filters: [{ name: '快捷宠迁移包', extensions: ['quickpet'] }]
  });
  if (result.canceled || !result.filePath) return null;
  return migrationManager.exportTo(result.filePath);
}

async function importMigrationBundle() {
  const result = await dialog.showOpenDialog(panelWindow, {
    title: '导入完整迁移包',
    filters: [{ name: '快捷宠迁移包', extensions: ['quickpet'] }],
    properties: ['openFile']
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const data = await migrationManager.importFrom(result.filePaths[0]);
  registerSearchShortcut(store.data.settings.globalSearchShortcut);
  syncShortcutHotkeys();
  closeCompanionWindows();
  syncCompanionWindows();
  broadcastState();
  return data;
}

async function capturePanelImage() {
  if (!panelWindow || panelWindow.isDestroyed()) createPanelWindow(true);
  else showPanelWindow();
  const result = await dialog.showSaveDialog(panelWindow, {
    title: '保存快捷宠面板截图',
    defaultPath: `快捷宠截图-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.png`,
    filters: [{ name: 'PNG 图片', extensions: ['png'] }]
  });
  if (result.canceled || !result.filePath) return null;
  const image = await panelWindow.webContents.capturePage();
  fs.writeFileSync(result.filePath, image.toPNG());
  return result.filePath;
}

async function checkForUpdates() {
  try {
    const result = await updateManager.check();
    broadcastState();
    return result;
  } catch (error) {
    updateManager.lastResult = { status: 'error', currentVersion: app.getVersion(), message: error.message };
    broadcastState();
    throw error;
  }
}

async function downloadAvailableUpdate() {
  const update = updateManager.lastResult;
  if (update?.status !== 'available') throw new Error('当前没有可下载的新版本');
  if (!update.downloadUrl) {
    if (!update.releaseUrl) throw new Error('新版本暂时没有可用的便携包');
    await shell.openExternal(update.releaseUrl);
    return update.releaseUrl;
  }
  const result = await dialog.showSaveDialog(panelWindow, {
    title: '保存快捷宠更新包',
    defaultPath: `QuickPet-Update-${update.version}.exe`,
    filters: [{ name: 'Windows 程序', extensions: ['exe'] }]
  });
  if (result.canceled || !result.filePath) return null;
  const filePath = await updateManager.download(update, result.filePath);
  shell.showItemInFolder(filePath);
  return filePath;
}

async function executeCommand(id) {
  if (id === 'open-settings') { navigatePanel('settings'); return { message: '已打开设置' }; }
  if (id === 'open-automation') { navigatePanel('automation'); return { message: '已打开自动化中心' }; }
  if (id === 'check-shortcuts') { const results = await checkAllShortcuts(); return { message: `已检查 ${results.length} 个快捷方式` }; }
  if (id === 'open-data-folder') { await shell.openPath(app.getPath('userData')); return { message: '已打开数据文件夹' }; }
  if (id === 'capture-panel') { const filePath = await capturePanelImage(); return { message: filePath ? '截图已保存' : '已取消截图' }; }
  if (id === 'toggle-walk') { const settings = store.updateSettings({ autoWalk: store.data.settings.autoWalk === false }); broadcastState(); return { message: settings.autoWalk ? '桌宠继续散步' : '桌宠已暂停散步' }; }
  if (id === 'clear-cache') { await maintenanceManager.clearCache(); return { message: '运行缓存已清理' }; }
  if (id === 'check-update') { const result = await checkForUpdates(); return { message: result.status === 'available' ? `发现新版本 ${result.version}` : result.status === 'unavailable' ? result.message : '当前已经是最新版本' }; }
  throw new Error('没有找到这个命令');
}

function scheduleProgramRemoval(removeUserData = false) {
  const target = programRemovalTarget();
  if (!target) throw new Error('当前运行位置不是安装目录或便携缓存，未删除任何程序文件');

  const scriptPath = path.join(os.tmpdir(), `quick-pet-remove-${process.pid}-${Date.now()}.ps1`);
  const script = `param([string]$Target,[string]$UserData,[string]$RemoveData)\nStart-Sleep -Milliseconds 1200\nif ($Target -and (Test-Path -LiteralPath $Target)) { Remove-Item -LiteralPath $Target -Recurse -Force -ErrorAction SilentlyContinue }\nif ($RemoveData -eq 'true' -and $UserData -and (Test-Path -LiteralPath $UserData)) { Remove-Item -LiteralPath $UserData -Recurse -Force -ErrorAction SilentlyContinue }\n$shell = New-Object -ComObject WScript.Shell\nforeach ($folder in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))) { if ($folder) { Get-ChildItem -LiteralPath $folder -Filter '*快捷宠*.lnk' -File -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue } }\nRemove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue\n`;
  fs.writeFileSync(scriptPath, script, 'utf8');
  const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-Target', target, '-UserData', app.getPath('userData'), '-RemoveData', String(Boolean(removeUserData)).toLowerCase()], { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
  isQuitting = true;
  setTimeout(() => app.quit(), 100);
  return true;
}

function leaveSafeMode({ notify = true } = {}) {
  if (safeModeRestore && store) store.updateSettings(safeModeRestore);
  safeMode = false;
  safeModeRestore = null;
  startupRecovery?.clearRestore();
  if (notify) {
    resizePetWindow(store.data.settings);
    broadcastState();
  }
  return true;
}

function petWindowFromSender(sender) {
  const senderWindow = BrowserWindow.fromWebContents(sender);
  return senderWindow === petWindow || [...companionWindows.values()].includes(senderWindow)
    ? senderWindow
    : null;
}

function motionControllerForPetWindow(window) {
  if (window === petWindow) return motionController;
  for (const [id, companionWindow] of companionWindows) {
    if (companionWindow === window) return companionControllers.get(id);
  }
  return null;
}

function endPetWindowDrag(window) {
  const drag = petDragStates.get(window);
  if (!drag) return;
  petDragStates.delete(window);
  const controller = motionControllerForPetWindow(window);
  controller?.setDragging(false);
  if (drag.active && !window.isDestroyed()) controller?.handleUserMove(window.getBounds());
}

function registerIpc() {
  ipcMain.handle('state:get', (event) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    return applicationState(stateScopeForWindow(senderWindow));
  });
  ipcMain.on('renderer:ready', (event) => {
    if (BrowserWindow.fromWebContents(event.sender) !== panelWindow) return;
    panelRendererReady = true;
    if (!pendingPanelNavigation) return;
    const view = pendingPanelNavigation;
    pendingPanelNavigation = '';
    panelWindow.webContents.send(view === 'automation' ? 'navigate:automation' : 'navigate:settings');
  });
  ipcMain.on('pet:set-click-through', (event, ignore) => {
    const senderWindow = petWindowFromSender(event.sender);
    if (!senderWindow || senderWindow.isDestroyed()) return;
    const shouldIgnore = isCrossScreenDragTest ? false : Boolean(ignore);
    senderWindow.setIgnoreMouseEvents(shouldIgnore, shouldIgnore ? { forward: true } : undefined);
    petClickThroughStates.set(senderWindow, shouldIgnore);
  });
  ipcMain.on('pet:drag-begin', (event, x, y) => {
    const senderWindow = petWindowFromSender(event.sender);
    if (!senderWindow || senderWindow.isDestroyed()) return;
    endPetWindowDrag(senderWindow);
    const cursor = isDirectDragTest && Number.isFinite(x) && Number.isFinite(y)
      ? { x, y }
      : screen.getCursorScreenPoint();
    if (isCrossScreenDragTest) crossScreenDragDiagnostics.push({ phase: 'begin', supplied: { x, y }, cursor: screen.getCursorScreenPoint() });
    petDragStates.set(senderWindow, {
      active: false,
      originCursor: cursor,
      originBounds: senderWindow.getBounds()
    });
  });
  ipcMain.on('pet:drag-activate', (event) => {
    const senderWindow = petWindowFromSender(event.sender);
    const drag = senderWindow ? petDragStates.get(senderWindow) : null;
    if (!senderWindow || !drag || drag.active || senderWindow.isDestroyed()) return;
    drag.active = true;
    motionControllerForPetWindow(senderWindow)?.setDragging(true);
  });
  ipcMain.on('pet:drag-move', (event, x, y) => {
    const senderWindow = petWindowFromSender(event.sender);
    const drag = senderWindow ? petDragStates.get(senderWindow) : null;
    if (!senderWindow || !drag?.active || senderWindow.isDestroyed()) return;
    const cursor = isDirectDragTest && Number.isFinite(x) && Number.isFinite(y)
      ? { x, y }
      : screen.getCursorScreenPoint();
    if (isCrossScreenDragTest) crossScreenDragDiagnostics.push({ phase: 'move', supplied: { x, y }, cursor });
    const nextX = drag.originBounds.x + cursor.x - drag.originCursor.x;
    const nextY = drag.originBounds.y + cursor.y - drag.originCursor.y;
    const controller = motionControllerForPetWindow(senderWindow);
    if (controller) controller.moveTo(nextX, nextY);
    else senderWindow.setBounds({ x: Math.round(nextX), y: Math.round(nextY), width: drag.originBounds.width, height: drag.originBounds.height }, false);
  });
  ipcMain.on('pet:drag-end', (event) => {
    const senderWindow = petWindowFromSender(event.sender);
    if (isCrossScreenDragTest) crossScreenDragDiagnostics.push({ phase: 'end', cursor: screen.getCursorScreenPoint() });
    if (senderWindow) endPetWindowDrag(senderWindow);
  });
  ipcMain.handle('panel:toggle', (_event, force) => {
    motionController?.pauseFor(900);
    return togglePanel(force);
  });
  ipcMain.handle('window:hide', () => panelWindow?.hide());
  ipcMain.handle('window:minimize', () => panelWindow?.minimize());
  ipcMain.handle('search:hide', () => searchWindow?.hide());
  ipcMain.handle('search:toggle', (_event, force, mode = 'search') => toggleSearch(force, mode));

  ipcMain.handle('shortcut:refresh-icon', async (_event, id) => {
    const item = store.data.shortcuts.find((entry) => entry.id === id);
    if (!item) throw new Error('快捷方式不存在');
    if (isProtocolTarget(item.target)) return item;
    const icon = await app.getFileIcon(item.target, { size: 'large' });
    const updated = store.updateShortcut(id, { iconData: icon.toDataURL(), iconBackground: item.iconBackground || '#f1efff' });
    broadcastState();
    return updated;
  });
  ipcMain.handle('shortcut:choose-icon', async (_event, id) => {
    const result = await dialog.showOpenDialog(panelWindow, { title: '选择图标图片', filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'ico'] }], properties: ['openFile'] });
    if (result.canceled || !result.filePaths[0]) return null;
    const image = nativeImage.createFromPath(result.filePaths[0]);
    if (image.isEmpty()) throw new Error('无法读取这张图片');
    const updated = store.updateShortcut(id, { iconData: image.resize({ width: 128, height: 128, quality: 'best' }).toDataURL() });
    broadcastState();
    return updated;
  });
  ipcMain.handle('shortcut:clear-icon', (_event, id) => { const result = store.updateShortcut(id, { iconData: '', iconBackground: '' }); broadcastState(); return result; });

  ipcMain.handle('rule:add', (_event, input) => { const result = store.addRule(input || {}); broadcastState(); return result; });
  ipcMain.handle('rule:update', (_event, id, changes) => { const result = store.updateRule(id, changes || {}); broadcastState(); return result; });
  ipcMain.handle('rule:remove', (_event, id) => { const result = store.removeRule(id); broadcastState(); return result; });
  ipcMain.handle('reminder:add', (_event, input) => { const result = store.addReminder(input || {}); broadcastState(); return result; });
  ipcMain.handle('reminder:update', (_event, id, changes) => { const result = store.updateReminder(id, changes || {}); broadcastState(); return result; });
  ipcMain.handle('reminder:remove', (_event, id) => { const result = store.removeReminder(id); broadcastState(); return result; });
  ipcMain.handle('notification:read-all', () => { const result = store.markNotificationsRead(); broadcastState(); return result; });
  ipcMain.handle('notification:clear', () => { const result = store.clearNotifications(); broadcastState(); return result; });
  ipcMain.handle('notification:open', () => { navigatePanel('automation'); return true; });
  ipcMain.handle('watched-folder:choose', async () => {
    const result = await dialog.showOpenDialog(panelWindow, { title: '选择动态收纳文件夹', properties: ['openDirectory'] });
    return result.canceled ? '' : result.filePaths[0] || '';
  });
  ipcMain.handle('watched-folder:add', (_event, input) => { const result = store.addWatchedFolder(input || {}); watchedFolderManager?.rebuild(); broadcastState(); return result; });
  ipcMain.handle('watched-folder:update', (_event, id, changes) => { const result = store.updateWatchedFolder(id, changes || {}); watchedFolderManager?.rebuild(); broadcastState(); return result; });
  ipcMain.handle('watched-folder:remove', (_event, id) => { const result = store.removeWatchedFolder(id); watchedFolderManager?.rebuild(); broadcastState(); return result; });
  ipcMain.handle('companion:add', (_event, input) => { const result = store.addCompanion(input || {}); syncCompanionWindows(); broadcastState(); return result; });
  ipcMain.handle('companion:update', (_event, id, changes) => { const result = store.updateCompanion(id, changes || {}); closeCompanionWindows(); syncCompanionWindows(); broadcastState(); return result; });
  ipcMain.handle('companion:remove', (_event, id) => { const result = store.removeCompanion(id); syncCompanionWindows(); broadcastState(); return result; });
  ipcMain.handle('clipboard:accept', (_event, candidate) => {
    const item = store.addShortcut(candidate || {});
    pushNotification({ title: '剪贴板已收纳', message: item.name, kind: 'success' });
    return item;
  });
  ipcMain.handle('clipboard:dismiss', (_event, target) => { lastClipboardText = String(target || lastClipboardText); return true; });

  ipcMain.handle('shortcut:choose-targets', chooseTargets);
  ipcMain.handle('shortcut:add-paths', (_event, paths) => addLocalPaths(Array.isArray(paths) ? paths : []));
  ipcMain.handle('shortcut:add', async (_event, input) => {
    const item = await beautifyLocalIcon(store.addShortcut(input || {}));
    syncShortcutHotkeys();
    broadcastState();
    return item;
  });
  ipcMain.handle('shortcut:update', (_event, id, changes) => {
    const item = store.updateShortcut(id, changes || {});
    syncShortcutHotkeys();
    broadcastState();
    return item;
  });
  ipcMain.handle('shortcut:reorder', (_event, id, beforeId, category) => {
    const item = store.reorderShortcut(id, beforeId, category);
    store.updateSettings({ sortBy: 'manual' });
    broadcastState();
    return item;
  });
  ipcMain.handle('shortcut:remove', (_event, id) => {
    const result = store.removeShortcut(id);
    syncShortcutHotkeys();
    broadcastState();
    return result;
  });
  ipcMain.handle('shortcut:remove-all', () => {
    const count = store.removeAllShortcuts();
    syncShortcutHotkeys();
    broadcastState();
    return count;
  });
  ipcMain.handle('shortcut:open', (_event, id) => openShortcut(id));
  ipcMain.handle('shortcut:check-all', () => checkAllShortcuts());
  ipcMain.handle('shortcut:reset-usage', () => { const result = store.resetUsage(); broadcastState(); return result; });
  ipcMain.handle('shortcut:scan', (_event, kind = 'all') => scanSources(kind, {
    app,
    readShortcutLink: (filePath) => shell.readShortcutLink(filePath),
    existingTargets: store.data.shortcuts.map((item) => item.target)
  }));
  ipcMain.handle('shortcut:import-scan', (_event, candidates) => {
    const added = [];
    const errors = [];
    for (const candidate of Array.isArray(candidates) ? candidates.slice(0, 1500) : []) {
      try {
        added.push(store.addShortcut({
          name: candidate.name,
          target: candidate.target,
          type: candidate.type,
          tags: candidate.source ? [candidate.source] : []
        }));
      } catch (error) {
        errors.push({ target: candidate.target, message: error.message });
      }
    }
    if (added.length) broadcastState();
    return { added, errors };
  });

  ipcMain.handle('category:add', (_event, input) => {
    const category = store.addCategory(input || {});
    broadcastState();
    return category;
  });
  ipcMain.handle('category:update', (_event, id, changes) => {
    const category = store.updateCategory(id, changes || {});
    broadcastState();
    return category;
  });
  ipcMain.handle('category:remove', (_event, id) => {
    const result = store.removeCategory(id);
    broadcastState();
    return result;
  });
  ipcMain.handle('category:move', (_event, id, direction) => {
    const result = store.moveCategory(id, direction);
    broadcastState();
    return result;
  });

  ipcMain.handle('settings:update', (_event, changes) => {
    const previousScale = store.data.settings.petScale;
    const previousRenderMode = store.data.settings.petRenderMode;
    const previousPanelWidth = store.data.settings.panelWidth;
    const previousPanelHeight = store.data.settings.panelHeight;
    const previousSearchShortcut = store.data.settings.globalSearchShortcut;
    const previousLaunchShortcut = store.data.settings.quickLaunchShortcut;
    const previousPanelShortcut = store.data.settings.panelShortcut;
    const settings = store.updateSettings(changes || {});
    if (Object.hasOwn(changes || {}, 'launchAtLogin')) {
      app.setLoginItemSettings({
        openAtLogin: settings.launchAtLogin,
        path: loginLaunchTarget(process.env, app.getPath('exe')),
        args: app.isPackaged ? [] : [app.getAppPath()]
      });
    }
    petWindow?.setAlwaysOnTop(settings.petAlwaysOnTop, 'floating');
    if (changes?.hideOnFullscreen === false && hiddenByFullscreen) {
      hiddenByFullscreen = false;
      petWindow?.showInactive();
    }
    if (changes?.hideOnFullscreen === true) fullscreenWatcher?.start();
    if (changes?.hideOnFullscreen === false) fullscreenWatcher?.stop();
    panelWindow?.setOpacity(settings.panelOpacity);
    if (petWindow && (settings.petScale !== previousScale || settings.petRenderMode !== previousRenderMode)) resizePetWindow(settings);
    if (panelWindow && (settings.panelWidth !== previousPanelWidth || settings.panelHeight !== previousPanelHeight)) {
      positionPanel();
    }
    if (settings.globalSearchShortcut !== previousSearchShortcut || settings.quickLaunchShortcut !== previousLaunchShortcut || settings.panelShortcut !== previousPanelShortcut) {
      registerSearchShortcut(settings.globalSearchShortcut);
      syncShortcutHotkeys();
    }
    motionController?.syncToWindow();
    broadcastState();
    return settings;
  });
  ipcMain.handle('skin:choose', async () => {
    const result = await dialog.showOpenDialog(panelWindow, {
      title: '选择桌宠图片',
      filters: [{ name: '图片', extensions: ['png', 'gif', 'webp', 'jpg', 'jpeg'] }],
      properties: ['openFile']
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const filePath = result.filePaths[0];
    const buffer = fs.readFileSync(filePath);
    if (buffer.length > 15 * 1024 * 1024) throw new Error('图片不能超过 15MB');
    const extension = path.extname(filePath).slice(1).toLowerCase().replace('jpg', 'jpeg');
    const originalData = `data:image/${extension};base64,${buffer.toString('base64')}`;
    const name = path.basename(filePath);
    let petImageData = originalData;
    let status = extension === 'gif' ? 'animated-original' : 'original';
    let message = '';

    if (extension !== 'gif' && store.data.settings.autoRemoveBackground) {
      try {
        const result = await removeBackground(nativeImage.createFromPath(filePath));
        petImageData = result.dataUrl;
        status = result.status;
      } catch (error) {
        status = 'fallback';
        message = error.message;
      }
    }

    store.updateSettings({
      petImageData,
      petOriginalImageData: originalData,
      petImageName: name,
      petBackgroundRemoved: ['removed', 'already-transparent'].includes(status),
      petRenderMode: '2d'
    });
    resizePetWindow(store.data.settings);
    broadcastState();
    return { petImageData, petImageName: name, status, message };
  });
  ipcMain.handle('skin:process-background', async () => {
    const originalData = store.data.settings.petOriginalImageData;
    if (!originalData) throw new Error('请先选择一张桌宠图片');
    if (/^data:image\/gif/i.test(originalData)) throw new Error('GIF 动图暂时不能自动抠图，否则会丢失动画');
    const result = await removeBackgroundFromDataUrl(originalData);
    store.updateSettings({ petImageData: result.dataUrl, petBackgroundRemoved: true });
    broadcastState();
    return result;
  });
  ipcMain.handle('skin:use-original', () => {
    const originalData = store.data.settings.petOriginalImageData;
    if (!originalData) throw new Error('没有可恢复的原图');
    store.updateSettings({ petImageData: originalData, petBackgroundRemoved: false });
    broadcastState();
    return true;
  });
  ipcMain.handle('skin:reset', () => {
    store.updateSettings({
      petImageData: '',
      petOriginalImageData: '',
      petImageName: '',
      petBackgroundRemoved: false
    });
    broadcastState();
    return true;
  });

  ipcMain.handle('model:choose-preview', async () => {
    const result = await dialog.showOpenDialog(panelWindow, {
      title: '选择 GLB、VRM 或 Live2D 模型',
      filters: [{ name: '桌宠模型', extensions: ['glb', 'vrm', 'json'] }],
      properties: ['openFile']
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const sourcePath = result.filePaths[0];
    const inspection = modelLibrary.inspectFile(sourcePath);
    const token = crypto.randomUUID();
    pendingModelPreviews.set(token, { sourcePath, baseDirectory: path.dirname(sourcePath), createdAt: Date.now() });
    setTimeout(() => pendingModelPreviews.delete(token), 10 * 60 * 1000);
    const { config: _config, references: _references, ...publicInspection } = inspection;
    return {
      token,
      ...publicInspection,
      previewUrl: inspection.format === 'live2d' ? `quickpet-preview://${token}/${encodeURI(path.basename(sourcePath))}` : ''
    };
  });
  ipcMain.handle('model:preview-bytes', (_event, token) => {
    const preview = pendingModelPreviews.get(token);
    if (!preview) return null;
    const buffer = fs.readFileSync(preview.sourcePath);
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  });
  ipcMain.handle('model:confirm-import', (_event, token, preferredName = '') => {
    const preview = pendingModelPreviews.get(token);
    if (!preview) throw new Error('预览已过期，请重新选择模型');
    const model = modelLibrary.importFile(preview.sourcePath, preferredName || path.basename(preview.sourcePath).replace(/\.model3\.json$/i, '').replace(/\.[^.]+$/, ''));
    pendingModelPreviews.delete(token);
    resizePetWindow(store.data.settings);
    broadcastState();
    return model;
  });
  ipcMain.handle('model:cancel-preview', (_event, token) => pendingModelPreviews.delete(token));
  ipcMain.handle('model:choose', async () => {
    const result = await dialog.showOpenDialog(panelWindow, {
      title: '选择 GLB、VRM 或 Live2D 模型',
      filters: [{ name: '桌宠模型', extensions: ['glb', 'vrm', 'json'] }],
      properties: ['openFile']
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const sourcePath = result.filePaths[0];
    const model = modelLibrary.importFile(sourcePath, path.basename(sourcePath).replace(/\.model3\.json$/i, '').replace(/\.[^.]+$/, ''));
    resizePetWindow(store.data.settings);
    broadcastState();
    return model;
  });

  ipcMain.handle('model:get', (_event, companionId = '') => {
    const companion = store.data.companions.find((item) => item.id === companionId);
    const settings = companion ? { petModelPreset: companion.modelPreset, activeModelId: companion.activeModelId } : store.data.settings;
    const selectedModel = store.data.models.find((item) => item.id === settings.activeModelId);
    const buffer = settings.petModelPreset === 'custom' && selectedModel
      ? fs.readFileSync(modelLibrary.modelPath(selectedModel))
      : fs.readFileSync(assetPath(path.join('models', 'fox.glb')));
    if (!buffer) return null;
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  });

  ipcMain.handle('model:select', (_event, id) => {
    const model = modelLibrary.store.selectModel(id);
    resizePetWindow(store.data.settings);
    broadcastState();
    return model;
  });
  ipcMain.handle('model:update', (_event, id, changes) => {
    const model = store.updateModel(id, changes || {});
    broadcastState();
    return model;
  });
  ipcMain.handle('model:remove', (_event, id) => {
    const removed = modelLibrary.remove(id);
    broadcastState();
    return removed;
  });

  ipcMain.handle('model:reset', () => {
    store.updateSettings({ petModelPreset: 'fox', petRenderMode: '3d', activeModelId: '', petModelName: '' });
    broadcastState();
    return true;
  });

  ipcMain.handle('model:open-library', () => shell.openExternal(
    'https://sketchfab.com/3d-models/animated-cat-3d-animal-model-c86d90e98e8e467e92c908206e1ee667'
  ));

  ipcMain.handle('pet:status-update', (_event, changes) => {
    const status = store.updatePetStatus(changes || {});
    broadcastState();
    return status;
  });
  ipcMain.handle('pet:interact', (event, kind) => {
    const status = store.interactWithPet(kind);
    const companionEntry = [...companionWindows.entries()].find(([, window]) => window?.webContents?.id === event.sender.id);
    const controller = companionEntry ? companionControllers.get(companionEntry[0]) : motionController;
    controller?.react(kind);
    broadcastState();
    return status;
  });

  ipcMain.handle('backup:export', async () => {
    const result = await dialog.showSaveDialog(panelWindow, {
      title: '导出快捷宠备份',
      defaultPath: `快捷宠备份-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON 备份', extensions: ['json'] }]
    });
    if (result.canceled || !result.filePath) return null;
    fs.writeFileSync(result.filePath, JSON.stringify(store.snapshot(), null, 2), 'utf8');
    return result.filePath;
  });
  ipcMain.handle('backup:import', async () => {
    const result = await dialog.showOpenDialog(panelWindow, {
      title: '恢复快捷宠备份',
      filters: [{ name: 'JSON 备份', extensions: ['json'] }],
      properties: ['openFile']
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const input = JSON.parse(fs.readFileSync(result.filePaths[0], 'utf8'));
    backupManager.create(store.snapshot(), { reason: 'before-restore', force: true });
    const data = store.replaceData(input);
    registerSearchShortcut(store.data.settings.globalSearchShortcut);
    syncShortcutHotkeys();
    broadcastState();
    return data;
  });
  ipcMain.handle('backup:list', () => backupManager.list());
  ipcMain.handle('backup:create', () => backupManager.create(store.snapshot(), { reason: 'manual', force: true }));
  ipcMain.handle('backup:restore-auto', (_event, id) => {
    backupManager.create(store.snapshot(), { reason: 'before-restore', force: true });
    const data = store.replaceData(backupManager.restore(id));
    registerSearchShortcut(store.data.settings.globalSearchShortcut);
    syncShortcutHotkeys();
    broadcastState();
    return data;
  });
  ipcMain.handle('backup:remove', (_event, id) => backupManager.remove(id));
  ipcMain.handle('migration:export', () => exportMigrationBundle());
  ipcMain.handle('migration:import', () => importMigrationBundle());

  ipcMain.handle('maintenance:report', async () => maintenanceManager.report());
  ipcMain.handle('maintenance:clear-cache', async (event) => {
    const sender = event.sender;
    const result = await clearRuntimeCacheWithElevation((progress) => {
      if (!sender.isDestroyed()) sender.send('maintenance:cache-progress', progress);
    });
    broadcastState();
    return result;
  });
  ipcMain.handle('maintenance:clear-old-portable-caches', async () => clearOldPortableCachesWithElevation());
  ipcMain.handle('maintenance:open-data', () => shell.openPath(app.getPath('userData')));
  ipcMain.handle('maintenance:exit-safe-mode', () => leaveSafeMode());
  ipcMain.handle('maintenance:remove-program', (_event, removeUserData) => scheduleProgramRemoval(Boolean(removeUserData)));

  ipcMain.handle('update:check', () => checkForUpdates());
  ipcMain.handle('update:download', () => downloadAvailableUpdate());
  ipcMain.handle('command:execute', (_event, id) => executeCommand(String(id || '')));

  ipcMain.handle('pet:context-menu', () => {
    const menu = Menu.buildFromTemplate([
      { label: '打开快捷面板', click: () => togglePanel(true) },
      { label: '隐藏快捷面板', click: () => togglePanel(false) },
      { label: `摸摸${store.data.petStatus.name}`, click: () => { store.interactWithPet('pet'); broadcastState(); } },
      { label: `给${store.data.petStatus.name}喂食`, click: () => { store.interactWithPet('feed'); broadcastState(); } },
      { label: '打开全局快捷搜索', click: () => toggleSearch(true) },
      { label: '打开快捷启动台', click: () => toggleSearch(true, 'launcher') },
      { type: 'separator' },
      { label: '设置', click: () => navigatePanel('settings') },
      {
        label: store.data.settings.petRenderMode === '3d' ? '切换为 2D 皮肤' : '切换为 3D 动物',
        click: () => {
          store.updateSettings({ petRenderMode: store.data.settings.petRenderMode === '3d' ? '2d' : '3d' });
          resizePetWindow(store.data.settings);
          broadcastState();
        }
      },
      {
        label: store.data.settings.autoWalk === false ? '开始自动散步' : '暂停自动散步',
        click: () => {
          store.updateSettings({ autoWalk: store.data.settings.autoWalk === false });
          broadcastState();
        }
      },
      { label: '回到屏幕右下角', click: placePetAtBottomRight },
      { type: 'separator' },
      { label: '退出快捷宠', click: () => { isQuitting = true; app.quit(); } }
    ]);
    menu.popup({ window: petWindow });
  });
}

function createTray() {
  let icon = createAppIcon();
  if (!icon.isEmpty()) icon = icon.resize({ width: 32, height: 32 });
  tray = new Tray(icon);
  tray.setToolTip(APP_NAME);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示桌宠', click: () => petWindow?.showInactive() },
    { label: '打开快捷面板', click: () => togglePanel(true) },
    { label: '设置', click: () => navigatePanel('settings') },
    { type: 'separator' },
    { label: '退出', click: () => { isQuitting = true; app.quit(); } }
  ]));
  tray.on('click', () => togglePanel());
}

const gotLock = isLaunchProbe || app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    petWindow?.showInactive();
    togglePanel(true);
  });

  app.whenReady().then(async () => {
    if (isLaunchProbe) {
      app.exit(0);
      return;
    }
    app.setName(APP_NAME);
    app.setAppUserModelId('com.quickpet.launcher');
    const userDataDirectory = app.getPath('userData');
    const dataFile = path.join(userDataDirectory, 'quick-pet-data.json');
    const backupDirectory = path.join(userDataDirectory, 'backups');
    const modelDirectory = path.join(userDataDirectory, 'models');
    const assetDirectory = path.join(userDataDirectory, 'assets');
    startupRecovery = new StartupRecovery(path.join(userDataDirectory, 'startup-running.json'));
    safeMode = process.argv.includes('--safe-mode') || startupRecovery.previousRunCrashed();
    startupRecovery.begin(app.getVersion());
    backupManager = new BackupManager({ dataFile, directory: backupDirectory, retention: 10 });
    const recovered = backupManager.recoverIfNeeded();
    store = new Store(dataFile, { assetStore: new AssetStore(assetDirectory) });
    if (safeMode) {
      safeModeRestore = startupRecovery.readRestore() || { petRenderMode: store.data.settings.petRenderMode, autoWalk: store.data.settings.autoWalk, performanceMode: store.data.settings.performanceMode };
      startupRecovery.saveRestore(safeModeRestore);
      store.updateSettings({ petRenderMode: '2d', autoWalk: false, performanceMode: 'efficient' });
      store.addNotification({ title: '已进入安全模式', message: '检测到上次异常退出，已暂时使用 2D 低负载模式', kind: 'warning' });
    }
    shortcutHotkeyRegistry = new ShortcutHotkeyRegistry({
      registrar: globalShortcut,
      onTrigger: (id) => openShortcut(id).catch((error) => pushNotification({ title: '快捷启动失败', message: error.message, kind: 'warning' }))
    });
    backupManager.create(store.snapshot(), { reason: 'auto' });
    if (recovered) store.addNotification({ title: '数据已自动恢复', message: '检测到配置损坏，已恢复最近一份有效备份', kind: 'warning' });
    modelLibrary = new ModelLibrary({ directory: modelDirectory, store });
    const legacyPortableCacheRoot = path.join(os.tmpdir(), 'QuickPetPortable');
    const portableCacheRoot = isCacheProgressUiTest
      ? path.join(automatedSessionDirectory, 'portable-cache')
      : process.env.QUICKPET_PORTABLE_CACHE_ROOT || legacyPortableCacheRoot;
    maintenanceManager = new MaintenanceManager({
      userData: userDataDirectory,
      modelDirectory,
      backupDirectory,
      portableCacheRoots: isCacheProgressUiTest ? [portableCacheRoot] : [portableCacheRoot, legacyPortableCacheRoot],
      currentCacheDirectory: process.env.QUICKPET_PORTABLE === '1' ? path.dirname(process.execPath) : '',
      sessionProvider: () => session.defaultSession
    });
    if (isCacheProgressUiTest) {
      const fixture = path.join(portableCacheRoot, `progress-fixture-${process.pid}`);
      fs.mkdirSync(fixture, { recursive: true });
      fs.writeFileSync(path.join(fixture, 'old-runtime.bin'), Buffer.alloc(1024));
      const createRemoveOperation = maintenanceManager.createRemoveOperation;
      maintenanceManager.createRemoveOperation = (...args) => {
        const operation = createRemoveOperation(...args);
        return {
          promise: new Promise((resolve, reject) => {
            setTimeout(() => operation.promise.then(resolve, reject), 500);
          }),
          cancel: () => operation.cancel?.()
        };
      };
    }
    if (isCacheCleanupTest) {
      const resultPath = path.join(process.cwd(), 'cache-cleanup-test-result.json');
      try {
        const before = await maintenanceManager.report();
        const cleanup = await maintenanceManager.clearCache();
        const after = await maintenanceManager.report();
        fs.writeFileSync(resultPath, JSON.stringify({
          execPath: process.execPath,
          cacheRoot: portableCacheRoot,
          currentCacheDirectory: process.env.QUICKPET_PORTABLE === '1' ? path.dirname(process.execPath) : '',
          before,
          cleanup,
          after
        }, null, 2));
        exitAutomatedTest(after.stalePortableCacheCount === 0 ? 0 : 14);
      } catch (error) {
        fs.writeFileSync(resultPath, JSON.stringify({ error: error.stack || error.message }, null, 2));
        exitAutomatedTest(14);
      }
      return;
    }
    migrationManager = new MigrationManager({ dataFile, modelDirectory, assetDirectory, store, backupManager, appVersion: app.getVersion() });
    updateManager = new UpdateManager({ currentVersion: app.getVersion() });
    registerModelProtocols();
    try { modelLibrary.migrateLegacyModel(customPetModelPath()); } catch (error) { console.warn('legacy-model-migration-failed', error.message); }
    if (is3dModelTest) {
      const testModelPath = process.env.QUICK_PET_TEST_MODEL || assetPath(path.join('models', 'fox.glb'));
      if (!fs.existsSync(testModelPath)) throw new Error(`缺少测试模型：${testModelPath}`);
      modelLibrary.importFile(testModelPath, 'model-test.glb');
    }
    if (isBackgroundRemovalTest) {
      try {
        const testImage = nativeImage.createFromBuffer(fs.readFileSync(assetPath('app-icon.png')));
        const result = await removeBackground(testImage, { maxSegmentSize: 160, force: true });
        if (!result.dataUrl.startsWith('data:image/png;base64,')) throw new Error('抠图结果格式不正确');
        console.log(`background-removal-ok ratio=${result.foregroundRatio.toFixed(3)}`);
        exitAutomatedTest(0);
      } catch (error) {
        console.error(error.stack || error.message);
        exitAutomatedTest(3);
      }
      return;
    }
    if (is3dTest || is3dModelTest || isPerformanceTest) {
      store.data.settings.petRenderMode = '3d';
      if (is3dTest || isPerformanceTest) store.data.settings.petModelPreset = 'fox';
      store.data.settings.autoWalk = false;
    }
    registerIpc();
    createPetWindow();
    if (isSmokeTest || isUiTest || isAcceptanceTest || isCacheProgressUiTest) createPanelWindow();
    motionController = new PetMotionController({
      getWindow: () => petWindow,
      getSettings: () => ({ ...store.data.settings, petStatus: store.data.petStatus }),
      screen
    });
    motionController.start();
    watchedFolderManager = new WatchedFolderManager({
      store,
      onChanged: ({ folder, added }) => pushNotification({ title: '动态文件夹已更新', message: `${folder.name} 新收纳 ${added} 项`, kind: 'success' })
    });
    reminderScheduler = new ReminderScheduler({
      store,
      notify: (reminder) => {
        if (store.data.settings.notificationsEnabled && Notification.isSupported()) {
          try { new Notification({ title: reminder.title, body: reminder.note || '到时间了', icon: createAppIcon() }).show(); } catch {}
        }
        broadcastState();
      }
    });
    if (!isAutomatedTest) {
      watchedFolderManager.start();
      reminderScheduler.start();
      startClipboardMonitor();
      syncCompanionWindows();
    }
    registerSearchShortcut(store.data.settings.globalSearchShortcut);
    syncShortcutHotkeys();
    fullscreenWatcher = new FullscreenWatcher({
      screen,
      onChange: (isFullscreen) => {
        if (!store?.data.settings.hideOnFullscreen) return;
        if (isFullscreen && petWindow?.isVisible() && !panelWindow?.isVisible()) {
          petWindow.hide();
          hiddenByFullscreen = true;
        } else if (!isFullscreen && hiddenByFullscreen) {
          petWindow?.showInactive();
          hiddenByFullscreen = false;
        }
      }
    });
    if (!isAutomatedTest && store.data.settings.hideOnFullscreen) fullscreenWatcher.start();
    if (!isAutomatedTest) createTray();
    if (!isAutomatedTest) setTimeout(() => promptForOldPortableCaches().catch((error) => console.warn('portable-cache-cleanup-prompt-failed', error.message)), 1400);
    if (!isAutomatedTest && store.data.settings.autoCheckUpdates) {
      setTimeout(() => checkForUpdates().then((result) => {
        if (result.status === 'available') pushNotification({ title: `发现快捷宠 ${result.version}`, message: result.notes || '可以在维护台下载新版本', kind: 'info' });
      }).catch(() => {}), 8000);
    }
    if (isMotionTest) {
      store.updateSettings({ autoWalk: true, petWalkSpeed: 110, naturalBehavior: false, nightSleep: false });
      whenPetShown(() => {
        const startingX = petWindow.getBounds().x;
        setTimeout(() => {
          const endingX = petWindow?.getBounds().x ?? startingX;
          const distance = Math.abs(endingX - startingX);
          console.log(`motion-test distance=${distance}px`);
          exitAutomatedTest(distance >= 8 ? 0 : 4);
        }, 6500);
      });
    }
    if (is3dTest || is3dModelTest) {
      whenPetShown(() => {
        setTimeout(async () => {
          try {
            motionController.stop();
            await petWindow.webContents.executeJavaScript("document.getElementById('speechBubble').style.display='none'");
            petWindow.webContents.send('pet:motion', { mode: 'walk', direction: 1, action: '' });
            await new Promise((resolve) => setTimeout(resolve, 650));
            const firstFrame = await petWindow.webContents.capturePage();
            const firstName = is3dModelTest ? 'pet-3d-model-a.png' : 'pet-3d-walk-a.png';
            const firstPath = path.join(process.cwd(), 'tests', firstName);
            fs.writeFileSync(firstPath, firstFrame.toPNG());
            await new Promise((resolve) => setTimeout(resolve, 360));
            const secondFrame = await petWindow.webContents.capturePage();
            const secondName = is3dModelTest ? 'pet-3d-model-b.png' : 'pet-3d-walk-b.png';
            const secondPath = path.join(process.cwd(), 'tests', secondName);
            fs.writeFileSync(secondPath, secondFrame.toPNG());
            console.log(`3d-test screenshots=${firstPath},${secondPath}`);
            exitAutomatedTest(0);
          } catch (error) {
            console.error(error.stack || error.message);
            exitAutomatedTest(5);
          }
        }, 2200);
      });
    }
    if (isSmokeTest) {
      let loadedWindows = 0;
      const markLoaded = () => {
        loadedWindows += 1;
        if (loadedWindows === 2) setTimeout(() => exitAutomatedTest(0), 300);
      };
      whenWebContentsLoaded(petWindow.webContents, markLoaded);
      whenWebContentsLoaded(panelWindow.webContents, markLoaded);
      setTimeout(() => exitAutomatedTest(2), 12000);
    }
    if (isUiTest) {
      whenWebContentsLoaded(panelWindow.webContents, () => {
        store.removeAllShortcuts();
        for (let index = 0; index < 12; index += 1) {
          store.addShortcut({
            name: index === 0 ? '一个名称很长但不应该挤坏布局的 Steam 游戏快捷方式' : `快捷项目 ${index + 1}`,
            target: index === 0 ? 'steam://rungameid/730' : `https://example.com/item-${index + 1}`,
            favorite: index < 3,
            showInLauncher: index === 3,
            hotkey: index === 1 ? 'CommandOrControl+Shift+K' : ''
          }, { persist: false });
        }
        store.save();
        broadcastState();
        navigatePanel('settings');
        setTimeout(async () => {
          try {
            const screenshot = await panelWindow.webContents.capturePage();
            const sidebarLayout = await panelWindow.webContents.executeJavaScript(`(() => {
              const rect = (selector) => { const element = document.querySelector(selector); const box = element.getBoundingClientRect(); return { top: box.top, bottom: box.bottom, height: box.height, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight }; };
              return { viewport: { innerWidth, innerHeight, devicePixelRatio }, app: rect('.app-shell'), workspace: rect('.workspace'), sidebar: rect('.sidebar'), scroll: rect('.sidebar-scroll'), bottom: rect('.sidebar-bottom'), automation: rect('[data-view="automation"]'), settings: rect('[data-view="settings"]') };
            })()`);
            const screenshotPath = path.join(process.cwd(), 'tests', 'settings-center.png');
            fs.writeFileSync(screenshotPath, screenshot.toPNG());
            await panelWindow.webContents.executeJavaScript("document.querySelector('.global-hotkeys-card').scrollIntoView({block:'start'})");
            await new Promise((resolve) => setTimeout(resolve, 250));
            const hotkeysScreenshot = await panelWindow.webContents.capturePage();
            const hotkeysScreenshotPath = path.join(process.cwd(), 'tests', 'settings-hotkeys.png');
            fs.writeFileSync(hotkeysScreenshotPath, hotkeysScreenshot.toPNG());
            await panelWindow.webContents.executeJavaScript("document.querySelector('.model-center-card').scrollIntoView({block:'start'})");
            await new Promise((resolve) => setTimeout(resolve, 250));
            const modelScreenshot = await panelWindow.webContents.capturePage();
            const modelScreenshotPath = path.join(process.cwd(), 'tests', 'settings-model-center.png');
            fs.writeFileSync(modelScreenshotPath, modelScreenshot.toPNG());
            navigatePanel('automation');
            await new Promise((resolve) => setTimeout(resolve, 250));
            const automationScreenshot = await panelWindow.webContents.capturePage();
            const automationScreenshotPath = path.join(process.cwd(), 'tests', 'automation-center.png');
            fs.writeFileSync(automationScreenshotPath, automationScreenshot.toPNG());
            toggleSearch(true);
            await new Promise((resolve) => setTimeout(resolve, 250));
            const searchScreenshot = await searchWindow.webContents.capturePage();
            const searchState = await searchWindow.webContents.executeJavaScript(`({ resultCount: document.querySelectorAll('[data-index]').length, emptyText: document.querySelector('.empty')?.textContent || '' })`);
            const searchScreenshotPath = path.join(process.cwd(), 'tests', 'global-search.png');
            fs.writeFileSync(searchScreenshotPath, searchScreenshot.toPNG());
            toggleSearch(true, 'launcher');
            await new Promise((resolve) => setTimeout(resolve, 250));
            const launcherScreenshot = await searchWindow.webContents.capturePage();
            const launcherState = await searchWindow.webContents.executeJavaScript(`({ resultCount: document.querySelectorAll('.launcher-item').length, names: [...document.querySelectorAll('.launcher-item b')].map((item) => item.textContent) })`);
            const launcherScreenshotPath = path.join(process.cwd(), 'tests', 'quick-launcher.png');
            fs.writeFileSync(launcherScreenshotPath, launcherScreenshot.toPNG());
            console.log(`ui-test panel-bounds=${JSON.stringify(panelWindow.getBounds())}`);
            console.log(`ui-test sidebar-layout=${JSON.stringify(sidebarLayout)}`);
            console.log(`ui-test search-state=${JSON.stringify(searchState)} launcher-state=${JSON.stringify(launcherState)}`);
            console.log(`ui-test screenshots=${screenshotPath},${hotkeysScreenshotPath},${modelScreenshotPath},${automationScreenshotPath},${searchScreenshotPath},${launcherScreenshotPath}`);
            const categoryIds = store.data.categories.filter((item) => !item.id.startsWith('custom-')).map((item) => item.id);
            const panelHotkeyReady = await panelWindow.webContents.executeJavaScript(`document.getElementById('panelShortcutStatus')?.textContent === '已生效'`);
            exitAutomatedTest(searchState.resultCount === 0 && launcherState.resultCount === 4 && panelHotkeyReady && JSON.stringify(categoryIds) === JSON.stringify(['tools', 'study', 'work']) ? 0 : 6);
          } catch (error) {
            console.error(error.stack || error.message);
            exitAutomatedTest(6);
          }
        }, 900);
      });
      setTimeout(() => exitAutomatedTest(7), 12000);
    }
    if (isCacheProgressUiTest) {
      whenWebContentsLoaded(panelWindow.webContents, () => {
        navigatePanel('settings');
        setTimeout(async () => {
          try {
            const running = await panelWindow.webContents.executeJavaScript(`(async () => {
              window.confirm = () => true;
              const events = [];
              window.quickPet.onCacheCleanupProgress((progress) => events.push(progress.stage));
              document.getElementById('clearCacheButton').click();
              const waitFor = async (predicate, timeout = 3000) => {
                const started = Date.now();
                while (!predicate()) {
                  if (Date.now() - started > timeout) throw new Error('timed out waiting for cache progress');
                  await new Promise((resolve) => setTimeout(resolve, 25));
                }
              };
              const progress = document.getElementById('cacheCleanupProgress');
              await waitFor(() => progress.dataset.stage === 'portable-item-start');
              progress.scrollIntoView({ block: 'center' });
              await new Promise((resolve) => setTimeout(resolve, 100));
              window.__cacheProgressStages = events;
              return {
                visible: !progress.classList.contains('hidden'),
                stage: progress.dataset.stage,
                status: document.getElementById('cacheCleanupStatus').textContent,
                percent: document.getElementById('cacheCleanupPercent').textContent,
                clearDisabled: document.getElementById('clearCacheButton').disabled,
                refreshDisabled: document.getElementById('refreshStorageButton').disabled
              };
            })()`);
            const screenshot = await panelWindow.webContents.capturePage();
            const screenshotPath = path.join(process.cwd(), 'tests', 'cache-cleanup-progress.png');
            fs.writeFileSync(screenshotPath, screenshot.toPNG());
            const completed = await panelWindow.webContents.executeJavaScript(`(async () => {
              const progress = document.getElementById('cacheCleanupProgress');
              const started = Date.now();
              while (progress.dataset.stage !== 'complete' || document.getElementById('clearCacheButton').textContent.includes('清理中')) {
                if (Date.now() - started > 8000) throw new Error('timed out waiting for cache cleanup completion');
                await new Promise((resolve) => setTimeout(resolve, 25));
              }
              return {
                stage: progress.dataset.stage,
                percent: document.getElementById('cacheCleanupPercent').textContent,
                status: document.getElementById('cacheCleanupStatus').textContent,
                refreshDisabled: document.getElementById('refreshStorageButton').disabled,
                stages: window.__cacheProgressStages
              };
            })()`);
            const runningPassed = running.visible && running.stage === 'portable-item-start' && running.clearDisabled && running.refreshDisabled;
            const completedPassed = completed.stage === 'complete' && completed.percent === '100%' && !completed.refreshDisabled && completed.stages.includes('runtime-start') && completed.stages.includes('complete');
            console.log(`cache-progress-ui-test running=${JSON.stringify(running)} completed=${JSON.stringify(completed)} screenshot=${screenshotPath}`);
            exitAutomatedTest(runningPassed && completedPassed ? 0 : 15);
          } catch (error) {
            console.error(`cache-progress-ui-test-error ${error.stack || error.message}`);
            exitAutomatedTest(15);
          }
        }, 900);
      });
      setTimeout(() => exitAutomatedTest(15), 15000);
    }
    if (isPerformanceTest) {
      whenPetShown(() => {
        const samples = [];
        setTimeout(() => {
          const timer = setInterval(async () => {
            const metrics = app.getAppMetrics();
            samples.push({
              cpu: metrics.reduce((sum, item) => sum + (item.cpu?.percentCPUUsage || 0), 0),
              memoryKb: metrics.reduce((sum, item) => sum + (item.memory?.workingSetSize || 0), 0)
            });
            if (samples.length < 8) return;
            clearInterval(timer);
            const renderStats = await petWindow.webContents.executeJavaScript('window.__quickPetRenderStats?.() || null');
            const averageCpu = samples.reduce((sum, item) => sum + item.cpu, 0) / samples.length;
            const maxMemoryMb = Math.max(...samples.map((item) => item.memoryKb)) / 1024;
            console.log(`performance-test avgCpu=${averageCpu.toFixed(2)} maxMemoryMb=${maxMemoryMb.toFixed(1)} renderStats=${JSON.stringify(renderStats)}`);
            exitAutomatedTest(0);
          }, 1000);
        }, 2200);
      });
      setTimeout(() => exitAutomatedTest(8), 15000);
    }
    if (isClickThroughTest) {
      whenPetShown(() => {
        setTimeout(async () => {
          try {
            motionController.stop();
            const { width, height } = petWindow.getBounds();
            const sample = async (x, y) => {
              await petWindow.webContents.executeJavaScript(`window.dispatchEvent(new MouseEvent('mousemove', { clientX: ${x}, clientY: ${y}, bubbles: true }))`);
              await new Promise((resolve) => setTimeout(resolve, 80));
              return petClickThroughStates.get(petWindow);
            };
            const cornerBefore = await sample(width - 5, height - 5);
            const center = await sample(Math.round(width / 2), Math.round(height * 0.55));
            const cornerAfter = await sample(width - 5, height - 5);
            console.log(`click-through-test cornerBefore=${cornerBefore} center=${center} cornerAfter=${cornerAfter}`);
            exitAutomatedTest(cornerBefore === true && center === false && cornerAfter === true ? 0 : 9);
          } catch (error) {
            console.error(error.stack || error.message);
            exitAutomatedTest(9);
          }
        }, 700);
      });
      setTimeout(() => exitAutomatedTest(9), 8000);
    }
    if (isDirectDragTest) {
      whenPetShown(() => {
        setTimeout(async () => {
          try {
            motionController.stop();
            const before = petWindow.getBounds();
            await petWindow.webContents.executeJavaScript('window.quickPet.beginPetDrag(100, 100); window.quickPet.activatePetDrag(); window.quickPet.movePetDrag(142, 127); window.quickPet.endPetDrag();');
            await new Promise((resolve) => setTimeout(resolve, 120));
            const after = petWindow.getBounds();
            const deltaX = after.x - before.x;
            const deltaY = after.y - before.y;
            console.log(`direct-drag-test deltaX=${deltaX} deltaY=${deltaY}`);
            exitAutomatedTest(deltaX === 42 && deltaY === 27 ? 0 : 10);
          } catch (error) {
            console.error(error.stack || error.message);
            exitAutomatedTest(10);
          }
        }, 700);
      });
      setTimeout(() => exitAutomatedTest(10), 8000);
    }
    if (isCrossScreenTest) {
      whenPetShown(() => {
        setTimeout(async () => {
          try {
            motionController.stop();
            const displays = screen.getAllDisplays().sort((a, b) => a.workArea.x - b.workArea.x);
            console.log(`cross-screen-test displays=${JSON.stringify(displays.map(({ id, scaleFactor, bounds, workArea }) => ({ id, scaleFactor, bounds, workArea })))}`);
            if (displays.length < 2) {
              console.log('cross-screen-test skipped=single-display');
              exitAutomatedTest(0);
              return;
            }
            const bounds = petWindow.getBounds();
            const left = Math.min(...displays.map((display) => display.workArea.x));
            const right = Math.max(...displays.map((display) => display.workArea.x + display.workArea.width)) - bounds.width;
            const samples = 80;
            for (let index = 0; index <= samples; index += 1) {
              const x = Math.round(left + (right - left) * index / samples);
              const matching = screen.getDisplayMatching({ x, y: bounds.y, width: bounds.width, height: bounds.height });
              petWindow.setPosition(x, bounds.y, false);
              const actual = petWindow.getBounds();
              if (index % 10 === 0) console.log(`cross-screen-sample requested=${x},${bounds.y} actual=${actual.x},${actual.y} display=${matching.id}`);
              await new Promise((resolve) => setTimeout(resolve, 12));
            }
            const positionOnlyFinal = petWindow.getBounds();
            for (let index = samples; index >= 0; index -= 1) {
              const x = Math.round(left + (right - left) * index / samples);
              petWindow.setBounds({ x, y: bounds.y, width: bounds.width, height: bounds.height }, false);
              await new Promise((resolve) => setTimeout(resolve, 12));
            }
            const fixedBoundsFinal = petWindow.getBounds();
            const seam = displays.slice(1).map((display) => display.workArea.x).find((x) => x > left && x < right + bounds.width);
            let dragHoldPassed = true;
            let dragHoldBounds = null;
            let autoWalkPassed = true;
            let autoWalkBounds = null;
            if (Number.isFinite(seam)) {
              const dragHoldX = Math.round(seam - bounds.width + 2);
              motionController.setDragging(true);
              motionController.moveTo(dragHoldX, bounds.y);
              await new Promise((resolve) => setTimeout(resolve, 360));
              dragHoldBounds = petWindow.getBounds();
              dragHoldPassed = Math.abs(dragHoldBounds.x - dragHoldX) <= 3;
              motionController.setDragging(false);

              store.updateSettings({ petScreenMode: 'all', edgeSnap: true, autoWalk: true, naturalBehavior: false, nightSleep: false, activityPadding: 0, petWalkSpeed: 110 });
              const autoWalkStartX = Math.round(seam - bounds.width - 50);
              motionController.moveTo(autoWalkStartX, bounds.y);
              motionController.syncToWindow(petBoundsForScale(store.data.settings.petScale, store.data.settings.petRenderMode));
              motionController.pausedUntil = 0;
              motionController.engine.mode = 'walk';
              motionController.engine.direction = 1;
              motionController.engine.lastTickAt = Date.now();
              motionController.engine.phaseEndsAt = Date.now() + 6000;
              motionController.start();
              await new Promise((resolve) => setTimeout(resolve, 3000));
              motionController.stop();
              autoWalkBounds = petWindow.getBounds();
              autoWalkPassed = autoWalkBounds.x > seam + 10;
            }
            console.log(`cross-screen-test positionOnlyFinal=${JSON.stringify(positionOnlyFinal)} fixedBoundsFinal=${JSON.stringify(fixedBoundsFinal)} dragHold=${JSON.stringify(dragHoldBounds)} dragHoldPassed=${dragHoldPassed} autoWalk=${JSON.stringify(autoWalkBounds)} autoWalkPassed=${autoWalkPassed}`);
            if (!dragHoldPassed) throw new Error('edge snap moved the pet during a cross-screen drag hold');
            if (!autoWalkPassed) throw new Error('automatic walking did not cross the internal display seam');
            exitAutomatedTest(0);
          } catch (error) {
            console.error(`cross-screen-test-error ${error.stack || error.message}`);
            exitAutomatedTest(11);
          }
        }, 700);
      });
      setTimeout(() => exitAutomatedTest(11), 18000);
    }
    if (isCrossScreenDragTest) {
      whenPetShown(() => {
        motionController.stop();
        petWindow.setIgnoreMouseEvents(false);
        const startingBounds = petWindow.getBounds();
        console.log(`cross-screen-drag-ready bounds=${JSON.stringify(startingBounds)}`);
        const finish = () => {
          const moves = crossScreenDragDiagnostics.filter((entry) => entry.phase === 'move');
          const begin = crossScreenDragDiagnostics.find((entry) => entry.phase === 'begin');
          const end = crossScreenDragDiagnostics.find((entry) => entry.phase === 'end');
          const finalBounds = petWindow.getBounds();
          const maximumDelta = moves.reduce((maximum, entry) => Math.max(maximum, Math.abs(entry.supplied.x - entry.cursor.x), Math.abs(entry.supplied.y - entry.cursor.y)), 0);
          const expected = begin && end ? {
            x: Math.round(startingBounds.x + end.cursor.x - begin.cursor.x),
            y: Math.round(startingBounds.y + end.cursor.y - begin.cursor.y)
          } : null;
          const passed = Boolean(expected)
            && Math.abs(finalBounds.x - expected.x) <= 3
            && Math.abs(finalBounds.y - expected.y) <= 3
            && Math.abs(finalBounds.width - startingBounds.width) <= 3
            && Math.abs(finalBounds.height - startingBounds.height) <= 3;
          console.log(`cross-screen-drag-test events=${crossScreenDragDiagnostics.length} maximumCoordinateDelta=${maximumDelta} expected=${JSON.stringify(expected)} final=${JSON.stringify(finalBounds)} passed=${passed}`);
          console.log(`cross-screen-drag-diagnostics=${JSON.stringify(crossScreenDragDiagnostics.filter((_entry, index) => index % Math.max(1, Math.floor(crossScreenDragDiagnostics.length / 12)) === 0))}`);
          exitAutomatedTest(passed ? 0 : 12);
        };
        const diagnosticTimer = setInterval(() => {
          if (!crossScreenDragDiagnostics.some((entry) => entry.phase === 'end')) return;
          clearInterval(diagnosticTimer);
          finish();
        }, 200);
        setTimeout(() => {
          clearInterval(diagnosticTimer);
          finish();
        }, 30000);
      });
      setTimeout(() => exitAutomatedTest(12), 35000);
    }
    if (isAcceptanceTest) {
      whenWebContentsLoaded(panelWindow.webContents, () => {
        setTimeout(async () => {
          try {
            const fixturePath = path.join(process.cwd(), 'package.json');
            const result = await panelWindow.webContents.executeJavaScript(`(async () => {
              const api = window.quickPet;
              const assert = (condition, label) => { if (!condition) throw new Error('acceptance failed: ' + label); };
              const passed = [];
              const mark = (label) => passed.push(label);
              let state = await api.getState();
              assert(Array.isArray(state.categories) && Array.isArray(state.shortcuts), 'state'); mark('state');

              for (const item of state.shortcuts.filter((entry) => entry.target === ${JSON.stringify(fixturePath)})) await api.removeShortcut(item.id);
              for (const item of state.categories.filter((entry) => entry.name.startsWith('Acceptance'))) await api.removeCategory(item.id);
              const category = await api.addCategory({ name: 'Acceptance', icon: 'A', color: '#333333' });
              await api.updateCategory(category.id, { name: 'Acceptance Updated' });
              await api.moveCategory(category.id, -1); mark('categories');

              const localResult = await api.addPaths([${JSON.stringify(fixturePath)}]);
              assert(localResult.added.length === 1 && localResult.errors.length === 0, 'add local path');
              const local = localResult.added[0];
              await api.refreshShortcutIcon(local.id);
              await api.clearShortcutIcon(local.id);
              const url = await api.addShortcut({ name: 'Acceptance URL', target: 'https://acceptance.example/test', category: category.id });
              await api.updateShortcut(url.id, { favorite: true, showInLauncher: true, tags: ['acceptance'], hotkey: 'Control+Alt+Shift+F11' });
              state = await api.getState();
              assert(state.shortcuts.find((entry) => entry.id === url.id)?.showInLauncher === true, 'launcher membership');
              await api.reorderShortcut(url.id, local.id, category.id);
              await api.removeShortcut(url.id);
              const checked = await api.checkAll();
              assert(checked.some((entry) => entry.id === local.id && entry.status === 'ok'), 'availability check');
              await api.resetUsage(); mark('shortcuts');

              const imported = await api.importScannedShortcuts([{ name: 'Scanned Acceptance', target: 'https://scan.acceptance.example', type: 'website', category: category.id }]);
              assert(imported.added.length === 1, 'scan import');
              await api.removeShortcut(imported.added[0].id); mark('scan import');
              const scanCounts = {};
              for (const kind of ['desktop', 'start-menu', 'bookmarks']) {
                const candidates = await api.scanShortcuts(kind);
                assert(Array.isArray(candidates) && candidates.length <= 1500, 'scan ' + kind);
                scanCounts[kind] = candidates.length;
              }
              mark('system scans ' + JSON.stringify(scanCounts));

              const settings = await api.updateSettings({ theme: 'dark', panelOpacity: 0.95, petScreenMode: 'all' });
              assert(settings.theme === 'dark' && settings.petScreenMode === 'all', 'settings');
              await api.updateSettings({ theme: 'system', panelOpacity: 0.98, petScreenMode: 'current' }); mark('settings');

              const status = await api.updatePetStatus({ name: 'Acceptance Pet' });
              assert(status.name === 'Acceptance Pet', 'pet status');
              await api.interactWithPet('feed');
              await api.interactWithPet('play'); mark('pet interaction');

              const rule = await api.addRule({ name: 'Acceptance Rule', field: 'name', operator: 'contains', value: 'acceptance', category: category.id, tags: ['tested'] });
              await api.updateRule(rule.id, { enabled: false });
              await api.removeRule(rule.id); mark('rules');

              const reminder = await api.addReminder({ title: 'Acceptance Reminder', dueAt: Date.now() + 3600000, repeat: 'daily' });
              await api.updateReminder(reminder.id, { completedAt: Date.now() });
              await api.removeReminder(reminder.id); mark('reminders');

              const folder = await api.addWatchedFolder({ path: ${JSON.stringify(process.cwd())}, category: category.id, tags: ['acceptance'] });
              await api.updateWatchedFolder(folder.id, { enabled: false });
              await api.removeWatchedFolder(folder.id); mark('watched folders');

              const companion = await api.addCompanion({ name: 'Acceptance Companion', renderMode: '3d', personality: 'lively', enabled: true });
              await api.updateCompanion(companion.id, { enabled: false, scale: 0.8 });
              await api.removeCompanion(companion.id); mark('companions');

              const clipboardItem = await api.acceptClipboardCandidate({ target: 'https://clipboard.acceptance.example', type: 'website' });
              await api.dismissClipboardCandidate('https://dismiss.acceptance.example');
              await api.removeShortcut(clipboardItem.id); mark('clipboard');

              const bytes = await api.getPetModel('');
              assert(bytes && bytes.byteLength > 1000, 'built-in model bytes');
              await api.resetPetModel(); mark('model access');

              const backup = await api.createBackup();
              const backups = await api.listBackups();
              assert(backups.some((entry) => entry.id === backup.id), 'backup list');
              await api.removeBackup(backup.id); mark('backups');

              const storage = await api.getStorageReport();
              assert(Number.isFinite(storage.userDataBytes) && Number.isFinite(storage.portableCacheBytes), 'storage report');
              const cleanup = await api.clearRuntimeCache();
              assert(Number.isFinite(cleanup.releasedBytes) && cleanup.report && Number.isFinite(cleanup.report.cleanableCacheBytes), 'cache cleanup result');
              mark('maintenance');

              const update = await api.checkForUpdates('');
              assert(['current', 'available', 'unavailable'].includes(update.status), 'update check'); mark('updates');

              await api.executeCommand('toggle-walk');
              await api.executeCommand('open-settings');
              await api.executeCommand('open-automation');
              await api.toggleSearch(true);
              await api.hideSearch();
              await api.togglePanel(false);
              await api.togglePanel(true); mark('commands and windows');

              await api.markNotificationsRead();
              await api.clearNotifications(); mark('notifications');

              await api.removeShortcut(local.id);
              await api.removeCategory(category.id); mark('cleanup');
              return passed;
            })()`);
            const feedTarget = 'https://feed.acceptance.example/drop';
            await petWindow.webContents.executeJavaScript(`(() => {
              const dataTransfer = new DataTransfer();
              dataTransfer.setData('text/uri-list', ${JSON.stringify(feedTarget)});
              document.getElementById('petButton').dispatchEvent(new DragEvent('drop', { dataTransfer, bubbles: true, cancelable: true }));
            })()`);
            const feedDeadline = Date.now() + 3000;
            while (!store.data.shortcuts.some((item) => item.target === feedTarget) && Date.now() < feedDeadline) await new Promise((resolve) => setTimeout(resolve, 25));
            const fedItem = store.data.shortcuts.find((item) => item.target === feedTarget);
            if (!fedItem) throw new Error('acceptance failed: pet drop feed');
            store.removeShortcut(fedItem.id);
            result.push('pet drop feed');
            console.log(`acceptance-test passed=${result.length} features=${result.join(',')}`);
            exitAutomatedTest(0);
          } catch (error) {
            console.error(error.stack || error.message);
            exitAutomatedTest(13);
          }
        }, 900);
      });
      setTimeout(() => exitAutomatedTest(13), 60000);
    }
  });
}

app.on('before-quit', () => {
  isQuitting = true;
  store?.flushScheduledSave?.();
  if (safeMode) leaveSafeMode({ notify: false });
  startupRecovery?.markClean();
  motionController?.stop();
  closeCompanionWindows();
  watchedFolderManager?.stop();
  reminderScheduler?.stop();
  clearInterval(clipboardTimer);
  fullscreenWatcher?.stop();
  globalShortcut.unregisterAll();
});
app.on('window-all-closed', (event) => event.preventDefault());
app.on('activate', () => {
  if (!petWindow) createPetWindow();
  petWindow?.showInactive();
});
