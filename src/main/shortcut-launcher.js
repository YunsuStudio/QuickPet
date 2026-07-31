'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { isProtocolTarget, protocolOf } = require('../shared/classifier');

function expandEnvironmentVariables(value, environment = process.env) {
  const keys = new Map(Object.keys(environment || {}).map((key) => [key.toLowerCase(), environment[key]]));
  return String(value || '').replace(/%([^%]+)%/g, (match, name) => keys.has(name.toLowerCase()) ? keys.get(name.toLowerCase()) : match);
}

function splitArguments(value = '') {
  const output = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === '"') {
      quoted = !quoted;
      continue;
    }
    if (/\s/.test(character) && !quoted) {
      if (current) output.push(current);
      current = '';
      continue;
    }
    current += character;
  }
  if (current) output.push(current);
  return output;
}

function commandParts(target) {
  const quoted = /^"([^"]+\.(?:exe|com|bat|cmd))"(?:\s+(.*))?$/i.exec(target);
  const plain = /^(.+?\.(?:exe|com|bat|cmd))(?:\s+(.*))$/i.exec(target);
  const match = quoted || plain;
  if (!match) return null;
  return { executable: match[1], arguments: splitArguments(match[2] || '') };
}

function createLaunchPlan(target, { environment = process.env, exists = fs.existsSync } = {}) {
  const expanded = expandEnvironmentVariables(String(target || '').trim(), environment);
  if (!expanded) throw new Error('快捷方式目标为空');
  if (['javascript', 'data', 'vbscript'].includes(protocolOf(expanded))) throw new Error('不支持这个协议');
  if (isProtocolTarget(expanded)) return { kind: 'external', target: expanded };
  if (exists(expanded)) return { kind: 'path', target: expanded };
  const command = commandParts(expanded);
  if (command) {
    return {
      kind: 'command',
      executable: command.executable,
      arguments: command.arguments,
      cwd: path.dirname(command.executable)
    };
  }
  return { kind: 'path', target: expanded };
}

async function launchTarget(target, {
  environment = process.env,
  exists = fs.existsSync,
  openExternal,
  openPath,
  spawnProcess = spawn
} = {}) {
  const plan = createLaunchPlan(target, { environment, exists });
  if (plan.kind === 'external') {
    await openExternal(plan.target, { activate: true });
    return plan;
  }
  if (plan.kind === 'path') {
    const message = await openPath(plan.target);
    if (message) throw new Error(message);
    return plan;
  }
  const child = spawnProcess(plan.executable, plan.arguments, {
    cwd: plan.cwd,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    shell: false
  });
  child.unref();
  return plan;
}

module.exports = { commandParts, createLaunchPlan, expandEnvironmentVariables, launchTarget, splitArguments };
