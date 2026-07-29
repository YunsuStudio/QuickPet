'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { AssetStore } = require('../src/main/asset-store');
const { Store } = require('../src/main/store');

test('图片资源保存为独立文件且持久化状态不再包含 Base64', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'quick-pet-assets-'));
  try {
    const assets = new AssetStore(path.join(directory, 'assets'));
    const store = new Store(path.join(directory, 'data.json'), { assetStore: assets });
    store.updateSettings({
      petImageData: 'data:image/png;base64,iVBORw0KGgo=',
      petOriginalImageData: 'data:image/jpeg;base64,/9j/2Q=='
    });
    const persisted = fs.readFileSync(store.filePath, 'utf8');
    assert.doesNotMatch(persisted, /data:image\//);
    assert.match(store.rendererSnapshot().settings.petImageData, /^file:\/\//);
    assert.equal(fs.readdirSync(path.join(directory, 'assets', 'skins')).length, 2);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('旧版内联快捷图标会在加载时自动迁移', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'quick-pet-asset-migration-'));
  const filePath = path.join(directory, 'data.json');
  try {
    fs.writeFileSync(filePath, JSON.stringify({ shortcuts: [{ id: 'one', name: 'One', target: 'https://example.com', iconData: 'data:image/png;base64,iVBORw0KGgo=' }], settings: {} }));
    const store = new Store(filePath, { assetStore: new AssetStore(path.join(directory, 'assets')) });
    assert.doesNotMatch(fs.readFileSync(filePath, 'utf8'), /data:image\//);
    assert.match(store.rendererSnapshot().shortcuts[0].iconData, /^file:\/\//);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
