#!/usr/bin/env node

/**
 * Stop Hook: run-budget guard (E2).
 *
 * Enforces OMC_RUN_BUDGET_TOKENS for unattended sessions: when an active
 * mode (ralph, autopilot, team, ultragoal) is running and the session's
 * token spend crosses the budget, the hook stops the stop — the model is
 * sent back to finish with a resumable budget report.
 *
 * Rollout is tri-state (mirrors the jev off/shadow/active protocol):
 *   OMC_BUDGET_ENFORCE=off     — do nothing
 *   OMC_BUDGET_ENFORCE=shadow  — log judgments to the enforcement shadow
 *                                log, never block or warn (default)
 *   OMC_BUDGET_ENFORCE=active  — warn at 90%, block at 100%
 *
 * Token accounting reads assistant-message usage from a bounded transcript
 * tail. Repeated records for the same message/request use the latest usage
 * snapshot, so content-block records are not counted multiple times. The tail
 * can undercount a long session. A missing/unreadable transcript degrades to
 * a pass with a `degraded` log line: this hook must never block on absent
 * evidence.
 */

import { closeSync, existsSync, fstatSync, openSync, readFileSync, readSync } from 'fs';
import { join } from 'path';
import {
  loadHookRuntime,
  surfaceCriticalHookFailure,
  surfaceOptionalHookFailure,
} from './lib/hook-runtime-loader.mjs';
import { readStdin } from './lib/stdin.mjs';
import { resolveOmcStateRoot } from './lib/state-root.mjs';
import { logEnforcement } from './lib/enforcement-log.mjs';

const GUARDED_MODES = ['ralph', 'autopilot', 'team', 'ultragoal'];
const TRANSCRIPT_TAIL_BYTES = 2 * 1024 * 1024;

function modeStatePath(stateRoot, mode, sessionId) {
  // session-scoped first, legacy fallback (mirrors resolveSessionStatePaths)
  const scoped = sessionId ? join(stateRoot, 'state', 'sessions', sessionId, `${mode}-state.json`) : null;
  if (scoped && existsSync(scoped)) return scoped;
  return join(stateRoot, 'state', `${mode}-state.json`);
}

async function activeUnattendedMode(stateRoot, sessionId) {
  for (const mode of GUARDED_MODES) {
    try {
      const path = modeStatePath(stateRoot, mode, sessionId);
      if (!existsSync(path)) continue;
      const state = JSON.parse(readFileSync(path, 'utf8'));
      if (state && state.active === true) return mode;
    } catch {
      // unreadable state files never trigger the guard
    }
  }
  return null;
}

/**
 * Sum assistant-message usage over a bounded tail of the transcript.
 * @returns {number|null} total tokens, or null when the transcript is
 *   missing/unreadable (degraded — never estimate).
 */
function transcriptTokenSpend(transcriptPath) {
  if (!transcriptPath || !existsSync(transcriptPath)) return null;
  let text;
  let start = 0;
  let fd;
  try {
    fd = openSync(transcriptPath, 'r');
    const size = fstatSync(fd).size;
    start = Math.max(0, size - TRANSCRIPT_TAIL_BYTES);
    const length = size - start;
    const buffer = Buffer.allocUnsafe(length);
    let offset = 0;
    while (offset < length) {
      const bytesRead = readSync(fd, buffer, offset, length - offset, start + offset);
      if (bytesRead === 0) return null;
      offset += bytesRead;
    }
    text = buffer.toString('utf8');
  } catch {
    return null;
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // A close failure does not change the transcript-read outcome.
      }
    }
  }
  // Drop the first partial line when the tail cut mid-record.
  if (start > 0) {
    const firstNewline = text.indexOf('\n');
    if (firstNewline !== -1) text = text.slice(firstNewline + 1);
  }
  const usageByMessage = new Map();
  let lineNumber = 0;
  for (const line of text.split('\n')) {
    lineNumber += 1;
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line);
      if (record?.type !== 'assistant') continue;
      const usage = record?.message?.usage;
      if (!usage) continue;
      const messageId = record?.message?.id;
      const requestId = record?.requestId;
      const key =
        typeof messageId === 'string' && messageId
          ? `message:${messageId}`
          : typeof requestId === 'string' && requestId
            ? `request:${requestId}`
            : `line:${lineNumber}`;
      // Claude Code can append multiple usage snapshots for one message.
      // Keep the latest snapshot rather than summing duplicate content blocks.
      usageByMessage.set(key, usage);
    } catch {
      // non-JSON lines contribute nothing
    }
  }
  let total = 0;
  for (const usage of usageByMessage.values()) {
    total +=
      (usage.input_tokens ?? 0) +
      (usage.output_tokens ?? 0) +
      (usage.cache_read_input_tokens ?? 0) +
      (usage.cache_creation_input_tokens ?? 0);
  }
  return total;
}

