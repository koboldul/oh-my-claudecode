import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  parseWindowsProcessStartIdentity,
} from '../platform/process-utils.js';

afterEach(() => {
  vi.doUnmock('fs');
  vi.doUnmock('child_process');
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
});
