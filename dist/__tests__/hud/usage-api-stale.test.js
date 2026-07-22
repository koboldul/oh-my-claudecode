/**
 * Tests for stale data handling in usage API.
 *
 * - 429 responses should set stale: true on returned UsageResult
 * - lastSuccessAt tracks when data was last successfully fetched
 * - After 15 minutes from lastSuccessAt, stale data is discarded
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { tmpdir } from 'os';
import { basename, dirname, join } from 'path';
const CLAUDE_CONFIG_DIR = join(tmpdir(), 'test-claude');
const CACHE_DIR = join(CLAUDE_CONFIG_DIR, 'plugins', 'oh-my-claudecode');
const CACHE_PATH = join(CACHE_DIR, '.usage-cache-zai.json');
function createFsMock(initialFiles) {
    const files = new Map(Object.entries(initialFiles));
    const identities = new Map();
    const directories = new Set([CLAUDE_CONFIG_DIR, CACHE_DIR]);
    const descriptors = new Map();
    let nextDescriptor = 1;
    let nextInode = 1;
    for (const path of files.keys()) {
        identities.set(path, { dev: 1, ino: nextInode++, mtimeMs: Date.now() });
    }
    const existsSync = vi.fn((path) => files.has(String(path)) || directories.has(String(path)));
    const readFileSync = vi.fn((path) => {
        const content = files.get(String(path));
        if (content == null)
            throw new Error(`ENOENT: ${path}`);
        return content;
    });
    const writeFileSync = vi.fn((path, content) => {
        const normalized = String(path);
        files.set(normalized, String(content));
        if (!identities.has(normalized)) {
            identities.set(normalized, { dev: 1, ino: nextInode++, mtimeMs: Date.now() });
        }
    });
    const mkdirSync = vi.fn((path) => {
        directories.add(String(path));
    });
    const unlinkSync = vi.fn((path) => {
        const normalized = String(path);
        files.delete(normalized);
        identities.delete(normalized);
    });
    const openSync = vi.fn((path) => {
        const normalized = String(path);
        if (files.has(normalized)) {
            const err = new Error(`EEXIST: ${normalized}`);
            err.code = 'EEXIST';
            throw err;
        }
        files.set(normalized, '');
        identities.set(normalized, { dev: 1, ino: nextInode++, mtimeMs: Date.now() });
        const descriptor = nextDescriptor++;
        descriptors.set(descriptor, normalized);
        return descriptor;
    });
    const lstatSync = vi.fn((path) => {
        const normalized = String(path);
        const identity = identities.get(normalized);
        if (!identity)
            throw new Error(`ENOENT: ${path}`);
        return { ...identity, size: Buffer.byteLength(files.get(normalized) ?? '') };
    });
    const fstatSync = vi.fn((descriptor) => {
        const path = descriptors.get(descriptor);
        if (!path)
            throw new Error(`EBADF: ${descriptor}`);
        return lstatSync(path);
    });
    const writeSync = vi.fn((descriptor, buffer, offset, length, position = 0) => {
        const path = descriptors.get(descriptor);
        if (!path)
            throw new Error(`EBADF: ${descriptor}`);
        const existing = Buffer.from(files.get(path) ?? '');
        const next = Buffer.alloc(Math.max(existing.length, position + length));
        existing.copy(next);
        buffer.copy(next, position, offset, offset + length);
        files.set(path, next.toString());
        return length;
    });
    const readSync = vi.fn((descriptor, buffer, offset, length, position = 0) => {
        const path = descriptors.get(descriptor);
        if (!path)
            throw new Error(`EBADF: ${descriptor}`);
        const source = Buffer.from(files.get(path) ?? '');
        return source.copy(buffer, offset, position, position + length);
    });
    const closeSync = vi.fn((descriptor) => {
        descriptors.delete(descriptor);
    });
    const linkSync = vi.fn((source, destination) => {
        if (files.has(destination)) {
            const err = new Error(`EEXIST: ${destination}`);
            err.code = 'EEXIST';
            throw err;
        }
        const identity = identities.get(source);
        if (!identity)
            throw new Error(`ENOENT: ${source}`);
        files.set(destination, files.get(source) ?? '');
        identities.set(destination, identity);
    });
    const readdirSync = vi.fn((directory) => [...files.keys()]
        .filter((path) => dirname(path) === directory)
        .map((path) => basename(path)));
    return {
        files,
        fsModule: {
            existsSync,
            readFileSync,
            writeFileSync,
            mkdirSync,
            unlinkSync,
            openSync,
            statSync: lstatSync,
            lstatSync,
            fstatSync,
            writeSync,
            readSync,
            fsyncSync: vi.fn(),
            closeSync,
            linkSync,
            readdirSync,
            renameSync: vi.fn(),
            constants: {
                O_CREAT: 0x40,
                O_EXCL: 0x80,
                O_WRONLY: 0x1,
                O_RDWR: 0x2,
            },
        },
    };
}
function setupMocks(fsModule, httpStatus, httpBody) {
    vi.doMock('../../utils/config-dir.js', () => ({
        getClaudeConfigDir: () => CLAUDE_CONFIG_DIR,
    }));
    vi.doMock('../../utils/ssrf-guard.js', () => ({
        validateAnthropicBaseUrl: () => ({ allowed: true }),
    }));
    vi.doMock('child_process', async () => ({
        ...(await vi.importActual('child_process')),
        execSync: vi.fn(),
    }));
    vi.doMock('fs', () => fsModule);
    vi.doMock('https', () => ({
        default: {
            request: vi.fn((_options, callback) => {
                const req = new EventEmitter();
                req.destroy = vi.fn();
                req.end = () => {
                    setTimeout(() => {
                        const res = new EventEmitter();
                        res.statusCode = httpStatus;
                        callback(res);
                        res.emit('data', httpBody);
                        res.emit('end');
                    }, 1);
                };
                return req;
            }),
        },
    }));
}
describe('usage API stale data handling', () => {
    const originalEnv = { ...process.env };
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        process.env = { ...originalEnv };
        process.env.ANTHROPIC_BASE_URL = 'https://api.z.ai/v1';
        process.env.ANTHROPIC_AUTH_TOKEN = 'test-token';
    });
    afterEach(() => {
        process.env = { ...originalEnv };
        vi.unmock('../../utils/config-dir.js');
        vi.unmock('../../utils/ssrf-guard.js');
        vi.unmock('fs');
        vi.unmock('child_process');
        vi.unmock('https');
    });
    it('sets stale=true when serving cached data on 429', async () => {
        const expiredCache = JSON.stringify({
            timestamp: Date.now() - 91_000,
            source: 'zai',
            data: {
                fiveHourPercent: 11,
                fiveHourResetsAt: null,
            },
        });
        const { fsModule } = createFsMock({ [CACHE_PATH]: expiredCache });
        setupMocks(fsModule, 429, '');
        const { getUsage } = await import('../../hud/usage-api.js');
        const result = await getUsage();
        expect(result.rateLimits).toBeDefined();
        expect(result.rateLimits?.fiveHourPercent).toBe(11);
        expect(result.error).toBe('rate_limited');
        expect(result.stale).toBe(true);
    });
    it('does not set stale on successful API response', async () => {
        const expiredCache = JSON.stringify({
            timestamp: Date.now() - 91_000,
            source: 'zai',
            data: { fiveHourPercent: 11 },
        });
        const { fsModule } = createFsMock({ [CACHE_PATH]: expiredCache });
        setupMocks(fsModule, 200, JSON.stringify({
            data: {
                limits: [
                    { type: 'TOKENS_LIMIT', percentage: 25, nextResetTime: Date.now() + 3_600_000 },
                ],
            },
        }));
        const { getUsage } = await import('../../hud/usage-api.js');
        const result = await getUsage();
        expect(result.rateLimits).toBeDefined();
        expect(result.rateLimits?.fiveHourPercent).toBe(25);
        expect(result.stale).toBeUndefined();
    });
    it('preserves lastSuccessAt in cache across 429 rewrites', async () => {
        const lastSuccess = Date.now() - 300_000; // 5 minutes ago
        const expiredCache = JSON.stringify({
            timestamp: Date.now() - 91_000,
            source: 'zai',
            lastSuccessAt: lastSuccess,
            data: { fiveHourPercent: 11 },
        });
        const { files, fsModule } = createFsMock({ [CACHE_PATH]: expiredCache });
        setupMocks(fsModule, 429, '');
        const { getUsage } = await import('../../hud/usage-api.js');
        await getUsage();
        // Cache should preserve the original lastSuccessAt
        const written = JSON.parse(files.get(CACHE_PATH));
        expect(written.lastSuccessAt).toBe(lastSuccess);
    });
    it('sets lastSuccessAt on successful API response', async () => {
        const expiredCache = JSON.stringify({
            timestamp: Date.now() - 91_000,
            source: 'zai',
            data: { fiveHourPercent: 11 },
        });
        const { files, fsModule } = createFsMock({ [CACHE_PATH]: expiredCache });
        setupMocks(fsModule, 200, JSON.stringify({
            data: {
                limits: [
                    { type: 'TOKENS_LIMIT', percentage: 25, nextResetTime: Date.now() + 3_600_000 },
                ],
            },
        }));
        const now = Date.now();
        const { getUsage } = await import('../../hud/usage-api.js');
        await getUsage();
        const written = JSON.parse(files.get(CACHE_PATH));
        expect(written.lastSuccessAt).toBeGreaterThanOrEqual(now);
    });
    it('discards stale data after 15 minutes from lastSuccessAt', async () => {
        const sixteenMinutesAgo = Date.now() - 16 * 60_000;
        // Cache is within rate-limited backoff window (valid) but lastSuccessAt is > 15min
        const validRateLimitedCache = JSON.stringify({
            timestamp: Date.now() - 60_000, // 1 min ago (within 2min backoff)
            source: 'zai',
            lastSuccessAt: sixteenMinutesAgo,
            data: { fiveHourPercent: 11 },
            rateLimited: true,
            rateLimitedCount: 1,
        });
        const { fsModule } = createFsMock({ [CACHE_PATH]: validRateLimitedCache });
        vi.doMock('../../utils/config-dir.js', () => ({
            getClaudeConfigDir: () => CLAUDE_CONFIG_DIR,
        }));
        vi.doMock('../../utils/ssrf-guard.js', () => ({
            validateAnthropicBaseUrl: () => ({ allowed: true }),
        }));
        vi.doMock('child_process', async () => ({
            ...(await vi.importActual('child_process')),
            execSync: vi.fn(),
        }));
        vi.doMock('fs', () => fsModule);
        const { getUsage } = await import('../../hud/usage-api.js');
        const result = await getUsage();
        // Should discard the data and show error
        expect(result.rateLimits).toBeNull();
        expect(result.error).toBe('rate_limited');
    });
    it('preserves last-known-good usage on transient network failures and marks it stale', async () => {
        const lastSuccess = Date.now() - 5 * 60_000;
        const expiredCache = JSON.stringify({
            timestamp: Date.now() - 91_000,
            source: 'zai',
            lastSuccessAt: lastSuccess,
            data: {
                fiveHourPercent: 11,
                fiveHourResetsAt: null,
            },
        });
        const { files, fsModule } = createFsMock({ [CACHE_PATH]: expiredCache });
        setupMocks(fsModule, 500, '');
        const { getUsage } = await import('../../hud/usage-api.js');
        const result = await getUsage();
        expect(result).toEqual({
            rateLimits: {
                fiveHourPercent: 11,
                fiveHourResetsAt: null,
            },
            error: 'network',
            stale: true,
        });
        const written = JSON.parse(files.get(CACHE_PATH));
        expect(written.data).toEqual({
            fiveHourPercent: 11,
            fiveHourResetsAt: null,
        });
        expect(written.error).toBe(true);
        expect(written.errorReason).toBe('network');
        expect(written.lastSuccessAt).toBe(lastSuccess);
    });
    it('does not preserve stale fallback data past the max stale window on transient failures', async () => {
        const sixteenMinutesAgo = Date.now() - 16 * 60_000;
        const expiredCache = JSON.stringify({
            timestamp: Date.now() - 91_000,
            source: 'zai',
            lastSuccessAt: sixteenMinutesAgo,
            data: {
                fiveHourPercent: 11,
                fiveHourResetsAt: null,
            },
        });
        const { files, fsModule } = createFsMock({ [CACHE_PATH]: expiredCache });
        setupMocks(fsModule, 500, '');
        const { getUsage } = await import('../../hud/usage-api.js');
        const result = await getUsage();
        expect(result).toEqual({
            rateLimits: null,
            error: 'network',
        });
        const written = JSON.parse(files.get(CACHE_PATH));
        expect(written.data).toBeNull();
        expect(written.error).toBe(true);
        expect(written.errorReason).toBe('network');
        expect(written.lastSuccessAt).toBe(sixteenMinutesAgo);
    });
    it('reuses stale transient failure cache long enough to avoid immediate retry hammering', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-03-10T00:00:00Z'));
        const validTransientFailureCache = JSON.stringify({
            timestamp: Date.now() - 90_000,
            source: 'zai',
            lastSuccessAt: Date.now() - 90_000,
            data: { fiveHourPercent: 11 },
            error: true,
            errorReason: 'network',
        });
        const { fsModule } = createFsMock({ [CACHE_PATH]: validTransientFailureCache });
        setupMocks(fsModule, 500, '');
        const httpsModule = await import('https');
        const { getUsage } = await import('../../hud/usage-api.js');
        const result = await getUsage();
        expect(result.rateLimits?.fiveHourPercent).toBe(11);
        expect(result.error).toBe('network');
        expect(result.stale).toBe(true);
        expect(httpsModule.default.request).not.toHaveBeenCalled();
        vi.useRealTimers();
    });
});
//# sourceMappingURL=usage-api-stale.test.js.map