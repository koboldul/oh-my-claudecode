import type { HookInput } from './bridge.js';
import {
  normalizeHookInput,
} from './bridge-normalize.js';
import {
  interpretLegacyOutput,
} from './hook-runtime.js';
import type {
  HookExecutionUnit,
  HookRunResult,
} from './hook-runtime.js';
import {
  encodeHookOutput,
  type EncodedHookOutput,
} from './hook-output.js';
import type {
  CanonicalAgentRef,
  CanonicalHookEnvelope,
  CanonicalHookEventPayload,
  HookDecision,
  HookEffect,
  HookEvaluation,
  HookHost,
  HookMutationRequirement,
  HookReduction,
  HookContract,
  HookType,
  ShellDialect,
} from './hook-protocol.js';

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

const LEGACY_HOOK_EVENT_NAMES: Readonly<Record<string, string>> = {
  notification: 'Notification',
  'permission-request': 'PermissionRequest',
  'post-tool-use': 'PostToolUse',
  'post-tool-use-failure': 'PostToolUseFailure',
  'pre-compact': 'PreCompact',
  'pre-tool-use': 'PreToolUse',
  'session-end': 'SessionEnd',
  'session-start': 'SessionStart',
  stop: 'Stop',
  'subagent-start': 'SubagentStart',
  'subagent-stop': 'SubagentStop',
  'user-prompt-submit': 'UserPromptSubmit',
};

function primaryPrompt(
  eventPayload: CanonicalHookEventPayload,
): string | undefined {
  return eventPayload.prompt
    ?? eventPayload.userPrompt
    ?? eventPayload.initialPrompt
    ?? eventPayload.promptAliases?.[0];
}

/**
 * Typed compatibility adapter for processors that still consume the legacy
 * camelCase hook input shape from a genuine single-call legacy payload.
 * Canonical and Copilot wrappers must use buildLegacyProcessorInput instead.
 */
export function normalizeLegacyHookInput(
  raw: unknown,
  hookType?: string,
): LegacyHookInput {
  return normalizeHookInput(raw, hookType) as LegacyHookInput;
}

/**
 * Build one legacy processor input from one canonical execution unit.
 * Canonical tool names are the default because existing processors generally
 * use Claude-style names; native provenance remains available on every call.
 */
export function buildLegacyProcessorInput(
  envelope: CanonicalHookEnvelope,
  unit: HookExecutionUnit,
  options: LegacyProcessorInputOptions = {},
): LegacyProcessorInput {
  const call = unit.call;
  const eventPayload = envelope.eventPayload;
  const toolName = call
    ? options.toolNameSource === 'native'
      ? call.nativeName
      : call.canonicalName
    : undefined;
  const prompt = primaryPrompt(eventPayload);
  const hookEventName = LEGACY_HOOK_EVENT_NAMES[envelope.hookType];

  return {
    ...eventPayload,
    ...(prompt !== undefined ? { prompt } : {}),
    host: envelope.host,
    contract: envelope.contract,
    hookType: envelope.hookType,
    eventPayload,
    originalIndex: unit.originalIndex,
    ...(envelope.sessionId !== undefined
      ? {
          sessionId: envelope.sessionId,
          session_id: envelope.sessionId,
        }
      : {}),
    ...(envelope.directory !== undefined
      ? {
          directory: envelope.directory,
          cwd: envelope.directory,
        }
      : {}),
    ...(envelope.transcriptPath !== undefined
      ? {
          transcriptPath: envelope.transcriptPath,
          transcript_path: envelope.transcriptPath,
        }
      : {}),
    ...(envelope.stopReason !== undefined
      ? {
          stopReason: envelope.stopReason,
          stop_reason: envelope.stopReason,
        }
      : {}),
    ...(eventPayload.endTurnReason !== undefined
      ? { end_turn_reason: eventPayload.endTurnReason }
      : {}),
    ...(eventPayload.stopHookActive !== undefined
      ? { stop_hook_active: eventPayload.stopHookActive }
      : {}),
    ...(eventPayload.lastAssistantMessage !== undefined
      ? { last_assistant_message: eventPayload.lastAssistantMessage }
      : {}),
    ...(eventPayload.userRequested !== undefined
      ? { user_requested: eventPayload.userRequested }
      : {}),
    ...(hookEventName !== undefined
      ? { hook_event_name: hookEventName }
      : {}),
    ...(eventPayload.permissionMode !== undefined
      ? { permission_mode: eventPayload.permissionMode }
      : {}),
    ...(eventPayload.customInstructions !== undefined
      ? { custom_instructions: eventPayload.customInstructions }
      : {}),
    ...(eventPayload.userPrompt !== undefined
      ? { user_prompt: eventPayload.userPrompt }
      : {}),
    ...(eventPayload.initialPrompt !== undefined
      ? { initial_prompt: eventPayload.initialPrompt }
      : {}),
    ...(eventPayload.promptId !== undefined
      ? { prompt_id: eventPayload.promptId }
      : {}),
    ...(eventPayload.sessionEndReason !== undefined
      || eventPayload.reason !== undefined
      ? { reason: eventPayload.sessionEndReason ?? eventPayload.reason }
      : {}),
    ...(envelope.agent !== undefined
      ? {
          agent: envelope.agent,
          ...(envelope.agent.id !== undefined
            ? { agentId: envelope.agent.id }
            : {}),
          ...(envelope.agent.name !== undefined
            ? { agentName: envelope.agent.name }
            : {}),
          ...(envelope.agent.displayName !== undefined
            ? { agentDisplayName: envelope.agent.displayName }
            : {}),
          ...(envelope.agent.description !== undefined
            ? { agentDescription: envelope.agent.description }
            : {}),
        }
      : {}),
    ...(call
      ? {
          callId: call.id,
          toolUseId: call.id,
          toolCallId: call.id,
          toolName,
          nativeToolName: call.nativeName,
          canonicalToolName: call.canonicalName,
          toolInput: unit.input,
          rawToolArgs: call.rawArgs,
          ...(call.shellDialect !== undefined
            ? { shellDialect: call.shellDialect }
            : {}),
        }
      : {}),
  };
}

