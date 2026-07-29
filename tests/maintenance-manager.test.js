'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { MaintenanceManager, directorySize, isPathInside } = require('../src/main/maintenance-manager');

test('维护工具准确统计目录并限制路径边界', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quick-pet-maintenance-'));
  fs.mkdirSync(path.join(root, 'nested'));
  fs.writeFileSync(path.join(root, 'a.bin'), Buffer.alloc(12));
  fs.writeFileSync(path.join(root, 'nested', 'b.bin'), Buffer.alloc(8));
  assert.equal(await directorySize(root), 20);
  assert.equal(isPathInside(root, path.join(root, 'nested')), true);
  assert.equal(isPathInside(root, path.join(root, '..', 'outside')), false);
  fs.rmSync(root, { recursive: true, force: true });
});

test('便携缓存报告区分当前版本和可清理的旧版本', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quick-pet-portable-report-'));
  const current = path.join(root, '0.11.7-current');
  const stale = path.join(root, '0.11.6-stale');
  fs.mkdirSync(current);
  fs.mkdirSync(stale);
  fs.writeFileSync(path.join(current, 'current.bin'), Buffer.alloc(12));
  fs.writeFileSync(path.join(stale, 'stale.bin'), Buffer.alloc(20));
  try {
    const manager = new MaintenanceManager({ portableCacheRoot: root, currentCacheDirectory: current });
    const report = await manager.report();
    assert.equal(report.portableCacheBytes, 32);
    assert.equal(report.currentPortableCacheBytes, 12);
    assert.equal(report.stalePortableCacheBytes, 20);
    assert.equal(report.stalePortableCacheCount, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('清理旧版缓存时保留当前版本并跳过正在运行的版本', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quick-pet-portable-clean-'));
  const current = path.join(root, '0.11.7-current');
  const stale = path.join(root, '0.11.6-stale');
  const running = path.join(root, '0.11.5-running');
  for (const directory of [current, stale, running]) {
    fs.mkdirSync(directory);
    fs.writeFileSync(path.join(directory, 'payload.bin'), Buffer.alloc(10));
  }
  try {
    const manager = new MaintenanceManager({
      portableCacheRoot: root,
      currentCacheDirectory: current,
      isCacheInUse: (directory) => directory === running
    });
    const result = await manager.clearOldPortableCaches();
    assert.equal(fs.existsSync(current), true);
    assert.equal(fs.existsSync(stale), false);
    assert.equal(fs.existsSync(running), true);
    assert.equal(result.releasedBytes, 10);
    assert.equal(result.removedCount, 1);
    assert.equal(result.skippedCount, 1);
    assert.equal(result.report.stalePortableCacheCount, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('同时统计程序旁缓存和旧临时缓存，并使用 Windows 重试删除', async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'quick-pet-cache-roots-'));
  const adjacentRoot = path.join(parent, 'adjacent');
  const legacyRoot = path.join(parent, 'legacy');
  const current = path.join(adjacentRoot, '0.11.8-current');
  const adjacentStale = path.join(adjacentRoot, '0.11.7-stale');
  const legacyStale = path.join(legacyRoot, '0.11.6-stale');
  for (const directory of [current, adjacentStale, legacyStale]) {
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'payload.bin'), Buffer.alloc(10));
  }
  const calls = [];
  try {
    const manager = new MaintenanceManager({
      portableCacheRoots: [adjacentRoot, legacyRoot],
      currentCacheDirectory: current,
      removeEntry: (target, options) => {
        calls.push({ target, options });
        fs.rmSync(target, options);
      }
    });
    assert.equal((await manager.report()).stalePortableCacheCount, 2);
    const result = await manager.clearOldPortableCaches();
    assert.equal(result.removedCount, 2);
    assert.equal(result.releasedBytes, 20);
    assert.equal(fs.existsSync(current), true);
    assert.equal(calls.every((call) => call.options.maxRetries >= 10 && call.options.retryDelay >= 100), true);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('权限不足不会被误报为旧版仍在运行', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quick-pet-cache-permission-'));
  const stale = path.join(root, 'old');
  fs.mkdirSync(stale);
  try {
    const manager = new MaintenanceManager({ portableCacheRoot: root, cacheState: () => 'permission' });
    const result = await manager.clearOldPortableCaches();
    assert.equal(result.skippedCount, 0);
    assert.equal(result.failures[0].code, 'permission');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
