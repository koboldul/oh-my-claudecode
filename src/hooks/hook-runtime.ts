import { normalizeHookEnvelope } from './bridge-normalize.js';
import {
  CLAUDE_SINGLE_CAPABILITIES,
  formatUnknownError,
  type CanonicalHookEnvelope,
  type CanonicalToolCall,
  type HookCallDecision,
  type HookDecision,
  type HookEffect,
  type HookEvaluation,
  type HookEvaluationSource,
  type HookMutationIntent,
  type HookMutationRetryIntent,
  type HookMutationRetryHint,
  type HookReduction,
} from './hook-protocol.js';
import { canEncodeHookMutation } from './hook-output.js';

export {
  canEncodeHookMutation,
  encodeClaudeHookOutput,
  encodeCopilotHookOutput,
  encodeHookOutput,
  type EncodedHookOutput,
} from './hook-output.js';

export const MAX_HOOK_CONTEXT_MESSAGES = 8;
export const MAX_HOOK_CONTEXT_CHARACTERS = 6_000;

const PERMISSION_SENSITIVE_EVENTS = new Set([
  'permissionrequest',
  'pretooluse',
]);

const READ_ONLY_CANONICAL_TOOLS = new Set([
  'Glob',
  'Grep',
  'Read',
  'WebFetch',
  'WebSearch',
]);

export interface HookExecutionUnit {
  call?: CanonicalToolCall;
  callId?: string;
  originalIndex: number;
  input: unknown;
}

export type HookProcessor = (
  unit: HookExecutionUnit,
  envelope: CanonicalHookEnvelope,
) => HookEvaluation | unknown | Promise<HookEvaluation | unknown>;

export interface HookRunResult {
  envelope: CanonicalHookEnvelope;
  evaluations: HookEvaluation[];
  reduction: HookReduction;
}

