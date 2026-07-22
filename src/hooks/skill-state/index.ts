/**
 * Skill Active State Management (v2 mixed schema)
 *
 * `skill-active-state.json` is a root aggregate plus session-local ledger:
 *
 *   {
 *     "version": 2,
 *     "active_skills": {                    // workflow-slot ledger
 *       "<canonical workflow skill>": {
 *         "skill_name": ...,
 *         "started_at": ...,
 *         "completed_at": ...,              // soft tombstone
 *         "parent_skill": ...,              // lineage for nested runs
 *         "session_id": ...,
 *         "mode_state_path": ...,
 *         "initialized_mode": ...,
 *         "initialized_state_path": ...,
 *         "initialized_session_state_path": ...
 *       }
 *     },
 *     "support_skill": {                    // legacy-compatible branch
 *       "active": true, "skill_name": "plan", ...
 *     }
 *   }
 *
 * HARD INVARIANTS:
 *   1. Every ledger read-modify-write goes through
 *      `mutateSkillActiveStateLocked()`.
 *   2. Session files contain only their own workflow/support state.
 *   3. The root file retains per-session ledgers for repair and exposes a
 *      legacy aggregate projection without feeding it back into sessions.
 *   4. Seen intent IDs are bounded and copied with a verified generation.
 */

import {
  existsSync,
  readFileSync,
  realpathSync,
  readdirSync,
  unlinkSync,
} from 'fs';
import { dirname, join, normalize, resolve } from 'path';
import {
  resolveStatePath,
  resolveSessionStatePath,
  resolveToWorktreeRoot,
} from '../../lib/worktree-paths.js';
import { atomicWriteJsonSync } from '../../lib/atomic-write.js';
import { withStateFileMutationLock } from '../../lib/mode-state-io.js';
import { readTrackingState, getStaleAgents } from '../subagent-tracker/index.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const SKILL_ACTIVE_STATE_MODE = 'skill-active';
export const SKILL_ACTIVE_STATE_FILE = 'skill-active-state.json';
export const WORKFLOW_TOMBSTONE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
export const SKILL_SEEN_INTENT_LIMIT = 128;
const SESSION_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,255}$/;

/**
 * Canonical workflow skills — the only skills that get workflow slots.
 * Non-workflow skills keep today's `light/medium/heavy` protection via the
 * `support_skill` branch.
 */
export const CANONICAL_WORKFLOW_SKILLS = [
  'autopilot',
  'ralph',
  'team',
  'ultrawork',
  'ultraqa',
  'deep-interview',
  'ralplan',
  'self-improve',
] as const;
export type CanonicalWorkflowSkill = typeof CANONICAL_WORKFLOW_SKILLS[number];

export function isCanonicalWorkflowSkill(skillName: string): skillName is CanonicalWorkflowSkill {
  const normalized = skillName.toLowerCase().replace(/^oh-my-claudecode:/, '');
  return (CANONICAL_WORKFLOW_SKILLS as readonly string[]).includes(normalized);
}

// ---------------------------------------------------------------------------
// Support-skill protection (preserves v1 behavior)
// ---------------------------------------------------------------------------

export type SkillProtectionLevel = 'none' | 'light' | 'medium' | 'heavy';

export interface SkillStateConfig {
  /** Max stop-hook reinforcements before allowing stop */
  maxReinforcements: number;
  /** Time-to-live in ms before state is considered stale */
  staleTtlMs: number;
}

const PROTECTION_CONFIGS: Record<SkillProtectionLevel, SkillStateConfig> = {
  none: { maxReinforcements: 0, staleTtlMs: 0 },
  light: { maxReinforcements: 3, staleTtlMs: 5 * 60 * 1000 },      // 5 min
  medium: { maxReinforcements: 5, staleTtlMs: 15 * 60 * 1000 },    // 15 min
  heavy: { maxReinforcements: 10, staleTtlMs: 30 * 60 * 1000 },    // 30 min
};

/**
 * Maps each skill name to its support-skill protection level.
 *
 * Workflow skills (autopilot, ralph, ultrawork, team, ultraqa, ralplan,
 * deep-interview, self-improve) have dedicated mode state and workflow slots,
 * so their support-skill protection is 'none'. They flow through the
 * `active_skills` branch instead.
 */
const SKILL_PROTECTION: Record<string, SkillProtectionLevel> = {
  // === Canonical workflow skills — bypass support-skill protection; flow through the workflow-slot path ===
  autopilot: 'none',
  autoresearch: 'none',
  ralph: 'none',
  ultrawork: 'none',
  team: 'none',
  'omc-teams': 'none',
  ultraqa: 'none',
  ralplan: 'none',
  'self-improve': 'none',
  cancel: 'none',

  // === Instant / read-only → no protection needed ===
  trace: 'none',
  hud: 'none',
  'omc-doctor': 'none',
  'omc-help': 'none',
  'learn-about-omc': 'none',
  note: 'none',

  // === Light protection (simple shortcuts, 3 reinforcements) ===
  skill: 'light',
  ask: 'light',
  'configure-notifications': 'light',

  // === Medium protection (review/planning, 5 reinforcements) ===
  'omc-plan': 'medium',
  plan: 'medium',
  'deep-interview': 'heavy',
  review: 'medium',
  'external-context': 'medium',
  'ai-slop-cleaner': 'medium',
  sciomc: 'medium',
  skillify: 'medium',
  learner: 'medium',
  'omc-setup': 'medium',
  setup: 'medium',
  'mcp-setup': 'medium',
  'project-session-manager': 'medium',
  psm: 'medium',
  'writer-memory': 'medium',
  'ralph-init': 'medium',
  release: 'medium',
  ccg: 'medium',

  // === Heavy protection (long-running, 10 reinforcements) ===
  deepinit: 'heavy',
};

export function getSkillProtection(skillName: string, rawSkillName?: string): SkillProtectionLevel {
  if (rawSkillName != null && !rawSkillName.toLowerCase().startsWith('oh-my-claudecode:')) {
    return 'none';
  }
  const normalized = skillName.toLowerCase().replace(/^oh-my-claudecode:/, '');
  return SKILL_PROTECTION[normalized] ?? 'none';
}

export function getSkillConfig(skillName: string, rawSkillName?: string): SkillStateConfig {
  return PROTECTION_CONFIGS[getSkillProtection(skillName, rawSkillName)];
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Legacy-compatible support-skill state shape (unchanged from v1). */
export interface SkillActiveState {
  active: boolean;
  skill_name: string;
  session_id?: string;
  started_at: string;
  last_checked_at: string;
  reinforcement_count: number;
  max_reinforcements: number;
  stale_ttl_ms: number;
  last_intent_id?: string;
}

/** A single workflow-slot entry keyed by canonical workflow skill name. */
export interface ActiveSkillSlot {
  skill_name: string;
  started_at: string;
  /** Soft tombstone. `null`/undefined = live. ISO timestamp = tombstoned. */
  completed_at?: string | null;
  /** Last idempotent re-confirmation timestamp (post-tool). */
  last_confirmed_at?: string;
  /** Parent skill name for nested lineage (e.g. ralph under autopilot). */
  parent_skill?: string | null;
  session_id: string;
  /** Absolute or relative path to the mode-specific state file. */
  mode_state_path: string;
  /** Mode to initialize alongside this slot (usually equals skill_name). */
  initialized_mode: string;
  /** Pointer to the root `skill-active-state.json` copy at write time. */
  initialized_state_path: string;
  /** Pointer to the session `skill-active-state.json` copy at write time. */
  initialized_session_state_path: string;
  /** Origin of the slot (e.g. 'prompt-submit', 'post-tool'). */
  source?: string;
}

/** v2 mixed schema. */
export interface SkillActiveStateV2 {
  version: 2;
  generation?: number;
  seen_intents?: string[];
  active_skills: Record<string, ActiveSkillSlot>;
  support_skill?: SkillActiveState | null;
  global_ledger?: SkillSessionLedger;
  session_ledgers?: Record<string, SkillSessionLedger>;
  session_tombstones?: Record<string, number>;
}

export interface SkillSessionLedger {
  generation: number;
  seen_intents: string[];
  active_skills: Record<string, ActiveSkillSlot>;
  support_skill?: SkillActiveState | null;
}

export function isWorkflowSkillCompleted(slot: ActiveSkillSlot): boolean {
  return typeof slot.completed_at === 'string'
    && slot.completed_at.trim().length > 0;
}

export interface WriteSkillActiveStateCopiesOptions {
  /**
   * Override the root copy payload. Defaults to writing the same payload as
   * the session copy. Pass `null` to explicitly delete the root copy while
   * keeping the session copy.
   */
  rootState?: SkillActiveStateV2 | null;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

export function emptySkillActiveStateV2(): SkillActiveStateV2 {
  return { version: 2, active_skills: {} };
}

function isEmptyV2(state: SkillActiveStateV2): boolean {
  return Object.keys(state.active_skills).length === 0
    && !state.support_skill
    && (state.seen_intents?.length ?? 0) === 0
    && Object.keys(state.session_ledgers ?? {}).length === 0
    && Object.keys(state.session_tombstones ?? {}).length === 0
    && !state.global_ledger;
}

export class SkillStateCorruptionError extends Error {
  readonly path: string;

  constructor(path: string) {
    super(`Corrupt skill-active state: ${path}`);
    this.name = 'SkillStateCorruptionError';
    this.path = path;
  }
}

type SkillStateFileRead =
  | { status: 'missing' }
  | { status: 'valid'; raw: unknown }
  | { status: 'corrupt' };

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value);
}

