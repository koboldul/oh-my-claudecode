import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { describe, expect, it, vi } from 'vitest';
import { encodeProjectPath } from '../../utils/encode-project-path.js';
import {
  canonicalToolName,
  decodeCopilotToolCall,
  detectHookContract,
  MAX_STABLE_SERIALIZATION_DEPTH,
  normalizeHookEnvelope,
  normalizeHookInput,
  stableCallFingerprint,
} from '../bridge-normalize.js';
import { COPILOT_1072_CAPABILITIES } from '../hook-protocol.js';

const FIXTURE_ROOT = join(process.cwd(), 'src', '__tests__', 'fixtures', 'hooks');

function loadFixture(host: 'claude' | 'copilot-1.0.72-1', name: string) {
  return JSON.parse(
    readFileSync(join(FIXTURE_ROOT, host, `${name}.json`), 'utf8'),
  ) as Record<string, unknown>;
}

function copilotCall(id: string, index: number) {
  return {
    id,
    name: index % 2 === 0 ? 'glob' : 'rg',
    args: JSON.stringify({
      pattern: `pattern-${index}`,
      output_mode: 'content',
      head_limit: index + 1,
    }),
  };
}

describe('canonical hook protocol normalization', () => {
  it('detects the host from the whole envelope without inspecting argument keys', () => {
    const claude = loadFixture('claude', 'PreToolUse');
    const copilot = loadFixture('copilot-1.0.72-1', 'preToolUse');

    expect(detectHookContract(claude)).toMatchObject({
      host: 'claude',
      contract: 'claude-single',
    });
    expect(detectHookContract(copilot)).toMatchObject({
      host: 'copilot',
      contract: 'copilot-1.0.72-1',
    });
    expect(detectHookContract({
      sessionId: 'copilot-session',
      toolCalls: [{
        id: 'call-1',
        name: 'rg',
        args: '{"output_mode":"content"}',
      }],
    }).host).toBe('copilot');
  });

  it('keeps Claude snake_case precedence for mixed legacy input', () => {
    const raw = {
      session_id: 'claude-session',
      sessionId: 'copilot-session',
      tool_name: 'Read',
      toolName: 'powershell',
      tool_input: { file_path: 'README.md' },
      toolInput: { command: 'Get-ChildItem' },
      cwd: '/claude',
      directory: '/copilot',
    };

    expect(detectHookContract(raw).host).toBe('claude');
    expect(normalizeHookInput(raw)).toMatchObject({
      sessionId: 'claude-session',
      toolName: 'Read',
      toolInput: { file_path: 'README.md' },
      directory: '/claude',
    });
  });

  it.each([1, 2, 20])('normalizes every unique call in a %i-call Copilot batch', (count) => {
    const envelope = normalizeHookEnvelope({
      sessionId: 'session',
      cwd: 'C:\\repo',
      toolCalls: Array.from({ length: count }, (_, index) =>
        copilotCall(`call-${index}`, index)),
    }, 'pre-tool-use');

    expect(envelope.host).toBe('copilot');
    expect(envelope.originalCallCount).toBe(count);
    expect(envelope.logicalCallCount).toBe(count);
    expect(envelope.toolCalls).toHaveLength(count);
    expect(envelope.toolCalls.map((call) => call.originalIndex)).toEqual(
      Array.from({ length: count }, (_, index) => index),
    );
    expect(envelope.toolCalls.every((call) => call.status === 'valid')).toBe(true);
  });

  it('parses serialized Copilot args without recursively camelizing them', () => {
    const envelope = normalizeHookEnvelope(
      loadFixture('copilot-1.0.72-1', 'preToolUse'),
      'pre-tool-use',
    );
    const secondInput = envelope.toolCalls[1].input as Record<string, unknown>;

    expect(secondInput).toHaveProperty('output_mode', 'content');
    expect(secondInput).toHaveProperty('head_limit', 20);
    expect(secondInput).not.toHaveProperty('outputMode');
    expect(secondInput).not.toHaveProperty('headLimit');
  });

  it('retains native tool provenance and shell dialect', () => {
    const envelope = normalizeHookEnvelope(
      loadFixture('copilot-1.0.72-1', 'permissionRequest'),
      'permission-request',
    );

    expect(envelope.toolCalls[0]).toMatchObject({
      nativeName: 'powershell',
      canonicalName: 'Bash',
      shellDialect: 'powershell',
      correlation: 'unavailable',
      status: 'valid',
    });
    expect(canonicalToolName('claude', 'proxy_Bash')).toBe('Bash');
  });

  it('uses a deterministic semantic fingerprint', () => {
    const first = stableCallFingerprint('rg', {
      pattern: 'needle',
      paths: ['src', 'tests'],
      nested: { z: 1, a: true },
    });
    const reordered = stableCallFingerprint('rg', {
      nested: { a: true, z: 1 },
      paths: ['src', 'tests'],
      pattern: 'needle',
    });

    expect(reordered).toBe(first);
    expect(stableCallFingerprint('rg', { paths: ['tests', 'src'] })).not.toBe(first);
    expect(stableCallFingerprint('glob', {
      pattern: 'needle',
      paths: ['src', 'tests'],
      nested: { z: 1, a: true },
    })).not.toBe(first);
  });

  it('represents malformed args explicitly without dropping valid siblings', () => {
    const envelope = normalizeHookEnvelope({
      sessionId: 'session',
      cwd: 'C:\\repo',
      toolCalls: [
        copilotCall('valid', 0),
        { id: 'broken', name: 'custom_write', args: '{"unterminated":' },
      ],
    }, 'pre-tool-use');

    expect(envelope.toolCalls).toHaveLength(2);
    expect(envelope.toolCalls[0].status).toBe('valid');
    expect(envelope.toolCalls[1]).toMatchObject({
      id: 'broken',
      status: 'malformed',
      malformed: true,
      rawArgs: '{"unterminated":',
    });
    expect(envelope.toolCalls[1].issues).toEqual([
      expect.objectContaining({ code: 'malformed-tool-args', scope: 'call' }),
    ]);
  });

  it('represents a missing batch call ID explicitly', () => {
    const call = decodeCopilotToolCall({
      name: 'glob',
      args: '{"pattern":"**/*.ts"}',
    }, 3);

    expect(call).toMatchObject({
      id: '__missing_tool_call_id_3',
      idSource: 'synthetic',
      correlation: 'unavailable',
      originalIndex: 3,
      status: 'malformed',
    });
    expect(call.issues).toEqual([
      expect.objectContaining({ code: 'missing-tool-call-id' }),
    ]);
  });

  it('deduplicates semantically identical duplicate IDs', () => {
    const envelope = normalizeHookEnvelope({
      sessionId: 'session',
      toolCalls: [
        { id: 'same', name: 'rg', args: '{"pattern":"x","paths":["src"]}' },
        { id: 'same', name: 'rg', args: '{"paths":["src"],"pattern":"x"}' },
      ],
    }, 'pre-tool-use');

    expect(envelope.toolCalls).toHaveLength(1);
    expect(envelope.originalCallCount).toBe(2);
    expect(envelope.logicalCallCount).toBe(1);
    expect(envelope.toolCalls[0].duplicateIndices).toEqual([1]);
    expect(envelope.issues).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'conflicting-duplicate-id' }),
      ]),
    );
  });

  it.each([
    {
      name: 'valid-first/malformed-duplicate',
      calls: [
        { id: 'same', name: 'rg', args: '{"pattern":"x"}' },
        { id: 'same', name: 'rg', args: { pattern: 'x' } },
      ],
    },
    {
      name: 'malformed-first/valid-duplicate',
      calls: [
        { id: 'same', name: 'rg', args: { pattern: 'x' } },
        { id: 'same', name: 'rg', args: '{"pattern":"x"}' },
      ],
    },
  ])('propagates duplicate invalidity for $name', ({ calls }) => {
    const envelope = normalizeHookEnvelope({
      sessionId: 'session',
      toolCalls: calls,
    }, 'pre-tool-use');

    expect(envelope).toMatchObject({
      originalCallCount: 2,
      logicalCallCount: 1,
    });
    expect(envelope.toolCalls).toHaveLength(1);
    expect(envelope.toolCalls[0]).toMatchObject({
      id: 'same',
      duplicateIndices: [1],
      status: 'malformed',
      malformed: true,
    });
    expect(envelope.toolCalls[0].issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'malformed-tool-args' }),
      ]),
    );
  });

  it('turns conflicting duplicate IDs into a batch safety issue', () => {
    const envelope = normalizeHookEnvelope({
      sessionId: 'session',
      toolCalls: [
        { id: 'same', name: 'rg', args: '{"pattern":"first"}' },
        { id: 'same', name: 'rg', args: '{"pattern":"second"}' },
      ],
    }, 'pre-tool-use');

    expect(envelope.toolCalls).toHaveLength(1);
    expect(envelope.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'conflicting-duplicate-id',
          severity: 'safety',
          scope: 'batch',
          batchSafety: true,
        }),
      ]),
    );
  });

  it('converts excessive fingerprint depth into a safety issue without overflowing', () => {
    let nested: unknown = 'leaf';
    for (let depth = 0; depth < MAX_STABLE_SERIALIZATION_DEPTH + 20; depth += 1) {
      nested = { child: nested };
    }

    const envelope = normalizeHookEnvelope({
      sessionId: 'session',
      toolCalls: [{
        id: 'deep',
        name: 'rg',
        args: JSON.stringify({ nested }),
      }],
    }, 'pre-tool-use');

    expect(envelope.toolCalls[0]).toMatchObject({
      id: 'deep',
      status: 'malformed',
      malformed: true,
    });
    expect(envelope.toolCalls[0].fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(envelope.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'tool-call-serialization-failed',
          severity: 'safety',
          scope: 'call',
        }),
      ]),
    );
  });

  it('marks only proven Copilot singleton mutation support as available', () => {
    const envelope = normalizeHookEnvelope({
      sessionId: 'session',
      toolCalls: [copilotCall('call-1', 0)],
    }, 'pre-tool-use');

    expect(envelope.capabilities).toEqual(COPILOT_1072_CAPABILITIES);
    expect(envelope.capabilities).toMatchObject({
      batchInput: true,
      correlatedDecisionOutput: false,
      correlatedMutationOutput: false,
      singletonMutationOutput: true,
    });
  });

  it('normalizes Copilot lifecycle agent fields without inventing an ID', () => {
    const envelope = normalizeHookEnvelope(
      loadFixture('copilot-1.0.72-1', 'subagentStart'),
      'subagent-start',
    );

    expect(envelope).toMatchObject({
      sessionId: '<session-id>',
      directory: '<cwd>',
      transcriptPath: '<transcript-path>',
      agent: {
        name: '<agent-name>',
        displayName: '<agent-display-name>',
        description: '<agent-description>',
        correlation: 'unavailable',
      },
    });
    expect(envelope.agent).not.toHaveProperty('id');
  });

  it('repairs a worktree-mismatched transcript path using the canonical directory', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'omc-canonical-transcript-'));
    const originalClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR;

    try {
      const claudeConfigDir = join(tempDir, 'claude');
      const mainProjectDir = join(tempDir, 'project');
      const worktreeDir = join(mainProjectDir, '.claude', 'worktrees', 'feature');
      const sessionFile = 'session.jsonl';
      const realTranscript = join(
        claudeConfigDir,
        'projects',
        encodeProjectPath(mainProjectDir),
        sessionFile,
      );
      const mismatchedTranscript = join(
        claudeConfigDir,
        'projects',
        '-missing-worktree-dir',
        sessionFile,
      );
      mkdirSync(worktreeDir, { recursive: true });
      mkdirSync(dirname(realTranscript), { recursive: true });
      writeFileSync(realTranscript, '{}');
      process.env.CLAUDE_CONFIG_DIR = claudeConfigDir;

      const envelope = normalizeHookEnvelope({
        session_id: 'session',
        cwd: worktreeDir,
        transcript_path: mismatchedTranscript,
        hook_event_name: 'SessionStart',
      }, 'session-start');

      expect(envelope.directory).toBe(worktreeDir);
      expect(envelope.transcriptPath).toBe(realTranscript);
    } finally {
      if (originalClaudeConfigDir === undefined) {
        delete process.env.CLAUDE_CONFIG_DIR;
      } else {
        process.env.CLAUDE_CONFIG_DIR = originalClaudeConfigDir;
      }
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('leaves existing Claude fixture normalization unchanged', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const raw = loadFixture('claude', 'PreToolUse');
    const original = structuredClone(raw);

    try {
      expect(normalizeHookInput(raw, 'pre-tool-use')).toEqual({
        sessionId: '<session-id>',
        toolName: 'Read',
        toolInput: { file_path: '<path>' },
        toolOutput: undefined,
        directory: '<cwd>',
        prompt: undefined,
        message: undefined,
        parts: undefined,
        transcript_path: '<transcript-path>',
        permission_mode: 'default',
        tool_use_id: '<tool-use-id>',
      });
      expect(raw).toEqual(original);
    } finally {
      errorSpy.mockRestore();
    }
  });
});
