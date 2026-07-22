import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { normalizeHookEnvelope } from '../bridge-normalize.js';
import {
  encodeClaudeHookOutput,
  encodeCopilotHookOutput,
  encodeHookOutput,
  reduceHookEvaluations,
} from '../hook-runtime.js';
import type {
  CanonicalHookEnvelope,
  HookDecision,
  HookReduction,
} from '../hook-protocol.js';

const FIXTURE_ROOT = join(process.cwd(), 'src', '__tests__', 'fixtures', 'hooks');
const COPILOT_OUTPUT_ROOT = join(
  FIXTURE_ROOT,
  'copilot-1.0.72-1',
  'outputs',
);
const CLAUDE_OUTPUT_ROOT = join(FIXTURE_ROOT, 'claude', 'outputs');

const REPLACEMENT_ARGS = {
  command: '<command>',
  description: '<description>',
  initial_wait: 30,
};

function loadOutputFixture(
  host: 'claude' | 'copilot-1.0.72-1',
  name: string,
): Record<string, unknown> {
  return JSON.parse(
    readFileSync(join(FIXTURE_ROOT, host, 'outputs', `${name}.json`), 'utf8'),
  ) as Record<string, unknown>;
}

function outputFixtureFiles(root: string): string[] {
  return readdirSync(root)
    .filter((file) => file.endsWith('.json') && file !== '_provenance.json')
    .sort();
}

function copilotEnvelope(
  hookType: string,
  callCount = 0,
): CanonicalHookEnvelope {
  return normalizeHookEnvelope({
    sessionId: '<session-id>',
    cwd: '<cwd>',
    ...(callCount > 0
      ? {
          toolCalls: Array.from({ length: callCount }, (_, index) => ({
            id: `call-${index}`,
            name: 'powershell',
            args: JSON.stringify({ command: `original-${index}` }),
          })),
        }
      : {}),
  }, hookType);
}

function claudeEnvelope(
  hookType: string,
  callCount = 0,
): CanonicalHookEnvelope {
  return normalizeHookEnvelope({
    session_id: '<session-id>',
    cwd: '<cwd>',
    ...(callCount > 0
      ? {
          tool_use_id: 'call-0',
          tool_name: 'Bash',
          tool_input: { command: 'original' },
        }
      : {}),
  }, hookType);
}

function reduction(overrides: Partial<HookReduction> = {}): HookReduction {
  return {
    decision: 'pass',
    retry: false,
    unchanged: true,
    contexts: [],
    diagnostics: [],
    mutations: [],
    callDecisions: [],
    effects: [],
    stagedEffects: [],
    ...overrides,
  };
}

const CLAUDE_MUTATION_MATRIX = [
  { label: 'PreToolUse', hookType: 'pre-tool-use', callCount: 1 },
  { label: 'PermissionRequest', hookType: 'permission-request', callCount: 1 },
  { label: 'agentStop', hookType: 'stop', callCount: 0 },
  { label: 'SessionStart', hookType: 'session-start', callCount: 0 },
  { label: 'SessionEnd', hookType: 'session-end', callCount: 0 },
].flatMap((event) =>
  (['pass', 'allow', 'ask', 'deny'] as const).map((decision) => ({
    ...event,
    decision,
    supported:
      event.hookType === 'pre-tool-use'
        ? decision !== 'deny'
        : event.hookType === 'permission-request'
          ? decision === 'allow'
          : false,
  })),
);