function isValidActiveSkillsShape(value: unknown): boolean {
  return value === undefined
    || (
      isPlainRecord(value)
      && Object.values(value).every((slot) => isPlainRecord(slot))
    );
}

function isValidSupportSkillShape(value: unknown): boolean {
  return value === undefined || value === null || isPlainRecord(value);
}

function isValidSessionLedgerShape(value: unknown): boolean {
  if (!isPlainRecord(value)) return false;
  return isValidActiveSkillsShape(value.active_skills)
    && isValidSupportSkillShape(value.support_skill)
    && (
      value.generation === undefined
      || (
        typeof value.generation === 'number'
        && Number.isSafeInteger(value.generation)
        && value.generation >= 0
      )
    )
    && (
      value.seen_intents === undefined
      || Array.isArray(value.seen_intents)
    );
}

function isValidSkillStatePayload(value: unknown): boolean {
  if (!isPlainRecord(value)) return false;
  const { _meta: _meta, ...state } = value;
  void _meta;
  const looksV2 =
    state.version === 2
    || 'active_skills' in state
    || 'support_skill' in state
    || 'global_ledger' in state
    || 'session_ledgers' in state
    || 'session_tombstones' in state;
  if (looksV2) {
    if (state.version !== undefined && state.version !== 2) return false;
    if (
      state.generation !== undefined
      && (
        typeof state.generation !== 'number'
        || !Number.isSafeInteger(state.generation)
        || state.generation < 0
      )
    ) {
      return false;
    }
    if (!isValidActiveSkillsShape(state.active_skills)) return false;
    if (!isValidSupportSkillShape(state.support_skill)) return false;
    if (
      state.global_ledger !== undefined
      && !isValidSessionLedgerShape(state.global_ledger)
    ) {
      return false;
    }
    if (state.session_ledgers !== undefined) {
      if (!isPlainRecord(state.session_ledgers)) return false;
      if (
        !Object.entries(state.session_ledgers).every(
          ([sessionId, ledger]) =>
            SESSION_ID_PATTERN.test(sessionId)
            && isValidSessionLedgerShape(ledger),
        )
      ) {
        return false;
      }
    }
    if (state.session_tombstones !== undefined) {
      if (!isPlainRecord(state.session_tombstones)) return false;
      if (
        !Object.entries(state.session_tombstones).every(
          ([sessionId, generation]) =>
            SESSION_ID_PATTERN.test(sessionId)
            && typeof generation === 'number'
            && Number.isSafeInteger(generation)
            && generation >= 0,
        )
      ) {
        return false;
      }
    }
    return true;
  }
  return typeof state.active === 'boolean'
    && typeof state.skill_name === 'string';
}

function inspectSkillStateFile(path: string): SkillStateFileRead {
  if (!existsSync(path)) return { status: 'missing' };
  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as unknown;
    return isValidSkillStatePayload(raw)
      ? { status: 'valid', raw }
      : { status: 'corrupt' };
  } catch {
    return { status: 'corrupt' };
  }
}

function readRawFromPath(path: string): unknown {
  const inspected = inspectSkillStateFile(path);
  if (inspected.status === 'missing') return null;
  if (inspected.status === 'corrupt') {
    throw new SkillStateCorruptionError(path);
  }
  return inspected.raw;
}

function isLegacyScalarSkillState(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const state = raw as Record<string, unknown>;
  return state.version !== 2
    && typeof state.active === 'boolean'
    && typeof state.skill_name === 'string'
    && !('active_skills' in state)
    && !('support_skill' in state);
}

function normalizedGeneration(value: unknown): number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
    ? value
    : 0;
}

function nextSkillGeneration(generation: number): number | null {
  return generation < Number.MAX_SAFE_INTEGER
    ? generation + 1
    : null;
}

function normalizeSeenIntents(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(
    value.filter(
      (intent): intent is string =>
        typeof intent === 'string' && intent.length > 0,
    ),
  )].slice(-SKILL_SEEN_INTENT_LIMIT);
}

function normalizeActiveSkills(
  value: unknown,
): Record<string, ActiveSkillSlot> {
  const activeSkills: Record<string, ActiveSkillSlot> = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return activeSkills;
  }
  for (const [name, slot] of Object.entries(
    value as Record<string, unknown>,
  )) {
    if (slot && typeof slot === 'object' && !Array.isArray(slot)) {
      activeSkills[name] = { ...(slot as ActiveSkillSlot) };
    }
  }
  return activeSkills;
}

function normalizeSupportSkill(value: unknown): SkillActiveState | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as SkillActiveState) }
    : null;
}

function normalizeSessionLedger(value: unknown): SkillSessionLedger {
  const record =
    value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  const supportSkill = normalizeSupportSkill(record.support_skill);
  return {
    generation: normalizedGeneration(record.generation),
    seen_intents: normalizeSeenIntents([
      ...(Array.isArray(record.seen_intents) ? record.seen_intents : []),
      ...(supportSkill?.last_intent_id
        ? [supportSkill.last_intent_id]
        : []),
    ]),
    active_skills: normalizeActiveSkills(record.active_skills),
    support_skill: supportSkill,
  };
}

function stateFromLedger(ledger: SkillSessionLedger): SkillActiveStateV2 {
  return {
    version: 2,
    generation: ledger.generation,
    seen_intents: [...ledger.seen_intents],
    active_skills: { ...ledger.active_skills },
    support_skill: ledger.support_skill
      ? { ...ledger.support_skill }
      : null,
  };
}

function ledgerFromState(state: SkillActiveStateV2): SkillSessionLedger {
  return normalizeSessionLedger(state);
}

/**
 * Normalize any raw payload (v1 scalar, v2 mixed, or unknown) into v2. Legacy
 * scalar state is folded into `support_skill` so support-skill data is never
 * dropped during migration.
 */
