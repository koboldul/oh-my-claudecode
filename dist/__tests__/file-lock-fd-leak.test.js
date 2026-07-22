import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync, utimesSync, } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
vi.mock('fs', async () => {
    const actual = await vi.importActual('fs');
    return {
        ...actual,
        openSync: vi.fn(actual.openSync),
        closeSync: vi.fn(actual.closeSync),
        fsyncSync: vi.fn(actual.fsyncSync),
        writeSync: vi.fn(actual.writeSync),
        unlinkSync: vi.fn(actual.unlinkSync),
    };
});
import { openSync as mockOpenSync, closeSync as mockCloseSync, fsyncSync as mockFsyncSync, writeSync as mockWriteSync, unlinkSync as mockUnlinkSync, } from 'fs';
import { acquireFileLockSync, releaseFileLockSync, } from '../lib/file-lock.js';
const mockedOpenSync = vi.mocked(mockOpenSync);
const mockedCloseSync = vi.mocked(mockCloseSync);
const mockedFsyncSync = vi.mocked(mockFsyncSync);
const mockedWriteSync = vi.mocked(mockWriteSync);
const mockedUnlinkSync = vi.mocked(mockUnlinkSync);
describe('file-lock fd leak on writeSync failure', () => {
    let testDir;
    beforeEach(async () => {
        testDir = join(tmpdir(), `file-lock-fd-leak-${Date.now()}-${Math.random().toString(36).slice(2)}`);
        mkdirSync(testDir, { recursive: true });
        vi.clearAllMocks();
        const realFs = await vi.importActual('fs');
        mockedOpenSync.mockImplementation(realFs.openSync);
        mockedCloseSync.mockImplementation(realFs.closeSync);
        mockedFsyncSync.mockImplementation(realFs.fsyncSync);
        mockedWriteSync.mockImplementation(realFs.writeSync);
        mockedUnlinkSync.mockImplementation(realFs.unlinkSync);
    });
    afterEach(() => {
        vi.restoreAllMocks();
        if (existsSync(testDir)) {
            rmSync(testDir, { recursive: true, force: true });
        }
    });
    it('should close fd and unlink lock file when writeSync throws on primary path', async () => {
        const realFs = await vi.importActual('fs');
        const capturedFds = [];
        const closedFds = [];
        const pathsByFd = new Map();
        const lockPath = join(testDir, 'primary.lock');
        mockedOpenSync.mockImplementation((...args) => {
            const fd = realFs.openSync(...args);
            capturedFds.push(fd);
            pathsByFd.set(fd, String(args[0]));
            return fd;
        });
        mockedCloseSync.mockImplementation((fd) => {
            closedFds.push(fd);
            realFs.closeSync(fd);
        });
        mockedUnlinkSync.mockImplementation(realFs.unlinkSync);
        mockedWriteSync.mockImplementation((...args) => {
            if (pathsByFd.get(args[0]) === lockPath) {
                throw new Error('simulated write failure');
            }
            return realFs.writeSync(...args);
        });
        expect(() => acquireFileLockSync(lockPath)).toThrow('simulated write failure');
        expect(capturedFds).toHaveLength(2);
        expect(closedFds).toEqual(expect.arrayContaining(capturedFds));
        expect(existsSync(lockPath)).toBe(false);
        expect(existsSync(`${lockPath}.reclaim.guard`)).toBe(false);
    });
    it('should close fd and unlink lock file when writeSync throws on retry path', async () => {
        const realFs = await vi.importActual('fs');
        const capturedFds = [];
        const closedFds = [];
        const pathsByFd = new Map();
        const lockPath = join(testDir, 'retry.lock');
        mockedOpenSync.mockImplementation((...args) => {
            const fd = realFs.openSync(...args);
            capturedFds.push(fd);
            pathsByFd.set(fd, String(args[0]));
            return fd;
        });
        mockedCloseSync.mockImplementation((fd) => {
            closedFds.push(fd);
            realFs.closeSync(fd);
        });
        mockedUnlinkSync.mockImplementation(realFs.unlinkSync);
        mockedWriteSync.mockImplementation((...args) => {
            if (pathsByFd.get(args[0]) === lockPath) {
                throw new Error('simulated write failure on retry');
            }
            return realFs.writeSync(...args);
        });
        writeFileSync(lockPath, JSON.stringify({ pid: 999999999, timestamp: Date.now() - 60_000 }));
        const oldTime = new Date(Date.now() - 60_000);
        utimesSync(lockPath, oldTime, oldTime);
        const handle = acquireFileLockSync(lockPath, { staleLockMs: 1000 });
        expect(handle).toBeNull();
        expect(capturedFds).toHaveLength(2);
        expect(closedFds).toEqual(expect.arrayContaining(capturedFds));
        expect(existsSync(lockPath)).toBe(false);
        expect(existsSync(`${lockPath}.reclaim.guard`)).toBe(false);
    });
    it('publishes the full owner payload across partial writes before acquisition', async () => {
        const realFs = await vi.importActual('fs');
        const partialWrite = (fd, buffer, offset, length, position) => realFs.writeSync(fd, buffer, offset, Math.min(length, 7), position);
        mockedWriteSync.mockImplementation(partialWrite);
        const lockPath = join(testDir, 'partial-write.lock');
        const handle = acquireFileLockSync(lockPath);
        expect(handle).not.toBeNull();
        expect(mockedWriteSync.mock.calls.length).toBeGreaterThan(1);
        expect(mockedFsyncSync).toHaveBeenCalledTimes(2);
        expect(JSON.parse(readFileSync(lockPath, 'utf8'))).toMatchObject({
            version: 2,
            pid: process.pid,
            nonce: handle.owner.nonce,
        });
        releaseFileLockSync(handle);
    });
    it('rejects and removes an owner payload that fails content verification', async () => {
        const realFs = await vi.importActual('fs');
        const lockPath = join(testDir, 'corrupt-owner.lock');
        const pathsByFd = new Map();
        mockedOpenSync.mockImplementation((...args) => {
            const fd = realFs.openSync(...args);
            pathsByFd.set(fd, String(args[0]));
            return fd;
        });
        mockedFsyncSync.mockImplementation((fd) => {
            realFs.fsyncSync(fd);
            if (pathsByFd.get(fd) === lockPath) {
                realFs.writeSync(fd, Buffer.from('!'), 0, 1, 0);
                realFs.fsyncSync(fd);
            }
        });
        expect(() => acquireFileLockSync(lockPath))
            .toThrow('Failed to verify file lock owner');
        expect(existsSync(lockPath)).toBe(false);
        expect(existsSync(`${lockPath}.reclaim.guard`)).toBe(false);
    });
});
//# sourceMappingURL=file-lock-fd-leak.test.js.map