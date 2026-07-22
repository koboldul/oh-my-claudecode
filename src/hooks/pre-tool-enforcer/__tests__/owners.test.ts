import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
const backgroundNotification = vi.hoisted(() => ({
  dispatch: vi.fn(),
}));
vi.mock('../../background-notifications.js', () => ({
  dispatchNotificationInBackground: backgroundNotification.dispatch,
}));
import {
  clearAllSkillActiveStateLocked,
  clearSkillActiveSessionStateLocked,
  emptySkillActiveStateV2,
  mutateSkillActiveStateLocked,
  readSkillActiveStateNormalized,
  resolveAuthoritativeWorkflowSkill,
  upsertSupportSkillActiveStateLocked,
  upsertWorkflowSkillSlot,
  writeSkillActiveStateCopies,
  type SkillActiveStateV2,
} from '../../skill-state/index.js';
import {
  appendReplayEvent,
  appendReplayEventOnce,
  readReplayEvents,
  resetSessionStartTimes,
} from '../../subagent-tracker/session-replay.js';
import {
  confirmModeAwaitingConfirmationLocked,
  writeStateFileLocked,
} from '../../../lib/mode-state-io.js';
import {
  acquireFileLockSync,
  releaseFileLockSync,
} from '../../../lib/file-lock.js';
import {
  clearWorktreeCache,
  getSessionStateDir,
  resolveSessionStatePaths,
} from '../../../lib/worktree-paths.js';
import {
  claimAdvisoryThrottleLocked,
  commitPreToolEffects,
  reserveAndPlanPreToolBatch,
  writeForceDelegationAttemptLocked,
} from '../effects.js';
import { loadPreToolBatchSnapshot } from '../snapshot.js';
import { normalizeHookEnvelope } from '../../bridge-normalize.js';
import {
  claimProvisionalNotificationReceipt,
  finalizeNotificationReceiptQueued,
  NOTIFICATION_PROVISIONAL_LEASE_MS,
  notifyOnce,
} from '../../../notifications/index.js';
import type {
  AdvisoryClaimEffectPayload,
  ForceDelegationAttemptEffectPayload,
} from '../types.js';
import { PRE_TOOL_EFFECT_PAYLOAD_VERSION } from '../types.js';
import type { HookReduction } from '../../hook-protocol.js';

const NOW_MS = Date.parse('2026-04-17T12:00:00.000Z');
const NOW_SEC = Math.floor(NOW_MS / 1000);
const NOTIFICATION_CHILD_PATH = join(
  process.cwd(),
  'scripts',
  'lib',
  'notification-child.cjs',
);

let tempDir: string;
let previousNodeEnv: string | undefined;
let previousStateDir: string | undefined;
let previousNotify: string | undefined;

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

function askUserReduction(
  directory: string,
  sessionId: string,
  intentId: string,
): HookReduction {
  return {
    decision: 'pass',
    retry: false,
    unchanged: true,
    contexts: [],
    diagnostics: [],
    mutations: [],
    mutationRetryHints: [],
    callDecisions: [],
    effects: [{
      type: 'pretool.ask-user-notify.v1',
      payload: {
        version: PRE_TOOL_EFFECT_PAYLOAD_VERSION,
        intentId,
        originalIndex: 0,
        directory,
        sessionId,
        question: 'Choose a path',
      },
      callId: `call-${intentId}`,
      commitOn: 'accepted',
      critical: false,
    }],
    stagedEffects: [],
  };
}

function writeNotificationMarkerRuntime(
  runtimePath: string,
  markerPath: string,
): void {
  writeFileSync(
    runtimePath,
    [
      "'use strict';",
      "const { appendFileSync } = require('node:fs');",
      'module.exports = {',
      '  async runHookNotificationChild(event, data) {',
      `    appendFileSync(${JSON.stringify(markerPath)},`,
      "      `${event}:${data.sessionId}\\n`, 'utf8');",
      '  },',
      '};',
      '',
    ].join('\n'),
    'utf8',
  );
}

function deliveryCount(markerPath: string): number {
  if (!existsSync(markerPath)) return 0;
  return readFileSync(markerPath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .length;
}

async function waitForDeliveryCount(
  markerPath: string,
  expected: number,
): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (deliveryCount(markerPath) === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  expect(deliveryCount(markerPath)).toBe(expected);
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'pretool-owners-'));
  execFileSync('git', ['init'], { cwd: tempDir, stdio: 'pipe' });
  previousNodeEnv = process.env.NODE_ENV;
  previousStateDir = process.env.OMC_STATE_DIR;
  previousNotify = process.env.OMC_NOTIFY;
  process.env.NODE_ENV = 'test';
  delete process.env.OMC_STATE_DIR;
  clearWorktreeCache();
  resetSessionStartTimes();
  backgroundNotification.dispatch.mockReset();
  backgroundNotification.dispatch.mockImplementation(async () => ({
    status: 'acknowledged',
    release: vi.fn(async () => 'released'),
    terminate: vi.fn(),
  }));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
  clearWorktreeCache();
  resetSessionStartTimes();
  if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previousNodeEnv;
  if (previousStateDir === undefined) delete process.env.OMC_STATE_DIR;
  else process.env.OMC_STATE_DIR = previousStateDir;
  if (previousNotify === undefined) delete process.env.OMC_NOTIFY;
  else process.env.OMC_NOTIFY = previousNotify;
  delete process.env.OMC_TEST_CONDITIONAL_WRITE_REPLACEMENT_PATH;
  delete process.env.OMC_TEST_CONDITIONAL_WRITE_REPLACEMENT_BASE64;
  delete process.env.OMC_TEST_SKILL_CLEAR_UNLINK_FAILURE_PATH;
  vi.restoreAllMocks();
});

