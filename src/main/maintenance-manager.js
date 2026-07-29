'use strict';

const fs = require('node:fs');
const path = require('node:path');

async function directorySize(directory) {
  if (!directory || !fs.existsSync(directory)) return 0;
  let total = 0;
  const pending = [directory];
  while (pending.length) {
    const current = pending.pop();
    let entries = [];
    try { entries = await fs.promises.readdir(current, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(target);
      else {
        try { total += (await fs.promises.stat(target)).size; } catch {}
      }
    }
  }
  return total;
}

function isPathInside(parent, target) {
  const root = path.resolve(parent);
  const resolved = path.resolve(target);
  return resolved === root || resolved.startsWith(`${root}${path.sep}`);
}

function cacheLockIsHeld(directory) {
  const marker = path.join(directory, '.running');
  if (!fs.existsSync(marker)) return false;
  let descriptor;
  try {
    descriptor = fs.openSync(marker, 'r+');
    return false;
  } catch (error) {
    return ['EACCES', 'EBUSY', 'EPERM'].includes(error?.code);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function cacheDirectoryIsInUse(directory) {
  if (cacheLockIsHeld(directory)) return true;
  let executables = [];
  try {
    executables = fs.readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.exe$/i.test(entry.name))
      .map((entry) => path.join(directory, entry.name));
  } catch {
    return true;
  }
  for (const executable of executables) {
    let descriptor;
    try {
      descriptor = fs.openSync(executable, 'r+');
    } catch (error) {
      if (['EACCES', 'EBUSY', 'EPERM'].includes(error?.code)) return true;
    } finally {
      if (descriptor !== undefined) fs.closeSync(descriptor);
    }
  }
  return false;
}

function cacheDirectoryState(directory) {
  const marker = path.join(directory, '.running');
  if (fs.existsSync(marker)) {
    try { fs.accessSync(marker, fs.constants.W_OK); } catch { return 'permission'; }
    if (cacheLockIsHeld(directory)) return 'running';
  }
  let executables = [];
  try {
    executables = fs.readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.exe$/i.test(entry.name))
      .map((entry) => path.join(directory, entry.name));
  } catch {
    return 'permission';
  }
  for (const executable of executables) {
    let descriptor;
    try {
      descriptor = fs.openSync(executable, 'r+');
    } catch (error) {
      if (!['EACCES', 'EBUSY', 'EPERM'].includes(error?.code)) continue;
      try { fs.accessSync(executable, fs.constants.W_OK); } catch { return 'permission'; }
      return 'running';
    } finally {
      if (descriptor !== undefined) fs.closeSync(descriptor);
    }
  }
  return 'free';
}

class MaintenanceManager {
  constructor({ userData, modelDirectory, backupDirectory, portableCacheRoot, portableCacheRoots, currentCacheDirectory, sessionProvider, isCacheInUse, cacheState, removeEntry }) {
    this.userData = userData;
    this.modelDirectory = modelDirectory;
    this.backupDirectory = backupDirectory;
    this.portableCacheRoots = [...new Set((portableCacheRoots || [portableCacheRoot])
      .filter(Boolean)
      .map((root) => path.resolve(root)))];
    this.portableCacheRoot = this.portableCacheRoots[0] || '';
    this.currentCacheDirectory = currentCacheDirectory || '';
    this.sessionProvider = sessionProvider;
    this.isCacheInUse = isCacheInUse || cacheDirectoryIsInUse;
    this.cacheState = cacheState || (isCacheInUse ? (directory) => isCacheInUse(directory) ? 'running' : 'free' : cacheDirectoryState);
    this.removeEntry = removeEntry || fs.promises.rm;
  }

  async portableCacheEntries() {
    const current = this.currentCacheDirectory ? path.resolve(this.currentCacheDirectory) : '';
    const groups = await Promise.all(this.portableCacheRoots.map(async (root) => {
      if (!fs.existsSync(root)) return [];
      const entries = await fs.promises.readdir(root, { withFileTypes: true });
      return Promise.all(entries.map(async (entry) => {
        const target = path.join(root, entry.name);
        if (!isPathInside(root, target)) return null;
        try {
          const bytes = entry.isDirectory() ? await directorySize(target) : (await fs.promises.stat(target)).size;
          return {
            name: entry.name,
            path: target,
            root,
            bytes,
            directory: entry.isDirectory(),
            current: Boolean(current) && path.resolve(target) === current
          };
        } catch {
          return null;
        }
      }));
    }));
    return groups.flat().filter(Boolean);
  }

  async report() {
    const [portableEntries, totalUserData, modelBytes, backupBytes] = await Promise.all([
      this.portableCacheEntries(),
      directorySize(this.userData),
      directorySize(this.modelDirectory),
      directorySize(this.backupDirectory)
    ]);
    const staleEntries = portableEntries.filter((entry) => !entry.current);
    return {
      userDataBytes: Math.max(0, totalUserData - modelBytes - backupBytes),
      modelBytes,
      backupBytes,
      portableCacheBytes: portableEntries.reduce((total, entry) => total + entry.bytes, 0),
      currentPortableCacheBytes: portableEntries.filter((entry) => entry.current).reduce((total, entry) => total + entry.bytes, 0),
      stalePortableCacheBytes: staleEntries.reduce((total, entry) => total + entry.bytes, 0),
      stalePortableCacheCount: staleEntries.length,
      portableCacheLocation: this.portableCacheRoot,
      portable: process.env.QUICKPET_PORTABLE === '1'
    };
  }

  async clearOldPortableCaches() {
    const staleEntries = (await this.portableCacheEntries()).filter((entry) => !entry.current);
    let releasedBytes = 0;
    let removedCount = 0;
    let skippedCount = 0;
    const failures = [];

    for (const entry of staleEntries) {
      if (entry.directory) {
        const state = this.cacheState(entry.path);
        if (state === 'running') {
          skippedCount += 1;
          continue;
        }
        if (state === 'permission') {
          failures.push({ name: entry.name, path: entry.path, code: 'permission', message: '没有权限访问这份旧缓存' });
          continue;
        }
      }
      try {
        await this.removeEntry(entry.path, {
          recursive: entry.directory,
          force: true,
          maxRetries: 20,
          retryDelay: 200
        });
        releasedBytes += entry.bytes;
        removedCount += 1;
      } catch (error) {
        failures.push({ name: entry.name, path: entry.path, code: ['EACCES', 'EPERM'].includes(error.code) ? 'permission' : error.code || 'remove-failed', message: error.message });
      }
    }

    return { releasedBytes, removedCount, skippedCount, failures, report: await this.report() };
  }

  async clearCache() {
    const electronSession = this.sessionProvider?.();
    if (electronSession) {
      await electronSession.clearCache();
      await electronSession.clearCodeCaches?.({});
    }
    const result = await this.clearOldPortableCaches();
    return result.report;
  }
}

module.exports = { MaintenanceManager, directorySize, isPathInside, cacheLockIsHeld, cacheDirectoryIsInUse, cacheDirectoryState };
