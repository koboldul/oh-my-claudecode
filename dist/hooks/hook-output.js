const COPILOT_CONTEXT_OUTPUT_EVENTS = new Set([
    'notification',
    'posttooluse',
    'posttoolusefailure',
    'sessionstart',
    'subagentstart',
    'userpromptsubmit',
]);
const CLAUDE_CONTEXT_EVENT_NAMES = {
    posttooluse: 'PostToolUse',
    posttoolusefailure: 'PostToolUseFailure',
    sessionstart: 'SessionStart',
    setupinit: 'Setup',
    setupmaintenance: 'Setup',
    subagentstart: 'SubagentStart',
    userpromptsubmit: 'UserPromptSubmit',
};
function normalizeEventName(hookType) {
    return hookType.replace(/[^a-z]/gi, '').toLowerCase();
}
export function canEncodeHookMutation(envelope, decision) {
    const eventName = normalizeEventName(envelope.hookType);
    if (eventName === 'pretooluse')
        return decision !== 'deny';
    return (envelope.host === 'claude'
        && eventName === 'permissionrequest'
        && decision === 'allow');
}
function nonEmptyText(value) {
    return value && value.trim().length > 0 ? value : undefined;
}
function encodedDecisionReason(reduction, fallback) {
    return nonEmptyText(reduction.reason) ?? fallback;
}
function singletonMutationInput(envelope, reduction) {
    const logicalCallCount = Number.isInteger(envelope.logicalCallCount)
        ? envelope.logicalCallCount
        : envelope.toolCalls.length;
    if (logicalCallCount !== 1
        || !envelope.capabilities.singletonMutationOutput
        || reduction.mutations.length !== 1) {
        return undefined;
    }
    const mutation = reduction.mutations[0];
    return mutation.input;
}
function encodeStopOutput(reduction) {
    if (reduction.decision !== 'deny')
        return {};
    return {
        decision: 'block',
        reason: encodedDecisionReason(reduction, 'Hook requested another agent turn.'),
    };
}
function encodeCopilotPreToolUseOutput(envelope, reduction) {
    const output = {};
    if (reduction.decision !== 'pass') {
        output.permissionDecision = reduction.decision;
        if (reduction.decision === 'deny' || reduction.decision === 'ask') {
            output.permissionDecisionReason = encodedDecisionReason(reduction, reduction.decision === 'deny'
                ? 'Hook denied this tool call.'
                : 'Hook requires confirmation for this tool call.');
        }
    }
    const mutation = canEncodeHookMutation(envelope, reduction.decision)
        ? singletonMutationInput(envelope, reduction)
        : undefined;
    if (mutation)
        output.modifiedArgs = mutation;
    const context = nonEmptyText(reduction.context);
    if (context)
        output.additionalContext = context;
    return output;
}
function encodeCopilotPermissionRequestOutput(reduction) {
    if (reduction.decision === 'allow') {
        return { behavior: 'allow' };
    }
    if (reduction.decision === 'deny') {
        return {
            behavior: 'deny',
            message: encodedDecisionReason(reduction, 'Hook denied this permission request.'),
        };
    }
    return {};
}
export function encodeCopilotHookOutput(envelope, reduction) {
    const eventName = normalizeEventName(envelope.hookType);
    if (eventName === 'pretooluse') {
        return encodeCopilotPreToolUseOutput(envelope, reduction);
    }
    if (eventName === 'agentstop' || eventName === 'stop' || eventName === 'subagentstop') {
        return encodeStopOutput(reduction);
    }
    if (eventName === 'permissionrequest') {
        return encodeCopilotPermissionRequestOutput(reduction);
    }
    const context = nonEmptyText(reduction.context);
    return context && COPILOT_CONTEXT_OUTPUT_EVENTS.has(eventName)
        ? { additionalContext: context }
        : {};
}
function encodeClaudePreToolUseOutput(envelope, reduction) {
    const hookSpecificOutput = {
        hookEventName: 'PreToolUse',
    };
    if (reduction.decision !== 'pass') {
        hookSpecificOutput.permissionDecision = reduction.decision;
        if (reduction.decision === 'deny' || reduction.decision === 'ask') {
            hookSpecificOutput.permissionDecisionReason = encodedDecisionReason(reduction, reduction.decision === 'deny'
                ? 'Hook denied this tool call.'
                : 'Hook requires confirmation for this tool call.');
        }
    }
    const mutation = canEncodeHookMutation(envelope, reduction.decision)
        ? singletonMutationInput(envelope, reduction)
        : undefined;
    if (mutation)
        hookSpecificOutput.updatedInput = mutation;
    const context = nonEmptyText(reduction.context);
    if (context)
        hookSpecificOutput.additionalContext = context;
    return Object.keys(hookSpecificOutput).length === 1
        ? {}
        : {
            continue: true,
            hookSpecificOutput,
        };
}
function encodeClaudePermissionRequestOutput(envelope, reduction) {
    if (reduction.decision !== 'allow' && reduction.decision !== 'deny') {
        return {};
    }
    const decision = {
        behavior: reduction.decision,
    };
    if (reduction.decision === 'allow') {
        const mutation = canEncodeHookMutation(envelope, reduction.decision)
            ? singletonMutationInput(envelope, reduction)
            : undefined;
        if (mutation)
            decision.updatedInput = mutation;
    }
    else {
        decision.message = encodedDecisionReason(reduction, 'Hook denied this permission request.');
    }
    return {
        continue: true,
        hookSpecificOutput: {
            hookEventName: 'PermissionRequest',
            decision,
        },
    };
}
export function encodeClaudeHookOutput(envelope, reduction) {
    const eventName = normalizeEventName(envelope.hookType);
    if (eventName === 'pretooluse') {
        return encodeClaudePreToolUseOutput(envelope, reduction);
    }
    if (eventName === 'agentstop' || eventName === 'stop' || eventName === 'subagentstop') {
        return encodeStopOutput(reduction);
    }
    if (eventName === 'permissionrequest') {
        return encodeClaudePermissionRequestOutput(envelope, reduction);
    }
    const hookEventName = CLAUDE_CONTEXT_EVENT_NAMES[eventName];
    const context = nonEmptyText(reduction.context);
    return hookEventName && context
        ? {
            continue: true,
            hookSpecificOutput: {
                hookEventName,
                additionalContext: context,
            },
        }
        : {};
}
/**
 * Encode a canonical reduction without executing effects or invoking host wrappers.
 */
export function encodeHookOutput(envelope, reduction) {
    return envelope.host === 'copilot'
        ? encodeCopilotHookOutput(envelope, reduction)
        : encodeClaudeHookOutput(envelope, reduction);
}
//# sourceMappingURL=hook-output.js.map