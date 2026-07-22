/**
 * Native GitHub Copilot CLI HUD setup.
 *
 * Installs the shared HUD wrapper under COPILOT_HOME and updates only the
 * Copilot settings.json statusLine entry. JSONC edits preserve comments and
 * unrelated keys, and third-party status lines are never replaced without an
 * explicit opt-in.
 */
export type CopilotStatusLineOwnership = "missing" | "omc" | "third-party" | "invalid";
export interface CopilotHudSetupOptions {
    copilotHome?: string;
    homeDir?: string;
    packageRoot?: string;
    nodePath?: string;
    replaceExisting?: boolean;
}
export interface CopilotHudStatus {
    copilotHome: string;
    settingsPath: string;
    wrapperPath: string;
    pluginRoot: string;
    runtimePath: string;
    expectedCommand: string;
    ownership: CopilotStatusLineOwnership;
    settingsValid: boolean;
    runtimeAvailable: boolean;
    wrapperInstalled: boolean;
    wrapperCurrent: boolean;
    configured: boolean;
    needsRepair: boolean;
    diagnostic: string;
}
export interface CopilotHudSetupResult extends CopilotHudStatus {
    changed: boolean;
    replacedThirdParty: boolean;
}
export declare function getCopilotHome(env?: NodeJS.ProcessEnv, home?: string): string;
export declare function buildCopilotStatusLineCommand(nodePath: string, wrapperPath: string): string;
export declare function inspectCopilotHud(options?: CopilotHudSetupOptions): CopilotHudStatus;
export declare function configureCopilotHud(options?: CopilotHudSetupOptions): CopilotHudSetupResult;
//# sourceMappingURL=copilot-setup.d.ts.map