function normalizeToV2(raw: unknown): SkillActiveStateV2 {
  if (!raw || typeof raw !== 'object') {
    return emptySkillActiveStateV2();
  }

  const obj = raw as Record<string, unknown>;
  // Strip `_meta` envelope if present (added by atomic writes).
  const { _meta: _meta, ...rest } = obj;
  void _meta;
  const state = rest as Record<string, unknown>;

  const looksV2 =
    state.version === 2
    || 'active_skills' in state
    || 'support_skill' in state
    || 'global_ledger' in state
    || 'session_ledgers' in state
    || 'session_tombstones' in state;
  if (looksV2) {
    const sessionLedgers: Record<string, SkillSessionLedger> = {};
    const sessionTombstones: Record<string, number> = {};
    if (
      state.session_ledgers
      && typeof state.session_ledgers === 'object'
      && !Array.isArray(state.session_ledgers)
    ) {
      for (const [sessionId, ledger] of Object.entries(
        state.session_ledgers as Record<string, unknown>,
      )) {
        if (SESSION_ID_PATTERN.test(sessionId)) {
          sessionLedgers[sessionId] = sanitizeLedgerForSession(
            normalizeSessionLedger(ledger),
            sessionId,
          );
        }
      }
    }
    if (
      state.session_tombstones
      && typeof state.session_tombstones === 'object'
      && !Array.isArray(state.session_tombstones)
    ) {
      for (const [sessionId, generation] of Object.entries(
        state.session_tombstones as Record<string, unknown>,
      )) {
        if (
          SESSION_ID_PATTERN.test(sessionId)
          && typeof generation === 'number'
          && Number.isSafeInteger(generation)
          && generation >= 0
        ) {
          sessionTombstones[sessionId] = generation;
        }
      }
    }
    return {
      version: 2,
      generation: normalizedGeneration(state.generation),
      seen_intents: normalizeSeenIntents(state.seen_intents),
      active_skills: normalizeActiveSkills(state.active_skills),
      support_skill: normalizeSupportSkill(state.support_skill),
      ...(state.global_ledger
        ? { global_ledger: normalizeSessionLedger(state.global_ledger) }
        : {}),
      ...(Object.keys(sessionLedgers).length > 0
        ? { session_ledgers: sessionLedgers }
        : {}),
      ...(Object.keys(sessionTombstones).length > 0
        ? { session_tombstones: sessionTombstones }
        : {}),
    };
  }

  // Legacy scalar shape → fold into support_skill.
  if (typeof state.active === 'boolean' && typeof state.skill_name === 'string') {
    return {
      version: 2,
      active_skills: {},
      support_skill: state as unknown as SkillActiveState,
    };
  }

  return emptySkillActiveStateV2();
}

// ---------------------------------------------------------------------------
// Pure workflow-slot helpers
// ---------------------------------------------------------------------------

/** Upsert (create or update) a workflow slot on a v2 state. Pure. */
export function upsertWorkflowSkillSlot(
  state: SkillActiveStateV2,
  skillName: string,
  slotData: Partial<ActiveSkillSlot> = {},
): SkillActiveStateV2 {
  const normalized = skillName.toLowerCase().replace(/^oh-my-claudecode:/, '');
  const existing = state.active_skills[normalized];
  const now = new Date().toISOString();

  const base: ActiveSkillSlot = {
    skill_name: normalized,
    started_at: existing?.started_at ?? now,
    completed_at: existing?.completed_at ?? null,
    parent_skill: existing?.parent_skill ?? null,
    session_id: existing?.session_id ?? '',
    mode_state_path: existing?.mode_state_path ?? '',
    initialized_mode: existing?.initialized_mode ?? normalized,
    initialized_state_path: existing?.initialized_state_path ?? '',
    initialized_session_state_path: existing?.initialized_session_state_path ?? '',
  };
  if (existing?.last_confirmed_at !== undefined) {
    base.last_confirmed_at = existing.last_confirmed_at;
  }
  if (existing?.source !== undefined) {
    base.source = existing.source;
  }

  const next: ActiveSkillSlot = {
    ...base,
    ...slotData,
    skill_name: normalized,
  };

  return {
    ...state,
    active_skills: { ...state.active_skills, [normalized]: next },
  };
}

/**
 * Soft tombstone: set `completed_at` on an existing slot. Slot is retained
 * until the TTL pruner removes it. Returns state unchanged when the slot is
 * absent (idempotent).
 */
export function markWorkflowSkillCompleted(
  state: SkillActiveStateV2,
  skillName: string,
  now: string = new Date().toISOString(),
): SkillActiveStateV2 {
  const normalized = skillName.toLowerCase().replace(/^oh-my-claudecode:/, '');
  const existing = state.active_skills[normalized];
  if (!existing) return state;
  const updated: ActiveSkillSlot = { ...existing, completed_at: now };
  return {
    ...state,
    active_skills: { ...state.active_skills, [normalized]: updated },
  };
}

/** Hard-clear: remove a slot entirely (for explicit cancel). Pure. */
export function clearWorkflowSkillSlot(
  state: SkillActiveStateV2,
  skillName: string,
): SkillActiveStateV2 {
  const normalized = skillName.toLowerCase().replace(/^oh-my-claudecode:/, '');
  if (!(normalized in state.active_skills)) return state;
  const next: Record<string, ActiveSkillSlot> = { ...state.active_skills };
  delete next[normalized];
  return { ...state, active_skills: next };
}

/**
 * TTL prune: remove tombstoned slots whose `completed_at + ttlMs < now`.
 * Called on UserPromptSubmit. Pure.
 */
export function pruneExpiredWorkflowSkillTombstones(
  state: SkillActiveStateV2,
  ttlMs: number = WORKFLOW_TOMBSTONE_TTL_MS,
  now: number = Date.now(),
): SkillActiveStateV2 {
  const next: Record<string, ActiveSkillSlot> = {};
  let changed = false;
  for (const [name, slot] of Object.entries(state.active_skills)) {
    if (!isWorkflowSkillCompleted(slot)) {
      next[name] = slot;
      continue;
    }
    const tombstonedAt = new Date(slot.completed_at!).getTime();
    if (!Number.isFinite(tombstonedAt)) {
      // Malformed timestamp — keep defensively rather than silently drop.
      next[name] = slot;
      continue;
    }
    if (now - tombstonedAt < ttlMs) {
      next[name] = slot;
    } else {
      changed = true;
    }
  }
  return changed ? { ...state, active_skills: next } : state;
}

/**
 * Resolve the authoritative workflow slot for stop-hook and downstream
 * consumers.
 *
 * Rule: among live (non-tombstoned) slots, prefer those whose parent lineage
 * is absent or itself tombstoned (roots of the live chain). Among those,
 * return the newest by `started_at`. In nested `autopilot → ralph` flows this
 * returns `autopilot` while ralph is still live beneath it, so stop-hook
 * enforcement keeps reinforcing the outer loop.
 */
export function resolveAuthoritativeWorkflowSkill(
  state: SkillActiveStateV2,
): ActiveSkillSlot | null {
  const live = Object.values(state.active_skills).filter(
    (slot) => !isWorkflowSkillCompleted(slot),
  );
  if (live.length === 0) return null;

  const isLiveAncestor = (name: string | null | undefined): boolean => {
    if (!name) return false;
    const parent = state.active_skills[name];
    return !!parent && !isWorkflowSkillCompleted(parent);
  };

  const roots = live.filter((s) => !isLiveAncestor(s.parent_skill ?? null));
  const pool = roots.length > 0 ? roots : live;

  pool.sort((a, b) => {
    const bt = new Date(b.started_at).getTime() || 0;
    const at = new Date(a.started_at).getTime() || 0;
    return bt - at;
  });
  return pool[0] ?? null;
}

/**
 * Pure query: is the workflow slot for `skillName` live (non-tombstoned)?
 * Returns false when no slot exists at all, so callers can distinguish
 * "no ledger entry" from "tombstoned" via `isWorkflowSkillTombstoned`.
 */
export function isWorkflowSkillLive(
  state: SkillActiveStateV2,
  skillName: string,
): boolean {
  const normalized = skillName.toLowerCase().replace(/^oh-my-claudecode:/, '');
  const slot = state.active_skills[normalized];
  return !!slot && !isWorkflowSkillCompleted(slot);
}

/**
 * Pure query: is the slot tombstoned (has `completed_at`) and not yet expired?
 * Used by stop enforcement to suppress noisy re-handoff on completed workflows
 * until TTL pruning removes the slot or a fresh invocation reactivates it.
 */
export function isWorkflowSkillTombstoned(
  state: SkillActiveStateV2,
  skillName: string,
  ttlMs: number = WORKFLOW_TOMBSTONE_TTL_MS,
  now: number = Date.now(),
): boolean {
  const normalized = skillName.toLowerCase().replace(/^oh-my-claudecode:/, '');
  const slot = state.active_skills[normalized];
  if (!slot || !isWorkflowSkillCompleted(slot)) return false;
  const tombstonedAt = new Date(slot.completed_at!).getTime();
  if (!Number.isFinite(tombstonedAt)) return true;
  return now - tombstonedAt < ttlMs;
}

// ---------------------------------------------------------------------------
// Read / Write I/O
// ---------------------------------------------------------------------------

function rawStateSessionOwner(raw: unknown): string | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  const meta =
    record._meta && typeof record._meta === 'object'
      ? record._meta as Record<string, unknown>
      : null;
  const owner = meta?.sessionId ?? record.session_id;
  return typeof owner === 'string' && owner.length > 0 ? owner : undefined;
}

