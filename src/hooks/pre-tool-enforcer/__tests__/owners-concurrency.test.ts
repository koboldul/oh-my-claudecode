import { spawn, execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  readSkillActiveStateNormalized,
} from '../../skill-state/index.js';
import {
  readReplayEvents,
  resetSessionStartTimes,
} from '../../subagent-tracker/session-replay.js';
import { clearWorktreeCache } from '../../../lib/worktree-paths.js';

const REPOSITORY_ROOT = fileURLToPath(
  new URL('../../../../', import.meta.url),
);
const SKILL_STATE_MODULE = new URL(
  '../../skill-state/index.ts',
  import.meta.url,
).href;
const REPLAY_MODULE = new URL(
  '../../subagent-tracker/session-replay.ts',
  import.meta.url,
).href;
const EFFECTS_MODULE = new URL('../effects.ts', import.meta.url).href;
const SNAPSHOT_MODULE = new URL('../snapshot.ts', import.meta.url).href;
const NORMALIZE_MODULE = new URL(
  '../../bridge-normalize.ts',
  import.meta.url,
).href;

let tempDir: string;

function runTypeScript(source: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', '--input-type=module', '--eval', source],
      {
        cwd: REPOSITORY_ROOT,
        stdio: ['ignore', 'ignore', 'pipe'],
      },
    );
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr || `child exited with ${code}`));
    });
  });
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'pretool-concurrency-'));
  execFileSync('git', ['init'], { cwd: tempDir, stdio: 'pipe' });
  clearWorktreeCache();
  resetSessionStartTimes();
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
  clearWorktreeCache();
  resetSessionStartTimes();
});

