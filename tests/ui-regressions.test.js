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

test('快捷卡片操作常驻且拖动按钮只在手动排序显示', () => {
  const app = read('src/renderer/app.js');
  const styles = read('src/renderer/styles.css');
  assert.doesNotMatch(styles, /\.card-icon-button\s*\{[^}]*opacity:\s*0/s);
  assert.match(app, /manualSort[\s\S]*drag-handle/);
  assert.match(app, /draggable="\$\{manualSort\}"/);
});

test('输入控件焦点使用中性色而不是点睛色', () => {
  const theme = read('src/renderer/index-theme.css');
  assert.match(theme, /input:focus-visible[\s\S]{0,180}var\(--text\)/);
  assert.doesNotMatch(theme, /input:focus-visible[\s\S]{0,180}var\(--accent\)/);
});

test('默认 2D 桌宠和桌宠设置统一使用程序图标', () => {
  const app = read('src/renderer/app.js');
  const pet = read('src/renderer/pet.js');
  const html = read('src/renderer/index.html');
  assert.match(app, /assets\/app-icon\.png/);
  assert.match(pet, /assets\/app-icon\.png/);
  assert.ok((html.match(/assets\/app-icon\.png/g) || []).length >= 2);
});

test('设置页按优先级分组并提供项目与作者信息', () => {
  const app = read('src/renderer/app.js');
  const html = read('src/renderer/index.html');
  assert.match(app, /organizeSettingsLayout/);
  assert.match(html, /id="openProjectButton"/);
  assert.match(html, /云间溯工作室/);
});

test('搜索和启动台切换使用内容级过渡而不是重播整个窗口', () => {
  const search = read('src/renderer/search.js');
  const css = read('src/renderer/search.css');
  assert.match(search, /modeTransitionToken/);
  assert.match(css, /mode-leave/);
  assert.match(css, /mode-enter/);
});

test('搜索和启动台不会把未分类项目显示成已移除的内置分类', () => {
  const search = read('src/renderer/search.js');
  assert.match(search, /category\?\.name \|\| '未分类'/);
  assert.equal((search.match(/\|\| '未分类'/g) || []).length, 2);
  assert.doesNotMatch(search, /category\?\.name \|\| '工具'/);
});

test('正常启动会同时创建并显示桌宠与主面板', () => {
  const main = read('src/main/main.js');
  assert.match(main, /createPetWindow\(\);\s*\n\s*createPanelWindow\(!isAutomatedTest\)/);
});

test('批量收纳支持自选文件夹和文件并排在快捷键台后面', () => {
  const html = read('src/renderer/index.html');
  const app = read('src/renderer/app.js');
  assert.match(html, /data-scan="folder"/);
  assert.match(html, /data-scan="files"/);
  assert.match(app, /'itemHotkeysCard', 'batchImportCard'/);
});

test('使用记录不再独占设置卡且仍可清除', () => {
  const html = read('src/renderer/index.html');
  const app = read('src/renderer/app.js');
  assert.doesNotMatch(html, /id="usageStatsCard"/);
  assert.match(html, /id="resetUsageButton"/);
  assert.doesNotMatch(app, /renderUsageStats/);
});

test('更新检查提供应用内提示和可测试的提示预览', () => {
  const html = read('src/renderer/index.html');
  const app = read('src/renderer/app.js');
  assert.match(html, /id="previewUpdateButton"/);
  assert.match(app, /promptAvailableUpdate/);
  assert.match(app, /maybePromptAvailableUpdate/);
});

test('缓存清理完成后自动收起进度条', () => {
  const app = read('src/renderer/app.js');
  assert.match(app, /scheduleCacheCleanupProgressDismiss/);
  assert.match(app, /cacheCleanupProgress = null/);
});

test('维护工具限制检查并发并合并重复缓存请求', () => {
  const main = read('src/main/main.js');
  const maintenance = read('src/main/maintenance-manager.js');
  assert.match(main, /SHORTCUT_CHECK_CONCURRENCY = 5/);
  assert.match(main, /shortcutCheckInFlight/);
  assert.match(main, /cacheCleanupInFlight/);
  assert.match(maintenance, /Promise\.all\(\[/);
});

test('范围设置的名称和值保持单行', () => {
  const theme = read('src/renderer/index-theme.css');
  assert.match(theme, /\.range-row\s*>\s*label\s*\{[^}]*display:\s*flex/s);
});

test('分类支持识别关键词且扫描预览允许修正自动分类', () => {
  const html = read('src/renderer/index.html');
  const app = read('src/renderer/app.js');
  assert.match(html, /id="newCategoryKeywords"/);
  assert.match(app, /category-keywords-input/);
  assert.match(app, /scan-category-select/);
  assert.match(app, /item\.categoryMatch \? '自动匹配'/);
});
