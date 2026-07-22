import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import {
  cloneStagedHookRuntime,
  stageHookRuntime,
  type StagedHookRuntime,
} from './helpers/staged-hook-runtime.js';

const FIXTURE_ROOT = join(process.cwd(), 'src', '__tests__', 'fixtures');
const HOOK_FIXTURE_ROOT = join(FIXTURE_ROOT, 'hooks');
const STOP_FIXTURE_ROOT = join(FIXTURE_ROOT, 'stop-entrypoints');
const COPILOT_TRANSCRIPT_FIXTURE = join(
  HOOK_FIXTURE_ROOT,
  'copilot-1.0.72-1',
  'agentStop-transcript.jsonl',
);
const SCRIPT_NAMES = [
  'context-guard-stop.mjs',
  'workflow-drift-guard.mjs',
  'persistent-mode.mjs',
  'code-simplifier.mjs',
] as const;

type Host = 'claude' | 'copilot';
type ScriptName = typeof SCRIPT_NAMES[number];
type JsonObject = Record<string, unknown>;

interface StopGoldens {
  claude: Record<string, JsonObject>;
  copilot: Record<string, JsonObject>;
}

interface HookRun {
  status: number | null;
  stdout: string;
  stderr: string;
  signal: NodeJS.Signals | null;
}

const goldens = JSON.parse(
  readFileSync(join(STOP_FIXTURE_ROOT, 'goldens.json'), 'utf8'),
) as StopGoldens;
const fixtures: Record<Host, JsonObject> = {
  claude: JSON.parse(
    readFileSync(join(HOOK_FIXTURE_ROOT, 'claude', 'Stop.json'), 'utf8'),
  ) as JsonObject,
  copilot: JSON.parse(
    readFileSync(
      join(HOOK_FIXTURE_ROOT, 'copilot-1.0.72-1', 'agentStop.json'),
      'utf8',
    ),
  ) as JsonObject,
};
const staged = stageHookRuntime(SCRIPT_NAMES);
const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

afterAll(() => {
  staged.cleanup();
});

function makeProject(prefix: string): string {
  const project = mkdtempSync(join(tmpdir(), prefix));
  tempRoots.push(project);
  return project;
}

function stopInput(
  host: Host,
  project: string,
  sessionId: string,
  overrides: JsonObject = {},
): JsonObject {
  const common = {
    ...fixtures[host],
    cwd: project,
    ...(host === 'claude'
      ? {
          session_id: sessionId,
          transcript_path: join(project, 'transcript.jsonl'),
        }
      : {
          sessionId,
          transcriptPath: join(project, 'transcript.jsonl'),
        }),
  };
  return { ...common, ...overrides };
}

function cleanEnvironment(project: string): NodeJS.ProcessEnv {
  const home = join(project, 'home');
  mkdirSync(home, { recursive: true });
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: 'test',
    HOME: home,
    USERPROFILE: home,
    CLAUDE_PLUGIN_ROOT: '',
  };
  delete env.DISABLE_OMC;
  delete env.OMC_SKIP_HOOKS;
  delete env.OMC_STATE_DIR;
  delete env.OMC_HOST;
  delete env.COPILOT_CLI;
  delete env.COPILOT_AGENT_SESSION_ID;
  return env;
}

function runHook(
  runtime: StagedHookRuntime,
  scriptName: ScriptName,
  input: JsonObject,
  project: string,
  envOverrides: NodeJS.ProcessEnv = {},
): HookRun {
  const result = spawnSync(
    process.execPath,
    [runtime.scriptPath(scriptName)],
    {
      cwd: project,
      input: JSON.stringify(input),
      encoding: 'utf8',
      env: { ...cleanEnvironment(project), ...envOverrides },
      timeout: 10_000,
      windowsHide: true,
    },
  );
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    signal: result.signal,
  };
}

function expectExactOutput(result: HookRun, expected: JsonObject): void {
  expect(result.signal).toBeNull();
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toBe(`${JSON.stringify(expected)}\n`);
}

function writeTranscript(
  project: string,
  contextWindow = 1000,
  inputTokens = 850,
): void {
  writeFileSync(
    join(project, 'transcript.jsonl'),
    `${JSON.stringify({
      usage: {
        context_window: contextWindow,
        input_tokens: inputTokens,
      },
      context_window: contextWindow,
      input_tokens: inputTokens,
    })}\n`,
  );
}

