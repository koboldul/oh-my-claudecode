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
const { spawn, spawnSync } = require('child_process');
const { PassThrough, Writable } = require('stream');
const {
  existsSync,
  readFileSync,
  realpathSync,
  writeFileSync,
  writeSync,
} = require('fs');
const { tmpdir } = require('os');
const path = require('path');
const { join, basename, dirname } = path;
const { hardenWindowsExeSearch } = require('./lib/windows-search.cjs');

hardenWindowsExeSearch();

let spawnInvocationCount = 0;
function spawnProcess(...args) {
  spawnInvocationCount += 1;
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
    const entries = readdirSync(cacheBase).filter(version => /^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(version));
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

const POSIX_TIMEOUT_CUSHION_MS = 500;
const WINDOWS_TIMEOUT_CUSHION_MS = 1500;
const MAX_DECLARED_GENERIC_TIMEOUT_MS = 60000;
const WINDOWS_REAP_TIMEOUT_MS = 400;
const PROTOCOL_STDIO_SETTLE_MS = 150;
const HOST_DELIVERY_ACK_ENV = 'OMC_RUNNER_HOST_DELIVERY_ACK';
const HOST_DELIVERY_DEADLINE_ENV = 'OMC_RUNNER_HOST_DELIVERY_DEADLINE_AT';
const HOST_DELIVERY_PROTOCOL = 'omc-host-delivery-v1';
const HOST_DELIVERY_REQUEST = 'stdout-request';
const HOST_DELIVERY_RESULT = 'stdout-result';
const HOST_DELIVERY_ABORT = 'abort';
const HOST_DELIVERY_PROCESS = 'process-spawn';
const HOST_PROCESS_IDENTITY_REQUEST = 'process-identity-request';
const HOST_PROCESS_IDENTITY_RESULT = 'process-identity-result';
const HOST_DELIVERY_SCRIPT = 'post-tool-rules-injector.mjs';
const HOST_DELIVERY_CHUNK_BYTES = 16 * 1024;
const HOST_DELIVERY_MAX_BYTES = 16 * 1024 * 1024;
const TEST_FORCE_GENERIC_ENV = 'OMC_RUNNER_TEST_FORCE_GENERIC';
const TEST_PROCESS_RECEIPT_DIR_ENV = 'OMC_RUNNER_TEST_PROCESS_RECEIPT_DIR';
// Empty source→tap→writer pipelines identify leaked descendant handles after
// the leader exits. Legitimate buffered bytes are exempt from this idle bound.
const PROTOCOL_SOURCE_IDLE_MS = 80;
const MIN_HOOK_INNER_FRACTION = 0.5;
const MIN_HOOK_INNER_MS = 400;
// Observed Windows supervisor→hook→grandchild cold start in hosted CI (361–559ms).
const WINDOWS_GENERIC_STARTUP_MS = 600;
// Must match scripts/lib/bounded-git-timeout.mjs.
const NESTED_OPERATION_TIMEOUT_MS = 2000;
const NESTED_OPERATION_MARGIN_MS = 200;
const NESTED_INNER_FLOOR_MS = NESTED_OPERATION_TIMEOUT_MS + NESTED_OPERATION_MARGIN_MS + WINDOWS_GENERIC_STARTUP_MS;
const TIMEOUT_CUSHION_MS = POSIX_TIMEOUT_CUSHION_MS;
const DEFAULT_GENERIC_TIMEOUT_MS = MAX_DECLARED_GENERIC_TIMEOUT_MS - POSIX_TIMEOUT_CUSHION_MS;

function platformTimeoutCushionMs(platform = process.platform) {
  return platform === 'win32' ? WINDOWS_TIMEOUT_CUSHION_MS : POSIX_TIMEOUT_CUSHION_MS;
}

function desiredTimeoutCushionMs(manifestTimeoutMs, hookEvent, platform = process.platform) {
  const base = platformTimeoutCushionMs(platform);
  if (hookEvent !== 'UserPromptSubmit') return base;
  const promptCushion = Math.floor(manifestTimeoutMs * 0.2);
  return Math.min(3000, Math.max(base, 1000, promptCushion));
}

const CRITICAL_HOOK_EVENTS = new Set(['permissionrequest', 'pretooluse']);
const SESSION_END_FIRST_BYTE_TIMEOUT_MS = 25;
const SESSION_END_TOTAL_TIMEOUT_MS = 100;
const SESSION_END_MAX_BYTES = 64 * 1024;
const SESSION_END_FALLBACK_OUTPUT = JSON.stringify({
  continue: true,
  suppressOutput: true,
});

function resolveTimeoutCushionMs(manifestTimeoutMs, hookEvent, platform = process.platform) {
  const desired = desiredTimeoutCushionMs(manifestTimeoutMs, hookEvent, platform);
  if (platform === 'win32' && hookEvent !== 'UserPromptSubmit' && manifestTimeoutMs <= 3000) {
    // Preserve the historical 500ms outer allowance for short hooks. It
    // covers the 400ms Windows reap plus the 80ms protocol-idle close while
    // leaving a 3s hook its prior 2500ms inner budget for shipped 2000ms Git
    // and lock operations.
    return Math.min(500, Math.max(1, manifestTimeoutMs - 1));
  }
  const fractionalInner = Math.max(MIN_HOOK_INNER_MS, Math.floor(manifestTimeoutMs * MIN_HOOK_INNER_FRACTION));
  const canFitNestedFloor = manifestTimeoutMs - POSIX_TIMEOUT_CUSHION_MS >= NESTED_INNER_FLOOR_MS;
  const minInner = Math.min(
    Math.max(1, manifestTimeoutMs - 1),
    canFitNestedFloor ? Math.max(fractionalInner, NESTED_INNER_FLOOR_MS) : fractionalInner,
  );
  const maxCushion = Math.max(1, manifestTimeoutMs - minInner);
  return Math.min(desired, maxCushion);
}

function resolveInnerTimeoutMs(manifestHook, platform = process.platform) {
  if (!manifestHook) return null;
  return Math.max(1, manifestHook.timeoutMs - resolveTimeoutCushionMs(manifestHook.timeoutMs, manifestHook.event, platform));
}

// Call only after resolveWorkerTarget has verified an exact canonical trusted target.
const TRUSTED_WORKER_HOOKS = new Map([
  ['keyword-detector.mjs', { event: 'UserPromptSubmit', timeoutCapMs: 8000 }],
  ['skill-injector.mjs', { event: 'UserPromptSubmit', timeoutCapMs: 12000 }],
  ['git-guardrails.mjs', { event: 'PreToolUse' }],
  ['pre-tool-enforcer.mjs', { event: 'PreToolUse' }],
  ['post-tool-verifier.mjs', { event: 'PostToolUse' }],
  ['project-memory-posttool.mjs', { event: 'PostToolUse' }],
  ['post-tool-rules-injector.mjs', { event: 'PostToolUse' }],
  ['post-tool-directory-context-injector.mjs', { event: 'PostToolUse' }],
]);

function resolveTrustedWorkerTimeoutMs(targetPath, manifestHook) {
  const calculatedTimeoutMs = resolveInnerTimeoutMs(manifestHook);
  const capMs = TRUSTED_WORKER_HOOKS.get(basename(targetPath))?.timeoutCapMs;
  return capMs ? Math.min(calculatedTimeoutMs, capMs) : calculatedTimeoutMs;
}

function resolveGenericTimeoutMs(manifestHook, platform = process.platform) {
  return manifestHook
    ? resolveInnerTimeoutMs(manifestHook, platform)
    : MAX_DECLARED_GENERIC_TIMEOUT_MS - platformTimeoutCushionMs(platform);
}

function isCriticalManifestHook(manifestHook) {
  if (!manifestHook || typeof manifestHook.event !== 'string') return false;
  const normalizedEvent = manifestHook.event.toLowerCase().replace(/[^a-z0-9]/g, '');
  return CRITICAL_HOOK_EVENTS.has(normalizedEvent);
}

function hookFailureExitCode(manifestHook) {
  return isCriticalManifestHook(manifestHook) ? 2 : 0;
}

function recordTestExecutionRoute(route) {
  const receiptPath = process.env.OMC_RUNNER_TEST_ROUTE_RECEIPT;
  if (process.env.NODE_ENV !== 'test' || !receiptPath) return;
  try {
    writeFileSync(
      receiptPath,
      `${JSON.stringify({ route, pid: process.pid })}\n`,
      'utf8',
    );
  } catch {
    // Test instrumentation must not affect hook execution.
  }
}

let testProcessReceiptSequence = 0;
function recordTestProcess(role, pid, details = {}) {
  const receiptDir = process.env[TEST_PROCESS_RECEIPT_DIR_ENV];
  if (
    process.env.NODE_ENV !== 'test'
    || !receiptDir
    || !Number.isInteger(pid)
    || pid <= 0
  ) {
    return;
  }
  try {
    testProcessReceiptSequence += 1;
    const receiptPath = join(
      receiptDir,
      `${process.pid}-${testProcessReceiptSequence}-${role}-${pid}.json`,
    );
    writeFileSync(
      receiptPath,
      `${JSON.stringify({
        role,
        pid,
        parentPid: process.pid,
        recordedAt: Date.now(),
        ...details,
      })}\n`,
      'utf8',
    );
  } catch {
    // Test instrumentation must not affect hook execution.
  }
}

function forceTrustedWorkerGenericForTest() {
  return process.env.NODE_ENV === 'test'
    && process.env[TEST_FORCE_GENERIC_ENV] === '1';
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

function resolveChildEnv(
  targetPath,
  hostDeliveryAck = false,
  hostDeliveryDeadlineAt,
) {
  const originalPluginRoot = process.env.CLAUDE_PLUGIN_ROOT;
  const hasCopilotEnvSignal = Boolean(
    process.env.COPILOT_CLI
    || process.env.COPILOT_AGENT_SESSION_ID
    || process.env.OMC_HOST === 'copilot'
  );
  const targetPluginRoot = !originalPluginRoot
    ? inferPluginRootFromTarget(targetPath)
    : null;
  const targetUnderCopilotInstall = Boolean(
    targetPluginRoot
    && /[\\/]\.copilot[\\/]installed-plugins[\\/]/i.test(targetPluginRoot)
  );
  const inferredPluginRoot = hasCopilotEnvSignal || targetUnderCopilotInstall
    ? targetPluginRoot
    : null;
  const effectivePluginRoot = originalPluginRoot || inferredPluginRoot;
  const childEnv = { ...process.env };
  delete childEnv[HOST_DELIVERY_ACK_ENV];
  delete childEnv[HOST_DELIVERY_DEADLINE_ENV];

  if (!originalPluginRoot && inferredPluginRoot) {
    childEnv.CLAUDE_PLUGIN_ROOT = inferredPluginRoot;
  }

  if (!childEnv.OMC_HOST) {
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

  if (hostDeliveryAck) {
    childEnv[HOST_DELIVERY_ACK_ENV] = '1';
    if (
      Number.isSafeInteger(hostDeliveryDeadlineAt)
      && hostDeliveryDeadlineAt > 0
    ) {
      childEnv[HOST_DELIVERY_DEADLINE_ENV] =
        String(hostDeliveryDeadlineAt);
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

    const scriptName = basename(resolution.targetPath);
    const trustedHook = TRUSTED_WORKER_HOOKS.get(scriptName);
    if (!trustedHook) return null;
    const expectedTarget = normalizedComparisonPath(join(trustedRoot, 'scripts', scriptName));
    if (canonicalTarget !== expectedTarget) return null;

    const manifestHook = resolveHookTimeoutMsFromRoot(trustedRoot, resolution.targetPath, []);
    if (manifestHook?.event !== trustedHook.event) return null;
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

function isHostDeliveryMessage(message, kind) {
  return isJsonObject(message)
    && message.protocol === HOST_DELIVERY_PROTOCOL
    && message.kind === kind
    && typeof message.id === 'string'
    && message.id.length > 0
    && message.id.length <= 256;
}

function isHostDeliveryRequest(message) {
  return isHostDeliveryMessage(message, HOST_DELIVERY_REQUEST)
    && Number.isSafeInteger(message.bytes)
    && message.bytes >= 0
    && message.bytes <= HOST_DELIVERY_MAX_BYTES
    && typeof message.payload === 'string'
    && Buffer.byteLength(message.payload, 'utf8') === message.bytes
    && Number.isFinite(message.timeoutMs)
    && message.timeoutMs > 0;
}

function isHostDeliveryAbort(message) {
  return isJsonObject(message)
    && message.protocol === HOST_DELIVERY_PROTOCOL
    && message.kind === HOST_DELIVERY_ABORT;
}

function isHostDeliveryProcess(message) {
  return isJsonObject(message)
    && message.protocol === HOST_DELIVERY_PROTOCOL
    && message.kind === HOST_DELIVERY_PROCESS
    && message.role === 'identity-probe'
    && Number.isSafeInteger(message.pid)
    && message.pid > 0;
}

function isHostProcessIdentityRequest(message) {
  return isHostDeliveryMessage(message, HOST_PROCESS_IDENTITY_REQUEST)
    && Number.isSafeInteger(message.pid)
    && message.pid > 0;
}

function isHostProcessIdentityResult(message) {
  return isHostDeliveryMessage(message, HOST_PROCESS_IDENTITY_RESULT)
    && Number.isSafeInteger(message.pid)
    && message.pid > 0
    && typeof message.ok === 'boolean'
    && (
      message.ok === false
      || (
        typeof message.identity === 'string'
        && /^ticks:\d{1,19}$/.test(message.identity)
      )
    );
}

function hostDeliveryResult(message, ok, error) {
  return {
    protocol: HOST_DELIVERY_PROTOCOL,
    kind: HOST_DELIVERY_RESULT,
    id: message.id,
    ok,
    ...(ok || !error ? {} : { error }),
  };
}

function hostProcessIdentityResult(message, identity, error) {
  const ok =
    typeof identity === 'string'
    && /^ticks:\d{1,19}$/.test(identity);
  return {
    protocol: HOST_DELIVERY_PROTOCOL,
    kind: HOST_PROCESS_IDENTITY_RESULT,
    id: message.id,
    pid: message.pid,
    ok,
    ...(ok ? { identity } : {}),
    ...(ok || !error ? {} : { error }),
  };
}

function hostDeliveryAbort(error) {
  return {
    protocol: HOST_DELIVERY_PROTOCOL,
    kind: HOST_DELIVERY_ABORT,
    ...(error ? { error } : {}),
  };
}

function createWindowsProcessIdentityBroker(deadlineAt) {
  if (
    process.platform !== 'win32'
    || !Number.isSafeInteger(deadlineAt)
    || deadlineAt <= Date.now()
  ) {
    return null;
  }

  const command = [
    '$line = [Console]::In.ReadLine()',
    '$targetPid = 0',
    'if ([string]::IsNullOrWhiteSpace($line) -or '
      + '-not [int]::TryParse($line, [ref]$targetPid) '
      + '-or $targetPid -le 0) { exit 2 }',
    'try {',
    '  $target = [System.Diagnostics.Process]::GetProcessById($targetPid)',
    '  $ticks = $target.StartTime.ToUniversalTime().Ticks',
    '  if ($ticks -le 0) { exit 3 }',
    '  [Console]::Out.WriteLine($ticks)',
    '} catch { exit 3 }',
  ].join('; ');

  let child;
  try {
    child = spawn(
      'powershell',
      [
        '-NoProfile',
        '-NonInteractive',
        '-InputFormat',
        'Text',
        '-OutputFormat',
        'Text',
        '-Command',
        command,
      ],
      {
        stdio: ['pipe', 'pipe', 'ignore'],
        windowsHide: true,
      },
    );
  } catch {
    return null;
  }

  recordTestProcess('identity-probe', child.pid);
  let output = '';
  let requestedPid;
  let settled = false;
  let resolveResult;
  const result = new Promise((resolve) => {
    resolveResult = resolve;
  });
  const finish = (identity) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    resolveResult(identity);
  };
  const kill = () => {
    try {
      if (!child.killed) child.kill();
    } catch {
      // The helper may already have exited.
    }
  };
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    output += chunk;
    if (output.length > 128) kill();
  });
  child.once('error', () => finish(null));
  child.once('exit', () => {
    const ticks = output.trim().match(/^\d{1,19}$/)?.[0];
    finish(ticks ? `ticks:${ticks}` : null);
  });
  const timer = setTimeout(() => {
    kill();
  }, Math.max(1, deadlineAt - Date.now()));

  return {
    request(pid) {
      if (
        requestedPid !== undefined
        || !Number.isSafeInteger(pid)
        || pid <= 0
        || Date.now() >= deadlineAt
      ) {
        return Promise.resolve(null);
      }
      requestedPid = pid;
      try {
        child.stdin.end(`${pid}\n`);
      } catch {
        kill();
      }
      return result;
    },
    close() {
      if (!settled) {
        try { child.stdin.destroy(); } catch { /* already closed */ }
        kill();
      }
      return result;
    },
  };
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

function resolveTrustedSessionEndTarget(resolution, extraArgs) {
  const trustedRoot = resolution.trustedPluginRoot;
  if (!trustedRoot || extraArgs.length !== 0) return null;
  try {
    const canonicalTarget = normalizedComparisonPath(resolution.targetPath);
    const canonicalRoot = normalizedComparisonPath(trustedRoot);
    if (!isContainedBy(canonicalRoot, canonicalTarget)) return null;
    const expectedTargets = ['session-end.mjs', 'wiki-session-end.mjs']
      .map(script => normalizedComparisonPath(join(trustedRoot, 'scripts', script)));
    if (!expectedTargets.includes(canonicalTarget)) return null;
    const manifestHook = resolveHookTimeoutMsFromRoot(trustedRoot, resolution.targetPath, []);
    return manifestHook?.event === 'SessionEnd' ? manifestHook : null;
  } catch {
    return null;
  }
}


function writeTimeoutDiagnostic(targetPath, manifestHook, timeoutMs, sink, explicitFailureMode) {
  const failureMode = explicitFailureMode
    ?? (isCriticalManifestHook(manifestHook) ? 'fail-closed' : 'fail-open');
  const message = `[run.cjs] Hook ${basename(targetPath)} timed out after ${timeoutMs}ms; exiting ${failureMode}.\n`;
  if (manifestHook?.event !== 'UserPromptSubmit' || isDebugHooksEnabled()) {
    if (sink) return sink.write(process.stderr, Buffer.from(message));
    try { process.stderr.write(message); } catch { /* protocol dest may already be closed */ }
  }
  return Promise.resolve();
}

function captureProcessStartIdentity(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  if (process.platform === 'linux') {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
      const closeParen = stat.lastIndexOf(')');
      if (closeParen === -1) return null;
      const fields = stat.substring(closeParen + 2).split(' ');
      const startTime = parseInt(fields[19], 10);
      return isNaN(startTime) ? null : String(startTime);
    } catch {
      return null;
    }
  }
  if (process.platform === 'darwin') {
    try {
      const { status, stdout } = spawnSync('ps', ['-p', String(pid), '-o', 'lstart='],
        { env: { ...process.env, LC_ALL: 'C' }, timeout: 2000, windowsHide: true });
      if (status !== 0) return null;
      const time = new Date(stdout.trim()).getTime();
      return isNaN(time) ? null : `mac:${time}`;
    } catch {
      return null;
    }
  }
  return null;
}

function processIdentityMatches(pid, expectedIdentity) {
  if (!expectedIdentity) return false;
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  return captureProcessStartIdentity(pid) === expectedIdentity;
}

function leaderPresence(pid, expectedIdentity) {
  try {
    process.kill(pid, 0);
  } catch (error) {
    return error && error.code === 'ESRCH' ? 'absent' : 'unknown';
  }
  if (!expectedIdentity) return 'alive';
  return captureProcessStartIdentity(pid) === expectedIdentity ? 'alive' : 'mismatch';
}

async function reapTree(child, childIdentity) {
  // Identity-safe reap: only signal a live PID we spawned, or a confirmed-dead
  // detached leader's leftover process group. A live identity mismatch is PID
  // reuse — fail closed. Unknown (EPERM/identity-read failure) also fail closed.
  if (!Number.isInteger(child.pid) || child.pid <= 0) return;
  const presence = leaderPresence(child.pid, childIdentity);
  if (presence === 'mismatch' || presence === 'unknown') return;
  if (presence === 'absent') {
    if (process.platform === 'win32') return;
    try { process.kill(-child.pid, 'SIGKILL'); } catch { /* group already empty */ }
    return;
  }
  if (process.platform === 'win32') {
    // Protocol stdout/stderr are owned by run.cjs pipes, so a descendant that
    // outlives this process cannot retain Claude Code's handles (#3920).
    // Keep taskkill attached and bounded so the reaper itself cannot outlive
    // the runner. Do not use spawnSync: Node can wait beyond its timeout.
    try {
      const killer = spawnProcess('taskkill', ['/T', '/F', '/PID', String(child.pid)], {
        cwd: tmpdir(),
        windowsHide: true,
        stdio: 'ignore',
      });
      recordTestProcess('tree-reaper', killer.pid);
      await new Promise(resolve => {
        let settled = false;
        let timer;
        const finish = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve();
        };
        killer.once('error', finish);
        killer.once('close', finish);
        timer = setTimeout(() => {
          try { killer.kill('SIGKILL'); } catch { /* already exited */ }
        }, WINDOWS_REAP_TIMEOUT_MS);
      });
    } catch {
      // best-effort; callers still release the owned child handle
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
function resolveGenericChildCommand(targetPath, extraArgs, platform = process.platform) {
  return platform === 'win32'
    ? [__filename, '--generic-child-supervisor', targetPath, ...extraArgs]
    : [targetPath, ...extraArgs];
}

function resolveGenericChildStdio(
  platform = process.platform,
  hostDeliveryAck = false,
) {
  // stdin inherit: hook JSON payload from Claude Code.
  // stdout/stderr pipe: run.cjs owns the protocol handles so a descendant that
  // outlives the runner cannot keep Claude Code blocked on EOF (#3920).
  // ipc: Windows supervisor parent-death reap.
  return platform === 'win32' || hostDeliveryAck
    ? ['inherit', 'pipe', 'pipe', 'ipc']
    : ['inherit', 'pipe', 'pipe'];
}

function isClosedDestinationError(error) {
  const code = error && error.code;
  return code === 'EPIPE' || code === 'ERR_STREAM_DESTROYED' || code === 'ERR_STREAM_WRITE_AFTER_END';
}


let processDestGuardsInstalled = false;
function ensureProcessDestGuards() {
  if (processDestGuardsInstalled) return;
  processDestGuardsInstalled = true;
  const guard = (error) => {
    if (isClosedDestinationError(error)) return;
    try {
      writeSync(2, `[run.cjs] protocol stream error: ${error.code || error.message}\n`);
    } catch { /* both destinations dead */ }
  };
  process.stdout.on('error', guard);
  process.stderr.on('error', guard);
}

function createProtocolSink(hooks = {}) {
  const destinations = {
    stdout: hooks.stdout || process.stdout,
    stderr: hooks.stderr || process.stderr,
  };
  const discarded = { stdout: false, stderr: false };
  const closedDest = { stdout: false, stderr: false };
  const deliveredBytes = { stdout: 0, stderr: 0 };
  const deliveryWaiters = { stdout: [], stderr: [] };
  const bindings = { stdout: [], stderr: [] };
  const discardedSources = { stdout: [], stderr: [] };
  let installed = false;
  let pendingWrites = 0;
  let uninstallRequested = false;
  const onStdoutError = (error) => handleDestError('stdout', destinations.stdout, error);
  const onStderrError = (error) => handleDestError('stderr', destinations.stderr, error);
  const onStdoutClose = () => handleDestClose('stdout');
  const onStderrClose = () => handleDestClose('stderr');

  function notifyDeliveryWaiters(name) {
    const dest = destinations[name];
    const failed = discarded[name]
      || closedDest[name]
      || !dest
      || dest.destroyed
      || !dest.writable;
    const remaining = [];
    for (const waiter of deliveryWaiters[name]) {
      if (failed) {
        clearTimeout(waiter.timer);
        waiter.resolve(false);
      } else if (
        deliveredBytes[name] >= waiter.bytes
        && !dest.writableNeedDrain
      ) {
        clearTimeout(waiter.timer);
        waiter.resolve(true);
      } else {
        remaining.push(waiter);
      }
    }
    deliveryWaiters[name] = remaining;
  }

  function teardownChannel(name) {
    discarded[name] = true;
    const snapshot = bindings[name];
    bindings[name] = [];
    for (const binding of snapshot) {
      try { binding.source.unpipe(binding.tap); } catch { /* already unpiped */ }
      try { binding.tap.unpipe(binding.writer); } catch { /* already unpiped */ }
      try { binding.tap.destroy(); } catch { /* already destroyed */ }
      try { binding.writer.destroy(); } catch { /* already destroyed */ }
    }
    if (typeof hooks.beforeSourceDestroy === 'function') hooks.beforeSourceDestroy();
    for (const binding of snapshot) {
      try { binding.source.destroy(); } catch { /* already destroyed */ }
    }
    notifyDeliveryWaiters(name);
  }

  function discardChannel(name) {
    discarded[name] = true;
    const snapshot = bindings[name];
    bindings[name] = [];
    for (const binding of snapshot) {
      try { binding.source.unpipe(binding.tap); } catch { /* already unpiped */ }
      try { binding.tap.unpipe(binding.writer); } catch { /* already unpiped */ }
      try { binding.tap.destroy(); } catch { /* already destroyed */ }
      try { binding.writer.destroy(); } catch { /* already destroyed */ }
      discardedSources[name].push(binding.source);
      try { binding.source.resume(); } catch { /* already flowing or destroyed */ }
    }
    notifyDeliveryWaiters(name);
  }

  function destroyDiscardedSources() {
    for (const name of ['stdout', 'stderr']) {
      const sources = discardedSources[name];
      discardedSources[name] = [];
      for (const source of sources) {
        try { source.destroy(); } catch { /* already destroyed */ }
      }
    }
  }

  function handleDestError(name, dest, error) {
    if (discarded[name]) return;
    if (isClosedDestinationError(error)) {
      handleDestClose(name);
      return;
    }
    // Close only the failed protocol channel first. Keep its child pipe
    // draining while the sibling channel remains available; reaping here can
    // race sibling bytes that the hook has not written yet.
    discardChannel(name);
    if (typeof hooks.onDestinationClose === 'function') hooks.onDestinationClose(name);
    if (name === 'stdout') {
      void write(process.stderr, Buffer.from(`[run.cjs] protocol stream error: ${error.code || error.message}\n`));
    }
  }

  function handleDestClose(name) {
    if (discarded[name]) return;
    closedDest[name] = true;
    discardChannel(name);
    if (typeof hooks.onDestinationClose === 'function') {
      hooks.onDestinationClose(name);
    }
  }

  function install() {
    ensureProcessDestGuards();
    if (installed) return;
    installed = true;
    destinations.stdout.on('error', onStdoutError);
    destinations.stderr.on('error', onStderrError);
    destinations.stdout.on('close', onStdoutClose);
    destinations.stderr.on('close', onStderrClose);
  }

  function flushUninstall() {
    if (!uninstallRequested || pendingWrites > 0 || !installed) return;
    installed = false;
    destinations.stdout.removeListener('error', onStdoutError);
    destinations.stderr.removeListener('error', onStderrError);
    destinations.stdout.removeListener('close', onStdoutClose);
    destinations.stderr.removeListener('close', onStderrClose);
    // Process-lifetime closed-dest guards remain so a late write callback
    // EPIPE after finish() cannot crash the runner.
  }

  function uninstall() {
    uninstallRequested = true;
    flushUninstall();
  }

  function abandonOutputs() {
    teardownChannel('stdout');
    teardownChannel('stderr');
    destroyDiscardedSources();
  }

  function closeDestinations() {
    for (const dest of [destinations.stdout, destinations.stderr]) {
      try { dest.destroy(); } catch { /* already closed */ }
    }
  }

  function writeAcknowledged(dest, data, timeoutMs = PROTOCOL_STDIO_SETTLE_MS) {
    install();
    const name = dest === destinations.stderr ? 'stderr' : 'stdout';
    if (discarded[name] || !dest || dest.destroyed || !dest.writable) {
      return Promise.resolve(false);
    }
    const payload = Buffer.isBuffer(data) ? data : Buffer.from(data);
    if (payload.length === 0) return Promise.resolve(true);
    pendingWrites += 1;
    return new Promise((resolve) => {
      let settled = false;
      let offset = 0;
      let activeDrain;
      const finish = (ok, error) => {
        if (settled) return;
        settled = true;
        pendingWrites = Math.max(0, pendingWrites - 1);
        clearTimeout(timer);
        dest.off('error', onError);
        dest.off('close', onClose);
        if (activeDrain) dest.off('drain', activeDrain);
        if (error) handleDestError(name, dest, error);
        resolve(ok && !discarded[name] && !closedDest[name]);
        flushUninstall();
      };
      const onError = (error) => finish(false, error);
      const onClose = () => finish(false);
      const timer = setTimeout(() => {
        discardChannel(name);
        try { dest.destroy(); } catch { /* already closed */ }
        finish(false);
      }, Math.max(1, Math.floor(timeoutMs)));

      dest.once('error', onError);
      dest.once('close', onClose);

      const writeNext = () => {
        if (settled) return;
        if (discarded[name] || dest.destroyed || !dest.writable) {
          finish(false);
          return;
        }
        if (dest.writableNeedDrain) {
          activeDrain = () => {
            activeDrain = undefined;
            writeNext();
          };
          dest.once('drain', activeDrain);
          return;
        }
        if (offset >= payload.length) {
          finish(true);
          return;
        }

        const end = Math.min(offset + HOST_DELIVERY_CHUNK_BYTES, payload.length);
        const chunk = payload.subarray(offset, end);
        let callbackComplete = false;
        let drainComplete = true;
        let writeReturned = false;
        const maybeContinue = () => {
          if (
            settled
            || !writeReturned
            || !callbackComplete
            || !drainComplete
          ) {
            return;
          }
          activeDrain = undefined;
          offset = end;
          writeNext();
        };

        try {
          const accepted = dest.write(chunk, (error) => {
            if (error) {
              finish(false, error);
              return;
            }
            callbackComplete = true;
            maybeContinue();
          });
          writeReturned = true;
          if (!accepted) {
            drainComplete = false;
            activeDrain = () => {
              drainComplete = true;
              maybeContinue();
            };
            dest.once('drain', activeDrain);
          }
          maybeContinue();
        } catch (error) {
          finish(false, error);
        }
      };

      writeNext();
    });
  }

  async function writeHostAcknowledged(data, timeoutMs) {
    const dest = destinations.stdout;
    const payload = Buffer.isBuffer(data) ? data : Buffer.from(data);
    if (
      process.platform !== 'win32'
      || dest !== process.stdout
      || payload.length <= HOST_DELIVERY_CHUNK_BYTES
    ) {
      return writeAcknowledged(dest, payload, timeoutMs);
    }
    if (
      discarded.stdout
      || closedDest.stdout
      || !dest
      || dest.destroyed
      || !dest.writable
    ) {
      return false;
    }

    pendingWrites += 1;
    try {
      const {
        writeHostStdoutAndWait,
      } = require('./lib/host-stdout-writer.cjs');
      await writeHostStdoutAndWait(
        payload,
        timeoutMs,
        writer => recordTestProcess('stdout-writer', writer.pid),
      );
      if (
        discarded.stdout
        || closedDest.stdout
        || dest.destroyed
        || !dest.writable
      ) {
        return false;
      }
      deliveredBytes.stdout += payload.length;
      notifyDeliveryWaiters('stdout');
      return true;
    } catch (error) {
      if (isClosedDestinationError(error)) closedDest.stdout = true;
      discardChannel('stdout');
      try { dest.destroy(); } catch { /* already closed */ }
      if (typeof hooks.onDestinationClose === 'function') {
        hooks.onDestinationClose('stdout');
      }
      return false;
    } finally {
      pendingWrites = Math.max(0, pendingWrites - 1);
      flushUninstall();
    }
  }

  function write(dest, data) {
    return writeAcknowledged(dest, data, PROTOCOL_STDIO_SETTLE_MS);
  }

  function waitForDelivery(name, bytes, timeoutMs) {
    install();
    const dest = destinations[name];
    if (
      !Number.isSafeInteger(bytes)
      || bytes < 0
      || discarded[name]
      || closedDest[name]
      || !dest
      || dest.destroyed
      || !dest.writable
    ) {
      return Promise.resolve(false);
    }
    if (deliveredBytes[name] >= bytes && !dest.writableNeedDrain) {
      return Promise.resolve(true);
    }

    return new Promise((resolve) => {
      const waiter = {
        bytes,
        resolve,
        timer: undefined,
      };
      waiter.timer = setTimeout(() => {
        deliveryWaiters[name] = deliveryWaiters[name].filter(
          (candidate) => candidate !== waiter,
        );
        discardChannel(name);
        try { dest.destroy(); } catch { /* already closed */ }
        resolve(false);
      }, Math.max(1, Math.floor(timeoutMs)));
      deliveryWaiters[name].push(waiter);
      notifyDeliveryWaiters(name);
    });
  }

  function attachChild(child) {
    install();
    const bind = (source, dest, name) => {
      if (!source) return;
      const tap = new PassThrough();
      const binding = {
        source,
        tap,
        dest,
        writer: null,
        completed: false,
        lastProgressAt: Date.now(),
      };
      const writer = new Writable({
        write(chunk, _encoding, callback) {
          let offset = 0;
          const writeNext = () => {
            if (discarded[name] || !dest || dest.destroyed || !dest.writable) {
              callback();
              return;
            }
            if (offset >= chunk.length) {
              callback();
              return;
            }
            const end = Math.min(offset + 1024, chunk.length);
            const slice = chunk.subarray(offset, end);
            let callbackComplete = false;
            let drainComplete = true;
            let writeReturned = false;
            let completed = false;
            const finishSlice = (error) => {
              if (completed) return;
              completed = true;
              if (error) {
                handleDestError(name, dest, error);
                callback();
                return;
              }
              binding.lastProgressAt = Date.now();
              deliveredBytes[name] += slice.length;
              notifyDeliveryWaiters(name);
              offset = end;
              writeNext();
            };
            const maybeFinishSlice = () => {
              if (
                writeReturned
                && callbackComplete
                && drainComplete
              ) {
                finishSlice();
              }
            };
            try {
              const accepted = dest.write(slice, (error) => {
                if (error) {
                  finishSlice(error);
                  return;
                }
                callbackComplete = true;
                maybeFinishSlice();
              });
              writeReturned = true;
              if (!accepted) {
                drainComplete = false;
                dest.once('drain', () => {
                  drainComplete = true;
                  maybeFinishSlice();
                });
              }
              maybeFinishSlice();
            } catch (error) {
              finishSlice(error);
            }
          };
          writeNext();
        },
      });
      binding.writer = writer;
      bindings[name].push(binding);
      source.on('data', () => { binding.lastProgressAt = Date.now(); });
      source.pipe(tap);
      tap.pipe(writer);
      tap.on('error', (error) => handleDestError(name, dest, error));
      writer.on('finish', () => { binding.completed = true; });
      writer.on('error', (error) => handleDestError(name, dest, error));
    };
    bind(child.stdout, destinations.stdout, 'stdout');
    bind(child.stderr, destinations.stderr, 'stderr');
  }

  function settleOutputs(timeoutMs, idleMs = PROTOCOL_SOURCE_IDLE_MS, reapIdleSources = true) {
    const active = [...bindings.stdout, ...bindings.stderr];
    if (active.length === 0) return Promise.resolve(true);
    const deadline = Date.now() + Math.max(1, timeoutMs);
    return new Promise(resolve => {
      let settled = false;
      const finish = (complete) => {
        if (settled) return;
        settled = true;
        clearInterval(timer);
        resolve(complete);
      };
      const inspect = () => {
        if (Date.now() >= deadline) {
          abandonOutputs();
          finish(false);
          return;
        }
        if (active.every(binding => (binding.completed && !binding.dest.writableNeedDrain) || binding.writer.destroyed)) {
          finish(true);
          return;
        }
        if (!reapIdleSources) return;
        const now = Date.now();
        for (const binding of active) {
          if (binding.completed || binding.writer.destroyed) continue;
          if (now - binding.lastProgressAt < idleMs) continue;
          const sourceEnded = binding.source.readableEnded || binding.source.destroyed;
          const bufferedBytes = binding.source.readableLength + binding.tap.readableLength +
            binding.writer.writableLength + (binding.dest.writableLength || 0);
          // An open source with an empty pipeline after the leader exited is a
          // leaked descendant handle. Buffered bytes, by contrast, are valid
          // protocol output and retain the remaining declared hook budget.
          if (!sourceEnded && bufferedBytes === 0) {
            teardownChannel(binding.dest === process.stderr ? 'stderr' : 'stdout');
          }
        }
      };
      const timer = setInterval(inspect, Math.max(5, Math.floor(idleMs / 4)));
      inspect();
    });
  }

  return {
    install,
    uninstall,
    write,
    writeAcknowledged,
    writeHostAcknowledged,
    attachChild,
    waitForDelivery,
    settleOutputs,
    abandonOutputs,
    closeDestinations,
    hasClosedDestination: () => closedDest.stdout || closedDest.stderr,
  };
}

function detachProtocolStdio(child) {
  if (!child) return;
  for (const [stream, dest] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
    if (!stream) continue;
    try { stream.unpipe(dest); } catch { /* already detached */ }
    try {
      if (typeof stream.pause === 'function') stream.pause();
      const destWritable = dest && !dest.destroyed && dest.writable && !dest.writableNeedDrain;
      if (typeof stream.read === 'function' && destWritable) {
        let chunk;
        while ((chunk = stream.read()) !== null) dest.write(chunk);
      }
    } catch { /* remaining buffered bytes are best-effort */ }
    try { stream.destroy(); } catch { /* already destroyed */ }
  }
}

function releaseGenericChild(child) {
  detachProtocolStdio(child);
  try {
    if (child.connected) child.disconnect();
  } catch {
    // The child may already have exited or closed its IPC channel.
  }
  try { child.unref(); } catch { /* handle already released */ }
}

function boundedHostDeliveryTimeout(request, deadlineAt) {
  const requested = Math.max(1, Math.floor(request.timeoutMs));
  if (!Number.isFinite(deadlineAt)) return requested;
  const remaining = Math.max(
    1,
    deadlineAt - Date.now() - PROTOCOL_STDIO_SETTLE_MS,
  );
  return Math.min(requested, remaining);
}

function hostDeliveryAbortGraceMs(manifestHook, timeoutMs) {
  if (!manifestHook || !Number.isFinite(manifestHook.timeoutMs)) return 0;
  return Math.max(
    0,
    Math.min(
      PROTOCOL_STDIO_SETTLE_MS,
      manifestHook.timeoutMs - timeoutMs,
    ),
  );
}

function superviseGenericChild(targetPath, extraArgs) {
  let terminal = false;
  const relayHostDelivery = process.env[HOST_DELIVERY_ACK_ENV] === '1';
  const child = spawn(process.execPath, [targetPath, ...extraArgs], {
    stdio: relayHostDelivery
      ? ['inherit', 'inherit', 'inherit', 'ipc']
      : 'inherit',
    env: {
      ...process.env,
      OMC_SESSION_OWNER_PID: process.env.OMC_SESSION_OWNER_PID || String(process.ppid),
    },
    windowsHide: true,
    detached: process.platform !== 'win32',
  });
  recordTestExecutionRoute('generic-windows-supervisor');
  recordTestProcess('generic-processor', child.pid);
  const childIdentity = child.pid ? captureProcessStartIdentity(child.pid) : null;
  const relayToParent = message => {
    if (
      !relayHostDelivery
      || (
        !isHostDeliveryRequest(message)
        && !isHostDeliveryProcess(message)
        && !isHostProcessIdentityRequest(message)
      )
      || typeof process.send !== 'function'
      || !process.connected
    ) {
      return;
    }
    if (
      isHostProcessIdentityRequest(message)
      && message.pid !== child.pid
    ) {
      try {
        child.send(
          hostProcessIdentityResult(
            message,
            null,
            'process identity request did not match the supervised hook',
          ),
          () => {},
        );
      } catch {
        // The child may already have exited.
      }
      return;
    }
    try { process.send(message, () => {}); } catch { /* parent already gone */ }
  };
  const relayToChild = message => {
    if (
      !relayHostDelivery
      || (
        !isHostDeliveryMessage(message, HOST_DELIVERY_RESULT)
        && !isHostDeliveryAbort(message)
        && !isHostProcessIdentityResult(message)
      )
      || typeof child.send !== 'function'
      || !child.connected
    ) {
      return;
    }
    try { child.send(message, () => {}); } catch { /* child already gone */ }
  };
  if (relayHostDelivery) {
    child.on('message', relayToParent);
    process.on('message', relayToChild);
  }
  const detachRelay = () => {
    child.off('message', relayToParent);
    process.off('message', relayToChild);
  };
  const finish = (status) => {
    if (terminal) return;
    terminal = true;
    detachRelay();
    process.exitCode = status;
    if (process.connected) process.disconnect();
  };

  // The supervisor is a detached Windows child of run.cjs. Its IPC channel is
  // closed by the OS even when run.cjs is externally terminated without JS
  // cleanup, so it can reap only the hook tree that it created.
  process.once('disconnect', () => {
    if (terminal) return;
    terminal = true;
    detachRelay();
    void reapTree(child, childIdentity).finally(() => {
      try { child.unref(); } catch { /* handle already released */ }
    });
  });
  child.once('exit', code => finish(typeof code === 'number' ? code : 0));
  child.once('error', () => finish(0));
}

function runGenericChild(targetPath, extraArgs, timeoutMs, manifestHook, options = {}) {
  const deadlineAt = options.deadlineAt;
  const hostDeliveryAck = options.hostDeliveryAck === true;
  const identityBroker = hostDeliveryAck
    ? createWindowsProcessIdentityBroker(deadlineAt)
    : null;
  let child;
  let childIdentity = null;
  let reapPromise;
  const reapOnce = () => {
    if (!child) return Promise.resolve();
    if (!reapPromise) reapPromise = reapTree(child, childIdentity);
    return reapPromise;
  };
  let destinationClosed = false;
  let startClosedDestinationCleanup = () => {};
  const sink = createProtocolSink({
    stdout: options.stdout,
    stderr: options.stderr,
    beforeSourceDestroy: reapOnce,
    onDestinationClose: () => {
      destinationClosed = true;
      startClosedDestinationCleanup();
    },
  });
  sink.install();
  return new Promise(resolve => {
    const protocolDeadline = Number.isSafeInteger(deadlineAt)
      ? deadlineAt
      : Date.now() + timeoutMs;
    let terminal = false;
    let finished = false;
    let settling = false;
    let timer;
    let closeCleanupStarted = false;
    let closeCleanupTimer;
    let childExited = false;
    let resolveChildExit;
    const childExitPromise = new Promise((resolveChildExitPromise) => {
      resolveChildExit = resolveChildExitPromise;
    });
    const deliveryRequests = new Set();
    const closeGraceMs = Math.min(timeoutMs, WINDOWS_GENERIC_STARTUP_MS + PROTOCOL_STDIO_SETTLE_MS);
    let detachHandlers = () => {};
    const finish = (status) => {
      if (finished) return;
      finished = true;
      terminal = true;
      if (closeCleanupTimer) {
        clearTimeout(closeCleanupTimer);
        closeCleanupTimer = undefined;
      }
      sink.uninstall();
      void Promise.resolve(identityBroker?.close())
        .finally(() => resolve(status));
    };
    const finishClosedDestination = async () => {
      if (terminal) return;
      terminal = true;
      settling = false;
      if (closeCleanupTimer) {
        clearTimeout(closeCleanupTimer);
        closeCleanupTimer = undefined;
      }
      detachHandlers();
      await reapOnce();
      sink.abandonOutputs();
      detachProtocolStdio(child);
      releaseGenericChild(child);
      finish(0);
    };
    startClosedDestinationCleanup = () => {
      if (closeCleanupStarted || terminal) return;
      closeCleanupStarted = true;
      closeCleanupTimer = setTimeout(() => {
        void finishClosedDestination();
      }, closeGraceMs);
      if (hostDeliveryAck) return;
      if (settling) return;
      settling = true;
      // A destination close is observed only after the active child reaches
      // that protocol channel. Keep the sibling channel for its existing idle
      // grace, but do not wait the full startup allowance on an open source
      // that has no buffered output.
      void sink.settleOutputs(closeGraceMs, PROTOCOL_SOURCE_IDLE_MS).then(() => {
        settling = false;
        void finishClosedDestination();
      });
    };
    try {
      const childEnv = resolveChildEnv(
        targetPath,
        hostDeliveryAck,
        Number.isFinite(deadlineAt) ? deadlineAt : protocolDeadline,
      );
      child = spawn(process.execPath, resolveGenericChildCommand(targetPath, extraArgs), {
        env: {
          ...childEnv,
          OMC_SESSION_OWNER_PID: childEnv.OMC_SESSION_OWNER_PID || String(process.ppid),
        },
        stdio: resolveGenericChildStdio(process.platform, hostDeliveryAck),
        windowsHide: true,
        detached: true,
      });
      if (process.platform !== 'win32') {
        recordTestExecutionRoute('generic-child');
      }
      recordTestProcess(
        process.platform === 'win32'
          ? 'generic-supervisor'
          : 'generic-processor',
        child.pid,
      );
    } catch (error) {
      writeSpawnErrorDiagnostic(targetPath, manifestHook, error);
      finish(hookFailureExitCode(manifestHook));
      return;
    }
    sink.attachChild(child);
    childIdentity = child.pid ? captureProcessStartIdentity(child.pid) : null;
    const onHostDeliveryMessage = message => {
      if (!hostDeliveryAck) return;
      if (isHostDeliveryProcess(message)) {
        recordTestProcess(message.role, message.pid);
        return;
      }
      if (isHostProcessIdentityRequest(message)) {
        void Promise.resolve(
          identityBroker?.request(message.pid) ?? null,
        ).then(identity => {
          if (typeof child.send !== 'function' || !child.connected) return;
          try {
            child.send(
              hostProcessIdentityResult(
                message,
                identity,
                identity
                  ? undefined
                  : 'runner process identity broker was unavailable',
              ),
              () => {},
            );
          } catch {
            // The child may already have exited.
          }
        });
        return;
      }
      if (
        !isHostDeliveryRequest(message)
        || deliveryRequests.has(message.id)
      ) return;
      deliveryRequests.add(message.id);
      const deliveryTimeoutMs = boundedHostDeliveryTimeout(
        message,
        protocolDeadline,
      );
      void sink.writeHostAcknowledged(
        Buffer.from(message.payload, 'utf8'),
        deliveryTimeoutMs,
      ).then(ok => {
        const response = hostDeliveryResult(
          message,
          ok,
          ok ? undefined : 'host stdout delivery failed or timed out',
        );
        if (typeof child.send !== 'function' || !child.connected) return;
        try { child.send(response, () => {}); } catch { /* child already gone */ }
      });
    };
    if (hostDeliveryAck) child.on('message', onHostDeliveryMessage);

    detachHandlers = () => {
      clearTimeout(timer);
      child.off('message', onHostDeliveryMessage);
      for (const signal of RUNNER_TERMINATION_SIGNALS) process.off(signal, onRunnerSignal);
      process.off('beforeExit', onRunnerBeforeExit);
    };
    function onRunnerSignal() {
      if (terminal && !settling) return;
      terminal = true;
      settling = false;
      detachHandlers();
      void (async () => {
        await reapOnce();
        void identityBroker?.close();
        sink.abandonOutputs();
        detachProtocolStdio(child);
        sink.uninstall();
        process.exit(hookFailureExitCode(manifestHook));
      })();
    }
    async function onRunnerBeforeExit() {
      if (terminal && !settling) return;
      terminal = true;
      settling = false;
      await reapOnce();
      void identityBroker?.close();
      sink.abandonOutputs();
      detachProtocolStdio(child);
    }

    const timerDelayMs = Number.isFinite(deadlineAt)
      ? Math.max(1, deadlineAt - Date.now())
      : timeoutMs;
    timer = setTimeout(() => {
      if (terminal) return;
      terminal = true;
      detachHandlers();
      void (async () => {
        const abortGraceMs = hostDeliveryAck
          ? hostDeliveryAbortGraceMs(manifestHook, timeoutMs)
          : 0;
        if (
          abortGraceMs > 0
          && typeof child.send === 'function'
          && child.connected
        ) {
          try {
            child.send(
              hostDeliveryAbort('runner timeout before host stdout delivery'),
              () => {},
            );
          } catch {
            // The child may have exited at the timeout boundary.
          }
          await Promise.race([
            childExitPromise,
            new Promise(resolveAbortGrace =>
              setTimeout(resolveAbortGrace, abortGraceMs)),
          ]);
          }
          if (!childExited) await reapOnce();
          await writeTimeoutDiagnostic(targetPath, manifestHook, timeoutMs, sink);
        sink.abandonOutputs();
        detachProtocolStdio(child);
        releaseGenericChild(child);
        if (require.main === module) {
          sink.closeDestinations();
        }
        finish(hookFailureExitCode(manifestHook));
      })();
    }, timerDelayMs);
    child.once('exit', (code, signal) => {
      childExited = true;
      resolveChildExit();
      if (terminal) return;
      if (destinationClosed) {
        void finishClosedDestination();
        return;
      }
      settling = true;
      clearTimeout(timer);
      const remainingProtocolMs = Math.max(1, protocolDeadline - Date.now());
      void sink.settleOutputs(remainingProtocolMs).then(async (complete) => {
        settling = false;
        if (terminal) return;
        if (destinationClosed) {
          void finishClosedDestination();
          return;
        }
        detachHandlers();
        await reapOnce();
        if (!complete && require.main === module) {
          sink.closeDestinations();
          releaseGenericChild(child);
          return process.exit(isCriticalManifestHook(manifestHook) ? 2 : 1);
        }
        releaseGenericChild(child);
        const childStatus = typeof code === 'number' ? code : 0;
        const exitStatus = isCriticalManifestHook(manifestHook)
          ? (childStatus === 0 && signal === null ? 0 : 2)
          : childStatus;
        finish(complete ? (sink.hasClosedDestination() ? 0 : exitStatus) : (isCriticalManifestHook(manifestHook) ? 2 : 1));
      });
    });
    child.once('error', (error) => {
      childExited = true;
      resolveChildExit();
      if (terminal) return;
      terminal = true;
      detachHandlers();
      detachProtocolStdio(child);
      writeSpawnErrorDiagnostic(targetPath, manifestHook, error);
      finish(hookFailureExitCode(manifestHook));
    });

    for (const signal of RUNNER_TERMINATION_SIGNALS) process.on(signal, onRunnerSignal);
    process.on('beforeExit', onRunnerBeforeExit);
  });
}

// A Worker created with `stdin: true` owns a stdio MessagePort that stays
// referenced until its stdin reaches EOF, and the parent cannot release it from
// the outside: ending or destroying `worker.stdin` leaves the worker-side
// readable open, so the worker never exits. A hook that returns before touching
// stdin — every `OMC_SKIP_HOOKS` / `DISABLE_OMC=1` early return — therefore
// idled until the manifest budget expired and was reported as a bogus timeout
// while the payload sat unread (#4086).
//
// This bootstrap runs the hook unchanged and, once its module evaluation has
// settled, resumes stdin only when the hook provably never looked at it: not
// flowing and no reader attached. Resuming drains the already-delivered payload
// to EOF, which releases the port; destroying the stream instead would break
// the EOF path and pin the worker forever. A hook that does read stdin attaches
// its listeners synchronously inside `main()` before its first await, so it is
// always observed as a consumer and keeps the untouched behaviour. Only
// 'data'/'readable' count as a reader: Node attaches its own internal 'end'
// listener to a worker stdin.
//
// `process.argv[1]` is restored to the hook path so entry guards of the form
// `import.meta.url === pathToFileURL(process.argv[1]).href` still fire.
const WORKER_STDIN_BOOTSTRAP = `
const { workerData } = require('node:worker_threads');
const { fileURLToPath } = require('node:url');
const targetUrl = workerData.omcWorkerTarget;
process.argv[1] = fileURLToPath(targetUrl);
function drainUnreadStdin() {
  const stdin = process.stdin;
  if (!stdin || stdin.destroyed || stdin.readableEnded) return;
  if (stdin.readableFlowing === true) return;
  if (stdin.listenerCount('data') > 0 || stdin.listenerCount('readable') > 0) return;
  try { stdin.resume(); } catch { /* already closed */ }
}
import(targetUrl).then(
  () => { setImmediate(drainUnreadStdin); },
  (error) => {
    setImmediate(() => {
      drainUnreadStdin();
      throw error;
    });
  },
);
`;

/**
 * git-guardrails.mjs is a no-op when explicitly disabled; skip starting its
 * worker entirely. Returns 0 to exit, or null to run the worker.
 */
function gitGuardrailsPreCheck() {
  if (process.env.OMC_GIT_GUARDRAILS === '0') return 0;
  return null;
}

async function runWorker(targetPath, manifestHook, timeoutMs, options = {}) {
  const { pathToFileURL } = require('url');
  const { Worker } = require('worker_threads');
  let worker;
  let terminal = false;
  let timer;
  let discardOutput = false;
  let workerExited = false;
  let resolveWorkerExit;
  const workerExitPromise = new Promise((resolveWorkerExitPromise) => {
    resolveWorkerExit = resolveWorkerExitPromise;
  });
  const stdout = [];
  const stderr = [];
  const deliveryRequests = new Set();
  const deliveryDeadline = Number.isSafeInteger(options.deadlineAt)
    ? options.deadlineAt
    : RUNNER_STARTED_AT + timeoutMs;
  const identityBroker = options.hostDeliveryAck === true
    ? createWindowsProcessIdentityBroker(deliveryDeadline)
    : null;
  let deliveryChain = Promise.resolve();
  const sink = createProtocolSink();
  sink.install();

  const cleanupInput = () => {
    if (!worker) return;
    process.stdin.unpipe(worker.stdin);
    worker.stdin.destroy();
  };
  const waitForOutputEnd = stream => stream.readableEnded
    ? Promise.resolve()
    : new Promise(resolve => stream.once('end', resolve));
  const sendDeliveryResult = (message, ok, error) => {
    if (!worker) return;
    try {
      worker.postMessage(hostDeliveryResult(message, ok, error));
    } catch {
      // The Worker may have exited after its acknowledgement timeout.
    }
  };
  const sendProcessIdentityResult = (message, identity, error) => {
    if (!worker) return;
    try {
      worker.postMessage(
        hostProcessIdentityResult(message, identity, error),
      );
    } catch {
      // The Worker may have exited during the identity query.
    }
  };
  const processDeliveryRequest = async message => {
    if (
      !isHostDeliveryRequest(message)
      || deliveryRequests.has(message.id)
    ) {
      return;
    }
    deliveryRequests.add(message.id);
    const requestTimeoutMs = boundedHostDeliveryTimeout(
      message,
      deliveryDeadline,
    );
    if (terminal) {
      sendDeliveryResult(
        message,
        false,
        'worker ended before host delivery could be acknowledged',
      );
      return;
    }

    const delivered = await sink.writeHostAcknowledged(
      Buffer.from(message.payload, 'utf8'),
      requestTimeoutMs,
    );
    sendDeliveryResult(
      message,
      delivered,
      delivered ? undefined : 'host stdout delivery failed or timed out',
    );
  };
  const onHostDeliveryMessage = message => {
    if (isHostDeliveryProcess(message)) {
      recordTestProcess(message.role, message.pid);
      return;
    }
    if (isHostProcessIdentityRequest(message)) {
      if (message.pid !== process.pid) {
        sendProcessIdentityResult(
          message,
          null,
          'process identity request did not match the Worker process',
        );
        return;
      }
      void Promise.resolve(
        identityBroker?.request(message.pid) ?? null,
      ).then(identity => {
        sendProcessIdentityResult(
          message,
          identity,
          identity
            ? undefined
            : 'runner process identity broker was unavailable',
        );
      });
      return;
    }
    if (!isHostDeliveryRequest(message)) return;
    deliveryChain = deliveryChain
      .then(() => processDeliveryRequest(message))
      .catch(() => {
        sendDeliveryResult(
          message,
          false,
          'host stdout delivery acknowledgement failed',
        );
      });
  };
  const forwardBuffers = async (workerError) => {
    if (stdout.length) {
      await sink.write(process.stdout, Buffer.concat(stdout));
    }
    if (stderr.length) await sink.write(process.stderr, Buffer.concat(stderr));
    if (workerError) {
      const diagnostic = workerError.stack || workerError.message || String(workerError);
      await sink.write(process.stderr, Buffer.from(`${diagnostic}\n`));
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
        if (worker) {
          await waitForWorkerOutput();
        }
        await deliveryChain;
        await forwardBuffers(workerError);
        await identityBroker?.close();
        sink.uninstall();
        resolve(status);
      };

      timer = setTimeout(async () => {
        if (terminal) return;
        terminal = true;
        cleanupInput();
        const abortGraceMs = options.hostDeliveryAck === true
          ? hostDeliveryAbortGraceMs(manifestHook, timeoutMs)
          : 0;
        if (abortGraceMs > 0 && worker) {
          try {
            worker.postMessage(
              hostDeliveryAbort('runner timeout before host stdout delivery'),
            );
          } catch {
            // The Worker may have exited at the timeout boundary.
          }
          await Promise.race([
            workerExitPromise,
            new Promise(resolveAbortGrace =>
              setTimeout(resolveAbortGrace, abortGraceMs)),
          ]);
        }
        if (!workerExited) {
          discardOutput = true;
          try {
            await worker.terminate();
          } catch {
            // Termination is best-effort; the hook must still fail open.
          }
        }
        if (worker) {
          await waitForWorkerOutput();
        }
        await deliveryChain;
        if (stderr.length) {
          await sink.write(process.stderr, Buffer.concat(stderr));
        }
        await writeTimeoutDiagnostic(targetPath, manifestHook, timeoutMs, sink, 'fail-open');
        await identityBroker?.close();
        sink.uninstall();
        resolve(0);
      }, Math.max(1, deliveryDeadline - Date.now()));

      try {
        worker = new Worker(WORKER_STDIN_BOOTSTRAP, {
          eval: true,
          stdin: true,
          stdout: true,
          stderr: true,
          env: resolveChildEnv(
            targetPath,
            options.hostDeliveryAck === true,
            deliveryDeadline,
          ),
          workerData: { omcWorkerTarget: pathToFileURL(targetPath).href },
        });
        recordTestExecutionRoute('worker');
        recordTestProcess('worker-thread', process.pid, {
          threadId: worker.threadId,
        });
        if (process.stdin.readableEnded) worker.stdin.end();
        else process.stdin.pipe(worker.stdin);
        worker.stdout.on('data', chunk => {
          if (discardOutput) return;
          stdout.push(chunk);
        });
        worker.stderr.on('data', chunk => { if (!discardOutput) stderr.push(chunk); });
        worker.on('message', onHostDeliveryMessage);
        worker.once('error', error => {
          void finish(1, error);
        });
        worker.once('exit', code => {
          workerExited = true;
          resolveWorkerExit();
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
  if (target === '--generic-child-supervisor') {
    const supervisedTarget = process.argv[3];
    if (supervisedTarget) superviseGenericChild(supervisedTarget, process.argv.slice(4));
    return 0;
  }
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
      return 0;
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
      return 0;
    }
    const output = await runSessionEndFastPath(
      resolution.targetPath,
      frame.raw,
      frame.value,
      childEnv,
    );
    writeSync(1, `${output}\n`);
    return 0;
  }

  const workerManifestHook = resolveWorkerTarget(resolution, extraArgs);
  const hostDeliveryAck = Boolean(
    workerManifestHook
    && basename(resolution.targetPath) === HOST_DELIVERY_SCRIPT
  );
  const forceGeneric = Boolean(
    workerManifestHook
    && forceTrustedWorkerGenericForTest()
  );
  if (workerManifestHook && !forceGeneric) {
    if (
      basename(resolution.targetPath) === 'git-guardrails.mjs'
      && gitGuardrailsPreCheck() === 0
    ) {
      return 0;
    }
    const workerTimeoutMs = resolveTrustedWorkerTimeoutMs(resolution.targetPath, workerManifestHook);
    return runWorker(
      resolution.targetPath,
      workerManifestHook,
      workerTimeoutMs,
      {
        deadlineAt: RUNNER_STARTED_AT + workerTimeoutMs,
        hostDeliveryAck,
      },
    );
  }

  const trustedSessionEndHook = resolveTrustedSessionEndTarget(resolution, extraArgs);
  if (trustedSessionEndHook) {
    const requestedTestTimeout = process.env.NODE_ENV === 'test'
      ? Number(process.env.OMC_SESSION_END_TEST_FOREGROUND_TIMEOUT_MS)
      : NaN;
    const budgetMs = Number.isFinite(requestedTestTimeout) && requestedTestTimeout > 0
      ? requestedTestTimeout
      : 300;
    const timeoutMs = Math.min(resolveGenericTimeoutMs(trustedSessionEndHook), budgetMs);
    return runWorker(resolution.targetPath, trustedSessionEndHook, timeoutMs);
  }

  const manifestHook = workerManifestHook
    || resolveHookTimeoutMs(resolution.targetPath, extraArgs);
  const timeoutMs = resolveGenericTimeoutMs(manifestHook);
  return runGenericChild(
    resolution.targetPath,
    extraArgs,
    timeoutMs,
    manifestHook,
    {
      deadlineAt: RUNNER_STARTED_AT + timeoutMs,
      hostDeliveryAck,
    },
  );
}

if (require.main === module) {
  ensureProcessDestGuards();
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
  resolveTrustedPromptWorkerTimeoutMs: resolveTrustedWorkerTimeoutMs,
  resolveTrustedWorkerTimeoutMs,
  resolveSessionEndTarget,
  resolveTrustedSessionEndTarget,
  resolveWorkerTarget,
  resolveHookTimeoutMs,
  resolveGenericTimeoutMs,
  resolveTimeoutCushionMs,
  desiredTimeoutCushionMs,
  platformTimeoutCushionMs,
  runSessionEndFastPath,
  runGenericChild,
  resolveGenericChildCommand,
  resolveGenericChildStdio,
  releaseGenericChild,
  isClosedDestinationError,
  DEFAULT_GENERIC_TIMEOUT_MS,
  TIMEOUT_CUSHION_MS,
  WINDOWS_TIMEOUT_CUSHION_MS,
  WINDOWS_REAP_TIMEOUT_MS,
  MIN_HOOK_INNER_MS,
  MIN_HOOK_INNER_FRACTION,
  WINDOWS_GENERIC_STARTUP_MS,
  NESTED_OPERATION_TIMEOUT_MS,
  NESTED_OPERATION_MARGIN_MS,
  NESTED_INNER_FLOOR_MS,
  MAX_DECLARED_GENERIC_TIMEOUT_MS,
  resolveTrustedSessionEndTarget,
};
