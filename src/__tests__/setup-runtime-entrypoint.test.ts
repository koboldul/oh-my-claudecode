import {
  execFileSync,
  spawnSync,
  type SpawnSyncReturns,
} from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
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

const REPO_ROOT = process.cwd();
const BUILD_RUNTIME_PATH = join(
  REPO_ROOT,
  'scripts',
  'build-hook-runtime.mjs',
);
const FIXTURE_ROOT = join(
  REPO_ROOT,
  'src',
  '__tests__',
  'fixtures',
  'hooks',
);
const CLAUDE_HOOKS_MANIFEST_PATH = join(
  REPO_ROOT,
  'hooks',
  'hooks.json',
);
const COPILOT_HOOKS_MANIFEST_PATH = join(
  REPO_ROOT,
  'hooks',
  'copilot-hooks.json',
);

const SCRIPT_CONFIG = {
  init: {
    filename: 'setup-init.mjs',
    hookType: 'setup-init',
    matcher: 'init',
  },
  maintenance: {
    filename: 'setup-maintenance.mjs',
    hookType: 'setup-maintenance',
    matcher: 'maintenance',
  },
} as const;

type ScriptName = keyof typeof SCRIPT_CONFIG;
type HookPayload = Record<string, unknown>;
type RuntimeMode = 'valid' | 'missing' | 'corrupt';

interface StagedPlugin {
  root: string;
  scripts: Record<ScriptName, string>;
}

function loadFixture(
  host: 'claude' | 'copilot-1.0.72-1',
): HookPayload {
  const filename = host === 'claude'
    ? 'SessionStart.json'
    : 'sessionStart.json';
  return JSON.parse(
    readFileSync(join(FIXTURE_ROOT, host, filename), 'utf8'),
  ) as HookPayload;
}

function exactClaudeSetupContext(context: string): HookPayload {
  return {
    continue: true,
    hookSpecificOutput: {
      hookEventName: 'Setup',
      additionalContext: context,
    },
  };
}

function expectExactOutput(
  result: SpawnSyncReturns<string>,
  output: HookPayload,
): void {
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  expect(result.signal).toBeNull();
  expect(result.stderr).toBe('');
  expect(result.stdout).toBe(`${JSON.stringify(output)}\n`);
}

