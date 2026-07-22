/**
 * Hook Input Normalization
 *
 * Handles snake_case -> camelCase field mapping for Claude Code hook inputs.
 * Claude Code sends snake_case fields: tool_name, tool_input, tool_response,
 * session_id, cwd, hook_event_name. This module normalizes them to camelCase
 * with snake_case-first fallback.
 *
 * Uses Zod for structural validation to catch malformed inputs early.
 * Sensitive hooks use strict allowlists; others pass through unknown fields.
 */
import { createHash } from 'crypto';
import { z } from 'zod';
import { resolveTranscriptPath } from '../lib/worktree-paths.js';
import { CLAUDE_SINGLE_CAPABILITIES, COPILOT_1072_CAPABILITIES, formatUnknownError, } from './hook-protocol.js';
// --- Zod schemas for hook input validation ---
/** Schema for the common hook input structure (supports both snake_case and camelCase) */
const HookInputSchema = z.object({
    // snake_case fields from Claude Code
    tool_name: z.string().optional(),
    tool_input: z.unknown().optional(),
    tool_response: z.unknown().optional(),
    session_id: z.string().optional(),
    cwd: z.string().optional(),
    hook_event_name: z.string().optional(),
    // camelCase fields (fallback / already normalized)
    toolName: z.string().optional(),
    toolInput: z.unknown().optional(),
    toolOutput: z.unknown().optional(),
    toolResponse: z.unknown().optional(),
    sessionId: z.string().optional(),
    directory: z.string().optional(),
    hookEventName: z.string().optional(),
    // Fields that are the same in both conventions
    prompt: z.string().optional(),
    message: z.object({ content: z.string().optional() }).optional(),
    parts: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional(),
    model: z.string().optional(),
    model_id: z.string().optional(),
    modelId: z.string().optional(),
    agent_name: z.string().optional(),
    agentName: z.string().optional(),
    // Stop hook fields
    stop_reason: z.string().optional(),
    stopReason: z.string().optional(),
    user_requested: z.boolean().optional(),
    userRequested: z.boolean().optional(),
}).passthrough();
export const MAX_STABLE_SERIALIZATION_DEPTH = 128;
class StableSerializationError extends Error {
}
const CLAUDE_ENVELOPE_MARKERS = new Set([
    'hook_event_name',
    'session_id',
    'tool_name',
    'tool_input',
    'tool_response',
    'transcript_path',
    'stop_reason',
    'agent_id',
    'agent_type',
    'tool_use_id',
    'permission_mode',
]);
const COPILOT_ENVELOPE_MARKERS = new Set([
    'sessionId',
    'toolCalls',
    'toolName',
    'toolArgs',
    'toolResult',
    'hookName',
    'transcriptPath',
    'stopReason',
    'initialPrompt',
    'promptId',
    'agentName',
    'agentDisplayName',
    'agentDescription',
    'customInstructions',
]);
const COPILOT_TOOL_ALIASES = {
    agent: 'Task',
    apply_patch: 'Edit',
    ask_user: 'AskUserQuestion',
    bash: 'Bash',
    create: 'Write',
    edit: 'Edit',
    glob: 'Glob',
    grep: 'Grep',
    powershell: 'Bash',
    pwsh: 'Bash',
    read: 'Read',
    rg: 'Grep',
    skill: 'Skill',
    str_replace_editor: 'Edit',
    task: 'Task',
    update_todo: 'TodoWrite',
    view: 'Read',
    web_fetch: 'WebFetch',
    web_search: 'WebSearch',
    write: 'Write',
};
const EVENT_NAME_ALIASES = {
    AgentStop: 'stop',
    Notification: 'notification',
    PermissionRequest: 'permission-request',
    PostToolUse: 'post-tool-use',
    PostToolUseFailure: 'post-tool-use-failure',
    PreCompact: 'pre-compact',
    PreToolUse: 'pre-tool-use',
    SessionEnd: 'session-end',
    SessionStart: 'session-start',
    Stop: 'stop',
    SubagentStart: 'subagent-start',
    SubagentStop: 'subagent-stop',
    UserPromptSubmit: 'user-prompt-submit',
    agentStop: 'stop',
    notification: 'notification',
    permissionRequest: 'permission-request',
    postToolUse: 'post-tool-use',
    postToolUseFailure: 'post-tool-use-failure',
    preCompact: 'pre-compact',
    preToolUse: 'pre-tool-use',
    sessionEnd: 'session-end',
    sessionStart: 'session-start',
    subagentStart: 'subagent-start',
    subagentStop: 'subagent-stop',
    userPromptSubmitted: 'user-prompt-submit',
};
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function hasOwn(input, key) {
    return Object.prototype.hasOwnProperty.call(input, key);
}
function stringField(input, key) {
    const value = input[key];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}