function migrateLegacyRootLedger(
  root: SkillActiveStateV2,
  raw: unknown,
): SkillActiveStateV2 {
  if (
    root.global_ledger
    || Object.keys(root.session_ledgers ?? {}).length > 0
    || Object.keys(root.session_tombstones ?? {}).length > 0
  ) {
    return root;
  }
  const legacyLedger = ledgerFromState(root);
  if (
    Object.keys(legacyLedger.active_skills).length === 0
    && !legacyLedger.support_skill
    && legacyLedger.seen_intents.length === 0
  ) {
    return root;
  }
  const owner = rawStateSessionOwner(raw);
  if (owner && SESSION_ID_PATTERN.test(owner)) {
    return {
      ...root,
      session_ledgers: {
        [owner]: sanitizeLedgerForSession(legacyLedger, owner),
      },
    };
  }
  return {
    ...root,
    global_ledger: legacyLedger,
  };
}

function sanitizeSessionLedger(
  state: SkillActiveStateV2,
  sessionId: string,
): SkillActiveStateV2 {
  const activeSkills = Object.fromEntries(
    Object.entries(state.active_skills).flatMap(([name, slot]) => {
      if (slot.session_id && slot.session_id !== sessionId) return [];
      return [[name, {
        ...slot,
        session_id: sessionId,
      } satisfies ActiveSkillSlot]];
    }),
  );
  const support =
    state.support_skill
    && (
      !state.support_skill.session_id
      || state.support_skill.session_id === sessionId
    )
      ? {
          ...state.support_skill,
          session_id: sessionId,
        }
      : null;
  return {
    version: 2,
    generation: normalizedGeneration(state.generation),
    seen_intents: normalizeSeenIntents(state.seen_intents),
    active_skills: activeSkills,
    support_skill: support,
  };
}

function sanitizeLedgerForSession(
  ledger: SkillSessionLedger,
  sessionId: string,
): SkillSessionLedger {
  return ledgerFromState(
    sanitizeSessionLedger(stateFromLedger(ledger), sessionId),
  );
}

function comparableLedger(ledger: SkillSessionLedger): unknown {
  return {
    generation: ledger.generation,
    seen_intents: ledger.seen_intents,
    active_skills: Object.fromEntries(
      Object.entries(ledger.active_skills)
        .sort(([left], [right]) => left.localeCompare(right)),
    ),
    support_skill: ledger.support_skill ?? null,
  };
}

function ledgersEqual(
  left: SkillSessionLedger | undefined,
  right: SkillSessionLedger | undefined,
): boolean {
  if (!left || !right) return left === right;
  return JSON.stringify(comparableLedger(left))
    === JSON.stringify(comparableLedger(right));
}

function selectAuthoritativeLedger(
  rootLedger: SkillSessionLedger | undefined,
  sessionLedger: SkillSessionLedger | undefined,
  tombstoneGeneration?: number,
): SkillSessionLedger {
  const highestLiveGeneration = Math.max(
    rootLedger?.generation ?? 0,
    sessionLedger?.generation ?? 0,
  );
  if (
    tombstoneGeneration !== undefined
    && tombstoneGeneration >= highestLiveGeneration
  ) {
    return {
      generation: tombstoneGeneration,
      seen_intents: [],
      active_skills: {},
      support_skill: null,
    };
  }
  if (!rootLedger) return sessionLedger ?? normalizeSessionLedger(null);
  if (!sessionLedger) return rootLedger;
  if (rootLedger.generation > sessionLedger.generation) return rootLedger;
  return sessionLedger;
}

function slotProjectionTime(slot: ActiveSkillSlot): number {
  const timestamps = isWorkflowSkillCompleted(slot)
    ? [slot.completed_at]
    : [slot.started_at, slot.last_confirmed_at];
  return timestamps.reduce((latest, timestamp) => {
    const parsed = typeof timestamp === 'string'
      ? Date.parse(timestamp)
      : Number.NaN;
    return Number.isFinite(parsed) ? Math.max(latest, parsed) : latest;
  }, Number.NEGATIVE_INFINITY);
}

function preferProjectedSlot(
  current: ActiveSkillSlot | undefined,
  candidate: ActiveSkillSlot,
): ActiveSkillSlot {
  if (!current) return candidate;
  const currentTime = slotProjectionTime(current);
  const candidateTime = slotProjectionTime(candidate);
  if (candidateTime !== currentTime) {
    return candidateTime > currentTime ? candidate : current;
  }

  const currentCompleted = isWorkflowSkillCompleted(current);
  const candidateCompleted = isWorkflowSkillCompleted(candidate);
  if (currentCompleted !== candidateCompleted) {
    return candidateCompleted ? current : candidate;
  }

  return candidate.session_id.localeCompare(current.session_id) > 0
    ? candidate
    : current;
}

function aggregateRootProjection(
  root: SkillActiveStateV2,
): SkillActiveStateV2 {
  const ledgers = [
    ...(root.global_ledger
      ? [{ key: '', ledger: root.global_ledger }]
      : []),
    ...Object.entries(root.session_ledgers ?? {}).map(
      ([key, ledger]) => ({ key, ledger }),
    ),
  ].sort((left, right) => left.key.localeCompare(right.key));
  const activeSkills: Record<string, ActiveSkillSlot> = {};
  let supportSkill: SkillActiveState | null = null;
  for (const { ledger } of ledgers) {
    for (const [skillName, slot] of Object.entries(ledger.active_skills)) {
      activeSkills[skillName] = preferProjectedSlot(
        activeSkills[skillName],
        slot,
      );
    }
    if (ledger.support_skill) {
      supportSkill = ledger.support_skill;
    }
  }
  return {
    ...root,
    version: 2,
    generation: ledgers.reduce(
      (highest, { ledger }) => Math.max(highest, ledger.generation),
      Math.max(
        normalizedGeneration(root.generation),
        ...Object.values(root.session_tombstones ?? {}),
      ),
    ),
    seen_intents: root.global_ledger?.seen_intents ?? [],
    active_skills: activeSkills,
    support_skill: supportSkill,
  };
}

function appendSeenIntent(
  seenIntents: readonly string[],
  intentId: string | undefined,
): string[] {
  if (!intentId) return normalizeSeenIntents(seenIntents);
  return normalizeSeenIntents([
    ...seenIntents.filter((candidate) => candidate !== intentId),
    intentId,
  ]);
}

function writeSkillLedgerFile(
  path: string,
  state: SkillActiveStateV2 | null,
  sessionId?: string,
): boolean {
  if (!state || isEmptyV2(state)) {
    if (!existsSync(path)) return true;
    try {
      unlinkSync(path);
      return true;
    } catch {
      return false;
    }
  }
  try {
    atomicWriteJsonSync(path, {
      ...state,
      version: 2,
      _meta: {
        written_at: new Date().toISOString(),
        mode: SKILL_ACTIVE_STATE_MODE,
        generation: normalizedGeneration(state.generation),
        ...(sessionId ? { sessionId } : {}),
      },
    });
    return true;
  } catch {
    return false;
  }
}

interface SessionLedgerCommitObservation {
  rootState: SkillActiveStateV2;
  rootLedger: SkillSessionLedger | undefined;
  sessionLedger: SkillSessionLedger | undefined;
  tombstoneGeneration: number | undefined;
}

function observeSessionLedgerCommit(
  rootPath: string,
  sessionPath: string,
  sessionId: string,
): SessionLedgerCommitObservation {
  const rootRaw = readRawFromPath(rootPath);
  const rootState = migrateLegacyRootLedger(
    normalizeToV2(rootRaw),
    rootRaw,
  );
  const sessionRaw = readRawFromPath(sessionPath);
  return {
    rootState,
    rootLedger: rootState.session_ledgers?.[sessionId],
    tombstoneGeneration: rootState.session_tombstones?.[sessionId],
    sessionLedger: sessionRaw === null
      ? undefined
      : ledgerFromState(sanitizeSessionLedger(
          normalizeToV2(sessionRaw),
          sessionId,
        )),
  };
}

