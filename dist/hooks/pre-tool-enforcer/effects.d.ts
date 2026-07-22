import type { CanonicalHookEnvelope, HookEffect, HookReduction } from '../hook-protocol.js';
import { type AdvisoryClaimDisposition, type AdvisoryClaimEffectPayload, type ForceDelegationAttemptEffectPayload, type ForceDelegationReservationResult, type ForceDelegationWriteResult, type PreToolEffectCommitReport, type PreToolEffectDependencies, type PreToolEffectRuntimeContext, type PreToolFinalDisposition, type PreToolBatchSnapshot } from './types.js';
/**
 * Re-plan and reserve force-delegation attempts against the latest durable
 * ledger under one owner lock. Callers must use the returned plan for final
 * reduction; a failed reservation is an indeterminate safety failure.
 */
export declare function reserveAndPlanPreToolBatch(envelope: CanonicalHookEnvelope, snapshot: PreToolBatchSnapshot): ForceDelegationReservationResult;
/**
 * Atomic, bounded owner write for the force-delegation attempt window.
 */
export declare function writeForceDelegationAttemptLocked(payload: ForceDelegationAttemptEffectPayload, disposition: PreToolFinalDisposition): ForceDelegationWriteResult;
/**
 * Post-reduction tri-state advisory claim. State failure is indeterminate so
 * the caller can fail open and still emit the safety context.
 */
export declare function claimAdvisoryThrottleLocked(payload: AdvisoryClaimEffectPayload): AdvisoryClaimDisposition;
export declare const DEFAULT_PRE_TOOL_EFFECT_DEPENDENCIES: PreToolEffectDependencies;
/**
 * Commit typed effect intents only after canonical reduction. Always-attempt
 * telemetry is committed first, followed by accepted effects in call order.
 */
export declare function commitPreToolEffects(stagedEffects: readonly HookEffect[], reduction: HookReduction, dependencies?: PreToolEffectDependencies, runtimeContext?: PreToolEffectRuntimeContext): Promise<PreToolEffectCommitReport>;
//# sourceMappingURL=effects.d.ts.map