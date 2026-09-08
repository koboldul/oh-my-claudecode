import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { spawnSync } from 'child_process';

vi.mock('child_process', () => ({
  spawnSync: vi.fn()
}));

const mockSpawnSync = vi.mocked(spawnSync);

type SpawnSyncResult = ReturnType<typeof spawnSync>;

function dockerPsResult(stdout: string): SpawnSyncResult {
  return { status: 0, stdout } as SpawnSyncResult;
}

/** Result shape Node produces when a spawnSync timeout kills the child. */
function dockerKilledResult(): SpawnSyncResult {
  return { status: null, signal: 'SIGKILL', stdout: null } as unknown as SpawnSyncResult;
}

describe('devcontainer docker probe bounding and caching', () => {
  let workspaceRoot: string;

  beforeEach(() => {
    workspaceRoot = mkdtempSync(join(tmpdir(), 'omc-devcontainer-bound-'));
    delete process.env.OMC_LSP_CONTAINER_ID;
    vi.resetModules();
    mockSpawnSync.mockReset();
  });

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
    vi.restoreAllMocks();
    delete process.env.OMC_LSP_CONTAINER_ID;
  });

  it('bounds every docker probe with a finite timeout and hard kill', async () => {
    mockSpawnSync.mockReturnValue(dockerPsResult(''));

    const mod = await import('../devcontainer.js');
    mod.clearDevContainerContextCache();
    mod.resolveDevContainerContext(workspaceRoot);

    expect(mockSpawnSync).toHaveBeenCalledTimes(1);
    const [command, args, options] = mockSpawnSync.mock.calls[0];
    expect(command).toBe('docker');
    expect(args).toEqual(['ps', '-q']);
    expect(options).toMatchObject({
      timeout: 3000,
      killSignal: 'SIGKILL',
      windowsHide: true
    });
  });

  it('treats a killed docker probe as no devcontainer instead of throwing', async () => {
    mockSpawnSync.mockReturnValue(dockerKilledResult());

    const mod = await import('../devcontainer.js');
    mod.clearDevContainerContextCache();

    expect(() => mod.resolveDevContainerContext(workspaceRoot)).not.toThrow();
    expect(mod.resolveDevContainerContext(workspaceRoot)).toBeNull();
  });

  it('caches the negative result so two immediate calls run one docker probe', async () => {
    mockSpawnSync.mockReturnValue(dockerPsResult(''));

    const mod = await import('../devcontainer.js');
    mod.clearDevContainerContextCache();

    expect(mod.resolveDevContainerContext(workspaceRoot)).toBeNull();
    expect(mod.resolveDevContainerContext(workspaceRoot)).toBeNull();

    expect(mockSpawnSync).toHaveBeenCalledTimes(1);
  });

  it('inspects all running containers in one bounded docker invocation', async () => {
    mockSpawnSync.mockImplementation(
      (_command: string, args: ReadonlyArray<string> | undefined) => {
        if (args?.[0] === 'ps') {
          return dockerPsResult('one\ntwo\nthree\n');
        }
        if (args?.[0] === 'inspect') {
          return {
            status: 0,
            stdout: JSON.stringify([
              { Id: 'one', State: { Running: true }, Config: { Labels: {} }, Mounts: [] },
              { Id: 'two', State: { Running: true }, Config: { Labels: {} }, Mounts: [] },
              { Id: 'three', State: { Running: true }, Config: { Labels: {} }, Mounts: [] }
            ])
          } as SpawnSyncResult;
        }
        throw new Error(`Unexpected docker args: ${args}`);
      }
    );

    const mod = await import('../devcontainer.js');
    mod.clearDevContainerContextCache();
    expect(mod.resolveDevContainerContext(workspaceRoot)).toBeNull();

    expect(mockSpawnSync).toHaveBeenCalledTimes(2);
    expect(mockSpawnSync.mock.calls[1][1]).toEqual([
      'inspect',
      'one',
      'two',
      'three'
    ]);
  });

  it('keys the cache by workspace root and container override', async () => {
    mockSpawnSync.mockReturnValue(dockerPsResult(''));

    const mod = await import('../devcontainer.js');
    mod.clearDevContainerContextCache();

    const otherWorkspaceRoot = mkdtempSync(join(tmpdir(), 'omc-devcontainer-other-'));
    try {
      mod.resolveDevContainerContext(workspaceRoot);
      mod.resolveDevContainerContext(otherWorkspaceRoot);
      expect(mockSpawnSync).toHaveBeenCalledTimes(2);

      process.env.OMC_LSP_CONTAINER_ID = 'override-container';
      mockSpawnSync.mockReturnValue(dockerKilledResult());
      mod.resolveDevContainerContext(workspaceRoot);
      expect(mockSpawnSync).toHaveBeenCalledTimes(3);
    } finally {
      rmSync(otherWorkspaceRoot, { recursive: true, force: true });
    }
  });

  it('re-probes after the cache TTL expires so a newly started container is seen', async () => {
    vi.useFakeTimers();
    try {
      mockSpawnSync.mockReturnValue(dockerPsResult(''));

      const mod = await import('../devcontainer.js');
      mod.clearDevContainerContextCache();

      mod.resolveDevContainerContext(workspaceRoot);
      expect(mockSpawnSync).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(5001);

      mod.resolveDevContainerContext(workspaceRoot);
      expect(mockSpawnSync).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
