/**
 * Rules Storage
 *
 * Persistent, cross-process storage for delivered rules and in-flight
 * delivery reservations.
 */
import { existsSync, readFileSync, unlinkSync, } from 'fs';
import { randomUUID } from 'crypto';
import { join } from 'path';
import { atomicWriteFileSync } from '../../lib/atomic-write.js';
import { lockPathFor, withFileLockSync, } from '../../lib/file-lock.js';
import { RULES_INJECTOR_STORAGE } from './constants.js';
const RULES_LOCK_TIMEOUT_MS = 500;
const RULES_LOCK_RETRY_DELAY_MS = 25;
const RULES_RESERVATION_TTL_MS = 30_000;
function getStoragePath(sessionId) {
    return join(RULES_INJECTOR_STORAGE, `${sessionId}.json`);
}
function emptyState(sessionId) {
    return {
        sessionId,
        contentHashes: new Set(),
        realPaths: new Set(),
        reservations: [],
    };
}
function stringArray(value) {
    return Array.isArray(value)
        ? value.filter((entry) => typeof entry === 'string')
        : [];
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function normalizeReservations(value) {
    if (!Array.isArray(value))
        return [];
    const reservations = [];
    for (const entry of value) {
        if (!isRecord(entry)
            || typeof entry.id !== 'string'
            || typeof entry.createdAt !== 'number'
            || !Number.isFinite(entry.createdAt)
            || typeof entry.expiresAt !== 'number'
            || !Number.isFinite(entry.expiresAt)
            || !Array.isArray(entry.rules)) {
            continue;
        }
        const rules = entry.rules.flatMap((rule) => isRecord(rule)
            && typeof rule.contentHash === 'string'
            && typeof rule.realPath === 'string'
            ? [{
                    contentHash: rule.contentHash,
                    realPath: rule.realPath,
                }]
            : []);
        if (rules.length === 0)
            continue;
        reservations.push({
            id: entry.id,
            createdAt: entry.createdAt,
            expiresAt: entry.expiresAt,
            rules,
        });
    }
    return reservations;
}
function parseState(sessionId, raw) {
    const data = JSON.parse(raw);
    return {
        sessionId,
        contentHashes: new Set(stringArray(data.injectedHashes)),
        realPaths: new Set(stringArray(data.injectedRealPaths)),
        reservations: normalizeReservations(data.reservations),
    };
}
function readStateUnlocked(sessionId, strict) {
    const filePath = getStoragePath(sessionId);
    if (!existsSync(filePath))
        return emptyState(sessionId);
    try {
        return parseState(sessionId, readFileSync(filePath, 'utf-8'));
    }
    catch (error) {
        if (!strict)
            return emptyState(sessionId);
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`Corrupt rules injector state at "${filePath}": ${detail}`);
    }
}
function pruneExpiredReservations(state, now, preserveReservationId) {
    const retained = state.reservations.filter((reservation) => reservation.id === preserveReservationId
        || reservation.expiresAt > now);
    const changed = retained.length !== state.reservations.length;
    state.reservations = retained;
    return changed;
}
function writeStateUnlocked(state) {
    const filePath = getStoragePath(state.sessionId);
    if (state.contentHashes.size === 0
        && state.realPaths.size === 0
        && state.reservations.length === 0) {
        if (existsSync(filePath))
            unlinkSync(filePath);
        return;
    }
    const storageData = {
        sessionId: state.sessionId,
        injectedHashes: [...state.contentHashes],
        injectedRealPaths: [...state.realPaths],
        reservations: state.reservations,
        updatedAt: Date.now(),
    };
    atomicWriteFileSync(filePath, JSON.stringify(storageData, null, 2));
}
function withRulesStateLock(sessionId, callback) {
    const statePath = getStoragePath(sessionId);
    return withFileLockSync(lockPathFor(statePath), callback, {
        timeoutMs: RULES_LOCK_TIMEOUT_MS,
        retryDelayMs: RULES_LOCK_RETRY_DELAY_MS,
    });
}
function identityKey(rule) {
    return `${rule.contentHash}\0${rule.realPath}`;
}
export function reserveInjectedRules(sessionId, candidates) {
    if (candidates.length === 0)
        return { rules: [] };
    return withRulesStateLock(sessionId, () => {
        const now = Date.now();
        const state = readStateUnlocked(sessionId, true);
        const pruned = pruneExpiredReservations(state, now);
        const unavailableHashes = new Set(state.contentHashes);
        const unavailablePaths = new Set(state.realPaths);
        for (const reservation of state.reservations) {
            for (const rule of reservation.rules) {
                unavailableHashes.add(rule.contentHash);
                unavailablePaths.add(rule.realPath);
            }
        }
        const reservedRules = [];
        for (const candidate of candidates) {
            if (unavailableHashes.has(candidate.contentHash)
                || unavailablePaths.has(candidate.realPath)) {
                continue;
            }
            reservedRules.push(candidate);
            unavailableHashes.add(candidate.contentHash);
            unavailablePaths.add(candidate.realPath);
        }
        if (reservedRules.length === 0) {
            if (pruned)
                writeStateUnlocked(state);
            return { rules: [] };
        }
        const reservationId = randomUUID();
        state.reservations.push({
            id: reservationId,
            createdAt: now,
            expiresAt: now + RULES_RESERVATION_TTL_MS,
            rules: reservedRules.map(({ contentHash, realPath }) => ({
                contentHash,
                realPath,
            })),
        });
        writeStateUnlocked(state);
        return {
            reservationId,
            rules: reservedRules,
        };
    });
}
export function commitInjectedRuleReservation(sessionId, reservationId, deliveredRules) {
    withRulesStateLock(sessionId, () => {
        const state = readStateUnlocked(sessionId, true);
        pruneExpiredReservations(state, Date.now(), reservationId);
        const reservationIndex = state.reservations.findIndex((reservation) => reservation.id === reservationId);
        if (reservationIndex === -1) {
            throw new Error(`Rules delivery reservation "${reservationId}" is unavailable.`);
        }
        const reservation = state.reservations[reservationIndex];
        const reservedKeys = new Set(reservation.rules.map(identityKey));
        for (const rule of deliveredRules) {
            if (!reservedKeys.has(identityKey(rule))) {
                throw new Error(`Rule "${rule.realPath}" was not part of reservation "${reservationId}".`);
            }
            state.contentHashes.add(rule.contentHash);
            state.realPaths.add(rule.realPath);
        }
        state.reservations.splice(reservationIndex, 1);
        writeStateUnlocked(state);
    });
}
export function releaseInjectedRuleReservation(sessionId, reservationId) {
    withRulesStateLock(sessionId, () => {
        const state = readStateUnlocked(sessionId, true);
        const before = state.reservations.length;
        state.reservations = state.reservations.filter((reservation) => reservation.id !== reservationId);
        const pruned = pruneExpiredReservations(state, Date.now());
        if (state.reservations.length !== before || pruned) {
            writeStateUnlocked(state);
        }
    });
}
export function loadInjectedRules(sessionId) {
    const state = readStateUnlocked(sessionId, false);
    return {
        contentHashes: state.contentHashes,
        realPaths: state.realPaths,
    };
}
/**
 * Compatibility writer: merge delivered rules without replacing concurrent
 * reservations or previously committed identities.
 */
export function saveInjectedRules(sessionId, data) {
    withRulesStateLock(sessionId, () => {
        const state = readStateUnlocked(sessionId, true);
        pruneExpiredReservations(state, Date.now());
        for (const contentHash of data.contentHashes) {
            state.contentHashes.add(contentHash);
        }
        for (const realPath of data.realPaths) {
            state.realPaths.add(realPath);
        }
        writeStateUnlocked(state);
    });
}
export function clearInjectedRules(sessionId) {
    withRulesStateLock(sessionId, () => {
        const filePath = getStoragePath(sessionId);
        if (existsSync(filePath))
            unlinkSync(filePath);
    });
}
//# sourceMappingURL=storage.js.map