import {
  execFileSync,
  spawn,
  spawnSync,
  type ChildProcessWithoutNullStreams,
  type SpawnSyncReturns,
} from 'node:child_process';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
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
const BUILD_RUNTIME_PATH = join(REPO_ROOT, 'scripts', 'build-hook-runtime.mjs');
const FIXTURE_ROOT = join(REPO_ROOT, 'src', '__tests__', 'fixtures', 'hooks');
const HOOKS_MANIFEST_PATH = join(REPO_ROOT, 'hooks', 'hooks.json');

const SCRIPT_CONFIG = {
  'post-tool-verifier': {
    filename: 'post-tool-verifier.mjs',
    hookType: 'post-tool-use',
    event: 'PostToolUse',
  },
  'project-memory-posttool': {
    filename: 'project-memory-posttool.mjs',
    hookType: 'post-tool-use',
    event: 'PostToolUse',
  },
  'post-tool-rules-injector': {
    filename: 'post-tool-rules-injector.mjs',
    hookType: 'post-tool-use',
    event: 'PostToolUse',
  },
  'post-tool-use-failure': {
    filename: 'post-tool-use-failure.mjs',
    hookType: 'post-tool-use-failure',
    event: 'PostToolUseFailure',
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
  event: 'post-tool-use' | 'post-tool-use-failure',
): HookPayload {
  const filename = host === 'claude'
    ? event === 'post-tool-use'
      ? 'PostToolUse.json'
      : 'PostToolUseFailure.json'
    : event === 'post-tool-use'
      ? 'postToolUse.json'
      : 'postToolUseFailure.json';
  return JSON.parse(
    readFileSync(join(FIXTURE_ROOT, host, filename), 'utf8'),
  ) as HookPayload;
}

function exactClaudePostToolContext(context: string): HookPayload {
  return {
    continue: true,
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: context,
    },
  };
}

function exactClaudePostToolFailureContext(context: string): HookPayload {
  return {
    continue: true,
    hookSpecificOutput: {
      hookEventName: 'PostToolUseFailure',
      additionalContext: context,
    },
  };
}

function expectExactOutput(
  result: SpawnSyncReturns<string>,
  output: HookPayload,
  pretty = false,
): void {
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  expect(result.signal).toBeNull();
  expect(result.stderr).toBe('');
  expect(result.stdout).toBe(
    `${JSON.stringify(output, null, pretty ? 2 : undefined)}\n`,
  );
}

