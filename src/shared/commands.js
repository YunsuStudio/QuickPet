'use strict';

const COMMANDS = [
  { id: 'open-settings', name: '打开设置', detail: '进入设置与外观', icon: '⚙', keywords: '设置 外观 选项' },
  { id: 'open-automation', name: '打开自动化中心', detail: '管理规则、提醒和伙伴', icon: '✦', keywords: '自动化 提醒 规则' },
  { id: 'check-shortcuts', name: '检查全部快捷方式', detail: '检查路径和网址是否有效', icon: '✓', keywords: '检查 修复 链接' },
  { id: 'open-data-folder', name: '打开数据文件夹', detail: '查看本地数据、模型和备份', icon: '▤', keywords: '文件夹 数据 模型 备份' },
  { id: 'capture-panel', name: '保存面板截图', detail: '截取当前快捷宠面板', icon: '▣', keywords: '截图 保存 图片' },
  { id: 'toggle-walk', name: '切换自动散步', detail: '暂停或继续桌宠移动', icon: '〽', keywords: '走路 暂停 移动' },
  { id: 'clear-cache', name: '清理运行缓存', detail: '清理网页缓存和旧便携缓存', icon: '⌫', keywords: '清理 缓存 空间' },
  { id: 'check-update', name: '检查软件更新', detail: '读取本地或在线更新清单', icon: '↻', keywords: '版本 升级 更新' }
];

module.exports = { COMMANDS };
