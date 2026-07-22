export { isCliAvailable, validateCliAvailable, getContract, type CliAgentType } from './model-contract.js';
export interface CliInfo {
    available: boolean;
    runnable: boolean;
    version?: string;
    path?: string;
    error?: string;
}
export declare function detectCli(binary: string): CliInfo;
export declare function detectAllClis(): Record<string, CliInfo>;
//# sourceMappingURL=cli-detection.d.ts.map