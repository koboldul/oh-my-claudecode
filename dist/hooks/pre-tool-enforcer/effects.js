import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { atomicWriteJsonSync } from '../../lib/atomic-write.js';
import { confirmModeAwaitingConfirmationLocked, withStateFileMutationLock, } from '../../lib/mode-state-io.js';
import { claimProvisionalNotificationReceipt, finalizeNotificationReceiptQueued, markNotificationReceiptRetryable, } from '../../notifications/index.js';
import { dispatchNotificationInBackground, } from '../background-notifications.js';
import { upsertSupportSkillActiveStateLocked } from '../skill-state/index.js';
import { appendReplayEventOnce } from '../subagent-tracker/session-replay.js';
import { PRE_TOOL_EFFECT_PAYLOAD_VERSION, PRE_TOOL_MAX_FUTURE_SKEW_MS, PRE_TOOL_MIN_EPOCH_MS, } from './types.js';
import { planPreToolBatch } from './evaluate.js';
const SESSION_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,255}$/;
const FORCE_DELEGATION_STATE_FILE = 'force-agent-delegation-events.json';
const FORCE_DELEGATION_RETENTION_SECONDS = 60 * 60;
const FORCE_DELEGATION_MAX_EVENTS = 2_000;
const ADVISORY_STATE_FILE = 'pre-tool-advisory-throttle.json';
const ADVISORY_MAX_ENTRIES = 100;
const ADVISORY_MIN_PRUNE_WINDOW_MS = 60 * 60 * 1000;
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function inspectJsonRecord(path) {
    if (!existsSync(path))
        return { status: 'missing' };
    try {
        const parsed = JSON.parse(readFileSync(path, 'utf8'));
        return isRecord(parsed)
            ? { status: 'valid', value: parsed }
            : { status: 'corrupt' };
    }
    catch {
        return { status: 'corrupt' };
    }
}
function storedGeneration(value) {
    if (value === undefined)
        return 0;
    return typeof value === 'number'
        && Number.isSafeInteger(value)
        && value >= 0
        ? value
        : null;
}
function nextGeneration(generation) {
    return generation < Number.MAX_SAFE_INTEGER
        ? generation + 1
        : null;
}
function validEpochSeconds(value, referenceSec) {
    return Number.isSafeInteger(value)
        && value >= Math.floor(PRE_TOOL_MIN_EPOCH_MS / 1000)
        && value <=
            referenceSec + Math.floor(PRE_TOOL_MAX_FUTURE_SKEW_MS / 1000);
}
function validEpochMilliseconds(value, referenceMs) {
    return Number.isSafeInteger(value)
        && value >= PRE_TOOL_MIN_EPOCH_MS
        && value <= referenceMs + PRE_TOOL_MAX_FUTURE_SKEW_MS;
}
function forceDelegationEvents(value, referenceSec) {
    if (!Array.isArray(value?.events))
        return [];
    return value.events.flatMap((event) => {
        if (!isRecord(event))
            return [];
        const tool = typeof event.tool === 'string'
            ? event.tool
            : typeof event.toolName === 'string'
                ? event.toolName
                : '';
        const t = typeof event.t === 'number'
            ? event.t
            : typeof event.observedAtSec === 'number'
                ? event.observedAtSec
                : Number.NaN;
        const intentId = typeof event.intentId === 'string'
            ? event.intentId
            : typeof event.intent_id === 'string'
                ? event.intent_id
                : '';
        const disposition = event.disposition === 'rejected' ? 'rejected' : 'accepted';
        if (!tool || !validEpochSeconds(t, referenceSec))
            return [];
        return [{
                tool,
                t,
                originalIndex: typeof event.originalIndex === 'number'
                    ? event.originalIndex
                    : 0,
                intentId,
                disposition: event.disposition === 'reserved' ? 'reserved' : disposition,
            }];
    });
}
function forceDelegationState(value, referenceSec) {
    const generation = storedGeneration(value?.generation);
    if (generation === null)
        return null;
    return {
        generation,
        events: forceDelegationEvents(value, referenceSec),
    };
}
function boundedForceDelegationEvents(events, retentionReferenceSec, validationReferenceSec = retentionReferenceSec) {
    const cutoff = retentionReferenceSec - FORCE_DELEGATION_RETENTION_SECONDS;
    return [...events]
        .filter((event) => event.t > cutoff
        && validEpochSeconds(event.t, validationReferenceSec))
        .sort((left, right) => left.t - right.t || left.originalIndex - right.originalIndex)
        .slice(-FORCE_DELEGATION_MAX_EVENTS);
}
/**
 * Re-plan and reserve force-delegation attempts against the latest durable
 * ledger under one owner lock. Callers must use the returned plan for final
 * reduction; a failed reservation is an indeterminate safety failure.
 */
