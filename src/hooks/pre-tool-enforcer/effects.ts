import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { atomicWriteJsonSync } from '../../lib/atomic-write.js';
import {
  confirmModeAwaitingConfirmationLocked,
  withStateFileMutationLock,
} from '../../lib/mode-state-io.js';
import {
  claimProvisionalNotificationReceipt,
  finalizeNotificationReceiptQueued,
  markNotificationReceiptRetryable,
} from '../../notifications/index.js';
import {
  dispatchNotificationInBackground,
} from '../background-notifications.js';
import { upsertSupportSkillActiveStateLocked } from '../skill-state/index.js';
import { appendReplayEventOnce } from '../subagent-tracker/session-replay.js';
import type {
  CanonicalHookEnvelope,
  HookEffect,
  HookReduction,
} from '../hook-protocol.js';
import {
  PRE_TOOL_EFFECT_PAYLOAD_VERSION,
  PRE_TOOL_MAX_FUTURE_SKEW_MS,
  PRE_TOOL_MIN_EPOCH_MS,
  type AdvisoryClaimDisposition,
  type AdvisoryClaimEffectPayload,
  type AskUserNotifyEffectPayload,
  type ForceDelegationAttemptEffectPayload,
  type ForceDelegationReservationResult,
  type ForceDelegationWriteResult,
  type ModeConfirmEffectPayload,
  type NotificationOnceResult,
  type PreToolEffectCommitReport,
  type PreToolEffectCommitResult,
  type PreToolEffectDependencies,
  type PreToolEffectRuntimeContext,
  type PreToolFinalDisposition,
  type PreToolBatchSnapshot,
  type PreToolHookEffect,
  type ReplayAppendOnceResult,
  type SupportSkillMutationResult,
  type SupportSkillUpsertEffectPayload,
  type TraceSkillAttemptEffectPayload,
} from './types.js';
import { planPreToolBatch } from './evaluate.js';

const SESSION_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,255}$/;
const FORCE_DELEGATION_STATE_FILE = 'force-agent-delegation-events.json';
const FORCE_DELEGATION_RETENTION_SECONDS = 60 * 60;
const FORCE_DELEGATION_MAX_EVENTS = 2_000;
const ADVISORY_STATE_FILE = 'pre-tool-advisory-throttle.json';
const ADVISORY_MAX_ENTRIES = 100;
const ADVISORY_MIN_PRUNE_WINDOW_MS = 60 * 60 * 1000;

interface StoredForceDelegationEvent {
  tool: string;
  t: number;
  originalIndex: number;
  intentId: string;
  disposition: PreToolFinalDisposition | 'reserved';
}

interface StoredForceDelegationState {
  version: 3;
  generation: number;
  events: StoredForceDelegationEvent[];
}

interface StoredAdvisoryEntry {
  last_emitted_at_ms: number;
  message: string;
  intent_id: string;
}

interface StoredAdvisoryState {
  version: 2;
  generation: number;
  entries: Record<string, StoredAdvisoryEntry>;
  updated_at?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

type JsonRecordRead =
  | { status: 'missing' }
  | { status: 'valid'; value: Record<string, unknown> }
  | { status: 'corrupt' };

function inspectJsonRecord(path: string): JsonRecordRead {
  if (!existsSync(path)) return { status: 'missing' };
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    return isRecord(parsed)
      ? { status: 'valid', value: parsed }
      : { status: 'corrupt' };
  } catch {
    return { status: 'corrupt' };
  }
}

function storedGeneration(value: unknown): number | null {
  if (value === undefined) return 0;
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
    ? value
    : null;
}

function nextGeneration(generation: number): number | null {
  return generation < Number.MAX_SAFE_INTEGER
    ? generation + 1
    : null;
}

function validEpochSeconds(value: number, referenceSec: number): boolean {
  return Number.isSafeInteger(value)
    && value >= Math.floor(PRE_TOOL_MIN_EPOCH_MS / 1000)
    && value <=
      referenceSec + Math.floor(PRE_TOOL_MAX_FUTURE_SKEW_MS / 1000);
}

