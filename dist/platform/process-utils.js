/**
 * Cross-Platform Process Utilities
 * Provides unified process management across Windows, macOS, and Linux.
 */
import { execFileSync, execFile, spawnSync } from 'child_process';
import { readFileSync } from 'fs';
import { promisify } from 'util';
import * as fsPromises from 'fs/promises';
import { normalizeProcessStartIdentity, } from '../../templates/hooks/lib/process-start-identity.mjs';
const execFileAsync = promisify(execFile);
function processGroupIdSync(pid) {
    if (!Number.isInteger(pid) || pid <= 0)
        return null;
    if (process.platform === 'linux') {
        try {
            const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
            const closeParen = stat.lastIndexOf(')');
            if (closeParen === -1)
                return null;
            const fields = stat.substring(closeParen + 2).split(' ');
            const group = Number(fields[2]);
            return Number.isInteger(group) && group > 0 ? group : null;
        }
        catch {
            return null;
        }
    }
    if (process.platform === 'darwin') {
        try {
            const result = spawnSync('ps', ['-p', String(pid), '-o', 'pgid='], {
                encoding: 'utf8', timeout: 2000, windowsHide: true,
            });
            const group = Number(result.stdout?.trim());
            return result.status === 0 && Number.isInteger(group) && group > 0 ? group : null;
        }
        catch {
            return null;
        }
    }
    return null;
}
/** Capture creation-bound POSIX process-group metadata for a detached owner. */
export function captureOwnedProcessGroup(pid) {
    if (process.platform === 'win32')
        return null;
    const processStartIdentity = getProcessStartIdentitySync(pid);
    const processGroupId = processGroupIdSync(pid);
    if (!processStartIdentity || processGroupId === null)
        return null;
    return { pid, processStartIdentity, processGroupId };
}
/** Signal only an exact-identity POSIX process-group leader; never fall back to PID. */
export async function terminateOwnedProcessGroup(options) {
    const deadline = parseDeadline(options.deadlineAt);
    if (deadline === undefined || isDeadlineExceeded(deadline))
        return 'deadline-exceeded';
    if (process.platform === 'win32')
        return 'unknown';
    if (!Number.isInteger(options.processGroupId) || options.processGroupId <= 0)
        return 'unknown';
    if (!isProcessAlive(options.pid))
        return 'already-dead';
    const identity = getProcessStartIdentitySync(options.pid);
    const group = processGroupIdSync(options.pid);
    if (!identity || !group)
        return 'unknown';
    if (identity !== options.expectedStartIdentity || group !== options.processGroupId)
        return 'identity-mismatch';
    if (isDeadlineExceeded(deadline))
        return 'deadline-exceeded';
    try {
        process.kill(-options.processGroupId, options.force ? 'SIGKILL' : 'SIGTERM');
        return 'terminated';
    }
    catch (error) {
        const code = error.code;
        if (code === 'ESRCH')
            return isProcessAlive(options.pid) ? 'unknown' : 'already-dead';
        return 'unknown';
    }
}
function remainingDeadlineMs(deadlineAt) {
    if (deadlineAt === undefined)
        return undefined;
    return Math.max(0, deadlineAt - Date.now());
}
function isDeadlineExceeded(deadlineAt) {
    return deadlineAt !== undefined && remainingDeadlineMs(deadlineAt) === 0;
}
function parseDeadline(deadlineAt) {
    const value = Date.parse(deadlineAt);
    return Number.isFinite(value) ? value : undefined;
}
/**
 * Kill a process and optionally its entire process tree.
 *
 * On Windows: Uses taskkill /T for generic callers; this is not creation-bound
 * and MUST NOT be used for launch-owned cleanup.
 * On Unix: Signals the owned process group, falling back to the root PID.
 */
