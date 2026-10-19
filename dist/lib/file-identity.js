export function identitiesEqual(left, right) {
    if (!left || left.ino !== right.ino)
        return false;
    // Windows can report a volume serial for fstat but 0 for pathname stat.
    // A zero device requires a known inode; only Windows may ignore a mismatch.
    if (left.dev === 0 || right.dev === 0) {
        return left.ino !== 0 &&
            (process.platform === "win32" || left.dev === right.dev);
    }
    return left.dev === right.dev;
}
//# sourceMappingURL=file-identity.js.map