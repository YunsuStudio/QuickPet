'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeHotkey, ShortcutHotkeyRegistry } = require('../src/main/shortcut-hotkeys');

test('组合键会规范化修饰键和普通按键', () => {
  assert.equal(normalizeHotkey('shift+ctrl+k'), 'CommandOrControl+Shift+K');
  assert.equal(normalizeHotkey('Alt+F12'), 'Alt+F12');
  assert.equal(normalizeHotkey('K'), '');
  assert.equal(normalizeHotkey('Alt+F4'), '');
});

test('注册器标记系统占用与保留组合键', () => {
  const active = new Set();
  const registrar = {
    register: (key) => key !== 'Alt+F8' && !active.has(key) && Boolean(active.add(key)),
    unregister: (key) => active.delete(key)
  };
  const opened = [];
  const registry = new ShortcutHotkeyRegistry({ registrar, onTrigger: (id) => opened.push(id) });
  const statuses = registry.sync([
    { id: 'one', hotkey: 'Ctrl+1' },
    { id: 'two', hotkey: 'Alt+F8' },
    { id: 'three', hotkey: 'Ctrl+Space' }
  ], ['Ctrl+Space']);
  assert.equal(statuses.one.status, 'registered');
  assert.equal(statuses.two.status, 'unavailable');
  assert.equal(statuses.three.status, 'conflict');
  registry.clear();
  assert.equal(active.size, 0);
});
