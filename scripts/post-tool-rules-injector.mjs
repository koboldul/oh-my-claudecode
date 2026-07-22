#!/usr/bin/env node

/**
 * PostToolUse Hook: Rules Injector (issue #2577 bug 2)
 *
 * Injects relevant rule files (.claude/rules, .github/instructions,
 * .cursor/rules, ~/.claude/rules) into context when Claude accesses files.
 *
 * Uses content-hash + realpath dedup (via rules-injector storage) so the same
 * rule is never injected more than once per session regardless of how many
 * files are accessed.
 *
 * Worktree safety (bug 3): project root is derived from the ACCESSED FILE's
 * path via findProjectRoot, not from the hook working directory. A .git FILE at the worktree
 * root stops the upward walk, preventing parent-repo rules from leaking in.
 */

import { isAbsolute, join, dirname } from 'path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'url';
import { readStdin } from './lib/stdin.mjs';
import {
  loadHookRuntime,
  surfaceOptionalHookFailure,
} from './lib/hook-runtime-loader.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEFAULT_STDOUT_FLUSH_TIMEOUT_MS = 1_500;
const STDOUT_WRITE_CHUNK_BYTES = 16 * 1024;
const STDOUT_STREAM_THRESHOLD_BYTES = 64 * 1024;

function stdoutFlushTimeoutMs() {
  const parsed = Number.parseInt(
    process.env.OMC_RULES_STDOUT_FLUSH_TIMEOUT_MS || '',
    10,
  );
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_STDOUT_FLUSH_TIMEOUT_MS;
}

function errorDetail(error) {
  try {
    if (error instanceof Error && error.message) return error.message;
  } catch {
    // Continue to the string fallback.
  }
  try {
    return String(error);
  } catch {
    return '<unprintable error>';
  }
}

function writeLargeStdoutAndWait(payload) {
  const writer = spawn(
    process.execPath,
    ['-e',
    `
      const { writeSync } = require('node:fs');
      const chunks = [];
      process.stdin.on('data', (chunk) => chunks.push(chunk));
      process.stdin.on('end', () => {
        const payload = Buffer.concat(chunks);
        try {
          let offset = 0;
          while (offset < payload.length) {
            const written = writeSync(
              1,
              payload,
              offset,
              Math.min(${STDOUT_WRITE_CHUNK_BYTES}, payload.length - offset),
            );
            if (written <= 0) {
              throw new Error('stdout write completed without delivering bytes');
            }
            offset += written;
          }
          process.send({ ok: true }, () => process.exit(0));
        } catch (error) {
          process.send({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          }, () => process.exit(0));
        }
      });
    `,
    ],
    {
      stdio: ['pipe', 1, 'ignore', 'ipc'],
      windowsHide: true,
    },
  );

  return new Promise((resolve, reject) => {
    let settled = false;
    let result;
    let pendingFailure;

    const cleanup = () => {
      clearTimeout(timeout);
      writer.removeAllListeners();
      writer.stdin.removeAllListeners();
    };
    const succeed = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const rejectFailure = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    const fail = (error) => {
      if (settled || pendingFailure) return;
      pendingFailure = error instanceof Error ? error : new Error(String(error));
      if (writer.exitCode === null && writer.signalCode === null) {
        writer.kill();
        return;
      }
      rejectFailure(pendingFailure);
    };
    const timeoutMs = stdoutFlushTimeoutMs();
    const timeout = setTimeout(() => {
      fail(new Error(
        `stdout flush timed out after ${timeoutMs}ms`,
      ));
    }, timeoutMs);

    writer.once('error', fail);
    writer.stdin.once('error', fail);
    writer.on('message', (message) => {
      result = message;
    });
    writer.once('exit', (code, signal) => {
      if (pendingFailure) {
        rejectFailure(pendingFailure);
      } else if (result?.ok === true && code === 0) {
        succeed();
      } else {
        rejectFailure(new Error(
          result?.error
          || `stdout writer exited before flush completed (${code ?? signal})`,
        ));
      }
    });
    writer.stdin.end(payload);
  });
}

