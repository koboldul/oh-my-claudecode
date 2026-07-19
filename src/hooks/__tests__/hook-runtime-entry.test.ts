import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  buildLegacyProcessorInput,
  runHookPayload,
  type CanonicalHookEnvelope,
  type HookExecutionUnit,
  type LegacyProcessorInput,
} from '../hook-runtime-entry.js';

const FIXTURE_ROOT = join(
  process.cwd(),
  'src',
  '__tests__',
  'fixtures',
  'hooks',
);

function loadFixture(host: string, name: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(join(FIXTURE_ROOT, host, `${name}.json`), 'utf8'),
  ) as Record<string, unknown>;
}

interface AgentAdapterCase {
  host: string;
  fixture: string;
  hookType: 'subagent-start' | 'subagent-stop';
  expected: {
    host: 'claude' | 'copilot';
    agentId?: string;
    agentName?: string;
    agentDisplayName?: string;
    agentDescription?: string;
  };
}

const AGENT_ADAPTER_CASES: AgentAdapterCase[] = [
  {
    host: 'copilot-1.0.72-1',
    fixture: 'subagentStart',
    hookType: 'subagent-start',
    expected: {
      host: 'copilot',
      agentName: '<agent-name>',
      agentDisplayName: '<agent-display-name>',
      agentDescription: '<agent-description>',
    },
  },
  {
    host: 'copilot-1.0.72-1',
    fixture: 'subagentStop',
    hookType: 'subagent-stop',
    expected: {
      host: 'copilot',
      agentName: '<agent-name>',
      agentDisplayName: '<agent-display-name>',
    },
  },
  {
    host: 'claude',
    fixture: 'SubagentStart',
    hookType: 'subagent-start',
    expected: {
      host: 'claude',
      agentId: '<agent-id>',
      agentName: '<agent-type>',
    },
  },
  {
    host: 'claude',
    fixture: 'SubagentStop',
    hookType: 'subagent-stop',
    expected: {
      host: 'claude',
      agentId: '<agent-id>',
      agentName: '<agent-type>',
    },
  },
];

describe('hook runtime entry legacy processor adapter', () => {
  it('builds one canonical legacy processor input for every Copilot batch call', async () => {
    const received: LegacyProcessorInput[] = [];
    const processor = vi.fn((
      unit: HookExecutionUnit,
      envelope: CanonicalHookEnvelope,
    ) => {
      received.push(buildLegacyProcessorInput(envelope, unit));
      return { decision: 'pass' as const };
    });

    const result = await runHookPayload('pre-tool-use', {
      ...loadFixture('copilot-1.0.72-1', 'preToolUse'),
      timestamp: 1700000000000,
      transcriptPath: '<transcript-path>',
    }, processor);

    expect(processor).toHaveBeenCalledTimes(2);
    expect(result.evaluations).toHaveLength(2);
    expect(received).toMatchObject([
      {
        host: 'copilot',
        contract: 'copilot-1.0.72-1',
        hookType: 'pre-tool-use',
        sessionId: '<session-id>',
        directory: '<cwd>',
        transcriptPath: '<transcript-path>',
        timestamp: 1700000000000,
        originalIndex: 0,
        callId: '<tool-call-id-1>',
        toolName: 'Glob',
        nativeToolName: 'glob',
        canonicalToolName: 'Glob',
        toolInput: {
          pattern: '<glob-pattern>',
          paths: '<path-1>',
        },
      },
      {
        host: 'copilot',
        contract: 'copilot-1.0.72-1',
        hookType: 'pre-tool-use',
        sessionId: '<session-id>',
        directory: '<cwd>',
        transcriptPath: '<transcript-path>',
        timestamp: 1700000000000,
        originalIndex: 1,
        callId: '<tool-call-id-2>',
        toolName: 'Grep',
        nativeToolName: 'rg',
        canonicalToolName: 'Grep',
        toolInput: {
          pattern: '<search-pattern>',
          output_mode: 'content',
          head_limit: 20,
        },
      },
    ]);
    expect(received[0].eventPayload).toEqual({ timestamp: 1700000000000 });
  });

  it('parses serialized Copilot toolArgs before invoking a legacy processor', async () => {
    const received: LegacyProcessorInput[] = [];
    const processor = vi.fn((
      unit: HookExecutionUnit,
      envelope: CanonicalHookEnvelope,
    ) => {
      received.push(buildLegacyProcessorInput(
        envelope,
        unit,
        { toolNameSource: 'native' },
      ));
      return { decision: 'pass' as const };
    });

    const result = await runHookPayload(
      'post-tool-use-failure',
      loadFixture('copilot-1.0.72-1', 'postToolUseFailure'),
      processor,
    );

    expect(processor).toHaveBeenCalledTimes(1);
    expect(result.evaluations).toHaveLength(1);
    expect(received[0]).toMatchObject({
      host: 'copilot',
      hookType: 'post-tool-use-failure',
      sessionId: '<session-id>',
      directory: '<cwd>',
      timestamp: 1700000000000,
      toolError: '<tool-error>',
      originalIndex: 0,
      toolName: 'glob',
      nativeToolName: 'glob',
      canonicalToolName: 'Glob',
      toolInput: {
        pattern: '<glob-pattern>',
        paths: '<path>',
      },
      rawToolArgs:
        '{"pattern":"<glob-pattern>","paths":"<path>"}',
    });
  });

  it.each(AGENT_ADAPTER_CASES)(
    'flattens canonical agent fields for non-tool $host/$fixture input',
    async ({ host, fixture, hookType, expected }) => {
      const received: LegacyProcessorInput[] = [];
      const processor = vi.fn((
        unit: HookExecutionUnit,
        envelope: CanonicalHookEnvelope,
      ) => {
        received.push(buildLegacyProcessorInput(envelope, unit));
        return { decision: 'pass' as const };
      });

      const result = await runHookPayload(
        hookType,
        loadFixture(host, fixture),
        processor,
      );

      expect(processor).toHaveBeenCalledTimes(1);
      expect(result.evaluations).toHaveLength(1);
      expect(received[0]).toMatchObject({
        hookType,
        sessionId: '<session-id>',
        directory: '<cwd>',
        transcriptPath: '<transcript-path>',
        originalIndex: 0,
        ...expected,
        agent: expect.objectContaining({
          ...(expected.agentId !== undefined ? { id: expected.agentId } : {}),
          ...(expected.agentName !== undefined
            ? { name: expected.agentName }
            : {}),
          ...(expected.agentDisplayName !== undefined
            ? { displayName: expected.agentDisplayName }
            : {}),
          ...(expected.agentDescription !== undefined
            ? { description: expected.agentDescription }
            : {}),
        }),
      });
      expect(received[0]).not.toHaveProperty('toolName');
      expect(received[0]).not.toHaveProperty('toolInput');
    },
  );
});
