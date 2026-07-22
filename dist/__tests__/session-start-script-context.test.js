import { describe, expect, it, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stageHookRuntime, } from './helpers/staged-hook-runtime.js';
const REPO_ROOT = join(__dirname, '..', '..');
const NODE = process.execPath;
let stagedRuntime;
let scriptPath;
beforeAll(() => {
    stagedRuntime = stageHookRuntime(['session-start.mjs'], REPO_ROOT);
    scriptPath = stagedRuntime.scriptPath('session-start.mjs');
});
afterAll(() => {
    stagedRuntime.cleanup();
});
function isolatedHostEnv(host) {
    const env = { ...process.env };
    delete env.COPILOT_CLI;
    delete env.COPILOT_AGENT_SESSION_ID;
    delete env.OMC_HOST;
    delete env.CLAUDE_PLUGIN_ROOT;
    return { ...env, OMC_HOST: host, CLAUDE_PLUGIN_ROOT: REPO_ROOT };
}
function removeTempDir(path) {
    try {
        rmSync(path, {
            recursive: true,
            force: true,
            maxRetries: 40,
            retryDelay: 25,
        });
    }
    catch (error) {
        if (error.code !== 'EPERM')
            throw error;
    }
}
describe('session-start.mjs regression #1386', () => {
    let tempDir;
    let fakeHome;
    let fakeProject;
    beforeEach(() => {
        tempDir = mkdtempSync(join(tmpdir(), 'omc-session-start-script-'));
        fakeHome = join(tempDir, 'home');
        fakeProject = join(tempDir, 'project');
        mkdirSync(join(fakeProject, '.omc', 'state', 'sessions', 'session-1386'), { recursive: true });
        // session-start validateCwd requires a real workspace anchor (.git / .omc-workspace)
        mkdirSync(join(fakeProject, '.git'), { recursive: true });
    });
    afterEach(() => {
        removeTempDir(tempDir);
    });
    it('prewarms the scoped SessionEnd resident within the approved 1.5s gate', () => {
        const source = readFileSync(join(REPO_ROOT, 'scripts', 'session-start.mjs'), 'utf8');
        expect(source).toContain("import { ensureSessionEndResident } from './lib/session-end-resident-control.mjs';");
        expect(source).toContain('await ensureSessionEndResident({');
        expect(source).toContain('timeoutMs: 1_500');
        expect(source).not.toContain('reconcileSessionEndJobsInBackground');
    });
    it('marks restored ultrawork state as prior-session context instead of imperative continuation', () => {
        writeFileSync(join(fakeProject, '.omc', 'state', 'sessions', 'session-1386', 'ultrawork-state.json'), JSON.stringify({
            active: true,
            session_id: 'session-1386',
            started_at: '2026-03-06T00:00:00.000Z',
            original_prompt: 'Old task that should not override a new request',
        }));
        const raw = execFileSync(NODE, [scriptPath], {
            input: JSON.stringify({
                hook_event_name: 'SessionStart',
                session_id: 'session-1386',
                cwd: fakeProject,
            }),
            encoding: 'utf-8',
            env: {
                ...isolatedHostEnv('claude'),
                HOME: fakeHome,
                USERPROFILE: fakeHome,
            },
            timeout: 15000,
        }).trim();
        const output = JSON.parse(raw);
        const context = output.hookSpecificOutput?.additionalContext || '';
        expect(context).toContain('[ULTRAWORK MODE RESTORED]');
        expect(context).toContain("Prioritize the user's newest request");
        expect(context).not.toContain('Continue working in ultrawork mode until all tasks are complete.');
    });
    it('injects persisted project memory into session-start additionalContext', () => {
        mkdirSync(join(fakeProject, '.omc'), { recursive: true });
        writeFileSync(join(fakeProject, '.omc', 'project-memory.json'), JSON.stringify({
            version: '1.0.0',
            lastScanned: Date.now(),
            projectRoot: fakeProject,
            techStack: {
                languages: [
                    {
                        name: 'TypeScript',
                        version: '5.0.0',
                        confidence: 'high',
                        markers: ['tsconfig.json', 'package.json'],
                    },
                ],
                frameworks: [],
                packageManager: 'pnpm',
                runtime: 'node',
            },
            build: {
                buildCommand: 'pnpm build',
                testCommand: 'pnpm test',
                lintCommand: null,
                devCommand: null,
                scripts: {},
            },
            conventions: {
                namingStyle: null,
                importStyle: null,
                testPattern: null,
                fileOrganization: null,
            },
            structure: {
                isMonorepo: false,
                workspaces: [],
                mainDirectories: ['src'],
                gitBranches: null,
            },
            customNotes: [
                {
                    timestamp: Date.now(),
                    source: 'manual',
                    category: 'env',
                    content: 'Requires LOCAL_API_BASE for smoke tests',
                },
            ],
            directoryMap: {},
            hotPaths: [],
            userDirectives: [
                {
                    timestamp: Date.now(),
                    directive: 'Preserve project memory directives at session start',
                    context: '',
                    source: 'explicit',
                    priority: 'high',
                },
            ],
        }));
        const raw = execFileSync(NODE, [scriptPath], {
            input: JSON.stringify({
                hook_event_name: 'SessionStart',
                session_id: 'session-1779',
                cwd: fakeProject,
            }),
            encoding: 'utf-8',
            env: {
                ...isolatedHostEnv('claude'),
                HOME: fakeHome,
                USERPROFILE: fakeHome,
            },
            timeout: 15000,
        }).trim();
        const output = JSON.parse(raw);
        const context = output.hookSpecificOutput?.additionalContext || '';
        expect(output.continue).toBe(true);
        expect(context).toContain('<project-memory-context>');
        expect(context).toContain('[PROJECT MEMORY]');
        expect(context).toContain('Preserve project memory directives at session start');
        expect(context).toContain('[Project Environment]');
        expect(context).toContain('- TypeScript | pkg:pnpm | node');
        expect(context).toContain('- build=pnpm build | test=pnpm test');
        expect(context).toContain('[env] Requires LOCAL_API_BASE for smoke tests');
        expect(context).toContain('</project-memory-context>');
    });
    it('injects model routing override for non-standard providers before lower-priority context', () => {
        writeFileSync(join(fakeProject, 'AGENTS.md'), `# oh-my-claudecode - Intelligent Multi-Agent Orchestration

<guidance_schema_contract>schema</guidance_schema_contract>

<operating_principles>
${'- oversized startup guidance\n'.repeat(700)}
</operating_principles>`);
        const raw = execFileSync(NODE, [scriptPath], {
            input: JSON.stringify({
                hook_event_name: 'SessionStart',
                session_id: 'session-bedrock-script',
                cwd: fakeProject,
            }),
            encoding: 'utf-8',
            env: {
                ...isolatedHostEnv('claude'),
                HOME: fakeHome,
                USERPROFILE: fakeHome,
                CLAUDE_CODE_USE_BEDROCK: '1',
            },
            timeout: 15000,
        }).trim();
        const output = JSON.parse(raw);
        const context = output.hookSpecificOutput?.additionalContext || '';
        expect(output.continue).toBe(true);
        expect(context).toContain('[MODEL ROUTING OVERRIDE');
        expect(context).toContain('tier alias');
        expect(context).toMatch(/\b(sonnet|opus|haiku)\b/);
        expect(context).not.toContain('Do NOT pass the `model` parameter');
        expect(context).not.toContain('Omit it entirely');
        expect(context.length).toBeLessThanOrEqual(6000);
    });
    it('surfaces update notices through systemMessage without injecting them into additionalContext', () => {
        const claudeDir = join(fakeHome, '.claude');
        const pluginRoot = join(tempDir, 'plugin');
        mkdirSync(join(claudeDir, '.omc'), { recursive: true });
        mkdirSync(join(claudeDir, 'hud'), { recursive: true });
        mkdirSync(pluginRoot, { recursive: true });
        writeFileSync(join(pluginRoot, 'package.json'), JSON.stringify({ version: '1.0.0', type: 'module' }));
        writeFileSync(join(claudeDir, 'hud', 'omc-hud.mjs'), '');
        writeFileSync(join(claudeDir, 'settings.json'), JSON.stringify({ statusLine: 'node ~/.claude/hud/omc-hud.mjs' }));
        writeFileSync(join(claudeDir, '.omc', 'update-check.json'), JSON.stringify({
            timestamp: Date.now(),
            latestVersion: '999.0.0',
            currentVersion: '1.0.0',
            updateAvailable: true,
        }));
        const result = spawnSync(NODE, [scriptPath], {
            input: JSON.stringify({
                hook_event_name: 'SessionStart',
                session_id: 'session-update-script',
                cwd: fakeProject,
            }),
            encoding: 'utf-8',
            env: {
                ...isolatedHostEnv('claude'),
                HOME: fakeHome,
                USERPROFILE: fakeHome,
                CLAUDE_PLUGIN_ROOT: pluginRoot,
                OMC_NOTIFY: '0',
            },
            timeout: 15000,
        });
        expect(result.status).toBe(0);
        expect(result.stderr).toBe('');
        const output = JSON.parse(result.stdout);
        expect(output.continue).toBe(true);
        expect(output.systemMessage).toContain('[OMC UPDATE AVAILABLE]');
        expect(output.systemMessage).toContain('v999.0.0');
        expect(output.systemMessage).toContain('/update');
        expect(output.hookSpecificOutput?.additionalContext ?? '').not.toContain('[OMC UPDATE AVAILABLE]');
        expect(output.hookSpecificOutput?.additionalContext ?? '').not.toContain('999.0.0');
    });
    it('does not show update notice when stale CLAUDE_PLUGIN_ROOT is older than plugin cache', () => {
        const claudeDir = join(fakeHome, '.claude');
        const stalePluginRoot = join(claudeDir, 'plugins', 'cache', 'omc', 'oh-my-claudecode', '4.14.4');
        const latestPluginRoot = join(claudeDir, 'plugins', 'cache', 'omc', 'oh-my-claudecode', '4.14.5');
        mkdirSync(join(claudeDir, '.omc'), { recursive: true });
        mkdirSync(join(claudeDir, 'hud'), { recursive: true });
        mkdirSync(stalePluginRoot, { recursive: true });
        mkdirSync(latestPluginRoot, { recursive: true });
        writeFileSync(join(stalePluginRoot, 'package.json'), JSON.stringify({ version: '4.14.4', type: 'module' }));
        writeFileSync(join(latestPluginRoot, 'package.json'), JSON.stringify({ version: '4.14.5', type: 'module' }));
        writeFileSync(join(claudeDir, 'hud', 'omc-hud.mjs'), '');
        writeFileSync(join(claudeDir, 'settings.json'), JSON.stringify({ statusLine: 'node ~/.claude/hud/omc-hud.mjs' }));
        writeFileSync(join(claudeDir, '.omc', 'update-check.json'), JSON.stringify({
            timestamp: Date.now(),
            latestVersion: '4.14.5',
            currentVersion: '4.14.4',
            updateAvailable: true,
        }));
        const result = spawnSync(NODE, [scriptPath], {
            input: JSON.stringify({
                hook_event_name: 'SessionStart',
                session_id: 'session-stale-plugin-root',
                cwd: fakeProject,
            }),
            encoding: 'utf-8',
            env: {
                ...isolatedHostEnv('claude'),
                HOME: fakeHome,
                USERPROFILE: fakeHome,
                CLAUDE_PLUGIN_ROOT: stalePluginRoot,
                OMC_NOTIFY: '0',
            },
            timeout: 15000,
        });
        expect(result.status).toBe(0);
        expect(result.stderr).toBe('');
        const output = JSON.parse(result.stdout);
        expect(output.continue).toBe(true);
        expect(output.systemMessage ?? '').not.toContain('[OMC UPDATE AVAILABLE]');
        expect(output.systemMessage ?? '').not.toContain('4.14.4');
        expect(output.hookSpecificOutput?.additionalContext ?? '').not.toContain('[OMC UPDATE AVAILABLE]');
    });
    it('suppresses plugin update notices when npm latest is newer than the marketplace channel', () => {
        const claudeDir = join(fakeHome, '.claude');
        const pluginRoot = join(claudeDir, 'plugins', 'cache', 'omc', 'oh-my-claudecode', '4.15.4');
        const marketplaceRoot = join(claudeDir, 'plugins', 'marketplaces', 'omc');
        mkdirSync(join(claudeDir, '.omc'), { recursive: true });
        mkdirSync(join(claudeDir, 'hud'), { recursive: true });
        mkdirSync(join(pluginRoot), { recursive: true });
        mkdirSync(join(marketplaceRoot, '.claude-plugin'), { recursive: true });
        writeFileSync(join(pluginRoot, 'package.json'), JSON.stringify({ version: '4.15.4', type: 'module' }));
        writeFileSync(join(marketplaceRoot, 'package.json'), JSON.stringify({ version: '4.15.4', type: 'module' }));
        writeFileSync(join(marketplaceRoot, '.claude-plugin', 'marketplace.json'), JSON.stringify({
            plugins: [{ name: 'oh-my-claudecode', version: '4.15.4' }],
            version: '4.15.4',
        }));
        writeFileSync(join(claudeDir, 'hud', 'omc-hud.mjs'), '');
        writeFileSync(join(claudeDir, 'settings.json'), JSON.stringify({ statusLine: 'node ~/.claude/hud/omc-hud.mjs' }));
        writeFileSync(join(claudeDir, '.omc', 'update-check.json'), JSON.stringify({
            timestamp: Date.now(),
            latestVersion: '4.15.5',
            currentVersion: '4.15.4',
            updateAvailable: true,
            source: 'npm',
        }));
        const result = spawnSync(NODE, [scriptPath], {
            input: JSON.stringify({
                hook_event_name: 'SessionStart',
                session_id: 'session-marketplace-channel-current',
                cwd: fakeProject,
            }),
            encoding: 'utf-8',
            env: {
                ...isolatedHostEnv('claude'),
                HOME: fakeHome,
                USERPROFILE: fakeHome,
                CLAUDE_PLUGIN_ROOT: pluginRoot,
                OMC_NOTIFY: '0',
            },
            timeout: 15000,
        });
        expect(result.status).toBe(0);
        expect(result.stderr).toBe('');
        const output = JSON.parse(result.stdout);
        expect(output.systemMessage ?? '').not.toContain('[OMC UPDATE AVAILABLE]');
        expect(output.systemMessage ?? '').not.toContain('4.15.5');
        expect(output.hookSpecificOutput?.additionalContext ?? '').not.toContain('[OMC UPDATE AVAILABLE]');
    });
    it('does not fall back to npm notices when marketplace metadata is unavailable', () => {
        const claudeDir = join(fakeHome, '.claude');
        const pluginRoot = join(claudeDir, 'plugins', 'cache', 'omc', 'oh-my-claudecode', '4.15.4');
        const marketplaceRoot = join(claudeDir, 'plugins', 'marketplaces', 'omc');
        mkdirSync(join(claudeDir, '.omc'), { recursive: true });
        mkdirSync(join(claudeDir, 'hud'), { recursive: true });
        mkdirSync(pluginRoot, { recursive: true });
        mkdirSync(join(marketplaceRoot, '.claude-plugin'), { recursive: true });
        writeFileSync(join(pluginRoot, 'package.json'), JSON.stringify({ version: '4.15.4', type: 'module' }));
        writeFileSync(join(marketplaceRoot, 'package.json'), JSON.stringify({ version: '999.0.0', type: 'module' }));
        writeFileSync(join(marketplaceRoot, '.claude-plugin', 'plugin.json'), JSON.stringify({
            name: 'oh-my-claudecode',
            version: '999.0.0',
        }));
        writeFileSync(join(marketplaceRoot, '.claude-plugin', 'marketplace.json'), JSON.stringify({
            plugins: [{ name: 'oh-my-claudecode', version: '999x.0.0' }],
        }));
        writeFileSync(join(claudeDir, 'hud', 'omc-hud.mjs'), '');
        writeFileSync(join(claudeDir, 'settings.json'), JSON.stringify({ statusLine: 'node ~/.claude/hud/omc-hud.mjs' }));
        writeFileSync(join(claudeDir, '.omc', 'update-check.json'), JSON.stringify({
            timestamp: Date.now(),
            latestVersion: '4.15.5',
            currentVersion: '4.15.4',
            updateAvailable: true,
            source: 'npm',
        }));
        const result = spawnSync(NODE, [scriptPath], {
            input: JSON.stringify({
                hook_event_name: 'SessionStart',
                session_id: 'session-marketplace-channel-unavailable',
                cwd: fakeProject,
            }),
            encoding: 'utf-8',
            env: {
                ...isolatedHostEnv('claude'),
                HOME: fakeHome,
                USERPROFILE: fakeHome,
                CLAUDE_PLUGIN_ROOT: pluginRoot,
                OMC_NOTIFY: '0',
            },
            timeout: 15000,
        });
        expect(result.status).toBe(0);
        expect(result.stderr).toBe('');
        const output = JSON.parse(result.stdout);
        expect(output.systemMessage ?? '').not.toContain('[OMC UPDATE AVAILABLE]');
        expect(output.systemMessage ?? '').not.toContain('4.15.5');
        expect(JSON.parse(readFileSync(join(claudeDir, '.omc', 'update-check.json'), 'utf-8'))).toMatchObject({
            latestVersion: '4.15.4',
            currentVersion: '4.15.4',
            updateAvailable: false,
            source: 'marketplace-unavailable',
        });
    });
    it('treats a stable marketplace version as newer than the matching prerelease', () => {
        const claudeDir = join(fakeHome, '.claude');
        const pluginRoot = join(claudeDir, 'plugins', 'cache', 'omc', 'oh-my-claudecode', '4.16.0-beta.1');
        const marketplaceRoot = join(claudeDir, 'plugins', 'marketplaces', 'omc');
        mkdirSync(join(claudeDir, 'hud'), { recursive: true });
        mkdirSync(pluginRoot, { recursive: true });
        mkdirSync(join(marketplaceRoot, '.claude-plugin'), { recursive: true });
        writeFileSync(join(pluginRoot, 'package.json'), JSON.stringify({ version: '4.16.0-beta.1', type: 'module' }));
        writeFileSync(join(marketplaceRoot, '.claude-plugin', 'marketplace.json'), JSON.stringify({
            plugins: [{ name: 'oh-my-claudecode', version: '4.16.0' }],
        }));
        writeFileSync(join(claudeDir, 'hud', 'omc-hud.mjs'), '');
        writeFileSync(join(claudeDir, 'settings.json'), JSON.stringify({ statusLine: 'node ~/.claude/hud/omc-hud.mjs' }));
        const result = spawnSync(NODE, [scriptPath], {
            input: JSON.stringify({
                hook_event_name: 'SessionStart',
                session_id: 'session-marketplace-stable-after-prerelease',
                cwd: fakeProject,
            }),
            encoding: 'utf-8',
            env: {
                ...isolatedHostEnv('claude'),
                HOME: fakeHome,
                USERPROFILE: fakeHome,
                CLAUDE_PLUGIN_ROOT: pluginRoot,
                OMC_NOTIFY: '0',
            },
            timeout: 15000,
        });
        expect(result.status).toBe(0);
        expect(result.stderr).toBe('');
        const output = JSON.parse(result.stdout);
        expect(output.systemMessage).toContain('[OMC UPDATE AVAILABLE]');
        expect(output.systemMessage).toContain('v4.16.0');
    });
    it('uses the marketplace clone version for plugin update notices instead of npm latest', () => {
        const claudeDir = join(fakeHome, '.claude');
        const pluginRoot = join(claudeDir, 'plugins', 'cache', 'omc', 'oh-my-claudecode', '4.15.3');
        const marketplaceRoot = join(claudeDir, 'plugins', 'marketplaces', 'omc');
        mkdirSync(join(claudeDir, '.omc'), { recursive: true });
        mkdirSync(join(claudeDir, 'hud'), { recursive: true });
        mkdirSync(join(pluginRoot), { recursive: true });
        mkdirSync(join(marketplaceRoot, '.claude-plugin'), { recursive: true });
        writeFileSync(join(pluginRoot, 'package.json'), JSON.stringify({ version: '4.15.3', type: 'module' }));
        writeFileSync(join(marketplaceRoot, '.claude-plugin', 'marketplace.json'), JSON.stringify({
            plugins: [{ name: 'oh-my-claudecode', version: '4.15.4' }],
            version: '4.15.4',
        }));
        writeFileSync(join(claudeDir, 'hud', 'omc-hud.mjs'), '');
        writeFileSync(join(claudeDir, 'settings.json'), JSON.stringify({ statusLine: 'node ~/.claude/hud/omc-hud.mjs' }));
        writeFileSync(join(claudeDir, '.omc', 'update-check.json'), JSON.stringify({
            timestamp: Date.now(),
            latestVersion: '4.15.5',
            currentVersion: '4.15.3',
            updateAvailable: true,
            source: 'npm',
        }));
        const result = spawnSync(NODE, [scriptPath], {
            input: JSON.stringify({
                hook_event_name: 'SessionStart',
                session_id: 'session-marketplace-channel-update',
                cwd: fakeProject,
            }),
            encoding: 'utf-8',
            env: {
                ...isolatedHostEnv('claude'),
                HOME: fakeHome,
                USERPROFILE: fakeHome,
                CLAUDE_PLUGIN_ROOT: pluginRoot,
                OMC_NOTIFY: '0',
            },
            timeout: 15000,
        });
        expect(result.status).toBe(0);
        expect(result.stderr).toBe('');
        const output = JSON.parse(result.stdout);
        expect(output.systemMessage).toContain('[OMC UPDATE AVAILABLE]');
        expect(output.systemMessage).toContain('v4.15.4');
        expect(output.systemMessage).not.toContain('4.15.5');
        expect(output.systemMessage).toContain('/plugin marketplace update omc && /omc-setup');
        expect(output.systemMessage).not.toContain('/update');
    });
    it('does not emit npm-channel drift guidance when managed marketplace plugin is current', () => {
        const claudeDir = join(fakeHome, '.claude');
        const pluginRoot = join(claudeDir, 'plugins', 'cache', 'omc', 'oh-my-claudecode', '4.15.4');
        const marketplaceRoot = join(claudeDir, 'plugins', 'marketplaces', 'omc');
        mkdirSync(join(claudeDir, '.omc'), { recursive: true });
        mkdirSync(join(claudeDir, 'hud'), { recursive: true });
        mkdirSync(pluginRoot, { recursive: true });
        mkdirSync(join(marketplaceRoot, '.claude-plugin'), { recursive: true });
        writeFileSync(join(pluginRoot, 'package.json'), JSON.stringify({ version: '4.15.4', type: 'module' }));
        writeFileSync(join(marketplaceRoot, '.claude-plugin', 'marketplace.json'), JSON.stringify({
            plugins: [{ name: 'oh-my-claudecode', version: '4.15.4' }],
        }));
        writeFileSync(join(claudeDir, '.omc-version.json'), JSON.stringify({ version: '4.15.5' }));
        writeFileSync(join(claudeDir, 'hud', 'omc-hud.mjs'), '');
        writeFileSync(join(claudeDir, 'settings.json'), JSON.stringify({ statusLine: 'node ~/.claude/hud/omc-hud.mjs' }));
        writeFileSync(join(claudeDir, '.omc', 'update-check.json'), JSON.stringify({
            timestamp: Date.now(),
            latestVersion: '4.15.5',
            currentVersion: '4.15.4',
            updateAvailable: true,
            source: 'npm',
        }));
        const result = spawnSync(NODE, [scriptPath], {
            input: JSON.stringify({
                hook_event_name: 'SessionStart',
                session_id: 'session-marketplace-current-npm-newer',
                cwd: fakeProject,
            }),
            encoding: 'utf-8',
            env: {
                ...isolatedHostEnv('claude'),
                HOME: fakeHome,
                USERPROFILE: fakeHome,
                CLAUDE_PLUGIN_ROOT: pluginRoot,
                OMC_NOTIFY: '0',
            },
            timeout: 15000,
        });
        expect(result.status).toBe(0);
        expect(result.stderr).toBe('');
        const output = JSON.parse(result.stdout);
        const combined = `${output.systemMessage ?? ''}\n${output.hookSpecificOutput?.additionalContext ?? ''}`;
        expect(combined).not.toContain('[OMC VERSION DRIFT DETECTED]');
        expect(combined).not.toContain("Run 'omc update'");
        expect(combined).not.toContain('4.15.5');
    });
});
describe('session-start.mjs — GitHub Copilot CLI host isolation', () => {
    let tempDir;
    let fakeHome;
    let fakeProject;
    beforeEach(() => {
        tempDir = mkdtempSync(join(tmpdir(), 'omc-session-start-copilot-'));
        fakeHome = join(tempDir, 'home');
        fakeProject = join(tempDir, 'project');
        mkdirSync(join(fakeProject, '.omc', 'state', 'sessions', 'session-copilot'), { recursive: true });
        mkdirSync(join(fakeProject, '.git'), { recursive: true });
    });
    afterEach(() => {
        removeTempDir(tempDir);
    });
    function runCopilotSessionStart(extraEnv = {}) {
        return spawnSync(NODE, [scriptPath], {
            input: JSON.stringify({
                source: 'new',
                sessionId: 'session-copilot',
                timestamp: 1700000000000,
                cwd: fakeProject,
            }),
            encoding: 'utf-8',
            env: {
                ...isolatedHostEnv('copilot'),
                HOME: fakeHome,
                USERPROFILE: fakeHome,
                OMC_NOTIFY: '0',
                ...extraEnv,
            },
            timeout: 15000,
        });
    }
    it('does not emit HUD guidance or a Claude Code restart instruction under Copilot', () => {
        const claudeDir = join(fakeHome, '.claude');
        mkdirSync(claudeDir, { recursive: true });
        // Deliberately do NOT create claudeDir/hud or settings.json, which would
        // trigger the HUD-missing message under Claude Code.
        const result = runCopilotSessionStart();
        expect(result.status).toBe(0);
        const output = JSON.parse(result.stdout);
        const context = output.additionalContext ?? '';
        expect(context).not.toContain('HUD not configured');
        expect(context).not.toContain('restart Claude Code');
    });
    it('does not emit /omc-setup guidance or CLAUDE.md drift messages under Copilot', () => {
        const claudeDir = join(fakeHome, '.claude');
        const pluginRoot = join(tempDir, 'plugin-copilot-drift');
        mkdirSync(claudeDir, { recursive: true });
        mkdirSync(pluginRoot, { recursive: true });
        writeFileSync(join(pluginRoot, 'package.json'), JSON.stringify({ version: '2.0.0', type: 'module' }));
        // Stale CLAUDE.md marker — would trigger "CLAUDE.md instructions" drift
        // under Claude Code, but Copilot never reads this file.
        writeFileSync(join(claudeDir, 'CLAUDE.md'), '<!-- OMC:VERSION:1.0.0 -->\n');
        writeFileSync(join(claudeDir, '.omc-config.json'), JSON.stringify({ silentAutoUpdate: true }));
        const result = runCopilotSessionStart({ CLAUDE_PLUGIN_ROOT: pluginRoot });
        expect(result.status).toBe(0);
        const output = JSON.parse(result.stdout);
        const combined = output.additionalContext ?? '';
        expect(combined).not.toContain('CLAUDE.md instructions');
        expect(combined).not.toContain('/omc-setup');
        expect(combined).not.toContain('silentAutoUpdate is enabled in .omc-config.json');
    });
    it('uses Copilot-specific update guidance instead of Claude Code /update or /plugin install text', () => {
        const claudeDir = join(fakeHome, '.claude');
        const pluginRoot = join(tempDir, 'plugin-copilot-update');
        mkdirSync(join(claudeDir, '.omc'), { recursive: true });
        mkdirSync(pluginRoot, { recursive: true });
        writeFileSync(join(pluginRoot, 'package.json'), JSON.stringify({ version: '1.0.0', type: 'module' }));
        writeFileSync(join(claudeDir, '.omc', 'update-check.json'), JSON.stringify({
            timestamp: Date.now(),
            latestVersion: '999.0.0',
            currentVersion: '1.0.0',
            updateAvailable: true,
        }));
        const result = runCopilotSessionStart({ CLAUDE_PLUGIN_ROOT: pluginRoot });
        expect(result.status).toBe(0);
        const output = JSON.parse(result.stdout);
        expect(output.additionalContext).toContain('[OMC UPDATE AVAILABLE]');
        expect(output.additionalContext).toContain('copilot plugin update oh-my-claudecode');
        expect(output.additionalContext).toContain('restart Copilot CLI');
        expect(output.additionalContext).not.toContain('/update');
        expect(output.additionalContext).not.toContain('/plugin install oh-my-claudecode');
    });
});
//# sourceMappingURL=session-start-script-context.test.js.map