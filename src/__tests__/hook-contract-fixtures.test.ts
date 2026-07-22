import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const FIXTURE_ROOT = join(process.cwd(), 'src', '__tests__', 'fixtures', 'hooks');
const CLAUDE_FIXTURE_ROOT = join(FIXTURE_ROOT, 'claude');
const COPILOT_FIXTURE_ROOT = join(FIXTURE_ROOT, 'copilot-1.0.72-1');
const COPILOT_PROVENANCE_PATH = join(COPILOT_FIXTURE_ROOT, '_provenance.json');

const HOOK_CONTRACTS = [
  { claude: 'SessionStart', copilot: 'sessionStart' },
  { claude: 'UserPromptSubmit', copilot: 'userPromptSubmitted' },
  { claude: 'PreToolUse', copilot: 'preToolUse' },
  { claude: 'PermissionRequest', copilot: 'permissionRequest' },
  { claude: 'PostToolUse', copilot: 'postToolUse' },
  { claude: 'PostToolUseFailure', copilot: 'postToolUseFailure' },
  { claude: 'SubagentStart', copilot: 'subagentStart' },
  { claude: 'SubagentStop', copilot: 'subagentStop' },
  { claude: 'Stop', copilot: 'agentStop' },
  { claude: 'PreCompact', copilot: 'preCompact' },
  { claude: 'SessionEnd', copilot: 'sessionEnd' },
] as const;

/**
 * Non-hook Copilot fixtures: these capture a stdin contract for a Copilot CLI
 * command other than a hook event (e.g. the `statusLine` command), so they
 * have no Claude-side counterpart and are excluded from `HOOK_CONTRACTS`.
 */
const NON_HOOK_COPILOT_FIXTURES = ['statusLine'] as const;

type JsonObject = Record<string, unknown>;
type FixtureStatus = 'observed' | 'provisional';

interface FixtureProvenance {
  status: FixtureStatus;
  source: string;
  copilotVersion: string;
  recordSha256?: string;
  recordLine?: number;
  sourceSessionStartSha256?: string;
}

interface CopilotProvenance {
  fixtures: Record<string, FixtureProvenance>;
  statusLine: {
    status: 'observed';
    source: string;
    copilotVersion: string;
    recordSha256: string;
    recordLine: number;
    recordByteLength: number;
    fixture: 'statusLine.json';
  };
}

interface StringField {
  key: string;
  path: string;
  value: string;
}

const EXACT_PLACEHOLDERS_BY_KEY: Readonly<Record<string, readonly string[]>> = {
  session_id: ['<session-id>'],
  sessionId: ['<session-id>'],
  prompt_id: ['<prompt-id>'],
  prompt: ['<prompt>'],
  initialPrompt: ['<initial-prompt>'],
  transcript_path: ['<transcript-path>'],
  transcriptPath: ['<transcript-path>'],
  cwd: ['<cwd>'],
  tool_use_id: ['<tool-use-id>'],
  agent_id: ['<agent-id>'],
  agent_type: ['<agent-type>'],
  agent_transcript_path: ['<agent-transcript-path>'],
  last_assistant_message: ['<assistant-message>'],
  model: ['<model>'],
  error: ['<tool-error>'],
  textResultForLlm: ['<tool-output>'],
  sessionLog: ['<session-log>'],
  agentName: ['<agent-name>'],
  agentDisplayName: ['<agent-display-name>'],
  agentDescription: ['<agent-description>'],
  custom_instructions: ['<custom-instructions>'],
  customInstructions: ['<custom-instructions>'],
  command: ['<command>'],
  content: ['<file-content>'],
  file_path: ['<path>'],
  filePath: ['<path>'],
  path: ['<path>', '<path-1>', '<path-2>', '<path-3>', '<path-4>'],
  paths: ['<path>', '<path-1>', '<path-2>', '<path-3>', '<path-4>'],
  id: ['<tool-call-id-1>', '<tool-call-id-2>'],
  pattern: ['<glob-pattern>', '<search-pattern>'],
  glob: ['<glob-pattern>'],
};

/**
 * Per-path placeholder overrides for fields whose exact JSON path narrows
 * which placeholder is legitimate, independent of the shared by-key
 * allowlist above. `$.model.id` is intentionally excluded from the global
 * `id` allowlist so a bare tool-call `id` field can never silently pass
 * validation using the `<model-id>` placeholder.
 */
const EXACT_PLACEHOLDERS_BY_PATH: Readonly<Record<string, readonly string[]>> = {
  '$.model.id': ['<model-id>'],
};

