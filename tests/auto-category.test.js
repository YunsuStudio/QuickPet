'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { suggestCategory } = require('../src/shared/auto-category');

const categories = [
  { id: 'social', name: '社交', keywords: [] },
  { id: 'entertainment', name: '娱乐', keywords: [] },
  { id: 'development', name: '开发', keywords: [] },
  { id: 'ai', name: 'AI工具', keywords: [] },
  { id: 'security', name: '逆向安全', keywords: [] }
];

test('按软件名称区分社交、娱乐、开发、AI 工具和逆向安全', () => {
  const examples = [
    ['微信', 'C:\\Users\\Public\\Desktop\\微信.lnk', 'social'],
    ['Steam', 'C:\\Program Files (x86)\\Steam\\steam.exe', 'entertainment'],
    ['Visual Studio Code', 'C:\\Users\\me\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe', 'development'],
    ['ChatGPT', 'C:\\Users\\Public\\Desktop\\ChatGPT.lnk', 'ai'],
    ['IDA Pro', 'D:\\Security\\IDA Pro 9\\ida64.exe', 'security']
  ];
  for (const [name, target, expected] of examples) {
    assert.equal(suggestCategory({ name, target, type: 'app' }, categories)?.category, expected);
  }
});

test('具体类别优先于宽泛开发类别且证据不足时保持未分类', () => {
  assert.equal(suggestCategory({ name: 'Cursor AI Editor', target: 'C:\\Apps\\Cursor\\Cursor.exe', type: 'app' }, categories)?.category, 'ai');
  assert.equal(suggestCategory({ name: 'Ghidra', target: 'D:\\Dev\\ghidraRun.bat', type: 'app' }, categories)?.category, 'security');
  assert.equal(suggestCategory({ name: '临时工具', target: 'D:\\Tools\\helper.exe', type: 'app' }, categories), null);
});

test('用户自定义关键词优先匹配任意分类', () => {
  const custom = [
    { id: 'communication', name: '联系', keywords: ['飞书', 'Lark'] },
    { id: 'office', name: '办公', keywords: ['文档'] }
  ];
  const result = suggestCategory({ name: 'Lark', target: 'C:\\Apps\\Lark\\Lark.exe', type: 'app' }, custom);
  assert.equal(result.category, 'communication');
  assert.equal(result.source, 'keyword');
});

test('同分的自定义关键词不擅自分类', () => {
  const ambiguous = [
    { id: 'one', name: '一组', keywords: ['studio'] },
    { id: 'two', name: '二组', keywords: ['studio'] }
  ];
  assert.equal(suggestCategory({ name: 'Studio', target: 'C:\\Studio.exe', type: 'app' }, ambiguous), null);
});

test('Windows 快捷方式会结合真实目标路径分类', () => {
  const result = suggestCategory({
    name: '快捷入口',
    target: 'C:\\Users\\Public\\Desktop\\快捷入口.lnk',
    type: 'app',
    classificationHints: ['C:\\Program Files (x86)\\Steam\\steam.exe', '-silent']
  }, categories);
  assert.equal(result.category, 'entertainment');
});
