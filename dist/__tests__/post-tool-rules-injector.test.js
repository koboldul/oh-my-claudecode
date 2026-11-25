import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve, join } from 'node:path';
import * as esbuild from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { stageHookRuntimeSupport } from './helpers/staged-hook-runtime.js';
const NODE = process.execPath;
const REPO_ROOT = resolve(join(__dirname, '..', '..'));
let tempRoot;
let pluginRoot;
let workspace;
let scriptPath;
beforeAll(async () => {
    tempRoot = mkdtempSync(join(tmpdir(), 'omc-rules-skip-entrypoint-'));
    pluginRoot = join(tempRoot, 'plugin');
    workspace = join(tempRoot, 'workspace');
    scriptPath = join(pluginRoot, 'scripts', 'post-tool-rules-injector.mjs');
    stageHookRuntimeSupport(pluginRoot, REPO_ROOT);
    copyFileSync(join(REPO_ROOT, 'scripts', 'post-tool-rules-injector.mjs'), scriptPath);
    writeFileSync(join(pluginRoot, 'package.json'), JSON.stringify({ type: 'module' }), 'utf8');
    execFileSync(NODE, [
        join(REPO_ROOT, 'scripts', 'build-hook-runtime.mjs'),
        '--outfile',
        join(pluginRoot, 'bridge', 'hook-runtime.cjs'),
    ], {
        cwd: REPO_ROOT,
        stdio: 'pipe',
        windowsHide: true,
    });
    const processorPath = join(pluginRoot, 'dist', 'hooks', 'rules-injector', 'index.js');
    mkdirSync(dirname(processorPath), { recursive: true });
    await esbuild.build({
        entryPoints: [
            join(REPO_ROOT, 'src', 'hooks', 'rules-injector', 'index.ts'),
        ],
        bundle: true,
        packages: 'bundle',
        preserveSymlinks: true,
        platform: 'node',
        target: 'node20',
        format: 'esm',
        outfile: processorPath,
    });
    mkdirSync(workspace, { recursive: true });
    writeFileSync(join(workspace, 'package.json'), '{}\n', 'utf8');
    writeFileSync(join(workspace, 'README.md'), '# Test\n', 'utf8');
});
afterAll(() => {
    rmSync(tempRoot, { recursive: true, force: true });
});
function runHook(input, extraEnv) {
    const testHome = join(tempRoot, 'home');
    mkdirSync(testHome, { recursive: true });
    const raw = execFileSync(NODE, [scriptPath], {
        cwd: workspace,
        input: JSON.stringify(input),
        encoding: 'utf-8',
        env: {
            ...process.env,
            CLAUDE_PLUGIN_ROOT: pluginRoot,
            CLAUDE_CONFIG_DIR: join(tempRoot, 'isolated-config'),
            HOME: testHome,
            NODE_ENV: 'test',
            USERPROFILE: testHome,
            ...extraEnv,
        },
        timeout: 15000,
    }).trim();
    return JSON.parse(raw);
}
function runCopilotHook(root, filePath, sessionId) {
    return runHook({
        sessionId,
        cwd: root,
        toolName: 'Read',
        toolArgs: JSON.stringify({ file_path: filePath }),
        toolResult: {
            textResultForLlm: '# fixture',
            resultType: 'success',
        },
    }, {
        CLAUDE_CONFIG_DIR: join(root, 'config'),
        HOME: join(root, 'home'),
        OMC_HOST: 'copilot',
        USERPROFILE: join(root, 'home'),
    });
}
function writeAlwaysRule(path, body) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `---\nalwaysApply: true\n---\n${body}`, 'utf8');
}
describe('post-tool-rules-injector.mjs skip guards (DISABLE_OMC / OMC_SKIP_HOOKS)', () => {
    // A payload with a file_path drives the hook into its rules-processing path, so a
    // hook that ignores the kill switch would NOT emit the bare `{ continue: true }`
    // that a guarded short-circuit produces.
    const INPUT = {
        tool_name: 'Read',
        tool_input: { file_path: 'README.md' },
        session_id: 'abc',
    };
    function expectSkipped(extraEnv) {
        // Guarded hooks short-circuit before any processing with a bare continue.
        expect(runHook(INPUT, extraEnv)).toEqual({ continue: true });
    }
    function expectInjectedContext(extraEnv) {
        const root = mkdtempSync(join(tmpdir(), 'post-tool-rules-injector-'));
        const home = join(root, 'home');
        const filePath = join(root, 'README.md');
        mkdirSync(join(root, '.claude', 'rules'), { recursive: true });
        mkdirSync(home, { recursive: true });
        writeFileSync(join(root, '.git'), 'gitdir: placeholder');
        writeFileSync(join(root, '.claude', 'rules', 'style.md'), '---\nalwaysApply: true\n---\nUse this rule.');
        writeFileSync(filePath, '# fixture');
        try {
            expect(runHook({
                cwd: root,
                tool_name: 'Read',
                tool_input: { file_path: filePath },
                session_id: 'issue-3956-rules',
            }, {
                HOME: home,
                USERPROFILE: home,
                CLAUDE_CONFIG_DIR: join(root, 'config'),
                ...extraEnv,
            })).toEqual({
                continue: true,
                hookSpecificOutput: {
                    hookEventName: 'PostToolUse',
                    additionalContext: expect.stringContaining('Use this rule.'),
                },
            });
        }
        finally {
            rmSync(root, { recursive: true, force: true });
        }
    }
    it('no-ops when DISABLE_OMC=1', () => {
        expectSkipped({ DISABLE_OMC: '1', OMC_SKIP_HOOKS: '' });
    });
    it('no-ops when DISABLE_OMC=true', () => {
        expectSkipped({ DISABLE_OMC: 'true', OMC_SKIP_HOOKS: '' });
    });
    it('no-ops when OMC_SKIP_HOOKS contains the post-tool-use event token', () => {
        expectSkipped({ DISABLE_OMC: '', OMC_SKIP_HOOKS: 'post-tool-use' });
    });
    it('honors whitespace and commas in OMC_SKIP_HOOKS', () => {
        expectSkipped({ DISABLE_OMC: '', OMC_SKIP_HOOKS: ' keyword-detector , post-tool-use ' });
    });
    it('preserves context without unsupported response fields when processing is enabled', () => {
        expectInjectedContext({ DISABLE_OMC: '', OMC_SKIP_HOOKS: '' });
    });
    it('preserves context when OMC_SKIP_HOOKS has an unrelated token', () => {
        expectInjectedContext({ DISABLE_OMC: '', OMC_SKIP_HOOKS: 'keyword-detector' });
    });
    it('preserves context when DISABLE_OMC=false', () => {
        expectInjectedContext({ DISABLE_OMC: 'false', OMC_SKIP_HOOKS: '' });
    });
});
describe('post-tool-rules-injector.mjs bounded delivery records', () => {
    it('omits a later Copilot rule rather than truncating the aggregate context', () => {
        const root = mkdtempSync(join(tmpdir(), 'omc-rules-aggregate-bound-'));
        const filePath = join(root, 'src', 'fixture.ts');
        const firstRule = join(root, 'src', '.claude', 'rules', 'first.md');
        const secondRule = join(root, '.claude', 'rules', 'second.md');
        mkdirSync(dirname(filePath), { recursive: true });
        mkdirSync(join(root, 'home'), { recursive: true });
        writeFileSync(join(root, '.git'), 'gitdir: placeholder', 'utf8');
        writeFileSync(filePath, 'export {};\n', 'utf8');
        writeAlwaysRule(firstRule, `FIRST-BOUNDARY\n${'a'.repeat(4_000)}\nFIRST-BOUNDARY-END`);
        writeAlwaysRule(secondRule, `SECOND-BOUNDARY\n${'b'.repeat(2_500)}\nSECOND-BOUNDARY-END`);
        try {
            const sessionId = `aggregate-bound-${Date.now()}`;
            const first = runCopilotHook(root, filePath, sessionId);
            expect(first.additionalContext).toContain('FIRST-BOUNDARY-END');
            expect(first.additionalContext).not.toContain('SECOND-BOUNDARY');
            expect(first.additionalContext).not.toContain('…');
            const second = runCopilotHook(root, filePath, sessionId);
            expect(second.additionalContext).toContain('SECOND-BOUNDARY-END');
            expect(second.additionalContext).not.toContain('FIRST-BOUNDARY');
        }
        finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
    it('does not commit an omitted rule whose formatted text is embedded in another rule', () => {
        const root = mkdtempSync(join(tmpdir(), 'omc-rules-embedded-record-'));
        const filePath = join(root, 'src', 'fixture.ts');
        const firstRule = join(root, 'src', '.claude', 'rules', 'first.md');
        const secondRule = join(root, '.claude', 'rules', 'second.md');
        mkdirSync(dirname(filePath), { recursive: true });
        mkdirSync(join(root, 'home'), { recursive: true });
        writeFileSync(join(root, '.git'), 'gitdir: placeholder', 'utf8');
        writeFileSync(filePath, 'export {};\n', 'utf8');
        const secondBody = 'SECOND-EMBEDDED-RECORD';
        const secondContext = `[Rule: ${relative(root, secondRule)}]\n`
            + '[Match: alwaysApply]\n'
            + secondBody;
        const firstHeader = `[Rule: ${relative(root, firstRule)}]\n`
            + '[Match: alwaysApply]\n';
        const firstPrefix = 'FIRST-CONTAINS-SECOND\n';
        const paddingLength = 5_950
            - firstHeader.length
            - firstPrefix.length
            - 1
            - secondContext.length;
        expect(paddingLength).toBeGreaterThan(0);
        const firstBody = `${firstPrefix}${'x'.repeat(paddingLength)}\n${secondContext}`;
        expect(`${firstHeader}${firstBody}`).toHaveLength(5_950);
        writeAlwaysRule(firstRule, firstBody);
        writeAlwaysRule(secondRule, secondBody);
        try {
            const sessionId = `embedded-record-${Date.now()}`;
            const first = runCopilotHook(root, filePath, sessionId);
            expect(first.additionalContext).toHaveLength(5_950);
            expect(first.additionalContext).toContain(secondContext);
            const second = runCopilotHook(root, filePath, sessionId);
            expect(second.additionalContext).toBe(secondContext);
        }
        finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});
//# sourceMappingURL=post-tool-rules-injector.test.js.map