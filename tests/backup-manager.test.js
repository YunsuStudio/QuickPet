'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { BackupManager } = require('../src/main/backup-manager');

function withManager(callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'quick-pet-backup-'));
  const dataFile = path.join(directory, 'data.json');
  const manager = new BackupManager({ dataFile, directory: path.join(directory, 'backups'), retention: 3 });
  try { return callback({ manager, dataFile }); } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

function data(name = '默认') {
  return { shortcuts: [{ id: name, target: 'https://example.com' }], settings: { theme: 'system' } };
}

test('每天只生成一份自动备份并限制保留数量', () => withManager(({ manager }) => {
  const first = manager.create(data('a'), { now: new Date('2026-07-20T01:00:00Z') });
  const sameDay = manager.create(data('b'), { now: new Date('2026-07-20T08:00:00Z') });
  assert.equal(first.id, sameDay.id);
  for (let day = 21; day <= 24; day += 1) manager.create(data(String(day)), { now: new Date(`2026-07-${day}T01:00:00Z`) });
  assert.equal(manager.list().length, 3);
}));

test('主数据损坏时恢复最近有效备份', () => withManager(({ manager, dataFile }) => {
  manager.create(data('older'), { force: true, now: new Date('2026-07-20T01:00:00Z') });
  const latest = manager.create(data('latest'), { force: true, now: new Date('2026-07-21T01:00:00Z') });
  fs.writeFileSync(dataFile, '{broken', 'utf8');
  const recovered = manager.recoverIfNeeded();
  assert.equal(recovered.backupId, latest.id);
  assert.equal(JSON.parse(fs.readFileSync(dataFile, 'utf8')).shortcuts[0].id, 'latest');
}));

test('可手动恢复和删除指定备份', () => withManager(({ manager }) => {
  const backup = manager.create(data('manual'), { reason: 'manual', force: true });
  assert.equal(manager.restore(backup.id).shortcuts[0].id, 'manual');
  assert.equal(manager.remove(backup.id), true);
  assert.equal(manager.list().length, 0);
}));
