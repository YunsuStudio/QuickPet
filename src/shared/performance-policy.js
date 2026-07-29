'use strict';

function normalizePerformanceMode(mode) {
  return ['efficient', 'balanced', 'quality'].includes(mode) ? mode : 'efficient';
}

function targetFps(mode, motionMode, interacting = false, secondary = false) {
  const normalized = normalizePerformanceMode(mode);
  let fps;
  if (normalized === 'quality') fps = 60;
  else if (interacting) fps = 60;
  else if (['walk', 'run'].includes(motionMode)) fps = normalized === 'balanced' ? 60 : 45;
  else if (['sleep', 'sit'].includes(motionMode)) fps = normalized === 'balanced' ? 24 : 15;
  else fps = normalized === 'balanced' ? 45 : 30;
  if (!secondary || interacting) return fps;
  const companionLimit = normalized === 'quality'
    ? (['walk', 'run'].includes(motionMode) ? 45 : 24)
    : (['walk', 'run'].includes(motionMode) ? 24 : 15);
  return Math.min(fps, companionLimit);
}

function pixelRatioLimit(mode) {
  return { efficient: 1.15, balanced: 1.4, quality: 1.8 }[normalizePerformanceMode(mode)];
}

function movementInterval(mode) {
  return normalizePerformanceMode(mode) === 'efficient' ? 22 : 17;
}

module.exports = { normalizePerformanceMode, targetFps, pixelRatioLimit, movementInterval };
