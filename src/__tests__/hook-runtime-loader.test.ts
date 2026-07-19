import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const REPO_ROOT = process.cwd();
const LOADER_PATH = join(
  REPO_ROOT,
  'scripts',
  'lib',
  'hook-runtime-loader.mjs',
);

interface HookRuntimeLoaderModule {
  REQUIRED_HOOK_RUNTIME_EXPORTS: readonly string[];
  loadHookRuntime(options?: {
    pluginRoot?: string;
    testBundlePath?: string;
  }): Record<string, unknown>;
}

const loader = await import(
  pathToFileURL(LOADER_PATH).href
) as unknown as HookRuntimeLoaderModule;

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function makeTempPluginRoot(): {
  container: string;
  pluginRoot: string;
  loaderPath: string;
  bundlePath: string;
} {
  const container = mkdtempSync(join(tmpdir(), 'omc-hook-runtime-loader-'));
  tempRoots.push(container);

  const pluginRoot = join(container, 'plugin root with spaces');
  const loaderPath = join(
    pluginRoot,
    'scripts',
    'lib',
    'hook-runtime-loader.mjs',
  );
  const bundlePath = join(pluginRoot, 'bridge', 'hook-runtime.cjs');
  mkdirSync(dirname(loaderPath), { recursive: true });
  mkdirSync(dirname(bundlePath), { recursive: true });
  copyFileSync(LOADER_PATH, loaderPath);

  return { container, pluginRoot, loaderPath, bundlePath };
}

function validBundleSource(marker = 'loaded'): string {
  const functions = loader.REQUIRED_HOOK_RUNTIME_EXPORTS.map(
    (name) => `${JSON.stringify(name)}() {}`,
  );
  return `module.exports = {\n  ${functions.join(',\n  ')},\n  marker: ${JSON.stringify(marker)}\n};\n`;
}