function comparableRootState(state: SkillActiveStateV2): unknown {
  const sessionLedgers = Object.fromEntries(
    Object.entries(state.session_ledgers ?? {})
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([sessionId, ledger]) => [
        sessionId,
        comparableLedger(ledger),
      ]),
  );
  return {
    generation: normalizedGeneration(state.generation),
    seen_intents: normalizeSeenIntents(state.seen_intents),
    active_skills: Object.fromEntries(
      Object.entries(state.active_skills)
        .sort(([left], [right]) => left.localeCompare(right)),
    ),
    support_skill: state.support_skill ?? null,
    global_ledger: state.global_ledger
      ? comparableLedger(state.global_ledger)
      : null,
    session_ledgers: sessionLedgers,
    session_tombstones: Object.fromEntries(
      Object.entries(state.session_tombstones ?? {})
        .sort(([left], [right]) => left.localeCompare(right)),
    ),
  };
}

function normalizedRootState(raw: unknown): SkillActiveStateV2 {
  return aggregateRootProjection(
    migrateLegacyRootLedger(normalizeToV2(raw), raw),
  );
}

function rootStatesEqual(
  left: SkillActiveStateV2,
  right: SkillActiveStateV2,
): boolean {
  return JSON.stringify(comparableRootState(left))
    === JSON.stringify(comparableRootState(right));
}

export interface MutateSkillActiveStateLockedOptions {
  intentId?: string;
  rootState?: SkillActiveStateV2 | null;
}

export interface MutateSkillActiveStateLockedResult {
  status: 'written' | 'skipped' | 'repaired' | 'failed';
  state?: SkillActiveStateV2;
}

/**
 * The single owner for skill-ledger read-modify-write transactions.
 * Session-local state never borrows root aggregate fields. The root retains a
 * per-session repair copy with a matching generation and bounded intent set.
 */
export function mutateSkillActiveStateLocked(
  directory: string,
  sessionId: string | undefined,
  mutate: (current: SkillActiveStateV2) => SkillActiveStateV2,
  options: MutateSkillActiveStateLockedOptions = {},
): MutateSkillActiveStateLockedResult {
  if (sessionId && !SESSION_ID_PATTERN.test(sessionId)) {
    return { status: 'failed' };
  }
  const rootPath = resolveStatePath('skill-active', directory);
  try {
    const locked = withStateFileMutationLock(rootPath, () => {
      const rootRaw = readRawFromPath(rootPath);
      let root = migrateLegacyRootLedger(normalizeToV2(rootRaw), rootRaw);

      if (!sessionId) {
        const currentLedger =
          root.global_ledger ?? normalizeSessionLedger(null);
        const current = stateFromLedger(currentLedger);
        const duplicate =
          !!options.intentId
          && currentLedger.seen_intents.includes(options.intentId);
        if (duplicate && options.rootState === undefined) {
          return { status: 'skipped' as const, state: current };
        }
        const mutationResult = duplicate ? current : mutate(current);
        const explicitNoop = !duplicate && mutationResult === current;
        if (explicitNoop && options.rootState === undefined) {
          return { status: 'skipped' as const, state: current };
        }
        const mutated = duplicate || explicitNoop
          ? current
          : normalizeToV2(mutationResult);
        const contentChanged = !ledgersEqual(
          currentLedger,
          ledgerFromState({
            ...mutated,
            generation: currentLedger.generation,
            seen_intents: currentLedger.seen_intents,
          }),
        );
        if (
          !contentChanged
          && !options.intentId
          && options.rootState === undefined
        ) {
          return {
            status: 'skipped' as const,
            state: current,
          };
        }
        let nextLedger: SkillSessionLedger = currentLedger;
        if (!duplicate && !explicitNoop && contentChanged) {
          const generation = nextSkillGeneration(currentLedger.generation);
          if (generation === null) {
            return { status: 'failed' as const };
          }
          nextLedger = {
            ...ledgerFromState(mutated),
            generation,
            seen_intents: appendSeenIntent(
              currentLedger.seen_intents,
              options.intentId,
            ),
          };
        }
        const globalIsEmpty =
          Object.keys(nextLedger.active_skills).length === 0
          && !nextLedger.support_skill
          && nextLedger.seen_intents.length === 0;
        const mutatedRoot = aggregateRootProjection({
          ...root,
          global_ledger: globalIsEmpty ? undefined : nextLedger,
        });
        const desiredRoot =
          options.rootState === undefined
            ? mutatedRoot
            : options.rootState === null
              ? null
              : normalizedRootState(options.rootState);
        const writeSucceeded = writeSkillLedgerFile(
          rootPath,
          desiredRoot && !isEmptyV2(desiredRoot) ? desiredRoot : null,
        );
        const persistedRead = inspectSkillStateFile(rootPath);
        const committed = desiredRoot === null || isEmptyV2(desiredRoot)
          ? persistedRead.status === 'missing'
          : persistedRead.status === 'valid'
            && rootStatesEqual(
              normalizedRootState(persistedRead.raw),
              desiredRoot,
            );
        if (!committed) {
          return { status: 'failed' as const };
        }
        return {
          status:
            duplicate || explicitNoop || !writeSucceeded
              ? 'repaired' as const
              : 'written' as const,
          state: stateFromLedger(nextLedger),
        };
      }

      const sessionPath = resolveSessionStatePath(
        'skill-active',
        sessionId,
        directory,
      );
      const sessionExists = existsSync(sessionPath);
      const rootLedger = root.session_ledgers?.[sessionId];
      const sessionRaw = sessionExists
        ? readRawFromPath(sessionPath)
        : null;
      const sessionLedger = sessionRaw !== null
        ? ledgerFromState(sanitizeSessionLedger(
            normalizeToV2(sessionRaw),
            sessionId,
          ))
        : undefined;
      const authoritative = selectAuthoritativeLedger(
        rootLedger,
        sessionLedger,
        root.session_tombstones?.[sessionId],
      );
      const copiesMatch =
        ledgersEqual(rootLedger, authoritative)
        && ledgersEqual(sessionLedger, authoritative);
      const current = sanitizeSessionLedger(
        stateFromLedger(authoritative),
        sessionId,
      );
      const duplicate =
        !!options.intentId
        && authoritative.seen_intents.includes(options.intentId);
      const mutationResult = duplicate ? current : mutate(current);
      const explicitNoop = !duplicate && mutationResult === current;
      const mutated = duplicate || explicitNoop
        ? current
        : sanitizeSessionLedger(normalizeToV2(mutationResult), sessionId);
      const candidateLedger = ledgerFromState({
        ...mutated,
        generation: authoritative.generation,
        seen_intents: authoritative.seen_intents,
      });
      const contentChanged = !ledgersEqual(
        authoritative,
        candidateLedger,
      );
      if (
        !contentChanged
        && !options.intentId
        && options.rootState === undefined
        && (
          isLegacyScalarSkillState(rootRaw)
          || isLegacyScalarSkillState(sessionRaw)
        )
      ) {
        return { status: 'skipped' as const, state: current };
      }
      if (
        (duplicate || explicitNoop)
        && copiesMatch
        && options.rootState === undefined
      ) {
        return { status: 'skipped' as const, state: current };
      }
      if (
        !contentChanged
        && !options.intentId
        && copiesMatch
        && options.rootState === undefined
      ) {
        return { status: 'skipped' as const, state: current };
      }

      let nextLedger: SkillSessionLedger = authoritative;
      if (!duplicate && !explicitNoop) {
        const generation = nextSkillGeneration(Math.max(
          rootLedger?.generation ?? 0,
          sessionLedger?.generation ?? 0,
          root.session_tombstones?.[sessionId] ?? 0,
        ));
        if (generation === null) {
          return { status: 'failed' as const };
        }
        nextLedger = {
          ...ledgerFromState(mutated),
          generation,
          seen_intents: appendSeenIntent(
            authoritative.seen_intents,
            options.intentId,
          ),
        };
      }
      const sessionLedgers = {
        ...(root.session_ledgers ?? {}),
      };
      const sessionTombstones = {
        ...(root.session_tombstones ?? {}),
      };
      const localIsEmpty =
        Object.keys(nextLedger.active_skills).length === 0
        && !nextLedger.support_skill
        && nextLedger.seen_intents.length === 0;
      if (localIsEmpty) {
        delete sessionLedgers[sessionId];
        if (!duplicate && !explicitNoop) delete sessionTombstones[sessionId];
      } else {
        sessionLedgers[sessionId] = nextLedger;
        delete sessionTombstones[sessionId];
      }

      root = aggregateRootProjection({
        ...root,
        session_ledgers:
          Object.keys(sessionLedgers).length > 0
            ? sessionLedgers
            : undefined,
        session_tombstones:
          Object.keys(sessionTombstones).length > 0
            ? sessionTombstones
            : undefined,
      });
      const nextSessionState = localIsEmpty
        ? null
        : stateFromLedger(nextLedger);
      const desiredRoot =
        options.rootState === undefined
          ? root
          : options.rootState === null
            ? null
            : normalizedRootState(options.rootState);
      const expectedLedger = localIsEmpty ? undefined : nextLedger;
      let authoritativeCommitVisible = false;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const rootWriteSucceeded = writeSkillLedgerFile(
          rootPath,
          desiredRoot && !isEmptyV2(desiredRoot) ? desiredRoot : null,
        );
        const sessionWriteSucceeded = writeSkillLedgerFile(
          sessionPath,
          nextSessionState,
          sessionId,
        );
        const observation = observeSessionLedgerCommit(
          rootPath,
          sessionPath,
          sessionId,
        );
        const sessionMatches = ledgersEqual(
          observation.sessionLedger,
          expectedLedger,
        );
        const rootMatches =
          options.rootState === null
            ? !existsSync(rootPath)
            : options.rootState !== undefined && desiredRoot
              ? rootStatesEqual(observation.rootState, desiredRoot)
              : ledgersEqual(observation.rootLedger, expectedLedger);
        if (rootMatches && sessionMatches) {
          return {
            status:
              duplicate
              || explicitNoop
              || (!copiesMatch && !contentChanged)
              || !rootWriteSucceeded
              || !sessionWriteSucceeded
                ? 'repaired' as const
                : 'written' as const,
            state: nextSessionState ?? emptySkillActiveStateV2(),
          };
        }
        if (expectedLedger) {
          authoritativeCommitVisible ||= ledgersEqual(
            selectAuthoritativeLedger(
              observation.rootLedger,
              observation.sessionLedger,
              observation.tombstoneGeneration,
            ),
            expectedLedger,
          );
        } else if (options.rootState !== undefined) {
          authoritativeCommitVisible ||= sessionMatches || rootMatches;
        } else {
          const observed = selectAuthoritativeLedger(
            observation.rootLedger,
            observation.sessionLedger,
            observation.tombstoneGeneration,
          );
          authoritativeCommitVisible ||=
            Object.keys(observed.active_skills).length === 0
            && !observed.support_skill
            && observed.seen_intents.length === 0
            && (
              observation.tombstoneGeneration !== undefined
              || (
                observation.rootLedger === undefined
                && observation.sessionLedger === undefined
              )
            );
        }
      }
      return authoritativeCommitVisible
        ? {
            status: 'repaired' as const,
            state: nextSessionState ?? emptySkillActiveStateV2(),
          }
        : { status: 'failed' as const };
    });
    return locked.acquired && locked.value
      ? locked.value
      : { status: 'failed' };
  } catch {
    return { status: 'failed' };
  }
}

