export type HookHost = 'claude' | 'copilot';

export type HookContract = 'claude-single' | 'copilot-1.0.72-1';

export type HookType = string;

export type HookDecision = 'pass' | 'allow' | 'ask' | 'deny';

export type HookEvaluationSource = 'host' | 'adapter' | 'handler';

export type HookMutationRequirement = 'optional' | 'required';

export type HookEffectCommit = 'accepted' | 'always';

export type ShellDialect = 'posix' | 'powershell';

const MAX_UNKNOWN_ERROR_LENGTH = 500;

function boundUnknownErrorText(text: string): string {
  return text.length <= MAX_UNKNOWN_ERROR_LENGTH
    ? text
    : `${text.slice(0, MAX_UNKNOWN_ERROR_LENGTH - 1)}…`;
}

export function formatUnknownError(value: unknown): string {
  if (typeof value === 'string') return boundUnknownErrorText(value);

  if (typeof value === 'symbol') {
    try {
      return boundUnknownErrorText(value.toString());
    } catch {
      return '<unprintable thrown value>';
    }
  }

  try {
    if (value instanceof Error) {
      try {
        if (typeof value.message === 'string' && value.message.length > 0) {
          return boundUnknownErrorText(value.message);
        }
      } catch {
        // Continue through the non-throwing fallbacks below.
      }
    }
  } catch {
    // Hostile proxies can throw during instanceof checks.
  }

  try {
    const serialized = JSON.stringify(value);
    if (typeof serialized === 'string' && serialized.length > 0) {
      return boundUnknownErrorText(serialized);
    }
  } catch {
    // Cycles, BigInt, getters, and hostile proxies can reject serialization.
  }

  try {
    const text = String(value);
    if (text.length > 0) return boundUnknownErrorText(text);
  } catch {
    // Null-prototype objects can reject primitive conversion.
  }

  try {
    return boundUnknownErrorText(Object.prototype.toString.call(value));
  } catch {
    return '<unprintable thrown value>';
  }
}

export interface HookCapabilities {
  readonly batchInput: boolean;
  readonly correlatedDecisionOutput: boolean;
  readonly correlatedMutationOutput: boolean;
  readonly singletonMutationOutput: boolean;
}

export const CLAUDE_SINGLE_CAPABILITIES: HookCapabilities = Object.freeze({
  batchInput: false,
  correlatedDecisionOutput: true,
  correlatedMutationOutput: true,
  singletonMutationOutput: true,
});

export const COPILOT_1072_CAPABILITIES: HookCapabilities = Object.freeze({
  batchInput: true,
  correlatedDecisionOutput: false,
  correlatedMutationOutput: false,
  singletonMutationOutput: true,
});

export type NormalizationIssueCode =
  | 'invalid-envelope'
  | 'invalid-tool-calls'
  | 'malformed-tool-call'
  | 'missing-tool-call-id'
  | 'missing-tool-name'
  | 'malformed-tool-args'
  | 'tool-call-serialization-failed'
  | 'conflicting-duplicate-id';

export type NormalizationIssueSeverity = 'diagnostic' | 'safety';

export type NormalizationIssueScope = 'envelope' | 'call' | 'batch';

export interface NormalizationIssue {
  code: NormalizationIssueCode;
  message: string;
  severity: NormalizationIssueSeverity;
  scope: NormalizationIssueScope;
  originalIndex?: number;
  callId?: string;
  batchSafety?: true;
}

export interface CanonicalToolCall {
  id: string;
  idSource: 'host' | 'synthetic';
  correlation: 'host-id' | 'unavailable';
  originalIndex: number;
  duplicateIndices: number[];
  nativeName: string;
  canonicalName: string;
  shellDialect?: ShellDialect;
  input: unknown;
  rawArgs?: unknown;
  fingerprint: string;
  status: 'valid' | 'malformed';
  malformed: boolean;
  issues: NormalizationIssue[];
}

export interface CanonicalAgentRef {
  id?: string;
  name?: string;
  displayName?: string;
  description?: string;
  correlation: 'host-id' | 'unavailable';
}

export interface CanonicalNotificationPayload {
  type?: string;
  title?: string;
  message?: unknown;
  data?: unknown;
}

export interface CanonicalGoalSnapshot {
  objective?: string;
  status?: string;
  source?: 'payload' | 'context' | 'transcript';
}

export interface CanonicalHookEventPayload {
  prompt?: string;
  userPrompt?: string;
  promptAliases?: readonly string[];
  initialPrompt?: string;
  promptId?: string;
  goal?: CanonicalGoalSnapshot;
  source?: string;
  model?: string;
  timestamp?: number;
  message?: unknown;
  parts?: readonly unknown[];
  toolOutput?: unknown;
  toolError?: unknown;
  contextWindow?: unknown;
  notification?: CanonicalNotificationPayload;
  trigger?: string;
  customInstructions?: string;
  sessionEndReason?: string;
  permissionSuggestions?: readonly unknown[];
  permissionMode?: string;
  durationMs?: number;
  interrupted?: boolean;
  stopHookActive?: boolean;
  lastAssistantMessage?: string;
  endTurnReason?: string;
  reason?: string;
  backgroundTasks?: readonly unknown[];
  sessionCrons?: readonly unknown[];
  agentTranscriptPath?: string;
  parentSessionId?: string;
  userRequested?: boolean;
  status?: unknown;
}

export interface HostHookDecision {
  decision: HookDecision;
  reason?: string;
}

export interface CanonicalHookEnvelope {
  host: HookHost;
  contract: HookContract;
  hookType: HookType;
  sessionId?: string;
  directory?: string;
  transcriptPath?: string;
  stopReason?: string;
  eventPayload: CanonicalHookEventPayload;
  originalCallCount: number;
  logicalCallCount: number;
  toolCalls: CanonicalToolCall[];
  agent?: CanonicalAgentRef;
  capabilities: HookCapabilities;
  issues: NormalizationIssue[];
  hostDecision?: HostHookDecision;
}

export interface HookMutation {
  input: unknown;
  requirement: HookMutationRequirement;
  retryHint?: HookMutationRetryHint;
}

export interface HookMutationRetryHint {
  instruction: string;
  patch?: Readonly<Record<string, unknown>>;
}

export interface HookEffect {
  type: string;
  payload?: unknown;
  callId?: string;
  commitOn?: HookEffectCommit;
  critical?: boolean;
}

export interface HookEvaluation {
  callId?: string;
  source?: HookEvaluationSource;
  decision: HookDecision;
  reason?: string;
  mutation?: HookMutation;
  contexts?: readonly string[];
  effects?: readonly HookEffect[];
}

export interface HookCallDecision {
  callId?: string;
  source: HookEvaluationSource;
  decision: HookDecision;
  reason?: string;
}

export interface HookMutationIntent extends HookMutation {
  callId?: string;
}

export interface HookMutationRetryIntent extends HookMutationRetryHint {
  callId?: string;
}

export interface HookReduction {
  decision: HookDecision;
  reason?: string;
  retry: boolean;
  unchanged: boolean;
  contexts: string[];
  context?: string;
  diagnostics: string[];
  mutations: HookMutationIntent[];
  mutationRetryHints?: HookMutationRetryIntent[];
  callDecisions: HookCallDecision[];
  effects: HookEffect[];
  stagedEffects: HookEffect[];
}

export interface DetectedHookContract {
  host: HookHost;
  contract: HookContract;
  capabilities: HookCapabilities;
}
