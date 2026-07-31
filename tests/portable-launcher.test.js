'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('便携启动器使用跨 PowerShell 版本安全的工作室署名', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'create-portable-launcher.ps1'), 'utf8');
  assert.doesNotMatch(source, /[^\x00-\x7f]/);
  assert.match(source, /AssemblyCompany\("\\u4e91\\u95f4\\u6eaf\\u5de5\\u4f5c\\u5ba4"\)/);
  assert.match(source, /AssemblyCopyright\("Copyright \\u00a9 2026 \\u4e91\\u95f4\\u6eaf\\u5de5\\u4f5c\\u5ba4"\)/);
});

test('便携版把运行文件解压到 EXE 同级目录并传递缓存根路径', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'create-portable-launcher.ps1'), 'utf8');
  assert.match(source, /Path\.GetDirectoryName\(Application\.ExecutablePath\)/);
  assert.match(source, /QuickPet-Portable-Cache/);
  assert.match(source, /QUICKPET_PORTABLE_CACHE_ROOT/);
});

test('便携版启动器会把诊断参数传给内层程序', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'create-portable-launcher.ps1'), 'utf8');
  assert.match(source, /CreateStartInfo\(application, cacheDirectory, args\)/);
  assert.match(source, /String\.Join\(" ", \(arguments \?\? new string\[0\]\)\.Select\(QuoteArgument\)\)/);
});

test('旧版便携 EXE 会在解压前转到同目录的最新版本', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'create-portable-launcher.ps1'), 'utf8');
  assert.match(source, /TryLaunchNewerPortable\(args\)/);
  assert.match(source, /candidateVersion\.CompareTo\(currentVersion\) > 0/);
  assert.ok(source.indexOf('TryLaunchNewerPortable(args)') < source.indexOf('EnsureExtracted()'));
});

test('最新版会可恢复地停用同目录已有旧版 EXE', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'create-portable-launcher.ps1'), 'utf8');
  assert.match(source, /DisableOlderPortableLaunchers\(\)/);
  assert.match(source, /candidate\.Version\.CompareTo\(currentVersion\) < 0/);
  assert.match(source, /string disabledPath = candidate\.Path \+ "\.disabled"/);
  assert.match(source, /File\.Move\(candidate\.Path, disabledPath\)/);
  assert.ok(source.indexOf('DisableOlderPortableLaunchers()') < source.indexOf('EnsureExtracted()'));
});

test('便携启动器识别同目录内被改名的快捷宠版本', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'create-portable-launcher.ps1'), 'utf8');
  assert.match(source, /Directory\.GetFiles\(directory, "\*\.exe", SearchOption\.TopDirectoryOnly\)/);
  assert.match(source, /IsPortableLauncher\(path\)/);
  assert.match(source, /ProductName/);
});

test('便携启动器为旧 EXE 和旧缓存处理失败写入诊断日志', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'create-portable-launcher.ps1'), 'utf8');
  assert.match(source, /QuickPet-Portable\.log/);
  assert.match(source, /WriteDiagnostic\("disable-old-launcher"/);
  assert.match(source, /WriteDiagnostic\("quarantine-stale-cache"/);
  assert.match(source, /WriteDiagnostic\("delete-quarantined-cache"/);
});

test('便携启动器先隔离旧运行目录再启动程序并后台删除', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'create-portable-launcher.ps1'), 'utf8');
  assert.match(source, /QuarantineStaleCaches\(cacheDirectory\)/);
  assert.match(source, /DeleteQuarantinedCaches\(staleCaches\)/);
  assert.match(source, /Directory\.Move\(candidate, deletingDirectory\)/);
  assert.match(source, /Directory\.Delete\(deletingDirectory, true\)/);
  assert.ok(source.indexOf('QuarantineStaleCaches(cacheDirectory)') < source.indexOf('Process.Start(CreateStartInfo(application, cacheDirectory, args))'));
  assert.ok(source.indexOf('DeleteQuarantinedCaches(staleCaches)') > source.indexOf('Process.Start(CreateStartInfo(application, cacheDirectory, args))'));
});
