import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearWorktreeCache } from '../../lib/worktree-paths.js';
import { stateReadTool, stateWriteTool } from '../state-tools.js';

const HOST_ENV_KEYS = [
  'CLAUDE_PLUGIN_ROOT',
  'COPILOT_CLI',
  'COPILOT_AGENT_SESSION_ID',
  'OMC_HOST',
  'OMC_STATE_DIR',
] as const;

describe('state tools from an installed plugin runtime', () => {
  let fixtureRoot: string;
  let pluginRoot: string;
  let projectRoot: string;
  let foreignProjectRoot: string;
  let originalCwd: string;
  let savedEnv: Record<(typeof HOST_ENV_KEYS)[number], string | undefined>;

  beforeEach(() => {
    fixtureRoot = mkdtempSync(join(tmpdir(), 'omc-state-installed-plugin-'));
    pluginRoot = join(fixtureRoot, 'plugin');
    projectRoot = join(fixtureRoot, 'project');
    foreignProjectRoot = join(fixtureRoot, 'foreign-project');
    originalCwd = process.cwd();
    savedEnv = Object.fromEntries(
      HOST_ENV_KEYS.map((key) => [key, process.env[key]]),
    ) as Record<(typeof HOST_ENV_KEYS)[number], string | undefined>;

    mkdirSync(join(pluginRoot, 'bridge'), { recursive: true });
    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(foreignProjectRoot, { recursive: true });
    writeFileSync(join(pluginRoot, 'bridge', 'mcp-server.cjs'), '// installed bridge');
    writeFileSync(
      join(pluginRoot, 'plugin.json'),
      JSON.stringify({ name: 'oh-my-claudecode' }),
    );
    execFileSync('git', ['init'], { cwd: projectRoot, stdio: 'pipe' });
    execFileSync('git', ['init'], { cwd: foreignProjectRoot, stdio: 'pipe' });

    for (const key of HOST_ENV_KEYS) delete process.env[key];
    process.env.COPILOT_CLI = '1';
    process.chdir(pluginRoot);
    clearWorktreeCache();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    clearWorktreeCache();
    for (const key of HOST_ENV_KEYS) {
      const value = savedEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(fixtureRoot, { recursive: true, force: true });
  });

  it('uses an explicit project root while rejecting a later foreign repository', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const writeResult = await stateWriteTool.handler({
        mode: 'ralph',
        session_id: 'installed-plugin-project',
        active: true,
        workingDirectory: projectRoot,
      });

      expect(writeResult.isError).toBeUndefined();
      expect(
        existsSync(
          join(
            projectRoot,
            '.omc',
            'state',
            'sessions',
            'installed-plugin-project',
            'ralph-state.json',
          ),
        ),
      ).toBe(true);

      const readResult = await stateReadTool.handler({
        mode: 'ralph',
        session_id: 'installed-plugin-project',
        workingDirectory: projectRoot,
      });
      expect(readResult.isError).toBeUndefined();
      expect(readResult.content[0].text).toContain('"active": true');

      const foreignResult = await stateReadTool.handler({
        mode: 'ralph',
        session_id: 'installed-plugin-project',
        workingDirectory: foreignProjectRoot,
      });
      expect(foreignResult.isError).toBe(true);
      expect(foreignResult.content[0].text).toContain(
        'belongs to a different repository',
      );
      expect(existsSync(join(foreignProjectRoot, '.omc'))).toBe(false);
    } finally {
      errorSpy.mockRestore();
    }
  });
});