export function describeHookRunFailure(
  result: HookRunResult,
): string | undefined {
  const failures: string[] = [];

  for (const issue of result.envelope.issues) {
    if (issue.severity === 'safety' || issue.batchSafety === true) {
      failures.push(
        issue.message || issue.code || 'hook input normalization failed',
      );
    }
  }

  for (const evaluation of result.evaluations) {
    if (evaluation.source === 'adapter' && evaluation.decision === 'deny') {
      failures.push(
        evaluation.reason || 'legacy processor adapter failed',
      );
    }
  }

  for (const decision of result.reduction.callDecisions) {
    if (decision.source === 'adapter' && decision.decision === 'deny') {
      failures.push(decision.reason || 'hook reduction failed');
    }
  }

  if (result.reduction.decision !== 'pass') {
    failures.push(
      result.reduction.reason
      || `unexpected ${result.reduction.decision} reduction`,
    );
  }

  return failures.length > 0
    ? [...new Set(failures)].join('; ')
    : undefined;
}

/**
 * Preserve the shipped Claude presentation while using canonical host
 * encoding for Copilot. Host selection comes only from the normalized
 * envelope; wrappers must not re-detect the host from raw payload fields.
 */
export function encodeLegacyCompatibleHookOutput(
  envelope: CanonicalHookEnvelope,
  reduction: HookReduction,
  legacyOutput: unknown,
): EncodedHookOutput {
  if (envelope.host === 'copilot') {
    return encodeHookOutput(envelope, reduction);
  }

  if (
    typeof legacyOutput === 'object'
    && legacyOutput !== null
    && !Array.isArray(legacyOutput)
  ) {
    return legacyOutput as EncodedHookOutput;
  }

  return encodeHookOutput(envelope, reduction);
}

/**
 * Typed compatibility adapter for processors that still return legacy hook
 * output objects. Canonical interpretation remains owned by hook-runtime.ts.
 */
export function adaptLegacyHookOutput(
  hookType: string,
  output: LegacyHookOutput,
): HookEvaluation {
  return interpretLegacyOutput(hookType, output);
}

export {
  detectHookContract,
  normalizeHookEnvelope,
  normalizeHookInput,
} from './bridge-normalize.js';

export {
  boundHookContexts,
  interpretLegacyOutput,
  reduceHookEvaluations,
  runHookJson,
  runHookPayload,
  sanitizeHookEvaluation,
  type HookExecutionUnit,
  type HookProcessor,
  type HookRunResult,
} from './hook-runtime.js';

export {
  canEncodeHookMutation,
  encodeClaudeHookOutput,
  encodeCopilotHookOutput,
  encodeHookOutput,
} from './hook-output.js';

export {
  CLAUDE_SINGLE_CAPABILITIES,
  COPILOT_1072_CAPABILITIES,
  formatUnknownError,
} from './hook-protocol.js';

export * from './pre-tool-enforcer/index.js';
export { runHookNotificationChild } from './background-notifications.js';

export type * from './hook-protocol.js';
