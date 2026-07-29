'use strict';

const MODIFIER_ORDER = ['CommandOrControl', 'Alt', 'Shift', 'Super'];
const MODIFIER_ALIASES = new Map([
  ['ctrl', 'CommandOrControl'], ['control', 'CommandOrControl'], ['commandorcontrol', 'CommandOrControl'],
  ['alt', 'Alt'], ['option', 'Alt'], ['shift', 'Shift'], ['win', 'Super'], ['meta', 'Super'], ['super', 'Super']
]);
const KEY_ALIASES = new Map([
  [' ', 'Space'], ['spacebar', 'Space'], ['esc', 'Escape'], ['arrowup', 'Up'], ['arrowdown', 'Down'],
  ['arrowleft', 'Left'], ['arrowright', 'Right'], ['pageup', 'PageUp'], ['pagedown', 'PageDown']
]);
const NAMED_KEYS = new Set(['Space', 'Tab', 'Escape', 'Enter', 'Backspace', 'Delete', 'Insert', 'Home', 'End', 'PageUp', 'PageDown', 'Up', 'Down', 'Left', 'Right']);

function normalizeKey(value) {
  const raw = String(value || '').trim();
  const alias = KEY_ALIASES.get(raw.toLowerCase());
  if (alias) return alias;
  if (/^[a-z0-9]$/i.test(raw)) return raw.toUpperCase();
  if (/^f(?:[1-9]|1\d|2[0-4])$/i.test(raw)) return raw.toUpperCase();
  const named = [...NAMED_KEYS].find((key) => key.toLowerCase() === raw.toLowerCase());
  return named || '';
}

function normalizeHotkey(value) {
  if (!String(value || '').trim()) return '';
  const modifiers = new Set();
  let key = '';
  for (const token of String(value).split('+').map((item) => item.trim()).filter(Boolean)) {
    const modifier = MODIFIER_ALIASES.get(token.toLowerCase());
    if (modifier) modifiers.add(modifier);
    else if (!key) key = normalizeKey(token);
    else return '';
  }
  if (!modifiers.size || !key) return '';
  const normalized = [...MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier)), key].join('+');
  if (['Alt+F4', 'CommandOrControl+Alt+Delete'].includes(normalized)) return '';
  return normalized;
}

class ShortcutHotkeyRegistry {
  constructor({ registrar, onTrigger }) {
    this.registrar = registrar;
    this.onTrigger = onTrigger;
    this.registered = new Map();
    this.statuses = {};
  }

  clear() {
    for (const accelerator of this.registered.values()) this.registrar.unregister(accelerator);
    this.registered.clear();
    this.statuses = {};
  }

  sync(shortcuts, reserved = []) {
    this.clear();
    const reservedSet = new Set(reserved.map(normalizeHotkey).filter(Boolean));
    const seen = new Set();
    for (const shortcut of shortcuts || []) {
      const accelerator = normalizeHotkey(shortcut.hotkey);
      if (!accelerator) continue;
      if (reservedSet.has(accelerator) || seen.has(accelerator)) {
        this.statuses[shortcut.id] = { status: 'conflict', message: '组合键与其他功能冲突' };
        continue;
      }
      seen.add(accelerator);
      try {
        if (this.registrar.register(accelerator, () => this.onTrigger(shortcut.id))) {
          this.registered.set(shortcut.id, accelerator);
          this.statuses[shortcut.id] = { status: 'registered', message: '组合键已生效' };
        } else {
          this.statuses[shortcut.id] = { status: 'unavailable', message: '组合键已被系统或其他程序占用' };
        }
      } catch {
        this.statuses[shortcut.id] = { status: 'invalid', message: '系统无法注册这个组合键' };
      }
    }
    return this.snapshot();
  }

  snapshot() {
    return { ...this.statuses };
  }
}

module.exports = { normalizeHotkey, ShortcutHotkeyRegistry };
