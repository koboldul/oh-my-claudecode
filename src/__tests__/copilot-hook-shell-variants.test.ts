import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

/**
 * GitHub Copilot CLI Windows/PowerShell compatibility guard for hook commands.
 *
 * OMC ships Claude Code style `command` strings of the form:
 *   node "$CLAUDE_PLUGIN_ROOT"/scripts/run.cjs "$CLAUDE_PLUGIN_ROOT"/scripts/X.mjs
 *
 * That form is correct under Claude Code (bash expands `$CLAUDE_PLUGIN_ROOT` at
 * runtime and concatenates the quoted segment with `/scripts/...`). But GitHub
 * Copilot CLI runs a hook's shell command differently:
 *   - it substitutes only the BRACED `${CLAUDE_PLUGIN_ROOT}` / `${PLUGIN_ROOT}`
 *     placeholders with the absolute plugin root at load time (its `aD` pass),
 *   - and on Windows it executes the command under **PowerShell**, where a bare
 *     `$CLAUDE_PLUGIN_ROOT` is an (unset) PowerShell variable and the
 *     `"…"/scripts/run.cjs` quoting splits the path into two arguments.
 *
 * Result: the bare `command` form fails with `Cannot find module` / exit 1, and
 * Copilot fail-closes ("Denied by preToolUse hook … (hook errored)").
 *
 * Fix: every hook entry also carries `bash` and `powershell` variants (the shape
 * Copilot's executor selects from — Windows → `powershell`, else `bash`). Both
 * use the BRACED, fully-quoted form so Copilot's `aD` substitution yields a
 * single absolute quoted path that works under PowerShell and bash alike:
 *   node "${CLAUDE_PLUGIN_ROOT}/scripts/run.cjs" "${CLAUDE_PLUGIN_ROOT}/scripts/X.mjs" [args]
 *
 * `command` is intentionally left in the bare form for Claude Code; this test
 * locks the Copilot-safe variants so a future manifest edit cannot silently
 * reintroduce the fail-closed regression on Windows.
 */

interface HookEntry {
  type?: string;
  command?: string;
  bash?: string;
  powershell?: string;
}

interface HooksConfig {
  hooks?: Record<string, Array<{ hooks?: HookEntry[] }>>;
}

const hooksJsonPath = join(__dirname, '..', '..', 'hooks', 'hooks.json');

function loadCommandHooks(): Array<{ event: string; entry: HookEntry }> {
  const raw = JSON.parse(readFileSync(hooksJsonPath, 'utf-8')) as HooksConfig;
  return Object.entries(raw.hooks ?? {}).flatMap(([event, groups]) =>
    (groups ?? []).flatMap(group =>
      (group.hooks ?? [])
        .filter(entry => entry.type === 'command' && typeof entry.command === 'string')
        .map(entry => ({ event, entry })),
    ),
  );
}

// Braced, fully-quoted run.cjs + script, with optional trailing args left OUTSIDE
// the quotes (e.g. `subagent-tracker.mjs" start`).
const PORTABLE_RE =
  /^node "\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/run\.cjs" "\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/[^"\s]+"(?: \S.*)?$/;

// The quote-split form that breaks under PowerShell: `"…"/scripts/…`.
const QUOTE_SPLIT_RE = /"\/scripts\//;

describe('GitHub Copilot CLI hook shell variants', () => {
  it('has at least one command hook to guard', () => {
    expect(loadCommandHooks().length).toBeGreaterThan(0);
  });

  it('every command hook also declares bash and powershell variants', () => {
    const missing = loadCommandHooks()
      .filter(({ entry }) => typeof entry.bash !== 'string' || typeof entry.powershell !== 'string')
      .map(({ event, entry }) => `${event}: ${entry.command}`);

    expect(
      missing,
      `hook entries missing bash/powershell variants (Copilot CLI runs from these; ` +
        `Windows selects powershell):\n${missing.join('\n')}`,
    ).toEqual([]);
  });

  it('bash and powershell variants use the braced, fully-quoted, PowerShell-safe form', () => {
    for (const { event, entry } of loadCommandHooks()) {
      for (const variant of ['bash', 'powershell'] as const) {
        const value = entry[variant] as string;
        expect(value, `${event} ${variant}`).toMatch(PORTABLE_RE);
        // Must not carry the quote-split path that PowerShell breaks on.
        expect(QUOTE_SPLIT_RE.test(value), `${event} ${variant} quote-split`).toBe(false);
        // Must not use a bare $CLAUDE_PLUGIN_ROOT (Copilot only substitutes braces).
        expect(value.includes('"$CLAUDE_PLUGIN_ROOT"'), `${event} ${variant} bare var`).toBe(false);
      }
    }
  });

  it('variants target the same run.cjs, script, and trailing args as command', () => {
    // All `/scripts/<name>` tokens, in order: [0] = run.cjs, [1] = the hook script.
    const scriptsOf = (cmd: string): string[] =>
      [...cmd.matchAll(/\/scripts\/([A-Za-z0-9._-]+)/g)].map(m => m[1]);
    const scriptOf = (cmd: string): string | undefined => scriptsOf(cmd)[1];
    const trailingOf = (cmd: string): string => {
      const script = scriptsOf(cmd)[1];
      if (!script) return '';
      return cmd.slice(cmd.lastIndexOf(script) + script.length).replace(/^"/, '').trim();
    };

    for (const { event, entry } of loadCommandHooks()) {
      const commandScript = scriptOf(entry.command as string);
      expect(commandScript, `${event} command script`).toBeTruthy();
      for (const variant of ['bash', 'powershell'] as const) {
        expect(scriptOf(entry[variant] as string), `${event} ${variant} script`).toBe(commandScript);
        expect(trailingOf(entry[variant] as string), `${event} ${variant} trailing args`).toBe(
          trailingOf(entry.command as string),
        );
      }
    }
  });
});
