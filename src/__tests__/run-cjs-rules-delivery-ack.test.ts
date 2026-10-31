import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
} from 'vitest';
import { stageHookRuntimeSupport } from './helpers/staged-hook-runtime.js';

const REPO_ROOT = process.cwd();
const RUN_CJS_PATH = join(REPO_ROOT, 'scripts', 'run.cjs');
const HOST_DELIVERY_ACK_ENV = 'OMC_RUNNER_HOST_DELIVERY_ACK';
const HOST_DELIVERY_DEADLINE_ENV =
  'OMC_RUNNER_HOST_DELIVERY_DEADLINE_AT';
const OUTER_TIMEOUT_MS = 3_000;
const INNER_TIMEOUT_MS = 2_500;
const ROUTES = ['worker', 'generic'] as const;

type Route = (typeof ROUTES)[number];
type Host = 'claude' | 'copilot';
type StdoutMode = 'capture' | 'closed' | 'stalled';

interface Fixture {
  root: string;
  cwd: string;
  home: string;
  host: Host;
  processReceiptDir: string;
  routeReceiptPath: string;
  ruleContent: string;
  rulePath: string;
  sessionId: string;
  targetPath: string;
}

interface RulesState {
  injectedHashes?: string[];
  injectedRealPaths?: string[];
  reservations?: unknown[];
}

type RulesStateReceipt =
  | { status: 'missing' }
  | { status: 'present'; value: RulesState };

interface RouteReceipt {
  route: string;
  pid: number;
}

interface ProcessReceipt {
  role: string;
  pid: number;
  parentPid: number;
  recordedAt: number;
  threadId?: number;
}

interface Invocation {
  route: Route;
  startedAt: number;
  exitedAt: number;
  closedAt: number;
  wallMs: number;
  reapWallMs: number;
  survivors: number[];
  status: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  runnerPid: number;
  routeReceipt: RouteReceipt | null;
  processReceipts: ProcessReceipt[];
}

interface Evidence {
  artifacts: Record<string, {
    path: string;
    sha256: string;
    mtimeUtc: string;
  }>;
  runs: Array<Record<string, unknown>>;
  trust: Array<Record<string, unknown>>;
}

const runnerModule = require('../../scripts/run.cjs') as {
  resolveGenericTimeoutMs(
    manifest: { timeoutMs: number; event: string },
    platform?: NodeJS.Platform,
  ): number;
};

let suiteRoot: string;
let pluginRoot: string;
let runnerPath: string;
let rulesHookPath: string;
const fixtureRoots: string[] = [];
const activeChildren = new Set<ChildProcess>();
const evidence: Evidence = {
  artifacts: {},
  runs: [],
  trust: [],
};

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function artifactReceipt(path: string): Evidence['artifacts'][string] {
  return {
    path,
    sha256: sha256(path),
    mtimeUtc: statSync(path).mtime.toISOString(),
  };
}

function initializeLocalGitRepository(cwd: string): void {
  const runGit = (args: readonly string[]) => {
    const result = spawnSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 5_000,
      windowsHide: true,
    });
    if (result.status !== 0) {
      throw new Error(
        `git ${args.join(' ')} failed: ${result.stderr || result.stdout}`,
      );
    }
  };

  runGit(['init', '--quiet']);
  runGit([
    'config',
    '--local',
    'remote.origin.url',
    'https://example.invalid/omc-rules-ack.git',
  ]);
}

function copyDistFile(relativePath: string): void {
  const source = join(REPO_ROOT, 'dist', relativePath);
  const destination = join(pluginRoot, 'dist', relativePath);
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(source, destination);
}