export async function killProcessTree(pid, signal = 'SIGTERM') {
    if (!Number.isInteger(pid) || pid <= 0)
        return false;
    if (process.platform === 'win32') {
        return killProcessTreeWindows(pid, signal === 'SIGKILL');
    }
    else {
        return killProcessTreeUnix(pid, signal);
    }
}
async function killProcessTreeWindows(pid, force) {
    try {
        const args = ['/T', '/PID', String(pid)];
        if (force) {
            args.unshift('/F');
        }
        execFileSync('taskkill.exe', args, {
            stdio: 'ignore',
            timeout: 5000,
            windowsHide: true
        });
        return true;
    }
    catch (err) {
        const error = err;
        if (error.status === 128)
            return true;
        return false;
    }
}
function killProcessTreeUnix(pid, signal) {
    try {
        process.kill(-pid, signal);
        return true;
    }
    catch {
        try {
            process.kill(pid, signal);
            return true;
        }
        catch {
            return !isProcessAlive(pid);
        }
    }
}
/**
 * Check if a process is alive.
 * Works cross-platform by attempting signal 0.
 * EPERM means the process exists but we lack permission to signal it.
 */
export function isProcessAlive(pid) {
    if (!Number.isInteger(pid) || pid <= 0)
        return false;
    try {
        process.kill(pid, 0);
        return true;
    }
    catch (e) {
        if (e && typeof e === 'object' && 'code' in e && e.code === 'EPERM') {
            return true;
        }
        return false;
    }
}
let currentProcessStartIdentitySync;
const WINDOWS_EPOCH_TICKS = 621355968000000000n;
const WINDOWS_MAX_TICKS = 3155378975999999999n;
function parseWindowsDmtfTimestamp(value) {
    const match = value.match(/(\d{14})\.(\d{6})([+-])(\d{3})/);
    if (!match)
        return undefined;
    const compact = match[1];
    const year = Number(compact.slice(0, 4));
    const month = Number(compact.slice(4, 6));
    const day = Number(compact.slice(6, 8));
    const hour = Number(compact.slice(8, 10));
    const minute = Number(compact.slice(10, 12));
    const second = Number(compact.slice(12, 14));
    const microseconds = Number(match[2]);
    const offsetMinutes = Number(match[4]) * (match[3] === '-' ? -1 : 1);
    if (year < 1601
        || month < 1
        || month > 12
        || day < 1
        || day > 31
        || hour > 23
        || minute > 59
        || second > 59
        || !Number.isSafeInteger(microseconds)
        || !Number.isSafeInteger(offsetMinutes)) {
        return undefined;
    }
    const wallClockMs = Date.UTC(year, month - 1, day, hour, minute, second);
    const verified = new Date(wallClockMs);
    if (verified.getUTCFullYear() !== year
        || verified.getUTCMonth() !== month - 1
        || verified.getUTCDate() !== day
        || verified.getUTCHours() !== hour
        || verified.getUTCMinutes() !== minute
        || verified.getUTCSeconds() !== second) {
        return undefined;
    }
    const epochMilliseconds = wallClockMs - offsetMinutes * 60_000;
    return {
        epochMilliseconds,
        epochMicroseconds: BigInt(epochMilliseconds) * 1000n + BigInt(microseconds),
    };
}
export function parseWindowsProcessStartIdentity(value) {
    const parsed = parseWindowsDmtfTimestamp(value);
    return parsed
        ? `windows-dmtf-us:${parsed.epochMicroseconds.toString()}`
        : undefined;
}
/**
 * Synchronous process-start identity for exclusive file-lock ownership.
 * `absent` proves the PID is not live; `null` means identity is unavailable.
 */
