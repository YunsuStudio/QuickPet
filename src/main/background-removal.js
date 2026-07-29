'use strict';

const { nativeImage } = require('electron');
const path = require('node:path');
const { Worker } = require('node:worker_threads');

let segmentationWorker;
let nextRequestId = 0;
const pendingRequests = new Map();

function getSegmentationWorker() {
  if (segmentationWorker) return segmentationWorker;
  segmentationWorker = new Worker(path.join(__dirname, 'background-removal-worker.js'));
  segmentationWorker.unref();
  segmentationWorker.on('message', ({ id, result, error }) => {
    const pending = pendingRequests.get(id);
    if (!pending) return;
    pendingRequests.delete(id);
    if (error) pending.reject(new Error(error));
    else pending.resolve(result);
  });
  segmentationWorker.on('error', (error) => {
    for (const pending of pendingRequests.values()) pending.reject(error);
    pendingRequests.clear();
    segmentationWorker = null;
  });
  segmentationWorker.on('exit', (code) => {
    if (code && pendingRequests.size) {
      const error = new Error(`自动抠图进程异常退出 (${code})`);
      for (const pending of pendingRequests.values()) pending.reject(error);
      pendingRequests.clear();
    }
    segmentationWorker = null;
  });
  return segmentationWorker;
}

function segmentForeground(bitmap, width, height, outputWidth, outputHeight) {
  const id = ++nextRequestId;
  const transferable = Uint8Array.from(bitmap);
  return new Promise((resolve, reject) => {
    pendingRequests.set(id, { resolve, reject });
    getSegmentationWorker().postMessage({ id, payload: { bitmap: transferable.buffer, width, height, outputWidth, outputHeight } }, [transferable.buffer]);
  });
}

function countExistingTransparency(bitmap) {
  let transparent = 0;
  const total = bitmap.length / 4;
  for (let offset = 3; offset < bitmap.length; offset += 4) {
    if (bitmap[offset] < 245) transparent += 1;
  }
  return transparent / Math.max(1, total);
}

async function removeBackground(inputImage, options = {}) {
  if (!inputImage || inputImage.isEmpty()) throw new Error('图片无法读取');
  const originalSize = inputImage.getSize();
  const maxOutputSize = options.maxSize || 1100;
  const outputScale = Math.min(1, maxOutputSize / Math.max(originalSize.width, originalSize.height));
  const outputWidth = Math.max(2, Math.round(originalSize.width * outputScale));
  const outputHeight = Math.max(2, Math.round(originalSize.height * outputScale));
  const outputImage = outputScale < 1 ? inputImage.resize({ width: outputWidth, height: outputHeight, quality: 'best' }) : inputImage;
  const outputBitmap = outputImage.toBitmap({ scaleFactor: 1 });

  if (!options.force && countExistingTransparency(outputBitmap) > 0.18) {
    return {
      dataUrl: `data:image/png;base64,${outputImage.toPNG().toString('base64')}`,
      status: 'already-transparent',
      foregroundRatio: 1
    };
  }

  const maxSegmentSize = options.maxSegmentSize || 360;
  const segmentScale = Math.min(1, maxSegmentSize / Math.max(outputWidth, outputHeight));
  const width = Math.max(2, Math.round(outputWidth * segmentScale));
  const height = Math.max(2, Math.round(outputHeight * segmentScale));
  const segmentImage = segmentScale < 1 ? outputImage.resize({ width, height, quality: 'good' }) : outputImage;
  const segmentBitmap = segmentImage.toBitmap({ scaleFactor: 1 });

  const segmentation = await segmentForeground(segmentBitmap, width, height, outputWidth, outputHeight);
  const outputAlpha = new Uint8Array(segmentation.alpha);
  const foregroundRatio = segmentation.foregroundRatio;
  const output = Buffer.from(outputBitmap);
  for (let pixel = 0; pixel < outputWidth * outputHeight; pixel += 1) {
    const offset = pixel * 4;
    const rawMatte = outputAlpha[pixel];
    const matte = rawMatte <= 42 ? 0 : rawMatte >= 248 ? 255 : Math.round((rawMatte - 42) * 255 / 206);
    output[offset] = Math.round(output[offset] * matte / 255);
    output[offset + 1] = Math.round(output[offset + 1] * matte / 255);
    output[offset + 2] = Math.round(output[offset + 2] * matte / 255);
    output[offset + 3] = matte;
  }

  const resultImage = nativeImage.createFromBitmap(output, { width: outputWidth, height: outputHeight, scaleFactor: 1 });
  if (resultImage.isEmpty()) throw new Error('透明图片生成失败');
  return {
    dataUrl: `data:image/png;base64,${resultImage.toPNG().toString('base64')}`,
    status: 'removed',
    foregroundRatio
  };
}

async function removeBackgroundFromDataUrl(dataUrl, options) {
  const image = nativeImage.createFromDataURL(dataUrl);
  return removeBackground(image, options);
}

module.exports = { removeBackground, removeBackgroundFromDataUrl };
