'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  displayNameFromTarget,
  inferType,
  isUrl,
  normalizeTarget
} = require('../src/shared/classifier');

test('识别常见网址和本地项目类型', () => {
  assert.equal(isUrl('https://example.com'), true);
  assert.equal(isUrl('C:\\Tools\\demo.exe'), false);
  assert.equal(inferType('https://example.com'), 'website');
  assert.equal(inferType('C:\\Tools\\demo.exe'), 'app');
  assert.equal(inferType('C:\\Docs\\note.pdf'), 'document');
  assert.equal(inferType('steam://rungameid/730'), 'app');
  assert.equal(inferType('steam://rungameid/730', 'folder'), 'app');
  assert.equal(inferType('spotify:track:demo'), 'app');
  assert.equal(inferType('shell:AppsFolder\\Microsoft.WindowsCalculator_8wekyb3d8bbwe!App'), 'app');
  assert.equal(inferType('C:\\Links\\Game.url'), 'website');
  assert.equal(inferType('C:\\Links\\Game.url', 'file'), 'website');
});

test('补全 www 开头的网址并生成可读名称', () => {
  assert.equal(normalizeTarget('www.example.com'), 'https://www.example.com');
  assert.equal(normalizeTarget('baidu.com'), 'https://baidu.com');
  assert.equal(normalizeTarget('docs.example.com/guide'), 'https://docs.example.com/guide');
  assert.equal(inferType(normalizeTarget('baidu.com')), 'website');
  assert.equal(displayNameFromTarget('https://www.example.com/page'), 'example.com');
  assert.equal(displayNameFromTarget('C:\\Tools\\Everything.exe'), 'Everything');
});

test('自动识别常见文件的详细类型', () => {
  assert.equal(inferType('C:\\Media\\cover.png'), 'image');
  assert.equal(inferType('C:\\Media\\clip.mp4'), 'video');
  assert.equal(inferType('C:\\Media\\song.flac'), 'audio');
  assert.equal(inferType('C:\\Docs\\manual.pdf'), 'document');
  assert.equal(inferType('C:\\Backup\\archive.7z'), 'archive');
  assert.equal(inferType('C:\\Code\\index.ts'), 'code');
  assert.equal(inferType('C:\\Design\\poster.psd'), 'design');
});

test('新用户不再自动创建内置分类', () => {
  const { DEFAULT_CATEGORIES } = require('../src/shared/classifier');
  assert.deepEqual(DEFAULT_CATEGORIES, []);
});
