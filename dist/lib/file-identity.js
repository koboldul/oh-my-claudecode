export function fileIdentityOf(stats) {
    return {
        dev: BigInt(stats.dev),
        ino: BigInt(stats.ino),
    };
}
export function identitiesEqual(left, right) {
    if (!left)
        return false;
    const leftIdentity = fileIdentityOf(left);
    const rightIdentity = fileIdentityOf(right);
    if (leftIdentity.ino !== rightIdentity.ino)
        return false;
    // Windows can report a volume serial for fstat but 0 for pathname stat.
    // A zero device requires a known inode; only Windows may ignore a mismatch.
    if (leftIdentity.dev === 0n || rightIdentity.dev === 0n) {
        return leftIdentity.ino !== 0n &&
            (process.platform === "win32" || leftIdentity.dev === rightIdentity.dev);
    }
    return leftIdentity.dev === rightIdentity.dev;
}
export function sameFileIdentity(left, right) {
    return identitiesEqual(left, right);
}
//# sourceMappingURL=file-identity.js.map