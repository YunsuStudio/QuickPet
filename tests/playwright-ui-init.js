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
      shortcutHotkeyStatuses: [],
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
        clipboardMonitor: true,
        launchAtLogin: false,
        autoCheckUpdates: true,
        portableCacheCleanupPrompt: true,
        updateFeedUrl: '',
        sortBy: 'recent'
      }
    };
    const listeners = [];
    const api = {
      getState: async () => state,
      listBackups: async () => [],
      getStorageReport: async () => ({ totalBytes: 0, items: [] }),
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
