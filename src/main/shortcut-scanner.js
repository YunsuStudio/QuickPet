'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { inferType } = require('../shared/classifier');

function safeReadJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return null; }
}

function collectBookmarks(node, source, output) {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'url' && /^https?:\/\//i.test(node.url || '')) {
    output.push({ name: String(node.name || node.url), target: node.url, type: 'website', source });
  }
  for (const child of node.children || []) collectBookmarks(child, source, output);
}

function scanBookmarks(localAppData = process.env.LOCALAPPDATA || '') {
  const browsers = [
    ['Chrome 书签', path.join(localAppData, 'Google', 'Chrome', 'User Data')],
    ['Edge 书签', path.join(localAppData, 'Microsoft', 'Edge', 'User Data')]
  ];
  const output = [];
  for (const [source, root] of browsers) {
    if (!fs.existsSync(root)) continue;
    let profiles = [];
    try {
      profiles = fs.readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && /^(Default|Profile \d+)$/i.test(entry.name))
        .map((entry) => entry.name);
    } catch {}
    for (const profile of profiles) {
      const data = safeReadJson(path.join(root, profile, 'Bookmarks'));
      if (!data?.roots) continue;
      for (const node of Object.values(data.roots)) collectBookmarks(node, source, output);
    }
  }
  return output;
}

function parseInternetShortcut(filePath) {
  try {
    const text = fs.readFileSync(filePath, 'utf8');
    const match = text.match(/^URL=(.+)$/im);
    return match?.[1]?.trim() || '';
  } catch {
    return '';
  }
}

function walkFiles(root, depth = 0, maximumDepth = 5, output = []) {
  if (!root || !fs.existsSync(root) || depth > maximumDepth) return output;
  let entries = [];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return output; }
  for (const entry of entries) {
    const filePath = path.join(root, entry.name);
    if (entry.isDirectory()) walkFiles(filePath, depth + 1, maximumDepth, output);
    else output.push(filePath);
  }
  return output;
}

function scanWindowsShortcuts({ source, roots, readShortcutLink, includeRegularFiles = false }) {
  const output = [];
  for (const root of roots) {
    for (const filePath of walkFiles(root)) {
      const extension = path.extname(filePath).toLowerCase();
      let target = '';
      if (extension === '.lnk') {
        try { target = readShortcutLink(filePath)?.target || ''; } catch {}
      } else if (extension === '.url') {
        target = parseInternetShortcut(filePath);
      } else if (includeRegularFiles && !/^\.(ini|db|log)$/i.test(extension)) {
        target = filePath;
      }
      if (!target) continue;
      output.push({
        name: path.basename(filePath, extension),
        target,
        type: inferType(target),
        source
      });
    }
  }
  return output;
}

function scanDesktop(roots, readShortcutLink) {
  const output = [];
  for (const root of roots) {
    if (!root || !fs.existsSync(root)) continue;
    let entries = [];
    try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (/^(desktop\.ini|thumbs\.db)$/i.test(entry.name)) continue;
      const filePath = path.join(root, entry.name);
      const extension = path.extname(filePath).toLowerCase();
      let target = entry.isDirectory() ? filePath : '';
      if (extension === '.lnk') {
        try { target = readShortcutLink(filePath)?.target || ''; } catch {}
      } else if (extension === '.url') target = parseInternetShortcut(filePath);
      else if (!target) target = filePath;
      if (target) output.push({ name: path.basename(entry.name, extension), target, type: inferType(target), source: '桌面' });
    }
  }
  return output;
}

function uniqueCandidates(candidates, existingTargets = []) {
  const used = new Set(existingTargets.map((target) => String(target).replace(/[\\/]+$/, '').toLowerCase()));
  const output = [];
  for (const item of candidates) {
    const key = String(item.target || '').replace(/[\\/]+$/, '').toLowerCase();
    if (!key || used.has(key)) continue;
    used.add(key);
    output.push({ ...item, id: Buffer.from(`${item.source}\0${key}`).toString('base64url').slice(0, 32) });
  }
  return output.slice(0, 1500);
}

function scanSources(kind, { app, readShortcutLink, existingTargets = [] }) {
  let candidates = [];
  if (kind === 'desktop' || kind === 'all') {
    const roots = [app.getPath('desktop'), path.join(process.env.PUBLIC || 'C:\\Users\\Public', 'Desktop')];
    candidates.push(...scanDesktop(roots, readShortcutLink));
  }
  if (kind === 'start-menu' || kind === 'all') {
    const roots = [
      path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
      path.join(process.env.ProgramData || 'C:\\ProgramData', 'Microsoft', 'Windows', 'Start Menu', 'Programs')
    ];
    candidates.push(...scanWindowsShortcuts({ source: '开始菜单', roots, readShortcutLink }));
  }
  if (kind === 'bookmarks' || kind === 'all') candidates.push(...scanBookmarks());
  return uniqueCandidates(candidates, existingTargets);
}

module.exports = {
  collectBookmarks,
  scanBookmarks,
  scanDesktop,
  scanSources,
  scanWindowsShortcuts,
  uniqueCandidates
};
