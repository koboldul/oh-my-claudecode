import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'child_process';
import { detectCli, detectAllClis } from '../cli-detection.js';
import { clearResolvedPathCache } from '../model-contract.js';

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    spawnSync: vi.fn(actual.spawnSync),
  };
});

function setProcessPlatform(platform: NodeJS.Platform): () => void {
  const originalPlatform = process.platform;
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  return () => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  };
}

describe('cli-detection', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('resolves a Windows provider before probing its .cmd shim through COMSPEC', () => {
    const mockSpawnSync = vi.mocked(spawnSync);
    const restorePlatform = setProcessPlatform('win32');
    const originalComspec = process.env.COMSPEC;
    process.env.COMSPEC = 'C:\\Windows\\System32\\cmd.exe';
    clearResolvedPathCache();

    mockSpawnSync
      .mockReturnValueOnce({ status: 0, stdout: 'C:\\Tools\\codex.cmd', stderr: '', pid: 0, output: [], signal: null } as any)
      .mockReturnValueOnce({ status: 0, stdout: 'codex 1.0.0', stderr: '', pid: 0, output: [], signal: null } as any);

    expect(detectCli('codex')).toEqual({
      available: true,
      runnable: true,
      version: 'codex 1.0.0',
      path: 'C:\\Tools\\codex.cmd',
    });

    expect(mockSpawnSync).toHaveBeenNthCalledWith(
      1,
      'where',
      ['codex'],
      expect.objectContaining({ timeout: 5000 }),
    );
    expect(mockSpawnSync).toHaveBeenNthCalledWith(
      2,
      'C:\\Windows\\System32\\cmd.exe',
      ['/d', '/c', 'C:\\Tools\\codex.cmd', '--version'],
      { timeout: 5000 },
    );
    if (originalComspec === undefined) delete process.env.COMSPEC;
    else process.env.COMSPEC = originalComspec;
    restorePlatform();
    clearResolvedPathCache();
    mockSpawnSync.mockRestore();
  });

  it('detectAllClis resolves the antigravity binary (agy)', () => {
    const mockSpawnSync = vi.mocked(spawnSync);
    clearResolvedPathCache();
    // Make every resolver report not-found so we exercise the agy lookup.
    mockSpawnSync.mockReturnValue({ status: 1, stdout: '', stderr: '', pid: 0, output: [], signal: null } as any);

    const result = detectAllClis();

    expect(result).toHaveProperty('antigravity');
    expect(result.antigravity).toMatchObject({ available: false, runnable: false });
    expect(mockSpawnSync).toHaveBeenCalledWith(
      process.platform === 'win32' ? 'where' : 'which',
      ['agy'],
      expect.objectContaining({ timeout: 5000 }),
    );
    clearResolvedPathCache();
    mockSpawnSync.mockRestore();
  });

  it('detects Copilot with `copilot --version` and avoids a Windows shell', () => {
    const mockSpawnSync = vi.mocked(spawnSync);
    const restorePlatform = setProcessPlatform('win32');
    clearResolvedPathCache();
    mockSpawnSync
      .mockReturnValueOnce({ status: 0, stdout: 'C:\\Tools\\copilot.exe', stderr: '', pid: 0, output: [], signal: null } as any)
      .mockReturnValueOnce({ status: 0, stdout: 'GitHub Copilot CLI 1.0.71-3', stderr: '', pid: 0, output: [], signal: null } as any);

    expect(detectCli('copilot')).toEqual({
      available: true,
      runnable: true,
      version: 'GitHub Copilot CLI 1.0.71-3',
      path: 'C:\\Tools\\copilot.exe',
    });
    expect(mockSpawnSync).toHaveBeenNthCalledWith(
      2,
      'C:\\Tools\\copilot.exe',
      ['--version'],
      { timeout: 5000, shell: false },
    );
    restorePlatform();
    clearResolvedPathCache();
    mockSpawnSync.mockRestore();
  });

  it('detects an npm-installed Copilot .cmd shim through COMSPEC on Windows', () => {
    const mockSpawnSync = vi.mocked(spawnSync);
    const restorePlatform = setProcessPlatform('win32');
    const originalComspec = process.env.COMSPEC;
    process.env.COMSPEC = 'C:\\Windows\\System32\\cmd.exe';
    clearResolvedPathCache();
    mockSpawnSync
      .mockReturnValueOnce({
        status: 0,
        stdout: 'C:\\Users\\me\\AppData\\Roaming\\npm\\copilot\r\nC:\\Users\\me\\AppData\\Roaming\\npm\\copilot.cmd\r\n',
        stderr: '',
        pid: 0,
        output: [],
        signal: null,
      } as any)
      .mockReturnValueOnce({
        status: 0,
        stdout: 'GitHub Copilot CLI 1.0.71-3',
        stderr: '',
        pid: 0,
        output: [],
        signal: null,
      } as any);

    expect(detectCli('copilot')).toEqual({
      available: true,
      runnable: true,
      version: 'GitHub Copilot CLI 1.0.71-3',
      path: 'C:\\Users\\me\\AppData\\Roaming\\npm\\copilot.cmd',
    });
    expect(mockSpawnSync).toHaveBeenNthCalledWith(
      2,
      'C:\\Windows\\System32\\cmd.exe',
      ['/d', '/c', 'C:\\Users\\me\\AppData\\Roaming\\npm\\copilot.cmd', '--version'],
      { timeout: 5000 },
    );

    if (originalComspec === undefined) delete process.env.COMSPEC;
    else process.env.COMSPEC = originalComspec;
    restorePlatform();
    clearResolvedPathCache();
    mockSpawnSync.mockRestore();
  });

  it('includes Copilot in all-provider detection', () => {
    const mockSpawnSync = vi.mocked(spawnSync);
    clearResolvedPathCache();
    mockSpawnSync.mockReturnValue({ status: 1, stdout: '', stderr: '', pid: 0, output: [], signal: null } as any);
    const result = detectAllClis();
    expect(result.copilot).toMatchObject({ available: false, runnable: false });
    expect(mockSpawnSync).toHaveBeenCalledWith(
      process.platform === 'win32' ? 'where' : 'which',
      ['copilot'],
      expect.objectContaining({ timeout: 5000 }),
    );
    clearResolvedPathCache();
    mockSpawnSync.mockRestore();
  });

  it('keeps a timed-out version probe available with diagnostic details', () => {
    const mockSpawnSync = vi.mocked(spawnSync);
    const restorePlatform = setProcessPlatform('win32');
    clearResolvedPathCache();
    mockSpawnSync
      .mockReturnValueOnce({ status: 0, stdout: 'C:\\Tools\\copilot.exe\n', stderr: '', pid: 0, output: [], signal: null } as any)
      .mockReturnValueOnce({
        status: null,
        stdout: '',
        stderr: '',
        error: Object.assign(new Error('spawnSync copilot ETIMEDOUT'), { code: 'ETIMEDOUT' }),
        pid: 0,
        output: [],
        signal: 'SIGTERM',
      } as any);

    expect(detectCli('copilot')).toEqual({
      available: true,
      runnable: false,
      path: 'C:\\Tools\\copilot.exe',
      error: 'Version probe timed out after 5000ms.',
    });
    restorePlatform();
    clearResolvedPathCache();
    mockSpawnSync.mockRestore();
  });

  it('keeps a nonzero version probe available with exit diagnostics', () => {
    const mockSpawnSync = vi.mocked(spawnSync);
    const restorePlatform = setProcessPlatform('win32');
    clearResolvedPathCache();
    mockSpawnSync
      .mockReturnValueOnce({ status: 0, stdout: 'C:\\Tools\\copilot.exe\n', stderr: '', pid: 0, output: [], signal: null } as any)
      .mockReturnValueOnce({
        status: 2,
        stdout: '',
        stderr: 'authentication required\n',
        pid: 0,
        output: [],
        signal: null,
      } as any);

    expect(detectCli('copilot')).toEqual({
      available: true,
      runnable: false,
      path: 'C:\\Tools\\copilot.exe',
      error: 'Version probe exited with code 2: authentication required',
    });
    restorePlatform();
    clearResolvedPathCache();
    mockSpawnSync.mockRestore();
  });
});
