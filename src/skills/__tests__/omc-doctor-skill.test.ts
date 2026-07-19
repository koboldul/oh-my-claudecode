import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('omc-doctor skill (issue #2254)', () => {
  it('documents CLAUDE.md OMC version drift check against cached plugin version', () => {
    const skillPath = join(process.cwd(), 'skills', 'omc-doctor', 'SKILL.md');
    const content = readFileSync(skillPath, 'utf8');

    expect(content).toContain('CLAUDE.md OMC version:');
    expect(content).toContain('OMC version source:');
    expect(content).toContain('Latest cached plugin version:');
    expect(content).toContain('VERSION DRIFT: CLAUDE.md and plugin versions differ');
    expect(content).toContain('VERSION CHECK SKIPPED: missing CLAUDE marker or plugin cache');
    expect(content).toContain('VERSION MATCH: CLAUDE and plugin cache are aligned');
    expect(content).toContain('CLAUDE-*.md');
    expect(content).toContain('deterministic companion');
    expect(content).toContain('scanned deterministic CLAUDE sources');
    expect(content).not.toContain('!==');
    expect(content).toContain('If `CLAUDE.md OMC version` != `Latest cached plugin version`: WARN - version drift detected');
  });
});


describe('omc-doctor skill Ralph Ruby dependency check (issue #2969)', () => {
  it('documents a narrow Ruby check with actionable Ralph guidance', () => {
    const skillPath = join(process.cwd(), 'skills', 'omc-doctor', 'SKILL.md');
    const content = readFileSync(skillPath, 'utf8');

    expect(content).toContain('Check Ralph Ruby Dependency');
    expect(content).toContain('Ruby for Ralph: MISSING');
    expect(content).toContain('Ralph workflows require Ruby');
    expect(content).toContain('sudo apt update && sudo apt install ruby-full');
    expect(content).toContain('Ralph Ruby Dependency');
  });
});

describe('omc-doctor skill package version diagnostic (issue #2981)', () => {
  it('checks the canonical published npm package for latest version', () => {
    const skillPath = join(process.cwd(), 'skills', 'omc-doctor', 'SKILL.md');
    const content = readFileSync(skillPath, 'utf8');

    expect(content).toContain('npm view oh-my-claude-sisyphus version');
    expect(content).not.toContain('npm view oh-my-claudecode version');
  });
});

describe('omc-doctor skill GitHub Copilot CLI awareness', () => {
  const skillPath = join(process.cwd(), 'skills', 'omc-doctor', 'SKILL.md');
  const content = readFileSync(skillPath, 'utf8');

  it('detects both Claude Code and Copilot CLI hosts before host-specific checks', () => {
    expect(content).toContain('Detect Host Environment');
    expect(content).toContain('Claude Code install:');
    expect(content).toContain('Copilot CLI install:');
    // Copilot plugins live under ~/.copilot/installed-plugins, honoring COPILOT_HOME.
    expect(content).toContain('installed-plugins');
    expect(content).toContain('COPILOT_HOME');
  });

  it('has a dedicated Copilot CLI checks section with install/enabled detection', () => {
    expect(content).toContain('## GitHub Copilot CLI checks');
    expect(content).toContain('oh-my-claudecode@omc');
    expect(content).toContain('/plugin install oh-my-claudecode');
    // Copilot recognizes Claude event names; never add camelCase mirrors (double-fire).
    expect(content).toContain('camelCase mirror events');
  });

  it('documents the verified Copilot CLI contract and forward-version warning policy', () => {
    expect(content).toContain('1.0.72-1');
    expect(content).toContain('omc doctor copilot');
    expect(content).toContain('earlier version: CRITICAL - unsupported');
    expect(content).toContain('later version: WARN - compatibility is unverified, not failed');
    expect(content).toContain('upgrade GitHub Copilot CLI');
  });

  it('describes observed subagentStart behavior without claiming full persistence parity', () => {
    expect(content).toContain('camelCase `subagentStart`');
    expect(content).toContain('remains partial parity');
    expect(content).not.toContain('persistence loop work the same as under Claude Code');
    expect(content).not.toContain('The only unsupported event is `SubagentStart`');
  });

  it('does not flag Claude-only artifacts for a Copilot-only install', () => {
    expect(content).toContain('do **not** report a missing');
    // Restart guidance must cover Copilot CLI, not just Claude Code.
    expect(content).toContain('restart Copilot CLI');
  });

  it('keeps the skill free of strict-inequality tokens the doctor test guards against', () => {
    // The existing drift-check test asserts no '!==' in the file; the Copilot
    // additions must preserve that (JSONC reads use full-line comment stripping).
    expect(content).not.toContain('!==');
  });
});
