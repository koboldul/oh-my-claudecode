import {
  closeSync,
  ftruncateSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { normalizeHookEnvelope } from '../../bridge-normalize.js';
import { reduceHookEvaluations } from '../../hook-runtime.js';
import type {
  CanonicalHookEnvelope,
} from '../../hook-protocol.js';
import {
  commitPreToolEffects,
  encodePreToolEnforcerOutput,
  finalizePreToolReduction,
  loadPreToolBatchSnapshot,
  planPreToolBatch,
} from '../index.js';
import type {
  AdvisoryClaimDisposition,
  PreToolBatchSnapshot,
  PreToolEffectCommitReport,
  PreToolEffectDependencies,
} from '../types.js';

const NOW_MS = Date.parse('2026-04-17T12:00:00.000Z');
const DIRECTORY = 'C:\\repo';
const OMC_ROOT = join(DIRECTORY, '.omc');
const STATE_DIR = join(OMC_ROOT, 'state');

function makeSnapshot(
  overrides: Partial<PreToolBatchSnapshot> = {},
): PreToolBatchSnapshot {
  return {
    version: 1,
    loadedAtMs: NOW_MS,
    observedAt: new Date(NOW_MS).toISOString(),
    observedAtSec: Math.floor(NOW_MS / 1000),
    directory: DIRECTORY,
    omcRoot: OMC_ROOT,
    stateDir: STATE_DIR,
    sessionId: 'session-1',
    deliveryId: 'delivery-1',
    environment: {},
    disabled: false,
    quietLevel: 2,
    todo: {
      pending: 0,
      inProgress: 0,
      label: '',
    },
    tracking: {
      running: 0,
      total: 0,
    },
    team: {
      active: false,
    },
    modeActive: false,
    modeStates: {},
    omcConfig: {},
    modelRouting: {
      forceInherit: false,
      claudeModel: '',
      anthropicModel: '',
      anthropicBaseUrl: '',
      useBedrock: false,
      useVertex: false,
      configuredAgentModels: {},
      agentDefinitionModels: {},
      copilotDefaults: {
        model: 'gpt-5.6-sol',
        reasoningEffort: 'max',
        warning: '',
      },
      tierEnvironment: {},
    },
    transcript: {
      tail: '',
      contextPercent: 0,
      contextThreshold: 72,
    },
    ultragoal: {
      state: null,
      plan: null,
      expectedObjective: '',
      terminal: true,
    },
    forceDelegation: null,
    forceDelegationLedger: {
      events: [],
    },
    advisoryThrottle: {
      path: join(STATE_DIR, 'pre-tool-advisory-throttle.json'),
      nowMs: NOW_MS,
      cooldownMs: 300_000,
      entries: {},
    },
    ...overrides,
  };
}

function claudeEnvelope(
  toolName: string,
  toolInput: Record<string, unknown>,
  toolUseId = 'call-1',
): CanonicalHookEnvelope {
  return normalizeHookEnvelope({
    hook_event_name: 'PreToolUse',
    session_id: 'session-1',
    cwd: DIRECTORY,
    tool_use_id: toolUseId,
    tool_name: toolName,
    tool_input: toolInput,
  }, 'pre-tool-use');
}

function copilotEnvelope(
  calls: Array<{
    id: string;
    name: string;
    args: Record<string, unknown>;
  }>,
): CanonicalHookEnvelope {
  return normalizeHookEnvelope({
    sessionId: 'session-1',
    cwd: DIRECTORY,
    toolCalls: calls.map((call) => ({
      id: call.id,
      name: call.name,
      args: JSON.stringify(call.args),
    })),
  }, 'pre-tool-use');
}

function reducePlan(
  envelope: CanonicalHookEnvelope,
  snapshot: PreToolBatchSnapshot,
) {
  const plan = planPreToolBatch(envelope, snapshot);
  const reduction = reduceHookEvaluations(envelope, plan.evaluations);
  return { plan, reduction };
}

function commitReport(
  disposition: 'accepted' | 'rejected',
  advisoryClaims: Readonly<Record<string, AdvisoryClaimDisposition>> = {},
): PreToolEffectCommitReport {
  return {
    disposition,
    results: [],
    advisoryClaims,
  };
}

describe('transactional PreToolUse foundation', () => {
  it('normalizes prompt aliases and goal aliases once into the canonical envelope', () => {
    const envelope = normalizeHookEnvelope({
      sessionId: 'session-1',
      cwd: DIRECTORY,
      prompt: 'primary prompt',
      userPrompt: 'user prompt',
      initialPrompt: 'initial prompt',
      context: {
        goal: {
          objective: 'Ship transactional PreToolUse',
          status: 'active',
        },
      },
      toolCalls: [{
        id: 'call-1',
        name: 'read',
        args: '{"path":"README.md"}',
      }],
    }, 'pre-tool-use');

    expect(envelope.eventPayload).toMatchObject({
      prompt: 'primary prompt',
      userPrompt: 'user prompt',
      initialPrompt: 'initial prompt',
      promptAliases: [
        'primary prompt',
        'user prompt',
        'initial prompt',
      ],
      goal: {
        objective: 'Ship transactional PreToolUse',
        status: 'active',
        source: 'context',
      },
    });
  });

  it('loads one immutable snapshot and caches every observed path', () => {
    const envelope = claudeEnvelope('Read', { file_path: 'README.md' }, '');
    const jsonReads = new Map<string, number>();
    const textReads = new Map<string, number>();
    let clockReads = 0;
    let environmentReads = 0;
    let directoryReads = 0;
    let nonceReads = 0;

    const snapshot = loadPreToolBatchSnapshot(envelope, {
      now: () => {
        clockReads += 1;
        return NOW_MS;
      },
      createDeliveryNonce: () => {
        nonceReads += 1;
        return 'synthetic-delivery';
      },
      currentDirectory: () => {
        directoryReads += 1;
        return DIRECTORY;
      },
      environment: () => {
        environmentReads += 1;
        return { HOME: 'C:\\home' };
      },
      resolveOmcRoot: () => OMC_ROOT,
      readJson: (path) => {
        jsonReads.set(path, (jsonReads.get(path) ?? 0) + 1);
        return null;
      },
      readText: (path, maxBytes) => {
        const key = `${path}\0${maxBytes ?? ''}`;
        textReads.set(key, (textReads.get(key) ?? 0) + 1);
        return null;
      },
      listDirectories: () => [],
      fileExists: () => false,
    });

    expect(clockReads).toBe(1);
    expect(environmentReads).toBe(1);
    expect(directoryReads).toBe(1);
    expect(nonceReads).toBe(1);
    expect([...jsonReads.values()].every((count) => count === 1)).toBe(true);
    expect([...textReads.values()].every((count) => count === 1)).toBe(true);
    expect(snapshot.deliveryId).toBe('delivery-synthetic-delivery');
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.modelRouting)).toBe(true);
    expect(Object.isFrozen(snapshot.forceDelegationLedger.events)).toBe(true);
  });

  it('reads transcript context from a bounded tail when goal full-read is over the limit', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'pretool-transcript-'));
    const transcriptPath = join(tempDir, 'session-1.jsonl');
    const fd = openSync(transcriptPath, 'w');
    try {
      ftruncateSync(fd, 25 * 1024 * 1024 + 1024);
      const tail = Buffer.from(
        '{"usage":{"context_window":1000,"input_tokens":800}}\n',
      );
      writeSync(fd, tail, 0, tail.length, 25 * 1024 * 1024 + 512);
    } finally {
      closeSync(fd);
    }

    try {
      const envelope = normalizeHookEnvelope({
        hook_event_name: 'PreToolUse',
        session_id: 'session-1',
        cwd: tempDir,
        transcript_path: transcriptPath,
        tool_use_id: 'call-1',
        tool_name: 'Read',
        tool_input: { file_path: 'README.md' },
      }, 'pre-tool-use');
      const snapshot = loadPreToolBatchSnapshot(envelope, {
        now: () => NOW_MS,
        environment: () => ({ HOME: tempDir }),
        resolveOmcRoot: () => join(tempDir, '.omc'),
        readJson: () => null,
        listDirectories: () => [],
        fileExists: () => false,
      });

      expect(snapshot.transcript.contextPercent).toBe(80);
      expect(snapshot.transcript.goal).toBeUndefined();
      expect(snapshot.transcript.tail).toContain('"input_tokens":800');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('does not full-read a transcript when a canonical payload goal exists', () => {
    const envelope = normalizeHookEnvelope({
      sessionId: 'session-1',
      cwd: DIRECTORY,
      transcriptPath: join(DIRECTORY, 'session-1.jsonl'),
      goal: { objective: 'Payload goal', status: 'active' },
      toolCalls: [{
        id: 'call-1',
        name: 'read',
        args: '{"path":"README.md"}',
      }],
    }, 'pre-tool-use');
    const readText = vi.fn((_path: string, _maxBytes?: number) => null);

    const snapshot = loadPreToolBatchSnapshot(envelope, {
      now: () => NOW_MS,
      environment: () => ({ HOME: 'C:\\home' }),
      resolveOmcRoot: () => OMC_ROOT,
      readJson: () => null,
      readText,
      readTextTail: () => '',
      listDirectories: () => [],
      fileExists: () => false,
    });

    expect(snapshot.transcript.goal?.objective).toBe('Payload goal');
    expect(readText.mock.calls.some(
      ([path]) => path === envelope.transcriptPath,
    )).toBe(false);
  });

  it('deep-clones borrowed observations before freezing the snapshot', () => {
    const borrowed = {
      routing: {
        forceInherit: true,
        nested: { marker: 'original' },
      },
    };
    const snapshot = loadPreToolBatchSnapshot(
      claudeEnvelope('Read', { file_path: 'README.md' }),
      {
        now: () => NOW_MS,
        environment: () => ({ HOME: 'C:\\home' }),
        resolveOmcRoot: () => OMC_ROOT,
        readJson: (path) =>
          path.endsWith('.omc-config.json') ? borrowed : null,
        readText: () => null,
        readTextTail: () => null,
        listDirectories: () => [],
        fileExists: () => false,
      },
    );

    expect(Object.isFrozen(borrowed)).toBe(false);
    expect(Object.isFrozen(borrowed.routing)).toBe(false);
    borrowed.routing.nested.marker = 'mutated';
    expect(
      (snapshot.omcConfig.routing as {
        nested: { marker: string };
      }).nested.marker,
    ).toBe('original');
  });

  it('does not borrow generic root mode activity for a valid session', () => {
    const rootAutopilot = join(STATE_DIR, 'autopilot-state.json');
    const reads: string[] = [];
    const snapshot = loadPreToolBatchSnapshot(
      claudeEnvelope('Read', { file_path: 'README.md' }),
      {
        now: () => NOW_MS,
        environment: () => ({ HOME: 'C:\\home' }),
        resolveOmcRoot: () => OMC_ROOT,
        readJson: (path) => {
          reads.push(path);
          return path === rootAutopilot ? { active: true } : null;
        },
        readText: () => null,
        readTextTail: () => null,
        listDirectories: () => [],
        fileExists: () => false,
      },
    );

    expect(snapshot.modeActive).toBe(false);
    expect(snapshot.modeStates.autopilot.state).toBeNull();
    expect(reads).not.toContain(rootAutopilot);
  });

  it.each(['ultragoal', 'team'] as const)(
    'uses %s root fallback only when it explicitly owns the valid session',
    (modeName) => {
      const rootPath = join(STATE_DIR, `${modeName}-state.json`);
      const load = (owner: string | undefined) =>
        loadPreToolBatchSnapshot(
          claudeEnvelope('Read', { file_path: 'README.md' }),
          {
            now: () => NOW_MS,
            environment: () => ({ HOME: 'C:\\home' }),
            resolveOmcRoot: () => OMC_ROOT,
            readJson: (path) =>
              path === rootPath
                ? {
                    active: true,
                    ...(owner ? { session_id: owner } : {}),
                  }
                : null,
            readText: () => null,
            readTextTail: () => null,
            listDirectories: () => [],
            fileExists: () => false,
          },
        );

      expect(load('session-1').modeStates[modeName]).toMatchObject({
        path: rootPath,
        state: {
          active: true,
          session_id: 'session-1',
        },
      });
      expect(load(undefined).modeStates[modeName].state).toBeNull();
      expect(load('foreign-session').modeStates[modeName].state).toBeNull();
    },
  );

  it('does not borrow root state for an invalid nonempty session ID', () => {
    const rootAutopilot = join(STATE_DIR, 'autopilot-state.json');
    const rootUltragoal = join(STATE_DIR, 'ultragoal-state.json');
    const rootTeam = join(STATE_DIR, 'team-state.json');
    const rootAdvisory = join(
      STATE_DIR,
      'pre-tool-advisory-throttle.json',
    );
    const rootSwarmSummary = join(STATE_DIR, 'swarm-summary.json');
    const rootSwarmMarker = join(STATE_DIR, 'swarm-active.marker');
    const reads: string[] = [];
    const existenceChecks: string[] = [];
    const envelope = {
      ...claudeEnvelope('Read', { file_path: 'README.md' }),
      sessionId: '../invalid',
    };
    const snapshot = loadPreToolBatchSnapshot(envelope, {
      now: () => NOW_MS,
      environment: () => ({ HOME: 'C:\\home' }),
      resolveOmcRoot: () => OMC_ROOT,
      readJson: (path) => {
        reads.push(path);
        if (path === rootAutopilot) return { active: true };
        if (path === rootUltragoal || path === rootTeam) {
          return { active: true, session_id: '../invalid' };
        }
        if (path === rootAdvisory) {
          return {
            entries: {
              secret: { last_emitted_at_ms: NOW_MS },
            },
          };
        }
        if (path === rootSwarmSummary) return { active: true };
        return null;
      },
      readText: () => null,
      readTextTail: () => null,
      listDirectories: () => [],
      fileExists: (path) => {
        existenceChecks.push(path);
        return path === rootSwarmMarker;
      },
    });

    expect(snapshot.modeActive).toBe(false);
    expect(snapshot.modeStates.autopilot.state).toBeNull();
    expect(snapshot.advisoryThrottle.entries).toEqual({});
    expect(reads).not.toContain(rootAutopilot);
    expect(reads).not.toContain(rootUltragoal);
    expect(reads).not.toContain(rootTeam);
    expect(reads).not.toContain(rootAdvisory);
    expect(reads).not.toContain(rootSwarmSummary);
    expect(existenceChecks).not.toContain(rootSwarmMarker);
  });

  it('prefers claudeObjective and ignores whitespace-only completion', () => {
    const sessionState = join(
      STATE_DIR,
      'sessions',
      'session-1',
      'ultragoal-state.json',
    );
    const goalsPath = join(OMC_ROOT, 'ultragoal', 'goals.json');
    const snapshot = loadPreToolBatchSnapshot(
      claudeEnvelope('Read', { file_path: 'README.md' }),
      {
        now: () => NOW_MS,
        environment: () => ({ HOME: 'C:\\home' }),
        resolveOmcRoot: () => OMC_ROOT,
        readJson: (path) => {
          if (path === sessionState) {
            return {
              active: true,
              completed_at: '   ',
              session_id: 'session-1',
            };
          }
          if (path === goalsPath) {
            return {
              claudeObjective: 'Claude objective',
              aggregateCompletion: {
                objective: 'Aggregate objective',
              },
            };
          }
          return null;
        },
        readText: () => null,
        readTextTail: () => null,
        listDirectories: () => [],
        fileExists: () => false,
      },
    );

    expect(snapshot.ultragoal.expectedObjective).toBe('Claude objective');
    expect(snapshot.ultragoal.terminal).toBe(false);
  });

  it('uses the dedicated advisory timestamp override in planned effects', () => {
    const advisoryNowMs = NOW_MS - 123_456;
    const envelope = claudeEnvelope('Read', { file_path: 'README.md' });
    const snapshot = loadPreToolBatchSnapshot(envelope, {
      now: () => NOW_MS,
      environment: () => ({
        HOME: 'C:\\home',
        OMC_PRE_TOOL_ADVISORY_NOW_MS: String(advisoryNowMs),
      }),
      resolveOmcRoot: () => OMC_ROOT,
      readJson: () => null,
      readText: () => null,
      readTextTail: () => null,
      listDirectories: () => [],
      fileExists: () => false,
    });
    const advisory = planPreToolBatch(envelope, snapshot)
      .evaluations[0].effects
      ?.find((effect) => effect.type === 'pretool.advisory-claim.v1');

    expect(snapshot.advisoryThrottle.nowMs).toBe(advisoryNowMs);
    expect(advisory?.payload).toMatchObject({ nowMs: advisoryNowMs });
  });

  it.each([
    String(Math.floor(NOW_MS / 1000)),
    String(NOW_MS + 10 * 60_000),
  ])('rejects implausible advisory timestamp override %s', (override) => {
    const snapshot = loadPreToolBatchSnapshot(
      claudeEnvelope('Read', { file_path: 'README.md' }),
      {
        now: () => NOW_MS,
        environment: () => ({
          HOME: 'C:\\home',
          OMC_PRE_TOOL_ADVISORY_NOW_MS: override,
        }),
        resolveOmcRoot: () => OMC_ROOT,
        readJson: () => null,
        readText: () => null,
        readTextTail: () => null,
        listDirectories: () => [],
        fileExists: () => false,
      },
    );

    expect(snapshot.advisoryThrottle.nowMs).toBe(NOW_MS);
  });

  it('filters poisoned force/advisory observations and keeps ledger generation', () => {
    const forcePath = join(
      STATE_DIR,
      'force-agent-delegation-events.json',
    );
    const advisoryPath = join(
      STATE_DIR,
      'sessions',
      'session-1',
      'pre-tool-advisory-throttle.json',
    );
    const snapshot = loadPreToolBatchSnapshot(
      claudeEnvelope('Read', { file_path: 'README.md' }),
      {
        now: () => NOW_MS,
        environment: () => ({ HOME: 'C:\\home' }),
        resolveOmcRoot: () => OMC_ROOT,
        readJson: (path) => {
          if (path === forcePath) {
            return {
              version: 3,
              generation: 7,
              events: [
                { tool: 'Read', t: Math.floor(NOW_MS / 1000) },
                { tool: 'Write', t: NOW_MS },
                {
                  tool: 'Edit',
                  t: Math.floor(NOW_MS / 1000) + 301,
                },
              ],
            };
          }
          if (path === advisoryPath) {
            return {
              version: 2,
              generation: 9,
              entries: {
                valid: { last_emitted_at_ms: NOW_MS },
                'wrong-unit': {
                  last_emitted_at_ms: Math.floor(NOW_MS / 1000),
                },
                future: {
                  last_emitted_at_ms: NOW_MS + 300_001,
                },
              },
            };
          }
          return null;
        },
        readText: () => null,
        readTextTail: () => null,
        listDirectories: () => [],
        fileExists: () => false,
      },
    );

    expect(snapshot.forceDelegationLedger).toMatchObject({
      generation: 7,
      events: [{
        toolName: 'Read',
        observedAtSec: Math.floor(NOW_MS / 1000),
      }],
    });
    expect(snapshot.advisoryThrottle.entries).toEqual({
      valid: { last_emitted_at_ms: NOW_MS },
    });
  });

  it('keeps the planner free of observation and side-effect APIs', () => {
    const source = readFileSync(
      new URL('../evaluate.ts', import.meta.url),
      'utf8',
    );

    expect(source).not.toMatch(/from ['"]node:(?:fs|child_process)/);
    expect(source).not.toMatch(/\bprocess\.env\b/);
    expect(source).not.toMatch(/\bDate\.now\s*\(/);
    expect(source).not.toMatch(/\bimport\s*\(/);
    expect(source).not.toMatch(/notifyOnce|appendReplayEventOnce|writeFileSync/);
  });

  it('plans deterministically without mutating its envelope or snapshot', () => {
    const envelope = claudeEnvelope('Skill', {
      skill: 'oh-my-claudecode:plan',
    });
    const snapshot = makeSnapshot();
    const envelopeBefore = structuredClone(envelope);
    const snapshotBefore = structuredClone(snapshot);

    const first = planPreToolBatch(envelope, snapshot);
    const second = planPreToolBatch(envelope, snapshot);

    expect(second).toEqual(first);
    expect(envelope).toEqual(envelopeBefore);
    expect(snapshot).toEqual(snapshotBefore);
    expect(first.evaluations[0].effects?.map((effect) => effect.type)).toEqual([
      'pretool.trace-skill-attempt.v1',
      'pretool.support-skill-upsert.v1',
    ]);
  });

  it('classifies every inventoried side effect by transactional phase', () => {
    const support = planPreToolBatch(
      claudeEnvelope('Skill', {
        skill: 'oh-my-claudecode:plan',
      }),
      makeSnapshot(),
    ).evaluations[0].effects ?? [];
    const mode = planPreToolBatch(
      claudeEnvelope('Skill', {
        skill: 'oh-my-claudecode:ralph',
      }),
      makeSnapshot(),
    ).evaluations[0].effects ?? [];
    const advisory = planPreToolBatch(
      claudeEnvelope('Read', { file_path: 'README.md' }),
      makeSnapshot({ quietLevel: 0 }),
    ).evaluations[0].effects ?? [];
    const notification = planPreToolBatch(
      claudeEnvelope('AskUserQuestion', {
        questions: [{ question: 'Continue?' }],
      }),
      makeSnapshot(),
    ).evaluations[0].effects ?? [];
    const forceDelegation = planPreToolBatch(
      claudeEnvelope('Read', { file_path: 'README.md' }),
      makeSnapshot({
        forceDelegation: {
          enforce: true,
          rules: [{ pattern: 'Write', threshold: { count: 2 } }],
        },
      }),
    ).evaluations[0].effects ?? [];

    expect(support).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'pretool.trace-skill-attempt.v1',
        commitOn: 'always',
      }),
      expect.objectContaining({
        type: 'pretool.support-skill-upsert.v1',
        commitOn: 'accepted',
      }),
    ]));
    expect(mode.filter(
      (effect) => effect.type === 'pretool.mode-confirm.v1',
    ).every(
      (effect) =>
        effect.commitOn === 'accepted'
        && effect.critical === true,
    )).toBe(true);
    expect(advisory).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'pretool.advisory-claim.v1',
        commitOn: 'accepted',
      }),
    ]));
    expect(notification).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'pretool.ask-user-notify.v1',
        commitOn: 'accepted',
      }),
    ]));
    expect(forceDelegation).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'pretool.force-delegation-attempt.v1',
        commitOn: 'always',
      }),
    ]));
  });

  it('carries exact mode activation observations in confirmation effects', () => {
    const state = {
      active: true,
      awaiting_confirmation: true,
      awaiting_confirmation_set_at: '2026-04-17T11:59:00.000Z',
      session_id: 'session-1',
      generation: 7,
    };
    const statePath = join(
      STATE_DIR,
      'sessions',
      'session-1',
      'ralph-state.json',
    );
    const plan = planPreToolBatch(
      claudeEnvelope('Skill', {
        skill: 'oh-my-claudecode:ralph',
      }),
      makeSnapshot({
        modeStates: {
          ralph: {
            path: statePath,
            state,
          },
        },
      }),
    );
    const effect = plan.evaluations[0].effects?.find(
      (candidate) =>
        candidate.type === 'pretool.mode-confirm.v1'
        && (candidate.payload as { modeName?: string }).modeName === 'ralph',
    );

    expect(effect?.payload).toMatchObject({
      observedPath: statePath,
      observedOwnerSessionId: 'session-1',
      observedGeneration: 7,
      observedConfirmationTimestamp:
        '2026-04-17T11:59:00.000Z',
    });
    expect((effect?.payload as { observedStateDigest?: string })
      .observedStateDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('threads force-delegation attempts through later calls in original order', () => {
    const envelope = copilotEnvelope([
      { id: 'read-first', name: 'read', args: { path: 'a.ts' } },
      { id: 'read-second', name: 'read', args: { path: 'b.ts' } },
    ]);
    const snapshot = makeSnapshot({
      forceDelegation: {
        enforce: true,
        rules: [{
          pattern: 'Read',
          threshold: { count: 2, windowSeconds: 120 },
        }],
      },
    });

    const plan = planPreToolBatch(envelope, snapshot);

    expect(plan.calls.map((call) => call.call.id)).toEqual([
      'read-first',
      'read-second',
    ]);
    expect(plan.evaluations.map((evaluation) => evaluation.decision)).toEqual([
      'pass',
      'deny',
    ]);
    expect(plan.finalForceDelegationLedger.events.map(
      (event) => event.toolName,
    )).toEqual(['Read', 'Read']);
  });

  it('does not double-count an idempotent force-delegation replay', () => {
    const envelope = claudeEnvelope('Read', { file_path: 'README.md' });
    const forceDelegation = {
      enforce: true,
      rules: [{
        pattern: 'Read',
        threshold: { count: 2, windowSeconds: 120 },
      }],
    } as const;
    const first = planPreToolBatch(
      envelope,
      makeSnapshot({ forceDelegation }),
    );
    const replay = planPreToolBatch(
      envelope,
      makeSnapshot({
        observedAtSec: Math.floor(NOW_MS / 1000) + 60,
        forceDelegation,
        forceDelegationLedger: first.finalForceDelegationLedger,
      }),
    );

    expect(first.evaluations[0].decision).toBe('pass');
    expect(replay.evaluations[0].decision).toBe('pass');
    expect(replay.finalForceDelegationLedger.events).toHaveLength(1);
    expect(replay.finalForceDelegationLedger.events[0]?.observedAtSec)
      .toBe(Math.floor(NOW_MS / 1000));
  });

  it('does not stage accepted state effects when the call is rejected', () => {
    const envelope = claudeEnvelope('Skill', {
      skill: 'oh-my-claudecode:plan',
    });
    const snapshot = makeSnapshot({
      forceDelegation: {
        enforce: true,
        rules: [{
          pattern: 'Skill',
          threshold: { count: 1, windowSeconds: 120 },
        }],
      },
    });

    const { reduction } = reducePlan(envelope, snapshot);
    const stagedTypes = reduction.stagedEffects.map((effect) => effect.type);

    expect(reduction.decision).toBe('deny');
    expect(stagedTypes).toEqual([
      'pretool.trace-skill-attempt.v1',
      'pretool.force-delegation-attempt.v1',
    ]);
    expect(stagedTypes).not.toContain('pretool.support-skill-upsert.v1');
  });

  it('records rejected disposition for always-attempt trace effects', async () => {
    const envelope = claudeEnvelope('Skill', {
      skill: 'oh-my-claudecode:plan',
    });
    const snapshot = makeSnapshot({
      forceDelegation: {
        enforce: true,
        rules: [{
          pattern: 'Skill',
          threshold: { count: 1, windowSeconds: 120 },
        }],
      },
    });
    const { reduction } = reducePlan(envelope, snapshot);
    const appendTraceAttempt = vi.fn(() => ({ status: 'appended' as const }));
    const writeForceDelegationAttempt = vi.fn(
      () => ({ status: 'written' as const }),
    );
    const dependencies: PreToolEffectDependencies = {
      appendTraceAttempt,
      writeForceDelegationAttempt,
      upsertSupportSkill: vi.fn(() => ({ status: 'written' as const })),
      confirmMode: vi.fn(() => ({ status: 'written' as const })),
      claimAdvisory: vi.fn(() => 'granted' as const),
      notifyAskUser: vi.fn(() => ({ status: 'sent' as const })),
    };

    const report = await commitPreToolEffects(
      reduction.stagedEffects,
      reduction,
      dependencies,
    );

    expect(report.disposition).toBe('rejected');
    expect(appendTraceAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ skillName: 'plan' }),
      'rejected',
    );
    expect(writeForceDelegationAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: 'Skill' }),
      'rejected',
    );
    expect(dependencies.upsertSupportSkill).not.toHaveBeenCalled();
  });

  it.each([
    ['written', 'committed'],
    ['not-applicable', 'committed'],
    ['changed', 'failed'],
    ['skipped', 'failed'],
    ['failed', 'failed'],
  ] as const)(
    'commits mode confirmation status %s as a critical %s result',
    async (modeStatus, expectedStatus) => {
      const envelope = claudeEnvelope('Skill', {
        skill: 'oh-my-claudecode:ralph',
      });
      const { reduction } = reducePlan(envelope, makeSnapshot());
      const dependencies: PreToolEffectDependencies = {
        appendTraceAttempt: () => ({ status: 'appended' }),
        writeForceDelegationAttempt: () => ({ status: 'written' }),
        upsertSupportSkill: () => ({ status: 'written' }),
        confirmMode: () => ({ status: modeStatus }),
        claimAdvisory: () => 'granted',
        notifyAskUser: () => ({ status: 'queued' }),
      };

      const report = await commitPreToolEffects(
        reduction.stagedEffects,
        reduction,
        dependencies,
      );
      const modeResults = report.results.filter(
        (result) => result.type === 'pretool.mode-confirm.v1',
      );

      expect(modeResults.length).toBeGreaterThan(0);
      expect(modeResults.every(
        (result) =>
          result.critical === true
          && result.status === expectedStatus,
      )).toBe(true);
    },
  );

  it('uses stable host idempotency and isolates synthetic deliveries', () => {
    const stableEnvelope = claudeEnvelope('Skill', {
      skill: 'oh-my-claudecode:plan',
    }, 'stable-call');
    const syntheticEnvelope = claudeEnvelope('Skill', {
      skill: 'oh-my-claudecode:plan',
    }, '');
    const load = (
      envelope: CanonicalHookEnvelope,
      nonce: string,
    ) => loadPreToolBatchSnapshot(envelope, {
      now: () => NOW_MS,
      createDeliveryNonce: () => nonce,
      currentDirectory: () => DIRECTORY,
      environment: () => ({ HOME: 'C:\\home' }),
      resolveOmcRoot: () => OMC_ROOT,
      readJson: () => null,
      readText: () => null,
      listDirectories: () => [],
      fileExists: () => false,
    });

    const stableA = load(stableEnvelope, 'unused-a');
    const stableB = load(stableEnvelope, 'unused-b');
    const syntheticA = load(syntheticEnvelope, 'delivery-a');
    const syntheticAReplay = load(syntheticEnvelope, 'delivery-a');
    const syntheticB = load(syntheticEnvelope, 'delivery-b');

    expect(stableB.deliveryId).toBe(stableA.deliveryId);
    expect(syntheticAReplay.deliveryId).toBe(syntheticA.deliveryId);
    expect(syntheticB.deliveryId).not.toBe(syntheticA.deliveryId);
    expect(
      planPreToolBatch(stableEnvelope, stableA)
        .evaluations[0].effects?.map((effect) => effect.payload),
    ).toEqual(
      planPreToolBatch(stableEnvelope, stableB)
        .evaluations[0].effects?.map((effect) => effect.payload),
    );
    expect(
      planPreToolBatch(syntheticEnvelope, syntheticA)
        .evaluations[0].effects?.map((effect) => effect.payload),
    ).not.toEqual(
      planPreToolBatch(syntheticEnvelope, syntheticB)
        .evaluations[0].effects?.map((effect) => effect.payload),
    );
  });

  it('retains every required retry patch when a later call denies the batch', () => {
    const envelope = copilotEnvelope([
      {
        id: 'agent-a',
        name: 'agent',
        args: { agent_type: 'oh-my-claudecode:executor' },
      },
      {
        id: 'agent-b',
        name: 'agent',
        args: { agent_type: 'oh-my-claudecode:verifier' },
      },
    ]);
    const { reduction } = reducePlan(envelope, makeSnapshot({
      forceDelegation: {
        enforce: true,
        rules: [{
          pattern: 'Task|Agent',
          threshold: { count: 2, windowSeconds: 120 },
        }],
      },
    }));

    expect(reduction).toMatchObject({
      decision: 'deny',
      retry: true,
      unchanged: true,
      mutations: [],
      mutationRetryHints: [
        {
          callId: 'agent-a',
          instruction:
            'call agent-a: model=gpt-5.6-sol, reasoning_effort=max',
          patch: {
            model: 'gpt-5.6-sol',
            reasoning_effort: 'max',
          },
        },
        {
          callId: 'agent-b',
          instruction:
            'call agent-b: model=gpt-5.6-sol, reasoning_effort=max',
          patch: {
            model: 'gpt-5.6-sol',
            reasoning_effort: 'max',
          },
        },
      ],
    });
    expect(reduction.reason).toContain('Force-agent-delegation');
    expect(reduction.reason).toContain(
      'call agent-a: model=gpt-5.6-sol, reasoning_effort=max',
    );
    expect(reduction.reason).toContain(
      'call agent-b: model=gpt-5.6-sol, reasoning_effort=max',
    );
  });

  it('preserves a same-call required mutation through a later denial', () => {
    const envelope = copilotEnvelope([{
      id: 'agent-a',
      name: 'agent',
      args: { agent_type: 'oh-my-claudecode:executor' },
    }]);
    const { plan, reduction } = reducePlan(envelope, makeSnapshot({
      forceDelegation: {
        enforce: true,
        rules: [{
          pattern: 'Task|Agent',
          threshold: { count: 1, windowSeconds: 120 },
        }],
      },
    }));

    expect(plan.evaluations[0]).toMatchObject({
      decision: 'deny',
      mutation: {
        requirement: 'required',
        retryHint: {
          instruction:
            'call agent-a: model=gpt-5.6-sol, reasoning_effort=max',
        },
      },
    });
    expect(reduction.mutationRetryHints).toEqual([
      {
        callId: 'agent-a',
        instruction:
          'call agent-a: model=gpt-5.6-sol, reasoning_effort=max',
        patch: {
          model: 'gpt-5.6-sol',
          reasoning_effort: 'max',
        },
      },
    ]);
  });

  it.each([
    {
      claim: 'granted' as const,
      emits: true,
      presentation: 'context',
    },
    {
      claim: 'throttled' as const,
      emits: false,
      presentation: 'suppressed',
    },
    {
      claim: 'indeterminate' as const,
      emits: true,
      presentation: 'context',
    },
  ])(
    'reconciles $claim advisory claims without ghost context',
    ({ claim, emits, presentation }) => {
      const envelope = claudeEnvelope('Read', {
        file_path: 'README.md',
      });
      const { plan, reduction } = reducePlan(
        envelope,
        makeSnapshot({ quietLevel: 0 }),
      );
      const candidate = plan.calls[0].advisoryCandidate;
      expect(candidate).toBeDefined();

      const finalized = finalizePreToolReduction(
        plan,
        reduction,
        commitReport('accepted', {
          [candidate!.intentId]: claim,
        }),
      );

      expect(finalized.reduction.contexts.length > 0).toBe(emits);
      expect(finalized.legacyPresentation?.kind).toBe(presentation);
    },
  );
});

