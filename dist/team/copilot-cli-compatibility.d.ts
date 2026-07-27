export declare const VERIFIED_COPILOT_CLI_VERSION = "1.0.72-1";
/**
 * Copilot CLI versions whose hook envelope was qualified against the
 * `1.0.72-1` contract snapshot in
 * `src/__tests__/fixtures/hooks/copilot-1.0.72-1/`.
 *
 * Qualification method: every `hook.start.data.input` record in local Copilot
 * session logs was reduced to a typed key-path set and diffed against the
 * baseline version. Tool-specific `toolInput`/`toolResult` payloads are
 * collapsed because they vary by which tool ran, not by CLI version. A version
 * qualifies only when all baseline hook events were observed and no envelope
 * field was added or removed. See `_provenance.json` -> `qualifiedVersions`.
 */
export declare const QUALIFIED_COPILOT_CLI_VERSIONS: readonly string[];
export declare function isQualifiedCopilotCliVersion(version: string): boolean;
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