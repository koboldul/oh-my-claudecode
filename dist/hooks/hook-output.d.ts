import type { CanonicalHookEnvelope, HookDecision, HookReduction } from './hook-protocol.js';
export type EncodedHookOutput = Record<string, unknown>;
export declare function canEncodeHookMutation(envelope: CanonicalHookEnvelope, decision: HookDecision): boolean;
export declare function encodeCopilotHookOutput(envelope: CanonicalHookEnvelope, reduction: HookReduction): EncodedHookOutput;
export declare function encodeClaudeHookOutput(envelope: CanonicalHookEnvelope, reduction: HookReduction): EncodedHookOutput;
/**
 * Encode a canonical reduction without executing effects or invoking host wrappers.
 */
export declare function encodeHookOutput(envelope: CanonicalHookEnvelope, reduction: HookReduction): EncodedHookOutput;
//# sourceMappingURL=hook-output.d.ts.map