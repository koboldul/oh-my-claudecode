/**
 * Identifier discovery must not import skill rendering: its provider guidance
 * loads delegation/agent definitions and probes external CLIs.
 */
export declare function getPackageDir(): string;
export declare function getBuiltinSkillIdentifiers(metadata: Record<string, string>, skillName: string): {
    primaryName: string;
    aliases: string[];
};
export interface BuiltinSkillRegistration {
    readonly skillPath: string;
    readonly skillName: string;
    readonly content: string;
    readonly primaryName: string;
    readonly registeredNames: readonly string[];
}
/**
 * Share runtime identifier claims without rendering skill bodies or reading
 * settings. Callers supply observations so hooks can cache and freeze them.
 */
export declare function loadBuiltinSkillRegistrations(skillsDirectories: readonly string[], readText: (path: string) => string | null, listDirectories: (path: string) => readonly string[], userType: string | undefined): BuiltinSkillRegistration[];
/** Default metadata observations for the plugin loader and delegation helpers. */
export declare function readBuiltinSkillRegistrations(): BuiltinSkillRegistration[];
export declare function getSkillsDir(): string;
//# sourceMappingURL=registry.d.ts.map