function firstDefinedField(input, keys) {
    for (const key of keys) {
        if (hasOwn(input, key) && input[key] !== undefined)
            return input[key];
    }
    return undefined;
}
function firstStringField(input, keys) {
    for (const key of keys) {
        const value = stringField(input, key);
        if (value !== undefined)
            return value;
    }
    return undefined;
}
function normalizeLastAssistantMessage(input) {
    if (hasOwn(input, 'last_assistant_message')) {
        const value = input.last_assistant_message;
        return typeof value === 'string' ? value.trim() : '';
    }
    for (const key of [
        'lastAssistantMessage',
        'message',
        'output',
        'response',
        'text',
    ]) {
        const value = input[key];
        if (typeof value === 'string' && value.trim().length > 0) {
            return value.trim();
        }
    }
    return undefined;
}
function firstNumberField(input, keys) {
    for (const key of keys) {
        const value = input[key];
        if (typeof value === 'number' && Number.isFinite(value))
            return value;
    }
    return undefined;
}
function firstBooleanField(input, keys) {
    for (const key of keys) {
        const value = input[key];
        if (typeof value === 'boolean')
            return value;
    }
    return undefined;
}
function firstArrayField(input, keys) {
    for (const key of keys) {
        const value = input[key];
        if (Array.isArray(value))
            return [...value];
    }
    return undefined;
}
function hostFieldKeys(host, snakeCase, camelCase, ...fallbacks) {
    return host === 'claude'
        ? [snakeCase, camelCase, ...fallbacks]
        : [camelCase, snakeCase, ...fallbacks];
}
function normalizeGoalSnapshot(raw) {
    const context = isRecord(raw.context) ? raw.context : undefined;
    const candidates = [
        { value: raw.goal, source: 'payload' },
        { value: raw.claude_goal, source: 'payload' },
        { value: raw.claudeGoal, source: 'payload' },
        { value: raw.goal_state, source: 'payload' },
        { value: raw.goalState, source: 'payload' },
        { value: raw.codex_goal, source: 'payload' },
        { value: raw.codexGoal, source: 'payload' },
        { value: context?.goal, source: 'context' },
        { value: context?.claude_goal, source: 'context' },
        { value: context?.claudeGoal, source: 'context' },
    ];
    for (const candidate of candidates) {
        const value = isRecord(candidate.value) && isRecord(candidate.value.goal)
            ? candidate.value.goal
            : candidate.value;
        if (!isRecord(value))
            continue;
        const objective = firstStringField(value, ['objective', 'condition', 'prompt', 'description']);
        const status = firstStringField(value, ['status', 'state']);
        if (objective === undefined && status === undefined)
            continue;
        return {
            ...(objective !== undefined ? { objective } : {}),
            ...(status !== undefined ? { status } : {}),
            source: candidate.source,
        };
    }
    return undefined;
}
function normalizeEventPayload(raw, host, hookType) {
    const prompt = firstStringField(raw, ['prompt']);
    const userPrompt = firstStringField(raw, hostFieldKeys(host, 'user_prompt', 'userPrompt'));
    const initialPrompt = firstStringField(raw, ['initialPrompt', 'initial_prompt']);
    const promptId = firstStringField(raw, hostFieldKeys(host, 'prompt_id', 'promptId'));
    const message = firstDefinedField(raw, ['message']);
    const messagePrompt = isRecord(message)
        ? firstStringField(message, ['content'])
        : typeof message === 'string' && message.length > 0
            ? message
            : undefined;
    const parts = firstArrayField(raw, ['parts']);
    const partsPrompt = parts
        ?.flatMap((part) => isRecord(part)
        && part.type === 'text'
        && typeof part.text === 'string'
        && part.text.length > 0
        ? [part.text]
        : [])
        .join(' ');
    const promptAliases = [...new Set([
            prompt,
            userPrompt,
            initialPrompt,
            messagePrompt,
            partsPrompt || undefined,
        ].filter((value) => value !== undefined))];
    const goal = normalizeGoalSnapshot(raw);
    const source = firstStringField(raw, ['source']);
    const model = firstStringField(raw, hostFieldKeys(host, 'model_id', 'modelId', 'model'));
    const timestamp = firstNumberField(raw, ['timestamp']);
    const toolOutput = firstDefinedField(raw, host === 'claude'
        ? ['tool_response', 'toolOutput', 'toolResponse', 'toolResult', 'output', 'result']
        : ['toolResult', 'toolOutput', 'toolResponse', 'tool_response', 'output', 'result']);
    const toolError = firstDefinedField(raw, ['error', 'toolError', 'tool_error']);
    const contextWindow = firstDefinedField(raw, hostFieldKeys(host, 'context_window', 'contextWindow'));
    const trigger = firstStringField(raw, ['trigger']);
    const customInstructions = firstStringField(raw, hostFieldKeys(host, 'custom_instructions', 'customInstructions'));
    const permissionSuggestions = firstArrayField(raw, hostFieldKeys(host, 'permission_suggestions', 'permissionSuggestions'));
    const permissionMode = firstStringField(raw, hostFieldKeys(host, 'permission_mode', 'permissionMode'));
    const durationMs = firstNumberField(raw, hostFieldKeys(host, 'duration_ms', 'durationMs'));
    const interrupted = firstBooleanField(raw, hostFieldKeys(host, 'is_interrupt', 'isInterrupt'));
    const stopHookActive = firstBooleanField(raw, hostFieldKeys(host, 'stop_hook_active', 'stopHookActive'));
    const lastAssistantMessage = normalizeLastAssistantMessage(raw);
    const endTurnReason = firstStringField(raw, hostFieldKeys(host, 'end_turn_reason', 'endTurnReason'));
    const reason = firstStringField(raw, ['reason']);
    const backgroundTasks = firstArrayField(raw, hostFieldKeys(host, 'background_tasks', 'backgroundTasks'));
    const sessionCrons = firstArrayField(raw, hostFieldKeys(host, 'session_crons', 'sessionCrons'));
    const agentTranscriptPath = firstStringField(raw, hostFieldKeys(host, 'agent_transcript_path', 'agentTranscriptPath'));
    const parentSessionId = firstStringField(raw, hostFieldKeys(host, 'parent_session_id', 'parentSessionId'));
    const userRequested = firstBooleanField(raw, hostFieldKeys(host, 'user_requested', 'userRequested'));
    const status = firstDefinedField(raw, ['status']);
    const eventKey = hookType.replace(/[^a-z]/gi, '').toLowerCase();
    const sessionEndReason = eventKey === 'sessionend'
        ? firstStringField(raw, ['reason'])
        : undefined;
    const notificationType = firstStringField(raw, hostFieldKeys(host, 'notification_type', 'notificationType'));
    const notificationTitle = firstStringField(raw, hostFieldKeys(host, 'notification_title', 'notificationTitle', 'title'));
    const notificationData = firstDefinedField(raw, hostFieldKeys(host, 'notification_data', 'notificationData', 'data'));
    const notification = eventKey === 'notification'
        || notificationType !== undefined
        || notificationTitle !== undefined
        || notificationData !== undefined
        ? {
            ...(notificationType !== undefined ? { type: notificationType } : {}),
            ...(notificationTitle !== undefined ? { title: notificationTitle } : {}),
            ...(message !== undefined ? { message } : {}),
            ...(notificationData !== undefined ? { data: notificationData } : {}),
        }
        : undefined;
    return {
        ...(prompt !== undefined ? { prompt } : {}),
        ...(userPrompt !== undefined ? { userPrompt } : {}),
        ...(promptAliases.length > 0 ? { promptAliases } : {}),
        ...(initialPrompt !== undefined ? { initialPrompt } : {}),
        ...(promptId !== undefined ? { promptId } : {}),
        ...(goal !== undefined ? { goal } : {}),
        ...(source !== undefined ? { source } : {}),
        ...(model !== undefined ? { model } : {}),
        ...(timestamp !== undefined ? { timestamp } : {}),
        ...(message !== undefined ? { message } : {}),
        ...(parts !== undefined ? { parts } : {}),
        ...(toolOutput !== undefined ? { toolOutput } : {}),
        ...(toolError !== undefined ? { toolError } : {}),
        ...(contextWindow !== undefined ? { contextWindow } : {}),
        ...(notification !== undefined ? { notification } : {}),
        ...(trigger !== undefined ? { trigger } : {}),
        ...(customInstructions !== undefined ? { customInstructions } : {}),
        ...(sessionEndReason !== undefined ? { sessionEndReason } : {}),
        ...(permissionSuggestions !== undefined ? { permissionSuggestions } : {}),
        ...(permissionMode !== undefined ? { permissionMode } : {}),
        ...(durationMs !== undefined ? { durationMs } : {}),
        ...(interrupted !== undefined ? { interrupted } : {}),
        ...(stopHookActive !== undefined ? { stopHookActive } : {}),
        ...(lastAssistantMessage !== undefined ? { lastAssistantMessage } : {}),
        ...(endTurnReason !== undefined ? { endTurnReason } : {}),
        ...(reason !== undefined ? { reason } : {}),
        ...(backgroundTasks !== undefined ? { backgroundTasks } : {}),
        ...(sessionCrons !== undefined ? { sessionCrons } : {}),
        ...(agentTranscriptPath !== undefined ? { agentTranscriptPath } : {}),
        ...(parentSessionId !== undefined ? { parentSessionId } : {}),
        ...(userRequested !== undefined ? { userRequested } : {}),
        ...(status !== undefined ? { status } : {}),
    };
}
function stableSerialize(value, seen = new Set(), depth = 0) {
    if (depth > MAX_STABLE_SERIALIZATION_DEPTH) {
        throw new StableSerializationError(`Tool arguments exceed the maximum fingerprint depth of ${MAX_STABLE_SERIALIZATION_DEPTH}.`);
    }
    if (value === null)
        return 'null';
    switch (typeof value) {
        case 'string':
        case 'boolean':
            return JSON.stringify(value);
        case 'number':
            return Number.isFinite(value) ? JSON.stringify(value) : JSON.stringify(String(value));
        case 'bigint':
            return JSON.stringify(`${value.toString()}n`);
        case 'undefined':
            return '"__undefined__"';
        case 'function':
            return '"__function__"';
        case 'symbol':
            return JSON.stringify(String(value));
        case 'object':
            break;
    }
    const objectValue = value;
    if (seen.has(objectValue))
        return '"__circular__"';
    seen.add(objectValue);
    let serialized;
    if (Array.isArray(value)) {
        serialized = `[${value
            .map((item) => stableSerialize(item, seen, depth + 1))
            .join(',')}]`;
    }
    else {
        const entries = Object.entries(value)
            .filter(([, child]) => !['undefined', 'function', 'symbol'].includes(typeof child))
            .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
            .map(([key, child]) => `${JSON.stringify(key)}:${stableSerialize(child, seen, depth + 1)}`);
        serialized = `{${entries.join(',')}}`;
    }
    seen.delete(objectValue);
    return serialized;
}
function shellDialectForTool(host, nativeName) {
    const normalized = nativeName.toLowerCase().replace(/^proxy_/, '');
    if (normalized === 'powershell' || normalized === 'pwsh')
        return 'powershell';
    if (normalized === 'bash' || (host === 'claude' && normalized === 'shell'))
        return 'posix';
    if (host === 'claude' && nativeName === 'Bash')
        return 'posix';
    return undefined;
}
function malformedCallIssue(code, message, originalIndex, callId) {
    return {
        code,
        message,
        severity: 'safety',
        scope: 'call',
        originalIndex,
        callId,
    };
}
function parseSerializedArgs(rawArgs, originalIndex, callId) {
    if (typeof rawArgs !== 'string') {
        return {
            input: rawArgs,
            issue: malformedCallIssue('malformed-tool-args', `Tool call at index ${originalIndex} must provide serialized JSON args.`, originalIndex, callId),
        };
    }
    try {
        return { input: JSON.parse(rawArgs) };
    }
    catch {
        return {
            input: rawArgs,
            issue: malformedCallIssue('malformed-tool-args', `Tool call at index ${originalIndex} contains malformed JSON args.`, originalIndex, callId),
        };
    }
}
function syntheticCallId(originalIndex) {
    return `__missing_tool_call_id_${originalIndex}`;
}
function normalizeHostDecision(value) {
    if (typeof value === 'string') {
        const decision = value === 'block' ? 'deny' : value;
        if (['pass', 'allow', 'ask', 'deny'].includes(decision)) {
            return { decision: decision };
        }
        return undefined;
    }
    if (!isRecord(value))
        return undefined;
    const rawDecision = value.decision ?? value.behavior;
    const normalized = normalizeHostDecision(rawDecision);
    if (!normalized)
        return undefined;
    const reason = stringField(value, 'reason');
    return reason ? { ...normalized, reason } : normalized;
}
function inferHookType(raw, hookType) {
    if (hookType)
        return hookType;
    const nativeEvent = stringField(raw, 'hook_event_name')
        ?? stringField(raw, 'hookName')
        ?? stringField(raw, 'hookEventName');
    if (!nativeEvent)
        return 'unknown';
    return EVENT_NAME_ALIASES[nativeEvent] ?? nativeEvent;
}
/**
 * Detect the host contract from the complete top-level hook envelope.
 * Nested tool arguments are deliberately ignored so snake_case argument keys
 * cannot change host detection.
 */
