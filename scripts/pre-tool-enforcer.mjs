#!/usr/bin/env node

import {
  loadHookRuntime,
  resolveHookNotificationChildPath,
  resolveHookPluginRoot,
  resolveHookRuntimePath,
  surfaceCriticalHookFailure,
} from './lib/hook-runtime-loader.mjs';
import {
  isJevShadowOptedIn,
  recordJevShadow,
} from './lib/jev-shadow.mjs';
import { readStdin } from './lib/stdin.mjs';

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
    instructions: 'Which model tier should this delegated task use?',
    criteria: {
      haiku: 'Quick lookups and lightweight, mechanical work',
      sonnet: 'Standard coding and orchestration work',
      opus: 'Complex architecture and deep analysis',
    },
  },
};

const MODEL_ROUTING_METADATA_MAX_CHARS = 500;
const JEV_MODEL_TIERS = new Set(['haiku', 'sonnet', 'opus']);

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
    const key of ['description', 'prompt', 'subagent_type', 'model', 'resume']
  ) {
    if (typeof toolInput[key] === 'string') {
      bounded[key] = toolInput[key].slice(
        0,
        MODEL_ROUTING_METADATA_MAX_CHARS,
      );
    }
  }
  if (typeof toolInput.run_in_background === 'boolean') {
    bounded.run_in_background = toolInput.run_in_background;
  }
  return bounded;
}

function recordSlopWarningShadow(callPlan, permissionMode) {
  const warned = callPlan.jevObservations?.slopWarning;
  if (typeof warned !== 'boolean') return;
  const toolInput = isRecord(callPlan.call.input)
    ? callPlan.call.input
    : {};
  recordJevShadow({
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

function recordModelRoutingShadow(callPlan, permissionMode) {
  const observation = callPlan.jevObservations?.modelRouting;
  if (
    !observation
    || !isJevShadowOptedIn(
      'model-routing',
      process.env,
      permissionMode,
    )
  ) {
    return undefined;
  }

  const originalInput = boundModelRoutingInput(observation.originalInput);
  const modifiedInput = boundModelRoutingInput(observation.modifiedInput);
  const jevResult = recordJevShadow({
    point: 'model-routing',
    state: {
      tool_name: callPlan.call.canonicalName,
      subagent_type: originalInput.subagent_type || '',
      task: originalInput.prompt || '',
    },
    questions: MODEL_ROUTING_QUESTIONS,
    heuristic: {
      originalInput,
      modifiedInput,
      injected: observation.injected,
      model: observation.model,
    },
    permissionMode,
  });

  if (jevResult?.mode !== 'active') return undefined;
  const choice = jevResult.answer?.choice?.toLowerCase();
  return JEV_MODEL_TIERS.has(choice) ? choice : undefined;
}

function collectJevModelRoutingOverrides(plan, eventPayload) {
  const permissionMode = plan.envelope.eventPayload.permissionMode;
  const canApplyActiveChoice =
    plan.envelope.host === 'claude'
    && !isCodexInput(eventPayload, plan.envelope.host);
  const overrides = {};

  for (const callPlan of plan.calls) {
    const choice = recordModelRoutingShadow(callPlan, permissionMode);
    recordSlopWarningShadow(callPlan, permissionMode);
    if (canApplyActiveChoice && choice) {
      overrides[callPlan.call.id] = choice;
    }
  }
  return overrides;
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
          );
        const modelRoutingOverrides = jevEnabled
          ? collectJevModelRoutingOverrides(
              runtime.planPreToolBatch(envelope, snapshot),
              envelope.eventPayload,
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
    writeOutput(
      output,
      result.envelope.eventPayload,
      result.envelope.host,
    );
  } catch (error) {
    surfaceCriticalHookFailure(error, {
      hookName: 'pre-tool-enforcer',
    });
  }
}

void main();
