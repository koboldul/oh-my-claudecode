import { execFileSync, spawn } from 'node:child_process';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
} from 'vitest';
import { sessionEndJobPath } from '../hooks/session-end/cleanup-manifest.js';

const REPO_ROOT = process.cwd();
const requireFromTest = createRequire(import.meta.url);
const RUNNER_ADMISSION_CEILING_MS = 500;
// Host launch is outside the latency contract; this is only a hang watchdog.
const HOST_PROCESS_WATCHDOG_MS = 10_000;
const TIMING_RUNS = 5;
const SEQUENTIAL_GATE_CALLS = 50;
const TEST_PRODUCER_GRACE_MS = '25';
const DETACHED_WORKER_CEILING_MS = 65_000;
const RESIDENT_START_TIMEOUT_MS = 5_000;

interface ExitResult {
  elapsedMs: number;
  code: number | null;
  signal: NodeJS.Signals | null;
  stderr: string;
  stdout: string;
  timedOut: boolean;
}

interface SessionEndTiming {
  acknowledged?: boolean;
  ackMs?: number;
  code: string;
  connectMs?: number;
  contextMs?: number;
  fastPathMs?: number;
  processCreations: number;
  publishMs?: number;
  runnerDurationMs: number;
  totalMs?: number;
  controlMs?: number;
}

interface WorkerTracking {
  completionFile: string;
  pidFile: string;
  rawReceipt: string;
  spoolReceipt: string;
  env: NodeJS.ProcessEnv;
}

let stagedCleanupRoot: string;
let stagedPluginRoot: string;
let stagedSessionEnd: string;
let timingPluginRoot: string;
let timingSessionEnd: string;
let timingWikiSessionEnd: string;
let residentRuntimeRoot: string;
const workerPidFiles = new Set<string>();

function writeModule(path: string, source: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, source, 'utf8');
}

function emitSessionEndClosure(outDir: string): void {
  const configPath = join(REPO_ROOT, 'tsconfig.json');
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error) {
    throw new Error(ts.formatDiagnostic(config.error, {
      getCanonicalFileName: fileName => fileName,
      getCurrentDirectory: () => REPO_ROOT,
      getNewLine: () => '\n',
    }));
  }
  const parsed = ts.parseJsonConfigFileContent(
    config.config,
    ts.sys,
    REPO_ROOT,
    {
      declaration: false,
      declarationMap: false,
      noEmit: false,
      outDir,
      rootDir: join(REPO_ROOT, 'src'),
      sourceMap: false,
    },
    configPath,
  );
  const sessionEndRoot = join(REPO_ROOT, 'src', 'hooks', 'session-end');
  const program = ts.createProgram({
    rootNames: [
      join(sessionEndRoot, 'index.ts'),
      join(sessionEndRoot, 'worker.ts'),
      join(sessionEndRoot, 'action-runner.ts'),
    ],
    options: parsed.options,
  });
  const diagnostics = ts
    .getPreEmitDiagnostics(program)
    .filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error);
  const emit = program.emit();
  diagnostics.push(
    ...emit.diagnostics.filter(
      diagnostic => diagnostic.category === ts.DiagnosticCategory.Error,
    ),
  );
  if (diagnostics.length > 0 || emit.emitSkipped) {
    throw new Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: fileName => fileName,
      getCurrentDirectory: () => REPO_ROOT,
      getNewLine: () => '\n',
    }));
  }

  const processUtilsPath = join(outDir, 'platform', 'process-utils.js');
  const processUtils = readFileSync(processUtilsPath, 'utf8');
  const patched = processUtils.replace(
    /export function getProcessStartIdentitySync\(pid\) \{\r?\n/,
    "export function getProcessStartIdentitySync(pid) {\n    return `session-end-test:${pid}`;\n",
  );
  if (patched === processUtils) {
    throw new Error('fresh SessionEnd closure did not expose process identity');
  }
  writeFileSync(processUtilsPath, patched, 'utf8');
}

