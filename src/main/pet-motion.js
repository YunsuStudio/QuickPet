'use strict';

const { movementInterval } = require('../shared/performance-policy');

class PetMotionEngine {
  constructor(random = Math.random) {
    this.random = random;
    this.x = 0;
    this.minX = 0;
    this.maxX = 0;
    this.speed = 46;
    this.mode = 'idle';
    this.direction = 1;
    this.lastTickAt = 0;
    this.phaseEndsAt = 0;
  }

  setBounds(minX, maxX, currentX = this.x) {
    this.minX = Math.min(minX, maxX);
    this.maxX = Math.max(minX, maxX);
    this.x = Math.min(this.maxX, Math.max(this.minX, currentX));
  }

  setSpeed(speed) {
    this.speed = Math.min(110, Math.max(18, Number(speed) || 46));
  }

  syncPosition(x, now = Date.now()) {
    this.x = Math.min(this.maxX, Math.max(this.minX, x));
    this.lastTickAt = now;
  }

  pause(now = Date.now()) {
    this.lastTickAt = now;
  }

  randomDuration(minimum, maximum) {
    return minimum + Math.round(this.random() * (maximum - minimum));
  }

  chooseDirection() {
    const edgePadding = Math.min(80, (this.maxX - this.minX) * 0.2);
    if (this.x <= this.minX + edgePadding) return 1;
    if (this.x >= this.maxX - edgePadding) return -1;
    return this.random() < 0.5 ? -1 : 1;
  }

  beginNextPhase(now, naturalBehavior = true) {
    let action = '';
    if (this.mode === 'walk' || this.mode === 'run') {
      this.mode = 'idle';
      this.phaseEndsAt = now + this.randomDuration(1000, 2600);
      if (this.random() < 0.32) action = 'hop';
    } else {
      const roll = naturalBehavior ? this.random() : 0.75;
      if (roll < 0.05) {
        this.mode = 'sleep';
        this.phaseEndsAt = now + this.randomDuration(5000, 10000);
      } else if (roll < 0.13) {
        this.mode = 'sit';
        this.phaseEndsAt = now + this.randomDuration(2500, 5500);
      } else if (roll < 0.2) {
        this.mode = 'stretch';
        action = 'stretch';
        this.phaseEndsAt = now + this.randomDuration(1400, 2600);
      } else if (roll < 0.28) {
        this.mode = 'look';
        action = 'look';
        this.phaseEndsAt = now + this.randomDuration(1200, 2600);
      } else {
        this.mode = roll >= 0.94 ? 'run' : 'walk';
        this.direction = this.chooseDirection();
        this.phaseEndsAt = now + this.randomDuration(this.mode === 'run' ? 1800 : 3800, this.mode === 'run' ? 4200 : 9000);
      }
    }
    return action;
  }

  tick(now, enabled = true, naturalBehavior = true) {
    if (!this.lastTickAt) this.lastTickAt = now;
    const deltaSeconds = Math.min(0.12, Math.max(0, (now - this.lastTickAt) / 1000));
    this.lastTickAt = now;
    if (!enabled) return { x: this.x, moved: false, mode: 'idle', direction: this.direction, action: '' };

    let action = '';
    if (!this.phaseEndsAt) {
      this.mode = 'idle';
      this.phaseEndsAt = now + this.randomDuration(600, 1400);
    } else if (now >= this.phaseEndsAt) {
      action = this.beginNextPhase(now, naturalBehavior);
    }

    let moved = false;
    if ((this.mode === 'walk' || this.mode === 'run') && this.maxX > this.minX) {
      const previousX = this.x;
      this.x += this.direction * this.speed * (this.mode === 'run' ? 1.72 : 1) * deltaSeconds;
      if (this.x <= this.minX) {
        this.x = this.minX;
        this.direction = 1;
        this.mode = naturalBehavior ? 'sit' : 'walk';
        this.phaseEndsAt = naturalBehavior ? now + this.randomDuration(1800, 4200) : this.phaseEndsAt;
        action = naturalBehavior ? 'edge-rest' : 'turn';
      } else if (this.x >= this.maxX) {
        this.x = this.maxX;
        this.direction = -1;
        this.mode = naturalBehavior ? 'sit' : 'walk';
        this.phaseEndsAt = naturalBehavior ? now + this.randomDuration(1800, 4200) : this.phaseEndsAt;
        action = naturalBehavior ? 'edge-rest' : 'turn';
      }
      moved = Math.abs(this.x - previousX) >= 0.01;
    }

    return { x: this.x, moved, mode: this.mode, direction: this.direction, action };
  }
}