function writeStdoutAndWait(output) {
  const payload = Buffer.from(`${JSON.stringify(output)}\n`, 'utf8');
  if (payload.length > STDOUT_STREAM_THRESHOLD_BYTES) {
    return writeLargeStdoutAndWait(payload);
  }

  return new Promise((resolve, reject) => {
    const stdout = process.stdout;
    let settled = false;
    let offset = 0;
    let writeReturned = false;
    let callbackComplete = false;
    let drainComplete = true;

    const cleanup = (keepErrorListener = false) => {
      clearTimeout(timeout);
      if (!keepErrorListener) {
        stdout.off('error', onError);
      }
      stdout.off('drain', onDrain);
      stdout.off('close', onClose);
    };
    const succeed = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      cleanup(true);
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    const maybeSucceed = () => {
      if (!writeReturned || !callbackComplete || !drainComplete) return;
      if (offset >= payload.length) {
        succeed();
        return;
      }
      setImmediate(writeNext);
    };
    const onError = (error) => fail(error);
    const onDrain = () => {
      drainComplete = true;
      maybeSucceed();
    };
    const onClose = () => {
      if (!settled) {
        fail(new Error('stdout closed before flush completed'));
      }
    };
    const timeout = setTimeout(() => {
      fail(new Error(
        `stdout flush timed out after ${stdoutFlushTimeoutMs()}ms`,
      ));
      try {
        stdout.destroy();
      } catch {
        // The timeout failure remains authoritative.
      }
    }, stdoutFlushTimeoutMs());

    stdout.on('error', onError);
    stdout.once('close', onClose);

    function writeNext() {
      if (settled) return;
      const chunk = payload.subarray(
        offset,
        Math.min(offset + STDOUT_WRITE_CHUNK_BYTES, payload.length),
      );
      writeReturned = false;
      callbackComplete = false;
      drainComplete = true;

      try {
        const accepted = stdout.write(chunk, (error) => {
          if (error) {
            fail(error);
            return;
          }
          offset += chunk.length;
          callbackComplete = true;
          maybeSucceed();
        });
        writeReturned = true;
        if (!accepted) {
          drainComplete = false;
          stdout.once('drain', onDrain);
        }
        maybeSucceed();
      } catch (error) {
        writeReturned = true;
        fail(error);
      }
    }

    writeNext();
  });
}

/**
 * Extract the primary file path from tool input.
 * All tracked tools (read, write, edit, multiedit) expose file_path at the
 * top level of tool_input.
 */
function extractFilePath(toolInput) {
  if (!toolInput) return null;
  return toolInput.file_path || toolInput.path || null;
}

function describeCanonicalFailure(result) {
  const failures = [];

  for (const issue of result?.envelope?.issues ?? []) {
    if (issue?.severity === 'safety' || issue?.batchSafety === true) {
      failures.push(issue.message || issue.code || 'hook input normalization failed');
    }
  }

  for (const evaluation of result?.evaluations ?? []) {
    if (evaluation?.source === 'adapter' && evaluation?.decision === 'deny') {
      failures.push(evaluation.reason || 'legacy processor adapter failed');
    }
  }

  for (const decision of result?.reduction?.callDecisions ?? []) {
    if (decision?.source === 'adapter' && decision?.decision === 'deny') {
      failures.push(decision.reason || 'hook reduction failed');
    }
  }

  if (result?.reduction?.decision && result.reduction.decision !== 'pass') {
    failures.push(result.reduction.reason || `unexpected ${result.reduction.decision} reduction`);
  }

  return failures.length > 0 ? [...new Set(failures)].join('; ') : undefined;
}

function isCompleteBoundedContext(runtime, context) {
  if (typeof runtime.boundHookContexts !== 'function') {
    throw new TypeError('Canonical context bounds export is unavailable.');
  }

  const bounded = runtime.boundHookContexts([context]);
  return bounded.length === 1 && bounded[0] === context;
}