export function getProcessStartIdentitySync(pid) {
    if (!Number.isInteger(pid) || pid <= 0)
        return null;
    if (process.env.OMC_TEST_EMERGENCY_PROCESS_START_UNKNOWN_PID === String(pid)
        || process.env.OMC_TEST_FILE_LOCK_PROCESS_START_UNKNOWN_PID === String(pid)) {
        return null;
    }
    if (pid === process.pid && currentProcessStartIdentitySync !== undefined) {
        return currentProcessStartIdentitySync;
    }
    let identity = null;
    if (process.platform === 'linux') {
        try {
            const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
            const closeParen = stat.lastIndexOf(')');
            if (closeParen >= 0) {
                const fields = stat.slice(closeParen + 2).trim().split(/\s+/);
                identity =
                    fields[19] && /^\d+$/.test(fields[19])
                        ? fields[19]
                        : null;
            }
        }
        catch (error) {
            identity =
                error.code === 'ENOENT'
                    ? 'absent'
                    : null;
        }
    }
    else if (process.platform === 'darwin') {
        try {
            const stdout = execFileSync('ps', ['-p', String(pid), '-o', 'lstart='], {
                encoding: 'utf8',
                env: { ...process.env, LC_ALL: 'C' },
                stdio: ['ignore', 'pipe', 'ignore'],
                timeout: 1000,
                windowsHide: true,
            });
            const value = new Date(stdout.trim()).getTime();
            identity = Number.isFinite(value) ? String(value) : null;
        }
        catch {
            identity = isProcessAlive(pid) ? null : 'absent';
        }
    }
    else if (process.platform === 'win32') {
        try {
            const stdout = execFileSync('powershell', [
                '-NoProfile',
                '-NonInteractive',
                '-Command',
                `$p = [System.Diagnostics.Process]::GetProcessById(${pid}); `
                    + '[System.Management.ManagementDateTimeConverter]'
                    + '::ToDmtfDateTime([datetime]$p.StartTime)',
            ], {
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'ignore'],
                timeout: 5000,
                windowsHide: true,
            });
            identity = parseWindowsProcessStartIdentity(stdout) ?? null;
        }
        catch {
            try {
                const stdout = execFileSync('wmic', [
                    'process',
                    'where',
                    `ProcessId=${pid}`,
                    'get',
                    'CreationDate',
                    '/format:csv',
                ], {
                    encoding: 'utf8',
                    stdio: ['ignore', 'pipe', 'ignore'],
                    timeout: 1000,
                    windowsHide: true,
                });
                identity = parseWindowsProcessStartIdentity(stdout) ?? null;
            }
            catch {
                identity = isProcessAlive(pid) ? null : 'absent';
            }
        }
    }
    if (pid === process.pid
        && identity !== null
        && identity !== 'absent') {
        currentProcessStartIdentitySync = identity;
    }
    return identity;
}
/**
 * Get process start time for PID reuse detection.
 * Returns milliseconds timestamp on macOS/Windows, jiffies on Linux.
 */