describe('Claude legacy output goldens', () => {
  const dependencies: PreToolEffectDependencies = {
    appendTraceAttempt: () => ({ status: 'appended' }),
    writeForceDelegationAttempt: () => ({ status: 'written' }),
    upsertSupportSkill: () => ({ status: 'written' }),
    confirmMode: () => ({ status: 'written' }),
    claimAdvisory: () => 'granted',
    notifyAskUser: () => ({ status: 'queued' }),
  };
  const configuredModelRouting = {
    ...makeSnapshot().modelRouting,
    configuredAgentModels: {
      'general-purpose': 'sonnet',
    },
  };

  it.each([
    {
      name: 'continue',
      toolName: 'Read',
      toolInput: { file_path: 'README.md' },
      snapshot: () => makeSnapshot({ disabled: true }),
      expected: { continue: true },
    },
    {
      name: 'suppressed',
      toolName: 'Read',
      toolInput: { file_path: 'README.md' },
      snapshot: () => makeSnapshot({ quietLevel: 2 }),
      expected: { continue: true, suppressOutput: true },
    },
    {
      name: 'suppressed mutation',
      toolName: 'Task',
      toolInput: { subagent_type: 'general-purpose' },
      snapshot: () => makeSnapshot({
        quietLevel: 2,
        modelRouting: configuredModelRouting,
      }),
      expected: {
        continue: true,
        suppressOutput: true,
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          updatedInput: {
            subagent_type: 'general-purpose',
            model: 'sonnet',
          },
        },
      },
    },
    {
      name: 'hook denial',
      toolName: 'Read',
      toolInput: { file_path: 'README.md' },
      snapshot: () => makeSnapshot({
        quietLevel: 2,
        forceDelegation: {
          enforce: true,
          rules: [{
            pattern: 'Read',
            threshold: { count: 1, windowSeconds: 120 },
          }],
        },
      }),
      expected: {
        continue: true,
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason:
            '[OMC] Force-agent-delegation: 1 Read in last 120s '
            + '(threshold 1). Delegate to an Agent instead. '
            + 'Bypass: ALLOW_RAW_READ=1.',
        },
      },
    },
    {
      name: 'raw block',
      toolName: 'Task',
      toolInput: { subagent_type: 'general-purpose' },
      snapshot: () => makeSnapshot({
        quietLevel: 2,
        transcript: {
          tail: '',
          contextPercent: 80,
          contextThreshold: 72,
        },
      }),
      expected: {
        decision: 'block',
        reason:
          '[OMC] Preflight context guard: 80% used (threshold: 72%). '
          + 'Avoid spawning additional agent-heavy tasks until context is reduced. '
          + 'Safe recovery: (1) pause new Task fan-out, (2) run /compact now, '
          + '(3) if compact fails, open a fresh session and continue from '
          + '.omc/state + .omc/notepad.md.',
      },
    },
    {
      name: 'context',
      toolName: 'Read',
      toolInput: { file_path: 'README.md' },
      snapshot: () => makeSnapshot({ quietLevel: 0 }),
      expected: {
        continue: true,
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          additionalContext:
            'Read multiple files in parallel when possible for faster analysis.',
        },
      },
    },
    {
      name: 'context and mutation',
      toolName: 'Task',
      toolInput: {
        subagent_type: 'general-purpose',
        description: 'Implement the focused fix',
      },
      snapshot: () => makeSnapshot({
        quietLevel: 0,
        modelRouting: configuredModelRouting,
      }),
      expected: {
        continue: true,
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          additionalContext:
            'Spawning agent: general-purpose (sonnet) | '
            + 'Task: Implement the focused fix',
          updatedInput: {
            subagent_type: 'general-purpose',
            description: 'Implement the focused fix',
            model: 'sonnet',
          },
        },
      },
    },
  ])(
    'preserves the $name presentation through the real pipeline',
    async ({ toolName, toolInput, snapshot, expected }) => {
      const envelope = claudeEnvelope(toolName, toolInput);
      const plan = planPreToolBatch(envelope, snapshot());
      const reduction = reduceHookEvaluations(
        envelope,
        plan.evaluations,
      );
      const report = await commitPreToolEffects(
        reduction.stagedEffects,
        reduction,
        dependencies,
      );
      const finalized = finalizePreToolReduction(
        plan,
        reduction,
        report,
      );

      expect(encodePreToolEnforcerOutput(envelope, finalized))
        .toEqual(expected);
    },
  );
});
