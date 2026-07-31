'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { compareVersions, validateManifest, downloadResponseToFile, parseGithubRelease, GITHUB_RELEASE_API } = require('../src/main/update-manager');

test('版本比较支持不同长度的语义版本', () => {
  assert.equal(compareVersions('0.11.0', '0.10.9'), 1);
  assert.equal(compareVersions('1.0.0', '1.0'), 0);
  assert.equal(compareVersions('2.0.0', '2.1.0'), -1);
});

test('更新下载使用流式大小限制并校验哈希', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'quick-pet-update-'));
  const destination = path.join(directory, 'update.exe');
  const body = Buffer.from('streamed-update');
  const hash = crypto.createHash('sha256').update(body).digest('hex').toUpperCase();
  try {
    await downloadResponseToFile(new Response(body), destination, hash, 1024);
    assert.equal(fs.readFileSync(destination, 'utf8'), 'streamed-update');
    await assert.rejects(() => downloadResponseToFile(new Response(body), `${destination}.large`, hash, 4), /超过/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('更新清单拒绝非 HTTPS 下载和缺失哈希', () => {
  assert.throws(() => validateManifest({ version: '1.0.0', downloadUrl: 'http://example.com/app.exe', sha256: 'A'.repeat(64) }), /HTTPS/);
  assert.throws(() => validateManifest({ version: '1.0.0', downloadUrl: 'https://example.com/app.exe' }), /SHA-256/);
  assert.equal(validateManifest({ version: '1.0.0', downloadUrl: '', notes: '本地通知' }).version, '1.0.0');
});

test('GitHub Release 会选择便携 x64 包并读取官方摘要', () => {
  const release = parseGithubRelease({
    tag_name: 'v0.12.0',
    body: '新版说明',
    html_url: 'https://github.com/YunsuStudio/QuickPet/releases/tag/v0.12.0',
    assets: [{
      name: '快捷宠-Portable-0.12.0-x64.exe',
      browser_download_url: 'https://github.com/YunsuStudio/QuickPet/releases/download/v0.12.0/app.exe',
      digest: `sha256:${'a'.repeat(64)}`
    }]
  });
  assert.equal(GITHUB_RELEASE_API, 'https://api.github.com/repos/YunsuStudio/QuickPet/releases/latest');
  assert.equal(release.version, '0.12.0');
  assert.equal(release.sha256, 'A'.repeat(64));
  assert.match(release.downloadUrl, /^https:\/\//);
  assert.equal(release.notes, '新版说明');
});

test('GitHub Release 没有便携包时仍可报告版本', () => {
  const release = parseGithubRelease({ tag_name: 'v1.0.0', html_url: 'https://github.com/release', assets: [] });
  assert.equal(release.version, '1.0.0');
  assert.equal(release.downloadUrl, '');
  assert.equal(release.releaseUrl, 'https://github.com/release');
});
