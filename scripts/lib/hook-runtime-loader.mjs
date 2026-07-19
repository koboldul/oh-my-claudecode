import { existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const requireFromLoader = createRequire(import.meta.url);
const loaderDirectory = dirname(fileURLToPath(import.meta.url));
const scriptRelativePluginRoot = resolve(loaderDirectory, '..', '..');

export const REQUIRED_HOOK_RUNTIME_EXPORTS = Object.freeze([
  'normalizeHookEnvelope',
  'runHookPayload',
  'runHookJson',
  'reduceHookEvaluations',
  'encodeHookOutput',
  'buildLegacyProcessorInput',
  'normalizeLegacyHookInput',
  'adaptLegacyHookOutput',
]);

export const CRITICAL_HOOK_FAILURE_EXIT_CODE = 2;
export const OPTIONAL_HOOK_FAILURE_EXIT_CODE = 0;

export class HookRuntimeLoadError extends Error {
  constructor(message, bundlePath, options = {}) {
    super(message, options);
    this.name = 'HookRuntimeLoadError';
    this.bundlePath = bundlePath;
  }
}

function requireNonEmptyPath(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty path`);
  }
  return value;
}

/**
 * Resolve the generated runtime bundle. The colocated loader-relative plugin
 * root is authoritative by default; only explicit options may select another
 * root. testBundlePath is a test-only escape hatch.
 */
export function resolveHookRuntimePath({
  pluginRoot,
  testBundlePath,
} = {}) {
  if (testBundlePath !== undefined) {
    return resolve(requireNonEmptyPath(testBundlePath, 'testBundlePath'));
  }

  const root = pluginRoot ?? scriptRelativePluginRoot;
  return join(
    resolve(requireNonEmptyPath(root, 'pluginRoot')),
    'bridge',
    'hook-runtime.cjs',
  );
}

export function validateHookRuntimeExports(runtime, bundlePath = '<hook runtime>') {
  const isModule =
    (typeof runtime === 'object' && runtime !== null)
    || typeof runtime === 'function';
  if (!isModule) {
    throw new HookRuntimeLoadError(
      `Hook runtime bundle at "${bundlePath}" did not export a module object.`,
      bundlePath,
    );
  }

  const missing = REQUIRED_HOOK_RUNTIME_EXPORTS.filter(
    (name) => typeof runtime[name] !== 'function',
  );
  if (missing.length > 0) {
    throw new HookRuntimeLoadError(
      `Hook runtime bundle at "${bundlePath}" is missing required exports: ${missing.join(', ')}.`,
      bundlePath,
    );
  }

  return runtime;
}

export function loadHookRuntime(options = {}) {
  const bundlePath = resolveHookRuntimePath(options);

  if (!existsSync(bundlePath)) {
    throw new HookRuntimeLoadError(
      `Canonical hook runtime bundle is missing at "${bundlePath}".`,
      bundlePath,
    );
  }

  let bundleStat;
  try {
    bundleStat = statSync(bundlePath);
  } catch (error) {
    throw new HookRuntimeLoadError(
      `Canonical hook runtime bundle cannot be inspected at "${bundlePath}".`,
      bundlePath,
      { cause: error },
    );
  }
  if (!bundleStat.isFile()) {
    throw new HookRuntimeLoadError(
      `Canonical hook runtime bundle is not a file at "${bundlePath}".`,
      bundlePath,
    );
  }

  let runtime;
  try {
    runtime = requireFromLoader(bundlePath);
  } catch (error) {
    throw new HookRuntimeLoadError(
      `Canonical hook runtime bundle failed to load from "${bundlePath}".`,
      bundlePath,
      { cause: error },
    );
  }

  return validateHookRuntimeExports(runtime, bundlePath);
}

function formatFailureDetail(error) {
  try {
    if (error instanceof Error && error.message) return error.message;
  } catch {
    // Continue to the non-throwing string fallback.
  }

  try {
    return String(error);
  } catch {
    return '<unprintable hook runtime failure>';
  }
}

function writeLine(stream, value) {
  stream.write(`${value}\n`);
}

function failureMessage(hookName, error, behavior) {
  const label =
    typeof hookName === 'string' && hookName.trim().length > 0
      ? hookName.trim()
      : 'hook';
  return `[${label}] Canonical hook runtime unavailable; ${behavior}: ${formatFailureDetail(error)}`;
}

/**
 * Surface a behavior-critical failure. Exit code 2 is the blocking hook error
 * used by hosts that support fail-closed hook exits.
 */
export function surfaceCriticalHookFailure(error, {
  hookName,
  stderr = process.stderr,
  processRef = process,
} = {}) {
  writeLine(
    stderr,
    failureMessage(hookName, error, 'refusing to continue silently'),
  );
  processRef.exitCode = CRITICAL_HOOK_FAILURE_EXIT_CODE;
  return CRITICAL_HOOK_FAILURE_EXIT_CODE;
}

/**
 * Surface an optional/advisory failure while allowing the host to continue.
 * The diagnostic remains visible on stderr, while stdout uses only the minimal
 * legacy continuation marker rather than duplicating host encoding logic.
 */
export function surfaceOptionalHookFailure(error, {
  hookName,
  stdout = process.stdout,
  stderr = process.stderr,
  processRef = process,
} = {}) {
  const message = failureMessage(
    hookName,
    error,
    'continuing without optional hook behavior',
  );
  writeLine(stderr, message);
  writeLine(stdout, JSON.stringify({ continue: true }));
  processRef.exitCode = OPTIONAL_HOOK_FAILURE_EXIT_CODE;
  return OPTIONAL_HOOK_FAILURE_EXIT_CODE;
}
