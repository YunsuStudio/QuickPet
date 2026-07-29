'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { matchesDisplay, WATCH_SCRIPT } = require('../src/main/fullscreen-detector');

test('前台窗口覆盖整块显示器时识别为全屏', () => {
  const display = { bounds: { x: 1920, y: 0, width: 1920, height: 1080 } };
  assert.equal(matchesDisplay({ left: 1920, top: 0, right: 3840, bottom: 1080, pid: 123 }, display, 456), true);
  assert.equal(matchesDisplay({ left: 1930, top: 10, right: 3830, bottom: 1070, pid: 123 }, display, 456), false);
  assert.equal(matchesDisplay({ left: 1920, top: 0, right: 3840, bottom: 1080, pid: 456 }, display, 456), false);
});

test('persistent watcher samples the foreground window inside its loop', () => {
  const loop = WATCH_SCRIPT.slice(WATCH_SCRIPT.indexOf('while ($true)'));
  assert.match(loop, /GetForegroundWindow/);
  assert.match(loop, /GetWindowRect/);
  assert.match(loop, /ConvertTo-Json -Compress/);
  assert.match(loop, /Start-Sleep -Milliseconds 2200/);
});
