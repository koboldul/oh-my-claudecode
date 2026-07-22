#!/usr/bin/env node

/**
 * PostToolUse Hook: Project Memory Learning
 * Learns from tool outputs and updates project memory
 */

import { readStdin } from './lib/stdin.mjs';
import {
  loadHookRuntime,
  surfaceOptionalHookFailure,
} from './lib/hook-runtime-loader.mjs';

function describeCanonicalFailure(result) {
  const failures = [];

  for (const issue of result?.envelope?.issues ?? []) {
    if (issue?.severity === 'safety' || issue?.batchSafety === true) {
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

async function processProjectMemoryPostTool(
  data,
  learnFromToolOutput,
  findProjectRoot,
) {
  const directory = data.directory || process.cwd();
  const projectRoot = findProjectRoot(directory);

  if (projectRoot) {
    await learnFromToolOutput(
      data.toolName || '',
      data.toolInput || {},
      data.toolOutput ?? '',
      projectRoot,
    );
  }

  return {
    continue: true,
    suppressOutput: true,
  };
}

/**
 * Main hook execution
 */
async function main() {
  try {
    const runtime = loadHookRuntime();
    const [
      { learnFromToolOutput },
      { findProjectRoot },
    ] = await Promise.all([
      import('../dist/hooks/project-memory/learner.js'),
      import('../dist/hooks/rules-injector/finder.js'),
    ]);
    if (typeof learnFromToolOutput !== 'function') {
      throw new TypeError('Project memory learner export is unavailable.');
    }
    if (typeof findProjectRoot !== 'function') {
      throw new TypeError('Project root finder export is unavailable.');
    }

    const input = await readStdin();
    const result = await runtime.runHookJson(
      'post-tool-use',
      input,
      (unit, envelope) => processProjectMemoryPostTool(
        runtime.buildLegacyProcessorInput(envelope, unit),
        learnFromToolOutput,
        findProjectRoot,
      ),
    );

    const canonicalFailure = describeCanonicalFailure(result);
    if (canonicalFailure) {
      surfaceOptionalHookFailure(
        new Error(canonicalFailure),
        { hookName: 'project-memory-posttool' },
      );
      return;
    }

    const encoded = runtime.encodeHookOutput(result.envelope, result.reduction);
    const output =
      result.envelope.host === 'claude' && Object.keys(encoded).length === 0
        ? { continue: true, suppressOutput: true }
        : encoded;
    console.log(JSON.stringify(output));
  } catch (error) {
    surfaceOptionalHookFailure(error, { hookName: 'project-memory-posttool' });
  }
}

main();