/**
 * Read the v2 mixed-schema workflow ledger, normalizing legacy scalar state
 * into `support_skill` without dropping support-skill data.
 *
 * When `sessionId` is provided, the session copy is authoritative for
 * session-local reads. No fall-through to the root copy, to prevent
 * cross-session leakage. When no session copy exists for the session, the
 * ledger is treated as empty for that session's local reads.
 *
 * When `sessionId` is omitted (legacy/global path), the root copy is read.
 *
 * Logs a reconciliation warning when the session copy diverges from the root
 * for slots belonging to the same session. The next mutation through
 * `writeSkillActiveStateCopies()` re-synchronizes both copies.
 */
export function readSkillActiveStateNormalized(
  directory: string,
  sessionId?: string,
): SkillActiveStateV2 {
  if (sessionId && !SESSION_ID_PATTERN.test(sessionId)) {
    return emptySkillActiveStateV2();
  }
  const rootPath = resolveStatePath('skill-active', directory);
  const rootRaw = readRawFromPath(rootPath);
  const root = migrateLegacyRootLedger(normalizeToV2(rootRaw), rootRaw);
  if (!sessionId) {
    return aggregateRootProjection(root);
  }
  const sessionPath = resolveSessionStatePath(
    'skill-active',
    sessionId,
    directory,
  );
  const sessionLedger = existsSync(sessionPath)
    ? ledgerFromState(sanitizeSessionLedger(
        normalizeToV2(readRawFromPath(sessionPath)),
        sessionId,
      ))
    : undefined;
  const rootLedger = root.session_ledgers?.[sessionId];
  return sanitizeSessionLedger(
    stateFromLedger(selectAuthoritativeLedger(
      rootLedger,
      sessionLedger,
      root.session_tombstones?.[sessionId],
    )),
    sessionId,
  );
}

/**
 * THE ONLY HELPER allowed to persist workflow-slot state.
 *
 * Writes BOTH root `.omc/state/skill-active-state.json` AND session
 * `.omc/state/sessions/{sessionId}/skill-active-state.json` together. When a
 * resolved state is empty (no slots, no support_skill), the corresponding
 * file is removed instead — the absence of a file is the canonical empty
 * state.
 *
 * @returns true when all writes / deletes succeeded, false otherwise.
 */
export function writeSkillActiveStateCopies(
  directory: string,
  nextState: SkillActiveStateV2,
  sessionId?: string,
  options?: WriteSkillActiveStateCopiesOptions,
): boolean {
  const result = mutateSkillActiveStateLocked(
    directory,
    sessionId,
    () => nextState,
    {
      ...(options?.rootState !== undefined
        ? { rootState: options.rootState }
        : {}),
    },
  );
  return result.status !== 'failed';
}

interface SkillStateLocation {
  rootPath: string;
  sessionPath?: string;
}

function normalizedPathKey(path: string): string {
  let canonicalPath = path;
  try {
    canonicalPath = realpathSync.native(path);
  } catch {
    try {
      canonicalPath = join(
        realpathSync.native(dirname(path)),
        path.slice(dirname(path).length + 1),
      );
    } catch {
      canonicalPath = path;
    }
  }
  const normalizedPath = normalize(resolve(canonicalPath));
  return process.platform === 'win32'
    ? normalizedPath.toLowerCase()
    : normalizedPath;
}

function skillStateLocations(
  directory: string,
  sessionId?: string,
): SkillStateLocation[] {
  const canonicalRoot = resolveStatePath('skill-active', directory);
  const worktreeRoot = resolveToWorktreeRoot(directory);
  const localRoot = join(
    worktreeRoot,
    '.omc',
    'state',
    SKILL_ACTIVE_STATE_FILE,
  );
  const locations = new Map<string, SkillStateLocation>();
  for (const rootPath of [canonicalRoot, localRoot]) {
    const key = normalizedPathKey(rootPath);
    locations.set(key, {
      rootPath,
      ...(sessionId
        ? {
            sessionPath: rootPath === canonicalRoot
              ? resolveSessionStatePath(
                  'skill-active',
                  sessionId,
                  directory,
                )
              : join(
                  dirname(rootPath),
                  'sessions',
                  sessionId,
                  SKILL_ACTIVE_STATE_FILE,
                ),
          }
        : {}),
    });
  }
  return [...locations.values()]
    .sort((left, right) => left.rootPath.localeCompare(right.rootPath));
}

function withSkillStateOwnerLocks<T>(
  rootPaths: readonly string[],
  callback: () => T,
): { acquired: boolean; value: T | undefined } {
  const unique = [...new Map(
    rootPaths.map((rootPath) => [normalizedPathKey(rootPath), rootPath]),
  ).values()].sort((left, right) => left.localeCompare(right));
  const acquireAt = (
    index: number,
  ): { acquired: boolean; value: T | undefined } => {
    if (index >= unique.length) {
      return { acquired: true, value: callback() };
    }
    const locked = withStateFileMutationLock(
      unique[index],
      () => acquireAt(index + 1),
    );
    return locked.acquired && locked.value?.acquired
      ? locked.value
      : { acquired: false, value: undefined };
  };
  return acquireAt(0);
}

