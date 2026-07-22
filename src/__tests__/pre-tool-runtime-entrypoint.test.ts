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
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  acquireFileLockSync,
  releaseFileLockSync,
} from '../lib/file-lock.js';

const REPO_ROOT = process.cwd();
const SCRIPT_PATH = join(REPO_ROOT, 'scripts', 'pre-tool-enforcer.mjs');
const LOADER_PATH = join(
  REPO_ROOT,
  'scripts',
  'lib',
  'hook-runtime-loader.mjs',
);
const STDIN_PATH = join(REPO_ROOT, 'scripts', 'lib', 'stdin.mjs');
const NOTIFICATION_CHILD_PATH = join(
  REPO_ROOT,
  'scripts',
  'lib',
  'notification-child.cjs',
);
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

type HookPayload = Record<string, unknown>;
type RuntimeMode = 'valid' | 'missing' | 'corrupt';

interface StagedPlugin {
  root: string;
  scriptPath: string;
}

interface RunOptions {
  env?: Record<string, string>;
  preloadPath?: string;
}

const tempRoots: string[] = [];
let runtimeFixtureRoot: string;
let runtimeFixturePath: string;

function loadFixture(
  host: 'claude' | 'copilot-1.0.72-1',
): HookPayload {
  const filename = host === 'claude'
    ? 'PreToolUse.json'
    : 'preToolUse.json';
  return JSON.parse(
    readFileSync(join(FIXTURE_ROOT, host, filename), 'utf8'),
  ) as HookPayload;
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2), 'utf8');
}

function makeWorktree(label: string): string {
  const path = mkdtempSync(join(tmpdir(), `omc-pretool-${label}-`));
  tempRoots.push(path);
  return path;
}

function claudePayload(
  cwd: string,
  toolName: string,
  toolInput: Record<string, unknown>,
  overrides: HookPayload = {},
): HookPayload {
  return {
    ...loadFixture('claude'),
    session_id: 'pretool-claude-session',
    cwd,
    tool_name: toolName,
    tool_input: toolInput,
    tool_use_id: 'pretool-claude-call',
    ...overrides,
  };
}

function copilotPayload(
  cwd: string,
  calls: Array<{
    id?: string;
    name: string;
    args: Record<string, unknown> | string;
  }>,
  overrides: HookPayload = {},
): HookPayload {
  return {
    ...loadFixture('copilot-1.0.72-1'),
    sessionId: 'pretool-copilot-session',
    cwd,
    toolCalls: calls.map((call) => ({
      ...(call.id !== undefined ? { id: call.id } : {}),
      name: call.name,
      args: typeof call.args === 'string'
        ? call.args
        : JSON.stringify(call.args),
    })),
    ...overrides,
  };
}

function exactClaudeDeny(reason: string): HookPayload {
  return {
    continue: true,
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
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

beforeAll(() => {
  runtimeFixtureRoot = mkdtempSync(
    join(tmpdir(), 'omc-pretool-runtime-bundle-'),
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
    rmSync(tempRoots.pop()!, { recursive: true, force: true });
  }
});

function stagePlugin(options: {
  runtime?: RuntimeMode;
  runtimeSource?: string;
} = {}): StagedPlugin {
  const root = mkdtempSync(join(tmpdir(), 'omc-pretool-entrypoint-'));
  tempRoots.push(root);
  const scriptPath = join(root, 'scripts', 'pre-tool-enforcer.mjs');
  const loaderPath = join(
    root,
    'scripts',
    'lib',
    'hook-runtime-loader.mjs',
  );
  const stdinPath = join(root, 'scripts', 'lib', 'stdin.mjs');
  const notificationChildPath = join(
    root,
    'scripts',
    'lib',
    'notification-child.cjs',
  );
  const runtimePath = join(root, 'bridge', 'hook-runtime.cjs');

  mkdirSync(dirname(loaderPath), { recursive: true });
  copyFileSync(SCRIPT_PATH, scriptPath);
  copyFileSync(LOADER_PATH, loaderPath);
  copyFileSync(STDIN_PATH, stdinPath);
  copyFileSync(NOTIFICATION_CHILD_PATH, notificationChildPath);
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ type: 'module' }),
    'utf8',
  );

  if (options.runtimeSource !== undefined) {
    mkdirSync(dirname(runtimePath), { recursive: true });
    writeFileSync(runtimePath, options.runtimeSource, 'utf8');
  } else if ((options.runtime ?? 'valid') !== 'missing') {
    mkdirSync(dirname(runtimePath), { recursive: true });
    if ((options.runtime ?? 'valid') === 'valid') {
      copyFileSync(runtimeFixturePath, runtimePath);
    } else {
      writeFileSync(runtimePath, 'module.exports = {\n', 'utf8');
    }
  }

  return { root, scriptPath };
}

