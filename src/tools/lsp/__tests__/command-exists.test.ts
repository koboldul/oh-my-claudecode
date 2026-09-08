import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'child_process';

vi.mock('child_process', () => ({
  spawnSync: vi.fn()
}));

const mockSpawnSync = vi.mocked(spawnSync);

type SpawnSyncResult = ReturnType<typeof spawnSync>;

describe('commandExists PATH probe bounding', () => {
  beforeEach(() => {
    vi.resetModules();
    mockSpawnSync.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('bounds the where/which lookup and reports availability on exit 0', async () => {
    mockSpawnSync.mockReturnValue({ status: 0 } as SpawnSyncResult);

    const { commandExists } = await import('../servers.js');
    expect(commandExists('gopls')).toBe(true);

    const [command, args, options] = mockSpawnSync.mock.calls[0];
    expect(command).toBe(process.platform === 'win32' ? 'where' : 'which');
    expect(args).toEqual(['gopls']);
    expect(options).toMatchObject({
      timeout: 3000,
      killSignal: 'SIGKILL',
      windowsHide: true
    });
  });

  it('reports unavailable when the lookup errors', async () => {
    mockSpawnSync.mockReturnValue({
      status: null,
      error: new Error('spawn ENOENT')
    } as unknown as SpawnSyncResult);

    const { commandExists } = await import('../servers.js');
    expect(commandExists('gopls')).toBe(false);
  });

  it('reports unavailable when the lookup is killed by the timeout', async () => {
    mockSpawnSync.mockReturnValue({
      status: null,
      signal: 'SIGKILL'
    } as unknown as SpawnSyncResult);

    const { commandExists } = await import('../servers.js');
    expect(commandExists('gopls')).toBe(false);
  });
});
