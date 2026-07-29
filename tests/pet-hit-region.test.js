'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isPetPointInteractive, shouldActivatePetDrag } = require('../src/shared/pet-hit-region');

test('3D 桌宠只拦截模型附近，透明角落允许点击穿透', () => {
  const viewport = { width: 420, height: 290, renderMode: '3d' };
  assert.equal(isPetPointInteractive({ x: 210, y: 160, ...viewport }), true);
  assert.equal(isPetPointInteractive({ x: 410, y: 280, ...viewport }), false);
  assert.equal(isPetPointInteractive({ x: 8, y: 8, ...viewport }), false);
});

test('2D 桌宠同样不会吞掉矩形窗口的透明角落', () => {
  const viewport = { width: 190, height: 230, renderMode: '2d' };
  assert.equal(isPetPointInteractive({ x: 95, y: 145, ...viewport }), true);
  assert.equal(isPetPointInteractive({ x: 180, y: 220, ...viewport }), false);
});

test('短按保持点击，移动超过阈值才切换为桌宠拖动', () => {
  const start = { startX: 100, startY: 100 };
  assert.equal(shouldActivatePetDrag({ ...start, currentX: 103, currentY: 103 }), false);
  assert.equal(shouldActivatePetDrag({ ...start, currentX: 106, currentY: 100 }), true);
});
