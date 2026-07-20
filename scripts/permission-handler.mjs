#!/usr/bin/env node
import {
  loadHookRuntime,
  surfaceCriticalHookFailure,
} from './lib/hook-runtime-loader.mjs';
import { readStdin } from './lib/stdin.mjs';

async function main() {
  try {
    const runtime = loadHookRuntime();
    const input = await readStdin();
    const { processPermissionRequest } = await import('../dist/hooks/permission-handler/index.js');
    if (typeof processPermissionRequest !== 'function') {
      throw new TypeError('Permission request processor export is unavailable.');
    }

    let processorFailed = false;
    let processorFailure;
    const result = await runtime.runHookJson(
      'permission-request',
      input,
      async (unit, envelope) => {
        try {
          return await processPermissionRequest(
            runtime.buildLegacyProcessorInput(envelope, unit),
          );
        } catch (error) {
          processorFailed = true;
          processorFailure = error;
          throw error;
        }
      },
    );

    if (processorFailed) {
      throw processorFailure;
    }
    const adapterFailure = result.evaluations.find(
      (evaluation) => evaluation.source === 'adapter',
    );
    if (adapterFailure) {
      throw new Error(
        adapterFailure.reason ?? 'Permission request processor failed.',
      );
    }

    const output = runtime.encodeHookOutput(
      result.envelope,
      result.reduction,
    );
    process.stdout.write(`${JSON.stringify(output)}\n`);
  } catch (error) {
    surfaceCriticalHookFailure(error, { hookName: 'permission-handler' });
  }
}

void main();
