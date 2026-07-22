import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const writeControl = vi.hoisted(() => ({
  fail: 'none' as 'none' | 'root' | 'session' | 'all',
}));

vi.mock('../../../lib/atomic-write.js', async () => {
  const actual = await vi.importActual<
    typeof import('../../../lib/atomic-write.js')
  >('../../../lib/atomic-write.js');
  return {
    ...actual,
    atomicWriteJsonSync: vi.fn((path: string, data: unknown) => {
      const sessionWrite = path.includes(`${sep}sessions${sep}`);
      if (
        writeControl.fail === 'all'
        || (writeControl.fail === 'root' && !sessionWrite)
        || (writeControl.fail === 'session' && sessionWrite)
      ) {
        throw new Error(`simulated ${writeControl.fail} write failure`);
      }
      actual.atomicWriteJsonSync(path, data);
    }),
  };
});

import {
  emptySkillActiveStateV2,
  mutateSkillActiveStateLocked,
  readSkillActiveStateNormalized,
  upsertWorkflowSkillSlot,
} from '../index.js';

describe('skill-state partial commit reconciliation', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'skill-partial-commit-'));
    execFileSync('git', ['init'], { cwd: tempDir, stdio: 'pipe' });
    writeControl.fail = 'none';
  });

  afterEach(() => {
    writeControl.fail = 'none';
    rmSync(tempDir, { recursive: true, force: true });
  });

  it.each(['root', 'session'] as const)(
    'reports repaired when only the %s counterpart fails',
    (failedCopy) => {
      const sessionId = `partial-${failedCopy}`;
      writeControl.fail = failedCopy;

      const result = mutateSkillActiveStateLocked(
        tempDir,
        sessionId,
        (current) => upsertWorkflowSkillSlot(current, 'ralph', {
          session_id: sessionId,
          started_at: '2026-07-20T11:00:00.000Z',
        }),
      );

      expect(result.status).toBe('repaired');
      expect(readSkillActiveStateNormalized(
        tempDir,
        sessionId,
      ).active_skills.ralph).toMatchObject({
        session_id: sessionId,
      });
      const rootPath = join(
        tempDir,
        '.omc',
        'state',
        'skill-active-state.json',
      );
      const sessionPath = join(
        tempDir,
        '.omc',
        'state',
        'sessions',
        sessionId,
        'skill-active-state.json',
      );
      expect(existsSync(
        failedCopy === 'root' ? sessionPath : rootPath,
      )).toBe(true);
    },
  );

  it('reports failed only when no authoritative copy lands', () => {
    writeControl.fail = 'all';
    const result = mutateSkillActiveStateLocked(
      tempDir,
      'partial-none',
      () => upsertWorkflowSkillSlot(
        emptySkillActiveStateV2(),
        'ralph',
        { session_id: 'partial-none' },
      ),
    );

    expect(result.status).toBe('failed');
  });
});
