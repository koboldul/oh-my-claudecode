import { encodeHookOutput, type EncodedHookOutput } from '../hook-output.js';
import { boundHookContexts } from '../hook-runtime.js';
import type {
  CanonicalHookEnvelope,
  HookReduction,
} from '../hook-protocol.js';
import type {
  FinalizedPreToolReduction,
  LegacyPresentation,
  PreToolBatchPlan,
  PreToolEffectCommitReport,
} from './types.js';

function accepted(reduction: HookReduction): boolean {
  return reduction.decision === 'pass' || reduction.decision === 'allow';
}

function finalizedContexts(
  plan: PreToolBatchPlan,
  reduction: HookReduction,
  commitReport: PreToolEffectCommitReport,
): string[] {
  const advisoryMessages = plan.calls.flatMap((call) => {
    const candidate = call.advisoryCandidate;
    if (!candidate) return [];
    const claim =
      commitReport.advisoryClaims[candidate.intentId] ?? 'indeterminate';
    return claim === 'throttled' ? [] : [candidate.message];
  });
  return boundHookContexts([
    ...reduction.contexts,
    ...advisoryMessages,
  ]);
}

function suppressedPresentation(
  presentation: LegacyPresentation,
): LegacyPresentation {
  return presentation.kind === 'context' && presentation.updatedInput
    ? {
        kind: 'suppressed-with-mutation',
        callId: presentation.callId,
        updatedInput: presentation.updatedInput,
      }
    : {
        kind: 'suppressed',
        callId: presentation.callId,
      };
}

function finalizeLegacyPresentation(
  plan: PreToolBatchPlan,
  reduction: HookReduction,
  commitReport: PreToolEffectCommitReport,
): LegacyPresentation | undefined {
  const solePresentation = plan.legacyPresentations.length === 1
    ? plan.legacyPresentations[0]
    : undefined;

  if (!accepted(reduction)) {
    if (solePresentation?.kind === 'raw-block') {
      return {
        ...solePresentation,
        reason: reduction.reason || solePresentation.reason,
      };
    }
    return {
      kind: 'hook-deny',
      callId: solePresentation?.callId,
      reason: reduction.reason || 'Hook denied this tool call.',
    };
  }

  if (!solePresentation) {
    return { kind: 'suppressed' };
  }
  if (
    solePresentation.kind !== 'context'
    || !solePresentation.advisoryIntentId
  ) {
    return solePresentation;
  }

  const claim =
    commitReport.advisoryClaims[solePresentation.advisoryIntentId]
    ?? 'indeterminate';
  return claim === 'throttled'
    ? suppressedPresentation(solePresentation)
    : solePresentation;
}

/**
 * Add post-commit advisory context and choose the Claude-only compatibility
 * presentation without mutating the canonical reduction.
 */
export function finalizePreToolReduction(
  plan: PreToolBatchPlan,
  reduction: HookReduction,
  commitReport: PreToolEffectCommitReport,
): FinalizedPreToolReduction {
  const contexts = accepted(reduction)
    ? finalizedContexts(plan, reduction, commitReport)
    : [...reduction.contexts];
  const finalizedReduction: HookReduction = {
    ...reduction,
    contexts,
    ...(contexts.length > 0
      ? { context: contexts.join('\n\n') }
      : { context: undefined }),
  };

  return {
    reduction: finalizedReduction,
    legacyPresentation:
      plan.envelope.host === 'claude'
        ? finalizeLegacyPresentation(plan, finalizedReduction, commitReport)
        : undefined,
    commitReport,
  };
}

function encodeClaudeLegacyPresentation(
  presentation: LegacyPresentation,
): EncodedHookOutput {
  switch (presentation.kind) {
    case 'continue':
      return { continue: true };
    case 'suppressed':
      return { continue: true, suppressOutput: true };
    case 'suppressed-with-mutation':
      return {
        continue: true,
        suppressOutput: true,
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          updatedInput: presentation.updatedInput,
        },
      };
    case 'hook-deny':
      return {
        continue: true,
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: presentation.reason,
        },
      };
    case 'raw-block':
      return {
        decision: 'block',
        reason: presentation.reason,
      };
    case 'context':
      return {
        continue: true,
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          additionalContext: presentation.context,
          ...(presentation.updatedInput
            ? { updatedInput: presentation.updatedInput }
            : {}),
        },
      };
  }
}

/**
 * Copilot uses the canonical host encoder. Claude uses the explicit legacy
 * presentation selected above so silent and raw-block variants stay exact.
 */
export function encodePreToolEnforcerOutput(
  envelope: CanonicalHookEnvelope,
  finalized: FinalizedPreToolReduction,
): EncodedHookOutput {
  if (envelope.host === 'copilot') {
    return encodeHookOutput(envelope, finalized.reduction);
  }
  return finalized.legacyPresentation
    ? encodeClaudeLegacyPresentation(finalized.legacyPresentation)
    : encodeHookOutput(envelope, finalized.reduction);
}
