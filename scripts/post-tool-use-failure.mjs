#!/usr/bin/env node
// OMC Post-Tool-Use-Failure Hook (Node.js)
// Tracks tool failures for retry guidance in Stop hook
// Writes last-tool-error-state.json (session-scoped) or last-tool-error.json (legacy)
// with privacy-safe tool metadata and retry count

import { existsSync, readFileSync, mkdirSync } from 'fs';
import { dirname, join, sep, resolve } from 'path';
import { readStdin } from './lib/stdin.mjs';
import { atomicWriteFileSync, withStateFileLockAtPathSync } from './lib/atomic-write.mjs';
import {
  resolveOmcStateRoot,
  resolveSessionStatePathsForHook,
} from './lib/state-root.mjs';
import {
  loadHookRuntime,
  surfaceOptionalHookFailure,
} from './lib/hook-runtime-loader.mjs';

// ============================================================================
// Session ID resolution (mirrors src/lib/session-id.ts — inlined for .mjs)
// Precedence in hook context: payload wins over env var.
// ============================================================================

/**
 * Resolve the session id for hook context.
 * Canonical payload sessionId takes priority; falls back to OMC_SESSION_ID env var.
 *
 * @param {object|null} hookPayload - Parsed stdin payload (may be null)
 * @returns {string|undefined}
 */
function resolveHookSessionId(hookPayload) {
  const payloadId =
    hookPayload &&
    typeof hookPayload === 'object' &&
    typeof hookPayload.sessionId === 'string' &&
    hookPayload.sessionId.trim()
      ? hookPayload.sessionId.trim()
      : undefined;

  const envId =
    process.env.OMC_SESSION_ID && process.env.OMC_SESSION_ID.trim()
      ? process.env.OMC_SESSION_ID.trim()
      : undefined;

  return payloadId ?? envId;
}

// ============================================================================
// Session ID validation (mirrors src/lib/worktree-paths.ts)
// ============================================================================

const SESSION_ID_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,255}$/;

/**
 * Validate session id to prevent path traversal.
 * Returns the id if valid, undefined otherwise.
 *
 * @param {string|undefined} sessionId
 * @returns {string|undefined}
 */
function validateSessionId(sessionId) {
  if (!sessionId) return undefined;
  if (sessionId.includes('..') || sessionId.includes('/') || sessionId.includes('\\')) return undefined;
  if (!SESSION_ID_REGEX.test(sessionId)) return undefined;
  return sessionId;
}

// Use the same process-identity-aware state lock as the cleanup hook.
// run.cjs gives 3s hooks a 2.5s inner budget; share a 1.8s monotonic deadline
// across acquisition and release, with bounded SQLite and process-probe waits.
const POST_TOOL_FAILURE_LOCK_ATTEMPTS = 50;
const POST_TOOL_FAILURE_SQLITE_TIMEOUT_MS = 600;
const POST_TOOL_FAILURE_TOTAL_TIMEOUT_MS = 1800;
// A cold Windows process-identity probe can consume most of the existing
// total budget; let the shared monotonic deadline remain the actual bound.
const POST_TOOL_FAILURE_PROCESS_PROBE_TIMEOUT_MS = POST_TOOL_FAILURE_TOTAL_TIMEOUT_MS;

function withFileLockSync(filePath, fn) {
  const result = withStateFileLockAtPathSync(
    `${filePath}.lock`,
    fn,
    true,
    POST_TOOL_FAILURE_LOCK_ATTEMPTS,
    POST_TOOL_FAILURE_SQLITE_TIMEOUT_MS,
    POST_TOOL_FAILURE_PROCESS_PROBE_TIMEOUT_MS,
    POST_TOOL_FAILURE_TOTAL_TIMEOUT_MS,
  );
  return result.acquired || result.callbackRan;
}

// Constants
const RETRY_WINDOW_MS = 60000; // 60 seconds
// Do not persist tool input or raw errors: either can contain credentials.
const GENERIC_ERROR_CLASS = 'Tool execution failed (details omitted for privacy).';
const OPTIONAL_STARTUP_READ_TOOL_NAMES = new Set([
  'mcp__omx_state__state_read',
  'mcp__omx_state__state_get_status',
  'mcp__omx_state__state_list_active',
  'mcp__omx_memory__notepad_read',
  'mcp__omx_memory__project_memory_read',
]);

