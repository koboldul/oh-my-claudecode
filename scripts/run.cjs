#!/usr/bin/env node
'use strict';
/**
 * OMC Cross-platform hook runner (run.cjs).
 *
 * Uses process.execPath (the Node binary already running this script) to spawn
 * ordinary hooks. The two trusted UserPromptSubmit hooks run in a Worker so the
 * runner retains ownership of their synchronous timeout boundary. Trusted
 * asynchronous SessionEnd hooks durably publish to the resident worker that
 * SessionStart prewarms for this plugin build, worktree scope, and session.
 */

// SessionEnd latency is measured from the first executable runner statement.
// Host process launch and fresh Node startup occur before this boundary.
const SESSION_END_RUNNER_STARTED_AT = process.hrtime.bigint();
const RUNNER_STARTED_AT = Date.now();
const {
  existsSync,
  readFileSync,
  realpathSync,
  writeFileSync,
  writeSync,
} = require('fs');
const path = require('path');
const { join, basename, dirname } = path;

let spawn;
let spawnInvocationCount = 0;
function spawnProcess(...args) {
  spawnInvocationCount += 1;
  if (!spawn) ({ spawn } = require('child_process'));
  return spawn(...args);
}


function isPluginRoot(pluginRoot) {
  return existsSync(join(pluginRoot, 'hooks', 'hooks.json')) &&
    existsSync(join(pluginRoot, 'scripts', 'run.cjs')) &&
    existsSync(join(pluginRoot, 'scripts'));
}

function canonicalPluginRoot(pluginRoot) {
  try {
    const canonicalRoot = path.resolve(realpathSync(pluginRoot));
    return isPluginRoot(canonicalRoot) ? canonicalRoot : null;
  } catch {
    return null;
  }
}

/**
 * Resolve the hook script target path, handling stale CLAUDE_PLUGIN_ROOT.
 *
 * A direct target remains valid for the generic child path even without a
 * trusted plugin root. Worker eligibility receives only independently proven
 * configured-root or selected-cache-version provenance.
 */
