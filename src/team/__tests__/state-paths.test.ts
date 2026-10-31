import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TeamPaths, absPath, normalizeTaskFileStem, withTeamStatePathScope } from '../state-paths.js';

describe('state-paths task/mailbox normalization', () => {
  it('normalizes numeric task ids to task-<id>.json', () => {
    expect(normalizeTaskFileStem('1')).toBe('task-1');
    expect(TeamPaths.taskFile('demo', '1')).toContain('/tasks/task-1.json');
  });

  it('keeps canonical task stem unchanged', () => {
    expect(normalizeTaskFileStem('task-42')).toBe('task-42');
    expect(TeamPaths.taskFile('demo', 'task-42')).toContain('/tasks/task-42.json');
  });

  it('uses canonical JSON mailbox path', () => {
    expect(TeamPaths.mailbox('demo', 'worker-1')).toBe('.omc/state/team/demo/mailbox/worker-1.json');
  });

  it('preserves absolute paths when resolving team state files', () => {
    expect(absPath('/workspace', '/already/absolute/path')).toBe('/already/absolute/path');
  });

  it('keeps overlapping operation roots isolated after the environment changes', async () => {
    const cwd = mkdtempSync(join(realpathSync(tmpdir()), 'omc-team-state-scope-'));
    const storageA = join(cwd, 'storage-a');
    const storageB = join(cwd, 'storage-b');
    const previousStateDir = process.env.OMC_STATE_DIR;
    mkdirSync(storageA, { recursive: true });
    mkdirSync(storageB, { recursive: true });
    const canonicalStorageA = realpathSync.native(storageA);
    const canonicalStorageB = realpathSync.native(storageB);
    writeFileSync(join(cwd, '.omc-workspace'), '{}');

    let releaseFirst!: () => void;
    const secondEntered = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    try {
      process.env.OMC_STATE_DIR = storageA;
      const first = withTeamStatePathScope(cwd, async () => {
        const before = absPath(cwd, TeamPaths.config('first'));
        await secondEntered;
        return [before, absPath(cwd, TeamPaths.config('first'))] as const;
      });

      process.env.OMC_STATE_DIR = storageB;
      const second = withTeamStatePathScope(cwd, async () => {
        const before = absPath(cwd, TeamPaths.config('second'));
        releaseFirst();
        await Promise.resolve();
        return [before, absPath(cwd, TeamPaths.config('second'))] as const;
      });

      const [firstPaths, secondPaths] = await Promise.all([first, second]);
      expect(firstPaths[1]).toBe(firstPaths[0]);
      expect(secondPaths[1]).toBe(secondPaths[0]);
      expect(firstPaths[0]).not.toBe(secondPaths[0]);
      expect(firstPaths[0].startsWith(canonicalStorageA)).toBe(true);
      expect(secondPaths[0].startsWith(canonicalStorageB)).toBe(true);
    } finally {
      if (previousStateDir === undefined) delete process.env.OMC_STATE_DIR;
      else process.env.OMC_STATE_DIR = previousStateDir;
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
