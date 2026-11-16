#!/usr/bin/env node

import { appendFileSync, closeSync, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readSync } from 'node:fs';
import { basename, join } from 'node:path';
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
  jevNoulOf,
  recordJevApplied,
  recordJevShadow,
  setJevHookContext,
  setJevSessionId,
} from './lib/jev-shadow.mjs';
import { readStdin } from './lib/stdin.mjs';
import { resolveExcerptChars, resolveJevLogMaxBytes, rotateJevLog } from './jev-resolve.mjs';

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

function readAgentField(agentType, directory, field, pluginFirst = false, pluginOnly = false) {
  if (typeof agentType !== 'string') return null;
  const bare = agentType.replace(/^oh-my-claudecode:/, '');
  if (!/^[a-zA-Z0-9_-]+$/.test(bare)) return null;
  const pluginRoots = [process.env.CLAUDE_PLUGIN_ROOT, resolveHookPluginRoot()].filter(Boolean);
  const nativeDirs = /^[a-zA-Z0-9_-]+$/.test(agentType)
    ? [join(directory, '.claude', 'agents'), join(getClaudeConfigDir(), 'agents')] : [];
  const pluginDirs = pluginRoots.map((root) => join(root, 'agents'));
  const dirs = pluginOnly ? pluginDirs : pluginFirst ? [...pluginDirs, ...nativeDirs] : [...nativeDirs, ...pluginDirs];
  for (const dir of dirs) {
    const path = join(dir, `${bare}.md`);
    if (!existsSync(path)) continue;
    try {
      const frontmatter = readFileSync(path, 'utf8').replace(/^\uFEFF/, '').match(/^---[\r\n]+([\s\S]*?)[\r\n]+---/);
      const match = frontmatter?.[1].match(new RegExp(`^${field}:\\s*(\\S+)`, 'm'));
      if (match) return match[1].trim().replace(/^["']|["']$/g, '');
    } catch { /* use the next candidate when resolving native models */ }
    if (!pluginFirst || pluginOnly) return null;
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
  });
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
    if (['Task', 'Agent'].includes(call.canonicalName) && isRecord(call.input)
      && (isJevShadowOptedIn('model-routing', process.env, permissionMode)
        || jevFlag('OMC_JEV_MODEL_ROUTING_MARKER')
        || jevFlag('OMC_JEV_MAX_EFFORT_ALWAYS'))) {
      const observation = callPlan.jevObservations?.modelRouting;
      const modified = observation?.modifiedInput
        ?? (isRecord(callPlan.evaluation.mutation?.input) ? callPlan.evaluation.mutation.input : input);
      const directory = plan.snapshot.directory || process.cwd();
      const definitionModel = readAgentField(input.subagent_type, directory, 'model', true, true);
      let marker = canApplyActiveChoice && jevFlag('OMC_JEV_MODEL_ROUTING_MARKER')
        ? parseModelRoutingMarker(input.prompt) : null;
      const safeTier = (tier) => !plan.snapshot.modelRouting.forceInherit
        || !runtime.evaluateModelRouting({ ...call, input: { ...input, model: tier } }, plan.envelope, plan.snapshot).denyReason;
      if (marker?.model && !safeTier(marker.model)) {
        marker.rejected.push('force-inherit');
        marker.model = undefined;
      }
      const markerApplies = Boolean(marker && (marker.model || marker.effort));
      const original = boundModelRoutingInput(markerApplies ? { ...input, prompt: marker.prompt } : input);
      const selectedModel = marker?.model || modified.model || definitionModel;
      const normalizedModel = typeof selectedModel === 'string'
        ? [...JEV_MODEL_TIERS].find((tier) => selectedModel.toLowerCase().includes(tier)) : undefined;
      const knownTier = normalizedModel && (normalizedModel !== 'fable' || jevFlag('OMC_JEV_MODEL_ROUTING_FABLE'));
      const nativeModel = selectedModel || readAgentField(input.subagent_type, directory, 'model', true);
      const unpinned = !knownTier && jevFlag('OMC_JEV_MODEL_ROUTING_ALL_AGENTS')
        && (!nativeModel || String(nativeModel).trim().toLowerCase() === 'inherit');
      const questions = modelRoutingQuestions();
      if (marker?.model) delete questions['model-tier'];
      if (marker?.effort) delete questions.effort;
      const askJev = isJevShadowOptedIn('model-routing', process.env, permissionMode)
        && (knownTier || unpinned) && Object.keys(questions).length > 0;
      let result;
      if (askJev) {
        const context = {};
        if (jevFlag('OMC_JEV_MODEL_ROUTING_CONTEXT')) {
          context.description = original.description || '';
          const parent = readParentLastUserMessage(plan.envelope.transcriptPath, plan.envelope.sessionId);
          if (parent) context.parent_last_user_message = parent;
        }
        result = recordJevShadow({
          point: 'model-routing',
          state: {
            tool_name: call.nativeName,
            subagent_type: original.subagent_type || '',
            task: original.prompt || '',
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
        });
      }
      const answers = result?.mode === 'active' ? result.answers : undefined;
      if (canApplyActiveChoice && answers && typeof answers === 'object') {
        const tierChoice = answers['model-tier']?.choice;
        const choice = typeof tierChoice === 'string' ? tierChoice.toLowerCase() : undefined;
        if (choice && JEV_MODEL_TIERS.has(choice)
          && (choice !== 'fable' || jevFlag('OMC_JEV_MODEL_ROUTING_FABLE'))
          && safeTier(choice)) override.model = choice;
        const score = answers.effort?.type === 'score' ? answers.effort.score : undefined;
        if (typeof score === 'number' && Number.isFinite(score) && score >= 0 && score <= 4) {
          override.effort = effortFromScore(score);
        } else if (typeof modified.effort === 'string') {
          const capped = capEffort(modified.effort);
          if (capped !== modified.effort) override.effort = capped;
        }
        pending.routing.push({ callId: call.id, input, modified, selectedModel, normalizedModel, unpinned, answers, override: { ...override }, directory });
      }
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
      }
      if (canApplyActiveChoice && jevFlag('OMC_JEV_MAX_EFFORT_ALWAYS')) {
        const effort = override.effort ?? modified.effort;
        if (typeof effort === 'string') {
          const capped = capEffort(effort);
          if (capped !== effort) override.effort = capped;
        }
      }
    }

    const slopResult = recordSlopWarningShadow(callPlan, permissionMode);
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
          pending.slop.push({ callId: call.id, action: { from: warned ? 'none' : 'warn', to: warned ? 'warn' : 'none', noul } });
        }
      }
    }
    if (Object.keys(override).length) overrides[call.id] = override;
  }
  return overrides;
}