function runHook(
  staged: StagedPlugin,
  input: HookPayload | string,
  cwd: string,
  options: RunOptions = {},
): SpawnSyncReturns<string> {
  const home = join(cwd, '.home');
  mkdirSync(home, { recursive: true });
  const args = [
    ...(options.preloadPath
      ? ['--require', options.preloadPath]
      : []),
    staged.scriptPath,
  ];
  return spawnSync(process.execPath, args, {
    cwd,
    input: typeof input === 'string' ? input : JSON.stringify(input),
    env: {
      ...process.env,
      ALLOW_RAW_READ: '',
      ALLOW_ULTRAGOAL_WITHOUT_GOAL: '',
      ANTHROPIC_BASE_URL: '',
      ANTHROPIC_DEFAULT_FABLE_MODEL: '',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: '',
      ANTHROPIC_DEFAULT_OPUS_MODEL: '',
      ANTHROPIC_DEFAULT_SONNET_MODEL: '',
      ANTHROPIC_MODEL: '',
      APPDATA: join(home, 'AppData', 'Roaming'),
      CLAUDE_CODE_BEDROCK_FABLE_MODEL: '',
      CLAUDE_CODE_BEDROCK_HAIKU_MODEL: '',
      CLAUDE_CODE_BEDROCK_OPUS_MODEL: '',
      CLAUDE_CODE_BEDROCK_SONNET_MODEL: '',
      CLAUDE_CODE_USE_BEDROCK: '',
      CLAUDE_CODE_USE_VERTEX: '',
      CLAUDE_CONFIG_DIR: join(home, '.claude'),
      CLAUDE_MODEL: '',
      CLAUDE_PLUGIN_ROOT: staged.root,
      COPILOT_AGENT_SESSION_ID: '',
      COPILOT_CLI: '',
      DISABLE_OMC: '',
      HOME: home,
      NODE_ENV: 'test',
      OMC_AGENT_PREFLIGHT_CONTEXT_THRESHOLD: '',
      OMC_COPILOT_DEFAULT_MODEL: '',
      OMC_COPILOT_REASONING_EFFORT: '',
      OMC_EXTERNAL_MODELS_DEFAULT_COPILOT_MODEL: '',
      OMC_HOST: '',
      OMC_NOTIFY: '0',
      OMC_PRE_TOOL_ADVISORY_COOLDOWN_MS: '0',
      OMC_PRE_TOOL_ADVISORY_NOW_MS: '',
      OMC_QUIET: '0',
      OMC_ROUTING_FORCE_INHERIT: '',
      OMC_SKIP_HOOKS: '',
      OMC_STATE_DIR: '',
      OMC_SUBAGENT_MODEL: '',
      USERPROFILE: home,
      XDG_CONFIG_HOME: join(home, '.config'),
      ...options.env,
    },
    encoding: 'utf8',
    timeout: 15_000,
    windowsHide: true,
  });
}

function runtimeProxySource(overrides: string): string {
  return `
    const base = require(${JSON.stringify(runtimeFixturePath)});
    ${overrides}
  `;
}

