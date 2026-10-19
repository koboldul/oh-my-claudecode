import { afterEach, describe, expect, it, vi } from 'vitest';
import { chmodSync, existsSync, linkSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync, } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { getProcessStartIdentitySync } from '../../platform/process-utils.js';
// @ts-expect-error Hook runtime source is intentionally JavaScript-only.
import { withStateFileLockSync } from '../../../scripts/lib/atomic-write.mjs';
import { tmpdir } from 'os';
const fsPromisesControl = vi.hoisted(() => ({
    renameHook: undefined,
    openHook: undefined,
    writeHook: undefined,
}));
const fsStatsControl = vi.hoisted(() => ({
    windowsDeviceMismatch: false,
    posixMode: undefined,
}));
vi.mock('fs', async (importOriginal) => {
    const actual = await importOriginal();
    const statSemantics = (stats, descriptor) => {
        if (fsStatsControl.windowsDeviceMismatch) {
            const dev = descriptor ? 2215166872 : 0;
            stats.dev = typeof stats.dev === 'bigint' ? BigInt(dev) : dev;
        }
        if (fsStatsControl.posixMode !== undefined) {
            stats.dev = typeof stats.dev === 'bigint' ? 1n : 1;
            stats.nlink = typeof stats.nlink === 'bigint' ? 1n : 1;
            stats.mode = typeof stats.mode === 'bigint'
                ? (stats.mode & ~511n) | BigInt(fsStatsControl.posixMode)
                : (stats.mode & ~0o777) | fsStatsControl.posixMode;
        }
        return stats;
    };
    return {
        ...actual,
        fstatSync: (...args) => statSemantics(actual.fstatSync(...args), true),
        lstatSync: (...args) => {
            const stats = actual.lstatSync(...args);
            return stats ? statSemantics(stats, false) : stats;
        },
    };
});
vi.mock('fs/promises', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        rename: async (from, to) => {
            await fsPromisesControl.renameHook?.(from, to);
            await actual.rename(from, to);
        },
        open: async (filePath, flags, mode) => {
            await fsPromisesControl.openHook?.(mode);
            const fd = await actual.open(filePath, flags, mode);
            fsPromisesControl.writeHook?.(fd);
            return fd;
        },
    };
});
import { atomicWriteBatchSync, atomicWriteFileSync, atomicWriteJson, } from '../atomic-write.js';
import { identitiesEqual } from '../file-identity.js';
function deferred() {
    let resolve;
    return { promise: new Promise(done => { resolve = done; }), resolve };
}
describe('atomicWriteJson', () => {
    const directories = [];
    const originalPlatform = process.platform;
    afterEach(() => {
        fsPromisesControl.renameHook = undefined;
        fsPromisesControl.openHook = undefined;
        fsPromisesControl.writeHook = undefined;
        fsStatsControl.windowsDeviceMismatch = false;
        fsStatsControl.posixMode = undefined;
        Object.defineProperty(process, 'platform', { configurable: true, value: originalPlatform });
        delete process.env.OMC_TEST_FLOCK_AVAILABLE;
        for (const directory of directories.splice(0)) {
            rmSync(directory, { recursive: true, force: true });
        }
    });
    it('publishes only complete JSON while rename is pending', async () => {
        const directory = mkdtempSync(join(tmpdir(), 'atomic-write-'));
        directories.push(directory);
        const filePath = join(directory, 'state.json');
        const oldValue = { status: 'old' };
        const nextValue = { status: 'new', items: ['complete'] };
        const renameEntered = deferred();
        const releaseRename = deferred();
        writeFileSync(filePath, JSON.stringify(oldValue));
        fsPromisesControl.renameHook = async (_from, to) => {
            if (to === filePath) {
                renameEntered.resolve();
                await releaseRename.promise;
            }
        };
        const writer = atomicWriteJson(filePath, nextValue);
        try {
            await renameEntered.promise;
            expect(JSON.parse(readFileSync(filePath, 'utf8'))).toEqual(oldValue);
        }
        finally {
            releaseRename.resolve();
        }
        await writer;
        expect(JSON.parse(readFileSync(filePath, 'utf8'))).toEqual(nextValue);
    });
    it('completes short writes before renaming the JSON payload', async () => {
        const directory = mkdtempSync(join(tmpdir(), 'atomic-write-short-write-'));
        directories.push(directory);
        const filePath = join(directory, 'state.json');
        const nextValue = { status: 'new', items: ['complete', 'utf8-✓'] };
        const expectedContent = JSON.stringify(nextValue, null, 2);
        const writeOffsets = [];
        fsPromisesControl.writeHook = fd => {
            const originalWrite = fd.write.bind(fd);
            Object.defineProperty(fd, 'write', {
                value: async (buffer, offset, length, position) => {
                    writeOffsets.push(offset);
                    return originalWrite(buffer, offset, Math.min(length, 3), position);
                },
            });
        };
        fsPromisesControl.renameHook = async (from, to) => {
            if (to === filePath) {
                expect(readFileSync(from)).toEqual(Buffer.from(expectedContent, 'utf8'));
            }
        };
        await atomicWriteJson(filePath, nextValue);
        expect(writeOffsets).toEqual(Array.from({ length: Math.ceil(Buffer.byteLength(expectedContent) / 3) }, (_, index) => index * 3));
        expect(readFileSync(filePath, 'utf8')).toBe(expectedContent);
    });
    it('rejects zero-byte write progress, preserves the old target, and removes the temp file', async () => {
        const directory = mkdtempSync(join(tmpdir(), 'atomic-write-zero-progress-'));
        directories.push(directory);
        const filePath = join(directory, 'state.json');
        const oldValue = { status: 'old' };
        writeFileSync(filePath, JSON.stringify(oldValue));
        fsPromisesControl.writeHook = fd => {
            Object.defineProperty(fd, 'write', {
                value: async (buffer) => ({ bytesWritten: 0, buffer }),
            });
        };
        await expect(atomicWriteJson(filePath, { status: 'new' })).rejects.toThrow('Failed to write complete JSON payload');
        expect(JSON.parse(readFileSync(filePath, 'utf8'))).toEqual(oldValue);
        expect(readdirSync(directory)).toEqual(['state.json']);
    });
    it('propagates FileHandle write failures, preserves the old target, and removes the temp file', async () => {
        const directory = mkdtempSync(join(tmpdir(), 'atomic-write-write-error-'));
        directories.push(directory);
        const filePath = join(directory, 'state.json');
        const oldValue = { status: 'old' };
        const failure = new Error('temp write failed');
        writeFileSync(filePath, JSON.stringify(oldValue));
        fsPromisesControl.writeHook = fd => {
            Object.defineProperty(fd, 'write', {
                value: async () => { throw failure; },
            });
        };
        await expect(atomicWriteJson(filePath, { status: 'new' })).rejects.toBe(failure);
        expect(JSON.parse(readFileSync(filePath, 'utf8'))).toEqual(oldValue);
        expect(readdirSync(directory)).toEqual(['state.json']);
    });
    it.each(['native', 'posix'])('creates missing parents and requests owner-only replacement files (%s)', async (semantics) => {
        const directory = mkdtempSync(join(tmpdir(), 'atomic-write-parent-'));
        directories.push(directory);
        const filePath = join(directory, 'nested', 'state.json');
        const openModes = [];
        fsPromisesControl.openHook = async (mode) => { openModes.push(mode); };
        if (semantics === 'posix') {
            Object.defineProperty(process, 'platform', { configurable: true, value: 'linux' });
            fsStatsControl.posixMode = 0o600;
        }
        await atomicWriteJson(filePath, { status: 'new' });
        expect(JSON.parse(readFileSync(filePath, 'utf8'))).toEqual({ status: 'new' });
        expect(openModes[0]).toBe(0o600);
        // Node on Windows has no owner/group distinction and reports writable files as 0666.
        expect(statSync(filePath).mode & 0o777).toBe(originalPlatform === 'win32' ? 0o666 : 0o600);
    });
    it('publishes a normal atomic write under Windows stat semantics', async () => {
        const directory = mkdtempSync(join(tmpdir(), 'atomic-write-win32-'));
        directories.push(directory);
        const filePath = join(directory, 'state.json');
        const originalPlatform = process.platform;
        Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' });
        try {
            await atomicWriteJson(filePath, { status: 'new' });
        }
        finally {
            Object.defineProperty(process, 'platform', { configurable: true, value: originalPlatform });
        }
        expect(JSON.parse(readFileSync(filePath, 'utf8'))).toEqual({ status: 'new' });
    });
    it.each(['async', 'sync', 'batch'])('publishes %s writes with Windows zero-device pathname metadata', async (kind) => {
        const directory = mkdtempSync(join(tmpdir(), `atomic-write-win32-${kind}-`));
        directories.push(directory);
        const filePath = join(directory, 'state.json');
        const nextValue = { status: 'new' };
        const content = JSON.stringify(nextValue);
        writeFileSync(filePath, JSON.stringify({ status: 'old' }));
        Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' });
        fsStatsControl.windowsDeviceMismatch = true;
        if (kind === 'async') {
            await atomicWriteJson(filePath, nextValue);
        }
        else if (kind === 'sync') {
            atomicWriteFileSync(filePath, content);
        }
        else {
            atomicWriteBatchSync([{ path: filePath, content }]);
        }
        expect(JSON.parse(readFileSync(filePath, 'utf8'))).toEqual(nextValue);
        expect(readdirSync(directory)).toEqual(['state.json']);
    });
    it.each([
        ['Windows changed inode', 'win32', { dev: 2215166872, ino: 7 }, { dev: 0, ino: 8 }],
        ['Windows unknown inode', 'win32', { dev: 2215166872, ino: 0 }, { dev: 0, ino: 0 }],
        ['Windows conflicting devices', 'win32', { dev: 1, ino: 7 }, { dev: 2, ino: 7 }],
        ['non-Windows missing device', 'linux', { dev: 1, ino: 7 }, { dev: 0, ino: 7 }],
        ['non-Windows unknown inode', 'linux', { dev: 0, ino: 0 }, { dev: 0, ino: 0 }],
        ['missing pathname identity', 'win32', null, { dev: 1, ino: 7 }],
    ])('rejects unsafe file identity metadata (%s)', (_name, platform, left, right) => {
        Object.defineProperty(process, 'platform', { configurable: true, value: platform });
        expect(identitiesEqual(left, right)).toBe(false);
    });
    it.each([
        ['async', true], ['async', false],
        ['sync', true], ['sync', false],
        ['batch', true], ['batch', false],
    ])('rolls back fenced Windows %s publication with zero-device metadata (prior target: %s)', async (kind, hasPriorTarget) => {
        const directory = mkdtempSync(join(tmpdir(), 'atomic-write-win32-rollback-'));
        directories.push(directory);
        const filePath = join(directory, 'state.json');
        if (hasPriorTarget)
            writeFileSync(filePath, 'old');
        Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' });
        fsStatsControl.windowsDeviceMismatch = true;
        const hooks = { afterRename: () => { throw new Error('publication fenced'); } };
        if (kind === 'async') {
            await expect(atomicWriteJson(filePath, 'new', hooks)).rejects.toThrow('publication fenced');
        }
        else if (kind === 'sync') {
            expect(() => atomicWriteFileSync(filePath, 'new', hooks)).toThrow('publication fenced');
        }
        else {
            expect(() => atomicWriteBatchSync([{ path: filePath, content: 'new' }], hooks)).toThrow('publication fenced');
        }
        if (hasPriorTarget) {
            expect(readFileSync(filePath, 'utf8')).toBe('old');
        }
        else {
            expect(existsSync(filePath)).toBe(false);
        }
        expect(readdirSync(directory)).toEqual(hasPriorTarget ? ['state.json'] : []);
    });
    it.each(['async', 'sync', 'batch'])('preserves a foreign Windows replacement during %s rollback despite zero-device pathname metadata', async (kind) => {
        const directory = mkdtempSync(join(tmpdir(), 'atomic-write-win32-replacement-'));
        directories.push(directory);
        const filePath = join(directory, 'state.json');
        writeFileSync(filePath, 'old');
        Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' });
        fsStatsControl.windowsDeviceMismatch = true;
        const hooks = {
            afterRename: () => {
                unlinkSync(filePath);
                writeFileSync(filePath, 'foreign');
            },
        };
        if (kind === 'async') {
            await expect(atomicWriteJson(filePath, 'new', hooks)).rejects.toThrow('target was replaced at publication');
        }
        else if (kind === 'sync') {
            expect(() => atomicWriteFileSync(filePath, 'new', hooks)).toThrow('target was replaced at publication');
        }
        else {
            expect(() => atomicWriteBatchSync([{ path: filePath, content: 'new' }], hooks)).toThrow('target was replaced at publication');
        }
        expect(readFileSync(filePath, 'utf8')).toBe('foreign');
        expect(readdirSync(directory)).toEqual(['state.json']);
    });
    it.each(['hardlink', 'special', 'replacement', 'permissions'])('rejects an untrusted temporary generation (%s) before rename', async (kind) => {
        const directory = mkdtempSync(join(tmpdir(), `atomic-write-${kind}-`));
        directories.push(directory);
        const filePath = join(directory, 'state.json');
        const oldValue = { status: 'old' };
        writeFileSync(filePath, JSON.stringify(oldValue));
        let extraPath;
        if (kind === 'permissions') {
            // Windows chmod cannot model POSIX group/other permission bits.
            Object.defineProperty(process, 'platform', { configurable: true, value: 'linux' });
            fsStatsControl.posixMode = 0o600;
        }
        fsPromisesControl.writeHook = () => {
            const tempName = readdirSync(directory).find(name => name.startsWith('.state.json.tmp.'));
            if (!tempName)
                throw new Error('atomic temp generation unavailable');
            const tempPath = join(directory, tempName);
            if (kind === 'hardlink') {
                extraPath = `${tempPath}.link`;
                linkSync(tempPath, extraPath);
            }
            else if (kind === 'special') {
                unlinkSync(tempPath);
                mkdirSync(tempPath);
            }
            else if (kind === 'replacement') {
                unlinkSync(tempPath);
                writeFileSync(tempPath, 'attacker replacement');
            }
            else {
                chmodSync(tempPath, 0o644);
                fsStatsControl.posixMode = 0o644;
            }
        };
        await expect(atomicWriteJson(filePath, { status: 'new' })).rejects.toThrow(/private regular single-link|replaced before rename/);
        expect(JSON.parse(readFileSync(filePath, 'utf8'))).toEqual(oldValue);
        if (extraPath !== undefined)
            rmSync(extraPath, { force: true });
    });
    it('rejects a temp replacement at rename without overwriting the foreign target', async () => {
        const directory = mkdtempSync(join(tmpdir(), 'atomic-write-publication-race-'));
        directories.push(directory);
        const filePath = join(directory, 'state.json');
        const oldValue = { status: 'old' };
        writeFileSync(filePath, JSON.stringify(oldValue));
        let raced = false;
        fsPromisesControl.renameHook = async (from) => {
            if (raced)
                return;
            raced = true;
            unlinkSync(from.toString());
            writeFileSync(from.toString(), JSON.stringify({ status: 'attacker' }));
        };
        await expect(atomicWriteJson(filePath, { status: 'new' })).rejects.toThrow('target was replaced at publication');
        expect(JSON.parse(readFileSync(filePath, 'utf8'))).toEqual({ status: 'attacker' });
        expect(readdirSync(directory)).toEqual(['state.json']);
    });
    it.each(['sync', 'batch'])('rolls back the prior target when %s publication loses its ownership hook', kind => {
        const directory = mkdtempSync(join(tmpdir(), `atomic-write-${kind}-boundary-`));
        directories.push(directory);
        const filePath = join(directory, 'state.json');
        writeFileSync(filePath, 'old', 'utf8');
        const hooks = { afterRename: () => { throw new Error('publication fenced'); } };
        if (kind === 'sync') {
            expect(() => atomicWriteFileSync(filePath, 'new', hooks)).toThrow('publication fenced');
        }
        else {
            expect(() => atomicWriteBatchSync([{ path: filePath, content: 'new' }], hooks)).toThrow('publication fenced');
        }
        expect(readFileSync(filePath, 'utf8')).toBe('old');
        expect(readdirSync(directory)).toEqual(['state.json']);
    });
    it('propagates temp write failures without publishing a target', async () => {
        const directory = mkdtempSync(join(tmpdir(), 'atomic-write-write-error-'));
        directories.push(directory);
        const filePath = join(directory, 'state.json');
        const failure = new Error('temp write failed');
        fsPromisesControl.openHook = async () => { throw failure; };
        await expect(atomicWriteJson(filePath, { status: 'new' })).rejects.toBe(failure);
        expect(existsSync(filePath)).toBe(false);
        expect(readdirSync(directory)).toEqual([]);
    });
    it('propagates rename failures, preserves the old target, and removes the temp file', async () => {
        const directory = mkdtempSync(join(tmpdir(), 'atomic-write-error-'));
        directories.push(directory);
        const filePath = join(directory, 'state.json');
        const oldValue = { status: 'old' };
        const failure = new Error('rename failed');
        writeFileSync(filePath, JSON.stringify(oldValue));
        fsPromisesControl.renameHook = async () => { throw failure; };
        await expect(atomicWriteJson(filePath, { status: 'new' })).rejects.toBe(failure);
        expect(JSON.parse(readFileSync(filePath, 'utf8'))).toEqual(oldValue);
        expect(readdirSync(directory)).toEqual(['state.json']);
        expect(existsSync(filePath)).toBe(true);
    });
    it('reclaims stale generic lock artifacts under the SQLite guard', () => {
        const directory = mkdtempSync(join(tmpdir(), 'atomic-write-lock-'));
        directories.push(directory);
        process.env.NODE_ENV = 'test';
        process.env.OMC_TEST_FLOCK_AVAILABLE = '0';
        const filePath = join(directory, 'state.json');
        writeFileSync(`${filePath}.mutation.lock`, JSON.stringify({ version: 1, pid: 999999999, processStart: '1', createdAt: new Date().toISOString(), nonce: randomUUID() }));
        expect(withStateFileLockSync(filePath, () => 'written')).toEqual({ acquired: true, value: 'written' });
        expect(existsSync(`${filePath}.mutation.lock`)).toBe(false);
    });
    it('rejects a live lock artifact without an unlocked fallback', () => {
        const directory = mkdtempSync(join(tmpdir(), 'atomic-write-lock-live-'));
        directories.push(directory);
        process.env.NODE_ENV = 'test';
        process.env.OMC_TEST_FLOCK_AVAILABLE = '0';
        const filePath = join(directory, 'state.json');
        const processStart = getProcessStartIdentitySync(process.pid);
        if (processStart === null)
            throw new Error('current process identity unavailable');
        writeFileSync(`${filePath}.mutation.lock`, JSON.stringify({ version: 1, pid: process.pid, processStart, createdAt: new Date().toISOString(), nonce: randomUUID() }));
        expect(withStateFileLockSync(filePath, () => 'written')).toEqual({ acquired: false, value: undefined });
        expect(existsSync(`${filePath}.mutation.lock`)).toBe(true);
    });
});
//# sourceMappingURL=atomic-write.test.js.map