describe('versioned hook output fixtures', () => {
  it.each([
    {
      root: COPILOT_OUTPUT_ROOT,
      expectedVersion: '1.0.72-1',
    },
    {
      root: CLAUDE_OUTPUT_ROOT,
      expectedVersion: undefined,
    },
  ])('records observed provenance for every fixture under $root', ({
    root,
    expectedVersion,
  }) => {
    const provenance = JSON.parse(
      readFileSync(join(root, '_provenance.json'), 'utf8'),
    ) as {
      copilotVersion?: string;
      sourceArtifacts: string[];
      fixtures: Record<string, {
        status: string;
        evidenceId: string;
      }>;
    };
    const files = outputFixtureFiles(root);

    expect(Object.keys(provenance.fixtures).sort()).toEqual(files);
    expect(provenance.sourceArtifacts).toEqual([
      '.omc/research/copilot-hook-output-contracts/report.md',
      '.omc/research/copilot-hook-output-contracts/evidence.json',
    ]);
    if (expectedVersion) {
      expect(provenance.copilotVersion).toBe(expectedVersion);
    }
    for (const fixture of Object.values(provenance.fixtures)) {
      expect(fixture.status).toBe('observed');
      expect(fixture.evidenceId).toMatch(/^[A-Za-z][A-Za-z0-9-]+$/);
    }
  });

  it.each([
    { root: COPILOT_OUTPUT_ROOT },
    { root: CLAUDE_OUTPUT_ROOT },
  ])('keeps every output fixture sanitized under $root', ({ root }) => {
    for (const file of outputFixtureFiles(root)) {
      const serialized = readFileSync(join(root, file), 'utf8');

      expect(serialized).not.toMatch(/[A-Za-z]:[\\/]/);
      expect(serialized).not.toMatch(
        /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i,
      );
      expect(serialized).not.toMatch(
        /\b(?:gh[pousr]_|github_pat_|sk-|xox[baprs]-|npm_)[A-Za-z0-9_-]{10,}\b/,
      );
    }
  });
});

