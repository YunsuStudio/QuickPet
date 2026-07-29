'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { collectBookmarks, uniqueCandidates } = require('../src/main/shortcut-scanner');

test('递归读取浏览器书签文件夹', () => {
  const output = [];
  collectBookmarks({ children: [{ type: 'folder', children: [{ type: 'url', name: 'OpenAI', url: 'https://openai.com' }] }] }, 'Chrome 书签', output);
  assert.deepEqual(output, [{ name: 'OpenAI', target: 'https://openai.com', type: 'website', source: 'Chrome 书签' }]);
});

test('扫描结果会排除已有目标并自动去重', () => {
  const result = uniqueCandidates([
    { name: 'A', target: 'C:\\Apps\\A.exe', source: '桌面' },
    { name: 'A2', target: 'c:\\apps\\a.exe', source: '开始菜单' },
    { name: 'B', target: 'https://example.com/', source: '书签' }
  ], ['https://example.com']);
  assert.equal(result.length, 1);
  assert.equal(result[0].name, 'A');
});
