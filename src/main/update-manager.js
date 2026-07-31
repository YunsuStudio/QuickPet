'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');

const MAX_UPDATE_BYTES = 400 * 1024 * 1024;
const GITHUB_RELEASE_API = 'https://api.github.com/repos/YunsuStudio/QuickPet/releases/latest';

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

function parseGithubRelease(input) {
  if (!input || typeof input !== 'object') throw new Error('GitHub 返回的版本信息无效');
  const version = String(input.tag_name || '').replace(/^v/i, '');
  if (!/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(version)) throw new Error('GitHub Release 的版本号无效');
  const assets = Array.isArray(input.assets) ? input.assets : [];
  const asset = assets.find((item) => /portable.*x64.*\.exe$/i.test(String(item?.name || '')) || /x64.*portable.*\.exe$/i.test(String(item?.name || '')));
  const digest = /^sha256:([a-f0-9]{64})$/i.exec(String(asset?.digest || ''))?.[1]?.toUpperCase() || '';
  const assetUrl = /^https:\/\//i.test(String(asset?.browser_download_url || '')) ? String(asset.browser_download_url) : '';
  return {
    version,
    downloadUrl: digest ? assetUrl : '',
    sha256: digest && assetUrl ? digest : '',
    notes: String(input.body || '').slice(0, 2000),
    releaseUrl: /^https:\/\//i.test(String(input.html_url || '')) ? String(input.html_url) : '',
    assetName: String(asset?.name || '')
  };
}

class UpdateManager {
  constructor({ currentVersion, fetchImpl = globalThis.fetch }) {
    this.currentVersion = currentVersion;
    this.fetchImpl = fetchImpl;
    this.lastResult = { status: 'idle', currentVersion };
  }

  async check() {
    this.lastResult = { status: 'checking', currentVersion: this.currentVersion };
    const response = await this.fetchImpl(GITHUB_RELEASE_API, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'QuickPet-Updater/1.0', 'X-GitHub-Api-Version': '2022-11-28' },
      signal: AbortSignal.timeout(10000)
    });
    if (response.status === 404) {
      return (this.lastResult = {
        status: 'unavailable',
        currentVersion: this.currentVersion,
        message: '更新仓库暂不可用，请稍后再试'
      });
    }
    if (!response.ok) throw new Error(`GitHub 更新服务返回 ${response.status}`);
    const manifest = parseGithubRelease(await response.json());
    const available = compareVersions(manifest.version, this.currentVersion) > 0;
    return (this.lastResult = { status: available ? 'available' : 'current', currentVersion: this.currentVersion, ...manifest });
  }

  async download(manifest, destination) {
    const valid = validateManifest(manifest);
    if (!valid.downloadUrl) throw new Error('更新清单没有下载地址');
    const response = await this.fetchImpl(valid.downloadUrl, { headers: { 'User-Agent': 'QuickPet-Updater/1.0' }, signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw new Error(`更新下载失败：${response.status}`);
    const length = Number(response.headers.get('content-length') || 0);
    if (length > MAX_UPDATE_BYTES) throw new Error('更新包超过 400 MB');
    return downloadResponseToFile(response, destination, valid.sha256, MAX_UPDATE_BYTES);
  }
}

module.exports = { UpdateManager, compareVersions, validateManifest, parseGithubRelease, downloadResponseToFile, GITHUB_RELEASE_API, MAX_UPDATE_BYTES };