function stageProductionPlugin(): void {
  stageHookRuntimeSupport(pluginRoot, REPO_ROOT);
  copyFileSync(join(REPO_ROOT, 'scripts', 'run.cjs'), runnerPath);
  copyFileSync(
    join(REPO_ROOT, 'scripts', 'post-tool-rules-injector.mjs'),
    rulesHookPath,
  );

  mkdirSync(join(pluginRoot, 'bridge'), { recursive: true });
  copyFileSync(
    join(REPO_ROOT, 'bridge', 'hook-runtime.cjs'),
    join(pluginRoot, 'bridge', 'hook-runtime.cjs'),
  );
  cpSync(
    join(REPO_ROOT, 'dist', 'hooks', 'rules-injector'),
    join(pluginRoot, 'dist', 'hooks', 'rules-injector'),
    { recursive: true },
  );
  for (const relativePath of [
    join('lib', 'atomic-write.js'),
    join('lib', 'file-identity.js'),
    join('lib', 'file-lock.js'),
    join('platform', 'index.js'),
    join('platform', 'process-utils.js'),
    join('utils', 'config-dir.js'),
    join('utils', 'frontmatter.js'),
  ]) {
    copyDistFile(relativePath);
  }

  mkdirSync(join(pluginRoot, 'hooks'), { recursive: true });
  copyFileSync(
    join(REPO_ROOT, 'hooks', 'hooks.json'),
    join(pluginRoot, 'hooks', 'hooks.json'),
  );
  mkdirSync(join(pluginRoot, '.claude-plugin'), { recursive: true });
  copyFileSync(
    join(REPO_ROOT, '.claude-plugin', 'plugin.json'),
    join(pluginRoot, '.claude-plugin', 'plugin.json'),
  );
  writeFileSync(
    join(pluginRoot, 'package.json'),
    `${JSON.stringify({ type: 'module' })}\n`,
    'utf8',
  );
}

beforeAll(() => {
  suiteRoot = mkdtempSync(join(tmpdir(), 'omc-runner-rules-ack-plugin-'));
  pluginRoot = join(suiteRoot, 'plugin');
  runnerPath = join(pluginRoot, 'scripts', 'run.cjs');
  rulesHookPath = join(pluginRoot, 'scripts', 'post-tool-rules-injector.mjs');
  stageProductionPlugin();

  for (const [name, path] of Object.entries({
    runtime: join(pluginRoot, 'bridge', 'hook-runtime.cjs'),
    processor: join(pluginRoot, 'dist', 'hooks', 'rules-injector', 'index.js'),
    storage: join(pluginRoot, 'dist', 'hooks', 'rules-injector', 'storage.js'),
    fileLock: join(pluginRoot, 'dist', 'lib', 'file-lock.js'),
    processUtils: join(pluginRoot, 'dist', 'platform', 'process-utils.js'),
    runner: runnerPath,
    rulesScript: rulesHookPath,
  })) {
    evidence.artifacts[name] = artifactReceipt(path);
  }
});

afterAll(() => {
  const evidencePath = process.env.OMC_ACK_EVIDENCE_LOG;
  if (evidencePath) {
    mkdirSync(dirname(evidencePath), { recursive: true });
    writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  }
  rmSync(suiteRoot, { recursive: true, force: true });
});

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
    throw error;
  }
}

function terminatePidTree(pid: number): void {
  if (!Number.isInteger(pid) || pid <= 0 || !processAlive(pid)) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/T', '/F', '/PID', String(pid)], {
      stdio: 'ignore',
      timeout: 2_000,
      windowsHide: true,
    });
    return;
  }
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    // The process may have exited between the liveness check and signal.
  }
}

function requestPidTreeTermination(pid: number): void {
  if (!Number.isInteger(pid) || pid <= 0 || !processAlive(pid)) return;
  if (process.platform === 'win32') {
    const killer = spawn(
      'taskkill',
      ['/T', '/F', '/PID', String(pid)],
      {
        cwd: tmpdir(),
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      },
    );
    killer.on('error', () => {});
    killer.unref();
    return;
  }
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    // The process may have exited between the liveness check and signal.
  }
}

