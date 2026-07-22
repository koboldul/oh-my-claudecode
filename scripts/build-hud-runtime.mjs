#!/usr/bin/env node
import * as esbuild from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const DEFAULT_OUTDIR = 'bridge';
const ARTIFACTS = Object.freeze([
  {
    entryPoint: 'src/hud/index.ts',
    fileName: 'hud-runtime.mjs',
  },
  {
    entryPoint: 'src/hud/copilot-setup.ts',
    fileName: 'copilot-hud-setup.mjs',
  },
]);

function parseOutdir(args) {
  let outdir = DEFAULT_OUTDIR;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== '--outdir' || index + 1 >= args.length) {
      throw new Error('usage: build-hud-runtime.mjs [--outdir <path>]');
    }
    outdir = args[index + 1];
    index += 1;
  }
  return outdir;
}

const outdir = parseOutdir(process.argv.slice(2));
await mkdir(outdir, { recursive: true });

await Promise.all(ARTIFACTS.map(({ entryPoint, fileName }) => {
  const outfile = join(outdir, fileName);
  return esbuild.build({
    entryPoints: [entryPoint],
    bundle: true,
    packages: 'bundle',
    preserveSymlinks: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    mainFields: ['module', 'main'],
    outfile,
  });
}));

console.error(
  `Built ${ARTIFACTS.map(({ fileName }) => join(outdir, fileName)).join(', ')}`,
);
