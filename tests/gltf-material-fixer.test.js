'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { fixLegacySpecGlossGlb, inspectGlb } = require('../src/main/gltf-material-fixer');

function makeGlb(json, binary = Buffer.from([1, 2, 3, 4])) {
  const jsonSource = Buffer.from(JSON.stringify(json), 'utf8');
  const jsonPadding = (4 - (jsonSource.length % 4)) % 4;
  const jsonChunk = Buffer.concat([jsonSource, Buffer.alloc(jsonPadding, 0x20)]);
  const binaryPadding = (4 - (binary.length % 4)) % 4;
  const binaryChunk = Buffer.concat([binary, Buffer.alloc(binaryPadding)]);
  const totalLength = 12 + 8 + jsonChunk.length + 8 + binaryChunk.length;
  const output = Buffer.alloc(totalLength);
  output.write('glTF', 0, 'ascii');
  output.writeUInt32LE(2, 4);
  output.writeUInt32LE(totalLength, 8);
  output.writeUInt32LE(jsonChunk.length, 12);
  output.writeUInt32LE(0x4e4f534a, 16);
  jsonChunk.copy(output, 20);
  const binaryOffset = 20 + jsonChunk.length;
  output.writeUInt32LE(binaryChunk.length, binaryOffset);
  output.writeUInt32LE(0x004e4942, binaryOffset + 4);
  binaryChunk.copy(output, binaryOffset + 8);
  return output;
}

test('旧版高光光泽材质会自动转换为标准 PBR 并保留内嵌贴图数据', () => {
  const sourceBinary = Buffer.from([9, 8, 7, 6, 5]);
  const source = makeGlb({
    asset: { version: '2.0' },
    extensionsUsed: ['KHR_materials_pbrSpecularGlossiness', 'KHR_texture_transform'],
    extensionsRequired: ['KHR_materials_pbrSpecularGlossiness'],
    materials: [{
      name: 'Feathers',
      extensions: {
        KHR_materials_pbrSpecularGlossiness: {
          diffuseFactor: [0.8, 0.7, 0.6, 1],
          diffuseTexture: { index: 0, texCoord: 1 },
          glossinessFactor: 0.75
        }
      }
    }]
  }, sourceBinary);

  const result = fixLegacySpecGlossGlb(source);
  const inspected = inspectGlb(result.buffer);
  const material = inspected.json.materials[0];

  assert.equal(result.changed, true);
  assert.equal(result.convertedMaterials, 1);
  assert.deepEqual(material.pbrMetallicRoughness.baseColorFactor, [0.8, 0.7, 0.6, 1]);
  assert.deepEqual(material.pbrMetallicRoughness.baseColorTexture, { index: 0, texCoord: 1 });
  assert.equal(material.pbrMetallicRoughness.metallicFactor, 0);
  assert.equal(material.pbrMetallicRoughness.roughnessFactor, 0.25);
  assert.equal(material.extensions, undefined);
  assert.deepEqual(inspected.json.extensionsUsed, ['KHR_texture_transform']);
  assert.equal(inspected.json.extensionsRequired, undefined);
  assert.deepEqual(inspected.binary.subarray(0, sourceBinary.length), sourceBinary);
});

test('标准 GLB 不会被改写', () => {
  const source = makeGlb({ asset: { version: '2.0' }, materials: [{ pbrMetallicRoughness: {} }] });
  const result = fixLegacySpecGlossGlb(source);
  assert.equal(result.changed, false);
  assert.equal(result.buffer, source);
});
