'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const MAX_ASSET_BYTES = 24 * 1024 * 1024;
const MIME_EXTENSIONS = new Map([
  ['png', 'png'],
  ['jpeg', 'jpg'],
  ['jpg', 'jpg'],
  ['webp', 'webp'],
  ['gif', 'gif']
]);

class AssetStore {
  constructor(directory) {
    this.directory = path.resolve(directory);
    fs.mkdirSync(this.directory, { recursive: true });
  }

  resolve(reference) {
    if (!reference) return '';
    const target = path.resolve(this.directory, String(reference));
    return target.startsWith(`${this.directory}${path.sep}`) ? target : '';
  }

  saveDataUrl(dataUrl, group = 'misc', name = '') {
    const match = /^data:image\/([a-z0-9.+-]+);base64,([a-z0-9+/=\r\n]+)$/i.exec(String(dataUrl || ''));
    if (!match) throw new Error('图片数据格式无效');
    const extension = MIME_EXTENSIONS.get(match[1].toLowerCase());
    if (!extension) throw new Error('只支持 PNG、JPG、WEBP 和 GIF 图片');
    const buffer = Buffer.from(match[2], 'base64');
    if (!buffer.length || buffer.length > MAX_ASSET_BYTES) throw new Error('图片资源不能超过 24MB');
    const safeGroup = String(group).replace(/[^a-z0-9-]/gi, '').slice(0, 24) || 'misc';
    const safeName = String(name).replace(/[^a-z0-9-]/gi, '').slice(0, 40) || 'asset';
    const digest = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 20);
    const reference = path.join(safeGroup, `${safeName}-${digest}.${extension}`);
    const destination = this.resolve(reference);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    if (!fs.existsSync(destination)) {
      const temporary = `${destination}.tmp-${process.pid}`;
      fs.writeFileSync(temporary, buffer);
      fs.renameSync(temporary, destination);
    }
    return reference;
  }

  url(reference) {
    const target = this.resolve(reference);
    return target && fs.existsSync(target) ? pathToFileURL(target).href : '';
  }
}

module.exports = { AssetStore, MAX_ASSET_BYTES };
