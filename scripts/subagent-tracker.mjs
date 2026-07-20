#!/usr/bin/env node
import { readStdin } from './lib/stdin.mjs';
import {
  loadHookRuntime,
  surfaceOptionalHookFailure,
} from './lib/hook-runtime-loader.mjs';

function shouldSkipSubagentTracker(action) {
  if (process.env.DISABLE_OMC === '1' || process.env.DISABLE_OMC === 'true') {
    return true;
  }

  const skipHooks = (process.env.OMC_SKIP_HOOKS || '')
    .split(',')
    .map((hook) => hook.trim())
    .filter(Boolean);
  const hookName = action === 'start' ? 'subagent-start' : action === 'stop' ? 'subagent-stop' : 'subagent-tracker';

  return skipHooks.includes(hookName) || skipHooks.includes('subagent-tracker');
}

function describeCanonicalFailure(result) {
  const failures = [];

  for (const issue of result?.envelope?.issues ?? []) {
    if (issue?.severity === 'safety' || issue?.severity === 'batch-safety') {
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

async function main() {
  const action = process.argv[2]; // 'start' or 'stop'

  if (shouldSkipSubagentTracker(action)) {
    console.log(JSON.stringify({ continue: true, suppressOutput: true }));
    return;
  }

  const hookType =
    action === 'start'
      ? 'subagent-start'
      : action === 'stop'
        ? 'subagent-stop'
        : undefined;
  if (!hookType) {
    surfaceOptionalHookFailure(
      new Error(`Unknown action: ${String(action)}`),
      { hookName: 'subagent-tracker' },
    );
    return;
  }

  try {
    const runtime = loadHookRuntime();
    const { processSubagentStart, processSubagentStop } = await import('../dist/hooks/subagent-tracker/index.js');
    const input = await readStdin();
    const result = await runtime.runHookJson(
      hookType,
      input,
      (unit, envelope) => {
        const processorInput = runtime.buildLegacyProcessorInput(envelope, unit);
        const deliveryReceipt = process.env.OMC_HOOK_DELIVERY_RECEIPT?.trim();
        if (deliveryReceipt) {
          processorInput.deliveryReceipt = deliveryReceipt;
        }
        return action === 'start'
          ? processSubagentStart(processorInput)
          : processSubagentStop(processorInput);
      },
    );

    const canonicalFailure = describeCanonicalFailure(result);
    if (canonicalFailure) {
      surfaceOptionalHookFailure(
        new Error(canonicalFailure),
        { hookName: `subagent-${action}` },
      );
      return;
    }

    console.log(JSON.stringify(
      runtime.encodeHookOutput(result.envelope, result.reduction),
    ));
  } catch (error) {
    surfaceOptionalHookFailure(error, { hookName: `subagent-${action}` });
  }
}

main();