function resolveTarget(targetPath) {
  const configuredRoot = canonicalPluginRoot(process.env.CLAUDE_PLUGIN_ROOT);

  try {
    if (existsSync(targetPath)) {
      return {
        targetPath: path.resolve(realpathSync(targetPath)),
        trustedPluginRoot: configuredRoot,
      };
    }
  } catch {
    // Continue to stale-cache recovery.
  }

  try {
    const configuredPath = process.env.CLAUDE_PLUGIN_ROOT;
    if (!configuredPath) return null;

    const cacheBase = dirname(configuredPath);
    const scriptRelative = targetPath.slice(configuredPath.length);
    if (!scriptRelative || !existsSync(cacheBase)) return null;

    const { readdirSync } = require('fs');
    const entries = readdirSync(cacheBase).filter(version => /^\d+\.\d+\.\d+/.test(version));
    entries.sort((a, b) => {
      const pa = a.split('.').map(Number);
      const pb = b.split('.').map(Number);
      for (let index = 0; index < 3; index++) {
        if ((pa[index] || 0) !== (pb[index] || 0)) return (pb[index] || 0) - (pa[index] || 0);
      }
      return 0;
    });

    for (const version of entries) {
      const selectedRoot = join(cacheBase, version);
      const candidate = selectedRoot + scriptRelative;
      if (!existsSync(candidate)) continue;
      const trustedPluginRoot = canonicalPluginRoot(selectedRoot);
      return {
        targetPath: path.resolve(realpathSync(candidate)),
        trustedPluginRoot,
      };

    }
  } catch {
    // Any stale-cache recovery error remains fail-open.
  }

  return null;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function flattenHookEntries(rawHooks) {
  if (!rawHooks || typeof rawHooks !== 'object') return [];
  return Object.entries(rawHooks).flatMap(([event, entries]) => {
    if (!Array.isArray(entries)) return [];
    return entries.map((entry) => ({ event, entry }));
  });
}

function isDebugHooksEnabled() {
  return process.env.OMC_DEBUG_HOOKS === '1' ||
    process.env.OMC_DEBUG === '1' ||
    process.env.OMC_DEBUG === 'true';
}

function resolveTimeoutCushionMs(manifestTimeoutMs, hookEvent) {
  if (hookEvent !== 'UserPromptSubmit') {
    return Math.min(1000, Math.max(TIMEOUT_CUSHION_MS, Math.floor(manifestTimeoutMs / 2)));
  }
  const promptCushion = Math.floor(manifestTimeoutMs * 0.2);
  return Math.min(3000, Math.max(1000, promptCushion));
}

const TIMEOUT_CUSHION_MS = 500;
// = max declared manifest budget (60000ms, setup-maintenance) minus the generic 1000ms reserve; applied ONLY when manifest resolution is null so long legit hooks are not prematurely reaped.
const DEFAULT_GENERIC_TIMEOUT_MS = 59000;
const CRITICAL_HOOK_EVENTS = new Set(['permissionrequest', 'pretooluse']);
const SESSION_END_FIRST_BYTE_TIMEOUT_MS = 25;
const SESSION_END_TOTAL_TIMEOUT_MS = 100;
const SESSION_END_MAX_BYTES = 64 * 1024;
const SESSION_END_FALLBACK_OUTPUT = JSON.stringify({
  continue: true,
  suppressOutput: true,
});


function resolveInnerTimeoutMs(manifestHook) {
  if (!manifestHook) return null;
  return Math.max(1, manifestHook.timeoutMs - resolveTimeoutCushionMs(manifestHook.timeoutMs, manifestHook.event));
}

// Call only after resolveWorkerTarget has verified an exact canonical trusted prompt target.
function resolveTrustedPromptWorkerTimeoutMs(targetPath, manifestHook, trustedPluginRoot) {
  const calculatedTimeoutMs = resolveInnerTimeoutMs(manifestHook);
  const canonicalTarget = normalizedComparisonPath(targetPath);
  const capsByCanonicalTarget = new Map([
    [normalizedComparisonPath(join(trustedPluginRoot, 'scripts', 'keyword-detector.mjs')), 8000],
    [normalizedComparisonPath(join(trustedPluginRoot, 'scripts', 'skill-injector.mjs')), 12000],
  ]);
  const capMs = capsByCanonicalTarget.get(canonicalTarget);
  return capMs ? Math.min(calculatedTimeoutMs, capMs) : calculatedTimeoutMs;
}

function resolveGenericTimeoutMs(manifestHook) {
  return manifestHook ? resolveInnerTimeoutMs(manifestHook) : DEFAULT_GENERIC_TIMEOUT_MS;
}

function isCriticalManifestHook(manifestHook) {
  if (!manifestHook || typeof manifestHook.event !== 'string') return false;
  const normalizedEvent = manifestHook.event.toLowerCase().replace(/[^a-z0-9]/g, '');
  return CRITICAL_HOOK_EVENTS.has(normalizedEvent);
}

function hookFailureExitCode(manifestHook) {
  return isCriticalManifestHook(manifestHook) ? 2 : 0;
}

function resolveHookTimeoutMsFromRoot(pluginRoot, targetPath, extraArgs) {
  const hooksJsonPath = join(pluginRoot, 'hooks', 'hooks.json');
  if (!existsSync(hooksJsonPath)) return null;

  try {
    const hooksJson = JSON.parse(readFileSync(hooksJsonPath, 'utf-8'));
    const scriptName = basename(targetPath);
    const scriptPattern = new RegExp(`[/\\\\]scripts[/\\\\]${escapeRegex(scriptName)}(?:\\s|$)`);
    const argNeedles = extraArgs.filter(arg => typeof arg === 'string' && arg.length > 0);

    for (const { event, entry } of flattenHookEntries(hooksJson?.hooks)) {
      const hooks = Array.isArray(entry?.hooks) ? entry.hooks : [];
      for (const hook of hooks) {
        const command = typeof hook?.command === 'string' ? hook.command : '';
        const timeout = Number(hook?.timeout);
        if (!scriptPattern.test(command)) continue;
        if (!Number.isFinite(timeout) || timeout <= 0) continue;
        if (!argNeedles.every(arg => command.includes(` ${arg}`) || command.endsWith(` ${arg}`))) continue;
        return {
          event,
          timeoutMs: Math.floor(timeout * 1000),
          async: hook?.async === true,
        };
      }
    }
  } catch {
    return null;
  }

  return null;
}

function resolveHookTimeoutMs(targetPath, extraArgs) {
  return resolveHookTimeoutMsFromRoot(dirname(dirname(targetPath)), targetPath, extraArgs);
}

/**
 * Infer the plugin root from a resolved hook script path when the host did not
 * export CLAUDE_PLUGIN_ROOT. Copilot CLI invokes manifest hooks by absolute
 * path, so accept only a scripts/ child of a package carrying both plugin
 * manifest markers.
 */
function inferPluginRootFromTarget(targetPath) {
  const scriptsDir = dirname(targetPath);
  if (basename(scriptsDir) !== 'scripts') return null;
  const candidateRoot = dirname(scriptsDir);
  if (!existsSync(join(candidateRoot, 'package.json'))) return null;
  if (!existsSync(join(candidateRoot, '.claude-plugin', 'plugin.json'))) return null;
  return candidateRoot;
}

function resolveChildEnv(targetPath) {
  const originalPluginRoot = process.env.CLAUDE_PLUGIN_ROOT;
  const inferredPluginRoot = originalPluginRoot ? null : inferPluginRootFromTarget(targetPath);
  const effectivePluginRoot = originalPluginRoot || inferredPluginRoot;
  const childEnv = { ...process.env };

  if (!originalPluginRoot && inferredPluginRoot) {
    childEnv.CLAUDE_PLUGIN_ROOT = inferredPluginRoot;
  }

  if (!childEnv.OMC_HOST) {
    const hasCopilotEnvSignal = Boolean(
      process.env.COPILOT_CLI || process.env.COPILOT_AGENT_SESSION_ID
    );
    const pluginRootUnderCopilot = Boolean(
      effectivePluginRoot &&
      /[\\/]\.copilot[\\/]installed-plugins[\\/]/i.test(effectivePluginRoot)
    );
    if (hasCopilotEnvSignal || pluginRootUnderCopilot) {
      childEnv.OMC_HOST = 'copilot';
    } else if (originalPluginRoot) {
      childEnv.OMC_HOST = 'claude';
    }
  }

  return childEnv;
}

function normalizedComparisonPath(value) {
  const canonical = path.resolve(realpathSync(value));
  return process.platform === 'win32'
    ? path.win32.normalize(canonical).toLowerCase()
    : path.normalize(canonical);
}

function isContainedBy(root, targetPath) {
  const pathApi = process.platform === 'win32' ? path.win32 : path;
  const relative = pathApi.relative(root, targetPath);
  return relative !== '' && !pathApi.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${pathApi.sep}`);
}

function resolveWorkerTarget(resolution, extraArgs) {
  const trustedRoot = resolution.trustedPluginRoot;
  if (!trustedRoot || extraArgs.length !== 0) return null;

  try {
    const canonicalRoot = normalizedComparisonPath(trustedRoot);
    const canonicalTarget = normalizedComparisonPath(resolution.targetPath);
    if (!isContainedBy(canonicalRoot, canonicalTarget)) return null;

    const expectedTargets = ['keyword-detector.mjs', 'skill-injector.mjs']
      .map(script => normalizedComparisonPath(join(trustedRoot, 'scripts', script)));
    if (!expectedTargets.includes(canonicalTarget)) return null;

    const manifestHook = resolveHookTimeoutMsFromRoot(trustedRoot, resolution.targetPath, []);
    if (manifestHook?.event !== 'UserPromptSubmit') return null;
    return manifestHook;
  } catch {
    return null;
  }
}

function resolveSessionEndTarget(resolution, extraArgs) {
  if (extraArgs.length !== 0) return null;

  const trustedRoot = resolution.trustedPluginRoot
    || canonicalPluginRoot(dirname(dirname(resolution.targetPath)));
  if (!trustedRoot) return null;

  try {
    const pathApi = process.platform === 'win32' ? path.win32 : path;
    const resolvedRoot = pathApi.normalize(path.resolve(trustedRoot));
    const resolvedTarget = pathApi.normalize(path.resolve(resolution.targetPath));
    const canonicalRoot = process.platform === 'win32'
      ? resolvedRoot.toLowerCase()
      : resolvedRoot;
    const canonicalTarget = process.platform === 'win32'
      ? resolvedTarget.toLowerCase()
      : resolvedTarget;
    if (!isContainedBy(canonicalRoot, canonicalTarget)) return null;

    const scriptName = basename(resolution.targetPath);
    if (scriptName !== 'session-end.mjs' && scriptName !== 'wiki-session-end.mjs') {
      return null;
    }
    const resolvedExpectedTarget = pathApi.normalize(
      path.resolve(trustedRoot, 'scripts', scriptName),
    );
    const expectedTarget = process.platform === 'win32'
      ? resolvedExpectedTarget.toLowerCase()
      : resolvedExpectedTarget;
    if (canonicalTarget !== expectedTarget) return null;

    const manifestHook = resolveHookTimeoutMsFromRoot(
      trustedRoot,
      resolution.targetPath,
      [],
    );
    if (manifestHook?.event !== 'SessionEnd' || manifestHook.async !== true) {
      return null;
    }
    return { ...manifestHook, pluginRoot: trustedRoot };
  } catch {
    return null;
  }
}

function isJsonObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readSessionEndInput() {
  return new Promise(resolve => {
    const stdin = process.stdin;
    const chunks = [];
    let byteLength = 0;
    let settled = false;
    let firstByteTimer;
    let totalTimer;

    const cleanup = () => {
      clearTimeout(firstByteTimer);
      clearTimeout(totalTimer);
      stdin.off('data', onData);
      stdin.off('end', onEnd);
      stdin.off('error', onError);
    };
    const finish = (result, closeStdin = false) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (closeStdin && !stdin.destroyed) {
        stdin.pause();
        stdin.destroy();
      }
      resolve(result);
    };
    const onData = chunk => {
      clearTimeout(firstByteTimer);
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      byteLength += buffer.length;
      if (byteLength > SESSION_END_MAX_BYTES) {
        finish({ status: 'overflow' }, true);
        return;
      }
      chunks.push(buffer);
    };
    const onEnd = () => {
      const raw = Buffer.concat(chunks);
      let input;
      try {
        input = new TextDecoder('utf-8', { fatal: true }).decode(raw);
      } catch {
        finish({ status: 'invalid' });
        return;
      }
      if (input.trim().length === 0) {
        finish({ status: 'empty' });
        return;
      }
      try {
        const value = JSON.parse(input);
        if (!isJsonObject(value)) {
          finish({ status: 'invalid' });
          return;
        }
        finish({ status: 'ok', raw, value });
      } catch {
        finish({ status: 'invalid' });
      }
    };
    const onError = () => finish({ status: 'error' }, true);

    stdin.on('data', onData);
    stdin.once('end', onEnd);
    stdin.once('error', onError);

    if (stdin.readableEnded) {
      onEnd();
      return;
    }

    firstByteTimer = setTimeout(
      () => finish({ status: 'timeout' }, true),
      SESSION_END_FIRST_BYTE_TIMEOUT_MS,
    );
    totalTimer = setTimeout(
      () => finish({ status: 'timeout' }, true),
      SESSION_END_TOTAL_TIMEOUT_MS,
    );
    stdin.resume();
  });
}

function detectSessionEndHost(value) {
  for (const key of [
    'hook_event_name',
    'session_id',
    'transcript_path',
    'permission_mode',
  ]) {
    if (Object.prototype.hasOwnProperty.call(value, key)) return 'claude';
  }
  for (const key of ['hookName', 'sessionId', 'transcriptPath']) {
    if (Object.prototype.hasOwnProperty.call(value, key)) return 'copilot';
  }
  return 'claude';
}

function writeSessionEndDiagnostic(targetPath, message, error) {
  const detail = error && typeof error.message === 'string'
    ? `: ${error.message}`
    : error
      ? `: ${String(error)}`
      : '';
  process.stderr.write(
    `[run.cjs] Hook ${basename(targetPath)} ${message}; exiting fail-open${detail}\n`,
  );
}

function sessionEndRuntimeError(targetPath) {
  const pluginRoot = dirname(dirname(targetPath));
  const bundlePath = join(pluginRoot, 'bridge', 'hook-runtime.cjs');
  if (!existsSync(bundlePath)) {
    return `Canonical hook runtime bundle is missing at "${bundlePath}".`;
  }
  const processorPath = join(
    pluginRoot,
    'dist',
    'hooks',
    'session-end',
    'index.js',
  );
  if (!existsSync(processorPath)) {
    return `Canonical SessionEnd processor is missing at "${processorPath}".`;
  }
  return null;
}

function writeSessionEndRuntimeError(targetPath, detail) {
  const hookName = basename(targetPath).replace(/\.mjs$/, '');
  writeSync(
    2,
    `[${hookName}] Canonical hook runtime unavailable; `
    + `continuing without optional hook behavior: ${detail}\n`,
  );
}

function monotonicElapsedMs(startedAt) {
  return Number(process.hrtime.bigint() - startedAt) / 1_000_000;
}

function writeSessionEndTimingReceipt(childEnv, timing) {
  if (
    childEnv.NODE_ENV !== 'test'
    || typeof childEnv.OMC_SESSION_END_TEST_IPC_RECEIPT !== 'string'
    || childEnv.OMC_SESSION_END_TEST_IPC_RECEIPT.length === 0
  ) {
    return;
  }
  try {
    writeFileSync(
      childEnv.OMC_SESSION_END_TEST_IPC_RECEIPT,
      JSON.stringify({
        ...timing,
        runnerDurationMs: monotonicElapsedMs(SESSION_END_RUNNER_STARTED_AT),
        processCreations: spawnInvocationCount,
      }),
      { encoding: 'utf8', mode: 0o600 },
    );
  } catch {
    // Test-only timing evidence never affects hook output.
  }
}

async function runSessionEndFastPath(targetPath, raw, value, childEnv) {
  const fastPathStartedAt = process.hrtime.bigint();
  const output = detectSessionEndHost(value) === 'copilot'
    ? '{}'
    : '{"continue":true}';
  const ipc = require('./lib/session-end-ipc.cjs');
  const coordinates = ipc.extractSessionEndCoordinates(value);
  if (!coordinates) {
    writeSessionEndDiagnostic(targetPath, 'received no valid session/worktree scope');
    writeSessionEndTimingReceipt(childEnv, {
      acknowledged: false,
      code: 'invalid-coordinates',
      fastPathMs: monotonicElapsedMs(fastPathStartedAt),
    });
    return output;
  }
  let context;
  let published;
  let contextMs;
  let publishMs;
  let controlMs;
  let control;
  let delivery = { acknowledged: false, code: 'not-attempted' };
  try {
    const contextStartedAt = Date.now();
    context = ipc.resolveResidentContext({
      pluginRoot: dirname(dirname(targetPath)),
      directory: coordinates.directory,
      sessionId: coordinates.sessionId,
      env: childEnv,
    });
    contextMs = Date.now() - contextStartedAt;
    const controlStartedAt = Date.now();
    control = ipc.readControl(context);
    controlMs = Date.now() - controlStartedAt;
    const publishStartedAt = Date.now();
    published = ipc.publishSessionEndFrame(context, {
      producer: basename(targetPath) === 'wiki-session-end.mjs' ? 'wiki' : 'core',
      raw,
      host: detectSessionEndHost(value),
      env: childEnv,
      runtimeReady: Boolean(control),
    });
    publishMs = Date.now() - publishStartedAt;
  } catch (error) {
    writeSessionEndDiagnostic(targetPath, 'could not durably spool its input', error);
    writeSessionEndTimingReceipt(childEnv, {
      acknowledged: false,
      code: 'publish-failed',
      contextMs,
      publishMs,
      controlMs,
      fastPathMs: monotonicElapsedMs(fastPathStartedAt),
    });
    return output;
  }

  if (control) {
    delivery = await ipc.notifyResident(context, control, published, childEnv);
  }
  writeSessionEndTimingReceipt(childEnv, {
    eventId: published.eventId,
    rawDigest: published.rawDigest,
    acknowledged: delivery.acknowledged,
    code: delivery.code,
    connectMs: delivery.connectMs,
    ackMs: delivery.ackMs,
    totalMs: delivery.totalMs,
    contextMs,
    publishMs,
    controlMs,
    fastPathMs: monotonicElapsedMs(fastPathStartedAt),
  });
  return output;
}

function writeTimeoutDiagnostic(targetPath, manifestHook, timeoutMs) {
  const failureMode = isCriticalManifestHook(manifestHook)
    ? 'fail-closed'
    : 'fail-open';
  const message =
    `[run.cjs] Hook ${basename(targetPath)} timed out after ${timeoutMs}ms; `
    + `exiting ${failureMode}.\n`;
  if (manifestHook?.event !== 'UserPromptSubmit' || isDebugHooksEnabled()) {
    process.stderr.write(message);
  }
}

function writeSpawnErrorDiagnostic(targetPath, manifestHook, error) {
  if (!isCriticalManifestHook(manifestHook) && !isDebugHooksEnabled()) {
    return;
  }
  const failureMode = isCriticalManifestHook(manifestHook)
    ? 'fail-closed'
    : 'fail-open';
  const detail = error && typeof error.message === 'string'
    ? error.message
    : String(error);
  process.stderr.write(
    `[run.cjs] Hook ${basename(targetPath)} failed to spawn; `
    + `exiting ${failureMode}: ${detail}\n`,
  );
}

function reapTree(child) {
  if (process.platform === 'win32') {
    // Fire-and-forget: a slow, denied, or missing taskkill must not block the
    // runner past the outer hooks.json budget. The runner still exits according
    // to the hook failure policy; taskkill reaps the tree best-effort.
    try {
      const killer = spawnProcess('taskkill', ['/T', '/F', '/PID', String(child.pid)], {
        windowsHide: true,
        detached: true,
        stdio: 'ignore',
      });
      killer.on('error', () => {});
      killer.unref();
    } catch {
      // best-effort; child.unref() still guarantees the runner exits
    }
    return;
  }

  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    try {
      process.kill(child.pid, 'SIGKILL');
    } catch {
      // best-effort; child.unref() still guarantees the runner exits
    }
  }
}

const RUNNER_TERMINATION_SIGNALS = ['SIGTERM', 'SIGINT', 'SIGHUP'];

function runGenericChild(targetPath, extraArgs, timeoutMs, manifestHook, deadlineAt) {
  return new Promise(resolve => {
    let terminal = false;
    let timer;
    const failureExitCode = hookFailureExitCode(manifestHook);
    let child;
    try {
      child = spawnProcess(process.execPath, [targetPath, ...extraArgs], {
        stdio: 'inherit',
        env: resolveChildEnv(targetPath),
        windowsHide: true,
        detached: process.platform !== 'win32',
      });
    } catch (error) {
      writeSpawnErrorDiagnostic(targetPath, manifestHook, error);
      resolve(failureExitCode);
      return;
    }

    // The generic child is detached into its own process group (POSIX). If the
    // runner is terminated or cancelled BEFORE the inner timer fires (outer
    // hooks.json timeout, Ctrl-C, parent kill), reap the tree so the detached
    // hook cannot be orphaned — the exact failure class #3493 must not leave open.
    const detachHandlers = () => {
      clearTimeout(timer);
      for (const signal of RUNNER_TERMINATION_SIGNALS) process.off(signal, onRunnerSignal);
      process.off('exit', onRunnerExit);
    };
    function onRunnerSignal() {
      if (terminal) return;
      terminal = true;
      detachHandlers();
      reapTree(child);
      process.exit(failureExitCode);
    }
    function onRunnerExit() {
      if (terminal) return;
      terminal = true;
      reapTree(child);
    }

    const timerDelayMs = Number.isFinite(deadlineAt)
      ? Math.max(1, deadlineAt - Date.now())
      : timeoutMs;
    timer = setTimeout(() => {
      if (terminal) return;
      terminal = true;
      detachHandlers();
      reapTree(child);
      // The runner MUST exit according to hook policy even if the tree reap did
      // not complete — the core #3493 symptom is run.cjs parents living for
      // tens of minutes. unref() releases the child handle from the event loop.
      try { child.unref(); } catch { /* handle already released */ }
      writeTimeoutDiagnostic(targetPath, manifestHook, timeoutMs);
      resolve(failureExitCode);
    }, timerDelayMs);

    child.once('exit', (code, signal) => {
      if (terminal) return;
      terminal = true;
      detachHandlers();
      if (isCriticalManifestHook(manifestHook)) {
        resolve(code === 0 && signal === null ? 0 : 2);
        return;
      }
      resolve(typeof code === 'number' ? code : 0);
    });
    child.once('error', (error) => {
      if (terminal) return;
      terminal = true;
      detachHandlers();
      writeSpawnErrorDiagnostic(targetPath, manifestHook, error);
      resolve(failureExitCode);
    });

    for (const signal of RUNNER_TERMINATION_SIGNALS) process.on(signal, onRunnerSignal);
    process.on('exit', onRunnerExit);
  });
}

async function runWorker(targetPath, manifestHook, timeoutMs) {
  const { pathToFileURL } = require('url');
  const { Worker } = require('worker_threads');
  let worker;
  let terminal = false;
  let timer;
  let discardOutput = false;
  const stdout = [];
  const stderr = [];

  const cleanupInput = () => {
    if (!worker) return;
    process.stdin.unpipe(worker.stdin);
    worker.stdin.destroy();
  };
  const waitForOutputEnd = stream => stream.readableEnded
    ? Promise.resolve()
    : new Promise(resolve => stream.once('end', resolve));
  const writeBuffer = (stream, buffer) => new Promise(resolve => {
    stream.write(buffer, () => resolve());
  });
  const forwardBuffers = async (workerError) => {
    if (stdout.length) await writeBuffer(process.stdout, Buffer.concat(stdout));
    if (stderr.length) await writeBuffer(process.stderr, Buffer.concat(stderr));
    if (workerError) {
      const diagnostic = workerError.stack || workerError.message || String(workerError);
      await writeBuffer(process.stderr, Buffer.from(`${diagnostic}\n`));
    }
  };
  const waitForWorkerOutput = () => Promise.all([
    waitForOutputEnd(worker.stdout),
    waitForOutputEnd(worker.stderr),
  ]);

  try {
    return await new Promise((resolve) => {
      const finish = async (status, workerError) => {
        if (terminal) return;
        terminal = true;
        clearTimeout(timer);
        cleanupInput();
        if (worker) await waitForWorkerOutput();
        await forwardBuffers(workerError);
        resolve(status);
      };

      timer = setTimeout(async () => {
        if (terminal) return;
        discardOutput = true;
        terminal = true;
        cleanupInput();
        try {
          await worker.terminate();
        } catch {
          // Termination is best-effort; the hook must still fail open.
        }
        writeTimeoutDiagnostic(targetPath, manifestHook, timeoutMs);
        resolve(0);
      }, timeoutMs);

      try {
        worker = new Worker(pathToFileURL(targetPath), {
          stdin: true,
          stdout: true,
          stderr: true,
          env: resolveChildEnv(targetPath),
        });
        if (process.stdin.readableEnded) worker.stdin.end();
        else process.stdin.pipe(worker.stdin);
        worker.stdout.on('data', chunk => { if (!discardOutput) stdout.push(chunk); });
        worker.stderr.on('data', chunk => { if (!discardOutput) stderr.push(chunk); });
        worker.once('error', error => {
          void finish(1, error);
        });
        worker.once('exit', code => {
          void finish(code ?? 0);
        });
      } catch (error) {
        void finish(1, error);
      }
    });
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const target = process.argv[2];
  if (!target) {
    return 0;
  }

  const resolution = resolveTarget(target);
  if (!resolution) {
    return 0;
  }

  const extraArgs = process.argv.slice(3);
  const sessionEndManifestHook = resolveSessionEndTarget(resolution, extraArgs);
  if (sessionEndManifestHook) {
    const childEnv = resolveChildEnv(resolution.targetPath);
    const frame = await readSessionEndInput();
    if (frame.status !== 'ok') {
      writeSessionEndTimingReceipt(childEnv, {
        acknowledged: false,
        code: `input-${frame.status}`,
      });
      writeSync(1, `${SESSION_END_FALLBACK_OUTPUT}\n`);
      process.exit(0);
    }
    const runtimeError = sessionEndRuntimeError(resolution.targetPath);
    if (runtimeError) {
      writeSessionEndTimingReceipt(childEnv, {
        acknowledged: false,
        code: 'runtime-unavailable',
      });
      writeSessionEndRuntimeError(resolution.targetPath, runtimeError);
      writeSync(
        1,
        `${detectSessionEndHost(frame.value) === 'copilot' ? '{}' : '{"continue":true}'}\n`,
      );
      process.exit(0);
    }
    const output = await runSessionEndFastPath(
      resolution.targetPath,
      frame.raw,
      frame.value,
      childEnv,
    );
    writeSync(1, `${output}\n`);
    process.exit(0);
  }

  const workerManifestHook = resolveWorkerTarget(resolution, extraArgs);
  if (workerManifestHook) {
    const workerTimeoutMs = resolveTrustedPromptWorkerTimeoutMs(
      resolution.targetPath,
      workerManifestHook,
      resolution.trustedPluginRoot,
    );
    return runWorker(
      resolution.targetPath,
      workerManifestHook,
      workerTimeoutMs,
    );
  }

  const manifestHook = resolveHookTimeoutMs(resolution.targetPath, extraArgs);
  const timeoutMs = resolveGenericTimeoutMs(manifestHook);
  return runGenericChild(
    resolution.targetPath,
    extraArgs,
    timeoutMs,
    manifestHook,
    RUNNER_STARTED_AT + timeoutMs,
  );
}

if (require.main === module) {
  main().then(status => {
    process.exitCode = status;
  }).catch(error => {
    process.stderr.write(`[run.cjs] Unexpected runner failure: ${error?.stack || error}\n`);
    process.exitCode = 0;
  });
}

module.exports = {
  hookFailureExitCode,
  isCriticalManifestHook,
  readSessionEndInput,
  resolveInnerTimeoutMs,
  resolveTrustedPromptWorkerTimeoutMs,
  resolveSessionEndTarget,
  resolveWorkerTarget,
  resolveHookTimeoutMs,
  resolveGenericTimeoutMs,
  runSessionEndFastPath,
  runGenericChild,
  DEFAULT_GENERIC_TIMEOUT_MS,
};
