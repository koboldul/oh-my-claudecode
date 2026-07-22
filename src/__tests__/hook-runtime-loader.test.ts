import { spawn, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
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
const NOTIFICATION_CHILD_PATH = join(
  REPO_ROOT,
  'scripts',
  'lib',
  'notification-child.cjs',
);

interface HookRuntimeLoaderModule {
  REQUIRED_HOOK_RUNTIME_EXPORTS: readonly string[];
  loadHookRuntime(options?: {
    pluginRoot?: string;
    testBundlePath?: string;
  }): Record<string, unknown>;
  loadHookRuntimeAsync(options?: {
    pluginRoot?: string;
    testBundlePath?: string;
  }): Promise<Record<string, unknown>>;
  resolveHookNotificationChildPath(options?: {
    pluginRoot?: string;
  }): string;
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

function buildNotificationMarkerRuntime(
  fixture: ReturnType<typeof makeTempPluginRoot>,
  markerPath: string,
): {
  childPath: string;
  runtimePath: string;
} {
  const childPath = loader.resolveHookNotificationChildPath({
    pluginRoot: fixture.pluginRoot,
  });
  mkdirSync(dirname(childPath), { recursive: true });
  copyFileSync(NOTIFICATION_CHILD_PATH, childPath);
  const build = spawnSync(
    process.execPath,
    [
      join(REPO_ROOT, 'scripts', 'build-hook-runtime.mjs'),
      '--outfile',
      fixture.bundlePath,
    ],
    {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    },
  );
  expect(build.status, build.stderr).toBe(0);

  const runtimePath = join(
    dirname(fixture.bundlePath),
    'notification-marker-runtime.cjs',
  );
  writeFileSync(
    runtimePath,
    [
      "'use strict';",
      `const base = require(${JSON.stringify(fixture.bundlePath)});`,
      "const { appendFileSync } = require('node:fs');",
      'module.exports = {',
      '  ...base,',
      '  async runHookNotificationChild(event, data) {',
      `    appendFileSync(${JSON.stringify(markerPath)},`,
      "      `${event}:${data.sessionId}\\n`, 'utf8');",
      '  },',
      '};',
      '',
    ].join('\n'),
    'utf8',
  );
  return { childPath, runtimePath };
}

function waitForChildExit(
  child: ReturnType<typeof spawn>,
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      resolve({ code, signal });
    });
  });
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
  if (!Object.hasOwn(envOverrides, 'OMC_HOST')) {
    delete env.OMC_HOST;
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
  it('requires the shipped wrapper runtime exports', () => {
    expect(loader.REQUIRED_HOOK_RUNTIME_EXPORTS).toEqual(
      expect.arrayContaining([
        'encodeLegacyCompatibleHookOutput',
        'loadPreToolBatchSnapshot',
        'planPreToolBatch',
        'reserveAndPlanPreToolBatch',
        'commitPreToolEffects',
        'finalizePreToolReduction',
        'encodePreToolEnforcerOutput',
        'runHookNotificationChild',
      ]),
    );
  });

  it('bundles every required runtime export from the TypeScript entrypoint', () => {
    const fixture = makeTempPluginRoot();
    const result = spawnSync(
      process.execPath,
      [
        join(REPO_ROOT, 'scripts', 'build-hook-runtime.mjs'),
        '--outfile',
        fixture.bundlePath,
      ],
      {
        cwd: REPO_ROOT,
        encoding: 'utf8',
      },
    );

    expect(result.status, result.stderr).toBe(0);
    const runtime = loader.loadHookRuntime({
      testBundlePath: fixture.bundlePath,
    });
    for (const name of loader.REQUIRED_HOOK_RUNTIME_EXPORTS) {
      expect(runtime[name], name).toBeTypeOf('function');
    }
  });

  it('loads and validates a CommonJS runtime asynchronously', async () => {
    const fixture = makeTempPluginRoot();
    writeFileSync(fixture.bundlePath, validBundleSource('async-loaded'));

    await expect(loader.loadHookRuntimeAsync({
      testBundlePath: fixture.bundlePath,
    })).resolves.toMatchObject({ marker: 'async-loaded' });
  });

  it('does not invoke the bundled notification runner without an IPC gate', () => {
    const fixture = makeTempPluginRoot();
    const markerPath = join(fixture.container, 'no-gate.log');
    const { childPath, runtimePath } =
      buildNotificationMarkerRuntime(fixture, markerPath);
    const result = spawnSync(
      process.execPath,
      [
        childPath,
        runtimePath,
        JSON.stringify('ask-user-question'),
        JSON.stringify({
          sessionId: 'bundle-notification-session',
          projectPath: fixture.pluginRoot,
          question: 'Continue?',
        }),
        'no-gate-intent',
        'no-gate-claim',
      ],
      {
        cwd: fixture.pluginRoot,
        encoding: 'utf8',
        timeout: 10_000,
        windowsHide: true,
      },
    );

    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(markerPath)).toBe(false);
  });

  it('does not invoke the bundled notification runner for a wrong gate', async () => {
    const fixture = makeTempPluginRoot();
    const markerPath = join(fixture.container, 'wrong-gate.log');
    const { childPath, runtimePath } =
      buildNotificationMarkerRuntime(fixture, markerPath);
    const child = spawn(
      process.execPath,
      [
        childPath,
        runtimePath,
        JSON.stringify('ask-user-question'),
        JSON.stringify({
          sessionId: 'bundle-notification-session',
          projectPath: fixture.pluginRoot,
          question: 'Continue?',
        }),
        'expected-intent',
        'expected-claim',
      ],
      {
        cwd: fixture.pluginRoot,
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        windowsHide: true,
      },
    );
    child.once('spawn', () => {
      child.send({
        type: 'omc.notification.dispatch.v1',
        intentId: 'wrong-intent',
        claimId: 'expected-claim',
      }, () => {
        if (child.connected) child.disconnect();
      });
    });
    const result = await waitForChildExit(child);

    expect(result).toEqual({ code: 0, signal: null });
    expect(existsSync(markerPath)).toBe(false);
  });

  it('does not invoke the bundled notification runner when the IPC gate times out', async () => {
    const fixture = makeTempPluginRoot();
    const markerPath = join(fixture.container, 'gate-timeout.log');
    const { childPath, runtimePath } =
      buildNotificationMarkerRuntime(fixture, markerPath);
    const child = spawn(
      process.execPath,
      [
        childPath,
        runtimePath,
        JSON.stringify('ask-user-question'),
        JSON.stringify({
          sessionId: 'bundle-notification-session',
          projectPath: fixture.pluginRoot,
          question: 'Continue?',
        }),
        'timeout-intent',
        'timeout-claim',
      ],
      {
        cwd: fixture.pluginRoot,
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        windowsHide: true,
      },
    );
    const result = await waitForChildExit(child);

    expect(result).toEqual({ code: 0, signal: null });
    expect(existsSync(markerPath)).toBe(false);
  }, 10_000);

  it('invokes the bundled notification runner once for the matching gate', async () => {
    const fixture = makeTempPluginRoot();
    const markerPath = join(fixture.container, 'matching-gate.log');
    const { childPath, runtimePath } =
      buildNotificationMarkerRuntime(fixture, markerPath);
    const child = spawn(
      process.execPath,
      [
        childPath,
        runtimePath,
        JSON.stringify('ask-user-question'),
        JSON.stringify({
          sessionId: 'bundle-notification-session',
          projectPath: fixture.pluginRoot,
          question: 'Continue?',
        }),
        'matching-intent',
        'matching-claim',
      ],
      {
        cwd: fixture.pluginRoot,
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        windowsHide: true,
      },
    );
    child.once('spawn', () => {
      child.send({
        type: 'omc.notification.dispatch.v1',
        intentId: 'matching-intent',
        claimId: 'matching-claim',
      }, () => {
        if (child.connected) child.disconnect();
      });
    });
    const result = await waitForChildExit(child);

    expect(result).toEqual({ code: 0, signal: null });
    expect(readFileSync(markerPath, 'utf8')).toBe(
      'ask-user-question:bundle-notification-session\n',
    );
  });

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

  it.each([
    ['unset', undefined, '{"continue":true}\n'],
    ['claude', 'claude', '{"continue":true}\n'],
    ['copilot', 'copilot', '{}\n'],
    ['unknown', 'custom-host', '{"continue":true}\n'],
  ])(
    'emits the %s host fail-open output for an optional hook failure',
    (_label, host, expectedStdout) => {
      const fixture = makeTempPluginRoot();
      const result = runLoaderProbe(
        fixture.loaderPath,
        `
          loader.surfaceOptionalHookFailure(
            new Error('bundle unavailable'),
            { hookName: 'sessionStart' },
          );
        `,
        [],
        host === undefined ? {} : { OMC_HOST: host },
      );

      expect(result.status).toBe(0);
      expect(result.stdout).toBe(expectedStdout);
      expect(result.stderr).toContain('[sessionStart]');
      expect(result.stderr).toContain(
        'continuing without optional hook behavior',
      );
    },
  );
});
