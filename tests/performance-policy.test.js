'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { targetFps, pixelRatioLimit, movementInterval } = require('../src/shared/performance-policy');

test('无感模式会让待机和睡眠显著降帧', () => {
  assert.equal(targetFps('efficient', 'idle'), 30);
  assert.equal(targetFps('efficient', 'sleep'), 15);
  assert.equal(targetFps('efficient', 'walk'), 45);
  assert.equal(targetFps('efficient', 'idle', true), 60);
});

test('无感模式限制透明 3D 窗口的像素比', () => {
  assert.equal(pixelRatioLimit('efficient'), 1.15);
  assert.ok(pixelRatioLimit('quality') > pixelRatioLimit('balanced'));
});

test('桌宠窗口移动频率跟随性能模式', () => {
  assert.equal(movementInterval('efficient'), 22);
  assert.equal(movementInterval('balanced'), 17);
  assert.equal(movementInterval('quality'), 17);
});

test('额外伙伴共享总渲染预算', () => {
  assert.equal(targetFps('efficient', 'idle', false, true), 15);
  assert.equal(targetFps('efficient', 'walk', false, true), 24);
  assert.equal(targetFps('quality', 'walk', false, true), 45);
});
