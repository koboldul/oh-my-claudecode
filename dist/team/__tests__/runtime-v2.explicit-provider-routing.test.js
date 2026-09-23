import { describe, expect, it } from 'vitest';
import { resolveTaskAssignment } from '../runtime-v2.js';
import { buildResolvedRoutingSnapshot } from '../stage-router.js';
const resolvedRouting = buildResolvedRoutingSnapshot({});
describe('runtime-v2 explicit provider + role preservation', () => {
    // Regression: `1:antigravity:executor` must launch antigravity, not silently fall
    // back to the default executor primary (Claude) just because a role was supplied.
    it('keeps an explicit antigravity provider when a role suffix is used (no role routing config)', () => {
        const assignment = resolveTaskAssignment({ subject: 'Executor task', description: 'apply the implementation', role: 'executor' }, resolvedRouting, undefined, 'antigravity');
        expect(assignment).toEqual({ agentType: 'antigravity', model: '', role: 'executor' });
    });
    it('preserves other explicit CLI providers + role too (e.g. gemini:reviewer)', () => {
        const assignment = resolveTaskAssignment({ subject: 'Review', description: 'review the change', role: 'reviewer' }, resolvedRouting, undefined, 'gemini');
        expect(assignment.agentType).toBe('gemini');
        // 'reviewer' normalizes to the canonical 'code-reviewer' role.
        expect(assignment.role).toBe('code-reviewer');
    });
    it('still routes a role-only spec (default claude provider) normally', () => {
        const assignment = resolveTaskAssignment({ subject: 'Executor task', description: 'apply the implementation', role: 'executor' }, resolvedRouting, undefined, 'claude');
        expect(assignment.agentType).toBe('claude');
        expect(assignment.role).toBe('executor');
    });
    it('preserves an explicit Copilot reviewer provider without native-agent fallback', () => {
        const assignment = resolveTaskAssignment({ subject: 'Review', description: 'review the change', role: 'code-reviewer' }, resolvedRouting, undefined, 'copilot');
        expect(assignment).toEqual({
            agentType: 'copilot',
            model: '',
            role: 'code-reviewer',
        });
    });
    // A routed provider is authoritative: binary availability is validated later,
    // before any worker launch, instead of silently rewriting provider identity.
    it('propagates routed Copilot model and effort regardless of binary availability', () => {
        const routed = buildResolvedRoutingSnapshot({
            team: { roleRouting: { critic: { provider: 'copilot' } } },
        });
        const assignment = resolveTaskAssignment({ subject: 'Critique', description: 'challenge the plan', role: 'critic' }, routed, { critic: { provider: 'copilot' } }, 'claude');
        expect(assignment).toMatchObject({
            agentType: 'copilot',
            model: 'gpt-5.6-sol',
            reasoningEffort: 'max',
            role: 'critic',
        });
    });
});
//# sourceMappingURL=runtime-v2.explicit-provider-routing.test.js.map