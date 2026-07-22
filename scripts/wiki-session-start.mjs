#!/usr/bin/env node
import { readStdin } from './lib/stdin.mjs';
import {
  describeHookRunFailure,
  encodeLegacyCompatibleHookOutput,
  loadHookRuntime,
  surfaceOptionalHookFailure,
} from './lib/hook-runtime-loader.mjs';

async function main() {
  try {
    const runtime = loadHookRuntime();
    const { onSessionStart } = await import('../dist/hooks/wiki/session-hooks.js');
    const input = await readStdin(1000);
    if (!input.trim()) {
      console.log(JSON.stringify({ continue: true, suppressOutput: true }));
      return;
    }

    let legacyOutput;
    const result = await runtime.runHookJson(
      'session-start',
      input,
      (unit, envelope) => {
        const processorResult = onSessionStart(
          runtime.buildLegacyProcessorInput(envelope, unit),
        );
        legacyOutput = processorResult.additionalContext
          ? {
              continue: true,
              hookSpecificOutput: {
                hookEventName: 'SessionStart',
                additionalContext: processorResult.additionalContext,
              },
            }
          : { continue: true, suppressOutput: true };
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
    surfaceOptionalHookFailure(error, { hookName: 'wiki-session-start' });
  }
}

void main();
