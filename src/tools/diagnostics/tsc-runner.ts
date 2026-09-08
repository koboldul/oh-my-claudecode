/**
 * TypeScript Compiler Diagnostics Runner
 *
 * Executes `tsc --noEmit` to get project-level type checking diagnostics.
 */

import { execFile, type ExecFileException } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';

export interface TscDiagnostic {
  file: string;
  line: number;
  column: number;
  code: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface TscResult {
  success: boolean;
  diagnostics: TscDiagnostic[];
  errorCount: number;
  warningCount: number;
}

/**
 * Hard upper bound for a single `tsc --noEmit` run.
 *
 * The runner is async so the event loop stays responsive, but a wedged compiler
 * still has to be reaped — otherwise the caller's promise never settles.
 */
export const TSC_TIMEOUT_MS = 120_000;

/** Max stdout/stderr captured from tsc (large monorepos emit a lot of text). */
const TSC_MAX_BUFFER_BYTES = 32 * 1024 * 1024;

/** Diagnostic code used for the synthetic "tsc was killed" diagnostic. */
export const TSC_TIMEOUT_CODE = 'OMC-TSC-TIMEOUT';

/** Diagnostic code used when tsc cannot produce parseable diagnostics. */
export const TSC_EXECUTION_ERROR_CODE = 'OMC-TSC-EXEC';

interface TscExecOutcome {
  error: ExecFileException | null;
  stdout: string;
  stderr: string;
}

/**
 * Run TypeScript compiler diagnostics on a directory.
 *
 * Non-blocking: uses async `execFile` so a long compile never stalls the
 * single-threaded MCP event loop.
 *
 * @param directory - Project directory containing tsconfig.json
 * @returns Result with diagnostics, error count, and warning count
 */
export async function runTscDiagnostics(directory: string): Promise<TscResult> {
  const tsconfigPath = join(directory, 'tsconfig.json');

  if (!existsSync(tsconfigPath)) {
    return {
      success: true,
      diagnostics: [],
      errorCount: 0,
      warningCount: 0
    };
  }

  const outcome = await execTsc(directory);
  const output = combineOutput(outcome.stdout, outcome.stderr);

  if (isTimedOut(outcome.error)) {
    return timeoutResult(directory);
  }

  const parsed = parseTscOutput(output, directory);
  if (!outcome.error || parsed.diagnostics.length > 0) {
    return outcome.error ? { ...parsed, success: false } : parsed;
  }

  return executionFailureResult(directory, outcome.error, output);
}

function execTsc(directory: string): Promise<TscExecOutcome> {
  return new Promise<TscExecOutcome>(settle => {
    execFile(
      'tsc',
      ['--noEmit', '--pretty', 'false'],
      {
        cwd: directory,
        encoding: 'utf-8',
        timeout: TSC_TIMEOUT_MS,
        killSignal: 'SIGKILL',
        maxBuffer: TSC_MAX_BUFFER_BYTES,
        windowsHide: true
      },
      (error, stdout, stderr) => {
        settle({
          error,
          stdout,
          stderr
        });
      }
    );
  });
}

function combineOutput(...values: string[]): string {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))].join('\n');
}

function isTimedOut(error: ExecFileException | null): boolean {
  return Boolean(
    error &&
    error.code !== 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' &&
    error.killed === true
  );
}

/**
 * Synthetic diagnostic emitted when tsc had to be killed, so callers surface a
 * visible failure instead of a silent "0 errors" pass.
 */
function timeoutResult(directory: string): TscResult {
  return {
    success: false,
    diagnostics: [
      {
        file: join(directory, 'tsconfig.json'),
        line: 1,
        column: 1,
        severity: 'error',
        code: TSC_TIMEOUT_CODE,
        message: `TypeScript check timed out after ${TSC_TIMEOUT_MS}ms and was terminated. Re-run 'tsc --noEmit' manually or check a smaller directory.`
      }
    ],
    errorCount: 1,
    warningCount: 0
  };
}

function executionFailureResult(
  directory: string,
  error: ExecFileException,
  output: string
): TscResult {
  const detail = output.split(/\r?\n/, 1)[0]?.trim() || error.message;
  return {
    success: false,
    diagnostics: [
      {
        file: join(directory, 'tsconfig.json'),
        line: 1,
        column: 1,
        severity: 'error',
        code: TSC_EXECUTION_ERROR_CODE,
        message: `TypeScript check could not complete: ${detail}`
      }
    ],
    errorCount: 1,
    warningCount: 0
  };
}

/**
 * Parse TypeScript compiler output into structured diagnostics
 * Format: file(line,col): error TS1234: message
 */
function parseTscOutput(output: string, directory: string): TscResult {
  const diagnostics: TscDiagnostic[] = [];

  // Parse tsc output format: file(line,col): error TS1234: message
  const regex = /^(.+)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.+)$/gm;
  let match;

  while ((match = regex.exec(output)) !== null) {
    diagnostics.push({
      file: match[1],
      line: parseInt(match[2], 10),
      column: parseInt(match[3], 10),
      severity: match[4] as 'error' | 'warning',
      code: match[5],
      message: match[6]
    });
  }

  // Some configuration errors are not associated with a source file.
  const globalRegex = /^(error|warning)\s+(TS\d+):\s+(.+)$/gm;
  while ((match = globalRegex.exec(output)) !== null) {
    diagnostics.push({
      file: join(directory, 'tsconfig.json'),
      line: 1,
      column: 1,
      severity: match[1] as 'error' | 'warning',
      code: match[2],
      message: match[3]
    });
  }

  const errorCount = diagnostics.filter(d => d.severity === 'error').length;
  const warningCount = diagnostics.filter(d => d.severity === 'warning').length;

  return {
    success: errorCount === 0,
    diagnostics,
    errorCount,
    warningCount
  };
}
