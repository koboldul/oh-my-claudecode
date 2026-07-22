import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

export interface StagedHookRuntime {
  root: string;
  bundlePath: string;
  scriptPath(filename: string): string;
  cleanup(): void;
}

function stagedRuntime(root: string, cleanupRoot: string): StagedHookRuntime {
  return {
    root,
    bundlePath: join(root, 'bridge', 'hook-runtime.cjs'),
    scriptPath(filename: string): string {
      return join(root, 'scripts', filename);
    },
    cleanup(): void {
      rmSync(cleanupRoot, { recursive: true, force: true });
    },
  };
}

export function stageHookRuntime(
  scriptNames: readonly string[],
  repoRoot = process.cwd(),
): StagedHookRuntime {
  const cleanupRoot = mkdtempSync(join(tmpdir(), 'omc-hook-runtime-'));
  const root = join(cleanupRoot, 'plugin');
  const scriptsDir = join(root, 'scripts');

  mkdirSync(scriptsDir, { recursive: true });
  cpSync(join(repoRoot, 'scripts', 'lib'), join(scriptsDir, 'lib'), {
    recursive: true,
  });

  for (const filename of scriptNames) {
    if (basename(filename) !== filename) {
      throw new Error(`Hook script name must not contain path segments: ${filename}`);
    }
    copyFileSync(
      join(repoRoot, 'scripts', filename),
      join(scriptsDir, filename),
    );
  }

  const bundlePath = join(root, 'bridge', 'hook-runtime.cjs');
  mkdirSync(join(root, 'bridge'), { recursive: true });
  execFileSync(
    process.execPath,
    [
      join(repoRoot, 'scripts', 'build-hook-runtime.mjs'),
      '--outfile',
      bundlePath,
    ],
    {
      cwd: repoRoot,
      stdio: 'pipe',
      windowsHide: true,
    },
  );

  return stagedRuntime(root, cleanupRoot);
}

export function cloneStagedHookRuntime(
  source: StagedHookRuntime,
): StagedHookRuntime {
  const cleanupRoot = mkdtempSync(join(tmpdir(), 'omc-hook-runtime-clone-'));
  const root = join(cleanupRoot, 'plugin');
  cpSync(source.root, root, { recursive: true });
  return stagedRuntime(root, cleanupRoot);
}