export function detectHookContract(raw, _hookType) {
    if (!isRecord(raw)) {
        return {
            host: 'claude',
            contract: 'claude-single',
            capabilities: CLAUDE_SINGLE_CAPABILITIES,
        };
    }
    for (const marker of CLAUDE_ENVELOPE_MARKERS) {
        if (hasOwn(raw, marker)) {
            return {
                host: 'claude',
                contract: 'claude-single',
                capabilities: CLAUDE_SINGLE_CAPABILITIES,
            };
        }
    }
    for (const marker of COPILOT_ENVELOPE_MARKERS) {
        if (hasOwn(raw, marker)) {
            return {
                host: 'copilot',
                contract: 'copilot-1.0.72-1',
                capabilities: COPILOT_1072_CAPABILITIES,
            };
        }
    }
    return {
        host: 'claude',
        contract: 'claude-single',
        capabilities: CLAUDE_SINGLE_CAPABILITIES,
    };
}
export function canonicalToolName(host, nativeName) {
    const unproxiedName = nativeName.replace(/^proxy_/, '');
    if (host === 'copilot') {
        return COPILOT_TOOL_ALIASES[unproxiedName.toLowerCase()] ?? unproxiedName;
    }
    return unproxiedName === 'powershell' || unproxiedName === 'pwsh'
        ? 'Bash'
        : unproxiedName;
}
export function stableCallFingerprint(name, parsedInput) {
    return createHash('sha256')
        .update(name)
        .update('\0')
        .update(stableSerialize(parsedInput))
        .digest('hex');
}
function safeCallFingerprint(name, parsedInput, rawArgs, originalIndex, callId) {
    try {
        return { fingerprint: stableCallFingerprint(name, parsedInput) };
    }
    catch (error) {
        const detail = formatUnknownError(error);
        const fallback = typeof rawArgs === 'string'
            ? rawArgs
            : `${typeof rawArgs}:serialization-unavailable`;
        return {
            fingerprint: createHash('sha256')
                .update(name)
                .update('\0serialization-error\0')
                .update(fallback)
                .digest('hex'),
            issue: malformedCallIssue('tool-call-serialization-failed', `Tool call at index ${originalIndex} could not be fingerprinted safely: ${detail}`, originalIndex, callId),
        };
    }
}
export function decodeCopilotToolCall(rawCall, originalIndex) {
    if (!isRecord(rawCall)) {
        const issue = malformedCallIssue('malformed-tool-call', `Tool call at index ${originalIndex} must be an object.`, originalIndex);
        const id = syntheticCallId(originalIndex);
        const fingerprint = safeCallFingerprint('', rawCall, rawCall, originalIndex, id);
        return {
            id,
            idSource: 'synthetic',
            correlation: 'unavailable',
            originalIndex,
            duplicateIndices: [],
            nativeName: '',
            canonicalName: '',
            input: rawCall,
            rawArgs: rawCall,
            fingerprint: fingerprint.fingerprint,
            status: 'malformed',
            malformed: true,
            issues: fingerprint.issue ? [issue, fingerprint.issue] : [issue],
        };
    }
    const issues = [];
    const rawId = stringField(rawCall, 'id');
    const id = rawId ?? syntheticCallId(originalIndex);
    if (!rawId) {
        issues.push(malformedCallIssue('missing-tool-call-id', `Tool call at index ${originalIndex} is missing a correlation ID.`, originalIndex, id));
    }
    const nativeName = stringField(rawCall, 'name') ?? '';
    if (!nativeName) {
        issues.push(malformedCallIssue('missing-tool-name', `Tool call at index ${originalIndex} is missing a tool name.`, originalIndex, id));
    }
    const rawArgs = rawCall.args;
    const parsedArgs = parseSerializedArgs(rawArgs, originalIndex, id);
    if (parsedArgs.issue)
        issues.push(parsedArgs.issue);
    const fingerprint = safeCallFingerprint(nativeName, parsedArgs.input, rawArgs, originalIndex, id);
    if (fingerprint.issue)
        issues.push(fingerprint.issue);
    const malformed = issues.length > 0;
    return {
        id,
        idSource: rawId ? 'host' : 'synthetic',
        correlation: rawId ? 'host-id' : 'unavailable',
        originalIndex,
        duplicateIndices: [],
        nativeName,
        canonicalName: canonicalToolName('copilot', nativeName),
        shellDialect: shellDialectForTool('copilot', nativeName),
        input: parsedArgs.input,
        rawArgs,
        fingerprint: fingerprint.fingerprint,
        status: malformed ? 'malformed' : 'valid',
        malformed,
        issues,
    };
}
export function dedupeCanonicalToolCalls(calls) {
    const uniqueCalls = [];
    const issues = [];
    const indexById = new Map();
    for (const call of calls) {
        const existingIndex = indexById.get(call.id);
        if (existingIndex === undefined) {
            indexById.set(call.id, uniqueCalls.length);
            uniqueCalls.push({
                ...call,
                duplicateIndices: [...call.duplicateIndices],
                issues: [...call.issues],
            });
            continue;
        }
        const existing = uniqueCalls[existingIndex];
        if (existing.fingerprint === call.fingerprint) {
            const malformed = existing.malformed
                || existing.status === 'malformed'
                || existing.issues.length > 0
                || call.malformed
                || call.status === 'malformed'
                || call.issues.length > 0;
            uniqueCalls[existingIndex] = {
                ...existing,
                duplicateIndices: [
                    ...existing.duplicateIndices,
                    call.originalIndex,
                    ...call.duplicateIndices,
                ],
                issues: [
                    ...existing.issues,
                    ...call.issues,
                ],
                status: malformed ? 'malformed' : 'valid',
                malformed,
            };
            continue;
        }
        issues.push({
            code: 'conflicting-duplicate-id',
            message: `Tool call ID "${call.id}" has conflicting names or arguments.`,
            severity: 'safety',
            scope: 'batch',
            originalIndex: call.originalIndex,
            callId: call.id,
            batchSafety: true,
        });
    }
    return { calls: uniqueCalls, issues };
}
function decodeSingleToolCall(host, raw) {
    const nativeName = host === 'claude'
        ? stringField(raw, 'tool_name') ?? stringField(raw, 'toolName')
        : stringField(raw, 'toolName') ?? stringField(raw, 'tool_name');
    if (!nativeName)
        return undefined;
    const hostId = stringField(raw, 'tool_use_id')
        ?? stringField(raw, 'toolUseId')
        ?? stringField(raw, 'toolCallId');
    const issues = [];
    let input;
    let rawArgs;
    if (host === 'copilot' && hasOwn(raw, 'toolArgs')) {
        rawArgs = raw.toolArgs;
        if (typeof rawArgs === 'string') {
            try {
                input = JSON.parse(rawArgs);
            }
            catch {
                input = rawArgs;
            }
        }
        else {
            input = rawArgs;
        }
    }
    else {
        input = host === 'claude'
            ? raw.tool_input ?? raw.toolInput
            : raw.toolInput ?? raw.tool_input;
        rawArgs = input;
    }
    const fingerprint = safeCallFingerprint(nativeName, input, rawArgs, 0, hostId);
    if (fingerprint.issue)
        issues.push(fingerprint.issue);
    const id = hostId ?? `__single_tool_call_${fingerprint.fingerprint.slice(0, 24)}`;
    const malformed = issues.length > 0;
    return {
        id,
        idSource: hostId ? 'host' : 'synthetic',
        correlation: hostId ? 'host-id' : 'unavailable',
        originalIndex: 0,
        duplicateIndices: [],
        nativeName,
        canonicalName: canonicalToolName(host, nativeName),
        shellDialect: shellDialectForTool(host, nativeName),
        input,
        rawArgs,
        fingerprint: fingerprint.fingerprint,
        status: malformed ? 'malformed' : 'valid',
        malformed,
        issues,
    };
}
/**
 * Normalize a complete host envelope without changing nested tool argument keys.
 */