function removeFileVerified(path: string): boolean {
  if (!existsSync(path)) return true;
  if (
    process.env.OMC_TEST_SKILL_CLEAR_UNLINK_FAILURE_PATH
    && normalizedPathKey(
      process.env.OMC_TEST_SKILL_CLEAR_UNLINK_FAILURE_PATH,
    ) === normalizedPathKey(path)
  ) {
    return false;
  }
  try {
    unlinkSync(path);
  } catch {
    return false;
  }
  return !existsSync(path);
}

type SessionDirectoryRead =
  | { status: 'missing'; sessionIds: [] }
  | { status: 'valid'; sessionIds: string[] }
  | { status: 'failed'; sessionIds: [] };

function sessionIdsAtRoot(rootPath: string): SessionDirectoryRead {
  const sessionsPath = join(dirname(rootPath), 'sessions');
  try {
    return {
      status: 'valid',
      sessionIds: readdirSync(sessionsPath, { withFileTypes: true })
        .filter(
          (entry) =>
            entry.isDirectory() && SESSION_ID_PATTERN.test(entry.name),
        )
        .map((entry) => entry.name),
    };
  } catch (error) {
    return (
      error
      && typeof error === 'object'
      && 'code' in error
      && (error as { code?: string }).code === 'ENOENT'
    )
      ? { status: 'missing', sessionIds: [] }
      : { status: 'failed', sessionIds: [] };
  }
}

/** Clear every root and session skill ledger under the shared owner lock. */
export function clearAllSkillActiveStateLocked(directory: string): boolean {
  try {
    const locations = skillStateLocations(directory);
    const locked = withSkillStateOwnerLocks(
      locations.map(({ rootPath }) => rootPath),
      () => {
        const preflight = locations.map(({ rootPath }) => ({
          rootPath,
          rootRead: inspectSkillStateFile(rootPath),
          sessions: sessionIdsAtRoot(rootPath),
        }));
        if (preflight.some(
          ({ rootRead, sessions }) =>
            rootRead.status === 'corrupt'
            || sessions.status === 'failed',
        )) {
          return false;
        }
        const sessionReads = preflight.flatMap(
          ({ rootPath, sessions }) => sessions.sessionIds.map((sessionId) => {
            const sessionPath = join(
              dirname(rootPath),
              'sessions',
              sessionId,
              SKILL_ACTIVE_STATE_FILE,
            );
            return {
              sessionPath,
              read: inspectSkillStateFile(sessionPath),
            };
          }),
        );
        if (sessionReads.some(({ read }) => read.status === 'corrupt')) {
          return false;
        }

        for (const { sessionPath } of sessionReads) {
          if (!removeFileVerified(sessionPath)) return false;
        }
        for (const { rootPath } of preflight) {
          if (!removeFileVerified(rootPath)) return false;
        }
        return preflight.every(({ rootPath }) => {
          if (existsSync(rootPath)) return false;
          const sessions = sessionIdsAtRoot(rootPath);
          return sessions.status !== 'failed'
            && sessions.sessionIds.every((sessionId) =>
              !existsSync(join(
                dirname(rootPath),
                'sessions',
                sessionId,
                SKILL_ACTIVE_STATE_FILE,
              )),
            );
        });
      }
    );
    return locked.acquired && locked.value === true;
  } catch {
    return false;
  }
}

