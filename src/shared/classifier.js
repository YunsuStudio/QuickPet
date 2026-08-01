'use strict';

const path = require('node:path');

const DEFAULT_CATEGORIES = [];
const DEFAULT_CATEGORY_ID = '';

const LEGACY_CATEGORIES = [
  { id: 'tools', name: '工具', icon: '🧰', color: '#5f6368', destination: '' },
  { id: 'study', name: '学习', icon: '📚', color: '#45b7a8', destination: '' },
  { id: 'work', name: '工作', icon: '💼', color: '#6c7cff', destination: '' },
  { id: 'design', name: '设计', icon: '🎨', color: '#f38bb3', destination: 'work' },
  { id: 'develop', name: '开发', icon: '⌨️', color: '#8a76e8', destination: 'work' },
  { id: 'social', name: '社交', icon: '💬', color: '#57a8ef', destination: 'tools' },
  { id: 'media', name: '影音', icon: '🎬', color: '#ff8b61', destination: 'tools' },
  { id: 'life', name: '生活', icon: '🌿', color: '#72bd69', destination: 'tools' },
  { id: 'other', name: '其他', icon: '✨', color: '#9aa0b5', destination: 'tools' }
];

const APP_EXTENSIONS = new Set(['.exe', '.lnk', '.bat', '.cmd', '.com', '.msi', '.appref-ms']);
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tif', '.tiff', '.avif', '.heic', '.ico']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mkv', '.avi', '.mov', '.webm', '.wmv', '.flv', '.m4v', '.mpeg', '.mpg']);
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.flac', '.aac', '.m4a', '.ogg', '.opus', '.wma']);
const DESIGN_EXTENSIONS = new Set(['.psd', '.ai', '.sketch', '.fig', '.blend', '.svg']);
const STUDY_EXTENSIONS = new Set(['.pdf', '.epub', '.mobi', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx', '.txt', '.rtf', '.odt', '.ods', '.odp', '.csv']);
const CODE_EXTENSIONS = new Set(['.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.go', '.rs', '.cpp', '.c', '.cs', '.html', '.css', '.json', '.md']);
const ARCHIVE_EXTENSIONS = new Set(['.zip', '.7z', '.rar', '.tar', '.gz', '.bz2', '.xz', '.cab', '.iso']);
const DOMAIN_TLDS = new Set(['com', 'cn', 'net', 'org', 'io', 'ai', 'dev', 'app', 'me', 'info', 'biz', 'xyz', 'top', 'site', 'online', 'store', 'tech', 'cloud', 'cc', 'tv', 'co', 'uk', 'jp', 'de', 'fr', 'ru', 'hk', 'tw']);
const EXPLICIT_TYPES = new Set(['website', 'app', 'folder', 'image', 'video', 'audio', 'document', 'archive', 'code', 'design', 'file']);

function protocolOf(value = '') {
  const clean = String(value).trim();
  if (/^[a-z]:[\\/]/i.test(clean)) return '';
  return /^([a-z][a-z0-9+.-]*):/i.exec(clean)?.[1]?.toLowerCase() || '';
}

function isWebUrl(value = '') {
  return ['http', 'https'].includes(protocolOf(value));
}

function isUrl(value = '') {
  return ['http', 'https', 'mailto'].includes(protocolOf(value));
}

function isProtocolTarget(value = '') {
  return Boolean(protocolOf(value));
}

function looksLikeBareDomain(value = '') {
  const clean = String(value).trim();
  if (!clean || /[\\\s]/.test(clean) || /^[./]/.test(clean)) return false;
  const host = clean.split(/[/?#]/, 1)[0].replace(/:\d{1,5}$/, '').toLowerCase();
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(host)) return true;
  const labels = host.split('.');
  if (labels.length < 2 || !DOMAIN_TLDS.has(labels.at(-1)) && !labels.at(-1).startsWith('xn--')) return false;
  return labels.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label));
}

function detailedTypeForExtension(extension) {
  if (IMAGE_EXTENSIONS.has(extension)) return 'image';
  if (VIDEO_EXTENSIONS.has(extension)) return 'video';
  if (AUDIO_EXTENSIONS.has(extension)) return 'audio';
  if (STUDY_EXTENSIONS.has(extension)) return 'document';
  if (ARCHIVE_EXTENSIONS.has(extension)) return 'archive';
  if (CODE_EXTENSIONS.has(extension)) return 'code';
  if (DESIGN_EXTENSIONS.has(extension)) return 'design';
  return '';
}

function inferType(target = '', hintedType = '') {
  const normalized = normalizeTarget(target);
  const protocol = protocolOf(normalized);
  if (['http', 'https', 'mailto'].includes(protocol)) return 'website';
  if (protocol) return 'app';
  const extension = path.extname(String(normalized).replace(/^"|"$/g, '')).toLowerCase();
  if (extension === '.url') return 'website';
  if (APP_EXTENSIONS.has(extension)) return 'app';
  if (EXPLICIT_TYPES.has(hintedType)) return hintedType;
  const detailedType = detailedTypeForExtension(extension);
  if (detailedType) return detailedType;
  return extension ? 'file' : 'folder';
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
  const clean = String(target).replace(/[\\/]+$/, '');
  const parsed = path.parse(clean);
  return parsed.name || parsed.base || '未命名快捷方式';
}

function normalizeTarget(target = '') {
  const clean = String(target).trim();
  if (/^www\./i.test(clean) || looksLikeBareDomain(clean)) return `https://${clean}`;
  return clean;
}

module.exports = {
  APP_EXTENSIONS,
  DEFAULT_CATEGORY_ID,
  DEFAULT_CATEGORIES,
  LEGACY_CATEGORIES,
  displayNameFromTarget,
  inferType,
  isProtocolTarget,
  isUrl,
  isWebUrl,
  normalizeTarget,
  protocolOf
};