function writeActiveModes(project: string, sessionId: string): void {
  const sessionDir = join(project, '.omc', 'state', 'sessions', sessionId);
  const now = new Date().toISOString();
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(
    join(sessionDir, 'ralph-state.json'),
    JSON.stringify({
      active: true,
      iteration: 1,
      max_iterations: 50,
      prompt: 'Fixture task',
      session_id: sessionId,
      project_path: project,
      started_at: now,
      last_checked_at: now,
    }),
  );
  writeFileSync(
    join(sessionDir, 'ultrawork-state.json'),
    JSON.stringify({
      active: true,
      original_prompt: 'Lower-priority fixture task',
      reinforcement_count: 0,
      session_id: sessionId,
      project_path: project,
      started_at: now,
      last_checked_at: now,
    }),
  );
  writeFileSync(
    join(sessionDir, 'autopilot-state.json'),
    JSON.stringify({
      active: true,
      current_phase: 'execution',
      reinforcement_count: 0,
      session_id: sessionId,
      project_path: project,
      started_at: now,
      last_checked_at: now,
    }),
  );
}

function writeRunningSubagent(project: string, sessionId: string): void {
  const path = join(
    project,
    '.omc',
    'state',
    'sessions',
    sessionId,
    'subagent-tracking-state.json',
  );
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({
    agents: [{
      agent_id: 'fixture-agent',
      agent_type: 'executor',
      parent_mode: 'ralph',
      session_id: sessionId,
      started_at: new Date().toISOString(),
      status: 'running',
    }],
  }));
}

function installInjectedRuntime(
  runtime: StagedHookRuntime,
  fault: 'processor' | 'reduction',
): void {
  const realBundle = join(dirname(runtime.bundlePath), 'hook-runtime-real.cjs');
  copyFileSync(runtime.bundlePath, realBundle);
  const source = fault === 'processor'
    ? [
        "const runtime = require('./hook-runtime-real.cjs');",
        'module.exports = {',
        '  ...runtime,',
        '  buildLegacyProcessorInput() {',
        "    throw new Error('Injected processor failure.');",
        '  },',
        '};',
        '',
      ].join('\n')
    : [
        "const runtime = require('./hook-runtime-real.cjs');",
        "const reason = 'Injected reduction failure.';",
        'module.exports = {',
        '  ...runtime,',
        '  async runHookJson(...args) {',
        '    const result = await runtime.runHookJson(...args);',
        "    const denial = { source: 'adapter', decision: 'deny', reason };",
        '    return {',
        '      ...result,',
        '      evaluations: [...result.evaluations, denial],',
        '      reduction: {',
        '        ...result.reduction,',
        "        decision: 'deny',",
        '        reason,',
        '        callDecisions: [...result.reduction.callDecisions, denial],',
        '      },',
        '    };',
        '  },',
        '};',
        '',
      ].join('\n');
  writeFileSync(runtime.bundlePath, source);
}

function expectFailurePolicy(
  result: HookRun,
  scriptName: ScriptName,
  detail: string,
  host: Host = 'claude',
): void {
  expect(result.signal).toBeNull();
  expect(result.stderr).toContain(detail);
  if (scriptName === 'code-simplifier.mjs') {
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(
      host === 'copilot' ? '{}\n' : '{"continue":true}\n',
    );
  } else {
    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
  }
}