describe('shipped post-tool canonical runtime entrypoints', () => {
  const tempRoots: string[] = [];
  let runtimeFixtureRoot: string;
  let runtimeFixturePath: string;
  let rulesProcessorFixturePath: string;

  beforeAll(async () => {
    runtimeFixtureRoot = mkdtempSync(join(tmpdir(), 'omc-post-tool-runtime-bundle-'));
    runtimeFixturePath = join(runtimeFixtureRoot, 'bridge', 'hook-runtime.cjs');
    rulesProcessorFixturePath = join(
      runtimeFixtureRoot,
      'processor',
      'rules-injector.js',
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
        join(REPO_ROOT, 'src', 'hooks', 'rules-injector', 'index.ts'),
      ],
      bundle: true,
      packages: 'bundle',
      preserveSymlinks: true,
      platform: 'node',
      target: 'node20',
      format: 'esm',
      outfile: rulesProcessorFixturePath,
    });
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
    productionRulesInjector?: boolean;
  } = {}): StagedPlugin {
    const root = mkdtempSync(join(tmpdir(), 'omc-post-tool-entrypoint-'));
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

    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ type: 'module' }),
      'utf8',
    );

    const runtimePath = join(root, 'bridge', 'hook-runtime.cjs');
    const runtimeMode = options.runtime ?? 'valid';
    if (options.runtimeSource !== undefined) {
      mkdirSync(dirname(runtimePath), { recursive: true });
      writeFileSync(runtimePath, options.runtimeSource, 'utf8');
    } else if (runtimeMode !== 'missing') {
      mkdirSync(dirname(runtimePath), { recursive: true });
      if (runtimeMode === 'valid') {
        copyFileSync(runtimeFixturePath, runtimePath);
      } else {
        writeFileSync(runtimePath, 'module.exports = {\n', 'utf8');
      }
    }

    const learnerPath = join(root, 'dist', 'hooks', 'project-memory', 'learner.js');
    mkdirSync(dirname(learnerPath), { recursive: true });
    writeFileSync(
      learnerPath,
      `
        import { writeFileSync } from 'node:fs';
        export async function learnFromToolOutput(
          toolName,
          toolInput,
          toolOutput,
          projectRoot
        ) {
          const receiptPath = process.env.OMC_TEST_PROJECT_MEMORY_RECEIPT;
          if (receiptPath) {
            writeFileSync(
              receiptPath,
              JSON.stringify({ toolName, toolInput, toolOutput, projectRoot }),
              'utf8'
            );
          }
        }
      `,
      'utf8',
    );

    const finderPath = join(root, 'dist', 'hooks', 'rules-injector', 'finder.js');
    mkdirSync(dirname(finderPath), { recursive: true });
    writeFileSync(
      finderPath,
      'export function findProjectRoot(directory) { return directory; }\n',
      'utf8',
    );

    const rulesPath = join(root, 'dist', 'hooks', 'rules-injector', 'index.js');
    if (options.productionRulesInjector) {
      copyFileSync(rulesProcessorFixturePath, rulesPath);
    } else {
      writeFileSync(
        rulesPath,
        `
          export function createRulesInjectorHook(cwd) {
            return {
              planToolExecution(toolName, filePath, sessionId) {
                const context = ['rules', toolName, filePath, sessionId, cwd].join('|');
                return {
                  reservationId: context,
                  rules: [{
                    relativePath: filePath,
                    matchReason: 'test',
                    content: context,
                    distance: 0,
                    contentHash: context,
                    realPath: filePath,
                    context
                  }]
                };
              },
              formatRuleForInjection(rule) {
                return rule.context;
              },
              formatRulesForInjection(rules) {
                return rules.map((rule) => rule.context).join('\\n\\n');
              },
              commitReservation() {},
              releaseReservation() {}
            };
          }
        `,
        'utf8',
      );
    }

    return { root, scripts };
  }

  function makeWorktree(label: string): string {
    const root = mkdtempSync(join(tmpdir(), `omc-post-tool-${label}-`));
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
    return spawnSync(process.execPath, [staged.scripts[name]], {
      cwd,
      input: typeof input === 'string' ? input : JSON.stringify(input),
      env: hookEnv(staged, cwd, extraEnv),
      encoding: 'utf8',
      timeout: 15_000,
      windowsHide: true,
    });
  }

  function hookEnv(
    staged: StagedPlugin,
    cwd: string,
    extraEnv: Record<string, string> = {},
  ): NodeJS.ProcessEnv {
    const testHome = join(cwd, '.home');
    mkdirSync(testHome, { recursive: true });
    return {
      ...process.env,
      CLAUDE_CONFIG_DIR: join(cwd, '.claude-test'),
      CLAUDE_PLUGIN_ROOT: staged.root,
      DISABLE_OMC: '',
      HOME: testHome,
      NODE_ENV: 'test',
      OMC_QUIET: '0',
      OMC_SESSION_ID: '',
      OMC_SKIP_HOOKS: '',
      OMC_STATE_DIR: '',
      USERPROFILE: testHome,
      ...extraEnv,
    };
  }

  function spawnHook(
    staged: StagedPlugin,
    input: HookPayload,
    cwd: string,
    extraEnv: Record<string, string> = {},
  ): ChildProcessWithoutNullStreams {
    const child = spawn(
      process.execPath,
      [staged.scripts['post-tool-rules-injector']],
      {
        cwd,
        env: hookEnv(staged, cwd, extraEnv),
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );
    child.stdin.end(JSON.stringify(input));
    return child;
  }

  async function collectChild(
    child: ChildProcessWithoutNullStreams,
  ): Promise<{
    status: number | null;
    signal: NodeJS.Signals | null;
    stdout: string;
    stderr: string;
  }> {
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));

    const { status, signal } = await new Promise<{
      status: number | null;
      signal: NodeJS.Signals | null;
    }>((resolveExit, rejectExit) => {
      child.once('error', rejectExit);
      child.once('close', (status, signal) => {
        resolveExit({ status, signal });
      });
    });

    return {
      status,
      signal,
      stdout: Buffer.concat(stdout).toString('utf8'),
      stderr: Buffer.concat(stderr).toString('utf8'),
    };
  }

  async function collectChildWithoutStdout(
    child: ChildProcessWithoutNullStreams,
  ): Promise<{
    status: number | null;
    signal: NodeJS.Signals | null;
    stderr: string;
  }> {
    const stderr: Buffer[] = [];
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    const { status, signal } = await new Promise<{
      status: number | null;
      signal: NodeJS.Signals | null;
    }>((resolveExit, rejectExit) => {
      child.once('error', rejectExit);
      const timeout = setTimeout(() => {
        child.stdout.destroy();
        child.stderr.destroy();
        child.kill();
        rejectExit(new Error(
          `Timed out waiting for hook exit: ${Buffer.concat(stderr).toString('utf8')}`,
        ));
      }, 5_000);
      child.once('exit', (status, signal) => {
        clearTimeout(timeout);
        child.stdout.destroy();
        resolveExit({ status, signal });
      });
    });
    return {
      status,
      signal,
      stderr: Buffer.concat(stderr).toString('utf8'),
    };
  }

  function prepareRulesWorktree(label: string): {
    cwd: string;
    targetPath: string;
  } {
    const cwd = makeWorktree(label);
    const targetPath = join(cwd, 'src', 'target.ts');
    mkdirSync(dirname(targetPath), { recursive: true });
    writeFileSync(join(cwd, 'package.json'), '{}\n', 'utf8');
    writeFileSync(targetPath, 'export const target = true;\n', 'utf8');
    return { cwd, targetPath };
  }

  function writeAlwaysRule(
    cwd: string,
    filename: string,
    content: string,
  ): string {
    const rulePath = join(cwd, '.claude', 'rules', filename);
    mkdirSync(dirname(rulePath), { recursive: true });
    writeFileSync(
      rulePath,
      `---\nalwaysApply: true\n---\n${content}`,
      'utf8',
    );
    return rulePath;
  }

  function rulesPayload(
    host: 'claude' | 'copilot',
    cwd: string,
    targetPath: string,
    sessionId: string,
  ): HookPayload {
    if (host === 'claude') {
      return {
        ...loadFixture('claude', 'post-tool-use'),
        cwd,
        session_id: sessionId,
        tool_name: 'Read',
        tool_input: { file_path: targetPath },
        tool_response: 'target contents',
      };
    }

    return {
      ...loadFixture('copilot-1.0.72-1', 'post-tool-use'),
      cwd,
      sessionId,
      toolName: 'read',
      toolArgs: JSON.stringify({ path: targetPath }),
      toolResult: 'target contents',
    };
  }

  function ruleContext(
    cwd: string,
    rulePath: string,
    content: string,
    legacy: boolean,
  ): string {
    const context =
      `[Rule: ${relative(cwd, rulePath)}]\n`
      + `[Match: alwaysApply]\n`
      + content;
    return legacy ? `\n\n${context}` : context;
  }

  function rulesStatePath(cwd: string, sessionId: string): string {
    return rulesStatePathForHome(join(cwd, '.home'), sessionId);
  }

  function rulesStatePathForHome(
    home: string,
    sessionId: string,
  ): string {
    return join(
      home,
      '.omc',
      'rules-injector',
      `${sessionId}.json`,
    );
  }

  function readRulesState(cwd: string, sessionId: string): {
    injectedHashes: string[];
    injectedRealPaths: string[];
    reservations?: Array<{
      id: string;
      rules: Array<{ contentHash: string; realPath: string }>;
    }>;
  } {
    return readRulesStateAtHome(join(cwd, '.home'), sessionId);
  }

  function readRulesStateAtHome(
    home: string,
    sessionId: string,
  ): {
    injectedHashes: string[];
    injectedRealPaths: string[];
    reservations?: Array<{
      id: string;
      rules: Array<{ contentHash: string; realPath: string }>;
    }>;
  } {
    return JSON.parse(
      readFileSync(rulesStatePathForHome(home, sessionId), 'utf8'),
    ) as {
      injectedHashes: string[];
      injectedRealPaths: string[];
      reservations?: Array<{
        id: string;
        rules: Array<{ contentHash: string; realPath: string }>;
      }>;
    };
  }

  async function waitForRulesState(
    cwd: string,
    sessionId: string,
    predicate: (state: ReturnType<typeof readRulesState>) => boolean,
    timeoutMs = 5_000,
  ): Promise<ReturnType<typeof readRulesState>> {
    return waitForRulesStateAtHome(
      join(cwd, '.home'),
      sessionId,
      predicate,
      timeoutMs,
    );
  }

  async function waitForRulesStateAtHome(
    home: string,
    sessionId: string,
    predicate: (state: ReturnType<typeof readRulesState>) => boolean,
    timeoutMs = 5_000,
  ): Promise<ReturnType<typeof readRulesState>> {
    const deadline = Date.now() + timeoutMs;
    let lastState: ReturnType<typeof readRulesState> | undefined;
    while (Date.now() < deadline) {
      if (existsSync(rulesStatePathForHome(home, sessionId))) {
        lastState = readRulesStateAtHome(home, sessionId);
        if (predicate(lastState)) return lastState;
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 25));
    }
    throw new Error(
      `Timed out waiting for rules state ${sessionId}: ${JSON.stringify(lastState)}`,
    );
  }

  function outputAdditionalContext(
    result: SpawnSyncReturns<string>,
    host: 'claude' | 'copilot',
  ): string | undefined {
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    const output = JSON.parse(result.stdout.trim()) as HookPayload;
    if (host === 'copilot') {
      return typeof output.additionalContext === 'string'
        ? output.additionalContext
        : undefined;
    }

    const hookSpecificOutput = output.hookSpecificOutput;
    return hookSpecificOutput
      && typeof hookSpecificOutput === 'object'
      && !Array.isArray(hookSpecificOutput)
      && typeof (hookSpecificOutput as HookPayload).additionalContext === 'string'
        ? (hookSpecificOutput as HookPayload).additionalContext as string
        : undefined;
  }

  function extractDeliveredRulePaths(context: string): string[] {
    return [...context.matchAll(/\[Rule: ([^\]]+)\]/g)]
      .map((match) => match[1]);
  }

  function failureRuntimeSource(kind: 'processor' | 'reduction'): string {
    const result = kind === 'processor'
      ? {
          envelope: { host: 'claude', issues: [] },
          evaluations: [{
            source: 'adapter',
            decision: 'deny',
            reason: 'processor exploded',
          }],
          reduction: {
            decision: 'deny',
            reason: 'processor exploded',
            callDecisions: [],
          },
        }
      : {
          envelope: { host: 'claude', issues: [] },
          evaluations: [],
          reduction: {
            decision: 'deny',
            reason: 'synthetic reduction failure',
            callDecisions: [{
              source: 'adapter',
              decision: 'deny',
              reason: 'synthetic reduction failure',
            }],
          },
        };

    return `
      const base = require(${JSON.stringify(runtimeFixturePath)});
      module.exports = {
        ...base,
        runHookJson: async () => (${JSON.stringify(result)}),
        encodeHookOutput: () => ({ decision: 'block' })
      };
    `;
  }

  it('preserves exact Claude verifier output and encodes Copilot toolResult context', () => {
    const staged = stagePlugin();
    const claudeCwd = makeWorktree('verifier-claude');
    const copilotCwd = makeWorktree('verifier-copilot');

    expectExactOutput(
      runHook(
        staged,
        'post-tool-verifier',
        {
          ...loadFixture('claude', 'post-tool-use'),
          cwd: claudeCwd,
          session_id: 'verifier-claude',
        },
        claudeCwd,
      ),
      exactClaudePostToolContext(
        'File written. Test the changes to ensure they work correctly.',
      ),
      true,
    );

    expectExactOutput(
      runHook(
        staged,
        'post-tool-verifier',
        {
          ...loadFixture('copilot-1.0.72-1', 'post-tool-use'),
          cwd: copilotCwd,
          sessionId: 'verifier-copilot',
          toolName: 'write',
          toolArgs: JSON.stringify({ file_path: 'README.md' }),
          toolResult: {
            filePath: join(copilotCwd, 'README.md'),
            type: 'create',
          },
        },
        copilotCwd,
      ),
      {
        additionalContext:
          'File written. Test the changes to ensure they work correctly.',
      },
      true,
    );
  });

  it('preserves Claude project-memory no-op output and canonicalizes Copilot processor input', () => {
    const staged = stagePlugin();
    const claudeCwd = makeWorktree('memory-claude');
    const copilotCwd = makeWorktree('memory-copilot');
    const claudeReceipt = join(claudeCwd, 'receipt.json');
    const copilotReceipt = join(copilotCwd, 'receipt.json');

    expectExactOutput(
      runHook(
        staged,
        'project-memory-posttool',
        {
          ...loadFixture('claude', 'post-tool-use'),
          cwd: claudeCwd,
          session_id: 'memory-claude',
        },
        claudeCwd,
        { OMC_TEST_PROJECT_MEMORY_RECEIPT: claudeReceipt },
      ),
      { continue: true, suppressOutput: true },
    );
    expect(JSON.parse(readFileSync(claudeReceipt, 'utf8'))).toMatchObject({
      toolName: 'Write',
      toolInput: {
        file_path: '<path>',
        content: '<file-content>',
      },
      toolOutput: {
        filePath: '<path>',
        success: true,
      },
      projectRoot: claudeCwd,
    });

    const copilotResult = {
      textResultForLlm: 'updated',
      resultType: 'success',
    };
    expectExactOutput(
      runHook(
        staged,
        'project-memory-posttool',
        {
          ...loadFixture('copilot-1.0.72-1', 'post-tool-use'),
          cwd: copilotCwd,
          sessionId: 'memory-copilot',
          toolName: 'write',
          toolArgs: JSON.stringify({ file_path: 'README.md' }),
          toolResult: copilotResult,
        },
        copilotCwd,
        { OMC_TEST_PROJECT_MEMORY_RECEIPT: copilotReceipt },
      ),
      {},
    );
    expect(JSON.parse(readFileSync(copilotReceipt, 'utf8'))).toEqual({
      toolName: 'Write',
      toolInput: { file_path: 'README.md' },
      toolOutput: copilotResult,
      projectRoot: copilotCwd,
    });
  });

  it('preserves exact Claude rules output and parses Copilot toolArgs', () => {
    const staged = stagePlugin();
    const claudeCwd = makeWorktree('rules-claude');
    const copilotCwd = makeWorktree('rules-copilot');
    const claudePath = isAbsolute('<path>')
      ? '<path>'
      : join(claudeCwd, '<path>');
    const claudeContext = [
      'rules',
      'Write',
      claudePath,
      '<session-id>',
      claudeCwd,
    ].join('|');

    expectExactOutput(
      runHook(
        staged,
        'post-tool-rules-injector',
        {
          ...loadFixture('claude', 'post-tool-use'),
          cwd: claudeCwd,
        },
        claudeCwd,
      ),
      exactClaudePostToolContext(claudeContext),
    );

    const copilotPath = join(copilotCwd, 'README.md');
    const copilotContext = [
      'rules',
      'Read',
      copilotPath,
      'rules-copilot',
      copilotCwd,
    ].join('|');
    expectExactOutput(
      runHook(
        staged,
        'post-tool-rules-injector',
        {
          ...loadFixture('copilot-1.0.72-1', 'post-tool-use'),
          cwd: copilotCwd,
          sessionId: 'rules-copilot',
          toolName: 'read',
          toolArgs: JSON.stringify({ path: 'README.md' }),
        },
        copilotCwd,
      ),
      { additionalContext: copilotContext },
    );
  });

  it('delivers and persists a complete long Claude rule with exact legacy output', () => {
    const staged = stagePlugin({ productionRulesInjector: true });
    const { cwd, targetPath } = prepareRulesWorktree('rules-long-claude');
    const sessionId = 'rules-long-claude';
    const content = `LONG-CLAUDE:${'x'.repeat(6_200)}`;
    const rulePath = writeAlwaysRule(cwd, 'long.md', content);
    const expectedContext = ruleContext(cwd, rulePath, content, true);

    expectExactOutput(
      runHook(
        staged,
        'post-tool-rules-injector',
        rulesPayload('claude', cwd, targetPath, sessionId),
        cwd,
      ),
      exactClaudePostToolContext(expectedContext),
    );

    const state = readRulesState(cwd, sessionId);
    expect(state.injectedHashes).toHaveLength(1);
    expect(state.injectedRealPaths).toEqual([realpathSync(rulePath)]);

    expectExactOutput(
      runHook(
        staged,
        'post-tool-rules-injector',
        rulesPayload('claude', cwd, targetPath, sessionId),
        cwd,
      ),
      { continue: true, suppressOutput: true },
    );
  });

  it('keeps an omitted long Copilot rule retryable until complete delivery', () => {
    const staged = stagePlugin({ productionRulesInjector: true });
    const { cwd, targetPath } = prepareRulesWorktree('rules-long-copilot');
    const sessionId = 'rules-long-copilot';
    const longContent = `LONG-COPILOT:${'y'.repeat(6_200)}`;
    const rulePath = writeAlwaysRule(cwd, 'long.md', longContent);

    expectExactOutput(
      runHook(
        staged,
        'post-tool-rules-injector',
        rulesPayload('copilot', cwd, targetPath, sessionId),
        cwd,
      ),
      {},
    );
    expect(existsSync(rulesStatePath(cwd, sessionId))).toBe(false);

    const retryContent = 'SHORT-COPILOT-RETRY';
    writeAlwaysRule(cwd, 'long.md', retryContent);
    expectExactOutput(
      runHook(
        staged,
        'post-tool-rules-injector',
        rulesPayload('copilot', cwd, targetPath, sessionId),
        cwd,
      ),
      {
        additionalContext: ruleContext(
          cwd,
          rulePath,
          retryContent,
          false,
        ),
      },
    );

    const state = readRulesState(cwd, sessionId);
    expect(state.injectedHashes).toHaveLength(1);
    expect(state.injectedRealPaths).toEqual([realpathSync(rulePath)]);

    expectExactOutput(
      runHook(
        staged,
        'post-tool-rules-injector',
        rulesPayload('copilot', cwd, targetPath, sessionId),
        cwd,
      ),
      {},
    );
  });

  it('preserves all Claude rules beyond canonical count bounds and deduplicates them', () => {
    const staged = stagePlugin({ productionRulesInjector: true });
    const { cwd, targetPath } = prepareRulesWorktree('rules-many-claude');
    const sessionId = 'rules-many-claude';
    const rules = Array.from({ length: 10 }, (_, index) => {
      const ordinal = String(index + 1).padStart(2, '0');
      const content = `CLAUDE-RULE-${ordinal}`;
      const path = writeAlwaysRule(cwd, `rule-${ordinal}.md`, content);
      return { path, content };
    });

    const result = runHook(
      staged,
      'post-tool-rules-injector',
      rulesPayload('claude', cwd, targetPath, sessionId),
      cwd,
    );
    const context = outputAdditionalContext(result, 'claude');
    expect(context).toBeDefined();
    expect(context?.startsWith('\n\n[Rule: ')).toBe(true);
    expect(context).not.toContain('…');
    expect(extractDeliveredRulePaths(context!)).toHaveLength(10);
    for (const rule of rules) {
      expect(context).toContain(ruleContext(cwd, rule.path, rule.content, true));
    }

    const state = readRulesState(cwd, sessionId);
    expect(state.injectedHashes).toHaveLength(10);
    expect([...state.injectedRealPaths].sort()).toEqual(
      rules.map((rule) => realpathSync(rule.path)).sort(),
    );

    expectExactOutput(
      runHook(
        staged,
        'post-tool-rules-injector',
        rulesPayload('claude', cwd, targetPath, sessionId),
        cwd,
      ),
      { continue: true, suppressOutput: true },
    );
  });

  it('persists only eight complete Copilot rules, then retries the omitted remainder', () => {
    const staged = stagePlugin({ productionRulesInjector: true });
    const { cwd, targetPath } = prepareRulesWorktree('rules-many-copilot');
    const sessionId = 'rules-many-copilot';
    const rules = Array.from({ length: 10 }, (_, index) => {
      const ordinal = String(index + 1).padStart(2, '0');
      const content = `COPILOT-RULE-${ordinal}`;
      const path = writeAlwaysRule(cwd, `rule-${ordinal}.md`, content);
      return { path, content };
    });

    const first = runHook(
      staged,
      'post-tool-rules-injector',
      rulesPayload('copilot', cwd, targetPath, sessionId),
      cwd,
    );
    const firstContext = outputAdditionalContext(first, 'copilot');
    expect(firstContext).toBeDefined();
    expect(firstContext).not.toContain('…');
    const firstRelativePaths = extractDeliveredRulePaths(firstContext!);
    expect(firstRelativePaths).toHaveLength(8);
    for (const relativePath of firstRelativePaths) {
      const rule = rules.find(
        (candidate) => relative(cwd, candidate.path) === relativePath,
      );
      expect(rule).toBeDefined();
      expect(firstContext).toContain(
        ruleContext(cwd, rule!.path, rule!.content, false),
      );
    }

    const firstState = readRulesState(cwd, sessionId);
    expect(firstState.injectedHashes).toHaveLength(8);
    expect([...firstState.injectedRealPaths].sort()).toEqual(
      firstRelativePaths
        .map((rulePath) => realpathSync(resolve(cwd, rulePath)))
        .sort(),
    );

    const second = runHook(
      staged,
      'post-tool-rules-injector',
      rulesPayload('copilot', cwd, targetPath, sessionId),
      cwd,
    );
    const secondContext = outputAdditionalContext(second, 'copilot');
    expect(secondContext).toBeDefined();
    expect(secondContext).not.toContain('…');
    const secondRelativePaths = extractDeliveredRulePaths(secondContext!);
    expect(secondRelativePaths).toHaveLength(2);
    for (const relativePath of secondRelativePaths) {
      const rule = rules.find(
        (candidate) => relative(cwd, candidate.path) === relativePath,
      );
      expect(rule).toBeDefined();
      expect(secondContext).toContain(
        ruleContext(cwd, rule!.path, rule!.content, false),
      );
    }
    expect(
      secondRelativePaths.some((rulePath) =>
        firstRelativePaths.includes(rulePath),
      ),
    ).toBe(false);

    const finalState = readRulesState(cwd, sessionId);
    expect(finalState.injectedHashes).toHaveLength(10);
    expect([...finalState.injectedRealPaths].sort()).toEqual(
      rules.map((rule) => realpathSync(rule.path)).sort(),
    );

    expectExactOutput(
      runHook(
        staged,
        'post-tool-rules-injector',
        rulesPayload('copilot', cwd, targetPath, sessionId),
        cwd,
      ),
      {},
    );
  });

  it('prevents duplicate delivery across concurrent rules hook processes', async () => {
    const staged = stagePlugin({ productionRulesInjector: true });
    const { cwd, targetPath } = prepareRulesWorktree('rules-concurrent-reserve');
    const sessionId = 'rules-concurrent-reserve';
    const content = 'CONCURRENT-RESERVATION-RULE';
    writeAlwaysRule(cwd, 'concurrent.md', content);
    const payload = rulesPayload('copilot', cwd, targetPath, sessionId);

    const [first, second] = await Promise.all([
      collectChild(spawnHook(staged, payload, cwd)),
      collectChild(spawnHook(staged, payload, cwd)),
    ]);

    for (const result of [first, second]) {
      expect(result.status).toBe(0);
      expect(result.signal).toBeNull();
      expect(result.stderr).toBe('');
    }
    const outputs = [first.stdout, second.stdout].map(
      (stdout) => JSON.parse(stdout.trim()) as HookPayload,
    );
    expect(
      outputs.filter((output) => typeof output.additionalContext === 'string'),
    ).toHaveLength(1);
    expect(outputs.filter((output) => Object.keys(output).length === 0))
      .toHaveLength(1);

    const state = readRulesState(cwd, sessionId);
    expect(state.injectedHashes).toHaveLength(1);
    expect(state.injectedRealPaths).toHaveLength(1);
    expect(state.reservations ?? []).toHaveLength(0);
  }, 15_000);

  it('merges commits from concurrent projects without losing either rule', async () => {
    const staged = stagePlugin({ productionRulesInjector: true });
    const projectA = prepareRulesWorktree('rules-merge-a');
    const projectB = prepareRulesWorktree('rules-merge-b');
    const commonHome = makeWorktree('rules-merge-home');
    const sessionId = 'rules-concurrent-merge';
    const ruleA = writeAlwaysRule(
      projectA.cwd,
      'project-a.md',
      'PROJECT-A-RULE',
    );
    const ruleB = writeAlwaysRule(
      projectB.cwd,
      'project-b.md',
      'PROJECT-B-RULE',
    );
    const sharedEnv = {
      HOME: commonHome,
      USERPROFILE: commonHome,
    };

    const [first, second] = await Promise.all([
      collectChild(spawnHook(
        staged,
        rulesPayload(
          'copilot',
          projectA.cwd,
          projectA.targetPath,
          sessionId,
        ),
        projectA.cwd,
        sharedEnv,
      )),
      collectChild(spawnHook(
        staged,
        rulesPayload(
          'copilot',
          projectB.cwd,
          projectB.targetPath,
          sessionId,
        ),
        projectB.cwd,
        sharedEnv,
      )),
    ]);

    for (const result of [first, second]) {
      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      expect(
        (JSON.parse(result.stdout.trim()) as HookPayload).additionalContext,
      ).toEqual(expect.any(String));
    }

    const state = readRulesStateAtHome(commonHome, sessionId);
    expect(state.injectedHashes).toHaveLength(2);
    expect([...state.injectedRealPaths].sort()).toEqual(
      [realpathSync(ruleA), realpathSync(ruleB)].sort(),
    );
    expect(state.reservations ?? []).toHaveLength(0);
  }, 15_000);

  it('waits for backpressured stdout flush before committing a reservation', async () => {
    const staged = stagePlugin({ productionRulesInjector: true });
    const { cwd, targetPath } = prepareRulesWorktree('rules-backpressure');
    const sessionId = 'rules-backpressure';
    writeAlwaysRule(
      cwd,
      'large.md',
      `BACKPRESSURE:${'b'.repeat(2_000_000)}`,
    );
    const child = spawnHook(
      staged,
      rulesPayload('claude', cwd, targetPath, sessionId),
      cwd,
      { OMC_RULES_STDOUT_FLUSH_TIMEOUT_MS: '5000' },
    );
    child.stdout.pause();

    await waitForRulesState(
      cwd,
      sessionId,
      (state) => (state.reservations?.length ?? 0) === 1,
    );
    await new Promise((resolveWait) => setTimeout(resolveWait, 150));
    const reservedState = readRulesState(cwd, sessionId);
    expect(reservedState.injectedHashes).toHaveLength(0);
    expect(reservedState.reservations).toHaveLength(1);
    expect(child.exitCode).toBeNull();

    const completion = collectChild(child);
    child.stdout.resume();
    const result = await completion;
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('BACKPRESSURE:');

    const committedState = readRulesState(cwd, sessionId);
    expect(committedState.injectedHashes).toHaveLength(1);
    expect(committedState.reservations ?? []).toHaveLength(0);
  }, 15_000);

  it('releases reservations after EPIPE and retries the rule', async () => {
    const staged = stagePlugin({ productionRulesInjector: true });
    const { cwd, targetPath } = prepareRulesWorktree('rules-epipe');
    const sessionId = 'rules-epipe';
    const rulePath = writeAlwaysRule(
      cwd,
      'epipe.md',
      `EPIPE:${'e'.repeat(2_000_000)}`,
    );
    const child = spawnHook(
      staged,
      rulesPayload('claude', cwd, targetPath, sessionId),
      cwd,
    );
    child.stdout.destroy();
    const failed = await collectChildWithoutStdout(child);

    expect(failed.status).toBe(0);
    expect(failed.stderr).toContain('stdout delivery failed');
    expect(failed.stderr).toContain('remain eligible for retry');
    expect(existsSync(rulesStatePath(cwd, sessionId))).toBe(false);

    const retryContent = 'EPIPE-RETRY-SUCCEEDED';
    writeAlwaysRule(cwd, 'epipe.md', retryContent);
    expectExactOutput(
      runHook(
        staged,
        'post-tool-rules-injector',
        rulesPayload('claude', cwd, targetPath, sessionId),
        cwd,
      ),
      exactClaudePostToolContext(
        ruleContext(cwd, rulePath, retryContent, true),
      ),
    );
    expect(readRulesState(cwd, sessionId).injectedHashes).toHaveLength(1);
  }, 15_000);

  it('times out blocked stdout without committing and releases for retry', async () => {
    const staged = stagePlugin({ productionRulesInjector: true });
    const { cwd, targetPath } = prepareRulesWorktree('rules-flush-timeout');
    const sessionId = 'rules-flush-timeout';
    const rulePath = writeAlwaysRule(
      cwd,
      'timeout.md',
      `TIMEOUT:${'t'.repeat(2_000_000)}`,
    );
    const child = spawnHook(
      staged,
      rulesPayload('claude', cwd, targetPath, sessionId),
      cwd,
      { OMC_RULES_STDOUT_FLUSH_TIMEOUT_MS: '100' },
    );
    child.stdout.pause();
    const failed = await collectChildWithoutStdout(child);

    expect(failed.status).toBe(0);
    expect(failed.stderr).toContain('stdout delivery failed');
    expect(failed.stderr).toContain('stdout flush timed out');
    expect(existsSync(rulesStatePath(cwd, sessionId))).toBe(false);

    const retryContent = 'TIMEOUT-RETRY-SUCCEEDED';
    writeAlwaysRule(cwd, 'timeout.md', retryContent);
    expectExactOutput(
      runHook(
        staged,
        'post-tool-rules-injector',
        rulesPayload('claude', cwd, targetPath, sessionId),
        cwd,
      ),
      exactClaudePostToolContext(
        ruleContext(cwd, rulePath, retryContent, true),
      ),
    );
    expect(readRulesState(cwd, sessionId).injectedHashes).toHaveLength(1);
  }, 15_000);

  it('preserves exact Claude failure guidance and supports Copilot error input', () => {
    const staged = stagePlugin();
    const claudeCwd = makeWorktree('failure-claude');
    const copilotCwd = makeWorktree('failure-copilot');

    expectExactOutput(
      runHook(
        staged,
        'post-tool-use-failure',
        {
          ...loadFixture('claude', 'post-tool-use-failure'),
          cwd: claudeCwd,
          session_id: 'failure-claude',
        },
        claudeCwd,
      ),
      exactClaudePostToolFailureContext(
        'Tool "Bash" failed. Analyze the error, fix the issue, and continue working.',
      ),
    );

    const claudeState = JSON.parse(
      readFileSync(
        join(
          claudeCwd,
          '.omc',
          'state',
          'sessions',
          'failure-claude',
          'last-tool-error-state.json',
        ),
        'utf8',
      ),
    ) as HookPayload;
    expect(claudeState).toMatchObject({
      tool_name: 'Bash',
      error: '<tool-error>',
      retry_count: 1,
    });

    expectExactOutput(
      runHook(
        staged,
        'post-tool-use-failure',
        {
          ...loadFixture('copilot-1.0.72-1', 'post-tool-use-failure'),
          cwd: copilotCwd,
          sessionId: 'failure-copilot',
          error: 'glob failed',
        },
        copilotCwd,
      ),
      {
        additionalContext:
          'Tool "Glob" failed. Analyze the error, fix the issue, and continue working.',
      },
    );

    const copilotState = JSON.parse(
      readFileSync(
        join(
          copilotCwd,
          '.omc',
          'state',
          'sessions',
          'failure-copilot',
          'last-tool-error-state.json',
        ),
        'utf8',
      ),
    ) as HookPayload;
    expect(copilotState).toMatchObject({
      tool_name: 'Glob',
      tool_input_preview:
        '{"pattern":"<glob-pattern>","paths":"<path>"}',
      error: 'glob failed',
      retry_count: 1,
    });
  });

  it.each(
    (Object.keys(SCRIPT_CONFIG) as ScriptName[]).flatMap((name) =>
      (['missing', 'corrupt'] as const).map((runtime) => ({ name, runtime })),
    ),
  )('fails open visibly when $name runtime bundle is $runtime', ({
    name,
    runtime,
  }) => {
    const staged = stagePlugin({ runtime });
    const cwd = makeWorktree(`${name}-${runtime}`);
    const event = SCRIPT_CONFIG[name].event === 'PostToolUse'
      ? 'post-tool-use'
      : 'post-tool-use-failure';
    const result = runHook(
      staged,
      name,
      {
        ...loadFixture('claude', event),
        cwd,
        session_id: `${name}-${runtime}`,
      },
      cwd,
    );

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(`${JSON.stringify({ continue: true })}\n`);
    expect(result.stdout).not.toContain('decision');
    expect(result.stderr).toContain(`[${name}]`);
    expect(result.stderr).toContain(
      'continuing without optional hook behavior',
    );
  });

  it.each(Object.keys(SCRIPT_CONFIG) as ScriptName[])(
    'fails open visibly when canonical normalization rejects %s input',
    (name) => {
      const staged = stagePlugin();
      const cwd = makeWorktree(`${name}-normalization`);
      const result = runHook(staged, name, '{"unterminated"', cwd);

      expect(result.status).toBe(0);
      expect(result.stdout).toBe(`${JSON.stringify({ continue: true })}\n`);
      expect(result.stdout).not.toContain('decision');
      expect(result.stderr).toContain(`[${name}]`);
      expect(result.stderr).toContain('Hook input must be a JSON object.');
    },
  );

  it.each(Object.keys(SCRIPT_CONFIG) as ScriptName[])(
    'fails open visibly when the %s processor adapter fails',
    (name) => {
      const staged = stagePlugin({
        runtimeSource: failureRuntimeSource('processor'),
      });
      const cwd = makeWorktree(`${name}-processor`);
      const event = SCRIPT_CONFIG[name].event === 'PostToolUse'
        ? 'post-tool-use'
        : 'post-tool-use-failure';
      const result = runHook(
        staged,
        name,
        {
          ...loadFixture('claude', event),
          cwd,
        },
        cwd,
      );

      expect(result.status).toBe(0);
      expect(result.stdout).toBe(`${JSON.stringify({ continue: true })}\n`);
      expect(result.stdout).not.toContain('decision');
      expect(result.stderr).toContain('processor exploded');
    },
  );

  it.each(Object.keys(SCRIPT_CONFIG) as ScriptName[])(
    'fails open visibly instead of encoding a %s reduction failure',
    (name) => {
      const staged = stagePlugin({
        runtimeSource: failureRuntimeSource('reduction'),
      });
      const cwd = makeWorktree(`${name}-reduction`);
      const event = SCRIPT_CONFIG[name].event === 'PostToolUse'
        ? 'post-tool-use'
        : 'post-tool-use-failure';
      const result = runHook(
        staged,
        name,
        {
          ...loadFixture('claude', event),
          cwd,
        },
        cwd,
      );

      expect(result.status).toBe(0);
      expect(result.stdout).toBe(`${JSON.stringify({ continue: true })}\n`);
      expect(result.stdout).not.toContain('decision');
      expect(result.stderr).toContain('synthetic reduction failure');
    },
  );

  it('keeps the manifest and shipped sources on the canonical post-tool path', () => {
    const manifest = JSON.parse(
      readFileSync(HOOKS_MANIFEST_PATH, 'utf8'),
    ) as {
      hooks: Record<
        'PostToolUse' | 'PostToolUseFailure',
        Array<{
          matcher: string;
          hooks: Array<{
            command: string;
            bash: string;
            powershell: string;
          }>;
        }>
      >;
    };

    const postToolFiles = manifest.hooks.PostToolUse[0].hooks.map((hook) => {
      const match = hook.command.match(/scripts\/([a-z0-9-]+\.mjs)/i);
      return match?.[1];
    });
    expect(manifest.hooks.PostToolUse[0].matcher).toBe('*');
    expect(postToolFiles).toEqual([
      'post-tool-verifier.mjs',
      'project-memory-posttool.mjs',
      'post-tool-rules-injector.mjs',
    ]);

    const failureHook = manifest.hooks.PostToolUseFailure[0];
    expect(failureHook.matcher).toBe('*');
    expect(failureHook.hooks).toHaveLength(1);
    for (const command of [
      failureHook.hooks[0].command,
      failureHook.hooks[0].bash,
      failureHook.hooks[0].powershell,
    ]) {
      expect(command).toContain('/scripts/post-tool-use-failure.mjs');
    }

    for (const [name, config] of Object.entries(SCRIPT_CONFIG) as Array<
      [ScriptName, (typeof SCRIPT_CONFIG)[ScriptName]]
    >) {
      const source = readFileSync(
        join(REPO_ROOT, 'scripts', config.filename),
        'utf8',
      );
      expect(source, name).toContain('loadHookRuntime()');
      expect(source, name).toContain(
        `runtime.runHookJson(\n      '${config.hookType}'`,
      );
      expect(source, name).toContain(
        'runtime.buildLegacyProcessorInput(envelope, unit)',
      );
      expect(source, name).toContain('runtime.encodeHookOutput(');
      expect(source, name).toContain('surfaceOptionalHookFailure(');
      expect(source, name).not.toContain('normalizeLegacyHookInput');
      expect(source, name).not.toMatch(/JSON\.parse\(\s*input\s*\)/);
      expect(source, name).not.toMatch(
        /\bdata\.(?:tool_name|tool_input|tool_response|session_id|is_interrupt|cwd|context_window)\b/,
      );
    }

    const rulesSource = readFileSync(
      join(REPO_ROOT, 'scripts', 'post-tool-rules-injector.mjs'),
      'utf8',
    );
    expect(rulesSource).toContain('hook.planToolExecution(');
    expect(rulesSource).toContain('await writeStdoutAndWait(output)');
    expect(rulesSource).toContain("stdout.once('drain', onDrain)");
    expect(rulesSource).toContain("stdout.on('error', onError)");
    expect(rulesSource).toContain('reservation.hook.commitReservation(');
    expect(rulesSource.indexOf('await writeStdoutAndWait(output)')).toBeLessThan(
      rulesSource.indexOf('reservation.hook.commitReservation('),
    );

    const rulesStorageSource = readFileSync(
      join(REPO_ROOT, 'src', 'hooks', 'rules-injector', 'storage.ts'),
      'utf8',
    );
    expect(rulesStorageSource).toContain('withFileLockSync(');
    expect(rulesStorageSource).toContain('reserveInjectedRules(');
    expect(rulesStorageSource).toContain('atomicWriteFileSync(');

    expect(existsSync(join(REPO_ROOT, 'scripts', 'lib', 'hook-runtime-loader.mjs')))
      .toBe(true);
  });
});
