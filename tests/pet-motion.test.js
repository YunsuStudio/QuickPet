'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PetMotionEngine, PetMotionController } = require('../src/main/pet-motion');

test('行走状态按速度移动并保持在屏幕范围内', () => {
  const engine = new PetMotionEngine(() => 0.5);
  engine.setBounds(0, 100, 50);
  engine.setSpeed(50);
  engine.mode = 'walk';
  engine.direction = 1;
  engine.phaseEndsAt = 10000;
  engine.lastTickAt = 1000;
  const motion = engine.tick(1120, true);
  assert.equal(Math.round(motion.x), 56);
  assert.equal(motion.mode, 'walk');
  assert.equal(motion.moved, true);
});

test('到达屏幕边缘时转身并短暂坐下', () => {
  const engine = new PetMotionEngine(() => 0.5);
  engine.setBounds(0, 100, 99);
  engine.setSpeed(100);
  engine.mode = 'walk';
  engine.direction = 1;
  engine.phaseEndsAt = 10000;
  engine.lastTickAt = 1000;
  const motion = engine.tick(1120, true);
  assert.equal(motion.x, 100);
  assert.equal(motion.direction, -1);
  assert.equal(motion.mode, 'sit');
  assert.equal(motion.action, 'edge-rest');
});

test('关闭自动散步后位置不发生变化', () => {
  const engine = new PetMotionEngine(() => 0.5);
  engine.setBounds(0, 100, 40);
  engine.mode = 'walk';
  engine.direction = 1;
  engine.lastTickAt = 1000;
  const motion = engine.tick(1500, false);
  assert.equal(motion.x, 40);
  assert.equal(motion.moved, false);
  assert.equal(motion.mode, 'idle');
});

test('停留结束后会选择方向开始行走', () => {
  const engine = new PetMotionEngine(() => 0.9);
  engine.setBounds(0, 200, 100);
  engine.mode = 'idle';
  engine.phaseEndsAt = 1000;
  engine.lastTickAt = 900;
  const motion = engine.tick(1001, true);
  assert.equal(motion.mode, 'walk');
  assert.equal(motion.direction, 1);
});

test('自然行为可以进入坐下和奔跑状态', () => {
  const sitEngine = new PetMotionEngine(() => 0.1);
  sitEngine.setBounds(0, 200, 100);
  sitEngine.mode = 'idle';
  sitEngine.phaseEndsAt = 1000;
  sitEngine.lastTickAt = 900;
  assert.equal(sitEngine.tick(1001, true, true).mode, 'sit');

  const runEngine = new PetMotionEngine(() => 0.97);
  runEngine.setBounds(0, 200, 100);
  runEngine.mode = 'idle';
  runEngine.phaseEndsAt = 1000;
  runEngine.lastTickAt = 900;
  assert.equal(runEngine.tick(1001, true, true).mode, 'run');
});

test('饥饿状态不会打断已经开始的散步', () => {
  const now = Date.now();
  const window = {
    isDestroyed: () => false,
    isVisible: () => true,
    getBounds: () => ({ x: 100, y: 500, width: 420, height: 290 }),
    setPosition: () => {},
    webContents: { send: () => {} }
  };
  const display = { workArea: { x: 0, y: 0, width: 1920, height: 1080 } };
  const controller = new PetMotionController({
    getWindow: () => window,
    getSettings: () => ({ autoWalk: true, naturalBehavior: true, nightSleep: false, petWalkSpeed: 46, petStatus: { hunger: 0 } }),
    isPanelVisible: () => false,
    screen: {
      getCursorScreenPoint: () => ({ x: 900, y: 500 }),
      getDisplayMatching: () => display,
      getAllDisplays: () => [display]
    }
  });
  controller.baseY = 500;
  controller.engine.mode = 'walk';
  controller.engine.direction = 1;
  controller.engine.phaseEndsAt = now + 5000;
  controller.engine.lastTickAt = now - 33;

  controller.tick();

  assert.equal(controller.engine.mode, 'walk');
});

