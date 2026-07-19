import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it, vi } from 'vitest';
import { normalizeHookEnvelope } from '../bridge-normalize.js';
import {
  MAX_HOOK_CONTEXT_CHARACTERS,
  MAX_HOOK_CONTEXT_MESSAGES,
  interpretLegacyOutput,
  reduceHookEvaluations,
  runHookPayload,
  sanitizeHookEvaluation,
} from '../hook-runtime.js';
import type {
  CanonicalHookEnvelope,
  HookCapabilities,
  HookDecision,
  HookEvaluation,
} from '../hook-protocol.js';

const FIXTURE_ROOT = join(process.cwd(), 'src', '__tests__', 'fixtures', 'hooks');

function loadFixture(host: 'claude' | 'copilot-1.0.72-1', name: string) {
  return JSON.parse(
    readFileSync(join(FIXTURE_ROOT, host, `${name}.json`), 'utf8'),
  ) as Record<string, unknown>;
}

function call(id: string, pattern = id) {
  return {
    id,
    name: 'rg',
    args: JSON.stringify({ pattern, output_mode: 'content' }),
  };
}

const HOOK_FIXTURE_CASES: Array<{
  hookType: string;
  claude: string;
  copilot: string;
  claudeExpected: Record<string, unknown>;
  copilotExpected: Record<string, unknown>;
}> = [
  {
    hookType: 'session-start',
    claude: 'SessionStart',
    copilot: 'sessionStart',
    claudeExpected: {
      eventPayload: {
        source: 'startup',
        model: '<model>',
      },
      toolCalls: [],
    },
    copilotExpected: {
      eventPayload: {
        source: 'new',
        initialPrompt: '<initial-prompt>',
        timestamp: 1700000000000,
      },
      toolCalls: [],
    },
  },
  {
    hookType: 'user-prompt-submit',
    claude: 'UserPromptSubmit',
    copilot: 'userPromptSubmitted',
    claudeExpected: {
      eventPayload: {
        prompt: '<prompt>',
        permissionMode: 'default',
      },
      toolCalls: [],
    },
    copilotExpected: {
      eventPayload: {
        prompt: '<prompt>',
        timestamp: 1700000000000,
      },
      toolCalls: [],
    },
  },
  {
    hookType: 'pre-tool-use',
    claude: 'PreToolUse',
    copilot: 'preToolUse',
    claudeExpected: {
      eventPayload: {
        permissionMode: 'default',
      },
      toolCalls: [{
        id: '<tool-use-id>',
        nativeName: 'Read',
        input: { file_path: '<path>' },
      }],
    },
    copilotExpected: {
      eventPayload: {},
      toolCalls: [
        {
          id: '<tool-call-id-1>',
          nativeName: 'glob',
          input: { pattern: '<glob-pattern>', paths: '<path-1>' },
        },
        {
          id: '<tool-call-id-2>',
          nativeName: 'rg',
          input: {
            pattern: '<search-pattern>',
            paths: ['<path-2>', '<path-3>', '<path-4>'],
            output_mode: 'content',
            glob: '<glob-pattern>',
            '-n': true,
            head_limit: 20,
          },
        },
      ],
    },
  },
  {
    hookType: 'permission-request',
    claude: 'PermissionRequest',
    copilot: 'permissionRequest',
    claudeExpected: {
      eventPayload: {
        permissionSuggestions: [],
        permissionMode: 'default',
      },
      toolCalls: [{
        nativeName: 'Bash',
        input: { command: '<command>' },
      }],
    },
    copilotExpected: {
      eventPayload: {
        timestamp: 1700000000000,
        permissionSuggestions: [],
      },
      toolCalls: [{
        nativeName: 'powershell',
        input: { command: '<command>' },
      }],
    },
  },
  {
    hookType: 'post-tool-use',
    claude: 'PostToolUse',
    copilot: 'postToolUse',
    claudeExpected: {
      eventPayload: {
        toolOutput: { filePath: '<path>', success: true },
        permissionMode: 'default',
        durationMs: 0,
      },
      toolCalls: [{
        id: '<tool-use-id>',
        nativeName: 'Write',
        input: { file_path: '<path>', content: '<file-content>' },
      }],
    },
    copilotExpected: {
      eventPayload: {
        timestamp: 1700000000000,
        toolOutput: {
          textResultForLlm: '<tool-output>',
          resultType: 'success',
          sessionLog: '<session-log>',
          toolTelemetry: {},
        },
      },
      toolCalls: [{
        nativeName: 'fetch_copilot_cli_documentation',
        input: {},
      }],
    },
  },
  {
    hookType: 'post-tool-use-failure',
    claude: 'PostToolUseFailure',
    copilot: 'postToolUseFailure',
    claudeExpected: {
      eventPayload: {
        toolError: '<tool-error>',
        permissionMode: 'default',
        durationMs: 0,
        interrupted: false,
      },
      toolCalls: [{
        id: '<tool-use-id>',
        nativeName: 'Bash',
        input: { command: '<command>' },
      }],
    },
    copilotExpected: {
      eventPayload: {
        timestamp: 1700000000000,
        toolError: '<tool-error>',
      },
      toolCalls: [{
        nativeName: 'glob',
        input: { pattern: '<glob-pattern>', paths: '<path>' },
      }],
    },
  },
  {
    hookType: 'subagent-start',
    claude: 'SubagentStart',
    copilot: 'subagentStart',
    claudeExpected: {
      eventPayload: {},
      agent: {
        id: '<agent-id>',
        name: '<agent-type>',
        correlation: 'host-id',
      },
      toolCalls: [],
    },
    copilotExpected: {
      eventPayload: {
        timestamp: 1700000000000,
      },
      agent: {
        name: '<agent-name>',
        displayName: '<agent-display-name>',
        description: '<agent-description>',
        correlation: 'unavailable',
      },
      toolCalls: [],
    },
  },
  {
    hookType: 'subagent-stop',
    claude: 'SubagentStop',
    copilot: 'subagentStop',
    claudeExpected: {
      eventPayload: {
        permissionMode: 'default',
        stopHookActive: false,
        lastAssistantMessage: '<assistant-message>',
        backgroundTasks: [],
        sessionCrons: [],
        agentTranscriptPath: '<agent-transcript-path>',
      },
      agent: {
        id: '<agent-id>',
        name: '<agent-type>',
        correlation: 'host-id',
      },
      toolCalls: [],
    },
    copilotExpected: {
      stopReason: 'end_turn',
      eventPayload: {
        timestamp: 1700000000000,
      },
      agent: {
        name: '<agent-name>',
        displayName: '<agent-display-name>',
        correlation: 'unavailable',
      },
      toolCalls: [],
    },
  },
  {
    hookType: 'stop',
    claude: 'Stop',
    copilot: 'agentStop',
    claudeExpected: {
      eventPayload: {
        permissionMode: 'default',
        stopHookActive: false,
        lastAssistantMessage: '<assistant-message>',
        backgroundTasks: [],
        sessionCrons: [],
      },
      toolCalls: [],
    },
    copilotExpected: {
      stopReason: 'end_turn',
      eventPayload: {
        timestamp: 1700000000000,
      },
      toolCalls: [],
    },
  },
  {
    hookType: 'pre-compact',
    claude: 'PreCompact',
    copilot: 'preCompact',
    claudeExpected: {
      eventPayload: {
        trigger: 'manual',
        customInstructions: '<custom-instructions>',
      },
      toolCalls: [],
    },
    copilotExpected: {
      eventPayload: {
        timestamp: 1700000000000,
        trigger: 'auto',
        customInstructions: '<custom-instructions>',
      },
      toolCalls: [],
    },
  },
  {
    hookType: 'session-end',
    claude: 'SessionEnd',
    copilot: 'sessionEnd',
    claudeExpected: {
      eventPayload: {
        sessionEndReason: 'other',
      },
      toolCalls: [],
    },
    copilotExpected: {
      eventPayload: {
        timestamp: 1700000000000,
        sessionEndReason: 'complete',
      },
      toolCalls: [],
    },
  },
];

