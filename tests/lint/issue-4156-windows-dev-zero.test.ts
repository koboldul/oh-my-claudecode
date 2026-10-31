import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import {
  identitiesEqual,
  sameFileIdentity,
} from '../../src/lib/file-identity.js';

/**
 * Regression test for issue #4156: Windows file identity comparison
 *
 * On Windows, Node.js returns:
 * - fstatSync(fd).dev: real volume serial number
 * - lstatSync(path).dev: 0
 *
 * This caused atomic write verification to fail with:
 * "atomic write temporary file was replaced before rename"
 *
 * The shared file-identity helper:
 * 1. Always compares inode
 * 2. Rejects an unknown inode even when dev is zero
 * 3. Skips a mismatched dev on Windows only when either dev value is zero
 */
describe('issue #4156: Windows file identity comparison (dev=0 from lstat)', () => {
  const root = process.cwd();

  const read = (...parts: string[]) => readFileSync(join(root, ...parts), 'utf8');

  function section(content: string, startMarker: string, endMarker: string): string {
    const start = content.indexOf(startMarker);
    const end = content.indexOf(endMarker, start);
    expect(start, `${startMarker} not found`).toBeGreaterThanOrEqual(0);
    expect(end, `${endMarker} not found`).toBeGreaterThan(start);
    return content.slice(start, end);
  }

  function functionBody(content: string, signature: string): string {
    const start = content.indexOf(signature);
    const end = content.indexOf('\n}', start);
    expect(start, `${signature} not found`).toBeGreaterThanOrEqual(0);
    expect(end, `${signature} end not found`).toBeGreaterThan(start);
    return content.slice(start, end + 2);
  }

  it('shared helper enforces inode and zero-device rules with BigInt identities', () => {
    const inode = 9_007_199_254_740_993n;

    expect(sameFileIdentity({ dev: 17n, ino: inode }, { dev: 17n, ino: inode })).toBe(true);
    expect(sameFileIdentity({ dev: 17n, ino: inode }, { dev: 18n, ino: inode })).toBe(false);
    expect(sameFileIdentity({ dev: 0n, ino: inode }, { dev: 0n, ino: inode })).toBe(true);
    expect(
      sameFileIdentity({ dev: 17n, ino: inode }, { dev: 0n, ino: inode }),
    ).toBe(process.platform === 'win32');
    expect(sameFileIdentity({ dev: 0n, ino: 0n }, { dev: 0n, ino: 0n })).toBe(false);
    expect(sameFileIdentity({ dev: 17n, ino: inode }, { dev: 17n, ino: inode + 1n })).toBe(false);
    expect(identitiesEqual(null, { dev: 17n, ino: inode })).toBe(false);
  });

  it('src/lib/atomic-write.ts delegates publication identity fences to the shared helper', () => {
    const content = read('src', 'lib', 'atomic-write.ts');

    expect(content).toContain('from "./file-identity.js";');
    expect(section(content, 'function verifyPrivateTempFile(', '/** Verify that publication')).toContain(
      'identitiesEqual(fdStats, pathStats)',
    );
    expect(section(content, 'function verifyPublishedFile(', '/** Optional hooks')).toContain(
      'identitiesEqual(fdStats, pathStats)',
    );
    expect(section(content, 'function rollbackPriorTarget(', 'function removeBackup(')).toContain(
      'identitiesEqual(current, expectedIdentity)',
    );
  });

  it('src/lib/mode-state-io.ts imports and uses the canonical helper directly', () => {
    const content = read('src', 'lib', 'mode-state-io.ts');

    expect(content).toContain("import { sameFileIdentity } from './file-identity.js';");
    expect(functionBody(content, 'function sameFile(path: string, expected: FileIdentity)')).toContain(
      'sameFileIdentity(actual, expected)',
    );
  });

  it.each([
    ['scripts/lib/atomic-write.mjs'],
    ['templates/hooks/lib/atomic-write.mjs'],
  ])('%s keeps the standalone helper aligned with the canonical zero-device rules', (file) => {
    const content = read(...file.split('/'));
    const identityBody = functionBody(content, 'function sameFileIdentity(a, b)');

    expect(identityBody).toContain('if (a.ino !== b.ino) return false');
    expect(identityBody).toContain('a.ino !== 0n');
    expect(identityBody).toContain("process.platform === 'win32' || a.dev === b.dev");
    expect(identityBody).toContain('return a.dev === b.dev');
    expect(functionBody(content, 'function sameFile(path, expected)')).toContain(
      'sameFileIdentity(actual, expected)',
    );
  });
});
