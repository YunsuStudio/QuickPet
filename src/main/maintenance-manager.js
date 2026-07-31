'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createRemoveOperation: createProcessRemoveOperation } = require('./removal-operation');

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

function emitProgress(callback, progress) {
  if (typeof callback !== 'function') return;
  try { callback(progress); } catch {}
}

class MaintenanceManager {
  constructor({ userData, modelDirectory, backupDirectory, portableCacheRoot, portableCacheRoots, currentCacheDirectory, sessionProvider, isCacheInUse, cacheState, removeEntry, createRemoveOperation, cacheOperationTimeout, removeOperationTimeout }) {
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
    this.createRemoveOperation = createRemoveOperation || (removeEntry
      ? (target, options) => ({
          promise: Promise.resolve().then(() => removeEntry(target, options)),
          cancel: async () => {}
        })
      : createProcessRemoveOperation);
    this.cacheOperationTimeout = Math.max(10, Number(cacheOperationTimeout) || 4000);
    this.removeOperationTimeout = Math.max(10, Number(removeOperationTimeout) || 5000);
  }

  async runCacheOperation(operation, fallback) {
    let timer;
    try {
      return await Promise.race([
        Promise.resolve().then(operation).then((value) => ({ value, timedOut: false })),
        new Promise((resolve) => {
          timer = setTimeout(() => resolve({ value: fallback, timedOut: true }), this.cacheOperationTimeout);
        })
      ]);
    } catch {
      return { value: fallback, timedOut: false };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async runRemoveOperation(target, options) {
    const operation = this.createRemoveOperation(target, options);
    const removalPromise = Promise.resolve(operation?.promise ?? operation)
      .then(() => ({ timedOut: false }));
    let timer;
    try {
      const result = await Promise.race([
        removalPromise,
        new Promise((resolve) => {
          timer = setTimeout(() => resolve({ timedOut: true }), this.removeOperationTimeout);
        })
      ]);
      if (result.timedOut && typeof operation?.cancel === 'function') {
        await operation.cancel();
      }
      return result;
    } finally {
      if (timer) clearTimeout(timer);
    }
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
    const electronSession = this.sessionProvider?.();
    const runtimeCache = electronSession?.getCacheSize
      ? this.runCacheOperation(() => electronSession.getCacheSize(), 0)
      : Promise.resolve({ value: 0 });
    const [portableEntries, totalUserData, modelBytes, backupBytes, runtimeCacheBytes] = await Promise.all([
      this.portableCacheEntries(),
      directorySize(this.userData),
      directorySize(this.modelDirectory),
      directorySize(this.backupDirectory),
      runtimeCache.then((result) => result.value)
    ]);
    const staleEntries = portableEntries.filter((entry) => !entry.current);
    const stalePortableCacheBytes = staleEntries.reduce((total, entry) => total + entry.bytes, 0);
    return {
      userDataBytes: Math.max(0, totalUserData - modelBytes - backupBytes),
      modelBytes,
      backupBytes,
      portableCacheBytes: portableEntries.reduce((total, entry) => total + entry.bytes, 0),
      currentPortableCacheBytes: portableEntries.filter((entry) => entry.current).reduce((total, entry) => total + entry.bytes, 0),
      stalePortableCacheBytes,
      stalePortableCacheCount: staleEntries.length,
      runtimeCacheBytes,
      cleanableCacheBytes: stalePortableCacheBytes + runtimeCacheBytes,
      portableCacheLocation: this.portableCacheRoot,
      portable: process.env.QUICKPET_PORTABLE === '1'
    };
  }

  async clearOldPortableCaches(onProgress) {
    emitProgress(onProgress, { stage: 'scan' });
    const staleEntries = (await this.portableCacheEntries()).filter((entry) => !entry.current);
    let releasedBytes = 0;
    let removedCount = 0;
    let skippedCount = 0;
    const failures = [];

    emitProgress(onProgress, {
      stage: 'portable-start',
      total: staleEntries.length,
      totalBytes: staleEntries.reduce((total, entry) => total + entry.bytes, 0)
    });

    for (const [offset, entry] of staleEntries.entries()) {
      const item = {
        index: offset + 1,
        total: staleEntries.length,
        name: entry.name,
        bytes: entry.bytes,
        releasedBytes
      };
      emitProgress(onProgress, { stage: 'portable-item-start', ...item });
      if (entry.directory) {
        const state = this.cacheState(entry.path);
        if (state === 'running') {
          skippedCount += 1;
          emitProgress(onProgress, {
            stage: 'portable-item-skipped',
            ...item,
            releasedBytes,
            reason: 'running'
          });
          continue;
        }
        if (state === 'permission') {
          const failure = { name: entry.name, path: entry.path, code: 'permission', message: '没有权限访问这份旧缓存' };
          failures.push(failure);
          emitProgress(onProgress, {
            stage: 'portable-item-failed',
            ...item,
            releasedBytes,
            code: failure.code,
            message: failure.message
          });
          continue;
        }
      }
      try {
        const removal = await this.runRemoveOperation(entry.path, {
          recursive: entry.directory,
          force: true,
          maxRetries: 3,
          retryDelay: 150
        });
        if (removal.timedOut) {
          const failure = { name: entry.name, path: entry.path, code: 'timeout', message: '删除超时，文件可能正被 Windows 或安全软件占用' };
          failures.push(failure);
          emitProgress(onProgress, {
            stage: 'portable-item-failed',
            ...item,
            releasedBytes,
            code: failure.code,
            message: failure.message
          });
          continue;
        }
        releasedBytes += entry.bytes;
        removedCount += 1;
        emitProgress(onProgress, {
          stage: 'portable-item-done',
          ...item,
          releasedBytes
        });
      } catch (error) {
        const failure = { name: entry.name, path: entry.path, code: ['EACCES', 'EPERM'].includes(error.code) ? 'permission' : error.code || 'remove-failed', message: error.message };
        failures.push(failure);
        emitProgress(onProgress, {
          stage: 'portable-item-failed',
          ...item,
          releasedBytes,
          code: failure.code,
          message: failure.message
        });
      }
    }

    emitProgress(onProgress, {
      stage: 'portable-complete',
      total: staleEntries.length,
      releasedBytes,
      removedCount,
      skippedCount,
      failedCount: failures.length
    });
    return { releasedBytes, removedCount, skippedCount, failures, report: await this.report() };
  }

  async clearCache(onProgress) {
    const portableResult = await this.clearOldPortableCaches(onProgress);
    emitProgress(onProgress, {
      stage: 'runtime-start',
      releasedBytes: portableResult.releasedBytes
    });
    const electronSession = this.sessionProvider?.();
    const beforeResult = electronSession?.getCacheSize
      ? await this.runCacheOperation(() => electronSession.getCacheSize(), 0)
      : { value: 0, timedOut: false };
    const runtimeCacheBefore = beforeResult.value;
    let runtimeCacheTimedOut = false;
    if (electronSession) {
      const clearResult = await this.runCacheOperation(() => Promise.allSettled([
          electronSession.clearCache(),
          electronSession.clearCodeCaches?.({})
        ]), null);
      runtimeCacheTimedOut = clearResult.timedOut;
    }
    const afterResult = !runtimeCacheTimedOut && electronSession?.getCacheSize
      ? await this.runCacheOperation(() => electronSession.getCacheSize(), runtimeCacheBefore)
      : { value: runtimeCacheBefore, timedOut: runtimeCacheTimedOut };
    runtimeCacheTimedOut = beforeResult.timedOut || runtimeCacheTimedOut || afterResult.timedOut;
    const runtimeCacheAfter = afterResult.value;
    const runtimeReleasedBytes = Math.max(0, runtimeCacheBefore - runtimeCacheAfter);
    const portableReleasedBytes = portableResult.releasedBytes;
    emitProgress(onProgress, {
      stage: runtimeCacheTimedOut ? 'runtime-timeout' : 'runtime-complete',
      runtimeReleasedBytes,
      releasedBytes: runtimeReleasedBytes + portableReleasedBytes
    });
    const result = {
      ...portableResult,
      runtimeReleasedBytes,
      runtimeCacheTimedOut,
      portableReleasedBytes,
      releasedBytes: runtimeReleasedBytes + portableReleasedBytes,
      report: await this.report()
    };
    emitProgress(onProgress, {
      stage: 'complete',
      releasedBytes: result.releasedBytes,
      removedCount: result.removedCount,
      skippedCount: result.skippedCount,
      failedCount: result.failures.length,
      runtimeCacheTimedOut
    });
    return result;
  }
}

module.exports = { MaintenanceManager, directorySize, isPathInside, cacheLockIsHeld, cacheDirectoryIsInUse, cacheDirectoryState };
