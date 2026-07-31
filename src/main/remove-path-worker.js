'use strict';

const fs = require('node:fs');

async function main() {
  const target = process.argv[2];
  const options = JSON.parse(process.argv[3] || '{}');
  if (!target) throw new Error('The removal target is missing.');
  await fs.promises.rm(target, options);
  process.send?.({ ok: true });
}

main().catch((error) => {
  process.send?.({
    ok: false,
    error: {
      code: error?.code || 'remove-failed',
      message: error?.message || String(error)
    }
  });
  process.exitCode = 1;
});