export async function getProcessStartTime(pid, deadlineAt) {
    if (!Number.isInteger(pid) || pid <= 0 || isDeadlineExceeded(deadlineAt))
        return undefined;
    if (process.platform === 'win32') {
        return getProcessStartTimeWindows(pid, deadlineAt);
    }
    else if (process.platform === 'darwin') {
        return getProcessStartTimeMacOS(pid, deadlineAt);
    }
    else if (process.platform === 'linux') {
        return getProcessStartTimeLinux(pid, deadlineAt);
    }
    return undefined;
}
async function getProcessStartTimeWindows(pid, deadlineAt) {
    try {
        const { stdout } = await execFileAsync('wmic', [
            'process', 'where', `ProcessId=${pid}`,
            'get', 'CreationDate', '/format:csv'
        ], { timeout: Math.max(1, Math.min(5000, remainingDeadlineMs(deadlineAt) ?? 5000)), windowsHide: true });
        const wmicTime = parseWmicCreationDate(stdout);
        if (wmicTime !== undefined)
            return wmicTime;
    }
    catch {
        // WMIC is deprecated on newer Windows builds; fall back to PowerShell.
    }
    if (isDeadlineExceeded(deadlineAt))
        return undefined;
    const cimTime = await getProcessStartTimeWindowsPowerShellCim(pid, deadlineAt);
    if (cimTime !== undefined)
        return cimTime;
    return isDeadlineExceeded(deadlineAt)
        ? undefined
        : getProcessStartTimeWindowsPowerShellProcess(pid, deadlineAt);
}
function parseWmicCreationDate(stdout) {
    return parseWindowsDmtfTimestamp(stdout)?.epochMilliseconds;
}
async function getProcessStartTimeWindowsPowerShellCim(pid, deadlineAt) {
    try {
        const { stdout } = await execFileAsync('powershell', [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            `$p = Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" -ErrorAction Stop; `
                + 'if ($p -and $p.CreationDate) { '
                + '[System.Management.ManagementDateTimeConverter]::ToDmtfDateTime([datetime]$p.CreationDate) }'
        ], { timeout: Math.max(1, Math.min(5000, remainingDeadlineMs(deadlineAt) ?? 5000)), windowsHide: true });
        return parseWmicCreationDate(stdout);
    }
    catch {
        return undefined;
    }
}
async function getProcessStartTimeWindowsPowerShellProcess(pid, deadlineAt) {
    try {
        const { stdout } = await execFileAsync('powershell', [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; `
                + 'if ($p -and $p.StartTime) { '
                + '[System.Management.ManagementDateTimeConverter]::ToDmtfDateTime([datetime]$p.StartTime) }'
        ], { timeout: Math.max(1, Math.min(5000, remainingDeadlineMs(deadlineAt) ?? 5000)), windowsHide: true });
        return parseWmicCreationDate(stdout);
    }
    catch {
        return undefined;
    }
}
async function getProcessStartTimeMacOS(pid, deadlineAt) {
    try {
        const { stdout } = await execFileAsync('ps', ['-p', String(pid), '-o', 'lstart='], {
            env: { ...process.env, LC_ALL: 'C' },
            timeout: Math.max(1, Math.min(5000, remainingDeadlineMs(deadlineAt) ?? 5000)),
            windowsHide: true
        });
        const date = new Date(stdout.trim());
        return isNaN(date.getTime()) ? undefined : date.getTime();
    }
    catch {
        return undefined;
    }
}
async function getProcessStartTimeLinux(pid, deadlineAt) {
    if (isDeadlineExceeded(deadlineAt))
        return undefined;
    try {
        const stat = await fsPromises.readFile(`/proc/${pid}/stat`, 'utf8');
        const closeParen = stat.lastIndexOf(')');
        if (closeParen === -1)
            return undefined;
        const fields = stat.substring(closeParen + 2).split(' ');
        const startTime = parseInt(fields[19], 10);
        return isNaN(startTime) ? undefined : startTime;
    }
    catch {
        return undefined;
    }
}
/**
 * Gracefully terminate a process with escalation.
 */
export async function gracefulKill(pid, gracePeriodMs = 5000) {
    if (!isProcessAlive(pid))
        return 'graceful';
    await killProcessTree(pid, 'SIGTERM');
    const deadline = Date.now() + gracePeriodMs;
    while (Date.now() < deadline) {
        if (!isProcessAlive(pid))
            return 'graceful';
        await new Promise(r => setTimeout(r, 100));
    }
    await killProcessTree(pid, 'SIGKILL');
    await new Promise(r => setTimeout(r, 1000));
    return isProcessAlive(pid) ? 'failed' : 'forced';
}
/** Convert a WMIC/CIM DMTF datetime to .NET ticks for a single Windows identity format. */
export function dmtfCreationDateToTicks(dmtf) {
    // DMTF: yyyyMMddHHmmss.ffffff+UUU (offset minutes; six fractional digits = microseconds)
    const m = dmtf.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\.(\d{6})([+-])(\d{3})$/);
    if (!m)
        return null;
    const [, ys, mo, ds, hs, mins, ss, us, sign, off] = m;
    const year = Number(ys), month = Number(mo), day = Number(ds);
    const hour = Number(hs), minute = Number(mins), second = Number(ss);
    const micros = Number(us);
    const offsetMin = Number(off) * (sign === '-' ? -1 : 1);
    if (![year, month, day, hour, minute, second, micros, offsetMin].every(Number.isFinite))
        return null;
    // Strict ranges — do not let JS Date normalize invalid calendar fields.
    if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59)
        return null;
    if (offsetMin < -840 || offsetMin > 840)
        return null; // valid civil TZ offsets only
    // Whole-second UTC ms (no ms truncation of the fractional field).
    const wholeUtcMs = Date.UTC(year, month - 1, day, hour, minute, second) - offsetMin * 60_000;
    if (!Number.isFinite(wholeUtcMs))
        return null;
    // Reject JS calendar normalization (e.g. Feb 30 → Mar 1/2).
    // Reconstruct the wall-clock components we intended in the offset zone:
    const localMs = wholeUtcMs + offsetMin * 60_000;
    const local = new Date(localMs);
    if (local.getUTCFullYear() !== year
        || local.getUTCMonth() + 1 !== month
        || local.getUTCDate() !== day
        || local.getUTCHours() !== hour
        || local.getUTCMinutes() !== minute
        || local.getUTCSeconds() !== second)
        return null;
    // .NET ticks: 100ns since 0001-01-01. 1 us = 10 ticks. Preserve all 6 fractional digits.
    const ticks = BigInt(wholeUtcMs) * 10000n + BigInt(micros) * 10n + 621355968000000000n;
    return `ticks:${ticks.toString()}`;
}
function windowsProcessStartAuthority(identity) {
    const exactTicksText = /^ticks:(\d{1,19})$/.exec(identity)?.[1];
    const legacyDmtf = /^dmtf:(.+)$/.exec(identity)?.[1];
    const source = legacyDmtf
        ? dmtfCreationDateToTicks(legacyDmtf)
        : identity;
    if (!source)
        return undefined;
    const normalized = normalizeProcessStartIdentity(source);
    const epochMicrosecondsText = /^windows-dmtf-us:(\d{1,18})$/.exec(normalized)?.[1];
    if (!epochMicrosecondsText)
        return undefined;
    const epochMicroseconds = BigInt(epochMicrosecondsText);
    const minimum = WINDOWS_EPOCH_TICKS + epochMicroseconds * 10n;
    const maximum = minimum + 9n;
    if (minimum <= WINDOWS_EPOCH_TICKS
        || maximum > WINDOWS_MAX_TICKS) {
        return undefined;
    }
    if (exactTicksText) {
        const exactTicks = BigInt(exactTicksText);
        if (exactTicks < minimum
            || exactTicks > maximum
            || exactTicks > WINDOWS_MAX_TICKS) {
            return undefined;
        }
        return {
            normalized: `windows-dmtf-us:${epochMicroseconds}`,
            minimum: exactTicks,
            maximum: exactTicks,
            exact: true,
        };
    }
    if (!legacyDmtf
        && !/^windows-dmtf-us:\d{1,18}$/.test(identity)) {
        return undefined;
    }
    return {
        normalized: `windows-dmtf-us:${epochMicroseconds}`,
        minimum,
        maximum,
        exact: false,
    };
}
function windowsProcessStartIdentitiesMatch(actual, expected) {
    const actualAuthority = windowsProcessStartAuthority(actual);
    const expectedAuthority = windowsProcessStartAuthority(expected);
    if (!actualAuthority || !expectedAuthority)
        return undefined;
    return actualAuthority.exact && expectedAuthority.exact
        ? actualAuthority.minimum === expectedAuthority.minimum
        : actualAuthority.normalized === expectedAuthority.normalized;
}
function currentProcessIdentityProbeDisabled() {
    return (process.env.OMC_TEST_EMERGENCY_PROCESS_START_UNKNOWN_PID === String(process.pid)
        || process.env.OMC_TEST_FILE_LOCK_PROCESS_START_UNKNOWN_PID === String(process.pid));
}
function canonicalSyncIdentityFromTicks(identity) {
    const authority = windowsProcessStartAuthority(identity);
    return authority?.exact ? authority.normalized : undefined;
}
async function queryCurrentProcessStartIdentityFromRunner() {
    // The host helper constructs its request from process.pid; callers cannot
    // provide either the target PID or the returned identity.
    const moduleUrl = new URL('../../scripts/lib/host-delivery-ack.mjs', import.meta.url).href;
    const hostModule = await import(moduleUrl);
    if (typeof hostModule !== 'object' || hostModule === null)
        return null;
    const observeHostDeliveryAbort = Reflect.get(hostModule, 'observeHostDeliveryAbort');
    if (typeof observeHostDeliveryAbort !== 'function')
        return null;
    const observer = await Reflect.apply(observeHostDeliveryAbort, hostModule, []);
    if (typeof observer !== 'object' || observer === null)
        return null;
    const queryCurrentProcessStartIdentity = Reflect.get(observer, 'queryCurrentProcessStartIdentity');
    const close = Reflect.get(observer, 'close');
    if (typeof queryCurrentProcessStartIdentity !== 'function') {
        if (typeof close === 'function')
            Reflect.apply(close, observer, []);
        return null;
    }
    try {
        const identity = await Reflect.apply(queryCurrentProcessStartIdentity, observer, []);
        return typeof identity === 'string' ? identity : null;
    }
    finally {
        if (typeof close === 'function')
            Reflect.apply(close, observer, []);
    }
}
function abortReason(signal) {
    return signal.reason instanceof Error
        ? signal.reason
        : new Error('process identity warm-up aborted');
}
function execFileForIdentity(command, args, timeoutMs, signal, onProbeSpawn) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(abortReason(signal));
            return;
        }
        let child;
        try {
            child = execFile(command, [...args], {
                encoding: 'utf8',
                signal,
                timeout: Math.max(1, Math.floor(timeoutMs)),
                windowsHide: true,
            }, (error, stdout) => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve(stdout);
            });
        }
        catch (error) {
            reject(error);
            return;
        }
        if (Number.isInteger(child.pid) && child.pid > 0) {
            try {
                onProbeSpawn?.(child.pid);
            }
            catch {
                // Observability must not affect the authoritative identity probe.
            }
        }
    });
}
async function getProcessStartIdentityWindows(pid, deadlineAt, signal, onProbeSpawn) {
    for (const executable of ['pwsh', 'powershell']) {
        let executableMissing = false;
        for (const command of [
            `$p = [System.Diagnostics.Process]::GetProcessById(${pid}); if ($p) { $p.StartTime.ToUniversalTime().Ticks }`,
            `$p = Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" -ErrorAction Stop; if ($p -and $p.CreationDate) { ([DateTime]$p.CreationDate).ToUniversalTime().Ticks }`,
        ]) {
            if (signal?.aborted)
                throw abortReason(signal);
            const timeoutMs = Math.min(5000, remainingDeadlineMs(deadlineAt) ?? 5000);
            if (timeoutMs <= 0)
                return null;
            try {
                const stdout = await execFileForIdentity(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], timeoutMs, signal, onProbeSpawn);
                const ticks = stdout.trim().match(/^\d+$/)?.[0];
                if (ticks)
                    return `ticks:${ticks}`;
            }
            catch (error) {
                if (signal?.aborted)
                    throw abortReason(signal);
                executableMissing =
                    error.code === 'ENOENT';
                if (executableMissing)
                    break;
                // Try the next exact Windows identity source.
            }
            if (isDeadlineExceeded(deadlineAt))
                return null;
        }
        if (!executableMissing && isDeadlineExceeded(deadlineAt))
            return null;
    }
    if (signal?.aborted)
        throw abortReason(signal);
    const timeoutMs = Math.min(5000, remainingDeadlineMs(deadlineAt) ?? 5000);
    if (timeoutMs <= 0)
        return null;
    try {
        const stdout = await execFileForIdentity('wmic', ['process', 'where', `ProcessId=${pid}`, 'get', 'CreationDate', '/format:csv'], timeoutMs, signal, onProbeSpawn);
        const match = stdout.match(/(\d{14}\.\d{6}[+-]\d{3})/);
        return match ? dmtfCreationDateToTicks(match[1]) : null;
    }
    catch {
        if (signal?.aborted)
            throw abortReason(signal);
        return null;
    }
}
/**
 * Warm the exact current-process identity used by synchronous file locking.
 * Foreign PIDs are intentionally unsupported so no caller can seed authority.
 */
