import { compareVersions } from '../features/auto-update.js';
import { detectCli } from './cli-detection.js';

export const VERIFIED_COPILOT_CLI_VERSION = '1.0.72-1';

export type CopilotCliCompatibilityStatus =
  | 'verified'
  | 'unsupported'
  | 'unverified';

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

const COPILOT_CLI_VERSION_PATTERN = /\b(\d+\.\d+\.\d+(?:-\d+)?)\b/;

export function parseCopilotCliVersion(versionOutput: string): string | undefined {
  return versionOutput.match(COPILOT_CLI_VERSION_PATTERN)?.[1];
}

function toComparableVersion(version: string): string {
  const [core, revision = '0'] = version.split('-', 2);
  return `${core}.${revision}`;
}

export function assessCopilotCliVersion(
  detectedVersion: string,
): Omit<CopilotCliCompatibility, 'available' | 'runnable' | 'path' | 'versionOutput'> {
  const comparison = compareVersions(
    toComparableVersion(detectedVersion),
    toComparableVersion(VERIFIED_COPILOT_CLI_VERSION),
  );

  if (comparison === 0) {
    return {
      status: 'verified',
      verifiedVersion: VERIFIED_COPILOT_CLI_VERSION,
      detectedVersion,
      message: `GitHub Copilot CLI ${detectedVersion} matches the verified OMC host contract.`,
    };
  }

  if (comparison < 0) {
    return {
      status: 'unsupported',
      verifiedVersion: VERIFIED_COPILOT_CLI_VERSION,
      detectedVersion,
      message: `GitHub Copilot CLI ${detectedVersion} is older than the verified OMC host contract ${VERIFIED_COPILOT_CLI_VERSION}.`,
      guidance: `Upgrade GitHub Copilot CLI to at least ${VERIFIED_COPILOT_CLI_VERSION} using the same package manager used to install it, then rerun \`copilot --version\`.`,
    };
  }

  return {
    status: 'unverified',
    verifiedVersion: VERIFIED_COPILOT_CLI_VERSION,
    detectedVersion,
    message: `GitHub Copilot CLI ${detectedVersion} is newer than the verified OMC host contract ${VERIFIED_COPILOT_CLI_VERSION}; compatibility is unverified, not failed.`,
    guidance: 'Continue with caution because contract fixtures and live qualification have not yet passed for this version.',
  };
}

export function detectCopilotCliCompatibility(): CopilotCliCompatibility {
  const detected = detectCli('copilot');
  if (!detected.available) {
    return {
      available: false,
      runnable: false,
      status: 'not-installed',
      verifiedVersion: VERIFIED_COPILOT_CLI_VERSION,
      ...(detected.error ? { diagnostic: detected.error } : {}),
      message: 'GitHub Copilot CLI was not found on PATH.',
      guidance: `Install or upgrade GitHub Copilot CLI to at least ${VERIFIED_COPILOT_CLI_VERSION}, then rerun \`copilot --version\`.`,
    };
  }

  const versionOutput = detected.version
    ?.split(/\r?\n/)
    .map(line => line.trim())
    .find(Boolean);
  const detectedVersion = versionOutput
    ? parseCopilotCliVersion(versionOutput)
    : undefined;

  if (!detectedVersion) {
    return {
      available: true,
      runnable: detected.runnable,
      status: 'unverified',
      verifiedVersion: VERIFIED_COPILOT_CLI_VERSION,
      ...(versionOutput ? { versionOutput } : {}),
      ...(detected.path ? { path: detected.path.split(/\r?\n/)[0] } : {}),
      ...(detected.error ? { diagnostic: detected.error } : {}),
      message: 'GitHub Copilot CLI is installed, but its version could not be parsed; compatibility is unverified, not failed.',
      guidance: 'Run `copilot --version` and compare its output with the verified contract before relying on parity-sensitive behavior.',
    };
  }

  return {
    available: true,
    runnable: detected.runnable,
    ...assessCopilotCliVersion(detectedVersion),
    versionOutput,
    ...(detected.path ? { path: detected.path.split(/\r?\n/)[0] } : {}),
  };
}
