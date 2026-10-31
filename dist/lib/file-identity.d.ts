export interface FileIdentity {
    readonly dev: number | bigint;
    readonly ino: number | bigint;
}
export declare function fileIdentityOf(stats: FileIdentity): {
    readonly dev: bigint;
    readonly ino: bigint;
};
export declare function identitiesEqual(left: FileIdentity | null, right: FileIdentity): boolean;
export declare function sameFileIdentity(left: FileIdentity, right: FileIdentity): boolean;
//# sourceMappingURL=file-identity.d.ts.map