beforeAll(() => {
  stagedCleanupRoot = mkdtempSync(join(tmpdir(), 'omc-session-end-staged-'));
  stagedPluginRoot = join(stagedCleanupRoot, 'plugin');
  const scriptsDir = join(stagedPluginRoot, 'scripts');
  mkdirSync(scriptsDir, { recursive: true });
  cpSync(join(REPO_ROOT, 'scripts', 'lib'), join(scriptsDir, 'lib'), {
    recursive: true,
  });
  for (const filename of [
    'run.cjs',
    'session-end.mjs',
    'session-end-resident.mjs',
    'wiki-session-end.mjs',
  ]) {
    copyFileSync(
      join(REPO_ROOT, 'scripts', filename),
      join(scriptsDir, filename),
    );
  }
  mkdirSync(join(stagedPluginRoot, 'hooks'), { recursive: true });
  copyFileSync(
    join(REPO_ROOT, 'hooks', 'hooks.json'),
    join(stagedPluginRoot, 'hooks', 'hooks.json'),
  );
  mkdirSync(join(stagedPluginRoot, '.claude-plugin'), { recursive: true });
  writeModule(
    join(stagedPluginRoot, 'package.json'),
    JSON.stringify({ type: 'module' }),
  );
  writeModule(
    join(stagedPluginRoot, '.claude-plugin', 'plugin.json'),
    '{}',
  );
  symlinkSync(
    join(REPO_ROOT, 'node_modules'),
    join(stagedPluginRoot, 'node_modules'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );

  const runtimePath = join(stagedPluginRoot, 'bridge', 'hook-runtime.cjs');
  execFileSync(
    process.execPath,
    [
      join(REPO_ROOT, 'scripts', 'build-hook-runtime.mjs'),
      '--outfile',
      runtimePath,
    ],
    {
      cwd: REPO_ROOT,
      stdio: 'pipe',
      windowsHide: true,
    },
  );
  emitSessionEndClosure(join(stagedPluginRoot, 'dist'));
  for (const filename of ['index.js', 'worker.js', 'action-runner.js']) {
    if (!existsSync(join(stagedPluginRoot, 'dist', 'hooks', 'session-end', filename))) {
      throw new Error(`fresh SessionEnd closure did not emit ${filename}`);
    }
  }
  stagedSessionEnd = join(scriptsDir, 'session-end.mjs');
  timingPluginRoot = stagedPluginRoot;
  timingSessionEnd = join(timingPluginRoot, 'scripts', 'session-end.mjs');
  timingWikiSessionEnd = join(timingPluginRoot, 'scripts', 'wiki-session-end.mjs');
  residentRuntimeRoot = join(stagedCleanupRoot, 'resident-runtime');
}, 60_000);

afterAll(() => {
  rmSync(stagedCleanupRoot, { recursive: true, force: true });
});

function runUntilClose(
  script: string,
  cwd: string,
  input: string | undefined,
  ceilingMs = HOST_PROCESS_WATCHDOG_MS,
  extraEnv: NodeJS.ProcessEnv = {},
  pluginRoot = stagedPluginRoot,
): Promise<ExitResult> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const home = join(cwd, '.home');
    const configDir = join(cwd, '.claude');
    mkdirSync(home, { recursive: true });
    mkdirSync(configDir, { recursive: true });
    const child = spawn(
      process.execPath,
      [join(pluginRoot, 'scripts', 'run.cjs'), script],
      {
      cwd,
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        CLAUDE_CONFIG_DIR: configDir,
        CLAUDE_PLUGIN_ROOT: pluginRoot,
        OMC_CONFIG_PATH: '',
        OMC_HOST: 'claude',
        OMC_STATE_DIR: '',
        ...extraEnv,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      },
    );
    const stderr: Buffer[] = [];
    const stdout: Buffer[] = [];
    child.stderr.on('data', chunk => stderr.push(Buffer.from(chunk)));
    child.stdout.on('data', chunk => stdout.push(Buffer.from(chunk)));
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, ceilingMs);

    child.once('close', (code, signal) => {
      clearTimeout(timer);
      resolve({
        elapsedMs: Date.now() - startedAt,
        code,
        signal,
        stderr: Buffer.concat(stderr).toString('utf8'),
        stdout: Buffer.concat(stdout).toString('utf8'),
        timedOut,
      });
    });

    if (input !== undefined) child.stdin.end(input);
  });
}

function expectPromptExit(
  result: ExitResult,
  output = '{"continue":true}\n',
  diagnostic?: string,
): void {
  expect(result.timedOut, diagnostic).toBe(false);
  expect(result.signal).toBeNull();
  expect(result.code).toBe(0);
  expect(result.stderr).toBe('');
  expect(result.stdout).toBe(output);
}

function readSessionEndTiming(path: string): SessionEndTiming {
  return JSON.parse(readFileSync(path, 'utf8')) as SessionEndTiming;
}

function expectRunnerAdmissionDuration(
  timing: SessionEndTiming,
  diagnostic?: string,
): void {
  expect(Number.isFinite(timing.runnerDurationMs), diagnostic).toBe(true);
  expect(timing.runnerDurationMs, diagnostic).toBeGreaterThanOrEqual(0);
  expect(timing.runnerDurationMs, diagnostic)
    .toBeLessThanOrEqual(RUNNER_ADMISSION_CEILING_MS);
}

function reportTimingSummary(
  label: string,
  samples: ReadonlyArray<{
    hostElapsedMs: number;
    runnerDurationMs: number;
  }>,
): void {
  if (
    process.env.OMC_SESSION_END_TEST_REPORT_TIMINGS !== '1'
    || samples.length === 0
  ) {
    return;
  }
  const runner = samples.map(sample => sample.runnerDurationMs);
  const host = samples.map(sample => sample.hostElapsedMs);
  const average = runner.reduce((sum, value) => sum + value, 0) / runner.length;
  process.stdout.write(
    `[session-end-timing] ${label} calls=${samples.length} `
    + `runner-ms min=${Math.min(...runner).toFixed(2)} `
    + `avg=${average.toFixed(2)} max=${Math.max(...runner).toFixed(2)} `
    + `host-ms max=${Math.max(...host)}\n`,
  );
}

function validSessionEndInput(cwd: string, sessionId: string): string {
  return JSON.stringify({
    session_id: sessionId,
    transcript_path: join(cwd, 'transcript.jsonl'),
    cwd,
    permission_mode: 'default',
    hook_event_name: 'SessionEnd',
    reason: 'clear',
  });
}

function configureDeferredAdapters(
  cwd: string,
  callbackPath = join(cwd, 'callback-{session_id}.md'),
): void {
  const configDir = join(cwd, '.claude');
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, '.omc-config.json'), JSON.stringify({
    notifications: { enabled: true },
    stopHookCallbacks: {
      file: {
        enabled: true,
        path: callbackPath,
        format: 'markdown',
      },
    },
  }));
}

async function readJsonEventually<T>(
  path: string,
  ceilingMs = DETACHED_WORKER_CEILING_MS,
): Promise<T> {
  const deadline = Date.now() + ceilingMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      return JSON.parse(readFileSync(path, 'utf8')) as T;
    } catch (error) {
      lastError = error;
      await new Promise<void>(resolve => setTimeout(resolve, 10));
    }
  }
  throw lastError;
}

