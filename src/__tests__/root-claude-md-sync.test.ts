import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Regression test for stale root CLAUDE.md guidance: root CLAUDE.md must
 * always be byte-identical to docs/CLAUDE.md (the canonical guidance
 * source), including the OMC:VERSION marker. Prior to the host-isolation
 * fix, scripts/sync-version.sh and scripts/release.ts only synced the
 * version marker in docs/CLAUDE.md and never touched root CLAUDE.md, so it
 * silently drifted (root stayed at v4.9.1 while docs/CLAUDE.md advanced to
 * v4.15.4). release-boundary.mjs now fails release closed on this drift too
 * (see src/__tests__/release-boundary.test.ts).
 */
describe('root CLAUDE.md stays synchronized with docs/CLAUDE.md', () => {
  const ROOT = resolve(__dirname, '..', '..');

  it('is byte-identical to docs/CLAUDE.md', () => {
    const rootContent = readFileSync(resolve(ROOT, 'CLAUDE.md'), 'utf-8');
    const docsContent = readFileSync(resolve(ROOT, 'docs', 'CLAUDE.md'), 'utf-8');
    expect(rootContent).toBe(docsContent);
  });

  it('advertises the same package.json version marker', () => {
    const rootContent = readFileSync(resolve(ROOT, 'CLAUDE.md'), 'utf-8');
    const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8'));
    expect(rootContent).toContain(`<!-- OMC:VERSION:${pkg.version} -->`);
  });

  it('carries the host-isolation guard for GitHub Copilot CLI', () => {
    const rootContent = readFileSync(resolve(ROOT, 'CLAUDE.md'), 'utf-8');
    expect(rootContent).toContain('<host_isolation>');
    expect(rootContent).toContain('OMC_HOST=copilot');
    expect(rootContent).toContain('COPILOT_CLI');
    expect(rootContent).toContain('COPILOT_AGENT_SESSION_ID');
    expect(rootContent).toContain('unless the user explicitly asks to configure Claude Code too');
  });
});
