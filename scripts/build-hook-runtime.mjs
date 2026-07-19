#!/usr/bin/env node
import * as esbuild from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const DEFAULT_OUTFILE = 'bridge/hook-runtime.cjs';

function parseOutfile(args) {
  let outfile = DEFAULT_OUTFILE;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== '--outfile' || index + 1 >= args.length) {
      throw new Error('usage: build-hook-runtime.mjs [--outfile <path>]');
    }
    outfile = args[index + 1];
    index += 1;
  }
  return outfile;
}

const outfile = parseOutfile(process.argv.slice(2));
await mkdir(dirname(outfile), { recursive: true });

await esbuild.build({
  entryPoints: ['src/hooks/hook-runtime.ts'],
  bundle: true,
  packages: 'bundle',
  preserveSymlinks: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile,
});

console.error(`Built ${outfile}`);