interface DecisionCandidate {
  callId?: string;
  source: HookEvaluationSource;
  decision: HookDecision;
  reason?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;

  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function normalizeEventName(hookType: string): string {
  return hookType.replace(/[^a-z]/gi, '').toLowerCase();
}

function isPermissionSensitiveEvent(hookType: string): boolean {
  return PERMISSION_SENSITIVE_EVENTS.has(normalizeEventName(hookType));
}

function isDecision(value: unknown): value is HookDecision {
  return value === 'pass' || value === 'allow' || value === 'ask' || value === 'deny';
}

function normalizeDecision(value: unknown): HookDecision | undefined {
  if (value === 'block') return 'deny';
  return isDecision(value) ? value : undefined;
}

function isEvaluationSource(value: unknown): value is HookEvaluationSource {
  return value === 'host' || value === 'adapter' || value === 'handler';
}

function adapterDenyEvaluation(
  detail: string,
  fallbackCallId?: string,
): HookEvaluation {
  return {
    ...(fallbackCallId ? { callId: fallbackCallId } : {}),
    source: 'adapter',
    decision: 'deny',
    reason: `Malformed hook evaluation: ${detail}`,
    contexts: [],
    effects: [],
  };
}

function validateEffects(value: unknown): HookEffect[] {
  if (!Array.isArray(value)) {
    throw new TypeError('effects must be an array');
  }

  return value.map((effect, index) => {
    if (!isRecord(effect)) {
      throw new TypeError(`effects[${index}] must be an object`);
    }
    if (typeof effect.type !== 'string' || effect.type.trim().length === 0) {
      throw new TypeError(`effects[${index}].type must be a non-empty string`);
    }
    if (
      hasOwn(effect, 'callId')
      && effect.callId !== undefined
      && (typeof effect.callId !== 'string' || effect.callId.trim().length === 0)
    ) {
      throw new TypeError(`effects[${index}].callId must be a non-empty string`);
    }
    if (
      hasOwn(effect, 'commitOn')
      && effect.commitOn !== undefined
      && effect.commitOn !== 'accepted'
      && effect.commitOn !== 'always'
    ) {
      throw new TypeError(`effects[${index}].commitOn is invalid`);
    }
    if (
      hasOwn(effect, 'critical')
      && effect.critical !== undefined
      && typeof effect.critical !== 'boolean'
    ) {
      throw new TypeError(`effects[${index}].critical must be boolean`);
    }

    return {
      type: effect.type,
      ...(hasOwn(effect, 'payload') ? { payload: effect.payload } : {}),
      ...(typeof effect.callId === 'string' ? { callId: effect.callId } : {}),
      ...(effect.commitOn === 'accepted' || effect.commitOn === 'always'
        ? { commitOn: effect.commitOn }
        : {}),
      ...(typeof effect.critical === 'boolean' ? { critical: effect.critical } : {}),
    };
  });
}

export function sanitizeHookEvaluation(
  value: unknown,
  fallbackCallId?: string,
): HookEvaluation {
  try {
    if (!isRecord(value)) {
      return adapterDenyEvaluation('evaluation must be an object', fallbackCallId);
    }
    if (!isDecision(value.decision)) {
      return adapterDenyEvaluation('decision is missing or invalid', fallbackCallId);
    }

    let callId = fallbackCallId;
    if (hasOwn(value, 'callId') && value.callId !== undefined) {
      if (typeof value.callId !== 'string' || value.callId.trim().length === 0) {
        return adapterDenyEvaluation('callId must be a non-empty string', fallbackCallId);
      }
      callId = value.callId;
    }

    let source: HookEvaluationSource = 'handler';
    if (hasOwn(value, 'source') && value.source !== undefined) {
      if (!isEvaluationSource(value.source)) {
        return adapterDenyEvaluation('source is invalid', callId);
      }
      source = value.source;
    }

    let reason: string | undefined;
    if (hasOwn(value, 'reason') && value.reason !== undefined) {
      if (typeof value.reason !== 'string') {
        return adapterDenyEvaluation('reason must be a string', callId);
      }
      reason = value.reason;
    }

    let contexts: string[] = [];
    if (hasOwn(value, 'contexts') && value.contexts !== undefined) {
      if (
        !Array.isArray(value.contexts)
        || value.contexts.some((context) => typeof context !== 'string')
      ) {
        return adapterDenyEvaluation('contexts must be an array of strings', callId);
      }
      contexts = [...value.contexts];
    }

    let mutation: HookEvaluation['mutation'];
    if (hasOwn(value, 'mutation') && value.mutation !== undefined) {
      const rawMutation = value.mutation;
      if (
        !isRecord(rawMutation)
        || !hasOwn(rawMutation, 'input')
        || (rawMutation.requirement !== 'optional'
          && rawMutation.requirement !== 'required')
      ) {
        return adapterDenyEvaluation(
          'mutation must contain input and a valid requirement',
          callId,
        );
      }
      let retryHint: HookMutationRetryHint | undefined;
      if (rawMutation.retryHint !== undefined) {
        if (
          !isRecord(rawMutation.retryHint)
          || typeof rawMutation.retryHint.instruction !== 'string'
          || rawMutation.retryHint.instruction.trim().length === 0
          || (
            rawMutation.retryHint.patch !== undefined
            && !isPlainObject(rawMutation.retryHint.patch)
          )
        ) {
          return adapterDenyEvaluation(
            'mutation.retryHint must contain a non-empty instruction and optional plain-object patch',
            callId,
          );
        }
        retryHint = {
          instruction: rawMutation.retryHint.instruction,
          ...(rawMutation.retryHint.patch !== undefined
            ? { patch: rawMutation.retryHint.patch }
            : {}),
        };
      }
      mutation = {
        input: rawMutation.input,
        requirement: rawMutation.requirement,
        ...(retryHint ? { retryHint } : {}),
      };
    }

    let effects: HookEffect[] = [];
    if (hasOwn(value, 'effects') && value.effects !== undefined) {
      try {
        effects = validateEffects(value.effects);
      } catch (error) {
        const detail = formatUnknownError(error);
        return adapterDenyEvaluation(detail, callId);
      }
    }

    return {
      ...(callId ? { callId } : {}),
      source,
      decision: value.decision,
      ...(reason !== undefined ? { reason } : {}),
      ...(mutation ? { mutation } : {}),
      contexts,
      effects,
    };
  } catch (error) {
    const detail = formatUnknownError(error);
    return adapterDenyEvaluation(`validation failed: ${detail}`, fallbackCallId);
  }
}

function firstReason(
  candidates: readonly DecisionCandidate[],
  decision: HookDecision,
): string | undefined {
  return candidates.find((candidate) => candidate.decision === decision)?.reason;
}

function aggregateDecision(candidates: readonly DecisionCandidate[]): HookDecision {
  if (candidates.some(({ decision }) => decision === 'deny')) return 'deny';
  if (candidates.some(({ decision }) => decision === 'ask')) return 'ask';

  const hasAllow = candidates.some(({ decision }) => decision === 'allow');
  const hasPass = candidates.some(({ decision }) => decision === 'pass');
  return hasAllow && !hasPass ? 'allow' : 'pass';
}

function normalizationSafetyIssue(envelope: CanonicalHookEnvelope) {
  const batchIssue = envelope.issues.find(
    (issue) => issue.batchSafety || (issue.scope === 'batch' && issue.severity === 'safety'),
  );
  if (batchIssue) return batchIssue;
  if (!isPermissionSensitiveEvent(envelope.hookType)) return undefined;

  return envelope.issues.find((issue) => {
    if (issue.severity !== 'safety') return false;
    if (issue.code !== 'malformed-tool-args') return true;

    const call = envelope.toolCalls.find(
      (candidate) =>
        candidate.originalIndex === issue.originalIndex
        || candidate.id === issue.callId,
    );
    return !call || !READ_ONLY_CANONICAL_TOOLS.has(call.canonicalName);
  });
}

function mutationRepresentationIssue(
  envelope: CanonicalHookEnvelope,
  decision: HookDecision,
  callId: string | undefined,
  input: unknown,
): string | undefined {
  if (!canEncodeHookMutation(envelope, decision)) {
    return `${envelope.host} ${envelope.hookType} output for decision "${decision}" does not encode input mutation`;
  }

  const logicalCallCount = Number.isInteger(envelope.logicalCallCount)
    ? envelope.logicalCallCount
    : envelope.toolCalls.length;
  if (logicalCallCount > 1) {
    if (!callId || !envelope.capabilities.correlatedMutationOutput) {
      return 'correlated multi-call mutation output is unsupported';
    }
    if (!envelope.toolCalls.some((call) => call.id === callId)) {
      return `callId "${callId}" does not identify a logical call in the batch`;
    }
  } else {
    if (logicalCallCount !== 1) {
      return 'mutation output requires exactly one logical call';
    }
    if (!envelope.capabilities.singletonMutationOutput) {
      return 'singleton mutation output is unsupported';
    }
    if (callId) {
      const onlyCall = envelope.toolCalls[0];
      if (!onlyCall || callId !== onlyCall.id) {
        const expectedCall = onlyCall
          ? `"${onlyCall.id}"`
          : 'the sole logical call';
        return `callId "${callId}" does not match ${expectedCall}`;
      }
    }
  }

  return isPlainObject(input)
    ? undefined
    : 'replacement input must be a plain object';
}

function normalizeEffects(evaluations: readonly HookEvaluation[]): HookEffect[] {
  return evaluations.flatMap((evaluation) =>
    (evaluation.effects ?? []).map((effect) => ({
      ...effect,
      callId: effect.callId ?? evaluation.callId,
      commitOn: effect.commitOn ?? 'accepted',
      critical: effect.critical ?? false,
    })),
  );
}

function allLogicalCallsExplicitlyAllowed(
  envelope: CanonicalHookEnvelope,
  evaluations: readonly HookEvaluation[],
): boolean {
  const logicalCallCount = Number.isInteger(envelope.logicalCallCount)
    ? envelope.logicalCallCount
    : envelope.toolCalls.length;
  if (
    logicalCallCount === 0
    || envelope.toolCalls.length !== logicalCallCount
    || envelope.toolCalls.some((call) => call.malformed)
  ) {
    return false;
  }

  const allowedCallIds = new Set(
    evaluations
      .filter(
        (evaluation): evaluation is HookEvaluation & { callId: string } =>
          evaluation.decision === 'allow'
          && typeof evaluation.callId === 'string',
      )
      .map((evaluation) => evaluation.callId),
  );

  return envelope.toolCalls.every((call) => allowedCallIds.has(call.id));
}

function adapterReductionFailure(error: unknown): HookReduction {
  const detail = formatUnknownError(error);
  const reason = `Hook reduction failed safely: ${detail}`;
  const callDecision: HookCallDecision = {
    source: 'adapter',
    decision: 'deny',
    reason,
  };
  return {
    decision: 'deny',
    reason,
    retry: false,
    unchanged: true,
    contexts: [],
    diagnostics: [],
    mutations: [],
    mutationRetryHints: [],
    callDecisions: [callDecision],
    effects: [],
    stagedEffects: [],
  };
}

export function boundHookContexts(
  messages: readonly string[],
  maxMessages = MAX_HOOK_CONTEXT_MESSAGES,
  maxCharacters = MAX_HOOK_CONTEXT_CHARACTERS,
): string[] {
  if (maxMessages <= 0 || maxCharacters <= 0) return [];

  const bounded: string[] = [];
  const seen = new Set<string>();
  let usedCharacters = 0;

  for (const rawMessage of messages) {
    const message = rawMessage.trim();
    if (!message || seen.has(message) || bounded.length >= maxMessages) continue;
    seen.add(message);

    const separatorLength = bounded.length > 0 ? 2 : 0;
    const remaining = maxCharacters - usedCharacters - separatorLength;
    if (remaining <= 0) break;

    let nextMessage = message;
    let truncated = false;
    if (nextMessage.length > remaining) {
      if (remaining === 1) {
        nextMessage = '…';
      } else {
        nextMessage = `${nextMessage.slice(0, remaining - 1)}…`;
      }
      truncated = true;
    }

    bounded.push(nextMessage);
    usedCharacters += separatorLength + nextMessage.length;
    if (truncated) break;
  }

  return bounded;
}

/**
 * Reduce per-call evaluations without mutating the envelope or executing effects.
 */
export function reduceHookEvaluations(
  envelope: CanonicalHookEnvelope,
  evaluations: readonly unknown[],
): HookReduction {
  try {
    return reduceHookEvaluationsInternal(envelope, evaluations);
  } catch (error) {
    return adapterReductionFailure(error);
  }
}

function reduceHookEvaluationsInternal(
  envelope: CanonicalHookEnvelope,
  evaluations: readonly unknown[],
): HookReduction {
  const normalizedEvaluations = evaluations.map((evaluation, index) =>
    sanitizeHookEvaluation(
      evaluation,
      envelope.toolCalls[index]?.id,
    ),
  );
  const decisionCandidates: DecisionCandidate[] = [];

  if (envelope.hostDecision) {
    decisionCandidates.push({
      source: 'host',
      decision: envelope.hostDecision.decision,
      reason: envelope.hostDecision.reason,
    });
  }

  for (const evaluation of normalizedEvaluations) {
    decisionCandidates.push({
      callId: evaluation.callId,
      source: evaluation.source ?? 'handler',
      decision: evaluation.decision,
      reason: evaluation.reason,
    });
  }

  const callDecisions: HookCallDecision[] = decisionCandidates.map((candidate) => ({
    ...candidate,
  }));
  const safetyIssue = normalizationSafetyIssue(envelope);
  const immutableHostDeny = decisionCandidates.find(
    ({ source, decision }) => source === 'host' && decision === 'deny',
  );
  const logicalCallCount = Number.isInteger(envelope.logicalCallCount)
    ? envelope.logicalCallCount
    : envelope.toolCalls.length;
  const emptyPermissionEnvelope =
    isPermissionSensitiveEvent(envelope.hookType)
    && logicalCallCount === 0;

  let decision = aggregateDecision(decisionCandidates);
  let reason =
    decision === 'deny'
      ? firstReason(decisionCandidates, 'deny')
      : decision === 'ask'
        ? firstReason(decisionCandidates, 'ask')
        : undefined;
  let retry = false;
  const diagnostics: string[] = [];
  const mutations: HookMutationIntent[] = [];
  const mutationRetryHints: HookMutationRetryIntent[] = [];

  if (safetyIssue) {
    decision = 'deny';
    reason = safetyIssue.message;
  } else if (emptyPermissionEnvelope) {
    decision = 'deny';
    reason = 'Permission-sensitive hook envelope contains no logical tool calls.';
  } else if (immutableHostDeny) {
    decision = 'deny';
    reason = immutableHostDeny.reason ?? 'The host denied this hook operation.';
  }

  const correlationUnavailable =
    logicalCallCount > 1
    && !envelope.capabilities.correlatedDecisionOutput;
  if (decision === 'ask' && correlationUnavailable) {
    const askReason = reason ? `${reason} ` : '';
    decision = 'deny';
    retry = true;
    reason = `${askReason}This host cannot correlate confirmation to one call in the batch; retry or confirm the calls separately.`;
  }

  if (
    decision === 'allow'
    && !allLogicalCallsExplicitlyAllowed(envelope, normalizedEvaluations)
  ) {
    decision = 'pass';
    diagnostics.push(
      'Aggregate allow was reduced to pass because not every logical tool call was explicitly evaluated and allowed.',
    );
  }

  let discardedOptionalMutation = false;
  const mutationDecision = decision;
  const requiredMutationReasons: string[] = [];

  for (const evaluation of normalizedEvaluations) {
    if (!evaluation.mutation) continue;

    const representationIssue = mutationRepresentationIssue(
      envelope,
      mutationDecision,
      evaluation.callId,
      evaluation.mutation.input,
    );
    if (!representationIssue) {
      mutations.push({
        callId: evaluation.callId,
        input: evaluation.mutation.input,
        requirement: evaluation.mutation.requirement,
        ...(evaluation.mutation.retryHint
          ? { retryHint: evaluation.mutation.retryHint }
          : {}),
      });
      continue;
    }

    const callLabel = evaluation.callId
      ? ` for call "${evaluation.callId}"`
      : '';
    if (evaluation.mutation.requirement === 'required') {
      retry = true;
      const retryInstruction = evaluation.mutation.retryHint?.instruction;
      if (evaluation.mutation.retryHint) {
        mutationRetryHints.push({
          ...(evaluation.callId ? { callId: evaluation.callId } : {}),
          ...evaluation.mutation.retryHint,
        });
      }
      const mutationReason =
        `Required input mutation${callLabel} cannot be represented by ${envelope.contract} because ${representationIssue}; `
        + (
          retryInstruction
            ? `retry with this exact per-call patch: ${retryInstruction}.`
            : 'retry the call separately with the required input changes.'
        );
      requiredMutationReasons.push(mutationReason);
      diagnostics.push(mutationReason);
      continue;
    }

    discardedOptionalMutation = true;
    diagnostics.push(
      `Optional input mutation${callLabel} was not applied because ${envelope.contract} cannot represent it: ${representationIssue}; the original input will be used.`,
    );
  }

  if (requiredMutationReasons.length > 0) {
    decision = 'deny';
    reason = [
      reason,
      ...requiredMutationReasons,
    ].filter(Boolean).join(' ');
    mutations.length = 0;
  }

  if (
    discardedOptionalMutation
    && decision !== 'deny'
    && decision !== 'ask'
  ) {
    decision = 'pass';
    mutations.length = 0;
  }

  const boundedDiagnostics = boundHookContexts(diagnostics);
  const contexts = boundHookContexts([
    ...normalizedEvaluations.flatMap((evaluation) => evaluation.contexts ?? []),
    ...boundedDiagnostics,
  ]);

  const allEffects = normalizeEffects(normalizedEvaluations);
  const accepted = decision === 'pass' || decision === 'allow';
  const stagedEffects = allEffects.filter(
    (effect) => effect.commitOn === 'always' || accepted,
  );

  return {
    decision,
    reason,
    retry,
    unchanged: mutations.length === 0,
    contexts,
    context: contexts.length > 0 ? contexts.join('\n\n') : undefined,
    diagnostics: boundedDiagnostics,
    mutations,
    mutationRetryHints,
    callDecisions,
    effects: stagedEffects,
    stagedEffects,
  };
}

export function interpretLegacyOutput(
  _hookType: string,
  output: unknown,
): HookEvaluation {
  try {
    if (!isRecord(output)) {
      return adapterDenyEvaluation('processor output must be an object');
    }

    const recognized = [
      'continue',
      'suppressOutput',
      'hookSpecificOutput',
      'decision',
      'message',
      'systemMessage',
      'modifiedInput',
      'effects',
    ].some((key) => hasOwn(output, key));
    if (!recognized) {
      return adapterDenyEvaluation('processor output has no recognized fields');
    }
    if (
      hasOwn(output, 'continue')
      && output.continue !== undefined
      && typeof output.continue !== 'boolean'
    ) {
      return adapterDenyEvaluation('continue must be boolean');
    }
    if (
      hasOwn(output, 'suppressOutput')
      && output.suppressOutput !== undefined
      && typeof output.suppressOutput !== 'boolean'
    ) {
      return adapterDenyEvaluation('suppressOutput must be boolean');
    }
    if (
      hasOwn(output, 'reason')
      && output.reason !== undefined
      && typeof output.reason !== 'string'
    ) {
      return adapterDenyEvaluation('reason must be a string');
    }
    if (
      hasOwn(output, 'mutationRequirement')
      && output.mutationRequirement !== undefined
      && output.mutationRequirement !== 'optional'
      && output.mutationRequirement !== 'required'
    ) {
      return adapterDenyEvaluation('mutationRequirement is invalid');
    }

    let hookSpecificOutput: Record<string, unknown> = {};
    if (hasOwn(output, 'hookSpecificOutput') && output.hookSpecificOutput !== undefined) {
      if (!isRecord(output.hookSpecificOutput)) {
        return adapterDenyEvaluation('hookSpecificOutput must be an object');
      }
      hookSpecificOutput = output.hookSpecificOutput;
    }

    let nestedDecision: Record<string, unknown> = {};
    if (
      hasOwn(hookSpecificOutput, 'decision')
      && hookSpecificOutput.decision !== undefined
    ) {
      if (!isRecord(hookSpecificOutput.decision)) {
        return adapterDenyEvaluation('hookSpecificOutput.decision must be an object');
      }
      nestedDecision = hookSpecificOutput.decision;
    }

    for (const [container, key, label] of [
      [output, 'message', 'message'],
      [output, 'systemMessage', 'systemMessage'],
      [hookSpecificOutput, 'additionalContext', 'hookSpecificOutput.additionalContext'],
      [hookSpecificOutput, 'permissionDecisionReason', 'permissionDecisionReason'],
      [nestedDecision, 'reason', 'hookSpecificOutput.decision.reason'],
    ] as const) {
      if (
        hasOwn(container, key)
        && container[key] !== undefined
        && typeof container[key] !== 'string'
      ) {
        return adapterDenyEvaluation(`${label} must be a string`);
      }
    }

    const candidates: DecisionCandidate[] = [];
    if (output.continue === false) {
      candidates.push({
        source: 'handler',
        decision: 'deny',
        reason:
          typeof output.reason === 'string'
            ? output.reason
            : typeof output.message === 'string'
              ? output.message
              : undefined,
      });
    }

    if (
      hasOwn(hookSpecificOutput, 'permissionDecision')
      && hookSpecificOutput.permissionDecision !== undefined
    ) {
      const permissionDecision = normalizeDecision(hookSpecificOutput.permissionDecision);
      if (!permissionDecision) {
        return adapterDenyEvaluation('permissionDecision is invalid');
      }
      candidates.push({
        source: 'handler',
        decision: permissionDecision,
        reason:
          typeof hookSpecificOutput.permissionDecisionReason === 'string'
            ? hookSpecificOutput.permissionDecisionReason
            : undefined,
      });
    }

    if (hasOwn(nestedDecision, 'behavior') && nestedDecision.behavior !== undefined) {
      const behaviorDecision = normalizeDecision(nestedDecision.behavior);
      if (!behaviorDecision) {
        return adapterDenyEvaluation('hookSpecificOutput.decision.behavior is invalid');
      }
      candidates.push({
        source: 'handler',
        decision: behaviorDecision,
        reason: typeof nestedDecision.reason === 'string' ? nestedDecision.reason : undefined,
      });
    }

    if (hasOwn(output, 'decision') && output.decision !== undefined) {
      const rootDecision = normalizeDecision(output.decision);
      if (!rootDecision) {
        return adapterDenyEvaluation('decision is invalid');
      }
      candidates.push({
        source: 'handler',
        decision: rootDecision,
        reason: typeof output.reason === 'string' ? output.reason : undefined,
      });
    }

    const decision = aggregateDecision(candidates);
    const reason =
      decision === 'deny'
        ? firstReason(candidates, 'deny')
        : decision === 'ask'
          ? firstReason(candidates, 'ask')
          : undefined;
    const hasNestedUpdatedInput = hasOwn(nestedDecision, 'updatedInput');
    const hasHookUpdatedInput = hasOwn(hookSpecificOutput, 'updatedInput');
    const hasRootModifiedInput = hasOwn(output, 'modifiedInput');
    const hasUpdatedInput =
      hasNestedUpdatedInput
      || hasHookUpdatedInput
      || hasRootModifiedInput;
    const updatedInput = hasNestedUpdatedInput
      ? nestedDecision.updatedInput
      : hasHookUpdatedInput
        ? hookSpecificOutput.updatedInput
        : output.modifiedInput;
    const mutationRequirement =
      hasNestedUpdatedInput || output.mutationRequirement === 'required'
        ? 'required'
        : 'optional';
    const contexts = [
      output.message,
      output.systemMessage,
      hookSpecificOutput.additionalContext,
    ].filter((value): value is string => typeof value === 'string');

    return sanitizeHookEvaluation({
      source: 'handler',
      decision,
      ...(reason !== undefined ? { reason } : {}),
      ...(hasUpdatedInput
        ? {
            mutation: {
              input: updatedInput,
              requirement: mutationRequirement,
            },
          }
        : {}),
      contexts,
      effects: hasOwn(output, 'effects') ? output.effects : [],
    });
  } catch (error) {
    const detail = formatUnknownError(error);
    return adapterDenyEvaluation(`legacy output validation failed: ${detail}`);
  }
}

function hasOwn(input: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(input, key);
}

function hasBatchSafetyIssue(envelope: CanonicalHookEnvelope): boolean {
  return envelope.issues.some(
    (issue) => issue.batchSafety || (issue.scope === 'batch' && issue.severity === 'safety'),
  );
}

function isCanonicalEvaluationOutput(value: unknown): boolean {
  return (
    isRecord(value)
    && hasOwn(value, 'decision')
    && isDecision(value.decision)
    && !hasOwn(value, 'continue')
    && !hasOwn(value, 'hookSpecificOutput')
  );
}

/**
 * Normalize the whole payload first, then evaluate each unique valid call in order.
 * Effect intents are returned in the reduction and are never executed here.
 */
export async function runHookPayload(
  hookType: string,
  raw: unknown,
  processor: HookProcessor,
): Promise<HookRunResult> {
  let envelope: CanonicalHookEnvelope;
  try {
    envelope = normalizeHookEnvelope(raw, hookType);
  } catch (error) {
    const detail = formatUnknownError(error);
    envelope = {
      host: 'claude',
      contract: 'claude-single',
      hookType,
      eventPayload: {},
      originalCallCount: 0,
      logicalCallCount: 0,
      toolCalls: [],
      capabilities: CLAUDE_SINGLE_CAPABILITIES,
      issues: [{
        code: 'invalid-envelope',
        message: `Hook input normalization failed safely: ${detail}`,
        severity: 'safety',
        scope: 'batch',
        batchSafety: true,
      }],
    };
  }
  const evaluations: HookEvaluation[] = [];

  if (!hasBatchSafetyIssue(envelope)) {
    const validCalls = envelope.toolCalls.filter((call) => !call.malformed);
    const units: HookExecutionUnit[] =
      envelope.toolCalls.length === 0
        ? isPermissionSensitiveEvent(envelope.hookType)
          ? []
          : [{ originalIndex: 0, input: envelope }]
        : validCalls.map((call) => ({
            call,
            callId: call.id,
            originalIndex: call.originalIndex,
            input: call.input,
          }));

    for (const unit of units) {
      try {
        const output = await processor(unit, envelope);
        const evaluation = isCanonicalEvaluationOutput(output)
          ? sanitizeHookEvaluation(output, unit.callId)
          : interpretLegacyOutput(hookType, output);
        evaluations.push(sanitizeHookEvaluation(evaluation, unit.callId));
      } catch (error) {
        const message = formatUnknownError(error);
        evaluations.push({
          callId: unit.callId,
          source: 'adapter',
          decision: 'deny',
          reason: `Hook processor failed: ${message}`,
          contexts: [],
          effects: [],
        });
      }
    }
  }

  return {
    envelope,
    evaluations,
    reduction: reduceHookEvaluations(envelope, evaluations),
  };
}

export async function runHookJson(
  hookType: string,
  json: string,
  processor: HookProcessor,
): Promise<HookRunResult> {
  let raw: unknown;
  try {
    raw = JSON.parse(json) as unknown;
  } catch {
    raw = json;
  }
  return runHookPayload(hookType, raw, processor);
}
