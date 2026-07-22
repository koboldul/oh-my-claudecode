import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import type {
  CanonicalGoalSnapshot,
  CanonicalHookEnvelope,
} from '../hook-protocol.js';
import { getOmcRoot } from '../../lib/worktree-paths.js';
import { parseJsonc } from '../../utils/jsonc.js';
import {
  PRE_TOOL_MAX_FUTURE_SKEW_MS,
  PRE_TOOL_MIN_EPOCH_MS,
  PRE_TOOL_SNAPSHOT_VERSION,
  type AdvisoryThrottleEntry,
  type ForceDelegationConfig,
  type ForceDelegationRule,
  type PreToolBatchSnapshot,
  type PreToolSnapshotDependencies,
  type PreToolStateSnapshot,
  type VirtualForceDelegationEvent,
} from './types.js';

const SESSION_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,255}$/;
const MAX_TRANSCRIPT_BYTES = 25 * 1024 * 1024;
const TRANSCRIPT_TAIL_BYTES = 4096;
const DEFAULT_CONTEXT_THRESHOLD = 72;
const DEFAULT_ADVISORY_COOLDOWN_MS = 5 * 60 * 1000;
const FORCE_DELEGATION_RETENTION_SECONDS = 60 * 60;
const COPILOT_DEFAULT_MODEL = 'gpt-5.6-sol';
const COPILOT_DEFAULT_REASONING_EFFORT = 'max';
const COPILOT_REASONING_EFFORTS = new Set([
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]);
const MODE_STATE_FILES = [
  'autopilot-state.json',
  'ultrapilot-state.json',
  'ralph-state.json',
  'ultragoal-state.json',
  'ultrawork-state.json',
  'ultraqa-state.json',
  'ralplan-state.json',
  'pipeline-state.json',
  'team-state.json',
  'omc-teams-state.json',
] as const;
const ULTRAGOAL_TERMINAL_PHASES = new Set([
  'complete',
  'completed',
  'done',
  'all-done',
  'all_done',
  'failed',
  'cancelled',
  'canceled',
  'aborted',
]);
const GOAL_COMMAND_MARKER = /<command-name>\s*\/goal\s*<\/command-name>/;
const GOAL_COMMAND_ARGS = /<command-args>([\s\S]*?)<\/command-args>/;
const GOAL_BEARING_HINT = /\/goal|Goal set|Goal cleared|local-command-stdout/;

const AGENT_CONFIG_KEY_MAP: Readonly<Record<string, string>> = {
  explore: 'explore',
  analyst: 'analyst',
  planner: 'planner',
  architect: 'architect',
  debugger: 'debugger',
  executor: 'executor',
  verifier: 'verifier',
  'security-reviewer': 'securityReviewer',
  'code-reviewer': 'codeReviewer',
  'test-engineer': 'testEngineer',
  designer: 'designer',
  writer: 'writer',
  'qa-tester': 'qaTester',
  scientist: 'scientist',
  tracer: 'tracer',
  'git-master': 'gitMaster',
  'code-simplifier': 'codeSimplifier',
  critic: 'critic',
  'document-specialist': 'documentSpecialist',
};

const DEPRECATED_ROLE_ALIASES: Readonly<Record<string, string>> = {
  researcher: 'document-specialist',
  'tdd-guide': 'test-engineer',
  'api-reviewer': 'code-reviewer',
  'performance-reviewer': 'code-reviewer',
  'dependency-expert': 'document-specialist',
  'quality-strategist': 'code-reviewer',
  vision: 'document-specialist',
  'quality-reviewer': 'code-reviewer',
  'deep-executor': 'executor',
  'build-fixer': 'debugger',
  'harsh-critic': 'critic',
  reviewer: 'code-reviewer',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function numberFromEnvironment(
  value: string | undefined,
  fallback: number,
  minimum = Number.NEGATIVE_INFINITY,
  maximum = Number.POSITIVE_INFINITY,
): number {
  if (value === undefined || value === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
}

function timestampFromEnvironment(
  value: string | undefined,
  fallback: number,
): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed)
    && parsed >= PRE_TOOL_MIN_EPOCH_MS
    && parsed <= fallback + PRE_TOOL_MAX_FUTURE_SKEW_MS
    ? parsed
    : fallback;
}

function resolveHome(
  environment: Readonly<Record<string, string | undefined>>,
): string {
  return stringValue(environment.USERPROFILE)
    || stringValue(environment.HOME)
    || homedir();
}

