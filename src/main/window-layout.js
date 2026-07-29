'use strict';

function centeredBounds(workArea, preferredWidth, preferredHeight, margin = 15) {
  const width = Math.max(1, Math.min(Number(preferredWidth) || 1, workArea.width - margin * 2));
  const height = Math.max(1, Math.min(Number(preferredHeight) || 1, workArea.height - margin * 2));
  return {
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + (workArea.height - height) / 2),
    width: Math.round(width),
    height: Math.round(height)
  };
}

module.exports = { centeredBounds };