function validEpochMilliseconds(value: number, referenceMs: number): boolean {
  return Number.isSafeInteger(value)
    && value >= PRE_TOOL_MIN_EPOCH_MS
    && value <= referenceMs + PRE_TOOL_MAX_FUTURE_SKEW_MS;
}

function forceDelegationEvents(
  value: Record<string, unknown> | null,
  referenceSec: number,
): StoredForceDelegationEvent[] {
  if (!Array.isArray(value?.events)) return [];
  return value.events.flatMap((event) => {
    if (!isRecord(event)) return [];
    const tool =
      typeof event.tool === 'string'
        ? event.tool
        : typeof event.toolName === 'string'
          ? event.toolName
          : '';
    const t =
      typeof event.t === 'number'
        ? event.t
        : typeof event.observedAtSec === 'number'
          ? event.observedAtSec
          : Number.NaN;
    const intentId =
      typeof event.intentId === 'string'
        ? event.intentId
        : typeof event.intent_id === 'string'
          ? event.intent_id
          : '';
    const disposition =
      event.disposition === 'rejected' ? 'rejected' : 'accepted';
    if (!tool || !validEpochSeconds(t, referenceSec)) return [];
    return [{
      tool,
      t,
      originalIndex:
        typeof event.originalIndex === 'number'
          ? event.originalIndex
          : 0,
      intentId,
      disposition:
        event.disposition === 'reserved' ? 'reserved' : disposition,
    }];
  });
}

function forceDelegationState(
  value: Record<string, unknown> | null,
  referenceSec: number,
): { generation: number; events: StoredForceDelegationEvent[] } | null {
  const generation = storedGeneration(value?.generation);
  if (generation === null) return null;
  return {
    generation,
    events: forceDelegationEvents(value, referenceSec),
  };
}

function boundedForceDelegationEvents(
  events: readonly StoredForceDelegationEvent[],
  retentionReferenceSec: number,
  validationReferenceSec = retentionReferenceSec,
): StoredForceDelegationEvent[] {
  const cutoff =
    retentionReferenceSec - FORCE_DELEGATION_RETENTION_SECONDS;
  return [...events]
    .filter((event) =>
      event.t > cutoff
      && validEpochSeconds(event.t, validationReferenceSec),
    )
    .sort((left, right) =>
      left.t - right.t || left.originalIndex - right.originalIndex,
    )
    .slice(-FORCE_DELEGATION_MAX_EVENTS);
}

/**
 * Re-plan and reserve force-delegation attempts against the latest durable
 * ledger under one owner lock. Callers must use the returned plan for final
 * reduction; a failed reservation is an indeterminate safety failure.
 */
