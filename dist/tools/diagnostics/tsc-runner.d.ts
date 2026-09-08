/**
 * TypeScript Compiler Diagnostics Runner
 *
 * Executes `tsc --noEmit` to get project-level type checking diagnostics.
 */
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
export declare const TSC_TIMEOUT_MS = 120000;
/** Diagnostic code used for the synthetic "tsc was killed" diagnostic. */
export declare const TSC_TIMEOUT_CODE = "OMC-TSC-TIMEOUT";
/** Diagnostic code used when tsc cannot produce parseable diagnostics. */
export declare const TSC_EXECUTION_ERROR_CODE = "OMC-TSC-EXEC";
/**
 * Run TypeScript compiler diagnostics on a directory.
 *
 * Non-blocking: uses async `execFile` so a long compile never stalls the
 * single-threaded MCP event loop.
 *
 * @param directory - Project directory containing tsconfig.json
 * @returns Result with diagnostics, error count, and warning count
 */
export declare function runTscDiagnostics(directory: string): Promise<TscResult>;
//# sourceMappingURL=tsc-runner.d.ts.map