'use strict';

const fs = require('node:fs');
const path = require('node:path');

function isValidBackupData(input) {
  return Boolean(input && typeof input === 'object' && Array.isArray(input.shortcuts) && input.settings && typeof input.settings === 'object');
}

function backupStamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

class BackupManager {
  constructor({ dataFile, directory, retention = 10 }) {
    this.dataFile = dataFile;
    this.directory = directory;
    this.retention = Math.max(2, Number(retention) || 10);
  }

  ensureDirectory() {
    fs.mkdirSync(this.directory, { recursive: true });
  }

  readData(filePath) {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!isValidBackupData(parsed)) throw new Error('备份内容不完整');
    return parsed;
  }

  list() {
    if (!fs.existsSync(this.directory)) return [];
    return fs.readdirSync(this.directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /^quick-pet-.*\.json$/i.test(entry.name))
      .map((entry) => {
        const filePath = path.join(this.directory, entry.name);
        const stats = fs.statSync(filePath);
        return { id: entry.name, createdAt: stats.mtimeMs, size: stats.size };
      })
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  prune() {
    for (const backup of this.list().slice(this.retention)) {
      fs.rmSync(path.join(this.directory, backup.id), { force: true });
    }
  }

  create(data, { reason = 'auto', force = false, now = new Date() } = {}) {
    if (!isValidBackupData(data)) throw new Error('当前数据不完整，无法备份');
    this.ensureDirectory();
    const day = now.toISOString().slice(0, 10);
    if (!force) {
      const existing = this.list().find((item) => item.id.startsWith(`quick-pet-auto-${day}`));
      if (existing) return existing;
    }
    const safeReason = String(reason).replace(/[^a-z0-9-]/gi, '').slice(0, 20) || 'manual';
    const id = `quick-pet-${safeReason}-${backupStamp(now)}.json`;
    const filePath = path.join(this.directory, id);
    const tempPath = `${filePath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tempPath, filePath);
    fs.utimesSync(filePath, now, now);
    this.prune();
    const stats = fs.statSync(filePath);
    return { id, createdAt: stats.mtimeMs, size: stats.size };
  }

  restore(id) {
    const safeId = path.basename(String(id || ''));
    const filePath = path.join(this.directory, safeId);
    if (!safeId || !fs.existsSync(filePath)) throw new Error('没有找到这份备份');
    return this.readData(filePath);
  }

  remove(id) {
    const safeId = path.basename(String(id || ''));
    const filePath = path.join(this.directory, safeId);
    if (!safeId || !fs.existsSync(filePath)) return false;
    fs.rmSync(filePath, { force: true });
    return true;
  }

  recoverIfNeeded() {
    if (!fs.existsSync(this.dataFile)) return null;
    try {
      this.readData(this.dataFile);
      return null;
    } catch {
      const brokenPath = `${this.dataFile}.broken-${Date.now()}`;
      try { fs.copyFileSync(this.dataFile, brokenPath); } catch {}
      for (const backup of this.list()) {
        try {
          this.readData(path.join(this.directory, backup.id));
          fs.copyFileSync(path.join(this.directory, backup.id), this.dataFile);
          return { backupId: backup.id, brokenPath };
        } catch {}
      }
      return null;
    }
  }
}

module.exports = { BackupManager, isValidBackupData, backupStamp };