describe('shipped setup canonical runtime entrypoints', () => {
  const tempRoots: string[] = [];
  let fixtureRoot: string;
  let runtimeFixturePath: string;
  let setupProcessorFixturePath: string;

  beforeAll(async () => {
    fixtureRoot = mkdtempSync(join(tmpdir(), 'omc setup fixtures '));
    runtimeFixturePath = join(fixtureRoot, 'bridge', 'hook-runtime.cjs');
    setupProcessorFixturePath = join(
      fixtureRoot,
      'processor',
      'setup',
      'index.js',
    );

    execFileSync(
      process.execPath,
      [BUILD_RUNTIME_PATH, '--outfile', runtimeFixturePath],
      {
        cwd: REPO_ROOT,
        stdio: 'pipe',
        windowsHide: true,
      },
    );
    await esbuild.build({
      entryPoints: [
        join(REPO_ROOT, 'src', 'hooks', 'setup', 'index.ts'),
      ],
      bundle: true,
      packages: 'bundle',
      preserveSymlinks: true,
      platform: 'node',
      target: 'node20',
      format: 'esm',
      outfile: setupProcessorFixturePath,
    });
  });

  afterAll(() => {
    rmSync(fixtureRoot, { recursive: true, force: true });
  });

  afterEach(() => {
    while (tempRoots.length > 0) {
      rmSync(tempRoots.pop()!, { recursive: true, force: true });
    }
  });

  function stagePlugin(runtime: RuntimeMode = 'valid'): StagedPlugin {
    const root = mkdtempSync(join(tmpdir(), 'omc setup entrypoint '));
    tempRoots.push(root);

    const scriptsDir = join(root, 'scripts');
    const scriptsLibDir = join(scriptsDir, 'lib');
    mkdirSync(scriptsLibDir, { recursive: true });
    copyFileSync(
      join(REPO_ROOT, 'scripts', 'lib', 'hook-runtime-loader.mjs'),
      join(scriptsLibDir, 'hook-runtime-loader.mjs'),
    );
    copyFileSync(
      join(REPO_ROOT, 'scripts', 'lib', 'stdin.mjs'),
      join(scriptsLibDir, 'stdin.mjs'),
    );

    const scripts = {} as Record<ScriptName, string>;
    for (const [name, config] of Object.entries(SCRIPT_CONFIG) as Array<
      [ScriptName, (typeof SCRIPT_CONFIG)[ScriptName]]
    >) {
      const scriptPath = join(scriptsDir, config.filename);
      copyFileSync(
        join(REPO_ROOT, 'scripts', config.filename),
        scriptPath,
      );
      scripts[name] = scriptPath;
    }

    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ type: 'module' }),
      'utf8',
    );

    const runtimePath = join(root, 'bridge', 'hook-runtime.cjs');
    if (runtime !== 'missing') {
      mkdirSync(dirname(runtimePath), { recursive: true });
      if (runtime === 'valid') {
        copyFileSync(runtimeFixturePath, runtimePath);
      } else {
        writeFileSync(runtimePath, 'module.exports = {\n', 'utf8');
      }
    }

    const processorPath = join(root, 'dist', 'hooks', 'setup', 'index.js');
    mkdirSync(dirname(processorPath), { recursive: true });
    copyFileSync(setupProcessorFixturePath, processorPath);

    return { root, scripts };
  }

  function makeWorktree(label: string): string {
    const root = mkdtempSync(join(tmpdir(), `omc setup ${label} `));
    tempRoots.push(root);
    return root;
  }

  function runHook(
    staged: StagedPlugin,
    name: ScriptName,
    input: HookPayload | string,
    cwd: string,
    extraEnv: Record<string, string> = {},
  ): SpawnSyncReturns<string> {
    const home = join(cwd, 'home with spaces');
    mkdirSync(home, { recursive: true });

    return spawnSync(process.execPath, [staged.scripts[name]], {
      cwd,
      input: typeof input === 'string' ? input : JSON.stringify(input),
      encoding: 'utf8',
      env: {
        ...process.env,
        CLAUDE_CONFIG_DIR: join(cwd, 'claude config'),
        CLAUDE_ENV_FILE: '',
        CLAUDE_PLUGIN_ROOT: staged.root,
        COPILOT_HOME: join(cwd, 'copilot home'),
        HOME: home,
        OMC_HOST: '',
        USERPROFILE: home,
        ...extraEnv,
      },
      windowsHide: true,
    });
  }

  it('preserves exact Claude init output and explicit init matcher behavior', () => {
    const staged = stagePlugin();
    const cwd = makeWorktree('claude init');
    const result = runHook(
      staged,
      'init',
      {
        ...loadFixture('claude'),
        cwd,
        session_id: 'setup-claude-init',
        trigger: 'maintenance',
      },
      cwd,
    );

    expectExactOutput(
      result,
      exactClaudeSetupContext([
        'OMC initialized:',
        '- 5 directories created',
        '- 0 configs validated',
      ].join('\n')),
    );
    expect(existsSync(join(cwd, '.omc', 'state'))).toBe(true);
    expect(existsSync(join(cwd, '.omc', 'logs'))).toBe(true);
    expect(existsSync(join(cwd, '.omc', 'notepads'))).toBe(true);
    expect(existsSync(join(cwd, '.omc', 'state', 'checkpoints'))).toBe(true);
    expect(existsSync(join(cwd, '.omc', 'plans'))).toBe(true);
  });

  it('preserves exact Claude maintenance output and explicit maintenance matcher behavior', () => {
    const staged = stagePlugin();
    const cwd = makeWorktree('claude maintenance');
    const stateDir = join(cwd, '.omc', 'state');
    const staleState = join(stateDir, 'old-setup-state.json');
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(staleState, '{}', 'utf8');
    const oldTime = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    utimesSync(staleState, oldTime, oldTime);

    const result = runHook(
      staged,
      'maintenance',
      {
        ...loadFixture('claude'),
        cwd,
        session_id: 'setup-claude-maintenance',
        trigger: 'init',
      },
      cwd,
    );

    expectExactOutput(
      result,
      exactClaudeSetupContext([
        'OMC maintenance completed:',
        '- 1 old state files pruned',
      ].join('\n')),
    );
    expect(existsSync(staleState)).toBe(false);
    expect(existsSync(join(cwd, '.omc', 'logs'))).toBe(false);
  });

  it('does not claim Setup output for a direct Copilot init payload', () => {
    const staged = stagePlugin();
    const cwd = makeWorktree('copilot init path spaces');
    const claudeConfigDir = join(cwd, 'claude config must stay absent');
    const claudeEnvFile = join(cwd, 'claude env must stay absent');
    const result = runHook(
      staged,
      'init',
      {
        ...loadFixture('copilot-1.0.72-1'),
        cwd,
        sessionId: 'setup-copilot-init',
        trigger: 'maintenance',
      },
      cwd,
      {
        CLAUDE_CONFIG_DIR: claudeConfigDir,
        CLAUDE_ENV_FILE: claudeEnvFile,
        OMC_HOST: 'claude',
      },
    );

    expectExactOutput(result, {});
    expect(existsSync(join(cwd, '.omc', 'state'))).toBe(true);
    expect(existsSync(claudeConfigDir)).toBe(false);
    expect(existsSync(claudeEnvFile)).toBe(false);
  });

  it('does not claim Setup output for a direct Copilot maintenance payload', () => {
    const staged = stagePlugin();
    const cwd = makeWorktree('copilot maintenance');
    const result = runHook(
      staged,
      'maintenance',
      {
        ...loadFixture('copilot-1.0.72-1'),
        cwd,
        sessionId: 'setup-copilot-maintenance',
        trigger: 'init',
      },
      cwd,
    );

    expectExactOutput(result, {});
  });

  it.each(
    (Object.keys(SCRIPT_CONFIG) as ScriptName[]).flatMap((name) =>
      (['missing', 'corrupt'] as const).map((runtime) => ({ name, runtime })),
    ),
  )('preserves fail-open output when $name runtime is $runtime', ({
    name,
    runtime,
  }) => {
    const staged = stagePlugin(runtime);
    const cwd = makeWorktree(`${name} runtime ${runtime}`);
    const result = runHook(
      staged,
      name,
      {
        ...loadFixture('claude'),
        cwd,
        session_id: `setup-${name}-${runtime}`,
      },
      cwd,
    );

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.signal).toBeNull();
    expect(result.stdout).toBe(
      `${JSON.stringify({ continue: true, suppressOutput: true })}\n`,
    );
    expect(result.stderr).toContain(`[setup-${name}] Error:`);
    expect(result.stderr).toContain('Canonical hook runtime bundle');
  });

  it.each(Object.keys(SCRIPT_CONFIG) as ScriptName[])(
    'preserves fail-open output for malformed %s JSON',
    (name) => {
      const staged = stagePlugin();
      const cwd = makeWorktree(`${name} malformed json`);
      const result = runHook(staged, name, '{"unterminated"', cwd);

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      expect(result.stdout).toBe(
        `${JSON.stringify({ continue: true, suppressOutput: true })}\n`,
      );
      expect(result.stderr).toContain(`[setup-${name}] Error:`);
    },
  );

  it('keeps setup matchers only in the Claude hook manifest', () => {
    const claudeManifest = JSON.parse(
      readFileSync(CLAUDE_HOOKS_MANIFEST_PATH, 'utf8'),
    ) as {
      hooks: {
        SessionStart: Array<{
          matcher: string;
          hooks: Array<{
            command: string;
            bash: string;
            powershell: string;
          }>;
        }>;
      };
    };
    const copilotManifestSource = readFileSync(
      COPILOT_HOOKS_MANIFEST_PATH,
      'utf8',
    );

    for (const [name, config] of Object.entries(SCRIPT_CONFIG) as Array<
      [ScriptName, (typeof SCRIPT_CONFIG)[ScriptName]]
    >) {
      const group = claudeManifest.hooks.SessionStart.find(
        (entry) => entry.matcher === config.matcher,
      );
      expect(group).toBeDefined();
      expect(group?.hooks).toHaveLength(1);
      expect(group?.hooks[0].command).toContain(config.filename);
      expect(group?.hooks[0].bash).toContain(config.filename);
      expect(group?.hooks[0].powershell).toContain(config.filename);

      const source = readFileSync(
        join(REPO_ROOT, 'scripts', config.filename),
        'utf8',
      );
      expect(source, name).toContain('loadHookRuntime');
      expect(source, name).toContain('runtime.runHookPayload(');
      expect(source, name).toContain('runtime.buildLegacyProcessorInput(');
      expect(source, name).toContain('runtime.encodeHookOutput(');
      expect(source, name).toContain(`trigger: '${config.matcher}'`);
      expect(copilotManifestSource, name).not.toContain(config.filename);
    }
  });
});
