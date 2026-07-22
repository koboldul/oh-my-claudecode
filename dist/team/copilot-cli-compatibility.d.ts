export declare const VERIFIED_COPILOT_CLI_VERSION = "1.0.72-1";
export type CopilotCliCompatibilityStatus = 'verified' | 'unsupported' | 'unverified';
export interface CopilotCliCompatibility {
    available: boolean;
    runnable: boolean;
    status: CopilotCliCompatibilityStatus | 'not-installed';
    verifiedVersion: string;
    detectedVersion?: string;
    versionOutput?: string;
    path?: string;
    diagnostic?: string;
    message: string;
    guidance?: string;
}
export declare function parseCopilotCliVersion(versionOutput: string): string | undefined;
export declare function assessCopilotCliVersion(detectedVersion: string): Omit<CopilotCliCompatibility, 'available' | 'runnable' | 'path' | 'versionOutput'>;
export declare function detectCopilotCliCompatibility(): CopilotCliCompatibility;
//# sourceMappingURL=copilot-cli-compatibility.d.ts.map