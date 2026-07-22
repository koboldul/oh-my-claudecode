import { type CanonicalHookEnvelope, type CanonicalToolCall, type HookEvaluation, type HookReduction } from './hook-protocol.js';
export { canEncodeHookMutation, encodeClaudeHookOutput, encodeCopilotHookOutput, encodeHookOutput, type EncodedHookOutput, } from './hook-output.js';
export declare const MAX_HOOK_CONTEXT_MESSAGES = 8;
export declare const MAX_HOOK_CONTEXT_CHARACTERS = 6000;
export interface HookExecutionUnit {
    call?: CanonicalToolCall;
    callId?: string;
    originalIndex: number;
    input: unknown;
}
export type HookProcessor = (unit: HookExecutionUnit, envelope: CanonicalHookEnvelope) => HookEvaluation | unknown | Promise<HookEvaluation | unknown>;
export interface HookRunResult {
    envelope: CanonicalHookEnvelope;
    evaluations: HookEvaluation[];
    reduction: HookReduction;
}
export declare function sanitizeHookEvaluation(value: unknown, fallbackCallId?: string): HookEvaluation;
export declare function boundHookContexts(messages: readonly string[], maxMessages?: number, maxCharacters?: number): string[];
/**
 * Reduce per-call evaluations without mutating the envelope or executing effects.
 */
export declare function reduceHookEvaluations(envelope: CanonicalHookEnvelope, evaluations: readonly unknown[]): HookReduction;
export declare function interpretLegacyOutput(_hookType: string, output: unknown): HookEvaluation;
/**
 * Normalize the whole payload first, then evaluate each unique valid call in order.
 * Effect intents are returned in the reduction and are never executed here.
 */
export declare function runHookPayload(hookType: string, raw: unknown, processor: HookProcessor): Promise<HookRunResult>;
export declare function runHookJson(hookType: string, json: string, processor: HookProcessor): Promise<HookRunResult>;
//# sourceMappingURL=hook-runtime.d.ts.map