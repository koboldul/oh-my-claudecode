import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import * as esbuild from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const NODE = process.execPath;
const REPO_ROOT = resolve(join(__dirname, '..', '..'));
let tempRoot: string;
let pluginRoot: string;
let workspace: string;
let scriptPath: string;

beforeAll(async () => {
  tempRoot = mkdtempSync(join(tmpdir(), 'omc-rules-skip-entrypoint-'));
  pluginRoot = join(tempRoot, 'plugin');
  workspace = join(tempRoot, 'workspace');
  scriptPath = join(pluginRoot, 'scripts', 'post-tool-rules-injector.mjs');

  mkdirSync(join(pluginRoot, 'scripts'), { recursive: true });
  cpSync(
    join(REPO_ROOT, 'scripts', 'lib'),
    join(pluginRoot, 'scripts', 'lib'),
    { recursive: true },
  );
  copyFileSync(
    join(REPO_ROOT, 'scripts', 'post-tool-rules-injector.mjs'),
    scriptPath,
  );
  writeFileSync(
    join(pluginRoot, 'package.json'),
    JSON.stringify({ type: 'module' }),
    'utf8',
  );

  execFileSync(
    NODE,
    [
      join(REPO_ROOT, 'scripts', 'build-hook-runtime.mjs'),
      '--outfile',
      join(pluginRoot, 'bridge', 'hook-runtime.cjs'),
    ],
    {
      cwd: REPO_ROOT,
      stdio: 'pipe',
      windowsHide: true,
    },
  );

  const processorPath = join(
    pluginRoot,
    'dist',
    'hooks',
    'rules-injector',
    'index.js',
  );
  mkdirSync(dirname(processorPath), { recursive: true });
  await esbuild.build({
    entryPoints: [
      join(REPO_ROOT, 'src', 'hooks', 'rules-injector', 'index.ts'),
    ],
    bundle: true,
    packages: 'bundle',
    preserveSymlinks: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    outfile: processorPath,
  });

  mkdirSync(workspace, { recursive: true });
  writeFileSync(join(workspace, 'package.json'), '{}\n', 'utf8');
  writeFileSync(join(workspace, 'README.md'), '# Test\n', 'utf8');
});

afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

function runHook(input: Record<string, unknown>, extraEnv?: Record<string, string>) {
  const testHome = join(tempRoot, 'home');
  mkdirSync(testHome, { recursive: true });
  const raw = execFileSync(NODE, [scriptPath], {
    cwd: workspace,
    input: JSON.stringify(input),
    encoding: 'utf-8',
    env: {
      ...process.env,
      CLAUDE_PLUGIN_ROOT: pluginRoot,
      HOME: testHome,
      NODE_ENV: 'test',
      USERPROFILE: testHome,
      ...extraEnv,
    },
    timeout: 15000,
  }).trim();

  return JSON.parse(raw) as {
    continue: boolean;
    suppressOutput?: boolean;
    hookSpecificOutput?: { hookEventName?: string; additionalContext?: string };
  };
}

describe('post-tool-rules-injector.mjs skip guards (DISABLE_OMC / OMC_SKIP_HOOKS)', () => {
  // A payload with a file_path drives the hook into its rules-processing path, so a
  // hook that ignores the kill switch would NOT emit the bare `{ continue: true }`
  // that a guarded short-circuit produces.
  const INPUT = {
    tool_name: 'Read',
    tool_input: { file_path: 'README.md' },
    session_id: 'abc',
  };

  function expectSkipped(extraEnv: Record<string, string>) {
    // Guarded hooks short-circuit before any processing with a bare continue.
    expect(runHook(INPUT, extraEnv)).toEqual({ continue: true });
  }

  it('no-ops when DISABLE_OMC=1', () => {
    expectSkipped({ DISABLE_OMC: '1', OMC_SKIP_HOOKS: '' });
  });

  it('no-ops when DISABLE_OMC=true', () => {
    expectSkipped({ DISABLE_OMC: 'true', OMC_SKIP_HOOKS: '' });
  });

  it('no-ops when OMC_SKIP_HOOKS contains the post-tool-use event token', () => {
    expectSkipped({ DISABLE_OMC: '', OMC_SKIP_HOOKS: 'post-tool-use' });
  });

  it('honors whitespace and commas in OMC_SKIP_HOOKS', () => {
    expectSkipped({ DISABLE_OMC: '', OMC_SKIP_HOOKS: ' keyword-detector , post-tool-use ' });
  });

  it('does not short-circuit when skip vars are empty', () => {
    // Not skipped: the hook runs its processing path, which always adds
    // suppressOutput (or injected context) rather than a bare continue.
    expect(runHook(INPUT, { DISABLE_OMC: '', OMC_SKIP_HOOKS: '' })).not.toEqual({ continue: true });
  });

  it('does not short-circuit for an unrelated OMC_SKIP_HOOKS token', () => {
    expect(runHook(INPUT, { DISABLE_OMC: '', OMC_SKIP_HOOKS: 'keyword-detector' })).not.toEqual({
      continue: true,
    });
  });

  it('processes normally when DISABLE_OMC=false', () => {
    expect(runHook(INPUT, { DISABLE_OMC: 'false', OMC_SKIP_HOOKS: '' })).not.toEqual({
      continue: true,
    });
  });
});
