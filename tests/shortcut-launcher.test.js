'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createLaunchPlan, launchTarget } = require('../src/main/shortcut-launcher');

test('特殊协议交给系统协议处理器', () => {
  assert.deepEqual(createLaunchPlan('steam://rungameid/730'), { kind: 'external', target: 'steam://rungameid/730' });
  assert.deepEqual(createLaunchPlan('shell:AppsFolder\\Demo.App!App'), { kind: 'external', target: 'shell:AppsFolder\\Demo.App!App' });
  assert.throws(() => createLaunchPlan('javascript:alert(1)'), /不支持/);
});

test('环境变量、快捷方式和带参数程序会正确解析', () => {
  const environment = { ProgramFiles: 'C:\\Program Files' };
  assert.deepEqual(createLaunchPlan('%ProgramFiles%\\Demo\\Demo.exe', { environment, exists: () => true }), {
    kind: 'path', target: 'C:\\Program Files\\Demo\\Demo.exe'
  });
  assert.deepEqual(createLaunchPlan('C:\\Links\\Game.lnk', { exists: () => true }), { kind: 'path', target: 'C:\\Links\\Game.lnk' });
  assert.deepEqual(createLaunchPlan('"C:\\Program Files\\Demo\\Demo.exe" --profile "Work User"', { exists: () => false }), {
    kind: 'command', executable: 'C:\\Program Files\\Demo\\Demo.exe', arguments: ['--profile', 'Work User'], cwd: 'C:\\Program Files\\Demo'
  });
});

test('启动计划调用对应系统能力且命令进程会脱离主程序', async () => {
  const calls = [];
  const child = { unref: () => calls.push(['unref']) };
  await launchTarget('steam://rungameid/730', {
    openExternal: async (target) => calls.push(['external', target]),
    openPath: async (target) => { calls.push(['path', target]); return ''; },
    spawnProcess: (...args) => { calls.push(['spawn', ...args]); return child; },
    exists: () => false
  });
  await launchTarget('"C:\\Demo\\Demo.exe" --fast', {
    openExternal: async () => {}, openPath: async () => '', exists: () => false,
    spawnProcess: (...args) => { calls.push(['spawn', ...args]); return child; }
  });
  assert.deepEqual(calls[0], ['external', 'steam://rungameid/730']);
  assert.equal(calls.some((entry) => entry[0] === 'spawn' && entry[1] === 'C:\\Demo\\Demo.exe'), true);
  assert.equal(calls.filter((entry) => entry[0] === 'unref').length, 1);
});
