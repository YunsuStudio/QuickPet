'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('../src/main/store');
const { ModelLibrary, guessAnimationMap } = require('../src/main/model-library');

function makeGlb(json) {
  const source = Buffer.from(JSON.stringify(json), 'utf8');
  const chunk = Buffer.concat([source, Buffer.alloc((4 - source.length % 4) % 4, 0x20)]);
  const output = Buffer.alloc(20 + chunk.length);
  output.write('glTF', 0, 'ascii');
  output.writeUInt32LE(2, 4);
  output.writeUInt32LE(output.length, 8);
  output.writeUInt32LE(chunk.length, 12);
  output.writeUInt32LE(0x4e4f534a, 16);
  chunk.copy(output, 20);
  return output;
}

test('模型库导入时修复旧材质并记录动作与贴图数量', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quick-pet-models-'));
  try {
    const sourcePath = path.join(root, 'animal.glb');
    fs.writeFileSync(sourcePath, makeGlb({
      asset: { version: '2.0' },
      extensionsUsed: ['KHR_materials_pbrSpecularGlossiness'],
      materials: [{ extensions: { KHR_materials_pbrSpecularGlossiness: { diffuseTexture: { index: 0 } } } }],
      textures: [{}],
      animations: [{ name: 'Chicken_Idle1' }, { name: 'AA_Chicken_Walk' }, { name: 'Chicken_Run' }]
    }));
    const store = new Store(path.join(root, 'data.json'));
    const library = new ModelLibrary({ directory: path.join(root, 'models'), store });
    const model = library.importFile(sourcePath, '小鸡');
    assert.equal(model.materialStatus, 'fixed-legacy');
    assert.equal(model.convertedMaterials, 1);
    assert.equal(model.textureCount, 1);
    assert.equal(model.animationMap.walk, 'AA_Chicken_Walk');
    assert.equal(model.animationMap.run, 'Chicken_Run');
    assert.equal(fs.existsSync(library.modelPath(model)), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('动作名称会自动映射常用行为', () => {
  const map = guessAnimationMap(['Cat_Idle', 'Cat_Walk', 'Cat_Sit', 'Cat_Sleep', 'Cat_Stretch']);
  assert.deepEqual(map, {
    idle: 'Cat_Idle', walk: 'Cat_Walk', run: '', sit: 'Cat_Sit', sleep: 'Cat_Sleep', stretch: 'Cat_Stretch'
  });
});