export function reserveAndPlanPreToolBatch(
  envelope: CanonicalHookEnvelope,
  snapshot: PreToolBatchSnapshot,
): ForceDelegationReservationResult {
  if (!snapshot.forceDelegation?.enforce) {
    return {
      status: 'planned',
      plan: planPreToolBatch(envelope, snapshot),
      generation: snapshot.forceDelegationLedger.generation ?? 0,
    };
  }
  if (!validEpochSeconds(
    snapshot.observedAtSec,
    Math.floor(Date.now() / 1000),
  )) {
    return {
      status: 'failed',
      reason: 'Invalid force-delegation observation timestamp.',
    };
  }
  const path = join(snapshot.stateDir, FORCE_DELEGATION_STATE_FILE);
  try {
    const locked = withStateFileMutationLock(path, () => {
      const lockNowMs = Date.now();
      const lockNowSec = Math.floor(lockNowMs / 1000);
      const inspected = inspectJsonRecord(path);
      if (inspected.status === 'corrupt') {
        return {
          status: 'failed' as const,
          reason: 'Corrupt force-delegation reservation ledger.',
        };
      }
      const persisted = forceDelegationState(
        inspected.status === 'valid' ? inspected.value : null,
        lockNowSec,
      );
      if (!persisted) {
        return {
          status: 'failed' as const,
          reason: 'Invalid force-delegation reservation generation.',
        };
      }
      const currentSnapshot: PreToolBatchSnapshot = {
        ...snapshot,
        observedAtSec: lockNowSec,
        forceDelegationLedger: {
          generation: persisted.generation,
          events: persisted.events.map((event) => ({
            toolName: event.tool,
            observedAtSec: event.t,
            originalIndex: event.originalIndex,
            ...(event.intentId ? { intentId: event.intentId } : {}),
          })),
        },
      };
      const plan = planPreToolBatch(envelope, currentSnapshot);
      const reservations = plan.evaluations.flatMap(
        (evaluation) => evaluation.effects ?? [],
      ).filter(
        (effect): effect is PreToolHookEffect =>
          effect.type === 'pretool.force-delegation-attempt.v1',
      );
      const events = [...persisted.events];
      let changed = false;
      for (const reservation of reservations) {
        const payload =
          reservation.payload as ForceDelegationAttemptEffectPayload;
        if (!validEpochSeconds(payload.observedAtSec, lockNowSec)) {
          return {
            status: 'failed' as const,
            reason: 'Invalid force-delegation reservation timestamp.',
          };
        }
        if (events.some((event) => event.intentId === payload.intentId)) {
          continue;
        }
        events.push({
          tool: payload.toolName,
          t: payload.observedAtSec,
          originalIndex: payload.originalIndex,
          intentId: payload.intentId,
          disposition: 'reserved',
        });
        changed = true;
      }
      const generation = changed
        ? nextGeneration(persisted.generation)
        : persisted.generation;
      if (generation === null) {
        return {
          status: 'failed' as const,
          reason: 'Force-delegation reservation generation exhausted.',
        };
      }
      if (changed) {
        atomicWriteJsonSync(path, {
          version: 3,
          generation,
          events: boundedForceDelegationEvents(
            events,
            lockNowSec,
          ),
        } satisfies StoredForceDelegationState);
      }
      return {
        status: 'planned' as const,
        plan,
        generation,
      };
    });
    return locked.acquired && locked.value
      ? locked.value
      : {
          status: 'failed',
          reason: 'Force-delegation reservation lock unavailable.',
        };
  } catch {
    return {
      status: 'failed',
      reason: 'Force-delegation reservation failed.',
    };
  }
}

/**
 * Atomic, bounded owner write for the force-delegation attempt window.
 */
export function writeForceDelegationAttemptLocked(
  payload: ForceDelegationAttemptEffectPayload,
  disposition: PreToolFinalDisposition,
): ForceDelegationWriteResult {
  if (!validEpochSeconds(
    payload.observedAtSec,
    Math.floor(Date.now() / 1000),
  )) {
    return { status: 'failed' };
  }
  try {
    const path = join(payload.stateDir, FORCE_DELEGATION_STATE_FILE);
    const locked = withStateFileMutationLock(path, () => {
      const lockNowSec = Math.floor(Date.now() / 1000);
      const inspected = inspectJsonRecord(path);
      if (inspected.status === 'corrupt') {
        return { status: 'failed' as const };
      }
      const persistedState = forceDelegationState(
        inspected.status === 'valid' ? inspected.value : null,
        lockNowSec,
      );
      if (!persistedState) return { status: 'failed' as const };
      const events = boundedForceDelegationEvents(
        persistedState.events,
        payload.observedAtSec,
        lockNowSec,
      );
      const nextEvent: StoredForceDelegationEvent = {
        tool: payload.toolName,
        t: payload.observedAtSec,
        originalIndex: payload.originalIndex,
        intentId: payload.intentId,
        disposition,
      };
      const existingIndex = events.findIndex(
        (event) => event.intentId === payload.intentId,
      );
      let status: ForceDelegationWriteResult['status'];
      if (existingIndex >= 0) {
        const existing = events[existingIndex];
        const reconciledEvent: StoredForceDelegationEvent = {
          ...nextEvent,
          t: existing.t,
        };
        if (
          existing.tool === reconciledEvent.tool
          && existing.originalIndex === reconciledEvent.originalIndex
          && existing.disposition === reconciledEvent.disposition
        ) {
          return { status: 'duplicate' as const };
        }
        events[existingIndex] = reconciledEvent;
        status = 'reconciled';
      } else {
        events.push(nextEvent);
        status = 'written';
      }

      const bounded = boundedForceDelegationEvents(
        events,
        payload.observedAtSec,
        lockNowSec,
      );
      const generation = nextGeneration(persistedState.generation);
      if (generation === null) return { status: 'failed' as const };
      atomicWriteJsonSync(path, {
        version: 3,
        generation,
        events: bounded,
      } satisfies StoredForceDelegationState);
      return { status };
    });

    return locked.acquired && locked.value
      ? locked.value
      : { status: 'failed' };
  } catch {
    return { status: 'failed' };
  }
}

