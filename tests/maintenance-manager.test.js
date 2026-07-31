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
    assert.equal(calls.every((call) => call.options.maxRetries <= 3 && call.options.retryDelay >= 100), true);
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

test('一键清理会清除 Electron 缓存和旧版运行目录但保留当前版本', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quick-pet-cache-all-'));
  const current = path.join(root, 'current');
  const stale = path.join(root, 'stale');
  fs.mkdirSync(current);
  fs.mkdirSync(stale);
  fs.writeFileSync(path.join(current, 'app.bin'), Buffer.alloc(12));
  fs.writeFileSync(path.join(stale, 'old.bin'), Buffer.alloc(20));
  let runtimeBytes = 30;
  let cacheCleared = 0;
  let codeCacheCleared = 0;
  const session = {
    getCacheSize: async () => runtimeBytes,
    clearCache: async () => { cacheCleared += 1; runtimeBytes = 0; },
    clearCodeCaches: async () => { codeCacheCleared += 1; }
  };
  try {
    const manager = new MaintenanceManager({
      portableCacheRoot: root,
      currentCacheDirectory: current,
      sessionProvider: () => session
    });
    const before = await manager.report();
    assert.equal(before.runtimeCacheBytes, 30);
    assert.equal(before.cleanableCacheBytes, 50);

    const result = await manager.clearCache();

    assert.equal(cacheCleared, 1);
    assert.equal(codeCacheCleared, 1);
    assert.equal(fs.existsSync(current), true);
    assert.equal(fs.existsSync(stale), false);
    assert.equal(result.runtimeReleasedBytes, 30);
    assert.equal(result.portableReleasedBytes, 20);
    assert.equal(result.releasedBytes, 50);
    assert.equal(result.report.cleanableCacheBytes, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Electron 缓存接口卡住时仍会先删除旧版运行目录并及时返回', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quick-pet-cache-timeout-'));
  const current = path.join(root, 'current');
  const stale = path.join(root, 'stale');
  fs.mkdirSync(current);
  fs.mkdirSync(stale);
  fs.writeFileSync(path.join(current, 'app.bin'), Buffer.alloc(12));
  fs.writeFileSync(path.join(stale, 'old.bin'), Buffer.alloc(20));
  const never = new Promise(() => {});
  const session = {
    getCacheSize: async () => 30,
    clearCache: () => never,
    clearCodeCaches: () => never
  };
  try {
    const manager = new MaintenanceManager({
      portableCacheRoot: root,
      currentCacheDirectory: current,
      sessionProvider: () => session,
      cacheOperationTimeout: 20
    });
    const started = Date.now();
    const result = await manager.clearCache();

    assert.equal(fs.existsSync(current), true);
    assert.equal(fs.existsSync(stale), false);
    assert.equal(result.portableReleasedBytes, 20);
    assert.equal(result.runtimeCacheTimedOut, true);
    assert.ok(Date.now() - started < 500);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('缓存大小查询卡住时存储报告仍会及时返回', async () => {
  const never = new Promise(() => {});
  const manager = new MaintenanceManager({
    sessionProvider: () => ({ getCacheSize: () => never }),
    cacheOperationTimeout: 20
  });
  const started = Date.now();
  const report = await manager.report();

  assert.equal(report.runtimeCacheBytes, 0);
  assert.ok(Date.now() - started < 500);
});

test('单份旧缓存删除卡住时会超时并继续清理其他目录', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quick-pet-remove-timeout-'));
  const current = path.join(root, 'current');
  const blocked = path.join(root, 'blocked');
  const removable = path.join(root, 'removable');
  for (const directory of [current, blocked, removable]) {
    fs.mkdirSync(directory);
    fs.writeFileSync(path.join(directory, 'payload.bin'), Buffer.alloc(10));
  }
  const never = new Promise(() => {});
  try {
    const manager = new MaintenanceManager({
      portableCacheRoot: root,
      currentCacheDirectory: current,
      removeOperationTimeout: 20,
      removeEntry: (target, options) => target === blocked ? never : fs.promises.rm(target, options)
    });
    const started = Date.now();
    const result = await manager.clearOldPortableCaches();

    assert.equal(fs.existsSync(current), true);
    assert.equal(fs.existsSync(blocked), true);
    assert.equal(fs.existsSync(removable), false);
    assert.equal(result.removedCount, 1);
    assert.equal(result.failures[0].code, 'timeout');
    assert.ok(Date.now() - started < 500);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('旧缓存删除超时后会完成取消且不会继续后台删除', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quick-pet-remove-cancel-'));
  const current = path.join(root, 'current');
  const blocked = path.join(root, 'blocked');
  for (const directory of [current, blocked]) {
    fs.mkdirSync(directory);
    fs.writeFileSync(path.join(directory, 'payload.bin'), Buffer.alloc(10));
  }
  let cancelled = false;
  let completed = false;
  let removalTimer;
  try {
    const manager = new MaintenanceManager({
      portableCacheRoot: root,
      currentCacheDirectory: current,
      removeOperationTimeout: 20,
      createRemoveOperation: (target, options) => ({
        promise: new Promise((resolve) => {
          removalTimer = setTimeout(async () => {
            completed = true;
            await fs.promises.rm(target, options);
            resolve();
          }, 100);
        }),
        cancel: async () => {
          cancelled = true;
          clearTimeout(removalTimer);
        }
      })
    });

    const result = await manager.clearOldPortableCaches();
    await new Promise((resolve) => setTimeout(resolve, 130));

    assert.equal(result.failures[0].code, 'timeout');
    assert.equal(cancelled, true);
    assert.equal(completed, false);
    assert.equal(fs.existsSync(blocked), true);
  } finally {
    clearTimeout(removalTimer);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('一键清理会按真实阶段报告进度和已释放空间', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quick-pet-cache-progress-'));
  const current = path.join(root, 'current');
  const stale = path.join(root, 'stale');
  fs.mkdirSync(current);
  fs.mkdirSync(stale);
  fs.writeFileSync(path.join(current, 'app.bin'), Buffer.alloc(12));
  fs.writeFileSync(path.join(stale, 'old.bin'), Buffer.alloc(20));
  let runtimeBytes = 30;
  const events = [];
  const session = {
    getCacheSize: async () => runtimeBytes,
    clearCache: async () => { runtimeBytes = 0; },
    clearCodeCaches: async () => {}
  };
  try {
    const manager = new MaintenanceManager({
      portableCacheRoot: root,
      currentCacheDirectory: current,
      sessionProvider: () => session
    });

    await manager.clearCache((progress) => events.push(progress));

    assert.deepEqual(events.map((event) => event.stage), [
      'scan',
      'portable-start',
      'portable-item-start',
      'portable-item-done',
      'portable-complete',
      'runtime-start',
      'runtime-complete',
      'complete'
    ]);
    assert.equal(events[2].name, 'stale');
    assert.equal(events[2].bytes, 20);
    assert.equal(events[3].releasedBytes, 20);
    assert.equal(events[6].runtimeReleasedBytes, 30);
    assert.equal(events[7].releasedBytes, 50);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('跳过、失败和 Electron 超时会报告对应清理进度', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quick-pet-cache-progress-errors-'));
  const running = path.join(root, 'running');
  const blocked = path.join(root, 'blocked');
  fs.mkdirSync(running);
  fs.mkdirSync(blocked);
  fs.writeFileSync(path.join(running, 'run.bin'), Buffer.alloc(10));
  fs.writeFileSync(path.join(blocked, 'blocked.bin'), Buffer.alloc(15));
  const never = new Promise(() => {});
  const events = [];
  try {
    const manager = new MaintenanceManager({
      portableCacheRoot: root,
      cacheState: (directory) => directory === running ? 'running' : 'permission',
      sessionProvider: () => ({
        getCacheSize: async () => 30,
        clearCache: () => never,
        clearCodeCaches: () => never
      }),
      cacheOperationTimeout: 20
    });

    await manager.clearCache((progress) => events.push(progress));

    const stages = events.map((event) => event.stage);
    assert.ok(stages.includes('portable-item-skipped'));
    assert.ok(stages.includes('portable-item-failed'));
    assert.ok(stages.includes('runtime-timeout'));
    assert.equal(stages.at(-1), 'complete');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
