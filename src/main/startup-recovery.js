'use strict';

const fs = require('node:fs');
const path = require('node:path');

class StartupRecovery {
  constructor(markerPath) {
    this.markerPath = markerPath;
    this.restorePath = `${markerPath}.restore`;
  }

  previousRunCrashed() {
    try {
      const marker = JSON.parse(fs.readFileSync(this.markerPath, 'utf8'));
      return marker?.running === true;
    } catch {
      return false;
    }
  }

  begin(version = '') {
    fs.mkdirSync(path.dirname(this.markerPath), { recursive: true });
    fs.writeFileSync(this.markerPath, JSON.stringify({ running: true, version: String(version), startedAt: Date.now() }), 'utf8');
  }

  markClean() {
    try { fs.rmSync(this.markerPath, { force: true }); } catch {}
  }

  readRestore() {
    try {
      const value = JSON.parse(fs.readFileSync(this.restorePath, 'utf8'));
      return value && typeof value === 'object' ? value : null;
    } catch {
      return null;
    }
  }

  saveRestore(value) {
    fs.writeFileSync(this.restorePath, JSON.stringify(value), 'utf8');
  }

  clearRestore() {
    try { fs.rmSync(this.restorePath, { force: true }); } catch {}
  }
}

module.exports = { StartupRecovery };
