/**
 * Cross-process advisory file locking for shared-memory coordination.
 *
 * Uses O_CREAT|O_EXCL (exclusive-create) for atomic lock acquisition.
 * The kernel guarantees at most one process succeeds in creating the file.
 * Includes PID/start-identity stale detection and authenticated release.
 *
 * Provides both synchronous and asynchronous variants:
 * - Sync: for notepad (readFileSync-based) and state operations
 * - Async: for project-memory operations
 */
import { openSync, closeSync, fstatSync, fsyncSync, linkSync, lstatSync, readdirSync, readSync, unlinkSync, writeSync, readFileSync, constants as fsConstants, } from "fs";
import { randomUUID } from "crypto";
import * as path from "path";
import { ensureDirSync } from "./atomic-write.js";
import { getProcessStartIdentitySync, isProcessAlive, } from "../platform/index.js";
// ============================================================================
// Constants
// ============================================================================
const DEFAULT_STALE_LOCK_MS = 30_000;
const DEFAULT_RETRY_DELAY_MS = 50;
const RECLAMATION_GUARD_SUFFIX = ".reclaim.guard";
const RECLAMATION_RECOVERY_SUFFIX = ".recover";
const RECLAMATION_RECOVERY_CLAIM_SUFFIX = ".reaper.";
const RECLAMATION_GUARD_STALE_MS = 30_000;
const RECLAMATION_RECOVERY_STALE_MS = 30_000;
const MAX_LOCK_MTIME_FUTURE_SKEW_MS = 5 * 60_000;
const RELEASE_GUARD_TIMEOUT_MS = 2_000;
function identityForFd(fd) {
    const stat = fstatSync(fd);
    return { dev: stat.dev, ino: stat.ino };
}
function identityForPath(lockPath) {
    try {
        const stat = lstatSync(lockPath);
        return { dev: stat.dev, ino: stat.ino };
    }
    catch {
        return null;
    }
}
function identitiesEqual(left, right) {
    return !!left && left.dev === right.dev && left.ino === right.ino;
}
function parseObservedLock(raw) {
    try {
        const payload = JSON.parse(raw);
        return {
            ...(typeof payload.version === 'number'
                ? { version: payload.version }
                : {}),
            ...(typeof payload.pid === 'number' ? { pid: payload.pid } : {}),
            ...(typeof payload.processStartIdentity === 'string'
                ? { processStartIdentity: payload.processStartIdentity }
                : typeof payload.processStart === 'string'
                    ? { processStartIdentity: payload.processStart }
                    : {}),
            ...(typeof payload.nonce === 'string'
                ? { nonce: payload.nonce }
                : {}),
            ...(typeof payload.timestamp === 'number'
                ? { timestamp: payload.timestamp }
                : {}),
        };
    }
    catch {
        return {};
    }
}
function isAuthenticatedOwner(owner) {
    return owner.version === 2
        && Number.isSafeInteger(owner.pid)
        && (owner.pid ?? 0) > 0
        && typeof owner.processStartIdentity === 'string'
        && owner.processStartIdentity.length > 0
        && typeof owner.nonce === 'string'
        && owner.nonce.length > 0
        && Number.isFinite(owner.timestamp);
}
function staleLockObservation(lockPath, staleLockMs, requireAuthenticatedOwner = false) {
    try {
        const stat = lstatSync(lockPath);
        const now = Date.now();
        if (!Number.isFinite(stat.mtimeMs)
            || stat.mtimeMs > now + MAX_LOCK_MTIME_FUTURE_SKEW_MS) {
            return null;
        }
        const ageMs = Math.max(0, now - stat.mtimeMs);
        if (ageMs < staleLockMs)
            return null;
        const raw = readFileSync(lockPath, "utf-8");
        const observation = {
            identity: { dev: stat.dev, ino: stat.ino },
            raw,
            owner: parseObservedLock(raw),
        };
        if (requireAuthenticatedOwner
            && !isAuthenticatedOwner(observation.owner)) {
            return null;
        }
        const pid = observation.owner.pid;
        if (!pid || !Number.isSafeInteger(pid) || pid <= 0) {
            return observation;
        }
        if (!isProcessAlive(pid))
            return observation;
        const expectedStart = observation.owner.processStartIdentity;
        if (!expectedStart)
            return null;
        const currentStart = getProcessStartIdentitySync(pid);
        if (currentStart === 'absent')
            return observation;
        if (currentStart === null)
            return null;
        return currentStart === expectedStart ? null : observation;
    }
    catch {
        return null;
    }
}
function observedLockStillMatches(lockPath, observation) {
    if (!identitiesEqual(identityForPath(lockPath), observation.identity)) {
        return false;
    }
    try {
        return readFileSync(lockPath, "utf-8") === observation.raw;
    }
    catch {
        return false;
    }
}
function reapObservedLock(lockPath, observation) {
    try {
        if (!observedLockStillMatches(lockPath, observation))
            return false;
        unlinkSync(lockPath);
        return true;
    }
    catch {
        return false;
    }
}
function isExistsError(error) {
    return !!error
        && typeof error === "object"
        && "code" in error
        && error.code === "EEXIST";
}
function waitSync(waitMs) {
    if (waitMs <= 0)
        return;
    const waitBuffer = new SharedArrayBuffer(4);
    try {
        Atomics.wait(new Int32Array(waitBuffer), 0, 0, waitMs);
    }
    catch {
        const waitUntil = Date.now() + waitMs;
        while (Date.now() < waitUntil) { /* spin */ }
    }
}
function recoveryOperationHasContender(recoveryPath, ownClaimPath) {
    const directory = path.dirname(recoveryPath);
    const prefix = `${path.basename(recoveryPath)}${RECLAMATION_RECOVERY_CLAIM_SUFFIX}`;
    let names;
    try {
        names = readdirSync(directory);
    }
    catch {
        return true;
    }
    for (const name of names) {
        if (!name.startsWith(prefix))
            continue;
        const contenderPath = path.join(directory, name);
        if (contenderPath === ownClaimPath)
            continue;
        const stale = staleLockObservation(contenderPath, RECLAMATION_RECOVERY_STALE_MS, true);
        if (stale) {
            // Claim paths include a fresh UUID and are never reused by a successor,
            // so exact-generation cleanup cannot unlink another reaper's claim.
            if (reapObservedLock(contenderPath, stale))
                continue;
            if (!identityForPath(contenderPath))
                continue;
        }
        return true;
    }
    return false;
}
function withRecoveryPathOperation(lockPath, callback) {
    const recoveryPath = `${lockPath}${RECLAMATION_GUARD_SUFFIX}${RECLAMATION_RECOVERY_SUFFIX}`;
    const owner = currentLockOwner();
    if (!owner)
        return { acquired: false, value: undefined };
    const claimPath = `${recoveryPath}${RECLAMATION_RECOVERY_CLAIM_SUFFIX}${owner.nonce}`;
    let claim;
    try {
        claim = createOwnedLockAtomically(claimPath, owner);
    }
    catch (error) {
        if (isExistsError(error)) {
            return { acquired: false, value: undefined };
        }
        throw error;
    }
    if (!claim)
        return { acquired: false, value: undefined };
    try {
        // Every recovery-path creator/reaper publishes its unique claim before
        // this scan and keeps it until completion. An overlapping contender
        // therefore either sees us and yields, or was already visible here.
        if (recoveryOperationHasContender(recoveryPath, claimPath)) {
            return { acquired: false, value: undefined };
        }
        return { acquired: true, value: callback() };
    }
    finally {
        releaseOwnedPath(claim);
    }
}
function withReclamationRecoveryBarrier(lockPath, callback) {
    const recoveryPath = `${lockPath}${RECLAMATION_GUARD_SUFFIX}${RECLAMATION_RECOVERY_SUFFIX}`;
    const operation = withRecoveryPathOperation(lockPath, () => {
        let recovery;
        try {
            recovery = createOwnedLockAtomically(recoveryPath);
        }
        catch (error) {
            if (!isExistsError(error))
                throw error;
            const stale = staleLockObservation(recoveryPath, RECLAMATION_RECOVERY_STALE_MS, true);
            if (!stale || !reapObservedLock(recoveryPath, stale)) {
                return { acquired: false, value: undefined };
            }
            try {
                recovery = createOwnedLockAtomically(recoveryPath);
            }
            catch (retryError) {
                if (isExistsError(retryError)) {
                    return { acquired: false, value: undefined };
                }
                throw retryError;
            }
        }
        if (!recovery)
            return { acquired: false, value: undefined };
        try {
            return { acquired: true, value: callback() };
        }
        finally {
            releaseOwnedPath(recovery);
        }
    });
    if (!operation.acquired || !operation.value) {
        return { acquired: false, value: undefined };
    }
    return operation.value;
}
function recoverStaleReclamationRecoveryBarrier(lockPath) {
    const recoveryPath = `${lockPath}${RECLAMATION_GUARD_SUFFIX}${RECLAMATION_RECOVERY_SUFFIX}`;
    const operation = withRecoveryPathOperation(lockPath, () => {
        const stale = staleLockObservation(recoveryPath, RECLAMATION_RECOVERY_STALE_MS, true);
        return !!stale && reapObservedLock(recoveryPath, stale);
    });
    return operation.acquired && operation.value === true;
}
function recoverStaleReclamationGuard(lockPath) {
    const guardPath = `${lockPath}${RECLAMATION_GUARD_SUFFIX}`;
    const recovery = withReclamationRecoveryBarrier(lockPath, () => {
        const stale = staleLockObservation(guardPath, RECLAMATION_GUARD_STALE_MS, true);
        return !!stale && reapObservedLock(guardPath, stale);
    });
    return recovery.acquired && recovery.value === true;
}
function releaseOwnedPath(handle) {
    const ownedBeforeClose = handleStillOwnsPath(handle);
    try {
        closeSync(handle.fd);
    }
    catch {
        /* already closed */
    }
    if (!ownedBeforeClose || !handleStillOwnsPath(handle))
        return;
    try {
        unlinkSync(handle.path);
    }
    catch {
        /* already removed */
    }
}
function withReclamationGuard(lockPath, callback, timeoutMs = 0) {
    const guardPath = `${lockPath}${RECLAMATION_GUARD_SUFFIX}`;
    const recoveryPath = `${guardPath}${RECLAMATION_RECOVERY_SUFFIX}`;
    const deadline = Date.now() + timeoutMs;
    let guard = null;
    while (!guard) {
        if (identityForPath(recoveryPath)) {
            if (recoverStaleReclamationRecoveryBarrier(lockPath))
                continue;
            if (Date.now() >= deadline) {
                return { acquired: false, value: undefined };
            }
            waitSync(Math.min(5, Math.max(1, deadline - Date.now())));
            continue;
        }
        try {
            guard = createOwnedLock(guardPath);
        }
        catch (error) {
            if (!isExistsError(error))
                throw error;
            if (recoverStaleReclamationGuard(lockPath))
                continue;
            if (Date.now() >= deadline) {
                return { acquired: false, value: undefined };
            }
            waitSync(Math.min(5, Math.max(1, deadline - Date.now())));
            continue;
        }
        if (!guard) {
            if (Date.now() >= deadline) {
                return { acquired: false, value: undefined };
            }
            waitSync(Math.min(5, Math.max(1, deadline - Date.now())));
        }
    }
    if (!guard)
        return { acquired: false, value: undefined };
    try {
        return { acquired: true, value: callback() };
    }
    finally {
        releaseOwnedPath(guard);
    }
}
function currentLockOwner() {
    const processStartIdentity = getProcessStartIdentitySync(process.pid);
    if (processStartIdentity === null
        || processStartIdentity === 'absent') {
        return null;
    }
    return {
        version: 2,
        pid: process.pid,
        processStartIdentity,
        nonce: randomUUID(),
        timestamp: Date.now(),
    };
}
function createOwnedLock(lockPath, suppliedOwner) {
    const owner = suppliedOwner ?? currentLockOwner();
    if (!owner)
        return null;
    const ownerRaw = JSON.stringify(owner);
    const ownerBytes = Buffer.from(ownerRaw, "utf8");
    const fd = openSync(lockPath, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_RDWR, 0o600);
    const creationIdentity = identityForFd(fd);
    try {
        let written = 0;
        while (written < ownerBytes.length) {
            const count = writeSync(fd, ownerBytes, written, ownerBytes.length - written, written);
            if (count <= 0) {
                throw new Error(`Failed to publish file lock owner: ${lockPath}`);
            }
            written += count;
        }
        fsyncSync(fd);
        const stat = fstatSync(fd);
        if (stat.size !== ownerBytes.length
            || !identitiesEqual(identityForPath(lockPath), creationIdentity)) {
            throw new Error(`Failed to verify file lock owner: ${lockPath}`);
        }
        const verifiedBytes = Buffer.alloc(ownerBytes.length);
        let read = 0;
        while (read < verifiedBytes.length) {
            const count = readSync(fd, verifiedBytes, read, verifiedBytes.length - read, read);
            if (count <= 0) {
                throw new Error(`Failed to verify file lock owner: ${lockPath}`);
            }
            read += count;
        }
        if (!verifiedBytes.equals(ownerBytes)) {
            throw new Error(`Failed to verify file lock owner: ${lockPath}`);
        }
        return {
            fd,
            path: lockPath,
            owner,
            ownerRaw,
            identity: creationIdentity,
        };
    }
    catch (writeErr) {
        try {
            closeSync(fd);
        }
        catch { /* already closed */ }
        try {
            if (identitiesEqual(identityForPath(lockPath), creationIdentity)) {
                unlinkSync(lockPath);
            }
        }
        catch {
            /* best effort */
        }
        throw writeErr;
    }
}
function createOwnedLockAtomically(lockPath, suppliedOwner) {
    const owner = suppliedOwner ?? currentLockOwner();
    if (!owner)
        return null;
    const publicationPath = path.join(path.dirname(lockPath), `.${path.basename(lockPath)}.publish.${owner.nonce}.tmp`);
    const publication = createOwnedLock(publicationPath, owner);
    if (!publication)
        return null;
    let linked = false;
    try {
        linkSync(publicationPath, lockPath);
        linked = true;
        const published = {
            ...publication,
            path: lockPath,
        };
        if (!handleStillOwnsPath(published)) {
            throw new Error(`Failed to publish file lock owner: ${lockPath}`);
        }
        try {
            if (handleStillOwnsPath(publication)) {
                unlinkSync(publicationPath);
            }
        }
        catch {
            /* the authenticated publication remains authoritative */
        }
        return published;
    }
    catch (error) {
        if (linked) {
            const published = {
                ...publication,
                path: lockPath,
            };
            try {
                if (handleStillOwnsPath(published))
                    unlinkSync(lockPath);
            }
            catch {
                /* best-effort unpublished generation cleanup */
            }
        }
        releaseOwnedPath(publication);
        throw error;
    }
}
function handleStillOwnsPath(handle) {
    if (!identitiesEqual(identityForPath(handle.path), handle.identity)) {
        return false;
    }
    try {
        const raw = readFileSync(handle.path, "utf-8");
        if (raw !== handle.ownerRaw)
            return false;
        const owner = JSON.parse(raw);
        return owner.version === handle.owner.version
            && owner.pid === handle.owner.pid
            && owner.processStartIdentity === handle.owner.processStartIdentity
            && owner.nonce === handle.owner.nonce;
    }
    catch {
        return false;
    }
}
/**
 * Derive the lock file path from a data file path.
 * e.g. /path/to/data.json -> /path/to/data.json.lock
 */
