import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
const { execFileMock, execFileSyncMock } = vi.hoisted(() => ({
    execFileMock: vi.fn(),
    execFileSyncMock: vi.fn(),
}));
vi.mock('child_process', () => ({
    execFile: execFileMock,
    execFileSync: execFileSyncMock,
}));
function execFileError(fields) {
    return Object.assign(new Error('execFile failed'), fields);
}
describe('runTscDiagnostics (async, bounded)', () => {
    const originalPlatform = process.platform;
    let projectDir;
    beforeEach(() => {
        Object.defineProperty(process, 'platform', { configurable: true, value: 'linux' });
        projectDir = mkdtempSync(join(tmpdir(), 'omc-tsc-runner-'));
        writeFileSync(join(projectDir, 'tsconfig.json'), '{}');
        execFileMock.mockReset();
        execFileSyncMock.mockReset();
    });
    afterEach(() => {
        Object.defineProperty(process, 'platform', { configurable: true, value: originalPlatform });
        rmSync(projectDir, { recursive: true, force: true });
        vi.restoreAllMocks();
    });
    it('runs tsc without blocking and passes bounded options on success', async () => {
        execFileMock.mockImplementation((_file, _args, _options, callback) => {
            callback(null, '', '');
        });
        const { runTscDiagnostics, TSC_TIMEOUT_MS } = await import('../tsc-runner.js');
        const result = await runTscDiagnostics(projectDir);
        expect(result).toEqual({ success: true, diagnostics: [], errorCount: 0, warningCount: 0 });
        const [file, args, options] = execFileMock.mock.calls[0];
        expect(file).toBe('tsc');
        expect(args).toEqual(['--noEmit', '--pretty', 'false']);
        expect(options).toMatchObject({
            cwd: projectDir,
            timeout: TSC_TIMEOUT_MS,
            killSignal: 'SIGKILL',
            windowsHide: true
        });
        expect(TSC_TIMEOUT_MS).toBe(120_000);
    });
    it('still parses ordinary compiler diagnostics from a failed run', async () => {
        execFileMock.mockImplementation((_file, _args, _options, callback) => {
            callback(execFileError({ code: 2, killed: false, signal: null }), "src/index.ts(12,5): error TS2322: Type 'string' is not assignable to type 'number'.\n", '');
        });
        const { runTscDiagnostics } = await import('../tsc-runner.js');
        const result = await runTscDiagnostics(projectDir);
        expect(result.success).toBe(false);
        expect(result.errorCount).toBe(1);
        expect(result.warningCount).toBe(0);
        expect(result.diagnostics[0]).toEqual({
            file: 'src/index.ts',
            line: 12,
            column: 5,
            severity: 'error',
            code: 'TS2322',
            message: "Type 'string' is not assignable to type 'number'."
        });
    });
    it('emits a synthetic failure diagnostic when tsc is killed by the timeout', async () => {
        execFileMock.mockImplementation((_file, _args, _options, callback) => {
            callback(execFileError({ killed: true, signal: 'SIGKILL', code: null }), '', '');
        });
        const { runTscDiagnostics, TSC_TIMEOUT_CODE } = await import('../tsc-runner.js');
        const result = await runTscDiagnostics(projectDir);
        expect(result.success).toBe(false);
        expect(result.errorCount).toBe(1);
        expect(result.diagnostics).toHaveLength(1);
        expect(result.diagnostics[0].code).toBe(TSC_TIMEOUT_CODE);
        expect(result.diagnostics[0].severity).toBe('error');
        expect(result.diagnostics[0].file).toBe(join(projectDir, 'tsconfig.json'));
        expect(result.diagnostics[0].message).toContain('timed out');
    });
    it('parses project-level TypeScript diagnostics without a source file', async () => {
        execFileMock.mockImplementation((_file, _args, _options, callback) => {
            callback(execFileError({ code: 2, killed: false, signal: null }), "error TS18003: No inputs were found in config file 'tsconfig.json'.\n", '');
        });
        const { runTscDiagnostics } = await import('../tsc-runner.js');
        const result = await runTscDiagnostics(projectDir);
        expect(result.success).toBe(false);
        expect(result.diagnostics).toEqual([
            {
                file: join(projectDir, 'tsconfig.json'),
                line: 1,
                column: 1,
                severity: 'error',
                code: 'TS18003',
                message: "No inputs were found in config file 'tsconfig.json'."
            }
        ]);
    });
    it('reports tsc as unavailable when the executable cannot be found', async () => {
        execFileMock.mockImplementation((_file, _args, _options, callback) => {
            callback(execFileError({ code: 'ENOENT', killed: false, signal: null }), '', '');
        });
        const { runTscDiagnostics } = await import('../tsc-runner.js');
        const result = await runTscDiagnostics(projectDir);
        expect(result.success).toBe(false);
        expect(result.errorCount).toBe(1);
        expect(result.diagnostics).toEqual([]);
        expect(result.error).toContain('tsc not found');
    });
    it('reports a synthetic execution failure for an unparseable spawn error', async () => {
        execFileMock.mockImplementation((_file, _args, _options, callback) => {
            callback(execFileError({ code: 'EACCES', killed: false, signal: null }), '', '');
        });
        const { runTscDiagnostics, TSC_EXECUTION_ERROR_CODE } = await import('../tsc-runner.js');
        const result = await runTscDiagnostics(projectDir);
        expect(result.success).toBe(false);
        expect(result.errorCount).toBe(1);
        expect(result.diagnostics[0].code).toBe(TSC_EXECUTION_ERROR_CODE);
        expect(result.diagnostics[0].message).toContain('could not complete');
    });
    it('parses truncated diagnostics when maxBuffer is exceeded instead of calling it a timeout', async () => {
        execFileMock.mockImplementation((_file, _args, _options, callback) => {
            callback(execFileError({
                code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
                killed: true,
                signal: 'SIGKILL'
            }), 'src/index.ts(2,3): error TS1005: Expected semicolon.\n', '');
        });
        const { runTscDiagnostics, TSC_TIMEOUT_CODE } = await import('../tsc-runner.js');
        const result = await runTscDiagnostics(projectDir);
        expect(result.success).toBe(false);
        expect(result.diagnostics[0].code).toBe('TS1005');
        expect(result.diagnostics[0].code).not.toBe(TSC_TIMEOUT_CODE);
    });
    it('skips the compiler entirely when the directory has no tsconfig.json', async () => {
        rmSync(join(projectDir, 'tsconfig.json'), { force: true });
        const { runTscDiagnostics } = await import('../tsc-runner.js');
        const result = await runTscDiagnostics(projectDir);
        expect(result).toEqual({ success: true, diagnostics: [], errorCount: 0, warningCount: 0 });
        expect(execFileMock).not.toHaveBeenCalled();
        expect(execFileSyncMock).not.toHaveBeenCalled();
    });
});
//# sourceMappingURL=tsc-runner.test.js.map