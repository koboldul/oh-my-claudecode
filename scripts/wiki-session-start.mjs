#!/usr/bin/env node
import { readStdin } from './lib/stdin.mjs';
import {
  describeHookRunFailure,
  encodeLegacyCompatibleHookOutput,
  loadHookRuntime,
  surfaceOptionalHookFailure,
} from './lib/hook-runtime-loader.mjs';
import { loadContextText } from './lib/context-text-loader.mjs';

// Opt-in text cleaning (OMC_CONTEXT_TEXT_SANITIZE=1 or true): the wiki index text is cleaned before it is injected. The page
// files named in the index (the model passes them to wiki_read) and the categories in its "## category" headings (the model
// passes them to wiki_list) are identifiers, so they are written exactly, and the text around them is cleaned (see
// cleanTextBlockKeeping). The module is loaded only when the switch is on; with the switch off the text is injected unchanged.
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
      async (unit, envelope) => {
        const data = runtime.buildLegacyProcessorInput(envelope, unit);
        const processorResult = onSessionStart(data);
        const sanitize = processorResult.additionalContext
          ? await loadContextText()
          : null;
        let names = [];
        if (sanitize) {
          names = processorResult.additionalContext.split('\n')
            .filter((line) => line.startsWith('## '))
            .map((line) => line.slice('## '.length));
          try {
            names.push(...(await import('../dist/hooks/wiki/storage.js')).listPages(data.cwd || process.cwd()));
          } catch {
            // The page files are not known: they are cleaned with the rest of the text.
          }
        }
        legacyOutput = processorResult.additionalContext
          ? {
              continue: true,
              hookSpecificOutput: {
                hookEventName: 'SessionStart',
                additionalContext: sanitize
                  ? sanitize.cleanTextBlockKeeping(processorResult.additionalContext, names)
                  : processorResult.additionalContext,
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
