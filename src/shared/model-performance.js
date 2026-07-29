'use strict';

function rateModelPerformance(input = {}) {
  const format = input.format === 'live2d' ? 'live2d' : '3d';
  const size = Math.max(0, Number(input.size) || 0);
  const vertexCount = Math.max(0, Number(input.vertexCount) || 0);
  const textureCount = Math.max(0, Number(input.textureCount) || 0);
  const materialCount = Math.max(0, Number(input.materialCount) || 0);
  let score = 100;
  const reasons = [];

  if (size > 60 * 1024 * 1024) { score -= 30; reasons.push('文件超过 60 MB'); }
  else if (size > 30 * 1024 * 1024) { score -= 16; reasons.push('文件超过 30 MB'); }
  else if (size > 15 * 1024 * 1024) { score -= 7; }

  if (format === '3d') {
    if (vertexCount > 400000) { score -= 38; reasons.push('顶点超过 40 万'); }
    else if (vertexCount > 250000) { score -= 25; reasons.push('顶点超过 25 万'); }
    else if (vertexCount > 120000) { score -= 12; reasons.push('顶点超过 12 万'); }
    if (textureCount > 16) { score -= 18; reasons.push('纹理数量较多'); }
    else if (textureCount > 8) score -= 8;
    if (materialCount > 20) { score -= 12; reasons.push('材质数量较多'); }
    if (input.hasSkeleton === false) reasons.push('没有骨骼，只能静态显示');
  } else if (textureCount > 10) {
    score -= 12;
    reasons.push('Live2D 纹理数量较多');
  }

  score = Math.max(0, Math.min(100, score));
  const grade = score >= 88 ? 'A' : score >= 72 ? 'B' : score >= 52 ? 'C' : 'D';
  return {
    score,
    grade,
    label: { A: '轻量', B: '适中', C: '偏重', D: '高负载' }[grade],
    recommendedMode: grade === 'A' ? 'quality' : grade === 'B' ? 'balanced' : 'efficient',
    reasons
  };
}

module.exports = { rateModelPerformance };
