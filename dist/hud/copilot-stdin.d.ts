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
import type { StatuslineStdin } from './types.js';
/**
 * Detect the Copilot CLI statusLine stdin shape using fields that Claude Code
 * never emits: a `version` build string, a `workspace.current_dir` field, and
 * the `ai_used` usage-accounting block.
 */
export declare function isCopilotStatuslinePayload(value: unknown): boolean;
/**
 * Map a Copilot CLI statusLine payload onto the host-neutral `StatuslineStdin`
 * contract. Only fields Copilot actually reports are included; fields absent
 * from the payload are left out of the result rather than filled with
 * synthesized placeholder values.
 */
export declare function adaptCopilotStatusline(payload: Record<string, unknown>): StatuslineStdin;
/**
 * Host-neutral normalization boundary. Copilot CLI statusLine payloads are
 * adapted onto the shared `StatuslineStdin` contract; any other payload
 * (Claude Code's native shape) is returned unchanged — same reference — so
 * existing Claude semantics are preserved exactly.
 */
export declare function normalizeStatuslineStdin(payload: unknown): StatuslineStdin;
//# sourceMappingURL=copilot-stdin.d.ts.map