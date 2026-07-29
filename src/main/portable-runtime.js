'use strict';

const path = require('node:path');

function isPathInside(parent, target) {
  if (!parent || !target) return false;
  const root = path.resolve(parent);
  const resolved = path.resolve(target);
  return resolved === root || resolved.startsWith(`${root}${path.sep}`);
}

function loginLaunchTarget(env = process.env, executablePath = process.execPath) {
  if (env.QUICKPET_PORTABLE === '1' && env.PORTABLE_EXECUTABLE_FILE) {
    return path.resolve(env.PORTABLE_EXECUTABLE_FILE);
  }
  return executablePath;
}

function programRemovalTarget({ env = process.env, execPath = process.execPath, localAppData = env.LOCALAPPDATA || '' } = {}) {
  const currentDirectory = path.dirname(execPath);
  const installedRoot = localAppData ? path.join(localAppData, 'Programs', 'QuickPet') : '';
  if (installedRoot && isPathInside(installedRoot, currentDirectory)) return installedRoot;
  if (env.QUICKPET_PORTABLE !== '1') return '';
  const cacheRoot = env.QUICKPET_PORTABLE_CACHE_ROOT || '';
  return cacheRoot && isPathInside(cacheRoot, currentDirectory) && path.resolve(cacheRoot) !== path.resolve(currentDirectory)
    ? currentDirectory
    : '';
}

module.exports = { loginLaunchTarget, programRemovalTarget, isPathInside };