export function normalizeHookEnvelope(raw, hookType) {
    const detected = detectHookContract(raw, hookType);
    if (!isRecord(raw)) {
        return {
            ...detected,
            hookType: hookType ?? 'unknown',
            eventPayload: {},
            originalCallCount: 0,
            logicalCallCount: 0,
            toolCalls: [],
            issues: [{
                    code: 'invalid-envelope',
                    message: 'Hook input must be a JSON object.',
                    severity: 'safety',
                    scope: 'batch',
                    batchSafety: true,
                }],
        };
    }
    const issues = [];
    let decodedCalls = [];
    if (detected.host === 'copilot' && hasOwn(raw, 'toolCalls')) {
        if (Array.isArray(raw.toolCalls)) {
            decodedCalls = raw.toolCalls.map((call, index) => decodeCopilotToolCall(call, index));
        }
        else {
            issues.push({
                code: 'invalid-tool-calls',
                message: 'Copilot toolCalls must be an array.',
                severity: 'safety',
                scope: 'batch',
                batchSafety: true,
            });
        }
    }
    else {
        const singleCall = decodeSingleToolCall(detected.host, raw);
        if (singleCall)
            decodedCalls = [singleCall];
    }
    for (const call of decodedCalls) {
        issues.push(...call.issues);
    }
    const deduped = dedupeCanonicalToolCalls(decodedCalls);
    issues.push(...deduped.issues);
    const canonicalHookType = inferHookType(raw, hookType);
    const sessionId = detected.host === 'claude'
        ? stringField(raw, 'session_id')
            ?? stringField(raw, 'sessionId')
            ?? stringField(raw, 'sessionid')
        : stringField(raw, 'sessionId')
            ?? stringField(raw, 'session_id')
            ?? stringField(raw, 'sessionid');
    const directory = stringField(raw, 'cwd') ?? stringField(raw, 'directory');
    const rawTranscriptPath = detected.host === 'claude'
        ? stringField(raw, 'transcript_path') ?? stringField(raw, 'transcriptPath')
        : stringField(raw, 'transcriptPath') ?? stringField(raw, 'transcript_path');
    const transcriptPath = resolveTranscriptPath(rawTranscriptPath, directory);
    const stopReason = detected.host === 'claude'
        ? stringField(raw, 'stop_reason') ?? stringField(raw, 'stopReason')
        : stringField(raw, 'stopReason') ?? stringField(raw, 'stop_reason');
    const agentId = stringField(raw, 'agent_id')
        ?? stringField(raw, 'agentId');
    const agentName = detected.host === 'claude'
        ? stringField(raw, 'agent_type')
            ?? stringField(raw, 'agent_name')
            ?? stringField(raw, 'agentName')
        : stringField(raw, 'agentName')
            ?? stringField(raw, 'agent_type')
            ?? stringField(raw, 'agent_name');
    const agentDisplayName = stringField(raw, 'agentDisplayName')
        ?? stringField(raw, 'agent_display_name');
    const agentDescription = stringField(raw, 'agentDescription')
        ?? stringField(raw, 'agent_description');
    let agent;
    if (agentId || agentName || agentDisplayName || agentDescription) {
        agent = {
            ...(agentId ? { id: agentId } : {}),
            ...(agentName ? { name: agentName } : {}),
            ...(agentDisplayName ? { displayName: agentDisplayName } : {}),
            ...(agentDescription ? { description: agentDescription } : {}),
            correlation: agentId ? 'host-id' : 'unavailable',
        };
    }
    const hostDecision = detected.host === 'copilot' && canonicalHookType === 'permission-request'
        ? undefined
        : normalizeHostDecision(raw.hostDecision)
            ?? normalizeHostDecision(raw.nativeDecision);
    return {
        ...detected,
        hookType: canonicalHookType,
        sessionId,
        directory,
        transcriptPath,
        stopReason,
        eventPayload: normalizeEventPayload(raw, detected.host, canonicalHookType),
        originalCallCount: decodedCalls.length,
        logicalCallCount: deduped.calls.length,
        toolCalls: deduped.calls,
        agent,
        issues,
        hostDecision,
    };
}
// --- Security: Hook sensitivity classification ---
/** Hooks where unknown fields are dropped (strict allowlist only) */
const SENSITIVE_HOOKS = new Set([
    'permission-request',
    'setup-init',
    'setup-maintenance',
    'session-end',
]);
/** All known camelCase field names the system uses (post-normalization) */
const KNOWN_FIELDS = new Set([
    // Core normalized fields
    'sessionId', 'toolName', 'toolInput', 'toolOutput', 'directory',
    'prompt', 'message', 'parts', 'hookEventName',
    // Stop hook fields
    'stop_reason', 'stopReason', 'user_requested', 'userRequested',
    // Permission hook fields
    'permission_mode', 'tool_use_id', 'transcript_path',
    // Subagent fields
    'agent_id', 'agent_name', 'agent_type', 'parent_session_id',
    'agentName', 'model', 'model_id', 'modelId',
    // Common extra fields from Claude Code
    'input', 'output', 'result', 'error', 'status',
    // Session-end fields
    'reason',
]);
// --- Fast-path detection ---
/** Typical camelCase keys that indicate already-normalized input */
const CAMEL_CASE_MARKERS = new Set(['sessionId', 'toolName', 'directory']);
/** Check if any key in the object contains an underscore (snake_case indicator) */
function hasSnakeCaseKeys(obj) {
    for (const key of Object.keys(obj)) {
        if (key.includes('_'))
            return true;
    }
    return false;
}
/** Check if input is already camelCase-normalized and can skip Zod parsing */
function isAlreadyCamelCase(obj) {
    // Must have at least one camelCase marker key
    let hasMarker = false;
    for (const marker of CAMEL_CASE_MARKERS) {
        if (marker in obj) {
            hasMarker = true;
            break;
        }
    }
    if (!hasMarker)
        return false;
    // Must have no snake_case keys
    return !hasSnakeCaseKeys(obj);
}
/**
 * Normalize hook input from Claude Code's snake_case format to the
 * camelCase HookInput interface used internally.
 *
 * Validates the input structure with Zod, then maps snake_case to camelCase.
 * Always reads snake_case first with camelCase fallback, per the
 * project convention documented in MEMORY.md.
 *
 * @param raw - Raw hook input (may be snake_case, camelCase, or mixed)
 * @param hookType - Optional hook type for sensitivity-aware filtering
 */
