#!/usr/bin/env node

/**
 * PostToolUse Hook: Directory Context Injector (issue #4006 finding 1)
 *
 * Injects the nearest README.md / AGENTS.md files, walking up from the
 * accessed file to the working directory root, into context when a host
 * reads or edits a file.
 */

import { isAbsolute, join } from 'path';
import { pathToFileURL } from 'url';
import { readStdin } from './lib/stdin.mjs';
import {
  describeHookRunFailure,
  encodeLegacyCompatibleHookOutput,
  loadHookRuntime,
  resolveHookPluginRoot,
  surfaceOptionalHookFailure,
} from './lib/hook-runtime-loader.mjs';

const SKIP_HOOKS = (process.env.OMC_SKIP_HOOKS || '')
  .split(',')
  .map((value) => value.trim());
const HOOK_DISABLED =
  process.env.DISABLE_OMC === '1'
  || process.env.DISABLE_OMC === 'true'
  || SKIP_HOOKS.includes('post-tool-use');

let createDirectoryReadmeInjectorHook = null;
try {
  const moduleUrl = pathToFileURL(join(
    resolveHookPluginRoot(),
    'dist',
    'hooks',
    'directory-readme-injector',
    'index.js',
  )).href;
  const module = await import(moduleUrl);
  createDirectoryReadmeInjectorHook =
    module.createDirectoryReadmeInjectorHook;
} catch {
  // dist is optional on a first development run.
}

function extractFilePath(toolInput) {
  if (!toolInput || typeof toolInput !== 'object') return null;
  return toolInput.file_path || toolInput.path || null;
}

function processDirectoryContext(data) {
  if (HOOK_DISABLED) {
    return { continue: true };
  }
  if (!createDirectoryReadmeInjectorHook) {
    return { continue: true, suppressOutput: true };
  }

  const toolName = data.toolName || '';
  const toolInput = data.toolInput || {};
  const sessionId = data.sessionId || 'unknown';
  const cwd = data.directory || process.cwd();
  const rawPath = extractFilePath(toolInput);
  if (typeof rawPath !== 'string' || rawPath.length === 0) {
    return { continue: true, suppressOutput: true };
  }

  const filePath = isAbsolute(rawPath) ? rawPath : join(cwd, rawPath);
  const hook = createDirectoryReadmeInjectorHook(cwd);
  const contextText = hook.processToolExecution(
    toolName,
    filePath,
    sessionId,
  );

  if (!contextText) {
    return { continue: true, suppressOutput: true };
  }

  return {
    continue: true,
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: contextText,
    },
  };
}

async function main() {
  try {
    const input = await readStdin();
    if (!input.trim()) {
      console.log(JSON.stringify({ continue: true }));
      return;
    }

    const runtime = loadHookRuntime();
    let legacyOutput;
    const result = await runtime.runHookJson(
      'post-tool-use',
      input,
      (unit, envelope) => {
        legacyOutput = processDirectoryContext(
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
      hookName: 'post-tool-directory-context-injector',
    });
  }
}

void main();
