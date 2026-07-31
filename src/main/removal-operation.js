'use strict';

const path = require('node:path');
const { fork } = require('node:child_process');

function removalError(details = {}) {
  const error = new Error(details.message || 'Unable to remove the cache entry.');
  error.code = details.code || 'remove-failed';
  return error;
}

function createRemoveOperation(target, options) {
  let child;
  let settled = false;
  let resolveExit;
  const exited = new Promise((resolve) => { resolveExit = resolve; });

  const promise = new Promise((resolve, reject) => {
    try {
      child = fork(path.join(__dirname, 'remove-path-worker.js'), [target, JSON.stringify(options || {})], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        execArgv: [],
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        windowsHide: true
      });
    } catch (error) {
      settled = true;
      resolveExit();
      reject(error);
      return;
    }

    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      callback(value);
    };
    child.once('message', (message) => {
      if (message?.ok) finish(resolve);
      else finish(reject, removalError(message?.error));
    });
    child.once('error', (error) => {
      resolveExit();
      finish(reject, error);
    });
    child.once('exit', (code, signal) => {
      resolveExit();
      if (!settled) {
        finish(reject, removalError({
          code: signal ? 'remove-cancelled' : 'remove-worker-exit',
          message: signal
            ? `Cache removal was stopped by ${signal}.`
            : `Cache removal worker exited with code ${code}.`
        }));
      }
    });
  });

  return {
    promise,
    async cancel() {
      if (!child || child.exitCode !== null || child.signalCode !== null) return;
      if (!child.kill()) throw removalError({ code: 'cancel-failed', message: 'Unable to stop the cache removal worker.' });
      await exited;
    }
  };
}

module.exports = { createRemoveOperation };
