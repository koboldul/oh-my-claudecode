/**
 * Cross-Platform Process Utilities
 * Provides unified process management across Windows, macOS, and Linux.
 */
export interface OwnedProcessGroup {
    pid: number;
    processStartIdentity: string;
    processGroupId: number;
}
/** Capture creation-bound POSIX process-group metadata for a detached owner. */
export declare function captureOwnedProcessGroup(pid: number): OwnedProcessGroup | null;
export interface TerminateOwnedProcessGroupOptions {
    pid: number;
    expectedStartIdentity: string;
    processGroupId: number;
    deadlineAt: string;
    force?: boolean;
}
/** Signal only an exact-identity POSIX process-group leader; never fall back to PID. */
export declare function terminateOwnedProcessGroup(options: TerminateOwnedProcessGroupOptions): Promise<'terminated' | 'already-dead' | 'identity-mismatch' | 'unknown' | 'deadline-exceeded'>;
/**
 * Kill a process and optionally its entire process tree.
 *
 * On Windows: Uses taskkill /T for generic callers; this is not creation-bound
 * and MUST NOT be used for launch-owned cleanup.
 * On Unix: Signals the owned process group, falling back to the root PID.
 */
export declare function killProcessTree(pid: number, signal?: NodeJS.Signals): Promise<boolean>;
/**
 * Check if a process is alive.
 * Works cross-platform by attempting signal 0.
 * EPERM means the process exists but we lack permission to signal it.
 */
export declare function isProcessAlive(pid: number): boolean;
export type ProcessStartIdentitySync = string | 'absent' | null;
export declare function parseWindowsProcessStartIdentity(value: string): string | undefined;
/**
 * Synchronous process-start identity for exclusive file-lock ownership.
 * `absent` proves the PID is not live; `null` means identity is unavailable.
 */
export declare function getProcessStartIdentitySync(pid: number): ProcessStartIdentitySync;
/**
 * Get process start time for PID reuse detection.
 * Returns milliseconds timestamp on macOS/Windows, jiffies on Linux.
 */
export declare function getProcessStartTime(pid: number, deadlineAt?: number): Promise<number | undefined>;
/**
 * Gracefully terminate a process with escalation.
 */
export declare function gracefulKill(pid: number, gracePeriodMs?: number): Promise<'graceful' | 'forced' | 'failed'>;
/** Convert a WMIC/CIM DMTF datetime to .NET ticks for a single Windows identity format. */
export declare function dmtfCreationDateToTicks(dmtf: string): string | null;
/** Stable PID-reuse identity suitable for a durable worker manifest. */
export declare function getProcessStartIdentity(pid: number, deadlineAt?: number): Promise<string | null>;
export declare function isProcessIdentityLive(pid: number, expectedStartIdentity: string, deadlineAt?: number): Promise<'live' | 'dead' | 'mismatch' | 'unknown'>;
export interface TerminateOwnedProcessTreeOptions {
    pid: number;
    expectedStartIdentity: string;
    deadlineAt: string;
    force?: boolean;
}
/**
 * Terminate only a process whose durable start identity still matches. Windows
 * binds verification to one exact root process identity and uses handles while
 * enumerating descendants; this remains a generic tree cleanup API, not a
 * creation-bound launch-owned authority. Launch-owned callers must use the
 * exact process-group API on POSIX and refuse unsupported Windows reconnects.
 */
export declare function terminateOwnedProcessTree(options: TerminateOwnedProcessTreeOptions): Promise<'terminated' | 'already-dead' | 'identity-mismatch' | 'unknown' | 'deadline-exceeded'>;
//# sourceMappingURL=process-utils.d.ts.map