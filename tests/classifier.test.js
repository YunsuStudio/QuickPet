'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  classifyShortcut,
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
  assert.equal(inferType('C:\\Docs\\note.pdf'), 'file');
});

test('补全 www 开头的网址并生成可读名称', () => {
  assert.equal(normalizeTarget('www.example.com'), 'https://www.example.com');
  assert.equal(displayNameFromTarget('https://www.example.com/page'), 'example.com');
  assert.equal(displayNameFromTarget('C:\\Tools\\Everything.exe'), 'Everything');
});

test('按关键字和扩展名自动分类', () => {
  assert.equal(classifyShortcut({ name: 'GitHub', target: 'https://github.com' }), 'develop');
  assert.equal(classifyShortcut({ name: '课程资料', target: 'C:\\Docs\\lesson.pdf' }), 'study');
  assert.equal(classifyShortcut({ name: '配色灵感', target: 'https://example.com/colors' }), 'design');
  assert.equal(classifyShortcut({ name: '普通项目', target: 'https://example.com' }), 'other');
});
