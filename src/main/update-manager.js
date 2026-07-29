'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');

const MAX_UPDATE_BYTES = 400 * 1024 * 1024;

async function downloadResponseToFile(response, destination, expectedHash, maxBytes = MAX_UPDATE_BYTES) {
  if (!response.body) throw new Error('更新服务器没有返回文件内容');
  const temporary = `${destination}.tmp`;
  const handle = await fs.promises.open(temporary, 'w');
  const hash = crypto.createHash('sha256');
  let bytes = 0;
  try {
    for await (const chunk of Readable.fromWeb(response.body)) {
      bytes += chunk.length;
      if (bytes > maxBytes) throw new Error(`更新包超过 ${Math.max(1, Math.round(maxBytes / 1024 / 1024))} MB`);
      hash.update(chunk);
      await handle.write(chunk);
    }
  } catch (error) {
    await handle.close();
    await fs.promises.rm(temporary, { force: true });
    throw error;
  }
  await handle.close();
  if (hash.digest('hex').toUpperCase() !== expectedHash) {
    await fs.promises.rm(temporary, { force: true });
    throw new Error('更新包校验失败，文件可能不完整');
  }
  await fs.promises.rename(temporary, destination);
  return destination;
}

function versionParts(value) {
  return String(value || '').replace(/^v/i, '').split('.').slice(0, 4).map((part) => Number.parseInt(part, 10) || 0);
}

function compareVersions(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if ((a[index] || 0) !== (b[index] || 0)) return (a[index] || 0) > (b[index] || 0) ? 1 : -1;
  }
  return 0;
}

function validateManifest(input) {
  if (!input || typeof input !== 'object' || !/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(String(input.version || ''))) throw new Error('更新清单版本无效');
  const downloadUrl = String(input.downloadUrl || '');
  if (downloadUrl && !/^https:\/\//i.test(downloadUrl)) throw new Error('更新下载地址必须使用 HTTPS');
  const sha256 = String(input.sha256 || '').toUpperCase();
  if (downloadUrl && !/^[A-F0-9]{64}$/.test(sha256)) throw new Error('更新包缺少有效的 SHA-256');
  return { version: String(input.version), downloadUrl, sha256, notes: String(input.notes || '').slice(0, 2000) };
}

class UpdateManager {
  constructor({ currentVersion, feedUrl = '', localManifests = [] }) {
    this.currentVersion = currentVersion;
    this.feedUrl = feedUrl;
    this.localManifests = localManifests;
    this.lastResult = { status: 'idle', currentVersion };
  }

  async check(feedUrl = this.feedUrl) {
    this.lastResult = { status: 'checking', currentVersion: this.currentVersion };
    let manifest;
    for (const filePath of this.localManifests) {
      if (!filePath || !fs.existsSync(filePath)) continue;
      manifest = validateManifest(JSON.parse(fs.readFileSync(filePath, 'utf8')));
      break;
    }
    if (!manifest && feedUrl) {
      if (!/^https:\/\//i.test(feedUrl)) throw new Error('更新地址必须使用 HTTPS');
      const response = await fetch(feedUrl, { headers: { 'User-Agent': 'QuickPet-Updater/1.0' }, signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error(`更新服务器返回 ${response.status}`);
      manifest = validateManifest(await response.json());
    }
    if (!manifest) return (this.lastResult = { status: 'unconfigured', currentVersion: this.currentVersion });
    const available = compareVersions(manifest.version, this.currentVersion) > 0;
    return (this.lastResult = { status: available ? 'available' : 'current', currentVersion: this.currentVersion, ...manifest });
  }

  async download(manifest, destination) {
    const valid = validateManifest(manifest);
    if (!valid.downloadUrl) throw new Error('更新清单没有下载地址');
    const response = await fetch(valid.downloadUrl, { headers: { 'User-Agent': 'QuickPet-Updater/1.0' }, signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw new Error(`更新下载失败：${response.status}`);
    const length = Number(response.headers.get('content-length') || 0);
    if (length > MAX_UPDATE_BYTES) throw new Error('更新包超过 400 MB');
    return downloadResponseToFile(response, destination, valid.sha256, MAX_UPDATE_BYTES);
  }
}

module.exports = { UpdateManager, compareVersions, validateManifest, downloadResponseToFile, MAX_UPDATE_BYTES };