function processRulesInjector(
  data,
  envelope,
  runtime,
  hook,
  activeReservations,
  stagedDeliveries,
  stagedKeys,
) {
  const toolName = data.toolName || '';
  const toolInput = data.toolInput || {};
  const sessionId = data.sessionId || 'unknown';
  const cwd = data.directory || process.cwd();

  const rawPath = extractFilePath(toolInput);
  if (!rawPath) {
    return { decision: 'pass', contexts: [] };
  }

  // Resolve relative paths against the shell CWD
  const filePath = isAbsolute(rawPath) ? rawPath : join(cwd, rawPath);

  // createRulesInjectorHook uses cwd only for relative-path resolution.
  // Internally, planToolExecution calls findProjectRoot(filePath) to
  // determine the project boundary — so worktree isolation is maintained
  // even when cwd points to a parent repository.
  const reservation = hook.planToolExecution(toolName, filePath, sessionId);
  if (reservation.reservationId) {
    activeReservations.push({
      hook,
      sessionId,
      reservationId: reservation.reservationId,
    });
  }
  const contexts = [];

  for (const rule of reservation.rules) {
    const key = `${sessionId}\0${rule.realPath}\0${rule.contentHash}`;
    if (stagedKeys.has(key)) continue;
    stagedKeys.add(key);

    const context = hook.formatRuleForInjection(rule).trim();
    const legacyContext = hook.formatRulesForInjection([rule]);
    stagedDeliveries.push({
      hook,
      sessionId,
      reservationId: reservation.reservationId,
      rule,
      context,
      legacyContext,
    });

    if (
      envelope.host === 'claude'
      || isCompleteBoundedContext(runtime, context)
    ) {
      contexts.push(context);
    }
  }

  return { decision: 'pass', contexts };
}

function encodedAdditionalContext(envelope, output) {
  if (envelope.host === 'copilot') {
    return typeof output.additionalContext === 'string'
      ? output.additionalContext
      : undefined;
  }

  const hookSpecificOutput = output.hookSpecificOutput;
  return hookSpecificOutput
    && typeof hookSpecificOutput === 'object'
    && typeof hookSpecificOutput.additionalContext === 'string'
      ? hookSpecificOutput.additionalContext
      : undefined;
}

function reportPersistenceFailure(error) {
  process.stderr.write(
    `[post-tool-rules-injector] Rule context was delivered but reservation commit failed; any surviving reservation remains bounded and retry recovers after release or expiry: ${errorDetail(error)}\n`,
  );
}

function writeStderrAndWait(message) {
  const stderr = process.stderr;

  return new Promise((resolve) => {
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      stderr.off('error', finish);
      resolve();
    };
    const timeout = setTimeout(finish, 250);

    stderr.once('error', finish);
    try {
      stderr.write(message, finish);
    } catch {
      finish();
    }
  });
}

async function reportStdoutFailure(error) {
  await writeStderrAndWait(
    `[post-tool-rules-injector] stdout delivery failed; rules were not committed and remain eligible for retry: ${errorDetail(error)}\n`,
  );
}

function releaseReservations(activeReservations) {
  const released = new Set();
  for (const reservation of activeReservations) {
    const key = `${reservation.sessionId}\0${reservation.reservationId}`;
    if (released.has(key)) continue;
    released.add(key);
    try {
      reservation.hook.releaseReservation(
        reservation.sessionId,
        reservation.reservationId,
      );
    } catch (error) {
      try {
        process.stderr.write(
          `[post-tool-rules-injector] Failed to release undelivered rule reservation; stale expiry will recover it: ${errorDetail(error)}\n`,
        );
      } catch {
        // The reservation has a bounded expiry even without diagnostics.
      }
    }
  }
}