export function lockPathFor(filePath) {
    return filePath + ".lock";
}
// ============================================================================
// Synchronous API
// ============================================================================
/**
 * Try to acquire an exclusive file lock (synchronous, single attempt).
 *
 * Creates a lock file adjacent to the target using O_CREAT|O_EXCL.
 * On first failure due to EEXIST, checks for staleness and retries once.
 *
 * @returns LockHandle on success, null if lock is held
 */
function tryAcquireSync(lockPath, staleLockMs) {
    ensureDirSync(path.dirname(lockPath));
    const guarded = withReclamationGuard(lockPath, () => {
        try {
            return createOwnedLock(lockPath);
        }
        catch (err) {
            if (err &&
                typeof err === "object" &&
                "code" in err &&
                err.code === "EEXIST") {
                const stale = staleLockObservation(lockPath, staleLockMs);
                if (stale && reapObservedLock(lockPath, stale)) {
                    try {
                        return createOwnedLock(lockPath);
                    }
                    catch {
                        return null;
                    }
                }
                return null;
            }
            throw err;
        }
    });
    return guarded.acquired ? guarded.value ?? null : null;
}
/**
 * Acquire an exclusive file lock with optional retry/timeout (synchronous).
 *
 * @param lockPath Path for the lock file
 * @param opts Lock options
 * @returns FileLockHandle on success, null if lock could not be acquired
 */
