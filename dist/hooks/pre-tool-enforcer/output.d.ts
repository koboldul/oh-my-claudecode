import { type EncodedHookOutput } from '../hook-output.js';
import type { CanonicalHookEnvelope, HookReduction } from '../hook-protocol.js';
import type { FinalizedPreToolReduction, PreToolBatchPlan, PreToolEffectCommitReport } from './types.js';
/**
 * Add post-commit advisory context and choose the Claude-only compatibility
 * presentation without mutating the canonical reduction.
 */
export declare function finalizePreToolReduction(plan: PreToolBatchPlan, reduction: HookReduction, commitReport: PreToolEffectCommitReport): FinalizedPreToolReduction;
/**
 * Copilot uses the canonical host encoder. Claude uses the explicit legacy
 * presentation selected above so silent and raw-block variants stay exact.
 */
export declare function encodePreToolEnforcerOutput(envelope: CanonicalHookEnvelope, finalized: FinalizedPreToolReduction): EncodedHookOutput;
//# sourceMappingURL=output.d.ts.map