describe('canonical Stop shipped entrypoints', () => {
  it('emits exact Claude legacy pass output and Copilot pass output', () => {
    const cases: Array<{
      script: ScriptName;
      claudeGolden: string;
    }> = [
      {
        script: 'context-guard-stop.mjs',
        claudeGolden: 'contextGuardPass',
      },
      {
        script: 'workflow-drift-guard.mjs',
        claudeGolden: 'workflowDriftPass',
      },
      {
        script: 'persistent-mode.mjs',
        claudeGolden: 'persistentModePass',
      },
      {
        script: 'code-simplifier.mjs',
        claudeGolden: 'codeSimplifierDisabled',
      },
    ];

    for (const { script, claudeGolden } of cases) {
      for (const host of ['claude', 'copilot'] as const) {
        const project = makeProject(`omc-stop-pass-${host}-`);
        const input = stopInput(host, project, `${host}-${script}`);
        expectExactOutput(
          runHook(staged, script, input, project),
          host === 'claude'
            ? goldens.claude[claudeGolden]
            : goldens.copilot.pass,
        );
      }
    }
  });

  it('preserves exact workflow block output for Claude and Copilot', () => {
    for (const host of ['claude', 'copilot'] as const) {
      const project = makeProject(`omc-stop-workflow-${host}-`);
      const message = 'PostgreSQL or SQLite?';
      const input = stopInput(host, project, `${host}-workflow`, host === 'claude'
        ? { last_assistant_message: message }
        : { lastAssistantMessage: message });
      expectExactOutput(
        runHook(staged, 'workflow-drift-guard.mjs', input, project),
        host === 'claude'
          ? goldens.claude.workflowDriftBlock
          : goldens.copilot.workflowDriftBlock,
      );
    }
  });

  it('recovers the exact Copilot workflow block from the observed transcript shape', () => {
    const project = makeProject('omc-stop-workflow-transcript-copilot-');
    copyFileSync(
      COPILOT_TRANSCRIPT_FIXTURE,
      join(project, 'transcript.jsonl'),
    );

    expectExactOutput(
      runHook(
        staged,
        'workflow-drift-guard.mjs',
        stopInput('copilot', project, 'copilot-workflow-transcript'),
        project,
      ),
      goldens.copilot.workflowDriftBlock,
    );
  });

  it('routes persistent-mode skip and disable passes through host encoding', () => {
    const controls: NodeJS.ProcessEnv[] = [
      { DISABLE_OMC: '1' },
      { OMC_SKIP_HOOKS: 'persistent-mode' },
    ];

    for (const host of ['claude', 'copilot'] as const) {
      for (const control of controls) {
        const project = makeProject(`omc-stop-skip-${host}-`);
        const sessionId = `${host}-skip-${tempRoots.length}`;
        writeActiveModes(project, sessionId);
        expectExactOutput(
          runHook(
            staged,
            'persistent-mode.mjs',
            stopInput(host, project, sessionId),
            project,
            { ...control, OMC_HOST: host },
          ),
          host === 'claude'
            ? goldens.claude.persistentModePass
            : goldens.copilot.pass,
        );
      }
    }
  });

  it('keeps Ralph ahead of lower active modes with exact block output', () => {
    for (const host of ['claude', 'copilot'] as const) {
      const project = makeProject(`omc-stop-priority-${host}-`);
      const sessionId = `${host}-priority`;
      writeActiveModes(project, sessionId);
      expectExactOutput(
        runHook(
          staged,
          'persistent-mode.mjs',
          stopInput(host, project, sessionId),
          project,
        ),
        host === 'claude'
          ? goldens.claude.persistentRalphBlock
          : goldens.copilot.persistentRalphBlock,
      );
    }
  });

  it('bypasses context limits, user aborts, cancel stops, and generic reasons', () => {
    const variants: Array<{
      claude: JsonObject;
      copilot: JsonObject;
    }> = [
      {
        claude: { stop_reason: 'context_limit' },
        copilot: { stopReason: 'context_limit' },
      },
      {
        claude: { user_requested: true },
        copilot: { userRequested: true },
      },
      {
        claude: { stop_reason: 'cancel' },
        copilot: { stopReason: 'cancel' },
      },
      {
        claude: { stop_reason: undefined, reason: 'context_limit' },
        copilot: { stopReason: undefined, reason: 'context_limit' },
      },
    ];

    for (const host of ['claude', 'copilot'] as const) {
      for (const variant of variants) {
        for (const script of [
          'context-guard-stop.mjs',
          'persistent-mode.mjs',
        ] as const) {
          const project = makeProject(`omc-stop-bypass-${host}-`);
          const sessionId = `${host}-${script}-${tempRoots.length}`;
          writeTranscript(project);
          writeActiveModes(project, sessionId);
          expectExactOutput(
            runHook(
              staged,
              script,
              stopInput(host, project, sessionId, variant[host]),
              project,
            ),
            host === 'claude'
              ? script === 'context-guard-stop.mjs'
                ? goldens.claude.contextGuardPass
                : goldens.claude.persistentModePass
              : goldens.copilot.pass,
          );
        }
      }
    }
  });

  it('isolates persistent state by session', () => {
    for (const host of ['claude', 'copilot'] as const) {
      const project = makeProject(`omc-stop-isolation-${host}-`);
      writeActiveModes(project, `${host}-other-session`);
      expectExactOutput(
        runHook(
          staged,
          'persistent-mode.mjs',
          stopInput(host, project, `${host}-current-session`),
          project,
        ),
        host === 'claude'
          ? goldens.claude.persistentModePass
          : goldens.copilot.pass,
      );
    }
  });

  it('suppresses continuation while a delegated session subagent is running', () => {
    for (const host of ['claude', 'copilot'] as const) {
      const project = makeProject(`omc-stop-subagent-${host}-`);
      const sessionId = `${host}-subagent`;
      writeActiveModes(project, sessionId);
      writeRunningSubagent(project, sessionId);
      expectExactOutput(
        runHook(
          staged,
          'persistent-mode.mjs',
          stopInput(host, project, sessionId),
          project,
        ),
        host === 'claude'
          ? goldens.claude.persistentModePass
          : goldens.copilot.pass,
      );
    }
  });

  it('bypasses continuation for a fresh session cancel signal', () => {
    for (const host of ['claude', 'copilot'] as const) {
      const project = makeProject(`omc-stop-cancel-signal-${host}-`);
      const sessionId = `${host}-cancel-signal`;
      const sessionDir = join(project, '.omc', 'state', 'sessions', sessionId);
      writeActiveModes(project, sessionId);
      rmSync(join(sessionDir, 'autopilot-state.json'), { force: true });
      writeFileSync(
        join(sessionDir, 'cancel-signal-state.json'),
        JSON.stringify({
          active: true,
          requested_at: new Date().toISOString(),
          source: 'fixture',
        }),
      );

      expectExactOutput(
        runHook(
          staged,
          'persistent-mode.mjs',
          stopInput(host, project, sessionId),
          project,
        ),
        host === 'claude'
          ? goldens.claude.persistentModePass
          : goldens.copilot.pass,
      );
    }
  });

  it('fails closed for missing bundles while simplifier remains optional', () => {
    const runtime = cloneStagedHookRuntime(staged);
    try {
      rmSync(runtime.bundlePath, { force: true });
      for (const host of ['claude', 'copilot'] as const) {
        for (const script of SCRIPT_NAMES) {
          const project = makeProject(`omc-stop-missing-runtime-${host}-`);
          const result = runHook(
            runtime,
            script,
            stopInput(host, project, `missing-${host}-${script}`),
            project,
            { OMC_HOST: host },
          );
          expectFailurePolicy(result, script, 'bundle is missing', host);
        }
      }
    } finally {
      runtime.cleanup();
    }
  });

  it('fails closed for corrupt bundles while simplifier remains optional', () => {
    const runtime = cloneStagedHookRuntime(staged);
    try {
      writeFileSync(runtime.bundlePath, 'module.exports = {\n');
      for (const host of ['claude', 'copilot'] as const) {
        for (const script of SCRIPT_NAMES) {
          const project = makeProject(`omc-stop-corrupt-runtime-${host}-`);
          const result = runHook(
            runtime,
            script,
            stopInput(host, project, `corrupt-${host}-${script}`),
            project,
            { OMC_HOST: host },
          );
          expectFailurePolicy(result, script, 'bundle failed to load', host);
        }
      }
    } finally {
      runtime.cleanup();
    }
  });

  it('fails closed for processor failures while simplifier remains optional', () => {
    const runtime = cloneStagedHookRuntime(staged);
    try {
      installInjectedRuntime(runtime, 'processor');
      for (const host of ['claude', 'copilot'] as const) {
        for (const script of SCRIPT_NAMES) {
          const project = makeProject(`omc-stop-processor-failure-${host}-`);
          const result = runHook(
            runtime,
            script,
            stopInput(host, project, `processor-${host}-${script}`),
            project,
            { OMC_HOST: host },
          );
          expectFailurePolicy(
            result,
            script,
            'Injected processor failure',
            host,
          );
        }
      }
    } finally {
      runtime.cleanup();
    }
  });

  it('fails closed for adapter-denial reductions while simplifier remains optional', () => {
    const runtime = cloneStagedHookRuntime(staged);
    try {
      installInjectedRuntime(runtime, 'reduction');
      for (const host of ['claude', 'copilot'] as const) {
        for (const script of SCRIPT_NAMES) {
          const project = makeProject(`omc-stop-reduction-failure-${host}-`);
          const result = runHook(
            runtime,
            script,
            stopInput(host, project, `reduction-${host}-${script}`),
            project,
            { OMC_HOST: host },
          );
          expectFailurePolicy(
            result,
            script,
            'Injected reduction failure',
            host,
          );
        }
      }
    } finally {
      runtime.cleanup();
    }
  });
});