export function normalizeHookInput(raw, hookType) {
    if (typeof raw !== 'object' || raw === null) {
        return {};
    }
    const rawObj = raw;
    // Fast path: if input is already camelCase, skip Zod parse entirely
    if (isAlreadyCamelCase(rawObj)) {
        const passthrough = filterPassthrough(rawObj, hookType);
        // Resolve worktree-mismatched transcript paths (issue #1094)
        if (passthrough.transcript_path) {
            passthrough.transcript_path = resolveTranscriptPath(passthrough.transcript_path, rawObj.directory);
        }
        return {
            sessionId: rawObj.sessionId,
            toolName: rawObj.toolName,
            toolInput: rawObj.toolInput,
            toolOutput: rawObj.toolOutput ?? rawObj.toolResponse,
            directory: rawObj.directory,
            prompt: rawObj.prompt,
            message: rawObj.message,
            parts: rawObj.parts,
            ...passthrough,
        };
    }
    // Validate with Zod - use safeParse so malformed input doesn't throw
    const parsed = HookInputSchema.safeParse(raw);
    if (!parsed.success) {
        // Log validation issues but don't block - fall through to best-effort mapping
        console.error('[bridge-normalize] Zod validation warning:', parsed.error.issues.map(i => i.message).join(', '));
    }
    const input = (parsed.success ? parsed.data : raw);
    const extraFields = filterPassthrough(input, hookType);
    // Resolve worktree-mismatched transcript paths (issue #1094)
    if (extraFields.transcript_path) {
        extraFields.transcript_path = resolveTranscriptPath(extraFields.transcript_path, (input.cwd ?? input.directory));
    }
    return {
        sessionId: input.session_id ?? input.sessionId,
        toolName: input.tool_name ?? input.toolName,
        toolInput: input.tool_input ?? input.toolInput,
        // tool_response maps to toolOutput for backward compatibility
        toolOutput: input.tool_response ?? input.toolOutput ?? input.toolResponse,
        directory: input.cwd ?? input.directory,
        prompt: input.prompt,
        message: input.message,
        parts: input.parts,
        // Pass through extra fields with sensitivity filtering
        ...extraFields,
    };
}
/**
 * Filter passthrough fields based on hook sensitivity.
 *
 * - Sensitive hooks: only allow KNOWN_FIELDS (drop everything else)
 * - Other hooks: pass through unknown fields with a debug warning
 */
