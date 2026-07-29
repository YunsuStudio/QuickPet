'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { compareVersions, validateManifest, downloadResponseToFile } = require('../src/main/update-manager');

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