function advisoryPath(stateDir: string, sessionId: string): string | null {
  if (sessionId && !SESSION_ID_PATTERN.test(sessionId)) return null;
  return sessionId
    ? join(stateDir, 'sessions', sessionId, ADVISORY_STATE_FILE)
    : join(stateDir, ADVISORY_STATE_FILE);
}

function advisoryEntries(
  value: Record<string, unknown> | null,
  referenceMs: number,
): Record<string, StoredAdvisoryEntry> {
  const entries = isRecord(value?.entries) ? value.entries : {};
  return Object.fromEntries(
    Object.entries(entries).flatMap(([key, entry]) => {
      if (!isRecord(entry)) return [];
      const last = Number(entry.last_emitted_at_ms);
      if (!validEpochMilliseconds(last, referenceMs)) return [];
      return [[key, {
        last_emitted_at_ms: last,
        message: typeof entry.message === 'string' ? entry.message : '',
        intent_id:
          typeof entry.intent_id === 'string' ? entry.intent_id : '',
      } satisfies StoredAdvisoryEntry]];
    }),
  );
}

function pruneAdvisoryEntries(
  entries: Record<string, StoredAdvisoryEntry>,
  retentionHorizonMs: number,
  cooldownMs: number,
  protectedKey?: string,
): Record<string, StoredAdvisoryEntry> {
  const pruneWindow = Math.max(
    cooldownMs * 2,
    ADVISORY_MIN_PRUNE_WINDOW_MS,
  );
  const protectedEntry = protectedKey
    ? entries[protectedKey]
    : undefined;
  const retainedPriorEntries = Object.entries(entries)
      .filter(([key, entry]) =>
        key !== protectedKey
        &&
        Number.isFinite(entry.last_emitted_at_ms)
        && retentionHorizonMs - entry.last_emitted_at_ms <= pruneWindow,
      )
      .sort(([leftKey, left], [rightKey, right]) =>
        right.last_emitted_at_ms - left.last_emitted_at_ms
        || leftKey.localeCompare(rightKey),
      )
      .slice(
        0,
        protectedEntry
          ? Math.max(0, ADVISORY_MAX_ENTRIES - 1)
          : ADVISORY_MAX_ENTRIES,
      );
  return Object.fromEntries([
    ...(protectedEntry && protectedKey
      ? [[protectedKey, protectedEntry] as const]
      : []),
    ...retainedPriorEntries,
  ]);
}

/**
 * Post-reduction tri-state advisory claim. State failure is indeterminate so
 * the caller can fail open and still emit the safety context.
 */