describe('Copilot 1.0.72-1 hook output encoding', () => {
  it.each([
    {
      name: 'pass',
      fixture: 'preToolUse-pass',
      value: reduction(),
    },
    {
      name: 'allow',
      fixture: 'preToolUse-allow',
      value: reduction({ decision: 'allow' }),
    },
    {
      name: 'deny with reason',
      fixture: 'preToolUse-deny',
      value: reduction({ decision: 'deny', reason: '<reason>' }),
    },
    {
      name: 'ask with reason',
      fixture: 'preToolUse-ask',
      value: reduction({ decision: 'ask', reason: '<reason>' }),
    },
    {
      name: 'complete argument replacement',
      fixture: 'preToolUse-modifiedArgs',
      value: reduction({
        decision: 'allow',
        unchanged: false,
        mutations: [{
          callId: 'call-0',
          input: REPLACEMENT_ARGS,
          requirement: 'optional',
        }],
      }),
    },
    {
      name: 'additional context',
      fixture: 'preToolUse-additionalContext',
      value: reduction({
        decision: 'allow',
        contexts: ['<additional-context>'],
        context: '<additional-context>',
      }),
    },
  ])('encodes proven preToolUse $name output', ({ fixture, value }) => {
    const envelope = copilotEnvelope('pre-tool-use', 1);

    expect(encodeHookOutput(envelope, value)).toEqual(
      loadOutputFixture('copilot-1.0.72-1', fixture),
    );
  });

  it('never emits the tolerated but undocumented literal pass decision', () => {
    const output = encodeCopilotHookOutput(
      copilotEnvelope('pre-tool-use', 1),
      reduction({
        contexts: ['<additional-context>'],
        context: '<additional-context>',
      }),
    );

    expect(output).toEqual({ additionalContext: '<additional-context>' });
    expect(output).not.toHaveProperty('permissionDecision');
    expect(JSON.stringify(output)).not.toContain('"pass"');
  });

  it('encodes proven agentStop block and release outputs', () => {
    const envelope = copilotEnvelope('stop');

    expect(encodeHookOutput(
      envelope,
      reduction({ decision: 'deny', reason: '<reason>' }),
    )).toEqual(loadOutputFixture('copilot-1.0.72-1', 'agentStop-block'));
    expect(encodeHookOutput(envelope, reduction())).toEqual(
      loadOutputFixture('copilot-1.0.72-1', 'agentStop-pass'),
    );
  });

  it('uses the same native block shape for subagentStop', () => {
    expect(encodeHookOutput(
      copilotEnvelope('subagent-stop'),
      reduction({ decision: 'deny', reason: '<reason>' }),
    )).toEqual({
      decision: 'block',
      reason: '<reason>',
    });
  });

  it.each([
    'session-start',
    'subagent-start',
    'post-tool-use',
    'post-tool-use-failure',
    'notification',
    'user-prompt-submit',
  ])('emits root additionalContext for native %s output', (hookType) => {
    expect(encodeCopilotHookOutput(
      copilotEnvelope(hookType),
      reduction({
        contexts: ['<additional-context>'],
        context: '<additional-context>',
      }),
    )).toEqual({
      additionalContext: '<additional-context>',
    });
  });

  it.each([
    'pre-compact',
    'session-end',
  ])('does not invent a context output for native %s', (hookType) => {
    expect(encodeCopilotHookOutput(
      copilotEnvelope(hookType),
      reduction({
        contexts: ['<additional-context>'],
        context: '<additional-context>',
      }),
    )).toEqual({});
  });

  it('uses the native permissionRequest behavior schema', () => {
    const envelope = copilotEnvelope('permission-request', 1);

    expect(encodeCopilotHookOutput(
      envelope,
      reduction({ decision: 'allow' }),
    )).toEqual({ behavior: 'allow' });
    expect(encodeCopilotHookOutput(
      envelope,
      reduction({ decision: 'deny', reason: '<reason>' }),
    )).toEqual({ behavior: 'deny', message: '<reason>' });
    expect(encodeCopilotHookOutput(
      envelope,
      reduction({ decision: 'ask', reason: '<reason>' }),
    )).toEqual({});
  });

  it('keeps optional batched mutation unchanged and surfaces its diagnostic', () => {
    const envelope = copilotEnvelope('pre-tool-use', 2);
    const reduced = reduceHookEvaluations(envelope, [
      {
        callId: 'call-0',
        decision: 'allow',
        mutation: {
          input: REPLACEMENT_ARGS,
          requirement: 'optional',
        },
      },
      { callId: 'call-1', decision: 'allow' },
    ]);
    const output = encodeHookOutput(envelope, reduced);

    expect(reduced).toMatchObject({
      decision: 'pass',
      unchanged: true,
      mutations: [],
    });
    expect(output).toEqual({ additionalContext: reduced.context });
    expect(output).not.toHaveProperty('modifiedArgs');
    expect(output).not.toHaveProperty('permissionDecision');
  });

  it('keeps required batched mutation as deny/retry without correlated output', () => {
    const envelope = copilotEnvelope('pre-tool-use', 2);
    const reduced = reduceHookEvaluations(envelope, [
      {
        callId: 'call-0',
        decision: 'pass',
        mutation: {
          input: REPLACEMENT_ARGS,
          requirement: 'required',
        },
      },
      { callId: 'call-1', decision: 'pass' },
    ]);
    const output = encodeHookOutput(envelope, reduced);

    expect(reduced).toMatchObject({
      decision: 'deny',
      retry: true,
      unchanged: true,
      mutations: [],
    });
    expect(output).toMatchObject({
      permissionDecision: 'deny',
      permissionDecisionReason: reduced.reason,
    });
    expect(output).not.toHaveProperty('modifiedArgs');
  });

  it.each([
    {
      name: 'mismatched callId',
      callId: 'other-call',
      input: REPLACEMENT_ARGS,
      diagnostic: 'does not match "call-0"',
    },
    {
      name: 'scalar input',
      callId: 'call-0',
      input: 'replacement',
      diagnostic: 'replacement input must be a plain object',
    },
    {
      name: 'null input',
      callId: 'call-0',
      input: null,
      diagnostic: 'replacement input must be a plain object',
    },
  ])('fails closed for required singleton $name before encoding', ({
    callId,
    input,
    diagnostic,
  }) => {
    for (const envelope of [
      copilotEnvelope('pre-tool-use', 1),
      claudeEnvelope('pre-tool-use', 1),
    ]) {
      const reduced = reduceHookEvaluations(envelope, [{
        callId,
        decision: 'pass',
        mutation: {
          input,
          requirement: 'required',
        },
      }]);
      const output = encodeHookOutput(envelope, reduced);
      const serialized = JSON.stringify(output);

      expect(reduced).toMatchObject({
        decision: 'deny',
        retry: true,
        unchanged: true,
        mutations: [],
      });
      expect(reduced.diagnostics).toEqual([
        expect.stringContaining(diagnostic),
      ]);
      expect(serialized).not.toContain('modifiedArgs');
      expect(serialized).not.toContain('updatedInput');
      expect(serialized).toContain('deny');
    }
  });

  it.each([
    {
      name: 'mismatched callId',
      callId: 'other-call',
      input: REPLACEMENT_ARGS,
      diagnostic: 'does not match "call-0"',
    },
    {
      name: 'scalar input',
      callId: 'call-0',
      input: 42,
      diagnostic: 'replacement input must be a plain object',
    },
    {
      name: 'null input',
      callId: 'call-0',
      input: null,
      diagnostic: 'replacement input must be a plain object',
    },
  ])('discards optional singleton $name with encoded diagnostic', ({
    callId,
    input,
    diagnostic,
  }) => {
    for (const envelope of [
      copilotEnvelope('pre-tool-use', 1),
      claudeEnvelope('pre-tool-use', 1),
    ]) {
      const reduced = reduceHookEvaluations(envelope, [{
        callId,
        decision: 'pass',
        mutation: {
          input,
          requirement: 'optional',
        },
      }]);
      const output = encodeHookOutput(envelope, reduced);
      const serialized = JSON.stringify(output);

      expect(reduced).toMatchObject({
        decision: 'pass',
        retry: false,
        unchanged: true,
        mutations: [],
      });
      expect(reduced.diagnostics).toEqual([
        expect.stringContaining(diagnostic),
      ]);
      expect(serialized).not.toContain('modifiedArgs');
      expect(serialized).not.toContain('updatedInput');
      expect(serialized).not.toContain('"pass"');
      const hookSpecificOutput = output.hookSpecificOutput as
        | Record<string, unknown>
        | undefined;
      expect(
        output.additionalContext ?? hookSpecificOutput?.additionalContext,
      ).toContain(diagnostic);
    }
  });
});

