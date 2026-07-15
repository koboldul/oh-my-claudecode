import { describe, expect, it } from 'vitest';

import { resolveTaskAssignment } from '../runtime-v2.js';
import { buildResolvedRoutingSnapshot } from '../stage-router.js';
import type { CliAgentType } from '../model-contract.js';

const resolvedRouting = buildResolvedRoutingSnapshot({});
const binaries: Partial<Record<CliAgentType, string>> = {
  claude: '/usr/bin/claude',
  gemini: '/usr/bin/gemini',
  codex: '/usr/bin/codex',
  antigravity: '/usr/bin/agy',
  copilot: '/usr/bin/copilot',
};

describe('runtime-v2 explicit provider + role preservation', () => {
  // Regression: `1:antigravity:executor` must launch antigravity, not silently fall
  // back to the default executor primary (Claude) just because a role was supplied.
  it('keeps an explicit antigravity provider when a role suffix is used (no role routing config)', () => {
    const assignment = resolveTaskAssignment(
      { subject: 'Executor task', description: 'apply the implementation', role: 'executor' },
      resolvedRouting,
      undefined,
      binaries,
      'antigravity',
    );
    expect(assignment).toEqual({ agentType: 'antigravity', model: '', role: 'executor' });
  });

  it('preserves other explicit CLI providers + role too (e.g. gemini:reviewer)', () => {
    const assignment = resolveTaskAssignment(
      { subject: 'Review', description: 'review the change', role: 'reviewer' },
      resolvedRouting,
      undefined,
      binaries,
      'gemini',
    );
    expect(assignment.agentType).toBe('gemini');
    // 'reviewer' normalizes to the canonical 'code-reviewer' role.
    expect(assignment.role).toBe('code-reviewer');
  });

  it('still routes a role-only spec (default claude provider) normally', () => {
    const assignment = resolveTaskAssignment(
      { subject: 'Executor task', description: 'apply the implementation', role: 'executor' },
      resolvedRouting,
      undefined,
      binaries,
      'claude',
    );
    expect(assignment.agentType).toBe('claude');
    expect(assignment.role).toBe('executor');
  });

  it('preserves an explicit Copilot reviewer provider without native-agent fallback', () => {
    const assignment = resolveTaskAssignment(
      { subject: 'Review', description: 'review the change', role: 'code-reviewer' },
      resolvedRouting,
      undefined,
      binaries,
      'copilot',
    );
    expect(assignment).toEqual({
      agentType: 'copilot',
      model: '',
      role: 'code-reviewer',
    });
  });

  it('propagates routed Copilot effort and falls back to the immutable Claude tuple when unavailable', () => {
    const routed = buildResolvedRoutingSnapshot({
      team: { roleRouting: { critic: { provider: 'copilot' } } },
    });
    const available = resolveTaskAssignment(
      { subject: 'Critique', description: 'challenge the plan', role: 'critic' },
      routed,
      { critic: { provider: 'copilot' } },
      binaries,
      'claude',
    );
    expect(available).toMatchObject({
      agentType: 'copilot',
      model: 'gpt-5.6-sol',
      reasoningEffort: 'max',
      role: 'critic',
    });

    const unavailable = resolveTaskAssignment(
      { subject: 'Critique', description: 'challenge the plan', role: 'critic' },
      routed,
      { critic: { provider: 'copilot' } },
      { claude: '/usr/bin/claude' },
      'claude',
    );
    expect(unavailable.agentType).toBe('claude');
    expect(unavailable.reasoningEffort).toBeUndefined();
  });
});
