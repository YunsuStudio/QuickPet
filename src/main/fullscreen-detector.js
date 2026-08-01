'use strict';

const { execFile, spawn } = require('node:child_process');

const TYPE_SCRIPT = [
  'Add-Type @"',
  'using System;',
  'using System.Runtime.InteropServices;',
  'public class QPWin {',
  '  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();',
  '  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);',
  '  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);',
  '  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }',
  '}',
  '"@'
].join('\n');

const SAMPLE_SCRIPT = [
  '$h=[QPWin]::GetForegroundWindow(); $r=New-Object QPWin+RECT; [uint32]$pidValue=0;',
  '[QPWin]::GetWindowRect($h,[ref]$r) | Out-Null; [QPWin]::GetWindowThreadProcessId($h,[ref]$pidValue) | Out-Null;',
  '[pscustomobject]@{left=$r.Left;top=$r.Top;right=$r.Right;bottom=$r.Bottom;pid=$pidValue} | ConvertTo-Json -Compress'
].join('\n');

const SCRIPT = `${TYPE_SCRIPT}\n${SAMPLE_SCRIPT}`;
const WATCH_SCRIPT = `${TYPE_SCRIPT}\nwhile ($true) {\n${SAMPLE_SCRIPT}\nStart-Sleep -Milliseconds 2200\n}`;

function readForegroundRect() {
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', SCRIPT], {
      windowsHide: true,
      timeout: 4500,
      maxBuffer: 16 * 1024
    }, (error, stdout) => {
      if (error) return resolve(null);
      try { resolve(JSON.parse(stdout.trim())); } catch { resolve(null); }
    });
  });
}

function matchesDisplay(rect, display, ownProcessId = process.pid) {
  if (!rect || Number(rect.pid) === ownProcessId) return false;
  const bounds = display.bounds;
  const tolerance = 3;
  return Math.abs(rect.left - bounds.x) <= tolerance
    && Math.abs(rect.top - bounds.y) <= tolerance
    && Math.abs(rect.right - (bounds.x + bounds.width)) <= tolerance
    && Math.abs(rect.bottom - (bounds.y + bounds.height)) <= tolerance;
}

class FullscreenWatcher {
  constructor({ screen, onChange, readRect = readForegroundRect }) {
    this.screen = screen;
    this.onChange = onChange;
    this.readRect = readRect;
    this.timer = null;
    this.lastValue = false;
    this.running = false;
    this.process = null;
    this.output = '';
    this.fullscreenSamples = 0;
  }

  start() {
    if (this.process || process.platform !== 'win32') return;
    this.process = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WATCH_SCRIPT], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore']
    });
    this.process.stdout.setEncoding('utf8');
    this.process.stdout.on('data', (chunk) => this.consume(chunk));
    this.process.once('exit', () => { this.process = null; });
  }

  stop() {
    if (this.process) this.process.kill();
    this.process = null;
    this.output = '';
    this.fullscreenSamples = 0;
  }

  update(next) {
    if (!next) {
      this.fullscreenSamples = 0;
      if (!this.lastValue) return;
      this.lastValue = false;
      this.onChange(false);
      return;
    }
    if (this.lastValue) return;
    this.fullscreenSamples += 1;
    if (this.fullscreenSamples < 2) return;
    this.fullscreenSamples = 0;
    this.lastValue = true;
    this.onChange(true);
  }

  consume(chunk) {
    this.output += chunk;
    const lines = this.output.split(/\r?\n/);
    this.output = lines.pop() || '';
    for (const line of lines) {
      let rect;
      try { rect = JSON.parse(line.trim()); } catch { continue; }
      const next = this.screen.getAllDisplays().some((display) => matchesDisplay(rect, display));
      this.update(next);
    }
  }

  async tick() {
    if (this.running) return;
    this.running = true;
    const rect = await this.readRect();
    const next = this.screen.getAllDisplays().some((display) => matchesDisplay(rect, display));
    this.running = false;
    this.update(next);
  }
}

module.exports = { FullscreenWatcher, matchesDisplay, readForegroundRect, WATCH_SCRIPT };
