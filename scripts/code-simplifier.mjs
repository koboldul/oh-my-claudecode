#!/usr/bin/env node

/**
 * OMC Code Simplifier Stop Hook (Node.js)
 *
 * Intercepts Stop events to automatically delegate recently modified source files
 * to the code-simplifier agent for cleanup and simplification.
 *
 * Opt-in via ~/.omc/config.json: { "codeSimplifier": { "enabled": true } }
 * Default: disabled (must explicitly opt in)
 */

import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  unlinkSync,
} from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { execFileSync } from 'child_process';
import {
  loadHookRuntime,
  surfaceOptionalHookFailure,
} from './lib/hook-runtime-loader.mjs';
import { readStdin } from './lib/stdin.mjs';
import { resolveOmcStateRoot } from './lib/state-root.mjs';
import { BOUNDED_GIT_TIMEOUT_MS } from './lib/bounded-git-timeout.mjs';

const DEFAULT_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs'];
const DEFAULT_MAX_FILES = 10;
const MARKER_FILENAME = 'code-simplifier-triggered.marker';

function readJsonFile(filePath) {
  try {
    if (!existsSync(filePath)) return null;
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function readOmcConfig() {
  return readJsonFile(join(homedir(), '.omc', 'config.json'));
}

function isEnabled(config) {
  return config?.codeSimplifier?.enabled === true;
}

function getModifiedFiles(cwd, extensions, maxFiles) {
  try {
    const output = execFileSync('git', ['diff', 'HEAD', '--name-only'], {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: BOUNDED_GIT_TIMEOUT_MS,
      windowsHide: true,
    });

    return output
      .trim()
      .split('\n')
      .filter((f) => f.trim().length > 0)
      .filter((f) => extensions.some((ext) => f.endsWith(ext)))
      .slice(0, maxFiles);
  } catch {
    return [];
  }
}

function buildMessage(files) {
  const fileList = files.map((f) => `  - ${f}`).join('\n');
  const fileArgs = files.join('\\n');
  return (
    `[CODE SIMPLIFIER] Recently modified files detected. Delegate to the ` +
    `code-simplifier agent to simplify the following files for clarity, ` +
    `consistency, and maintainability (without changing behavior):\n\n` +
    `${fileList}\n\n` +
    `Use: Task(subagent_type="oh-my-claudecode:code-simplifier", ` +
    `prompt="Simplify the recently modified files:\\n${fileArgs}")`
  );
}

async function processCodeSimplifierStop(data) {
  const cwd = data.cwd || data.directory || process.cwd();
  const stateDir = join(await resolveOmcStateRoot(cwd), 'state');
  const config = readOmcConfig();

  if (!isEnabled(config)) {
    return { continue: true };
  }

  const markerPath = join(stateDir, MARKER_FILENAME);

  // If already triggered this turn, clear marker and allow stop
  if (existsSync(markerPath)) {
    try {
      unlinkSync(markerPath);
    } catch {
      // ignore
    }
    return { continue: true };
  }

  const extensions = config?.codeSimplifier?.extensions ?? DEFAULT_EXTENSIONS;
  const maxFiles = config?.codeSimplifier?.maxFiles ?? DEFAULT_MAX_FILES;
  const files = getModifiedFiles(cwd, extensions, maxFiles);

  if (files.length === 0) {
    return { continue: true };
  }

  // Write trigger marker to prevent re-triggering within this turn cycle
  try {
    if (!existsSync(stateDir)) {
      mkdirSync(stateDir, { recursive: true });
    }
    writeFileSync(markerPath, new Date().toISOString(), 'utf-8');
  } catch {
    // best-effort — proceed even if marker write fails
  }

  return {
    continue: false,
    decision: 'block',
    reason: buildMessage(files),
  };
}

function describeStopRunFailure(result) {
  const failures = [];

  for (const issue of result.envelope.issues) {
    if (issue.severity === 'safety' || issue.batchSafety === true) {
      failures.push(issue.message || issue.code || 'hook input normalization failed');
    }
  }
  for (const evaluation of result.evaluations) {
    if (evaluation.source === 'adapter' && evaluation.decision === 'deny') {
      failures.push(evaluation.reason || 'legacy processor adapter failed');
    }
  }
  for (const decision of result.reduction.callDecisions) {
    if (decision.source === 'adapter' && decision.decision === 'deny') {
      failures.push(decision.reason || 'hook reduction failed');
    }
  }
  if (!['pass', 'deny'].includes(result.reduction.decision)) {
    failures.push(
      result.reduction.reason
      || `unexpected ${result.reduction.decision} reduction`,
    );
  }

  return failures.length > 0 ? [...new Set(failures)].join('; ') : undefined;
}

async function main() {
  try {
    const runtime = loadHookRuntime();
    const input = await readStdin();
    let legacyOutput;
    const result = await runtime.runHookJson(
      'stop',
      input,
      async (unit, envelope) => {
        legacyOutput = await processCodeSimplifierStop(
          runtime.buildLegacyProcessorInput(envelope, unit),
        );
        return legacyOutput;
      },
    );

    const failure = describeStopRunFailure(result);
    if (failure) throw new Error(failure);
    if (!legacyOutput || typeof legacyOutput !== 'object') {
      throw new Error('Code simplifier processor produced no legacy output.');
    }

    process.stdout.write(`${JSON.stringify(
      runtime.encodeLegacyCompatibleHookOutput(
        result.envelope,
        result.reduction,
        legacyOutput,
      ),
    )}\n`);
  } catch (error) {
    surfaceOptionalHookFailure(error, { hookName: 'code-simplifier' });
  }
}

const safetyTimeout = setTimeout(() => {
  surfaceOptionalHookFailure(
    new Error('Safety timeout reached after 10000ms.'),
    { hookName: 'code-simplifier' },
  );
  process.exit(0);
}, 10000);

void main().finally(() => {
  clearTimeout(safetyTimeout);
});
