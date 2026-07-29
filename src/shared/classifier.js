'use strict';

const path = require('node:path');

const DEFAULT_CATEGORIES = [
  { id: 'work', name: '工作', icon: '💼', color: '#6c7cff' },
  { id: 'study', name: '学习', icon: '📚', color: '#45b7a8' },
  { id: 'design', name: '设计', icon: '🎨', color: '#f38bb3' },
  { id: 'develop', name: '开发', icon: '⌨️', color: '#8a76e8' },
  { id: 'media', name: '影音', icon: '🎬', color: '#ff8b61' },
  { id: 'social', name: '社交', icon: '💬', color: '#57a8ef' },
  { id: 'tools', name: '工具', icon: '🧰', color: '#e6a84b' },
  { id: 'life', name: '生活', icon: '🌿', color: '#72bd69' },
  { id: 'other', name: '其他', icon: '✨', color: '#9aa0b5' }
];

const RULES = [
  ['develop', ['github', 'gitlab', 'gitee', 'npm', 'developer', 'stackoverflow', 'code', 'vscode', 'terminal', 'powershell', 'python', 'java', 'docker', 'api', '编程', '代码', '开发']],
  ['design', ['figma', 'dribbble', 'behance', 'canva', 'adobe', 'photoshop', 'illustrator', 'blender', '设计', '图片', '素材', '配色']],
  ['study', ['edu', 'course', 'learn', 'wiki', 'notion', 'obsidian', 'book', 'bilibili.com/video', '学习', '课程', '文档', '教程', '笔记']],
  ['work', ['office', 'docs', 'sheets', 'drive', 'feishu', 'dingtalk', 'work', 'meeting', 'zoom', '腾讯文档', '飞书', '钉钉', '会议', '工作']],
  ['media', ['youtube', 'bilibili', 'spotify', 'music', 'video', 'netflix', 'iqiyi', 'youku', 'media', '音乐', '视频', '影视', '直播']],
  ['social', ['weibo', 'wechat', 'qq.com', 'discord', 'telegram', 'reddit', 'twitter', 'x.com', 'facebook', 'instagram', '知乎', '微博', '社交']],
  ['tools', ['tool', 'convert', 'translate', 'calculator', 'download', 'utility', '7-zip', 'winrar', 'everything', '工具', '转换', '翻译', '下载']],
  ['life', ['shop', 'taobao', 'jd.com', 'travel', 'map', 'weather', 'food', 'health', '生活', '购物', '地图', '天气', '美食']]
];

const APP_EXTENSIONS = new Set(['.exe', '.lnk', '.bat', '.cmd', '.com', '.msi', '.appref-ms']);
const MEDIA_EXTENSIONS = new Set(['.mp3', '.wav', '.flac', '.mp4', '.mkv', '.avi', '.mov', '.webm']);
const DESIGN_EXTENSIONS = new Set(['.psd', '.ai', '.sketch', '.fig', '.blend', '.svg']);
const STUDY_EXTENSIONS = new Set(['.pdf', '.epub', '.mobi', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx']);
const CODE_EXTENSIONS = new Set(['.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.go', '.rs', '.cpp', '.c', '.cs', '.html', '.css', '.json', '.md']);

function isUrl(value = '') {
  try {
    const url = new URL(value.trim());
    return ['http:', 'https:', 'mailto:'].includes(url.protocol);
  } catch {
    return false;
  }
}

function inferType(target = '', hintedType = '') {
  if (hintedType && hintedType !== 'auto') return hintedType;
  if (isUrl(target)) return 'website';
  const extension = path.extname(target).toLowerCase();
  if (APP_EXTENSIONS.has(extension)) return 'app';
  return extension ? 'file' : 'folder';
}

function classifyShortcut({ name = '', target = '', type = '' }) {
  const haystack = `${name} ${target}`.toLowerCase();
  const extension = path.extname(target).toLowerCase();

  if (CODE_EXTENSIONS.has(extension)) return 'develop';
  if (DESIGN_EXTENSIONS.has(extension)) return 'design';
  if (MEDIA_EXTENSIONS.has(extension)) return 'media';
  if (STUDY_EXTENSIONS.has(extension)) return 'study';
  if (inferType(target, type) === 'app') return 'tools';

  for (const [category, keywords] of RULES) {
    if (keywords.some((keyword) => haystack.includes(keyword))) return category;
  }
  return 'other';
}

function displayNameFromTarget(target = '') {
  if (isUrl(target)) {
    try {
      const url = new URL(target);
      return url.hostname.replace(/^www\./, '') || target;
    } catch {
      return target;
    }
  }
  const clean = target.replace(/[\\/]+$/, '');
  const parsed = path.parse(clean);
  return parsed.name || parsed.base || '未命名快捷方式';
}

function normalizeTarget(target = '') {
  const clean = String(target).trim();
  if (/^www\./i.test(clean)) return `https://${clean}`;
  return clean;
}

module.exports = {
  DEFAULT_CATEGORIES,
  classifyShortcut,
  displayNameFromTarget,
  inferType,
  isUrl,
  normalizeTarget
};