function getToolInputCommand(toolInput) {
  if (typeof toolInput === 'string') {
    return toolInput;
  }
  if (!toolInput || typeof toolInput !== 'object') {
    return '';
  }

  const candidateKeys = ['command', 'cmd', 'bash_command', 'script', 'query'];
  for (const key of candidateKeys) {
    const value = toolInput[key];
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
  }

  return '';
}

function isPermissionDeniedScanLine(line) {
  return /^(?:find|grep|rg): .*permission denied$/i.test(line.trim());
}

function shouldSuppressFilesystemScanPermissionNoise(toolName, toolInput, error) {
  if (String(toolName || '').toLowerCase() !== 'bash') {
    return false;
  }

  const command = getToolInputCommand(toolInput).trim();
  if (!command) {
    return false;
  }

  const looksLikeBroadScan =
    /\bAGENTS\.md\b/i.test(command) ||
    /\b(?:find|grep|rg)\b[\s\S]*?(?:\.\.|\/)/i.test(command);
  if (!looksLikeBroadScan) {
    return false;
  }

  const lines = String(error || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const permissionLines = lines.filter(isPermissionDeniedScanLine);
  if (permissionLines.length === 0) {
    return false;
  }

  const nonNoiseLines = lines.filter((line) => {
    if (isPermissionDeniedScanLine(line)) return false;
    if (/^(?:command failed with exit code \d+:|exit code \d+)$/i.test(line)) return false;
    if (line === command) return false;
    return true;
  });

  return nonNoiseLines.length === 0;
}

// Validate that targetPath is contained within basePath (prevent path traversal)
function isPathContained(targetPath, basePath) {
  const normalizedTarget = resolve(targetPath);
  const normalizedBase = resolve(basePath);
  return normalizedTarget.startsWith(normalizedBase + sep) || normalizedTarget === normalizedBase;
}

// Initialize .omc directory if needed; returns the omc root (not state subdir)
async function initOmcDir(directory) {
  const cwd = process.cwd();
  // Validate directory is contained within cwd
  if (!isPathContained(directory, cwd)) {
    // Fallback to cwd if directory attempts traversal
    directory = cwd;
  }
  const omcDir = await resolveOmcStateRoot(directory);
  const stateDir = join(omcDir, 'state');

  if (!existsSync(omcDir)) {
    try { mkdirSync(omcDir, { recursive: true }); } catch {}
  }
  if (!existsSync(stateDir)) {
    try { mkdirSync(stateDir, { recursive: true }); } catch {}
  }

  return omcDir;
}

// Read existing error state
function readErrorState(statePath) {
  try {
    if (!existsSync(statePath)) return null;
    const content = readFileSync(statePath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

// Calculate retry count
function calculateRetryCount(existingState, toolName, currentTime) {
  if (!existingState || existingState.tool_name !== toolName) {
    return 1; // First failure for this tool
  }

  const lastErrorTime = new Date(existingState.timestamp).getTime();
  // Guard against NaN from invalid timestamps
  if (!Number.isFinite(lastErrorTime)) {
    return 1; // Treat as first failure if timestamp is invalid
  }
  const timeDiff = currentTime - lastErrorTime;

  if (timeDiff > RETRY_WINDOW_MS) {
    return 1; // Outside retry window, reset count
  }

  return (existingState.retry_count || 1) + 1;
}

// Write error state to a pre-resolved statePath (session-scoped or legacy)
function writeErrorState(stateDir, toolName, retryCount, statePath) {
  const resolvedPath = statePath || join(stateDir, 'last-tool-error.json');

  const errorState = {
    tool_name: toolName,
    error: GENERIC_ERROR_CLASS,
    timestamp: new Date().toISOString(),
    retry_count: retryCount,
  };

  try {
    atomicWriteFileSync(resolvedPath, JSON.stringify(errorState, null, 2));
  } catch {}
}

function shouldSuppressOptionalStartupMethodNotFound(toolName, error) {
  if (!OPTIONAL_STARTUP_READ_TOOL_NAMES.has(toolName)) {
    return false;
  }

  return /\bmethod not found\b/i.test(String(error || ''));
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

async function processPostToolUseFailure(data) {
  const toolName = data.toolName || '';
  const toolInput = data.toolInput;
  const error = data.toolError ?? '';
  const isInterrupt = data.interrupted || false;
  const directory = data.directory || process.cwd();

  // Ignore user interrupts
  if (isInterrupt) {
    return { continue: true, suppressOutput: true };
  }

  // Skip if no tool name or error
  if (!toolName || !error) {
    return { continue: true, suppressOutput: true };
  }

  if (shouldSuppressOptionalStartupMethodNotFound(toolName, error)) {
    return { continue: true, suppressOutput: true };
  }

  if (shouldSuppressFilesystemScanPermissionNoise(toolName, toolInput, error)) {
    return { continue: true, suppressOutput: true };
  }

  // Resolve session id: payload wins over env var (hook context)
  const rawSessionId = resolveHookSessionId(data);
  const sessionId = validateSessionId(rawSessionId);

  // Initialize .omc root directory
  const omcRoot = await initOmcDir(directory);

  // Session-scoped writes use the canonical resolver. The legacy filename is
  // intentionally preserved for installs without a session id.
  const statePath = sessionId
    ? (await resolveSessionStatePathsForHook(
        directory,
        'last-tool-error',
        sessionId,
      )).writePath
    : join(omcRoot, 'state', 'last-tool-error.json');
  const stateDir = dirname(statePath);

  // Ensure session state dir exists when session-scoped
  if (sessionId) {
    try { mkdirSync(stateDir, { recursive: true }); } catch {}
  }

  // Hoist retryCount so it is accessible for guidance generation after the lock
  let retryCount = 1;

  // Read-compute-write under lock to prevent concurrent retryCount corruption
  const stateWriteCompleted = withFileLockSync(statePath, () => {
    // Read existing state and calculate retry count
    const existingState = readErrorState(statePath);
    const currentTime = Date.now();
    retryCount = calculateRetryCount(existingState, toolName, currentTime);

    // Write error state
    writeErrorState(stateDir, toolName, retryCount, statePath);
  });
  if (!stateWriteCompleted) {
    console.error('[omc-tool-failure] state write skipped because the exclusive lock was unavailable');
  }

  // Inject continuation guidance so the model analyzes the error instead of stopping.
  // Without this, PostToolUseFailure returns silently and the model may end its turn.
  // The PostToolUse hook (post-tool-verifier.mjs) provides similar guidance for
  // successful Bash calls with error patterns, but PostToolUseFailure is a separate
  // event that needs its own guidance injection.
  let guidance;
  if (retryCount >= 5) {
    guidance = `Tool "${toolName}" has failed ${retryCount} times. Stop retrying the same approach — try a different command, check dependencies, or ask the user for guidance.`;
  } else {
    guidance = `Tool "${toolName}" failed. Analyze the error, fix the issue, and continue working.`;
  }

  return {
    continue: true,
    hookSpecificOutput: {
      hookEventName: 'PostToolUseFailure',
      additionalContext: guidance,
    },
  };
}

async function main() {
  // Skip guard: honor DISABLE_OMC and OMC_SKIP_HOOKS (see issues #838, #3253).
  // Token `post-tool-use-failure` is preferred; `post-tool-use` is accepted for
  // compatibility with the sibling PostToolUse hook (post-tool-verifier.mjs).
  const _skipHooks = (process.env.OMC_SKIP_HOOKS || '').split(',').map(s => s.trim());
  if (
    process.env.DISABLE_OMC === '1' ||
    process.env.DISABLE_OMC === 'true' ||
    _skipHooks.includes('post-tool-use-failure') ||
    _skipHooks.includes('post-tool-use')
  ) {
    console.log(JSON.stringify({ continue: true }));
    return;
  }

  try {
    const runtime = loadHookRuntime();
    const input = await readStdin();
    let legacyOutput;
    const result = await runtime.runHookJson(
      'post-tool-use-failure',
      input,
      async (unit, envelope) => {
        legacyOutput = await processPostToolUseFailure(
          runtime.buildLegacyProcessorInput(envelope, unit),
        );
        return legacyOutput;
      },
    );

    const canonicalFailure = describeCanonicalFailure(result);
    if (canonicalFailure) {
      surfaceOptionalHookFailure(
        new Error(canonicalFailure),
        { hookName: 'post-tool-use-failure' },
      );
      return;
    }

    console.log(JSON.stringify(
      runtime.encodeLegacyCompatibleHookOutput(
        result.envelope,
        result.reduction,
        legacyOutput,
      ),
    ));
  } catch (error) {
    surfaceOptionalHookFailure(error, { hookName: 'post-tool-use-failure' });
  }
}

main();
