#!/usr/bin/env node

/**
 * PreCompact Hook: Project Memory Preservation
 * Ensures user directives and project context survive compaction
 */

import { readStdin } from './lib/stdin.mjs';
import {
  describeHookRunFailure,
  encodeLegacyCompatibleHookOutput,
  loadHookRuntime,
  surfaceOptionalHookFailure,
} from './lib/hook-runtime-loader.mjs';

/**
 * Main hook execution
 */
async function main() {
  try {
    const runtime = loadHookRuntime();
    const { processPreCompact } = await import(
      '../dist/hooks/project-memory/pre-compact.js'
    );
    const input = await readStdin();
    if (!input.trim()) {
      console.log(JSON.stringify({
        continue: true,
        suppressOutput: true,
      }));
      return;
    }

    let legacyOutput;
    const result = await runtime.runHookJson(
      'pre-compact',
      input,
      async (unit, envelope) => {
        legacyOutput = await processPreCompact(
          runtime.buildLegacyProcessorInput(envelope, unit),
        );
        return legacyOutput;
      },
    );

    const failure = describeHookRunFailure(runtime, result);
    if (failure) throw new Error(failure);

    console.log(JSON.stringify(
      encodeLegacyCompatibleHookOutput(
        runtime,
        result,
        legacyOutput,
      ),
    ));
  } catch (error) {
    surfaceOptionalHookFailure(error, {
      hookName: 'project-memory-precompact',
    });
  }
}

void main();