export function acquireFileLockSync(lockPath, opts) {
    const staleLockMs = opts?.staleLockMs ?? DEFAULT_STALE_LOCK_MS;
    const timeoutMs = opts?.timeoutMs ?? 0;
    const retryDelayMs = opts?.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
    const handle = tryAcquireSync(lockPath, staleLockMs);
    if (handle || timeoutMs <= 0)
        return handle;
    // Retry loop — try Atomics.wait (works in Workers), fall back to spin for main thread
    const deadline = Date.now() + timeoutMs;
    const sharedBuf = new SharedArrayBuffer(4);
    const sharedArr = new Int32Array(sharedBuf);
    while (Date.now() < deadline) {
        const waitMs = Math.min(retryDelayMs, deadline - Date.now());
        try {
            Atomics.wait(sharedArr, 0, 0, waitMs);
        }
        catch {
            // Main thread: Atomics.wait throws — brief spin instead (capped at retryDelayMs)
            const waitUntil = Date.now() + waitMs;
            while (Date.now() < waitUntil) { /* spin */ }
        }
        const retryHandle = tryAcquireSync(lockPath, staleLockMs);
        if (retryHandle)
            return retryHandle;
    }
    return null;
}
/**
 * Release a previously acquired file lock (synchronous).
 */
export function releaseFileLockSync(handle) {
    try {
        const guarded = withReclamationGuard(handle.path, () => {
            releaseOwnedPath(handle);
        }, RELEASE_GUARD_TIMEOUT_MS);
        if (guarded.acquired)
            return;
    }
    catch {
        /* fail closed below */
    }
    try {
        const cleanup = withReclamationRecoveryBarrier(handle.path, () => {
            releaseOwnedPath(handle);
        });
        if (cleanup.acquired)
            return;
    }
    catch {
        /* fail closed below */
    }
    try {
        closeSync(handle.fd);
    }
    catch {
        /* already closed */
    }
}
/**
 * Execute a function while holding an exclusive file lock (synchronous).
 *
 * @param lockPath Path for the lock file
 * @param fn Function to execute under lock
 * @param opts Lock options
 * @returns The function's return value
 * @throws Error if the lock cannot be acquired
 */
