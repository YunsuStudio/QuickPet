'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { fixLegacySpecGlossGlb, inspectGlb, SPEC_GLOSS_EXTENSION } = require('./gltf-material-fixer');
const { rateModelPerformance } = require('../shared/model-performance');

const MAX_MODEL_BYTES = 80 * 1024 * 1024;
const MAX_LIVE2D_FILE_BYTES = 32 * 1024 * 1024;
const MAX_LIVE2D_PACKAGE_BYTES = 160 * 1024 * 1024;
const MAX_LIVE2D_REFERENCES = 500;

function guessAnimationMap(animationNames) {
  const find = (pattern) => animationNames.find((name) => pattern.test(name)) || '';
  return {
    idle: find(/idle|breath|stand(?!up)|rest/i) || animationNames[0] || '',
    walk: find(/walk|trot/i) || find(/run/i) || animationNames[1] || animationNames[0] || '',
    run: find(/run|sprint|gallop/i),
    sit: find(/sit|seat/i),
    sleep: find(/sleep|lay|lie|nap/i),
    stretch: find(/stretch/i)
  };
}

function safeReference(baseDirectory, reference) {
  if (!reference || typeof reference !== 'string') return null;
  const base = path.resolve(baseDirectory);
  const resolved = path.resolve(base, reference.replaceAll('/', path.sep));
  return resolved === base || resolved.startsWith(`${base}${path.sep}`) ? resolved : null;
}

function collectLive2dReferences(config) {
  const refs = config.FileReferences || {};
  const files = [refs.Moc, refs.Physics, refs.Pose, refs.UserData, refs.DisplayInfo, ...(refs.Textures || [])];
  for (const expression of refs.Expressions || []) files.push(expression.File);
  for (const motions of Object.values(refs.Motions || {})) {
    for (const motion of motions || []) files.push(motion.File, motion.Sound);
  }
  return [...new Set(files.filter(Boolean).map(String))];
}

function inspectLive2dFile(sourcePath, limits = {}) {
  const maxFileBytes = Number(limits.maxFileBytes) || MAX_LIVE2D_FILE_BYTES;
  const maxPackageBytes = Number(limits.maxPackageBytes) || MAX_LIVE2D_PACKAGE_BYTES;
  const sourceBytes = fs.statSync(sourcePath).size;
  if (sourceBytes > 5 * 1024 * 1024) throw new Error('Live2D 配置文件不能超过 5MB');
  const source = fs.readFileSync(sourcePath);
  const config = JSON.parse(source.toString('utf8'));
  const baseDirectory = path.dirname(sourcePath);
  const references = collectLive2dReferences(config);
  if (references.length > MAX_LIVE2D_REFERENCES) throw new Error(`Live2D 引用文件不能超过 ${MAX_LIVE2D_REFERENCES} 个`);
  const missingFiles = references.filter((reference) => {
    const resolved = safeReference(baseDirectory, reference);
    return !resolved || !fs.existsSync(resolved);
  });
  const textures = config.FileReferences?.Textures || [];
  const animationNames = Object.keys(config.FileReferences?.Motions || {});
  const expressionNames = (config.FileReferences?.Expressions || []).map((item, index) => String(item.Name || `表情 ${index + 1}`));
  const warnings = [];
  if (!config.FileReferences?.Moc) warnings.push('没有声明 Moc 核心模型文件');
  if (!textures.length) warnings.push('没有声明纹理文件');
  if (!animationNames.length) warnings.push('没有动作组，将只播放呼吸和眨眼');
  if (!config.FileReferences?.Physics) warnings.push('没有物理配置，头发和衣物摆动可能较少');
  let size = source.length;
  for (const reference of references) {
    const resolved = safeReference(baseDirectory, reference);
    if (!resolved || !fs.existsSync(resolved)) continue;
    const fileBytes = fs.statSync(resolved).size;
    if (fileBytes > maxFileBytes) throw new Error(`Live2D 单个文件不能超过 ${Math.max(1, Math.round(maxFileBytes / 1024 / 1024))}MB`);
    size += fileBytes;
    if (size > maxPackageBytes) throw new Error(`Live2D 总大小不能超过 ${Math.max(1, Math.round(maxPackageBytes / 1024 / 1024))}MB`);
  }
  let thumbnailData = '';
  const firstTexture = safeReference(baseDirectory, textures[0]);
  if (firstTexture && fs.existsSync(firstTexture)) {
    const textureBytes = fs.statSync(firstTexture).size;
    if (textureBytes <= 8 * 1024 * 1024) {
      const texture = fs.readFileSync(firstTexture);
      const mime = ['.jpg', '.jpeg'].includes(path.extname(firstTexture).toLowerCase()) ? 'image/jpeg' : 'image/png';
      thumbnailData = `data:${mime};base64,${texture.toString('base64')}`;
    }
  }
  const result = { format: 'live2d', name: path.basename(sourcePath).replace(/\.model3\.json$/i, ''), size, textureCount: textures.length, materialCount: 0, animationNames, expressionNames, thumbnailData, references, missingFiles, warnings, config };
  result.performance = rateModelPerformance(result);
  return result;
}

