#!/usr/bin/env node

/**
 * SessionStart Hook: stale-run reporter (the unattended-run watchdog).
 *
 * Observes stale unattended-mode state and reports it as advisory context.
 * It never mutates state, resumes a run, or infers approval.
 */

import { readStdin } from './lib/stdin.mjs';
import { resolveOmcStateRoot } from './lib/state-root.mjs';
import { findStaleRuns } from './lib/run-reaper.mjs';
import {
  describeHookRunFailure,
  encodeLegacyCompatibleHookOutput,
  loadHookRuntime,
  surfaceOptionalHookFailure,
} from './lib/hook-runtime-loader.mjs';

async function processStaleRunReporter(data) {
  const directory = data.directory || process.cwd();
  const sessionId = data.sessionId || undefined;

  let stateRoot;
  try {
    stateRoot = await resolveOmcStateRoot(directory);
  } catch {
    stateRoot = null;
  }
  if (!stateRoot) {
    return { continue: true, suppressOutput: true };
  }

  const stale = await findStaleRuns({
    stateRoot,
    excludeSessionId: sessionId,
  });
  if (stale.length === 0) {
    return { continue: true, suppressOutput: true };
  }

  const lines = [
    `[STALE RUN] ${stale.length} unattended-run state file(s) look stale — likely a run whose process died mid-flight:`,
    ...stale.map(
      (entry) =>
        `- ${entry.mode}${entry.sessionId ? ` (session ${entry.sessionId})` : ''}: active for ~${entry.ageHours}h — ${entry.path}`,
    ),
    'Nothing was changed automatically. To reclaim: run /oh-my-claudecode:cancel to clean up the state, or re-enter the mode to resume from its artifacts. Re-kicking is a human decision.',
  ];

  return {
    continue: true,
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: lines.join('\n'),
    },
  };
}

async function main() {
  try {
    const input = await readStdin(3000);
    const runtime = loadHookRuntime();
    let legacyOutput;
    const result = await runtime.runHookJson(
      'session-start',
      input,
      async (unit, envelope) => {
        legacyOutput = await processStaleRunReporter(
          runtime.buildLegacyProcessorInput(envelope, unit),
        );
        return legacyOutput;
      },
    );

    const failure = describeHookRunFailure(runtime, result);
    if (failure) throw new Error(failure);

    console.log(JSON.stringify(
      encodeLegacyCompatibleHookOutput(
        runtime,
        result,
        legacyOutput,
      ),
    ));
  } catch (error) {
    surfaceOptionalHookFailure(error, {
      hookName: 'stale-run-reporter',
    });
  }
}

void main();
