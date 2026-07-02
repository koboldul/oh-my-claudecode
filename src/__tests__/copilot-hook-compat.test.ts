import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

/**
 * GitHub Copilot CLI compatibility guard for the plugin hook manifest.
 *
 * OMC ships a single Claude Code style `hooks/hooks.json`. GitHub Copilot CLI
 * loads that same manifest from an installed plugin ("Loaded N hook(s) from 1
 * plugin(s)") and understands Claude's event vocabulary: it accepts the
 * PascalCase / VS Code compatible event names as aliases for its own camelCase
 * events, delivers snake_case payloads for the PascalCase form, and honors the
 * Claude output protocol (`hookSpecificOutput.additionalContext`,
 * `decision: "block"`, `continue`, `suppressOutput`).
 *
 * Source: GitHub Copilot hooks reference
 * https://docs.github.com/en/copilot/reference/hooks-reference
 * (see the "Hook event input payloads" section, e.g. `userPromptSubmitted` /
 * `UserPromptSubmit`, `agentStop` / `Stop`, `postToolUseFailure` /
 * `PostToolUseFailure`, `preCompact` / `PreCompact`, `permissionRequest` /
 * `PermissionRequest`).
 *
 * This test locks the contract: every event key in `hooks/hooks.json` must be
 * one Copilot CLI recognizes, so a future hook addition cannot silently break
 * OMC under Copilot. The only sanctioned exception is `SubagentStart` — Copilot
 * exposes that event as camelCase-only `subagentStart` with a camelCase payload,
 * and the tracker it drives is trace-only (the real completion work runs on the
 * `SubagentStop` event, which Copilot does recognize).
 */

// Event names GitHub Copilot CLI recognizes, both its native camelCase form and
// the PascalCase / VS Code compatible aliases documented in the hooks reference.
const COPILOT_RECOGNIZED_EVENTS = new Set<string>([
  // sessionStart / SessionStart
  'sessionStart',
  'SessionStart',
  // sessionEnd / SessionEnd
  'sessionEnd',
  'SessionEnd',
  // userPromptSubmitted / UserPromptSubmit
  'userPromptSubmitted',
  'UserPromptSubmit',
  // preToolUse / PreToolUse
  'preToolUse',
  'PreToolUse',
  // postToolUse / PostToolUse
  'postToolUse',
  'PostToolUse',
  // postToolUseFailure / PostToolUseFailure
  'postToolUseFailure',
  'PostToolUseFailure',
  // agentStop / Stop
  'agentStop',
  'Stop',
  // subagentStop / SubagentStop
  'subagentStop',
  'SubagentStop',
  // subagentStart (camelCase only — no documented PascalCase alias)
  'subagentStart',
  // errorOccurred / ErrorOccurred
  'errorOccurred',
  'ErrorOccurred',
  // preCompact / PreCompact
  'preCompact',
  'PreCompact',
  // permissionRequest / PermissionRequest
  'permissionRequest',
  'PermissionRequest',
  // notification / Notification
  'notification',
  'Notification',
]);

// Claude Code event names that Copilot CLI does NOT recognize under this exact
// spelling. Each entry is a deliberate, documented limitation — keep this list
// as small as possible and update docs/REFERENCE.md when it changes.
const CLAUDE_ONLY_EVENTS = new Set<string>([
  // Copilot exposes this only as camelCase `subagentStart`; the OMC tracker it
  // drives is trace-only, so we accept it not firing under Copilot rather than
  // shipping a half-wired camelCase mirror with a mismatched payload shape.
  'SubagentStart',
]);

function loadHookEvents(): string[] {
  const manifestPath = join(process.cwd(), 'hooks', 'hooks.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    hooks?: Record<string, unknown>;
  };
  return Object.keys(manifest.hooks ?? {});
}

describe('GitHub Copilot CLI hook compatibility', () => {
  it('only uses events Copilot recognizes, or explicitly documented Claude-only events', () => {
    const events = loadHookEvents();
    expect(events.length).toBeGreaterThan(0);

    const unsupported = events.filter(
      (event) => !COPILOT_RECOGNIZED_EVENTS.has(event) && !CLAUDE_ONLY_EVENTS.has(event),
    );

    expect(
      unsupported,
      `hooks/hooks.json declares event(s) GitHub Copilot CLI does not recognize: ${unsupported.join(
        ', ',
      )}. Add a Copilot-recognized event name (see docs/REFERENCE.md#github-copilot-cli-compatibility) ` +
        `or, if intentionally Claude-only, extend CLAUDE_ONLY_EVENTS and document the limitation.`,
    ).toEqual([]);
  });

  it('keeps the two behavior-critical events wired and Copilot-recognized', () => {
    const events = new Set(loadHookEvents());

    // Keyword auto-detection ("ralph", "autopilot", ...) rides UserPromptSubmit.
    expect(events.has('UserPromptSubmit')).toBe(true);
    expect(COPILOT_RECOGNIZED_EVENTS.has('UserPromptSubmit')).toBe(true);

    // The ralph / ultrawork / autopilot persistence loop rides the Stop event,
    // which Copilot honors as an alias of `agentStop` (decision: "block").
    expect(events.has('Stop')).toBe(true);
    expect(COPILOT_RECOGNIZED_EVENTS.has('Stop')).toBe(true);
  });

  it('does not carry a stale Claude-only allowlist entry', () => {
    const events = new Set(loadHookEvents());
    const stale = [...CLAUDE_ONLY_EVENTS].filter((event) => !events.has(event));

    expect(
      stale,
      `CLAUDE_ONLY_EVENTS lists event(s) no longer present in hooks/hooks.json: ${stale.join(
        ', ',
      )}. Remove them so the allowlist reflects reality.`,
    ).toEqual([]);
  });
});
