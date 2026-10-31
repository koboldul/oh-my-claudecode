import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseWindowsProcessStartIdentity,
} from '../platform/process-utils.js';

afterEach(() => {
  vi.doUnmock('fs');
  vi.doUnmock('child_process');
  vi.doUnmock('../../scripts/lib/host-delivery-ack.mjs');
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('process start identity cache', () => {
  it('canonicalizes PowerShell and WMIC DMTF timestamps to one precise identity', () => {
    const local = parseWindowsProcessStartIdentity(
      '20260720070001.123456-240',
    );
    const utc = parseWindowsProcessStartIdentity(
      'Node,20260720110001.123456+000',
    );

    expect(local).toBe(utc);
    expect(local).toMatch(/^windows-dmtf-us:\d+$/);
    expect(parseWindowsProcessStartIdentity(
      '20260720110001.123457+000',
    )).not.toBe(local);
  });

  it('retries transient null identity probes instead of caching them', async () => {
    const actualFs = await vi.importActual<typeof import('fs')>('fs');
    const actualChildProcess = await vi.importActual<
      typeof import('child_process')
    >('child_process');
    const procPath = `/proc/${process.pid}/stat`;
    const realProcStat = process.platform === 'linux'
      ? actualFs.readFileSync(procPath, 'utf8')
      : '';
    let linuxReads = 0;
    let macReads = 0;
    let windowsPowerShellReads = 0;

    vi.doMock('fs', () => ({
      ...actualFs,
      readFileSync: (...args: unknown[]) => {
        if (process.platform === 'linux' && args[0] === procPath) {
          linuxReads += 1;
          if (linuxReads === 1) {
            throw Object.assign(new Error('transient read failure'), {
              code: 'EACCES',
            });
          }
          return realProcStat;
        }
        return Reflect.apply(actualFs.readFileSync, actualFs, args);
      },
    }));
    vi.doMock('child_process', () => ({
      ...actualChildProcess,
      execFileSync: (...args: unknown[]) => {
        const command = String(args[0]);
        if (process.platform === 'darwin' && command === 'ps') {
          macReads += 1;
          if (macReads === 1) throw new Error('transient ps failure');
          return 'Fri Apr 17 12:00:00 2026\n';
        }
        if (process.platform === 'win32' && command === 'powershell') {
          windowsPowerShellReads += 1;
          if (windowsPowerShellReads === 1) {
            throw new Error('transient PowerShell failure');
          }
          return '20260417120000.123456+000\n';
        }
        if (process.platform === 'win32' && command === 'wmic') {
          throw new Error('transient WMIC failure');
        }
        return Reflect.apply(
          actualChildProcess.execFileSync,
          actualChildProcess,
          args,
        );
      },
    }));
    vi.resetModules();
    const { getProcessStartIdentitySync } = await import(
      '../platform/process-utils.js'
    );

    expect(getProcessStartIdentitySync(process.pid)).toBeNull();
    expect(getProcessStartIdentitySync(process.pid)).toEqual(
      expect.any(String),
    );
  });

  it('retries an absent current-process probe instead of caching it', async () => {
    const actualFs = await vi.importActual<typeof import('fs')>('fs');
    const platform = vi.spyOn(process, 'platform', 'get')
      .mockReturnValue('linux');
    let reads = 0;
    vi.doMock('fs', () => ({
      ...actualFs,
      readFileSync: (...args: unknown[]) => {
        if (args[0] === `/proc/${process.pid}/stat`) {
          reads += 1;
          if (reads === 1) {
            throw Object.assign(new Error('transient absence'), {
              code: 'ENOENT',
            });
          }
          return `${process.pid} (node) S `
            + '0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 987654';
        }
        return Reflect.apply(actualFs.readFileSync, actualFs, args);
      },
    }));
    vi.resetModules();
    const { getProcessStartIdentitySync } = await import(
      '../platform/process-utils.js'
    );

    expect(getProcessStartIdentitySync(process.pid)).toBe('absent');
    expect(getProcessStartIdentitySync(process.pid)).toBe('987654');
    platform.mockRestore();
  });

  it('warms the current Windows cache from the runner identity broker without a local probe', async () => {
    const actualChildProcess = await vi.importActual<
      typeof import('child_process')
    >('child_process');
    const platform = vi.spyOn(process, 'platform', 'get')
      .mockReturnValue('win32');
    const expected = parseWindowsProcessStartIdentity(
      '20260101000000.123456+000',
    );
    if (!expected) throw new Error('test DMTF identity is invalid');
    const epochMicroseconds = BigInt(
      expected.slice('windows-dmtf-us:'.length),
    );
    const ticks = 621355968000000000n + epochMicroseconds * 10n + 9n;
    const execFileSync = vi.fn(() => {
      throw new Error('sync identity probe should use the warmed cache');
    });
    const execFile = vi.fn(() => {
      throw new Error('runner-brokered identity must not spawn locally');
    });
    vi.doMock('child_process', () => ({
      ...actualChildProcess,
      execFile,
      execFileSync,
    }));
    const queryCurrentProcessStartIdentity = vi.fn(async () =>
      `ticks:${ticks}`,
    );
    const close = vi.fn();
    const observeHostDeliveryAbort = vi.fn(async () => ({
      queryCurrentProcessStartIdentity,
      close,
    }));
    vi.doMock('../../scripts/lib/host-delivery-ack.mjs', () => ({
      observeHostDeliveryAbort,
    }));
    vi.stubEnv('OMC_RUNNER_HOST_DELIVERY_ACK', '1');
    vi.resetModules();
    const {
      getProcessStartIdentitySync,
      warmCurrentProcessStartIdentitySyncCache,
    } = await import('../platform/process-utils.js');

    await expect(warmCurrentProcessStartIdentitySyncCache({
      deadlineAt: Date.now() + 1_000,
    })).resolves.toBe(true);
    expect(observeHostDeliveryAbort).toHaveBeenCalledWith();
    expect(queryCurrentProcessStartIdentity).toHaveBeenCalledWith();
    expect(close).toHaveBeenCalledWith();
    expect(getProcessStartIdentitySync(process.pid)).toBe(expected);
    expect(execFile).not.toHaveBeenCalled();
    expect(execFileSync).not.toHaveBeenCalled();
    platform.mockRestore();
  });

  it('does not prime an invalid runner-brokered Windows identity', async () => {
    const actualChildProcess = await vi.importActual<
      typeof import('child_process')
    >('child_process');
    const platform = vi.spyOn(process, 'platform', 'get')
      .mockReturnValue('win32');
    const dmtf = '20260101000000.123456+000';
    const execFileSync = vi.fn(() => `${dmtf}\n`);
    const execFile = vi.fn(() => {
      throw new Error('failed broker authority must not fall back locally');
    });
    vi.doMock('child_process', () => ({
      ...actualChildProcess,
      execFile,
      execFileSync,
    }));
    const close = vi.fn();
    vi.doMock('../../scripts/lib/host-delivery-ack.mjs', () => ({
      observeHostDeliveryAbort: async () => ({
        queryCurrentProcessStartIdentity: async () => 'ticks:0',
        close,
      }),
    }));
    vi.stubEnv('OMC_RUNNER_HOST_DELIVERY_ACK', '1');
    vi.resetModules();
    const {
      getProcessStartIdentitySync,
      warmCurrentProcessStartIdentitySyncCache,
    } = await import('../platform/process-utils.js');

    await expect(warmCurrentProcessStartIdentitySyncCache({
      deadlineAt: Date.now() + 1_000,
    })).resolves.toBe(false);
    expect(close).toHaveBeenCalledWith();
    expect(execFile).not.toHaveBeenCalled();
    expect(execFileSync).not.toHaveBeenCalled();
    expect(getProcessStartIdentitySync(process.pid)).toBe(
      parseWindowsProcessStartIdentity(dmtf),
    );
    expect(execFileSync).toHaveBeenCalledTimes(1);
    platform.mockRestore();
  });

  it('warms the current Windows sync cache with exact canonical microseconds', async () => {
    const actualChildProcess = await vi.importActual<
      typeof import('child_process')
    >('child_process');
    const platform = vi.spyOn(process, 'platform', 'get')
      .mockReturnValue('win32');
    const expected = parseWindowsProcessStartIdentity(
      '20260101000000.123456+000',
    );
    if (!expected) throw new Error('test DMTF identity is invalid');
    const epochMicroseconds = BigInt(
      expected.slice('windows-dmtf-us:'.length),
    );
    const ticks = 621355968000000000n + epochMicroseconds * 10n + 9n;
    const execFileSync = vi.fn(() => {
      throw new Error('sync identity probe should use the warmed cache');
    });
    const execFile = vi.fn((...args: unknown[]) => {
      const callback = args.at(-1);
      if (typeof callback !== 'function') {
        throw new TypeError('execFile callback missing');
      }
      queueMicrotask(() => callback(null, `${ticks}\n`, ''));
      return { pid: 4321 };
    });
    vi.doMock('child_process', () => ({
      ...actualChildProcess,
      execFile,
      execFileSync,
    }));
    vi.stubEnv('OMC_RUNNER_HOST_DELIVERY_ACK', '0');
    vi.resetModules();
    const {
      getProcessStartIdentity,
      getProcessStartIdentitySync,
      isProcessIdentityLive,
      warmCurrentProcessStartIdentitySyncCache,
    } = await import('../platform/process-utils.js');
    const { withFileLockSync } = await import('../lib/file-lock.js');
    const spawned: number[] = [];
    const lockRoot = mkdtempSync(join(tmpdir(), 'omc-identity-warm-lock-'));
    const untrustedIdentityProvider = vi.fn(async () =>
      `ticks:${ticks + 10_000n}`,
    );
    const warmOptions = {
      deadlineAt: Date.now() + 1_000,
      onProbeSpawn: (pid: number) => spawned.push(pid),
      queryCurrentProcessStartIdentity: untrustedIdentityProvider,
    };

    try {
      await expect(
        warmCurrentProcessStartIdentitySyncCache(warmOptions),
      ).resolves.toBe(true);
      expect(getProcessStartIdentitySync(process.pid)).toBe(expected);
      await expect(getProcessStartIdentity(
        process.pid,
        Date.now() + 1_000,
      )).resolves.toBe(`ticks:${ticks}`);
      await expect(isProcessIdentityLive(
        process.pid,
        `ticks:${ticks}`,
        Date.now() + 1_000,
      )).resolves.toBe('live');
      expect(withFileLockSync(
        join(lockRoot, 'state.lock'),
        () => 'locked',
      )).toBe('locked');
      expect(spawned).toEqual([4321]);
      expect(untrustedIdentityProvider).not.toHaveBeenCalled();
      expect(execFile).toHaveBeenCalledTimes(3);
      expect(execFile).toHaveBeenCalledWith(
        'pwsh',
        [
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          expect.stringContaining(
            `[System.Diagnostics.Process]::GetProcessById(${process.pid})`,
          ),
        ],
        expect.objectContaining({
          signal: undefined,
          windowsHide: true,
        }),
        expect.any(Function),
      );
      expect(execFileSync).not.toHaveBeenCalled();
    } finally {
      rmSync(lockRoot, { recursive: true, force: true });
      platform.mockRestore();
    }
  });

  it('falls back to Windows PowerShell when PowerShell Core is unavailable', async () => {
    const actualChildProcess = await vi.importActual<
      typeof import('child_process')
    >('child_process');
    const platform = vi.spyOn(process, 'platform', 'get')
      .mockReturnValue('win32');
    const expected = parseWindowsProcessStartIdentity(
      '20260101000000.123456+000',
    );
    if (!expected) throw new Error('test DMTF identity is invalid');
    const epochMicroseconds = BigInt(
      expected.slice('windows-dmtf-us:'.length),
    );
    const ticks = 621355968000000000n + epochMicroseconds * 10n;
    const commands: string[] = [];
    const execFileSync = vi.fn(() => {
      throw new Error('sync identity probe should use the warmed cache');
    });
    const execFile = vi.fn((...args: unknown[]) => {
      const command = args[0];
      const callback = args.at(-1);
      if (typeof command !== 'string' || typeof callback !== 'function') {
        throw new TypeError('execFile contract missing');
      }
      commands.push(command);
      queueMicrotask(() => {
        if (command === 'pwsh') {
          callback(
            Object.assign(new Error('pwsh unavailable'), { code: 'ENOENT' }),
            '',
            '',
          );
          return;
        }
        callback(null, `${ticks}\n`, '');
      });
      return { pid: command === 'pwsh' ? 4325 : 4326 };
    });
    vi.doMock('child_process', () => ({
      ...actualChildProcess,
      execFile,
      execFileSync,
    }));
    vi.resetModules();
    const {
      getProcessStartIdentitySync,
      warmCurrentProcessStartIdentitySyncCache,
    } = await import('../platform/process-utils.js');
    const spawned: number[] = [];

    await expect(warmCurrentProcessStartIdentitySyncCache({
      deadlineAt: Date.now() + 1_000,
      onProbeSpawn: (pid) => spawned.push(pid),
    })).resolves.toBe(true);
    expect(commands).toEqual(['pwsh', 'powershell']);
    expect(spawned).toEqual([4325, 4326]);
    expect(getProcessStartIdentitySync(process.pid)).toBe(expected);
    expect(execFileSync).not.toHaveBeenCalled();
    platform.mockRestore();
  });

  it('does not prime failed or explicitly unknown current Windows probes', async () => {
    const actualChildProcess = await vi.importActual<
      typeof import('child_process')
    >('child_process');
    const platform = vi.spyOn(process, 'platform', 'get')
      .mockReturnValue('win32');
    const dmtf = '20260101000000.123456+000';
    const expected = parseWindowsProcessStartIdentity(dmtf);
    const execFileSync = vi.fn(() => `${dmtf}\n`);
    const execFile = vi.fn((...args: unknown[]) => {
      const callback = args.at(-1);
      if (typeof callback !== 'function') {
        throw new TypeError('execFile callback missing');
      }
      queueMicrotask(() => callback(new Error('probe failed'), '', ''));
      return { pid: 4322 };
    });
    vi.doMock('child_process', () => ({
      ...actualChildProcess,
      execFile,
      execFileSync,
    }));
    vi.resetModules();
    const {
      getProcessStartIdentitySync,
      warmCurrentProcessStartIdentitySyncCache,
    } = await import('../platform/process-utils.js');

    await expect(warmCurrentProcessStartIdentitySyncCache({
      deadlineAt: Date.now() + 1_000,
    })).resolves.toBe(false);
    expect(getProcessStartIdentitySync(process.pid)).toBe(expected);
    expect(execFileSync).toHaveBeenCalledTimes(1);

    vi.resetModules();
    vi.stubEnv(
      'OMC_TEST_FILE_LOCK_PROCESS_START_UNKNOWN_PID',
      String(process.pid),
    );
    const fenced = await import('../platform/process-utils.js');
    execFile.mockClear();
    execFileSync.mockClear();
    await expect(fenced.warmCurrentProcessStartIdentitySyncCache({
      deadlineAt: Date.now() + 1_000,
    })).resolves.toBe(false);
    expect(fenced.getProcessStartIdentitySync(process.pid)).toBeNull();
    expect(execFile).not.toHaveBeenCalled();
    expect(execFileSync).not.toHaveBeenCalled();
    platform.mockRestore();
  });

  it('keeps foreign Windows PID probes fresh after warming the current PID', async () => {
    const actualChildProcess = await vi.importActual<
      typeof import('child_process')
    >('child_process');
    const platform = vi.spyOn(process, 'platform', 'get')
      .mockReturnValue('win32');
    const currentDmtf = '20260101000000.123456+000';
    const current = parseWindowsProcessStartIdentity(currentDmtf);
    if (!current) throw new Error('test DMTF identity is invalid');
    const currentMicros = BigInt(current.slice('windows-dmtf-us:'.length));
    const ticks = 621355968000000000n + currentMicros * 10n;
    const foreignDmtf = '20260101000001.654321+000';
    const execFileSync = vi.fn(() => `${foreignDmtf}\n`);
    const execFile = vi.fn((...args: unknown[]) => {
      const callback = args.at(-1);
      if (typeof callback !== 'function') {
        throw new TypeError('execFile callback missing');
      }
      queueMicrotask(() => callback(null, `${ticks}\n`, ''));
      return { pid: 4323 };
    });
    vi.doMock('child_process', () => ({
      ...actualChildProcess,
      execFile,
      execFileSync,
    }));
    vi.resetModules();
    const {
      getProcessStartIdentitySync,
      warmCurrentProcessStartIdentitySyncCache,
    } = await import('../platform/process-utils.js');

    await expect(warmCurrentProcessStartIdentitySyncCache({
      deadlineAt: Date.now() + 1_000,
    })).resolves.toBe(true);
    expect(getProcessStartIdentitySync(process.pid)).toBe(current);
    expect(getProcessStartIdentitySync(4242)).toBe(
      parseWindowsProcessStartIdentity(foreignDmtf),
    );
    expect(execFileSync).toHaveBeenCalledTimes(1);
    platform.mockRestore();
  });

  it('aborts a Windows warm-up without priming the sync cache', async () => {
    const actualChildProcess = await vi.importActual<
      typeof import('child_process')
    >('child_process');
    const platform = vi.spyOn(process, 'platform', 'get')
      .mockReturnValue('win32');
    const dmtf = '20260101000000.123456+000';
    const execFileSync = vi.fn(() => `${dmtf}\n`);
    const execFile = vi.fn((...args: unknown[]) => {
      const options = args[2];
      const callback = args.at(-1);
      if (
        typeof callback !== 'function'
        || typeof options !== 'object'
        || options === null
        || !('signal' in options)
        || !(options.signal instanceof AbortSignal)
      ) {
        throw new TypeError('execFile abort contract missing');
      }
      options.signal.addEventListener('abort', () => {
        queueMicrotask(() => callback(
          Object.assign(new Error('aborted'), { code: 'ABORT_ERR' }),
          '',
          '',
        ));
      }, { once: true });
      return { pid: 4324 };
    });
    vi.doMock('child_process', () => ({
      ...actualChildProcess,
      execFile,
      execFileSync,
    }));
    vi.resetModules();
    const {
      getProcessStartIdentitySync,
      warmCurrentProcessStartIdentitySyncCache,
    } = await import('../platform/process-utils.js');
    const controller = new AbortController();
    const warm = warmCurrentProcessStartIdentitySyncCache({
      deadlineAt: Date.now() + 1_000,
      signal: controller.signal,
    });
    controller.abort(new Error('cancelled'));

    await expect(warm).rejects.toThrow('cancelled');
    expect(getProcessStartIdentitySync(process.pid)).toBe(
      parseWindowsProcessStartIdentity(dmtf),
    );
    expect(execFileSync).toHaveBeenCalledTimes(1);
    platform.mockRestore();
  });

  it('warms the actual Windows current-process cache and reaps its probe', async () => {
    if (process.platform !== 'win32') return;
    vi.resetModules();
    const {
      getProcessStartIdentitySync,
      warmCurrentProcessStartIdentitySyncCache,
    } = await import('../platform/process-utils.js');
    const spawned: number[] = [];

    await expect(warmCurrentProcessStartIdentitySyncCache({
      deadlineAt: Date.now() + 2_000,
      onProbeSpawn: (pid) => spawned.push(pid),
    })).resolves.toBe(true);
    expect(getProcessStartIdentitySync(process.pid)).toMatch(
      /^windows-dmtf-us:\d+$/,
    );
    expect(spawned.length).toBeGreaterThan(0);

    const cleanupDeadline = Date.now() + 500;
    for (const pid of spawned) {
      while (Date.now() < cleanupDeadline) {
        try {
          process.kill(pid, 0);
          await new Promise((resolve) => setTimeout(resolve, 10));
        } catch {
          break;
        }
      }
      expect(() => process.kill(pid, 0)).toThrow();
    }
  });

  it('aborts and reaps an actual Windows identity probe', async () => {
    if (process.platform !== 'win32') return;
    vi.resetModules();
    const { warmCurrentProcessStartIdentitySyncCache } = await import(
      '../platform/process-utils.js'
    );
    const controller = new AbortController();
    const spawned: number[] = [];
    const warm = warmCurrentProcessStartIdentitySyncCache({
      deadlineAt: Date.now() + 2_000,
      signal: controller.signal,
      onProbeSpawn: (pid) => {
        spawned.push(pid);
        controller.abort(new Error('test identity probe abort'));
      },
    });

    await expect(warm).rejects.toThrow('test identity probe abort');
    expect(spawned.length).toBeGreaterThan(0);
    const cleanupDeadline = Date.now() + 500;
    for (const pid of spawned) {
      while (Date.now() < cleanupDeadline) {
        try {
          process.kill(pid, 0);
          await new Promise((resolve) => setTimeout(resolve, 10));
        } catch {
          break;
        }
      }
      expect(() => process.kill(pid, 0)).toThrow();
    }
  });
});