describe('Claude legacy hook output encoding', () => {
  it.each(CLAUDE_MUTATION_MATRIX)(
    'encodes required mutation only for $label $decision branch',
    ({ hookType, callCount, decision, supported }) => {
      const envelope = claudeEnvelope(hookType, callCount);
      const reduced = reduceHookEvaluations(envelope, [{
        ...(callCount > 0 ? { callId: 'call-0' } : {}),
        decision,
        mutation: {
          input: REPLACEMENT_ARGS,
          requirement: 'required',
        },
      }]);
      const output = encodeHookOutput(envelope, reduced);
      const serialized = JSON.stringify(output);

      if (supported) {
        expect(reduced).toMatchObject({
          decision,
          retry: false,
          unchanged: false,
          mutations: [{
            input: REPLACEMENT_ARGS,
            requirement: 'required',
          }],
        });
        expect(serialized).toContain('"updatedInput"');
        return;
      }

      expect(reduced).toMatchObject({
        decision: 'deny',
        retry: true,
        unchanged: true,
        mutations: [],
      });
      expect(reduced.diagnostics).toEqual(
        expect.arrayContaining([
          expect.stringContaining('does not encode input mutation'),
        ]),
      );
      expect(serialized).not.toContain('"updatedInput"');
      if (hookType === 'session-end') {
        expect(output).toEqual({});
      }
    },
  );

  it.each(CLAUDE_MUTATION_MATRIX)(
    'discards optional mutation for unsupported $label $decision branch',
    ({ hookType, callCount, decision, supported }) => {
      const envelope = claudeEnvelope(hookType, callCount);
      const reduced = reduceHookEvaluations(envelope, [{
        ...(callCount > 0 ? { callId: 'call-0' } : {}),
        decision,
        mutation: {
          input: REPLACEMENT_ARGS,
          requirement: 'optional',
        },
      }]);
      const output = encodeHookOutput(envelope, reduced);
      const serialized = JSON.stringify(output);

      if (supported) {
        expect(reduced).toMatchObject({
          decision,
          retry: false,
          unchanged: false,
          mutations: [{
            input: REPLACEMENT_ARGS,
            requirement: 'optional',
          }],
        });
        expect(serialized).toContain('"updatedInput"');
        return;
      }

      const expectedDecision: HookDecision =
        decision === 'allow' && callCount === 0
          ? 'pass'
          : decision;
      expect(reduced).toMatchObject({
        decision: expectedDecision,
        retry: false,
        unchanged: true,
        mutations: [],
      });
      expect(reduced.diagnostics).toEqual(
        expect.arrayContaining([
          expect.stringContaining('does not encode input mutation'),
        ]),
      );
      expect(serialized).not.toContain('"updatedInput"');
      if (
        hookType === 'session-end'
        || (hookType === 'permission-request'
          && (expectedDecision === 'pass' || expectedDecision === 'ask'))
        || (hookType === 'stop' && expectedDecision !== 'deny')
      ) {
        expect(output).toEqual({});
      }
    },
  );

  it('preserves empty PreToolUse pass output', () => {
    expect(encodeHookOutput(
      claudeEnvelope('pre-tool-use', 1),
      reduction(),
    )).toEqual(loadOutputFixture('claude', 'PreToolUse-pass'));
  });

  it('preserves hookSpecificOutput update and context semantics', () => {
    expect(encodeClaudeHookOutput(
      claudeEnvelope('pre-tool-use', 1),
      reduction({
        decision: 'allow',
        unchanged: false,
        contexts: ['<additional-context>'],
        context: '<additional-context>',
        mutations: [{
          callId: 'call-0',
          input: REPLACEMENT_ARGS,
          requirement: 'optional',
        }],
      }),
    )).toEqual(
      loadOutputFixture('claude', 'PreToolUse-allow-update-context'),
    );
  });

  it('keeps Claude deny and ask reasons inside hookSpecificOutput', () => {
    const envelope = claudeEnvelope('pre-tool-use', 1);

    expect(encodeClaudeHookOutput(
      envelope,
      reduction({ decision: 'deny', reason: '<reason>' }),
    )).toEqual({
      continue: true,
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: '<reason>',
      },
    });
    expect(encodeClaudeHookOutput(
      envelope,
      reduction({ decision: 'ask', reason: '<reason>' }),
    )).toEqual({
      continue: true,
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'ask',
        permissionDecisionReason: '<reason>',
      },
    });
  });

  it.each([
    ['session-start', 'SessionStart'],
    ['user-prompt-submit', 'UserPromptSubmit'],
    ['subagent-start', 'SubagentStart'],
    ['post-tool-use', 'PostToolUse'],
    ['post-tool-use-failure', 'PostToolUseFailure'],
  ])('keeps %s context in Claude hookSpecificOutput', (hookType, hookEventName) => {
    expect(encodeClaudeHookOutput(
      claudeEnvelope(hookType),
      reduction({
        contexts: ['<additional-context>'],
        context: '<additional-context>',
      }),
    )).toEqual({
      continue: true,
      hookSpecificOutput: {
        hookEventName,
        additionalContext: '<additional-context>',
      },
    });
  });

  it('keeps PermissionRequest updatedInput in the legacy decision wrapper', () => {
    expect(encodeClaudeHookOutput(
      claudeEnvelope('permission-request', 1),
      reduction({
        decision: 'allow',
        unchanged: false,
        mutations: [{
          callId: 'call-0',
          input: REPLACEMENT_ARGS,
          requirement: 'required',
        }],
      }),
    )).toEqual({
      continue: true,
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: {
          behavior: 'allow',
          updatedInput: REPLACEMENT_ARGS,
        },
      },
    });
  });

  it('uses block/reason for Claude stop hooks without explicit allow output', () => {
    const envelope = claudeEnvelope('subagent-stop');

    expect(encodeClaudeHookOutput(
      envelope,
      reduction({ decision: 'deny', reason: '<reason>' }),
    )).toEqual({
      decision: 'block',
      reason: '<reason>',
    });
    expect(encodeClaudeHookOutput(envelope, reduction({
      decision: 'allow',
    }))).toEqual({});
  });
});
