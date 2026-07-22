/**
 * OMC HUD - Copilot statusLine adapter
 *
 * Copilot CLI's `statusLine` stdin payload is a distinct, host-specific shape
 * (see `src/__tests__/fixtures/hooks/copilot-1.0.72-1/statusLine.json`) rather
 * than Claude Code's native `StatuslineStdin` contract. This module detects
 * that shape and maps only the fields that correspond cleanly to fields the
 * rest of the HUD already consumes.
 *
 * Copilot CLI 1.0.72-1 conditionally emits `context_window.current_usage`
 * (populated once there has been model activity in the session; absent, as
 * in the observed startup fixture, before any call completes). It is mapped
 * only when present in the source payload, copying just its numeric
 * properties, and omitted entirely otherwise rather than synthesized as
 * zero. `rate_limits` is not present in the Copilot payload shape at all and
 * is likewise omitted. Metrics Copilot *does* report as zero (e.g.
 * `context_window.total_input_tokens`) are passed through unchanged.
 *
 * Copilot also reports both the model's full context limit and last-call
 * metrics (`context_window_size`, `used_percentage`, `total_input_tokens`)
 * and the "current" view of what's actually occupying the active displayed
 * context (`displayed_context_limit`, `current_context_used_percentage`,
 * `current_context_tokens`). The current view is preferred when present
 * since it reflects what the HUD displays; the model/full-limit fields are
 * used only as a fallback when the current-view field is absent from the
 * source payload — except for context occupancy tokens: `current_context_tokens`
 * is mapped to `total_input_tokens` in the normalized contract, and Copilot's
 * cumulative `total_input_tokens` is never used as a fallback because it would
 * misrepresent current active context occupancy.
 */
/**
 * Detect the Copilot CLI statusLine stdin shape using fields that Claude Code
 * never emits: a `version` build string, a `workspace.current_dir` field, and
 * the `ai_used` usage-accounting block.
 */
export function isCopilotStatuslinePayload(value) {
    if (!value || typeof value !== 'object')
        return false;
    const payload = value;
    const workspace = payload.workspace;
    const hasWorkspaceCurrentDir = !!workspace &&
        typeof workspace === 'object' &&
        typeof workspace.current_dir === 'string';
    return (typeof payload.version === 'string' &&
        hasWorkspaceCurrentDir &&
        !!payload.ai_used &&
        typeof payload.ai_used === 'object');
}
/**
 * Map a Copilot CLI statusLine payload onto the host-neutral `StatuslineStdin`
 * contract. Only fields Copilot actually reports are included; fields absent
 * from the payload are left out of the result rather than filled with
 * synthesized placeholder values.
 */
export function adaptCopilotStatusline(payload) {
    const result = {};
    if (typeof payload.cwd === 'string') {
        result.cwd = payload.cwd;
    }
    if (typeof payload.transcript_path === 'string') {
        result.transcript_path = payload.transcript_path;
    }
    const model = payload.model;
    if (model && typeof model === 'object') {
        const modelRecord = model;
        const mappedModel = {};
        if (typeof modelRecord.id === 'string')
            mappedModel.id = modelRecord.id;
        if (typeof modelRecord.display_name === 'string') {
            mappedModel.display_name = modelRecord.display_name;
        }
        if (Object.keys(mappedModel).length > 0) {
            result.model = mappedModel;
        }
    }
    const contextWindow = payload.context_window;
    if (contextWindow && typeof contextWindow === 'object') {
        const contextWindowRecord = contextWindow;
        const mappedContextWindow = {};
        // Prefer the "current" displayed context-limit field; fall back to the
        // cumulative field only when the current-view field is absent.
        if (typeof contextWindowRecord.displayed_context_limit === 'number') {
            mappedContextWindow.context_window_size = contextWindowRecord.displayed_context_limit;
        }
        else if (typeof contextWindowRecord.context_window_size === 'number') {
            mappedContextWindow.context_window_size = contextWindowRecord.context_window_size;
        }
        // `current_context_tokens` reflects current context occupancy; Copilot's
        // cumulative `total_input_tokens` is never used as a fallback here since
        // it would misrepresent current occupancy.
        if (typeof contextWindowRecord.current_context_tokens === 'number') {
            mappedContextWindow.total_input_tokens = contextWindowRecord.current_context_tokens;
        }
        // Prefer the "current" used-percentage field; fall back to the
        // cumulative field only when the current-view field is absent.
        if (typeof contextWindowRecord.current_context_used_percentage === 'number') {
            mappedContextWindow.used_percentage = contextWindowRecord.current_context_used_percentage;
        }
        else if (typeof contextWindowRecord.used_percentage === 'number') {
            mappedContextWindow.used_percentage = contextWindowRecord.used_percentage;
        }
        // `current_usage` is only present after model activity in the session;
        // map its numeric properties when present, omit entirely otherwise.
        const currentUsage = contextWindowRecord.current_usage;
        if (currentUsage && typeof currentUsage === 'object') {
            const currentUsageRecord = currentUsage;
            const mappedCurrentUsage = {};
            if (typeof currentUsageRecord.input_tokens === 'number') {
                mappedCurrentUsage.input_tokens = currentUsageRecord.input_tokens;
            }
            if (typeof currentUsageRecord.output_tokens === 'number') {
                mappedCurrentUsage.output_tokens = currentUsageRecord.output_tokens;
            }
            if (typeof currentUsageRecord.cache_creation_input_tokens === 'number') {
                mappedCurrentUsage.cache_creation_input_tokens =
                    currentUsageRecord.cache_creation_input_tokens;
            }
            if (typeof currentUsageRecord.cache_read_input_tokens === 'number') {
                mappedCurrentUsage.cache_read_input_tokens = currentUsageRecord.cache_read_input_tokens;
            }
            if (Object.keys(mappedCurrentUsage).length > 0) {
                mappedContextWindow.current_usage = mappedCurrentUsage;
            }
        }
        if (Object.keys(mappedContextWindow).length > 0) {
            result.context_window = mappedContextWindow;
        }
    }
    return result;
}
/**
 * Host-neutral normalization boundary. Copilot CLI statusLine payloads are
 * adapted onto the shared `StatuslineStdin` contract; any other payload
 * (Claude Code's native shape) is returned unchanged — same reference — so
 * existing Claude semantics are preserved exactly.
 */
export function normalizeStatuslineStdin(payload) {
    if (isCopilotStatuslinePayload(payload)) {
        return adaptCopilotStatusline(payload);
    }
    return payload;
}
//# sourceMappingURL=copilot-stdin.js.map