function blockReason({ mode, spend, budget }) {
  const percent = Math.round((spend / budget) * 100);
  return [
    `Run budget exhausted: ~${spend} of ${budget} tokens (${percent}%) during this ${mode} run.`,
    'Stop now with a budget report so the session is resumable:',
    '- what was completed and verified (fresh evidence only)',
    '- what remains (state files and progress artifacts are preserved)',
    '- the resume pointer (re-enter the mode to continue from artifacts)',
    'Budget exhaustion is a stop condition, not a failure — do not start new work.',
  ].join('\n');
}

async function processBudgetGuard(data, { started, enforce, budget }) {
  const directory =
    typeof data.directory === 'string' && data.directory
      ? data.directory
      : process.cwd();
  const sessionId =
    typeof data.sessionId === 'string' ? data.sessionId : undefined;
  let stateRoot;
  try {
    stateRoot = await resolveOmcStateRoot(directory);
  } catch {
    return { continue: true, suppressOutput: true };
  }

  const mode = await activeUnattendedMode(stateRoot, sessionId);
  if (!mode) return { continue: true, suppressOutput: true };

  if (data.stopHookActive === true || data.stop_hook_active === true) {
    logEnforcement({
      stateRoot,
      rule: 'budget-stop',
      mode,
      outcome: 'pass',
      detail: 'Stop hook re-entry; budget check skipped to avoid a blocking loop',
      latencyMs: Date.now() - started,
    });
    return { continue: true, suppressOutput: true };
  }

  const spend = transcriptTokenSpend(data.transcriptPath);
  const detail = spend === null ? 'transcript unavailable; no estimate attempted' : `~${spend}/${budget} tokens (${Math.round((spend / budget) * 100)}%)`;
  const latencyMs = Date.now() - started;

  if (spend === null) {
    logEnforcement({ stateRoot, rule: 'budget-stop', mode, outcome: 'degraded', detail, latencyMs });
    return { continue: true, suppressOutput: true };
  }

  const ratio = spend / budget;

  if (ratio >= 1) {
    if (enforce === 'active') {
      logEnforcement({ stateRoot, rule: 'budget-stop', mode, outcome: 'block', detail, latencyMs });
      return {
        decision: 'block',
        reason: blockReason({ mode, spend, budget }),
      };
    }
    // shadow: record the would-block, stay silent
    logEnforcement({ stateRoot, rule: 'budget-stop', mode, outcome: 'warn', detail, latencyMs });
    return { continue: true, suppressOutput: true };
  }

  if (ratio >= 0.9) {
    logEnforcement({ stateRoot, rule: 'budget-stop', mode, outcome: 'warn', detail, latencyMs });
    if (enforce === 'active') {
      return {
        continue: true,
        systemMessage: `[BUDGET] ${mode} run at ${Math.round(ratio * 100)}% of OMC_RUN_BUDGET_TOKENS — finish the current unit, then stop with a budget report.`,
      };
    }
    return { continue: true, suppressOutput: true };
  }

  logEnforcement({ stateRoot, rule: 'budget-stop', mode, outcome: 'pass', detail, latencyMs });
  return { continue: true, suppressOutput: true };
}

function describeBudgetRunFailure(result) {
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

  return failures.length > 0
    ? [...new Set(failures)].join('; ')
    : undefined;
}

async function main() {
  const started = Date.now();
  const enforce = process.env.OMC_BUDGET_ENFORCE || 'shadow';
  if (enforce === 'off') {
    process.exit(0);
    return;
  }

  const budget = Number(process.env.OMC_RUN_BUDGET_TOKENS);
  if (!Number.isFinite(budget) || budget <= 0) {
    process.exit(0);
    return;
  }

  let runtime;
  try {
    runtime = loadHookRuntime();
  } catch (error) {
    surfaceCriticalHookFailure(error, { hookName: 'budget-guard' });
    return;
  }

  try {
    const raw = await readStdin(3000);
    let legacyOutput;
    const result = await runtime.runHookJson(
      'stop',
      raw,
      async (unit, envelope) => {
        legacyOutput = await processBudgetGuard(
          runtime.buildLegacyProcessorInput(envelope, unit),
          { started, enforce, budget },
        );
        return legacyOutput;
      },
    );

    const failure = describeBudgetRunFailure(result);
    if (failure) throw new Error(failure);

    if (result.envelope.host === 'claude') {
      if (result.reduction.decision === 'deny') {
        process.stderr.write(
          `${result.reduction.reason || 'Run budget exhausted.'}\n`,
        );
        process.exitCode = 2;
      } else if (legacyOutput?.systemMessage) {
        process.stdout.write(`${JSON.stringify(legacyOutput)}\n`);
      }
      return;
    }

    process.stdout.write(`${JSON.stringify(
      runtime.encodeHookOutput(result.envelope, result.reduction),
    )}\n`);
  } catch (error) {
    // Missing or malformed budget evidence must not block a stop.
    surfaceOptionalHookFailure(error, { hookName: 'budget-guard' });
  }
}

void main();
