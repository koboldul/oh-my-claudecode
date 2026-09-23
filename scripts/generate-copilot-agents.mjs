#!/usr/bin/env node

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_DIR = join(ROOT, 'agents');
const OUTPUT_DIR = join(ROOT, 'agents-copilot');
const COPILOT_SOL_MODEL = 'gpt-6-sol';
const COPILOT_LUNA_MODEL = 'gpt-6-luna';
const COPILOT_REASONING_EFFORT = 'max';

function getCopilotModel(frontmatter) {
  const sourceModel = frontmatter.match(/^model:\s*(\S+)/m)?.[1] ?? '';
  return sourceModel.toLowerCase().includes('sonnet')
    ? COPILOT_LUNA_MODEL
    : COPILOT_SOL_MODEL;
}

function rewriteDescription(frontmatter) {
  return frontmatter.replace(
    /^description:\s*(.*)$/m,
    (_line, description) => `description: ${description
      .replace(/\s*\((?:Haiku|Sonnet|Opus)(,\s*READ-ONLY)?\)\s*$/i, (_match, readOnly) => (
        readOnly ? ' (READ-ONLY)' : ''
      ))
      .trim()}`,
  );
}

function rewriteCopilotBody(body) {
  return body
    .replace(/Task\(subagent_type=/g, 'Task(agent_type=')
    .replace(
      /Runtime effort inherits from the parent Claude Code session; no bundled agent frontmatter pins an effort override\./g,
      'Runtime effort is pinned to max by the Copilot agent profile unless an explicit per-call override is supplied.',
    )
    .replace(
      /Spawn explore agent \(model=haiku\)/g,
      'Spawn the explore agent without a model override',
    )
    .replace(
      /When invoked with model=haiku for lightweight style-only checks/g,
      'For lightweight style-only checks',
    )
    .replace(/\(haiku tier\)/gi, '(quick mode)')
    .replace(/\(sonnet tier\)/gi, '(comprehensive mode)')
    .replace(/\(opus tier\)/gi, '(deep mode)');
}

export function transformCopilotAgent(source, sourceName = 'agent.md') {
  const normalized = source.replace(/^\uFEFF/, '');
  const match = normalized.match(/^---\r?\n([\s\S]*?)\r?\n---(\r?\n[\s\S]*)$/);
  if (!match) {
    throw new Error(`Agent ${sourceName} has no YAML frontmatter`);
  }

  let frontmatter = rewriteDescription(match[1]);
  if (!/^model:\s*\S+/m.test(frontmatter)) {
    throw new Error(`Agent ${sourceName} has no model field`);
  }

  const copilotModel = getCopilotModel(frontmatter);
  frontmatter = frontmatter
    .replace(/^model:\s*\S+.*$/m, `model: ${copilotModel}`)
    .replace(/^reasoning-effort:\s*\S+.*\r?\n?/m, '')
    .replace(/^target:\s*\S+.*\r?\n?/m, '');

  const disallowedToolsMatch = frontmatter.match(/^disallowedTools:\s*(.*)$/m);
  if (disallowedToolsMatch) {
    const disallowedTools = disallowedToolsMatch[1]
      .split(',')
      .map((tool) => tool.trim().toLowerCase())
      .filter(Boolean);
    const onlyDirectEditTools = disallowedTools.every((tool) => ['write', 'edit'].includes(tool));
    if (!onlyDirectEditTools) {
      throw new Error(`Agent ${sourceName} has unsupported disallowedTools: ${disallowedToolsMatch[1]}`);
    }
    frontmatter = frontmatter.replace(/^disallowedTools:\s*.*\r?\n?/m, '');
  }

  const modelLine = `model: ${copilotModel}`;
  const toolsLine = disallowedToolsMatch
    ? '\ntools: [execute, read, search, agent, web, todo]'
    : '';
  frontmatter = frontmatter.replace(
    modelLine,
    `${modelLine}\nreasoning-effort: ${COPILOT_REASONING_EFFORT}\ntarget: github-copilot${toolsLine}`,
  );

  return `---\n${frontmatter}\n---${rewriteCopilotBody(match[2].replace(/\r\n/g, '\n'))}`;
}

export function generateCopilotAgents() {
  const sourceFiles = readdirSync(SOURCE_DIR)
    .filter((file) => file.endsWith('.md'))
    .sort();

  mkdirSync(OUTPUT_DIR, { recursive: true });
  const expectedOutputs = new Set();

  for (const sourceFile of sourceFiles) {
    const outputFile = sourceFile.replace(/\.md$/, '.agent.md');
    expectedOutputs.add(outputFile);
    const source = readFileSync(join(SOURCE_DIR, sourceFile), 'utf8');
    const output = transformCopilotAgent(source, sourceFile);
    const outputPath = join(OUTPUT_DIR, outputFile);
    if (!existsSync(outputPath) || readFileSync(outputPath, 'utf8') !== output) {
      writeFileSync(outputPath, output, 'utf8');
    }
  }

  for (const outputFile of readdirSync(OUTPUT_DIR)) {
    if (outputFile.endsWith('.agent.md') && !expectedOutputs.has(outputFile)) {
      rmSync(join(OUTPUT_DIR, outputFile));
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  generateCopilotAgents();
}
