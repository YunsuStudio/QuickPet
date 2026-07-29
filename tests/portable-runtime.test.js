'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loginLaunchTarget, programRemovalTarget } = require('../src/main/portable-runtime');

test('便携版开机启动始终指向外层启动器', () => {
  const env = {
    QUICKPET_PORTABLE: '1',
    PORTABLE_EXECUTABLE_FILE: 'D:\\Apps\\QuickPet-Portable.exe'
  };
  assert.equal(loginLaunchTarget(env, 'D:\\Apps\\QuickPet-Portable-Cache\\0.11.8\\快捷宠.exe'), env.PORTABLE_EXECUTABLE_FILE);
});

test('便携版只允许移除缓存根目录中的当前运行目录', () => {
  const cacheRoot = path.resolve('D:\\Apps\\QuickPet-Portable-Cache');
  const current = path.join(cacheRoot, '0.11.8-build');
  const env = { QUICKPET_PORTABLE: '1', QUICKPET_PORTABLE_CACHE_ROOT: cacheRoot };
  assert.equal(programRemovalTarget({ env, execPath: path.join(current, '快捷宠.exe') }), current);
  assert.equal(programRemovalTarget({ env, execPath: 'D:\\Apps\\QuickPet-Portable.exe' }), '');
});