const SENSITIVE_KEY_PATTERN =
  /prompt|instruction|transcript|cwd|path|command|content|message|description|model|error|resultForLlm|sessionLog|(?:session|toolUse|agent)Id$|(?:session|tool_use|agent)_id$|^id$|^agent_|^agent[A-Z]|pattern|^glob$/i;
const CREDENTIAL_KEY_PATTERN =
  /token|secret|password|credential|api[_-]?key|authorization|cookie/i;
const UUID_PATTERN =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const RAW_CREDENTIAL_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\b(?:gh[pousr]_|github_pat_|sk-|xox[baprs]-|npm_)[A-Za-z0-9_-]{10,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{10,}/i,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  /(?:token|secret|password|credential|api[_-]?key)\s*[:=]\s*(?!<)[^\s,}"']{8,}/i,
];

function loadFixture(root: string, eventName: string): JsonObject {
  return JSON.parse(readFileSync(join(root, `${eventName}.json`), 'utf8')) as JsonObject;
}

function loadCopilotProvenance(): CopilotProvenance {
  return JSON.parse(readFileSync(COPILOT_PROVENANCE_PATH, 'utf8')) as CopilotProvenance;
}

function collectKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(collectKeys);
  if (!value || typeof value !== 'object') return [];

  return Object.entries(value).flatMap(([key, child]) => [key, ...collectKeys(child)]);
}

function parseSerializedJson(value: string): unknown | undefined {
  const trimmed = value.trim();
  if (
    !(
      (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))
    )
  ) {
    return undefined;
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return undefined;
  }
}

function collectStringFields(
  value: unknown,
  path = '$',
  key = '',
): StringField[] {
  if (typeof value === 'string') {
    const fields = [{ key, path, value }];
    const parsed = parseSerializedJson(value);
    return parsed === undefined
      ? fields
      : [...fields, ...collectStringFields(parsed, `${path}<json>`, key)];
  }
  if (Array.isArray(value)) {
    return value.flatMap((child, index) => collectStringFields(child, `${path}[${index}]`, key));
  }
  if (!value || typeof value !== 'object') return [];

  return Object.entries(value).flatMap(([childKey, child]) =>
    collectStringFields(child, `${path}.${childKey}`, childKey),
  );
}

