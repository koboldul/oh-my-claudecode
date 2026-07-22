import { execFileSync, spawnSync } from 'child_process';
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, } from 'fs';
import { tmpdir } from 'os';
import { delimiter, join } from 'path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stageHookRuntime } from './helpers/staged-hook-runtime.js';
const stagedRuntime = stageHookRuntime(['context-guard-stop.mjs']);
const SCRIPT_PATH = stagedRuntime.scriptPath('context-guard-stop.mjs');
const COPILOT_FIXTURE_ROOT = join(process.cwd(), 'src', '__tests__', 'fixtures', 'hooks', 'copilot-1.0.72-1');
const COPILOT_AGENT_STOP = JSON.parse(readFileSync(join(COPILOT_FIXTURE_ROOT, 'agentStop.json'), 'utf8'));
const COPILOT_CONTEXT_EVENTS = join(COPILOT_FIXTURE_ROOT, 'context-events.jsonl');
const COPILOT_CONTEXT_DIAGNOSTIC = '[context-guard-stop] Copilot context blocking disabled: 1.0.72-1 agentStop/events do not provide a current Stop-time token count paired with the active model context limit; continuing without a synthetic estimate.\n';
afterAll(() => {
    stagedRuntime.cleanup();
});
function runContextGuardStop(input) {
    const stdout = execFileSync(process.execPath, [SCRIPT_PATH], {
        input: JSON.stringify(input),
        encoding: 'utf-8',
        timeout: 5000,
        env: { ...process.env, NODE_ENV: 'test' },
    });
    return JSON.parse(stdout.trim());
}
function runContextGuardStopWithEnv(input, env) {
    const stdout = execFileSync(process.execPath, [SCRIPT_PATH], {
        input: JSON.stringify(input),
        encoding: 'utf-8',
        timeout: 5000,
        env: { ...process.env, NODE_ENV: 'test', ...env },
    });
    return JSON.parse(stdout.trim());
}
function runContextGuardStopCaptured(input, env = {}) {
    const result = spawnSync(process.execPath, [SCRIPT_PATH], {
        input: JSON.stringify(input),
        encoding: 'utf-8',
        timeout: 5000,
        env: { ...process.env, NODE_ENV: 'test', ...env },
    });
    return {
        status: result.status,
        stdout: result.stdout,
        stderr: result.stderr,
    };
}
function writeTranscriptWithContext(filePath, contextWindow, inputTokens) {
    const line = JSON.stringify({
        usage: { context_window: contextWindow, input_tokens: inputTokens },
        context_window: contextWindow,
        input_tokens: inputTokens,
    });
    writeFileSync(filePath, `${line}\n`, 'utf-8');
}
describe('context-guard-stop safe recovery messaging (issue #1373)', () => {
    let tempDir;
    let transcriptPath;
    beforeEach(() => {
        tempDir = mkdtempSync(join(tmpdir(), 'context-guard-stop-'));
        transcriptPath = join(tempDir, 'transcript.jsonl');
    });
    afterEach(() => {
        rmSync(tempDir, { recursive: true, force: true });
    });
    it('blocks high-context stops with explicit compact-first recovery advice', () => {
        writeTranscriptWithContext(transcriptPath, 1000, 850); // 85%
        const out = runContextGuardStop({
            session_id: `session-${Date.now()}`,
            transcript_path: transcriptPath,
            cwd: tempDir,
            stop_reason: 'normal',
        });
        expect(out.decision).toBe('block');
        expect(String(out.reason)).toContain('Run /compact immediately');
        expect(String(out.reason)).toContain('.omc/state');
    });
    it('fails open at critical context exhaustion to avoid stop-hook deadlock', () => {
        writeTranscriptWithContext(transcriptPath, 1000, 960); // 96%
        const out = runContextGuardStop({
            session_id: `session-${Date.now()}`,
            transcript_path: transcriptPath,
            cwd: tempDir,
            stop_reason: 'end_turn',
        });
        expect(out.continue).toBe(true);
        expect(out.decision).toBeUndefined();
    });
    it('ignores invalid session_id values when tracking block retries', () => {
        writeTranscriptWithContext(transcriptPath, 1000, 850); // 85%
        const invalidSessionId = '../../bad-session-id';
        const first = runContextGuardStop({
            session_id: invalidSessionId,
            transcript_path: transcriptPath,
            cwd: tempDir,
            stop_reason: 'normal',
        });
        const second = runContextGuardStop({
            session_id: invalidSessionId,
            transcript_path: transcriptPath,
            cwd: tempDir,
            stop_reason: 'normal',
        });
        expect(first.decision).toBe('block');
        expect(second.decision).toBe('block');
        expect(String(first.reason)).toContain('(Block 1/2)');
        expect(String(second.reason)).toContain('(Block 1/2)');
    });
    it('skips git worktree probing in non-git directories without a local .git marker', () => {
        const missingTranscriptPath = join(tempDir, 'missing-transcript.jsonl');
        const fakeBinDir = join(tempDir, 'fake-bin');
        mkdirSync(fakeBinDir, { recursive: true });
        const gitLogPath = join(tempDir, 'git-invocations.log');
        writeFileSync(join(fakeBinDir, 'git'), '#!/usr/bin/env node\n' +
            'require("fs").appendFileSync(process.env.OMC_FAKE_GIT_LOG, process.argv.slice(2).join(" ") + "\\n");\n' +
            'process.exit(1);\n', { mode: 0o755 });
        writeFileSync(join(fakeBinDir, 'git.cmd'), '@echo off\r\nnode "%~dp0\\git" %*\r\n');
        const out = runContextGuardStopWithEnv({
            session_id: `session-${Date.now()}`,
            transcript_path: missingTranscriptPath,
            cwd: tempDir,
            stop_reason: 'normal',
        }, {
            PATH: `${fakeBinDir}${delimiter}${process.env.PATH ?? ''}`,
            OMC_FAKE_GIT_LOG: gitLogPath,
        });
        expect(out).toEqual({ continue: true, suppressOutput: true });
        expect(() => readFileSync(gitLogPath, 'utf-8')).toThrow();
    });
    it('explicitly disables Copilot blocking when events lack a paired context denominator', () => {
        copyFileSync(COPILOT_CONTEXT_EVENTS, transcriptPath);
        const result = runContextGuardStopCaptured({
            ...COPILOT_AGENT_STOP,
            cwd: tempDir,
            sessionId: `copilot-${Date.now()}`,
            transcriptPath,
        });
        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout).toBe('{}\n');
        expect(result.stderr).toBe(COPILOT_CONTEXT_DIAGNOSTIC);
    });
    it('keeps Copilot context-limit bypasses silent while passing canonically', () => {
        copyFileSync(COPILOT_CONTEXT_EVENTS, transcriptPath);
        const result = runContextGuardStopCaptured({
            ...COPILOT_AGENT_STOP,
            cwd: tempDir,
            sessionId: `copilot-limit-${Date.now()}`,
            transcriptPath,
            stopReason: 'context_limit',
        });
        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout).toBe('{}\n');
        expect(result.stderr).toBe('');
    });
});
//# sourceMappingURL=context-guard-stop.test.js.map