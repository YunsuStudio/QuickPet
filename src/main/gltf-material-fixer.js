'use strict';

const GLB_MAGIC = 'glTF';
const GLB_VERSION = 2;
const JSON_CHUNK_TYPE = 0x4e4f534a;
const BIN_CHUNK_TYPE = 0x004e4942;
const SPEC_GLOSS_EXTENSION = 'KHR_materials_pbrSpecularGlossiness';

function inspectGlb(input) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (buffer.length < 20 || buffer.toString('ascii', 0, 4) !== GLB_MAGIC) {
    throw new Error('不是有效的 GLB 文件');
  }
  if (buffer.readUInt32LE(4) !== GLB_VERSION) throw new Error('只支持 GLB 2.0 模型');
  const declaredLength = buffer.readUInt32LE(8);
  if (declaredLength !== buffer.length) throw new Error('GLB 文件长度信息不正确');

  const chunks = [];
  let offset = 12;
  while (offset < buffer.length) {
    if (offset + 8 > buffer.length) throw new Error('GLB 数据块不完整');
    const length = buffer.readUInt32LE(offset);
    const type = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + length;
    if (end > buffer.length) throw new Error('GLB 数据块长度超出文件范围');
    chunks.push({ type, data: buffer.subarray(start, end) });
    offset = end;
  }

  const jsonChunk = chunks.find((chunk) => chunk.type === JSON_CHUNK_TYPE);
  if (!jsonChunk) throw new Error('GLB 缺少 JSON 数据块');
  const jsonText = jsonChunk.data.toString('utf8').replace(/[\u0000\u0020]+$/g, '');
  const json = JSON.parse(jsonText);
  const binaryChunk = chunks.find((chunk) => chunk.type === BIN_CHUNK_TYPE);
  return { buffer, json, binary: binaryChunk?.data || Buffer.alloc(0), chunks };
}

function withoutExtension(list) {
  if (!Array.isArray(list)) return undefined;
  const next = list.filter((name) => name !== SPEC_GLOSS_EXTENSION);
  return next.length ? next : undefined;
}

function clamp01(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(1, Math.max(0, number)) : fallback;
}

function convertMaterial(material) {
  const legacy = material?.extensions?.[SPEC_GLOSS_EXTENSION];
  if (!legacy) return false;

  const pbr = { ...(material.pbrMetallicRoughness || {}) };
  if (!pbr.baseColorTexture && legacy.diffuseTexture) {
    pbr.baseColorTexture = { ...legacy.diffuseTexture };
  }
  if (!pbr.baseColorFactor && Array.isArray(legacy.diffuseFactor)) {
    pbr.baseColorFactor = legacy.diffuseFactor.slice(0, 4);
  }
  if (pbr.metallicFactor === undefined) pbr.metallicFactor = 0;
  if (pbr.roughnessFactor === undefined) {
    pbr.roughnessFactor = 1 - clamp01(legacy.glossinessFactor, 1);
  }
  material.pbrMetallicRoughness = pbr;

  const remainingExtensions = { ...material.extensions };
  delete remainingExtensions[SPEC_GLOSS_EXTENSION];
  if (Object.keys(remainingExtensions).length) material.extensions = remainingExtensions;
  else delete material.extensions;
  return true;
}

function encodeJsonChunk(json) {
  const source = Buffer.from(JSON.stringify(json), 'utf8');
  const padding = (4 - (source.length % 4)) % 4;
  return padding ? Buffer.concat([source, Buffer.alloc(padding, 0x20)]) : source;
}

function rebuildGlb(chunks, replacementJson) {
  const encodedChunks = chunks.map((chunk) => ({
    type: chunk.type,
    data: chunk.type === JSON_CHUNK_TYPE ? replacementJson : chunk.data
  }));
  const totalLength = 12 + encodedChunks.reduce((total, chunk) => total + 8 + chunk.data.length, 0);
  const output = Buffer.alloc(totalLength);
  output.write(GLB_MAGIC, 0, 'ascii');
  output.writeUInt32LE(GLB_VERSION, 4);
  output.writeUInt32LE(totalLength, 8);
  let offset = 12;
  for (const chunk of encodedChunks) {
    output.writeUInt32LE(chunk.data.length, offset);
    output.writeUInt32LE(chunk.type, offset + 4);
    chunk.data.copy(output, offset + 8);
    offset += 8 + chunk.data.length;
  }
  return output;
}

function fixLegacySpecGlossGlb(input) {
  const inspected = inspectGlb(input);
  const json = structuredClone(inspected.json);
  let convertedMaterials = 0;
  for (const material of json.materials || []) {
    if (convertMaterial(material)) convertedMaterials += 1;
  }
  if (!convertedMaterials) {
    return { buffer: inspected.buffer, changed: false, convertedMaterials: 0 };
  }

  const extensionsUsed = withoutExtension(json.extensionsUsed);
  const extensionsRequired = withoutExtension(json.extensionsRequired);
  if (extensionsUsed) json.extensionsUsed = extensionsUsed;
  else delete json.extensionsUsed;
  if (extensionsRequired) json.extensionsRequired = extensionsRequired;
  else delete json.extensionsRequired;

  return {
    buffer: rebuildGlb(inspected.chunks, encodeJsonChunk(json)),
    changed: true,
    convertedMaterials
  };
}

module.exports = {
  SPEC_GLOSS_EXTENSION,
  fixLegacySpecGlossGlb,
  inspectGlb
};