function copilotEnvelope(count = 2): CanonicalHookEnvelope {
  return normalizeHookEnvelope({
    sessionId: 'session',
    cwd: 'C:\\repo',
    toolCalls: Array.from({ length: count }, (_, index) => call(`call-${index}`)),
  }, 'pre-tool-use');
}

function withCapabilities(
  envelope: CanonicalHookEnvelope,
  capabilities: Partial<HookCapabilities>,
): CanonicalHookEnvelope {
  return {
    ...envelope,
    capabilities: {
      ...envelope.capabilities,
      ...capabilities,
    },
  };
}

function evaluations(...decisions: HookDecision[]): HookEvaluation[] {
  return decisions.map((decision, index) => ({
    callId: `call-${index}`,
    decision,
  }));
}

describe('canonical hook reduction', () => {
  it.each([
    { decisions: ['pass', 'pass'], expected: 'pass' },
    { decisions: ['allow', 'allow'], expected: 'allow' },
    { decisions: ['allow', 'pass'], expected: 'pass' },
    { decisions: ['allow', 'deny'], expected: 'deny' },
    { decisions: ['ask', 'deny'], expected: 'deny' },
  ] as Array<{ decisions: HookDecision[]; expected: HookDecision }>)(
    'reduces $decisions to $expected',
    ({ decisions, expected }) => {
      const result = reduceHookEvaluations(
        copilotEnvelope(decisions.length),
        evaluations(...decisions),
      );

      expect(result.decision).toBe(expected);
    },
  );

  it('converts an uncorrelatable ask into a whole-batch deny', () => {
    const result = reduceHookEvaluations(
      copilotEnvelope(2),
      [
        { callId: 'call-0', decision: 'allow' },
        { callId: 'call-1', decision: 'ask', reason: 'Confirm this call.' },
      ],
    );

    expect(result).toMatchObject({
      decision: 'deny',
      retry: true,
      mutations: [],
    });
    expect(result.reason).toContain('Confirm this call.');
    expect(result.reason).toContain('retry or confirm the calls separately');
  });

  it('preserves ask when per-call decision correlation is available', () => {
    const envelope = withCapabilities(copilotEnvelope(2), {
      correlatedDecisionOutput: true,
    });
    const result = reduceHookEvaluations(envelope, [
      { callId: 'call-0', decision: 'allow' },
      { callId: 'call-1', decision: 'ask', reason: 'Confirm.' },
    ]);

    expect(result).toMatchObject({
      decision: 'ask',
      reason: 'Confirm.',
      retry: false,
      mutations: [],
    });
  });

  it('keeps a host deny immutable', () => {
    const envelope: CanonicalHookEnvelope = {
      ...copilotEnvelope(2),
      hostDecision: {
        decision: 'deny',
        reason: 'Native policy denied the batch.',
      },
    };
    const result = reduceHookEvaluations(envelope, [
      {
        callId: 'call-0',
        decision: 'allow',
        mutation: {
          input: { pattern: 'changed' },
          requirement: 'optional',
        },
      },
      { callId: 'call-1', decision: 'allow' },
    ]);

    expect(result).toMatchObject({
      decision: 'deny',
      reason: 'Native policy denied the batch.',
      mutations: [],
      unchanged: true,
    });
  });

  it('denies permission-sensitive envelopes with zero logical calls', () => {
    const envelope = normalizeHookEnvelope({
      sessionId: 'session',
      toolCalls: [],
    }, 'pre-tool-use');
    const result = reduceHookEvaluations(envelope, []);

    expect(envelope).toMatchObject({
      originalCallCount: 0,
      logicalCallCount: 0,
    });
    expect(result).toMatchObject({
      decision: 'deny',
      unchanged: true,
    });
    expect(result.reason).toContain('no logical tool calls');
  });

  it('reduces allow to pass when a valid logical call was not evaluated', () => {
    const result = reduceHookEvaluations(copilotEnvelope(2), [
      { callId: 'call-0', decision: 'allow' },
    ]);

    expect(result).toMatchObject({
      decision: 'pass',
      unchanged: true,
    });
    expect(result.diagnostics).toEqual([
      expect.stringContaining('not every logical tool call'),
    ]);
  });

  it('denies and retries when a deny branch cannot emit a required mutation', () => {
    const deny = reduceHookEvaluations(copilotEnvelope(1), [{
      callId: 'call-0',
      decision: 'deny',
      mutation: {
        input: { pattern: 'changed' },
        requirement: 'required',
      },
    }]);

    expect(deny).toMatchObject({
      decision: 'deny',
      retry: true,
      unchanged: true,
      mutations: [],
    });
    expect(deny.diagnostics).toEqual([
      expect.stringContaining('decision "deny" does not encode input mutation'),
    ]);
  });

  it('preserves a required ask mutation for a Copilot singleton', () => {
    const result = reduceHookEvaluations(copilotEnvelope(1), [{
      callId: 'call-0',
      decision: 'ask',
      reason: 'Confirm the sanitized input.',
      mutation: {
        input: { pattern: 'changed' },
        requirement: 'required',
      },
    }]);

    expect(result).toMatchObject({
      decision: 'ask',
      reason: 'Confirm the sanitized input.',
      retry: false,
      unchanged: false,
      mutations: [{
        callId: 'call-0',
        input: { pattern: 'changed' },
        requirement: 'required',
      }],
    });
  });

  it('denies an uncorrelatable batched ask without retaining its mutation', () => {
    const result = reduceHookEvaluations(copilotEnvelope(2), [
      {
        callId: 'call-0',
        decision: 'ask',
        reason: 'Confirm the sanitized input.',
        mutation: {
          input: { pattern: 'changed' },
          requirement: 'required',
        },
      },
      { callId: 'call-1', decision: 'allow' },
    ]);

    expect(result).toMatchObject({
      decision: 'deny',
      retry: true,
      unchanged: true,
      mutations: [],
    });
    expect(result.reason).toContain('cannot correlate confirmation');
  });

  it('keeps ask with a supported optional singleton mutation', () => {
    const result = reduceHookEvaluations(copilotEnvelope(1), [{
      callId: 'call-0',
      decision: 'ask',
      reason: 'Confirm the original input.',
      mutation: {
        input: { pattern: 'optional-change' },
        requirement: 'optional',
      },
    }]);

    expect(result).toMatchObject({
      decision: 'ask',
      reason: 'Confirm the original input.',
      retry: false,
      unchanged: false,
      mutations: [{
        callId: 'call-0',
        input: { pattern: 'optional-change' },
        requirement: 'optional',
      }],
    });
    expect(result.diagnostics).toEqual([]);
  });

  it('passes an unsupported optional multi-call mutation unchanged with a diagnostic', () => {
    const result = reduceHookEvaluations(copilotEnvelope(2), [
      {
        callId: 'call-0',
        decision: 'allow',
        mutation: {
          input: { pattern: 'changed' },
          requirement: 'optional',
        },
      },
      { callId: 'call-1', decision: 'allow' },
    ]);

    expect(result).toMatchObject({
      decision: 'pass',
      unchanged: true,
      mutations: [],
    });
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toContain('original input will be used');
    expect(result.contexts).toContain(result.diagnostics[0]);
  });

  it('denies and requests a retry for an unsupported required mutation', () => {
    const result = reduceHookEvaluations(copilotEnvelope(2), [
      {
        callId: 'call-0',
        decision: 'pass',
        mutation: {
          input: { pattern: 'required-change' },
          requirement: 'required',
        },
      },
      { callId: 'call-1', decision: 'pass' },
    ]);

    expect(result).toMatchObject({
      decision: 'deny',
      retry: true,
      unchanged: true,
      mutations: [],
    });
    expect(result.reason).toContain('retry the call separately');
  });

  it('retains a supported singleton mutation', () => {
    const result = reduceHookEvaluations(copilotEnvelope(1), [{
      callId: 'call-0',
      decision: 'allow',
      mutation: {
        input: { pattern: 'changed' },
        requirement: 'optional',
      },
    }]);

    expect(result).toMatchObject({
      decision: 'allow',
      unchanged: false,
      mutations: [{
        callId: 'call-0',
        input: { pattern: 'changed' },
        requirement: 'optional',
      }],
    });
  });

  it.each([
    {
      name: 'mismatched callId',
      callId: 'other-call',
      input: { pattern: 'changed' },
      diagnostic: 'does not match "call-0"',
    },
    {
      name: 'scalar input',
      callId: 'call-0',
      input: 'changed',
      diagnostic: 'replacement input must be a plain object',
    },
    {
      name: 'null input',
      callId: 'call-0',
      input: null,
      diagnostic: 'replacement input must be a plain object',
    },
  ])('denies and retries a required singleton mutation with $name', ({
    callId,
    input,
    diagnostic,
  }) => {
    const result = reduceHookEvaluations(copilotEnvelope(1), [{
      callId,
      decision: 'pass',
      mutation: {
        input,
        requirement: 'required',
      },
    }]);

    expect(result).toMatchObject({
      decision: 'deny',
      retry: true,
      unchanged: true,
      mutations: [],
    });
    expect(result.diagnostics).toEqual([
      expect.stringContaining(diagnostic),
    ]);
    expect(result.contexts).toContain(result.diagnostics[0]);
  });

  it.each([
    {
      name: 'mismatched callId',
      callId: 'other-call',
      input: { pattern: 'changed' },
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
  ])('discards an optional singleton mutation with $name', ({
    callId,
    input,
    diagnostic,
  }) => {
    const result = reduceHookEvaluations(copilotEnvelope(1), [{
      callId,
      decision: 'pass',
      mutation: {
        input,
        requirement: 'optional',
      },
    }]);

    expect(result).toMatchObject({
      decision: 'pass',
      retry: false,
      unchanged: true,
      mutations: [],
    });
    expect(result.diagnostics).toEqual([
      expect.stringContaining(diagnostic),
    ]);
    expect(result.contexts).toContain(result.diagnostics[0]);
  });

  it('deduplicates and bounds context in first-seen order', () => {
    const longMessage = 'x'.repeat(MAX_HOOK_CONTEXT_CHARACTERS + 500);
    const result = reduceHookEvaluations(copilotEnvelope(2), [
      {
        callId: 'call-0',
        decision: 'pass',
        contexts: ['first', 'duplicate', 'duplicate', 'second'],
      },
      {
        callId: 'call-1',
        decision: 'pass',
        contexts: [
          'third',
          'fourth',
          'fifth',
          'sixth',
          'seventh',
          'eighth',
          'ninth',
          longMessage,
        ],
      },
    ]);

    expect(result.contexts.slice(0, 3)).toEqual(['first', 'duplicate', 'second']);
    expect(result.contexts.length).toBeLessThanOrEqual(MAX_HOOK_CONTEXT_MESSAGES);
    expect(result.context?.length).toBeLessThanOrEqual(MAX_HOOK_CONTEXT_CHARACTERS);
    expect(result.contexts.filter((message) => message === 'duplicate')).toHaveLength(1);
  });

  it('stages effect intents without executing them', () => {
    const run = vi.fn();
    const accepted = reduceHookEvaluations(copilotEnvelope(1), [{
      callId: 'call-0',
      decision: 'pass',
      effects: [
        { type: 'write-state', payload: { run }, commitOn: 'accepted' },
        { type: 'audit', payload: { run }, commitOn: 'always' },
      ],
    }]);
    const denied = reduceHookEvaluations(copilotEnvelope(1), [{
      callId: 'call-0',
      decision: 'deny',
      effects: [
        { type: 'write-state', payload: { run }, commitOn: 'accepted' },
        { type: 'audit', payload: { run }, commitOn: 'always' },
      ],
    }]);

    expect(accepted.stagedEffects.map(({ type }) => type)).toEqual([
      'write-state',
      'audit',
    ]);
    expect(denied.stagedEffects.map(({ type }) => type)).toEqual(['audit']);
    expect(run).not.toHaveBeenCalled();
  });

  it('contains unexpected reduction failures as adapter denials', () => {
    const baseEnvelope = copilotEnvelope(1);
    const envelope = new Proxy(baseEnvelope, {
      get(target, property, receiver) {
        if (property === 'issues') {
          throw new Error('issue access failed');
        }
        return Reflect.get(target, property, receiver) as unknown;
      },
    });

    const result = reduceHookEvaluations(envelope, [
      { callId: 'call-0', decision: 'allow' },
    ]);

    expect(result).toMatchObject({
      decision: 'deny',
      unchanged: true,
      callDecisions: [{
        source: 'adapter',
        decision: 'deny',
      }],
    });
    expect(result.reason).toContain('Hook reduction failed safely');
  });
});

describe('canonical hook runtime sequencing', () => {
  it.each(HOOK_FIXTURE_CASES)(
    'preserves $hookType fixture semantics through processor execution',
    async ({ hookType, claude, copilot, claudeExpected, copilotExpected }) => {
      const variants = [
        {
          fixtureHost: 'claude' as const,
          canonicalHost: 'claude',
          fixtureName: claude,
          expected: claudeExpected,
        },
        {
          fixtureHost: 'copilot-1.0.72-1' as const,
          canonicalHost: 'copilot',
          fixtureName: copilot,
          expected: copilotExpected,
        },
      ];

      for (const variant of variants) {
        const raw = loadFixture(variant.fixtureHost, variant.fixtureName);
        const observedEnvelopes: CanonicalHookEnvelope[] = [];
        const result = await runHookPayload(hookType, raw, (_unit, envelope) => {
          observedEnvelopes.push(envelope);
          return { decision: 'pass' as const };
        });
        const rawTranscriptPath = raw.transcript_path ?? raw.transcriptPath;
        const expectedCallCount = Array.isArray(raw.toolCalls)
          ? raw.toolCalls.length
          : typeof (raw.tool_name ?? raw.toolName) === 'string'
            ? 1
            : 0;

        expect(result.envelope).toMatchObject({
          host: variant.canonicalHost,
          hookType,
          sessionId: '<session-id>',
          directory: '<cwd>',
          originalCallCount: expectedCallCount,
          logicalCallCount: expectedCallCount,
          ...variant.expected,
        });
        expect(result.envelope.transcriptPath).toBe(rawTranscriptPath);
        expect(observedEnvelopes.length).toBeGreaterThan(0);
        for (const observed of observedEnvelopes) {
          expect(observed).toBe(result.envelope);
          expect(observed).toMatchObject(variant.expected);
        }
      }
    },
  );

  it('preserves canonical notification data through processor execution', async () => {
    const processor = vi.fn((_unit, envelope: CanonicalHookEnvelope) => {
      expect(envelope.eventPayload).toEqual({
        message: 'Permission required.',
        notification: {
          type: 'permission_prompt',
          title: 'Approval needed',
          message: 'Permission required.',
          data: { toolName: 'Bash' },
        },
      });
      return { decision: 'pass' as const };
    });

    const result = await runHookPayload('notification', {
      session_id: 'session',
      cwd: 'C:\\repo',
      hook_event_name: 'Notification',
      notification_type: 'permission_prompt',
      notification_title: 'Approval needed',
      message: 'Permission required.',
      notification_data: { toolName: 'Bash' },
    }, processor);

    expect(processor).toHaveBeenCalledTimes(1);
    expect(result.envelope.eventPayload.notification).toEqual({
      type: 'permission_prompt',
      title: 'Approval needed',
      message: 'Permission required.',
      data: { toolName: 'Bash' },
    });
  });

  it.each([1, 2, 20])('evaluates each unique call exactly once for %i calls', async (count) => {
    const processor = vi.fn(({ callId }) => ({
      callId,
      decision: 'pass' as const,
    }));
    const result = await runHookPayload('pre-tool-use', {
      sessionId: 'session',
      toolCalls: Array.from({ length: count }, (_, index) => call(`call-${index}`)),
    }, processor);

    expect(processor).toHaveBeenCalledTimes(count);
    expect(result.evaluations).toHaveLength(count);
    expect(result.reduction.decision).toBe('pass');
  });

  it('evaluates an identical duplicate ID once', async () => {
    const processor = vi.fn(() => ({ decision: 'allow' as const }));
    const result = await runHookPayload('pre-tool-use', {
      sessionId: 'session',
      toolCalls: [
        { id: 'same', name: 'rg', args: '{"pattern":"x","paths":["src"]}' },
        { id: 'same', name: 'rg', args: '{"paths":["src"],"pattern":"x"}' },
      ],
    }, processor);

    expect(processor).toHaveBeenCalledTimes(1);
    expect(result.envelope).toMatchObject({
      originalCallCount: 2,
      logicalCallCount: 1,
    });
    expect(result.envelope.toolCalls[0].duplicateIndices).toEqual([1]);
    expect(result.reduction.decision).toBe('allow');
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
  ])('does not allow an identical-ID batch with $name', async ({ calls }) => {
    const processor = vi.fn(() => ({ decision: 'allow' as const }));
    const result = await runHookPayload('pre-tool-use', {
      sessionId: 'session',
      toolCalls: calls,
    }, processor);

    expect(processor).not.toHaveBeenCalled();
    expect(result.envelope.toolCalls).toHaveLength(1);
    expect(result.envelope.toolCalls[0]).toMatchObject({
      status: 'malformed',
      malformed: true,
    });
    expect(result.reduction.decision).toBe('pass');
    expect(result.reduction.decision).not.toBe('allow');
  });

  it('denies a conflicting duplicate batch before processor execution', async () => {
    const processor = vi.fn(() => ({ decision: 'allow' as const }));
    const result = await runHookPayload('pre-tool-use', {
      sessionId: 'session',
      toolCalls: [
        call('same', 'first'),
        call('same', 'second'),
      ],
    }, processor);

    expect(processor).not.toHaveBeenCalled();
    expect(result.reduction).toMatchObject({
      decision: 'deny',
      unchanged: true,
    });
    expect(result.reduction.reason).toContain('conflicting');
  });

  it('keeps a malformed call explicit while evaluating its valid sibling', async () => {
    const processor = vi.fn(() => ({ decision: 'pass' as const }));
    const result = await runHookPayload('pre-tool-use', {
      sessionId: 'session',
      toolCalls: [
        call('valid'),
        { id: 'broken', name: 'custom_write', args: '{' },
      ],
    }, processor);

    expect(processor).toHaveBeenCalledTimes(1);
    expect(result.envelope.toolCalls[1].status).toBe('malformed');
    expect(result.reduction.decision).toBe('deny');
  });

  it('forces pass when a malformed read-only call is skipped', async () => {
    const processor = vi.fn(() => ({ decision: 'allow' as const }));
    const result = await runHookPayload('pre-tool-use', {
      sessionId: 'session',
      toolCalls: [
        call('valid'),
        { id: 'broken', name: 'rg', args: '{' },
      ],
    }, processor);

    expect(processor).toHaveBeenCalledTimes(1);
    expect(result.envelope).toMatchObject({
      originalCallCount: 2,
      logicalCallCount: 2,
    });
    expect(result.envelope.toolCalls[1].status).toBe('malformed');
    expect(result.reduction.decision).toBe('pass');
    expect(result.reduction.decision).not.toBe('allow');
  });

  it('does not invoke a processor for a permission-sensitive zero-call envelope', async () => {
    const processor = vi.fn(() => ({ decision: 'allow' as const }));
    const result = await runHookPayload('permission-request', {
      sessionId: 'session',
      toolCalls: [],
    }, processor);

    expect(processor).not.toHaveBeenCalled();
    expect(result.reduction.decision).toBe('deny');
  });

  it('contains hostile toolCalls decoding failures as an invalid-envelope denial', async () => {
    const processor = vi.fn(() => ({ decision: 'allow' as const }));
    const raw = new Proxy({
      sessionId: 'session',
      toolCalls: [],
    }, {
      get(target, property, receiver) {
        if (property === 'toolCalls') {
          throw Symbol('toolCalls getter failed');
        }
        return Reflect.get(target, property, receiver) as unknown;
      },
    });

    const result = await runHookPayload('pre-tool-use', raw, processor);

    expect(processor).not.toHaveBeenCalled();
    expect(result.envelope).toMatchObject({
      host: 'claude',
      contract: 'claude-single',
      hookType: 'pre-tool-use',
      originalCallCount: 0,
      logicalCallCount: 0,
      toolCalls: [],
      issues: [{
        code: 'invalid-envelope',
        severity: 'safety',
        scope: 'batch',
        batchSafety: true,
      }],
    });
    expect(result.envelope.issues[0].message).toContain('Symbol(toolCalls getter failed)');
    expect(result.reduction).toMatchObject({
      decision: 'deny',
      unchanged: true,
      reason: result.envelope.issues[0].message,
    });
  });

  it('fails closed when a processor throws', async () => {
    const result = await runHookPayload('pre-tool-use', {
      sessionId: 'session',
      toolCalls: [call('call-0')],
    }, () => {
      throw new Error('adapter unavailable');
    });

    expect(result.reduction).toMatchObject({
      decision: 'deny',
      reason: 'Hook processor failed: adapter unavailable',
    });
  });

  it('formats hostile thrown values without escaping runHookPayload', async () => {
    const nullPrototype = Object.assign(
      Object.create(null) as Record<string, unknown>,
      { kind: 'null-prototype' },
    );
    const hostileProxy = new Proxy({}, {
      get() {
        throw Symbol('proxy-get');
      },
      getPrototypeOf() {
        throw Symbol('proxy-prototype');
      },
      ownKeys() {
        throw Symbol('proxy-keys');
      },
    });
    const thrownValues = [
      nullPrototype,
      Symbol('symbol-failure'),
      hostileProxy,
    ];

    for (const thrownValue of thrownValues) {
      const result = await runHookPayload('pre-tool-use', {
        sessionId: 'session',
        toolCalls: [call('call-0')],
      }, () => Promise.reject(thrownValue));

      expect(result.evaluations[0]).toMatchObject({
        callId: 'call-0',
        source: 'adapter',
        decision: 'deny',
      });
      expect(result.evaluations[0].reason).toEqual(expect.any(String));
      expect(result.evaluations[0].reason?.length).toBeGreaterThan(0);
      expect(result.reduction.decision).toBe('deny');
    }
  });

  it.each([
    ['contexts', { decision: 'allow', contexts: {} }],
    ['effects', { decision: 'allow', effects: [{ type: 42 }] }],
    ['mutation', { decision: 'allow', mutation: { input: {} } }],
    ['source', { decision: 'allow', source: 'external' }],
    ['callId', { decision: 'allow', callId: 42 }],
    ['reason', { decision: 'allow', reason: { text: 'bad' } }],
  ])('turns malformed canonical %s output into an adapter deny', async (_field, output) => {
    const result = await runHookPayload('pre-tool-use', {
      sessionId: 'session',
      toolCalls: [call('call-0')],
    }, () => output);

    expect(result.evaluations[0]).toMatchObject({
      callId: 'call-0',
      source: 'adapter',
      decision: 'deny',
    });
    expect(result.reduction.decision).toBe('deny');
  });

  it('contains throwing optional evaluation fields as an adapter deny', async () => {
    const output = {
      decision: 'allow',
      get contexts(): string[] {
        throw new Error('contexts getter failed');
      },
    };
    const result = await runHookPayload('pre-tool-use', {
      sessionId: 'session',
      toolCalls: [call('call-0')],
    }, () => output);

    expect(result.evaluations[0]).toMatchObject({
      callId: 'call-0',
      source: 'adapter',
      decision: 'deny',
    });
    expect(result.evaluations[0].reason).toContain('contexts getter failed');
    expect(result.reduction.decision).toBe('deny');
  });

  it('rejects malformed legacy optional fields instead of silently dropping them', async () => {
    const result = await runHookPayload('pre-tool-use', {
      sessionId: 'session',
      toolCalls: [call('call-0')],
    }, () => ({
      continue: true,
      effects: [{ type: 42 }],
    }));

    expect(result.evaluations[0]).toMatchObject({
      callId: 'call-0',
      source: 'adapter',
      decision: 'deny',
    });
    expect(result.reduction.decision).toBe('deny');
  });

  it('sanitizes valid optional evaluation fields into owned arrays and objects', () => {
    const contexts = ['one'];
    const effects = [{ type: 'audit', commitOn: 'always' as const }];
    const evaluation = sanitizeHookEvaluation({
      callId: 'call-0',
      source: 'handler',
      decision: 'allow',
      reason: 'safe',
      contexts,
      mutation: {
        input: { pattern: 'changed' },
        requirement: 'optional',
      },
      effects,
    });

    contexts.push('later');
    effects.push({ type: 'later', commitOn: 'always' });

    expect(evaluation).toMatchObject({
      callId: 'call-0',
      source: 'handler',
      decision: 'allow',
      reason: 'safe',
      contexts: ['one'],
      mutation: {
        input: { pattern: 'changed' },
        requirement: 'optional',
      },
      effects: [{ type: 'audit', commitOn: 'always' }],
    });
  });

  it('treats PermissionRequest decision.updatedInput as a required mutation', async () => {
    const result = await runHookPayload('permission-request', {
      sessionId: 'session',
      toolName: 'powershell',
      toolInput: { command: 'unsafe-command' },
    }, () => ({
      continue: true,
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: {
          behavior: 'allow',
          updatedInput: { command: 'sanitized-command' },
        },
      },
    }));

    expect(result.evaluations[0]).toMatchObject({
      decision: 'allow',
      mutation: {
        input: { command: 'sanitized-command' },
        requirement: 'required',
      },
    });
    expect(result.reduction).toMatchObject({
      decision: 'deny',
      retry: true,
      unchanged: true,
      mutations: [],
    });
    expect(result.reduction.reason).toContain('retry the call separately');
  });

  it('interprets legacy decisions, context, and mutation without executing effects', () => {
    const evaluation = interpretLegacyOutput('pre-tool-use', {
      continue: true,
      message: 'message',
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        additionalContext: 'context',
        updatedInput: { model: 'sonnet' },
      },
      effects: [{ type: 'state-write', commitOn: 'accepted' }],
    });

    expect(evaluation).toMatchObject({
      decision: 'allow',
      mutation: {
        input: { model: 'sonnet' },
        requirement: 'optional',
      },
      contexts: ['message', 'context'],
      effects: [{ type: 'state-write', commitOn: 'accepted' }],
    });
  });
});