export function claimAdvisoryThrottleLocked(
  payload: AdvisoryClaimEffectPayload,
): AdvisoryClaimDisposition {
  if (!payload.message || payload.cooldownMs <= 0) return 'granted';
  if (!validEpochMilliseconds(payload.nowMs, Date.now())) {
    return 'indeterminate';
  }
  try {
    const path = advisoryPath(payload.stateDir, payload.sessionId);
    if (!path) return 'indeterminate';
    const locked = withStateFileMutationLock(path, () => {
      const lockNowMs = Date.now();
      if (!validEpochMilliseconds(payload.nowMs, lockNowMs)) {
        return 'indeterminate' as const;
      }
      const inspected = inspectJsonRecord(path);
      if (inspected.status === 'corrupt') return 'indeterminate' as const;
      const stored = inspected.status === 'valid' ? inspected.value : null;
      const generation = storedGeneration(stored?.generation);
      if (generation === null) return 'indeterminate' as const;
      const persisted = advisoryEntries(stored, lockNowMs);
      const previous = persisted[payload.messageHash];
      if (previous?.intent_id === payload.intentId) {
        return 'throttled' as const;
      }
      if (
        previous
        && (
          previous.last_emitted_at_ms > payload.nowMs
          || payload.nowMs - previous.last_emitted_at_ms < payload.cooldownMs
        )
      ) {
        return 'throttled' as const;
      }

      const retentionHorizonMs = Object.values(persisted).reduce(
        (latest, entry) => Math.max(latest, entry.last_emitted_at_ms),
        payload.nowMs,
      );
      const updatedAtHorizonMs = Math.max(
        retentionHorizonMs,
        typeof stored?.updated_at === 'string'
          && validEpochMilliseconds(
            Date.parse(stored.updated_at),
            lockNowMs,
          )
          ? Date.parse(stored.updated_at)
          : 0,
      );
      const entries = pruneAdvisoryEntries(
        persisted,
        retentionHorizonMs,
        payload.cooldownMs,
      );
      entries[payload.messageHash] = {
        last_emitted_at_ms: payload.nowMs,
        message: payload.message,
        intent_id: payload.intentId,
      };
      const bounded = pruneAdvisoryEntries(
        entries,
        retentionHorizonMs,
        payload.cooldownMs,
        payload.messageHash,
      );
      const next = nextGeneration(generation);
      if (next === null) return 'indeterminate' as const;
      atomicWriteJsonSync(path, {
        version: 2,
        generation: next,
        entries: bounded,
        updated_at: new Date(updatedAtHorizonMs).toISOString(),
      } satisfies StoredAdvisoryState);
      const committed = inspectJsonRecord(path);
      if (committed.status !== 'valid') return 'indeterminate' as const;
      const committedClaim = advisoryEntries(
        committed.value,
        lockNowMs,
      )[payload.messageHash];
      if (
        storedGeneration(committed.value.generation) !== next
        || committedClaim?.intent_id !== payload.intentId
        || committedClaim.last_emitted_at_ms !== payload.nowMs
      ) {
        return 'indeterminate' as const;
      }
      return 'granted' as const;
    });

    return locked.acquired && locked.value
      ? locked.value
      : 'indeterminate';
  } catch {
    return 'indeterminate';
  }
}

function appendTraceAttempt(
  payload: TraceSkillAttemptEffectPayload,
  disposition: PreToolFinalDisposition,
): ReplayAppendOnceResult {
  if (payload.sessionId && !SESSION_ID_PATTERN.test(payload.sessionId)) {
    return { status: 'failed' };
  }
  return appendReplayEventOnce(
    payload.directory,
    payload.sessionId,
    payload.intentId,
    {
      agent: 'system',
      event: 'skill_invoked',
      skill_name: payload.rawSkillName,
      skill_source: 'pre-tool-use',
      attempt: true,
      disposition,
      observed_at: payload.observedAt,
    },
    payload.observedAtMs,
  );
}

function upsertSupportSkill(
  payload: SupportSkillUpsertEffectPayload,
): SupportSkillMutationResult {
  const result = upsertSupportSkillActiveStateLocked(
    payload.directory,
    payload.skillName,
    payload.sessionId || undefined,
    payload.rawSkillName,
    {
      observedAt: payload.observedAt,
      intentId: payload.intentId,
    },
  );
  return { status: result.status };
}

function confirmMode(
  payload: ModeConfirmEffectPayload,
): ReturnType<PreToolEffectDependencies['confirmMode']> {
  const result = confirmModeAwaitingConfirmationLocked(
    payload.directory,
    payload.modeName,
    payload.sessionId || undefined,
    {
      path: payload.observedPath,
      ownerSessionId: payload.observedOwnerSessionId,
      generation: payload.observedGeneration,
      confirmationTimestamp: payload.observedConfirmationTimestamp,
      digest: payload.observedStateDigest,
    },
  );
  return { status: result.status };
}

