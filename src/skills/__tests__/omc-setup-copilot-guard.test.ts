import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('omc-setup skill Copilot host guard', () => {
  const skillPath = join(process.cwd(), 'skills', 'omc-setup', 'SKILL.md');
  const content = readFileSync(skillPath, 'utf8');

  it('places an explicit Copilot Host Guard before flag parsing', () => {
    const guardIndex = content.indexOf('## Copilot Host Guard');
    const flagParsingIndex = content.indexOf('## Flag Parsing');
    expect(guardIndex).toBeGreaterThan(-1);
    expect(flagParsingIndex).toBeGreaterThan(-1);
    expect(guardIndex).toBeLessThan(flagParsingIndex);
  });

  it('detects the Copilot host using the same signals as run.cjs/session-start.mjs', () => {
    expect(content).toContain('OMC_HOST=copilot');
    expect(content).toContain('COPILOT_CLI');
    expect(content).toContain('COPILOT_AGENT_SESSION_ID');
  });

  it('does not touch Claude-only surfaces in a Copilot session unless explicitly asked', () => {
    expect(content).toContain('do **not**');
    expect(content).toContain('Touch `.claude`, `~/.claude`, or any `CLAUDE.md` file');
    expect(content).toContain('Configure HUD/statusLine');
    expect(content).toContain('unless the user **explicitly asks to configure Claude Code too**');
  });

  it('tells Copilot users plugin installation is sufficient and how to verify/diagnose/update', () => {
    expect(content).toContain('Plugin installation is sufficient');
    expect(content).toContain('/env');
    expect(content).toContain('/oh-my-claudecode:setup doctor');
    expect(content).toContain('copilot plugin update oh-my-claudecode');
    expect(content).toContain('restart Copilot CLI');
  });
});

describe('setup skill routing respects the Copilot host guard', () => {
  const skillPath = join(process.cwd(), 'skills', 'setup', 'SKILL.md');
  const content = readFileSync(skillPath, 'utf8');

  it('does not imply Claude Code setup is required for a no-argument invocation under Copilot', () => {
    expect(content).toContain('Copilot Host Guard');
    expect(content).toContain('applies its Copilot Host Guard rather than assuming Claude Code setup is required');
  });

  it('documents the Copilot-only verify/diagnose/update path in the routing notes', () => {
    expect(content).toContain('/oh-my-claudecode:setup doctor');
    expect(content).toContain('copilot plugin update oh-my-claudecode');
  });
});