describe('PreToolUse owner APIs', () => {
  it('semantically upserts support state without dropping v2 workflow slots', () => {
    const sessionId = 'support-owner-session';
    const workflowState: SkillActiveStateV2 = {
      ...emptySkillActiveStateV2(),
      active_skills: {
        autopilot: {
          skill_name: 'autopilot',
          started_at: '2026-04-17T10:00:00.000Z',
          completed_at: null,
          session_id: sessionId,
          mode_state_path: 'autopilot-state.json',
          initialized_mode: 'autopilot',
          initialized_state_path: '',
          initialized_session_state_path: '',
        },
      },
    };
    expect(
      writeSkillActiveStateCopies(tempDir, workflowState, sessionId),
    ).toBe(true);

    const result = upsertSupportSkillActiveStateLocked(
      tempDir,
      'plan',
      sessionId,
      'oh-my-claudecode:plan',
      {
        observedAt: '2026-04-17T12:00:00.000Z',
        intentId: 'support-intent-1',
      },
    );
    const replay = upsertSupportSkillActiveStateLocked(
      tempDir,
      'plan',
      sessionId,
      'oh-my-claudecode:plan',
      {
        observedAt: '2026-04-17T12:00:00.000Z',
        intentId: 'support-intent-1',
      },
    );
    const paths = resolveSessionStatePaths(
      'skill-active',
      sessionId,
      tempDir,
    );
    const root = readJson(paths.legacy);
    const session = readJson(paths.sessionScoped);

    expect(result.status).toBe('written');
    expect(replay.status).toBe('skipped');
    for (const state of [root, session]) {
      expect(state).toMatchObject({
        version: 2,
        active_skills: {
          autopilot: {
            skill_name: 'autopilot',
            completed_at: null,
          },
        },
        support_skill: {
          active: true,
          skill_name: 'plan',
          session_id: sessionId,
          last_intent_id: 'support-intent-1',
        },
      });
    }
  });

  it('keeps root repair ledgers and session-local skill state isolated', () => {
    const sessionA = 'skill-session-a';
    const sessionB = 'skill-session-b';
    expect(mutateSkillActiveStateLocked(
      tempDir,
      sessionA,
      (current) => upsertWorkflowSkillSlot(current, 'autopilot', {
        session_id: sessionA,
      }),
    ).status).toBe('written');
    expect(mutateSkillActiveStateLocked(
      tempDir,
      sessionB,
      (current) => upsertWorkflowSkillSlot(current, 'ralph', {
        session_id: sessionB,
      }),
    ).status).toBe('written');
    expect(upsertSupportSkillActiveStateLocked(
      tempDir,
      'plan',
      sessionA,
      'oh-my-claudecode:plan',
      { intentId: 'session-a-support' },
    ).status).toBe('written');
    expect(upsertSupportSkillActiveStateLocked(
      tempDir,
      'skill',
      sessionB,
      'oh-my-claudecode:skill',
      { intentId: 'session-b-support' },
    ).status).toBe('written');

    const stateA = readSkillActiveStateNormalized(tempDir, sessionA);
    const stateB = readSkillActiveStateNormalized(tempDir, sessionB);
    expect(Object.keys(stateA.active_skills)).toEqual(['autopilot']);
    expect(stateA.support_skill?.skill_name).toBe('plan');
    expect(Object.keys(stateB.active_skills)).toEqual(['ralph']);
    expect(stateB.support_skill?.skill_name).toBe('skill');

    const root = readJson(
      resolveSessionStatePaths('skill-active', sessionA, tempDir).legacy,
    ) as {
      session_ledgers: Record<string, {
        active_skills: Record<string, unknown>;
        support_skill?: { skill_name?: string };
      }>;
    };
    expect(Object.keys(root.session_ledgers)).toEqual(
      expect.arrayContaining([sessionA, sessionB]),
    );
    expect(Object.keys(root.session_ledgers[sessionA].active_skills))
      .toEqual(['autopilot']);
    expect(root.session_ledgers[sessionA].support_skill?.skill_name)
      .toBe('plan');
    expect(Object.keys(root.session_ledgers[sessionB].active_skills))
      .toEqual(['ralph']);
    expect(root.session_ledgers[sessionB].support_skill?.skill_name)
      .toBe('skill');
  });

  it('projects newer live workflow slots over older high-generation tombstones', () => {
    const tombstoneSession = 'projection-old-session';
    const liveSession = 'projection-new-session';
    for (let generation = 0; generation < 5; generation += 1) {
      expect(mutateSkillActiveStateLocked(
        tempDir,
        tombstoneSession,
        (current) => upsertWorkflowSkillSlot(current, 'ralph', {
          session_id: tombstoneSession,
          started_at: '2026-04-17T08:00:00.000Z',
          completed_at: '2026-04-17T10:00:00.000Z',
          source: `old-generation-${generation}`,
        }),
      ).status).toBe('written');
    }
    expect(mutateSkillActiveStateLocked(
      tempDir,
      liveSession,
      (current) => upsertWorkflowSkillSlot(current, 'ralph', {
        session_id: liveSession,
        started_at: '2026-04-17T11:00:00.000Z',
        completed_at: null,
      }),
    ).status).toBe('written');

    const root = readJson(resolveSessionStatePaths(
      'skill-active',
      liveSession,
      tempDir,
    ).legacy) as {
      active_skills: Record<string, {
        session_id: string;
        completed_at?: string | null;
      }>;
      session_ledgers: Record<string, { generation: number }>;
    };
    expect(root.session_ledgers[tombstoneSession].generation)
      .toBeGreaterThan(root.session_ledgers[liveSession].generation);
    expect(root.active_skills.ralph).toMatchObject({
      session_id: liveSession,
      completed_at: null,
    });
  });

  it('fails closed for invalid nonempty skill-state session IDs', () => {
    expect(upsertSupportSkillActiveStateLocked(
      tempDir,
      'plan',
      undefined,
      'oh-my-claudecode:plan',
    ).status).toBe('written');
    const rootBefore = readSkillActiveStateNormalized(tempDir);

    expect(readSkillActiveStateNormalized(tempDir, '../invalid'))
      .toEqual(emptySkillActiveStateV2());
    expect(mutateSkillActiveStateLocked(
      tempDir,
      '../invalid',
      (current) => upsertWorkflowSkillSlot(current, 'autopilot'),
    ).status).toBe('failed');
    expect(readSkillActiveStateNormalized(tempDir)).toEqual(rootBefore);
  });

  it('clears canonical and local skill-active copies under both owner locks', () => {
    const sessionId = 'dual-root-clear-session';
    process.env.OMC_STATE_DIR = join(tempDir, 'centralized-state');
    clearWorktreeCache();
    expect(mutateSkillActiveStateLocked(
      tempDir,
      sessionId,
      (current) => upsertWorkflowSkillSlot(current, 'ralph', {
        session_id: sessionId,
      }),
    ).status).toBe('written');
    const canonical = resolveSessionStatePaths(
      'skill-active',
      sessionId,
      tempDir,
    );
    const localRoot = join(
      tempDir,
      '.omc',
      'state',
      'skill-active-state.json',
    );
    const localSession = join(
      tempDir,
      '.omc',
      'state',
      'sessions',
      sessionId,
      'skill-active-state.json',
    );
    const legacy = {
      active: true,
      skill_name: 'plan',
      session_id: sessionId,
      started_at: '2026-07-20T10:00:00.000Z',
      last_checked_at: '2026-07-20T10:00:00.000Z',
      reinforcement_count: 0,
      max_reinforcements: 5,
      stale_ttl_ms: 900_000,
    };
    mkdirSync(dirname(localSession), { recursive: true });
    writeFileSync(localRoot, JSON.stringify(legacy));
    writeFileSync(localSession, JSON.stringify(legacy));

    expect(clearSkillActiveSessionStateLocked(tempDir, sessionId))
      .toBe(true);
    expect(existsSync(canonical.sessionScoped)).toBe(false);
    expect(existsSync(localSession)).toBe(false);
    expect(existsSync(localRoot)).toBe(false);
    if (existsSync(canonical.legacy)) {
      expect(
        (readJson(canonical.legacy).session_ledgers as
          | Record<string, unknown>
          | undefined)?.[sessionId],
      ).toBeUndefined();
    }
  });

  it('reports skill-active clear failure when any applicable owner lock is unavailable', () => {
    const sessionId = 'dual-root-clear-blocked';
    process.env.OMC_STATE_DIR = join(tempDir, 'centralized-state');
    clearWorktreeCache();
    expect(mutateSkillActiveStateLocked(
      tempDir,
      sessionId,
      (current) => upsertWorkflowSkillSlot(current, 'ralph', {
        session_id: sessionId,
      }),
    ).status).toBe('written');
    const localRoot = join(
      tempDir,
      '.omc',
      'state',
      'skill-active-state.json',
    );
    mkdirSync(dirname(localRoot), { recursive: true });
    writeFileSync(localRoot, JSON.stringify({
      active: true,
      skill_name: 'plan',
      session_id: sessionId,
    }));
    const held = acquireFileLockSync(`${localRoot}.mutation.lock`);
    expect(held).not.toBeNull();
    try {
      expect(clearSkillActiveSessionStateLocked(tempDir, sessionId))
        .toBe(false);
      expect(existsSync(localRoot)).toBe(true);
      expect(readSkillActiveStateNormalized(tempDir, sessionId)
        .active_skills.ralph).toBeDefined();
    } finally {
      releaseFileLockSync(held!);
    }
  });

  it('commits a durable tombstone when a session copy cannot be removed', () => {
    const sessionId = 'partial-skill-clear-session';
    expect(mutateSkillActiveStateLocked(
      tempDir,
      sessionId,
      (current) => upsertWorkflowSkillSlot(current, 'ralph', {
        session_id: sessionId,
      }),
    ).status).toBe('written');
    const paths = resolveSessionStatePaths(
      'skill-active',
      sessionId,
      tempDir,
    );
    process.env.OMC_TEST_SKILL_CLEAR_UNLINK_FAILURE_PATH =
      paths.sessionScoped;

    expect(clearSkillActiveSessionStateLocked(tempDir, sessionId))
      .toBe(true);
    expect(existsSync(paths.sessionScoped)).toBe(true);
    expect(readJson(paths.legacy)).toMatchObject({
      session_tombstones: {
        [sessionId]: 2,
      },
    });
    expect(readSkillActiveStateNormalized(tempDir, sessionId))
      .toMatchObject({
        generation: 2,
        active_skills: {},
        support_skill: null,
      });

    delete process.env.OMC_TEST_SKILL_CLEAR_UNLINK_FAILURE_PATH;
    expect(mutateSkillActiveStateLocked(
      tempDir,
      sessionId,
      (current) => upsertWorkflowSkillSlot(current, 'autopilot', {
        session_id: sessionId,
      }),
    ).status).toBe('written');
    expect(readJson(paths.legacy).session_tombstones ?? {})
      .not.toHaveProperty(sessionId);
    expect(readSkillActiveStateNormalized(tempDir, sessionId)
      .active_skills.autopilot).toBeDefined();
  });

  it('validates every skill clear copy before deleting any of them', () => {
    const sessionId = 'skill-clear-preflight-session';
    process.env.OMC_STATE_DIR = join(tempDir, 'centralized-state');
    clearWorktreeCache();
    expect(mutateSkillActiveStateLocked(
      tempDir,
      sessionId,
      (current) => upsertWorkflowSkillSlot(current, 'ralph', {
        session_id: sessionId,
      }),
    ).status).toBe('written');
    const canonical = resolveSessionStatePaths(
      'skill-active',
      sessionId,
      tempDir,
    );
    const localRoot = join(
      tempDir,
      '.omc',
      'state',
      'skill-active-state.json',
    );
    mkdirSync(dirname(localRoot), { recursive: true });
    writeFileSync(localRoot, '{corrupt');

    expect(clearSkillActiveSessionStateLocked(tempDir, sessionId))
      .toBe(false);
    expect(existsSync(canonical.legacy)).toBe(true);
    expect(existsSync(canonical.sessionScoped)).toBe(true);
    expect(readFileSync(localRoot, 'utf8')).toBe('{corrupt');
  });

  it('fails closed when skill generations cannot advance safely', () => {
    const sessionId = 'skill-generation-overflow';
    const paths = resolveSessionStatePaths(
      'skill-active',
      sessionId,
      tempDir,
    );
    const support = {
      active: true,
      skill_name: 'plan',
      session_id: sessionId,
      started_at: '2026-04-17T10:00:00.000Z',
      last_checked_at: '2026-04-17T10:00:00.000Z',
      reinforcement_count: 0,
      max_reinforcements: 5,
      stale_ttl_ms: 900_000,
    };
    const ledger = {
      generation: Number.MAX_SAFE_INTEGER,
      seen_intents: [],
      active_skills: {},
      support_skill: support,
    };
    mkdirSync(dirname(paths.sessionScoped), { recursive: true });
    writeFileSync(paths.legacy, JSON.stringify({
      version: 2,
      active_skills: {},
      session_ledgers: {
        [sessionId]: ledger,
      },
    }));
    writeFileSync(paths.sessionScoped, JSON.stringify({
      version: 2,
      generation: Number.MAX_SAFE_INTEGER,
      seen_intents: [],
      active_skills: {},
      support_skill: support,
    }));

    expect(mutateSkillActiveStateLocked(
      tempDir,
      sessionId,
      (current) => ({ ...current, support_skill: null }),
    ).status).toBe('failed');
    expect(clearSkillActiveSessionStateLocked(tempDir, sessionId))
      .toBe(false);
    expect(readSkillActiveStateNormalized(tempDir, sessionId)
      .support_skill?.skill_name).toBe('plan');
  });

  it('distinguishes missing skill session directories from enumeration failure', () => {
    expect(upsertSupportSkillActiveStateLocked(
      tempDir,
      'plan',
      undefined,
      'oh-my-claudecode:plan',
    ).status).toBe('written');
    const rootPath = resolveSessionStatePaths(
      'skill-active',
      'unused-session',
      tempDir,
    ).legacy;
    const sessionsPath = join(dirname(rootPath), 'sessions');
    writeFileSync(sessionsPath, 'not a directory');

    expect(clearAllSkillActiveStateLocked(tempDir)).toBe(false);
    expect(existsSync(rootPath)).toBe(true);
  });

  it('routes bridge and persistent workflow RMW paths through the skill owner', () => {
    const bridgeSource = readFileSync(
      new URL('../../bridge.ts', import.meta.url),
      'utf8',
    );
    const persistentSource = readFileSync(
      new URL('../../persistent-mode/index.ts', import.meta.url),
      'utf8',
    );

    expect(bridgeSource).not.toContain('writeSkillActiveStateCopies');
    expect(bridgeSource).toContain('mutateSkillActiveStateLocked');
    expect(persistentSource).not.toContain('writeSkillActiveStateCopies');
    expect(persistentSource).toContain('mutateSkillActiveStateLocked');
  });

  it('bounds seen intents and repairs divergent generations idempotently', () => {
    const sessionId = 'skill-generation-session';
    for (let index = 0; index < 140; index += 1) {
      expect(upsertSupportSkillActiveStateLocked(
        tempDir,
        'plan',
        sessionId,
        'oh-my-claudecode:plan',
        {
          observedAt: new Date(NOW_MS + index).toISOString(),
          intentId: `support-intent-${index}`,
        },
      ).status).toBe('written');
    }

    const paths = resolveSessionStatePaths(
      'skill-active',
      sessionId,
      tempDir,
    );
    const root = readJson(paths.legacy) as {
      session_ledgers: Record<string, {
        generation: number;
        seen_intents: string[];
      }>;
    };
    const session = readJson(paths.sessionScoped) as {
      generation: number;
      seen_intents: string[];
    };
    const authoritative = root.session_ledgers[sessionId];
    expect(authoritative.seen_intents).toHaveLength(128);
    expect(authoritative.seen_intents[0]).toBe('support-intent-12');
    expect(session.generation).toBe(authoritative.generation);
    expect(session.seen_intents).toEqual(authoritative.seen_intents);

    writeFileSync(paths.sessionScoped, JSON.stringify({
      ...session,
      generation: session.generation - 1,
      seen_intents: session.seen_intents.slice(0, -1),
    }));
    const repair = upsertSupportSkillActiveStateLocked(
      tempDir,
      'plan',
      sessionId,
      'oh-my-claudecode:plan',
      {
        observedAt: new Date(NOW_MS + 139).toISOString(),
        intentId: 'support-intent-139',
      },
    );
    const repairedSession = readJson(paths.sessionScoped) as {
      generation: number;
      seen_intents: string[];
    };

    expect(repair.status).toBe('repaired');
    expect(repairedSession.generation).toBe(authoritative.generation);
    expect(repairedSession.seen_intents).toEqual(
      authoritative.seen_intents,
    );
  });

  it('treats whitespace-only workflow completion as non-terminal', () => {
    const sessionId = 'whitespace-completion-session';
    const state = upsertWorkflowSkillSlot(
      emptySkillActiveStateV2(),
      'autopilot',
      {
        session_id: sessionId,
        completed_at: '   ',
      },
    );

    expect(resolveAuthoritativeWorkflowSkill(state)?.skill_name)
      .toBe('autopilot');
  });

  it('clears both confirmation fields in owned root and session copies', () => {
    const sessionId = 'mode-owner-session';
    const paths = resolveSessionStatePaths('ralph', sessionId, tempDir);
    for (const path of [paths.legacy, paths.sessionScoped]) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, JSON.stringify({
        active: true,
        awaiting_confirmation: true,
        awaiting_confirmation_set_at: '2026-04-17T11:59:00.000Z',
        session_id: sessionId,
        marker: path,
      }));
    }

    const result = confirmModeAwaitingConfirmationLocked(
      tempDir,
      'ralph',
      sessionId,
    );

    expect(result.status).toBe('written');
    for (const path of [paths.legacy, paths.sessionScoped]) {
      const state = readJson(path);
      expect(state.awaiting_confirmation).toBeUndefined();
      expect(state.awaiting_confirmation_set_at).toBeUndefined();
      expect(state.marker).toBe(path);
    }
  });

  it('preserves a concurrent replacement owned by another session', () => {
    const sessionId = 'original-session';
    const paths = resolveSessionStatePaths('ralph', sessionId, tempDir);
    const original = {
      active: true,
      awaiting_confirmation: true,
      awaiting_confirmation_set_at: '2026-04-17T11:59:00.000Z',
      session_id: sessionId,
    };
    const replacement = {
      active: true,
      awaiting_confirmation: true,
      awaiting_confirmation_set_at: '2026-04-17T12:00:00.000Z',
      session_id: 'replacement-session',
      generation: 2,
    };
    for (const path of [paths.legacy, paths.sessionScoped]) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, JSON.stringify(original));
    }
    process.env.OMC_TEST_CONDITIONAL_WRITE_REPLACEMENT_PATH =
      paths.sessionScoped;
    process.env.OMC_TEST_CONDITIONAL_WRITE_REPLACEMENT_BASE64 =
      Buffer.from(JSON.stringify(replacement)).toString('base64');
    writeFileSync(paths.legacy, JSON.stringify({
      ...original,
      session_id: 'foreign-root-session',
    }));

    const result = confirmModeAwaitingConfirmationLocked(
      tempDir,
      'ralph',
      sessionId,
    );

    expect(result.status).toBe('skipped');
    expect(readJson(paths.sessionScoped)).toEqual(replacement);
    expect(readJson(paths.legacy)).toMatchObject({
      awaiting_confirmation: true,
      session_id: 'foreign-root-session',
    });
  });

  it('reports changed mode identity and succeeds after a fresh retry', () => {
    const sessionId = 'mode-cas-session';
    const paths = resolveSessionStatePaths('ralph', sessionId, tempDir);
    const observed = {
      active: true,
      awaiting_confirmation: true,
      awaiting_confirmation_set_at: '2026-04-17T11:59:00.000Z',
      session_id: sessionId,
      generation: 1,
    };
    const newer = {
      ...observed,
      awaiting_confirmation_set_at: '2026-04-17T12:00:00.000Z',
      generation: 2,
    };
    mkdirSync(dirname(paths.sessionScoped), { recursive: true });
    writeFileSync(paths.sessionScoped, JSON.stringify(newer));

    const stale = confirmModeAwaitingConfirmationLocked(
      tempDir,
      'ralph',
      sessionId,
      {
        path: paths.sessionScoped,
        ownerSessionId: sessionId,
        generation: 1,
        confirmationTimestamp: observed.awaiting_confirmation_set_at,
        digest: createHash('sha256')
          .update(JSON.stringify(observed))
          .digest('hex'),
      },
    );
    expect(stale.status).toBe('changed');
    expect(readJson(paths.sessionScoped)).toEqual(newer);

    const current = confirmModeAwaitingConfirmationLocked(
      tempDir,
      'ralph',
      sessionId,
      {
        path: paths.sessionScoped,
        ownerSessionId: sessionId,
        generation: 2,
        confirmationTimestamp: newer.awaiting_confirmation_set_at,
        digest: createHash('sha256')
          .update(JSON.stringify(newer))
          .digest('hex'),
      },
    );
    expect(current.status).toBe('written');
    expect(readJson(paths.sessionScoped)).toEqual({
      active: true,
      session_id: sessionId,
      generation: 2,
    });
  });

  it('verifies missing or already-cleared mode state as not applicable', () => {
    const sessionId = 'mode-not-applicable-session';
    const paths = resolveSessionStatePaths('ralph', sessionId, tempDir);
    const missing = confirmModeAwaitingConfirmationLocked(
      tempDir,
      'ralph',
      sessionId,
      {
        path: paths.sessionScoped,
        ownerSessionId: '',
        generation: null,
        confirmationTimestamp: '',
        digest: createHash('sha256').update('null').digest('hex'),
      },
    );
    expect(missing.status).toBe('not-applicable');

    mkdirSync(dirname(paths.sessionScoped), { recursive: true });
    writeFileSync(paths.sessionScoped, JSON.stringify({
      active: true,
      session_id: sessionId,
      generation: 3,
    }));
    const cleared = confirmModeAwaitingConfirmationLocked(
      tempDir,
      'ralph',
      sessionId,
      {
        path: paths.sessionScoped,
        ownerSessionId: sessionId,
        generation: 3,
        confirmationTimestamp: '',
        digest: 'stale-digest',
      },
    );
    expect(cleared.status).toBe('not-applicable');
  });

  it('fails observed mode confirmation when its owner lock is unavailable', () => {
    const sessionId = 'mode-lock-failure-session';
    const paths = resolveSessionStatePaths('ralph', sessionId, tempDir);
    const observed = {
      active: true,
      awaiting_confirmation: true,
      awaiting_confirmation_set_at: '2026-04-17T11:59:00.000Z',
      session_id: sessionId,
      generation: 1,
    };
    mkdirSync(dirname(paths.sessionScoped), { recursive: true });
    writeFileSync(paths.sessionScoped, JSON.stringify(observed));
    const lock = acquireFileLockSync(
      `${paths.sessionScoped}.mutation.lock`,
    );
    expect(lock).not.toBeNull();
    try {
      expect(confirmModeAwaitingConfirmationLocked(
        tempDir,
        'ralph',
        sessionId,
        {
          path: paths.sessionScoped,
          ownerSessionId: sessionId,
          generation: 1,
          confirmationTimestamp:
            observed.awaiting_confirmation_set_at,
          digest: createHash('sha256')
            .update(JSON.stringify(observed))
            .digest('hex'),
        },
      ).status).toBe('failed');
      expect(readJson(paths.sessionScoped)).toEqual(observed);
    } finally {
      releaseFileLockSync(lock!);
    }
  });

  it('confirms an explicitly owned root observation under exact CAS', () => {
    const sessionId = 'root-mode-cas-session';
    const paths = resolveSessionStatePaths('ralph', sessionId, tempDir);
    const observed = {
      active: true,
      awaiting_confirmation: true,
      awaiting_confirmation_set_at: '2026-04-17T11:59:00.000Z',
      session_id: sessionId,
      generation: 4,
    };
    mkdirSync(dirname(paths.legacy), { recursive: true });
    writeFileSync(paths.legacy, JSON.stringify(observed));

    const result = confirmModeAwaitingConfirmationLocked(
      tempDir,
      'ralph',
      sessionId,
      {
        path: paths.legacy,
        ownerSessionId: sessionId,
        generation: 4,
        confirmationTimestamp: observed.awaiting_confirmation_set_at,
        digest: createHash('sha256')
          .update(JSON.stringify(observed))
          .digest('hex'),
      },
    );

    expect(result.status).toBe('written');
    expect(readJson(paths.legacy)).toEqual({
      active: true,
      session_id: sessionId,
      generation: 4,
    });
  });

  it('rejects ownerless or foreign transactional mode confirmations', () => {
    const sessionId = 'strict-mode-owner-session';
    const paths = resolveSessionStatePaths('ralph', sessionId, tempDir);
    const ownerless = {
      active: true,
      awaiting_confirmation: true,
      awaiting_confirmation_set_at: '2026-04-17T11:59:00.000Z',
      generation: 1,
    };
    mkdirSync(dirname(paths.sessionScoped), { recursive: true });
    writeFileSync(paths.sessionScoped, JSON.stringify(ownerless));
    const digest = createHash('sha256')
      .update(JSON.stringify(ownerless))
      .digest('hex');

    expect(confirmModeAwaitingConfirmationLocked(
      tempDir,
      'ralph',
      sessionId,
      {
        path: paths.sessionScoped,
        ownerSessionId: '',
        generation: 1,
        confirmationTimestamp: ownerless.awaiting_confirmation_set_at,
        digest,
      },
    ).status).toBe('failed');
    expect(confirmModeAwaitingConfirmationLocked(
      tempDir,
      'ralph',
      sessionId,
      {
        path: paths.sessionScoped,
        ownerSessionId: 'foreign-session',
        generation: 1,
        confirmationTimestamp: ownerless.awaiting_confirmation_set_at,
        digest,
      },
    ).status).toBe('failed');
    expect(readJson(paths.sessionScoped)).toEqual(ownerless);
  });

  it('fails mutation owners rather than executing while the lock is held', () => {
    const statePath = join(
      tempDir,
      '.omc',
      'state',
      'portable-lock-state.json',
    );
    mkdirSync(dirname(statePath), { recursive: true });
    writeFileSync(statePath, JSON.stringify({ value: 'original' }));
    const lock = acquireFileLockSync(`${statePath}.mutation.lock`);
    expect(lock).not.toBeNull();
    try {
      expect(writeStateFileLocked(statePath, { value: 'replacement' }))
        .toBe(false);
      expect(readJson(statePath)).toEqual({ value: 'original' });
    } finally {
      releaseFileLockSync(lock!);
    }

    const skillPath = resolveSessionStatePaths(
      'skill-active',
      'locked-skill-session',
      tempDir,
    ).legacy;
    const skillLock = acquireFileLockSync(`${skillPath}.mutation.lock`);
    expect(skillLock).not.toBeNull();
    try {
      expect(upsertSupportSkillActiveStateLocked(
        tempDir,
        'plan',
        'locked-skill-session',
        'oh-my-claudecode:plan',
        { intentId: 'locked-skill-intent' },
      ).status).toBe('failed');
      expect(existsSync(skillPath)).toBe(false);
    } finally {
      releaseFileLockSync(skillLock!);
    }
  });

  it('appends replay attempts once and reconciles final disposition in place', () => {
    const sessionId = 'replay-owner-session';
    const event = {
      agent: 'system',
      event: 'skill_invoked' as const,
      skill_name: 'oh-my-claudecode:plan',
      skill_source: 'pre-tool-use',
      attempt: true,
      disposition: 'accepted' as const,
      observed_at: '2026-04-17T12:00:00.000Z',
    };

    expect(appendReplayEventOnce(
      tempDir,
      sessionId,
      'trace-intent-1',
      event,
      NOW_MS,
    ).status).toBe('appended');
    expect(appendReplayEventOnce(
      tempDir,
      sessionId,
      'trace-intent-1',
      event,
      NOW_MS,
    ).status).toBe('duplicate');
    expect(appendReplayEventOnce(
      tempDir,
      sessionId,
      'trace-intent-1',
      {
        ...event,
        disposition: 'rejected',
        observed_at: '2026-04-17T12:01:00.000Z',
      },
      NOW_MS + 60_000,
    ).status).toBe('reconciled');

    const events = readReplayEvents(tempDir, sessionId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      intent_id: 'trace-intent-1',
      attempt: true,
      disposition: 'rejected',
      observed_at: '2026-04-17T12:00:00.000Z',
      t: 0,
    });
  });

  it('uses the replay owner for ordinary appends', () => {
    const sessionId = 'replay-lock-session';
    const replayPath = join(
      tempDir,
      '.omc',
      'state',
      `agent-replay-${sessionId}.jsonl`,
    );
    const lock = acquireFileLockSync(`${replayPath}.mutation.lock`);
    expect(lock).not.toBeNull();
    try {
      expect(appendReplayEvent(tempDir, sessionId, {
        agent: 'system',
        event: 'hook_fire',
      }).status).toBe('failed');
      expect(existsSync(replayPath)).toBe(false);
    } finally {
      releaseFileLockSync(lock!);
    }
  });

  it('atomically bounds and reconciles force-delegation attempts', () => {
    const stateDir = join(tempDir, '.omc', 'state');
    const statePath = join(
      stateDir,
      'force-agent-delegation-events.json',
    );
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(statePath, JSON.stringify({
      version: 2,
      events: Array.from({ length: 2_100 }, (_, index) => ({
        tool: 'Read',
        t: NOW_SEC - (index % 100),
        originalIndex: index,
        intentId: `old-${index}`,
        disposition: 'accepted',
      })),
    }));
    const payload: ForceDelegationAttemptEffectPayload = {
      version: 1,
      intentId: 'force-intent-1',
      originalIndex: 2_101,
      stateDir,
      toolName: 'Read',
      observedAtSec: NOW_SEC,
    };

    expect(
      writeForceDelegationAttemptLocked(payload, 'accepted').status,
    ).toBe('written');
    expect(
      writeForceDelegationAttemptLocked(payload, 'accepted').status,
    ).toBe('duplicate');
    expect(
      writeForceDelegationAttemptLocked({
        ...payload,
        observedAtSec: NOW_SEC + 60,
      }, 'rejected').status,
    ).toBe('reconciled');

    const state = readJson(statePath) as {
      version: number;
      generation: number;
      events: Array<Record<string, unknown>>;
    };
    expect(state).toMatchObject({ version: 3, generation: 2 });
    expect(state.events).toHaveLength(2_000);
    expect(state.events.find(
      (event) => event.intentId === payload.intentId,
    )).toMatchObject({
      disposition: 'rejected',
      originalIndex: 2_101,
      t: NOW_SEC,
    });
    if (process.platform !== 'win32') {
      expect(statSync(statePath).mode & 0o777).toBe(0o600);
    }
  });

  it('preserves force entries newer than a payload delayed over five minutes', () => {
    const stateDir = join(tempDir, '.omc', 'state');
    const statePath = join(
      stateDir,
      'force-agent-delegation-events.json',
    );
    const commitNowMs = NOW_MS + 10 * 60_000;
    const newerEventSec = NOW_SEC + 9 * 60;
    vi.spyOn(Date, 'now').mockReturnValue(commitNowMs);
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(statePath, JSON.stringify({
      version: 2,
      events: [{
        tool: 'Write',
        t: newerEventSec,
        originalIndex: 8,
        intentId: 'newer-force-intent',
        disposition: 'accepted',
      }],
    }));

    expect(writeForceDelegationAttemptLocked({
      version: 1,
      intentId: 'delayed-force-intent',
      originalIndex: 1,
      stateDir,
      toolName: 'Read',
      observedAtSec: NOW_SEC,
    }, 'rejected').status).toBe('written');

    const state = readJson(statePath) as {
      version: number;
      generation: number;
      events: Array<Record<string, unknown>>;
    };
    expect(state).toMatchObject({ version: 3, generation: 1 });
    expect(state.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        intentId: 'newer-force-intent',
        t: newerEventSec,
      }),
      expect.objectContaining({
        intentId: 'delayed-force-intent',
        t: NOW_SEC,
        disposition: 'rejected',
      }),
    ]));
  });

  it('uses the fresh lock-time horizon for stale force snapshots', () => {
    const omcRoot = join(tempDir, '.omc');
    const stateDir = join(omcRoot, 'state');
    const statePath = join(
      stateDir,
      'force-agent-delegation-events.json',
    );
    const lockNowMs = NOW_MS + 10 * 60_000;
    const lockNowSec = Math.floor(lockNowMs / 1000);
    mkdirSync(stateDir, { recursive: true });
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
    writeFileSync(statePath, JSON.stringify({
      version: 3,
      generation: 7,
      events: [{
        tool: 'Read',
        t: lockNowSec - 60,
        originalIndex: 0,
        intentId: 'recent-lock-time-event',
        disposition: 'accepted',
      }],
    }));
    const envelope = normalizeHookEnvelope({
      hook_event_name: 'PreToolUse',
      session_id: 'stale-force-snapshot',
      cwd: tempDir,
      tool_use_id: 'stale-force-call',
      tool_name: 'Read',
      tool_input: { file_path: 'README.md' },
    }, 'pre-tool-use');
    const snapshot = loadPreToolBatchSnapshot(envelope, {
      now: () => NOW_MS,
      environment: () => ({
        HOME: tempDir,
        USERPROFILE: tempDir,
      }),
      resolveOmcRoot: () => omcRoot,
    });
    vi.spyOn(Date, 'now').mockReturnValue(lockNowMs);

    const result = reserveAndPlanPreToolBatch(envelope, snapshot);

    expect(result.status).toBe('planned');
    if (result.status !== 'planned') return;
    expect(result.plan.evaluations[0]?.decision).toBe('deny');
    expect(readJson(statePath)).toMatchObject({
      version: 3,
      generation: 8,
      events: expect.arrayContaining([
        expect.objectContaining({
          intentId: 'recent-lock-time-event',
          t: lockNowSec - 60,
        }),
        expect.objectContaining({
          t: lockNowSec,
          disposition: 'reserved',
        }),
      ]),
    });
  });

  it('fails closed instead of overflowing force and advisory generations', () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW_MS);
    const stateDir = join(tempDir, '.omc', 'state');
    const forcePath = join(
      stateDir,
      'force-agent-delegation-events.json',
    );
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(forcePath, JSON.stringify({
      version: 3,
      generation: Number.MAX_SAFE_INTEGER,
      events: [],
    }));
    expect(writeForceDelegationAttemptLocked({
      version: 1,
      intentId: 'force-overflow',
      originalIndex: 0,
      stateDir,
      toolName: 'Read',
      observedAtSec: NOW_SEC,
    }, 'accepted')).toEqual({ status: 'failed' });
    expect(readJson(forcePath).generation).toBe(Number.MAX_SAFE_INTEGER);
    writeFileSync(join(tempDir, '.omc', 'config.json'), JSON.stringify({
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
    const envelope = normalizeHookEnvelope({
      hook_event_name: 'PreToolUse',
      session_id: 'force-overflow-session',
      cwd: tempDir,
      tool_use_id: 'force-overflow-call',
      tool_name: 'Read',
      tool_input: { file_path: 'README.md' },
    }, 'pre-tool-use');
    const snapshot = loadPreToolBatchSnapshot(envelope, {
      now: () => NOW_MS,
      environment: () => ({
        HOME: tempDir,
        USERPROFILE: tempDir,
      }),
      resolveOmcRoot: () => join(tempDir, '.omc'),
    });
    expect(reserveAndPlanPreToolBatch(envelope, snapshot)).toMatchObject({
      status: 'failed',
      reason: 'Force-delegation reservation generation exhausted.',
    });

    const advisoryPath = join(
      stateDir,
      'sessions',
      'advisory-overflow-session',
      'pre-tool-advisory-throttle.json',
    );
    mkdirSync(dirname(advisoryPath), { recursive: true });
    writeFileSync(advisoryPath, JSON.stringify({
      version: 2,
      generation: Number.MAX_SAFE_INTEGER,
      entries: {},
    }));
    expect(claimAdvisoryThrottleLocked({
      version: 1,
      intentId: 'advisory-overflow',
      originalIndex: 0,
      stateDir,
      sessionId: 'advisory-overflow-session',
      message: 'Read multiple files in parallel.',
      messageHash: 'advisory-overflow-message',
      nowMs: NOW_MS,
      cooldownMs: 300_000,
    })).toBe('indeterminate');
    expect(readJson(advisoryPath).generation)
      .toBe(Number.MAX_SAFE_INTEGER);
  });

  it('returns all throttle dispositions and retains only bounded recent state', () => {
    const stateDir = join(tempDir, '.omc', 'state');
    const sessionId = 'throttle-owner-session';
    const statePath = join(
      stateDir,
      'sessions',
      sessionId,
      'pre-tool-advisory-throttle.json',
    );
    mkdirSync(dirname(statePath), { recursive: true });
    writeFileSync(statePath, JSON.stringify({
      version: 1,
      entries: Object.fromEntries(
        Array.from({ length: 150 }, (_, index) => [
          `old-${index}`,
          {
            last_emitted_at_ms: NOW_MS - index,
            message: `old message ${index}`,
            intent_id: `old-intent-${index}`,
          },
        ]),
      ),
    }));
    const payload: AdvisoryClaimEffectPayload = {
      version: 1,
      intentId: 'advisory-intent-1',
      originalIndex: 0,
      stateDir,
      sessionId,
      message: 'Read multiple files in parallel.',
      messageHash: 'message-hash-1',
      nowMs: NOW_MS,
      cooldownMs: 300_000,
    };

    expect(claimAdvisoryThrottleLocked(payload)).toBe('granted');
    expect(claimAdvisoryThrottleLocked(payload)).toBe('throttled');
    expect(claimAdvisoryThrottleLocked({
      ...payload,
      intentId: 'advisory-intent-2',
    })).toBe('throttled');

    const state = readJson(statePath) as {
      version: number;
      generation: number;
      entries: Record<string, unknown>;
    };
    expect(state).toMatchObject({ version: 2, generation: 1 });
    expect(Object.keys(state.entries)).toHaveLength(100);
    expect(state.entries[payload.messageHash]).toBeDefined();
    if (process.platform !== 'win32') {
      expect(statSync(statePath).mode & 0o777).toBe(0o600);
    }

    const blockedStateDir = join(tempDir, 'not-a-directory');
    writeFileSync(blockedStateDir, 'blocked');
    expect(claimAdvisoryThrottleLocked({
      ...payload,
      stateDir: blockedStateDir,
      sessionId: 'blocked-session',
      intentId: 'advisory-intent-failed',
      messageHash: 'message-hash-failed',
    })).toBe('indeterminate');
  });

  it('durably retains a new claim when 100 newer advisories saturate the ledger', () => {
    const stateDir = join(tempDir, '.omc', 'state');
    const sessionId = 'saturated-advisory-session';
    const statePath = join(
      stateDir,
      'sessions',
      sessionId,
      'pre-tool-advisory-throttle.json',
    );
    const priorBaseMs = NOW_MS + 9 * 60_000;
    const newestPriorMs = priorBaseMs + 99;
    vi.spyOn(Date, 'now').mockReturnValue(NOW_MS + 10 * 60_000);
    mkdirSync(dirname(statePath), { recursive: true });
    writeFileSync(statePath, JSON.stringify({
      version: 2,
      generation: 7,
      entries: Object.fromEntries(
        Array.from({ length: 100 }, (_, index) => [
          `prior-${index}`,
          {
            last_emitted_at_ms: priorBaseMs + index,
            message: `Prior advisory ${index}`,
            intent_id: `prior-intent-${index}`,
          },
        ]),
      ),
      updated_at: new Date(newestPriorMs).toISOString(),
    }));
    const payload: AdvisoryClaimEffectPayload = {
      version: 1,
      intentId: 'saturated-new-intent',
      originalIndex: 0,
      stateDir,
      sessionId,
      message: 'New saturated advisory.',
      messageHash: 'saturated-new-message',
      nowMs: NOW_MS,
      cooldownMs: 300_000,
    };

    expect(claimAdvisoryThrottleLocked(payload)).toBe('granted');
    const committed = readJson(statePath) as {
      generation: number;
      entries: Record<string, {
        last_emitted_at_ms: number;
        intent_id: string;
      }>;
      updated_at: string;
    };
    expect(committed.generation).toBe(8);
    expect(Object.keys(committed.entries)).toHaveLength(100);
    expect(committed.entries[payload.messageHash]).toMatchObject({
      last_emitted_at_ms: NOW_MS,
      intent_id: payload.intentId,
    });
    expect(committed.entries['prior-0']).toBeUndefined();
    expect(committed.entries['prior-1']).toBeDefined();
    expect(committed.entries['prior-99']).toBeDefined();
    expect(committed.updated_at).toBe(
      new Date(newestPriorMs).toISOString(),
    );

    const firstCommit = readFileSync(statePath, 'utf8');
    expect(claimAdvisoryThrottleLocked(payload)).toBe('throttled');
    expect(readFileSync(statePath, 'utf8')).toBe(firstCommit);
  });

  it('does not re-emit an advisory after a delay over five minutes', () => {
    const stateDir = join(tempDir, '.omc', 'state');
    const sessionId = 'delayed-throttle-session';
    const statePath = join(
      stateDir,
      'sessions',
      sessionId,
      'pre-tool-advisory-throttle.json',
    );
    const futureMs = NOW_MS + 9 * 60_000;
    vi.spyOn(Date, 'now').mockReturnValue(NOW_MS + 10 * 60_000);
    mkdirSync(dirname(statePath), { recursive: true });
    writeFileSync(statePath, JSON.stringify({
      version: 1,
      entries: {
        'same-message': {
          last_emitted_at_ms: futureMs,
          message: 'Read multiple files in parallel.',
          intent_id: 'newer-advisory-intent',
        },
        'future-sibling': {
          last_emitted_at_ms: futureMs + 1,
          message: 'Combine searches in parallel.',
          intent_id: 'future-sibling-intent',
        },
      },
      updated_at: new Date(futureMs + 1).toISOString(),
    }));
    const delayed: AdvisoryClaimEffectPayload = {
      version: 1,
      intentId: 'delayed-advisory-intent',
      originalIndex: 0,
      stateDir,
      sessionId,
      message: 'Read multiple files in parallel.',
      messageHash: 'same-message',
      nowMs: NOW_MS,
      cooldownMs: 300_000,
    };

    expect(claimAdvisoryThrottleLocked(delayed)).toBe('throttled');
    expect(readJson(statePath)).toMatchObject({
      entries: {
        'same-message': {
          last_emitted_at_ms: futureMs,
          intent_id: 'newer-advisory-intent',
        },
        'future-sibling': {
          last_emitted_at_ms: futureMs + 1,
        },
      },
      updated_at: new Date(futureMs + 1).toISOString(),
    });

    expect(claimAdvisoryThrottleLocked({
      ...delayed,
      intentId: 'delayed-distinct-intent',
      message: 'Use one focused search.',
      messageHash: 'distinct-message',
      cooldownMs: 1,
    })).toBe('granted');
    const merged = readJson(statePath);
    expect(merged).toMatchObject({
      version: 2,
      generation: 1,
      entries: {
        'same-message': {
          last_emitted_at_ms: futureMs,
        },
        'future-sibling': {
          last_emitted_at_ms: futureMs + 1,
        },
        'distinct-message': {
          last_emitted_at_ms: NOW_MS,
        },
      },
      updated_at: new Date(futureMs + 1).toISOString(),
    });
  });

  it('rejects wrong-unit and excessive-future force/advisory timestamps', () => {
    const stateDir = join(tempDir, '.omc', 'state');
    const forcePath = join(
      stateDir,
      'force-agent-delegation-events.json',
    );
    const forcePayload: ForceDelegationAttemptEffectPayload = {
      version: 1,
      intentId: 'timestamp-force',
      originalIndex: 0,
      stateDir,
      toolName: 'Read',
      observedAtSec: NOW_SEC,
    };
    expect(writeForceDelegationAttemptLocked({
      ...forcePayload,
      observedAtSec: NOW_MS,
    }, 'accepted')).toEqual({ status: 'failed' });
    expect(writeForceDelegationAttemptLocked({
      ...forcePayload,
      observedAtSec: Math.floor((Date.now() + 10 * 60_000) / 1000),
    }, 'accepted')).toEqual({ status: 'failed' });
    expect(existsSync(forcePath)).toBe(false);

    const advisoryPayload: AdvisoryClaimEffectPayload = {
      version: 1,
      intentId: 'timestamp-advisory',
      originalIndex: 0,
      stateDir,
      sessionId: 'timestamp-session',
      message: 'Read multiple files in parallel.',
      messageHash: 'timestamp-message',
      nowMs: NOW_MS,
      cooldownMs: 300_000,
    };
    expect(claimAdvisoryThrottleLocked({
      ...advisoryPayload,
      nowMs: NOW_SEC,
    })).toBe('indeterminate');
    expect(claimAdvisoryThrottleLocked({
      ...advisoryPayload,
      nowMs: Date.now() + 10 * 60_000,
    })).toBe('indeterminate');
    expect(existsSync(join(
      stateDir,
      'sessions',
      advisoryPayload.sessionId,
      'pre-tool-advisory-throttle.json',
    ))).toBe(false);
  });

  it('repairs excessive-future persisted timestamps without losing generation order', () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW_MS);
    const stateDir = join(tempDir, '.omc', 'state');
    const forcePath = join(
      stateDir,
      'force-agent-delegation-events.json',
    );
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(forcePath, JSON.stringify({
      version: 3,
      generation: 40,
      events: [{
        tool: 'Write',
        t: NOW_SEC + 10 * 60,
        originalIndex: 0,
        intentId: 'future-poison-force',
        disposition: 'accepted',
      }],
    }));
    expect(writeForceDelegationAttemptLocked({
      version: 1,
      intentId: 'valid-force-after-poison',
      originalIndex: 1,
      stateDir,
      toolName: 'Read',
      observedAtSec: NOW_SEC,
    }, 'accepted').status).toBe('written');
    expect(readJson(forcePath)).toMatchObject({
      version: 3,
      generation: 41,
      events: [{
        intentId: 'valid-force-after-poison',
        t: NOW_SEC,
      }],
    });

    const sessionId = 'future-poison-advisory-session';
    const advisoryPath = join(
      stateDir,
      'sessions',
      sessionId,
      'pre-tool-advisory-throttle.json',
    );
    mkdirSync(dirname(advisoryPath), { recursive: true });
    writeFileSync(advisoryPath, JSON.stringify({
      version: 2,
      generation: 12,
      entries: {
        'same-message': {
          last_emitted_at_ms: NOW_MS + 10 * 60_000,
          message: 'Read multiple files in parallel.',
          intent_id: 'future-poison-advisory',
        },
      },
    }));
    expect(claimAdvisoryThrottleLocked({
      version: 1,
      intentId: 'valid-advisory-after-poison',
      originalIndex: 1,
      stateDir,
      sessionId,
      message: 'Read multiple files in parallel.',
      messageHash: 'same-message',
      nowMs: NOW_MS,
      cooldownMs: 300_000,
    })).toBe('granted');
    expect(readJson(advisoryPath)).toMatchObject({
      version: 2,
      generation: 13,
      entries: {
        'same-message': {
          last_emitted_at_ms: NOW_MS,
          intent_id: 'valid-advisory-after-poison',
        },
      },
    });
  });

  it('finalizes a provisional AskUser receipt only after queue success', async () => {
    process.env.OMC_NOTIFY = '1';
    const sessionId = 'notification-detached';
    const intentId = 'notification-detached-intent';
    const receiptPath = join(
      getSessionStateDir(sessionId, tempDir),
      'notification-delivery-receipts.json',
    );
    let receiptExistedAtDispatch = false;
    let receiptQueuedAtRelease = false;
    const release = vi.fn(async () => {
      const receipt = readJson(receiptPath).receipts as
        Record<string, Record<string, unknown>>;
      receiptQueuedAtRelease =
        receipt[intentId]?.delivery_status === 'queued';
      return 'released' as const;
    });
    const terminate = vi.fn();
    let resolveDispatch:
      ((result: {
        status: 'acknowledged';
        release(): Promise<'released' | 'failed'>;
        terminate(): void;
      }) => void)
      | undefined;
    backgroundNotification.dispatch.mockImplementation(() => {
      const receipt = readJson(receiptPath).receipts as
        Record<string, Record<string, unknown>>;
      receiptExistedAtDispatch =
        receipt[intentId]?.delivery_status === 'provisional';
      return new Promise<{
        status: 'acknowledged';
        release(): Promise<'released' | 'failed'>;
        terminate(): void;
      }>((resolve) => {
        resolveDispatch = resolve;
      });
    });
    const reduction: HookReduction = {
      decision: 'pass',
      retry: false,
      unchanged: true,
      contexts: [],
      diagnostics: [],
      mutations: [],
      mutationRetryHints: [],
      callDecisions: [],
      effects: [{
        type: 'pretool.ask-user-notify.v1',
        payload: {
          version: PRE_TOOL_EFFECT_PAYLOAD_VERSION,
          intentId,
          originalIndex: 0,
          directory: tempDir,
          sessionId,
          question: 'Choose a path',
        },
        callId: 'call-notify',
        commitOn: 'accepted',
        critical: false,
      }],
      stagedEffects: [],
    };

    const pending = commitPreToolEffects(
      reduction.effects,
      reduction,
      undefined,
      {
        notificationChildEntrypointPath: 'notification-child.cjs',
        hookRuntimePath: 'hook-runtime.cjs',
      },
    );

    expect(receiptExistedAtDispatch).toBe(true);
    expect(backgroundNotification.dispatch).toHaveBeenCalledOnce();
    expect(readJson(receiptPath).receipts).toMatchObject({
      [intentId]: {
        delivery_status: 'provisional',
      },
    });
    resolveDispatch?.({
      status: 'acknowledged',
      release,
      terminate,
    });
    const result = await pending;
    expect(readJson(receiptPath).receipts).toMatchObject({
      [intentId]: {
        session_id: sessionId,
        event: 'ask-user-question',
        delivery_status: 'queued',
      },
    });
    expect(
      result.results[0]?.status,
    ).toBe('committed');
    expect(receiptQueuedAtRelease).toBe(true);
    expect(release).toHaveBeenCalledOnce();
    expect(terminate).not.toHaveBeenCalled();
  });

  it('recovers after lease when finalization and retry locks both fail', async () => {
    process.env.OMC_NOTIFY = '1';
    const sessionId = 'notification-finalize-failure';
    const intentId = 'notification-finalize-failure-intent';
    const markerPath = join(tempDir, 'notification-deliveries.log');
    const runtimePath = join(tempDir, 'notification-runtime.cjs');
    writeNotificationMarkerRuntime(runtimePath, markerPath);
    const receiptPath = join(
      getSessionStateDir(sessionId, tempDir),
      'notification-delivery-receipts.json',
    );
    const actualBackground = await vi.importActual<
      typeof import('../../background-notifications.js')
    >('../../background-notifications.js');
    let receiptLock:
      ReturnType<typeof acquireFileLockSync>
      | null = null;
    backgroundNotification.dispatch.mockImplementation(async (
      ...args: Parameters<
        typeof actualBackground.dispatchNotificationInBackground
      >
    ) => {
      const acknowledged =
        await actualBackground.dispatchNotificationInBackground(...args);
      if (acknowledged.status === 'acknowledged') {
        receiptLock = acquireFileLockSync(
          `${receiptPath}.mutation.lock`,
        );
        expect(receiptLock).not.toBeNull();
      }
      return acknowledged;
    });
    const reduction = askUserReduction(tempDir, sessionId, intentId);
    const runtimeContext = {
      notificationChildEntrypointPath: NOTIFICATION_CHILD_PATH,
      hookRuntimePath: runtimePath,
    };

    let result;
    try {
      result = await commitPreToolEffects(
        reduction.effects,
        reduction,
        undefined,
        runtimeContext,
      );
    } finally {
      if (receiptLock) releaseFileLockSync(receiptLock);
    }

    expect(result.results[0]?.status).toBe('failed');
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(deliveryCount(markerPath)).toBe(0);
    const provisional = (
      readJson(receiptPath).receipts as
      Record<string, Record<string, unknown>>
    )[intentId];
    expect(provisional).toMatchObject({
      delivery_status: 'provisional',
      lease_expires_at_ms: expect.any(Number),
    });
    const leaseExpiresAtMs =
      provisional.lease_expires_at_ms as number;
    const originalClaimId = provisional.claim_id as string;

    const immediate = await commitPreToolEffects(
      reduction.effects,
      reduction,
      undefined,
      runtimeContext,
    );
    expect(immediate.results[0]?.status).toBe('duplicate');
    expect(backgroundNotification.dispatch).toHaveBeenCalledOnce();
    expect(deliveryCount(markerPath)).toBe(0);

    backgroundNotification.dispatch.mockImplementation(
      actualBackground.dispatchNotificationInBackground,
    );
    const now = vi.spyOn(Date, 'now')
      .mockReturnValue(leaseExpiresAtMs);
    const retried = await commitPreToolEffects(
      reduction.effects,
      reduction,
      undefined,
      runtimeContext,
    );
    now.mockRestore();

    expect(retried.results[0]?.status).toBe('committed');
    await waitForDeliveryCount(markerPath, 1);
    const queued = (
      readJson(receiptPath).receipts as
      Record<string, Record<string, unknown>>
    )[intentId];
    expect(queued).toMatchObject({
      delivery_status: 'queued',
    });
    expect(queued.claim_id).not.toBe(originalClaimId);

    const duplicate = await commitPreToolEffects(
      reduction.effects,
      reduction,
      undefined,
      runtimeContext,
    );
    expect(duplicate.results[0]?.status).toBe('duplicate');
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(deliveryCount(markerPath)).toBe(1);
  });

  it('delivers once for concurrent duplicate AskUser effects', async () => {
    process.env.OMC_NOTIFY = '1';
    const sessionId = 'notification-concurrent-duplicate';
    const intentId = 'notification-concurrent-duplicate-intent';
    const markerPath = join(tempDir, 'concurrent-deliveries.log');
    const runtimePath = join(tempDir, 'concurrent-runtime.cjs');
    writeNotificationMarkerRuntime(runtimePath, markerPath);
    const actualBackground = await vi.importActual<
      typeof import('../../background-notifications.js')
    >('../../background-notifications.js');
    backgroundNotification.dispatch.mockImplementation(
      actualBackground.dispatchNotificationInBackground,
    );
    const reduction = askUserReduction(tempDir, sessionId, intentId);
    const runtimeContext = {
      notificationChildEntrypointPath: NOTIFICATION_CHILD_PATH,
      hookRuntimePath: runtimePath,
    };

    const reports = await Promise.all([
      commitPreToolEffects(
        reduction.effects,
        reduction,
        undefined,
        runtimeContext,
      ),
      commitPreToolEffects(
        reduction.effects,
        reduction,
        undefined,
        runtimeContext,
      ),
    ]);

    expect(reports.map((report) => report.results[0]?.status).sort())
      .toEqual(['committed', 'duplicate']);
    expect(backgroundNotification.dispatch).toHaveBeenCalledOnce();
    await waitForDeliveryCount(markerPath, 1);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(deliveryCount(markerPath)).toBe(1);
  });

  it('never reclaims a queued notification receipt after its lease', () => {
    const sessionId = 'notification-queued-lifetime';
    const intentId = 'notification-queued-lifetime-intent';
    const claimed = claimProvisionalNotificationReceipt(
      intentId,
      'ask-user-question',
      sessionId,
      tempDir,
      NOW_MS,
    );
    expect(claimed.status).toBe('claimed');
    if (claimed.status !== 'claimed') {
      throw new Error('initial notification claim failed');
    }
    expect(finalizeNotificationReceiptQueued(
      intentId,
      sessionId,
      tempDir,
      claimed.claimId,
      NOW_MS + 1,
    )).toBe('finalized');

    expect(claimProvisionalNotificationReceipt(
      intentId,
      'ask-user-question',
      sessionId,
      tempDir,
      NOW_MS + (10 * NOTIFICATION_PROVISIONAL_LEASE_MS),
    )).toEqual({ status: 'duplicate' });
    const receiptPath = join(
      getSessionStateDir(sessionId, tempDir),
      'notification-delivery-receipts.json',
    );
    expect(readJson(receiptPath).receipts).toMatchObject({
      [intentId]: {
        delivery_status: 'queued',
        queued_at_ms: NOW_MS + 1,
      },
    });
    expect(
      (readJson(receiptPath).receipts as
        Record<string, Record<string, unknown>>)[intentId],
    ).not.toHaveProperty('lease_expires_at_ms');
  });

  it('marks a failed AskUser queue claim retryable and retries it', async () => {
    process.env.OMC_NOTIFY = '1';
    const sessionId = 'notification-queue-retry';
    const intentId = 'notification-queue-retry-intent';
    const receiptPath = join(
      getSessionStateDir(sessionId, tempDir),
      'notification-delivery-receipts.json',
    );
    const reduction: HookReduction = {
      decision: 'pass',
      retry: false,
      unchanged: true,
      contexts: [],
      diagnostics: [],
      mutations: [],
      mutationRetryHints: [],
      callDecisions: [],
      effects: [{
        type: 'pretool.ask-user-notify.v1',
        payload: {
          version: PRE_TOOL_EFFECT_PAYLOAD_VERSION,
          intentId,
          originalIndex: 0,
          directory: tempDir,
          sessionId,
          question: 'Choose a path',
        },
        callId: 'call-notify-retry',
        commitOn: 'accepted',
        critical: false,
      }],
      stagedEffects: [],
    };
    const runtimeContext = {
      notificationChildEntrypointPath: 'notification-child.cjs',
      hookRuntimePath: 'hook-runtime.cjs',
    };
    backgroundNotification.dispatch.mockResolvedValueOnce({
      status: 'failed',
    });

    const failed = await commitPreToolEffects(
      reduction.effects,
      reduction,
      undefined,
      runtimeContext,
    );

    expect(failed.results[0]?.status).toBe('failed');
    expect(readJson(receiptPath).receipts).toMatchObject({
      [intentId]: {
        delivery_status: 'retryable',
      },
    });

    const retried = await commitPreToolEffects(
      reduction.effects,
      reduction,
      undefined,
      runtimeContext,
    );

    expect(retried.results[0]?.status).toBe('committed');
    expect(backgroundNotification.dispatch).toHaveBeenCalledTimes(2);
    expect(readJson(receiptPath).receipts).toMatchObject({
      [intentId]: {
        delivery_status: 'queued',
      },
    });
  });

  it('retains notification receipts for each session lifetime', async () => {
    process.env.OMC_NOTIFY = '0';
    const data = (sessionId: string) => ({
      sessionId,
      projectPath: tempDir,
      question: 'Continue?',
    });

    expect(await notifyOnce(
      'shared-notification-intent',
      'ask-user-question',
      data('notification-session-a'),
      NOW_MS,
    )).toEqual({ status: 'skipped' });
    expect(await notifyOnce(
      'shared-notification-intent',
      'ask-user-question',
      data('notification-session-b'),
      NOW_MS,
    )).toEqual({ status: 'skipped' });
    expect(await notifyOnce(
      'shared-notification-intent',
      'ask-user-question',
      data('notification-session-a'),
      NOW_MS + 30 * 24 * 60 * 60 * 1000,
    )).toEqual({ status: 'duplicate' });

    for (const sessionId of [
      'notification-session-a',
      'notification-session-b',
    ]) {
      const receiptPath = join(
        tempDir,
        '.omc',
        'state',
        'sessions',
        sessionId,
        'notification-delivery-receipts.json',
      );
      expect(readJson(receiptPath)).toMatchObject({
        version: 2,
        receipts: {
          'shared-notification-intent': {
            session_id: sessionId,
            event: 'ask-user-question',
          },
        },
      });
    }
    expect(existsSync(join(
      tempDir,
      '.omc',
      'state',
      'notification-delivery-receipts.json',
    ))).toBe(false);
  });

  it('fails closed without overwriting malformed notification receipts', async () => {
    process.env.OMC_NOTIFY = '0';
    const malformedStates = [
      '{not-json',
      JSON.stringify({ version: 1, receipts: {} }),
      JSON.stringify({ version: 2, receipts: [] }),
      JSON.stringify({
        version: 2,
        receipts: {
          prior: {
            claimed_at_ms: 'not-a-number',
            session_id: 'notification-malformed-entry',
            event: 'ask-user-question',
          },
        },
      }),
    ];

    for (const [index, raw] of malformedStates.entries()) {
      const sessionId = `notification-malformed-${index}`;
      const receiptPath = join(
        tempDir,
        '.omc',
        'state',
        'sessions',
        sessionId,
        'notification-delivery-receipts.json',
      );
      mkdirSync(dirname(receiptPath), { recursive: true });
      writeFileSync(receiptPath, raw);

      expect(await notifyOnce(
        `malformed-intent-${index}`,
        'ask-user-question',
        {
          sessionId,
          projectPath: tempDir,
          question: 'Continue?',
        },
        NOW_MS,
      )).toEqual({ status: 'failed' });
      expect(readFileSync(receiptPath, 'utf8')).toBe(raw);
    }
  });
});
