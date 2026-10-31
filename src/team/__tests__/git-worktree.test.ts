import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  existsSync,
  writeFileSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  chmodSync,
} from 'fs';
import { dirname, join, resolve } from 'path';
import { tmpdir } from 'os';
import { execFileSync } from 'child_process';
import {
  createWorkerWorktree,
  removeWorkerWorktree,
  listTeamWorktrees,
  cleanupTeamWorktrees,
  ensureWorkerWorktree,
  getBranchName,
  getWorktreePath,
  installWorktreeRootAgents,
  restoreWorktreeRootAgents,
  prepareWorkerWorktreeForRemoval,
  isWorktreeMetadataPublicationFailure,
} from '../git-worktree.js';
import { withTeamStatePathScope } from '../state-paths.js';

function canonicalFixturePath(path: string): string {
  let canonical: string;
  try {
    canonical = realpathSync.native(path);
  } catch {
    canonical = resolve(path);
  }
  return process.platform === 'win32' ? canonical.toLowerCase() : canonical;
}

function registeredWorktreePaths(repoDir: string): string[] {
  return execFileSync('git', ['worktree', 'list', '--porcelain'], {
    cwd: repoDir,
    encoding: 'utf-8',
  }).split(/\r?\n/)
    .filter(line => line.startsWith('worktree '))
    .map(line => canonicalFixturePath(line.slice('worktree '.length)));
}

