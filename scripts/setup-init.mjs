#!/usr/bin/env node
import { loadHookRuntime } from './lib/hook-runtime-loader.mjs';
import { readStdin } from './lib/stdin.mjs';

function canonicalFailureReason(result) {
  const normalizationFailure = result.envelope.issues.find(
    (issue) => issue.severity === 'safety' || issue.batchSafety === true,
  );
  if (normalizationFailure) {
    return normalizationFailure.message;
  }

  const adapterFailure = result.evaluations.find(
    (evaluation) => evaluation.source === 'adapter',
  ) ?? result.reduction.callDecisions.find(
    (decision) => decision.source === 'adapter',
  );
  if (adapterFailure) {
    return adapterFailure.reason ?? 'Setup init adapter failed safely.';
  }

  if (result.reduction.decision !== 'pass') {
    return result.reduction.reason
      ?? `Unexpected ${result.reduction.decision} setup init reduction.`;
  }

  return undefined;
}

async function main() {
  // Read stdin (timeout-protected, see issue #240/#459)
  const input = await readStdin();

  try {
    const data = JSON.parse(input);
    const runtime = loadHookRuntime();
    const { processSetup } = await import('../dist/hooks/setup/index.js');
    const result = await runtime.runHookPayload(
      'setup-init',
      data,
      (unit, envelope) => {
        const legacyInput = runtime.buildLegacyProcessorInput(envelope, unit);
        return processSetup({
          ...legacyInput,
          session_id: legacyInput.sessionId,
          transcript_path: legacyInput.transcriptPath,
          cwd: legacyInput.directory,
          permission_mode: legacyInput.permissionMode ?? 'default',
          hook_event_name: 'Setup',
          trigger: 'init',
        });
      },
    );
    const failure = canonicalFailureReason(result);
    if (failure) {
      throw new Error(failure);
    }

    console.log(JSON.stringify(
      runtime.encodeHookOutput(result.envelope, result.reduction),
    ));
  } catch (error) {
    console.error('[setup-init] Error:', error.message);
    console.log(JSON.stringify({ continue: true, suppressOutput: true }));
  }
}

void main();
