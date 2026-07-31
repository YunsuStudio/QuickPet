async (page) => {
  await page.addInitScript(() => {
    const categories = [
      { id: 'work', name: '工作', icon: 'W', color: '#333333', parentId: '', sortOrder: 0 },
      { id: 'other', name: '其他', icon: 'O', color: '#777777', parentId: '', sortOrder: 1 }
    ];
    const state = {
      appVersion: '0.11.10',
      categories,
      shortcuts: [],
      models: [],
      rules: [],
      reminders: [],
      watchedFolders: [],
      notifications: [],
      companions: [],
      commands: [],
      hotkeyRegistrations: {},
      runtime: {
        globalShortcutRegistrations: { search: true, launcher: true },
        update: { status: 'idle', currentVersion: '0.11.21' }
      },
      petStatus: { name: 'Nuan Nuan', mood: 82, hunger: 76, affection: 20 },
      settings: {
        theme: 'system',
        accent: '#171717',
        panelOpacity: 0.98,
        panelWidth: 1040,
        panelHeight: 720,
        performanceMode: 'efficient',
        petScale: 1,
        petRenderMode: '2d',
        petModelPreset: 'fox',
        activeModelId: '',
        petImageData: '',
        petImageName: '',
        petBackgroundRemoved: false,
        autoRemoveBackground: true,
        naturalBehavior: true,
        autoWalk: true,
        nightSleep: true,
        petWalkSpeed: 46,
        petScreenMode: 'current',
        petAlwaysOnTop: true,
        hideOnFullscreen: true,
        edgeSnap: true,
        activityPadding: 10,
        globalSearchShortcut: 'Alt+Space',
        quickLaunchShortcut: 'CommandOrControl+Alt+Space',
        clipboardMonitor: true,
        launchAtLogin: false,
        autoCheckUpdates: true,
        portableCacheCleanupPrompt: true,
        sortBy: 'recent'
      }
    };
    const listeners = [];
    const cacheProgressListeners = [];
    const api = {
      getState: async () => state,
      listBackups: async () => [],
      getStorageReport: async () => ({
        userDataBytes: 1024,
        modelBytes: 2048,
        backupBytes: 512,
        currentPortableCacheBytes: 300 * 1024 * 1024,
        runtimeCacheBytes: 4 * 1024 * 1024,
        stalePortableCacheBytes: 20 * 1024 * 1024,
        stalePortableCacheCount: 1,
        cleanableCacheBytes: 24 * 1024 * 1024,
        portable: true
      }),
      clearRuntimeCache: async () => {
        const send = async (progress) => {
          cacheProgressListeners.forEach((callback) => callback(progress));
          await new Promise((resolve) => setTimeout(resolve, 80));
        };
        await send({ stage: 'scan', releasedBytes: 0 });
        await send({ stage: 'portable-start', total: 1, totalBytes: 20 * 1024 * 1024, releasedBytes: 0 });
        await send({ stage: 'portable-item-start', index: 1, total: 1, name: '0.11.13', bytes: 20 * 1024 * 1024, releasedBytes: 0 });
        await send({ stage: 'portable-item-done', index: 1, total: 1, name: '0.11.13', bytes: 20 * 1024 * 1024, releasedBytes: 20 * 1024 * 1024 });
        await send({ stage: 'portable-complete', total: 1, removedCount: 1, skippedCount: 0, failedCount: 0, releasedBytes: 20 * 1024 * 1024 });
        await send({ stage: 'runtime-start', releasedBytes: 20 * 1024 * 1024 });
        await send({ stage: 'runtime-complete', runtimeReleasedBytes: 4 * 1024 * 1024, releasedBytes: 24 * 1024 * 1024 });
        await send({ stage: 'complete', releasedBytes: 24 * 1024 * 1024, removedCount: 1, skippedCount: 0, failedCount: 0 });
        return {
          releasedBytes: 24 * 1024 * 1024,
          runtimeReleasedBytes: 4 * 1024 * 1024,
          portableReleasedBytes: 20 * 1024 * 1024,
          skippedCount: 0,
          failures: [],
          report: {
          userDataBytes: 1024,
          modelBytes: 2048,
          backupBytes: 512,
          currentPortableCacheBytes: 300 * 1024 * 1024,
          runtimeCacheBytes: 0,
          stalePortableCacheBytes: 0,
          stalePortableCacheCount: 0,
          cleanableCacheBytes: 0,
          portable: true
          }
        };
      },
      onCacheCleanupProgress: (callback) => { cacheProgressListeners.push(callback); return () => {}; },
      onStateChanged: (callback) => { listeners.push(callback); return () => {}; },
      onNavigateSettings: () => () => {},
      onNavigateAutomation: () => () => {},
      rendererReady: () => {},
      updateSettings: async (changes) => {
        Object.assign(state.settings, changes);
        listeners.forEach((callback) => callback(state));
        return state.settings;
      },
      addShortcut: async (input) => input,
      addRule: async (input) => input,
      addReminder: async (input) => input,
      addCategory: async (input) => input,
      addCompanion: async (input) => input
    };
    window.quickPet = new Proxy(api, {
      get: (target, key) => key in target ? target[key] : (() => Promise.resolve(null))
    });
  });
  await page.reload();
  await page.waitForTimeout(700);
}