export function reserveAndPlanPreToolBatch(envelope, snapshot) {
    if (!snapshot.forceDelegation?.enforce) {
        return {
            status: 'planned',
            plan: planPreToolBatch(envelope, snapshot),
            generation: snapshot.forceDelegationLedger.generation ?? 0,
        };
    }
    if (!validEpochSeconds(snapshot.observedAtSec, Math.floor(Date.now() / 1000))) {
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
                    status: 'failed',
                    reason: 'Corrupt force-delegation reservation ledger.',
                };
            }
            const persisted = forceDelegationState(inspected.status === 'valid' ? inspected.value : null, lockNowSec);
            if (!persisted) {
                return {
                    status: 'failed',
                    reason: 'Invalid force-delegation reservation generation.',
                };
            }
            const currentSnapshot = {
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
            const reservations = plan.evaluations.flatMap((evaluation) => evaluation.effects ?? []).filter((effect) => effect.type === 'pretool.force-delegation-attempt.v1');
            const events = [...persisted.events];
            let changed = false;
            for (const reservation of reservations) {
                const payload = reservation.payload;
                if (!validEpochSeconds(payload.observedAtSec, lockNowSec)) {
                    return {
                        status: 'failed',
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
                    status: 'failed',
                    reason: 'Force-delegation reservation generation exhausted.',
                };
            }
            if (changed) {
                atomicWriteJsonSync(path, {
                    version: 3,
                    generation,
                    events: boundedForceDelegationEvents(events, lockNowSec),
                });
            }
            return {
                status: 'planned',
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
    }
    catch {
        return {
            status: 'failed',
            reason: 'Force-delegation reservation failed.',
        };
    }
}
/**
 * Atomic, bounded owner write for the force-delegation attempt window.
 */
export function writeForceDelegationAttemptLocked(payload, disposition) {
    if (!validEpochSeconds(payload.observedAtSec, Math.floor(Date.now() / 1000))) {
        return { status: 'failed' };
    }
    try {
        const path = join(payload.stateDir, FORCE_DELEGATION_STATE_FILE);
        const locked = withStateFileMutationLock(path, () => {
            const lockNowSec = Math.floor(Date.now() / 1000);
            const inspected = inspectJsonRecord(path);
            if (inspected.status === 'corrupt') {
                return { status: 'failed' };
            }
            const persistedState = forceDelegationState(inspected.status === 'valid' ? inspected.value : null, lockNowSec);
            if (!persistedState)
                return { status: 'failed' };
            const events = boundedForceDelegationEvents(persistedState.events, payload.observedAtSec, lockNowSec);
            const nextEvent = {
                tool: payload.toolName,
                t: payload.observedAtSec,
                originalIndex: payload.originalIndex,
                intentId: payload.intentId,
                disposition,
            };
            const existingIndex = events.findIndex((event) => event.intentId === payload.intentId);
            let status;
            if (existingIndex >= 0) {
                const existing = events[existingIndex];
                const reconciledEvent = {
                    ...nextEvent,
                    t: existing.t,
                };
                if (existing.tool === reconciledEvent.tool
                    && existing.originalIndex === reconciledEvent.originalIndex
                    && existing.disposition === reconciledEvent.disposition) {
                    return { status: 'duplicate' };
                }
                events[existingIndex] = reconciledEvent;
                status = 'reconciled';
            }
            else {
                events.push(nextEvent);
                status = 'written';
            }
            const bounded = boundedForceDelegationEvents(events, payload.observedAtSec, lockNowSec);
            const generation = nextGeneration(persistedState.generation);
            if (generation === null)
                return { status: 'failed' };
            atomicWriteJsonSync(path, {
                version: 3,
                generation,
                events: bounded,
            });
            return { status };
        });
        return locked.acquired && locked.value
            ? locked.value
            : { status: 'failed' };
    }
    catch {
        return { status: 'failed' };
    }
}
function advisoryPath(stateDir, sessionId) {
    if (sessionId && !SESSION_ID_PATTERN.test(sessionId))
        return null;
    return sessionId
        ? join(stateDir, 'sessions', sessionId, ADVISORY_STATE_FILE)
        : join(stateDir, ADVISORY_STATE_FILE);
}
function advisoryEntries(value, referenceMs) {
    const entries = isRecord(value?.entries) ? value.entries : {};
    return Object.fromEntries(Object.entries(entries).flatMap(([key, entry]) => {
        if (!isRecord(entry))
            return [];
        const last = Number(entry.last_emitted_at_ms);
        if (!validEpochMilliseconds(last, referenceMs))
            return [];
        return [[key, {
                    last_emitted_at_ms: last,
                    message: typeof entry.message === 'string' ? entry.message : '',
                    intent_id: typeof entry.intent_id === 'string' ? entry.intent_id : '',
                }]];
    }));
}
function pruneAdvisoryEntries(entries, retentionHorizonMs, cooldownMs, protectedKey) {
    const pruneWindow = Math.max(cooldownMs * 2, ADVISORY_MIN_PRUNE_WINDOW_MS);
    const protectedEntry = protectedKey
        ? entries[protectedKey]
        : undefined;
    const retainedPriorEntries = Object.entries(entries)
        .filter(([key, entry]) => key !== protectedKey
        &&
            Number.isFinite(entry.last_emitted_at_ms)
        && retentionHorizonMs - entry.last_emitted_at_ms <= pruneWindow)
        .sort(([leftKey, left], [rightKey, right]) => right.last_emitted_at_ms - left.last_emitted_at_ms
        || leftKey.localeCompare(rightKey))
        .slice(0, protectedEntry
        ? Math.max(0, ADVISORY_MAX_ENTRIES - 1)
        : ADVISORY_MAX_ENTRIES);
    return Object.fromEntries([
        ...(protectedEntry && protectedKey
            ? [[protectedKey, protectedEntry]]
            : []),
        ...retainedPriorEntries,
    ]);
}
/**
 * Post-reduction tri-state advisory claim. State failure is indeterminate so
 * the caller can fail open and still emit the safety context.
 */
export function claimAdvisoryThrottleLocked(payload) {
    if (!payload.message || payload.cooldownMs <= 0)
        return 'granted';
    if (!validEpochMilliseconds(payload.nowMs, Date.now())) {
        return 'indeterminate';
    }
    try {
        const path = advisoryPath(payload.stateDir, payload.sessionId);
        if (!path)
            return 'indeterminate';
        const locked = withStateFileMutationLock(path, () => {
            const lockNowMs = Date.now();
            if (!validEpochMilliseconds(payload.nowMs, lockNowMs)) {
                return 'indeterminate';
            }
            const inspected = inspectJsonRecord(path);
            if (inspected.status === 'corrupt')
                return 'indeterminate';
            const stored = inspected.status === 'valid' ? inspected.value : null;
            const generation = storedGeneration(stored?.generation);
            if (generation === null)
                return 'indeterminate';
            const persisted = advisoryEntries(stored, lockNowMs);
            const previous = persisted[payload.messageHash];
            if (previous?.intent_id === payload.intentId) {
                return 'throttled';
            }
            if (previous
                && (previous.last_emitted_at_ms > payload.nowMs
                    || payload.nowMs - previous.last_emitted_at_ms < payload.cooldownMs)) {
                return 'throttled';
            }
            const retentionHorizonMs = Object.values(persisted).reduce((latest, entry) => Math.max(latest, entry.last_emitted_at_ms), payload.nowMs);
            const updatedAtHorizonMs = Math.max(retentionHorizonMs, typeof stored?.updated_at === 'string'
                && validEpochMilliseconds(Date.parse(stored.updated_at), lockNowMs)
                ? Date.parse(stored.updated_at)
                : 0);
            const entries = pruneAdvisoryEntries(persisted, retentionHorizonMs, payload.cooldownMs);
            entries[payload.messageHash] = {
                last_emitted_at_ms: payload.nowMs,
                message: payload.message,
                intent_id: payload.intentId,
            };
            const bounded = pruneAdvisoryEntries(entries, retentionHorizonMs, payload.cooldownMs, payload.messageHash);
            const next = nextGeneration(generation);
            if (next === null)
                return 'indeterminate';
            atomicWriteJsonSync(path, {
                version: 2,
                generation: next,
                entries: bounded,
                updated_at: new Date(updatedAtHorizonMs).toISOString(),
            });
            const committed = inspectJsonRecord(path);
            if (committed.status !== 'valid')
                return 'indeterminate';
            const committedClaim = advisoryEntries(committed.value, lockNowMs)[payload.messageHash];
            if (storedGeneration(committed.value.generation) !== next
                || committedClaim?.intent_id !== payload.intentId
                || committedClaim.last_emitted_at_ms !== payload.nowMs) {
                return 'indeterminate';
            }
            return 'granted';
        });
        return locked.acquired && locked.value
            ? locked.value
            : 'indeterminate';
    }
    catch {
        return 'indeterminate';
    }
}
function appendTraceAttempt(payload, disposition) {
    if (payload.sessionId && !SESSION_ID_PATTERN.test(payload.sessionId)) {
        return { status: 'failed' };
    }
    return appendReplayEventOnce(payload.directory, payload.sessionId, payload.intentId, {
        agent: 'system',
        event: 'skill_invoked',
        skill_name: payload.rawSkillName,
        skill_source: 'pre-tool-use',
        attempt: true,
        disposition,
        observed_at: payload.observedAt,
    }, payload.observedAtMs);
}
function upsertSupportSkill(payload) {
    const result = upsertSupportSkillActiveStateLocked(payload.directory, payload.skillName, payload.sessionId || undefined, payload.rawSkillName, {
        observedAt: payload.observedAt,
        intentId: payload.intentId,
    });
    return { status: result.status };
}
function confirmMode(payload) {
    const result = confirmModeAwaitingConfirmationLocked(payload.directory, payload.modeName, payload.sessionId || undefined, {
        path: payload.observedPath,
        ownerSessionId: payload.observedOwnerSessionId,
        generation: payload.observedGeneration,
        confirmationTimestamp: payload.observedConfirmationTimestamp,
        digest: payload.observedStateDigest,
    });
    return { status: result.status };
}
async function notifyAskUser(payload, runtimeContext) {
    if (process.env.OMC_NOTIFY === '0')
        return { status: 'skipped' };
    if (!runtimeContext.notificationChildEntrypointPath
        || !runtimeContext.hookRuntimePath) {
        return { status: 'failed' };
    }
    const claim = claimProvisionalNotificationReceipt(payload.intentId, 'ask-user-question', payload.sessionId, payload.directory, Date.now());
    if (claim.status === 'duplicate')
        return { status: 'duplicate' };
    if (claim.status === 'failed')
        return { status: 'failed' };
    const dispatch = await dispatchNotificationInBackground('ask-user-question', {
        sessionId: payload.sessionId,
        projectPath: payload.directory,
        question: payload.question,
    }, {
        childEntrypointPath: runtimeContext.notificationChildEntrypointPath,
        hookRuntimePath: runtimeContext.hookRuntimePath,
    }, {
        intentId: payload.intentId,
        claimId: claim.claimId,
    });
    if (dispatch.status === 'acknowledged') {
        const finalized = finalizeNotificationReceiptQueued(payload.intentId, payload.sessionId, payload.directory, claim.claimId, Date.now());
        if (finalized === 'finalized') {
            return await dispatch.release() === 'released'
                ? { status: 'queued' }
                : { status: 'failed' };
        }
        dispatch.terminate();
        markNotificationReceiptRetryable(payload.intentId, payload.sessionId, payload.directory, claim.claimId, Date.now());
        return { status: 'failed' };
    }
    markNotificationReceiptRetryable(payload.intentId, payload.sessionId, payload.directory, claim.claimId, Date.now());
    return dispatch.status === 'disabled'
        ? { status: 'skipped' }
        : { status: 'failed' };
}
export const DEFAULT_PRE_TOOL_EFFECT_DEPENDENCIES = {
    appendTraceAttempt,
    writeForceDelegationAttempt: writeForceDelegationAttemptLocked,
    upsertSupportSkill,
    confirmMode,
    claimAdvisory: claimAdvisoryThrottleLocked,
    notifyAskUser,
};
function isPreToolEffect(effect) {
    return (typeof effect.callId === 'string'
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
        ].includes(effect.type));
}
function resultStatus(status) {
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
async function commitOneEffect(effect, disposition, dependencies, runtimeContext) {
    const base = {
        type: effect.type,
        intentId: effect.payload.intentId,
        callId: effect.callId,
        originalIndex: effect.payload.originalIndex,
        commitOn: effect.commitOn,
        critical: effect.critical === true,
        disposition,
    };
    try {
        switch (effect.type) {
            case 'pretool.trace-skill-attempt.v1': {
                const result = dependencies.appendTraceAttempt(effect.payload, disposition);
                return { ...base, status: resultStatus(result.status) };
            }
            case 'pretool.force-delegation-attempt.v1': {
                const result = dependencies.writeForceDelegationAttempt(effect.payload, disposition);
                return { ...base, status: resultStatus(result.status) };
            }
            case 'pretool.support-skill-upsert.v1': {
                const result = dependencies.upsertSupportSkill(effect.payload);
                return { ...base, status: resultStatus(result.status) };
            }
            case 'pretool.mode-confirm.v1': {
                const result = dependencies.confirmMode(effect.payload);
                const committed = result.status === 'written'
                    || result.status === 'not-applicable';
                return {
                    ...base,
                    status: committed ? 'committed' : 'failed',
                    ...(!committed
                        ? {
                            detail: result.status === 'changed'
                                ? 'mode confirmation state changed; retry required'
                                : 'mode confirmation could not be verified',
                        }
                        : {}),
                };
            }
            case 'pretool.advisory-claim.v1': {
                const claim = dependencies.claimAdvisory(effect.payload);
                return {
                    ...base,
                    status: claim === 'indeterminate' ? 'failed' : 'committed',
                    advisoryClaim: claim,
                };
            }
            case 'pretool.ask-user-notify.v1': {
                const result = await dependencies.notifyAskUser(effect.payload, runtimeContext);
                return { ...base, status: resultStatus(result.status) };
            }
        }
    }
    catch (error) {
        return {
            ...base,
            status: 'failed',
            detail: error instanceof Error ? error.message : String(error),
            ...(effect.type === 'pretool.advisory-claim.v1'
                ? { advisoryClaim: 'indeterminate' }
                : {}),
        };
    }
}
/**
 * Commit typed effect intents only after canonical reduction. Always-attempt
 * telemetry is committed first, followed by accepted effects in call order.
 */
export async function commitPreToolEffects(stagedEffects, reduction, dependencies = DEFAULT_PRE_TOOL_EFFECT_DEPENDENCIES, runtimeContext = {}) {
    const disposition = reduction.decision === 'pass' || reduction.decision === 'allow'
        ? 'accepted'
        : 'rejected';
    const indexed = stagedEffects
        .map((effect, index) => ({ effect, index }))
        .filter((entry) => isPreToolEffect(entry.effect))
        .filter(({ effect }) => effect.commitOn === 'always' || disposition === 'accepted')
        .sort((left, right) => {
        const commitOrder = Number(left.effect.commitOn === 'accepted')
            - Number(right.effect.commitOn === 'accepted');
        return commitOrder
            || left.effect.payload.originalIndex
                - right.effect.payload.originalIndex
            || left.index - right.index;
    });
    const seen = new Set();
    const results = [];
    const advisoryClaims = {};
    for (const { effect } of indexed) {
        if (seen.has(effect.payload.intentId)) {
            const duplicate = {
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
        const result = await commitOneEffect(effect, disposition, dependencies, runtimeContext);
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
//# sourceMappingURL=effects.js.map