function recordAppliedDecisions(pending, output, reduction) {
  if (reduction.decision !== 'pass' && reduction.decision !== 'allow') return;
  const sent = output?.hookSpecificOutput?.updatedInput;
  if (isRecord(sent) && isJevAppliedLogEnabled()) {
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
      const choice = item.answers['model-tier']?.choice;
      const baselineModel = item.unpinned
        ? process.env.CLAUDE_MODEL || process.env.ANTHROPIC_MODEL || item.modified.model
        : item.selectedModel || item.modified.model;
      if (typeof choice === 'string' && item.override.model === choice.toLowerCase()
        && sent.model === item.override.model
        && resolvedModel(sent.model) !== resolvedModel(baselineModel)) {
        applied.model = { from: baselineModel ?? null, to: sent.model };
      }
      const score = item.answers.effort?.type === 'score' ? item.answers.effort.score : undefined;
      const explicitEffort = typeof item.modified.effort === 'string' && jevFlag('OMC_JEV_MAX_EFFORT_ALWAYS')
        ? capEffort(item.modified.effort) : item.modified.effort;
      const baselineEffort = explicitEffort
        || readAgentField(item.input.subagent_type, item.directory, 'effort')
        || process.env.CLAUDE_CODE_EFFORT_LEVEL;
      if (typeof score === 'number' && Number.isFinite(score) && score >= 0 && score <= 4
        && item.override.effort === sent.effort && sent.effort !== baselineEffort) {
        applied.effort = { from: baselineEffort ?? null, to: sent.effort, score };
      }
      if (applied.model || applied.effort) {
        recordJevApplied('model-routing', { subagent_type: item.input.subagent_type || null, ...applied });
      }
    }
  }
  const rendered = JSON.stringify(output);
  for (const item of pending.slop) {
    if (item.action.to === 'none' || rendered.includes('[SLOP WARNING]')) {
      recordJevApplied('slop-warning', { action: item.action });
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
    try {
      const data = JSON.parse(input);
      setJevSessionId(data.session_id || data.sessionId, data.agent_id || data.agentId);
      await setJevHookContext(data);
    } catch { /* canonical input handling below owns malformed input */ }
    let shellChecks;
    if (process.env.OMC_SHELL_CHECKS === '1') {
      try { shellChecks = await import('./lib/shell-checks.mjs'); } catch { /* fail open */ }
    }
    const shellContexts = [];
    const pending = { routing: [], slop: [] };
    let plan;
    let processorFailure;

    const ensurePlan = (envelope) => {
      if (plan) return plan;
      if (processorFailure) throw processorFailure;

      try {
        const snapshot = runtime.loadPreToolBatchSnapshot(envelope, {
          pluginRoot: resolveHookPluginRoot(),
        });
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
      (unit, envelope) => {
        const currentPlan = ensurePlan(envelope);
        const evaluation = currentPlan.evaluations.find(
          (candidate) => candidate.callId === unit.callId,
        );
        if (!evaluation) {
          throw new Error(
            `PreToolUse planner omitted logical call "${unit.callId ?? '<uncorrelated>'}".`,
          );
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
    const output = runtime.encodePreToolEnforcerOutput(
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
