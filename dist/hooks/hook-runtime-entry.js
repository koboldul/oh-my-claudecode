import { normalizeHookInput, } from './bridge-normalize.js';
import { interpretLegacyOutput, } from './hook-runtime.js';
import { encodeHookOutput, } from './hook-output.js';
const LEGACY_HOOK_EVENT_NAMES = {
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
function primaryPrompt(eventPayload) {
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
export function normalizeLegacyHookInput(raw, hookType) {
    return normalizeHookInput(raw, hookType);
}
/**
 * Build one legacy processor input from one canonical execution unit.
 * Canonical tool names are the default because existing processors generally
 * use Claude-style names; native provenance remains available on every call.
 */
export function buildLegacyProcessorInput(envelope, unit, options = {}) {
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
export function describeHookRunFailure(result) {
    const failures = [];
    for (const issue of result.envelope.issues) {
        if (issue.severity === 'safety' || issue.batchSafety === true) {
            failures.push(issue.message || issue.code || 'hook input normalization failed');
        }
    }
    for (const evaluation of result.evaluations) {
        if (evaluation.source === 'adapter' && evaluation.decision === 'deny') {
            failures.push(evaluation.reason || 'legacy processor adapter failed');
        }
    }
    for (const decision of result.reduction.callDecisions) {
        if (decision.source === 'adapter' && decision.decision === 'deny') {
            failures.push(decision.reason || 'hook reduction failed');
        }
    }
    if (result.reduction.decision !== 'pass') {
        failures.push(result.reduction.reason
            || `unexpected ${result.reduction.decision} reduction`);
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
export function encodeLegacyCompatibleHookOutput(envelope, reduction, legacyOutput) {
    if (envelope.host === 'copilot') {
        return encodeHookOutput(envelope, reduction);
    }
    if (typeof legacyOutput === 'object'
        && legacyOutput !== null
        && !Array.isArray(legacyOutput)) {
        return legacyOutput;
    }
    return encodeHookOutput(envelope, reduction);
}
/**
 * Typed compatibility adapter for processors that still return legacy hook
 * output objects. Canonical interpretation remains owned by hook-runtime.ts.
 */
export function adaptLegacyHookOutput(hookType, output) {
    return interpretLegacyOutput(hookType, output);
}
export { detectHookContract, normalizeHookEnvelope, normalizeHookInput, } from './bridge-normalize.js';
export { boundHookContexts, interpretLegacyOutput, reduceHookEvaluations, runHookJson, runHookPayload, sanitizeHookEvaluation, } from './hook-runtime.js';
export { canEncodeHookMutation, encodeClaudeHookOutput, encodeCopilotHookOutput, encodeHookOutput, } from './hook-output.js';
export { CLAUDE_SINGLE_CAPABILITIES, COPILOT_1072_CAPABILITIES, formatUnknownError, } from './hook-protocol.js';
export * from './pre-tool-enforcer/index.js';
export { runHookNotificationChild } from './background-notifications.js';
//# sourceMappingURL=hook-runtime-entry.js.map