describe('shipped PreToolUse canonical runtime entrypoint', () => {
  it('preserves the exact Claude skip output', () => {
    const staged = stagePlugin();
    const cwd = makeWorktree('claude-skip');
    expectExactOutput(
      runHook(
        staged,
        claudePayload(cwd, 'Read', { file_path: 'README.md' }),
        cwd,
        { env: { DISABLE_OMC: '1' } },
      ),
      { continue: true },
    );
  });

  it('preserves the exact Claude suppressed output', () => {
    const staged = stagePlugin();
    const cwd = makeWorktree('claude-suppressed');
    expectExactOutput(
      runHook(
        staged,
        claudePayload(cwd, 'Read', { file_path: 'README.md' }),
        cwd,
        { env: { OMC_QUIET: '2' } },
      ),
      { continue: true, suppressOutput: true },
    );
  });

  it('preserves the exact Claude suppressed mutation output', () => {
    const staged = stagePlugin();
    const cwd = makeWorktree('claude-suppressed-mutation');
    writeJson(join(cwd, '.claude', 'omc.jsonc'), {
      agents: {
        executor: { model: 'claude-sonnet-4-6' },
      },
    });

    expectExactOutput(
      runHook(
        staged,
        claudePayload(cwd, 'Task', { subagent_type: 'executor' }),
        cwd,
        { env: { OMC_QUIET: '2' } },
      ),
      {
        continue: true,
        suppressOutput: true,
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          updatedInput: {
            subagent_type: 'executor',
            model: 'sonnet',
          },
        },
      },
    );
  });

  it('preserves the exact Claude hook denial output', () => {
    const staged = stagePlugin();
    const cwd = makeWorktree('claude-deny');
    writeJson(join(cwd, '.omc', 'config.json'), {
      routing: {
        forceDelegation: {
          enforce: true,
          rules: [{
            pattern: 'Read',
            threshold: { count: 1, windowSeconds: 120 },
          }],
        },
      },
    });

    expectExactOutput(
      runHook(
        staged,
        claudePayload(cwd, 'Read', { file_path: 'README.md' }),
        cwd,
        { env: { OMC_QUIET: '2' } },
      ),
      exactClaudeDeny(
        '[OMC] Force-agent-delegation: 1 Read in last 120s '
        + '(threshold 1). Delegate to an Agent instead. '
        + 'Bypass: ALLOW_RAW_READ=1.',
      ),
    );
  });

  it('preserves the exact Claude raw-block output', () => {
    const staged = stagePlugin();
    const cwd = makeWorktree('claude-raw-block');
    const transcriptPath = join(cwd, 'pretool-claude-session.jsonl');
    writeFileSync(
      transcriptPath,
      `${JSON.stringify({
        usage: { context_window: 1000, input_tokens: 800 },
      })}\n`,
      'utf8',
    );

    expectExactOutput(
      runHook(
        staged,
        claudePayload(
          cwd,
          'Task',
          { subagent_type: 'executor' },
          { transcript_path: transcriptPath },
        ),
        cwd,
        { env: { OMC_QUIET: '2' } },
      ),
      {
        decision: 'block',
        reason:
          '[OMC] Preflight context guard: 80% used (threshold: 72%). '
          + 'Avoid spawning additional agent-heavy tasks until context is reduced. '
          + 'Safe recovery: (1) pause new Task fan-out, (2) run /compact now, '
          + '(3) if compact fails, open a fresh session and continue from '
          + '.omc/state + .omc/notepad.md.',
      },
    );
  });

  it('preserves the exact Claude context output', () => {
    const staged = stagePlugin();
    const cwd = makeWorktree('claude-context');
    expectExactOutput(
      runHook(
        staged,
        claudePayload(cwd, 'Read', { file_path: 'README.md' }),
        cwd,
      ),
      {
        continue: true,
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          additionalContext:
            'Read multiple files in parallel when possible for faster analysis.',
        },
      },
    );
  });

  it('preserves the exact Claude context and mutation output', () => {
    const staged = stagePlugin();
    const cwd = makeWorktree('claude-context-mutation');
    writeJson(join(cwd, '.claude', 'omc.jsonc'), {
      agents: {
        executor: { model: 'claude-sonnet-4-6' },
      },
    });

    expectExactOutput(
      runHook(
        staged,
        claudePayload(cwd, 'Task', {
          subagent_type: 'executor',
          description: 'Implement the focused fix',
        }),
        cwd,
      ),
      {
        continue: true,
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          additionalContext:
            'Spawning agent: executor (sonnet) | '
            + 'Task: Implement the focused fix',
          updatedInput: {
            subagent_type: 'executor',
            description: 'Implement the focused fix',
            model: 'sonnet',
          },
        },
      },
    );
  });

  it.each([1, 2, 20])(
    'uses the canonical Copilot encoder for a batch of %i calls',
    (count) => {
      const staged = stagePlugin();
      const cwd = makeWorktree(`copilot-batch-${count}`);
      const calls = Array.from({ length: count }, (_, index) => ({
        id: `read-${index}`,
        name: 'read',
        args: { path: `src/file-${index}.ts` },
      }));

      expectExactOutput(
        runHook(staged, copilotPayload(cwd, calls), cwd),
        {
          additionalContext:
            'Read multiple files in parallel when possible for faster analysis.',
        },
      );
    },
  );

  it('accepts the native singleton toolName/toolArgs payload', () => {
    const staged = stagePlugin();
    const cwd = makeWorktree('copilot-native-singleton');

    expectExactOutput(
      runHook(
        staged,
        {
          sessionId: 'pretool-copilot-native-singleton',
          timestamp: 1_700_000_000_000,
          cwd,
          toolName: 'view',
          toolArgs: { path: 'README.md' },
        },
        cwd,
      ),
      {
        additionalContext:
          'Read multiple files in parallel when possible for faster analysis.',
      },
    );
  });

  it('denies malformed Copilot calls without inventing correlation', () => {
    const staged = stagePlugin();
    const cwd = makeWorktree('copilot-malformed');

    expectExactOutput(
      runHook(
        staged,
        copilotPayload(cwd, [{
          name: 'read',
          args: { path: 'README.md' },
        }]),
        cwd,
      ),
      {
        permissionDecision: 'deny',
        permissionDecisionReason:
          'Tool call at index 0 is missing a correlation ID.',
      },
    );
  });

  it('denies conflicting Copilot call IDs for the whole batch', () => {
    const staged = stagePlugin();
    const cwd = makeWorktree('copilot-conflicting');

    expectExactOutput(
      runHook(
        staged,
        copilotPayload(cwd, [
          {
            id: 'duplicate-call',
            name: 'read',
            args: { path: 'a.ts' },
          },
          {
            id: 'duplicate-call',
            name: 'read',
            args: { path: 'b.ts' },
          },
        ]),
        cwd,
      ),
      {
        permissionDecision: 'deny',
        permissionDecisionReason:
          'Tool call ID "duplicate-call" has conflicting names or arguments.',
      },
    );
  });

  it('fails closed on malformed JSON through canonical normalization', () => {
    const staged = stagePlugin();
    const cwd = makeWorktree('malformed-json');

    expectExactOutput(
      runHook(staged, '{"unterminated"', cwd),
      exactClaudeDeny('Hook input must be a JSON object.'),
    );
  });

  it('denies from an owned legacy ultragoal ghost state', () => {
    const staged = stagePlugin();
    const cwd = makeWorktree('ghost-state');
    const sessionId = 'owned-ghost-session';
    writeJson(join(cwd, '.omc', 'state', 'ultragoal-state.json'), {
      active: true,
      session_id: sessionId,
      project_path: cwd,
      objective: 'Ship parity',
      last_checked_at: new Date().toISOString(),
    });

    expectExactOutput(
      runHook(
        staged,
        claudePayload(
          cwd,
          'Read',
          { file_path: 'README.md' },
          { session_id: sessionId },
        ),
        cwd,
      ),
      exactClaudeDeny(
        '[ULTRAGOAL /GOAL REQUIRED] Active ultragoal state requires the '
        + 'matching Claude /goal before tools run; no active Claude /goal '
        + 'snapshot was visible to the hook. Activate /goal with the '
        + 'ultragoal objective, or set ALLOW_ULTRAGOAL_WITHOUT_GOAL=1 to '
        + 'bypass this guard intentionally. Expected objective: Ship parity',
      ),
    );
  });

  it('encodes a representable Copilot singleton mutation', () => {
    const staged = stagePlugin();
    const cwd = makeWorktree('copilot-singleton-mutation');

    expectExactOutput(
      runHook(
        staged,
        copilotPayload(cwd, [{
          id: 'agent-single',
          name: 'agent',
          args: { agent_type: 'oh-my-claudecode:executor' },
        }]),
        cwd,
        { env: { OMC_QUIET: '2' } },
      ),
      {
        modifiedArgs: {
          agent_type: 'oh-my-claudecode:executor',
          model: 'gpt-5.6-sol',
          reasoning_effort: 'max',
        },
      },
    );
  });

  it('denies unrepresentable Copilot batch mutations with exact patches', () => {
    const staged = stagePlugin();
    const cwd = makeWorktree('copilot-batch-mutation');
    const result = runHook(
      staged,
      copilotPayload(cwd, [
        {
          id: 'agent-a',
          name: 'agent',
          args: { agent_type: 'oh-my-claudecode:executor' },
        },
        {
          id: 'agent-b',
          name: 'agent',
          args: { agent_type: 'oh-my-claudecode:verifier' },
        },
      ]),
      cwd,
      { env: { OMC_QUIET: '2' } },
    );

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    const output = JSON.parse(result.stdout) as HookPayload;
    expect(output.permissionDecision).toBe('deny');
    expect(output).not.toHaveProperty('modifiedArgs');
    for (const patch of [
      'call agent-a: model=gpt-5.6-sol, reasoning_effort=max',
      'call agent-b: model=gpt-5.6-sol, reasoning_effort=max',
    ]) {
      expect(output.permissionDecisionReason).toContain(
        `retry with this exact per-call patch: ${patch}.`,
      );
      expect(output.additionalContext).toContain(patch);
    }
  });

  it('fails critically when the canonical processor throws', () => {
    const staged = stagePlugin({
      runtimeSource: runtimeProxySource(`
        module.exports = {
          ...base,
          reserveAndPlanPreToolBatch() {
            throw new Error('processor exploded');
          },
        };
      `),
    });
    const cwd = makeWorktree('processor-failure');
    const result = runHook(
      staged,
      claudePayload(cwd, 'Read', { file_path: 'README.md' }),
      cwd,
    );

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('[pre-tool-enforcer]');
    expect(result.stderr).toContain('processor exploded');
    expect(result.stderr).toContain('refusing to continue silently');
  });

  it('fails critically when a critical staged effect cannot commit', () => {
    const staged = stagePlugin({
      runtimeSource: runtimeProxySource(`
        function markFirstEffectCritical(plan) {
          let marked = false;
          const calls = plan.calls.map((callPlan) => {
            const effects = (callPlan.evaluation.effects || []).map((effect) => {
              if (marked) return effect;
              marked = true;
              return { ...effect, critical: true };
            });
            return {
              ...callPlan,
              evaluation: { ...callPlan.evaluation, effects },
            };
          });
          return {
            ...plan,
            calls,
            evaluations: calls.map((callPlan) => callPlan.evaluation),
          };
        }

        module.exports = {
          ...base,
          reserveAndPlanPreToolBatch(envelope, snapshot) {
            const result = base.reserveAndPlanPreToolBatch(
              envelope,
              snapshot,
            );
            return result.status === 'planned'
              ? { ...result, plan: markFirstEffectCritical(result.plan) }
              : result;
          },
          async commitPreToolEffects(stagedEffects, reduction) {
            const effect = stagedEffects.find(
              (candidate) => candidate.critical === true,
            );
            const disposition =
              reduction.decision === 'pass'
              || reduction.decision === 'allow'
                ? 'accepted'
                : 'rejected';
            return {
              disposition,
              results: effect
                ? [{
                    type: effect.type,
                    intentId: effect.payload.intentId,
                    callId: effect.callId,
                    originalIndex: effect.payload.originalIndex,
                    commitOn: effect.commitOn,
                    status: 'failed',
                    disposition,
                    detail: 'critical commit exploded',
                  }]
                : [],
              advisoryClaims: {},
            };
          },
        };
      `),
    });
    const cwd = makeWorktree('critical-commit');
    const result = runHook(
      staged,
      claudePayload(cwd, 'Read', { file_path: 'README.md' }),
      cwd,
    );

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('[pre-tool-enforcer]');
    expect(result.stderr).toContain('critical commit exploded');
    expect(result.stderr).toContain('refusing to continue silently');
  });

  it('fails closed on mode confirmation lock failure and succeeds on retry', () => {
    const staged = stagePlugin();
    const cwd = makeWorktree('mode-confirm-retry');
    execFileSync('git', ['init'], { cwd, stdio: 'pipe' });
    const sessionId = 'pretool-claude-session';
    const statePath = join(
      cwd,
      '.omc',
      'state',
      'sessions',
      sessionId,
      'ralph-state.json',
    );
    writeJson(statePath, {
      active: true,
      awaiting_confirmation: true,
      awaiting_confirmation_set_at: '2026-07-20T20:00:00.000Z',
      session_id: sessionId,
      generation: 1,
    });
    const held = acquireFileLockSync(
      `${statePath}.mutation.lock`,
    );
    expect(held).not.toBeNull();
    let failed: SpawnSyncReturns<string> | undefined;
    try {
      failed = runHook(
        staged,
        claudePayload(cwd, 'Skill', {
          skill: 'oh-my-claudecode:ralph',
        }),
        cwd,
      );
    } finally {
      releaseFileLockSync(held!);
    }

    expect(failed).toBeDefined();
    expect(failed!.error).toBeUndefined();
    expect(failed!.status).toBe(2);
    expect(failed!.stdout).toBe('');
    expect(failed!.stderr).toContain('pretool.mode-confirm.v1');
    expect(failed!.stderr).toContain(
      'mode confirmation could not be verified',
    );

    const retried = runHook(
      staged,
      claudePayload(cwd, 'Skill', {
        skill: 'oh-my-claudecode:ralph',
      }),
      cwd,
    );
    expect(retried.error).toBeUndefined();
    expect(retried.status).toBe(0);
    const state = JSON.parse(
      readFileSync(statePath, 'utf8'),
    ) as Record<string, unknown>;
    expect(state.awaiting_confirmation).toBeUndefined();
    expect(state.awaiting_confirmation_set_at).toBeUndefined();
  });

  it('delivers AskUser exactly once after durable queued finalization', async () => {
    const staged = stagePlugin({
      runtimeSource: runtimeProxySource(`
        const { appendFileSync } = require('node:fs');
        module.exports = {
          ...base,
          async runHookNotificationChild(event, data) {
            appendFileSync(
              process.env.OMC_TEST_NOTIFICATION_DELIVERY_PATH,
              event + ':' + data.sessionId + '\\n',
              'utf8',
            );
          },
        };
      `),
    });
    const cwd = makeWorktree('ask-user-notification-child');
    execFileSync('git', ['init'], { cwd, stdio: 'pipe' });
    const sessionId = 'pretool-claude-session';
    const markerPath = join(cwd, 'notification-deliveries.log');
    const payload = claudePayload(
      cwd,
      'AskUserQuestion',
      { questions: [{ question: 'Continue?' }] },
    );
    const options = {
      env: {
        OMC_NOTIFY: '1',
        OMC_TEST_NOTIFICATION_DELIVERY_PATH: markerPath,
      },
    };
    const result = runHook(
      staged,
      payload,
      cwd,
      options,
    );

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    await vi.waitFor(() => {
      expect(existsSync(markerPath)).toBe(true);
      expect(readFileSync(markerPath, 'utf8')).toBe(
        `ask-user-question:${sessionId}\n`,
      );
    }, { timeout: 3_000, interval: 25 });

    const duplicate = runHook(staged, payload, cwd, options);
    expect(duplicate.error).toBeUndefined();
    expect(duplicate.status).toBe(0);
    expect(duplicate.stderr).toBe('');
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(readFileSync(markerPath, 'utf8')).toBe(
      `ask-user-question:${sessionId}\n`,
    );
    const receiptPath = join(
      cwd,
      '.omc',
      'state',
      'sessions',
      sessionId,
      'notification-delivery-receipts.json',
    );
    const receipt = JSON.parse(
      readFileSync(receiptPath, 'utf8'),
    ) as {
      version: number;
      receipts: Record<string, Record<string, unknown>>;
    };
    expect(receipt.version).toBe(2);
    expect(Object.values(receipt.receipts)).toEqual([
      expect.objectContaining({
        session_id: sessionId,
        event: 'ask-user-question',
        delivery_status: 'queued',
      }),
    ]);
  });

  it('keeps an AskUser receipt retryable after an asynchronous spawn ENOENT', () => {
    const staged = stagePlugin();
    const cwd = makeWorktree('ask-user-notification-spawn-error');
    execFileSync('git', ['init'], { cwd, stdio: 'pipe' });
    const sessionId = 'pretool-claude-session';
    const missingExecutable = join(cwd, 'missing-node.exe');
    const preloadPath = join(cwd, 'missing-node-preload.cjs');
    writeFileSync(
      preloadPath,
      [
        "Object.defineProperty(process, 'execPath', {",
        '  configurable: true,',
        `  value: ${JSON.stringify(missingExecutable)},`,
        '  writable: true,',
        '});',
        '',
      ].join('\n'),
      'utf8',
    );

    const result = runHook(
      staged,
      claudePayload(
        cwd,
        'AskUserQuestion',
        { questions: [{ question: 'Continue?' }] },
      ),
      cwd,
      {
        env: { OMC_NOTIFY: '1' },
        preloadPath,
      },
    );

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    const receiptPath = join(
      cwd,
      '.omc',
      'state',
      'sessions',
      sessionId,
      'notification-delivery-receipts.json',
    );
    const receipt = JSON.parse(
      readFileSync(receiptPath, 'utf8'),
    ) as {
      receipts: Record<string, Record<string, unknown>>;
    };
    expect(Object.values(receipt.receipts)).toEqual([
      expect.objectContaining({
        session_id: sessionId,
        event: 'ask-user-question',
        delivery_status: 'retryable',
      }),
    ]);
  });

  it('fails critically on an abnormal final encoding failure', () => {
    const staged = stagePlugin({
      runtimeSource: runtimeProxySource(`
        module.exports = {
          ...base,
          encodePreToolEnforcerOutput() {
            throw new Error('encoder exploded');
          },
        };
      `),
    });
    const cwd = makeWorktree('encoder-failure');
    const result = runHook(
      staged,
      claudePayload(cwd, 'Read', { file_path: 'README.md' }),
      cwd,
    );

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('[pre-tool-enforcer]');
    expect(result.stderr).toContain('encoder exploded');
    expect(result.stderr).toContain('refusing to continue silently');
  });

  it.each(['missing', 'corrupt'] as const)(
    'fails critically when the canonical runtime bundle is %s',
    (runtime) => {
      const staged = stagePlugin({ runtime });
      const cwd = makeWorktree(`runtime-${runtime}`);
      const result = runHook(
        staged,
        claudePayload(cwd, 'Read', { file_path: 'README.md' }),
        cwd,
      );

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(2);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain('[pre-tool-enforcer]');
      expect(result.stderr).toContain('refusing to continue silently');
    },
  );

  it('writes stdout exactly once for a successful invocation', () => {
    const staged = stagePlugin();
    const cwd = makeWorktree('one-write');
    const preloadPath = join(cwd, 'count-stdout-writes.cjs');
    const countPath = join(cwd, 'stdout-write-count.txt');
    writeFileSync(
      preloadPath,
      `
        const { writeFileSync } = require('node:fs');
        const originalWrite = process.stdout.write;
        let writes = 0;
        process.stdout.write = function (...args) {
          writes += 1;
          return originalWrite.apply(this, args);
        };
        process.on('exit', () => {
          writeFileSync(process.env.OMC_STDOUT_WRITE_COUNT, String(writes));
        });
      `,
      'utf8',
    );

    expectExactOutput(
      runHook(
        staged,
        claudePayload(cwd, 'Read', { file_path: 'README.md' }),
        cwd,
        {
          env: { OMC_STDOUT_WRITE_COUNT: countPath },
          preloadPath,
        },
      ),
      {
        continue: true,
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          additionalContext:
            'Read multiple files in parallel when possible for faster analysis.',
        },
      },
    );
    expect(readFileSync(countPath, 'utf8')).toBe('1');
  });

  it('keeps the shipped wrapper parser-free and side-effect-free', () => {
    const source = readFileSync(SCRIPT_PATH, 'utf8');

    expect(source).toMatch(
      /runtime\.runHookJson\(\s*['"]pre-tool-use['"]/,
    );
    expect(source).toContain('runtime.loadPreToolBatchSnapshot(envelope)');
    expect(source).toContain('runtime.reserveAndPlanPreToolBatch(');
    expect(source).toContain('runtime.commitPreToolEffects(');
    expect(source).toContain('runtime.finalizePreToolReduction(');
    expect(source).toContain('runtime.encodePreToolEnforcerOutput(');
    expect(source.match(/process\.stdout\.write/g)).toHaveLength(1);

    expect(source).not.toMatch(/\bJSON\.parse\s*\(/);
    expect(source).not.toMatch(/\bconsole\.(?:log|error|warn)\s*\(/);
    expect(source).not.toMatch(
      /from ['"](?:node:)?(?:fs|crypto|child_process|path|os)['"]/,
    );
    expect(source).not.toMatch(
      /\b(?:writeFileSync|renameSync|mkdirSync|appendFileSync|atomicWriteJsonSync)\b/,
    );
    expect(source).not.toMatch(
      /\b(?:notify|recordSkillInvoked|dispatchNotificationInBackground)\b/,
    );
    expect(source).not.toMatch(
      /extractJsonField|isCopilotHost|toolCalls|tool_name|toolName\s*=/,
    );
    expect(source).not.toMatch(
      /pre-tool-enforcer-preflight|force-agent-delegation-preflight|state-root|agent-model-config/,
    );
  });
});
