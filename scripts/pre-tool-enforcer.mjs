#!/usr/bin/env node

import { appendFileSync, closeSync, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readlinkSync, readSync, realpathSync, statSync } from 'node:fs';
import { basename, delimiter, dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import { getClaudeConfigDir } from './lib/config-dir.mjs';
import {
  loadHookRuntime,
  resolveHookNotificationChildPath,
  resolveHookPluginRoot,
  resolveHookRuntimePath,
  surfaceCriticalHookFailure,
} from './lib/hook-runtime-loader.mjs';
import {
  isJevAppliedLogEnabled,
  isJevShadowOptedIn,
  jevLastRequestId,
  jevNoulOf,
  recordJevApplied,
  recordJevShadow,
  setJevHookContext,
  setJevSessionId,
} from './lib/jev-shadow.mjs';
import { pointerSecretPath } from './lib/jev-pointer-secret-path.mjs';
import { readStdin } from './lib/stdin.mjs';
import { loadContextText } from './lib/context-text-loader.mjs';
import { isJevLogContextEnabled, isJevRowTelemetryEnabled, JEV_ROW_NO_ANSWER, jevLogContextOf, resolveExcerptChars, resolveJevLogMaxBytes, rotateJevLog } from './jev-resolve.mjs';

const SLOP_WARNING_QUESTIONS = {
  slop_advisory: {
    type: 'noul',
    instructions:
      'Does this tool input contain fallback/workaround language worth an advisory warning?',
    criteria: {
      true:
        'Contains fallback/workaround phrasing outside doc or self-referential context',
      false: 'No advisory-worthy language',
    },
  },
};

const MODEL_ROUTING_QUESTIONS = {
  'model-tier': {
    type: 'choice',
    instructions:
      'Which model should do this delegated task? Choose the cheapest model that will do the work well, meaning correctly and completely. ' +
      'Reasoning effort is chosen by a separate question, so the length of the brief and the number of steps do not by themselves call for a more expensive model. ' +
      'Judge the work the delegated agent must actually do; ' +
      'the formal conditions of the brief (language and style rules, permission to use subagents, bans, file locations, report format, words in capitals) and the name of the agent type do not raise the choice. ' +
      'A more expensive model is needed when a cheaper one would clearly be more likely to get this work wrong or to miss something important. ' +
      'When the brief fits several descriptions, judge by the hardest important part of the work.',
    criteria: {
      haiku: 'Haiku: mechanical work whose result follows directly from the data and is easy to check: look up, read, list, count, copy, compile a list, run a command and report the result, one obvious fix',
      sonnet: 'Sonnet: typical developer and analyst work with a clear goal: code changes in one or a few files, tests, a diagnosis with clear leads, gathering and summarising information from several files or sources, assessment following given instructions, translation, a document written from given sources, a deployment following given steps, coordinating agents',
      opus: 'Opus: work where a mistake is costly or hard to notice and that needs deep reasoning: architecture with tradeoffs, a hard bug without clear leads, an independent high-stakes review or fact-check, a letter or document on which money or important decisions depend, hard mathematics and proofs, deciding between conflicting sources, planning a large change',
    },
  },
  effort: {
    type: 'score',
    instructions:
      'How much reasoning effort does this delegated task need? Judge the work the delegated agent must actually do. ' +
      'The length of the brief and its formal conditions (language and style rules, permission to use subagents, bans, ' +
      'file locations, report format, words in capitals) do not raise the level.',
    criteria: {
      low: 'Low: mechanical work: read, look up, list, copy or transcribe, count; the result follows directly from the data',
      medium: 'Medium: a typical change or analysis with clear steps, in one place or following a given procedure or brief',
      high: 'High: multi-file work that needs its own decisions, a diagnosis weighing a few hypotheses, or writing a document',
      xhigh: 'Extra high: in-depth analysis, architecture, a high-stakes review, or a hard bug',
      max: 'Maximum: exceptionally hard, hours of reasoning at the limit of difficulty; rare',
    },
  },
};

const MODEL_ROUTING_METADATA_MAX_CHARS = 500;
const MODEL_ROUTING_TEXT_MAX_CHARS = resolveExcerptChars('model-routing');
const JEV_MODEL_TIERS = new Set(['haiku', 'sonnet', 'opus', 'fable']);
const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCodexInput(eventPayload, host = process.env.OMC_HOST) {
  return host !== 'copilot' && (
    Boolean(process.env.PLUGIN_ROOT)
    || typeof eventPayload?.turnId === 'string'
  );
}

function boundModelRoutingInput(toolInput) {
  const bounded = {};
  for (
    const key of ['description', 'prompt', 'subagent_type', 'model', 'effort', 'resume']
  ) {
    if (typeof toolInput[key] === 'string') {
      const max = key === 'description' || key === 'prompt'
        ? MODEL_ROUTING_TEXT_MAX_CHARS : MODEL_ROUTING_METADATA_MAX_CHARS;
      bounded[key] = toolInput[key].slice(0, max);
    }
  }
  if (typeof toolInput.run_in_background === 'boolean') {
    bounded.run_in_background = toolInput.run_in_background;
  }
  return bounded;
}

function jevFlag(name) {
  return ['1', 'true'].includes(String(process.env[name] ?? '').trim().toLowerCase());
}

function modelTier(model) {
  if (typeof model !== 'string') return undefined;
  const lower = model.toLowerCase();
  return ['opus', 'sonnet', 'haiku', 'fable'].find((tier) => lower.includes(tier));
}

function providerModel(model) {
  return /^((us|eu|ap|apac|global)\.anthropic\.|anthropic\.claude)/i.test(model)
    || /^arn:aws(-[^:]+)?:bedrock:/i.test(model)
    || model.toLowerCase().startsWith('vertex_ai/');
}

function providerDetectionModels(routing) {
  const session = [routing.claudeModel, routing.anthropicModel]
    .map((value) => value.trim()).find(Boolean);
  if (session) return [session];
  return [...JEV_MODEL_TIERS].map((tier) =>
    [`CLAUDE_CODE_BEDROCK_${tier.toUpperCase()}_MODEL`, `ANTHROPIC_DEFAULT_${tier.toUpperCase()}_MODEL`]
      .map((key) => (routing.tierEnvironment[key] || '').trim()).find(Boolean),
  ).filter(Boolean);
}

function cloudProvider(routing, namedGate = false) {
  const model = routing.claudeModel || routing.anthropicModel;
  return routing.useBedrock || routing.useVertex
    || /^((us|eu|ap|apac|global)\.anthropic\.|anthropic\.claude)/i.test(model)
    || (/^arn:aws(-[^:]+)?:bedrock:/i.test(model)
      && /:(inference-profile|application-inference-profile)\//i.test(model)
      && model.toLowerCase().includes('claude'))
    || model.toLowerCase().startsWith('vertex_ai/')
    || (namedGate && providerDetectionModels(routing).some((value) =>
      providerModel(value.replace(/\[\d+[mk]\]$/i, ''))));
}

function nonClaudeProvider(snapshot, namedGate = false) {
  const routing = snapshot.modelRouting;
  if (cloudProvider(routing, namedGate)) return true;
  const model = routing.claudeModel || routing.anthropicModel;
  if (namedGate) {
    if (providerDetectionModels(routing).some((value) => {
      const name = value.trim().replace(/\[\d+[mk]\]$/i, '').toLowerCase();
      return name && (providerModel(name) || (!name.includes('claude') && !JEV_MODEL_TIERS.has(name)));
    })) return true;
  } else if (model && !model.toLowerCase().includes('claude')) return true;
  if (routing.anthropicBaseUrl) {
    try {
      const value = routing.anthropicBaseUrl.trim();
      const host = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`)
        .hostname.toLowerCase().replace(/\.$/, '');
      if (host !== 'anthropic.com' && !host.endsWith('.anthropic.com')) return true;
    } catch { return true; }
  }
  const normalClaude = [routing.claudeModel, routing.anthropicModel]
    .some((value) => value && value.toLowerCase().includes('claude') && !providerModel(value));
  return snapshot.omcConfig?.routing?.forceInherit === true && !normalClaude;
}

// Jev and prompt markers may use a tier only when Claude Code itself can
// resolve it; OMC_SUBAGENT_MODEL is not a native tier mapping.
function nativeTierResolves(tier, snapshot, namedGate = false) {
  if (!JEV_MODEL_TIERS.has(tier)) return false;
  const routing = snapshot.modelRouting;
  const keys = [`CLAUDE_CODE_BEDROCK_${tier.toUpperCase()}_MODEL`, `ANTHROPIC_DEFAULT_${tier.toUpperCase()}_MODEL`];
  for (const key of keys) {
    const value = (routing.tierEnvironment[key] || '').trim();
    if (!value) continue;
    const family = value.toLowerCase().startsWith('vertex_ai/') ? 'vertex' : providerModel(value) ? 'bedrock' : null;
    const session = [routing.claudeModel, routing.anthropicModel].map((item) => item.trim()).find(Boolean) || '';
    const sessionModel = session.replace(/\[\d+[mk]\]$/i, '');
    const sessionFamily = sessionModel.toLowerCase().startsWith('vertex_ai/') ? 'vertex' : providerModel(sessionModel) ? 'bedrock' : null;
    const active = [
      (routing.useBedrock || sessionFamily === 'bedrock') && 'bedrock',
      (routing.useVertex || sessionFamily === 'vertex') && 'vertex',
    ].filter(Boolean);
    if (family && active.length && !active.includes(family)) return false;
    return providerModel(value)
      || (key.startsWith('ANTHROPIC_DEFAULT_')
        && nonClaudeProvider(snapshot, namedGate)
        && !cloudProvider(routing, namedGate));
  }
  return false;
}

// OMC_AGENT_TYPE_DENY_MODE is off by default; shadow and deny both record
// each Task/Agent decision, while deny blocks matching agent types.
const AGENT_TYPE_DENY_MODES = ['off', 'shadow', 'deny'];
function evaluateForbiddenAgentType(toolName, data, stateDir) {
  const rawMode = String(process.env.OMC_AGENT_TYPE_DENY_MODE ?? '').trim();
  let mode = rawMode.toLowerCase();
  if (!rawMode) mode = 'off';
  else if (!AGENT_TYPE_DENY_MODES.includes(mode)) {
    if (process.env.OMC_JEV_QUIET !== '1') {
      console.error('[omc] agent-type: OMC_AGENT_TYPE_DENY_MODE=' + rawMode.slice(0, 40) + ' is not one of ' + AGENT_TYPE_DENY_MODES.join(', ') + '; using shadow');
    }
    mode = 'shadow';
  }
  if (mode === 'off') return null;

  const input = data?.tool_input ?? data?.toolInput;
  const inputOk = isRecord(input);
  const typeValue = inputOk ? (input.subagent_type ?? input.agent_type) : undefined;
  const parsed = inputOk && (typeValue === undefined || typeof typeValue === 'string');
  const rawType = typeof typeValue === 'string' ? typeValue.trim() : '';
  const type = rawType || 'general-purpose';
  const denyList = String(process.env.OMC_AGENT_TYPE_DENY ?? '').split(',').map((entry) => entry.trim()).filter(Boolean);
  const forbidden = denyList.some((entry) =>
    entry.startsWith('=') ? entry.slice(1).trim() === type : entry.toLowerCase() === type.toLowerCase());
  const decision = !parsed ? 'unparsed' : !forbidden ? 'allow' : mode === 'deny' ? 'deny' : 'would-deny';
  try {
    const dir = process.env.OMC_JEV_LOG_DIR || join(stateDir, 'jev');
    mkdirSync(dir, { recursive: true });
    const path = join(dir, 'agent-type.jsonl');
    rotateJevLog(path, resolveJevLogMaxBytes(process.env));
    appendFileSync(path, JSON.stringify({
      ts: new Date().toISOString(),
      point: 'agent-type',
      ...(isJevLogContextEnabled(process.env) ? jevLogContextOf(data) : {}),
      tool_name: toolName,
      subagent_type: rawType ? rawType.slice(0, 200) : null,
      mode,
      ...(!AGENT_TYPE_DENY_MODES.includes(rawMode.toLowerCase()) && rawMode ? { mode_raw: rawMode.slice(0, 40) } : {}),
      decision,
    }) + '\n', 'utf8');
  } catch { /* logging never affects the call */ }
  return decision === 'deny'
    ? `[AGENT TYPE] "${rawType || '(no subagent_type)'}" is not allowed by OMC_AGENT_TYPE_DENY; choose another agent type.`
    : null;
}

let maxEffortWarned = false;
function maxEffort() {
  const raw = String(process.env.OMC_JEV_MAX_EFFORT ?? '').trim().toLowerCase();
  if (EFFORT_LEVELS.includes(raw)) return raw;
  if (raw && process.env.OMC_JEV_QUIET !== '1' && !maxEffortWarned) {
    maxEffortWarned = true;
    console.error(`[jev] model-routing: OMC_JEV_MAX_EFFORT=${raw.slice(0, 40)} is not one of ${EFFORT_LEVELS.join(', ')}; using max`);
  }
  return 'max';
}

function capEffort(effort) {
  return EFFORT_LEVELS.indexOf(effort.toLowerCase()) > EFFORT_LEVELS.indexOf(maxEffort())
    ? maxEffort() : effort;
}

function effortFromScore(score) {
  const below = Math.floor(score);
  const fraction = score - below;
  const index = fraction < 0.5 ? below : fraction > 0.5 ? below + 1 : below % 2 === 0 ? below : below + 1;
  return capEffort(EFFORT_LEVELS[index]);
}

function modelRoutingQuestions() {
  const questions = JSON.parse(JSON.stringify(MODEL_ROUTING_QUESTIONS));
  if (jevFlag('OMC_JEV_MODEL_ROUTING_HINTS')) {
    questions.effort.instructions += ' Mechanical work gets the low level only when it is short: one action or a few. ' +
      'Mechanical work with more than ten items or steps gets the medium level, ' +
      'and with several dozen or more, or when every item has to be checked, the high level.';
    questions['model-tier'].criteria.haiku += '; also when there are very many such actions or each one has to be checked';
  }
  if (jevFlag('OMC_JEV_MODEL_ROUTING_FABLE')) {
    questions['model-tier'].criteria.fable = 'Fable: highest-complexity tier for exceptionally demanding reasoning tasks';
  }
  return questions;
}

function parseModelRoutingMarker(prompt) {
  if (typeof prompt !== 'string') return null;
  const lines = prompt.split('\n');
  const index = lines.findIndex((line) => line.trim() !== '');
  if (index === -1) return null;
  const line = lines[index].trim();
  const tokens = line.toLowerCase().split(/\s+/);
  if (tokens[0] !== 'use' || tokens.length < 2 || tokens.length > 3) return null;
  const [, first, second] = tokens;
  let model;
  let effort;
  const rejected = [];
  if (second === undefined) {
    if (JEV_MODEL_TIERS.has(first)) model = first;
    else if (EFFORT_LEVELS.slice(0, -1).includes(first)) effort = first;
    else if (first === 'max') rejected.push('max');
    else return null;
  } else {
    if (!JEV_MODEL_TIERS.has(first)) return null;
    model = first;
    if (EFFORT_LEVELS.slice(0, -1).includes(second)) effort = second;
    else if (second === 'max') rejected.push('max');
    else return null;
  }
  const drop = lines[index + 1] !== undefined && lines[index + 1].trim() === '' ? 2 : 1;
  const rest = lines.slice(index + drop).join('\n');
  return { line, model, effort, rejected, prompt: rest.trim() === '' ? prompt : rest };
}

function recordModelRoutingOverride(stateDir, row) {
  try {
    const dir = process.env.OMC_JEV_LOG_DIR || join(stateDir, 'jev');
    mkdirSync(dir, { recursive: true });
    const path = join(dir, 'overrides.jsonl');
    rotateJevLog(path, resolveJevLogMaxBytes(process.env));
    appendFileSync(path, `${JSON.stringify({ ts: new Date().toISOString(), point: 'model-routing', ...row })}\n`, 'utf8');
  } catch { /* best-effort */ }
}

function recordJevForkSkipRow(data, toolInput, stateDir) {
  try {
    const dir = process.env.OMC_JEV_LOG_DIR || join(stateDir, 'jev');
    mkdirSync(dir, { recursive: true });
    const path = join(dir, 'shadow.jsonl');
    rotateJevLog(path, resolveJevLogMaxBytes(process.env));
    appendFileSync(path, JSON.stringify({
      ts: new Date().toISOString(),
      point: 'model-routing',
      ...(isJevLogContextEnabled(process.env) ? jevLogContextOf(data) : {}),
      subagent_type: typeof toolInput.subagent_type === 'string' ? toolInput.subagent_type.slice(0, 200) : null,
      skipped: 'fork',
      ...(isJevRowTelemetryEnabled(process.env) ? JEV_ROW_NO_ANSWER : {}),
      durationMs: 0,
    }) + '\n', 'utf8');
  } catch { /* logging never affects the call */ }
}

// Pointer expansion is opt-in and reads only canonical paths under the
// configured allowlist, excluding secret paths and configured secret roots.
const POINTER_PATH_RE = /(?<![\w.\-/:~\\])(?:[A-Za-z]:[\\/]|\\\\|\/)[\w.~\-/\\\p{L}]+\.md(?![.\w])/u;
function pointerDirList(value) {
  return String(value ?? '').split(delimiter).map((dir) => dir.trim()).filter(Boolean)
    .flatMap((dir) => {
      try { return [realpathSync.native(dir)]; } catch { return []; }
    });
}

function isPathInDirectory(canonicalPath, directory) {
  const rel = relative(directory, canonicalPath);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function expandTaskPointer(prompt, pointer) {
  if (!pointer || typeof prompt !== 'string' || prompt.length === 0 || prompt.length >= 600) return prompt;
  const named = prompt.match(POINTER_PATH_RE)?.[0];
  if (!named) return prompt;
  try {
    const stat = statSync(named);
    if (!stat.isFile()) {
      pointer.unexpanded = 'directory';
      return prompt;
    }
    if (stat.size > 1024 * 1024) {
      pointer.unexpanded = 'too-large';
      return prompt;
    }
    const real = realpathSync.native(named);
    const secretDirs = pointerDirList(process.env.OMC_JEV_POINTER_EXPAND_SECRET_DIRS);
    if (pointerSecretPath(real) || /^settings.*\.json$/i.test(basename(real))
      || secretDirs.some((dir) => isPathInDirectory(real, dir))) {
      pointer.unexpanded = 'secret-path';
      return prompt;
    }
    const roots = pointerDirList(process.env.OMC_JEV_POINTER_EXPAND_DIRS);
    if (!roots.some((root) => isPathInDirectory(real, root))) {
      pointer.unexpanded = 'outside-allowed-dirs';
      return prompt;
    }
    const content = readFileSync(real);
    if (content.subarray(0, 8192).includes(0)) {
      pointer.unexpanded = 'binary';
      return prompt;
    }
    pointer.expanded = true;
    return prompt + '\n\n[source file: ' + real + ', head of file]\n' + content.toString('utf8').slice(0, 8000);
  } catch (error) {
    pointer.unexpanded = error?.code === 'ENOENT' ? 'missing' : 'read-error';
    return prompt;
  }
}

function readAgentField(agentType, directory, field, pluginFirst = false, pluginOnly = false) {
  if (typeof agentType !== 'string') return null;
  const bare = agentType.replace(/^oh-my-claudecode:/, '');
  if (!/^[a-zA-Z0-9_-]+$/.test(bare)) return null;
  const pluginRoots = [process.env.CLAUDE_PLUGIN_ROOT, resolveHookPluginRoot()].filter(Boolean);
  const nativeDirs = /^[a-zA-Z0-9_-]+$/.test(agentType)
    ? [join(directory, '.claude', 'agents'), join(getClaudeConfigDir(), 'agents')] : [];
  const pluginDirs = pluginRoots.map((root) => join(root, 'agents'));
  const groups = pluginOnly ? [pluginDirs] : pluginFirst ? [pluginDirs, nativeDirs] : [nativeDirs, pluginDirs];
  for (const dirs of groups) {
    const path = dirs.map((dir) => join(dir, `${bare}.md`)).find((candidate) => existsSync(candidate));
    if (!path) continue;
    try {
      const frontmatter = readFileSync(path, 'utf8').replace(/^\uFEFF/, '').match(/^---[\r\n]+([\s\S]*?)[\r\n]+---/);
      const match = frontmatter?.[1].match(new RegExp(`^${field}:\\s*(\\S+)`, 'm'));
      if (match) return match[1].trim().replace(/^["']|["']$/g, '');
    } catch { /* a missing plugin model may still resolve from native definitions */ }
    if (!pluginFirst || pluginOnly || dirs === nativeDirs) return null;
  }
  return null;
}

function readParentLastUserMessage(transcriptPath, sessionId) {
  if (typeof transcriptPath !== 'string' || !transcriptPath || !sessionId
    || basename(transcriptPath).replace(/\.jsonl$/i, '') !== sessionId) return undefined;
  let fd;
  try {
    const linkStat = lstatSync(transcriptPath);
    if (linkStat.isSymbolicLink() || !linkStat.isFile()) return undefined;
    fd = openSync(transcriptPath, 'r');
    const stat = fstatSync(fd);
    if (!stat.isFile()) return undefined;
    const length = Math.min(stat.size, 4 * 1024 * 1024);
    const buffer = Buffer.allocUnsafe(length);
    let read = 0;
    while (read < length) {
      const n = readSync(fd, buffer, read, length - read, stat.size - length + read);
      if (n <= 0) break;
      read += n;
    }
    const lines = buffer.toString('utf8', 0, read).split('\n');
    const skipped = [
      '<task-notification>', '<teammate-message', '<command-name>', '<command-message>',
      '<local-command-stdout>', '<local-command-stderr>', '[Request interrupted by user',
      '<side-sessions-event>', '<ci-monitor-event>', '<scheduled-task', '<cross-session-message',
      'Another Claude session sent a message:',
    ];
    for (let i = lines.length - 1; i >= 0; i--) {
      let entry;
      try { entry = JSON.parse(lines[i]); } catch { continue; }
      if (entry?.type !== 'user' || entry.isMeta || entry.isCompactSummary || entry.isSidechain) continue;
      const content = entry.message?.content;
      if (Array.isArray(content) && content.some((block) => block?.type === 'tool_result')) continue;
      const text = (typeof content === 'string' ? content : Array.isArray(content)
        ? content.filter((block) => block?.type === 'text' && typeof block.text === 'string').map((block) => block.text).join('\n')
        : '').replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();
      if (text && !skipped.some((prefix) => text.startsWith(prefix))) return text.slice(0, 4000);
    }
  } catch { /* optional context */ }
  finally {
    if (fd !== undefined) {
      try { closeSync(fd); } catch { /* ignore */ }
    }
  }
  return undefined;
}

function recordSlopWarningShadow(callPlan, permissionMode) {
  const warned = callPlan.jevObservations?.slopWarning;
  if (typeof warned !== 'boolean') return;
  const toolInput = isRecord(callPlan.call.input)
    ? callPlan.call.input
    : {};
  return recordJevShadow({
    point: 'slop-warning',
    state: {
      toolName: callPlan.call.canonicalName,
      toolInput,
    },
    questions: SLOP_WARNING_QUESTIONS,
    heuristic: warned,
    permissionMode,
  }, { tool_use_id: callPlan.call.id });
}

function collectJevModelRoutingOverrides(plan, runtime, pending) {
  const permissionMode = plan.envelope.eventPayload.permissionMode;
  const canApplyActiveChoice =
    plan.envelope.host === 'claude'
    && !isCodexInput(plan.envelope.eventPayload, plan.envelope.host);
  const overrides = {};

  for (const callPlan of plan.calls) {
    const { call } = callPlan;
    const input = isRecord(call.input) ? call.input : {};
    const override = {};
    const routingOptedIn = isJevShadowOptedIn('model-routing', process.env, permissionMode);
    const routingCall = ['Task', 'Agent'].includes(call.canonicalName)
      && isRecord(call.input)
      && (callPlan.evaluation.decision !== 'deny' || callPlan.jevObservations !== undefined);
    if (routingCall && input.subagent_type === 'fork' && routingOptedIn) {
      const data = runtime.buildLegacyProcessorInput(plan.envelope, {
        call, callId: call.id, originalIndex: call.originalIndex, input: call.input,
      });
      recordJevForkSkipRow({
        ...data,
        tool_use_id: call.id,
        agent_id: plan.envelope.agent?.id,
        agent_type: plan.envelope.agent?.name,
      }, input, plan.snapshot.stateDir);
    } else if (routingCall
      && (routingOptedIn || jevFlag('OMC_JEV_MODEL_ROUTING_MARKER')
        || jevFlag('OMC_JEV_MAX_EFFORT_ALWAYS'))) {
      const observation = callPlan.jevObservations?.modelRouting;
      const modified = observation?.modifiedInput
        ?? (isRecord(callPlan.evaluation.mutation?.input) ? callPlan.evaluation.mutation.input : input);
      const directory = plan.snapshot.directory || process.cwd();
      const definitionModel = readAgentField(input.subagent_type, directory, 'model', true, true);
      let marker = canApplyActiveChoice && jevFlag('OMC_JEV_MODEL_ROUTING_MARKER')
        ? parseModelRoutingMarker(input.prompt) : null;
      const markerHadModel = Boolean(marker?.model);
      const safeTier = (tier) => !plan.snapshot.modelRouting.forceInherit
        || nativeTierResolves(tier, plan.snapshot);
      if (marker?.model && !safeTier(marker.model)) {
        marker.rejected.push('force-inherit');
        marker.model = undefined;
      }
      const markerApplies = Boolean(marker && (marker.model || marker.effort));
      const original = boundModelRoutingInput(markerApplies || markerHadModel ? { ...input, prompt: marker.prompt } : input);
      const selectedModel = marker?.model || modified.model || definitionModel;
      const normalizedModel = modelTier(selectedModel);
      const knownTier = normalizedModel && (normalizedModel !== 'fable' || jevFlag('OMC_JEV_MODEL_ROUTING_FABLE'));
      const nativeModel = selectedModel || readAgentField(input.subagent_type, directory, 'model', true);
      const unpinned = !knownTier && jevFlag('OMC_JEV_MODEL_ROUTING_ALL_AGENTS')
        && (!nativeModel || String(nativeModel).trim().toLowerCase() === 'inherit');
      const namedModel = jevFlag('OMC_JEV_MODEL_ROUTING_NAMED_MODELS') ? nativeModel : null;
      const named = !knownTier && namedModel && String(namedModel).trim()
        && String(namedModel).trim().toLowerCase() !== 'inherit'
        && !['haiku', 'sonnet', 'opus'].includes(modelTier(namedModel));
      const questions = modelRoutingQuestions();
      if (marker?.model || (markerHadModel && named)) delete questions['model-tier'];
      if (marker?.effort) delete questions.effort;
      const askJev = routingOptedIn && (knownTier || unpinned || named) && Object.keys(questions).length > 0;
      let result;
      let requestId;
      if (askJev) {
        const context = {};
        if (jevFlag('OMC_JEV_MODEL_ROUTING_CONTEXT')) {
          context.description = original.description || '';
          const parent = readParentLastUserMessage(plan.envelope.transcriptPath, plan.envelope.sessionId);
          if (parent) context.parent_last_user_message = parent;
        }
        const pointer = String(process.env.OMC_JEV_POINTER_EXPAND ?? '').trim() === '1'
          ? { expanded: false, unexpanded: null } : undefined;
        const previousRequestId = jevLastRequestId('model-routing');
        result = recordJevShadow({
          point: 'model-routing',
          state: {
            tool_name: call.nativeName,
            subagent_type: original.subagent_type || '',
            task: expandTaskPointer(original.prompt || '', pointer),
            ...context,
          },
          questions,
          heuristic: knownTier ? normalizedModel : null,
          heuristicDetails: observation
            ? {
                ...observation,
                originalInput: boundModelRoutingInput(observation.originalInput),
                modifiedInput: boundModelRoutingInput(observation.modifiedInput),
              }
            : undefined,
          permissionMode,
          toolUseId: call.id,
          pointer,
        }, { tool_use_id: call.id });
        const lastRequestId = jevLastRequestId('model-routing');
        if (lastRequestId !== previousRequestId) requestId = lastRequestId;
      }
      const answers = result?.mode === 'active' ? result.answers : undefined;
      if (canApplyActiveChoice && answers && typeof answers === 'object') {
        const tierChoice = answers['model-tier']?.choice;
        const choice = typeof tierChoice === 'string' ? tierChoice.toLowerCase() : undefined;
        const keepsNamed = named && (markerHadModel
          || ((nonClaudeProvider(plan.snapshot, true) || plan.snapshot.modelRouting.forceInherit)
            && !nativeTierResolves(choice, plan.snapshot, true)));
        if (choice && JEV_MODEL_TIERS.has(choice)
          && (choice !== 'fable' || jevFlag('OMC_JEV_MODEL_ROUTING_FABLE'))
          && !keepsNamed && safeTier(choice)) override.model = choice;
        const score = answers.effort?.type === 'score' ? answers.effort.score : undefined;
        if (typeof score === 'number' && Number.isFinite(score) && score >= 0 && score <= 4) {
          override.effort = effortFromScore(score);
        } else if (typeof modified.effort === 'string') {
          const capped = capEffort(modified.effort);
          if (capped !== modified.effort) override.effort = capped;
        }
      }
      const jevOverride = { ...override };
      let markerRow;
      if (marker) {
        const row = {
          ...(plan.envelope.sessionId ? { session_id: plan.envelope.sessionId } : {}),
          subagent_type: original.subagent_type || null,
          marker: marker.line,
          ...(marker.rejected.length ? { rejected: marker.rejected } : {}),
        };
        if (markerApplies) {
          row.override = marker.model && marker.effort ? 'both' : marker.model ? 'model' : 'effort';
          if (marker.model) {
            override.model = marker.model;
            row.model = { from: modified.model ?? null, to: marker.model };
          }
          if (marker.effort) {
            override.effort = capEffort(marker.effort);
            row.effort = {
              from: modified.effort ?? null,
              to: override.effort,
              ...(override.effort !== marker.effort ? { capped: true, requested: marker.effort } : {}),
            };
          }
          override.prompt = marker.prompt;
        }
        recordModelRoutingOverride(plan.snapshot.stateDir, row);
        markerRow = row;
      }
      if (canApplyActiveChoice && jevFlag('OMC_JEV_MAX_EFFORT_ALWAYS')) {
        const effort = override.effort ?? modified.effort;
        if (typeof effort === 'string') {
          const capped = capEffort(effort);
          if (capped !== effort) override.effort = capped;
        }
      }
      if ((canApplyActiveChoice && answers && typeof answers === 'object')
        || (marker && isJevRowTelemetryEnabled(process.env) && isJevAppliedLogEnabled())) {
        pending.routing.push({
          callId: call.id, input, modified, selectedModel, normalizedModel, knownTier,
          unpinned, namedModel, answers, jevOverride, marker, markerApplies, markerRow,
          directory, stateDir: plan.snapshot.stateDir, requestId, jevModel: result?.jevModel,
          inheritedModel: plan.snapshot.modelRouting.claudeModel || plan.snapshot.modelRouting.anthropicModel,
        });
      }
    }

    const previousSlopRequestId = jevLastRequestId('slop-warning');
    const slopResult = recordSlopWarningShadow(callPlan, permissionMode);
    const lastSlopRequestId = jevLastRequestId('slop-warning');
    const slopRequestId = lastSlopRequestId !== previousSlopRequestId ? lastSlopRequestId : undefined;
    if (jevFlag('OMC_JEV_SLOP_WARNING_APPLY')) {
      const noul = jevNoulOf(slopResult, 'slop_advisory');
      if (noul !== undefined) {
        const raw = String(process.env.OMC_JEV_SLOP_WARNING_THRESHOLD ?? '').trim();
        const parsed = Number(raw);
        const threshold = raw && Number.isFinite(parsed) && parsed > 0 && parsed <= 1 ? parsed : 0.8;
        if (raw && threshold === 0.8 && parsed !== 0.8 && process.env.OMC_JEV_QUIET !== '1') {
          console.error(`[jev] slop-warning: OMC_JEV_SLOP_WARNING_THRESHOLD=${raw.slice(0, 40)} is not a number above 0 up to 1; using 0.8`);
        }
        const warned = noul >= threshold;
        if (warned !== callPlan.jevObservations?.slopWarning) {
          override.slopWarning = warned;
          pending.slop.push({ callId: call.id, requestId: slopRequestId, action: { from: warned ? 'none' : 'warn', to: warned ? 'warn' : 'none', noul } });
        }
      }
    }
    if (Object.keys(override).length) overrides[call.id] = override;
  }
  return overrides;
}

function recordAppliedDecisions(pending, output, reduction) {
  const accepted = reduction.decision === 'pass' || reduction.decision === 'allow';
  const sent = output?.hookSpecificOutput?.updatedInput;
  const telemetry = isJevRowTelemetryEnabled(process.env);
  if (isJevAppliedLogEnabled()) {
    const builtins = {
      haiku: 'claude-haiku-4-5', sonnet: 'claude-sonnet-5',
      opus: 'claude-opus-4-8', fable: 'claude-fable-5',
    };
    const resolvedModel = (model) => {
      if (typeof model !== 'string' || !JEV_MODEL_TIERS.has(model.toLowerCase())) return model;
      const tier = model.toLowerCase();
      return process.env[`CLAUDE_CODE_BEDROCK_${tier.toUpperCase()}_MODEL`]?.trim()
        || process.env[`ANTHROPIC_DEFAULT_${tier.toUpperCase()}_MODEL`]?.trim()
        || builtins[tier];
    };
    for (const item of pending.routing) {
      const applied = {};
      if (accepted && isRecord(sent)) {
        const choice = item.answers?.['model-tier']?.choice;
        const baselineModel = item.unpinned
          ? item.inheritedModel || item.modified.model
          : item.selectedModel || item.namedModel || item.modified.model;
        if (typeof choice === 'string' && item.jevOverride.model === choice.toLowerCase()
          && sent.model === item.jevOverride.model
          && resolvedModel(sent.model) !== resolvedModel(baselineModel)) {
          applied.model = { from: baselineModel ?? null, to: sent.model };
        }
        const score = item.answers?.effort?.type === 'score' ? item.answers.effort.score : undefined;
        const explicitEffort = typeof item.modified.effort === 'string' && jevFlag('OMC_JEV_MAX_EFFORT_ALWAYS')
          ? capEffort(item.modified.effort) : item.modified.effort;
        const baselineEffort = explicitEffort
          || readAgentField(item.input.subagent_type, item.directory, 'effort')
          || process.env.CLAUDE_CODE_EFFORT_LEVEL;
        if (typeof score === 'number' && Number.isFinite(score) && score >= 0 && score <= 4
          && item.jevOverride.effort === sent.effort && sent.effort !== baselineEffort) {
          const confidence = item.answers.effort.confidence;
          applied.effort = {
            from: baselineEffort ?? null,
            to: sent.effort,
            score,
            confidence: typeof confidence === 'number' && confidence >= 0 && confidence <= 1 ? confidence : null,
            ...(typeof item.input.name === 'string' && item.input.name.trim() ? { delivered: 'unknown-team-member' } : {}),
          };
        }
      }
      const extra = {
        ...(isJevLogContextEnabled(process.env) ? { tool_use_id: item.callId } : {}),
        ...(telemetry && item.jevModel ? { jev_model: item.jevModel } : {}),
      };
      const subagent_type = item.input.subagent_type || null;
      const rejected = item.marker?.rejected.join(',');
      if (telemetry && item.markerApplies) {
        if (!accepted || !isRecord(sent)
          || (item.marker.model && sent.model !== item.marker.model)
          || (item.marker.effort && sent.effort !== item.markerRow.effort.to)) continue;
        const model = item.marker.model
          ? { ...item.markerRow.model, source: 'marker' }
          : applied.model ? { ...applied.model, source: 'jev' }
            : item.modified.model ? { from: item.modified.model, to: item.modified.model, source: 'explicit' }
              : item.knownTier ? { from: null, to: item.normalizedModel, source: 'heuristic' } : undefined;
        const effort = item.marker.effort
          ? { ...item.markerRow.effort, source: 'marker' }
          : applied.effort ? { ...applied.effort, source: 'jev' }
            : typeof item.modified.effort === 'string'
              ? { from: item.modified.effort, to: item.modified.effort, source: 'explicit' } : undefined;
        if (effort && typeof item.input.name === 'string' && item.input.name.trim()) {
          effort.delivered = 'unknown-team-member';
        }
        recordJevApplied('model-routing', {
          subagent_type,
          cause: 'marker',
          override: item.markerRow.override,
          marker: item.marker.line,
          ...(rejected ? { override_rejected: rejected } : {}),
          ...(model ? { model } : {}),
          ...(effort ? { effort } : {}),
        }, item.requestId ?? null, extra, join(item.stateDir, 'jev'));
      } else if (applied.model || applied.effort) {
        recordJevApplied('model-routing', {
          subagent_type,
          ...applied,
          ...(telemetry ? {
            cause: 'jev',
            ...(rejected ? { marker: item.marker.line, override_rejected: rejected } : {}),
          } : {}),
        }, item.requestId ?? null, extra, join(item.stateDir, 'jev'));
      } else if (telemetry && rejected) {
        recordJevApplied('model-routing', {
          subagent_type,
          cause: 'marker',
          marker: item.marker.line,
          override_rejected: rejected,
        }, item.requestId ?? null, extra, join(item.stateDir, 'jev'));
      }
    }
  }
  if (!accepted) return;
  const rendered = JSON.stringify(output);
  for (const item of pending.slop) {
    if (item.action.to === 'none' || rendered.includes('[SLOP WARNING]')) {
      recordJevApplied('slop-warning', { action: item.action }, item.requestId ?? null,
        isJevLogContextEnabled(process.env) ? { tool_use_id: item.callId } : {});
    }
  }
}

function writeOutput(output, eventPayload, host = process.env.OMC_HOST) {
  if (isCodexInput(eventPayload, host)) {
    const codexOutput = { ...output };
    delete codexOutput.continue;
    delete codexOutput.suppressOutput;
    const hookOutput = codexOutput.hookSpecificOutput;
    if (
      hookOutput
      && typeof hookOutput === 'object'
      && hookOutput.updatedInput !== undefined
      && !hookOutput.permissionDecision
    ) {
      codexOutput.hookSpecificOutput = {
        ...hookOutput,
        permissionDecision: 'allow',
      };
    }
    if (Object.keys(codexOutput).length === 0) return;
    output = codexOutput;
  }
  process.stdout.write(`${JSON.stringify(output)}\n`);
}

function findAdapterFailure(result) {
  return result.evaluations.find(
    (evaluation) => evaluation.source === 'adapter',
  ) ?? result.reduction.callDecisions.find(
    (decision) => decision.source === 'adapter',
  );
}

function findCriticalCommitFailure(reduction, report) {
  const criticalIntentIds = new Set(
    reduction.stagedEffects.flatMap((effect) => {
      if (
        effect.critical !== true
        || !effect.payload
        || typeof effect.payload !== 'object'
        || typeof effect.payload.intentId !== 'string'
      ) {
        return [];
      }
      return [effect.payload.intentId];
    }),
  );

  return report.results.find(
    (result) =>
      result.status === 'failed'
      && (
        result.critical === true
        || criticalIntentIds.has(result.intentId)
      ),
  );
}

// With OMC_PLANNER_WRITE_GUARD=1, guarded agents may write only Markdown
// plans. Resolve the raw and normalized paths through every symlink.
const PLAN_WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const PLAN_WRITE_DIR = join('.omc', 'plans');
const PLAN_WRITE_PATH_FIELDS = ['file_path', 'filePath', 'notebook_path', 'path', 'file'];
const PLAN_WRITE_MAX_LINKS = 40;

function walkKernelPath(filePath, cwd, followLast = true) {
  try {
    const root = isAbsolute(filePath) ? parse(filePath).root : '';
    let current = realpathSync.native(root || cwd);
    let missing = 0;
    const parts = filePath.slice(root.length).split(process.platform === 'win32' ? /[\\/]+/ : /\/+/).filter((part) => part !== '' && part !== '.');
    for (const [index, part] of parts.entries()) {
      if (missing === 0 && !statSync(current).isDirectory()) return null;
      if (part === '..') {
        current = dirname(current);
        if (missing > 0) missing -= 1;
        continue;
      }
      const next = join(current, part);
      if (missing === 0) {
        try {
          lstatSync(next);
        } catch (error) {
          if (error?.code !== 'ENOENT') return null;
          missing = 1;
          current = next;
          continue;
        }
        current = followLast || index < parts.length - 1 ? realpathSync.native(next) : next;
      } else {
        missing += 1;
        current = next;
      }
    }
    return current;
  } catch {
    return null;
  }
}

function planEntryAllowed(entry, nativePlansDir) {
  let current = entry;
  for (let hop = 0; hop <= PLAN_WRITE_MAX_LINKS; hop += 1) {
    if (current === null) return false;
    const rel = relative(nativePlansDir, current);
    if (rel === '' || rel.split(sep)[0] === '..' || isAbsolute(rel) || !current.endsWith('.md')) return false;
    let stat;
    try {
      stat = lstatSync(current);
    } catch (error) {
      return hop === 0 && error?.code === 'ENOENT';
    }
    if (!stat.isSymbolicLink()) return stat.isFile();
    try {
      current = walkKernelPath(readlinkSync(current), dirname(current), false);
    } catch {
      return false;
    }
  }
  return false;
}

function planWritePathAllowed(filePath, cwd) {
  const plansDir = resolve(cwd, PLAN_WRITE_DIR);
  const target = resolve(cwd, filePath);
  const rel = relative(plansDir, target);
  if (rel === '' || rel.split(sep)[0] === '..' || isAbsolute(rel) || !rel.endsWith('.md')) return false;
  const nativePlansDir = walkKernelPath(plansDir, cwd);
  if (nativePlansDir === null) return false;
  return planEntryAllowed(walkKernelPath(filePath, cwd, false), nativePlansDir)
    && planEntryAllowed(walkKernelPath(target, cwd, false), nativePlansDir);
}

function evaluatePlanWriteGuard(toolName, data, directory, stateDir) {
  if (process.env.OMC_PLANNER_WRITE_GUARD !== '1' || !PLAN_WRITE_TOOLS.has(toolName)) return null;
  try {
    const configured = String(process.env.OMC_PLANNER_WRITE_GUARD_TYPES ?? '').split(',').map((name) => name.trim()).filter(Boolean);
    const guardedTypes = configured.length > 0 ? configured : ['oh-my-claudecode:planner'];
    const agentTypes = [data?.agent_type, data?.agentType, data?.agentName, ...(data?.agentTypeAliases ?? [])]
      .filter((value) => typeof value === 'string').map((value) => value.trim()).filter(Boolean);
    const agentType = agentTypes.find((name) => guardedTypes.includes(name)) ?? agentTypes[0] ?? '';
    let row;
    let reason = null;
    if (!agentType || !guardedTypes.includes(agentType)) {
      row = { agent_type: agentType ? agentType.slice(0, 200) : null, decision: 'allow', reason: agentType ? 'agent_type not guarded' : 'no agent_type' };
    } else {
      const filePaths = [data.tool_input, data.toolInput, ...(data.toolInputAliases ?? [])]
        .filter(isRecord)
        .flatMap((input) => PLAN_WRITE_PATH_FIELDS.map((field) => input[field]))
        .filter((value) => typeof value === 'string' && value.trim() !== '');
      if (filePaths.length === 0) return null;
      const cwd = typeof data.cwd === 'string' && data.cwd !== '' ? data.cwd : directory;
      const deniedPath = filePaths.find((candidate) => !planWritePathAllowed(candidate, cwd));
      const filePath = deniedPath ?? filePaths[0];
      row = { agent_type: agentType.slice(0, 200), path: filePath.slice(0, 300), decision: deniedPath === undefined ? 'allow' : 'deny' };
      if (deniedPath !== undefined) {
        reason = `[PLAN WRITE GUARD] The planner may write only Markdown files under ${PLAN_WRITE_DIR}${sep} (denied: "${filePath.slice(0, 200)}"). Write the plan to ${PLAN_WRITE_DIR}${sep}<name>.md instead.`;
      }
    }
    try {
      const logDir = process.env.OMC_JEV_LOG_DIR || join(stateDir, 'jev');
      mkdirSync(logDir, { recursive: true });
      const logPath = join(logDir, 'plan-write-guard.jsonl');
      rotateJevLog(logPath, resolveJevLogMaxBytes(process.env));
      appendFileSync(logPath, JSON.stringify({ ts: new Date().toISOString(), point: 'plan-write-guard', ...jevLogContextOf(data), tool_name: toolName, ...row }) + '\n', 'utf8');
    } catch { /* logging never affects the call */ }
    return reason;
  } catch {
    return null;
  }
}

async function main() {
  const skipHooks = (process.env.OMC_SKIP_HOOKS || '')
    .split(',')
    .map((value) => value.trim());
  if (
    process.env.DISABLE_OMC === '1'
    || skipHooks.includes('pre-tool-use')
  ) {
    writeOutput(
      process.env.OMC_HOST === 'copilot' ? {} : { continue: true },
    );
    return;
  }

  try {
    const input = await readStdin();
    const runtime = loadHookRuntime();
    const contextText = await loadContextText();
    let jevContextInitialized = false;
    let shellChecks;
    if (process.env.OMC_SHELL_CHECKS === '1') {
      try { shellChecks = await import('./lib/shell-checks.mjs'); } catch { /* fail open */ }
    }
    const shellContexts = [];
    const pending = { routing: [], slop: [] };
    const guardDenials = new Map();
    let plan;
    let processorFailure;

    const ensurePlan = (envelope) => {
      if (plan) return plan;
      if (processorFailure) throw processorFailure;

      try {
        const loadedSnapshot = runtime.loadPreToolBatchSnapshot(envelope, {
          pluginRoot: resolveHookPluginRoot(),
        });
        const rawGoal = loadedSnapshot.ultragoal.goal;
        const snapshot = contextText
          ? Object.freeze({
              ...loadedSnapshot,
              ultragoal: Object.freeze({
                ...loadedSnapshot.ultragoal,
                expectedObjective: contextText.cleanHostText(loadedSnapshot.ultragoal.expectedObjective, Infinity),
                ...(isRecord(rawGoal) ? {
                  goal: Object.freeze({
                    ...rawGoal,
                    ...(typeof rawGoal.objective === 'string'
                      ? { objective: contextText.cleanHostText(rawGoal.objective, Infinity) }
                      : {}),
                  }),
                } : {}),
              }),
            })
          : loadedSnapshot;
        for (const call of envelope.toolCalls.filter((candidate) => !candidate.malformed)) {
          const unit = { call, callId: call.id, originalIndex: call.originalIndex, input: call.input };
          const data = runtime.buildLegacyProcessorInput(envelope, unit);
          const guardData = {
            ...data,
            tool_input: call.input,
            toolInput: call.input,
            toolInputAliases: call.inputAliases,
            tool_use_id: call.id,
            agent_type: data.agentName,
            agentTypeAliases: envelope.agent?.nameAliases,
          };
          const reason = evaluatePlanWriteGuard(call.canonicalName, guardData, snapshot.directory, snapshot.stateDir)
            || (['Task', 'Agent'].includes(call.canonicalName)
              ? evaluateForbiddenAgentType(call.canonicalName, guardData, snapshot.stateDir)
              : null);
          if (reason) guardDenials.set(call.id, reason);
        }
        if (guardDenials.size > 0) {
          plan = runtime.planPreToolBatch(envelope, snapshot);
          return plan;
        }
        const permissionMode = envelope.eventPayload.permissionMode;
        const jevEnabled =
          isJevShadowOptedIn(
            'slop-warning',
            process.env,
            permissionMode,
          )
          || isJevShadowOptedIn(
            'model-routing',
            process.env,
            permissionMode,
          )
          || jevFlag('OMC_JEV_MODEL_ROUTING_MARKER')
          || jevFlag('OMC_JEV_MAX_EFFORT_ALWAYS');
        const modelRoutingOverrides = jevEnabled
          ? collectJevModelRoutingOverrides(
              runtime.planPreToolBatch(envelope, snapshot),
              runtime,
              pending,
            )
          : {};
        const reservation = runtime.reserveAndPlanPreToolBatch(
          envelope,
          snapshot,
          modelRoutingOverrides,
        );
        if (reservation.status !== 'planned') {
          throw new Error(
            `PreToolUse planning failed safely: ${reservation.reason}`,
          );
        }
        plan = reservation.plan;
        return plan;
      } catch (error) {
        processorFailure = error;
        throw error;
      }
    };

    const result = await runtime.runHookJson(
      'pre-tool-use',
      input,
      async (unit, envelope) => {
        if (!jevContextInitialized) {
          jevContextInitialized = true;
          const data = runtime.buildLegacyProcessorInput(envelope, unit);
          setJevSessionId(envelope.sessionId, envelope.agent?.id);
          await setJevHookContext({
            ...data,
            tool_use_id: envelope.toolCalls.length === 1 ? unit.call?.id : undefined,
            toolUseId: undefined,
            agent_id: envelope.agent?.id,
            agent_type: envelope.agent?.name,
          });
        }
        const currentPlan = ensurePlan(envelope);
        const evaluation = currentPlan.evaluations.find(
          (candidate) => candidate.callId === unit.callId,
        );
        if (!evaluation) {
          throw new Error(
            `PreToolUse planner omitted logical call "${unit.callId ?? '<uncorrelated>'}".`,
          );
        }
        if (guardDenials.size > 0) {
          const reason = guardDenials.get(unit.callId);
          return {
            ...evaluation,
            ...(reason ? { decision: 'deny', reason } : {}),
            mutation: undefined,
            contexts: [],
            effects: [],
          };
        }
        const call = unit.call;
        const shellName = call?.shellDialect === 'powershell'
          ? 'PowerShell' : call?.shellDialect === 'posix' ? 'Bash' : undefined;
        if (shellChecks && shellName) {
          try {
            const data = runtime.buildLegacyProcessorInput(envelope, unit);
            const verdict = shellChecks.runShellChecks(shellName, {
              ...data,
              tool_name: shellName,
              tool_input: unit.input,
              tool_use_id: call.id,
            }, { logDir: join(currentPlan.snapshot.stateDir, 'shell-checks') });
            if (verdict?.decision === 'deny' && verdict.reason) {
              return {
                ...evaluation,
                decision: 'deny',
                reason: verdict.reason,
                mutation: undefined,
                contexts: [],
              };
            }
            if (verdict?.context) {
              shellContexts.push(verdict.context);
              return { ...evaluation, contexts: [verdict.context, ...(evaluation.contexts ?? [])] };
            }
          } catch { /* checks are advisory on internal failure */ }
        }
        return evaluation;
      },
    );

    if (processorFailure) throw processorFailure;
    const adapterFailure = findAdapterFailure(result);
    if (adapterFailure) {
      throw new Error(
        adapterFailure.reason ?? 'PreToolUse processor failed safely.',
      );
    }

    const finalizedPlan = ensurePlan(result.envelope);
    const commitReport = await runtime.commitPreToolEffects(
      result.reduction.stagedEffects,
      result.reduction,
      undefined,
      {
        notificationChildEntrypointPath:
          resolveHookNotificationChildPath(),
        hookRuntimePath: resolveHookRuntimePath(),
      },
    );
    const criticalCommitFailure = findCriticalCommitFailure(
      result.reduction,
      commitReport,
    );
    if (criticalCommitFailure) {
      throw new Error(
        `Critical PreToolUse effect "${criticalCommitFailure.type}" failed`
        + ` for call "${criticalCommitFailure.callId}"`
        + (
          criticalCommitFailure.detail
            ? `: ${criticalCommitFailure.detail}`
            : '.'
        ),
      );
    }

    const finalized = runtime.finalizePreToolReduction(
      finalizedPlan,
      result.reduction,
      commitReport,
    );
    let output = runtime.encodePreToolEnforcerOutput(
      result.envelope,
      finalized,
    );
    if (result.envelope.host === 'claude' && shellContexts.length
      && (result.reduction.decision === 'pass' || result.reduction.decision === 'allow')) {
      const hookOutput = isRecord(output.hookSpecificOutput) ? output.hookSpecificOutput : {};
      const existingContext = typeof hookOutput.additionalContext === 'string' ? hookOutput.additionalContext : '';
      output.hookSpecificOutput = {
        ...hookOutput,
        hookEventName: 'PreToolUse',
        additionalContext: [...shellContexts.filter((context) => !existingContext.includes(context)), existingContext].filter(Boolean).join('\n\n'),
      };
      delete output.suppressOutput;
    }
    if (contextText) {
      const expected = finalizedPlan.snapshot.ultragoal.expectedObjective;
      const actual = finalizedPlan.snapshot.ultragoal.goal?.objective;
      const substitutions = typeof actual === 'string' && actual
        ? [[
            `current Claude /goal appears unrelated: "${actual}".`,
            `current Claude /goal appears unrelated: "${contextText.cleanHostText(actual)}".`,
          ]]
        : [];
      const options = { whole: expected ? [expected] : [], substitutions };
      output = contextText.cleanHookOutput(output, options);
      const flat = Object.fromEntries(
        ['additionalContext', 'permissionDecisionReason']
          .filter((field) => typeof output[field] === 'string')
          .map((field) => [field, output[field]]),
      );
      if (Object.keys(flat).length) {
        Object.assign(output, contextText.cleanHookOutput({ hookSpecificOutput: flat }, options).hookSpecificOutput);
      }
    }
    writeOutput(
      output,
      result.envelope.eventPayload,
      result.envelope.host,
    );
    recordAppliedDecisions(pending, output, result.reduction);
  } catch (error) {
    surfaceCriticalHookFailure(error, {
      hookName: 'pre-tool-enforcer',
    });
  }
}

void main();