test('主快捷面板可见时桌宠仍会继续散步', () => {
  const now = Date.now();
  let bounds = { x: 100, y: 500, width: 190, height: 230 };
  const window = {
    isDestroyed: () => false,
    isVisible: () => true,
    getBounds: () => ({ ...bounds }),
    setBounds: (next) => { bounds = { ...next }; },
    webContents: { send: () => {} }
  };
  const display = { workArea: { x: 0, y: 0, width: 1920, height: 1080 } };
  const controller = new PetMotionController({
    getWindow: () => window,
    getSettings: () => ({ autoWalk: true, naturalBehavior: true, nightSleep: false, petWalkSpeed: 46 }),
    isPanelVisible: () => true,
    screen: {
      getCursorScreenPoint: () => ({ x: 900, y: 500 }),
      getDisplayMatching: () => display,
      getAllDisplays: () => [display]
    }
  });
  controller.baseY = 500;
  controller.engine.mode = 'walk';
  controller.engine.direction = 1;
  controller.engine.phaseEndsAt = now + 5000;
  controller.engine.lastTickAt = now - 100;

  controller.tick();

  assert.ok(bounds.x > 100);
  assert.equal(controller.engine.mode, 'walk');
});

test('自然行为更倾向于开始移动而不是长时间停留', () => {
  const engine = new PetMotionEngine(() => 0.3);
  engine.setBounds(0, 300, 150);
  engine.mode = 'idle';
  engine.phaseEndsAt = 1000;
  engine.lastTickAt = 900;

  assert.equal(engine.tick(1001, true, true).mode, 'walk');
});

test('跨不同缩放屏幕移动时持续使用桌宠的设计尺寸', () => {
  let bounds = { x: 100, y: 500, width: 190, height: 230 };
  const requests = [];
  const window = {
    isDestroyed: () => false,
    getBounds: () => ({ ...bounds }),
    setBounds: (next) => {
      requests.push(next);
      bounds = { ...next, width: next.width + 2, height: next.height + 2 };
    },
    webContents: { send: () => {} }
  };
  const display = { workArea: { x: -1536, y: 0, width: 1536, height: 960 } };
  const controller = new PetMotionController({
    getWindow: () => window,
    getSettings: () => ({ activityPadding: 0, petScreenMode: 'current' }),
    isPanelVisible: () => false,
    screen: {
      getDisplayMatching: () => display,
      getAllDisplays: () => [display]
    }
  });

  controller.syncToWindow();
  controller.moveTo(-300, 460);
  controller.moveTo(-500, 460);

  assert.deepEqual(requests.map(({ width, height }) => ({ width, height })), [
    { width: 190, height: 230 },
    { width: 190, height: 230 }
  ]);
});

test('edge snap stays disabled for the entire direct-drag gesture', () => {
  let bounds = { x: 2, y: 500, width: 190, height: 230 };
  const requests = [];
  const window = {
    isDestroyed: () => false,
    getBounds: () => ({ ...bounds }),
    setBounds: (next) => {
      requests.push(next);
      bounds = { ...next };
    },
    webContents: { send: () => {} }
  };
  const display = { workArea: { x: 0, y: 0, width: 1920, height: 1080 } };
  const controller = new PetMotionController({
    getWindow: () => window,
    getSettings: () => ({ activityPadding: 0, petScreenMode: 'current', edgeSnap: true }),
    isPanelVisible: () => false,
    screen: {
      getDisplayMatching: () => display,
      getAllDisplays: () => [display]
    }
  });

  controller.setDragging(true);
  assert.equal(controller.snapToEdge(), false);
  assert.equal(requests.length, 0);

  controller.setDragging(false);
  assert.equal(controller.snapToEdge(), true);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].x, 0);
});

test('cross-screen walking does not snap to an internal display seam', () => {
  let bounds = { x: -188, y: 700, width: 190, height: 230 };
  const requests = [];
  const leftDisplay = { workArea: { x: -1536, y: 0, width: 1536, height: 960 } };
  const rightDisplay = { workArea: { x: 0, y: 0, width: 1920, height: 1080 } };
  const window = {
    isDestroyed: () => false,
    getBounds: () => ({ ...bounds }),
    setBounds: (next) => {
      requests.push(next);
      bounds = { ...next };
    },
    webContents: { send: () => {} }
  };
  const controller = new PetMotionController({
    getWindow: () => window,
    getSettings: () => ({ activityPadding: 0, petScreenMode: 'all', edgeSnap: true }),
    isPanelVisible: () => false,
    screen: {
      getDisplayMatching: () => leftDisplay,
      getAllDisplays: () => [leftDisplay, rightDisplay]
    }
  });

  assert.equal(controller.snapToEdge(), false);
  assert.equal(requests.length, 0);
});
