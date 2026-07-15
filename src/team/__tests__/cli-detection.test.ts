import { describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'child_process';
import { detectCli, detectAllClis } from '../cli-detection.js';

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
  it('uses shell:true for Windows provider version probes', () => {
    const mockSpawnSync = vi.mocked(spawnSync);
    const restorePlatform = setProcessPlatform('win32');

    mockSpawnSync
      .mockReturnValueOnce({ status: 0, stdout: 'codex 1.0.0', stderr: '', pid: 0, output: [], signal: null } as any)
      .mockReturnValueOnce({ status: 0, stdout: 'C:\\Tools\\codex.cmd', stderr: '', pid: 0, output: [], signal: null } as any);

    expect(detectCli('codex')).toEqual({
      available: true,
      version: 'codex 1.0.0',
      path: 'C:\\Tools\\codex.cmd',
    });

    expect(mockSpawnSync).toHaveBeenNthCalledWith(1, 'codex', ['--version'], { timeout: 5000, shell: true });
    expect(mockSpawnSync).toHaveBeenNthCalledWith(2, 'where', ['codex'], { timeout: 5000 });
    restorePlatform();
    mockSpawnSync.mockRestore();
  });

  it('detectAllClis probes the antigravity binary (agy)', () => {
    const mockSpawnSync = vi.mocked(spawnSync);
    // Make every probe report not-found so we exercise the agy version probe.
    mockSpawnSync.mockReturnValue({ status: 1, stdout: '', stderr: '', pid: 0, output: [], signal: null } as any);

    const result = detectAllClis();

    expect(result).toHaveProperty('antigravity');
    expect(result.antigravity).toEqual({ available: false });
    expect(mockSpawnSync).toHaveBeenCalledWith('agy', ['--version'], expect.objectContaining({ timeout: 5000 }));
    mockSpawnSync.mockRestore();
  });

  it('detects Copilot with `copilot --version` and avoids a Windows shell', () => {
    const mockSpawnSync = vi.mocked(spawnSync);
    const restorePlatform = setProcessPlatform('win32');
    mockSpawnSync
      .mockReturnValueOnce({ status: 0, stdout: 'GitHub Copilot CLI 1.0.71-3', stderr: '', pid: 0, output: [], signal: null } as any)
      .mockReturnValueOnce({ status: 0, stdout: 'C:\\Tools\\copilot.exe', stderr: '', pid: 0, output: [], signal: null } as any);

    expect(detectCli('copilot')).toEqual({
      available: true,
      version: 'GitHub Copilot CLI 1.0.71-3',
      path: 'C:\\Tools\\copilot.exe',
    });
    expect(mockSpawnSync).toHaveBeenNthCalledWith(
      1,
      'copilot',
      ['--version'],
      { timeout: 5000, shell: false },
    );
    restorePlatform();
    mockSpawnSync.mockRestore();
  });

  it('detects an npm-installed Copilot .cmd shim through COMSPEC on Windows', () => {
    const mockSpawnSync = vi.mocked(spawnSync);
    const restorePlatform = setProcessPlatform('win32');
    const originalComspec = process.env.COMSPEC;
    process.env.COMSPEC = 'C:\\Windows\\System32\\cmd.exe';
    mockSpawnSync
      .mockReturnValueOnce({
        status: null,
        stdout: '',
        stderr: '',
        error: Object.assign(new Error('spawnSync copilot ENOENT'), { code: 'ENOENT' }),
        pid: 0,
        output: [],
        signal: null,
      } as any)
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
      version: 'GitHub Copilot CLI 1.0.71-3',
      path: 'C:\\Users\\me\\AppData\\Roaming\\npm\\copilot.cmd',
    });
    expect(mockSpawnSync).toHaveBeenNthCalledWith(
      3,
      'C:\\Windows\\System32\\cmd.exe',
      ['/d', '/s', '/c', '"C:\\Users\\me\\AppData\\Roaming\\npm\\copilot.cmd" --version'],
      { timeout: 5000 },
    );

    if (originalComspec === undefined) delete process.env.COMSPEC;
    else process.env.COMSPEC = originalComspec;
    restorePlatform();
    mockSpawnSync.mockRestore();
  });

  it('includes Copilot in all-provider detection', () => {
    const mockSpawnSync = vi.mocked(spawnSync);
    mockSpawnSync.mockReturnValue({ status: 1, stdout: '', stderr: '', pid: 0, output: [], signal: null } as any);
    const result = detectAllClis();
    expect(result.copilot).toEqual({ available: false });
    expect(mockSpawnSync).toHaveBeenCalledWith(
      'copilot',
      ['--version'],
      expect.objectContaining({ timeout: 5000 }),
    );
    mockSpawnSync.mockRestore();
  });
});
