'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('危险操作统一使用应用内确认层而不是阻塞式原生弹窗', () => {
  const app = read('src/renderer/app.js');
  const html = read('src/renderer/index.html');
  assert.doesNotMatch(app, /\bconfirm\(/);
  assert.match(app, /confirmAction/);
  assert.match(html, /id="confirmModal"/);
});

test('侧边栏分类树支持层级缩进和收缩展开', () => {
  const app = read('src/renderer/app.js');
  assert.match(app, /category-toggle/);
  assert.match(app, /collapsedCategoryIds/);
  assert.match(app, /aria-expanded/);
});

test('添加快捷方式可分别选择文件和文件夹并提供详细类型', () => {
  const html = read('src/renderer/index.html');
  assert.match(html, /id="browseFileButton"/);
  assert.match(html, /id="browseFolderButton"/);
  for (const type of ['image', 'video', 'audio', 'document', 'archive', 'code', 'design']) {
    assert.match(html, new RegExp(`value="${type}"`));
  }
});

test('快捷启动台只显示明确加入的项目并允许直接移除', () => {
  const search = read('src/renderer/search.js');
  assert.match(search, /filter\(\(item\) => item\.showInLauncher\)/);
  assert.doesNotMatch(search, /item\.showInLauncher \|\| item\.favorite/);
  assert.match(search, /data-remove-launcher/);
});

test('拖拽排序只提交一次原子重排并复用单个插入指示器', () => {
  const app = read('src/renderer/app.js');
  assert.doesNotMatch(app, /updateSettings\(\{ sortBy: 'manual' \}\);\s*\n\s*await window\.quickPet\.reorderShortcut/);
  assert.match(app, /dragIndicatorCard/);
});

test('点睛色用于可见状态且搜索结果使用轻量进场动效', () => {
  const theme = read('src/renderer/index-theme.css');
  const searchCss = read('src/renderer/search.css');
  assert.ok((theme.match(/var\(--accent\)/g) || []).length >= 4);
  assert.match(searchCss, /itemSettle/);
  assert.match(searchCss, /--item-index/);
});

test('重复状态广播不会反复重载相同桌宠皮肤', () => {
  const pet = read('src/renderer/pet.js');
  assert.match(pet, /activeSkinSource/);
  assert.match(pet, /if \(nextSkinSource !== activeSkinSource\)/);
});

test('全局快捷键注册冲突会恢复旧设置并明确提示用户', () => {
  const main = read('src/main/main.js');
  assert.match(main, /const failed = hotkeyChanges\.filter/);
  assert.match(main, /globalSearchShortcut: previousSearchShortcut/);
  assert.match(main, /组合键已被系统或其他程序占用，已保留原快捷键/);
});
