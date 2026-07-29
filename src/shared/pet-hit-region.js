'use strict';

(function exposePetHitRegion(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.QuickPetHitRegion = api;
})(globalThis, () => {
  function isPetPointInteractive({ x, y, width, height, renderMode = '2d' }) {
    const safeWidth = Number(width);
    const safeHeight = Number(height);
    if (![x, y, safeWidth, safeHeight].every(Number.isFinite) || safeWidth <= 0 || safeHeight <= 0) return false;
    const normalizedX = Number(x) / safeWidth;
    const normalizedY = Number(y) / safeHeight;
    const is3d = renderMode === '3d';
    const radiusX = is3d ? 0.39 : 0.36;
    const radiusY = is3d ? 0.4 : 0.38;
    const centerY = is3d ? 0.52 : 0.61;
    const offsetX = (normalizedX - 0.5) / radiusX;
    const offsetY = (normalizedY - centerY) / radiusY;
    return offsetX * offsetX + offsetY * offsetY <= 1;
  }

  function shouldActivatePetDrag({ startX, startY, currentX, currentY, threshold = 5 }) {
    if (![startX, startY, currentX, currentY].every(Number.isFinite)) return false;
    return Math.hypot(currentX - startX, currentY - startY) >= Math.max(1, Number(threshold) || 5);
  }

  return { isPetPointInteractive, shouldActivatePetDrag };
});
