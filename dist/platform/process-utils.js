/**
 * Cross-Platform Process Utilities
 * Provides unified process management across Windows, macOS, and Linux.
 */
import { execFileSync, execFile } from 'child_process';
import { promisify } from 'util';
import { readFileSync } from 'fs';
import * as fsPromises from 'fs/promises';
const execFileAsync = promisify(execFile);
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
 * On Windows: Uses taskkill /T for tree kill, /F for force
 * On Unix: Uses negative PID for process group, falls back to direct kill
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
            return false;
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
/** Stable PID-reuse identity suitable for a durable worker manifest. */
export async function getProcessStartIdentity(pid, deadlineAt) {
    const synchronousIdentity = getProcessStartIdentitySync(pid);
    if (synchronousIdentity === 'absent')
        return null;
    if (synchronousIdentity !== null)
        return synchronousIdentity;
    const startTime = await getProcessStartTime(pid, deadlineAt);
    return startTime === undefined || isDeadlineExceeded(deadlineAt) ? null : String(startTime);
}
export async function isProcessIdentityLive(pid, expectedStartIdentity, deadlineAt) {
    if (!Number.isInteger(pid) || pid <= 0 || !expectedStartIdentity || isDeadlineExceeded(deadlineAt)) {
        return isDeadlineExceeded(deadlineAt) ? 'unknown' : 'dead';
    }
    if (!isProcessAlive(pid))
        return 'dead';
    const identity = await getProcessStartIdentity(pid, deadlineAt);
    if (identity === null)
        return isProcessAlive(pid) ? 'unknown' : 'dead';
    return identity === expectedStartIdentity ? 'live' : 'mismatch';
}
/**
 * Terminate only a process whose durable start identity still matches. The
 * Windows path is asynchronous and receives the worker's remaining deadline,
 * preventing taskkill from holding SessionEnd for its legacy five seconds.
 */
export async function terminateOwnedProcessTree(options) {
    const deadline = parseDeadline(options.deadlineAt);
    if (deadline === undefined || isDeadlineExceeded(deadline))
        return 'deadline-exceeded';
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
    if (process.platform !== 'win32') {
        return killProcessTreeUnix(options.pid, options.force ? 'SIGKILL' : 'SIGTERM')
            ? 'terminated'
            : (isProcessAlive(options.pid) ? 'unknown' : 'already-dead');
    }
    const timeout = remainingDeadlineMs(deadline);
    if (!timeout)
        return 'deadline-exceeded';
    try {
        const args = ['/T', '/PID', String(options.pid)];
        if (options.force)
            args.unshift('/F');
        await execFileAsync('taskkill.exe', args, { windowsHide: true, timeout });
        return 'terminated';
    }
    catch (error) {
        if (isDeadlineExceeded(deadline))
            return 'deadline-exceeded';
        const status = error.status;
        if (status === 128 || !isProcessAlive(options.pid))
            return 'already-dead';
        return 'unknown';
    }
}
//# sourceMappingURL=process-utils.js.map