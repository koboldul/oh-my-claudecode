const MAX_UNKNOWN_ERROR_LENGTH = 500;
function boundUnknownErrorText(text) {
    return text.length <= MAX_UNKNOWN_ERROR_LENGTH
        ? text
        : `${text.slice(0, MAX_UNKNOWN_ERROR_LENGTH - 1)}…`;
}
export function formatUnknownError(value) {
    if (typeof value === 'string')
        return boundUnknownErrorText(value);
    if (typeof value === 'symbol') {
        try {
            return boundUnknownErrorText(value.toString());
        }
        catch {
            return '<unprintable thrown value>';
        }
    }
    try {
        if (value instanceof Error) {
            try {
                if (typeof value.message === 'string' && value.message.length > 0) {
                    return boundUnknownErrorText(value.message);
                }
            }
            catch {
                // Continue through the non-throwing fallbacks below.
            }
        }
    }
    catch {
        // Hostile proxies can throw during instanceof checks.
    }
    try {
        const serialized = JSON.stringify(value);
        if (typeof serialized === 'string' && serialized.length > 0) {
            return boundUnknownErrorText(serialized);
        }
    }
    catch {
        // Cycles, BigInt, getters, and hostile proxies can reject serialization.
    }
    try {
        const text = String(value);
        if (text.length > 0)
            return boundUnknownErrorText(text);
    }
    catch {
        // Null-prototype objects can reject primitive conversion.
    }
    try {
        return boundUnknownErrorText(Object.prototype.toString.call(value));
    }
    catch {
        return '<unprintable thrown value>';
    }
}
export const CLAUDE_SINGLE_CAPABILITIES = Object.freeze({
    batchInput: false,
    correlatedDecisionOutput: true,
    correlatedMutationOutput: true,
    singletonMutationOutput: true,
});
export const COPILOT_1072_CAPABILITIES = Object.freeze({
    batchInput: true,
    correlatedDecisionOutput: false,
    correlatedMutationOutput: false,
    singletonMutationOutput: true,
});
//# sourceMappingURL=hook-protocol.js.map