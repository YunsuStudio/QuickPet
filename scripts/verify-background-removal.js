'use strict';

const { app, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { removeBackground } = require('../src/main/background-removal');

function createOpaqueFixture() {
  const width = 420;
  const height = 420;
  const bitmap = Buffer.alloc(width * height * 4);
  const setPixel = (x, y, red, green, blue, alpha = 255) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const offset = (y * width + x) * 4;
    bitmap[offset] = blue;
    bitmap[offset + 1] = green;
    bitmap[offset + 2] = red;
    bitmap[offset + 3] = alpha;
  };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const wave = Math.round(18 * Math.sin(x / 37) * Math.cos(y / 49));
      setPixel(x, y, 80 + Math.round(y * .18), 145 + wave, 184 - Math.round(x * .1));
    }
  }
  const ellipse = (cx, cy, rx, ry, color) => {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y += 1) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x += 1) {
        const dx = (x - cx) / rx;
        const dy = (y - cy) / ry;
        if (dx * dx + dy * dy <= 1) setPixel(x, y, ...color);
      }
    }
  };
  ellipse(210, 238, 127, 145, [246, 221, 183]);
  ellipse(175, 132, 85, 58, [211, 119, 70]);
  ellipse(162, 230, 20, 28, [70, 53, 68]);
  ellipse(258, 230, 20, 28, [70, 53, 68]);
  ellipse(210, 326, 34, 34, [117, 102, 237]);
  return nativeImage.createFromBitmap(bitmap, { width, height, scaleFactor: 1 });
}

app.whenReady().then(async () => {
  try {
    const input = createOpaqueFixture();
    fs.writeFileSync(path.join(__dirname, '..', 'tests', 'background-removal-input.png'), input.toPNG());
    const startedAt = Date.now();
    const result = await removeBackground(input, { maxSize: 512, maxSegmentSize: 320 });
    const output = Buffer.from(result.dataUrl.split(',')[1], 'base64');
    const outputPath = path.join(__dirname, '..', 'tests', 'background-removal-output.png');
    fs.writeFileSync(outputPath, output);
    console.log(JSON.stringify({ outputPath, status: result.status, foregroundRatio: result.foregroundRatio, elapsedMs: Date.now() - startedAt }));
    app.exit(0);
  } catch (error) {
    console.error(error.stack || error.message);
    app.exit(1);
  }
});
