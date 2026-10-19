/** Compare legacy .NET UTC ticks at the DMTF probe's Unix-microsecond precision. */
export function normalizeProcessStartIdentity(identity) {
  const ticks = /^ticks:(\d{1,19})$/.exec(identity);
  return ticks
    ? `windows-dmtf-us:${(BigInt(ticks[1]) - 621355968000000000n) / 10n}`
    : identity;
}

/** Timestamp prefixes contain colons, which are illegal in NTFS filenames. */
export function encodeProcessStartForFilename(identity) {
  return identity.replace(/:/g, '_c_');
}

export function decodeProcessStartFromFilename(encoded) {
  return encoded.replace(/_c_/g, ':');
}
