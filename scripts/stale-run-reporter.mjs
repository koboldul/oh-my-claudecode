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
import { loadContextText } from './lib/context-text-loader.mjs';

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

  const crashed = stale.filter((entry) => !entry.awaitingConfirmation);
  const waiting = stale.filter((entry) => entry.awaitingConfirmation);

  // State-file fields are data. With the switch on the mode, the session id and the path are identifiers: each is written
  // exactly (escaped, not cleaned; a written form over 200 characters, the path over 500, is replaced by a notice), and the
  // other fields are cleaned to one line.
  const sanitize = await loadContextText();
  const field = (value, max) => (sanitize ? sanitize.cleanHostText(value, max) : value);
  const identifier = (value, max) => (sanitize ? sanitize.escapeIdentifier(value, max) : value);
  const lines = [];
  if (crashed.length > 0) {
    lines.push(
      `[STALE RUN] ${crashed.length} unattended-run state file(s) look stale — likely a run whose process died mid-flight:`,
      ...crashed.map(
        (entry) =>
          `- ${identifier(entry.mode, 200)}${entry.sessionId ? ` (session ${identifier(entry.sessionId, 200)})` : ''}: active for ~${field(entry.ageHours, 200)}h — ${identifier(entry.path, 500)}`,
      ),
      'Nothing was changed automatically. To reclaim: run /oh-my-claudecode:cancel to clean up the state, or re-enter the mode to resume from its artifacts. Re-kicking is a human decision.',
    );
  }
  if (waiting.length > 0) {
    lines.push(
      `[AWAITING CONFIRMATION] ${waiting.length} unattended-run state file(s) are waiting for your confirmation and show no recent activity:`,
      ...waiting.map((entry) => {
        const since = entry.awaitingConfirmationSetAt
          ? ` since ${field(entry.awaitingConfirmationSetAt, 200)}`
          : '';
        return `- ${identifier(entry.mode, 200)}${entry.sessionId ? ` (session ${identifier(entry.sessionId, 200)})` : ''}: waiting for your confirmation${since}, no activity for ~${field(entry.ageHours, 200)}h — ${identifier(entry.path, 500)}`;
      }),
      'Nothing was changed automatically. A parked prompt is not proof the run is still alive; answer it in its session, or run /oh-my-claudecode:cancel if it is gone. Re-kicking is a human decision.',
    );
  }

  // The number of runs is not bounded, so with the switch on the whole message is also bounded where it is emitted.
  const output = {
    continue: true,
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: lines.join('\n'),
    },
  };
  return sanitize ? sanitize.cleanHookOutput(output) : output;
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
