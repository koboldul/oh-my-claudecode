// Re-exports from model-contract.ts for backward compatibility
// and additional CLI detection utilities
export { isCliAvailable, validateCliAvailable, getContract, type CliAgentType } from './model-contract.js';
import { spawnSync } from 'child_process';
import { resolveCliBinaryPath } from './model-contract.js';

export interface CliInfo {
  available: boolean;
  runnable: boolean;
  version?: string;
  path?: string;
  error?: string;
}

const VERSION_PROBE_TIMEOUT_MS = 5000;

function firstOutputLine(output: unknown): string | undefined {
  return output
    ?.toString()
    .split(/\r?\n/)
    .map(line => line.trim())
    .find(Boolean);
}

function describeVersionProbeFailure(
  result: ReturnType<typeof spawnSync>,
): string {
  const probeError = result.error as NodeJS.ErrnoException | undefined;
  if (probeError?.code === 'ETIMEDOUT') {
    return `Version probe timed out after ${VERSION_PROBE_TIMEOUT_MS}ms.`;
  }
  if (probeError) {
    return `Version probe failed: ${probeError.message}`;
  }

  const stderr = firstOutputLine(result.stderr);
  if (typeof result.status === 'number') {
    return `Version probe exited with code ${result.status}${stderr ? `: ${stderr}` : '.'}`;
  }
  if (result.signal) {
    return `Version probe terminated by signal ${result.signal}.`;
  }
  return 'Version probe did not complete.';
}

export function detectCli(binary: string): CliInfo {
  let resolvedBinary: string;
  try {
    resolvedBinary = resolveCliBinaryPath(binary);
  } catch (error) {
    return {
      available: false,
      runnable: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  try {
    const versionResult = process.platform === 'win32' && /\.(cmd|bat)$/i.test(resolvedBinary)
      ? spawnSync(
          process.env.COMSPEC || 'cmd.exe',
          ['/d', '/c', resolvedBinary, '--version'],
          { timeout: VERSION_PROBE_TIMEOUT_MS },
        )
      : spawnSync(resolvedBinary, ['--version'], {
          timeout: VERSION_PROBE_TIMEOUT_MS,
          shell: false,
        });

    if (versionResult.status === 0) {
      const version = firstOutputLine(versionResult.stdout)
        ?? firstOutputLine(versionResult.stderr);
      return {
        available: true,
        runnable: true,
        path: resolvedBinary,
        ...(version
          ? { version }
          : { error: 'Version probe succeeded but returned no version output.' }),
      };
    }
    return {
      available: true,
      runnable: false,
      path: resolvedBinary,
      error: describeVersionProbeFailure(versionResult),
    };
  } catch (error) {
    return {
      available: true,
      runnable: false,
      path: resolvedBinary,
      error: `Version probe failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export function detectAllClis(): Record<string, CliInfo> {
  return {
    claude: detectCli('claude'),
    codex: detectCli('codex'),
    gemini: detectCli('gemini'),
    cursor: detectCli('cursor-agent'),
    grok: detectCli('grok'),
    antigravity: detectCli('agy'),
    copilot: detectCli('copilot'),
  };
}
