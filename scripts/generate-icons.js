'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const OUTPUT_SIZE = 256;
const SCALE = 2;
const width = OUTPUT_SIZE * SCALE;
const height = OUTPUT_SIZE * SCALE;
const pixels = Buffer.alloc(width * height * 4);

function blendPixel(x, y, color) {
  x = Math.round(x);
  y = Math.round(y);
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  const offset = (y * width + x) * 4;
  const alpha = color[3] / 255;
  const inverse = 1 - alpha;
  pixels[offset] = Math.round(color[0] * alpha + pixels[offset] * inverse);
  pixels[offset + 1] = Math.round(color[1] * alpha + pixels[offset + 1] * inverse);
  pixels[offset + 2] = Math.round(color[2] * alpha + pixels[offset + 2] * inverse);
  pixels[offset + 3] = Math.round((alpha + (pixels[offset + 3] / 255) * inverse) * 255);
}

function ellipse(cx, cy, rx, ry, color) {
  cx *= SCALE; cy *= SCALE; rx *= SCALE; ry *= SCALE;
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y += 1) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x += 1) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      if (dx * dx + dy * dy <= 1) blendPixel(x, y, color);
    }
  }
}

function roundedRect(x, y, w, h, radius, topColor, bottomColor = topColor) {
  x *= SCALE; y *= SCALE; w *= SCALE; h *= SCALE; radius *= SCALE;
  for (let py = y; py < y + h; py += 1) {
    const progress = (py - y) / Math.max(1, h - 1);
    const color = topColor.map((value, index) => index === 3 ? value : Math.round(value + (bottomColor[index] - value) * progress));
    for (let px = x; px < x + w; px += 1) {
      const closestX = Math.max(x + radius, Math.min(px, x + w - radius));
      const closestY = Math.max(y + radius, Math.min(py, y + h - radius));
      const dx = px - closestX;
      const dy = py - closestY;
      if (dx * dx + dy * dy <= radius * radius) blendPixel(px, py, color);
    }
  }
}

function polygon(points, color) {
  const scaled = points.map(([x, y]) => [x * SCALE, y * SCALE]);
  const minX = Math.floor(Math.min(...scaled.map(([x]) => x)));
  const maxX = Math.ceil(Math.max(...scaled.map(([x]) => x)));
  const minY = Math.floor(Math.min(...scaled.map(([, y]) => y)));
  const maxY = Math.ceil(Math.max(...scaled.map(([, y]) => y)));
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      let inside = false;
      for (let i = 0, j = scaled.length - 1; i < scaled.length; j = i++) {
        const [xi, yi] = scaled[i];
        const [xj, yj] = scaled[j];
        const intersects = ((yi > y) !== (yj > y)) && x < ((xj - xi) * (y - yi)) / (yj - yi || 1) + xi;
        if (intersects) inside = !inside;
      }
      if (inside) blendPixel(x, y, color);
    }
  }
}

function render() {
  roundedRect(8, 8, 240, 240, 61, [145, 131, 255, 255], [99, 82, 215, 255]);
  ellipse(128, 145, 79, 77, [255, 243, 220, 255]);
  polygon([[57, 113], [50, 50], [103, 82]], [255, 243, 220, 255]);
  polygon([[199, 113], [206, 50], [153, 82]], [255, 243, 220, 255]);
  polygon([[60, 83], [57, 62], [82, 77]], [244, 166, 162, 220]);
  polygon([[196, 83], [199, 62], [174, 77]], [244, 166, 162, 220]);
  ellipse(122, 93, 57, 31, [220, 133, 80, 255]);
  ellipse(82, 110, 30, 27, [220, 133, 80, 255]);
  ellipse(94, 143, 14, 18, [78, 59, 79, 255]);
  ellipse(162, 143, 14, 18, [78, 59, 79, 255]);
  ellipse(90, 137, 4, 5, [255, 255, 255, 255]);
  ellipse(158, 137, 4, 5, [255, 255, 255, 255]);
  polygon([[119, 164], [128, 171], [137, 164], [128, 160]], [221, 125, 124, 255]);
  ellipse(128, 197, 23, 23, [117, 102, 237, 255]);
  polygon([[128, 180], [133, 192], [145, 197], [133, 202], [128, 214], [123, 202], [111, 197], [123, 192]], [255, 255, 255, 255]);
}

function downsample() {
  const output = Buffer.alloc(OUTPUT_SIZE * OUTPUT_SIZE * 4);
  for (let y = 0; y < OUTPUT_SIZE; y += 1) {
    for (let x = 0; x < OUTPUT_SIZE; x += 1) {
      const sums = [0, 0, 0, 0];
      for (let sy = 0; sy < SCALE; sy += 1) {
        for (let sx = 0; sx < SCALE; sx += 1) {
          const source = (((y * SCALE + sy) * width) + x * SCALE + sx) * 4;
          for (let channel = 0; channel < 4; channel += 1) sums[channel] += pixels[source + channel];
        }
      }
      const target = (y * OUTPUT_SIZE + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) output[target + channel] = Math.round(sums[channel] / (SCALE * SCALE));
    }
  }
  return output;
}

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function encodePng(rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(OUTPUT_SIZE, 0);
  header.writeUInt32BE(OUTPUT_SIZE, 4);
  header[8] = 8;
  header[9] = 6;
  const scanlines = Buffer.alloc((OUTPUT_SIZE * 4 + 1) * OUTPUT_SIZE);
  for (let y = 0; y < OUTPUT_SIZE; y += 1) {
    const target = y * (OUTPUT_SIZE * 4 + 1);
    scanlines[target] = 0;
    rgba.copy(scanlines, target + 1, y * OUTPUT_SIZE * 4, (y + 1) * OUTPUT_SIZE * 4);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(scanlines, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function encodeIco(png) {
  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  header[6] = 0;
  header[7] = 0;
  header[8] = 0;
  header[9] = 0;
  header.writeUInt16LE(1, 10);
  header.writeUInt16LE(32, 12);
  header.writeUInt32LE(png.length, 14);
  header.writeUInt32LE(22, 18);
  return Buffer.concat([header, png]);
}

render();
const png = encodePng(downsample());
const outputDirectory = path.join(__dirname, '..', 'assets');
fs.writeFileSync(path.join(outputDirectory, 'app-icon.png'), png);
fs.writeFileSync(path.join(outputDirectory, 'app-icon.ico'), encodeIco(png));
console.log('Generated assets/app-icon.png and assets/app-icon.ico');