export async function warmCurrentProcessStartIdentitySyncCache(options = {}) {
    if (currentProcessIdentityProbeDisabled())
        return false;
    if (options.signal?.aborted)
        throw abortReason(options.signal);
    if (currentProcessStartIdentitySync !== undefined)
        return true;
    if (isDeadlineExceeded(options.deadlineAt))
        return false;
    if (process.platform !== 'win32') {
        const identity = getProcessStartIdentitySync(process.pid);
        return identity !== null && identity !== 'absent';
    }
    const identity = process.env.OMC_RUNNER_HOST_DELIVERY_ACK === '1'
        ? await queryCurrentProcessStartIdentityFromRunner()
        : await getProcessStartIdentityWindows(process.pid, options.deadlineAt, options.signal, options.onProbeSpawn);
    if (options.signal?.aborted)
        throw abortReason(options.signal);
    if (currentProcessIdentityProbeDisabled())
        return false;
    if (!identity)
        return false;
    const canonicalIdentity = canonicalSyncIdentityFromTicks(identity);
    if (!canonicalIdentity)
        return false;
    currentProcessStartIdentitySync = canonicalIdentity;
    return true;
}
/** Stable PID-reuse identity suitable for a durable worker manifest. */
export async function getProcessStartIdentity(pid, deadlineAt) {
    if (!Number.isInteger(pid) || pid <= 0 || isDeadlineExceeded(deadlineAt))
        return null;
    // The durable Windows API is ticks-based. The current-process sync cache has
    // a distinct microsecond lease encoding and must never escape through it.
    if (process.platform === 'win32')
        return getProcessStartIdentityWindows(pid, deadlineAt);
    const synchronousIdentity = getProcessStartIdentitySync(pid);
    if (synchronousIdentity === 'absent')
        return null;
    if (synchronousIdentity !== null)
        return synchronousIdentity;
    const startTime = await getProcessStartTime(pid, deadlineAt);
    return startTime === undefined || isDeadlineExceeded(deadlineAt) ? null : String(startTime);
}
export async function isProcessIdentityLive(pid, expectedStartIdentity, deadlineAt) {
    if (isDeadlineExceeded(deadlineAt))
        return 'unknown';
    if (!Number.isInteger(pid) || pid <= 0)
        return 'dead';
    if (!isProcessAlive(pid))
        return 'dead';
    if (typeof expectedStartIdentity !== 'string'
        || !expectedStartIdentity.trim())
        return 'unknown';
    if (process.platform === 'win32') {
        if (!windowsProcessStartAuthority(expectedStartIdentity))
            return 'unknown';
        const identity = await getProcessStartIdentity(pid, deadlineAt);
        if (identity === null)
            return isProcessAlive(pid) ? 'unknown' : 'dead';
        const matches = windowsProcessStartIdentitiesMatch(identity, expectedStartIdentity);
        return matches === undefined
            ? 'unknown'
            : matches
                ? 'live'
                : 'mismatch';
    }
    // Preserve pre-normalization behavior for non-Windows callers. Windows
    // identities were already compared through the shared canonical form above.
    let expected = expectedStartIdentity;
    if (expected.startsWith('dmtf:')) {
        const converted = dmtfCreationDateToTicks(expected.slice('dmtf:'.length));
        if (!converted)
            return 'unknown'; // malformed legacy identity is not authority
        expected = converted;
    }
    const identity = await getProcessStartIdentity(pid, deadlineAt);
    if (identity === null)
        return isProcessAlive(pid) ? 'unknown' : 'dead';
    return identity === expected ? 'live' : 'mismatch';
}
/**
 * Terminate only a process whose durable start identity still matches. Windows
 * binds verification to one exact root process identity and uses handles while
 * enumerating descendants; this remains a generic tree cleanup API, not a
 * creation-bound launch-owned authority. Launch-owned callers must use the
 * exact process-group API on POSIX and refuse unsupported Windows reconnects.
 */