async function waitForPidsDead(
  pids: readonly number[],
  deadlineAt: number,
): Promise<number[]> {
  const uniquePids = [...new Set(pids.filter((pid) => pid > 0))];
  while (performance.now() < deadlineAt) {
    const alive = uniquePids.filter(processAlive);
    if (alive.length === 0) return [];
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return uniquePids.filter(processAlive);
}

afterEach(async () => {
  for (const child of activeChildren) {
    if (child.pid) terminatePidTree(child.pid);
  }
  activeChildren.clear();

  for (const root of fixtureRoots.splice(0)) {
    const receiptDir = join(root, '.process-receipts');
    const receiptPids: number[] = [];
    if (existsSync(receiptDir)) {
      for (const name of readdirSync(receiptDir)) {
        try {
          const receipt = JSON.parse(
            readFileSync(join(receiptDir, name), 'utf8'),
          ) as Partial<ProcessReceipt>;
          if (typeof receipt.pid === 'number') {
            receiptPids.push(receipt.pid);
            terminatePidTree(receipt.pid);
          }
        } catch {
          // Malformed test evidence does not block PID-scoped cleanup.
        }
      }
    }
    await waitForPidsDead(receiptPids, performance.now() + 2_000);
    const cleanupDeadline = performance.now() + 1_000;
    while (true) {
      try {
        rmSync(root, { recursive: true, force: true });
        break;
      } catch (error) {
        if (
          (error as NodeJS.ErrnoException).code !== 'EPERM'
          || performance.now() >= cleanupDeadline
        ) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
  }
});

function makeFixture(
  label: string,
  ruleContent: string,
  host: Host,
): Fixture {
  const root = mkdtempSync(join(tmpdir(), `omc-runner-rules-${label}-`));
  fixtureRoots.push(root);
  const cwd = join(root, 'project');
  const targetPath = join(cwd, 'src', 'target.ts');
  const rulePath = join(cwd, '.claude', 'rules', 'delivery.md');
  const home = join(root, '.home');
  const processReceiptDir = join(root, '.process-receipts');
  mkdirSync(dirname(targetPath), { recursive: true });
  mkdirSync(dirname(rulePath), { recursive: true });
  mkdirSync(home, { recursive: true });
  mkdirSync(processReceiptDir, { recursive: true });
  writeFileSync(join(cwd, 'package.json'), '{}\n', 'utf8');
  initializeLocalGitRepository(cwd);
  writeFileSync(join(cwd, 'transcript.jsonl'), '{}\n', 'utf8');
  writeFileSync(targetPath, 'export const target = true;\n', 'utf8');
  writeFileSync(
    rulePath,
    `---\nalwaysApply: true\n---\n${ruleContent}`,
    'utf8',
  );

  return {
    root,
    cwd,
    home,
    host,
    processReceiptDir,
    routeReceiptPath: join(root, '.runner-route.json'),
    ruleContent,
    rulePath,
    sessionId: `delivery-${label}`,
    targetPath,
  };
}

function hookPayload(fixture: Fixture): string {
  if (fixture.host === 'copilot') {
    return JSON.stringify({
      hookName: 'postToolUse',
      sessionId: fixture.sessionId,
      cwd: fixture.cwd,
      toolName: 'read',
      toolArgs: JSON.stringify({ path: fixture.targetPath }),
      toolResult: 'target contents',
    });
  }

  return JSON.stringify({
    session_id: fixture.sessionId,
    transcript_path: join(fixture.cwd, 'transcript.jsonl'),
    cwd: fixture.cwd,
    permission_mode: 'default',
    hook_event_name: 'PostToolUse',
    tool_name: 'Read',
    tool_input: { file_path: fixture.targetPath },
    tool_response: {
      filePath: fixture.targetPath,
      success: true,
    },
    tool_use_id: 'delivery-tool-use',
    duration_ms: 0,
  });
}

function hookEnvironment(
  route: Route,
  fixture: Fixture,
  flushTimeoutMs: number,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CLAUDE_CONFIG_DIR: join(fixture.root, '.claude-test'),
    CLAUDE_PLUGIN_ROOT: pluginRoot,
    DISABLE_OMC: '',
    HOME: fixture.home,
    NODE_ENV: 'test',
    OMC_HOST: fixture.host,
    OMC_QUIET: '0',
    OMC_RULES_STDOUT_FLUSH_TIMEOUT_MS: String(flushTimeoutMs),
    OMC_RUNNER_TEST_FORCE_GENERIC: route === 'generic' ? '1' : '',
    OMC_RUNNER_TEST_PROCESS_RECEIPT_DIR: fixture.processReceiptDir,
    OMC_RUNNER_TEST_ROUTE_RECEIPT: fixture.routeReceiptPath,
    OMC_SESSION_ID: '',
    OMC_SKIP_HOOKS: '',
    OMC_STATE_DIR: '',
    USERPROFILE: fixture.home,
  };

  delete env[HOST_DELIVERY_ACK_ENV];
  delete env[HOST_DELIVERY_DEADLINE_ENV];
  delete env.OMC_TEST_EMERGENCY_PROCESS_START_UNKNOWN_PID;
  delete env.OMC_TEST_FILE_LOCK_PROCESS_START_UNKNOWN_PID;
  if (fixture.host === 'copilot') {
    env.COPILOT_CLI = '1';
    env.COPILOT_AGENT_SESSION_ID = fixture.sessionId;
  } else {
    delete env.COPILOT_CLI;
    delete env.COPILOT_AGENT_SESSION_ID;
  }
  return env;
}

function resetReceipts(fixture: Fixture): void {
  rmSync(fixture.routeReceiptPath, { force: true });
  rmSync(fixture.processReceiptDir, { recursive: true, force: true });
  mkdirSync(fixture.processReceiptDir, { recursive: true });
}

function readRouteReceipt(fixture: Fixture): RouteReceipt | null {
  if (!existsSync(fixture.routeReceiptPath)) return null;
  const value = JSON.parse(
    readFileSync(fixture.routeReceiptPath, 'utf8'),
  ) as Partial<RouteReceipt>;
  if (typeof value.route !== 'string' || typeof value.pid !== 'number') {
    throw new TypeError('runner route receipt is malformed');
  }
  return { route: value.route, pid: value.pid };
}

function readProcessReceipts(fixture: Fixture): ProcessReceipt[] {
  return readdirSync(fixture.processReceiptDir)
    .map((name) => JSON.parse(
      readFileSync(join(fixture.processReceiptDir, name), 'utf8'),
    ) as Partial<ProcessReceipt>)
    .map((value) => {
      if (
        typeof value.role !== 'string'
        || typeof value.pid !== 'number'
        || typeof value.parentPid !== 'number'
        || typeof value.recordedAt !== 'number'
      ) {
        throw new TypeError('runner process receipt is malformed');
      }
      return {
        role: value.role,
        pid: value.pid,
        parentPid: value.parentPid,
        recordedAt: value.recordedAt,
        ...(typeof value.threadId === 'number'
          ? { threadId: value.threadId }
          : {}),
      };
    });
}

async function invokeWrapped(
  route: Route,
  fixture: Fixture,
  stdoutMode: StdoutMode,
  flushTimeoutMs: number,
): Promise<Invocation> {
  resetReceipts(fixture);
  const startedAt = performance.now();
  const child = spawn(
    process.execPath,
    [runnerPath, rulesHookPath],
    {
      cwd: fixture.cwd,
      env: hookEnvironment(route, fixture, flushTimeoutMs),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    },
  );
  activeChildren.add(child);
  const runnerPid = child.pid ?? -1;
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  if (stdoutMode === 'capture') {
    child.stdout?.on('data', (chunk: Buffer) => stdout.push(chunk));
  } else if (stdoutMode === 'closed') {
    child.stdout?.destroy();
  } else {
    child.stdout?.pause();
  }
  child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk));
  child.stdin?.end(hookPayload(fixture));

  let status: number | null = null;
  let signal: NodeJS.Signals | null = null;
  let exitedAt = Number.NaN;
  let closedAt = Number.NaN;
  let timedOut = false;
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      timedOut = true;
      if (child.pid) requestPidTreeTermination(child.pid);
    }, OUTER_TIMEOUT_MS);
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('exit', (exitStatus, exitSignal) => {
      status = exitStatus;
      signal = exitSignal;
      exitedAt = performance.now();
      if (stdoutMode !== 'capture') child.stdout?.destroy();
    });
    child.once('close', () => {
      clearTimeout(timeout);
      closedAt = performance.now();
      resolve();
    });
  });
  activeChildren.delete(child);

  if (!Number.isFinite(exitedAt)) exitedAt = closedAt;
  const routeReceipt = readRouteReceipt(fixture);
  const processReceipts = readProcessReceipts(fixture);
  const processPids = [
    runnerPid,
    ...processReceipts.map(({ pid }) => pid),
  ];
  const survivors = await waitForPidsDead(
    processPids,
    startedAt + OUTER_TIMEOUT_MS,
  );
  const reapWallMs = performance.now() - startedAt;
  const invocation: Invocation = {
    route,
    startedAt,
    exitedAt,
    closedAt,
    wallMs: closedAt - startedAt,
    reapWallMs,
    survivors,
    status,
    signal,
    stdout: Buffer.concat(stdout).toString('utf8'),
    stderr: Buffer.concat(stderr).toString('utf8'),
    timedOut,
    runnerPid,
    routeReceipt,
    processReceipts,
  };
  evidence.runs.push({
    route,
    host: fixture.host,
    stdoutMode,
    flushTimeoutMs,
    sessionId: fixture.sessionId,
    wallMs: invocation.wallMs,
    reapWallMs: invocation.reapWallMs,
    survivors: invocation.survivors,
    exitMs: invocation.exitedAt - invocation.startedAt,
    status: invocation.status,
    signal: invocation.signal,
    timedOut: invocation.timedOut,
    stdoutBytes: Buffer.byteLength(invocation.stdout),
    stderr: invocation.stderr,
    routeReceipt: invocation.routeReceipt,
    processReceipts: invocation.processReceipts,
    gitRepository: existsSync(join(fixture.cwd, '.git')),
    state: readStateReceipt(fixture),
  });
  return invocation;
}