function runLoaderProbe(
  loaderPath: string,
  body: string,
  args: string[] = [],
  envOverrides: NodeJS.ProcessEnv = {},
) {
  const emptyNodeModules = join(dirname(loaderPath), 'empty-node-modules');
  mkdirSync(emptyNodeModules);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_PATH: emptyNodeModules,
    ...envOverrides,
  };
  if (!Object.hasOwn(envOverrides, 'CLAUDE_PLUGIN_ROOT')) {
    delete env.CLAUDE_PLUGIN_ROOT;
  }

  return spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
        const loader = await import(process.argv[1]);
        ${body}
      `,
      pathToFileURL(loaderPath).href,
      ...args,
    ],
    {
      cwd: dirname(loaderPath),
      encoding: 'utf8',
      env,
    },
  );
}

describe('hook runtime loader', () => {
  it('loads the plugin-relative bundle from a path with spaces without node_modules', () => {
    const fixture = makeTempPluginRoot();
    writeFileSync(fixture.bundlePath, validBundleSource('plugin-relative'));

    expect(existsSync(join(fixture.pluginRoot, 'node_modules'))).toBe(false);
    const result = runLoaderProbe(
      fixture.loaderPath,
      `
        const runtime = loader.loadHookRuntime();
        process.stdout.write(String(runtime.marker));
      `,
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('plugin-relative');
    expect(result.stderr).toBe('');
  });

  it('supports an explicit test-only bundle path override', () => {
    const fixture = makeTempPluginRoot();
    const overridePath = join(
      fixture.container,
      'test bundle with spaces',
      'hook-runtime.cjs',
    );
    mkdirSync(dirname(overridePath), { recursive: true });
    writeFileSync(overridePath, validBundleSource('test-override'));

    const result = runLoaderProbe(
      fixture.loaderPath,
      `
        const runtime = loader.loadHookRuntime({
          testBundlePath: process.argv[2],
        });
        process.stdout.write(String(runtime.marker));
      `,
      [overridePath],
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('test-override');
    expect(result.stderr).toBe('');
  });

  it('allows an explicit plugin root to select another bundle', () => {
    const fixture = makeTempPluginRoot();
    const explicitRoot = join(fixture.container, 'explicit plugin root');
    const explicitBundle = join(explicitRoot, 'bridge', 'hook-runtime.cjs');
    mkdirSync(dirname(explicitBundle), { recursive: true });
    writeFileSync(explicitBundle, validBundleSource('explicit-root'));

    const result = runLoaderProbe(
      fixture.loaderPath,
      `
        const runtime = loader.loadHookRuntime({
          pluginRoot: process.argv[2],
        });
        process.stdout.write(String(runtime.marker));
      `,
      [explicitRoot],
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('explicit-root');
    expect(result.stderr).toBe('');
  });

  it('ignores a stale CLAUDE_PLUGIN_ROOT when a colocated bundle exists', () => {
    const fixture = makeTempPluginRoot();
    const staleRoot = join(fixture.container, 'stale plugin root');
    const staleBundle = join(staleRoot, 'bridge', 'hook-runtime.cjs');
    mkdirSync(dirname(staleBundle), { recursive: true });
    writeFileSync(fixture.bundlePath, validBundleSource('colocated'));
    writeFileSync(staleBundle, validBundleSource('stale-environment'));

    const result = runLoaderProbe(
      fixture.loaderPath,
      `
        const runtime = loader.loadHookRuntime();
        process.stdout.write(String(runtime.marker));
      `,
      [],
      { CLAUDE_PLUGIN_ROOT: staleRoot },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('colocated');
    expect(result.stderr).toBe('');
  });

  it('rejects missing and corrupt bundles without a legacy fallback', () => {
    const fixture = makeTempPluginRoot();

    expect(() => loader.loadHookRuntime({
      testBundlePath: fixture.bundlePath,
    })).toThrow(/bundle is missing/);

    writeFileSync(fixture.bundlePath, 'module.exports = {\n');
    expect(() => loader.loadHookRuntime({
      testBundlePath: fixture.bundlePath,
    })).toThrow(/failed to load/);
  });

  it('rejects bundles that omit any required wrapper export', () => {
    const fixture = makeTempPluginRoot();
    const missingExport = loader.REQUIRED_HOOK_RUNTIME_EXPORTS.at(-1);
    const incompleteExports = loader.REQUIRED_HOOK_RUNTIME_EXPORTS
      .slice(0, -1)
      .map((name) => `${JSON.stringify(name)}() {}`)
      .join(',\n');
    writeFileSync(
      fixture.bundlePath,
      `module.exports = {\n${incompleteExports}\n};\n`,
    );

    expect(() => loader.loadHookRuntime({
      testBundlePath: fixture.bundlePath,
    })).toThrow(
      new RegExp(`missing required exports: ${missingExport}`),
    );
  });

  it.each(['preToolUse', 'PermissionRequest', 'Stop'])(
    'surfaces a nonzero failure for behavior-critical %s hooks',
    (hookName) => {
      const fixture = makeTempPluginRoot();
      const result = runLoaderProbe(
        fixture.loaderPath,
        `
          loader.surfaceCriticalHookFailure(
            new Error('bundle unavailable'),
            { hookName: process.argv[2] },
          );
        `,
        [hookName],
      );

      expect(result.status).toBe(2);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain(`[${hookName}]`);
      expect(result.stderr).toContain('refusing to continue silently');
    },
  );

  it('emits a visible fail-open output for an optional hook failure', () => {
    const fixture = makeTempPluginRoot();
    const result = runLoaderProbe(
      fixture.loaderPath,
      `
        loader.surfaceOptionalHookFailure(
          new Error('bundle unavailable'),
          { hookName: 'sessionStart' },
        );
      `,
    );

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ continue: true });
    expect(result.stderr).toContain('[sessionStart]');
    expect(result.stderr).toContain(
      'continuing without optional hook behavior',
    );
  });
});