async function notifyAskUser(
  payload: AskUserNotifyEffectPayload,
  runtimeContext: PreToolEffectRuntimeContext,
): Promise<NotificationOnceResult> {
  if (process.env.OMC_NOTIFY === '0') return { status: 'skipped' };
  if (
    !runtimeContext.notificationChildEntrypointPath
    || !runtimeContext.hookRuntimePath
  ) {
    return { status: 'failed' };
  }
  const claim = claimProvisionalNotificationReceipt(
    payload.intentId,
    'ask-user-question',
    payload.sessionId,
    payload.directory,
    Date.now(),
  );
  if (claim.status === 'duplicate') return { status: 'duplicate' };
  if (claim.status === 'failed') return { status: 'failed' };
  const dispatch = await dispatchNotificationInBackground(
    'ask-user-question',
    {
      sessionId: payload.sessionId,
      projectPath: payload.directory,
      question: payload.question,
    },
    {
      childEntrypointPath:
        runtimeContext.notificationChildEntrypointPath,
      hookRuntimePath: runtimeContext.hookRuntimePath,
    },
    {
      intentId: payload.intentId,
      claimId: claim.claimId,
    },
  );
  if (dispatch.status === 'acknowledged') {
    const finalized = finalizeNotificationReceiptQueued(
      payload.intentId,
      payload.sessionId,
      payload.directory,
      claim.claimId,
      Date.now(),
    );
    if (finalized === 'finalized') {
      return await dispatch.release() === 'released'
        ? { status: 'queued' }
        : { status: 'failed' };
    }
    dispatch.terminate();
    markNotificationReceiptRetryable(
      payload.intentId,
      payload.sessionId,
      payload.directory,
      claim.claimId,
      Date.now(),
    );
    return { status: 'failed' };
  }
  markNotificationReceiptRetryable(
    payload.intentId,
    payload.sessionId,
    payload.directory,
    claim.claimId,
    Date.now(),
  );
  return dispatch.status === 'disabled'
    ? { status: 'skipped' }
    : { status: 'failed' };
}

export const DEFAULT_PRE_TOOL_EFFECT_DEPENDENCIES:
PreToolEffectDependencies = {
  appendTraceAttempt,
  writeForceDelegationAttempt: writeForceDelegationAttemptLocked,
  upsertSupportSkill,
  confirmMode,
  claimAdvisory: claimAdvisoryThrottleLocked,
  notifyAskUser,
};

function isPreToolEffect(effect: HookEffect): effect is PreToolHookEffect {
  return (
    typeof effect.callId === 'string'
    && (effect.commitOn === 'accepted' || effect.commitOn === 'always')
    && isRecord(effect.payload)
    && effect.payload.version === PRE_TOOL_EFFECT_PAYLOAD_VERSION
    && typeof effect.payload.intentId === 'string'
    && typeof effect.payload.originalIndex === 'number'
    && [
      'pretool.trace-skill-attempt.v1',
      'pretool.force-delegation-attempt.v1',
      'pretool.support-skill-upsert.v1',
      'pretool.mode-confirm.v1',
      'pretool.advisory-claim.v1',
      'pretool.ask-user-notify.v1',
    ].includes(effect.type)
  );
}

function resultStatus(
  status: string,
): PreToolEffectCommitResult['status'] {
  switch (status) {
    case 'written':
    case 'appended':
    case 'reconciled':
    case 'repaired':
    case 'sent':
    case 'queued':
      return 'committed';
    case 'duplicate':
      return 'duplicate';
    case 'skipped':
      return 'skipped';
    default:
      return 'failed';
  }
}