function filterPassthrough(input, hookType) {
    const MAPPED_KEYS = new Set([
        'tool_name', 'toolName',
        'tool_input', 'toolInput',
        'tool_response', 'toolOutput', 'toolResponse',
        'session_id', 'sessionId',
        'cwd', 'directory',
        'hook_event_name', 'hookEventName',
        'prompt', 'message', 'parts',
    ]);
    const isSensitive = hookType != null && SENSITIVE_HOOKS.has(hookType);
    const extra = {};
    for (const [key, value] of Object.entries(input)) {
        if (MAPPED_KEYS.has(key) || value === undefined)
            continue;
        if (isSensitive) {
            // Strict: only allow known fields
            if (KNOWN_FIELDS.has(key)) {
                extra[key] = value;
            }
            // Unknown fields silently dropped for sensitive hooks
        }
        else {
            // Conservative: pass through but warn on truly unknown fields
            extra[key] = value;
            if (!KNOWN_FIELDS.has(key)) {
                console.error(`[bridge-normalize] Unknown field "${key}" passed through for hook "${hookType ?? 'unknown'}"`);
            }
        }
    }
    return extra;
}
// --- Test helpers (exported for testing only) ---
export { SENSITIVE_HOOKS, KNOWN_FIELDS, isAlreadyCamelCase, HookInputSchema };
//# sourceMappingURL=bridge-normalize.js.map