/** Clear one session ledger and both repair copies under the root owner lock. */
export function clearSkillActiveSessionStateLocked(
  directory: string,
  sessionId: string,
): boolean {
  if (!SESSION_ID_PATTERN.test(sessionId)) return false;
  try {
    const locations = skillStateLocations(directory, sessionId);
    const locked = withSkillStateOwnerLocks(
      locations.map(({ rootPath }) => rootPath),
      () => {
        const preflight = locations.map(({ rootPath, sessionPath }) => ({
          rootPath,
          sessionPath: sessionPath!,
          rootRead: inspectSkillStateFile(rootPath),
          sessionRead: sessionPath
            ? inspectSkillStateFile(sessionPath)
            : { status: 'missing' as const },
        }));
        if (preflight.some(
          ({ rootRead, sessionRead }) =>
            rootRead.status === 'corrupt'
            || sessionRead.status === 'corrupt',
        )) {
          return false;
        }

        const observed = preflight.map((entry) => {
          const root = entry.rootRead.status === 'valid'
            ? migrateLegacyRootLedger(
                normalizeToV2(entry.rootRead.raw),
                entry.rootRead.raw,
              )
            : emptySkillActiveStateV2();
          const sessionLedger = entry.sessionRead.status === 'valid'
            ? ledgerFromState(sanitizeSessionLedger(
                normalizeToV2(entry.sessionRead.raw),
                sessionId,
              ))
            : undefined;
          return {
            ...entry,
            root,
            rootLedger: root.session_ledgers?.[sessionId],
            sessionLedger,
            tombstoneGeneration: root.session_tombstones?.[sessionId],
          };
        });
        const hasState = observed.some((entry) =>
          entry.rootLedger !== undefined
          || entry.sessionLedger !== undefined
          || entry.tombstoneGeneration !== undefined,
        );
        if (!hasState) return true;

        const clearGeneration = nextSkillGeneration(Math.max(
          ...observed.flatMap((entry) => [
            entry.rootLedger?.generation ?? 0,
            entry.sessionLedger?.generation ?? 0,
            entry.tombstoneGeneration ?? 0,
          ]),
        ));
        if (clearGeneration === null) return false;

        for (const entry of observed) {
          if (
            entry.rootLedger === undefined
            && entry.sessionLedger === undefined
            && entry.tombstoneGeneration === undefined
          ) {
            continue;
          }
          const sessionLedgers = { ...(entry.root.session_ledgers ?? {}) };
          const sessionTombstones = {
            ...(entry.root.session_tombstones ?? {}),
            [sessionId]: clearGeneration,
          };
          delete sessionLedgers[sessionId];
          const stagedRoot = aggregateRootProjection({
            ...entry.root,
            session_ledgers:
              Object.keys(sessionLedgers).length > 0
                ? sessionLedgers
                : undefined,
            session_tombstones: sessionTombstones,
          });
          if (!writeSkillLedgerFile(entry.rootPath, stagedRoot)) return false;
          const stagedRead = inspectSkillStateFile(entry.rootPath);
          if (
            stagedRead.status !== 'valid'
            || normalizedRootState(stagedRead.raw)
              .session_tombstones?.[sessionId] !== clearGeneration
          ) {
            return false;
          }
        }

        for (const entry of observed) {
          if (!removeFileVerified(entry.sessionPath)) {
            continue;
          }
          const rootRead = inspectSkillStateFile(entry.rootPath);
          if (rootRead.status !== 'valid') continue;
          const root = normalizedRootState(rootRead.raw);
          if (root.session_tombstones?.[sessionId] !== clearGeneration) {
            continue;
          }
          const sessionTombstones = { ...(root.session_tombstones ?? {}) };
          delete sessionTombstones[sessionId];
          const cleanedRoot = aggregateRootProjection({
            ...root,
            session_tombstones:
              Object.keys(sessionTombstones).length > 0
                ? sessionTombstones
                : undefined,
          });
          writeSkillLedgerFile(
            entry.rootPath,
            isEmptyV2(cleanedRoot) ? null : cleanedRoot,
          );
        }

        return observed.every((entry) => {
          const rootRead = inspectSkillStateFile(entry.rootPath);
          const sessionRead = inspectSkillStateFile(entry.sessionPath);
          if (
            rootRead.status === 'corrupt'
            || sessionRead.status === 'corrupt'
          ) {
            return false;
          }
          const root = rootRead.status === 'valid'
            ? normalizedRootState(rootRead.raw)
            : emptySkillActiveStateV2();
          const rootLedger = root.session_ledgers?.[sessionId];
          const sessionLedger = sessionRead.status === 'valid'
            ? ledgerFromState(sanitizeSessionLedger(
                normalizeToV2(sessionRead.raw),
                sessionId,
              ))
            : undefined;
          const tombstoneGeneration =
            root.session_tombstones?.[sessionId];
          if (!rootLedger && !sessionLedger) return true;
          const authoritative = selectAuthoritativeLedger(
            rootLedger,
            sessionLedger,
            tombstoneGeneration,
          );
          return tombstoneGeneration !== undefined
            && Object.keys(authoritative.active_skills).length === 0
            && !authoritative.support_skill
            && authoritative.seen_intents.length === 0;
        });
      },
    );
    return locked.acquired && locked.value === true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Legacy-compatible support-skill API (operates on the `support_skill` branch)
// ---------------------------------------------------------------------------

/**
 * Read the support-skill state as a legacy scalar `SkillActiveState`.
 *
 * Returns null when no support_skill entry is present in the v2 ledger.
 * Workflow slots are intentionally NOT exposed through this function —
 * downstream workflow consumers should call `readSkillActiveStateNormalized()`
 * and `resolveAuthoritativeWorkflowSkill()` instead.
 */
export function readSkillActiveState(
  directory: string,
  sessionId?: string,
): SkillActiveState | null {
  const v2 = readSkillActiveStateNormalized(directory, sessionId);
  const support = v2.support_skill;
  if (!support || typeof support.active !== 'boolean') return null;
  return support;
}

/**
 * Write support-skill state. No-op for skills with 'none' protection.
 *
 * Preserves the `active_skills` workflow ledger — every write reads the full
 * v2 state, updates only the `support_skill` branch, and re-writes both
 * copies together via `writeSkillActiveStateCopies()`.
 *
 * @param rawSkillName - Original skill name as invoked. When provided without
 *   the `oh-my-claudecode:` prefix, protection returns 'none' to avoid
 *   confusion with user-defined project skills of the same name (#1581).
 */
export function writeSkillActiveState(
  directory: string,
  skillName: string,
  sessionId?: string,
  rawSkillName?: string,
): SkillActiveState | null {
  const protection = getSkillProtection(skillName, rawSkillName);
  if (protection === 'none') return null;

  const config = PROTECTION_CONFIGS[protection];
  const now = new Date().toISOString();
  const normalized = skillName.toLowerCase().replace(/^oh-my-claudecode:/, '');
  let support: SkillActiveState | null = null;
  const result = mutateSkillActiveStateLocked(
    directory,
    sessionId,
    (current) => {
      const existing = current.support_skill;
      if (
        existing
        && existing.active
        && existing.skill_name !== normalized
      ) {
        return current;
      }
      support = {
        active: true,
        skill_name: normalized,
        session_id: sessionId,
        started_at: now,
        last_checked_at: now,
        reinforcement_count: 0,
        max_reinforcements: config.maxReinforcements,
        stale_ttl_ms: config.staleTtlMs,
      };
      return { ...current, support_skill: support };
    },
  );
  if (result.status === 'failed') return null;
  const committed = result.state?.support_skill;
  return committed?.active && committed.skill_name === normalized
    ? committed
    : null;
}

export interface UpsertSupportSkillLockedOptions {
  observedAt?: string;
  intentId?: string;
}

export interface UpsertSupportSkillLockedResult {
  status: 'written' | 'skipped' | 'repaired' | 'failed';
  state?: SkillActiveState;
}

/**
 * Locked semantic update for the support_skill branch. The full v2 ledger is
 * re-read under the root owner lock, workflow slots are preserved, and root
 * plus session copies are written together through the canonical copier.
 */
export function upsertSupportSkillActiveStateLocked(
  directory: string,
  skillName: string,
  sessionId?: string,
  rawSkillName?: string,
  options: UpsertSupportSkillLockedOptions = {},
): UpsertSupportSkillLockedResult {
  const protection = getSkillProtection(skillName, rawSkillName);
  if (protection === 'none') return { status: 'skipped' };

  const normalized = skillName
    .toLowerCase()
    .replace(/^oh-my-claudecode:/, '');
  const config = PROTECTION_CONFIGS[protection];
  const observedAt = options.observedAt ?? new Date().toISOString();
  const result = mutateSkillActiveStateLocked(
    directory,
    sessionId,
    (current) => {
      const existing = current.support_skill;
      if (
        existing?.active
        && existing.skill_name !== normalized
      ) {
        return current;
      }
      const support: SkillActiveState = {
        active: true,
        skill_name: normalized,
        session_id: sessionId,
        started_at: observedAt,
        last_checked_at: observedAt,
        reinforcement_count: 0,
        max_reinforcements: config.maxReinforcements,
        stale_ttl_ms: config.staleTtlMs,
        ...(options.intentId ? { last_intent_id: options.intentId } : {}),
      };
      return {
        ...current,
        support_skill: support,
      };
    },
    {
      ...(options.intentId ? { intentId: options.intentId } : {}),
    },
  );
  return {
    status: result.status,
    ...(result.state?.support_skill
      ? { state: result.state.support_skill }
      : {}),
  };
}

/**
 * Clear support-skill state while preserving workflow slots.
 */
export function clearSkillActiveState(directory: string, sessionId?: string): boolean {
  return mutateSkillActiveStateLocked(
    directory,
    sessionId,
    (current) =>
      current.support_skill
        ? { ...current, support_skill: null }
        : current,
  ).status !== 'failed';
}

export function isSkillStateStale(state: SkillActiveState): boolean {
  if (!state.active) return true;

  const lastChecked = state.last_checked_at
    ? new Date(state.last_checked_at).getTime()
    : 0;
  const startedAt = state.started_at
    ? new Date(state.started_at).getTime()
    : 0;
  const mostRecent = Math.max(lastChecked, startedAt);

  if (mostRecent === 0) return true;

  const age = Date.now() - mostRecent;
  return age > (state.stale_ttl_ms || 5 * 60 * 1000);
}

/**
 * Stop-hook integration for support skills.
 *
 * Reinforcement updates go through the skill-state owner so workflow and
 * support-skill writers cannot clobber each other.
 */
export function checkSkillActiveState(
  directory: string,
  sessionId?: string,
): { shouldBlock: boolean; message: string; skillName?: string } {
  const state = readSkillActiveState(directory, sessionId);

  if (!state || !state.active) {
    return { shouldBlock: false, message: '' };
  }

  // Session isolation
  if (sessionId && state.session_id && state.session_id !== sessionId) {
    return { shouldBlock: false, message: '' };
  }

  // Orchestrators are allowed to go idle while delegated work is still active.
  const trackingState = readTrackingState(directory);
  const staleIds = new Set(getStaleAgents(trackingState).map((a) => a.agent_id));
  const nonStaleRunning = trackingState.agents.filter(
    (a) => a.status === 'running' && !staleIds.has(a.agent_id),
  );
  if (nonStaleRunning.length > 0) {
    mutateSkillActiveStateLocked(directory, sessionId, (current) => {
      const support = current.support_skill;
      if (
        !support?.active
        || (sessionId
          && support.session_id
          && support.session_id !== sessionId)
      ) {
        return current;
      }
      if (
        isSkillStateStale(support)
        || support.reinforcement_count >= support.max_reinforcements
      ) {
        return { ...current, support_skill: null };
      }
      if (support.reinforcement_count === 0) return current;
      return {
        ...current,
        support_skill: {
          ...support,
          reinforcement_count: 0,
          last_checked_at: new Date().toISOString(),
        },
      };
    });
    return { shouldBlock: false, message: '', skillName: state.skill_name };
  }

  const result = mutateSkillActiveStateLocked(
    directory,
    sessionId,
    (current) => {
      const support = current.support_skill;
      if (
        !support?.active
        || (sessionId
          && support.session_id
          && support.session_id !== sessionId)
      ) {
        return current;
      }
      if (
        isSkillStateStale(support)
        || support.reinforcement_count >= support.max_reinforcements
      ) {
        return { ...current, support_skill: null };
      }
      const incremented: SkillActiveState = {
        ...support,
        reinforcement_count: support.reinforcement_count + 1,
        last_checked_at: new Date().toISOString(),
      };
      return { ...current, support_skill: incremented };
    },
  );
  const incremented = result.status === 'written'
    ? result.state?.support_skill
    : null;
  if (!incremented) {
    return { shouldBlock: false, message: '' };
  }

  const message =
    `[SKILL ACTIVE: ${incremented.skill_name}] The "${incremented.skill_name}" skill is still executing ` +
    `(reinforcement ${incremented.reinforcement_count}/${incremented.max_reinforcements}). ` +
    `Continue working on the skill's instructions. Do not stop until the skill completes its workflow.`;

  return {
    shouldBlock: true,
    message,
    skillName: incremented.skill_name,
  };
}
