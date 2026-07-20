/**
 * Subagent Tracker Hook Module
 *
 * Tracks SubagentStart and SubagentStop events for comprehensive agent monitoring.
 * Features:
 * - Track all spawned agents with parent mode context
 * - Detect stuck/stale agents (>5 min without progress)
 * - HUD integration for agent status display
 * - Automatic cleanup of orphaned agent state
 *
 * Storage: session-scoped under .omc/state/sessions/{sessionId}/subagent-tracking-state.json
 * Locking:  withFileLockSync from file-lock.ts (O_CREAT|O_EXCL advisory lock)
 */

import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  unlinkSync,
  readdirSync,
  openSync,
  closeSync,
  readSync,
  statSync,
} from "fs";
import { createHash } from "crypto";
import { dirname, join } from "path";
import { getOmcRoot, resolveSessionStatePaths } from '../../lib/worktree-paths.js';
import { resolveSessionId } from '../../lib/session-id.js';
import { withFileLockSync, lockPathFor } from '../../lib/file-lock.js';
import {
  recordAgentReconciliation,
  recordAgentStart,
  recordAgentStop,
} from './session-replay.js';
import { recordMissionAgentStart, recordMissionAgentStop } from '../../hud/mission-board.js';

// ============================================================================
// Types
// ============================================================================

export interface SubagentInfo {
  agent_id: string;
  agent_type: string;
  agent_name?: string;
  agent_display_name?: string;
  agent_description?: string;
  started_at: string;
  start_sequence?: number;
  start_event_id?: string;
  stop_event_id?: string;
  identity_digest?: string;
  start_identity_digest?: string;
  stop_identity_digest?: string;
  delivery_fingerprint?: string;
  delivery_receipt?: string;
  stop_delivery_fingerprint?: string;
  stop_delivery_receipt?: string;
  start_event_timestamp?: number;
  stop_event_timestamp?: number;
  reported_agent_id?: string;
  id_source?: "host" | "synthetic";
  host_id_source?: "payload" | "event-log";
  correlation_status?: "host-id" | "unavailable";
  correlation_strategy?: SubagentCorrelationStrategy;
  synthetic_correlation?: boolean;
  reordered?: boolean;
  parent_mode: string; // 'autopilot' | 'ultrawork' | 'team' | 'ralph' | 'none'
  task_description?: string;
  file_ownership?: string[];
  status: "running" | "completed" | "failed";
  completed_at?: string;
  duration_ms?: number;
  output_summary?: string;
  tool_usage?: ToolUsageEntry[];
  token_usage?: TokenUsage;
  model?: string;
  synthetic?: boolean;
  telemetry_status?: "unmatched_stop";
  telemetry_note?: string;
}

export type SubagentCorrelationStrategy =
  | "host-id"
  | "synthetic-start-id"
  | "agent-name-fifo"
  | "reordered-host-id"
  | "reordered-agent-name"
  | "unmatched-stop";

export interface ToolUsageEntry {
  tool_name: string;
  timestamp: string;
  duration_ms?: number;
  success?: boolean;
}

export interface ToolTimingStats {
  count: number;
  avg_ms: number;
  max_ms: number;
  total_ms: number;
  failures: number;
}

export interface AgentPerformance {
  agent_id: string;
  tool_timings: Record<string, ToolTimingStats>;
  token_usage: TokenUsage;
  bottleneck?: string;
  parallel_efficiency?: number;
}

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cost_usd: number;
}

export interface SubagentTrackingState {
  agents: SubagentInfo[];
  total_spawned: number;
  total_completed: number;
  total_failed: number;
  last_updated: string;
  lifecycle_sequence?: number;
  delivery_receipts?: SubagentDeliveryReceipt[];
}

export interface SubagentDeliveryReceipt {
  action: "start" | "stop";
  receipt: string;
  fingerprint: string;
  agent_id?: string;
  event_id?: string;
  recorded_at: string;
}

export interface SubagentStartInput {
  session_id: string;
  transcript_path: string;
  cwd: string;
  permission_mode: string;
  hook_event_name: "SubagentStart";
  agent_id: string;
  agent_type: string;
  prompt?: string;
  model?: string;
  deliveryReceipt?: string;
}

export interface CanonicalSubagentInput {
  host?: "claude" | "copilot";
  sessionId?: string;
  directory?: string;
  transcriptPath?: string;
  stopReason?: string;
  originalIndex?: number;
  agentId?: string;
  agentName?: string;
  agentDisplayName?: string;
  agentDescription?: string;
  prompt?: string;
  model?: string;
  timestamp?: number;
  permissionMode?: string;
  lastAssistantMessage?: string;
  toolOutput?: unknown;
  status?: unknown;
  success?: boolean;
  eventPayload?: Record<string, unknown>;
  deliveryReceipt?: string;
}

export type SubagentStartProcessorInput =
  | SubagentStartInput
  | CanonicalSubagentInput;

export interface SubagentStopInput {
  session_id: string;
  transcript_path: string;
  cwd: string;
  permission_mode: string;
  hook_event_name: "SubagentStop";
  agent_id?: string;
  agent_type?: string;
  output?: string;
  /** @deprecated The SDK does not provide a success field. Use inferred status instead. */
  success?: boolean;
  deliveryReceipt?: string;
}

export type SubagentStopProcessorInput =
  | SubagentStopInput
  | CanonicalSubagentInput;

export interface SubagentLifecycleOutput {
  agent_id: string;
  agent_name?: string;
  correlation_strategy: SubagentCorrelationStrategy;
  correlation_status: "host-id" | "unavailable";
  synthetic_correlation: boolean;
  duplicate?: boolean;
  reordered?: boolean;
}

export interface HookOutput {
  continue: boolean;
  hookSpecificOutput?: {
    hookEventName: string;
    additionalContext?: string;
    agent_count?: number;
    stale_agents?: string[];
    agent_id?: string;
    agent_name?: string;
    correlation_strategy?: SubagentCorrelationStrategy;
    correlation_status?: "host-id" | "unavailable";
    synthetic_correlation?: boolean;
    duplicate?: boolean;
    reordered?: boolean;
  };
  suppressOutput?: boolean;
  tracking?: SubagentLifecycleOutput;
}

export interface AgentIntervention {
  type: "timeout" | "deadlock" | "excessive_cost" | "file_conflict";
  agent_id: string;
  agent_type: string;
  reason: string;
  suggested_action: "kill" | "restart" | "warn" | "skip";
  auto_execute: boolean;
}

export const COST_LIMIT_USD = 1.0;
export const DEADLOCK_CHECK_THRESHOLD = 3;

// ============================================================================
// Constants
// ============================================================================

const STATE_NAME = "subagent-tracking";
const STALE_THRESHOLD_MS = 5 * 60 * 1000;
const MAX_COMPLETED_AGENTS = 100;
const WRITE_DEBOUNCE_MS = 100;
const MAX_FLUSH_RETRIES = 3;
const FLUSH_RETRY_BASE_MS = 50;
const UNTRACKED_NATIVE_FORK_AGENT_TYPE = "untracked-native-fork";
const UNMATCHED_STOP_TELEMETRY_NOTE =
  "SubagentStop arrived without a matching SubagentStart; native Agent/Task start telemetry was not observed.";
const REORDERED_LIFECYCLE_TELEMETRY_NOTE =
  "Subagent lifecycle events arrived out of order and were reconciled deterministically.";
const REORDER_WINDOW_MS = 30_000;
const MAX_DELIVERY_RECEIPTS = 512;
const COPILOT_EVENT_MATCH_WINDOW_MS = 2_000;
const COPILOT_EVENT_TAIL_BYTES = 256 * 1024;
const COPILOT_EVENT_TAIL_LINES = 512;

interface NormalizedSubagentStartInput
  extends Omit<SubagentStartInput, "agent_id"> {
  agent_id?: string;
  id_source: "host" | "synthetic";
  agent_name?: string;
  agent_display_name?: string;
  agent_description?: string;
  event_timestamp?: number;
  host_id_source?: "payload" | "event-log";
  content_digest: string;
  delivery_fingerprint: string;
  delivery_receipt?: string;
}

interface NormalizedSubagentStopInput extends SubagentStopInput {
  agent_name?: string;
  agent_display_name?: string;
  agent_description?: string;
  event_timestamp?: number;
  host_id_source?: "payload" | "event-log";
  content_digest: string;
  delivery_fingerprint: string;
  delivery_receipt?: string;
}

// Lock options — short timeout for hot-path writes; stale detection generous
// so healthy writers aren't mistakenly treated as abandoned.
const LOCK_OPTS = {
  timeoutMs: 500,
  retryDelayMs: 50,
  staleLockMs: 30_000,
};
const LIFECYCLE_LOCK_OPTS = {
  ...LOCK_OPTS,
  timeoutMs: 5_000,
};

// Per write-path debounce state for batching writes (avoids race conditions).
// Key: resolved write path (session-scoped when sessionId present, legacy otherwise).
// Each session gets its own slot so concurrent sessions don't overwrite each other.
const pendingWrites = new Map<
  string,
  { state: SubagentTrackingState; sessionId: string | undefined; directory: string; timeout: ReturnType<typeof setTimeout> }
>();

// Guard against duplicate concurrent flushes per write path
const flushInProgress = new Set<string>();

/**
 * Synchronous sleep using Atomics.wait
 * Avoids CPU-spinning busy-wait loops
 */
function syncSleep(ms: number): void {
  const buffer = new SharedArrayBuffer(4);
  const view = new Int32Array(buffer);
  try {
    Atomics.wait(view, 0, 0, ms);
  } catch {
    // Main thread: Atomics.wait throws on Node <22
    const waitUntil = Date.now() + ms;
    while (Date.now() < waitUntil) { /* spin */ }
  }
}

