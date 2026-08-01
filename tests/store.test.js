'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('../src/main/store');

function withStore(callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'quick-pet-test-'));
  try {
    return callback(new Store(path.join(directory, 'data.json')));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test('添加快捷方式时保持未分类并持久化', () => withStore((store) => {
  const item = store.addShortcut({ target: 'https://github.com/openai', name: '代码仓库' });
  assert.equal(item.type, 'website');
  assert.equal(item.category, '');
  assert.deepEqual(store.data.categories, []);
  assert.equal(store.snapshot().shortcuts.length, 1);
  assert.equal(fs.existsSync(store.filePath), true);
}));

test('智能规则会覆盖自动分类并追加标签', () => withStore((store) => {
  const category = store.addCategory({ name: '设计' });
  store.addRule({ name: '设计文件', field: 'extension', operator: 'equals', value: 'psd', category: category.id, tags: ['设计素材'] });
  const item = store.addShortcut({ target: 'C:\\Work\\poster.psd' });
  assert.equal(item.category, category.id);
  assert.deepEqual(item.tags, ['设计素材']);
}));

test('图标字段、提醒和通知会安全持久化', () => withStore((store) => {
  const item = store.addShortcut({ target: 'https://example.com/icon', iconData: 'data:image/png;base64,AA==', iconBackground: '#663399' });
  store.addReminder({ title: '休息一下', dueAt: Date.now() + 1000, repeat: 'daily' });
  for (let index = 0; index < 110; index += 1) store.addNotification({ message: `消息 ${index}` });
  const data = store.snapshot();
  assert.equal(data.shortcuts.find((entry) => entry.id === item.id).iconBackground, '#663399');
  assert.equal(data.reminders[0].repeat, 'daily');
  assert.equal(data.notifications.length, 100);
}));

test('动态文件夹去重且最多保存四个额外伙伴', () => withStore((store) => {
  store.addWatchedFolder({ path: 'C:\\Work', category: 'other' });
  assert.throws(() => store.addWatchedFolder({ path: 'C:\\Work\\' }), /已经在监控/);
  for (let index = 0; index < 4; index += 1) store.addCompanion({ name: `伙伴 ${index + 1}` });
  assert.equal(store.snapshot().companions.length, 4);
  assert.throws(() => store.addCompanion({ name: '第五只' }), /最多/);
}));

test('拒绝重复目标', () => withStore((store) => {
  store.addShortcut({ target: 'https://example.com/' });
  assert.throws(() => store.addShortcut({ target: 'https://example.com' }), /已经收纳过/);
}));

test('快捷启动组合键会规范化并拒绝冲突', () => withStore((store) => {
  const first = store.addShortcut({ target: 'https://example.com/hotkey-one', hotkey: 'Ctrl+Shift+K' });
  assert.equal(first.hotkey, 'CommandOrControl+Shift+K');
  assert.throws(() => store.addShortcut({ target: 'https://example.com/hotkey-two', hotkey: 'Shift+Ctrl+K' }), /已经被占用/);
  assert.throws(() => store.updateShortcut(first.id, { hotkey: 'Alt+F4' }), /需要包含/);
  assert.throws(() => store.updateShortcut(first.id, { hotkey: store.data.settings.globalSearchShortcut }), /已经被占用/);
  assert.throws(() => store.updateShortcut(first.id, { hotkey: store.data.settings.quickLaunchShortcut }), /已经被占用/);
  assert.throws(() => store.updateShortcut(first.id, { hotkey: store.data.settings.panelShortcut }), /已经被占用/);
  assert.throws(() => store.updateSettings({ quickLaunchShortcut: store.data.settings.globalSearchShortcut }), /不能相同/);
  assert.throws(() => store.updateSettings({ panelShortcut: store.data.settings.quickLaunchShortcut }), /不能相同/);
  const settings = store.updateSettings({ globalSearchShortcut: 'Ctrl+Shift+F8', quickLaunchShortcut: 'Alt+F9', panelShortcut: 'Ctrl+Alt+P' });
  assert.equal(settings.globalSearchShortcut, 'CommandOrControl+Shift+F8');
  assert.equal(settings.quickLaunchShortcut, 'Alt+F9');
  assert.equal(settings.panelShortcut, 'CommandOrControl+Alt+P');
}));

test('自定义分类删除后项目变为未分类', () => withStore((store) => {
  const category = store.addCategory({ name: '灵感', icon: '💡', color: '#ff9900' });
  const item = store.addShortcut({ target: 'https://example.com/inspire', category: category.id });
  assert.equal(item.category, category.id);
  store.removeCategory(category.id);
  assert.equal(store.snapshot().shortcuts[0].category, '');
}));

test('快捷启动台只持久化用户明确加入的项目', () => withStore((store) => {
  const item = store.addShortcut({ target: 'https://example.com/launcher', showInLauncher: true });
  assert.equal(item.showInLauncher, true);
  store.updateShortcut(item.id, { showInLauncher: false });
  assert.equal(new Store(store.filePath).data.shortcuts[0].showInLauncher, false);
}));

test('分类支持嵌套并拒绝形成循环', () => withStore((store) => {
  const parent = store.addCategory({ name: '工作' });
  const child = store.addCategory({ name: '项目', parentId: parent.id });
  assert.equal(child.parentId, parent.id);
  assert.throws(() => store.updateCategory(parent.id, { parentId: child.id }), /不能把分类放进自己的子分类/);
  store.removeCategory(parent.id);
  assert.equal(store.data.categories.find((item) => item.id === child.id).parentId, '');
}));

test('快捷方式支持同类排序和跨分类拖动', () => withStore((store) => {
  const work = store.addCategory({ name: '工作' });
  const tools = store.addCategory({ name: '工具' });
  const first = store.addShortcut({ target: 'https://example.com/first', category: work.id });
  const second = store.addShortcut({ target: 'https://example.com/second', category: work.id });
  store.reorderShortcut(second.id, first.id, work.id);
  let ordered = store.data.shortcuts.filter((item) => item.category === work.id).sort((a, b) => a.sortOrder - b.sortOrder);
  assert.deepEqual(ordered.map((item) => item.id), [second.id, first.id]);
  store.reorderShortcut(first.id, '', tools.id);
  ordered = store.data.shortcuts.filter((item) => item.category === tools.id).sort((a, b) => a.sortOrder - b.sortOrder);
  assert.deepEqual(ordered.map((item) => item.id), [first.id]);
}));

test('可以一次清空全部快捷方式', () => withStore((store) => {
  store.addShortcut({ target: 'https://example.com/one' });
  store.addShortcut({ target: 'https://example.com/two' });
  assert.equal(store.removeAllShortcuts(), 2);
  assert.equal(store.data.shortcuts.length, 0);
  assert.equal(new Store(store.filePath).data.shortcuts.length, 0);
}));

test('旧版内置分类会全部移除且保留用户自定义分类', () => withStore((store) => {
  const data = store.replaceData({
    categories: [
      { id: 'work', name: '工作', icon: '💼', color: '#6c7cff' },
      { id: 'design', name: '设计', icon: '🎨', color: '#f38bb3' },
      { id: 'develop', name: '我的开发', icon: 'D', color: '#123456' },
      { id: 'social', name: '社交', icon: '💬', color: '#57a8ef' },
      { id: 'media', name: '影音', icon: '🎬', color: '#ff8b61' },
      { id: 'life', name: '生活', icon: '🌿', color: '#72bd69' },
      { id: 'other', name: '其他', icon: '✨', color: '#9aa0b5' }
    ],
    shortcuts: [
      { target: 'C:\\Art\\poster.psd', category: 'design' },
      { target: 'C:\\Code\\app.exe', category: 'develop' },
      { target: 'https://weibo.com', category: 'social' },
      { target: 'C:\\Media\\song.mp3', category: 'media' },
      { target: 'https://example.com/misc', category: 'other' }
    ]
  });
  assert.equal(data.categories.some((item) => item.id === 'design'), false);
  assert.equal(data.categories.some((item) => item.id === 'social'), false);
  assert.equal(data.categories.some((item) => item.id === 'develop' && item.name === '我的开发'), true);
  assert.deepEqual(data.categories.filter((item) => ['tools', 'study', 'work'].includes(item.id)), []);
  assert.deepEqual(data.shortcuts.map((item) => item.category), ['', 'develop', '', '', '']);
}));

test('旧默认桌宠名字会迁移为快捷宠', () => withStore((store) => {
  const data = store.replaceData({ petStatus: { name: '暖暖', mood: 80, hunger: 70, affection: 20 } });
  assert.equal(data.petStatus.name, '快捷宠');
}));

test('设置数值和桌宠模式会被限制在安全范围内', () => withStore((store) => {
  const settings = store.updateSettings({ panelOpacity: 0.1, panelWidth: 9999, petScale: 4, petRenderMode: 'unknown', portableCacheCleanupPrompt: false });
  assert.equal(settings.panelOpacity, 0.72);
  assert.equal(settings.panelWidth, 1500);
  assert.equal(settings.petScale, 1.45);
  assert.equal(settings.petRenderMode, '2d');
  assert.equal(settings.portableCacheCleanupPrompt, false);
  assert.equal(new Store(store.filePath).data.settings.portableCacheCleanupPrompt, false);
}));

test('桌宠互动状态与多个模型会持久保存', () => withStore((store) => {
  const model = store.addModel({ id: 'cat-1', name: '小猫', fileName: 'cat-1.glb', animationNames: ['Idle', 'Walk'] });
  store.interactWithPet('feed');
  store.updatePetStatus({ name: '团子', affection: 66 });
  assert.equal(model.id, 'cat-1');
  assert.equal(store.data.settings.activeModelId, 'cat-1');
  assert.equal(store.data.petStatus.name, '团子');
  assert.equal(store.data.petStatus.affection, 66);
  assert.equal(store.data.petStatus.hunger, 100);
}));

test('旧版程序化橘猫配置会自动迁移到内置狐狸', () => withStore((store) => {
  const data = store.replaceData({
    settings: { petModelPreset: 'procedural', activeModelId: 'old-cat', petModelName: '程序化橘猫' }
  });
  assert.equal(data.settings.petModelPreset, 'fox');
  assert.equal(data.settings.activeModelId, '');
  assert.equal(data.settings.petModelName, '');
}));

test('旧版默认强调色会升级为太极墨色且保留用户自定义颜色', () => withStore((store) => {
  const migrated = store.replaceData({ settings: { accent: '#df5b3f' } });
  assert.equal(migrated.settings.accent, '#171717');
  const migratedBlue = store.replaceData({ settings: { accent: '#3f66d4' } });
  assert.equal(migratedBlue.settings.accent, '#171717');
  const customized = store.replaceData({ settings: { accent: '#168c72' } });
  assert.equal(customized.settings.accent, '#168c72');
}));