async function readTextEventually(
  path: string,
  ceilingMs = DETACHED_WORKER_CEILING_MS,
): Promise<string> {
  const deadline = Date.now() + ceilingMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      return readFileSync(path, 'utf8');
    } catch (error) {
      lastError = error;
      await new Promise<void>(resolve => setTimeout(resolve, 10));
    }
  }
  throw lastError;
}

async function readBufferEventually(
  path: string,
  ceilingMs = DETACHED_WORKER_CEILING_MS,
): Promise<Buffer> {
  const deadline = Date.now() + ceilingMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      return readFileSync(path);
    } catch (error) {
      lastError = error;
      await new Promise<void>(resolve => setTimeout(resolve, 10));
    }
  }
  throw lastError;
}

async function waitForTerminalManifest(
  cwd: string,
  sessionId: string,
): Promise<{
  actions: Record<string, { phase: string; status: string }>;
  owner: unknown;
  phase: string;
}> {
  const manifestPath = sessionEndJobPath(cwd, sessionId);
  const deadline = Date.now() + DETACHED_WORKER_CEILING_MS;
  while (Date.now() < deadline) {
    if (existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
          actions: Record<string, { phase: string; status: string }>;
          owner: unknown;
          phase: string;
        };
        if (manifest.phase === 'complete' && manifest.owner === null) {
          return manifest;
        }
      } catch {
        // The worker may be between atomic manifest replacements.
      }
    }
    await new Promise<void>(resolve => setTimeout(resolve, 10));
  }
  throw new Error(`detached SessionEnd job ${sessionId} did not complete`);
}

async function waitForTerminalCallback(
  cwd: string,
  sessionId: string,
  callbackPath: string,
): Promise<void> {
  const manifestPath = sessionEndJobPath(cwd, sessionId);
  const deadline = Date.now() + DETACHED_WORKER_CEILING_MS;
  let lastManifest: unknown = null;
  while (Date.now() < deadline) {
    if (existsSync(manifestPath)) {
      try {
        lastManifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
        const manifest = lastManifest as {
          actions?: Record<string, { status?: string }>;
          owner?: unknown;
          phase?: string;
        };
        if (
          existsSync(callbackPath)
          && manifest.phase === 'complete'
          && manifest.owner === null
          && manifest.actions?.callback?.status === 'completed'
        ) {
          return;
        }
      } catch {
        // The worker may be between atomic manifest replacements.
      }
    }
    await new Promise<void>(resolve => setTimeout(resolve, 10));
  }
  throw new Error(
    `detached SessionEnd worker did not complete its callback; last manifest: ${JSON.stringify(lastManifest)}`,
  );
}

async function waitForDeath(pid: number): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') return;
      throw error;
    }
    await new Promise<void>(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`SessionEnd envelope worker ${pid} survived completion`);
}

function workerTracking(cwd: string, label: string): WorkerTracking {
  const receiptDir = join(cwd, 'worker-receipts', label);
  mkdirSync(receiptDir, { recursive: true });
  const completionFile = join(receiptDir, 'completion.json');
  const pidFile = join(receiptDir, 'worker.pid');
  const rawReceipt = join(receiptDir, 'raw.json');
  const spoolReceipt = join(receiptDir, 'spool-path.txt');
  workerPidFiles.add(pidFile);
  return {
    completionFile,
    pidFile,
    rawReceipt,
    spoolReceipt,
    env: {
      NODE_ENV: 'test',
      OMC_SESSION_END_TEST_PRODUCER_GRACE_MS: TEST_PRODUCER_GRACE_MS,
      OMC_SESSION_END_TEST_WORKER_COMPLETION_FILE: completionFile,
      OMC_SESSION_END_TEST_WORKER_PID_FILE: pidFile,
      OMC_SESSION_END_TEST_RAW_RECEIPT: rawReceipt,
      OMC_SESSION_END_TEST_SPOOL_RECEIPT: spoolReceipt,
    },
  };
}

