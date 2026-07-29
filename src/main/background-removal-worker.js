'use strict';

const { parentPort } = require('node:worker_threads');

let cvReady;

function getOpenCv() {
  if (!cvReady) {
    const loaded = require('@techstark/opencv-js');
    cvReady = typeof loaded?.then === 'function' ? loaded : Promise.resolve(loaded);
  }
  return cvReady;
}

async function segment({ bitmap, width, height, outputWidth, outputHeight }) {
  const cv = await getOpenCv();
  const source = new cv.Mat(height, width, cv.CV_8UC4);
  const rgb = new cv.Mat();
  const mask = new cv.Mat();
  const backgroundModel = new cv.Mat();
  const foregroundModel = new cv.Mat();
  const alpha = new cv.Mat(height, width, cv.CV_8UC1);
  const outputAlpha = new cv.Mat();
  let kernel;
  try {
    source.data.set(new Uint8Array(bitmap));
    cv.cvtColor(source, rgb, cv.COLOR_BGRA2BGR);
    const insetX = Math.max(2, Math.round(width * 0.025));
    const insetY = Math.max(2, Math.round(height * 0.025));
    const rectangle = new cv.Rect(insetX, insetY, Math.max(1, width - insetX * 2), Math.max(1, height - insetY * 2));
    cv.grabCut(rgb, mask, rectangle, backgroundModel, foregroundModel, 5, cv.GC_INIT_WITH_RECT);
    let foregroundPixels = 0;
    for (let index = 0; index < mask.data.length; index += 1) {
      const value = mask.data[index];
      const isForeground = value === cv.GC_FGD || value === cv.GC_PR_FGD;
      alpha.data[index] = isForeground ? 255 : 0;
      if (isForeground) foregroundPixels += 1;
    }
    const foregroundRatio = foregroundPixels / (width * height);
    if (foregroundRatio < 0.025 || foregroundRatio > 0.94) throw new Error('没有可靠识别出照片主体，请换一张主体更清晰的图片');
    kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(3, 3));
    cv.morphologyEx(alpha, alpha, cv.MORPH_CLOSE, kernel);
    cv.erode(alpha, alpha, kernel, new cv.Point(-1, -1), 2);
    cv.GaussianBlur(alpha, alpha, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT);
    if (width !== outputWidth || height !== outputHeight) cv.resize(alpha, outputAlpha, new cv.Size(outputWidth, outputHeight), 0, 0, cv.INTER_LINEAR);
    else alpha.copyTo(outputAlpha);
    const result = Uint8Array.from(outputAlpha.data);
    return { alpha: result.buffer, foregroundRatio };
  } finally {
    source.delete();
    rgb.delete();
    mask.delete();
    backgroundModel.delete();
    foregroundModel.delete();
    alpha.delete();
    outputAlpha.delete();
    kernel?.delete();
  }
}

parentPort.on('message', async ({ id, payload }) => {
  try {
    const result = await segment(payload);
    parentPort.postMessage({ id, result }, [result.alpha]);
  } catch (error) {
    parentPort.postMessage({ id, error: error.message });
  }
});
