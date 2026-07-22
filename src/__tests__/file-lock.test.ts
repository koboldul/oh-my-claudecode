import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { closeSync, mkdirSync, rmSync, existsSync, readFileSync, unlinkSync, writeFileSync, utimesSync } from 'fs';
import { spawn, spawnSync, type ChildProcess } from 'child_process';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  acquireFileLockSync,
  releaseFileLockSync,
  withFileLockSync,
  acquireFileLock,
  releaseFileLock,
  withFileLock,
  lockPathFor,
} from '../lib/file-lock.js';
import { getProcessStartIdentitySync } from '../platform/process-utils.js';

async function waitForPaths(
  paths: string[],
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!paths.every((path) => existsSync(path))) {
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for: ${paths.join(', ')}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function waitForChild(child: ChildProcess): Promise<number | null> {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });
}

describe('file-lock', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(
      tmpdir(),
      `file-lock-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    delete process.env.OMC_TEST_FILE_LOCK_PROCESS_START_UNKNOWN_PID;
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  function currentOwner(timestamp = Date.now()) {
    const processStartIdentity = getProcessStartIdentitySync(process.pid);
    if (
      processStartIdentity === null
      || processStartIdentity === 'absent'
    ) {
      throw new Error('current process identity unavailable');
    }
    return {
      version: 2,
      pid: process.pid,
      processStartIdentity,
      nonce: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      timestamp,
    };
  }

  describe('lockPathFor', () => {
    it('should append .lock to the file path', () => {
      expect(lockPathFor('/path/to/file.json')).toBe('/path/to/file.json.lock');
    });
  });

  describe('acquireFileLockSync / releaseFileLockSync', () => {
    it('should acquire and release a lock successfully', () => {
      const lockPath = join(testDir, 'test.lock');
      const handle = acquireFileLockSync(lockPath);

      expect(handle).not.toBeNull();
      expect(existsSync(lockPath)).toBe(true);

      // Verify lock payload contains PID
      const payload = JSON.parse(readFileSync(lockPath, 'utf-8'));
      const processStartIdentity = getProcessStartIdentitySync(process.pid);
      expect(processStartIdentity).not.toBeNull();
      expect(processStartIdentity).not.toBe('absent');
      expect(payload.version).toBe(2);
      expect(payload.pid).toBe(process.pid);
      expect(payload.processStartIdentity).toBe(processStartIdentity);
      expect(payload.nonce).toMatch(/^[0-9a-f-]{36}$/i);
      expect(payload.timestamp).toBeGreaterThan(0);

      releaseFileLockSync(handle!);
      expect(existsSync(lockPath)).toBe(false);
    });

    it('should fail to acquire when lock is already held', () => {
      const lockPath = join(testDir, 'test.lock');
      const handle1 = acquireFileLockSync(lockPath);
      expect(handle1).not.toBeNull();

      // Second attempt should fail (same process, but O_EXCL prevents it)
      const handle2 = acquireFileLockSync(lockPath);
      expect(handle2).toBeNull();

      releaseFileLockSync(handle1!);
    });

    it('should fail closed when current process identity is unavailable', () => {
      const lockPath = join(testDir, 'identity-unavailable.lock');
      process.env.OMC_TEST_FILE_LOCK_PROCESS_START_UNKNOWN_PID =
        String(process.pid);
      try {
        expect(acquireFileLockSync(lockPath)).toBeNull();
        expect(existsSync(lockPath)).toBe(false);
      } finally {
        delete process.env.OMC_TEST_FILE_LOCK_PROCESS_START_UNKNOWN_PID;
      }
    });

    it('should reap stale lock from dead PID', () => {
      const lockPath = join(testDir, 'test.lock');

      // Create a fake lock file with a dead PID
      writeFileSync(
        lockPath,
        JSON.stringify({
          version: 2,
          pid: 999999999,
          processStartIdentity: '1',
          nonce: '00000000-0000-4000-8000-000000000000',
          timestamp: Date.now() - 60_000,
        }),
      );

      // Backdate the file's mtime so it looks old to stat()
      const oldTime = new Date(Date.now() - 60_000);
      utimesSync(lockPath, oldTime, oldTime);

      // Should reap the stale lock and succeed
      const handle = acquireFileLockSync(lockPath, { staleLockMs: 1000 });
      expect(handle).not.toBeNull();

      releaseFileLockSync(handle!);
    });

    it('does not reclaim or unlink a successor while the reclamation guard is held', () => {
      const lockPath = join(testDir, 'guarded-reclaim.lock');
      const guardPath = `${lockPath}.reclaim.guard`;
      const successor = JSON.stringify({
        version: 2,
        pid: 999999999,
        processStartIdentity: '1',
        nonce: '44444444-4444-4444-8444-444444444444',
        timestamp: Date.now() - 60_000,
      });
      writeFileSync(lockPath, successor);
      const oldTime = new Date(Date.now() - 60_000);
      utimesSync(lockPath, oldTime, oldTime);
      writeFileSync(guardPath, 'reclamation in progress');

      expect(acquireFileLockSync(lockPath, { staleLockMs: 1000 }))
        .toBeNull();
      expect(readFileSync(lockPath, 'utf8')).toBe(successor);

      unlinkSync(guardPath);
      const handle = acquireFileLockSync(lockPath, { staleLockMs: 1000 });
      expect(handle).not.toBeNull();
      releaseFileLockSync(handle!);
    });

    it('recovers an authenticated stale reclamation guard', () => {
      const lockPath = join(testDir, 'stale-guard.lock');
      const guardPath = `${lockPath}.reclaim.guard`;
      writeFileSync(guardPath, JSON.stringify({
        version: 2,
        pid: 999999999,
        processStartIdentity: '1',
        nonce: '55555555-5555-4555-8555-555555555555',
        timestamp: Date.now() - 60_000,
      }));
      const oldTime = new Date(Date.now() - 60_000);
      utimesSync(guardPath, oldTime, oldTime);

      const handle = acquireFileLockSync(lockPath, { staleLockMs: 1000 });

      expect(handle).not.toBeNull();
      expect(existsSync(guardPath)).toBe(false);
      releaseFileLockSync(handle!);
    });

    it('recovers an authenticated recovery barrier orphaned by a crashed owner', () => {
      const lockPath = join(testDir, 'crashed-recovery-owner.lock');
      const recoveryPath = `${lockPath}.reclaim.guard.recover`;
      const processUtilsUrl =
        new URL('../platform/process-utils.ts', import.meta.url).href;
      const child = spawnSync(
        process.execPath,
        [
          '--import',
          'tsx',
          '--input-type=module',
          '-e',
          `
            import { writeFileSync } from 'node:fs';
            import { randomUUID } from 'node:crypto';
            import { getProcessStartIdentitySync } from ${JSON.stringify(processUtilsUrl)};
            const identity = getProcessStartIdentitySync(process.pid);
            if (identity === null || identity === 'absent') process.exit(91);
            writeFileSync(
              ${JSON.stringify(recoveryPath)},
              JSON.stringify({
                version: 2,
                pid: process.pid,
                processStartIdentity: identity,
                nonce: randomUUID(),
                timestamp: Date.now(),
              }),
              { mode: 0o600 },
            );
            process.exit(23);
          `,
        ],
        {
          cwd: process.cwd(),
          encoding: 'utf8',
          timeout: 10_000,
          windowsHide: true,
        },
      );
      expect(child.status, child.stderr).toBe(23);
      const oldTime = new Date(Date.now() - 60_000);
      utimesSync(recoveryPath, oldTime, oldTime);

      const handle = acquireFileLockSync(lockPath, { staleLockMs: 1000 });

      expect(handle).not.toBeNull();
      expect(existsSync(recoveryPath)).toBe(false);
      releaseFileLockSync(handle!);
    });

    it('recovers an orphaned recovery reaper claim without another fixed barrier', () => {
      const lockPath = join(testDir, 'orphaned-reaper-claim.lock');
      const recoveryPath = `${lockPath}.reclaim.guard.recover`;
      const claimPath =
        `${recoveryPath}.reaper.77777777-7777-4777-8777-777777777777`;
      const staleOwner = JSON.stringify({
        version: 2,
        pid: 999999999,
        processStartIdentity: '1',
        nonce: '77777777-7777-4777-8777-777777777777',
        timestamp: Date.now() - 60_000,
      });
      writeFileSync(recoveryPath, staleOwner);
      writeFileSync(claimPath, staleOwner);
      const oldTime = new Date(Date.now() - 60_000);
      utimesSync(recoveryPath, oldTime, oldTime);
      utimesSync(claimPath, oldTime, oldTime);

      const handle = acquireFileLockSync(lockPath, { staleLockMs: 1000 });

      expect(handle).not.toBeNull();
      expect(existsSync(recoveryPath)).toBe(false);
      expect(existsSync(claimPath)).toBe(false);
      releaseFileLockSync(handle!);
    });

    it('ignores an incomplete unpublished reaper claim left by a crash', () => {
      const lockPath = join(testDir, 'partial-reaper-publication.lock');
      const recoveryPath = `${lockPath}.reclaim.guard.recover`;
      const nonce = '78787878-7878-4787-8787-787878787878';
      const publicationPath = join(
        testDir,
        `.partial-reaper-publication.lock.reclaim.guard.recover.reaper.${nonce}.publish.${nonce}.tmp`,
      );
      writeFileSync(recoveryPath, JSON.stringify({
        version: 2,
        pid: 999999999,
        processStartIdentity: '1',
        nonce,
        timestamp: Date.now() - 60_000,
      }));
      writeFileSync(publicationPath, '{"version":2');
      const oldTime = new Date(Date.now() - 60_000);
      utimesSync(recoveryPath, oldTime, oldTime);
      utimesSync(publicationPath, oldTime, oldTime);

      const handle = acquireFileLockSync(lockPath, { staleLockMs: 1000 });

      expect(handle).not.toBeNull();
      expect(existsSync(publicationPath)).toBe(true);
      releaseFileLockSync(handle!);
    });

    it('does not reclaim a live authenticated recovery barrier', () => {
      const lockPath = join(testDir, 'live-recovery-owner.lock');
      const recoveryPath = `${lockPath}.reclaim.guard.recover`;
      const original = JSON.stringify(currentOwner(Date.now() - 60_000));
      writeFileSync(recoveryPath, original);
      const oldTime = new Date(Date.now() - 60_000);
      utimesSync(recoveryPath, oldTime, oldTime);

      expect(acquireFileLockSync(lockPath, {
        timeoutMs: 50,
        retryDelayMs: 5,
        staleLockMs: 1000,
      })).toBeNull();
      expect(readFileSync(recoveryPath, 'utf8')).toBe(original);
    });

    it('does not reclaim malformed recovery barrier ownership', () => {
      const lockPath = join(testDir, 'malformed-recovery-owner.lock');
      const recoveryPath = `${lockPath}.reclaim.guard.recover`;
      writeFileSync(recoveryPath, '{"pid":999999999}');
      const oldTime = new Date(Date.now() - 60_000);
      utimesSync(recoveryPath, oldTime, oldTime);

      expect(acquireFileLockSync(lockPath, { staleLockMs: 1000 }))
        .toBeNull();
      expect(readFileSync(recoveryPath, 'utf8'))
        .toBe('{"pid":999999999}');
    });

    it('does not reclaim recovery barriers with implausibly future mtimes', () => {
      const lockPath = join(testDir, 'future-recovery-mtime.lock');
      const recoveryPath = `${lockPath}.reclaim.guard.recover`;
      const original = JSON.stringify({
        version: 2,
        pid: 999999999,
        processStartIdentity: '1',
        nonce: '88888888-8888-4888-8888-888888888888',
        timestamp: Date.now() - 60_000,
      });
      writeFileSync(recoveryPath, original);
      const future = new Date(Date.now() + 10 * 60_000);
      utimesSync(recoveryPath, future, future);

      expect(acquireFileLockSync(lockPath, { staleLockMs: 1000 }))
        .toBeNull();
      expect(readFileSync(recoveryPath, 'utf8')).toBe(original);
    });

    it('reclaims a recovery barrier after authenticated PID reuse', () => {
      const lockPath = join(testDir, 'reused-recovery-owner.lock');
      const recoveryPath = `${lockPath}.reclaim.guard.recover`;
      const processStartIdentity = getProcessStartIdentitySync(process.pid);
      expect(processStartIdentity).not.toBeNull();
      expect(processStartIdentity).not.toBe('absent');
      writeFileSync(recoveryPath, JSON.stringify({
        version: 2,
        pid: process.pid,
        processStartIdentity:
          processStartIdentity === '1' ? '2' : '1',
        nonce: '99999999-9999-4999-8999-999999999999',
        timestamp: Date.now() - 60_000,
      }));
      const oldTime = new Date(Date.now() - 60_000);
      utimesSync(recoveryPath, oldTime, oldTime);

      const handle = acquireFileLockSync(lockPath, { staleLockMs: 1000 });

      expect(handle).not.toBeNull();
      expect(existsSync(recoveryPath)).toBe(false);
      releaseFileLockSync(handle!);
    });

    it('only lets the exact recovery barrier owner release its generation', () => {
      const recoveryPath =
        `${join(testDir, 'owned-recovery-release.lock')}.reclaim.guard.recover`;
      const handle = acquireFileLockSync(recoveryPath);
      expect(handle).not.toBeNull();
      closeSync(handle!.fd);
      unlinkSync(recoveryPath);
      const replacement = JSON.stringify({
        version: 2,
        pid: process.pid,
        processStartIdentity: handle!.owner.processStartIdentity,
        nonce: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        timestamp: Date.now(),
      });
      writeFileSync(recoveryPath, replacement);

      releaseFileLockSync(handle!);

      expect(readFileSync(recoveryPath, 'utf8')).toBe(replacement);
    });

    it('serializes concurrent recovery reapers without removing a successor generation', async () => {
      const lockPath = join(testDir, 'concurrent-recovery-reapers.lock');
      const guardPath = `${lockPath}.reclaim.guard`;
      const recoveryPath = `${lockPath}.reclaim.guard.recover`;
      const staleOwner = JSON.stringify({
        version: 2,
        pid: 999999999,
        processStartIdentity: '1',
        nonce: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        timestamp: Date.now() - 60_000,
      });
      writeFileSync(guardPath, staleOwner);
      writeFileSync(recoveryPath, staleOwner);
      const oldTime = new Date(Date.now() - 60_000);
      utimesSync(guardPath, oldTime, oldTime);
      utimesSync(recoveryPath, oldTime, oldTime);

      const startPath = join(testDir, 'concurrent-reapers.start');
      const releasePath = join(testDir, 'concurrent-reapers.release');
      const fileLockUrl = new URL('../lib/file-lock.ts', import.meta.url).href;
      const children = [0, 1].map((index) => {
        const readyPath = join(testDir, `concurrent-reaper-${index}.ready`);
        const resultPath = join(testDir, `concurrent-reaper-${index}.json`);
        const script = `
          import { existsSync, writeFileSync } from 'node:fs';
          import {
            acquireFileLockSync,
            releaseFileLockSync,
          } from ${JSON.stringify(fileLockUrl)};
          const waitBuffer = new SharedArrayBuffer(4);
          const wait = (ms) =>
            Atomics.wait(new Int32Array(waitBuffer), 0, 0, ms);
          writeFileSync(${JSON.stringify(readyPath)}, '');
          while (!existsSync(${JSON.stringify(startPath)})) wait(5);
          const handle = acquireFileLockSync(
            ${JSON.stringify(lockPath)},
            { timeoutMs: 1000, retryDelayMs: 5, staleLockMs: 1000 },
          );
          writeFileSync(
            ${JSON.stringify(resultPath)},
            JSON.stringify(handle
              ? { acquired: true, ownerRaw: handle.ownerRaw }
              : { acquired: false }),
          );
          if (handle) {
            const deadline = Date.now() + 10_000;
            while (
              !existsSync(${JSON.stringify(releasePath)})
              && Date.now() < deadline
            ) wait(5);
            releaseFileLockSync(handle);
          }
        `;
        return {
          child: spawn(
            process.execPath,
            [
              '--import',
              'tsx',
              '--input-type=module',
              '-e',
              script,
            ],
            {
              cwd: process.cwd(),
              env: { ...process.env, NODE_ENV: 'test' },
              stdio: 'ignore',
              windowsHide: true,
            },
          ),
          readyPath,
          resultPath,
        };
      });
      const exits = children.map(({ child }) => waitForChild(child));

      try {
        await waitForPaths(children.map(({ readyPath }) => readyPath));
        writeFileSync(startPath, '');
        await waitForPaths(
          children.map(({ resultPath }) => resultPath),
          7_500,
        );
        const results = children.map(({ resultPath }) =>
          JSON.parse(readFileSync(resultPath, 'utf8')) as {
            acquired: boolean;
            ownerRaw?: string;
          });
        const winners = results.filter((result) => result.acquired);
        expect(winners).toHaveLength(1);
        expect(readFileSync(lockPath, 'utf8')).toBe(winners[0]!.ownerRaw);
        expect(existsSync(guardPath)).toBe(false);
        expect(existsSync(recoveryPath)).toBe(false);
      } finally {
        writeFileSync(releasePath, '');
        await Promise.all(exits);
      }
    }, 15_000);

    it('does not reclaim dead-owner locks with implausibly future mtimes', () => {
      const lockPath = join(testDir, 'future-mtime.lock');
      const original = JSON.stringify({
        version: 2,
        pid: 999999999,
        processStartIdentity: '1',
        nonce: '66666666-6666-4666-8666-666666666666',
        timestamp: Date.now() - 60_000,
      });
      writeFileSync(lockPath, original);
      const future = new Date(Date.now() + 10 * 60_000);
      utimesSync(lockPath, future, future);

      expect(acquireFileLockSync(lockPath, { staleLockMs: 1000 }))
        .toBeNull();
      expect(readFileSync(lockPath, 'utf8')).toBe(original);
    });

    it('cleans up its owned lock after guard-wait timeout', () => {
      const lockPath = join(testDir, 'release-timeout.lock');
      const guardPath = `${lockPath}.reclaim.guard`;
      const handle = acquireFileLockSync(lockPath);
      expect(handle).not.toBeNull();
      writeFileSync(guardPath, JSON.stringify(currentOwner()));

      releaseFileLockSync(handle!);

      expect(existsSync(lockPath)).toBe(false);
      expect(existsSync(guardPath)).toBe(true);
      unlinkSync(guardPath);
    });

    it('should not reap lock from alive PID', () => {
      const lockPath = join(testDir, 'test.lock');

      // Create a lock file with current (alive) PID but old timestamp
      writeFileSync(
        lockPath,
        JSON.stringify({ pid: process.pid, timestamp: Date.now() - 60_000 }),
      );

      // Should not reap because PID is alive
      const handle = acquireFileLockSync(lockPath, { staleLockMs: 1000 });
      expect(handle).toBeNull();

      // Cleanup
      rmSync(lockPath, { force: true });
    });

    it('should reap an old lock when an alive PID has been reused', () => {
      const lockPath = join(testDir, 'test.lock');
      const processStartIdentity = getProcessStartIdentitySync(process.pid);
      expect(processStartIdentity).not.toBeNull();
      expect(processStartIdentity).not.toBe('absent');
      writeFileSync(
        lockPath,
        JSON.stringify({
          version: 2,
          pid: process.pid,
          processStartIdentity:
            processStartIdentity === '1' ? '2' : '1',
          nonce: '11111111-1111-4111-8111-111111111111',
          timestamp: Date.now() - 60_000,
        }),
      );
      const oldTime = new Date(Date.now() - 60_000);
      utimesSync(lockPath, oldTime, oldTime);

      const handle = acquireFileLockSync(lockPath, { staleLockMs: 1000 });
      expect(handle).not.toBeNull();
      releaseFileLockSync(handle!);
    });

    it('should not remove a replacement lock during release', () => {
      const lockPath = join(testDir, 'test.lock');
      const handle = acquireFileLockSync(lockPath);
      expect(handle).not.toBeNull();
      closeSync(handle!.fd);
      unlinkSync(lockPath);
      const replacement = JSON.stringify({
        version: 2,
        pid: process.pid,
        processStartIdentity: handle!.owner.processStartIdentity,
        nonce: '22222222-2222-4222-8222-222222222222',
        timestamp: Date.now(),
      });
      writeFileSync(lockPath, replacement);

      releaseFileLockSync(handle!);

      expect(readFileSync(lockPath, 'utf8')).toBe(replacement);
    });

    it('should retry with timeout and acquire stale lock', () => {
      const lockPath = join(testDir, 'test.lock');

      // Create a lock held by a dead PID with old mtime
      writeFileSync(
        lockPath,
        JSON.stringify({
          version: 2,
          pid: 999999999,
          processStartIdentity: '1',
          nonce: '33333333-3333-4333-8333-333333333333',
          timestamp: Date.now() - 60_000,
        }),
      );
      const oldTime = new Date(Date.now() - 60_000);
      utimesSync(lockPath, oldTime, oldTime);

      // Acquire with retry -- should detect stale and reap on retry
      const handle = acquireFileLockSync(lockPath, { timeoutMs: 1000, retryDelayMs: 50, staleLockMs: 1000 });
      expect(handle).not.toBeNull();

      releaseFileLockSync(handle!);
    });

    it('should fail after timeout expires', () => {
      const lockPath = join(testDir, 'test.lock');

      // Create a lock held by current (alive) PID
      writeFileSync(
        lockPath,
        JSON.stringify({ pid: process.pid, timestamp: Date.now() }),
      );

      const start = Date.now();
      const handle = acquireFileLockSync(lockPath, { timeoutMs: 200, retryDelayMs: 50 });
      const elapsed = Date.now() - start;

      expect(handle).toBeNull();
      expect(elapsed).toBeGreaterThanOrEqual(150); // Should have waited

      // Cleanup
      rmSync(lockPath, { force: true });
    });
  });

  describe('withFileLockSync', () => {
    it('should execute function under lock and release', () => {
      const lockPath = join(testDir, 'test.lock');
      const result = withFileLockSync(lockPath, () => {
        expect(existsSync(lockPath)).toBe(true);
        return 42;
      });

      expect(result).toBe(42);
      expect(existsSync(lockPath)).toBe(false);
    });

    it('should release lock even on error', () => {
      const lockPath = join(testDir, 'test.lock');

      expect(() => {
        withFileLockSync(lockPath, () => {
          throw new Error('test error');
        });
      }).toThrow('test error');

      expect(existsSync(lockPath)).toBe(false);
    });

    it('should throw when lock cannot be acquired', () => {
      const lockPath = join(testDir, 'test.lock');

      // Hold the lock
      writeFileSync(
        lockPath,
        JSON.stringify({ pid: process.pid, timestamp: Date.now() }),
      );

      expect(() => {
        withFileLockSync(lockPath, () => 'should not run');
      }).toThrow('Failed to acquire file lock');

      // Cleanup
      rmSync(lockPath, { force: true });
    });
  });

  describe('acquireFileLock (async)', () => {
    it('should acquire and release a lock successfully', async () => {
      const lockPath = join(testDir, 'test-async.lock');
      const handle = await acquireFileLock(lockPath);

      expect(handle).not.toBeNull();
      expect(existsSync(lockPath)).toBe(true);

      releaseFileLock(handle!);
      expect(existsSync(lockPath)).toBe(false);
    });

    it('should retry with timeout and acquire when lock is released', async () => {
      const lockPath = join(testDir, 'test-async.lock');
      const handle1 = await acquireFileLock(lockPath);
      expect(handle1).not.toBeNull();

      // Release after a short delay
      setTimeout(() => {
        releaseFileLock(handle1!);
      }, 100);

      const handle2 = await acquireFileLock(lockPath, { timeoutMs: 1000, retryDelayMs: 50 });
      expect(handle2).not.toBeNull();

      releaseFileLock(handle2!);
    });
  });

  describe('withFileLock (async)', () => {
    it('should execute async function under lock and release', async () => {
      const lockPath = join(testDir, 'test-async.lock');
      const result = await withFileLock(lockPath, async () => {
        expect(existsSync(lockPath)).toBe(true);
        return 'async-result';
      });

      expect(result).toBe('async-result');
      expect(existsSync(lockPath)).toBe(false);
    });

    it('should release lock even on async error', async () => {
      const lockPath = join(testDir, 'test-async.lock');

      await expect(
        withFileLock(lockPath, async () => {
          throw new Error('async error');
        }),
      ).rejects.toThrow('async error');

      expect(existsSync(lockPath)).toBe(false);
    });
  });

  describe('concurrent writes with locking', () => {
    it('should prevent data loss with concurrent notepad-style writes', () => {
      const dataPath = join(testDir, 'data.txt');
      const lockPath = lockPathFor(dataPath);
      writeFileSync(dataPath, '');

      // Simulate 10 concurrent writers, each appending a unique line
      const results: boolean[] = [];
      for (let i = 0; i < 10; i++) {
        try {
          withFileLockSync(lockPath, () => {
            const current = readFileSync(dataPath, 'utf-8');
            writeFileSync(dataPath, current + `line-${i}\n`);
          }, { timeoutMs: 5000 });
          results.push(true);
        } catch {
          results.push(false);
        }
      }

      // All writes should succeed
      expect(results.every(r => r)).toBe(true);

      // All 10 lines should be present (no data loss)
      const final = readFileSync(dataPath, 'utf-8');
      const lines = final.trim().split('\n');
      expect(lines).toHaveLength(10);
      for (let i = 0; i < 10; i++) {
        expect(lines).toContain(`line-${i}`);
      }
    });

    it('should prevent data loss with concurrent async writes', async () => {
      const dataPath = join(testDir, 'data-async.json');
      const lockPath = lockPathFor(dataPath);
      writeFileSync(dataPath, JSON.stringify({ items: [] }));

      // Launch 10 concurrent async writers
      const writers = Array.from({ length: 10 }, (_, i) =>
        withFileLock(lockPath, async () => {
          const content = JSON.parse(readFileSync(dataPath, 'utf-8'));
          content.items.push(`item-${i}`);
          writeFileSync(dataPath, JSON.stringify(content));
        }, { timeoutMs: 5000 }),
      );

      await Promise.all(writers);

      // All 10 items should be present
      const final = JSON.parse(readFileSync(dataPath, 'utf-8'));
      expect(final.items).toHaveLength(10);
      for (let i = 0; i < 10; i++) {
        expect(final.items).toContain(`item-${i}`);
      }
    });
  });
});