function resolveClaudeConfigDirectory(
  environment: Readonly<Record<string, string | undefined>>,
): string {
  const home = resolveHome(environment);
  const configured = stringValue(environment.CLAUDE_CONFIG_DIR);
  if (!configured) return join(home, '.claude');
  if (configured === '~') return home;
  if (configured.startsWith('~/') || configured.startsWith('~\\')) {
    return join(home, configured.slice(2));
  }
  return configured;
}

function resolveUserConfigDirectory(
  environment: Readonly<Record<string, string | undefined>>,
): string {
  const home = resolveHome(environment);
  if (process.platform === 'win32') {
    return stringValue(environment.APPDATA)
      || join(home, 'AppData', 'Roaming');
  }
  return stringValue(environment.XDG_CONFIG_HOME)
    || join(home, '.config');
}

function defaultReadText(path: string, maxBytes = Number.POSITIVE_INFINITY): string | null {
  let linkStat;
  try {
    linkStat = lstatSync(path);
  } catch {
    return null;
  }
  if (linkStat.isSymbolicLink() || !linkStat.isFile() || linkStat.size > maxBytes) {
    return null;
  }

  let fd = -1;
  try {
    fd = openSync(path, 'r');
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > maxBytes) return null;
    const buffer = Buffer.allocUnsafe(stat.size);
    let offset = 0;
    while (offset < stat.size) {
      const read = readSync(fd, buffer, offset, stat.size - offset, offset);
      if (read <= 0) break;
      offset += read;
    }
    return buffer.toString('utf8', 0, offset);
  } catch {
    return null;
  } finally {
    if (fd !== -1) {
      try {
        closeSync(fd);
      } catch {
        // Best-effort snapshot read cleanup.
      }
    }
  }
}

function defaultReadTextTail(path: string, maxBytes: number): string | null {
  let linkStat;
  try {
    linkStat = lstatSync(path);
  } catch {
    return null;
  }
  if (linkStat.isSymbolicLink() || !linkStat.isFile()) return null;

  let fd = -1;
  try {
    fd = openSync(path, 'r');
    const stat = fstatSync(fd);
    if (!stat.isFile()) return null;
    const length = Math.min(stat.size, Math.max(0, maxBytes));
    const start = Math.max(0, stat.size - length);
    const buffer = Buffer.allocUnsafe(length);
    let offset = 0;
    while (offset < length) {
      const read = readSync(
        fd,
        buffer,
        offset,
        length - offset,
        start + offset,
      );
      if (read <= 0) break;
      offset += read;
    }
    return buffer.toString('utf8', 0, offset);
  } catch {
    return null;
  } finally {
    if (fd !== -1) {
      try {
        closeSync(fd);
      } catch {
        // Best-effort snapshot read cleanup.
      }
    }
  }
}

function defaultReadJson(path: string): unknown {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch {
    return null;
  }
}

function defaultListDirectories(path: string): readonly string[] {
  try {
    return readdirSync(path, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (!value || typeof value !== 'object') return value;
  const objectValue = value as object;
  if (seen.has(objectValue)) return value;
  seen.add(objectValue);
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child, seen);
  }
  return Object.freeze(value);
}

function cloneObservation<T>(value: T): T {
  try {
    return structuredClone(value);
  } catch {
    if (Array.isArray(value)) {
      return value.map((item) => cloneObservation(item)) as T;
    }
    if (isRecord(value)) {
      return Object.fromEntries(
        Object.entries(value).map(([key, child]) => [
          key,
          cloneObservation(child),
        ]),
      ) as T;
    }
    return value;
  }
}

function getAgentType(input: unknown): string {
  if (!isRecord(input)) return '';
  return stringValue(input.subagent_type) || stringValue(input.agent_type);
}

function normalizeAgentType(rawAgentType: string): string {
  const unprefixed = rawAgentType.replace(/^oh-my-claudecode:/, '');
  return DEPRECATED_ROLE_ALIASES[unprefixed] ?? unprefixed;
}

function loadJsoncRecord(
  path: string,
  readText: (path: string, maxBytes?: number) => string | null,
): Record<string, unknown> | null {
  const content = readText(path);
  if (content === null) return null;
  try {
    return asRecord(parseJsonc(content));
  } catch {
    return null;
  }
}

function resolveConfiguredAgentModel(
  agentType: string,
  projectConfig: Record<string, unknown> | null,
  userConfig: Record<string, unknown> | null,
): string | null {
  const canonical = normalizeAgentType(agentType);
  const configKey = AGENT_CONFIG_KEY_MAP[canonical];
  if (!configKey) return null;

  for (const config of [projectConfig, userConfig]) {
    const agents = asRecord(config?.agents);
    const agent = asRecord(agents?.[configKey]);
    const model = stringValue(agent?.model);
    if (model) return model;
  }
  return null;
}