function inspectionFromGlb(sourcePath, source, json) {
  const animationNames = (json.animations || []).map((item, index) => String(item.name || `动作 ${index + 1}`));
  const vertexCount = (json.meshes || []).reduce((sum, mesh) => sum + (mesh.primitives || []).reduce((part, primitive) => part + (Number(json.accessors?.[primitive.attributes?.POSITION]?.count) || 0), 0), 0);
  const warnings = [];
  if (!(json.textures || []).length) warnings.push('模型没有纹理，可能显示为纯色或白色');
  if (!animationNames.length) warnings.push('模型没有动作，将使用静态待机');
  if (!(json.skins || []).length) warnings.push('没有骨骼蒙皮，无法播放四足走路动作');
  if (vertexCount > 250000) warnings.push('模型面数较高，无感模式会自动降低渲染精度');
  const result = {
    format: path.extname(sourcePath).toLowerCase() === '.vrm' ? 'vrm' : 'glb',
    name: path.basename(sourcePath, path.extname(sourcePath)),
    size: source.length,
    textureCount: (json.textures || []).length,
    materialCount: (json.materials || []).length,
    animationNames,
    expressionNames: [],
    vertexCount,
    hasSkeleton: Boolean((json.skins || []).length),
    missingFiles: [],
    warnings
  };
  result.performance = rateModelPerformance(result);
  return result;
}

function inspectGlbFile(sourcePath) {
  const source = fs.readFileSync(sourcePath);
  if (source.length > MAX_MODEL_BYTES) throw new Error('3D 模型不能超过 80MB');
  return inspectionFromGlb(sourcePath, source, inspectGlb(source).json);
}

class ModelLibrary {
  constructor({ directory, store }) {
    this.directory = directory;
    this.store = store;
    fs.mkdirSync(directory, { recursive: true });
  }

  modelPath(model) {
    if (model.format === 'live2d') return path.join(this.directory, 'live2d', model.id, path.basename(model.entryFile || model.fileName));
    return path.join(this.directory, path.basename(model.fileName));
  }

  inspectFile(sourcePath) {
    return sourcePath.toLowerCase().endsWith('.model3.json') ? inspectLive2dFile(sourcePath) : inspectGlbFile(sourcePath);
  }

  importFile(sourcePath, preferredName = '') {
    const extension = path.extname(sourcePath).toLowerCase();
    if (extension === '.json' && sourcePath.toLowerCase().endsWith('.model3.json')) return this.importLive2d(sourcePath, preferredName);
    if (!['.glb', '.vrm'].includes(extension)) throw new Error('只支持 GLB、VRM 或 Live2D model3.json');
    const source = fs.readFileSync(sourcePath);
    if (source.length > MAX_MODEL_BYTES) throw new Error('3D 模型不能超过 80MB');
    const inspected = inspectGlb(source);
    const inspection = inspectionFromGlb(sourcePath, source, inspected.json);
    const animationNames = inspection.animationNames;
    const usesLegacyMaterial = (inspected.json.extensionsUsed || []).includes(SPEC_GLOSS_EXTENSION)
      || (inspected.json.materials || []).some((item) => item.extensions?.[SPEC_GLOSS_EXTENSION]);
    const fixed = fixLegacySpecGlossGlb(source);
    const id = crypto.randomUUID();
    const format = extension === '.vrm' ? 'vrm' : 'glb';
    const fileName = `${id}.${format}`;
    const destination = path.join(this.directory, fileName);
    const temporary = `${destination}.tmp`;
    fs.writeFileSync(temporary, fixed.buffer);
    fs.renameSync(temporary, destination);
    try {
      return this.store.addModel({
        id,
        name: String(preferredName || inspection.name).trim(),
        fileName,
        entryFile: fileName,
        format,
        size: fixed.buffer.length,
        createdAt: Date.now(),
        materialStatus: fixed.changed ? 'fixed-legacy' : (usesLegacyMaterial ? 'unknown' : 'standard'),
        convertedMaterials: fixed.convertedMaterials,
        textureCount: inspection.textureCount,
        materialCount: inspection.materialCount,
        animationNames,
        expressionNames: [],
        inspection: { warnings: inspection.warnings, hasSkeleton: inspection.hasSkeleton, vertexCount: inspection.vertexCount, missingFiles: [] },
        transform: { scale: 1, rotationY: 0, flip: false, verticalOffset: 0 },
        animationMap: guessAnimationMap(animationNames)
      });
    } catch (error) {
      try { fs.unlinkSync(destination); } catch {}
      throw error;
    }
  }

