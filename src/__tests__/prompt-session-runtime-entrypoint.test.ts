import { execFileSync, spawnSync, type SpawnSyncReturns } from 'node:child_process';
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
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
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

const SCRIPT_CONFIG = {
  'keyword-detector': {
    filename: 'keyword-detector.mjs',
    fixture: 'userPromptSubmitted',
  },
  'skill-injector': {
    filename: 'skill-injector.mjs',
    fixture: 'userPromptSubmitted',
  },
  'session-start': {
    filename: 'session-start.mjs',
    fixture: 'sessionStart',
  },
  'project-memory-session': {
    filename: 'project-memory-session.mjs',
    fixture: 'sessionStart',
  },
  'wiki-session-start': {
    filename: 'wiki-session-start.mjs',
    fixture: 'sessionStart',
  },
  'pre-compact': {
    filename: 'pre-compact.mjs',
    fixture: 'preCompact',
  },
  'project-memory-precompact': {
    filename: 'project-memory-precompact.mjs',
    fixture: 'preCompact',
  },
  'wiki-pre-compact': {
    filename: 'wiki-pre-compact.mjs',
    fixture: 'preCompact',
  },
  'session-end': {
    filename: 'session-end.mjs',
    fixture: 'sessionEnd',
  },
  'wiki-session-end': {
    filename: 'wiki-session-end.mjs',
    fixture: 'sessionEnd',
  },
} as const;

type ScriptName = keyof typeof SCRIPT_CONFIG;
type HookPayload = Record<string, unknown>;

interface StagedPlugin {
  root: string;
  runCjs: string;
  scripts: Record<ScriptName, string>;
}

const requireFromTest = createRequire(import.meta.url);
const tempRoots: string[] = [];
let runtimeFixtureRoot: string;
let runtimeFixturePath: string;

function loadFixture(
  host: 'claude' | 'copilot-1.0.72-1',
  name: string,
): HookPayload {
  return JSON.parse(
    readFileSync(join(FIXTURE_ROOT, host, `${name}.json`), 'utf8'),
  ) as HookPayload;
}

function writeModule(path: string, source: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, source, 'utf8');
}

function stageProcessorFixtures(root: string): void {
  writeModule(
    join(root, 'dist', 'hooks', 'project-memory', 'index.js'),
    `
      import { writeFileSync } from 'node:fs';
      export async function registerProjectMemoryContext(sessionId, directory) {
        const receipt = process.env.OMC_TEST_PROJECT_MEMORY_SESSION_RECEIPT;
        if (receipt) writeFileSync(receipt, JSON.stringify({ sessionId, directory }), 'utf8');
        return true;
      }
    `,
  );
  writeModule(
    join(root, 'dist', 'hooks', 'wiki', 'session-hooks.js'),
    `
      import { writeFileSync } from 'node:fs';
      function record(name, data) {
        const receipt = process.env[name];
        if (receipt) writeFileSync(receipt, JSON.stringify(data), 'utf8');
      }
      export function onSessionStart(data) {
        record('OMC_TEST_WIKI_SESSION_START_RECEIPT', data);
        return {
          additionalContext: [
            'wiki-start',
            data.source ?? '',
            data.prompt ?? '',
            data.session_id ?? '',
            data.transcript_path ?? '',
          ].join('|'),
        };
      }
      export function onPreCompact(data) {
        record('OMC_TEST_WIKI_PRECOMPACT_RECEIPT', data);
        return {
          additionalContext: [
            'wiki-compact',
            data.trigger ?? '',
            data.custom_instructions ?? '',
            data.transcript_path ?? '',
          ].join('|'),
        };
      }
    `,
  );
  writeModule(
    join(root, 'dist', 'hooks', 'pre-compact', 'index.js'),
    `
      import { writeFileSync } from 'node:fs';
      export async function processPreCompact(data) {
        const receipt = process.env.OMC_TEST_PRECOMPACT_RECEIPT;
        if (receipt) writeFileSync(receipt, JSON.stringify(data), 'utf8');
        return {
          continue: true,
          systemMessage: [
            'compact',
            data.trigger ?? '',
            data.custom_instructions ?? '',
            data.transcript_path ?? '',
          ].join('|'),
        };
      }
    `,
  );
  writeModule(
    join(root, 'dist', 'hooks', 'project-memory', 'pre-compact.js'),
    `
      import { writeFileSync } from 'node:fs';
      export async function processPreCompact(data) {
        const receipt = process.env.OMC_TEST_PROJECT_MEMORY_PRECOMPACT_RECEIPT;
        if (receipt) writeFileSync(receipt, JSON.stringify(data), 'utf8');
        return {
          continue: true,
          systemMessage: [
            'project-memory-compact',
            data.trigger ?? '',
            data.custom_instructions ?? '',
            data.transcript_path ?? '',
          ].join('|'),
        };
      }
    `,
  );
  writeModule(
    join(root, 'dist', 'hooks', 'session-end', 'index.js'),
    `
      import { writeFileSync } from 'node:fs';
      function record(name, data) {
        const receipt = process.env[name];
        if (receipt) writeFileSync(receipt, JSON.stringify(data), 'utf8');
      }
      export async function processSessionEnd(data) {
        record('OMC_TEST_SESSION_END_RECEIPT', data);
        return { continue: true };
      }
      export async function processWikiSessionEnd(data) {
        record('OMC_TEST_WIKI_SESSION_END_RECEIPT', data);
        return { continue: true };
      }
    `,
  );
}

