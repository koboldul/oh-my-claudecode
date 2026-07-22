import { execFileSync } from 'node:child_process';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  renameSync,
  rmSync,
  unlinkSync,
} from 'node:fs';
import { join } from 'node:path';

const WAIT_BUFFER = new Int32Array(new SharedArrayBuffer(4));
const BUILD_WAIT_MS = 30_000;

function waitForBundle(runtimePath: string, lockPath: string): void {
  const deadline = Date.now() + BUILD_WAIT_MS;
  while (!existsSync(runtimePath) && existsSync(lockPath) && Date.now() < deadline) {
    Atomics.wait(WAIT_BUFFER, 0, 0, 50);
  }

  if (!existsSync(runtimePath)) {
    throw new Error(`Timed out waiting for canonical hook runtime test bundle: ${runtimePath}`);
  }
}

export function ensureHookRuntimeBundle(repoRoot = process.cwd()): string {
  const bridgeDir = join(repoRoot, 'bridge');
  const runtimePath = join(bridgeDir, 'hook-runtime.cjs');
  if (existsSync(runtimePath)) return runtimePath;

  mkdirSync(bridgeDir, { recursive: true });
  const lockPath = join(bridgeDir, '.hook-runtime-test-build.lock');
  let lockFd: number;

  try {
    lockFd = openSync(lockPath, 'wx');
  } catch (error) {
    if (
      typeof error !== 'object'
      || error === null
      || !('code' in error)
      || error.code !== 'EEXIST'
    ) {
      throw error;
    }
    waitForBundle(runtimePath, lockPath);
    return runtimePath;
  }

  const tempPath = `${runtimePath}.${process.pid}.tmp`;
  try {
    execFileSync(
      process.execPath,
      [
        join(repoRoot, 'scripts', 'build-hook-runtime.mjs'),
        '--outfile',
        tempPath,
      ],
      {
        cwd: repoRoot,
        stdio: 'pipe',
        windowsHide: true,
      },
    );
    renameSync(tempPath, runtimePath);
  } finally {
    rmSync(tempPath, { force: true });
    try { closeSync(lockFd); } catch {
      // Best-effort cleanup for a test-only build lock.
    }
    try { unlinkSync(lockPath); } catch {
      // Another worker may already have removed the completed build lock.
    }
  }

  return runtimePath;
}
