'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const extractZip = require('extract-zip');
const { isValidBackupData } = require('./backup-manager');

const execFileAsync = promisify(execFile);
const MAX_ARCHIVE_BYTES = 500 * 1024 * 1024;
const MAX_EXTRACTED_BYTES = 1024 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 5000;

function validateMigrationTree(directory, { maxEntries = MAX_ARCHIVE_ENTRIES, maxBytes = MAX_EXTRACTED_BYTES } = {}) {
  let entries = 0;
  let bytes = 0;
  const visit = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      entries += 1;
      if (entries > maxEntries) throw new Error(`迁移包文件数量不能超过 ${maxEntries}`);
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) visit(target);
      else {
        bytes += fs.statSync(target).size;
        if (bytes > maxBytes) throw new Error(`迁移包展开后不能超过 ${Math.max(1, Math.round(maxBytes / 1024 / 1024))}MB`);
      }
    }
  };
  visit(directory);
  return { entries, bytes };
}

function archiveEntryLimiter({ maxEntries = MAX_ARCHIVE_ENTRIES, maxBytes = MAX_EXTRACTED_BYTES } = {}) {
  let entries = 0;
  let bytes = 0;
  return (entry) => {
    entries += 1;
    bytes += Math.max(0, Number(entry.uncompressedSize) || 0);
    const name = String(entry.fileName || '').replaceAll('\\', '/');
    if (!name || name.startsWith('/') || /^[a-z]:/i.test(name) || name.split('/').includes('..')) throw new Error('迁移包包含不安全路径');
    if (entries > maxEntries) throw new Error(`迁移包文件数量不能超过 ${maxEntries}`);
    if (bytes > maxBytes) throw new Error(`迁移包展开后不能超过 ${Math.max(1, Math.round(maxBytes / 1024 / 1024))}MB`);
  };
}

function validateMigrationData(directory) {
  const manifestPath = path.join(directory, 'manifest.json');
  const dataPath = path.join(directory, 'quick-pet-data.json');
  if (!fs.existsSync(manifestPath) || !fs.existsSync(dataPath)) throw new Error('迁移包内容不完整');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  if (manifest.format !== 'quick-pet-migration' || !isValidBackupData(data)) throw new Error('这不是有效的快捷宠迁移包');
  return { manifest, data, modelDirectory: path.join(directory, 'models'), assetDirectory: path.join(directory, 'assets') };
}

async function runPowerShell(script, argumentsList) {
  const powershell = path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const scriptPath = path.join(os.tmpdir(), `quick-pet-migration-${process.pid}-${Date.now()}.ps1`);
  try {
    fs.writeFileSync(scriptPath, script, 'utf8');
    await execFileAsync(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...argumentsList], { windowsHide: true, maxBuffer: 1024 * 1024 });
  } finally {
    try { fs.rmSync(scriptPath, { force: true }); } catch {}
  }
}

class MigrationManager {
  constructor({ dataFile, modelDirectory, assetDirectory = '', store, backupManager, appVersion }) {
    this.dataFile = dataFile;
    this.modelDirectory = modelDirectory;
    this.assetDirectory = assetDirectory;
    this.store = store;
    this.backupManager = backupManager;
    this.appVersion = appVersion;
  }

  async exportTo(destination) {
    const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'quick-pet-export-'));
    const zipPath = path.join(os.tmpdir(), `quick-pet-export-${process.pid}-${Date.now()}.zip`);
    try {
      await fs.promises.writeFile(path.join(staging, 'manifest.json'), JSON.stringify({ format: 'quick-pet-migration', version: 1, appVersion: this.appVersion, createdAt: Date.now() }, null, 2), 'utf8');
      await fs.promises.writeFile(path.join(staging, 'quick-pet-data.json'), JSON.stringify(this.store.snapshot(), null, 2), 'utf8');
      if (fs.existsSync(this.modelDirectory)) await fs.promises.cp(this.modelDirectory, path.join(staging, 'models'), { recursive: true });
      if (this.assetDirectory && fs.existsSync(this.assetDirectory)) await fs.promises.cp(this.assetDirectory, path.join(staging, 'assets'), { recursive: true });
      await runPowerShell(
        "param([string]$Source,[string]$Destination)\nCompress-Archive -Path (Join-Path $Source '*') -DestinationPath $Destination -CompressionLevel Optimal -Force",
        ['-Source', staging, '-Destination', zipPath]
      );
      fs.copyFileSync(zipPath, destination);
      return destination;
    } finally {
      try { fs.rmSync(staging, { recursive: true, force: true }); } catch {}
      try { fs.rmSync(zipPath, { force: true }); } catch {}
    }
  }

  async importFrom(source) {
    const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'quick-pet-import-'));
    try {
      if (fs.statSync(source).size > MAX_ARCHIVE_BYTES) throw new Error('迁移包不能超过 500MB');
      await extractZip(path.resolve(source), { dir: staging, onEntry: archiveEntryLimiter() });
      validateMigrationTree(staging);
      const migration = validateMigrationData(staging);
      this.backupManager.create(this.store.snapshot(), { reason: 'before-migration', force: true });
      if (fs.existsSync(migration.modelDirectory)) {
        await fs.promises.mkdir(this.modelDirectory, { recursive: true });
        await fs.promises.cp(migration.modelDirectory, this.modelDirectory, { recursive: true, force: true });
      }
      if (this.assetDirectory && fs.existsSync(migration.assetDirectory)) {
        await fs.promises.mkdir(this.assetDirectory, { recursive: true });
        await fs.promises.cp(migration.assetDirectory, this.assetDirectory, { recursive: true, force: true });
      }
      return this.store.replaceData(migration.data);
    } finally {
      try { fs.rmSync(staging, { recursive: true, force: true }); } catch {}
    }
  }
}

module.exports = { MigrationManager, validateMigrationData, validateMigrationTree, archiveEntryLimiter, MAX_ARCHIVE_BYTES, MAX_EXTRACTED_BYTES, MAX_ARCHIVE_ENTRIES };
