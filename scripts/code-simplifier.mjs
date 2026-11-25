#!/usr/bin/env node

/**
 * OMC Code Simplifier Stop Hook (Node.js)
 *
 * Intercepts Stop events to automatically delegate recently modified source files
 * to the code-simplifier agent for cleanup and simplification.
 *
 * Opt-in via the global OMC config.json: { "codeSimplifier": { "enabled": true } }
 * ($OMC_HOME/config.json, else ${XDG_CONFIG_HOME:-~/.config}/omc/config.json on
 * Linux/Unix, with legacy ~/.omc/config.json as the fallback)
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
import { jevNoulOf, jevStateIds, recordJevApplied, recordJevShadow, setJevHookContext, setJevSessionId } from './lib/jev-shadow.mjs';
import { loadContextText } from './lib/context-text-loader.mjs';

// Opt-in text cleaning (OMC_CONTEXT_TEXT_SANITIZE=1 or true): file names from git are escaped, not cleaned, only when the switch is on.
let contextText = null;
const DEFAULT_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs'];
const DEFAULT_MAX_FILES = 10;
const MARKER_FILENAME = 'code-simplifier-triggered.marker';
const SIMPLIFIER_TRIGGER_QUESTIONS = {
  simplification_worthy: {
    type: 'noul',
    instructions: 'Is this change simplification-worthy enough to inject the simplifier delegation?',
    criteria: {
      true: 'The change would benefit from a simplification pass (duplication, speculative flexibility, over-abstraction)',
      false: 'Change is already minimal or not code',
    },
  },
};

// OMC_JEV_SIMPLIFIER_APPLY=1 lets an active `simplifier-trigger` answer skip the reminder
// when the probability of "yes" is below this value. Off by default.
const SIMPLIFIER_SKIP_BELOW = 0.5;

function isSimplifierApplyEnabled(env = process.env) {
  return ['1', 'true'].includes(String(env.OMC_JEV_SIMPLIFIER_APPLY ?? '').trim().toLowerCase());
}

function readJsonFile(filePath) {
  try {
    if (!existsSync(filePath)) return null;
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

// Mirrors src/utils/paths.ts:getGlobalOmcConfigCandidates('config.json'):
// OMC_HOME alone when set; otherwise the XDG config root on Linux/Unix, then
// the legacy ~/.omc fallback. The first file that exists wins.
function getGlobalOmcConfigCandidates() {
  const explicitRoot = process.env.OMC_HOME?.trim();
  if (explicitRoot) return [join(explicitRoot, 'config.json')];

  const home = process.platform === 'win32'
    ? process.env.USERPROFILE || process.env.HOME || homedir()
    : process.env.HOME || homedir();
  const legacy = join(home, '.omc', 'config.json');
  if (process.platform === 'win32' || process.platform === 'darwin') return [legacy];

  const configHome = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
  return [...new Set([join(configHome, 'omc', 'config.json'), legacy])];
}

function readOmcConfig() {
  for (const configPath of getGlobalOmcConfigCandidates()) {
    if (existsSync(configPath)) return readJsonFile(configPath);
  }
  return null;
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
  // With the text cleaning switch on, a name that contains a character the cleaning removes is written as a double-quoted
  // JSON string with \uXXXX escapes; every other name stays exactly as git printed it. A cleaned name would point the
  // simplifier at a file that does not exist.
  const shown = contextText ? files.map((f) => contextText.escapeIdentifier(f)) : files;
  const escaped = shown.some((f, index) => f !== files[index]);
  const decodeRule = 'a name in double quotes is a JSON string: its \\uXXXX escapes stand for characters that are not shown; decode them to get the exact name';
  const escapedNote = escaped ? `Note: ${decodeRule}.\n\n` : '';
  const fileList = shown.map((f) => `  - ${f}`).join('\n');
  const fileArgs = shown.join('\\n');
  return (
    `[CODE SIMPLIFIER] Recently modified files detected. Delegate to the ` +
    `code-simplifier agent to simplify the following files for clarity, ` +
    `consistency, and maintainability (without changing behavior):\n\n` +
    `${fileList}\n\n` +
    escapedNote +
    `Use: Task(subagent_type="oh-my-claudecode:code-simplifier", ` +
    `prompt="Simplify the recently modified files${escaped ? ` (${decodeRule})` : ''}:\\n${fileArgs}")`
  );
}

async function processCodeSimplifierStop(data) {
  setJevSessionId(data.sessionId, data.agentId);
  await setJevHookContext({ ...data, agent_type: data.agentName });
  contextText = await loadContextText();
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

  const jevResult = recordJevShadow({
    point: 'simplifier-trigger',
    state: { ...jevStateIds({ cwd }), files, source: 'code-simplifier-stop' },
    questions: SIMPLIFIER_TRIGGER_QUESTIONS,
    heuristic: true,
    permissionMode: data.permission_mode,
  });

  if (isSimplifierApplyEnabled()) {
    const noul = jevNoulOf(jevResult, 'simplification_worthy');
    if (noul !== undefined && noul < SIMPLIFIER_SKIP_BELOW) {
      recordJevApplied('simplifier-trigger', {
        action: { from: 'remind', to: 'skip', noul },
      });
      return { continue: true };
    }
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