describe('versioned hook contract fixtures', () => {
  it('covers every shipped hook event for Claude and Copilot CLI 1.0.72-1', () => {
    const claudeFiles = readdirSync(CLAUDE_FIXTURE_ROOT)
      .filter((file) => file.endsWith('.json'))
      .sort();
    const copilotFiles = readdirSync(COPILOT_FIXTURE_ROOT)
      .filter(
        (file) =>
          file.endsWith('.json') &&
          file !== '_provenance.json' &&
          !(NON_HOOK_COPILOT_FIXTURES as readonly string[]).includes(file.replace(/\.json$/, '')),
      )
      .sort();

    expect(claudeFiles).toEqual(HOOK_CONTRACTS.map(({ claude }) => `${claude}.json`).sort());
    expect(copilotFiles).toEqual(
      HOOK_CONTRACTS.map(({ copilot }) => `${copilot}.json`).sort(),
    );
  });

  it.each(HOOK_CONTRACTS)(
    'uses Claude snake_case envelope fields for $claude',
    ({ claude }) => {
      const fixture = loadFixture(CLAUDE_FIXTURE_ROOT, claude);

      expect(fixture.hook_event_name).toBe(claude);
      expect(fixture.session_id).toBe('<session-id>');
      expect(fixture.cwd).toBe('<cwd>');
      expect(fixture).not.toHaveProperty('sessionId');
    },
  );

  it.each(HOOK_CONTRACTS)(
    'uses Copilot camelCase fields for $copilot',
    ({ copilot }) => {
      const fixture = loadFixture(COPILOT_FIXTURE_ROOT, copilot);
      const snakeCaseKeys = collectKeys(fixture).filter((key) => key.includes('_'));

      expect(fixture.sessionId).toBe('<session-id>');
      expect(fixture.cwd).toBe('<cwd>');
      expect(fixture).not.toHaveProperty('session_id');
      expect(fixture).not.toHaveProperty('hook_event_name');
      expect(snakeCaseKeys).toEqual([]);
    },
  );

  it('captures Copilot PreToolUse as a batch of serialized tool calls', () => {
    const fixture = loadFixture(COPILOT_FIXTURE_ROOT, 'preToolUse');
    const toolCalls = fixture.toolCalls as Array<Record<string, unknown>>;

    expect(toolCalls).toHaveLength(2);
    expect(toolCalls.map(({ id, name }) => ({ id, name }))).toEqual([
      { id: '<tool-call-id-1>', name: 'glob' },
      { id: '<tool-call-id-2>', name: 'rg' },
    ]);
    expect(toolCalls.every(({ args }) => typeof args === 'string')).toBe(true);
    expect(toolCalls.map(({ args }) => JSON.parse(args as string))).toEqual([
      { pattern: '<glob-pattern>', paths: '<path-1>' },
      {
        pattern: '<search-pattern>',
        paths: ['<path-2>', '<path-3>', '<path-4>'],
        output_mode: 'content',
        glob: '<glob-pattern>',
        '-n': true,
        head_limit: 20,
      },
    ]);
    expect(fixture).not.toHaveProperty('tool_name');
    expect(fixture).not.toHaveProperty('toolName');
  });

  it('captures the firing Copilot subagentStart payload', () => {
    expect(loadFixture(COPILOT_FIXTURE_ROOT, 'subagentStart')).toMatchObject({
      sessionId: '<session-id>',
      transcriptPath: '<transcript-path>',
      agentName: '<agent-name>',
      agentDisplayName: '<agent-display-name>',
      agentDescription: '<agent-description>',
    });
  });

  it.each(HOOK_CONTRACTS)(
    'records observed or provisional provenance for $copilot',
    ({ copilot }) => {
      const provenance = loadCopilotProvenance().fixtures[copilot];

      expect(['observed', 'provisional']).toContain(provenance.status);
      expect(provenance.copilotVersion).toBe('1.0.72-1');

      if (provenance.status === 'observed') {
        expect(provenance.recordSha256).toMatch(/^[0-9a-f]{64}$/);
        expect(provenance.recordLine).toBeGreaterThan(0);
      } else {
        expect(provenance.source).toBe('documented-schema');
        expect(provenance.recordSha256).toBeUndefined();
      }
    },
  );

  it('uses observed Copilot 1.0.72-1 records for terminal lifecycle fixtures', () => {
    const provenance = loadCopilotProvenance();

    expect(provenance.fixtures.preCompact).toMatchObject({
      status: 'observed',
      source: 'local-session-events',
      copilotVersion: '1.0.72-1',
      recordSha256: '1c481e04a298e1f02328de42bd19f1658ae5018db289a8f7d66cb232419bb172',
      sourceSessionStartSha256:
        '4eaf1710521fbd56199182e6a05e1a3037929c49dac6f6ad393ca248c6f6b2cf',
    });
    expect(loadFixture(COPILOT_FIXTURE_ROOT, 'preCompact').trigger).toBe('auto');

    expect(provenance.fixtures.sessionEnd).toMatchObject({
      status: 'observed',
      source: 'local-session-events',
      copilotVersion: '1.0.72-1',
      recordSha256: '1ad0f1ef39c2a7af011f12a489110e5b4939fda8c7d745ca6562453feae049c8',
      sourceSessionStartSha256:
        '1ea5a3f7c1363fae5564d4079140c0287914e645d5cc5ee7a0fc5d535cabd647',
    });
    expect(loadFixture(COPILOT_FIXTURE_ROOT, 'sessionEnd').reason).toBe('complete');
  });

  it.each([
    ...HOOK_CONTRACTS.map(({ claude }) => ({
      host: 'claude',
      root: CLAUDE_FIXTURE_ROOT,
      eventName: claude,
    })),
    ...HOOK_CONTRACTS.map(({ copilot }) => ({
      host: 'copilot-1.0.72-1',
      root: COPILOT_FIXTURE_ROOT,
      eventName: copilot,
    })),
    ...NON_HOOK_COPILOT_FIXTURES.map((eventName) => ({
      host: 'copilot-1.0.72-1',
      root: COPILOT_FIXTURE_ROOT,
      eventName,
    })),
  ])(
    'uses exact placeholders for sensitive fields in $host/$eventName',
    ({ root, eventName }) => {
      const fields = collectStringFields(loadFixture(root, eventName));

      for (const field of fields) {
        if (CREDENTIAL_KEY_PATTERN.test(field.key)) {
          expect(field.value, `${field.path} must redact credential data`).toBe(
            '<redacted-credential>',
          );
          continue;
        }
        if (!SENSITIVE_KEY_PATTERN.test(field.key)) continue;

        const allowed = EXACT_PLACEHOLDERS_BY_PATH[field.path] ?? EXACT_PLACEHOLDERS_BY_KEY[field.key];
        expect(allowed, `${field.path} lacks an explicit placeholder policy`).toBeDefined();
        expect(allowed, `${field.path} must use an exact deterministic placeholder`).toContain(
          field.value,
        );
      }
    },
  );

  it.each([
    ...HOOK_CONTRACTS.map(({ claude }) => ({
      host: 'claude',
      root: CLAUDE_FIXTURE_ROOT,
      eventName: claude,
    })),
    ...HOOK_CONTRACTS.map(({ copilot }) => ({
      host: 'copilot-1.0.72-1',
      root: COPILOT_FIXTURE_ROOT,
      eventName: copilot,
    })),
    ...NON_HOOK_COPILOT_FIXTURES.map((eventName) => ({
      host: 'copilot-1.0.72-1',
      root: COPILOT_FIXTURE_ROOT,
      eventName,
    })),
  ])(
    'rejects raw paths, IDs, prompts, and credential material in $host/$eventName',
    ({ root, eventName }) => {
      const fields = collectStringFields(loadFixture(root, eventName));

      for (const { path, value } of fields) {
        expect(value, `${path} contains a drive-absolute path`).not.toMatch(/^[A-Za-z]:[\\/]/);
        expect(value, `${path} contains a UNC path`).not.toMatch(/^\\\\/);
        expect(value, `${path} contains an absolute POSIX path`).not.toMatch(/^\//);
        expect(value, `${path} contains a home-relative path`).not.toMatch(/^~[\\/]/);
        expect(value, `${path} contains a file URL`).not.toMatch(/^file:\/\//i);
        expect(value, `${path} contains a raw UUID`).not.toMatch(UUID_PATTERN);
        expect(value, `${path} contains raw user email data`).not.toMatch(EMAIL_PATTERN);
        for (const pattern of RAW_CREDENTIAL_PATTERNS) {
          expect(value, `${path} contains token or credential material`).not.toMatch(pattern);
        }
      }
    },
  );

  it('recursively sanitizes serialized JSON tool arguments', () => {
    const fields = collectStringFields(loadFixture(COPILOT_FIXTURE_ROOT, 'preToolUse'));

    expect(fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: '$.toolCalls[0].args<json>.paths',
          value: '<path-1>',
        }),
        expect.objectContaining({
          path: '$.toolCalls[1].args<json>.paths[2]',
          value: '<path-4>',
        }),
      ]),
    );
  });

  it('captures the observed Copilot 1.0.72-1 statusLine payload from an isolated capture', () => {
    const readme = readFileSync(join(COPILOT_FIXTURE_ROOT, 'README.md'), 'utf8');
    const provenance = loadCopilotProvenance();

    expect(existsSync(join(COPILOT_FIXTURE_ROOT, 'statusLine.json'))).toBe(true);
    expect(loadFixture(COPILOT_FIXTURE_ROOT, 'statusLine')).toEqual({
      cwd: '<cwd>',
      session_id: '<session-id>',
      session_name: null,
      transcript_path: '<transcript-path>',
      model: { id: '<model-id>', display_name: '<model-name>' },
      workspace: { current_dir: '<cwd>' },
      username: null,
      remote: { connected: false },
      version: '1.0.72-1',
      cost: {
        total_api_duration_ms: 0,
        total_lines_added: 0,
        total_lines_removed: 0,
        total_duration_ms: 1686,
        total_premium_requests: 0,
      },
      context_window: {
        total_input_tokens: 0,
        total_output_tokens: 0,
        total_cache_read_tokens: 0,
        total_cache_write_tokens: 0,
        total_reasoning_tokens: 0,
        total_tokens: 0,
        context_window_size: 1000000,
        used_percentage: 0,
        remaining_percentage: 100,
        remaining_tokens: 1000000,
        last_call_input_tokens: 0,
        last_call_output_tokens: 0,
        current_context_tokens: 0,
        displayed_context_limit: 264000,
        current_context_used_percentage: 0,
      },
      ai_used: { total_nano_aiu: 0, formatted: '0' },
      allow_all_enabled: false,
    });

    expect(provenance.statusLine).toEqual({
      status: 'observed',
      source: 'isolated-status-line-command',
      copilotVersion: '1.0.72-1',
      recordSha256: '26d19faef4768a7c3800cef8e6eb0007123a696ab76fe461150ac0c9ff21fce5',
      recordLine: 3,
      recordByteLength: 1231,
      fixture: 'statusLine.json',
    });

    expect(readme).toContain('statusLine.json');
    expect(readme).toContain('isolated-status-line-command');
    expect(readme).not.toContain('Phase 5 prerequisite');
  });
});
