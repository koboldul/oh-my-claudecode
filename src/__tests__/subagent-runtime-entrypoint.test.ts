import { execFileSync, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import * as esbuild from 'esbuild';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
} from 'vitest';

const ROOT = process.cwd();
const FIXTURE_PATH = join(
  ROOT,
  'src',
  '__tests__',
  'fixtures',
  'hooks',
  'copilot-1.0.72-1',
  'subagentStart.json',
);
const MANIFEST_PATH = join(ROOT, 'hooks', 'copilot-hooks.json');
const BUILD_RUNTIME_PATH = join(ROOT, 'scripts', 'build-hook-runtime.mjs');
const PROCESSOR_PATH = join(
  ROOT,
  'src',
  'hooks',
  'subagent-tracker',
  'index.ts',
);

interface HookEntry {
  command?: string;
}

interface NativeManifest {
  hooks: {
    subagentStart: HookEntry[];
  };
}

const tempRoots: string[] = [];
let runtimeBundlePath: string;
let processorBundlePath: string;
let buildRoot: string;

beforeAll(async () => {
  buildRoot = mkdtempSync(join(tmpdir(), 'omc-subagent-runtime-build-'));
  runtimeBundlePath = join(buildRoot, 'bridge', 'hook-runtime.cjs');
  processorBundlePath = join(
    buildRoot,
    'dist',
    'hooks',
    'subagent-tracker',
    'index.js',
  );
  execFileSync(
    process.execPath,
    [BUILD_RUNTIME_PATH, '--outfile', runtimeBundlePath],
    {
      cwd: ROOT,
      stdio: 'pipe',
      windowsHide: true,
    },
  );
  await esbuild.build({
    entryPoints: [PROCESSOR_PATH],
    bundle: true,
    packages: 'bundle',
    preserveSymlinks: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    outfile: processorBundlePath,
  });
});

afterAll(() => {
  rmSync(buildRoot, { recursive: true, force: true });
});

afterEach(() => {
  while (tempRoots.length > 0) {
    rmSync(tempRoots.pop()!, { recursive: true, force: true });
  }
});

describe('native Copilot subagentStart shipped entrypoint', () => {
  it('routes the observed fixture through subagent-tracker.mjs start', () => {
    const manifest = JSON.parse(
      readFileSync(MANIFEST_PATH, 'utf8'),
    ) as NativeManifest;
    const entry = manifest.hooks.subagentStart[0];
    expect(entry.command).toContain('/scripts/subagent-tracker.mjs start');

    const tempRoot = mkdtempSync(join(tmpdir(), 'omc-subagent-entrypoint-'));
    tempRoots.push(tempRoot);
    const pluginRoot = join(tempRoot, 'plugin');
    const project = join(tempRoot, 'project');
    const scriptPath = join(
      pluginRoot,
      'scripts',
      'subagent-tracker.mjs',
    );
    const stagedRuntimePath = join(
      pluginRoot,
      'bridge',
      'hook-runtime.cjs',
    );
    const stagedProcessorPath = join(
      pluginRoot,
      'dist',
      'hooks',
      'subagent-tracker',
      'index.js',
    );
    mkdirSync(project, { recursive: true });
    mkdirSync(join(project, '.git'));
    mkdirSync(dirname(scriptPath), { recursive: true });
    cpSync(
      join(ROOT, 'scripts', 'lib'),
      join(pluginRoot, 'scripts', 'lib'),
      { recursive: true },
    );
    copyFileSync(
      join(ROOT, 'scripts', 'subagent-tracker.mjs'),
      scriptPath,
    );
    mkdirSync(dirname(stagedRuntimePath), { recursive: true });
    copyFileSync(runtimeBundlePath, stagedRuntimePath);
    mkdirSync(dirname(stagedProcessorPath), { recursive: true });
    copyFileSync(processorBundlePath, stagedProcessorPath);
    writeFileSync(
      join(pluginRoot, 'package.json'),
      JSON.stringify({ type: 'module' }),
      'utf8',
    );

    const fixture = JSON.parse(
      readFileSync(FIXTURE_PATH, 'utf8'),
    ) as Record<string, unknown>;
    const sessionId = 'native-subagent-session';
    const payload = {
      ...fixture,
      sessionId,
      cwd: project,
      transcriptPath: join(project, 'events.jsonl'),
      agentName: 'explore',
      agentDisplayName: 'Explore',
      agentDescription: 'Inspect native hook routing',
    };
    const home = join(tempRoot, 'home');
    mkdirSync(home, { recursive: true });

    const result = spawnSync(process.execPath, [scriptPath, 'start'], {
      cwd: project,
      input: JSON.stringify(payload),
      encoding: 'utf8',
      timeout: 15_000,
      windowsHide: true,
      env: {
        ...process.env,
        CLAUDE_CONFIG_DIR: join(home, '.claude'),
        CLAUDE_PLUGIN_ROOT: pluginRoot,
        DISABLE_OMC: '',
        HOME: home,
        NODE_ENV: 'test',
        OMC_HOST: 'copilot',
        OMC_NOTIFY: '0',
        OMC_SKIP_HOOKS: '',
        OMC_STATE_DIR: '',
        USERPROFILE: home,
      },
    });

    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      additionalContext: expect.stringContaining('Agent explore'),
    });

    const statePath = join(
      project,
      '.omc',
      'state',
      'sessions',
      sessionId,
      'subagent-tracking-state.json',
    );
    expect(existsSync(statePath)).toBe(true);
    expect(JSON.parse(readFileSync(statePath, 'utf8'))).toMatchObject({
      total_spawned: 1,
      agents: [
        {
          agent_name: 'explore',
          agent_display_name: 'Explore',
          agent_description: 'Inspect native hook routing',
          status: 'running',
        },
      ],
    });
  });
});
