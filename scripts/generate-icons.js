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
  const ink = [17, 17, 17, 255];
  const paper = [244, 244, 239, 255];
  roundedRect(8, 8, 240, 240, 61, ink);
  polygon([[69, 87], [62, 43], [105, 71]], paper);
  polygon([[187, 87], [194, 43], [151, 71]], paper);
  ellipse(128, 132, 82, 82, paper);

  for (let y = 50 * SCALE; y <= 214 * SCALE; y += 1) {
    for (let x = 46 * SCALE; x <= 210 * SCALE; x += 1) {
      const logicalX = x / SCALE;
      const logicalY = y / SCALE;
      const insideOuter = (logicalX - 128) ** 2 + (logicalY - 132) ** 2 <= 82 ** 2;
      if (!insideOuter) continue;
      let black = logicalX >= 128;
      if ((logicalX - 128) ** 2 + (logicalY - 91) ** 2 <= 41 ** 2) black = true;
      if ((logicalX - 128) ** 2 + (logicalY - 173) ** 2 <= 41 ** 2) black = false;
      if (black) blendPixel(x, y, ink);
    }
  }

  ellipse(128, 91, 14, 14, paper);
  ellipse(128, 173, 14, 14, ink);

  const rim = [215, 215, 208, 255];
  for (let y = 48 * SCALE; y <= 216 * SCALE; y += 1) {
    for (let x = 44 * SCALE; x <= 212 * SCALE; x += 1) {
      const logicalX = x / SCALE;
      const logicalY = y / SCALE;
      const distanceSquared = (logicalX - 128) ** 2 + (logicalY - 132) ** 2;
      if (distanceSquared >= 80 ** 2 && distanceSquared <= 82 ** 2) blendPixel(x, y, rim);
    }
  }
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
