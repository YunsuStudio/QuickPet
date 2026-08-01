'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { collectBookmarks, scanLocalFiles, scanLocalFolders, scanWindowsShortcuts, uniqueCandidates } = require('../src/main/shortcut-scanner');

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

test('扫描 Windows 快捷方式时保留 lnk 文件以免丢失参数', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'quick-pet-scan-'));
  const link = path.join(directory, 'Steam 游戏.lnk');
  fs.writeFileSync(link, 'placeholder');
  try {
    const result = scanWindowsShortcuts({
      source: '开始菜单',
      roots: [directory],
      readShortcutLink: () => ({ target: 'C:\\Steam\\steam.exe', args: '-applaunch 730' })
    });
    assert.equal(result.length, 1);
    assert.equal(result[0].target, link);
    assert.equal(result[0].type, 'app');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('批量收纳可以扫描用户选择的文件夹和任意本地文件', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'quick-pet-local-scan-'));
  const nested = path.join(directory, '资料');
  const document = path.join(nested, '说明.pdf');
  const image = path.join(directory, '封面.png');
  fs.mkdirSync(nested);
  fs.writeFileSync(document, 'pdf');
  fs.writeFileSync(image, 'png');
  try {
    const folders = scanLocalFolders([directory], () => ({}));
    assert.deepEqual(folders.map((item) => item.target).sort(), [document, image].sort());
    assert.ok(folders.every((item) => item.source.startsWith('文件夹 · ')));

    const files = scanLocalFiles([document, image], () => ({}));
    assert.deepEqual(files.map((item) => item.target), [document, image]);
    assert.ok(files.every((item) => item.source === '本地文件'));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