class PetMotionController {
  constructor({ getWindow, getSettings, isPanelVisible, screen }) {
    this.getWindow = getWindow;
    this.getSettings = getSettings;
    this.isPanelVisible = isPanelVisible;
    this.screen = screen;
    this.engine = new PetMotionEngine();
    this.timer = null;
    this.running = false;
    this.pausedUntil = 0;
    this.baseY = null;
    this.lastMotionKey = '';
    this.lastCursorPoint = null;
    this.lastUserActivityAt = Date.now();
    this.nextHungerRestAt = 0;
    this.windowSize = null;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.schedule(0);
  }

  stop() {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  schedule(delay) {
    if (!this.running) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      const nextDelay = this.tick();
      this.schedule(nextDelay);
    }, delay);
  }

  pauseFor(milliseconds = 3000) {
    this.pausedUntil = Math.max(this.pausedUntil, Date.now() + milliseconds);
    this.engine.pause();
    this.emitMotion({ mode: 'idle', direction: this.engine.direction, action: '' });
  }

  react(action = 'pet') {
    const now = Date.now();
    this.pausedUntil = Math.max(this.pausedUntil, now + 1400);
    this.engine.mode = action === 'play' ? 'run' : action === 'feed' ? 'sit' : 'look';
    this.engine.phaseEndsAt = now + (action === 'play' ? 2600 : 1600);
    this.emitMotion({ mode: this.engine.mode, direction: this.engine.direction, action });
  }

  handleUserMove(bounds) {
    this.pauseFor(6000);
    this.baseY = bounds.y;
    this.refreshBounds(bounds);
    this.engine.syncPosition(bounds.x);
  }

  syncToWindow(intendedSize = null) {
    const window = this.getWindow();
    if (!window || window.isDestroyed()) return;
    const bounds = window.getBounds();
    this.windowSize = {
      width: Math.max(1, Math.round(Number(intendedSize?.width) || bounds.width)),
      height: Math.max(1, Math.round(Number(intendedSize?.height) || bounds.height))
    };
    this.baseY = bounds.y;
    this.refreshBounds(bounds);
    this.engine.syncPosition(bounds.x);
  }

  moveTo(x, y) {
    const window = this.getWindow();
    if (!window || window.isDestroyed()) return;
    const current = window.getBounds();
    if (!this.windowSize) this.windowSize = { width: current.width, height: current.height };
    const nextX = Math.round(x);
    const nextY = Math.round(y);
    if (typeof window.setBounds === 'function') {
      window.setBounds({ x: nextX, y: nextY, width: this.windowSize.width, height: this.windowSize.height }, false);
    } else {
      window.setPosition(nextX, nextY, false);
    }
  }

  refreshBounds(bounds) {
    const settings = this.getSettings();
    const padding = Math.max(0, Number(settings.activityPadding) || 0);
    const displays = settings.petScreenMode === 'all' ? this.screen.getAllDisplays() : [this.screen.getDisplayMatching(bounds)];
    const minimum = Math.min(...displays.map((display) => display.workArea.x)) + padding;
    const maximum = Math.max(...displays.map((display) => display.workArea.x + display.workArea.width)) - bounds.width - padding;
    this.engine.setBounds(minimum, maximum, bounds.x);
    const display = this.screen.getDisplayMatching(bounds);
    if (this.baseY === null) this.baseY = bounds.y;
    this.baseY = Math.min(display.workArea.y + display.workArea.height - bounds.height - padding, Math.max(display.workArea.y + padding, this.baseY));
  }

  snapToEdge() {
    const window = this.getWindow();
    const settings = this.getSettings();
    if (!window || window.isDestroyed() || settings.edgeSnap === false) return false;
    const bounds = window.getBounds();
    const area = this.screen.getDisplayMatching(bounds).workArea;
    const threshold = 28;
    const candidates = [
      { distance: Math.abs(bounds.x - area.x), x: area.x },
      { distance: Math.abs(bounds.x + bounds.width - (area.x + area.width)), x: area.x + area.width - bounds.width }
    ];
    const closest = candidates.sort((a, b) => a.distance - b.distance)[0];
    if (closest.distance > threshold) return false;
    this.moveTo(closest.x, bounds.y);
    this.engine.syncPosition(closest.x);
    return true;
  }

  emitMotion(motion) {
    const window = this.getWindow();
    if (!window || window.isDestroyed()) return;
    const focusKey = Number.isFinite(motion.focusX) ? `:${Math.round(motion.focusX * 8)}:${Math.round(motion.focusY * 8)}` : '';
    const key = `${motion.mode}:${motion.direction}${focusKey}`;
    if (key === this.lastMotionKey && !motion.action) return;
    this.lastMotionKey = key;
    window.webContents.send('pet:motion', motion);
  }

  tick() {
    const window = this.getWindow();
    if (!window || window.isDestroyed() || !window.isVisible()) return 500;
    const settings = this.getSettings();
    const now = Date.now();
    const enabled = settings.autoWalk !== false && !this.isPanelVisible() && now >= this.pausedUntil;
    const bounds = window.getBounds();
    const cursor = this.screen.getCursorScreenPoint();
    if (!this.lastCursorPoint || cursor.x !== this.lastCursorPoint.x || cursor.y !== this.lastCursorPoint.y) {
      this.lastCursorPoint = cursor;
      this.lastUserActivityAt = now;
    }
    this.refreshBounds(bounds);
    this.engine.setSpeed(settings.petWalkSpeed);

    if (!enabled) {
      this.engine.pause(now);
      this.emitMotion({ mode: 'idle', direction: this.engine.direction, action: '' });
      return 250;
    }

    const hour = new Date(now).getHours();
    if (settings.nightSleep !== false && (hour >= 23 || hour < 6) && this.engine.mode !== 'sleep') {
      this.engine.mode = 'sleep';
      this.engine.phaseEndsAt = now + 60000;
    } else if (Number(settings.petStatus?.hunger) < 16 && this.engine.mode === 'idle' && now >= this.nextHungerRestAt) {
      this.engine.mode = 'sit';
      this.engine.phaseEndsAt = now + 2200;
      this.nextHungerRestAt = now + 60000;
    } else if (settings.naturalBehavior !== false && now - this.lastUserActivityAt > 8 * 60 * 1000 && this.engine.mode !== 'sleep') {
      this.engine.mode = 'sleep';
      this.engine.phaseEndsAt = now + 60000;
    }
    const motion = this.engine.tick(now, true, settings.naturalBehavior !== false);
    motion.focusX = Math.max(-1, Math.min(1, (cursor.x - (bounds.x + bounds.width / 2)) / Math.max(1, bounds.width * 1.4)));
    motion.focusY = Math.max(-1, Math.min(1, (cursor.y - (bounds.y + bounds.height / 2)) / Math.max(1, bounds.height * 1.4)));
    if (motion.moved) this.moveTo(motion.x, this.baseY);
    this.emitMotion(motion);
    return motion.moved ? movementInterval(settings.performanceMode) : 100;
  }
}

module.exports = { PetMotionEngine, PetMotionController };
