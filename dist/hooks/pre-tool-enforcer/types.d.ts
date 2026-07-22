import type { CanonicalGoalSnapshot, CanonicalHookEnvelope, CanonicalToolCall, HookEffect, HookEvaluation, HookReduction } from '../hook-protocol.js';
export declare const PRE_TOOL_SNAPSHOT_VERSION: 1;
export declare const PRE_TOOL_EFFECT_PAYLOAD_VERSION: 1;
export declare const PRE_TOOL_MAX_FUTURE_SKEW_MS: number;
export declare const PRE_TOOL_MIN_EPOCH_MS: number;
export type PreToolFinalDisposition = 'accepted' | 'rejected';
export type AdvisoryClaimDisposition = 'granted' | 'throttled' | 'indeterminate';
export interface PreToolTodoSnapshot {
    readonly pending: number;
    readonly inProgress: number;
    readonly label: string;
}
export interface PreToolTrackingSnapshot {
    readonly running: number;
    readonly total: number;
}
export interface PreToolTeamSnapshot {
    readonly active: boolean;
    readonly teamName?: string;
}
export interface PreToolStateSnapshot {
    readonly path: string;
    readonly state: Readonly<Record<string, unknown>> | null;
}
export interface PreToolTranscriptSnapshot {
    readonly path?: string;
    readonly tail: string;
    readonly contextPercent: number;
    readonly contextThreshold: number;
    readonly goal?: CanonicalGoalSnapshot;
}
export interface PreToolCopilotDefaultsSnapshot {
    readonly model: string;
    readonly reasoningEffort: string;
    readonly warning: string;
}
export interface PreToolModelRoutingSnapshot {
    readonly forceInherit: boolean;
    readonly claudeModel: string;
    readonly anthropicModel: string;
    readonly anthropicBaseUrl: string;
    readonly useBedrock: boolean;
    readonly useVertex: boolean;
    readonly configuredAgentModels: Readonly<Record<string, string | null>>;
    readonly agentDefinitionModels: Readonly<Record<string, string | null>>;
    readonly copilotDefaults: PreToolCopilotDefaultsSnapshot;
    readonly tierEnvironment: Readonly<Record<string, string>>;
}
export interface ForceDelegationThreshold {
    readonly count?: number;
    readonly windowSeconds?: number;
}
export interface ForceDelegationRule {
    readonly pattern?: string;
    readonly threshold?: ForceDelegationThreshold;
    readonly denyMessage?: string;
    readonly bypassEnv?: string;
}
export interface ForceDelegationConfig {
    readonly enforce: boolean;
    readonly rules: readonly ForceDelegationRule[];
}
export interface VirtualForceDelegationEvent {
    readonly toolName: string;
    readonly observedAtSec: number;
    readonly originalIndex: number;
    readonly intentId?: string;
}
export interface VirtualForceDelegationLedger {
    readonly generation?: number;
    readonly events: readonly VirtualForceDelegationEvent[];
}
export interface PreToolUltragoalSnapshot {
    readonly state: Readonly<Record<string, unknown>> | null;
    readonly statePath?: string;
    readonly plan: Readonly<Record<string, unknown>> | null;
    readonly expectedObjective: string;
    readonly terminal: boolean;
    readonly goal?: CanonicalGoalSnapshot;
}
export interface AdvisoryThrottleEntry {
    readonly last_emitted_at_ms?: number;
    readonly message?: string;
    readonly intent_id?: string;
}
export interface AdvisoryThrottleSnapshot {
    readonly path: string;
    readonly nowMs: number;
    readonly cooldownMs: number;
    readonly entries: Readonly<Record<string, AdvisoryThrottleEntry>>;
}
export interface PreToolBatchSnapshot {
    readonly version: typeof PRE_TOOL_SNAPSHOT_VERSION;
    readonly loadedAtMs: number;
    readonly observedAt: string;
    readonly observedAtSec: number;
    readonly directory: string;
    readonly omcRoot: string;
    readonly stateDir: string;
    readonly sessionId: string;
    readonly deliveryId: string;
    readonly environment: Readonly<Record<string, string | undefined>>;
    readonly disabled: boolean;
    readonly quietLevel: number;
    readonly todo: PreToolTodoSnapshot;
    readonly tracking: PreToolTrackingSnapshot;
    readonly team: PreToolTeamSnapshot;
    readonly modeActive: boolean;
    readonly modeStates: Readonly<Record<string, PreToolStateSnapshot>>;
    readonly omcConfig: Readonly<Record<string, unknown>>;
    readonly modelRouting: PreToolModelRoutingSnapshot;
    readonly transcript: PreToolTranscriptSnapshot;
    readonly ultragoal: PreToolUltragoalSnapshot;
    readonly forceDelegation: ForceDelegationConfig | null;
    readonly forceDelegationLedger: VirtualForceDelegationLedger;
    readonly advisoryThrottle: AdvisoryThrottleSnapshot;
}
export type LegacyPresentation = {
    readonly kind: 'continue';
    readonly callId?: string;
} | {
    readonly kind: 'suppressed';
    readonly callId?: string;
} | {
    readonly kind: 'suppressed-with-mutation';
    readonly callId?: string;
    readonly updatedInput: Readonly<Record<string, unknown>>;
} | {
    readonly kind: 'hook-deny';
    readonly callId?: string;
    readonly reason: string;
} | {
    readonly kind: 'raw-block';
    readonly callId?: string;
    readonly reason: string;
} | {
    readonly kind: 'context';
    readonly callId?: string;
    readonly context: string;
    readonly updatedInput?: Readonly<Record<string, unknown>>;
    readonly advisoryIntentId?: string;
};
export interface PreToolEffectPayloadBase {
    readonly version: typeof PRE_TOOL_EFFECT_PAYLOAD_VERSION;
    readonly intentId: string;
    readonly originalIndex: number;
}
export interface TraceSkillAttemptEffectPayload extends PreToolEffectPayloadBase {
    readonly directory: string;
    readonly sessionId: string;
    readonly skillName: string;
    readonly rawSkillName: string;
    readonly observedAt: string;
    readonly observedAtMs: number;
}
export interface ForceDelegationAttemptEffectPayload extends PreToolEffectPayloadBase {
    readonly stateDir: string;
    readonly toolName: string;
    readonly observedAtSec: number;
}
export interface SupportSkillUpsertEffectPayload extends PreToolEffectPayloadBase {
    readonly directory: string;
    readonly sessionId: string;
    readonly skillName: string;
    readonly rawSkillName: string;
    readonly protection: 'light' | 'medium' | 'heavy';
    readonly observedAt: string;
}
export interface ModeConfirmEffectPayload extends PreToolEffectPayloadBase {
    readonly directory: string;
    readonly stateDir: string;
    readonly sessionId: string;
    readonly modeName: string;
    readonly observedPath: string;
    readonly observedOwnerSessionId: string;
    readonly observedGeneration: number | null;
    readonly observedConfirmationTimestamp: string;
    readonly observedStateDigest: string;
}
export interface AdvisoryClaimEffectPayload extends PreToolEffectPayloadBase {
    readonly stateDir: string;
    readonly sessionId: string;
    readonly message: string;
    readonly messageHash: string;
    readonly nowMs: number;
    readonly cooldownMs: number;
}
export interface AskUserNotifyEffectPayload extends PreToolEffectPayloadBase {
    readonly directory: string;
    readonly sessionId: string;
    readonly question: string;
}
export type PreToolEffectPayload = TraceSkillAttemptEffectPayload | ForceDelegationAttemptEffectPayload | SupportSkillUpsertEffectPayload | ModeConfirmEffectPayload | AdvisoryClaimEffectPayload | AskUserNotifyEffectPayload;
export type PreToolEffectType = 'pretool.trace-skill-attempt.v1' | 'pretool.force-delegation-attempt.v1' | 'pretool.support-skill-upsert.v1' | 'pretool.mode-confirm.v1' | 'pretool.advisory-claim.v1' | 'pretool.ask-user-notify.v1';
export interface PreToolHookEffect extends HookEffect {
    readonly type: PreToolEffectType;
    readonly payload: PreToolEffectPayload;
    readonly callId: string;
    readonly commitOn: 'accepted' | 'always';
}
export interface AdvisoryCandidate {
    readonly message: string;
    readonly messageHash: string;
    readonly intentId: string;
    readonly effect: PreToolHookEffect;
}
export interface PreToolCallPlan {
    readonly call: CanonicalToolCall;
    readonly evaluation: HookEvaluation;
    readonly legacyPresentation: LegacyPresentation;
    readonly nextForceDelegationLedger: VirtualForceDelegationLedger;
    readonly advisoryCandidate?: AdvisoryCandidate;
}
export interface PreToolBatchPlan {
    readonly envelope: CanonicalHookEnvelope;
    readonly snapshot: PreToolBatchSnapshot;
    readonly calls: readonly PreToolCallPlan[];
    readonly evaluations: readonly HookEvaluation[];
    readonly legacyPresentations: readonly LegacyPresentation[];
    readonly finalForceDelegationLedger: VirtualForceDelegationLedger;
}
export interface PreToolEffectCommitResult {
    readonly type: PreToolEffectType;
    readonly intentId: string;
    readonly callId: string;
    readonly originalIndex: number;
    readonly commitOn: 'accepted' | 'always';
    readonly critical: boolean;
    readonly status: 'committed' | 'duplicate' | 'skipped' | 'failed';
    readonly disposition: PreToolFinalDisposition;
    readonly advisoryClaim?: AdvisoryClaimDisposition;
    readonly detail?: string;
}
export interface PreToolEffectCommitReport {
    readonly disposition: PreToolFinalDisposition;
    readonly results: readonly PreToolEffectCommitResult[];
    readonly advisoryClaims: Readonly<Record<string, AdvisoryClaimDisposition>>;
}
export interface FinalizedPreToolReduction {
    readonly reduction: HookReduction;
    readonly legacyPresentation?: LegacyPresentation;
    readonly commitReport: PreToolEffectCommitReport;
}
export interface PreToolSnapshotDependencies {
    readonly now?: () => number;
    readonly createDeliveryNonce?: () => string;
    readonly currentDirectory?: () => string;
    readonly environment?: () => Readonly<Record<string, string | undefined>>;
    readonly resolveOmcRoot?: (directory: string) => string;
    readonly readJson?: (path: string) => unknown;
    readonly readText?: (path: string, maxBytes?: number) => string | null;
    readonly readTextTail?: (path: string, maxBytes: number) => string | null;
    readonly listDirectories?: (path: string) => readonly string[];
    readonly fileExists?: (path: string) => boolean;
}
export interface SupportSkillMutationResult {
    readonly status: 'written' | 'skipped' | 'repaired' | 'failed';
}
export interface ModeConfirmationMutationResult {
    readonly status: 'written' | 'not-applicable' | 'changed' | 'skipped' | 'failed';
}
export interface ReplayAppendOnceResult {
    readonly status: 'appended' | 'duplicate' | 'reconciled' | 'failed';
}
export interface NotificationOnceResult {
    readonly status: 'sent' | 'queued' | 'duplicate' | 'skipped' | 'failed';
}
export interface PreToolEffectRuntimeContext {
    readonly notificationChildEntrypointPath?: string;
    readonly hookRuntimePath?: string;
}
export interface ForceDelegationWriteResult {
    readonly status: 'written' | 'duplicate' | 'reconciled' | 'failed';
}
export type ForceDelegationReservationResult = {
    readonly status: 'planned';
    readonly plan: PreToolBatchPlan;
    readonly generation: number;
} | {
    readonly status: 'failed';
    readonly reason: string;
};
export interface PreToolEffectDependencies {
    readonly appendTraceAttempt: (payload: TraceSkillAttemptEffectPayload, disposition: PreToolFinalDisposition) => ReplayAppendOnceResult;
    readonly writeForceDelegationAttempt: (payload: ForceDelegationAttemptEffectPayload, disposition: PreToolFinalDisposition) => ForceDelegationWriteResult;
    readonly upsertSupportSkill: (payload: SupportSkillUpsertEffectPayload) => SupportSkillMutationResult;
    readonly confirmMode: (payload: ModeConfirmEffectPayload) => ModeConfirmationMutationResult;
    readonly claimAdvisory: (payload: AdvisoryClaimEffectPayload) => AdvisoryClaimDisposition;
    readonly notifyAskUser: (payload: AskUserNotifyEffectPayload, runtimeContext: PreToolEffectRuntimeContext) => Promise<NotificationOnceResult> | NotificationOnceResult;
}
//# sourceMappingURL=types.d.ts.map