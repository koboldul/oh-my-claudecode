import type { CanonicalHookEnvelope, CanonicalToolCall } from '../hook-protocol.js';
import { type AdvisoryCandidate, type PreToolBatchPlan, type PreToolBatchSnapshot, type PreToolCallPlan, type PreToolHookEffect, type VirtualForceDelegationLedger } from './types.js';
export interface ModelRoutingEvaluation {
    readonly updatedInput?: Readonly<Record<string, unknown>>;
    readonly warning: string;
    readonly denyReason?: string;
}
export interface ForceDelegationEvaluation {
    readonly nextLedger: VirtualForceDelegationLedger;
    readonly effect?: PreToolHookEffect;
    readonly denyReason?: string;
}
/**
 * Pure model/default routing. All environment, config, and definition reads
 * are supplied by the immutable batch snapshot.
 */
export declare function evaluateModelRouting(call: CanonicalToolCall, envelope: CanonicalHookEnvelope, snapshot: PreToolBatchSnapshot): ModelRoutingEvaluation;
/**
 * Pure ultragoal gate using only the immutable state/goal snapshot.
 */
export declare function evaluateUltragoal(call: CanonicalToolCall, snapshot: PreToolBatchSnapshot): string | undefined;
/**
 * Pure force-delegation fold. The returned ledger includes the current call,
 * so later calls in the same batch observe preceding attempts in host order.
 */
export declare function evaluateForceDelegationPure(call: CanonicalToolCall, snapshot: PreToolBatchSnapshot, ledger: VirtualForceDelegationLedger): ForceDelegationEvaluation;
/**
 * Build a typed advisory claim without reading or writing throttle state.
 */
export declare function buildAdvisoryCandidate(call: CanonicalToolCall, snapshot: PreToolBatchSnapshot, message: string): AdvisoryCandidate | undefined;
/**
 * Evaluate one canonical call without any filesystem, environment, clock,
 * subprocess, import, notification, or trace access.
 */
export declare function evaluatePreToolCall(call: CanonicalToolCall, envelope: CanonicalHookEnvelope, snapshot: PreToolBatchSnapshot, ledger: VirtualForceDelegationLedger): PreToolCallPlan;
/**
 * Fold canonical calls in original host order while threading the virtual
 * force-delegation ledger. Duplicate advisory messages are claimed once.
 */
export declare function planPreToolBatch(envelope: CanonicalHookEnvelope, snapshot: PreToolBatchSnapshot): PreToolBatchPlan;
//# sourceMappingURL=evaluate.d.ts.map