  importLive2d(sourcePath, preferredName = '') {
    const inspection = inspectLive2dFile(sourcePath);
    if (inspection.missingFiles.length) throw new Error(`Live2D 缺少文件：${inspection.missingFiles.slice(0, 5).join('、')}`);
    const id = crypto.randomUUID();
    const entryFile = path.basename(sourcePath);
    const packageDirectory = path.join(this.directory, 'live2d', id);
    const baseDirectory = path.dirname(sourcePath);
    fs.mkdirSync(packageDirectory, { recursive: true });
    try {
      for (const reference of [entryFile, ...inspection.references]) {
        const sourceFile = reference === entryFile ? sourcePath : safeReference(baseDirectory, reference);
        const destination = path.resolve(packageDirectory, reference.replaceAll('/', path.sep));
        if (!sourceFile || !(destination === packageDirectory || destination.startsWith(`${packageDirectory}${path.sep}`))) throw new Error('Live2D 包含不安全的外部路径');
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.copyFileSync(sourceFile, destination);
      }
      const model = this.store.addModel({
        id,
        name: String(preferredName || inspection.name).trim(),
        fileName: entryFile,
        entryFile,
        format: 'live2d',
        size: inspection.size,
        createdAt: Date.now(),
        materialStatus: 'standard',
        textureCount: inspection.textureCount,
        materialCount: 0,
        thumbnailData: inspection.thumbnailData,
        animationNames: inspection.animationNames,
        expressionNames: inspection.expressionNames,
        inspection: { warnings: inspection.warnings, hasSkeleton: true, vertexCount: 0, missingFiles: [] },
        transform: { scale: 1, rotationY: 0, flip: false, verticalOffset: 0 },
        animationMap: {}
      });
      this.store.updateSettings({ petRenderMode: '2d' });
      return model;
    } catch (error) {
      try { fs.rmSync(packageDirectory, { recursive: true, force: true }); } catch {}
      throw error;
    }
  }

  migrateLegacyModel(legacyPath) {
    const settings = this.store.data.settings;
    if (settings.activeModelId || settings.petModelPreset !== 'custom' || !fs.existsSync(legacyPath)) return null;
    return this.importFile(legacyPath, settings.petModelName || '已导入模型');
  }

  getActiveModel() {
    const id = this.store.data.settings.activeModelId;
    return this.store.data.models.find((item) => item.id === id) || null;
  }

  getActiveBytes() {
    const model = this.getActiveModel();
    if (!model || model.format === 'live2d') return null;
    const filePath = this.modelPath(model);
    return fs.existsSync(filePath) ? fs.readFileSync(filePath) : null;
  }

  remove(id) {
    const model = this.store.data.models.find((item) => item.id === id);
    if (!model) return false;
    const removed = this.store.removeModel(id);
    if (!removed) return false;
    try {
      if (removed.format === 'live2d') fs.rmSync(path.join(this.directory, 'live2d', removed.id), { recursive: true, force: true });
      else fs.unlinkSync(this.modelPath(removed));
    } catch {}
    return true;
  }
}

module.exports = { ModelLibrary, MAX_MODEL_BYTES, guessAnimationMap, inspectLive2dFile, inspectGlbFile, collectLive2dReferences, safeReference };
