import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  COPILOT_HOOKS_JSON_PATH,
  COPILOT_NATIVE_HOOK_EVENTS,
  COPILOT_PLUGIN_JSON_PATH,
  MCP_JSON_PATH,
  PACKAGE_ROOT,
  PLUGIN_JSON_PATH,
  listSourceControlledPackageFiles,
  readPluginMcpServers,
  referencesCopilotHooksManifest,
  referencesRootMcpConfig,
  referencesStandardHooksManifest,
  type PluginJson,
} from './npm-package-surface-helpers.js';

describe('npm package hook surface regression', () => {
  it('builds generated hook runtimes for packaging without mutating ordinary test entrypoints', () => {
    const packageJson = JSON.parse(
      readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf-8'),
    ) as {
      files?: string[];
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.build).toMatch(
      /npm run compose-docs && npm run build:claude-md-coordinator/,
    );
    expect(packageJson.scripts?.build).toContain('npm run build:hook-runtime');
    expect(packageJson.scripts?.['build:hook-runtime']).toBe(
      'node scripts/build-hook-runtime.mjs',
    );
    expect(
      existsSync(join(PACKAGE_ROOT, 'scripts', 'build-hook-runtime.mjs')),
    ).toBe(true);
    expect(
      existsSync(
        join(PACKAGE_ROOT, 'scripts', 'lib', 'hook-runtime-loader.mjs'),
      ),
    ).toBe(true);
    expect(
      existsSync(
        join(PACKAGE_ROOT, 'src', 'hooks', 'hook-runtime-entry.ts'),
      ),
    ).toBe(true);
    for (const entrypoint of ['test', 'test:ui', 'test:run', 'test:coverage']) {
      expect(packageJson.scripts?.[entrypoint], entrypoint).not.toContain(
        'build:claude-md-coordinator',
      );
      expect(packageJson.scripts?.[entrypoint], entrypoint).not.toContain(
        'build:hook-runtime',
      );
    }
    expect(packageJson.scripts?.prepack).toBe('npm run build');
    expect(packageJson.scripts?.prepublishOnly).toBe('npm run build');
    expect(packageJson.files).toEqual(
      expect.arrayContaining([
        '.claude-plugin',
        '.mcp.json',
        'bridge',
        'hooks',
        'scripts',
        'templates',
      ]),
    );
  });

  it('keeps the source-controlled plugin and MCP manifests wired to exact standard entrypoints', () => {
    expect(existsSync(PLUGIN_JSON_PATH)).toBe(true);
    expect(existsSync(COPILOT_PLUGIN_JSON_PATH)).toBe(true);
    expect(existsSync(COPILOT_HOOKS_JSON_PATH)).toBe(true);
    expect(existsSync(MCP_JSON_PATH)).toBe(true);

    const claudePluginJson = JSON.parse(
      readFileSync(PLUGIN_JSON_PATH, 'utf-8'),
    ) as PluginJson;
    const copilotPluginJson = JSON.parse(
      readFileSync(COPILOT_PLUGIN_JSON_PATH, 'utf-8'),
    ) as PluginJson;
    const copilotHooksJson = JSON.parse(
      readFileSync(COPILOT_HOOKS_JSON_PATH, 'utf-8'),
    ) as {
      version?: number;
      hooks?: Record<string, Array<Record<string, unknown>>>;
    };
    expect(referencesStandardHooksManifest(claudePluginJson.hooks)).toBe(true);
    expect(referencesCopilotHooksManifest(copilotPluginJson.hooks)).toBe(true);
    expect(referencesRootMcpConfig(claudePluginJson.mcpServers)).toBe(true);
    expect(referencesRootMcpConfig(copilotPluginJson.mcpServers)).toBe(true);
    expect(copilotHooksJson.version).toBe(1);
    expect(Object.keys(copilotHooksJson.hooks ?? {})).toEqual(
      COPILOT_NATIVE_HOOK_EVENTS,
    );
    expect(
      Object.values(copilotHooksJson.hooks ?? {})
        .flat()
        .some((entry) => Array.isArray(entry.hooks)),
    ).toBe(false);

    expect(Object.values(readPluginMcpServers())).toEqual([
      {
        command: 'node',
        args: ['${CLAUDE_PLUGIN_ROOT}/bridge/mcp-server.cjs'],
      },
    ]);
  });

  it('keeps the complete hook dependency and template payload source-controlled', () => {
    const requiredFiles = listSourceControlledPackageFiles();

    expect(requiredFiles).toContain('commands/omc-setup.md');
    expect(requiredFiles).not.toHaveLength(0);
    expect(
      requiredFiles.filter((file) => !existsSync(join(PACKAGE_ROOT, file))),
    ).toEqual([]);
  });
});
