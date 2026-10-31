/**
 * Ticket 16: slop-warning judgment-point wiring in pre-tool-enforcer.
 *
 * Drives the real hook script end to end at the existing hook-script seam.
 * The channel's degraded path is acceptable wiring evidence: an unreachable
 * endpoint still lands a shadow-log line with the heuristic preserved.
 */
import { execFile, execFileSync } from 'child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { createServer } from 'node:http';
import { tmpdir } from 'os';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { afterAll, afterEach, beforeEach, describe, expect, it, } from 'vitest';
const SCRIPT_PATH = fileURLToPath(new URL('../../scripts/pre-tool-enforcer.mjs', import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'jev-slop-wiring-'));
const worktrees = [];
function makeGitTemp(prefix) {
    const directory = mkdtempSync(join(tmpdir(), prefix));
    worktrees.push(directory);
    execFileSync('git', ['init'], { cwd: directory, stdio: 'pipe' });
    return directory;
}
afterAll(() => {
    for (const directory of worktrees) {
        rmSync(directory, {
            recursive: true,
            force: true,
            maxRetries: 10,
            retryDelay: 50,
        });
    }
    rmSync(tmp, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 50,
    });
});
afterEach(() => {
    try {
        rmSync(join(tmp, 'shadow.jsonl'));
    }
    catch { /* absent is fine */ }
});
function enforcerEnvironment(homeDir, env) {
    const childEnv = {
        ...process.env,
        HOME: homeDir,
        USERPROFILE: homeDir,
        CLAUDE_CONFIG_DIR: join(homeDir, '.claude'),
        CLAUDE_PLUGIN_ROOT: '',
        NODE_ENV: 'test',
        DISABLE_OMC: '',
        OMC_JEV: '',
        OMC_JEV_ENDPOINT: '',
        OMC_JEV_EXCERPT_CHARS: '',
        OMC_JEV_LOG_DIR: '',
        OMC_JEV_PLAN_MODE: '',
        OMC_SKIP_HOOKS: '',
        OMC_STATE_DIR: '',
        TYPESAFE_API_KEY: '',
        ...env,
        OMC_HOST: 'claude',
    };
    delete childEnv.COPILOT_AGENT_SESSION_ID;
    delete childEnv.COPILOT_CLI;
    delete childEnv.PLUGIN_ROOT;
    return childEnv;
}
function runEnforcer(input, env) {
    const cwd = input.cwd || makeGitTemp('jev-slop-wiring-cwd-');
    const homeDir = join(cwd, '.test-home');
    const stdout = execFileSync(process.execPath, [SCRIPT_PATH], {
        cwd,
        input: JSON.stringify(input),
        encoding: 'utf-8',
        timeout: 10000,
        env: enforcerEnvironment(homeDir, env),
    });
    return JSON.parse(stdout);
}
function runEnforcerAsync(input, env) {
    const cwd = input.cwd || makeGitTemp('jev-slop-wiring-cwd-');
    const homeDir = join(cwd, '.test-home');
    return new Promise((resolve, reject) => {
        const child = execFile(process.execPath, [SCRIPT_PATH], {
            cwd,
            encoding: 'utf-8',
            timeout: 10000,
            env: enforcerEnvironment(homeDir, env),
        }, (error, stdout, stderr) => {
            if (error) {
                reject(new Error(`${error.message}\n${stderr}`));
                return;
            }
            try {
                resolve(JSON.parse(stdout));
            }
            catch (parseError) {
                reject(parseError);
            }
        });
        child.stdin?.end(JSON.stringify(input));
    });
}
function waitForShadowEntry(point) {
    const logPath = join(tmp, 'shadow.jsonl');
    for (let i = 0; i < 120; i++) {
        if (existsSync(logPath)) {
            const line = readFileSync(logPath, 'utf8')
                .trim()
                .split('\n')
                .filter(Boolean)
                .find((entry) => {
                try {
                    return JSON.parse(entry).point === point;
                }
                catch {
                    return false;
                }
            });
            if (line)
                return JSON.parse(line);
        }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
    throw new Error(`Timed out waiting for Jev shadow entry "${point}"`);
}
const SLOP_INPUT = {
    cwd: '',
    tool_name: 'Task',
    toolInput: {
        subagent_type: 'oh-my-claudecode:executor',
        description: 'Implement a fallback',
        prompt: 'Add a workaround if the normal architecture is hard.',
    },
};
let cwd = '';
beforeEach(() => {
    cwd = makeGitTemp('jev-slop-wiring-cwd-');
    SLOP_INPUT.cwd = cwd;
});
describe('pre-tool-enforcer slop-warning judgment wiring (ticket 16)', () => {
    it('lands a slop-warning shadow-log line with the heuristic preserved when opted in', () => {
        const output = runEnforcer(SLOP_INPUT, {
            TYPESAFE_API_KEY: 'test-key',
            OMC_JEV: 'slop-warning',
            OMC_JEV_LOG_DIR: tmp,
            OMC_JEV_ENDPOINT: 'http://127.0.0.1:9', // unreachable: degraded path is the evidence
        });
        // Advisory output unchanged (warns, non-blocking).
        const text = JSON.stringify(output);
        expect(text).toContain('SLOP WARNING');
        // Wait briefly for the detached child to write its log line.
        const logPath = join(tmp, 'shadow.jsonl');
        let line = '';
        for (let i = 0; i < 120 && !line; i++) {
            if (existsSync(logPath)) {
                const content = readFileSync(logPath, 'utf8').trim();
                if (content)
                    line = content.split('\n').pop() ?? '';
            }
            if (!line)
                Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
        }
        expect(line).not.toBe('');
        const entry = JSON.parse(line);
        expect(entry).toMatchObject({ point: 'slop-warning', mode: 'degraded', heuristic: true });
    });
    it('spawns nothing and logs nothing when env is absent', () => {
        const output = runEnforcer(SLOP_INPUT, {});
        expect(JSON.stringify(output)).toContain('SLOP WARNING');
        expect(existsSync(join(tmp, 'shadow.jsonl'))).toBe(false);
    });
    it('spawns nothing when the point is not opted in (other point named)', () => {
        runEnforcer(SLOP_INPUT, {
            TYPESAFE_API_KEY: 'test-key',
            OMC_JEV: 'task-size',
            OMC_JEV_LOG_DIR: tmp,
        });
        expect(existsSync(join(tmp, 'shadow.jsonl'))).toBe(false);
    });
    it('the all wildcard opts the point in', () => {
        runEnforcer(SLOP_INPUT, {
            TYPESAFE_API_KEY: 'test-key',
            OMC_JEV: 'all',
            OMC_JEV_LOG_DIR: tmp,
            OMC_JEV_ENDPOINT: 'http://127.0.0.1:9',
        });
        const logPath = join(tmp, 'shadow.jsonl');
        let line = '';
        for (let i = 0; i < 120 && !line; i++) {
            if (existsSync(logPath)) {
                const lines = readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean);
                line = lines.find((entry) => {
                    try {
                        return JSON.parse(entry).point === 'slop-warning';
                    }
                    catch {
                        return false;
                    }
                }) ?? '';
            }
            if (!line)
                Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
        }
        expect(line).not.toBe('');
        // The request reaches the child through the temp file, not argv: the state
        // it logs must still carry the tool input the enforcer inspected.
        expect(JSON.parse(line)).toMatchObject({
            point: 'slop-warning',
            state: { toolName: 'Task', toolInput: { subagent_type: 'oh-my-claudecode:executor' } },
        });
    });
    describe('pre-tool-enforcer model-routing judgment wiring', () => {
        it('applies an active Claude tier from the real script and runtime artifact', async () => {
            let requestCount = 0;
            const server = createServer((request, response) => {
                requestCount += 1;
                request.resume();
                response.writeHead(200, { 'Content-Type': 'application/json' });
                response.end(JSON.stringify({
                    answers: {
                        'model-tier': {
                            type: 'choice',
                            choice: 'opus',
                            confidence: 0.99,
                        },
                    },
                }));
            });
            await new Promise((resolve, reject) => {
                const onError = (error) => reject(error);
                server.once('error', onError);
                server.listen(0, '127.0.0.1', () => {
                    server.off('error', onError);
                    resolve();
                });
            });
            try {
                const address = server.address();
                if (!address || typeof address === 'string') {
                    throw new Error('Jev loopback server did not expose a TCP port');
                }
                const output = await runEnforcerAsync({
                    cwd,
                    permission_mode: 'default',
                    tool_name: 'Task',
                    toolInput: {
                        subagent_type: 'oh-my-claudecode:executor',
                        description: 'Implement the focused fix',
                        prompt: 'Implement the focused fix and its regression test.',
                        model: 'haiku',
                    },
                }, {
                    TYPESAFE_API_KEY: 'test-key',
                    OMC_HOST: 'claude',
                    OMC_JEV: 'model-routing:active',
                    OMC_JEV_ENDPOINT: `http://127.0.0.1:${address.port}`,
                    OMC_JEV_LOG_DIR: tmp,
                });
                expect(requestCount).toBe(1);
                expect(output).toMatchObject({
                    continue: true,
                    hookSpecificOutput: {
                        hookEventName: 'PreToolUse',
                        updatedInput: {
                            subagent_type: 'oh-my-claudecode:executor',
                            description: 'Implement the focused fix',
                            prompt: 'Implement the focused fix and its regression test.',
                            model: 'opus',
                        },
                    },
                });
            }
            finally {
                await new Promise((resolve) => server.close(() => resolve()));
            }
        }, 15_000);
        it('logs bounded original and modified routing inputs', () => {
            const prompt = 'p'.repeat(700);
            runEnforcer({
                cwd,
                tool_name: 'Task',
                toolInput: {
                    subagent_type: 'oh-my-claudecode:executor',
                    description: 'd'.repeat(700),
                    prompt,
                    model: 'haiku',
                    run_in_background: true,
                    ignored: 'not logged',
                },
            }, {
                TYPESAFE_API_KEY: 'test-key',
                OMC_JEV: 'model-routing',
                OMC_JEV_LOG_DIR: tmp,
                OMC_JEV_ENDPOINT: 'http://127.0.0.1:9',
            });
            const entry = waitForShadowEntry('model-routing');
            expect(entry.heuristic).toMatchObject({
                injected: false,
                model: 'haiku',
                originalInput: {
                    subagent_type: 'oh-my-claudecode:executor',
                    model: 'haiku',
                    run_in_background: true,
                },
                modifiedInput: {
                    subagent_type: 'oh-my-claudecode:executor',
                    model: 'haiku',
                    run_in_background: true,
                },
            });
            expect(String(entry.heuristic.originalInput.prompt)).toHaveLength(500);
            expect(String(entry.heuristic.modifiedInput.description)).toHaveLength(500);
            expect(entry.heuristic.originalInput).not.toHaveProperty('ignored');
            const task = entry.state.task;
            expect(task).toEqual(expect.any(String));
            expect(String(task).length).toBeGreaterThan(0);
            expect(String(task).length).toBeLessThanOrEqual(500);
            expect(prompt.startsWith(String(task))).toBe(true);
        });
    });
});
//# sourceMappingURL=pre-tool-enforcer-jev-wiring.test.js.map