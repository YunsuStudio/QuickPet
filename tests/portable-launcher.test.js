'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('便携版把运行文件解压到 EXE 同级目录并传递缓存根路径', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'create-portable-launcher.ps1'), 'utf8');
  assert.match(source, /Path\.GetDirectoryName\(Application\.ExecutablePath\)/);
  assert.match(source, /QuickPet-Portable-Cache/);
  assert.match(source, /QUICKPET_PORTABLE_CACHE_ROOT/);
});