function withLifecycleLock<T>(
  lockPath: string,
  processEvent: () => T,
): T {
  const deadline = Date.now() + LIFECYCLE_LOCK_OPTS.timeoutMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    let lockAcquired = false;
    try {
      return withFileLockSync(lockPath, () => {
        lockAcquired = true;
        return processEvent();
      }, {
        ...LIFECYCLE_LOCK_OPTS,
        timeoutMs: Math.min(250, deadline - Date.now()),
      });
    } catch (error) {
      if (lockAcquired) throw error;
      lastError = error;
    }
    syncSleep(LIFECYCLE_LOCK_OPTS.retryDelayMs);
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Failed to acquire lifecycle lock: ${lockPath}`);
}

// ============================================================================
// Path helpers
// ============================================================================

/**
 * Resolve the effective write path for subagent-tracking given a cwd and
 * optional session ID. This is the canonical path used for all I/O.
 */
function resolveWritePath(directory: string, sessionId?: string): string {
  const paths = resolveSessionStatePaths(STATE_NAME, sessionId, directory);
  return paths.effectiveWrite as string;
}

/**
 * Resolve the effective read path for subagent-tracking given a cwd and
 * optional session ID (probes session-scoped first, then legacy fallback).
 */
function resolveReadPath(directory: string, sessionId?: string): string {
  const paths = resolveSessionStatePaths(STATE_NAME, sessionId, directory);
  return paths.effectiveRead as string;
}

/**
 * Ensure the directory for a file path exists.
 */
function ensureParentDir(filePath: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

// ============================================================================
// Merge Logic
// ============================================================================

/**
 * Merge two tracker states with deterministic semantics.
 * Used by debounced flush to combine disk state with in-memory pending state.
 *
 * Merge rules:
 * - Counters (total_spawned, total_completed, total_failed): Math.max
 * - Agents: union by agent_id; if same ID exists in both, newer timestamp wins
 * - last_updated: Math.max of both timestamps
 */
export function mergeTrackerStates(
  diskState: SubagentTrackingState,
  pendingState: SubagentTrackingState,
): SubagentTrackingState {
  // Build agent map: start with disk agents, overlay with pending
  const agentMap = new Map<string, SubagentInfo>();

  for (const agent of diskState.agents) {
    agentMap.set(agent.agent_id, agent);
  }

  for (const agent of pendingState.agents) {
    const existing = agentMap.get(agent.agent_id);
    if (!existing) {
      // New agent from pending state
      agentMap.set(agent.agent_id, agent);
    } else {
      // Same agent_id in both - pick the one with the newer relevant timestamp
      const existingTime = existing.completed_at
        ? new Date(existing.completed_at).getTime()
        : new Date(existing.started_at).getTime();
      const pendingTime = agent.completed_at
        ? new Date(agent.completed_at).getTime()
        : new Date(agent.started_at).getTime();

      if (pendingTime >= existingTime) {
        agentMap.set(agent.agent_id, agent);
      }
    }
  }

  // Counters: take max to avoid double-counting
  const total_spawned = Math.max(diskState.total_spawned, pendingState.total_spawned);
  const total_completed = Math.max(diskState.total_completed, pendingState.total_completed);
  const total_failed = Math.max(diskState.total_failed, pendingState.total_failed);

  // Timestamp: take the latest
  const diskTime = new Date(diskState.last_updated).getTime();
  const pendingTime = new Date(pendingState.last_updated).getTime();
  const last_updated = diskTime > pendingTime ? diskState.last_updated : pendingState.last_updated;
  const lifecycle_sequence = Math.max(
    diskState.lifecycle_sequence ?? 0,
    pendingState.lifecycle_sequence ?? 0,
  );
  const receiptMap = new Map<string, SubagentDeliveryReceipt>();
  for (const receipt of [
    ...(diskState.delivery_receipts ?? []),
    ...(pendingState.delivery_receipts ?? []),
  ]) {
    receiptMap.set(`${receipt.action}:${receipt.receipt}`, receipt);
  }
  const delivery_receipts = Array.from(receiptMap.values())
    .sort((left, right) =>
      new Date(left.recorded_at).getTime()
      - new Date(right.recorded_at).getTime()
    )
    .slice(-MAX_DELIVERY_RECEIPTS);

  return {
    agents: Array.from(agentMap.values()),
    total_spawned,
    total_completed,
    total_failed,
    last_updated,
    ...(lifecycle_sequence > 0 ? { lifecycle_sequence } : {}),
    ...(delivery_receipts.length > 0 ? { delivery_receipts } : {}),
  };
}

// ============================================================================
// State Management
// ============================================================================

/**
 * Get the state file path for a given directory and optional session ID.
 * Creates the parent directory if it does not exist.
 *
 * @deprecated Use resolveWritePath / resolveReadPath for new code.
 */
export function getStateFilePath(directory: string, sessionId?: string): string {
  const p = resolveWritePath(directory, sessionId);
  ensureParentDir(p);
  return p;
}

/**
 * Read tracking state directly from disk, bypassing the pending writes cache.
 * Used during flush to get the latest on-disk state for merging.
 *
 * When sessionId is provided, reads the session-scoped file (or legacy fallback).
 * When sessionId is absent, reads the legacy file. If the legacy file doesn't exist
 * but session-scoped files do exist under this directory, merges them all — this
 * preserves backward-compat for callers that read without a session ID after state
 * was written exclusively to session-scoped paths.
 */
export function readDiskState(directory: string, sessionId?: string): SubagentTrackingState {
  const empty = (): SubagentTrackingState => ({
    agents: [],
    total_spawned: 0,
    total_completed: 0,
    total_failed: 0,
    last_updated: new Date().toISOString(),
  });

  const readFile = (p: string): SubagentTrackingState | null => {
    if (!existsSync(p)) return null;
    try {
      return JSON.parse(readFileSync(p, "utf-8")) as SubagentTrackingState;
    } catch (error) {
      console.error("[SubagentTracker] Error reading disk state:", error);
      return null;
    }
  };

  if (sessionId) {
    // Session-scoped read: read sessionScoped path EXCLUSIVELY (no legacy fallback).
    // Legacy fallback would leak agents/counters from the pre-session file into a
    // fresh session on its first read — see executeFlush which calls this before
    // merging a delta into disk state.
    const paths = resolveSessionStatePaths(STATE_NAME, sessionId, directory);
    return readFile(paths.sessionScoped) ?? empty();
  }

  // Legacy read: try the legacy path first
  const legacyState = readFile(resolveReadPath(directory, undefined));
  if (legacyState) return legacyState;

  // Legacy file absent — scan session-scoped files and merge them all.
  // This handles the backward-compat case where a hook wrote to session-scoped paths
  // but the caller reads without a session ID (e.g. after flushPendingWrites).
  const sessionsDir = join(getOmcRoot(directory), 'state', 'sessions');
  if (!existsSync(sessionsDir)) return empty();

  let merged = empty();
  try {
    const entries = readdirSync(sessionsDir, { withFileTypes: true });
    const normalizedName = `${STATE_NAME}-state.json`;
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const sessionState = readFile(join(sessionsDir, entry.name, normalizedName));
      if (sessionState) {
        merged = mergeTrackerStates(merged, sessionState);
      }
    }
  } catch {
    // readdirSync failed — return empty
  }

  return merged;
}

/**
 * Read tracking state from file.
 * If there's a pending write for this directory/session, returns it instead of reading disk.
 *
 * When sessionId is provided, looks for a pending write keyed by the exact session-scoped
 * write path (precise, no cross-session contamination).
 *
 * When sessionId is absent, returns the pending write for the legacy path if present,
 * then falls back to checking if any pending write belongs to this directory (any session)
 * — this preserves backward-compat for callers that wrote with a session ID (e.g. via a
 * hook) and then read back without one immediately afterward.
 */
export function readTrackingState(directory: string, sessionId?: string): SubagentTrackingState {
  // Pending writes are keyed by write path (session-scoped when sid present)
  const writePath = resolveWritePath(directory, sessionId);
  const pending = pendingWrites.get(writePath);
  if (pending) {
    return pending.state;
  }

  // When no sessionId is given, check if there is a pending write associated with this
  // exact directory (any session). Each entry stores its origin directory so we can
  // match without string prefix heuristics.
  if (!sessionId) {
    const normalizedDir = join(directory); // normalize separators via path.join
    for (const entry of pendingWrites.values()) {
      if (entry.directory === normalizedDir) {
        return entry.state;
      }
    }
  }

  return readDiskState(directory, sessionId);
}

/**
 * Write tracking state to file immediately (bypasses debounce).
 */
function writeTrackingStateImmediate(
  directory: string,
  state: SubagentTrackingState,
  sessionId?: string,
): void {
  const statePath = resolveWritePath(directory, sessionId);
  ensureParentDir(statePath);
  state.last_updated = new Date().toISOString();

  try {
    writeFileSync(statePath, JSON.stringify(state, null, 2), "utf-8");
  } catch (error) {
    console.error("[SubagentTracker] Error writing state:", error);
  }
}

/**
 * Execute the flush: lock -> re-read disk -> merge -> write -> unlock.
 * Uses withFileLockSync from file-lock.ts for proper O_CREAT|O_EXCL locking.
 * Returns true on success, false if lock could not be acquired.
 */
export function executeFlush(
  directory: string,
  pendingState: SubagentTrackingState,
  sessionId?: string,
): boolean {
  const writePath = resolveWritePath(directory, sessionId);
  ensureParentDir(writePath);
  const lockPath = lockPathFor(writePath);

  try {
    withFileLockSync(lockPath, () => {
      // Re-read latest disk state to avoid overwriting concurrent changes
      const diskState = readDiskState(directory, sessionId);
      const merged = mergeTrackerStates(diskState, pendingState);
      writeTrackingStateImmediate(directory, merged, sessionId);
    }, LOCK_OPTS);
    return true;
  } catch {
    return false;
  }
}

/**
 * Write tracking state with debouncing to reduce I/O.
 * The flush callback acquires the lock, re-reads disk state, merges with
 * the pending in-memory delta, and writes atomically.
 * If the lock cannot be acquired, retries with exponential backoff (max 3 retries).
 *
 * Keyed by write path (session-scoped when sessionId is present) so different
 * sessions never share a debounce slot.
 */
export function writeTrackingState(
  directory: string,
  state: SubagentTrackingState,
  sessionId?: string,
): void {
  const writePath = resolveWritePath(directory, sessionId);
  const normalizedDir = join(directory); // normalize separators
  const existing = pendingWrites.get(writePath);
  if (existing) {
    clearTimeout(existing.timeout);
  }

  const timeout = setTimeout(() => {
    const pending = pendingWrites.get(writePath);
    if (!pending) return;

    pendingWrites.delete(writePath);

    // Guard against duplicate concurrent flushes for the same path
    if (flushInProgress.has(writePath)) {
      // Re-queue: put it back and let the next debounce cycle handle it
      pendingWrites.set(writePath, {
        state: pending.state,
        sessionId,
        directory: normalizedDir,
        timeout: setTimeout(() => {
          writeTrackingState(directory, pending.state, sessionId);
        }, WRITE_DEBOUNCE_MS),
      });
      return;
    }

    flushInProgress.add(writePath);

    try {
      // Try flush with bounded retries on lock failure
      let success = false;
      for (let attempt = 0; attempt < MAX_FLUSH_RETRIES; attempt++) {
        success = executeFlush(directory, pending.state, sessionId);
        if (success) break;
        // Exponential backoff before retry
        syncSleep(FLUSH_RETRY_BASE_MS * Math.pow(2, attempt));
      }

      if (!success) {
        console.error(
          `[SubagentTracker] Failed to flush after ${MAX_FLUSH_RETRIES} retries for ${directory}. Data retained in memory for next attempt.`,
        );
        // Put data back in pending so the next writeTrackingState call will retry
        pendingWrites.set(writePath, {
          state: pending.state,
          sessionId,
          directory: normalizedDir,
          timeout: setTimeout(() => {
            // No-op: data is just stored, will be picked up by next write or flushPendingWrites
          }, 0),
        });
      }
    } finally {
      flushInProgress.delete(writePath);
    }
  }, WRITE_DEBOUNCE_MS);

  pendingWrites.set(writePath, { state, sessionId, directory: normalizedDir, timeout });
}

/**
 * Flush any pending debounced writes immediately using the merge-aware path.
 * Call this in tests before cleanup to ensure state is persisted.
 */
export function flushPendingWrites(): void {
  for (const pending of pendingWrites.values()) {
    clearTimeout(pending.timeout);
    try {
      // Use the same merge-aware locked flush as the debounced path.
      // On lock failure, fall back to a direct write so tests with no
      // contention still persist state.
      if (!executeFlush(pending.directory, pending.state, pending.sessionId)) {
        writeTrackingStateImmediate(pending.directory, pending.state, pending.sessionId);
      }
    } catch (error) {
      console.error("[SubagentTracker] Error during flushPendingWrites:", error);
    }
  }
  pendingWrites.clear();
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Detect the current parent mode from state files
 */
function detectParentMode(directory: string): string {
  const stateDir = join(getOmcRoot(directory), "state");

  if (!existsSync(stateDir)) {
    return "none";
  }

  // Check in order of specificity
  const modeFiles = [
    { file: "autopilot-state.json", mode: "autopilot" },
    { file: "ultrawork-state.json", mode: "ultrawork" },
    { file: "ralph-state.json", mode: "ralph" },
    { file: "team-state.json", mode: "team" },
  ];

  for (const { file, mode } of modeFiles) {
    const filePath = join(stateDir, file);
    if (existsSync(filePath)) {
      {
        // JSON file check
        try {
          const content = readFileSync(filePath, "utf-8");
          const state = JSON.parse(content);
          if (
            state.active === true ||
            state.status === "running" ||
            state.status === "active"
          ) {
            return mode;
          }
        } catch {
          continue;
        }
      }
    }
  }

  return "none";
}

/**
 * Get list of stale agents (running for too long)
 */
export function getStaleAgents(state: SubagentTrackingState): SubagentInfo[] {
  const now = Date.now();

  return state.agents.filter((agent) => {
    if (agent.status !== "running") {
      return false;
    }

    const startTime = new Date(agent.started_at).getTime();
    const elapsed = now - startTime;

    return elapsed > STALE_THRESHOLD_MS;
  });
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}

function firstBoolean(...values: unknown[]): boolean | undefined {
  for (const value of values) {
    if (typeof value === "boolean") return value;
  }
  return undefined;
}

function lifecycleTimestamp(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 1_000_000_000_000 ? value * 1_000 : value;
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function lifecycleLabelMatches(
  expected: string | undefined,
  actual: string | undefined,
): boolean {
  if (!expected) return true;
  if (!actual) return false;
  return expected.trim().toLowerCase() === actual.trim().toLowerCase();
}

function resolveCopilotEventLogPath(
  transcriptPath: string,
): string | undefined {
  if (!transcriptPath) return undefined;
  const candidates = [
    join(transcriptPath, "events.jsonl"),
    join(dirname(transcriptPath), "events.jsonl"),
    transcriptPath,
  ];

  for (const candidate of new Set(candidates)) {
    try {
      if (existsSync(candidate) && statSync(candidate).isFile()) {
        return candidate;
      }
    } catch {
      // Evidence is optional; continue to the next canonical location.
    }
  }
  return undefined;
}

function readBoundedEventLogTail(filePath: string): string[] {
  let fd: number | undefined;
  try {
    const size = statSync(filePath).size;
    const byteLength = Math.min(size, COPILOT_EVENT_TAIL_BYTES);
    const offset = Math.max(0, size - byteLength);
    const buffer = Buffer.alloc(byteLength);
    fd = openSync(filePath, "r");
    const bytesRead = readSync(fd, buffer, 0, byteLength, offset);
    let content = buffer.subarray(0, bytesRead).toString("utf8");
    if (offset > 0) {
      const firstNewline = content.indexOf("\n");
      content = firstNewline === -1 ? "" : content.slice(firstNewline + 1);
    }
    return content
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .slice(-COPILOT_EVENT_TAIL_LINES);
  } catch {
    return [];
  } finally {
    if (fd !== undefined) {
      try { closeSync(fd); } catch { /* already closed */ }
    }
  }
}

function resolveCopilotLifecycleId(
  kind: "start" | "stop",
  transcriptPath: string,
  eventTimestamp: number | undefined,
  agentName: string | undefined,
  agentDisplayName: string | undefined,
): string | undefined {
  if (eventTimestamp === undefined) return undefined;
  const eventLogPath = resolveCopilotEventLogPath(transcriptPath);
  if (!eventLogPath) return undefined;
  const expectedType =
    kind === "start" ? "subagent.started" : "subagent.completed";
  const candidates: Array<{
    agentId: string;
    delta: number;
    lineIndex: number;
  }> = [];

  const lines = readBoundedEventLogTail(eventLogPath);
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(lines[lineIndex]) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (event.type !== expectedType) continue;

    const data = asRecord(event.data);
    const timestamp = lifecycleTimestamp(event.timestamp ?? data?.timestamp);
    if (timestamp === undefined) continue;
    const delta = Math.abs(timestamp - eventTimestamp);
    if (delta > COPILOT_EVENT_MATCH_WINDOW_MS) continue;

    const eventAgentName = firstString(
      event.agentName,
      data?.agentName,
    );
    const eventDisplayName = firstString(
      event.displayName,
      event.agentDisplayName,
      data?.displayName,
      data?.agentDisplayName,
    );
    if (!lifecycleLabelMatches(agentName, eventAgentName)) continue;
    if (!lifecycleLabelMatches(agentDisplayName, eventDisplayName)) continue;

    const agentId = firstString(event.agentId, data?.toolCallId);
    if (!agentId) continue;
    candidates.push({ agentId, delta, lineIndex });
  }

  return candidates
    .sort((left, right) =>
      left.delta - right.delta || right.lineIndex - left.lineIndex
    )[0]?.agentId;
}

function lifecycleDigest(
  kind: "start" | "stop",
  fields: readonly unknown[],
): string {
  return createHash("sha256")
    .update(JSON.stringify([kind, ...fields]))
    .digest("hex");
}

function digestDisplayId(digest: string): string {
  return `${digest.slice(0, 12)}-${digest.slice(12, 24)}`;
}

function allocateLifecycleIdentity(
  state: SubagentTrackingState,
  kind: "start" | "stop",
  sessionId: string,
  contentDigest: string,
): {
  sequence: number;
  identityDigest: string;
  eventId: string;
} {
  const sequence = (state.lifecycle_sequence ?? 0) + 1;
  state.lifecycle_sequence = sequence;
  const identityDigest = lifecycleDigest(kind, [
    sessionId,
    contentDigest,
    sequence,
  ]);

  return {
    sequence,
    identityDigest,
    eventId: `subagent-${kind}:${identityDigest}`,
  };
}

function resolveLifecycleIdentity(
  state: SubagentTrackingState,
  kind: "start" | "stop",
  sessionId: string,
  contentDigest: string,
  hostAgentId?: string,
): {
  sequence?: number;
  identityDigest: string;
  eventId: string;
} {
  if (!hostAgentId) {
    return allocateLifecycleIdentity(
      state,
      kind,
      sessionId,
      contentDigest,
    );
  }

  const identityDigest = lifecycleDigest(kind, [
    sessionId,
    "host",
    hostAgentId,
  ]);
  return {
    identityDigest,
    eventId: `subagent-${kind}:${identityDigest}`,
  };
}

function findDeliveryReceipt(
  state: SubagentTrackingState,
  action: "start" | "stop",
  receipt?: string,
): SubagentDeliveryReceipt | undefined {
  if (!receipt) return undefined;
  return state.delivery_receipts?.find(
    (entry) => entry.action === action && entry.receipt === receipt,
  );
}

function recordDeliveryReceipt(
  state: SubagentTrackingState,
  receipt: SubagentDeliveryReceipt | undefined,
): void {
  if (!receipt) return;
  state.delivery_receipts = [
    ...(state.delivery_receipts ?? []).filter(
      (entry) =>
        entry.action !== receipt.action || entry.receipt !== receipt.receipt,
    ),
    receipt,
  ].slice(-MAX_DELIVERY_RECEIPTS);
}

function updateReceiptAgentId(
  state: SubagentTrackingState,
  previousAgentId: string,
  nextAgentId: string,
): void {
  for (const receipt of state.delivery_receipts ?? []) {
    if (receipt.agent_id === previousAgentId) {
      receipt.agent_id = nextAgentId;
    }
  }
}

function timestampIso(timestamp?: number): string {
  if (timestamp !== undefined) {
    const date = new Date(timestamp);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return new Date().toISOString();
}

function normalizedAgentName(agent: SubagentInfo): string {
  return agent.agent_name ?? agent.agent_type;
}

function lifecycleOutput(
  agent: SubagentInfo,
  options: {
    duplicate?: boolean;
    reordered?: boolean;
  } = {},
): SubagentLifecycleOutput {
  return {
    agent_id: agent.agent_id,
    agent_name: agent.agent_name,
    correlation_strategy: agent.correlation_strategy
      ?? (agent.id_source === "synthetic" ? "synthetic-start-id" : "host-id"),
    correlation_status: agent.correlation_status
      ?? (agent.id_source === "host" ? "host-id" : "unavailable"),
    synthetic_correlation: agent.synthetic_correlation === true,
    ...(options.duplicate ? { duplicate: true } : {}),
    ...(options.reordered ? { reordered: true } : {}),
  };
}

function normalizeSubagentStartInput(
  input: SubagentStartProcessorInput,
): NormalizedSubagentStartInput | undefined {
  const raw = input as unknown as Record<string, unknown>;
  const eventPayload = asRecord(raw.eventPayload);
  const sessionId = firstString(raw.session_id, raw.sessionId);
  const cwd = firstString(raw.cwd, raw.directory);
  if (!sessionId || !cwd) return undefined;

  const explicitAgentId = firstString(raw.agent_id, raw.agentId);
  const agentName = firstString(
    raw.agent_type,
    raw.agentName,
    raw.agent_name,
  );
  const agentDisplayName = firstString(
    raw.agentDisplayName,
    raw.agent_display_name,
  );
  const agentDescription = firstString(
    raw.agentDescription,
    raw.agent_description,
  );
  if (!explicitAgentId && !agentName && !agentDisplayName) return undefined;

  const timestamp = firstNumber(raw.timestamp, eventPayload?.timestamp);
  const transcriptPath = firstString(
    raw.transcript_path,
    raw.transcriptPath,
  ) ?? "";
  const eventLogAgentId =
    !explicitAgentId && raw.host === "copilot"
      ? resolveCopilotLifecycleId(
          "start",
          transcriptPath,
          timestamp,
          agentName,
          agentDisplayName,
        )
      : undefined;
  const agentId = explicitAgentId ?? eventLogAgentId;
  const prompt = firstString(raw.prompt, eventPayload?.prompt);
  const model = firstString(raw.model, eventPayload?.model);
  const contentDigest = lifecycleDigest("start", [
    sessionId,
    raw.host,
    agentId,
    agentName,
    agentDisplayName,
    agentDescription,
    timestamp,
    transcriptPath,
    prompt,
    model,
    raw.originalIndex,
  ]);
  const deliveryReceipt = firstString(
    raw.deliveryReceipt,
    raw.delivery_receipt,
    raw.deliveryId,
    raw.idempotencyKey,
    eventPayload?.deliveryReceipt,
    eventPayload?.deliveryId,
    eventPayload?.idempotencyKey,
  );

  return {
    session_id: sessionId,
    transcript_path: transcriptPath,
    cwd,
    permission_mode: firstString(
      raw.permission_mode,
      raw.permissionMode,
      eventPayload?.permissionMode,
    ) ?? "default",
    hook_event_name: "SubagentStart",
    agent_id: agentId,
    agent_type: agentName ?? agentDisplayName ?? "unknown",
    prompt,
    model,
    id_source: agentId ? "host" : "synthetic",
    host_id_source: explicitAgentId
      ? "payload"
      : eventLogAgentId
        ? "event-log"
        : undefined,
    agent_name: agentName ?? agentDisplayName,
    agent_display_name: agentDisplayName,
    agent_description: agentDescription,
    event_timestamp: timestamp,
    content_digest: contentDigest,
    delivery_fingerprint: `subagent-start:${contentDigest}`,
    delivery_receipt: deliveryReceipt,
  };
}

function normalizeSubagentStopInput(
  input: SubagentStopProcessorInput,
): NormalizedSubagentStopInput | undefined {
  const raw = input as unknown as Record<string, unknown>;
  const eventPayload = asRecord(raw.eventPayload);
  const sessionId = firstString(raw.session_id, raw.sessionId);
  const cwd = firstString(raw.cwd, raw.directory);
  if (!sessionId || !cwd) return undefined;

  const explicitAgentId = firstString(raw.agent_id, raw.agentId);
  const agentName = firstString(
    raw.agent_type,
    raw.agentName,
    raw.agent_name,
  );
  const agentDisplayName = firstString(
    raw.agentDisplayName,
    raw.agent_display_name,
  );
  const agentDescription = firstString(
    raw.agentDescription,
    raw.agent_description,
  );
  const timestamp = firstNumber(raw.timestamp, eventPayload?.timestamp);
  const transcriptPath = firstString(
    raw.transcript_path,
    raw.transcriptPath,
  ) ?? "";
  const eventLogAgentId =
    !explicitAgentId && raw.host === "copilot"
      ? resolveCopilotLifecycleId(
          "stop",
          transcriptPath,
          timestamp,
          agentName,
          agentDisplayName,
        )
      : undefined;
  const agentId = explicitAgentId ?? eventLogAgentId;
  const output = firstString(
    raw.output,
    raw.lastAssistantMessage,
    eventPayload?.lastAssistantMessage,
    raw.toolOutput,
    eventPayload?.toolOutput,
  );
  const stopReason = firstString(
    raw.stop_reason,
    raw.stopReason,
  );
  const contentDigest = lifecycleDigest("stop", [
    sessionId,
    raw.host,
    agentId,
    agentName,
    agentDisplayName,
    agentDescription,
    timestamp,
    transcriptPath,
    stopReason,
    output,
    raw.originalIndex,
  ]);
  const deliveryReceipt = firstString(
    raw.deliveryReceipt,
    raw.delivery_receipt,
    raw.deliveryId,
    raw.idempotencyKey,
    eventPayload?.deliveryReceipt,
    eventPayload?.deliveryId,
    eventPayload?.idempotencyKey,
  );
  const success = firstBoolean(raw.success)
    ?? (firstString(raw.status, eventPayload?.status) === "failed"
      ? false
      : undefined);

  return {
    session_id: sessionId,
    transcript_path: transcriptPath,
    cwd,
    permission_mode: firstString(
      raw.permission_mode,
      raw.permissionMode,
      eventPayload?.permissionMode,
    ) ?? "default",
    hook_event_name: "SubagentStop",
    agent_id: agentId,
    agent_type: agentName ?? agentDisplayName,
    output,
    success,
    agent_name: agentName ?? agentDisplayName,
    agent_display_name: agentDisplayName,
    agent_description: agentDescription,
    event_timestamp: timestamp,
    host_id_source: explicitAgentId
      ? "payload"
      : eventLogAgentId
        ? "event-log"
        : undefined,
    content_digest: contentDigest,
    delivery_fingerprint: `subagent-stop:${contentDigest}`,
    delivery_receipt: deliveryReceipt,
  };
}

// ============================================================================
// Hook Processors
// ============================================================================

/**
 * Process SubagentStart event
 */
export function processSubagentStart(
  input: SubagentStartProcessorInput,
): HookOutput {
  const normalized = normalizeSubagentStartInput(input);
  if (!normalized) return { continue: true };

  const sessionId = resolveSessionId({
    context: "hook",
    hookPayload: normalized,
  });
  const writePath = resolveWritePath(normalized.cwd, sessionId);
  ensureParentDir(writePath);
  const lockPath = lockPathFor(writePath);

  try {
    const processed = withLifecycleLock(lockPath, () => {
      const state = readTrackingState(normalized.cwd, sessionId);
      const parentMode = detectParentMode(normalized.cwd);
      const startedAt = timestampIso(normalized.event_timestamp);
      const taskDescription = (
        normalized.prompt
        ?? normalized.agent_description
      )?.substring(0, 200);

      const duplicateOutput = (duplicateAgent: SubagentInfo): HookOutput => {
        const runningCount = state.agents.filter(
          (agent) => agent.status === "running",
        ).length;

        return {
          continue: true,
          hookSpecificOutput: {
            hookEventName: "SubagentStart",
            additionalContext:
              `Agent ${duplicateAgent.agent_type} start already recorded `
              + `(${duplicateAgent.agent_id}); ${runningCount} agent(s) running`,
            agent_count: runningCount,
            stale_agents: getStaleAgents(state).map(
              (agent) => agent.agent_id,
            ),
            agent_id: duplicateAgent.agent_id,
            agent_name: duplicateAgent.agent_name,
            correlation_strategy: duplicateAgent.correlation_strategy,
            correlation_status: duplicateAgent.correlation_status
              ?? (duplicateAgent.id_source === "host"
                ? "host-id"
                : "unavailable"),
            synthetic_correlation:
              duplicateAgent.synthetic_correlation === true,
            duplicate: true,
          },
          tracking: lifecycleOutput(duplicateAgent, { duplicate: true }),
        };
      };

      const priorReceipt = findDeliveryReceipt(
        state,
        "start",
        normalized.delivery_receipt,
      );
      if (priorReceipt) {
        const duplicateAgent = priorReceipt.agent_id
          ? state.agents.find(
              (agent) => agent.agent_id === priorReceipt.agent_id,
            )
          : undefined;
        return {
          output: duplicateAgent
            ? duplicateOutput(duplicateAgent)
            : {
                continue: true,
                hookSpecificOutput: {
                  hookEventName: "SubagentStart",
                  additionalContext:
                    `Subagent start delivery ${priorReceipt.receipt} already recorded`,
                  duplicate: true,
                },
              },
          record: undefined,
        };
      }

      let existingIndex = normalized.agent_id
        ? state.agents.findIndex(
            (agent) => agent.agent_id === normalized.agent_id,
          )
        : -1;

      if (existingIndex !== -1) {
        const existingAgent = state.agents[existingIndex];
        const pendingReordered =
          existingAgent.status !== "running"
          && existingAgent.telemetry_status === "unmatched_stop"
          && existingAgent.start_event_id === undefined;

        if (
          pendingReordered
          && !canReconcileReorderedStop(
            existingAgent,
            normalized.event_timestamp,
          )
        ) {
          const previousAgentId = existingAgent.agent_id;
          existingAgent.reported_agent_id ??= previousAgentId;
          existingAgent.agent_id = digestDisplayId(
            existingAgent.stop_identity_digest
              ?? existingAgent.identity_digest
              ?? lifecycleDigest("stop", [
                normalized.session_id,
                existingAgent.stop_delivery_fingerprint,
                existingAgent.completed_at,
              ]),
          );
          updateReceiptAgentId(
            state,
            previousAgentId,
            existingAgent.agent_id,
          );
          existingIndex = -1;
        } else if (!pendingReordered) {
          existingAgent.agent_name ??= normalized.agent_name;
          existingAgent.agent_display_name ??= normalized.agent_display_name;
          existingAgent.agent_description ??= normalized.agent_description;
          existingAgent.correlation_strategy ??=
            normalized.id_source === "synthetic"
              ? "synthetic-start-id"
              : "host-id";
          existingAgent.correlation_status ??=
            normalized.id_source === "host" ? "host-id" : "unavailable";
          existingAgent.host_id_source ??= normalized.host_id_source;
          existingAgent.synthetic_correlation ??=
            normalized.id_source === "synthetic";
          recordDeliveryReceipt(
            state,
            normalized.delivery_receipt
              ? {
                  action: "start",
                  receipt: normalized.delivery_receipt,
                  fingerprint: normalized.delivery_fingerprint,
                  agent_id: existingAgent.agent_id,
                  event_id: existingAgent.start_event_id,
                  recorded_at: startedAt,
                }
              : undefined,
          );
          writeTrackingStateImmediate(normalized.cwd, state, sessionId);
          return {
            output: duplicateOutput(existingAgent),
            record: undefined,
          };
        }
      }

      const identity = resolveLifecycleIdentity(
        state,
        "start",
        normalized.session_id,
        normalized.content_digest,
        normalized.agent_id,
      );
      const agentId = normalized.agent_id
        ?? digestDisplayId(identity.identityDigest);

      if (
        existingIndex === -1
        && normalized.agent_name
      ) {
        existingIndex = findPendingReorderedStopByName(
          state,
          normalized.agent_name,
          normalized.event_timestamp,
          normalized.agent_id,
        );
      }

      let trackedAgent: SubagentInfo;
      let reordered = false;
      let previousAgentId: string | undefined;

      if (existingIndex !== -1) {
        const existingAgent = state.agents[existingIndex];
        previousAgentId = existingAgent.agent_id;
        const hasHostIdentity =
          normalized.id_source === "host"
          || existingAgent.id_source === "host";
        existingAgent.agent_id =
          normalized.id_source === "host"
            ? agentId
            : previousAgentId;
        existingAgent.agent_type = normalized.agent_type;
        existingAgent.agent_name = normalized.agent_name;
        existingAgent.agent_display_name = normalized.agent_display_name;
        existingAgent.agent_description = normalized.agent_description;
        existingAgent.started_at = startedAt;
        existingAgent.start_sequence = state.total_spawned + 1;
        existingAgent.start_event_id = identity.eventId;
        existingAgent.identity_digest ??= identity.identityDigest;
        existingAgent.start_identity_digest = identity.identityDigest;
        existingAgent.delivery_fingerprint = normalized.delivery_fingerprint;
        existingAgent.delivery_receipt = normalized.delivery_receipt;
        existingAgent.start_event_timestamp = normalized.event_timestamp;
        existingAgent.id_source = hasHostIdentity ? "host" : "synthetic";
        existingAgent.host_id_source ??= normalized.host_id_source;
        existingAgent.correlation_status =
          hasHostIdentity ? "host-id" : "unavailable";
        existingAgent.parent_mode = parentMode;
        existingAgent.task_description = taskDescription;
        existingAgent.model = normalized.model;
        existingAgent.synthetic = undefined;
        existingAgent.telemetry_status = undefined;
        existingAgent.telemetry_note = REORDERED_LIFECYCLE_TELEMETRY_NOTE;
        existingAgent.reordered = true;
        existingAgent.synthetic_correlation =
          !hasHostIdentity;
        existingAgent.correlation_strategy =
          hasHostIdentity ? "reordered-host-id" : "reordered-agent-name";
        if (previousAgentId !== existingAgent.agent_id) {
          updateReceiptAgentId(
            state,
            previousAgentId,
            existingAgent.agent_id,
          );
        }
        if (existingAgent.completed_at) {
          existingAgent.duration_ms = Math.max(
            0,
            new Date(existingAgent.completed_at).getTime()
              - new Date(startedAt).getTime(),
          );
        }
        state.total_spawned++;
        trackedAgent = existingAgent;
        reordered = true;
      } else {
        const agentInfo: SubagentInfo = {
          agent_id: agentId,
          agent_type: normalized.agent_type,
          agent_name: normalized.agent_name,
          agent_display_name: normalized.agent_display_name,
          agent_description: normalized.agent_description,
          started_at: startedAt,
          start_sequence: state.total_spawned + 1,
          start_event_id: identity.eventId,
          identity_digest: identity.identityDigest,
          start_identity_digest: identity.identityDigest,
          delivery_fingerprint: normalized.delivery_fingerprint,
          delivery_receipt: normalized.delivery_receipt,
          start_event_timestamp: normalized.event_timestamp,
          id_source: normalized.id_source,
          host_id_source: normalized.host_id_source,
          correlation_status:
            normalized.id_source === "host" ? "host-id" : "unavailable",
          correlation_strategy:
            normalized.id_source === "synthetic"
              ? "synthetic-start-id"
              : "host-id",
          synthetic_correlation: normalized.id_source === "synthetic",
          parent_mode: parentMode,
          task_description: taskDescription,
          status: "running",
          model: normalized.model,
        };

        state.agents.push(agentInfo);
        state.total_spawned++;
        trackedAgent = agentInfo;
      }

      recordDeliveryReceipt(
        state,
        normalized.delivery_receipt
          ? {
              action: "start",
              receipt: normalized.delivery_receipt,
              fingerprint: normalized.delivery_fingerprint,
              agent_id: trackedAgent.agent_id,
              event_id: trackedAgent.start_event_id,
              recorded_at: startedAt,
            }
          : undefined,
      );

      // Lifecycle counters must be committed while the lock is held. Debounced
      // whole-state snapshots can merge disjoint agents but cannot add counters.
      writeTrackingStateImmediate(normalized.cwd, state, sessionId);

      const staleAgents = getStaleAgents(state);
      const runningCount = state.agents.filter(
        (agent) => agent.status === "running",
      ).length;

      return {
        output: {
          continue: true,
          hookSpecificOutput: {
            hookEventName: "SubagentStart",
            additionalContext:
              `Agent ${trackedAgent.agent_type} started `
              + `(${trackedAgent.agent_id}); ${runningCount} agent(s) running`,
            agent_count: runningCount,
            stale_agents: staleAgents.map((agent) => agent.agent_id),
            agent_id: trackedAgent.agent_id,
            agent_name: trackedAgent.agent_name,
            correlation_strategy: trackedAgent.correlation_strategy,
            correlation_status: trackedAgent.correlation_status
              ?? (trackedAgent.id_source === "host"
                ? "host-id"
                : "unavailable"),
            synthetic_correlation:
              trackedAgent.synthetic_correlation === true,
            ...(reordered ? { reordered: true } : {}),
          },
          tracking: lifecycleOutput(trackedAgent, { reordered }),
        },
        record: {
          trackedAgent,
          parentMode,
          reordered,
          startedAt,
          previousAgentId,
        },
      };
    });

    if (processed.record) {
      const {
        trackedAgent,
        parentMode,
        reordered,
        startedAt,
        previousAgentId,
      } = processed.record;
      try {
        recordAgentStart(
          normalized.cwd,
          normalized.session_id,
          trackedAgent.agent_id,
          trackedAgent.agent_type,
          normalized.prompt ?? normalized.agent_description,
          parentMode,
          normalized.model,
        );
      } catch { /* best-effort */ }

      if (reordered && trackedAgent.status !== "running") {
        try {
          recordAgentReconciliation(
            normalized.cwd,
            normalized.session_id,
            previousAgentId ?? trackedAgent.agent_id,
            trackedAgent.agent_id,
            trackedAgent.agent_type,
            trackedAgent.status === "completed",
            trackedAgent.duration_ms,
          );
        } catch { /* best-effort */ }
      }

      try {
        recordMissionAgentStart(normalized.cwd, {
          sessionId: normalized.session_id,
          agentId: trackedAgent.agent_id,
          agentType: trackedAgent.agent_type,
          parentMode,
          taskDescription:
            normalized.prompt ?? normalized.agent_description,
          at: trackedAgent.started_at,
        }, sessionId);
      } catch { /* best-effort */ }

      if (reordered && trackedAgent.status !== "running") {
        try {
          recordMissionAgentStop(normalized.cwd, {
            sessionId: normalized.session_id,
            agentId: trackedAgent.agent_id,
            success: trackedAgent.status === "completed",
            outputSummary: trackedAgent.output_summary,
            at: trackedAgent.completed_at ?? startedAt,
          }, sessionId);
        } catch { /* best-effort */ }
      }
    }

    return processed.output;
  } catch {
    return { continue: true }; // Fail gracefully if lock cannot be acquired
  }
}

/**
 * Find the oldest running agent with a matching normalized name. Sequence is
 * authoritative for new records; timestamp and array order preserve stable
 * behavior for legacy records.
 */
function findRunningAgentByNameFifo(
  state: SubagentTrackingState,
  agentName: string,
): number {
  return state.agents
    .map((agent, index) => ({ agent, index }))
    .filter(({ agent }) =>
      agent.status === "running"
      && normalizedAgentName(agent) === agentName
    )
    .sort((left, right) => {
      const leftSequence = left.agent.start_sequence ?? Number.MAX_SAFE_INTEGER;
      const rightSequence =
        right.agent.start_sequence ?? Number.MAX_SAFE_INTEGER;
      if (leftSequence !== rightSequence) {
        return leftSequence - rightSequence;
      }
      const timeDifference =
        new Date(left.agent.started_at).getTime()
        - new Date(right.agent.started_at).getTime();
      return timeDifference || left.index - right.index;
    })[0]?.index ?? -1;
}

function canReconcileReorderedStop(
  agent: SubagentInfo,
  startTimestamp?: number,
): boolean {
  if (
    startTimestamp === undefined
    || agent.stop_event_timestamp === undefined
  ) {
    return false;
  }

  const delta = agent.stop_event_timestamp - startTimestamp;
  return delta >= 0 && delta <= REORDER_WINDOW_MS;
}

function findPendingReorderedStopByName(
  state: SubagentTrackingState,
  agentName: string,
  startTimestamp?: number,
  startAgentId?: string,
): number {
  return state.agents
    .map((agent, index) => ({ agent, index }))
    .filter(({ agent }) =>
      agent.status !== "running"
      && agent.start_event_id === undefined
      && agent.telemetry_status === "unmatched_stop"
      && normalizedAgentName(agent) === agentName
      && (
        startAgentId === undefined
        || agent.id_source === "synthetic"
        || agent.agent_id === startAgentId
      )
      && canReconcileReorderedStop(agent, startTimestamp)
    )
    .sort((left, right) => {
      const timeDifference =
        new Date(left.agent.completed_at ?? left.agent.started_at).getTime()
        - new Date(right.agent.completed_at ?? right.agent.started_at).getTime();
      return timeDifference || left.index - right.index;
    })[0]?.index ?? -1;
}

/**
 * Mark running agents that have exceeded the stale threshold as failed. Used
 * during unmatched Stop reconciliation so native fork stop events carrying an
 * unknown agent_id cannot leave running entries lingering forever. Returns the
 * number of agents reaped.
 */
function reapStaleRunningAgents(
  state: SubagentTrackingState,
  nowIso: string,
): number {
  const now = new Date(nowIso).getTime();
  let reaped = 0;
  for (const agent of state.agents) {
    if (agent.status !== "running") continue;
    const startTime = new Date(agent.started_at).getTime();
    if (now - startTime > STALE_THRESHOLD_MS) {
      agent.status = "failed";
      agent.completed_at = nowIso;
      agent.duration_ms = now - startTime;
      agent.output_summary =
        "Marked as stale during unmatched stop reconciliation - exceeded timeout";
      state.total_failed++;
      reaped++;
    }
  }
  return reaped;
}

/**
 * Process SubagentStop event
 */
export function processSubagentStop(
  input: SubagentStopProcessorInput,
): HookOutput {
  const normalized = normalizeSubagentStopInput(input);
  if (!normalized) return { continue: true, suppressOutput: true };

  const sessionId = resolveSessionId({
    context: "hook",
    hookPayload: normalized,
  });
  const writePath = resolveWritePath(normalized.cwd, sessionId);
  ensureParentDir(writePath);
  const lockPath = lockPathFor(writePath);

  try {
    const processed = withLifecycleLock(lockPath, () => {
      const state = readTrackingState(normalized.cwd, sessionId);
      const succeeded = normalized.success !== false;
      const nowIso = timestampIso(normalized.event_timestamp);
      const priorReceipt = findDeliveryReceipt(
        state,
        "stop",
        normalized.delivery_receipt,
      );
      if (priorReceipt) {
        const duplicateAgent = priorReceipt.agent_id
          ? state.agents.find(
              (agent) => agent.agent_id === priorReceipt.agent_id,
            )
          : undefined;
        return {
          output: {
            continue: true,
            suppressOutput: true,
            ...(duplicateAgent
              ? {
                  tracking: lifecycleOutput(
                    duplicateAgent,
                    { duplicate: true },
                  ),
                }
              : {}),
          },
          record: undefined,
        };
      }

      const historicalExactDuplicate = normalized.agent_id
        ? state.agents.find(
            (agent) =>
              agent.status !== "running"
              && agent.reported_agent_id === normalized.agent_id
              && agent.stop_delivery_fingerprint
                === normalized.delivery_fingerprint,
          )
        : undefined;
      if (historicalExactDuplicate) {
        return {
          output: {
            continue: true,
            suppressOutput: true,
            tracking: lifecycleOutput(
              historicalExactDuplicate,
              { duplicate: true },
            ),
          },
          record: undefined,
        };
      }

      let agentIndex = normalized.agent_id
        ? state.agents.findIndex(
            (agent) => agent.agent_id === normalized.agent_id,
          )
        : -1;
      let correlationStrategy: SubagentCorrelationStrategy = "host-id";

      if (
        agentIndex === -1
        && !normalized.agent_id
        && normalized.agent_name
      ) {
        agentIndex = findRunningAgentByNameFifo(
          state,
          normalized.agent_name,
        );
        correlationStrategy = "agent-name-fifo";
      }

      if (agentIndex !== -1) {
        const agent = state.agents[agentIndex];
        if (agent.status !== "running") {
          recordDeliveryReceipt(
            state,
            normalized.delivery_receipt
              ? {
                  action: "stop",
                  receipt: normalized.delivery_receipt,
                  fingerprint: normalized.delivery_fingerprint,
                  agent_id: agent.agent_id,
                  event_id: agent.stop_event_id,
                  recorded_at: nowIso,
                }
              : undefined,
          );
          writeTrackingStateImmediate(normalized.cwd, state, sessionId);
          return {
            output: {
              continue: true,
              suppressOutput: true,
              tracking: lifecycleOutput(agent, { duplicate: true }),
            },
            record: undefined,
          };
        }

        const stopIdentity = resolveLifecycleIdentity(
          state,
          "stop",
          normalized.session_id,
          normalized.content_digest,
          normalized.agent_id,
        );
        agent.status = succeeded ? "completed" : "failed";
        agent.completed_at = nowIso;
        agent.stop_event_id = stopIdentity.eventId;
        agent.stop_identity_digest = stopIdentity.identityDigest;
        agent.stop_delivery_fingerprint = normalized.delivery_fingerprint;
        agent.stop_delivery_receipt = normalized.delivery_receipt;
        agent.stop_event_timestamp = normalized.event_timestamp;
        agent.agent_name ??= normalized.agent_name;
        agent.agent_display_name ??= normalized.agent_display_name;
        agent.agent_description ??= normalized.agent_description;
        agent.correlation_strategy = correlationStrategy;
        agent.correlation_status =
          correlationStrategy === "host-id" ? "host-id" : "unavailable";
        agent.host_id_source ??= normalized.host_id_source;
        agent.synthetic_correlation =
          correlationStrategy === "agent-name-fifo";

        const startTime = new Date(agent.started_at).getTime();
        agent.duration_ms = Math.max(
          0,
          new Date(nowIso).getTime() - startTime,
        );

        if (normalized.output) {
          agent.output_summary = normalized.output.substring(0, 500);
        }

        if (succeeded) {
          state.total_completed++;
        } else {
          state.total_failed++;
        }
      } else if (normalized.agent_id || normalized.agent_name) {
        const stopIdentity = resolveLifecycleIdentity(
          state,
          "stop",
          normalized.session_id,
          normalized.content_digest,
          normalized.agent_id,
        );
        reapStaleRunningAgents(state, nowIso);

        const synthetic: SubagentInfo = {
          agent_id:
            normalized.agent_id
            ?? digestDisplayId(stopIdentity.identityDigest),
          agent_type:
            normalized.agent_type
            ?? normalized.agent_name
            ?? UNTRACKED_NATIVE_FORK_AGENT_TYPE,
          agent_name: normalized.agent_name,
          agent_display_name: normalized.agent_display_name,
          agent_description: normalized.agent_description,
          started_at: nowIso,
          stop_event_id: stopIdentity.eventId,
          identity_digest: stopIdentity.identityDigest,
          stop_identity_digest: stopIdentity.identityDigest,
          stop_delivery_fingerprint: normalized.delivery_fingerprint,
          stop_delivery_receipt: normalized.delivery_receipt,
          stop_event_timestamp: normalized.event_timestamp,
          id_source: normalized.agent_id ? "host" : "synthetic",
          host_id_source: normalized.host_id_source,
          correlation_status:
            normalized.agent_id ? "host-id" : "unavailable",
          correlation_strategy: "unmatched-stop",
          synthetic_correlation: normalized.agent_id === undefined,
          parent_mode: detectParentMode(normalized.cwd),
          status: succeeded ? "completed" : "failed",
          completed_at: nowIso,
          output_summary: normalized.output
            ? normalized.output.substring(0, 500)
            : undefined,
          synthetic: true,
          telemetry_status: "unmatched_stop",
          telemetry_note: UNMATCHED_STOP_TELEMETRY_NOTE,
        };
        state.agents.push(synthetic);
        agentIndex = state.agents.length - 1;

        if (succeeded) {
          state.total_completed++;
        } else {
          state.total_failed++;
        }
      }

      const stoppedAgent =
        agentIndex !== -1 ? state.agents[agentIndex] : undefined;

      recordDeliveryReceipt(
        state,
        stoppedAgent && normalized.delivery_receipt
          ? {
              action: "stop",
              receipt: normalized.delivery_receipt,
              fingerprint: normalized.delivery_fingerprint,
              agent_id: stoppedAgent.agent_id,
              event_id: stoppedAgent.stop_event_id,
              recorded_at: nowIso,
            }
          : undefined,
      );

      const completedAgents = state.agents.filter(
        (a) => a.status === "completed" || a.status === "failed",
      );
      if (completedAgents.length > MAX_COMPLETED_AGENTS) {
        completedAgents.sort((a, b) => {
          const timeA = a.completed_at ? new Date(a.completed_at).getTime() : 0;
          const timeB = b.completed_at ? new Date(b.completed_at).getTime() : 0;
          return timeB - timeA;
        });

        const toRemove = new Set(
          completedAgents.slice(MAX_COMPLETED_AGENTS).map((a) => a.agent_id),
        );
        state.agents = state.agents.filter((a) => !toRemove.has(a.agent_id));
      }

      writeTrackingStateImmediate(normalized.cwd, state, sessionId);

      return {
        output: {
          continue: true,
          suppressOutput: true,
          ...(stoppedAgent
            ? { tracking: lifecycleOutput(stoppedAgent) }
            : {}),
        },
        record: stoppedAgent
          ? {
              stoppedAgent,
              succeeded,
              nowIso,
            }
          : undefined,
      };
    });

    if (processed.record) {
      const { stoppedAgent, succeeded, nowIso } = processed.record;
      try {
        recordAgentStop(
          normalized.cwd,
          normalized.session_id,
          stoppedAgent.agent_id,
          stoppedAgent.agent_type,
          succeeded,
          stoppedAgent.duration_ms,
          stoppedAgent.synthetic
            ? {
                synthetic: true,
                telemetry_status: stoppedAgent.telemetry_status,
                reason: stoppedAgent.telemetry_note,
              }
            : undefined,
        );
      } catch { /* best-effort */ }

      if (!stoppedAgent.synthetic) {
        try {
          recordMissionAgentStop(normalized.cwd, {
            sessionId: normalized.session_id,
            agentId: stoppedAgent.agent_id,
            success: succeeded,
            outputSummary:
              stoppedAgent.output_summary ?? normalized.output,
            at: stoppedAgent.completed_at ?? nowIso,
          }, sessionId);
        } catch { /* best-effort */ }
      }
    }

    return processed.output;
  } catch {
    return { continue: true }; // Fail gracefully if lock cannot be acquired
  }
}

// ============================================================================
// Cleanup Functions
// ============================================================================

/**
 * Cleanup stale agents (mark as failed)
 */
export function cleanupStaleAgents(directory: string, sessionId?: string): number {
  const writePath = resolveWritePath(directory, sessionId);
  ensureParentDir(writePath);
  const lockPath = lockPathFor(writePath);

  try {
    return withFileLockSync(lockPath, () => {
      const state = readTrackingState(directory, sessionId);
      const staleAgents = getStaleAgents(state);

      if (staleAgents.length === 0) {
        return 0;
      }

      for (const stale of staleAgents) {
        const agentIndex = state.agents.findIndex(
          (a) => a.agent_id === stale.agent_id,
        );
        if (agentIndex !== -1) {
          state.agents[agentIndex].status = "failed";
          state.agents[agentIndex].completed_at = new Date().toISOString();
          state.agents[agentIndex].output_summary =
            "Marked as stale - exceeded timeout";
          state.total_failed++;
        }
      }

      writeTrackingState(directory, state, sessionId);

      return staleAgents.length;
    }, LOCK_OPTS);
  } catch {
    return 0; // Could not acquire lock
  }
}

// ============================================================================
// Query Functions
// ============================================================================

/**
 * Get count of active (running) agents
 */
export interface ActiveAgentSnapshot {
  count: number;
  lastUpdatedAt?: string;
}

export function getActiveAgentSnapshot(directory: string, sessionId?: string): ActiveAgentSnapshot {
  const state = readTrackingState(directory, sessionId);
  return {
    count: state.agents.filter((a) => a.status === "running").length,
    lastUpdatedAt: state.last_updated,
  };
}

export function getActiveAgentCount(directory: string, sessionId?: string): number {
  return getActiveAgentSnapshot(directory, sessionId).count;
}

/**
 * Get agents by type
 */
export function getAgentsByType(
  directory: string,
  agentType: string,
  sessionId?: string,
): SubagentInfo[] {
  const state = readTrackingState(directory, sessionId);
  return state.agents.filter((a) => a.agent_type === agentType);
}

/**
 * Get all running agents
 */
export function getRunningAgents(directory: string, sessionId?: string): SubagentInfo[] {
  const state = readTrackingState(directory, sessionId);
  return state.agents.filter((a) => a.status === "running");
}

/**
 * Get tracking stats
 */
export function getTrackingStats(directory: string, sessionId?: string): {
  running: number;
  completed: number;
  failed: number;
  total: number;
} {
  const state = readTrackingState(directory, sessionId);
  return {
    running: state.agents.filter((a) => a.status === "running").length,
    completed: state.total_completed,
    failed: state.total_failed,
    total: state.total_spawned,
  };
}

/**
 * Record a tool usage event for a specific agent
 * Called from PreToolUse/PostToolUse hooks to track which agent uses which tool
 */
export function recordToolUsage(
  directory: string,
  agentId: string,
  toolName: string,
  success?: boolean,
  sessionId?: string,
): void {
  const writePath = resolveWritePath(directory, sessionId);
  ensureParentDir(writePath);
  const lockPath = lockPathFor(writePath);

  try {
    withFileLockSync(lockPath, () => {
      const state = readTrackingState(directory, sessionId);
      const agent = state.agents.find(
        (a) => a.agent_id === agentId && a.status === "running",
      );

      if (agent) {
        if (!agent.tool_usage) agent.tool_usage = [];
        // Keep last 50 tool usages per agent to prevent unbounded growth
        if (agent.tool_usage.length >= 50) {
          agent.tool_usage = agent.tool_usage.slice(-49);
        }
        agent.tool_usage.push({
          tool_name: toolName,
          timestamp: new Date().toISOString(),
          success,
        });
        writeTrackingState(directory, state, sessionId);
      }
    }, LOCK_OPTS);
  } catch { /* best-effort */ }
}

/**
 * Record tool usage with timing data
 * Called from PostToolUse hook with duration information
 */
export function recordToolUsageWithTiming(
  directory: string,
  agentId: string,
  toolName: string,
  durationMs: number,
  success: boolean,
  sessionId?: string,
): void {
  const writePath = resolveWritePath(directory, sessionId);
  ensureParentDir(writePath);
  const lockPath = lockPathFor(writePath);

  try {
    withFileLockSync(lockPath, () => {
      const state = readTrackingState(directory, sessionId);
      const agent = state.agents.find(
        (a) => a.agent_id === agentId && a.status === "running",
      );

      if (agent) {
        if (!agent.tool_usage) agent.tool_usage = [];
        if (agent.tool_usage.length >= 50) {
          agent.tool_usage = agent.tool_usage.slice(-49);
        }
        agent.tool_usage.push({
          tool_name: toolName,
          timestamp: new Date().toISOString(),
          duration_ms: durationMs,
          success,
        });
        writeTrackingState(directory, state, sessionId);
      }
    }, LOCK_OPTS);
  } catch { /* best-effort */ }
}

/**
 * Generate a formatted dashboard of all running agents
 * Used for debugging parallel agent execution in ultrawork mode
 */
export function getAgentDashboard(directory: string, sessionId?: string): string {
  const state = readTrackingState(directory, sessionId);
  const running = state.agents.filter((a) => a.status === "running");

  if (running.length === 0) return "";

  const now = Date.now();
  const lines: string[] = [`Agent Dashboard (${running.length} active):`];

  for (const agent of running) {
    const elapsed = Math.round(
      (now - new Date(agent.started_at).getTime()) / 1000,
    );
    const shortType = agent.agent_type.replace("oh-my-claudecode:", "");
    const toolCount = agent.tool_usage?.length || 0;
    const lastTool =
      agent.tool_usage?.[agent.tool_usage.length - 1]?.tool_name || "-";
    const desc = agent.task_description
      ? ` "${agent.task_description.substring(0, 60)}"`
      : "";

    lines.push(
      `  [${agent.agent_id.substring(0, 7)}] ${shortType} (${elapsed}s) tools:${toolCount} last:${lastTool}${desc}`,
    );
  }

  const stale = getStaleAgents(state);
  if (stale.length > 0) {
    lines.push(`  ⚠ ${stale.length} stale agent(s) detected`);
  }

  return lines.join("\n");
}

/**
 * Generate a rich observatory view of all running agents
 * Includes: performance metrics, token usage, file ownership, bottlenecks
 * For HUD integration and debugging parallel agent execution
 */
export function getAgentObservatory(directory: string, sessionId?: string): {
  header: string;
  lines: string[];
  summary: {
    total_agents: number;
    total_cost_usd: number;
    efficiency: number;
    interventions: number;
  };
} {
  const state = readTrackingState(directory, sessionId);
  const running = state.agents.filter((a) => a.status === "running");
  const efficiency = calculateParallelEfficiency(directory, sessionId);
  const interventions = suggestInterventions(directory, sessionId);

  const now = Date.now();
  const lines: string[] = [];
  let totalCost = 0;

  for (const agent of running) {
    const elapsed = Math.round(
      (now - new Date(agent.started_at).getTime()) / 1000,
    );
    const shortType = agent.agent_type.replace("oh-my-claudecode:", "");
    const toolCount = agent.tool_usage?.length || 0;

    // Token and cost info
    const cost = agent.token_usage?.cost_usd || 0;
    totalCost += cost;
    const tokens = agent.token_usage
      ? `${Math.round((agent.token_usage.input_tokens + agent.token_usage.output_tokens) / 1000)}k`
      : "-";

    // Status indicator
    const stale = getStaleAgents(state).some(
      (s) => s.agent_id === agent.agent_id,
    );
    const hasIntervention = interventions.some(
      (i) => i.agent_id === agent.agent_id,
    );
    const status = stale ? "🔴" : hasIntervention ? "🟡" : "🟢";

    // Bottleneck detection
    const perf = getAgentPerformance(directory, agent.agent_id, sessionId);
    const bottleneck = perf?.bottleneck || "";

    // File ownership
    const files = agent.file_ownership?.length || 0;

    // Build line
    let line = `${status} [${agent.agent_id.substring(0, 7)}] ${shortType} ${elapsed}s`;
    line += ` tools:${toolCount} tokens:${tokens}`;
    if (cost > 0) line += ` $${cost.toFixed(2)}`;
    if (files > 0) line += ` files:${files}`;
    if (bottleneck) line += `\n   └─ bottleneck: ${bottleneck}`;

    lines.push(line);
  }

  // Add intervention warnings at the end
  for (const intervention of interventions.slice(0, 3)) {
    const shortType = intervention.agent_type.replace("oh-my-claudecode:", "");
    lines.push(`⚠ ${shortType}: ${intervention.reason}`);
  }

  const header = `Agent Observatory (${running.length} active, ${efficiency.score}% efficiency)`;

  return {
    header,
    lines,
    summary: {
      total_agents: running.length,
      total_cost_usd: totalCost,
      efficiency: efficiency.score,
      interventions: interventions.length,
    },
  };
}

// ============================================================================
// Intervention Functions
// ============================================================================

/**
 * Suggest interventions for problematic agents
 * Checks for: stale agents, cost limit exceeded, file conflicts
 */
export function suggestInterventions(directory: string, sessionId?: string): AgentIntervention[] {
  const state = readTrackingState(directory, sessionId);
  const interventions: AgentIntervention[] = [];
  const running = state.agents.filter((a) => a.status === "running");

  // 1. Stale agent detection
  const stale = getStaleAgents(state);
  for (const agent of stale) {
    const elapsed = Math.round(
      (Date.now() - new Date(agent.started_at).getTime()) / 1000 / 60,
    );
    interventions.push({
      type: "timeout",
      agent_id: agent.agent_id,
      agent_type: agent.agent_type,
      reason: `Agent running for ${elapsed}m (threshold: 5m)`,
      suggested_action: "kill",
      auto_execute: elapsed > 10, // Auto-kill after 10 minutes
    });
  }

  // 2. Cost limit detection
  for (const agent of running) {
    if (agent.token_usage && agent.token_usage.cost_usd > COST_LIMIT_USD) {
      interventions.push({
        type: "excessive_cost",
        agent_id: agent.agent_id,
        agent_type: agent.agent_type,
        reason: `Cost $${agent.token_usage.cost_usd.toFixed(2)} exceeds limit $${COST_LIMIT_USD.toFixed(2)}`,
        suggested_action: "warn",
        auto_execute: false,
      });
    }
  }

  // 3. File conflict detection
  const fileToAgents = new Map<string, Array<{ id: string; type: string }>>();
  for (const agent of running) {
    for (const file of agent.file_ownership || []) {
      if (!fileToAgents.has(file)) {
        fileToAgents.set(file, []);
      }
      fileToAgents
        .get(file)!
        .push({ id: agent.agent_id, type: agent.agent_type });
    }
  }

  for (const [file, agents] of fileToAgents) {
    if (agents.length > 1) {
      // Warn all but first agent (first one "owns" the file)
      for (let i = 1; i < agents.length; i++) {
        interventions.push({
          type: "file_conflict",
          agent_id: agents[i].id,
          agent_type: agents[i].type,
          reason: `File conflict on ${file} with ${agents[0].type.replace("oh-my-claudecode:", "")}`,
          suggested_action: "warn",
          auto_execute: false,
        });
      }
    }
  }

  return interventions;
}

/**
 * Calculate parallel efficiency score (0-100)
 * 100 = all agents actively running, 0 = all stale/waiting
 */
export function calculateParallelEfficiency(directory: string, sessionId?: string): {
  score: number;
  active: number;
  stale: number;
  total: number;
} {
  const state = readTrackingState(directory, sessionId);
  const running = state.agents.filter((a) => a.status === "running");
  const stale = getStaleAgents(state);

  if (running.length === 0)
    return { score: 100, active: 0, stale: 0, total: 0 };

  const active = running.length - stale.length;
  const score = Math.round((active / running.length) * 100);

  return { score, active, stale: stale.length, total: running.length };
}

// ============================================================================
// File Ownership Functions
// ============================================================================

/**
 * Record file ownership when an agent modifies a file
 * Called from PreToolUse hook when Edit/Write tools are used
 */
export function recordFileOwnership(
  directory: string,
  agentId: string,
  filePath: string,
  sessionId?: string,
): void {
  const writePath = resolveWritePath(directory, sessionId);
  ensureParentDir(writePath);
  const lockPath = lockPathFor(writePath);

  try {
    withFileLockSync(lockPath, () => {
      const state = readTrackingState(directory, sessionId);
      const agent = state.agents.find(
        (a) => a.agent_id === agentId && a.status === "running",
      );

      if (agent) {
        if (!agent.file_ownership) agent.file_ownership = [];
        // Normalize and deduplicate
        const normalized = filePath.replace(directory, "").replace(/^\//, "").replace(/^\\/, "");
        if (!agent.file_ownership.includes(normalized)) {
          agent.file_ownership.push(normalized);
          // Cap at 100 files per agent
          if (agent.file_ownership.length > 100) {
            agent.file_ownership = agent.file_ownership.slice(-100);
          }
          writeTrackingState(directory, state, sessionId);
        }
      }
    }, LOCK_OPTS);
  } catch { /* best-effort */ }
}

/**
 * Check for file conflicts between running agents
 * Returns files being modified by more than one agent
 */
export function detectFileConflicts(directory: string, sessionId?: string): Array<{
  file: string;
  agents: string[];
}> {
  const state = readTrackingState(directory, sessionId);
  const running = state.agents.filter((a) => a.status === "running");

  const fileToAgents = new Map<string, string[]>();

  for (const agent of running) {
    for (const file of agent.file_ownership || []) {
      if (!fileToAgents.has(file)) {
        fileToAgents.set(file, []);
      }
      fileToAgents
        .get(file)!
        .push(agent.agent_type.replace("oh-my-claudecode:", ""));
    }
  }

  const conflicts: Array<{ file: string; agents: string[] }> = [];
  for (const [file, agents] of fileToAgents) {
    if (agents.length > 1) {
      conflicts.push({ file, agents });
    }
  }

  return conflicts;
}

/**
 * Get all file ownership for running agents
 */
export function getFileOwnershipMap(directory: string, sessionId?: string): Map<string, string> {
  const state = readTrackingState(directory, sessionId);
  const running = state.agents.filter((a) => a.status === "running");
  const map = new Map<string, string>();

  for (const agent of running) {
    const shortType = agent.agent_type.replace("oh-my-claudecode:", "");
    for (const file of agent.file_ownership || []) {
      map.set(file, shortType);
    }
  }

  return map;
}

// ============================================================================
// Performance Query Functions
// ============================================================================

/**
 * Get performance metrics for a specific agent
 */
export function getAgentPerformance(
  directory: string,
  agentId: string,
  sessionId?: string,
): AgentPerformance | null {
  const state = readTrackingState(directory, sessionId);
  const agent = state.agents.find((a) => a.agent_id === agentId);
  if (!agent) return null;

  const toolTimings: Record<string, ToolTimingStats> = {};

  for (const entry of agent.tool_usage || []) {
    if (!toolTimings[entry.tool_name]) {
      toolTimings[entry.tool_name] = {
        count: 0,
        avg_ms: 0,
        max_ms: 0,
        total_ms: 0,
        failures: 0,
      };
    }
    const stats = toolTimings[entry.tool_name];
    stats.count++;
    if (entry.duration_ms !== undefined) {
      stats.total_ms += entry.duration_ms;
      stats.max_ms = Math.max(stats.max_ms, entry.duration_ms);
      stats.avg_ms = Math.round(stats.total_ms / stats.count);
    }
    if (entry.success === false) stats.failures++;
  }

  // Find bottleneck (tool with highest avg_ms that has been called 2+ times)
  let bottleneck: string | undefined;
  let maxAvg = 0;
  for (const [tool, stats] of Object.entries(toolTimings)) {
    if (stats.count >= 2 && stats.avg_ms > maxAvg) {
      maxAvg = stats.avg_ms;
      bottleneck = `${tool} (${(stats.avg_ms / 1000).toFixed(1)}s avg)`;
    }
  }

  return {
    agent_id: agentId,
    tool_timings: toolTimings,
    token_usage: agent.token_usage || {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_tokens: 0,
      cost_usd: 0,
    },
    bottleneck,
  };
}

/**
 * Get performance for all running agents
 */
export function getAllAgentPerformance(directory: string, sessionId?: string): AgentPerformance[] {
  const state = readTrackingState(directory, sessionId);
  return state.agents
    .filter((a) => a.status === "running")
    .map((a) => getAgentPerformance(directory, a.agent_id, sessionId))
    .filter((p): p is AgentPerformance => p !== null);
}

/**
 * Update token usage for an agent (called from SubagentStop)
 */
export function updateTokenUsage(
  directory: string,
  agentId: string,
  tokens: Partial<TokenUsage>,
  sessionId?: string,
): void {
  const writePath = resolveWritePath(directory, sessionId);
  ensureParentDir(writePath);
  const lockPath = lockPathFor(writePath);

  try {
    withFileLockSync(lockPath, () => {
      const state = readTrackingState(directory, sessionId);
      const agent = state.agents.find((a) => a.agent_id === agentId);

      if (agent) {
        if (!agent.token_usage) {
          agent.token_usage = {
            input_tokens: 0,
            output_tokens: 0,
            cache_read_tokens: 0,
            cost_usd: 0,
          };
        }
        if (tokens.input_tokens !== undefined)
          agent.token_usage.input_tokens += tokens.input_tokens;
        if (tokens.output_tokens !== undefined)
          agent.token_usage.output_tokens += tokens.output_tokens;
        if (tokens.cache_read_tokens !== undefined)
          agent.token_usage.cache_read_tokens += tokens.cache_read_tokens;
        if (tokens.cost_usd !== undefined) agent.token_usage.cost_usd += tokens.cost_usd;
        writeTrackingState(directory, state, sessionId);
      }
    }, LOCK_OPTS);
  } catch { /* best-effort */ }
}

// ============================================================================
// Main Entry Points
// ============================================================================

/**
 * Handle SubagentStart hook
 */
export async function handleSubagentStart(
  input: SubagentStartInput,
): Promise<HookOutput> {
  return processSubagentStart(input);
}

/**
 * Handle SubagentStop hook
 */
export async function handleSubagentStop(
  input: SubagentStopInput,
): Promise<HookOutput> {
  return processSubagentStop(input);
}

/**
 * Clear all tracking state (for testing or cleanup)
 */
export function clearTrackingState(directory: string, sessionId?: string): void {
  const statePath = resolveWritePath(directory, sessionId);
  if (existsSync(statePath)) {
    try {
      unlinkSync(statePath);
    } catch (error) {
      console.error("[SubagentTracker] Error clearing state:", error);
    }
  }
}