export function withFileLockSync(lockPath, fn, opts) {
    const handle = acquireFileLockSync(lockPath, opts);
    if (!handle) {
        throw new Error(`Failed to acquire file lock: ${lockPath}`);
    }
    try {
        return fn();
    }
    finally {
        releaseFileLockSync(handle);
    }
}
// ============================================================================
// Asynchronous API
// ============================================================================
/**
 * Sleep for a given number of milliseconds (async).
 */
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
/**
 * Acquire an exclusive file lock with optional retry/timeout (asynchronous).
 *
 * @param lockPath Path for the lock file
 * @param opts Lock options
 * @returns FileLockHandle on success, null if lock could not be acquired
 */
export async function acquireFileLock(lockPath, opts) {
    const staleLockMs = opts?.staleLockMs ?? DEFAULT_STALE_LOCK_MS;
    const timeoutMs = opts?.timeoutMs ?? 0;
    const retryDelayMs = opts?.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
    const handle = tryAcquireSync(lockPath, staleLockMs);
    if (handle || timeoutMs <= 0)
        return handle;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        await sleep(Math.min(retryDelayMs, deadline - Date.now()));
        const retryHandle = tryAcquireSync(lockPath, staleLockMs);
        if (retryHandle)
            return retryHandle;
    }
    return null;
}
/**
 * Release a previously acquired file lock (async-compatible, delegates to sync).
 */
export function releaseFileLock(handle) {
    releaseFileLockSync(handle);
}
/**
 * Execute an async function while holding an exclusive file lock.
 *
 * @param lockPath Path for the lock file
 * @param fn Async function to execute under lock
 * @param opts Lock options
 * @returns The function's return value
 * @throws Error if the lock cannot be acquired
 */
export async function withFileLock(lockPath, fn, opts) {
    const handle = await acquireFileLock(lockPath, opts);
    if (!handle) {
        throw new Error(`Failed to acquire file lock: ${lockPath}`);
    }
    try {
        return await fn();
    }
    finally {
        releaseFileLock(handle);
    }
}
//# sourceMappingURL=file-lock.js.map