describe('git-worktree', () => {
  let repoDir: string;
  const teamName = 'test-wt';

  beforeEach(() => {
    repoDir = realpathSync.native(mkdtempSync(join(tmpdir(), 'git-worktree-test-')));
    // Initialize a git repo with an initial commit
    execFileSync('git', ['init'], { cwd: repoDir, stdio: 'pipe' });
    execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: repoDir, stdio: 'pipe' });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repoDir, stdio: 'pipe' });
    writeFileSync(join(repoDir, 'README.md'), '# Test\n');
    writeFileSync(join(repoDir, 'AGENTS.md'), 'original instructions');
    execFileSync('git', ['add', '.'], { cwd: repoDir, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', 'Initial commit'], { cwd: repoDir, stdio: 'pipe' });
  });

  afterEach(() => {
    // Clean up worktrees first (git needs this before rmSync)
    try {
      cleanupTeamWorktrees(teamName, repoDir);
    } catch { /* ignore */ }
    rmSync(repoDir, { recursive: true, force: true });
  });

  describe('createWorkerWorktree', () => {
    it('creates worktree at correct path', () => {
      const info = createWorkerWorktree(teamName, 'worker1', repoDir);

      expect(realpathSync.native(info.path)).toBe(
        realpathSync.native(getWorktreePath(repoDir, teamName, 'worker1')),
      );
      expect(info.branch).toBe(`omc-team/${teamName}/worker1`);
      expect(info.workerName).toBe('worker1');
      expect(info.teamName).toBe(teamName);
      expect(existsSync(info.path)).toBe(true);
    });

    it('branch name is properly sanitized', () => {
      const info = createWorkerWorktree(teamName, 'worker-with-special', repoDir);
      expect(info.branch).toContain('omc-team/');
      expect(existsSync(info.path)).toBe(true);
    });

    it('handles recreation of stale worktree', () => {
      const info1 = createWorkerWorktree(teamName, 'worker1', repoDir);
      expect(existsSync(info1.path)).toBe(true);

      // Recreate the same worktree
      const info2 = createWorkerWorktree(teamName, 'worker1', repoDir);
      expect(existsSync(info2.path)).toBe(true);
      expect(info2.path).toBe(info1.path);
      expect(info2.created).toBe(false);
      expect(info2.reused).toBe(true);
    });

    it('rejects a lossy worker-name alias before touching an existing canonical worktree', () => {
      const workerName = 'worker-2';
      const info = createWorkerWorktree(teamName, workerName, repoDir);
      installWorktreeRootAgents(teamName, workerName, repoDir, info.path, 'managed overlay');
      const branchOid = execFileSync('git', ['rev-parse', info.branch], {
        cwd: repoDir,
        encoding: 'utf-8',
      }).trim();
      const metadata = listTeamWorktrees(teamName, repoDir);
      const agents = readFileSync(join(info.path, 'AGENTS.md'));

      expect(() => ensureWorkerWorktree(teamName, 'worker-2!', repoDir, {
        mode: 'named',
        requireCleanLeader: false,
      })).toThrow(/worktree_worker_name_noncanonical/);

      expect(existsSync(info.path)).toBe(true);
      expect(registeredWorktreePaths(repoDir)).toContain(canonicalFixturePath(info.path));
      expect(execFileSync('git', ['rev-parse', info.branch], {
        cwd: repoDir,
        encoding: 'utf-8',
      }).trim()).toBe(branchOid);
      expect(listTeamWorktrees(teamName, repoDir)).toEqual(metadata);
      expect(readFileSync(join(info.path, 'AGENTS.md'))).toEqual(agents);
    });

    it('keeps invalid worker names as a disabled/default no-op', () => {
      const missingRepo = join(repoDir, 'missing-repo');

      expect(ensureWorkerWorktree(teamName, 'worker-2!', missingRepo)).toBeNull();
      expect(ensureWorkerWorktree(teamName, 'worker-2!', missingRepo, {
        mode: 'disabled',
      })).toBeNull();
      expect(existsSync(missingRepo)).toBe(false);
    });

    it('preserves a reused worktree and branch when metadata publication fails', () => {
      const workerName = 'worker-reused-publication-failure';
      const info = createWorkerWorktree(teamName, workerName, repoDir);
      const omcRoot = join(info.path, '..', '..', '..', '..');
      const metadataPath = join(omcRoot, 'state', 'team', teamName, 'worktrees.json');
      const branchHead = execFileSync('git', ['rev-parse', info.branch], {
        cwd: repoDir,
        encoding: 'utf-8',
      }).trim();
      rmSync(metadataPath, { force: true });
      mkdirSync(metadataPath, { recursive: true });

      expect(() => createWorkerWorktree(teamName, workerName, repoDir)).toThrow(/worktrees\.json/);

      expect(existsSync(info.path)).toBe(true);
      expect(registeredWorktreePaths(repoDir)).toContain(canonicalFixturePath(info.path));
      expect(execFileSync('git', ['rev-parse', info.branch], {
        cwd: repoDir,
        encoding: 'utf-8',
      }).trim()).toBe(branchHead);

      rmSync(metadataPath, { recursive: true, force: true });
      removeWorkerWorktree(teamName, workerName, repoDir, info.path);
    });

    it('rejects a stale plain directory instead of deleting files', () => {
      const stalePath = join(repoDir, '.omc', 'team', teamName, 'worktrees', 'worker-stale');
      rmSync(stalePath, { recursive: true, force: true });
      mkdirSync(stalePath, { recursive: true });
      writeFileSync(join(stalePath, 'orphan.txt'), 'orphaned state');

      expect(() => createWorkerWorktree(teamName, 'worker-stale', repoDir)).toThrow(/worktree_path_mismatch/);
      expect(existsSync(join(stalePath, 'orphan.txt'))).toBe(true);
    });

    it('plans detached worktrees under canonical native team path', () => {
      const info = ensureWorkerWorktree(teamName, 'worker-detached', repoDir, {
        mode: 'detached',
        requireCleanLeader: false,
      });

      expect(realpathSync.native(info!.path)).toBe(
        realpathSync.native(getWorktreePath(repoDir, teamName, 'worker-detached')),
      );
      expect(info?.detached).toBe(true);
      expect(info?.created).toBe(true);
      expect(info?.reused).toBe(false);
    });

    it('ignores native .omc metadata when requiring a clean leader for multiple workers', () => {
      const first = ensureWorkerWorktree(teamName, 'worker-clean-1', repoDir, {
        mode: 'detached',
      });
      const second = ensureWorkerWorktree(teamName, 'worker-clean-2', repoDir, {
        mode: 'detached',
      });

      expect(first?.created).toBe(true);
      expect(second?.created).toBe(true);
      expect(existsSync(first!.path)).toBe(true);
      expect(existsSync(second!.path)).toBe(true);
    });

    it('preserves dirty existing worktrees', () => {
      const info = createWorkerWorktree(teamName, 'worker-dirty', repoDir);
      writeFileSync(join(info.path, 'dirty.txt'), 'dirty');

      expect(() => createWorkerWorktree(teamName, 'worker-dirty', repoDir)).toThrow(/worktree_dirty/);
      expect(existsSync(join(info.path, 'dirty.txt'))).toBe(true);
    });

    it('removes the exact created worktree and owned branch when metadata publication fails', () => {
      const workerName = 'worker-metadata-failure';
      const worktreePath = getWorktreePath(repoDir, teamName, workerName);
      const omcRoot = join(worktreePath, '..', '..', '..', '..');
      const metadataPath = join(omcRoot, 'state', 'team', teamName, 'worktrees.json');
      const branch = getBranchName(teamName, workerName);
      mkdirSync(metadataPath, { recursive: true });

      let publicationFailure: unknown;
      try {
        createWorkerWorktree(teamName, workerName, repoDir);
      } catch (error) {
        publicationFailure = error;
      }
      expect(publicationFailure).toBeInstanceOf(Error);
      expect(publicationFailure).toMatchObject({
        code: 'worktree_metadata_publication_failed',
        teamName,
        workerName,
        worktreePath,
        worktreeBranch: branch,
        worktreeMode: 'named',
        cleanupVerified: true,
        cause: expect.any(Error),
      });
      if (publicationFailure instanceof Error && publicationFailure.cause instanceof Error) {
        expect(publicationFailure.cause.message).toMatch(/worktrees\.json/);
      }

      expect(existsSync(worktreePath)).toBe(false);
      expect(registeredWorktreePaths(repoDir)).not.toContain(canonicalFixturePath(worktreePath));
      expect(execFileSync('git', ['branch', '--list', branch], {
        cwd: repoDir,
        encoding: 'utf-8',
      }).trim()).toBe('');
      expect(() => removeWorkerWorktree(teamName, workerName, repoDir, worktreePath)).not.toThrow();
    });

    it('returns exact retry authority when metadata publication and branch cleanup both fail', () => {
      const workerName = 'worker-metadata-branch-lock';
      const worktreePath = getWorktreePath(repoDir, teamName, workerName);
      const branch = getBranchName(teamName, workerName);
      const omcRoot = join(worktreePath, '..', '..', '..', '..');
      const metadataPath = join(omcRoot, 'state', 'team', teamName, 'worktrees.json');
      const gitDir = realpathSync.native(join(
        repoDir,
        execFileSync('git', ['rev-parse', '--git-dir'], {
          cwd: repoDir,
          encoding: 'utf-8',
        }).trim(),
      ));
      const hookPath = join(gitDir, 'hooks', 'post-checkout');
      const branchLockPath = join(gitDir, 'refs', 'heads', `${branch}.lock`);
      const shellQuote = (value: string): string =>
        `'${value.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`;
      mkdirSync(dirname(hookPath), { recursive: true });
      writeFileSync(hookPath, [
        '#!/bin/sh',
        `mkdir -p ${shellQuote(dirname(branchLockPath))}`,
        `printf locked > ${shellQuote(branchLockPath)}`,
      ].join('\n'), 'utf-8');
      chmodSync(hookPath, 0o755);
      mkdirSync(metadataPath, { recursive: true });

      try {
        let publicationFailure: unknown;
        try {
          createWorkerWorktree(teamName, workerName, repoDir);
        } catch (error) {
          publicationFailure = error;
        }

        expect(isWorktreeMetadataPublicationFailure(publicationFailure)).toBe(true);
        if (!isWorktreeMetadataPublicationFailure(publicationFailure)) {
          throw new Error('expected worktree metadata publication failure');
        }
        expect(publicationFailure).toMatchObject({
          code: 'worktree_metadata_publication_cleanup_failed',
          teamName,
          workerName,
          worktreePath,
          worktreeBranch: branch,
          worktreeMode: 'named',
          cleanupVerified: false,
          cause: expect.any(Error),
          cleanupError: expect.any(Error),
        });
        expect(existsSync(branchLockPath)).toBe(true);
        expect(existsSync(worktreePath)).toBe(false);
        expect(execFileSync('git', ['branch', '--list', branch], {
          cwd: repoDir,
          encoding: 'utf-8',
        }).trim()).toContain(branch);

        const receipt = {
          path: publicationFailure.worktreePath,
          branch: publicationFailure.worktreeBranch,
          mode: publicationFailure.worktreeMode,
          created: true as const,
          reused: false as const,
        };
        expect(() => removeWorkerWorktree(teamName, workerName, repoDir, receipt)).toThrow(
          /worktree_branch_remove_failed/,
        );

        rmSync(branchLockPath, { force: true });
        expect(() => removeWorkerWorktree(teamName, workerName, repoDir, receipt)).not.toThrow();
        expect(execFileSync('git', ['branch', '--list', branch], {
          cwd: repoDir,
          encoding: 'utf-8',
        }).trim()).toBe('');
      } finally {
        rmSync(branchLockPath, { force: true });
        rmSync(metadataPath, { recursive: true, force: true });
        rmSync(hookPath, { force: true });
      }
    });

    it('does not clean a same-named worktree on a new root when failed publication rolls back', async () => {
      const workerName = 'worker-publication-root-switch';
      const stateParent = realpathSync.native(mkdtempSync(join(tmpdir(), 'git-worktree-publication-root-')));
      const storageA = join(stateParent, 'storage-a');
      const storageB = join(stateParent, 'storage-b');
      const previousStateDir = process.env.OMC_STATE_DIR;
      mkdirSync(storageA, { recursive: true });
      mkdirSync(storageB, { recursive: true });

      try {
        process.env.OMC_STATE_DIR = storageB;
        const worktreeB = getWorktreePath(repoDir, teamName, workerName);
        mkdirSync(worktreeB, { recursive: true });
        const sentinelB = join(worktreeB, 'do-not-remove.txt');
        writeFileSync(sentinelB, 'root-b');

        process.env.OMC_STATE_DIR = storageA;
        await withTeamStatePathScope(repoDir, async () => {
          const worktreeA = getWorktreePath(repoDir, teamName, workerName);
          const omcRootA = join(worktreeA, '..', '..', '..', '..');
          const metadataPathA = join(omcRootA, 'state', 'team', teamName, 'worktrees.json');
          mkdirSync(metadataPathA, { recursive: true });

          await Promise.resolve();
          process.env.OMC_STATE_DIR = storageB;

          expect(() => ensureWorkerWorktree(teamName, workerName, repoDir, {
            mode: 'detached',
            requireCleanLeader: false,
          })).toThrow(/worktrees\.json/);
          expect(existsSync(worktreeA)).toBe(false);
          expect(readFileSync(sentinelB, 'utf-8')).toBe('root-b');
          expect(registeredWorktreePaths(repoDir)).not.toContain(canonicalFixturePath(worktreeA));
        });
      } finally {
        if (previousStateDir === undefined) delete process.env.OMC_STATE_DIR;
        else process.env.OMC_STATE_DIR = previousStateDir;
        rmSync(stateParent, { recursive: true, force: true });
      }
    });

    it('keeps creation and metadata on the captured root after an awaited environment change', async () => {
      const stateParent = realpathSync.native(mkdtempSync(join(tmpdir(), 'git-worktree-state-root-')));
      const storageA = join(stateParent, 'storage-a');
      const storageB = join(stateParent, 'storage-b');
      const previousStateDir = process.env.OMC_STATE_DIR;
      mkdirSync(storageA, { recursive: true });
      mkdirSync(storageB, { recursive: true });

      try {
        process.env.OMC_STATE_DIR = storageB;
        const worktreeB = getWorktreePath(repoDir, teamName, 'worker-root-switch');
        const omcRootB = join(worktreeB, '..', '..', '..', '..');
        process.env.OMC_STATE_DIR = storageA;

        await withTeamStatePathScope(repoDir, async () => {
          const expectedPath = getWorktreePath(repoDir, teamName, 'worker-root-switch');
          await Promise.resolve();
          process.env.OMC_STATE_DIR = storageB;

          const info = ensureWorkerWorktree(teamName, 'worker-root-switch', repoDir, {
            mode: 'detached',
            requireCleanLeader: false,
          });
          expect(info?.path).toBe(expectedPath);
          expect(listTeamWorktrees(teamName, repoDir)).toEqual([
            expect.objectContaining({ workerName: 'worker-root-switch', path: expectedPath }),
          ]);
          expect(existsSync(worktreeB)).toBe(false);
          expect(existsSync(join(omcRootB, 'state', 'team', teamName, 'worktrees.json'))).toBe(false);

          removeWorkerWorktree(teamName, 'worker-root-switch', repoDir, expectedPath);
        });
      } finally {
        if (previousStateDir === undefined) delete process.env.OMC_STATE_DIR;
        else process.env.OMC_STATE_DIR = previousStateDir;
        rmSync(stateParent, { recursive: true, force: true });
      }
    });
  });

  describe('removeWorkerWorktree', () => {
    it('preserves dirty worktrees instead of force-removing them', () => {
      const info = createWorkerWorktree(teamName, 'dirty-worker', repoDir);
      writeFileSync(join(info.path, 'dirty.txt'), 'dirty');

      expect(() => removeWorkerWorktree(teamName, 'dirty-worker', repoDir)).toThrow(/worktree_dirty/);
      expect(existsSync(info.path)).toBe(true);
    });

    it('removes worktree and branch', () => {
      const info = createWorkerWorktree(teamName, 'worker1', repoDir);
      expect(existsSync(info.path)).toBe(true);

      removeWorkerWorktree(teamName, 'worker1', repoDir);

      // Worktree directory should be gone
      expect(existsSync(info.path)).toBe(false);

      // Branch should be deleted
      const branches = execFileSync('git', ['branch'], { cwd: repoDir, encoding: 'utf-8' });
      expect(branches).not.toContain('omc-team/');
    });

    it('does not delete a same-named branch when removing an owned detached worktree', () => {
      const workerName = 'worker-detached-branch-sentinel';
      const syntheticBranch = getBranchName(teamName, workerName);
      execFileSync('git', ['branch', syntheticBranch], { cwd: repoDir, stdio: 'pipe' });
      const info = ensureWorkerWorktree(teamName, workerName, repoDir, {
        mode: 'detached',
        requireCleanLeader: false,
      });

      expect(info).toMatchObject({
        branch: 'HEAD',
        mode: 'detached',
        created: true,
        reused: false,
      });
      removeWorkerWorktree(teamName, workerName, repoDir);

      expect(existsSync(info!.path)).toBe(false);
      expect(execFileSync('git', ['branch', '--list', syntheticBranch], {
        cwd: repoDir,
        encoding: 'utf-8',
      }).trim()).toContain(syntheticBranch);
    });

    it('rejects a forged detached receipt for another worker path', () => {
      const workerOne = 'worker-detached-one';
      const workerTwo = 'worker-detached-two';
      const infoOne = ensureWorkerWorktree(teamName, workerOne, repoDir, {
        mode: 'detached',
        requireCleanLeader: false,
      });
      const infoTwo = ensureWorkerWorktree(teamName, workerTwo, repoDir, {
        mode: 'detached',
        requireCleanLeader: false,
      });

      expect(() => removeWorkerWorktree(teamName, workerOne, repoDir, {
        path: infoTwo!.path,
        branch: 'HEAD',
        mode: 'detached',
        created: true,
        reused: false,
      })).toThrow(/worktree_path_mismatch/);

      expect(existsSync(infoOne!.path)).toBe(true);
      expect(existsSync(infoTwo!.path)).toBe(true);
      expect(listTeamWorktrees(teamName, repoDir).map(entry => entry.workerName).sort()).toEqual([
        workerOne,
        workerTwo,
      ]);

      removeWorkerWorktree(teamName, workerOne, repoDir, infoOne!);
      expect(existsSync(infoOne!.path)).toBe(false);
      expect(existsSync(infoTwo!.path)).toBe(true);
      expect(listTeamWorktrees(teamName, repoDir).map(entry => entry.workerName)).toEqual([workerTwo]);
    });

    it('rejects a lossy worker-name alias without touching the actual worktree authority', () => {
      const workerName = 'worker-2';
      const alias = 'worker-2!';
      const info = createWorkerWorktree(teamName, workerName, repoDir);
      const branchOid = execFileSync('git', ['rev-parse', info.branch], {
        cwd: repoDir,
        encoding: 'utf-8',
      }).trim();
      const metadata = listTeamWorktrees(teamName, repoDir);

      expect(() => removeWorkerWorktree(teamName, alias, repoDir, {
        path: info.path,
        branch: info.branch,
        mode: 'named',
        created: true,
        reused: false,
      })).toThrow(/worktree_worker_name_noncanonical/);

      expect(existsSync(info.path)).toBe(true);
      expect(registeredWorktreePaths(repoDir)).toContain(canonicalFixturePath(info.path));
      expect(execFileSync('git', ['rev-parse', info.branch], {
        cwd: repoDir,
        encoding: 'utf-8',
      }).trim()).toBe(branchOid);
      expect(listTeamWorktrees(teamName, repoDir)).toEqual(metadata);

      removeWorkerWorktree(teamName, workerName, repoDir);
      expect(existsSync(info.path)).toBe(false);
      expect(listTeamWorktrees(teamName, repoDir)).toEqual([]);
    });

    it('throws and preserves metadata when git refuses to remove a registered worktree', () => {
      const workerName = 'locked-worker';
      const info = createWorkerWorktree(teamName, workerName, repoDir);
      execFileSync('git', ['worktree', 'lock', info.path], { cwd: repoDir, stdio: 'pipe' });

      expect(() => removeWorkerWorktree(teamName, workerName, repoDir)).toThrow(/worktree_remove_failed/);

      expect(existsSync(info.path)).toBe(true);
      expect(listTeamWorktrees(teamName, repoDir).map(w => w.workerName)).toContain(workerName);
      expect(registeredWorktreePaths(repoDir)).toContain(canonicalFixturePath(info.path));

      execFileSync('git', ['worktree', 'unlock', info.path], { cwd: repoDir, stdio: 'pipe' });
    });

    it('preserves metadata when branch deletion fails and completes cleanup on retry', () => {
      const workerName = 'worker-branch-lock';
      const info = createWorkerWorktree(teamName, workerName, repoDir);
      const branchLockPath = join(repoDir, '.git', 'refs', 'heads', `${info.branch}.lock`);
      mkdirSync(join(branchLockPath, '..'), { recursive: true });
      writeFileSync(branchLockPath, 'locked');

      expect(() => removeWorkerWorktree(teamName, workerName, repoDir)).toThrow(
        /worktree_branch_remove_failed/,
      );
      expect(existsSync(info.path)).toBe(false);
      expect(execFileSync('git', ['branch', '--list', info.branch], {
        cwd: repoDir,
        encoding: 'utf-8',
      }).trim()).toContain(info.branch);
      expect(listTeamWorktrees(teamName, repoDir)).toEqual([
        expect.objectContaining({
          workerName,
          path: info.path,
          branch: info.branch,
          mode: 'named',
          created: true,
          reused: false,
        }),
      ]);
      expect(cleanupTeamWorktrees(teamName, repoDir)).toEqual({
        removed: [],
        preserved: [
          expect.objectContaining({
            workerName,
            path: info.path,
            reason: expect.stringContaining('worktree_branch_remove_failed'),
          }),
        ],
      });

      rmSync(branchLockPath, { force: true });
      expect(cleanupTeamWorktrees(teamName, repoDir)).toEqual({
        removed: [workerName],
        preserved: [],
      });
      expect(execFileSync('git', ['branch', '--list', info.branch], {
        cwd: repoDir,
        encoding: 'utf-8',
      }).trim()).toBe('');
      expect(listTeamWorktrees(teamName, repoDir)).toEqual([]);
    });

    it('does not throw for non-existent worktree', () => {
      expect(() => removeWorkerWorktree(teamName, 'nonexistent', repoDir)).not.toThrow();
    });

    it('refuses a symlink at the canonical worker worktree path', () => {
      const workerName = 'worker-symlink';
      const worktreePath = join(repoDir, '.omc', 'team', teamName, 'worktrees', workerName);
      mkdirSync(join(repoDir, '.omc', 'team', teamName, 'worktrees'), { recursive: true });
      symlinkSync(repoDir, worktreePath, 'dir');

      expect(() => removeWorkerWorktree(teamName, workerName, repoDir)).toThrow(/worktree_path_is_symlink/);
      expect(existsSync(join(repoDir, 'README.md'))).toBe(true);
    });

    it('removes only the persisted worktree when the storage alias is retargeted after await', async () => {
      const workerName = 'worker-retargeted-root';
      const stateParent = realpathSync.native(mkdtempSync(join(tmpdir(), 'git-worktree-alias-root-')));
      const storageA = join(stateParent, 'storage-a');
      const storageB = join(stateParent, 'storage-b');
      const storageAlias = join(stateParent, 'storage-alias');
      const previousStateDir = process.env.OMC_STATE_DIR;
      mkdirSync(storageA, { recursive: true });
      mkdirSync(storageB, { recursive: true });
      symlinkSync(storageA, storageAlias, process.platform === 'win32' ? 'junction' : 'dir');

      try {
        process.env.OMC_STATE_DIR = storageAlias;
        const info = withTeamStatePathScope(repoDir, () =>
          ensureWorkerWorktree(teamName, workerName, repoDir, {
            mode: 'detached',
            requireCleanLeader: false,
          }))!;

        process.env.OMC_STATE_DIR = storageB;
        const worktreeB = getWorktreePath(repoDir, teamName, workerName);
        mkdirSync(worktreeB, { recursive: true });
        const sentinelB = join(worktreeB, 'do-not-remove.txt');
        writeFileSync(sentinelB, 'root-b');
        process.env.OMC_STATE_DIR = storageAlias;

        await withTeamStatePathScope(repoDir, async () => {
          await Promise.resolve();
          rmSync(storageAlias, { recursive: true, force: true });
          symlinkSync(storageB, storageAlias, process.platform === 'win32' ? 'junction' : 'dir');
          removeWorkerWorktree(teamName, workerName, repoDir, info.path);
        });

        expect(existsSync(info.path)).toBe(false);
        expect(readFileSync(sentinelB, 'utf8')).toBe('root-b');
      } finally {
        if (previousStateDir === undefined) delete process.env.OMC_STATE_DIR;
        else process.env.OMC_STATE_DIR = previousStateDir;
        rmSync(stateParent, { recursive: true, force: true });
      }
    });
  });



  describe('worktree root AGENTS.md lifecycle', () => {
    it('installs a managed overlay and removes it on cleanup when no root AGENTS.md existed', () => {
      rmSync(join(repoDir, 'AGENTS.md'));
      execFileSync('git', ['add', '-u', 'AGENTS.md'], { cwd: repoDir, stdio: 'pipe' });
      execFileSync('git', ['commit', '-m', 'Remove root agents'], { cwd: repoDir, stdio: 'pipe' });

      const info = createWorkerWorktree(teamName, 'worker-agents-new', repoDir);
      const agentsPath = join(info.path, 'AGENTS.md');
      expect(existsSync(agentsPath)).toBe(false);

      installWorktreeRootAgents(teamName, 'worker-agents-new', repoDir, info.path, 'managed overlay\n');
      expect(readFileSync(agentsPath, 'utf-8')).toBe('managed overlay\n');

      const restored = restoreWorktreeRootAgents(teamName, 'worker-agents-new', repoDir, info.path);
      expect(restored).toEqual({ restored: true });
      expect(existsSync(agentsPath)).toBe(false);
    });

    it('backs up an existing root AGENTS.md and restores it before removal', () => {
      writeFileSync(join(repoDir, 'AGENTS.md'), 'original root instructions\n');
      execFileSync('git', ['add', 'AGENTS.md'], { cwd: repoDir, stdio: 'pipe' });
      execFileSync('git', ['commit', '-m', 'Add root agents'], { cwd: repoDir, stdio: 'pipe' });
      const info = createWorkerWorktree(teamName, 'worker-agents-existing', repoDir);
      const agentsPath = join(info.path, 'AGENTS.md');

      installWorktreeRootAgents(teamName, 'worker-agents-existing', repoDir, info.path, 'managed overlay\n');
      expect(readFileSync(agentsPath, 'utf-8')).toBe('managed overlay\n');

      removeWorkerWorktree(teamName, 'worker-agents-existing', repoDir);
      expect(existsSync(info.path)).toBe(false);
    });

    it('leaves the managed overlay and backup intact when other dirty edits block cleanup', () => {
      writeFileSync(join(repoDir, 'AGENTS.md'), 'original root instructions\n');
      execFileSync('git', ['add', 'AGENTS.md'], { cwd: repoDir, stdio: 'pipe' });
      execFileSync('git', ['commit', '-m', 'Add root agents'], { cwd: repoDir, stdio: 'pipe' });
      const workerName = 'worker-agents-dirty';
      const info = createWorkerWorktree(teamName, workerName, repoDir);
      const agentsPath = join(info.path, 'AGENTS.md');
      const backupPath = join(repoDir, '.omc', 'state', 'team', teamName, 'workers', workerName, 'worktree-root-agents.json');
      installWorktreeRootAgents(teamName, workerName, repoDir, info.path, 'managed overlay\n');
      writeFileSync(join(info.path, 'dirty.txt'), 'dirty');

      const result = cleanupTeamWorktrees(teamName, repoDir);

      expect(result.preserved).toHaveLength(1);
      expect(result.preserved[0]?.reason).toMatch(/worktree_dirty/);
      expect(existsSync(info.path)).toBe(true);
      expect(readFileSync(agentsPath, 'utf-8')).toBe('managed overlay\n');
      expect(existsSync(backupPath)).toBe(true);
      expect(listTeamWorktrees(teamName, repoDir).map(w => w.workerName)).toContain(workerName);
    });

    it('restores managed AGENTS.md only after removal preflight confirms no other dirty edits', () => {
      writeFileSync(join(repoDir, 'AGENTS.md'), 'original root instructions\n');
      execFileSync('git', ['add', 'AGENTS.md'], { cwd: repoDir, stdio: 'pipe' });
      execFileSync('git', ['commit', '-m', 'Add root agents'], { cwd: repoDir, stdio: 'pipe' });
      const workerName = 'worker-agents-clean-preflight';
      const info = createWorkerWorktree(teamName, workerName, repoDir);
      const agentsPath = join(info.path, 'AGENTS.md');
      const originalAgents = readFileSync(agentsPath);
      const backupPath = join(repoDir, '.omc', 'state', 'team', teamName, 'workers', workerName, 'worktree-root-agents.json');
      installWorktreeRootAgents(teamName, workerName, repoDir, info.path, 'managed overlay\n');

      expect(() => prepareWorkerWorktreeForRemoval(teamName, workerName, repoDir, info.path)).not.toThrow();

      expect(readFileSync(agentsPath)).toEqual(originalAgents);
      expect(existsSync(backupPath)).toBe(false);
    });


    it('cleans up backup metadata after a partial AGENTS.md install left original content intact', () => {
      writeFileSync(join(repoDir, 'AGENTS.md'), 'original root instructions\n');
      execFileSync('git', ['add', 'AGENTS.md'], { cwd: repoDir, stdio: 'pipe' });
      execFileSync('git', ['commit', '-m', 'Add root agents'], { cwd: repoDir, stdio: 'pipe' });
      const workerName = 'worker-agents-partial-install';
      const info = createWorkerWorktree(teamName, workerName, repoDir);
      const agentsPath = join(info.path, 'AGENTS.md');
      const originalAgents = readFileSync(agentsPath);
      const backupDir = join(repoDir, '.omc', 'state', 'team', teamName, 'workers', workerName);
      const backupPath = join(backupDir, 'worktree-root-agents.json');
      mkdirSync(backupDir, { recursive: true });
      writeFileSync(backupPath, JSON.stringify({
        worktreePath: info.path,
        hadOriginal: true,
        originalContent: originalAgents.toString('utf8'),
        installedContent: 'managed overlay\n',
        installedAt: new Date().toISOString(),
      }), 'utf-8');

      expect(readFileSync(agentsPath)).toEqual(originalAgents);

      removeWorkerWorktree(teamName, workerName, repoDir);

      expect(existsSync(info.path)).toBe(false);
      expect(existsSync(backupPath)).toBe(false);
    });

    it('preserves the worktree when AGENTS.md itself was modified by the worker', () => {
      const info = createWorkerWorktree(teamName, 'worker-agents-edited', repoDir);
      const agentsPath = join(info.path, 'AGENTS.md');
      installWorktreeRootAgents(teamName, 'worker-agents-edited', repoDir, info.path, 'managed overlay\n');
      writeFileSync(agentsPath, 'worker edited instructions\n');

      expect(() => removeWorkerWorktree(teamName, 'worker-agents-edited', repoDir)).toThrow(/agents_dirty/);
      expect(existsSync(info.path)).toBe(true);
      expect(readFileSync(agentsPath, 'utf-8')).toBe('worker edited instructions\n');
    });
  });

  describe('listTeamWorktrees', () => {
    it('returns empty for team with no worktrees', () => {
      const list = listTeamWorktrees(teamName, repoDir);
      expect(list).toEqual([]);
    });

    it('lists created worktrees', () => {
      createWorkerWorktree(teamName, 'worker1', repoDir);
      createWorkerWorktree(teamName, 'worker2', repoDir);

      const list = listTeamWorktrees(teamName, repoDir);
      expect(list).toHaveLength(2);
      expect(list.map(w => w.workerName)).toContain('worker1');
      expect(list.map(w => w.workerName)).toContain('worker2');
    });
  });

  describe('cleanupTeamWorktrees', () => {
    it('removes all worktrees for a team', () => {
      createWorkerWorktree(teamName, 'worker1', repoDir);
      createWorkerWorktree(teamName, 'worker2', repoDir);

      expect(listTeamWorktrees(teamName, repoDir)).toHaveLength(2);

      const result = cleanupTeamWorktrees(teamName, repoDir);

      expect(result.preserved).toHaveLength(0);
      expect(listTeamWorktrees(teamName, repoDir)).toHaveLength(0);
    });

    it('preserves dirty worktrees during cleanup and leaves metadata for follow-up', () => {
      const dirty = createWorkerWorktree(teamName, 'worker-dirty', repoDir);
      writeFileSync(join(dirty.path, 'dirty.txt'), 'dirty');

      const result = cleanupTeamWorktrees(teamName, repoDir);

      expect(result.removed).toHaveLength(0);
      expect(result.preserved).toHaveLength(1);
      expect(existsSync(dirty.path)).toBe(true);
      expect(listTeamWorktrees(teamName, repoDir)).toHaveLength(1);
    });

    it('restores a pre-existing worktree-root AGENTS.md before removing a clean worktree', () => {
      const info = createWorkerWorktree(teamName, 'worker-agents', repoDir);
      const agentsPath = join(info.path, 'AGENTS.md');
      const originalAgents = readFileSync(agentsPath);

      installWorktreeRootAgents(teamName, 'worker-agents', repoDir, info.path, 'managed worker overlay');
      expect(readFileSync(agentsPath, 'utf-8')).toBe('managed worker overlay');

      restoreWorktreeRootAgents(teamName, 'worker-agents', repoDir, info.path);
      expect(readFileSync(agentsPath)).toEqual(originalAgents);

      removeWorkerWorktree(teamName, 'worker-agents', repoDir);
      expect(existsSync(info.path)).toBe(false);
    });

    it('restores overlays without deleting a reused worktree or branch', () => {
      const workerName = 'worker-reused-cleanup';
      const branch = getBranchName(teamName, workerName);
      const worktreePath = getWorktreePath(repoDir, teamName, workerName);
      mkdirSync(join(worktreePath, '..'), { recursive: true });
      execFileSync('git', ['branch', branch], { cwd: repoDir, stdio: 'pipe' });
      execFileSync('git', ['worktree', 'add', worktreePath, branch], { cwd: repoDir, stdio: 'pipe' });
      const info = ensureWorkerWorktree(teamName, workerName, repoDir, {
        mode: 'named',
        requireCleanLeader: false,
      });
      expect(info).toMatchObject({ branch, created: false, reused: true });
      expect(realpathSync.native(info!.path)).toBe(realpathSync.native(worktreePath));
      const originalAgents = readFileSync(join(worktreePath, 'AGENTS.md'));

      installWorktreeRootAgents(teamName, workerName, repoDir, worktreePath, 'managed worker overlay');
      expect(readFileSync(join(worktreePath, 'AGENTS.md'), 'utf-8')).toBe('managed worker overlay');

      const result = cleanupTeamWorktrees(teamName, repoDir);

      expect(result).toEqual({
        removed: [],
        retired: [workerName],
        preserved: [],
      });
      expect(existsSync(worktreePath)).toBe(true);
      expect(readFileSync(join(worktreePath, 'AGENTS.md'))).toEqual(originalAgents);
      expect(execFileSync('git', ['branch', '--list', branch], {
        cwd: repoDir,
        encoding: 'utf-8',
      }).trim()).toContain(branch);
      expect(listTeamWorktrees(teamName, repoDir)).toEqual([]);

      execFileSync('git', ['worktree', 'remove', worktreePath], { cwd: repoDir, stdio: 'pipe' });
      execFileSync('git', ['branch', '-D', branch], { cwd: repoDir, stdio: 'pipe' });
    });

    it('preserves a worktree when the managed root AGENTS.md was edited', () => {
      const info = createWorkerWorktree(teamName, 'worker-agents-dirty', repoDir);
      installWorktreeRootAgents(teamName, 'worker-agents-dirty', repoDir, info.path, 'managed worker overlay');
      writeFileSync(join(info.path, 'AGENTS.md'), 'human edits');

      const result = cleanupTeamWorktrees(teamName, repoDir);

      expect(result.removed).toHaveLength(0);
      expect(result.preserved).toHaveLength(1);
      expect(result.preserved[0]?.reason).toContain('agents_dirty');
      expect(existsSync(info.path)).toBe(true);
      expect(readFileSync(join(info.path, 'AGENTS.md'), 'utf-8')).toBe('human edits');
    });






    it('preserves corrupt root AGENTS backup for metadata-listed workers', () => {
      const info = createWorkerWorktree(teamName, 'worker-corrupt-backup', repoDir);
      const backupDir = join(repoDir, '.omc', 'state', 'team', teamName, 'workers', 'worker-corrupt-backup');
      const backupPath = join(backupDir, 'worktree-root-agents.json');
      mkdirSync(backupDir, { recursive: true });
      writeFileSync(backupPath, '{not-json', 'utf-8');
      rmSync(info.path, { recursive: true, force: true });

      const result = cleanupTeamWorktrees(teamName, repoDir);

      expect(result.removed).toHaveLength(0);
      expect(result.preserved).toHaveLength(1);
      expect(result.preserved[0]?.path).toBe(backupPath);
      expect(result.preserved[0]?.reason).toContain('worktree_root_agents_backup_unreadable');
      expect(existsSync(backupPath)).toBe(true);
    });

    it('preserves team state cleanup when only worktree-root AGENTS backup remains', () => {
      const backupPath = join(repoDir, '.omc', 'state', 'team', teamName, 'workers', 'worker-backup', 'worktree-root-agents.json');
      mkdirSync(join(repoDir, '.omc', 'state', 'team', teamName, 'workers', 'worker-backup'), { recursive: true });
      writeFileSync(backupPath, JSON.stringify({
        worktreePath: join(repoDir, '.omc', 'team', teamName, 'worktrees', 'worker-backup'),
        hadOriginal: true,
        originalContent: 'original',
        installedContent: 'managed',
        installedAt: new Date().toISOString(),
      }), 'utf-8');

      const result = cleanupTeamWorktrees(teamName, repoDir);

      expect(result.removed).toHaveLength(0);
      expect(result.preserved).toHaveLength(1);
      expect(result.preserved[0]?.path).toBe(backupPath);
      expect(result.preserved[0]?.reason).toContain('orphaned_worktree_root_agents_backup');
      expect(existsSync(backupPath)).toBe(true);
    });

    it('preserves team state cleanup when worktree metadata is corrupt', () => {
      const metadataPath = join(repoDir, '.omc', 'state', 'team', teamName, 'worktrees.json');
      mkdirSync(join(repoDir, '.omc', 'state', 'team', teamName), { recursive: true });
      writeFileSync(metadataPath, '{not-json', 'utf-8');

      const result = cleanupTeamWorktrees(teamName, repoDir);

      expect(result.removed).toHaveLength(0);
      expect(result.preserved).toHaveLength(1);
      expect(result.preserved[0]?.path).toBe(metadataPath);
      expect(result.preserved[0]?.reason).toContain('worktree_metadata_unreadable');
      expect(existsSync(metadataPath)).toBe(true);
    });
  });
});