async function commitOneEffect(
  effect: PreToolHookEffect,
  disposition: PreToolFinalDisposition,
  dependencies: PreToolEffectDependencies,
  runtimeContext: PreToolEffectRuntimeContext,
): Promise<PreToolEffectCommitResult> {
  const base = {
    type: effect.type,
    intentId: effect.payload.intentId,
    callId: effect.callId,
    originalIndex: effect.payload.originalIndex,
    commitOn: effect.commitOn,
    critical: effect.critical === true,
    disposition,
  } as const;

  try {
    switch (effect.type) {
      case 'pretool.trace-skill-attempt.v1': {
        const result = dependencies.appendTraceAttempt(
          effect.payload as TraceSkillAttemptEffectPayload,
          disposition,
        );
        return { ...base, status: resultStatus(result.status) };
      }
      case 'pretool.force-delegation-attempt.v1': {
        const result = dependencies.writeForceDelegationAttempt(
          effect.payload as ForceDelegationAttemptEffectPayload,
          disposition,
        );
        return { ...base, status: resultStatus(result.status) };
      }
      case 'pretool.support-skill-upsert.v1': {
        const result = dependencies.upsertSupportSkill(
          effect.payload as SupportSkillUpsertEffectPayload,
        );
        return { ...base, status: resultStatus(result.status) };
      }
      case 'pretool.mode-confirm.v1': {
        const result = dependencies.confirmMode(
          effect.payload as ModeConfirmEffectPayload,
        );
        const committed =
          result.status === 'written'
          || result.status === 'not-applicable';
        return {
          ...base,
          status: committed ? 'committed' : 'failed',
          ...(!committed
            ? {
                detail:
                  result.status === 'changed'
                    ? 'mode confirmation state changed; retry required'
                    : 'mode confirmation could not be verified',
              }
            : {}),
        };
      }
      case 'pretool.advisory-claim.v1': {
        const claim = dependencies.claimAdvisory(
          effect.payload as AdvisoryClaimEffectPayload,
        );
        return {
          ...base,
          status: claim === 'indeterminate' ? 'failed' : 'committed',
          advisoryClaim: claim,
        };
      }
      case 'pretool.ask-user-notify.v1': {
        const result = await dependencies.notifyAskUser(
          effect.payload as AskUserNotifyEffectPayload,
          runtimeContext,
        );
        return { ...base, status: resultStatus(result.status) };
      }
    }
  } catch (error) {
    return {
      ...base,
      status: 'failed',
      detail: error instanceof Error ? error.message : String(error),
      ...(effect.type === 'pretool.advisory-claim.v1'
        ? { advisoryClaim: 'indeterminate' as const }
        : {}),
    };
  }
}

/**
 * Commit typed effect intents only after canonical reduction. Always-attempt
 * telemetry is committed first, followed by accepted effects in call order.
 */
export async function commitPreToolEffects(
  stagedEffects: readonly HookEffect[],
  reduction: HookReduction,
  dependencies:
  PreToolEffectDependencies = DEFAULT_PRE_TOOL_EFFECT_DEPENDENCIES,
  runtimeContext: PreToolEffectRuntimeContext = {},
): Promise<PreToolEffectCommitReport> {
  const disposition: PreToolFinalDisposition =
    reduction.decision === 'pass' || reduction.decision === 'allow'
      ? 'accepted'
      : 'rejected';
  const indexed = stagedEffects
    .map((effect, index) => ({ effect, index }))
    .filter(
      (entry): entry is { effect: PreToolHookEffect; index: number } =>
        isPreToolEffect(entry.effect),
    )
    .filter(({ effect }) =>
      effect.commitOn === 'always' || disposition === 'accepted',
    )
    .sort((left, right) => {
      const commitOrder =
        Number(left.effect.commitOn === 'accepted')
        - Number(right.effect.commitOn === 'accepted');
      return commitOrder
        || left.effect.payload.originalIndex
          - right.effect.payload.originalIndex
        || left.index - right.index;
    });

  const seen = new Set<string>();
  const results: PreToolEffectCommitResult[] = [];
  const advisoryClaims: Record<string, AdvisoryClaimDisposition> = {};
  for (const { effect } of indexed) {
    if (seen.has(effect.payload.intentId)) {
      const duplicate: PreToolEffectCommitResult = {
        type: effect.type,
        intentId: effect.payload.intentId,
        callId: effect.callId,
        originalIndex: effect.payload.originalIndex,
        commitOn: effect.commitOn,
        critical: effect.critical === true,
        status: 'duplicate',
        disposition,
        ...(effect.type === 'pretool.advisory-claim.v1'
          ? { advisoryClaim: 'throttled' }
          : {}),
      };
      results.push(duplicate);
      if (duplicate.advisoryClaim) {
        advisoryClaims[duplicate.intentId] = duplicate.advisoryClaim;
      }
      continue;
    }
    seen.add(effect.payload.intentId);
    const result = await commitOneEffect(
      effect,
      disposition,
      dependencies,
      runtimeContext,
    );
    results.push(result);
    if (result.advisoryClaim) {
      advisoryClaims[result.intentId] = result.advisoryClaim;
    }
  }

  return {
    disposition,
    results,
    advisoryClaims,
  };
}