function statePath(fixture: Fixture): string {
  return join(
    fixture.home,
    '.omc',
    'rules-injector',
    `${fixture.sessionId}.json`,
  );
}

function readState(fixture: Fixture): RulesState {
  const receipt = readStateReceipt(fixture);
  return receipt.status === 'present' ? receipt.value : {};
}

function readStateReceipt(fixture: Fixture): RulesStateReceipt {
  const path = statePath(fixture);
  if (!existsSync(path)) return { status: 'missing' };
  return {
    status: 'present',
    value: JSON.parse(readFileSync(path, 'utf8')) as RulesState,
  };
}

function expectRetryable(fixture: Fixture): void {
  const state = readState(fixture);
  expect(state.injectedHashes ?? []).toHaveLength(0);
  expect(state.injectedRealPaths ?? []).toHaveLength(0);
  expect(state.reservations ?? []).toHaveLength(0);
  expect(readStateReceipt(fixture)).toEqual({ status: 'missing' });
}

function expectedContext(fixture: Fixture): string {
  return `[Rule: ${relative(fixture.cwd, fixture.rulePath)}]\n`
    + '[Match: alwaysApply]\n'
    + fixture.ruleContent;
}

function expectedDeliveryOutput(fixture: Fixture): Record<string, unknown> {
  if (fixture.host === 'copilot') {
    return { additionalContext: expectedContext(fixture) };
  }
  return {
    continue: true,
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: `\n\n${expectedContext(fixture)}`,
    },
  };
}

