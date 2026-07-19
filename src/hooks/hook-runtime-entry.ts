import type { HookInput } from './bridge.js';
import {
  normalizeHookInput,
} from './bridge-normalize.js';
import {
  interpretLegacyOutput,
} from './hook-runtime.js';
import type {
  HookExecutionUnit,
} from './hook-runtime.js';
import type {
  CanonicalAgentRef,
  CanonicalHookEnvelope,
  CanonicalHookEventPayload,
  HookDecision,
  HookEffect,
  HookEvaluation,
  HookHost,
  HookMutationRequirement,
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
  directory?: string;
  transcriptPath?: string;
  stopReason?: string;
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
  const toolName = call
    ? options.toolNameSource === 'native'
      ? call.nativeName
      : call.canonicalName
    : undefined;

  return {
    ...envelope.eventPayload,
    host: envelope.host,
    contract: envelope.contract,
    hookType: envelope.hookType,
    eventPayload: envelope.eventPayload,
    originalIndex: unit.originalIndex,
    ...(envelope.sessionId !== undefined
      ? { sessionId: envelope.sessionId }
      : {}),
    ...(envelope.directory !== undefined
      ? { directory: envelope.directory }
      : {}),
    ...(envelope.transcriptPath !== undefined
      ? { transcriptPath: envelope.transcriptPath }
      : {}),
    ...(envelope.stopReason !== undefined
      ? { stopReason: envelope.stopReason }
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
  type EncodedHookOutput,
} from './hook-output.js';

export {
  CLAUDE_SINGLE_CAPABILITIES,
  COPILOT_1072_CAPABILITIES,
  formatUnknownError,
} from './hook-protocol.js';

export type * from './hook-protocol.js';