export async function terminateOwnedProcessTree(options) {
    const deadline = parseDeadline(options.deadlineAt);
    if (deadline === undefined || isDeadlineExceeded(deadline))
        return 'deadline-exceeded';
    if (process.platform !== 'win32') {
        const liveness = await isProcessIdentityLive(options.pid, options.expectedStartIdentity, deadline);
        if (liveness === 'dead')
            return 'already-dead';
        if (liveness === 'mismatch')
            return 'identity-mismatch';
        if (liveness === 'unknown') {
            return isDeadlineExceeded(deadline) ? 'deadline-exceeded' : 'unknown';
        }
        if (isDeadlineExceeded(deadline))
            return 'deadline-exceeded';
        return killProcessTreeUnix(options.pid, options.force ? 'SIGKILL' : 'SIGTERM')
            ? 'terminated'
            : (isProcessAlive(options.pid) ? 'unknown' : 'already-dead');
    }
    if (!isProcessAlive(options.pid))
        return 'already-dead';
    const expectedAuthority = windowsProcessStartAuthority(options.expectedStartIdentity);
    if (!expectedAuthority)
        return 'unknown';
    const timeout = remainingDeadlineMs(deadline);
    if (!timeout)
        return 'deadline-exceeded';
    const waitMs = Math.max(1, timeout);
    const script = [
        'Add-Type -TypeDefinition @"',
        'using System;',
        'using System.Runtime.InteropServices;',
        'public static class OmcNative {',
        '  [DllImport("ntdll.dll")] public static extern int NtSuspendProcess(IntPtr handle);',
        '  [DllImport("ntdll.dll")] public static extern int NtResumeProcess(IntPtr handle);',
        '}',
        '"@',
        `$root = [System.Diagnostics.Process]::GetProcessById(${options.pid})`,
        '$rootTicks = $root.StartTime.ToUniversalTime().Ticks',
        `if ($rootTicks -lt ${expectedAuthority.minimum} -or $rootTicks -gt ${expectedAuthority.maximum}) { exit 3 }`,
        '$owned = @{}',
        '$owned[$root.Id] = @{ Process = $root; Depth = 0; Suspended = $true }',
        '[void][OmcNative]::NtSuspendProcess($root.Handle)',
        'try {',
        '  for ($pass = 0; $pass -lt 64; $pass++) {',
        '    $added = $false',
        '    foreach ($row in Get-CimInstance Win32_Process) {',
        '      $parent = [int]$row.ParentProcessId; $id = [int]$row.ProcessId',
        '      if (-not $owned.ContainsKey($parent) -or $owned.ContainsKey($id)) { continue }',
        '      try {',
        '        $process = [System.Diagnostics.Process]::GetProcessById($id)',
        '        $created = ([DateTime]$row.CreationDate).ToUniversalTime().Ticks',
        '        $processTicks = $process.StartTime.ToUniversalTime().Ticks',
        '        if ($processTicks -lt $created -or $processTicks -gt ($created + 9)) { continue }',
        '        [void][OmcNative]::NtSuspendProcess($process.Handle)',
        '        $owned[$id] = @{ Process = $process; Depth = ([int]$owned[$parent].Depth + 1); Suspended = $true }',
        '        $added = $true',
        '      } catch {}',
        '    }',
        '    if (-not $added) { break }',
        '  }',
        '  $ordered = $owned.Values | Sort-Object -Property Depth -Descending',
        '  foreach ($entry in $ordered) {',
        '    try {',
        '      if (-not $entry.Process.HasExited) { $entry.Process.Kill() }',
        '      $entry.Suspended = $false',
        '    } catch {',
        '      # Kill failed: resume this process so it is not left frozen.',
        '      try { if ($entry.Suspended -and -not $entry.Process.HasExited) { [void][OmcNative]::NtResumeProcess($entry.Process.Handle) } } catch {}',
        '      exit 4',
        '    }',
        '  }',
        `  if (-not $root.WaitForExit(${waitMs})) {`,
        '    # Deadline exceeded after suspension: resume any still-suspended processes.',
        '    foreach ($entry in $ordered) { try { if ($entry.Suspended -and -not $entry.Process.HasExited) { [void][OmcNative]::NtResumeProcess($entry.Process.Handle) } } catch {} }',
        '    exit 5',
        '  }',
        '} catch {',
        '  # Outer failure (e.g. CIM enumeration error): resume every suspended process.',
        '  foreach ($entry in $owned.Values) { try { if ($entry.Suspended -and -not $entry.Process.HasExited) { [void][OmcNative]::NtResumeProcess($entry.Process.Handle) } } catch {} }',
        '  exit 6',
        '} finally {',
        '  # Final safety net: resume any process still marked suspended.',
        '  foreach ($entry in $owned.Values) { try { if ($entry.Suspended -and -not $entry.Process.HasExited) { [void][OmcNative]::NtResumeProcess($entry.Process.Handle) } } catch {} }',
        '}',
    ].join("\n");
    try {
        await execFileAsync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout });
        return 'terminated';
    }
    catch (error) {
        if (isDeadlineExceeded(deadline))
            return 'deadline-exceeded';
        const status = error.status ?? error.code;
        if (status === 3)
            return 'identity-mismatch';
        if (!isProcessAlive(options.pid))
            return 'already-dead';
        // exit 4 (kill failed), exit 5 (deadline after suspension), exit 6 (outer failure):
        // all suspended processes have been resumed by the finally block, but we cannot
        // prove termination, so return unknown rather than claiming success.
        return 'unknown';
    }
}
//# sourceMappingURL=process-utils.js.map