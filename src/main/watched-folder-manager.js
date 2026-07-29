'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { inferType } = require('../shared/classifier');

class WatchedFolderManager {
  constructor({ store, onChanged }) {
    this.store = store;
    this.onChanged = onChanged;
    this.watchers = new Map();
    this.timers = new Map();
  }

  start() {
    this.rebuild();
  }

  stop() {
    for (const watcher of this.watchers.values()) watcher.close();
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.watchers.clear();
    this.timers.clear();
  }

  rebuild() {
    this.stop();
    for (const folder of this.store.data.watchedFolders.filter((item) => item.enabled && fs.existsSync(item.path))) {
      this.scan(folder);
      try {
        const watcher = fs.watch(folder.path, () => this.schedule(folder));
        watcher.on('error', () => {});
        this.watchers.set(folder.id, watcher);
      } catch {}
    }
  }

  schedule(folder) {
    clearTimeout(this.timers.get(folder.id));
    this.timers.set(folder.id, setTimeout(() => this.scan(folder), 450));
  }

  scan(folder) {
    let entries = [];
    try { entries = fs.readdirSync(folder.path, { withFileTypes: true }); } catch { return; }
    let added = 0;
    for (const entry of entries.slice(0, 500)) {
      const target = path.join(folder.path, entry.name);
      try {
        this.store.addShortcut({
          name: entry.name,
          target,
          type: entry.isDirectory() ? 'folder' : inferType(target),
          category: folder.category,
          tags: [...new Set([...(folder.tags || []), '动态文件夹'])]
        }, { persist: false });
        added += 1;
      } catch {}
    }
    if (added) {
      this.store.save();
      this.onChanged?.({ folder, added });
    }
  }
}

module.exports = { WatchedFolderManager };