async function main() {
  // Skip guard: honor the documented kill switches (see issues #838, #3253).
  // This hook injects context on PostToolUse alongside post-tool-verifier.mjs, so it
  // accepts the same `post-tool-use` event token. Without this, DISABLE_OMC=1 and
  // OMC_SKIP_HOOKS=post-tool-use failed to suppress rule injection because only
  // post-tool-verifier.mjs honored them.
  const _skipHooks = (process.env.OMC_SKIP_HOOKS || '').split(',').map((s) => s.trim());
  if (
    process.env.DISABLE_OMC === '1' ||
    process.env.DISABLE_OMC === 'true' ||
    _skipHooks.includes('post-tool-use')
  ) {
    console.log(JSON.stringify({ continue: true }));
    return;
  }

  const activeReservations = [];
  try {
    const runtime = loadHookRuntime();
    const runtimeBase = join(__dirname, '..');
    const mod = await import(
      pathToFileURL(join(runtimeBase, 'dist', 'hooks', 'rules-injector', 'index.js')).href
    );
    const { createRulesInjectorHook } = mod;
    if (typeof createRulesInjectorHook !== 'function') {
      throw new TypeError('Rules injector processor export is unavailable.');
    }

    const input = await readStdin();
    const hooksByDirectory = new Map();
    const stagedDeliveries = [];
    const stagedKeys = new Set();
    const result = await runtime.runHookJson(
      'post-tool-use',
      input,
      (unit, envelope) => {
        const data = runtime.buildLegacyProcessorInput(envelope, unit);
        const cwd = data.directory || process.cwd();
        let hook = hooksByDirectory.get(cwd);
        if (!hook) {
          hook = createRulesInjectorHook(cwd);
          if (
            typeof hook?.planToolExecution !== 'function'
            || typeof hook?.formatRuleForInjection !== 'function'
            || typeof hook?.formatRulesForInjection !== 'function'
            || typeof hook?.commitReservation !== 'function'
            || typeof hook?.releaseReservation !== 'function'
          ) {
            throw new TypeError('Rules injector staged delivery API is unavailable.');
          }
          hooksByDirectory.set(cwd, hook);
        }

        return processRulesInjector(
          data,
          envelope,
          runtime,
          hook,
          activeReservations,
          stagedDeliveries,
          stagedKeys,
        );
      },
    );

    const canonicalFailure = describeCanonicalFailure(result);
    if (canonicalFailure) {
      releaseReservations(activeReservations);
      surfaceOptionalHookFailure(
        new Error(canonicalFailure),
        { hookName: 'post-tool-rules-injector' },
      );
      return;
    }

    let deliveryContexts;
    let deliveryRecords;
    if (result.envelope.host === 'claude') {
      const legacyContext = stagedDeliveries
        .map((delivery) => delivery.legacyContext)
        .join('');
      deliveryContexts = legacyContext ? [legacyContext] : [];
      deliveryRecords = stagedDeliveries;
    } else {
      const deliveriesByContext = new Map(
        stagedDeliveries.map((delivery) => [delivery.context, delivery]),
      );
      deliveryContexts = result.reduction.contexts.filter(
        (context) => deliveriesByContext.has(context),
      );
      deliveryRecords = deliveryContexts
        .map((context) => deliveriesByContext.get(context))
        .filter(Boolean);
    }

    const deliveryReduction = {
      ...result.reduction,
      contexts: deliveryContexts,
      context: deliveryContexts.length > 0
        ? deliveryContexts.join('\n\n')
        : undefined,
    };
    const encoded = runtime.encodeHookOutput(
      result.envelope,
      deliveryReduction,
    );
    const output =
      result.envelope.host === 'claude' && Object.keys(encoded).length === 0
        ? { continue: true, suppressOutput: true }
        : encoded;

    const expectedContext = deliveryReduction.context;
    const deliveredRecords =
      expectedContext
      && encodedAdditionalContext(result.envelope, output) === expectedContext
        ? deliveryRecords
        : [];

    try {
      await writeStdoutAndWait(output);
    } catch (error) {
      releaseReservations(activeReservations);
      await reportStdoutFailure(error);
      process.exit(0);
    }

    for (const reservation of activeReservations) {
      const rules = deliveredRecords
        .filter(
          (delivery) =>
            delivery.reservationId === reservation.reservationId
            && delivery.sessionId === reservation.sessionId,
        )
        .map((delivery) => delivery.rule);
      try {
        reservation.hook.commitReservation(
          reservation.sessionId,
          reservation.reservationId,
          rules,
        );
      } catch (error) {
        reportPersistenceFailure(error);
      }
    }
  } catch (error) {
    releaseReservations(activeReservations);
    surfaceOptionalHookFailure(error, { hookName: 'post-tool-rules-injector' });
  }
}

main();