function stagePlugin(runtime: 'valid' | 'missing' = 'valid'): StagedPlugin {
  const root = mkdtempSync(join(tmpdir(), 'omc-prompt-session-entrypoint-'));
  tempRoots.push(root);
  const scriptsDir = join(root, 'scripts');
  mkdirSync(scriptsDir, { recursive: true });
  cpSync(
    join(REPO_ROOT, 'scripts', 'lib'),
    join(scriptsDir, 'lib'),
    { recursive: true },
  );

  const scripts = {} as Record<ScriptName, string>;
  for (const [name, config] of Object.entries(SCRIPT_CONFIG) as Array<
    [ScriptName, (typeof SCRIPT_CONFIG)[ScriptName]]
  >) {
    const scriptPath = join(scriptsDir, config.filename);
    copyFileSync(join(REPO_ROOT, 'scripts', config.filename), scriptPath);
    scripts[name] = scriptPath;
  }
  const runCjs = join(scriptsDir, 'run.cjs');
  copyFileSync(join(REPO_ROOT, 'scripts', 'run.cjs'), runCjs);
  mkdirSync(join(root, 'hooks'), { recursive: true });
  copyFileSync(
    join(REPO_ROOT, 'hooks', 'hooks.json'),
    join(root, 'hooks', 'hooks.json'),
  );
  mkdirSync(join(root, '.claude-plugin'), { recursive: true });
  writeFileSync(join(root, '.claude-plugin', 'plugin.json'), '{}', 'utf8');

  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ type: 'module' }),
    'utf8',
  );
  if (runtime === 'valid') {
    const runtimePath = join(root, 'bridge', 'hook-runtime.cjs');
    mkdirSync(dirname(runtimePath), { recursive: true });
    copyFileSync(runtimeFixturePath, runtimePath);
  }
  stageProcessorFixtures(root);
  return { root, runCjs, scripts };
}

function makeWorktree(label: string): string {
  const root = mkdtempSync(join(tmpdir(), `omc-prompt-session-${label}-`));
  tempRoots.push(root);
  mkdirSync(join(root, '.git'));
  return root;
}

function runHook(
  staged: StagedPlugin,
  name: ScriptName,
  input: HookPayload | string,
  cwd: string,
  extraEnv: Record<string, string> = {},
): SpawnSyncReturns<string> {
  const home = join(cwd, '.home');
  const configDir = join(cwd, '.claude');
  mkdirSync(home, { recursive: true });
  mkdirSync(configDir, { recursive: true });
  const isSessionEnd =
    name === 'session-end' || name === 'wiki-session-end';

  const result = spawnSync(
    process.execPath,
    [staged.scripts[name]],
    {
    cwd,
    input: typeof input === 'string' ? input : JSON.stringify(input),
    encoding: 'utf8',
    timeout: 10_000,
    windowsHide: true,
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      CLAUDE_CONFIG_DIR: configDir,
      CLAUDE_PLUGIN_ROOT: isSessionEnd ? staged.root : '',
      COPILOT_CLI: '',
      COPILOT_AGENT_SESSION_ID: '',
      DISABLE_OMC: '',
      OMC_HOST: '',
      OMC_NOTIFY: '0',
      OMC_SKIP_HOOKS: '',
      OMC_STATE_DIR: '',
      ...extraEnv,
    },
    },
  );
  return result;
}

async function readJsonEventually(path: string): Promise<HookPayload> {
  const deadline = Date.now() + 5_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      if (existsSync(path)) {
        return JSON.parse(readFileSync(path, 'utf8')) as HookPayload;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise<void>(resolve => setTimeout(resolve, 10));
  }
  throw lastError ?? new Error(`receipt was not written: ${path}`);
}

