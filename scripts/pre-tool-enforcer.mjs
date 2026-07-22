#!/usr/bin/env node

import {
  loadHookRuntime,
  resolveHookNotificationChildPath,
  resolveHookRuntimePath,
  surfaceCriticalHookFailure,
} from './lib/hook-runtime-loader.mjs';
import { readStdin } from './lib/stdin.mjs';

function writeOutput(output) {
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
    writeOutput({ continue: true });
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
        const snapshot = runtime.loadPreToolBatchSnapshot(envelope);
        const reservation = runtime.reserveAndPlanPreToolBatch(
          envelope,
          snapshot,
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
    writeOutput(output);
  } catch (error) {
    surfaceCriticalHookFailure(error, {
      hookName: 'pre-tool-enforcer',
    });
  }
}

void main();
