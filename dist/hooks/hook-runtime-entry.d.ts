import type { HookInput } from './bridge.js';
import type { HookExecutionUnit, HookRunResult } from './hook-runtime.js';
import { type EncodedHookOutput } from './hook-output.js';
import type { CanonicalAgentRef, CanonicalHookEnvelope, CanonicalHookEventPayload, HookDecision, HookEffect, HookEvaluation, HookHost, HookMutationRequirement, HookReduction, HookContract, HookType, ShellDialect } from './hook-protocol.js';
export type LegacyHookInput = HookInput & Record<string, unknown>;
export type LegacyProcessorToolNameSource = 'canonical' | 'native';
export interface LegacyProcessorInputOptions {
    toolNameSource?: LegacyProcessorToolNameSource;
}
export interface LegacyProcessorInput extends CanonicalHookEventPayload {
    [key: string]: unknown;
    host: HookHost;
    contract: HookContract;
    hookType: HookType;
    eventPayload: CanonicalHookEventPayload;
    originalIndex: number;
    sessionId?: string;
    session_id?: string;
    directory?: string;
    cwd?: string;
    transcriptPath?: string;
    transcript_path?: string;
    stopReason?: string;
    stop_reason?: string;
    end_turn_reason?: string;
    stop_hook_active?: boolean;
    last_assistant_message?: string;
    user_requested?: boolean;
    hook_event_name?: string;
    permission_mode?: string;
    custom_instructions?: string;
    user_prompt?: string;
    initial_prompt?: string;
    prompt_id?: string;
    reason?: string;
    agent?: CanonicalAgentRef;
    agentId?: string;
    agentName?: string;
    agentDisplayName?: string;
    agentDescription?: string;
    callId?: string;
    toolUseId?: string;
    toolCallId?: string;
    toolName?: string;
    nativeToolName?: string;
    canonicalToolName?: string;
    toolInput?: unknown;
    rawToolArgs?: unknown;
    shellDialect?: ShellDialect;
}
export interface LegacyHookSpecificDecision {
    behavior?: HookDecision | 'block';
    reason?: string;
    updatedInput?: unknown;
    [key: string]: unknown;
}
export interface LegacyHookSpecificOutput {
    additionalContext?: string;
    permissionDecision?: HookDecision | 'block';
    permissionDecisionReason?: string;
    updatedInput?: unknown;
    decision?: LegacyHookSpecificDecision;
    [key: string]: unknown;
}
export interface LegacyHookOutput {
    continue?: boolean;
    suppressOutput?: boolean;
    reason?: string;
    decision?: HookDecision | 'block';
    message?: string;
    systemMessage?: string;
    modifiedInput?: unknown;
    mutationRequirement?: HookMutationRequirement;
    effects?: readonly HookEffect[];
    hookSpecificOutput?: LegacyHookSpecificOutput;
    [key: string]: unknown;
}
/**
 * Typed compatibility adapter for processors that still consume the legacy
 * camelCase hook input shape from a genuine single-call legacy payload.
 * Canonical and Copilot wrappers must use buildLegacyProcessorInput instead.
 */
export declare function normalizeLegacyHookInput(raw: unknown, hookType?: string): LegacyHookInput;
/**
 * Build one legacy processor input from one canonical execution unit.
 * Canonical tool names are the default because existing processors generally
 * use Claude-style names; native provenance remains available on every call.
 */
export declare function buildLegacyProcessorInput(envelope: CanonicalHookEnvelope, unit: HookExecutionUnit, options?: LegacyProcessorInputOptions): LegacyProcessorInput;
export declare function describeHookRunFailure(result: HookRunResult): string | undefined;
/**
 * Preserve the shipped Claude presentation while using canonical host
 * encoding for Copilot. Host selection comes only from the normalized
 * envelope; wrappers must not re-detect the host from raw payload fields.
 */
export declare function encodeLegacyCompatibleHookOutput(envelope: CanonicalHookEnvelope, reduction: HookReduction, legacyOutput: unknown): EncodedHookOutput;
/**
 * Typed compatibility adapter for processors that still return legacy hook
 * output objects. Canonical interpretation remains owned by hook-runtime.ts.
 */
export declare function adaptLegacyHookOutput(hookType: string, output: LegacyHookOutput): HookEvaluation;
export { detectHookContract, normalizeHookEnvelope, normalizeHookInput, } from './bridge-normalize.js';
export { boundHookContexts, interpretLegacyOutput, reduceHookEvaluations, runHookJson, runHookPayload, sanitizeHookEvaluation, type HookExecutionUnit, type HookProcessor, type HookRunResult, } from './hook-runtime.js';
export { canEncodeHookMutation, encodeClaudeHookOutput, encodeCopilotHookOutput, encodeHookOutput, } from './hook-output.js';
export { CLAUDE_SINGLE_CAPABILITIES, COPILOT_1072_CAPABILITIES, formatUnknownError, } from './hook-protocol.js';
export * from './pre-tool-enforcer/index.js';
export { runHookNotificationChild } from './background-notifications.js';
export type * from './hook-protocol.js';
//# sourceMappingURL=hook-runtime-entry.d.ts.map