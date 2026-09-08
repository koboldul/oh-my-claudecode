import { execFileSync } from 'node:child_process';
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import * as esbuild from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
    mkdirSync(join(pluginRoot, 'scripts'), { recursive: true });
    cpSync(join(REPO_ROOT, 'scripts', 'lib'), join(pluginRoot, 'scripts', 'lib'), { recursive: true });
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
//# sourceMappingURL=post-tool-rules-injector.test.js.map