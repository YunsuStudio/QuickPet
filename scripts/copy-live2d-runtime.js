'use strict';

const fs = require('node:fs');
const path = require('node:path');

const source = require.resolve('@hazart-pkg/live2d-core/live2dcubismcore.min.js');
const destination = path.join(__dirname, '..', 'src', 'renderer', 'vendor', 'live2dcubismcore.min.js');
fs.mkdirSync(path.dirname(destination), { recursive: true });
fs.copyFileSync(source, destination);
console.log(`Copied Cubism Core to ${destination}`);