function resolveConfiguredCopilotDefault(
  key: 'copilotModel' | 'copilotReasoningEffort',
  projectConfig: Record<string, unknown> | null,
  userConfig: Record<string, unknown> | null,
): string {
  for (const config of [projectConfig, userConfig]) {
    const externalModels = asRecord(config?.externalModels);
    const defaults = asRecord(externalModels?.defaults);
    const value = stringValue(defaults?.[key]);
    if (value) return value;
  }
  return '';
}

function readAgentDefinitionModel(
  agentType: string,
  environment: Readonly<Record<string, string | undefined>>,
  currentDirectory: string,
  readText: (path: string, maxBytes?: number) => string | null,
): string | null {
  const canonical = normalizeAgentType(agentType);
  if (!/^[a-zA-Z0-9_-]+$/.test(canonical)) return null;

  const pluginRoot = stringValue(environment.CLAUDE_PLUGIN_ROOT);
  const candidateRoots = [
    ...(pluginRoot ? [pluginRoot] : []),
    currentDirectory,
  ];
  for (const root of candidateRoots) {
    const content = readText(join(root, 'agents', `${canonical}.md`));
    if (content === null) continue;
    const frontmatter = content.replace(/^\uFEFF/, '').match(
      /^---[\r\n]+([\s\S]*?)[\r\n]+---/,
    );
    if (!frontmatter) return null;
    const model = frontmatter[1].match(/^model:\s*(\S+)/m);
    return model
      ? model[1].trim().replace(/^["']|["']$/g, '')
      : null;
  }
  return null;
}

function extractTodoCounts(values: readonly unknown[]): {
  pending: number;
  inProgress: number;
} {
  let pending = 0;
  let inProgress = 0;
  for (const value of values) {
    const record = asRecord(value);
    const todos = Array.isArray(record?.todos)
      ? record.todos
      : Array.isArray(value)
        ? value
        : [];
    for (const todo of todos) {
      const status = isRecord(todo) ? todo.status : undefined;
      if (status === 'pending') pending += 1;
      if (status === 'in_progress') inProgress += 1;
    }
  }
  return { pending, inProgress };
}

function extractTracking(value: unknown): { running: number; total: number } {
  const record = asRecord(value);
  const agents = Array.isArray(record?.agents) ? record.agents : [];
  return {
    running: agents.filter(
      (agent) => isRecord(agent) && agent.status === 'running',
    ).length,
    total: typeof record?.total_spawned === 'number'
      ? record.total_spawned
      : 0,
  };
}

function sessionStatePath(
  stateDir: string,
  sessionId: string,
  fileName: string,
): string | null {
  return SESSION_ID_PATTERN.test(sessionId)
    ? join(stateDir, 'sessions', sessionId, fileName)
    : null;
}

function readOwnedState(
  stateDir: string,
  sessionId: string,
  fileName: string,
  readJson: (path: string) => unknown,
  allowLegacyFallback = false,
): PreToolStateSnapshot {
  if (sessionId && !SESSION_ID_PATTERN.test(sessionId)) {
    return { path: '', state: null };
  }
  const sessionPath = sessionStatePath(stateDir, sessionId, fileName);
  const legacyPath = join(stateDir, fileName);
  const paths = sessionPath
    ? [
        sessionPath,
        ...(allowLegacyFallback ? [legacyPath] : []),
      ]
    : [legacyPath];

  for (const path of paths) {
    const state = asRecord(readJson(path));
    if (!state) continue;
    const owner = stringValue(state.session_id)
      || stringValue(asRecord(state._meta)?.sessionId);
    const isLegacyFallback = !!sessionPath && path === legacyPath;
    if (isLegacyFallback && owner !== sessionId) continue;
    if (sessionId && owner && owner !== sessionId) continue;
    return { path, state };
  }
  return { path: paths[0] ?? legacyPath, state: null };
}

function hasActiveModeState(state: Record<string, unknown> | null): boolean {
  return state?.active === true;
}

function mapCanonicalTeamPhase(rawPhase: unknown): string {
  switch (stringValue(rawPhase).toLowerCase()) {
    case 'initializing':
    case 'planning':
      return 'team-plan';
    case 'executing':
      return 'team-exec';
    case 'fixing':
      return 'team-fix';
    case 'completed':
      return 'complete';
    case 'failed':
      return 'failed';
    default:
      return '';
  }
}

function readCanonicalTeam(
  stateDir: string,
  sessionId: string,
  readJson: (path: string) => unknown,
  listDirectories: (path: string) => readonly string[],
): { active: boolean; teamName?: string } {
  if (!SESSION_ID_PATTERN.test(sessionId)) return { active: false };
  const teamRoot = join(stateDir, 'team');
  for (const teamName of listDirectories(teamRoot)) {
    const manifest = asRecord(readJson(join(teamRoot, teamName, 'manifest.json')));
    const phase = asRecord(readJson(join(teamRoot, teamName, 'phase-state.json')));
    const leader = asRecord(manifest?.leader);
    if (stringValue(leader?.session_id) !== sessionId) continue;
    const stage = mapCanonicalTeamPhase(phase?.current_phase);
    if (!stage) continue;
    return {
      active: stage !== 'complete' && stage !== 'failed',
      teamName,
    };
  }
  return { active: false };
}

function normalizePhase(value: unknown): string {
  return stringValue(value).toLowerCase();
}

function expectedUltragoalObjective(
  state: Record<string, unknown> | null,
  plan: Record<string, unknown> | null,
): string {
  for (const value of [
    state?.claude_goal_objective,
    state?.claudeGoalObjective,
    state?.codex_objective,
    state?.codexObjective,
    state?.goal_objective,
    state?.goalObjective,
    state?.objective,
  ]) {
    const objective = stringValue(value);
    if (objective) return objective;
  }

  const claudeObjective = stringValue(plan?.claudeObjective);
  if (claudeObjective) return claudeObjective;
  const aggregate = asRecord(plan?.aggregateCompletion);
  const aggregateObjective = stringValue(aggregate?.objective);
  if (aggregateObjective) return aggregateObjective;
  const goals = Array.isArray(plan?.goals) ? plan.goals : [];
  const activeGoal = goals.find(
    (goal) => isRecord(goal) && goal.status === 'in_progress',
  );
  return isRecord(activeGoal) ? stringValue(activeGoal.objective) : '';
}

function isUltragoalTerminal(
  state: Record<string, unknown> | null,
  plan: Record<string, unknown> | null,
): boolean {
  if (!state) return true;
  if (
    state.active === false
    || stringValue(state.completed_at) !== ''
    || state.all_done === true
    || state.done === true
  ) {
    return true;
  }
  const phase = normalizePhase(
    state.current_phase ?? state.phase ?? state.status,
  );
  if (phase && ULTRAGOAL_TERMINAL_PHASES.has(phase)) return true;

  const aggregate = asRecord(plan?.aggregateCompletion);
  if (aggregate?.status === 'complete') return true;
  const goals = Array.isArray(plan?.goals) ? plan.goals : [];
  return goals.length > 0 && goals.every((goal) => {
    if (!isRecord(goal)) return false;
    const status = normalizePhase(goal.status);
    return status === 'complete' || status === 'review_blocked';
  });
}

function extractGoalFromTranscript(
  transcript: string | null,
  transcriptPath: string | undefined,
  sessionId: string,
): CanonicalGoalSnapshot | undefined {
  if (
    transcript === null
    || !transcriptPath
    || !sessionId
    || basename(transcriptPath).replace(/\.jsonl$/i, '') !== sessionId
  ) {
    return undefined;
  }

  let objective = '';
  for (const line of transcript.split('\n')) {
    if (!line || !GOAL_BEARING_HINT.test(line)) continue;
    let entry: unknown;
    try {
      entry = JSON.parse(line) as unknown;
    } catch {
      return undefined;
    }
    const record = asRecord(entry);
    const message = asRecord(record?.message);
    if (
      record?.type !== 'user'
      || message?.role !== 'user'
      || typeof message.content !== 'string'
      || !GOAL_COMMAND_MARKER.test(message.content)
    ) {
      continue;
    }
    const args = message.content.match(GOAL_COMMAND_ARGS)?.[1]?.trim() ?? '';
    objective = args === '' || args.toLowerCase() === 'clear' ? '' : args;
  }

  return objective
    ? { objective, status: 'active', source: 'transcript' }
    : undefined;
}

function estimateContextPercent(tail: string): number {
  const windowMatches = tail.match(/"context_window"\s{0,5}:\s{0,5}(\d+)/g);
  const inputMatches = tail.match(/"input_tokens"\s{0,5}:\s{0,5}(\d+)/g);
  if (!windowMatches || !inputMatches) return 0;

  const contextWindow = Number.parseInt(
    windowMatches.at(-1)?.match(/(\d+)/)?.[1] ?? '0',
    10,
  );
  const inputTokens = Number.parseInt(
    inputMatches.at(-1)?.match(/(\d+)/)?.[1] ?? '0',
    10,
  );
  return contextWindow > 0
    ? Math.round((inputTokens / contextWindow) * 100)
    : 0;
}

function parseForceDelegationConfig(value: unknown): ForceDelegationConfig | null {
  const routing = asRecord(asRecord(value)?.routing);
  const raw = asRecord(routing?.forceDelegation);
  if (!raw || raw.enforce !== true || !Array.isArray(raw.rules)) return null;
  return {
    enforce: true,
    rules: raw.rules
      .filter(isRecord)
      .map((rule): ForceDelegationRule => ({
        ...(typeof rule.pattern === 'string' ? { pattern: rule.pattern } : {}),
        ...(isRecord(rule.threshold)
          ? {
              threshold: {
                ...(typeof rule.threshold.count === 'number'
                  ? { count: rule.threshold.count }
                  : {}),
                ...(typeof rule.threshold.windowSeconds === 'number'
                  ? { windowSeconds: rule.threshold.windowSeconds }
                  : {}),
              },
            }
          : {}),
        ...(typeof rule.denyMessage === 'string'
          ? { denyMessage: rule.denyMessage }
          : {}),
        ...(typeof rule.bypassEnv === 'string'
          ? { bypassEnv: rule.bypassEnv }
          : {}),
      })),
  };
}

function parseForceDelegationEvents(
  value: unknown,
  nowSec: number,
): readonly VirtualForceDelegationEvent[] {
  const events = Array.isArray(asRecord(value)?.events)
    ? asRecord(value)!.events as unknown[]
    : [];
  const cutoff = nowSec - FORCE_DELEGATION_RETENTION_SECONDS;
  return events.flatMap((event, originalIndex) => {
    if (!isRecord(event)) return [];
    const observedAtSec = typeof event.observedAtSec === 'number'
      ? event.observedAtSec
      : typeof event.t === 'number'
        ? event.t
        : Number.NaN;
    const toolName = stringValue(event.toolName) || stringValue(event.tool);
    if (
      !Number.isSafeInteger(observedAtSec)
      || observedAtSec < Math.floor(PRE_TOOL_MIN_EPOCH_MS / 1000)
      || observedAtSec <= cutoff
      || observedAtSec
        > nowSec + Math.floor(PRE_TOOL_MAX_FUTURE_SKEW_MS / 1000)
      || !toolName
    ) {
      return [];
    }
    return [{
      toolName,
      observedAtSec,
      originalIndex: typeof event.originalIndex === 'number'
        ? event.originalIndex
        : originalIndex,
      ...(typeof event.intentId === 'string'
        ? { intentId: event.intentId }
        : typeof event.intent_id === 'string'
          ? { intentId: event.intent_id }
          : {}),
    }];
  });
}

function parseAdvisoryEntries(
  value: unknown,
  nowMs: number,
): Readonly<Record<string, AdvisoryThrottleEntry>> {
  const entries = asRecord(asRecord(value)?.entries);
  if (!entries) return {};
  return Object.fromEntries(
    Object.entries(entries).flatMap(([key, entry]) => {
      if (!isRecord(entry)) return [];
      const lastEmittedAtMs = entry.last_emitted_at_ms;
      if (
        typeof lastEmittedAtMs !== 'number'
        || !Number.isSafeInteger(lastEmittedAtMs)
        || lastEmittedAtMs < PRE_TOOL_MIN_EPOCH_MS
        || lastEmittedAtMs > nowMs + PRE_TOOL_MAX_FUTURE_SKEW_MS
      ) {
        return [];
      }
      return [[key, {
        last_emitted_at_ms: lastEmittedAtMs,
        ...(typeof entry.message === 'string' ? { message: entry.message } : {}),
        ...(typeof entry.intent_id === 'string'
          ? { intent_id: entry.intent_id }
          : {}),
      } satisfies AdvisoryThrottleEntry]];
    }),
  );
}

function deliveryIdForEnvelope(
  envelope: CanonicalHookEnvelope,
  createNonce: () => string,
): string {
  if (
    envelope.toolCalls.length > 0
    && envelope.toolCalls.every((call) => call.idSource === 'host')
  ) {
    const identity = envelope.toolCalls
      .map((call) => `${call.id}\0${call.fingerprint}`)
      .join('\0');
    return createHash('sha256')
      .update(envelope.contract)
      .update('\0')
      .update(envelope.sessionId ?? '')
      .update('\0')
      .update(identity)
      .digest('hex');
  }
  return `delivery-${createNonce()}`;
}

/**
 * Load every observation needed by the PreToolUse planner exactly once and
 * freeze the resulting batch snapshot. No planner function performs I/O.
 */
export function loadPreToolBatchSnapshot(
  envelope: CanonicalHookEnvelope,
  dependencies: PreToolSnapshotDependencies = {},
): PreToolBatchSnapshot {
  const now = dependencies.now ?? Date.now;
  const createDeliveryNonce = dependencies.createDeliveryNonce ?? randomUUID;
  const currentDirectory = dependencies.currentDirectory ?? process.cwd;
  const environmentProvider = dependencies.environment
    ?? (() => ({ ...process.env }));
  const resolveOmcRoot = dependencies.resolveOmcRoot ?? getOmcRoot;
  const rawReadJson = dependencies.readJson ?? defaultReadJson;
  const rawReadText = dependencies.readText ?? defaultReadText;
  const rawReadTextTail = dependencies.readTextTail ?? defaultReadTextTail;
  const rawListDirectories =
    dependencies.listDirectories ?? defaultListDirectories;
  const rawFileExists = dependencies.fileExists ?? existsSync;

  const jsonCache = new Map<string, unknown>();
  const textCache = new Map<string, string | null>();
  const textTailCache = new Map<string, string | null>();
  const directoryCache = new Map<string, readonly string[]>();
  const existenceCache = new Map<string, boolean>();
  const readJson = (path: string): unknown => {
    if (!jsonCache.has(path)) {
      jsonCache.set(path, cloneObservation(rawReadJson(path)));
    }
    return jsonCache.get(path);
  };
  const readText = (path: string, maxBytes?: number): string | null => {
    const key = `${path}\0${maxBytes ?? ''}`;
    if (!textCache.has(key)) {
      textCache.set(key, rawReadText(path, maxBytes));
    }
    return textCache.get(key) ?? null;
  };
  const readTextTail = (path: string, maxBytes: number): string | null => {
    const key = `${path}\0${maxBytes}`;
    if (!textTailCache.has(key)) {
      textTailCache.set(key, rawReadTextTail(path, maxBytes));
    }
    return textTailCache.get(key) ?? null;
  };
  const listDirectories = (path: string): readonly string[] => {
    if (!directoryCache.has(path)) {
      directoryCache.set(path, [...rawListDirectories(path)]);
    }
    return directoryCache.get(path) ?? [];
  };
  const fileExists = (path: string): boolean => {
    if (!existenceCache.has(path)) {
      existenceCache.set(path, rawFileExists(path));
    }
    return existenceCache.get(path) ?? false;
  };

  const loadedAtMs = now();
  const observedAt = new Date(loadedAtMs).toISOString();
  const observedAtSec = Math.floor(loadedAtMs / 1000);
  const environment = { ...environmentProvider() };
  const runtimeDirectory = currentDirectory();
  const directory = envelope.directory || runtimeDirectory;
  const omcRoot = resolveOmcRoot(directory);
  const stateDir = join(omcRoot, 'state');
  const sessionId = envelope.sessionId ?? '';
  const deliveryId = deliveryIdForEnvelope(envelope, createDeliveryNonce);

  const userOmcConfigPath = join(
    resolveClaudeConfigDirectory(environment),
    '.omc-config.json',
  );
  const projectOmcConfigPath = join(omcRoot, 'config.json');
  const omcConfig =
    asRecord(readJson(userOmcConfigPath))
    ?? asRecord(readJson(projectOmcConfigPath))
    ?? {};

  const userConfig = loadJsoncRecord(
    join(
      resolveUserConfigDirectory(environment),
      'claude-omc',
      'config.jsonc',
    ),
    readText,
  );
  const projectConfig = loadJsoncRecord(
    join(directory, '.claude', 'omc.jsonc'),
    readText,
  );

  const agentTypes = [...new Set(
    envelope.toolCalls
      .map((call) => getAgentType(call.input))
      .filter(Boolean)
      .map(normalizeAgentType),
  )];
  const configuredAgentModels = Object.fromEntries(
    agentTypes.map((agentType) => [
      agentType,
      resolveConfiguredAgentModel(agentType, projectConfig, userConfig),
    ]),
  );
  const agentDefinitionModels = Object.fromEntries(
    agentTypes.map((agentType) => [
      agentType,
      readAgentDefinitionModel(
        agentType,
        environment,
        runtimeDirectory,
        readText,
      ),
    ]),
  );

  const configuredCopilotModel = resolveConfiguredCopilotDefault(
    'copilotModel',
    projectConfig,
    userConfig,
  );
  const configuredCopilotEffort = stringValue(
    environment.OMC_COPILOT_REASONING_EFFORT,
  ) || resolveConfiguredCopilotDefault(
    'copilotReasoningEffort',
    projectConfig,
    userConfig,
  ) || COPILOT_DEFAULT_REASONING_EFFORT;
  const normalizedCopilotEffort = configuredCopilotEffort.toLowerCase();
  const copilotEffortValid = COPILOT_REASONING_EFFORTS.has(
    normalizedCopilotEffort,
  );
  const copilotDefaults = {
    model:
      stringValue(environment.OMC_EXTERNAL_MODELS_DEFAULT_COPILOT_MODEL)
      || stringValue(environment.OMC_COPILOT_DEFAULT_MODEL)
      || configuredCopilotModel
      || COPILOT_DEFAULT_MODEL,
    reasoningEffort: copilotEffortValid
      ? normalizedCopilotEffort
      : COPILOT_DEFAULT_REASONING_EFFORT,
    warning: copilotEffortValid
      ? ''
      : `[COPILOT MODEL] Ignoring invalid reasoning effort "${configuredCopilotEffort}". `
        + `Expected one of: ${[...COPILOT_REASONING_EFFORTS].join(', ')}. `
        + `Using "${COPILOT_DEFAULT_REASONING_EFFORT}".`,
  };

  const modeStates = Object.fromEntries(
    MODE_STATE_FILES.map((fileName) => [
      fileName.replace(/-state\.json$/, ''),
      readOwnedState(
        stateDir,
        sessionId,
        fileName,
        readJson,
        fileName === 'ultragoal-state.json'
          || fileName === 'team-state.json',
      ),
    ]),
  );
  const invalidSessionId =
    sessionId.length > 0 && !SESSION_ID_PATTERN.test(sessionId);
  const swarmSummaryPath = sessionStatePath(
    stateDir,
    sessionId,
    'swarm-summary.json',
  ) ?? (invalidSessionId ? null : join(stateDir, 'swarm-summary.json'));
  const swarmMarkerPath = sessionStatePath(
    stateDir,
    sessionId,
    'swarm-active.marker',
  ) ?? (invalidSessionId ? null : join(stateDir, 'swarm-active.marker'));
  const swarmSummary = swarmSummaryPath
    ? asRecord(readJson(swarmSummaryPath))
    : null;
  const modeActive =
    Object.values(modeStates).some((candidate) =>
      hasActiveModeState(candidate.state as Record<string, unknown> | null),
    )
    || (
      swarmMarkerPath !== null
      && fileExists(swarmMarkerPath)
      && swarmSummary?.active === true
    );

  const coarseTeamState = modeStates.team?.state ?? null;
  const canonicalTeam = readCanonicalTeam(
    stateDir,
    sessionId,
    readJson,
    listDirectories,
  );
  const team = coarseTeamState?.active === true
    ? {
        active: true,
        teamName:
          stringValue(coarseTeamState.team_name)
          || stringValue(coarseTeamState.teamName)
          || 'team',
      }
    : canonicalTeam;

  const todoCounts = extractTodoCounts([
    readJson(join(omcRoot, 'todos.json')),
    readJson(join(directory, '.claude', 'todos.json')),
  ]);
  const todoLabel = todoCounts.pending + todoCounts.inProgress > 0
    ? `[${todoCounts.inProgress} active, ${todoCounts.pending} pending] `
    : '';
  const tracking = extractTracking(
    readJson(join(stateDir, 'subagent-tracking.json')),
  );

  const transcriptPath = envelope.transcriptPath;
  const transcriptTail = transcriptPath
    ? readTextTail(transcriptPath, TRANSCRIPT_TAIL_BYTES) ?? ''
    : '';
  const needsTranscriptGoal =
    !!transcriptPath
    && !envelope.eventPayload.goal
    && !!sessionId
    && basename(transcriptPath).replace(/\.jsonl$/i, '') === sessionId;
  const transcriptContent = needsTranscriptGoal
    ? readText(transcriptPath!, MAX_TRANSCRIPT_BYTES)
    : null;
  const transcriptGoal = envelope.eventPayload.goal
    ? cloneObservation(envelope.eventPayload.goal)
    : extractGoalFromTranscript(transcriptContent, transcriptPath, sessionId);
  const contextThreshold = numberFromEnvironment(
    environment.OMC_AGENT_PREFLIGHT_CONTEXT_THRESHOLD,
    DEFAULT_CONTEXT_THRESHOLD,
    1,
    100,
  );

  const ultragoalState = modeStates.ultragoal?.state ?? null;
  const ultragoalPlan =
    asRecord(readJson(join(omcRoot, 'ultragoal', 'goals.json')))
    ?? asRecord(readJson(join(directory, '.omc', 'ultragoal', 'goals.json')));

  const forceDelegation = parseForceDelegationConfig(omcConfig);
  const forceDelegationState = asRecord(
    readJson(join(stateDir, 'force-agent-delegation-events.json')),
  );
  const forceDelegationGeneration =
    typeof forceDelegationState?.generation === 'number'
    && Number.isSafeInteger(forceDelegationState.generation)
    && forceDelegationState.generation >= 0
      ? forceDelegationState.generation
      : 0;
  const forceDelegationLedger = {
    generation: forceDelegationGeneration,
    events: parseForceDelegationEvents(
      forceDelegationState,
      observedAtSec,
    ),
  };

  const advisoryPath =
    sessionId && !SESSION_ID_PATTERN.test(sessionId)
      ? ''
      : SESSION_ID_PATTERN.test(sessionId)
        ? join(
            stateDir,
            'sessions',
            sessionId,
            'pre-tool-advisory-throttle.json',
          )
        : join(stateDir, 'pre-tool-advisory-throttle.json');
  const advisoryCooldownMs = numberFromEnvironment(
    environment.OMC_PRE_TOOL_ADVISORY_COOLDOWN_MS,
    DEFAULT_ADVISORY_COOLDOWN_MS,
    0,
  );
  const advisoryNowMs = timestampFromEnvironment(
    environment.OMC_PRE_TOOL_ADVISORY_NOW_MS,
    loadedAtMs,
  );

  const routing = asRecord(omcConfig.routing);
  const snapshot: PreToolBatchSnapshot = {
    version: PRE_TOOL_SNAPSHOT_VERSION,
    loadedAtMs,
    observedAt,
    observedAtSec,
    directory,
    omcRoot,
    stateDir,
    sessionId,
    deliveryId,
    environment,
    disabled:
      environment.DISABLE_OMC === '1'
      || (environment.OMC_SKIP_HOOKS ?? '')
        .split(',')
        .map((value) => value.trim())
        .includes('pre-tool-use'),
    quietLevel: numberFromEnvironment(environment.OMC_QUIET, 0, 0),
    todo: {
      ...todoCounts,
      label: todoLabel,
    },
    tracking,
    team,
    modeActive,
    modeStates,
    omcConfig,
    modelRouting: {
      forceInherit:
        environment.OMC_ROUTING_FORCE_INHERIT === 'true'
        || routing?.forceInherit === true,
      claudeModel: stringValue(environment.CLAUDE_MODEL),
      anthropicModel: stringValue(environment.ANTHROPIC_MODEL),
      anthropicBaseUrl: stringValue(environment.ANTHROPIC_BASE_URL),
      useBedrock: environment.CLAUDE_CODE_USE_BEDROCK === '1',
      useVertex: environment.CLAUDE_CODE_USE_VERTEX === '1',
      configuredAgentModels,
      agentDefinitionModels,
      copilotDefaults,
      tierEnvironment: Object.fromEntries(
        Object.entries(environment)
          .filter(([key, value]) =>
            value !== undefined
            && (
              key === 'OMC_SUBAGENT_MODEL'
              || key.startsWith('CLAUDE_CODE_BEDROCK_')
              || key.startsWith('ANTHROPIC_DEFAULT_')
            ),
          )
          .map(([key, value]) => [key, value ?? '']),
      ),
    },
    transcript: {
      ...(transcriptPath ? { path: transcriptPath } : {}),
      tail: transcriptTail,
      contextPercent: estimateContextPercent(transcriptTail),
      contextThreshold,
      ...(transcriptGoal ? { goal: transcriptGoal } : {}),
    },
    ultragoal: {
      state: ultragoalState,
      ...(modeStates.ultragoal?.path
        ? { statePath: modeStates.ultragoal.path }
        : {}),
      plan: ultragoalPlan,
      expectedObjective: expectedUltragoalObjective(
        ultragoalState as Record<string, unknown> | null,
        ultragoalPlan,
      ),
      terminal: isUltragoalTerminal(
        ultragoalState as Record<string, unknown> | null,
        ultragoalPlan,
      ),
      ...(transcriptGoal ? { goal: transcriptGoal } : {}),
    },
    forceDelegation,
    forceDelegationLedger,
    advisoryThrottle: {
      path: advisoryPath,
      nowMs: advisoryNowMs,
      cooldownMs: advisoryCooldownMs,
      entries: advisoryPath
        ? parseAdvisoryEntries(readJson(advisoryPath), advisoryNowMs)
        : {},
    },
  };

  return deepFreeze(snapshot);
}
