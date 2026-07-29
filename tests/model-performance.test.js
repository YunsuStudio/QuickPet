'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { rateModelPerformance } = require('../src/shared/model-performance');

test('轻量模型获得 A 级并允许高画质', () => {
  const result = rateModelPerformance({ format: 'glb', size: 4 * 1024 * 1024, vertexCount: 50000, textureCount: 3, materialCount: 4, hasSkeleton: true });
  assert.equal(result.grade, 'A');
  assert.equal(result.recommendedMode, 'quality');
});

test('超大高面数模型降为 D 级并建议无感模式', () => {
  const result = rateModelPerformance({ format: 'glb', size: 70 * 1024 * 1024, vertexCount: 500000, textureCount: 20, materialCount: 30, hasSkeleton: true });
  assert.equal(result.grade, 'D');
  assert.equal(result.recommendedMode, 'efficient');
  assert.ok(result.reasons.length >= 3);
});
