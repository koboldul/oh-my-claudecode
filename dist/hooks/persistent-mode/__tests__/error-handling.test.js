/**
 * Tests for issue #319: Stop hook error handling
 * Ensures the persistent-mode hook doesn't hang on errors
 */
import { afterAll, describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stageHookRuntime } from '../../../__tests__/helpers/staged-hook-runtime.js';
const TEMPLATE_HOOK_PATH = join(__dirname, '../../../../templates/hooks/persistent-mode.mjs');
const stagedRuntime = stageHookRuntime(['persistent-mode.mjs']);
const SCRIPT_HOOK_PATH = stagedRuntime.scriptPath('persistent-mode.mjs');
const TIMEOUT_MS = 3000;
afterAll(() => {
    stagedRuntime.cleanup();
});
describe('persistent-mode hook error handling (issue #319)', () => {
    it('should return continue:true on empty valid input without hanging', async () => {
        const result = await runHook('{}');
        expect(result.output).toContain('continue');
        expect(result.timedOut).toBe(false);
        expect(result.exitCode).toBe(0);
    });
    it('should return continue:true on broken stdin without hanging', async () => {
        const result = await runHook('', true); // Empty stdin, close immediately
        expect(result.output).toContain('continue');
        expect(result.timedOut).toBe(false);
    });
    it('keeps standalone compatibility but fails closed in the shipped script on invalid JSON', async () => {
        const template = await runHook('invalid json{{{', {
            hookPath: TEMPLATE_HOOK_PATH,
        });
        expect(template.timedOut).toBe(false);
        expect(template.exitCode).toBe(0);
        expect(JSON.parse(template.output)).toEqual({
            continue: true,
            suppressOutput: true,
        });
        const shipped = await runHook('invalid json{{{', {
            hookPath: SCRIPT_HOOK_PATH,
        });
        expect(shipped.timedOut).toBe(false);
        expect(shipped.exitCode).toBe(2);
        expect(shipped.output).toBe('');
        expect(shipped.stderr).toContain('refusing to continue silently');
    });
    it('should complete within timeout even on errors', async () => {
        const result = await runHook('{"malformed": }');
        expect(result.timedOut).toBe(false);
        expect(result.duration).toBeLessThan(TIMEOUT_MS);
    });
    it('bounds execution when stdin stays open', async () => {
        const template = await runHook('{"cwd":"."}', {
            hookPath: TEMPLATE_HOOK_PATH,
            closeStdin: false,
            env: { OMC_PERSISTENT_MODE_TIMEOUT_MS: '250' },
        });
        expect(template.timedOut).toBe(false);
        expect(template.exitCode).toBe(0);
        expect(template.duration).toBeLessThan(TIMEOUT_MS);
        expect(JSON.parse(template.output)).toEqual({
            continue: true,
            suppressOutput: true,
        });
        const shipped = await runHook('{"cwd":"."}', {
            hookPath: SCRIPT_HOOK_PATH,
            closeStdin: false,
            env: { OMC_PERSISTENT_MODE_TIMEOUT_MS: '250' },
        });
        expect(shipped.timedOut).toBe(false);
        expect(shipped.exitCode).toBe(2);
        expect(shipped.duration).toBeLessThan(TIMEOUT_MS);
        expect(shipped.output).toBe('');
        expect(shipped.stderr).toContain('Safety timeout reached');
    });
    it('keeps template pre-stdin skips while shipped skips use canonical input encoding', async () => {
        const skipEnvs = [
            { DISABLE_OMC: '1' },
            { OMC_SKIP_HOOKS: 'other,persistent-mode' },
            { OMC_SKIP_HOOKS: 'other,stop-continuation' },
        ];
        for (const env of skipEnvs) {
            const template = await runHook('{"cwd":"."}', {
                hookPath: TEMPLATE_HOOK_PATH,
                closeStdin: false,
                env,
            });
            expect(template.timedOut).toBe(false);
            expect(template.exitCode).toBe(0);
            expect(template.duration).toBeLessThan(1000);
            expect(JSON.parse(template.output)).toEqual({
                continue: true,
                suppressOutput: true,
            });
            const shipped = await runHook('{"hook_event_name":"Stop","cwd":"."}', {
                hookPath: SCRIPT_HOOK_PATH,
                env,
            });
            expect(shipped.timedOut).toBe(false);
            expect(shipped.exitCode).toBe(0);
            expect(shipped.duration).toBeLessThan(1000);
            expect(JSON.parse(shipped.output)).toEqual({
                continue: true,
                suppressOutput: true,
            });
        }
    });
    it('fails closed when a shipped skip cannot read the canonical input', async () => {
        const shipped = await runHook('', {
            hookPath: SCRIPT_HOOK_PATH,
            closeStdin: false,
            env: {
                DISABLE_OMC: '1',
                OMC_PERSISTENT_MODE_TIMEOUT_MS: '250',
            },
        });
        expect(shipped.timedOut).toBe(false);
        expect(shipped.exitCode).toBe(2);
        expect(shipped.output).toBe('');
        expect(shipped.stderr).toContain('Safety timeout reached');
    });
    it('keeps the default safety timeout below the shipped Stop hook wrapper kill', () => {
        const manifest = JSON.parse(readFileSync(join(__dirname, '../../../../hooks/hooks.json'), 'utf-8'));
        const stopHook = manifest.hooks.Stop[0].hooks.find((hook) => hook.command?.includes('/scripts/persistent-mode.mjs'));
        expect(stopHook?.timeout).toBe(10);
        const wrapperKillMs = stopHook.timeout * 1000 - 500;
        for (const hookPath of [TEMPLATE_HOOK_PATH, SCRIPT_HOOK_PATH]) {
            expect(readDefaultSafetyTimeoutMs(hookPath)).toBeLessThan(wrapperKillMs);
        }
    });
    it('registers watchdog handlers before top-level awaited dynamic imports', () => {
        for (const hookPath of [TEMPLATE_HOOK_PATH, SCRIPT_HOOK_PATH]) {
            const source = readFileSync(hookPath, 'utf-8');
            const timeoutIndex = source.indexOf('const safetyTimeout = setTimeout');
            const handlerIndex = source.indexOf('process.on("uncaughtException"');
            const dynamicImportIndex = source.indexOf('await import(pathToFileURL(join(__dirname, "lib", "config-dir.mjs"))');
            expect(timeoutIndex).toBeGreaterThan(-1);
            expect(handlerIndex).toBeGreaterThan(timeoutIndex);
            expect(dynamicImportIndex).toBeGreaterThan(handlerIndex);
        }
    });
});
function readDefaultSafetyTimeoutMs(hookPath) {
    const source = readFileSync(hookPath, 'utf-8');
    const match = source.match(/const DEFAULT_SAFETY_TIMEOUT_MS = (\d+);/);
    if (!match)
        throw new Error(`Missing DEFAULT_SAFETY_TIMEOUT_MS in ${hookPath}`);
    return Number(match[1]);
}
function runHook(input, options = {}) {
    const normalized = typeof options === 'boolean'
        ? { closeStdin: options }
        : options;
    const hookPath = normalized.hookPath ?? TEMPLATE_HOOK_PATH;
    const closeStdin = normalized.closeStdin ?? true;
    return new Promise((resolve) => {
        const startTime = Date.now();
        const proc = spawn('node', [hookPath], {
            env: { ...process.env, ...normalized.env },
        });
        let stdout = '';
        let stderr = '';
        let timedOut = false;
        const timeout = setTimeout(() => {
            timedOut = true;
            proc.kill('SIGTERM');
            setTimeout(() => proc.kill('SIGKILL'), 100);
        }, TIMEOUT_MS);
        proc.stdout.on('data', (data) => {
            stdout += data.toString();
        });
        proc.stderr.on('data', (data) => {
            stderr += data.toString();
        });
        proc.on('close', (code) => {
            clearTimeout(timeout);
            const duration = Date.now() - startTime;
            resolve({
                output: stdout,
                stderr,
                exitCode: code,
                timedOut,
                duration
            });
        });
        if (input) {
            proc.stdin.write(input);
        }
        if (closeStdin) {
            proc.stdin.end();
        }
    });
}
//# sourceMappingURL=error-handling.test.js.map