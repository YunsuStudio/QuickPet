'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { validateMigrationData, validateMigrationTree, MigrationManager } = require('../src/main/migration-manager');
const { BackupManager } = require('../src/main/backup-manager');
const { Store, freshData } = require('../src/main/store');

test('迁移包必须同时包含清单和有效数据', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'quick-pet-migration-'));
  fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify({ format: 'quick-pet-migration' }));
  assert.throws(() => validateMigrationData(directory), /不完整/);
  fs.writeFileSync(path.join(directory, 'quick-pet-data.json'), JSON.stringify({ shortcuts: [], settings: {} }));
  assert.equal(validateMigrationData(directory).manifest.format, 'quick-pet-migration');
  fs.rmSync(directory, { recursive: true, force: true });
});

test('完整迁移包会导出并恢复快捷方式与模型文件', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'quick-pet-migration-roundtrip-'));
  try {
    const dataFile = path.join(directory, 'data.json');
    const modelDirectory = path.join(directory, 'models');
    const assetDirectory = path.join(directory, 'assets');
    const destination = path.join(directory, 'export.quickpet');
    fs.mkdirSync(modelDirectory);
    fs.mkdirSync(assetDirectory);
    fs.writeFileSync(path.join(modelDirectory, 'sample.glb'), 'model');
    fs.writeFileSync(path.join(assetDirectory, 'skin.png'), 'image');
    const store = new Store(dataFile);
    store.addShortcut({ name: '示例', target: 'https://example.com' });
    const backups = new BackupManager({ dataFile, directory: path.join(directory, 'backups') });
    const manager = new MigrationManager({ dataFile, modelDirectory, assetDirectory, store, backupManager: backups, appVersion: '1.0.0' });
    await manager.exportTo(destination);
    assert.equal(fs.existsSync(destination), true);
    store.replaceData(freshData());
    fs.rmSync(path.join(modelDirectory, 'sample.glb'));
    fs.rmSync(path.join(assetDirectory, 'skin.png'));
    await manager.importFrom(destination);
    assert.equal(store.data.shortcuts[0].name, '示例');
    assert.equal(fs.readFileSync(path.join(modelDirectory, 'sample.glb'), 'utf8'), 'model');
    assert.equal(fs.readFileSync(path.join(assetDirectory, 'skin.png'), 'utf8'), 'image');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('迁移包限制文件数量和展开后体积', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'quick-pet-migration-limit-'));
  try {
    fs.writeFileSync(path.join(directory, 'one.bin'), Buffer.alloc(6));
    fs.writeFileSync(path.join(directory, 'two.bin'), Buffer.alloc(6));
    assert.throws(() => validateMigrationTree(directory, { maxEntries: 1, maxBytes: 100 }), /文件数量/);
    assert.throws(() => validateMigrationTree(directory, { maxEntries: 5, maxBytes: 10 }), /展开后/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
