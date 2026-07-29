'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('../src/main/store');
const { ModelLibrary, inspectLive2dFile } = require('../src/main/model-library');

test('Live2D 体检会发现缺失文件并在导入时复制完整模型包', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quick-pet-live2d-'));
  try {
    fs.mkdirSync(path.join(root, 'textures'));
    fs.mkdirSync(path.join(root, 'motions'));
    fs.writeFileSync(path.join(root, 'avatar.moc3'), Buffer.from('moc'));
    fs.writeFileSync(path.join(root, 'textures', 'texture_00.png'), Buffer.from('png'));
    fs.writeFileSync(path.join(root, 'motions', 'idle.motion3.json'), '{}');
    const sourcePath = path.join(root, 'avatar.model3.json');
    fs.writeFileSync(sourcePath, JSON.stringify({
      Version: 3,
      FileReferences: {
        Moc: 'avatar.moc3',
        Textures: ['textures/texture_00.png'],
        Motions: { Idle: [{ File: 'motions/idle.motion3.json' }] },
        Physics: 'avatar.physics3.json'
      }
    }));
    const store = new Store(path.join(root, 'data.json'));
    const library = new ModelLibrary({ directory: path.join(root, 'models'), store });
    assert.deepEqual(library.inspectFile(sourcePath).missingFiles, ['avatar.physics3.json']);
    fs.writeFileSync(path.join(root, 'avatar.physics3.json'), '{}');
    const model = library.importFile(sourcePath, '测试 Live2D');
    assert.equal(model.format, 'live2d');
    assert.equal(model.animationNames[0], 'Idle');
    assert.equal(fs.existsSync(library.modelPath(model)), true);
    assert.equal(fs.existsSync(path.join(root, 'models', 'live2d', model.id, 'textures', 'texture_00.png')), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Live2D 在读取纹理前限制单文件和总包体积', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quick-pet-live2d-limit-'));
  try {
    fs.writeFileSync(path.join(root, 'avatar.moc3'), Buffer.alloc(8));
    fs.writeFileSync(path.join(root, 'texture.png'), Buffer.alloc(8));
    const sourcePath = path.join(root, 'avatar.model3.json');
    fs.writeFileSync(sourcePath, JSON.stringify({ Version: 3, FileReferences: { Moc: 'avatar.moc3', Textures: ['texture.png'] } }));
    assert.throws(() => inspectLive2dFile(sourcePath, { maxFileBytes: 7, maxPackageBytes: 100 }), /单个文件/);
    assert.throws(() => inspectLive2dFile(sourcePath, { maxFileBytes: 20, maxPackageBytes: 15 }), /总大小/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
