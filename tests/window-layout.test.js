'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('面板在当前屏幕工作区正中央且完整留在屏幕内', () => {
  const { centeredBounds } = require('../src/main/window-layout');
  assert.deepEqual(centeredBounds({ x: 1920, y: 0, width: 1920, height: 1040 }, 1040, 720), {
    x: 2360,
    y: 160,
    width: 1040,
    height: 720
  });
  assert.deepEqual(centeredBounds({ x: 0, y: 0, width: 800, height: 560 }, 1040, 720), {
    x: 15,
    y: 15,
    width: 770,
    height: 530
  });
});

test('侧栏滚动区会占用剩余高度，底部入口不会被挤出窗口', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'styles.css'), 'utf8');
  assert.match(css, /\.sidebar\s*\{[^}]*min-height:\s*0/s);
  assert.match(css, /\.sidebar-scroll\s*\{[^}]*flex:\s*1(?:\s+1\s+auto)?/s);
  assert.match(css, /\.sidebar-bottom\s*\{[^}]*flex-shrink:\s*0/s);
});
