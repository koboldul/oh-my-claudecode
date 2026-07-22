import { readFileSync } from 'node:fs';
import { join, normalize, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const COPILOT_PLUGIN_MANIFEST_PATH = join(ROOT, 'plugin.json');
const CLAUDE_PLUGIN_MANIFEST_PATH = join(
  ROOT,
  '.claude-plugin',
  'plugin.json',
);
const COPILOT_FIXTURE_ROOT = join(
  ROOT,
  'src',
  '__tests__',
  'fixtures',
  'hooks',
  'copilot-1.0.72-1',
);

const EVENT_PROJECTION = [
  ['UserPromptSubmit', 'userPromptSubmitted'],
  ['SessionStart', 'sessionStart'],
  ['PreToolUse', 'preToolUse'],
  ['PermissionRequest', 'permissionRequest'],
  ['PostToolUse', 'postToolUse'],
  ['PostToolUseFailure', 'postToolUseFailure'],
  ['SubagentStart', 'subagentStart'],
  ['SubagentStop', 'subagentStop'],
  ['PreCompact', 'preCompact'],
  ['Stop', 'agentStop'],
  ['SessionEnd', 'sessionEnd'],
] as const;

type ClaudeEvent = (typeof EVENT_PROJECTION)[number][0];
type CopilotEvent = (typeof EVENT_PROJECTION)[number][1];

const FIXTURE_BY_EVENT: Readonly<Record<CopilotEvent, string>> = {
  userPromptSubmitted: 'userPromptSubmitted.json',
  sessionStart: 'sessionStart.json',
  preToolUse: 'preToolUse.json',
  permissionRequest: 'permissionRequest.json',
  postToolUse: 'postToolUse.json',
  postToolUseFailure: 'postToolUseFailure.json',
  subagentStart: 'subagentStart.json',
  subagentStop: 'subagentStop.json',
  preCompact: 'preCompact.json',
  agentStop: 'agentStop.json',
  sessionEnd: 'sessionEnd.json',
};

const EXPECTED_SCRIPTS_BY_EVENT: Readonly<
  Record<CopilotEvent, readonly string[]>
> = {
  userPromptSubmitted: [
    'keyword-detector.mjs',
    'skill-injector.mjs',
  ],
  sessionStart: [
    'session-start.mjs',
    'project-memory-session.mjs',
    'wiki-session-start.mjs',
  ],
  preToolUse: ['pre-tool-enforcer.mjs'],
  permissionRequest: ['permission-handler.mjs'],
  postToolUse: [
    'post-tool-verifier.mjs',
    'project-memory-posttool.mjs',
    'post-tool-rules-injector.mjs',
  ],
  postToolUseFailure: ['post-tool-use-failure.mjs'],
  subagentStart: ['subagent-tracker.mjs'],
  subagentStop: [
    'subagent-tracker.mjs',
    'verify-deliverables.mjs',
  ],
  preCompact: [
    'pre-compact.mjs',
    'project-memory-precompact.mjs',
    'wiki-pre-compact.mjs',
  ],
  agentStop: [
    'context-guard-stop.mjs',
    'workflow-drift-guard.mjs',
    'persistent-mode.mjs',
    'code-simplifier.mjs',
  ],
  sessionEnd: [
    'session-end.mjs',
    'wiki-session-end.mjs',
  ],
};

interface PluginManifest {
  hooks?: unknown;
}

interface HookCommand {
  type?: string;
  matcher?: string;
  command?: string;
  bash?: string;
  powershell?: string;
  timeout?: number;
  async?: boolean;
}

interface ClaudeHookMatcherGroup {
  matcher?: string;
  hooks?: HookCommand[];
}

interface ClaudeHookManifest {
  description?: string;
  hooks: Record<ClaudeEvent, ClaudeHookMatcherGroup[]>;
}

interface CopilotHookManifest {
  version: number;
  hooks: Record<CopilotEvent, HookCommand[]>;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function resolveDeclaredHookManifest<T>(
  pluginManifestPath: string,
): {
  declaration: string;
  path: string;
  manifest: T;
} {
  const pluginManifest = readJson<PluginManifest>(pluginManifestPath);
  if (typeof pluginManifest.hooks !== 'string') {
    throw new TypeError(
      `${relative(ROOT, pluginManifestPath)} must declare exactly one hooks manifest path`,
    );
  }

  const declaration = pluginManifest.hooks.replace(/\\/g, '/');
  const path = normalize(join(ROOT, declaration));
  return {
    declaration,
    path,
    manifest: readJson<T>(path),
  };
}

function projectClaudeManifestToNativeCopilot(
  manifest: ClaudeHookManifest,
): CopilotHookManifest {
  const hooks = {} as Record<CopilotEvent, HookCommand[]>;

  for (const [claudeEvent, copilotEvent] of EVENT_PROJECTION) {
    const groups = manifest.hooks[claudeEvent] ?? [];
    hooks[copilotEvent] = groups
      .filter(
        (group) =>
          claudeEvent !== 'SessionStart'
          || (group.matcher !== 'init' && group.matcher !== 'maintenance'),
      )
      .flatMap((group) =>
        (group.hooks ?? []).map((hook) => {
          const { async: _async, matcher: _matcher, ...nativeHook } = hook;
          return copilotEvent === 'permissionRequest'
            ? { ...nativeHook, matcher: 'bash|powershell' }
            : nativeHook;
        }),
      );
  }

  return { version: 1, hooks };
}

function matcherValue(
  event: CopilotEvent,
  fixture: Record<string, unknown>,
): string | undefined {
  switch (event) {
    case 'permissionRequest':
    case 'postToolUse':
      return typeof fixture.toolName === 'string'
        ? fixture.toolName
        : undefined;
    case 'preToolUse':
      return typeof fixture.toolName === 'string'
        ? fixture.toolName
        : undefined;
    case 'preCompact':
      return typeof fixture.trigger === 'string'
        ? fixture.trigger
        : undefined;
    case 'subagentStart':
      return typeof fixture.agentName === 'string'
        ? fixture.agentName
        : undefined;
    default:
      return undefined;
  }
}

function routeFixture(
  event: CopilotEvent,
  entries: HookCommand[],
  fixture: Record<string, unknown>,
): HookCommand[] {
  const value = matcherValue(event, fixture);
  return entries.filter((entry) => {
    if (entry.matcher === undefined) return true;
    if (value === undefined) return false;
    return new RegExp(`^(?:${entry.matcher})$`).test(value);
  });
}

function scriptName(command: string | undefined): string | undefined {
  return command?.match(/\/scripts\/([A-Za-z0-9._-]+)(?:["\s]|$)/g)
    ?.at(-1)
    ?.match(/\/scripts\/([A-Za-z0-9._-]+)/)?.[1];
}

describe('GitHub Copilot CLI native hook manifest routing', () => {
  it('routes each host through one explicit, distinct hooks manifest', () => {
    const copilot = resolveDeclaredHookManifest<CopilotHookManifest>(
      COPILOT_PLUGIN_MANIFEST_PATH,
    );
    const claude = resolveDeclaredHookManifest<ClaudeHookManifest>(
      CLAUDE_PLUGIN_MANIFEST_PATH,
    );

    expect(copilot.declaration).toBe('./hooks/copilot-hooks.json');
    expect(claude.declaration).toBe('./hooks/hooks.json');
    expect(copilot.path).not.toBe(claude.path);
  });

  it('is the exact native projection of Claude common hooks', () => {
    const copilot = resolveDeclaredHookManifest<CopilotHookManifest>(
      COPILOT_PLUGIN_MANIFEST_PATH,
    ).manifest;
    const claude = resolveDeclaredHookManifest<ClaudeHookManifest>(
      CLAUDE_PLUGIN_MANIFEST_PATH,
    ).manifest;

    expect(copilot).toEqual(projectClaudeManifestToNativeCopilot(claude));
  });

  it('registers every native event exactly once without compatibility aliases', () => {
    const { path, manifest } =
      resolveDeclaredHookManifest<CopilotHookManifest>(
        COPILOT_PLUGIN_MANIFEST_PATH,
      );
    const source = readFileSync(path, 'utf8');
    const nativeEvents = EVENT_PROJECTION.map(([, event]) => event);
    const claudeEvents = EVENT_PROJECTION.map(([event]) => event);

    expect(manifest.version).toBe(1);
    expect(Object.keys(manifest.hooks)).toEqual(nativeEvents);
    for (const event of nativeEvents) {
      expect(
        source.match(new RegExp(`"${event}"\\s*:`, 'g')),
        event,
      ).toHaveLength(1);
    }
    for (const event of claudeEvents) {
      expect(Object.keys(manifest.hooks), event).not.toContain(event);
    }
  });

  it('uses native matcher semantics without wildcard or Claude tool aliases', () => {
    const manifest = resolveDeclaredHookManifest<CopilotHookManifest>(
      COPILOT_PLUGIN_MANIFEST_PATH,
    ).manifest;
    const permissionEntries = manifest.hooks.permissionRequest;
    const permissionFixture = readJson<Record<string, unknown>>(
      join(COPILOT_FIXTURE_ROOT, FIXTURE_BY_EVENT.permissionRequest),
    );

    expect(manifest.hooks.preToolUse).toHaveLength(1);
    expect(manifest.hooks.preToolUse[0].matcher).toBeUndefined();
    expect(permissionEntries).toHaveLength(1);
    expect(permissionEntries[0].matcher).toBe('bash|powershell');
    expect(routeFixture(
      'permissionRequest',
      permissionEntries,
      permissionFixture,
    )).toHaveLength(1);
    expect(new RegExp(`^(?:${permissionEntries[0].matcher})$`).test('bash'))
      .toBe(true);
    expect(new RegExp(`^(?:${permissionEntries[0].matcher})$`).test('Bash'))
      .toBe(false);
    expect(new RegExp(`^(?:${permissionEntries[0].matcher})$`).test('read'))
      .toBe(false);

    for (const entries of Object.values(manifest.hooks)) {
      for (const entry of entries) {
        expect(entry.matcher).not.toBe('*');
        expect(entry).not.toHaveProperty('hooks');
        expect(entry).not.toHaveProperty('async');
      }
    }
  });

  it.each(EVENT_PROJECTION.map(([, event]) => event))(
    'routes the observed %s fixture to its shipped wrappers',
    (event) => {
      const manifest = resolveDeclaredHookManifest<CopilotHookManifest>(
        COPILOT_PLUGIN_MANIFEST_PATH,
      ).manifest;
      const fixture = readJson<Record<string, unknown>>(
        join(COPILOT_FIXTURE_ROOT, FIXTURE_BY_EVENT[event]),
      );
      const routed = routeFixture(event, manifest.hooks[event], fixture);

      expect(routed.map((entry) => scriptName(entry.command))).toEqual(
        EXPECTED_SCRIPTS_BY_EVENT[event],
      );
      for (const entry of routed) {
        expect(entry.command).toContain('/scripts/run.cjs');
        expect(entry.bash).toContain('/scripts/run.cjs');
        expect(entry.powershell).toContain('/scripts/run.cjs');
      }
    },
  );

  it('does not register Claude setup wrappers for Copilot sessionStart source new', () => {
    const manifest = resolveDeclaredHookManifest<CopilotHookManifest>(
      COPILOT_PLUGIN_MANIFEST_PATH,
    ).manifest;
    const fixture = readJson<Record<string, unknown>>(
      join(COPILOT_FIXTURE_ROOT, FIXTURE_BY_EVENT.sessionStart),
    );
    const commands = routeFixture(
      'sessionStart',
      manifest.hooks.sessionStart,
      fixture,
    ).map((entry) => entry.command ?? '');

    expect(fixture.source).toBe('new');
    expect(commands.join('\n')).not.toContain('setup-init.mjs');
    expect(commands.join('\n')).not.toContain('setup-maintenance.mjs');
  });
});