describe('SessionEnd run.cjs runner/admission latency and detached completion', () => {
  const tempDirs: string[] = [];
  const workerPids = new Set<number>();

  afterEach(() => {
    for (const pidFile of workerPidFiles) {
      if (!existsSync(pidFile)) continue;
      const pid = Number(readFileSync(pidFile, 'utf8'));
      if (!Number.isInteger(pid) || pid <= 0) continue;
      try { process.kill(pid, 'SIGKILL'); } catch { /* already dead */ }
    }
    workerPidFiles.clear();
    for (const pid of workerPids) {
      try { process.kill(pid, 'SIGKILL'); } catch { /* already dead */ }
    }
    workerPids.clear();
    for (const directory of tempDirs.splice(0)) {
      try {
        rmSync(directory, {
          recursive: true,
          force: true,
          maxRetries: 40,
          retryDelay: 25,
        });
      } catch {
        // A failing assertion may interrupt before a detached action worker
        // reaches its terminal receipt; successful tests clean synchronously.
      }
    }
  });

  function createProject(label = 'project'): string {
    const cwd = mkdtempSync(join(tmpdir(), `omc-session-end-${label}-`));
    tempDirs.push(cwd);
    mkdirSync(join(cwd, '.git'));
    writeFileSync(join(cwd, 'transcript.jsonl'), '');
    return cwd;
  }

  function residentEnvironment(
    extra: NodeJS.ProcessEnv = {},
  ): NodeJS.ProcessEnv {
    return {
      NODE_ENV: 'test',
      OMC_SESSION_END_RESIDENT_TEST_ENABLE: '1',
      OMC_SESSION_END_TEST_PRODUCER_GRACE_MS: TEST_PRODUCER_GRACE_MS,
      OMC_SESSION_END_TEST_KEEP_RESIDENT_MS: '120000',
      LOCALAPPDATA: residentRuntimeRoot,
      TMPDIR: residentRuntimeRoot,
      TMP: residentRuntimeRoot,
      TEMP: residentRuntimeRoot,
      ...extra,
    };
  }

  async function ensureResident(
    cwd: string,
    sessionId: string,
    extra: NodeJS.ProcessEnv = {},
    pluginRoot = stagedPluginRoot,
  ): Promise<NodeJS.ProcessEnv> {
    const { ensureSessionEndResident } = await import(
      pathToFileURL(
        join(pluginRoot, 'scripts', 'lib', 'session-end-resident-control.mjs'),
      ).href
    );
    const env = residentEnvironment(extra);
    const result = await ensureSessionEndResident({
      pluginRoot,
      directory: cwd,
      sessionId,
      timeoutMs: RESIDENT_START_TIMEOUT_MS,
      env: { ...process.env, ...env },
    });
    expect(result.status).toBe('ready');
    const pid = result.control?.pid;
    expect(Number.isInteger(pid) && pid > 0).toBe(true);
    workerPids.add(pid as number);
    return env;
  }

  it.each([
    ['session-end', () => timingSessionEnd],
    ['wiki-session-end', () => timingWikiSessionEnd],
  ] as const)(
    '%s reports <=500ms runner duration on every cold empty open-stdin run',
    async (name, script) => {
      const samples: Array<{
        hostElapsedMs: number;
        runnerDurationMs: number;
      }> = [];
      for (let index = 0; index < TIMING_RUNS; index += 1) {
        const cwd = createProject(`empty-${name}-${index}`);
        const receipt = join(cwd, 'runner-timing.json');
        const result = await runUntilClose(
          script(),
          cwd,
          undefined,
          HOST_PROCESS_WATCHDOG_MS,
          {
            NODE_ENV: 'test',
            OMC_SESSION_END_TEST_IPC_RECEIPT: receipt,
          },
          timingPluginRoot,
        );
        expectPromptExit(
          result,
          '{"continue":true,"suppressOutput":true}\n',
        );
        const timing = readSessionEndTiming(receipt);
        const diagnostic = JSON.stringify({
          index,
          hostElapsedMs: result.elapsedMs,
          timing,
        });
        expect(timing.code, diagnostic).toBe('input-timeout');
        expectRunnerAdmissionDuration(timing, diagnostic);
        samples.push({
          hostElapsedMs: result.elapsedMs,
          runnerDurationMs: timing.runnerDurationMs,
        });
      }
      reportTimingSummary(`${name} cold-empty`, samples);
    },
    15_000,
  );

  it.each([
    ['session-end', () => timingSessionEnd],
    ['wiki-session-end', () => timingWikiSessionEnd],
  ] as const)(
    '%s reports <=500ms runner/admission duration on every repeated configured run',
    async (name, script) => {
      const cwd = createProject(`configured-${name}`);
      configureDeferredAdapters(cwd);
      const sessionId = `configured-${name}`;
      const residentEnv = await ensureResident(
        cwd,
        sessionId,
        {},
        timingPluginRoot,
      );
      const tracking = workerTracking(cwd, name);
      const samples: Array<{
        hostElapsedMs: number;
        runnerDurationMs: number;
      }> = [];
      for (let index = 0; index < TIMING_RUNS; index += 1) {
        const raw = validSessionEndInput(cwd, sessionId);
        const receipt = join(cwd, `runner-timing-${index}.json`);
        const result = await runUntilClose(
          script(),
          cwd,
          raw,
          HOST_PROCESS_WATCHDOG_MS,
          {
            ...residentEnv,
            ...tracking.env,
            OMC_SESSION_END_TEST_IPC_RECEIPT: receipt,
          },
          timingPluginRoot,
        );
        expectPromptExit(result);
        const timing = readSessionEndTiming(receipt);
        const diagnostic = JSON.stringify({
          index,
          hostElapsedMs: result.elapsedMs,
          timing,
        });
        expect(timing.acknowledged, diagnostic).toBe(true);
        expectRunnerAdmissionDuration(timing, diagnostic);
        samples.push({
          hostElapsedMs: result.elapsedMs,
          runnerDurationMs: timing.runnerDurationMs,
        });
      }
      reportTimingSummary(`${name} repeated-configured`, samples);
      const pid = Number(await readTextEventually(tracking.pidFile));
      expect(await readJsonEventually(tracking.completionFile)).toMatchObject({
        pid,
        status: 'completed',
      });
      expect(await readBufferEventually(tracking.rawReceipt)).toEqual(
        Buffer.from(validSessionEndInput(cwd, sessionId)),
      );
      expect(existsSync(await readTextEventually(tracking.spoolReceipt))).toBe(false);
    },
    30_000,
  );

  it('completes callbacks through a USERNA~1 path and consumes the resident spool', async () => {
    const cwd = createProject('callback-short-path');
    const callbackPath = join(cwd, 'USERNA~1', 'callback.md');
    configureDeferredAdapters(cwd, callbackPath);
    const sessionId = 'detached-callback-short-path';
    const raw = ` \n${validSessionEndInput(cwd, sessionId)}\n`;
    const core = workerTracking(cwd, 'core');
    const residentEnv = await ensureResident(cwd, sessionId);

    expectPromptExit(await runUntilClose(
      stagedSessionEnd,
      cwd,
      raw,
      HOST_PROCESS_WATCHDOG_MS,
      { ...residentEnv, ...core.env },
    ));
    expect(await readBufferEventually(core.rawReceipt)).toEqual(Buffer.from(raw));
    expect(existsSync(await readTextEventually(core.spoolReceipt))).toBe(false);

    const pid = Number(await readTextEventually(core.pidFile));
    workerPids.add(pid);
    const completion = await readJsonEventually<{
      pid: number;
      status: string;
      eventId: string;
    }>(core.completionFile);
    expect(completion).toMatchObject({ pid, status: 'completed' });
    expect(existsSync(await readTextEventually(core.spoolReceipt))).toBe(false);

    await waitForTerminalCallback(cwd, sessionId, callbackPath);
    const manifest = await waitForTerminalManifest(cwd, sessionId);
    expect(manifest.actions['foreground-cleanup'].status).toBe('completed');
    expect(manifest.actions.callback.status).toBe('completed');
    expect(manifest.actions.notification.phase).toBe('deferred-best-effort');
    expect(manifest).toMatchObject({ phase: 'complete', owner: null });
    expect(readFileSync(callbackPath, 'utf8')).toContain(sessionId);
  }, 75_000);

  it('keeps the resident alive through producer grace and reaches terminal completion', async () => {
    const cwd = createProject('producer-grace');
    const callbackPath = join(cwd, 'callback.md');
    const sessionId = 'detached-worker-producer-grace';
    configureDeferredAdapters(cwd, callbackPath);
    const residentEnv = await ensureResident(cwd, sessionId);

    expectPromptExit(await runUntilClose(
      stagedSessionEnd,
      cwd,
      validSessionEndInput(cwd, sessionId),
      HOST_PROCESS_WATCHDOG_MS,
      {
        ...residentEnv,
      },
    ));

    await waitForTerminalCallback(cwd, sessionId, callbackPath);
  }, 75_000);

  it('keeps configured callbacks, proxies, and custom CA out of the foreground process', async () => {
    const cwd = createProject('network-routing');
    configureDeferredAdapters(cwd);
    const caPath = join(cwd, 'test-ca.pem');
    const sessionId = 'configured-network-routing';
    const tracking = workerTracking(cwd, 'network-routing');
    writeFileSync(caPath, 'not a certificate');
    const residentEnv = await ensureResident(cwd, sessionId);

    const result = await runUntilClose(
      timingSessionEnd,
      cwd,
      validSessionEndInput(cwd, sessionId),
      HOST_PROCESS_WATCHDOG_MS,
      {
        ...residentEnv,
        ...tracking.env,
        HTTPS_PROXY: 'http://127.0.0.1:9',
        HTTP_PROXY: 'http://127.0.0.1:9',
        NODE_EXTRA_CA_CERTS: caPath,
      },
      timingPluginRoot,
    );
    expectPromptExit(result);
    const pid = Number(await readTextEventually(tracking.pidFile));
    workerPids.add(pid);
    expect(await readJsonEventually(tracking.completionFile)).toMatchObject({
      pid,
      status: 'completed',
    });
    expect(existsSync(await readTextEventually(tracking.spoolReceipt))).toBe(false);
  }, 75_000);

  it('restores a resident environment value before processing the next admission', async () => {
    const originalRequestsCaBundle = process.env.REQUESTS_CA_BUNDLE;
    delete process.env.REQUESTS_CA_BUNDLE;
    const cwd = createProject('request-env-restore');
    const sessionId = 'request-env-restore';
    const firstActiveReceipt = join(cwd, 'active-env-first.json');
    const firstRestoredReceipt = join(cwd, 'restored-env-first.json');
    const secondActiveReceipt = join(cwd, 'active-env-second.json');
    const secondRestoredReceipt = join(cwd, 'restored-env-second.json');

    try {
      const residentEnv = await ensureResident(cwd, sessionId, {
        REQUESTS_CA_BUNDLE: 'resident-default.pem',
      });

      expectPromptExit(await runUntilClose(
        timingSessionEnd,
        cwd,
        validSessionEndInput(cwd, sessionId),
        HOST_PROCESS_WATCHDOG_MS,
        {
          ...residentEnv,
          REQUESTS_CA_BUNDLE: 'request-one.pem',
          OMC_SESSION_END_TEST_ENV_RECEIPT: firstActiveReceipt,
          OMC_SESSION_END_TEST_ENV_RESTORE_RECEIPT: firstRestoredReceipt,
        },
        timingPluginRoot,
      ));
      expect(await readJsonEventually(firstActiveReceipt)).toEqual({
        hasRequestsCaBundle: true,
        requestsCaBundle: 'request-one.pem',
      });
      expect(await readJsonEventually(firstRestoredReceipt)).toEqual({
        hasRequestsCaBundle: true,
        requestsCaBundle: 'resident-default.pem',
      });

      const nextRaw = JSON.stringify({
        ...JSON.parse(validSessionEndInput(cwd, sessionId)),
        reason: 'other',
      });
      const nextEnv: NodeJS.ProcessEnv = {
        ...residentEnv,
        OMC_SESSION_END_TEST_ENV_RECEIPT: secondActiveReceipt,
        OMC_SESSION_END_TEST_ENV_RESTORE_RECEIPT: secondRestoredReceipt,
      };
      delete nextEnv.REQUESTS_CA_BUNDLE;
      expectPromptExit(await runUntilClose(
        timingSessionEnd,
        cwd,
        nextRaw,
        HOST_PROCESS_WATCHDOG_MS,
        nextEnv,
        timingPluginRoot,
      ));
      expect(await readJsonEventually(secondActiveReceipt)).toEqual({
        hasRequestsCaBundle: true,
        requestsCaBundle: 'resident-default.pem',
      });
      expect(await readJsonEventually(secondRestoredReceipt)).toEqual({
        hasRequestsCaBundle: true,
        requestsCaBundle: 'resident-default.pem',
      });
    } finally {
      if (originalRequestsCaBundle === undefined) {
        delete process.env.REQUESTS_CA_BUNDLE;
      } else {
        process.env.REQUESTS_CA_BUNDLE = originalRequestsCaBundle;
      }
    }
  }, 75_000);

  it('lets wiki-session-end return without waiting for a live wiki lock', async () => {
    const cwd = createProject('wiki-lock');
    configureDeferredAdapters(cwd);
    const wikiDir = join(cwd, '.omc', 'wiki');
    const sessionId = 'wiki-live-lock';
    const tracking = workerTracking(cwd, 'wiki-lock');
    mkdirSync(wikiDir, { recursive: true });
    writeFileSync(
      join(cwd, '.omc', '.omc-config.json'),
      JSON.stringify({ wiki: { autoCapture: true } }),
    );
    writeFileSync(
      join(wikiDir, '.wiki-lock.lock'),
      JSON.stringify({ pid: process.pid, timestamp: Date.now() }),
    );
    const residentEnv = await ensureResident(cwd, sessionId);

    expectPromptExit(await runUntilClose(
      timingWikiSessionEnd,
      cwd,
      validSessionEndInput(cwd, sessionId),
      HOST_PROCESS_WATCHDOG_MS,
      { ...residentEnv, ...tracking.env },
      timingPluginRoot,
    ));
    const pid = Number(await readTextEventually(tracking.pidFile));
    workerPids.add(pid);
    expect(await readJsonEventually(tracking.completionFile)).toMatchObject({
      pid,
      status: 'completed',
    });
  }, 75_000);

  it('recovers a durable no-resident spool on the next resident start', async () => {
    const cwd = createProject('no-resident-recovery');
    const sessionId = 'no-resident-recovery';
    const tracking = workerTracking(cwd, 'recovery');
    const env = residentEnvironment(tracking.env);

    expectPromptExit(await runUntilClose(
      stagedSessionEnd,
      cwd,
      validSessionEndInput(cwd, sessionId),
      HOST_PROCESS_WATCHDOG_MS,
      env,
    ));
    const spoolPath = await readTextEventually(tracking.spoolReceipt);
    expect(existsSync(spoolPath)).toBe(true);
    expect(existsSync(sessionEndJobPath(cwd, sessionId))).toBe(false);

    await ensureResident(cwd, 'next-session-recovery', {
      OMC_SESSION_END_TEST_KEEP_RESIDENT_MS: '0',
    });
    await waitForTerminalManifest(cwd, sessionId);
    expect(existsSync(spoolPath)).toBe(false);
  }, 75_000);

  it('serializes concurrent core/wiki admission in one resident', async () => {
    const cwd = createProject('concurrent-producers');
    const sessionId = 'concurrent-resident-producers';
    const env = await ensureResident(cwd, sessionId, {
      OMC_SESSION_END_TEST_PRODUCER_GRACE_MS: '30000',
    });
    const raw = validSessionEndInput(cwd, sessionId);
    const coreReceipt = join(cwd, 'core-runner-timing.json');
    const wikiReceipt = join(cwd, 'wiki-runner-timing.json');

    const [core, wiki] = await Promise.all([
      runUntilClose(
        stagedSessionEnd,
        cwd,
        raw,
        HOST_PROCESS_WATCHDOG_MS,
        { ...env, OMC_SESSION_END_TEST_IPC_RECEIPT: coreReceipt },
      ),
      runUntilClose(
        timingWikiSessionEnd,
        cwd,
        raw,
        HOST_PROCESS_WATCHDOG_MS,
        { ...env, OMC_SESSION_END_TEST_IPC_RECEIPT: wikiReceipt },
      ),
    ]);
    expectPromptExit(core);
    expectPromptExit(wiki);
    const coreTiming = readSessionEndTiming(coreReceipt);
    const wikiTiming = readSessionEndTiming(wikiReceipt);
    expect(coreTiming.acknowledged).toBe(true);
    expect(wikiTiming.acknowledged).toBe(true);
    expectRunnerAdmissionDuration(
      coreTiming,
      JSON.stringify({ hostElapsedMs: core.elapsedMs, timing: coreTiming }),
    );
    expectRunnerAdmissionDuration(
      wikiTiming,
      JSON.stringify({ hostElapsedMs: wiki.elapsedMs, timing: wikiTiming }),
    );
    reportTimingSummary('concurrent core/wiki', [
      {
        hostElapsedMs: core.elapsedMs,
        runnerDurationMs: coreTiming.runnerDurationMs,
      },
      {
        hostElapsedMs: wiki.elapsedMs,
        runnerDurationMs: wikiTiming.runnerDurationMs,
      },
    ]);

    const manifest = await waitForTerminalManifest(cwd, sessionId) as {
      producers?: Record<string, {
        eventId?: string;
        rawDigest?: string;
        sealedBy?: string;
        state?: string;
      }>;
    };
    expect(manifest.producers?.core).toMatchObject({
      state: 'sealed',
      sealedBy: 'foreground',
      eventId: expect.stringMatching(/^[a-f0-9]{64}$/),
      rawDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(manifest.producers?.wiki).toMatchObject({
      state: 'no-op',
      sealedBy: 'wiki-producer',
      eventId: expect.stringMatching(/^[a-f0-9]{64}$/),
      rawDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  }, 75_000);

  it('authenticates both directions and rejects replay, bad MAC, stale gates, and traversal', async () => {
    const cwd = createProject('ipc-security');
    const sessionId = 'ipc-security';
    const env = await ensureResident(cwd, sessionId);
    const ipc = requireFromTest(
      join(stagedPluginRoot, 'scripts', 'lib', 'session-end-ipc.cjs'),
    ) as {
      buildSignedRequest(
        control: Record<string, unknown>,
        context: Record<string, string>,
        published: Record<string, unknown>,
        env: NodeJS.ProcessEnv,
      ): Record<string, unknown>;
      exchange(
        control: Record<string, unknown>,
        request: Record<string, unknown>,
      ): Promise<{ acknowledged: boolean; code: string }>;
      publishSessionEndFrame(
        context: Record<string, string>,
        input: {
          producer: 'core' | 'wiki';
          raw: Buffer;
          host: 'claude' | 'copilot';
          env: NodeJS.ProcessEnv;
        },
      ): Record<string, unknown>;
      readControl(context: Record<string, string>): Record<string, unknown> | null;
      resolveResidentContext(input: {
        pluginRoot: string;
        directory: string;
        sessionId: string;
        env: NodeJS.ProcessEnv;
      }): Record<string, string>;
      signObject(token: string, request: Record<string, unknown>): string;
    };
    const fullEnv = { ...process.env, ...env };
    const context = ipc.resolveResidentContext({
      pluginRoot: stagedPluginRoot,
      directory: cwd,
      sessionId,
      env: fullEnv,
    });
    const control = ipc.readControl(context);
    expect(control).not.toBeNull();
    const publish = (suffix: string) => ipc.publishSessionEndFrame(context, {
      producer: 'core',
      raw: Buffer.from(validSessionEndInput(cwd, `${sessionId}${suffix}`)),
      host: 'claude',
      env: fullEnv,
    });

    const firstPublished = publish('');
    const firstRequest = ipc.buildSignedRequest(
      control!,
      context,
      firstPublished,
      fullEnv,
    );
    expect((await ipc.exchange(control!, firstRequest)).acknowledged).toBe(true);
    expect((await ipc.exchange(control!, firstRequest)).acknowledged).toBe(false);

    const badMacRequest = ipc.buildSignedRequest(
      control!,
      context,
      publish('-bad-mac'),
      fullEnv,
    );
    badMacRequest.mac = '00'.repeat(32);
    expect((await ipc.exchange(control!, badMacRequest)).acknowledged).toBe(false);

    const staleRequest = ipc.buildSignedRequest(
      control!,
      context,
      publish('-stale'),
      fullEnv,
    );
    staleRequest.timestamp = Date.now() - 60_000;
    staleRequest.mac = ipc.signObject(control!.token as string, staleRequest);
    expect((await ipc.exchange(control!, staleRequest)).acknowledged).toBe(false);

    const traversalRequest = ipc.buildSignedRequest(
      control!,
      context,
      publish('-traversal'),
      fullEnv,
    );
    traversalRequest.spool = '../foreign.frame';
    traversalRequest.mac = ipc.signObject(
      control!.token as string,
      traversalRequest,
    );
    expect((await ipc.exchange(control!, traversalRequest)).acknowledged).toBe(false);
  }, 75_000);

  it('recovers a crash after durable claim even when the ACK is lost', async () => {
    const cwd = createProject('lost-ack-crash');
    const sessionId = 'lost-ack-crash';
    const tracking = workerTracking(cwd, 'lost-ack');
    const firstEnv = await ensureResident(cwd, sessionId);
    const ipcReceipt = join(cwd, 'lost-ack-ipc.json');

    expectPromptExit(await runUntilClose(
      stagedSessionEnd,
      cwd,
      validSessionEndInput(cwd, sessionId),
      HOST_PROCESS_WATCHDOG_MS,
      {
        ...firstEnv,
        ...tracking.env,
        OMC_SESSION_END_TEST_CRASH_AFTER_CLAIM: 'before-ack',
        OMC_SESSION_END_TEST_IPC_RECEIPT: ipcReceipt,
      },
    ));
    const firstControlPid = [...workerPids].at(-1)!;
    await waitForDeath(firstControlPid);
    const ipcResult = JSON.parse(readFileSync(ipcReceipt, 'utf8')) as {
      acknowledged: boolean;
    };
    expect(ipcResult.acknowledged).toBe(false);
    const spoolPath = await readTextEventually(tracking.spoolReceipt);

    await ensureResident(cwd, sessionId);
    await waitForTerminalManifest(cwd, sessionId);
    expect(existsSync(spoolPath)).toBe(false);
  }, 75_000);

  it('leaves the durable processing claim quarantined after retry exhaustion', async () => {
    const cwd = createProject('retry-exhaustion');
    const sessionId = 'retry-exhaustion';
    const tracking = workerTracking(cwd, 'retry-exhaustion');
    const env = await ensureResident(cwd, sessionId, {
      OMC_SESSION_END_TEST_FORCE_PROCESS_FAILURE: '1',
    });
    const ipcReceipt = join(cwd, 'retry-exhaustion-ipc.json');

    expectPromptExit(await runUntilClose(
      timingSessionEnd,
      cwd,
      validSessionEndInput(cwd, sessionId),
      HOST_PROCESS_WATCHDOG_MS,
      {
        ...env,
        ...tracking.env,
        OMC_SESSION_END_TEST_IPC_RECEIPT: ipcReceipt,
      },
      timingPluginRoot,
    ));

    const ipcResult = JSON.parse(readFileSync(ipcReceipt, 'utf8')) as {
      eventId: string;
    };
    const spoolPath = await readTextEventually(tracking.spoolReceipt);
    const ipc = requireFromTest(
      join(stagedPluginRoot, 'scripts', 'lib', 'session-end-ipc.cjs'),
    ) as {
      resolveResidentContext(input: {
        pluginRoot: string;
        directory: string;
        sessionId: string;
        env: NodeJS.ProcessEnv;
      }): Record<string, string>;
      spoolPaths(
        context: Record<string, string>,
        spoolName: string,
        eventId: string,
      ): {
        readyPath: string;
        processingPath: string;
        claimPath: string;
      };
    };
    const context = ipc.resolveResidentContext({
      pluginRoot: stagedPluginRoot,
      directory: cwd,
      sessionId,
      env: { ...process.env, ...env },
    });
    const paths = ipc.spoolPaths(
      context,
      spoolPath.split(/[\\/]/).at(-1)!,
      ipcResult.eventId,
    );
    const deadline = Date.now() + 45_000;
    let claim: { attempts?: number; lastError?: string } | null = null;
    while (Date.now() < deadline) {
      try {
        claim = JSON.parse(readFileSync(paths.claimPath, 'utf8')) as {
          attempts?: number;
          lastError?: string;
        };
        if (claim.attempts === 3 && claim.lastError) break;
      } catch {
        // Retry transitions briefly move the frame back to ready.
      }
      await new Promise<void>(resolve => setTimeout(resolve, 25));
    }

    expect(claim).toMatchObject({
      attempts: 3,
      lastError: 'forced SessionEnd resident processing failure',
    });
    await new Promise<void>(resolve => setTimeout(resolve, 500));
    expect(existsSync(paths.readyPath)).toBe(false);
    expect(existsSync(paths.processingPath)).toBe(true);
    expect(existsSync(paths.claimPath)).toBe(true);
  }, 75_000);

  it('replaces stale control whose live PID has a reused start identity', async () => {
    const cwd = createProject('pid-reuse');
    const sessionId = 'pid-reuse';
    const env = await ensureResident(cwd, sessionId);
    const ipc = requireFromTest(
      join(stagedPluginRoot, 'scripts', 'lib', 'session-end-ipc.cjs'),
    ) as {
      atomicWritePrivateJson(path: string, value: unknown): void;
      readControl(context: Record<string, string>): Record<string, unknown> | null;
      resolveResidentContext(input: {
        pluginRoot: string;
        directory: string;
        sessionId: string;
        env: NodeJS.ProcessEnv;
      }): Record<string, string>;
    };
    const context = ipc.resolveResidentContext({
      pluginRoot: stagedPluginRoot,
      directory: cwd,
      sessionId,
      env: { ...process.env, ...env },
    });
    const oldControl = ipc.readControl(context)!;
    const oldPid = oldControl.pid as number;
    process.kill(oldPid, 'SIGKILL');
    await waitForDeath(oldPid);
    ipc.atomicWritePrivateJson(context.controlPath, {
      ...oldControl,
      pid: process.pid,
      processStartIdentity: 'reused-start-identity',
    });

    await ensureResident(cwd, sessionId);
    const replacement = ipc.readControl(context);
    expect(replacement?.pid).not.toBe(oldPid);
    expect(replacement?.pid).not.toBe(process.pid);
  }, 75_000);

  it(
    'keeps exactly 50 resident calls at <=500ms runner/admission duration with bounded authenticated ACKs and zero child creation',
    async () => {
      const cwd = createProject('sequential-50-run');
      const sessionId = 'sequential-50-run';
      const env = await ensureResident(cwd, sessionId);
      const raw = validSessionEndInput(cwd, sessionId);
      const samples: Array<{
        hostElapsedMs: number;
        runnerDurationMs: number;
      }> = [];

      for (let index = 0; index < SEQUENTIAL_GATE_CALLS; index += 1) {
        const receipt = join(cwd, `ipc-${index}.json`);
        const result = await runUntilClose(
          timingSessionEnd,
          cwd,
          raw,
          HOST_PROCESS_WATCHDOG_MS,
          {
            ...env,
            OMC_SESSION_END_TEST_IPC_RECEIPT: receipt,
          },
          timingPluginRoot,
        );
        const timing = readSessionEndTiming(receipt);
        const diagnostic = JSON.stringify({
          index,
          hostElapsedMs: result.elapsedMs,
          timing,
        });
        expectPromptExit(
          result,
          '{"continue":true}\n',
          diagnostic,
        );
        expect(timing.acknowledged, diagnostic).toBe(true);
        expect(timing.connectMs, diagnostic).toBeLessThanOrEqual(25);
        expect(timing.ackMs, diagnostic).toBeLessThanOrEqual(75);
        expect(timing.processCreations, diagnostic).toBe(0);
        expectRunnerAdmissionDuration(timing, diagnostic);
        samples.push({
          hostElapsedMs: result.elapsedMs,
          runnerDurationMs: timing.runnerDurationMs,
        });
      }
      expect(samples).toHaveLength(SEQUENTIAL_GATE_CALLS);
      reportTimingSummary('sequential 50-call gate', samples);
    },
    180_000,
  );

});