describe('PreToolUse owner concurrency', () => {
  it('preserves concurrent workflow and support-skill mutations', async () => {
    const sessionId = 'concurrent-skill-session';
    const directory = JSON.stringify(tempDir);
    const session = JSON.stringify(sessionId);
    const moduleUrl = JSON.stringify(SKILL_STATE_MODULE);

    await Promise.all([
      runTypeScript(`
        import {
          mutateSkillActiveStateLocked,
          upsertWorkflowSkillSlot,
        } from ${moduleUrl};
        const result = mutateSkillActiveStateLocked(
          ${directory},
          ${session},
          (current) => {
            const until = Date.now() + 200;
            while (Date.now() < until) {}
            return upsertWorkflowSkillSlot(current, 'autopilot', {
              session_id: ${session},
            });
          },
        );
        if (result.status !== 'written') {
          throw new Error('workflow mutation failed: ' + result.status);
        }
      `),
      runTypeScript(`
        import { upsertSupportSkillActiveStateLocked } from ${moduleUrl};
        const result = upsertSupportSkillActiveStateLocked(
          ${directory},
          'plan',
          ${session},
          'oh-my-claudecode:plan',
          { intentId: 'concurrent-support-intent' },
        );
        if (result.status !== 'written') {
          throw new Error('support mutation failed: ' + result.status);
        }
      `),
    ]);

    const state = readSkillActiveStateNormalized(tempDir, sessionId);
    expect(state.active_skills.autopilot).toMatchObject({
      skill_name: 'autopilot',
      session_id: sessionId,
    });
    expect(state.support_skill).toMatchObject({
      skill_name: 'plan',
      session_id: sessionId,
    });
  });

  it('serializes concurrent ordinary replay appends into valid JSONL', async () => {
    const sessionId = 'concurrent-replay-session';
    const directory = JSON.stringify(tempDir);
    const session = JSON.stringify(sessionId);
    const moduleUrl = JSON.stringify(REPLAY_MODULE);

    await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        runTypeScript(`
          import { appendReplayEvent } from ${moduleUrl};
          const result = appendReplayEvent(${directory}, ${session}, {
            agent: 'worker-${index}',
            event: 'hook_fire',
            hook: 'concurrency-test',
          });
          if (result.status !== 'appended') {
            throw new Error('replay append failed: ' + result.status);
          }
        `),
      ),
    );

    const events = readReplayEvents(tempDir, sessionId);
    expect(events).toHaveLength(8);
    expect(new Set(events.map((event) => event.agent)).size).toBe(8);
  });

  it('atomically reserves force-delegation capacity across concurrent batches', async () => {
    const omcRoot = join(tempDir, '.omc');
    mkdirSync(omcRoot, { recursive: true });
    writeFileSync(join(omcRoot, 'config.json'), JSON.stringify({
      routing: {
        forceDelegation: {
          enforce: true,
          rules: [{
            pattern: 'Read',
            threshold: { count: 2, windowSeconds: 120 },
          }],
        },
      },
    }));
    const directoryArg = JSON.stringify(tempDir);
    const omcRootArg = JSON.stringify(omcRoot);
    const effectsModule = JSON.stringify(EFFECTS_MODULE);
    const snapshotModule = JSON.stringify(SNAPSHOT_MODULE);
    const normalizeModule = JSON.stringify(NORMALIZE_MODULE);
    const resultPaths = [
      join(tempDir, 'reservation-a.json'),
      join(tempDir, 'reservation-b.json'),
    ];

    await Promise.all(resultPaths.map((resultPath, index) =>
      runTypeScript(`
        import { writeFileSync } from 'node:fs';
        import { normalizeHookEnvelope } from ${normalizeModule};
        import { loadPreToolBatchSnapshot } from ${snapshotModule};
        import { reserveAndPlanPreToolBatch } from ${effectsModule};
        const envelope = normalizeHookEnvelope({
          hook_event_name: 'PreToolUse',
          session_id: 'force-reservation-session',
          cwd: ${directoryArg},
          tool_use_id: 'force-reservation-${index}',
          tool_name: 'Read',
          tool_input: { file_path: 'README.md' },
        }, 'pre-tool-use');
        const snapshot = loadPreToolBatchSnapshot(envelope, {
          environment: () => ({
            HOME: ${directoryArg},
            USERPROFILE: ${directoryArg},
          }),
          resolveOmcRoot: () => ${omcRootArg},
        });
        const result = reserveAndPlanPreToolBatch(envelope, snapshot);
        writeFileSync(
          ${JSON.stringify(resultPath)},
          JSON.stringify({
            status: result.status,
            decision: result.status === 'planned'
              ? result.plan.evaluations[0]?.decision
              : 'failed',
          }),
        );
      `),
    ));

    const decisions = resultPaths.map((path) =>
      (JSON.parse(readFileSync(path, 'utf8')) as {
        status: string;
        decision: string;
      }).decision,
    ).sort();
    expect(decisions).toEqual(['deny', 'pass']);
    const state = JSON.parse(readFileSync(
      join(
        tempDir,
        '.omc',
        'state',
        'force-agent-delegation-events.json',
      ),
      'utf8',
    )) as {
      version: number;
      generation: number;
      events: Array<{ disposition: string; intentId: string }>;
    };
    expect(state).toMatchObject({
      version: 3,
      generation: 2,
    });
    expect(state.events).toHaveLength(2);
    expect(state.events.every(
      (event) => event.disposition === 'reserved',
    )).toBe(true);
  });

  it('re-evaluates a delayed stale snapshot at lock time', async () => {
    const omcRoot = join(tempDir, '.omc');
    const stateDir = join(omcRoot, 'state');
    const readyPath = join(tempDir, 'stale-snapshot.ready');
    const committedPath = join(tempDir, 'recent-event.committed');
    const resultPath = join(tempDir, 'stale-snapshot-result.json');
    mkdirSync(omcRoot, { recursive: true });
    writeFileSync(join(omcRoot, 'config.json'), JSON.stringify({
      routing: {
        forceDelegation: {
          enforce: true,
          rules: [{
            pattern: 'Read',
            threshold: { count: 2, windowSeconds: 120 },
          }],
        },
      },
    }));
    const staleNowMs = Date.now() - 10 * 60_000;
    const recentNowSec = Math.floor(Date.now() / 1000);

    await Promise.all([
      runTypeScript(`
        import { existsSync, writeFileSync } from 'node:fs';
        import { normalizeHookEnvelope } from ${JSON.stringify(NORMALIZE_MODULE)};
        import { loadPreToolBatchSnapshot } from ${JSON.stringify(SNAPSHOT_MODULE)};
        import { reserveAndPlanPreToolBatch } from ${JSON.stringify(EFFECTS_MODULE)};
        const envelope = normalizeHookEnvelope({
          hook_event_name: 'PreToolUse',
          session_id: 'delayed-force-session',
          cwd: ${JSON.stringify(tempDir)},
          tool_use_id: 'delayed-force-call',
          tool_name: 'Read',
          tool_input: { file_path: 'README.md' },
        }, 'pre-tool-use');
        const snapshot = loadPreToolBatchSnapshot(envelope, {
          now: () => ${staleNowMs},
          environment: () => ({
            HOME: ${JSON.stringify(tempDir)},
            USERPROFILE: ${JSON.stringify(tempDir)},
          }),
          resolveOmcRoot: () => ${JSON.stringify(omcRoot)},
        });
        writeFileSync(${JSON.stringify(readyPath)}, 'ready');
        const deadline = Date.now() + 5000;
        while (
          !existsSync(${JSON.stringify(committedPath)})
          && Date.now() < deadline
        ) {}
        if (!existsSync(${JSON.stringify(committedPath)})) {
          throw new Error('recent force commit timeout');
        }
        const result = reserveAndPlanPreToolBatch(envelope, snapshot);
        writeFileSync(${JSON.stringify(resultPath)}, JSON.stringify({
          status: result.status,
          decision: result.status === 'planned'
            ? result.plan.evaluations[0]?.decision
            : 'failed',
        }));
      `),
      runTypeScript(`
        import { existsSync, writeFileSync } from 'node:fs';
        import { writeForceDelegationAttemptLocked } from ${JSON.stringify(EFFECTS_MODULE)};
        const deadline = Date.now() + 5000;
        while (
          !existsSync(${JSON.stringify(readyPath)})
          && Date.now() < deadline
        ) {}
        if (!existsSync(${JSON.stringify(readyPath)})) {
          throw new Error('stale snapshot readiness timeout');
        }
        const result = writeForceDelegationAttemptLocked({
          version: 1,
          intentId: 'recent-concurrent-force',
          originalIndex: 0,
          stateDir: ${JSON.stringify(stateDir)},
          toolName: 'Read',
          observedAtSec: ${recentNowSec},
        }, 'accepted');
        if (result.status !== 'written') {
          throw new Error('recent force commit failed: ' + result.status);
        }
        writeFileSync(${JSON.stringify(committedPath)}, 'committed');
      `),
    ]);

    expect(JSON.parse(readFileSync(resultPath, 'utf8'))).toEqual({
      status: 'planned',
      decision: 'deny',
    });
  });

  it('preserves newer force and advisory state from delayed processes', async () => {
    const stateDir = join(tempDir, '.omc', 'state');
    const marker = join(tempDir, 'newer-owner-commit.done');
    const stateDirArg = JSON.stringify(stateDir);
    const markerArg = JSON.stringify(marker);
    const effectsModule = JSON.stringify(EFFECTS_MODULE);
    const nowMs = Date.parse('2026-04-17T12:00:00.000Z');
    const nowSec = Math.floor(nowMs / 1000);

    await Promise.all([
      runTypeScript(`
        import { existsSync } from 'node:fs';
        import {
          claimAdvisoryThrottleLocked,
          writeForceDelegationAttemptLocked,
        } from ${effectsModule};
        const deadline = Date.now() + 5000;
        while (!existsSync(${markerArg}) && Date.now() < deadline) {}
        if (!existsSync(${markerArg})) throw new Error('newer commit timeout');
        const force = writeForceDelegationAttemptLocked({
          version: 1,
          intentId: 'delayed-force',
          originalIndex: 1,
          stateDir: ${stateDirArg},
          toolName: 'Read',
          observedAtSec: ${nowSec},
        }, 'rejected');
        if (force.status !== 'written') {
          throw new Error('delayed force failed: ' + force.status);
        }
        const advisory = claimAdvisoryThrottleLocked({
          version: 1,
          intentId: 'delayed-advisory',
          originalIndex: 1,
          stateDir: ${stateDirArg},
          sessionId: 'delayed-owner-session',
          message: 'Read multiple files in parallel.',
          messageHash: 'shared-message',
          nowMs: ${nowMs},
          cooldownMs: 300000,
        });
        if (advisory !== 'throttled') {
          throw new Error('delayed advisory was not throttled: ' + advisory);
        }
      `),
      runTypeScript(`
        import { writeFileSync } from 'node:fs';
        import {
          claimAdvisoryThrottleLocked,
          writeForceDelegationAttemptLocked,
        } from ${effectsModule};
        const force = writeForceDelegationAttemptLocked({
          version: 1,
          intentId: 'newer-force',
          originalIndex: 2,
          stateDir: ${stateDirArg},
          toolName: 'Write',
          observedAtSec: ${nowSec + 120},
        }, 'accepted');
        if (force.status !== 'written') {
          throw new Error('newer force failed: ' + force.status);
        }
        const advisory = claimAdvisoryThrottleLocked({
          version: 1,
          intentId: 'newer-advisory',
          originalIndex: 2,
          stateDir: ${stateDirArg},
          sessionId: 'delayed-owner-session',
          message: 'Read multiple files in parallel.',
          messageHash: 'shared-message',
          nowMs: ${nowMs + 60_000},
          cooldownMs: 300000,
        });
        if (advisory !== 'granted') {
          throw new Error('newer advisory failed: ' + advisory);
        }
        writeFileSync(${markerArg}, 'done');
      `),
    ]);

    const force = JSON.parse(readFileSync(
      join(stateDir, 'force-agent-delegation-events.json'),
      'utf8',
    )) as {
      version: number;
      generation: number;
      events: Array<{ intentId: string; t: number }>;
    };
    expect(force).toMatchObject({ version: 3, generation: 2 });
    expect(force.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ intentId: 'newer-force', t: nowSec + 120 }),
      expect.objectContaining({ intentId: 'delayed-force', t: nowSec }),
    ]));

    const advisory = JSON.parse(readFileSync(
      join(
        stateDir,
        'sessions',
        'delayed-owner-session',
        'pre-tool-advisory-throttle.json',
      ),
      'utf8',
    )) as {
      version: number;
      generation: number;
      entries: Record<string, {
        last_emitted_at_ms: number;
        intent_id: string;
      }>;
    };
    expect(advisory).toMatchObject({ version: 2, generation: 1 });
    expect(advisory.entries['shared-message']).toEqual({
      last_emitted_at_ms: nowMs + 60_000,
      message: 'Read multiple files in parallel.',
      intent_id: 'newer-advisory',
    });
  });
});
