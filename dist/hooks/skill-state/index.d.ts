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
export declare const SKILL_ACTIVE_STATE_MODE = "skill-active";
export declare const SKILL_ACTIVE_STATE_FILE = "skill-active-state.json";
export declare const WORKFLOW_TOMBSTONE_TTL_MS: number;
export declare const SKILL_SEEN_INTENT_LIMIT = 128;
/**
 * Canonical workflow skills — the only skills that get workflow slots.
 * Non-workflow skills keep today's `light/medium/heavy` protection via the
 * `support_skill` branch.
 */
export declare const CANONICAL_WORKFLOW_SKILLS: readonly ["autopilot", "ralph", "team", "ultrawork", "ultraqa", "deep-interview", "ralplan", "self-improve"];
export type CanonicalWorkflowSkill = typeof CANONICAL_WORKFLOW_SKILLS[number];
export declare function isCanonicalWorkflowSkill(skillName: string): skillName is CanonicalWorkflowSkill;
export type SkillProtectionLevel = 'none' | 'light' | 'medium' | 'heavy';
export interface SkillStateConfig {
    /** Max stop-hook reinforcements before allowing stop */
    maxReinforcements: number;
    /** Time-to-live in ms before state is considered stale */
    staleTtlMs: number;
}
export declare function getSkillProtection(skillName: string, rawSkillName?: string): SkillProtectionLevel;
export declare function getSkillConfig(skillName: string, rawSkillName?: string): SkillStateConfig;
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
export declare function isWorkflowSkillCompleted(slot: ActiveSkillSlot): boolean;
export interface WriteSkillActiveStateCopiesOptions {
    /**
     * Override the root copy payload. Defaults to writing the same payload as
     * the session copy. Pass `null` to explicitly delete the root copy while
     * keeping the session copy.
     */
    rootState?: SkillActiveStateV2 | null;
}
export declare function emptySkillActiveStateV2(): SkillActiveStateV2;
export declare class SkillStateCorruptionError extends Error {
    readonly path: string;
    constructor(path: string);
}
/** Upsert (create or update) a workflow slot on a v2 state. Pure. */
export declare function upsertWorkflowSkillSlot(state: SkillActiveStateV2, skillName: string, slotData?: Partial<ActiveSkillSlot>): SkillActiveStateV2;
/**
 * Soft tombstone: set `completed_at` on an existing slot. Slot is retained
 * until the TTL pruner removes it. Returns state unchanged when the slot is
 * absent (idempotent).
 */
export declare function markWorkflowSkillCompleted(state: SkillActiveStateV2, skillName: string, now?: string): SkillActiveStateV2;
/** Hard-clear: remove a slot entirely (for explicit cancel). Pure. */
export declare function clearWorkflowSkillSlot(state: SkillActiveStateV2, skillName: string): SkillActiveStateV2;
/**
 * TTL prune: remove tombstoned slots whose `completed_at + ttlMs < now`.
 * Called on UserPromptSubmit. Pure.
 */
export declare function pruneExpiredWorkflowSkillTombstones(state: SkillActiveStateV2, ttlMs?: number, now?: number): SkillActiveStateV2;
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
export declare function resolveAuthoritativeWorkflowSkill(state: SkillActiveStateV2): ActiveSkillSlot | null;
/**
 * Pure query: is the workflow slot for `skillName` live (non-tombstoned)?
 * Returns false when no slot exists at all, so callers can distinguish
 * "no ledger entry" from "tombstoned" via `isWorkflowSkillTombstoned`.
 */
export declare function isWorkflowSkillLive(state: SkillActiveStateV2, skillName: string): boolean;
/**
 * Pure query: is the slot tombstoned (has `completed_at`) and not yet expired?
 * Used by stop enforcement to suppress noisy re-handoff on completed workflows
 * until TTL pruning removes the slot or a fresh invocation reactivates it.
 */
export declare function isWorkflowSkillTombstoned(state: SkillActiveStateV2, skillName: string, ttlMs?: number, now?: number): boolean;
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
export declare function mutateSkillActiveStateLocked(directory: string, sessionId: string | undefined, mutate: (current: SkillActiveStateV2) => SkillActiveStateV2, options?: MutateSkillActiveStateLockedOptions): MutateSkillActiveStateLockedResult;
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
export declare function readSkillActiveStateNormalized(directory: string, sessionId?: string): SkillActiveStateV2;
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
export declare function writeSkillActiveStateCopies(directory: string, nextState: SkillActiveStateV2, sessionId?: string, options?: WriteSkillActiveStateCopiesOptions): boolean;
/** Clear every root and session skill ledger under the shared owner lock. */
export declare function clearAllSkillActiveStateLocked(directory: string): boolean;
/** Clear one session ledger and both repair copies under the root owner lock. */
export declare function clearSkillActiveSessionStateLocked(directory: string, sessionId: string): boolean;
/**
 * Read the support-skill state as a legacy scalar `SkillActiveState`.
 *
 * Returns null when no support_skill entry is present in the v2 ledger.
 * Workflow slots are intentionally NOT exposed through this function —
 * downstream workflow consumers should call `readSkillActiveStateNormalized()`
 * and `resolveAuthoritativeWorkflowSkill()` instead.
 */
export declare function readSkillActiveState(directory: string, sessionId?: string): SkillActiveState | null;
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
export declare function writeSkillActiveState(directory: string, skillName: string, sessionId?: string, rawSkillName?: string): SkillActiveState | null;
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
export declare function upsertSupportSkillActiveStateLocked(directory: string, skillName: string, sessionId?: string, rawSkillName?: string, options?: UpsertSupportSkillLockedOptions): UpsertSupportSkillLockedResult;
/**
 * Clear support-skill state while preserving workflow slots.
 */
export declare function clearSkillActiveState(directory: string, sessionId?: string): boolean;
export declare function isSkillStateStale(state: SkillActiveState): boolean;
/**
 * Stop-hook integration for support skills.
 *
 * Reinforcement updates go through the skill-state owner so workflow and
 * support-skill writers cannot clobber each other.
 */
export declare function checkSkillActiveState(directory: string, sessionId?: string): {
    shouldBlock: boolean;
    message: string;
    skillName?: string;
};
//# sourceMappingURL=index.d.ts.map