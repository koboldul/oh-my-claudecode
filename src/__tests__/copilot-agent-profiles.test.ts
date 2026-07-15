import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const SOURCE_DIR = join(ROOT, 'agents');
const COPILOT_DIR = join(ROOT, 'agents-copilot');
const GENERATOR = join(ROOT, 'scripts', 'generate-copilot-agents.mjs');

describe('Copilot-specific agent profiles', () => {
  it('routes Claude and Copilot hosts to separate agent directories', () => {
    const claudeManifest = JSON.parse(
      readFileSync(join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8'),
    ) as Record<string, unknown>;
    const copilotManifest = JSON.parse(
      readFileSync(join(ROOT, 'plugin.json'), 'utf8'),
    ) as Record<string, unknown>;

    expect(claudeManifest.agents).toBe('./agents/');
    expect(copilotManifest.agents).toBe('./agents-copilot/');
    expect(copilotManifest.version).toBe(claudeManifest.version);
  });

  it('keeps every Copilot profile generated from its Claude source profile', () => {
    const beforeGeneration = Object.fromEntries(
      readdirSync(COPILOT_DIR)
        .filter((file) => file.endsWith('.agent.md'))
        .map((file) => [file, readFileSync(join(COPILOT_DIR, file), 'utf8')]),
    );
    execFileSync(process.execPath, [GENERATOR], { cwd: ROOT });

    const sourceFiles = readdirSync(SOURCE_DIR)
      .filter((file) => file.endsWith('.md'))
      .sort();
    const copilotFiles = readdirSync(COPILOT_DIR)
      .filter((file) => file.endsWith('.agent.md'))
      .sort();

    expect(copilotFiles).toEqual(
      sourceFiles.map((file) => file.replace(/\.md$/, '.agent.md')),
    );

    for (const sourceFile of sourceFiles) {
      const source = readFileSync(join(SOURCE_DIR, sourceFile), 'utf8');
      const outputFile = sourceFile.replace(/\.md$/, '.agent.md');
      const generated = readFileSync(join(COPILOT_DIR, outputFile), 'utf8');

      expect(generated).toBe(beforeGeneration[outputFile]);
      expect(generated).toMatch(/^model: gpt-5\.6-sol$/m);
      expect(generated).toMatch(/^reasoning-effort: max$/m);
      expect(generated).toMatch(/^target: github-copilot$/m);
      expect(generated).not.toMatch(/^model: (?:haiku|sonnet|opus|fable)$/m);
      expect(generated).not.toContain('Runtime effort inherits from the parent Claude Code session');
      expect(generated).not.toContain('subagent_type');
      expect(generated).not.toContain('model=haiku');
      expect(generated).not.toMatch(/\((?:haiku|sonnet|opus) tier\)/i);
      if (/^disallowedTools:\s*(?:Write,\s*Edit|Edit,\s*Write)$/m.test(source)) {
        expect(generated).toMatch(/^tools: \[execute, read, search, agent, web, todo\]$/m);
        expect(generated).not.toMatch(/^disallowedTools:/m);
      }
    }
  });
});