function expectedDedupOutput(host: Host): Record<string, unknown> {
  return host === 'copilot' ? {} : { continue: true };
}

function expectExactFrame(
  stdout: string,
  expected: Record<string, unknown>,
): void {
  expect(stdout).toBe(`${JSON.stringify(expected)}\n`);
  const frames = stdout.endsWith('\n')
    ? stdout.slice(0, -1).split('\n')
    : [];
  expect(frames).toHaveLength(1);
  expect(JSON.parse(frames[0])).toEqual(expected);
}

async function expectInvocationComplete(
  invocation: Invocation,
  fixture: Fixture,
  expectWriter: boolean,
): Promise<void> {
  expect(invocation.timedOut).toBe(false);
  expect(invocation.status, invocation.stderr).toBe(0);
  expect(invocation.signal).toBeNull();
  expect(invocation.wallMs, invocation.stderr).toBeLessThan(OUTER_TIMEOUT_MS);
  expect(
    invocation.survivors,
    `post-exit PIDs remained live after ${invocation.reapWallMs.toFixed(1)}ms: `
      + invocation.survivors.join(', '),
  ).toEqual([]);
  expect(invocation.reapWallMs, invocation.stderr).toBeLessThan(OUTER_TIMEOUT_MS);
  expect(invocation.routeReceipt?.route).toBe(
    invocation.route === 'worker'
      ? 'worker'
      : process.platform === 'win32'
        ? 'generic-windows-supervisor'
        : 'generic-child',
  );

  const roles = invocation.processReceipts.map(({ role }) => role);
  if (invocation.route === 'worker') {
    expect(roles).toContain('worker-thread');
    expect(roles).not.toContain('generic-supervisor');
    expect(roles).not.toContain('generic-processor');
  } else if (process.platform === 'win32') {
    expect(roles).toContain('generic-supervisor');
    expect(roles).toContain('generic-processor');
  } else {
    expect(roles).toContain('generic-processor');
  }
  if (expectWriter && process.platform === 'win32') {
    expect(roles).toContain('stdout-writer');
  }
  if (process.platform === 'win32') {
    expect(roles).toContain('identity-probe');
  }

  expect(existsSync(fixture.processReceiptDir)).toBe(true);
}

