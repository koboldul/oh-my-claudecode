#!/usr/bin/env node
import { readStdin } from './lib/stdin.mjs';
import {
  describeHookRunFailure,
  encodeLegacyCompatibleHookOutput,
  loadHookRuntime,
  surfaceOptionalHookFailure,
} from './lib/hook-runtime-loader.mjs';
import { loadContextText } from './lib/context-text-loader.mjs';

// Opt-in text cleaning (OMC_CONTEXT_TEXT_SANITIZE=1 or true): the wiki page metadata is cleaned before it is written. The
// categories in it are identifiers (the model passes them to wiki_list), so they are written exactly, and the text around
// them is cleaned (see cleanTextBlockKeeping). The module is loaded only when the switch is on; with the switch off the
// text is written unchanged.
async function main() {
  try {
    const runtime = loadHookRuntime();
    const { onPreCompact } = await import('../dist/hooks/wiki/session-hooks.js');
    const input = await readStdin(1000);
    if (!input.trim()) {
      console.log(JSON.stringify({ continue: true, suppressOutput: true }));
      return;
    }

    let legacyOutput;
    const result = await runtime.runHookJson(
      'pre-compact',
      input,
      async (unit, envelope) => {
        const data = runtime.buildLegacyProcessorInput(envelope, unit);
        const processorResult = onPreCompact(data);
        const sanitize = processorResult.additionalContext
          ? await loadContextText()
          : null;
        let categories = [];
        if (sanitize) {
          try {
            categories = (await import('../dist/hooks/wiki/storage.js'))
              .readAllPages(data.cwd || process.cwd())
              .map((page) => page.frontmatter.category);
          } catch {
            // The categories are not known: the text is cleaned as a whole.
          }
        }
        legacyOutput = processorResult.additionalContext
          ? {
              continue: true,
              systemMessage: sanitize
                ? sanitize.cleanTextBlockKeeping(processorResult.additionalContext, categories)
                : processorResult.additionalContext,
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
    surfaceOptionalHookFailure(error, { hookName: 'wiki-pre-compact' });
  }
}

void main();