async function expectedSessionEndLegacyInput(
  input: HookPayload,
): Promise<HookPayload> {
  const runtime = requireFromTest(runtimeFixturePath) as {
    buildLegacyProcessorInput(
      envelope: unknown,
      unit: unknown,
    ): HookPayload;
    runHookPayload(
      hookType: string,
      payload: HookPayload,
      processor: (unit: unknown, envelope: unknown) => HookPayload,
    ): Promise<unknown>;
  };
  let received: HookPayload | undefined;
  await runtime.runHookPayload(
    'session-end',
    input,
    (unit, envelope) => {
      received = runtime.buildLegacyProcessorInput(envelope, unit);
      return { continue: true };
    },
  );
  if (!received) throw new Error('canonical runtime did not produce a SessionEnd input');
  return JSON.parse(JSON.stringify(received)) as HookPayload;
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

beforeAll(() => {
  runtimeFixtureRoot = mkdtempSync(
    join(tmpdir(), 'omc-prompt-session-runtime-'),
  );
  runtimeFixturePath = join(
    runtimeFixtureRoot,
    'bridge',
    'hook-runtime.cjs',
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
});

afterAll(() => {
  rmSync(runtimeFixtureRoot, { recursive: true, force: true });
});

afterEach(() => {
  while (tempRoots.length > 0) {
    rmSync(tempRoots.pop()!, {
      recursive: true,
      force: true,
      maxRetries: 40,
      retryDelay: 25,
    });
  }
});

describe('shipped prompt/session canonical runtime entrypoints', () => {
  it('keeps Copilot prompt aliases visible and persists keyword activation state', () => {
    const staged = stagePlugin();
    const cwd = makeWorktree('keyword');
    const skillPath = join(staged.root, 'skills', 'autopilot', 'SKILL.md');
    mkdirSync(dirname(skillPath), { recursive: true });
    writeFileSync(skillPath, '# Autopilot\n', 'utf8');
    const prompt = 'autopilot build me an app';
    const payload: HookPayload = {
      ...loadFixture('copilot-1.0.72-1', 'userPromptSubmitted'),
      sessionId: 'keyword-alias-session',
      cwd,
      transcriptPath: join(cwd, 'events.jsonl'),
      userPrompt: prompt,
    };
    delete payload.prompt;

    const expectedContext = `[MAGIC KEYWORD: AUTOPILOT]

Skill routing detected: autopilot
Preferred invocation: /oh-my-claudecode:autopilot
Read fallback: open ${skillPath} and follow its SKILL.md instructions.

User request (compact echo; original prompt remains authoritative):
${prompt}

IMPORTANT: Start the autopilot workflow immediately. If the slash invocation is unavailable, read the SKILL.md at the fallback path instead of relying on this compact guide.`;
    expectExactOutput(
      runHook(staged, 'keyword-detector', payload, cwd),
      { additionalContext: expectedContext },
    );

    const state = JSON.parse(readFileSync(
      join(
        cwd,
        '.omc',
        'state',
        'sessions',
        'keyword-alias-session',
        'autopilot-state.json',
      ),
      'utf8',
    )) as Record<string, unknown>;
    expect(state).toEqual({
      active: true,
      started_at: expect.any(String),
      original_prompt: prompt,
      session_id: 'keyword-alias-session',
      project_path: cwd,
      reinforcement_count: 0,
      awaiting_confirmation: true,
      awaiting_confirmation_set_at: expect.any(String),
      last_checked_at: expect.any(String),
    });
    expect(state.awaiting_confirmation_set_at).toBe(state.started_at);
    expect(state.last_checked_at).toBe(state.started_at);
  });

  it('keeps learned-skill activation visible and records exact session dedup state', () => {
    const staged = stagePlugin();
    const cwd = makeWorktree('skill');
    const skillPath = join(cwd, '.omc', 'skills', 'widget-memory.md');
    mkdirSync(dirname(skillPath), { recursive: true });
    writeFileSync(
      skillPath,
      [
        '---',
        'name: Widget Memory',
        'description: Reuse the widget workflow.',
        'triggers:',
        '  - remember widgets',
        '---',
        'Run the widget workflow.',
        '',
      ].join('\n'),
      'utf8',
    );
    const payload: HookPayload = {
      ...loadFixture('copilot-1.0.72-1', 'userPromptSubmitted'),
      sessionId: 'skill-alias-session',
      cwd,
      userPrompt: 'please remember widgets',
    };
    delete payload.prompt;

    const descriptor = [
      '### Widget Memory (project)',
      `<skill-metadata>${JSON.stringify({
        path: skillPath,
        triggers: ['remember widgets'],
        score: 10,
        scope: 'project',
      })}</skill-metadata>`,
      'Summary: Reuse the widget workflow.',
      `Load instructions: if this skill is needed, read ${skillPath} and follow the full instructions there.`,
    ].join('\n');
    const expectedContext = [
      '<mnemosyne>',
      '',
      '## Relevant Learned Skills',
      '',
      'Compact descriptors only; full learned skill bodies stay on disk to avoid prompt bloat.',
      descriptor,
      '</mnemosyne>',
    ].join('\n');
    expectExactOutput(
      runHook(staged, 'skill-injector', payload, cwd),
      { additionalContext: expectedContext },
    );

    const state = JSON.parse(readFileSync(
      join(
        cwd,
        '.omc',
        'state',
        'sessions',
        'skill-alias-session',
        'skill-sessions-fallback-state.json',
      ),
      'utf8',
    )) as {
      sessions: Record<string, {
        injectedPaths: string[];
        timestamp: number;
      }>;
    };
    expect(state).toEqual({
      sessions: {
        'skill-alias-session': {
          injectedPaths: [skillPath],
          timestamp: expect.any(Number),
        },
      },
    });
  });

  it('routes session and compact fixtures with exact host output and aliases', async () => {
    const staged = stagePlugin();
    const cwd = makeWorktree('lifecycle');
    const transcriptPath = join(cwd, 'events.jsonl');
    const receipts = Object.fromEntries([
      'PROJECT_MEMORY_SESSION',
      'WIKI_SESSION_START',
      'PRECOMPACT',
      'PROJECT_MEMORY_PRECOMPACT',
      'WIKI_PRECOMPACT',
      'SESSION_END',
      'WIKI_SESSION_END',
    ].map((name) => [name, join(cwd, `${name}.json`)]));
    const env = {
      OMC_TEST_PROJECT_MEMORY_SESSION_RECEIPT:
        receipts.PROJECT_MEMORY_SESSION,
      OMC_TEST_WIKI_SESSION_START_RECEIPT:
        receipts.WIKI_SESSION_START,
      OMC_TEST_PRECOMPACT_RECEIPT: receipts.PRECOMPACT,
      OMC_TEST_PROJECT_MEMORY_PRECOMPACT_RECEIPT:
        receipts.PROJECT_MEMORY_PRECOMPACT,
      OMC_TEST_WIKI_PRECOMPACT_RECEIPT: receipts.WIKI_PRECOMPACT,
      OMC_TEST_SESSION_END_RECEIPT: receipts.SESSION_END,
      OMC_TEST_WIKI_SESSION_END_RECEIPT: receipts.WIKI_SESSION_END,
    };

    const sessionStart = {
      ...loadFixture('copilot-1.0.72-1', 'sessionStart'),
      cwd,
      sessionId: 'lifecycle-session',
      transcriptPath,
    };
    expectExactOutput(
      runHook(staged, 'session-start', sessionStart, cwd, env),
      {},
    );
    expectExactOutput(
      runHook(staged, 'project-memory-session', sessionStart, cwd, env),
      {},
    );
    expectExactOutput(
      runHook(staged, 'wiki-session-start', sessionStart, cwd, env),
      {
        additionalContext:
          `wiki-start|new|<initial-prompt>|lifecycle-session|${transcriptPath}`,
      },
    );
    expect(JSON.parse(
      readFileSync(receipts.PROJECT_MEMORY_SESSION, 'utf8'),
    )).toEqual({
      sessionId: 'lifecycle-session',
      directory: cwd,
    });
    expect(JSON.parse(
      readFileSync(receipts.WIKI_SESSION_START, 'utf8'),
    )).toMatchObject({
      source: 'new',
      prompt: '<initial-prompt>',
      sessionId: 'lifecycle-session',
      session_id: 'lifecycle-session',
      transcriptPath,
      transcript_path: transcriptPath,
    });
    expect(JSON.parse(readFileSync(
      join(
        cwd,
        '.omc',
        'state',
        'sessions',
        'lifecycle-session',
        'session-started.json',
      ),
      'utf8',
    ))).toMatchObject({
      session_id: 'lifecycle-session',
      cwd,
      started_at: expect.any(String),
      pid: expect.any(Number),
    });

    const copilotCompact = {
      ...loadFixture('copilot-1.0.72-1', 'preCompact'),
      cwd,
      sessionId: 'lifecycle-session',
      transcriptPath,
    };
    expectExactOutput(
      runHook(staged, 'pre-compact', copilotCompact, cwd, env),
      {},
    );
    expectExactOutput(
      runHook(
        staged,
        'project-memory-precompact',
        copilotCompact,
        cwd,
        env,
      ),
      {},
    );
    expectExactOutput(
      runHook(staged, 'wiki-pre-compact', copilotCompact, cwd, env),
      {},
    );
    for (const receipt of [
      receipts.PRECOMPACT,
      receipts.PROJECT_MEMORY_PRECOMPACT,
      receipts.WIKI_PRECOMPACT,
    ]) {
      expect(JSON.parse(readFileSync(receipt, 'utf8'))).toMatchObject({
        trigger: 'auto',
        customInstructions: '<custom-instructions>',
        custom_instructions: '<custom-instructions>',
        transcriptPath,
        transcript_path: transcriptPath,
      });
    }

    const claudeCompact = {
      ...loadFixture('claude', 'PreCompact'),
      cwd,
      session_id: 'claude-compact-session',
      transcript_path: transcriptPath,
    };
    expectExactOutput(
      runHook(staged, 'pre-compact', claudeCompact, cwd, env),
      {
        continue: true,
        systemMessage:
          `compact|manual|<custom-instructions>|${transcriptPath}`,
      },
    );
    expectExactOutput(
      runHook(
        staged,
        'project-memory-precompact',
        claudeCompact,
        cwd,
        env,
      ),
      {
        continue: true,
        systemMessage:
          `project-memory-compact|manual|<custom-instructions>|${transcriptPath}`,
      },
    );
    expectExactOutput(
      runHook(staged, 'wiki-pre-compact', claudeCompact, cwd, env),
      {
        continue: true,
        systemMessage:
          `wiki-compact|manual|<custom-instructions>|${transcriptPath}`,
      },
    );

    const copilotEnd = {
      ...loadFixture('copilot-1.0.72-1', 'sessionEnd'),
      cwd,
      sessionId: 'lifecycle-session',
      transcriptPath,
    };
    expectExactOutput(
      runHook(staged, 'session-end', copilotEnd, cwd, env),
      {},
    );
    expectExactOutput(
      runHook(staged, 'wiki-session-end', copilotEnd, cwd, env),
      {},
    );
    const expectedCopilotEnd = await expectedSessionEndLegacyInput(copilotEnd);
    for (const receipt of [
      receipts.SESSION_END,
      receipts.WIKI_SESSION_END,
    ]) {
      expect(await readJsonEventually(receipt)).toEqual(expectedCopilotEnd);
    }

    const claudeEnd = {
      ...loadFixture('claude', 'SessionEnd'),
      cwd,
      session_id: 'claude-end-session',
      transcript_path: transcriptPath,
    };
    rmSync(receipts.SESSION_END, { force: true });
    rmSync(receipts.WIKI_SESSION_END, { force: true });
    expectExactOutput(
      runHook(staged, 'session-end', claudeEnd, cwd, env),
      { continue: true },
    );
    expectExactOutput(
      runHook(staged, 'wiki-session-end', claudeEnd, cwd, env),
      { continue: true },
    );
    const expectedClaudeEnd = await expectedSessionEndLegacyInput(claudeEnd);
    for (const receipt of [
      receipts.SESSION_END,
      receipts.WIKI_SESSION_END,
    ]) {
      expect(await readJsonEventually(receipt)).toEqual(expectedClaudeEnd);
    }
  }, 30_000);

  it.each(Object.entries(SCRIPT_CONFIG) as Array<
    [ScriptName, (typeof SCRIPT_CONFIG)[ScriptName]]
  >)(
    'fails open visibly when the optional %s runtime is missing',
    (name, config) => {
      const staged = stagePlugin('missing');
      const cwd = makeWorktree(`missing-${name}`);
      const input = loadFixture('copilot-1.0.72-1', config.fixture);
      input.cwd = cwd;
      input.sessionId = `missing-${name}`;

      const result = runHook(staged, name, input, cwd);

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      expect(result.signal).toBeNull();
      expect(result.stdout).toBe('{"continue":true}\n');
      expect(result.stderr).toContain(`[${name}]`);
      expect(result.stderr).toContain(
        'continuing without optional hook behavior',
      );
    },
    15_000,
  );
});