function createAckProbePlugin(root: string): string {
  const scriptsDir = join(root, 'scripts');
  mkdirSync(scriptsDir, { recursive: true });
  mkdirSync(join(root, 'hooks'), { recursive: true });
  mkdirSync(join(root, '.claude-plugin'), { recursive: true });
  writeFileSync(join(scriptsDir, 'run.cjs'), '// trusted runner marker\n');
  const target = join(scriptsDir, 'post-tool-rules-injector.mjs');
  writeFileSync(
    target,
    [
      "import { isMainThread } from 'node:worker_threads';",
      'process.stdin.on("end", () => {',
      '  process.stdout.write(JSON.stringify({',
      `    ack: process.env.${HOST_DELIVERY_ACK_ENV} || null,`,
      `    deadlineAt: Number(process.env.${HOST_DELIVERY_DEADLINE_ENV}) || null,`,
      '    route: isMainThread ? "generic" : "worker",',
      '  }));',
      '});',
      'process.stdin.resume();',
    ].join('\n'),
    'utf8',
  );
  writeFileSync(
    join(root, 'hooks', 'hooks.json'),
    JSON.stringify({
      hooks: {
        PostToolUse: [{
          matcher: '*',
          hooks: [{
            type: 'command',
            command: 'node "$CLAUDE_PLUGIN_ROOT"/scripts/run.cjs "$CLAUDE_PLUGIN_ROOT"/scripts/post-tool-rules-injector.mjs',
            timeout: 3,
          }],
        }],
      },
    }),
    'utf8',
  );
  writeFileSync(join(root, '.claude-plugin', 'plugin.json'), '{}\n', 'utf8');
  writeFileSync(join(root, 'package.json'), '{"type":"module"}\n', 'utf8');
  return target;
}

function runAckProbe(
  target: string,
  pluginRootValue: string | undefined,
  extraArgs: readonly string[] = [],
): {
  status: number | null;
  stderr: string;
  ack: string | null;
  deadlineAt: number | null;
  route: string;
} {
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: 'test' };
  delete env[HOST_DELIVERY_ACK_ENV];
  delete env[HOST_DELIVERY_DEADLINE_ENV];
  delete env.OMC_RUNNER_TEST_FORCE_GENERIC;
  delete env.OMC_RUNNER_TEST_PROCESS_RECEIPT_DIR;
  delete env.OMC_RUNNER_TEST_ROUTE_RECEIPT;
  if (pluginRootValue === undefined) delete env.CLAUDE_PLUGIN_ROOT;
  else env.CLAUDE_PLUGIN_ROOT = pluginRootValue;
  const result = spawnSync(
    process.execPath,
    [RUN_CJS_PATH, target, ...extraArgs],
    {
      encoding: 'utf8',
      env,
      input: '{}',
      timeout: 5_000,
      windowsHide: true,
    },
  );
  const output = JSON.parse(result.stdout || '{}') as {
    ack?: unknown;
    deadlineAt?: unknown;
    route?: unknown;
  };
  if (
    output.ack !== null
    && typeof output.ack !== 'string'
    && output.ack !== undefined
  ) {
    throw new TypeError('ACK probe result is malformed');
  }
  if (typeof output.route !== 'string') {
    throw new TypeError(
      `ACK probe route is malformed: ${result.stderr || result.stdout}`,
    );
  }
  if (
    output.deadlineAt !== null
    && output.deadlineAt !== undefined
    && (
      typeof output.deadlineAt !== 'number'
      || !Number.isSafeInteger(output.deadlineAt)
      || output.deadlineAt <= 0
    )
  ) {
    throw new TypeError('ACK probe deadline is malformed');
  }
  const deadlineAt = typeof output.deadlineAt === 'number'
    ? output.deadlineAt
    : null;
  const receipt = {
    status: result.status,
    stderr: result.stderr || '',
    ack: output.ack ?? null,
    deadlineAt,
    route: output.route,
  };
  evidence.trust.push({
    target,
    pluginRoot: pluginRootValue ?? null,
    extraArgs,
    ...receipt,
  });
  return receipt;
}

