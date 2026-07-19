import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

/**
 * GitHub Copilot CLI compatibility guard for the plugin hook manifest.
 *
 * OMC ships a single Claude Code style `hooks/hooks.json`. GitHub Copilot CLI
 * loads that manifest and normalizes its PascalCase event names to native
 * camelCase deliveries. The versioned fixtures in
 * `src/__tests__/fixtures/hooks/copilot-1.0.72-1` lock the observed payload
 * shapes separately.
 */

const COPILOT_NATIVE_EVENT_BY_MANIFEST_EVENT = new Map<string, string>([
  ['SessionStart', 'sessionStart'],
  ['UserPromptSubmit', 'userPromptSubmitted'],
  ['PreToolUse', 'preToolUse'],
  ['PermissionRequest', 'permissionRequest'],
  ['PostToolUse', 'postToolUse'],
  ['PostToolUseFailure', 'postToolUseFailure'],
  ['SubagentStart', 'subagentStart'],
  ['SubagentStop', 'subagentStop'],
  ['Stop', 'agentStop'],
  ['PreCompact', 'preCompact'],
  ['SessionEnd', 'sessionEnd'],
]);

function loadHookEvents(): string[] {
  const manifestPath = join(process.cwd(), 'hooks', 'hooks.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    hooks?: Record<string, unknown>;
  };
  return Object.keys(manifest.hooks ?? {});
}

describe('GitHub Copilot CLI hook compatibility', () => {
  it('declares exactly the lifecycle events with verified Copilot deliveries', () => {
    expect(loadHookEvents().sort()).toEqual(
      [...COPILOT_NATIVE_EVENT_BY_MANIFEST_EVENT.keys()].sort(),
    );
  });

  it('keeps behavior-critical aliases wired without duplicate camelCase entries', () => {
    const events = new Set(loadHookEvents());

    expect(events.has('UserPromptSubmit')).toBe(true);
    expect(events.has('userPromptSubmitted')).toBe(false);

    expect(events.has('Stop')).toBe(true);
    expect(events.has('agentStop')).toBe(false);
  });

  it('maps SubagentStart to the firing Copilot subagentStart event', () => {
    const events = new Set(loadHookEvents());

    expect(events.has('SubagentStart')).toBe(true);
    expect(COPILOT_NATIVE_EVENT_BY_MANIFEST_EVENT.get('SubagentStart')).toBe('subagentStart');
  });
});
