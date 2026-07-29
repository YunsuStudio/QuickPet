'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { StartupRecovery } = require('../src/main/startup-recovery');

test('未清理的启动标记会触发崩溃恢复，正常退出后消失', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'quick-pet-recovery-'));
  const marker = path.join(directory, 'run.json');
  const recovery = new StartupRecovery(marker);
  assert.equal(recovery.previousRunCrashed(), false);
  recovery.begin('1.2.3');
  assert.equal(new StartupRecovery(marker).previousRunCrashed(), true);
  recovery.saveRestore({ petRenderMode: '3d' });
  assert.deepEqual(recovery.readRestore(), { petRenderMode: '3d' });
  recovery.markClean();
  assert.equal(recovery.previousRunCrashed(), false);
  recovery.clearRestore();
  assert.equal(recovery.readRestore(), null);
  fs.rmSync(directory, { recursive: true, force: true });
});
