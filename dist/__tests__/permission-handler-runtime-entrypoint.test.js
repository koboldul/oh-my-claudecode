import { execFileSync, spawnSync, } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import * as esbuild from 'esbuild';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, } from 'vitest';
const REPO_ROOT = process.cwd();
const SOURCE_SCRIPT_PATH = join(REPO_ROOT, 'scripts', 'permission-handler.mjs');
const LOADER_PATH = join(REPO_ROOT, 'scripts', 'lib', 'hook-runtime-loader.mjs');
const STDIN_PATH = join(REPO_ROOT, 'scripts', 'lib', 'stdin.mjs');
const BUILD_RUNTIME_PATH = join(REPO_ROOT, 'scripts', 'build-hook-runtime.mjs');
const FIXTURE_ROOT = join(REPO_ROOT, 'src', '__tests__', 'fixtures', 'hooks');
const PROCESSOR_ENTRY_PATH = join(REPO_ROOT, 'src', 'hooks', 'permission-handler', 'index.ts');
const SAFE_POSIX_HEREDOC_COMMAND = `git commit -m "$(cat <<'EOF'\nSafe commit message\nEOF\n)"`;
const SAFE_DOUBLE_QUOTED_POSIX_HEREDOC_COMMAND = `git tag -a v1.0.0 -m "$(cat <<"EOF"\nSafe tag message\nEOF\n)"`;
const UNSAFE_UNQUOTED_POSIX_HEREDOC_COMMAND = `git commit -m "$(cat <<EOF\n$(touch /tmp/omc-heredoc-bypass)\nEOF\n)"`;
function loadPermissionFixture(host) {
    const filename = host === 'claude'
        ? 'PermissionRequest.json'
        : 'permissionRequest.json';
    return JSON.parse(readFileSync(join(FIXTURE_ROOT, host, filename), 'utf8'));
}
function claudePayload(cwd, command, toolName = 'Bash') {
    return {
        ...loadPermissionFixture('claude'),
        session_id: 'permission-runtime-session',
        transcript_path: '<transcript-path>',
        cwd,
        tool_name: toolName,
        tool_input: { command },
        tool_use_id: 'permission-runtime-tool-use',
    };
}
function copilotPayload(cwd, command, toolName = 'powershell') {
    return {
        ...loadPermissionFixture('copilot-1.0.72-1'),
        sessionId: 'permission-runtime-session',
        cwd,
        toolName,
        toolInput: { command },
    };
}
function claudeDecision(behavior, message) {
    return {
        continue: true,
        hookSpecificOutput: {
            hookEventName: 'PermissionRequest',
            decision: {
                behavior,
                ...(message ? { message } : {}),
            },
        },
    };
}
function runPermissionHandler(scriptPath, input, claudeConfigDir) {
    return spawnSync(process.execPath, [scriptPath], {
        cwd: REPO_ROOT,
        input: typeof input === 'string' ? input : JSON.stringify(input),
        env: {
            ...process.env,
            CLAUDE_CONFIG_DIR: claudeConfigDir,
        },
        encoding: 'utf8',
        timeout: 10000,
        windowsHide: true,
    });
}
function expectExactOutput(result, output) {
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.signal).toBeNull();
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe(`${JSON.stringify(output)}\n`);
}
describe('scripts/permission-handler.mjs canonical runtime entrypoint', () => {
    let runtimeFixtureDir;
    let runtimeFixturePath;
    let processorFixturePath;
    let tempDir;
    let cwd;
    let claudeConfigDir;
    let productionScriptPath;
    let stagedEntrypointCount;
    beforeAll(async () => {
        runtimeFixtureDir = mkdtempSync(join(tmpdir(), 'omc-permission-runtime-bundle-'));
        runtimeFixturePath = join(runtimeFixtureDir, 'bridge', 'hook-runtime.cjs');
        processorFixturePath = join(runtimeFixtureDir, 'processor', 'index.js');
        execFileSync(process.execPath, [BUILD_RUNTIME_PATH, '--outfile', runtimeFixturePath], {
            cwd: REPO_ROOT,
            stdio: 'pipe',
            windowsHide: true,
        });
        await esbuild.build({
            entryPoints: [PROCESSOR_ENTRY_PATH],
            bundle: true,
            packages: 'bundle',
            preserveSymlinks: true,
            platform: 'node',
            target: 'node20',
            format: 'esm',
            outfile: processorFixturePath,
        });
    });
    afterAll(() => {
        rmSync(runtimeFixtureDir, { recursive: true, force: true });
    });
    beforeEach(() => {
        tempDir = mkdtempSync(join(tmpdir(), 'omc-permission-runtime-'));
        cwd = join(tempDir, 'repo');
        claudeConfigDir = join(tempDir, 'claude-config');
        stagedEntrypointCount = 0;
        mkdirSync(cwd, { recursive: true });
        productionScriptPath = stageEntrypoint({
            runtime: 'valid',
            productionProcessor: true,
        });
    });
    afterEach(() => {
        rmSync(tempDir, { recursive: true, force: true });
    });
    function stageEntrypoint(options) {
        stagedEntrypointCount += 1;
        const pluginRoot = join(tempDir, `plugin-${stagedEntrypointCount}`);
        const scriptPath = join(pluginRoot, 'scripts', 'permission-handler.mjs');
        const loaderPath = join(pluginRoot, 'scripts', 'lib', 'hook-runtime-loader.mjs');
        const stdinPath = join(pluginRoot, 'scripts', 'lib', 'stdin.mjs');
        const runtimePath = join(pluginRoot, 'bridge', 'hook-runtime.cjs');
        mkdirSync(dirname(loaderPath), { recursive: true });
        copyFileSync(SOURCE_SCRIPT_PATH, scriptPath);
        copyFileSync(LOADER_PATH, loaderPath);
        copyFileSync(STDIN_PATH, stdinPath);
        if (options.runtime !== 'missing') {
            mkdirSync(dirname(runtimePath), { recursive: true });
            if (options.runtime === 'valid') {
                copyFileSync(runtimeFixturePath, runtimePath);
            }
            else {
                writeFileSync(runtimePath, 'module.exports = {\n', 'utf8');
            }
        }
        if (options.productionProcessor || options.processorSource !== undefined) {
            const processorPath = join(pluginRoot, 'dist', 'hooks', 'permission-handler', 'index.js');
            mkdirSync(dirname(processorPath), { recursive: true });
            writeFileSync(join(pluginRoot, 'package.json'), JSON.stringify({ type: 'module' }), 'utf8');
            if (options.productionProcessor) {
                copyFileSync(processorFixturePath, processorPath);
            }
            else if (options.processorSource !== undefined) {
                writeFileSync(processorPath, options.processorSource, 'utf8');
            }
        }
        return scriptPath;
    }
    it('emits exact Claude allow output for Bash and proxy_Bash fixtures', () => {
        for (const toolName of ['Bash', 'proxy_Bash']) {
            const result = runPermissionHandler(productionScriptPath, claudePayload(cwd, 'git status', toolName), claudeConfigDir);
            expectExactOutput(result, claudeDecision('allow'));
        }
    });
    it('passes observed safe Copilot powershell requests to native permission handling', () => {
        const result = runPermissionHandler(productionScriptPath, copilotPayload(cwd, 'git status'), claudeConfigDir);
        expectExactOutput(result, {});
    });
    it('passes exact camelCase Copilot bash safe-command fixtures to native handling', () => {
        for (const command of ['git status', SAFE_POSIX_HEREDOC_COMMAND]) {
            expectExactOutput(runPermissionHandler(productionScriptPath, copilotPayload(cwd, command, 'bash'), claudeConfigDir), {});
        }
    });
    it('keeps unsafe Copilot bash requests on the native prompt path', () => {
        for (const command of [
            'git status; rm -rf /',
            UNSAFE_UNQUOTED_POSIX_HEREDOC_COMMAND,
        ]) {
            expectExactOutput(runPermissionHandler(productionScriptPath, copilotPayload(cwd, command, 'bash'), claudeConfigDir), {});
        }
    });
    it('never applies POSIX heredoc auto-allow to Copilot powershell', () => {
        expectExactOutput(runPermissionHandler(productionScriptPath, copilotPayload(cwd, SAFE_POSIX_HEREDOC_COMMAND), claudeConfigDir), {});
        expectExactOutput(runPermissionHandler(productionScriptPath, claudePayload(cwd, SAFE_POSIX_HEREDOC_COMMAND), claudeConfigDir), claudeDecision('allow'));
    });
    it('requires quoted delimiters for POSIX heredoc auto-allow', () => {
        for (const command of [
            SAFE_POSIX_HEREDOC_COMMAND,
            SAFE_DOUBLE_QUOTED_POSIX_HEREDOC_COMMAND,
        ]) {
            expectExactOutput(runPermissionHandler(productionScriptPath, claudePayload(cwd, command), claudeConfigDir), claudeDecision('allow'));
        }
        expectExactOutput(runPermissionHandler(productionScriptPath, claudePayload(cwd, UNSAFE_UNQUOTED_POSIX_HEREDOC_COMMAND), claudeConfigDir), {});
    });
    it('never converts Copilot powershell classifications into OMC allow', () => {
        for (const command of [
            'git status',
            'git diff --cached --stat',
            'git log -n 5 --oneline',
            'git branch --list feature/topic',
            'git show --stat HEAD',
            'npm.cmd run lint',
            'tsc.cmd --noEmit',
            'prettier --check .',
            'ls',
            'ls Env:',
            'cat package.json',
            'git status | Remove-Item -Recurse .',
            '{ git status }',
            'git branch -D topic',
            'git branch --move old-name new-name',
            'git fetch --prune',
            'git diff --output=diff.txt',
            'git log --output=log.txt',
            'git show --output=show.txt',
        ]) {
            expectExactOutput(runPermissionHandler(productionScriptPath, copilotPayload(cwd, command), claudeConfigDir), {});
        }
    });
    it.each([
        ['unknown', 'Get-ChildItem'],
        ['chained', 'git status; rm -rf /'],
        ['destructive', 'rm -rf /'],
    ])('keeps %s commands on the native prompt path', (_label, command) => {
        expectExactOutput(runPermissionHandler(productionScriptPath, claudePayload(cwd, command), claudeConfigDir), {});
        expectExactOutput(runPermissionHandler(productionScriptPath, copilotPayload(cwd, command), claudeConfigDir), {});
    });
    it('never auto-allows malformed command inputs', () => {
        expectExactOutput(runPermissionHandler(productionScriptPath, claudePayload(cwd, 42), claudeConfigDir), {});
        const copilot = copilotPayload(cwd, 'git status');
        copilot.toolInput = null;
        expectExactOutput(runPermissionHandler(productionScriptPath, copilot, claudeConfigDir), {});
    });
    it('does not auto-allow non-shell tools when invoked directly', () => {
        expectExactOutput(runPermissionHandler(productionScriptPath, claudePayload(cwd, 'git status', 'Read'), claudeConfigDir), {});
        const copilot = copilotPayload(cwd, 'git status');
        copilot.toolName = 'read';
        expectExactOutput(runPermissionHandler(productionScriptPath, copilot, claudeConfigDir), {});
    });
    it('encodes malformed envelopes as exact host-native denies', () => {
        expectExactOutput(runPermissionHandler(productionScriptPath, '{"unterminated"', claudeConfigDir), claudeDecision('deny', 'Hook input must be a JSON object.'));
        const copilot = copilotPayload(cwd, 'git status');
        delete copilot.toolName;
        expectExactOutput(runPermissionHandler(productionScriptPath, copilot, claudeConfigDir), {
            behavior: 'deny',
            message: 'Permission-sensitive hook envelope contains no logical tool calls.',
        });
    });
    it('keeps explicit Claude native ask and deny decisions above OMC safe-command allow', () => {
        const nativeAsk = {
            decision: 'ask',
            reason: 'Native confirmation required.',
        };
        const nativeDeny = {
            decision: 'deny',
            reason: 'Native policy denied this command.',
        };
        expectExactOutput(runPermissionHandler(productionScriptPath, { ...claudePayload(cwd, 'git status'), nativeDecision: nativeAsk }, claudeConfigDir), {});
        expectExactOutput(runPermissionHandler(productionScriptPath, { ...claudePayload(cwd, 'git status'), nativeDecision: nativeDeny }, claudeConfigDir), claudeDecision('deny', 'Native policy denied this command.'));
    });
    it('routes exact camelCase Copilot bash and powershell fixtures through the manifest', () => {
        const fixture = loadPermissionFixture('copilot-1.0.72-1');
        const bashFixture = copilotPayload('<cwd>', '<command>', 'bash');
        const manifest = JSON.parse(readFileSync(join(REPO_ROOT, 'hooks', 'copilot-hooks.json'), 'utf8'));
        const entry = manifest.hooks.permissionRequest[0];
        const matcher = new RegExp(`^(?:${entry.matcher})$`);
        expect(manifest.version).toBe(1);
        expect(fixture.toolName).toBe('powershell');
        expect(fixture).not.toHaveProperty('nativeDecision');
        expect(fixture).not.toHaveProperty('hostDecision');
        expect(bashFixture).toEqual({
            hookName: 'permissionRequest',
            sessionId: 'permission-runtime-session',
            timestamp: 1700000000000,
            cwd: '<cwd>',
            permissionSuggestions: [],
            toolName: 'bash',
            toolInput: {
                command: '<command>',
            },
        });
        expect(entry.command).toContain('/scripts/permission-handler.mjs');
        expect(entry.matcher).toBe('bash|powershell');
        expect(matcher.test(fixture.toolName)).toBe(true);
        expect(matcher.test(bashFixture.toolName)).toBe(true);
        expect(matcher.test('Bash')).toBe(false);
        expect(matcher.test('read')).toBe(false);
    });
    it.each(['missing', 'corrupt'])('fails critically when the canonical runtime bundle is %s', (runtime) => {
        const result = runPermissionHandler(stageEntrypoint({ runtime }), claudePayload(cwd, 'git status'), claudeConfigDir);
        expect(result.error).toBeUndefined();
        expect(result.status).toBe(2);
        expect(result.stdout).toBe('');
        expect(result.stderr).toContain('[permission-handler]');
        expect(result.stderr).toContain('refusing to continue silently');
    });
    it.each([
        {
            label: 'throws',
            processorSource: `
        export async function processPermissionRequest() {
          throw new Error('processor exploded');
        }
      `,
            expectedMessage: 'processor exploded',
        },
        {
            label: 'returns an invalid output',
            processorSource: `
        export async function processPermissionRequest() {
          return {};
        }
      `,
            expectedMessage: 'processor output has no recognized fields',
        },
    ])('fails critically when the permission processor $label', ({ processorSource, expectedMessage, }) => {
        const result = runPermissionHandler(stageEntrypoint({
            runtime: 'valid',
            processorSource,
        }), claudePayload(cwd, 'git status'), claudeConfigDir);
        expect(result.error).toBeUndefined();
        expect(result.status).toBe(2);
        expect(result.stdout).toBe('');
        expect(result.stderr).toContain('[permission-handler]');
        expect(result.stderr).toContain(expectedMessage);
        expect(result.stderr).toContain('refusing to continue silently');
    });
});
//# sourceMappingURL=permission-handler-runtime-entrypoint.test.js.map