#!/usr/bin/env node
/**
 * OMC HUD - Main Entry Point
 *
 * Statusline command that visualizes oh-my-claudecode state.
 * Receives normalized host statusline stdin and outputs the formatted HUD.
 */
/** @internal Reset spawn guard — used by tests only. */
export declare function _resetSummarySpawnTimestamp(): void;
/** @internal Get the tracked summary process PID — used by tests only. */
export declare function _getSummaryProcessPid(): number | null;
declare function main(watchMode?: boolean, skipInit?: boolean): Promise<void>;
export { main };
//# sourceMappingURL=index.d.ts.map