import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const runCjs = require('../../scripts/run.cjs');
const RUN_CJS_PATH = join(process.cwd(), 'scripts', 'run.cjs');
const HUNG_PARENT = join(process.cwd(), 'src', '__tests__', 'fixtures', 'hung-hooks', 'hung-parent.cjs');
const SLOW_EXIT = join(process.cwd(), 'src', '__tests__', 'fixtures', 'hung-hooks', 'slow-exit.cjs');

function withWatchdog<T>(promise: Promise<T>, timeoutMs = 5000): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const watchdog = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`runGenericChild exceeded ${timeoutMs}ms watchdog`)), timeoutMs);
  });
  return Promise.race([promise, watchdog]).finally(() => clearTimeout(timer));
}

function killIfAlive(pid: number | undefined): void {
  if (!pid) return;
  try {
    process.kill(pid, 'SIGKILL');
  } catch { /* already dead */ }
}

async function waitForDeath(pid: number, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') return;
      throw error;
    }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`PID ${pid} survived process-tree reap`);
}

describe('run.cjs generic hook timeout supervisor', () => {
  it('exports generic timeout resolution without dispatching when required', () => {
    expect(runCjs.DEFAULT_GENERIC_TIMEOUT_MS).toBe(59000);
    expect(runCjs.resolveGenericTimeoutMs(null)).toBe(59000);
    const manifestHook = { timeoutMs: 3000, event: 'PostToolUse' };
    expect(runCjs.resolveGenericTimeoutMs(manifestHook))
      .toBe(runCjs.resolveInnerTimeoutMs(manifestHook));
    expect(runCjs.resolveGenericTimeoutMs(manifestHook)).toBe(2000);
  });

  it('classifies only manifest-resolved permission gates as critical', () => {
    expect(runCjs.isCriticalManifestHook(null)).toBe(false);
    expect(runCjs.isCriticalManifestHook({ event: 'Stop', timeoutMs: 3000 })).toBe(false);
    expect(runCjs.isCriticalManifestHook({ event: 'PermissionRequest', timeoutMs: 5000 })).toBe(true);
    expect(runCjs.isCriticalManifestHook({ event: 'pre_tool_use', timeoutMs: 3000 })).toBe(true);
    expect(runCjs.hookFailureExitCode({ event: 'PermissionRequest', timeoutMs: 5000 })).toBe(2);
    expect(runCjs.hookFailureExitCode({ event: 'PostToolUse', timeoutMs: 3000 })).toBe(0);
  });

  it('reaps a timed-out generic hook and its POSIX grandchild', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'omc-hung-generic-'));
    const pidfile = join(directory, 'grandchild.pid');
    const previousPidfile = process.env.OMC_TEST_PIDFILE;
    let grandchildPid: number | undefined;
    process.env.OMC_TEST_PIDFILE = pidfile;
    try {
      const startedAt = Date.now();
      const status = await withWatchdog(runCjs.runGenericChild(HUNG_PARENT, [], 250, null));
      const elapsed = Date.now() - startedAt;
      expect(status).toBe(0);
      expect(elapsed).toBeGreaterThanOrEqual(200);
      expect(elapsed).toBeLessThan(5000);
      grandchildPid = Number(readFileSync(pidfile, 'utf8'));
      expect(grandchildPid).toBeGreaterThan(0);
      if (process.platform !== 'win32') await waitForDeath(grandchildPid);
    } finally {
      if (previousPidfile === undefined) delete process.env.OMC_TEST_PIDFILE;
      else process.env.OMC_TEST_PIDFILE = previousPidfile;
      killIfAlive(grandchildPid);
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('propagates numeric exits and fail-opens for signal exits and spawn errors', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'omc-generic-exit-'));
    try {
      const numericExit = join(directory, 'numeric-exit.cjs');
      const signalExit = join(directory, 'signal-exit.cjs');
      writeFileSync(numericExit, 'process.exit(3);');
      writeFileSync(signalExit, "process.kill(process.pid, 'SIGKILL');");

      await expect(withWatchdog(runCjs.runGenericChild(numericExit, [], 2000, null))).resolves.toBe(3);
      // Windows reports this forced self-termination as numeric exit 1 rather
      // than an exit event with a signal, so only POSIX can exercise this path.
      if (process.platform !== 'win32') {
        await expect(withWatchdog(runCjs.runGenericChild(signalExit, [], 2000, null))).resolves.toBe(0);
      }
      const originalExecPath = process.execPath;
      Object.defineProperty(process, 'execPath', { configurable: true, value: join(directory, 'missing-node') });
      try {
        await expect(withWatchdog(runCjs.runGenericChild(join(directory, 'missing.cjs'), [], 2000, null))).resolves.toBe(0);
      } finally {
        Object.defineProperty(process, 'execPath', { configurable: true, value: originalExecPath });
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it.each(['PermissionRequest', 'PreToolUse'])(
    'fails closed when a manifest-resolved %s hook times out',
    async (event) => {
      await expect(withWatchdog(
        runCjs.runGenericChild(SLOW_EXIT, [], 25, { event, timeoutMs: 525 }),
      )).resolves.toBe(2);
    },
  );

  it('keeps optional manifest-resolved timeout and spawn failures fail-open', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'omc-optional-failure-'));
    try {
      await expect(withWatchdog(
        runCjs.runGenericChild(
          SLOW_EXIT,
          [],
          25,
          { event: 'PostToolUse', timeoutMs: 525 },
        ),
      )).resolves.toBe(0);

      const originalExecPath = process.execPath;
      Object.defineProperty(process, 'execPath', {
        configurable: true,
        value: join(directory, 'missing-node'),
      });
      try {
        await expect(withWatchdog(
          runCjs.runGenericChild(
            SLOW_EXIT,
            [],
            2000,
            { event: 'PostToolUse', timeoutMs: 2500 },
          ),
        )).resolves.toBe(0);
      } finally {
        Object.defineProperty(process, 'execPath', {
          configurable: true,
          value: originalExecPath,
        });
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it.each(['PermissionRequest', 'PreToolUse'])(
    'fails closed when a manifest-resolved %s hook cannot spawn',
    async (event) => {
      const directory = mkdtempSync(join(tmpdir(), 'omc-critical-spawn-'));
      const originalExecPath = process.execPath;
      Object.defineProperty(process, 'execPath', {
        configurable: true,
        value: join(directory, 'missing-node'),
      });
      try {
        await expect(withWatchdog(
          runCjs.runGenericChild(
            join(directory, 'missing.cjs'),
            [],
            2000,
            { event, timeoutMs: 2500 },
          ),
        )).resolves.toBe(2);
      } finally {
        Object.defineProperty(process, 'execPath', {
          configurable: true,
          value: originalExecPath,
        });
        rmSync(directory, { recursive: true, force: true });
      }
    },
  );

  it.each(['PermissionRequest', 'PreToolUse'])(
    'accepts only a successful manifest-resolved %s child exit',
    async (event) => {
      const directory = mkdtempSync(join(tmpdir(), 'omc-critical-exit-'));
      const success = join(directory, 'success.cjs');
      writeFileSync(success, 'process.exit(0);');
      try {
        await expect(withWatchdog(
          runCjs.runGenericChild(
            success,
            [],
            2000,
            { event, timeoutMs: 2500 },
          ),
        )).resolves.toBe(0);
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
  );

  it.each(['PermissionRequest', 'PreToolUse'])(
    'maps every abnormal manifest-resolved %s child termination to exit 2',
    async (event) => {
      const directory = mkdtempSync(join(tmpdir(), 'omc-critical-abnormal-'));
      const cases = [
        {
          label: 'syntax failure',
          filename: 'syntax-failure.cjs',
          source: 'function broken( {',
        },
        {
          label: 'import failure',
          filename: 'import-failure.cjs',
          source: "require('./missing-critical-import.cjs');",
        },
        {
          label: 'exit 1',
          filename: 'exit-one.cjs',
          source: 'process.exit(1);',
        },
        {
          label: 'signal',
          filename: 'signal.cjs',
          source: "process.kill(process.pid, 'SIGTERM');",
        },
      ];

      try {
        for (const testCase of cases) {
          const fixture = join(directory, testCase.filename);
          writeFileSync(fixture, testCase.source);
          const status = await withWatchdog(
            runCjs.runGenericChild(
              fixture,
              [],
              2000,
              { event, timeoutMs: 2500 },
            ),
          );
          expect(status, testCase.label).toBe(2);
        }
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
  );

  it('terminalizes once when a child exits after its timeout', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'omc-generic-late-'));
    const fixture = join(directory, 'late-exit.cjs');
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    writeFileSync(fixture, 'setTimeout(() => process.exit(7), 150);');
    process.on('unhandledRejection', onUnhandled);
    try {
      await expect(withWatchdog(runCjs.runGenericChild(fixture, [], 50, null))).resolves.toBe(0);
      await new Promise(resolve => setTimeout(resolve, 200));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it.each([
    ['PermissionRequest', 2],
    ['PreToolUse', 2],
    ['PostToolUse', 0],
  ] as const)(
    'uses manifest policy for %s runner signals (exit %i, POSIX)',
    async (event, expectedStatus) => {
      // Windows force-terminates the runner instead of delivering SIGTERM to
      // its JavaScript handler, so this handler-path regression is POSIX-only.
      if (process.platform === 'win32') return;

      const directory = mkdtempSync(join(tmpdir(), 'omc-runner-signal-'));
      const scriptsDir = join(directory, 'scripts');
      const hooksDir = join(directory, 'hooks');
      const scriptName = `signal-${event.toLowerCase()}.cjs`;
      const target = join(scriptsDir, scriptName);
      const pidfile = join(directory, 'hook.pid');
      let hookPid: number | undefined;
      mkdirSync(scriptsDir, { recursive: true });
      mkdirSync(hooksDir, { recursive: true });
      writeFileSync(
        target,
        `require('node:fs').writeFileSync(${JSON.stringify(pidfile)}, String(process.pid)); setInterval(() => {}, 1e9);`,
      );
      writeFileSync(
        join(hooksDir, 'hooks.json'),
        JSON.stringify({
          hooks: {
            [event]: [
              {
                matcher: '*',
                hooks: [
                  {
                    type: 'command',
                    command: `node "$CLAUDE_PLUGIN_ROOT"/scripts/run.cjs "$CLAUDE_PLUGIN_ROOT"/scripts/${scriptName}`,
                    timeout: 5,
                  },
                ],
              },
            ],
          },
        }),
      );

      const runner = spawn(process.execPath, [RUN_CJS_PATH, target], {
        stdio: 'ignore',
        env: { ...process.env, CLAUDE_PLUGIN_ROOT: directory },
      });

      try {
        const deadline = Date.now() + 4000;
        while (Date.now() < deadline && !existsSync(pidfile)) {
          await new Promise(resolve => setTimeout(resolve, 25));
        }
        expect(existsSync(pidfile)).toBe(true);
        hookPid = Number(readFileSync(pidfile, 'utf8'));
        expect(hookPid).toBeGreaterThan(0);

        const runnerExit = new Promise<{
          code: number | null;
          signal: NodeJS.Signals | null;
        }>(resolve => {
          runner.once('exit', (code, signal) => resolve({ code, signal }));
        });
        runner.kill('SIGTERM');
        const result = await Promise.race([
          runnerExit,
          new Promise<never>((_, reject) => setTimeout(
            () => reject(new Error('runner did not exit after SIGTERM')),
            5000,
          )),
        ]);

        expect(result).toEqual({ code: expectedStatus, signal: null });
        await waitForDeath(hookPid);
      } finally {
        killIfAlive(hookPid);
        try { runner.kill('SIGKILL'); } catch { /* already gone */ }
        rmSync(directory, { recursive: true, force: true });
      }
    },
  );

  it('reaps the detached hook tree when the runner is terminated before its timeout (POSIX)', async () => {
    if (process.platform === 'win32') return; // POSIX-only: exercises process-group reap. Killing the grandchild proves its whole group (incl. the direct hook child) was reaped. Windows programmatic SIGTERM force-terminates rather than delivering a catchable signal, so this outer-cancellation path is POSIX-specific.
    const directory = mkdtempSync(join(tmpdir(), 'omc-runner-cancel-'));
    const pidfile = join(directory, 'grandchild.pid');
    let grandchildPid: number | undefined;
    // Manifest-null target => the runner arms the 59000ms default timer; we terminate the
    // runner well before it fires, so only the new signal-handler reap can prevent an orphan.
    const runner = spawn(process.execPath, [RUN_CJS_PATH, HUNG_PARENT], {
      stdio: 'ignore',
      env: { ...process.env, OMC_TEST_PIDFILE: pidfile },
    });
    try {
      const deadline = Date.now() + 4000;
      while (Date.now() < deadline && !existsSync(pidfile)) {
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      expect(existsSync(pidfile)).toBe(true);
      grandchildPid = Number(readFileSync(pidfile, 'utf8'));
      expect(grandchildPid).toBeGreaterThan(0);

      const runnerExit = new Promise<void>(resolve => runner.once('exit', () => resolve()));
      runner.kill('SIGTERM');
      await Promise.race([
        runnerExit,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('runner did not exit after SIGTERM')), 5000)),
      ]);
      await waitForDeath(grandchildPid);
    } finally {
      killIfAlive(grandchildPid);
      try { runner.kill('SIGKILL'); } catch { /* already gone */ }
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
