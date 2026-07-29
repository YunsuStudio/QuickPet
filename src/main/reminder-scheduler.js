'use strict';

function nextDueAt(reminder, now) {
  if (reminder.repeat === 'daily') return now + 24 * 60 * 60 * 1000;
  if (reminder.repeat === 'weekly') return now + 7 * 24 * 60 * 60 * 1000;
  if (reminder.repeat === 'monthly') {
    const next = new Date(now);
    next.setMonth(next.getMonth() + 1);
    return next.getTime();
  }
  if (reminder.repeat === 'weekdays') {
    const next = new Date(now + 24 * 60 * 60 * 1000);
    while ([0, 6].includes(next.getDay())) next.setDate(next.getDate() + 1);
    return next.getTime();
  }
  return reminder.dueAt;
}

class ReminderScheduler {
  constructor({ store, notify, intervalMs = 15000 }) {
    this.store = store;
    this.notify = notify;
    this.intervalMs = intervalMs;
    this.timer = null;
  }

  start() {
    this.stop();
    this.tick();
    this.timer = setInterval(() => this.tick(), this.intervalMs);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  tick(now = Date.now()) {
    let changed = false;
    for (const reminder of this.store.data.reminders) {
      if (!reminder.enabled || !reminder.dueAt || reminder.dueAt > now || reminder.lastTriggeredAt >= reminder.dueAt) continue;
      reminder.lastTriggeredAt = now;
      if (reminder.repeat === 'none') reminder.enabled = false;
      else reminder.dueAt = nextDueAt(reminder, now);
      const notification = this.store.addNotification({ title: reminder.title, message: reminder.note || '到时间了', kind: 'reminder' });
      this.notify?.(reminder, notification);
      changed = true;
    }
    if (changed) this.store.save();
    return changed;
  }
}

module.exports = { ReminderScheduler, nextDueAt };
