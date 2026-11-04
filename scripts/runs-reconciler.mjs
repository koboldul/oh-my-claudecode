#!/usr/bin/env node

/**
 * SessionStart Hook: runs reconciler.
 *
 * Reports ended unattended runs whose closeout was never written.
 * Advisory only: it never mutates state or re-runs work.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { readStdin } from './lib/stdin.mjs';
import { resolveOmcStateRoot } from './lib/state-root.mjs';
import {
  describeHookRunFailure,
  encodeLegacyCompatibleHookOutput,
  loadHookRuntime,
  surfaceOptionalHookFailure,
} from './lib/hook-runtime-loader.mjs';

const LOOKBACK_MS = 7 * 24 * 3600_000;

function readLedgerTail(stateRoot, maxLines = 200) {
  const path = join(stateRoot, 'state', 'runs', 'ledger.jsonl');
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return [];
  }

  const lines = raw
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .slice(-maxLines);
  const entries = [];
  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      if (entry && entry.run && entry.event) entries.push(entry);
    } catch {
      // Skip malformed ledger lines.
    }
  }
  return entries;
}

function reconcile(entries) {
  const now = Date.now();
  const lastEnd = new Map();
  for (const entry of entries) {
    const key = `${entry.run}:${entry.sessionId ?? 'legacy'}`;
    if (entry.event === 'end') lastEnd.set(key, entry);
  }

  const findings = [];
  for (const entry of lastEnd.values()) {
    if (entry.closeoutWritten !== false) continue;
    const timestamp = Date.parse(entry.ts);
    if (!Number.isFinite(timestamp) || now - timestamp > LOOKBACK_MS) continue;
    findings.push(entry);
  }
  findings.sort((left, right) => Date.parse(left.ts) - Date.parse(right.ts));
  return findings;
}

async function processRunsReconciler(data) {
  const directory = data.directory || process.cwd();

  let stateRoot;
  try {
    stateRoot = await resolveOmcStateRoot(directory);
  } catch {
    stateRoot = null;
  }
  if (!stateRoot) {
    return { continue: true, suppressOutput: true };
  }

  const findings = reconcile(readLedgerTail(stateRoot));
  if (findings.length === 0) {
    return { continue: true, suppressOutput: true };
  }

  const lines = [
    `[RUN RECONCILIATION] ${findings.length} unattended run(s) ended without a notepad closeout — the run's friction was not captured:`,
    ...findings.map(
      (entry) =>
        `- ${entry.run}${entry.sessionId ? ` (session ${entry.sessionId})` : ''}: ended ${entry.ts} without a notepad closeout`,
    ),
    'Nothing was changed automatically. If a lesson was learned in those runs, record it now (the notepad is the refit surface); otherwise acknowledge and move on.',
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
        legacyOutput = await processRunsReconciler(
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
      hookName: 'runs-reconciler',
    });
  }
}

void main();