describe('run.cjs host-delivery ACK trust boundary', () => {
  it('preserves a canonical install-root alias for the exact registered script', () => {
    const root = mkdtempSync(join(tmpdir(), 'omc-ack-alias-root-'));
    const alias = `${root}-alias`;
    fixtureRoots.push(root, alias);
    createAckProbePlugin(root);
    symlinkSync(root, alias, process.platform === 'win32' ? 'junction' : 'dir');

    const receipt = runAckProbe(
      join(alias, 'scripts', 'post-tool-rules-injector.mjs'),
      alias,
    );
    expect(receipt).toEqual({
      status: 0,
      stderr: '',
      ack: '1',
      deadlineAt: expect.any(Number),
      route: 'worker',
    });
    expect(receipt.deadlineAt).toBeGreaterThan(0);
  });

  it('executes but does not ACK-enable an unselected copied-marker root', () => {
    const root = mkdtempSync(join(tmpdir(), 'omc-ack-copied-root-'));
    fixtureRoots.push(root);
    const target = createAckProbePlugin(root);

    expect(runAckProbe(target, undefined)).toEqual({
      status: 0,
      stderr: '',
      ack: null,
      deadlineAt: null,
      route: 'generic',
    });
  });

  it('executes but does not ACK-enable unsupported extra arguments', () => {
    const root = mkdtempSync(join(tmpdir(), 'omc-ack-extra-argument-'));
    fixtureRoots.push(root);
    const target = createAckProbePlugin(root);

    expect(runAckProbe(target, root, ['unsupported'])).toEqual({
      status: 0,
      stderr: '',
      ack: null,
      deadlineAt: null,
      route: 'generic',
    });
  });

  it('executes but does not ACK-enable a file symlink escaping the trusted root', () => {
    const root = mkdtempSync(join(tmpdir(), 'omc-ack-file-link-root-'));
    const outside = mkdtempSync(join(tmpdir(), 'omc-ack-file-link-outside-'));
    fixtureRoots.push(root, outside);
    const target = createAckProbePlugin(root);
    const outsideTarget = join(outside, 'post-tool-rules-injector.mjs');
    copyFileSync(target, outsideTarget);
    rmSync(target);
    symlinkSync(outsideTarget, target, 'file');

    expect(runAckProbe(target, root)).toEqual({
      status: 0,
      stderr: '',
      ack: null,
      deadlineAt: null,
      route: 'generic',
    });
  });

  it('executes but does not ACK-enable a scripts junction escaping the trusted root', () => {
    const root = mkdtempSync(join(tmpdir(), 'omc-ack-dir-link-root-'));
    const outside = mkdtempSync(join(tmpdir(), 'omc-ack-dir-link-outside-'));
    fixtureRoots.push(root, outside);
    const outsideScripts = join(outside, 'scripts');
    const outsideTarget = createAckProbePlugin(outside);
    mkdirSync(join(root, 'hooks'), { recursive: true });
    mkdirSync(join(root, '.claude-plugin'), { recursive: true });
    copyFileSync(
      join(outside, 'hooks', 'hooks.json'),
      join(root, 'hooks', 'hooks.json'),
    );
    copyFileSync(
      join(outside, '.claude-plugin', 'plugin.json'),
      join(root, '.claude-plugin', 'plugin.json'),
    );
    copyFileSync(join(outside, 'package.json'), join(root, 'package.json'));
    symlinkSync(
      outsideScripts,
      join(root, 'scripts'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );

    expect(runAckProbe(
      join(root, 'scripts', 'post-tool-rules-injector.mjs'),
      root,
    )).toEqual({
      status: 0,
      stderr: '',
      ack: null,
      deadlineAt: null,
      route: 'generic',
    });
    expect(existsSync(outsideTarget)).toBe(true);
  });
});

describe('run.cjs production rules delivery transaction', () => {
  it('uses the shipped 3s manifest, 2.5s runner, and 500ms outer cushion', () => {
    const manifest = JSON.parse(
      readFileSync(join(pluginRoot, 'hooks', 'hooks.json'), 'utf8'),
    ) as {
      hooks: Record<string, Array<{
        hooks?: Array<{ command?: string; timeout?: number }>;
      }>>;
    };
    const hook = manifest.hooks.PostToolUse
      .flatMap(({ hooks = [] }) => hooks)
      .find(({ command = '' }) =>
        command.includes('post-tool-rules-injector.mjs'),
      );
    expect(hook?.timeout).toBe(OUTER_TIMEOUT_MS / 1_000);
    expect(runnerModule.resolveGenericTimeoutMs({
      timeoutMs: OUTER_TIMEOUT_MS,
      event: 'PostToolUse',
    }, process.platform)).toBe(INNER_TIMEOUT_MS);
    expect(OUTER_TIMEOUT_MS - INNER_TIMEOUT_MS).toBe(500);
  });

  it.each(ROUTES)(
    '%s emits one complete native frame, commits once, and deduplicates',
    async (route) => {
      const fixture = makeFixture(
        `${route}-success`,
        `DELIVERY-SUCCESS-${route}`,
        'copilot',
      );

      const first = await invokeWrapped(route, fixture, 'capture', 1_000);
      await expectInvocationComplete(first, fixture, false);
      expect(first.stderr).toBe('');
      expectExactFrame(first.stdout, expectedDeliveryOutput(fixture));
      expect(
        first.stdout.match(new RegExp(`DELIVERY-SUCCESS-${route}`, 'g')),
      ).toHaveLength(1);
      expect(readState(fixture).injectedHashes).toHaveLength(1);
      expect(readState(fixture).injectedRealPaths).toHaveLength(1);
      expect(readState(fixture).reservations ?? []).toHaveLength(0);

      const second = await invokeWrapped(route, fixture, 'capture', 1_000);
      await expectInvocationComplete(second, fixture, false);
      expect(second.stderr).toBe('');
      expectExactFrame(second.stdout, expectedDedupOutput(fixture.host));
      expect(readState(fixture).injectedHashes).toHaveLength(1);
      expect(readState(fixture).injectedRealPaths).toHaveLength(1);
      expect(readState(fixture).reservations ?? []).toHaveLength(0);
    },
    30_000,
  );

  it.each(ROUTES)(
    '%s releases a closed delivery and the next invocation commits',
    async (route) => {
      const marker = `DELIVERY-CLOSED-${route}`;
      const fixture = makeFixture(
        `${route}-closed`,
        `${marker}:${'x'.repeat(128 * 1024)}`,
        'claude',
      );

      const failed = await invokeWrapped(route, fixture, 'closed', 500);
      await expectInvocationComplete(failed, fixture, true);
      expect(failed.stdout).toBe('');
      expect(failed.stderr).toContain('stdout delivery failed');
      expect(failed.stderr).toContain('remain eligible for retry');
      expectRetryable(fixture);

      const retry = await invokeWrapped(route, fixture, 'capture', 1_000);
      await expectInvocationComplete(retry, fixture, true);
      expect(retry.stderr).toBe('');
      expectExactFrame(retry.stdout, expectedDeliveryOutput(fixture));
      expect(readState(fixture).injectedHashes).toHaveLength(1);
      expect(readState(fixture).injectedRealPaths).toHaveLength(1);
      expect(readState(fixture).reservations ?? []).toHaveLength(0);
    },
    30_000,
  );

  it.each(ROUTES)(
    '%s bounds a stalled delivery and the next invocation commits',
    async (route) => {
      const marker = `DELIVERY-STALLED-${route}`;
      const fixture = makeFixture(
        `${route}-stalled`,
        `${marker}:${'y'.repeat(128 * 1024)}`,
        'claude',
      );

      const failed = await invokeWrapped(route, fixture, 'stalled', 150);
      await expectInvocationComplete(failed, fixture, true);
      expect(failed.stdout).toBe('');
      expect(failed.stderr).toContain('stdout delivery failed');
      expect(failed.stderr).toContain('remain eligible for retry');
      expectRetryable(fixture);

      const retry = await invokeWrapped(route, fixture, 'capture', 1_000);
      await expectInvocationComplete(retry, fixture, true);
      expect(retry.stderr).toBe('');
      expectExactFrame(retry.stdout, expectedDeliveryOutput(fixture));
      expect(readState(fixture).injectedHashes).toHaveLength(1);
      expect(readState(fixture).injectedRealPaths).toHaveLength(1);
      expect(readState(fixture).reservations ?? []).toHaveLength(0);
    },
    30_000,
  );
});
