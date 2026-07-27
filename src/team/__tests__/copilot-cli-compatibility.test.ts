import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  detectCli: vi.fn(),
}));

vi.mock('../cli-detection.js', () => ({
  detectCli: mocks.detectCli,
}));

import {
  QUALIFIED_COPILOT_CLI_VERSIONS,
  VERIFIED_COPILOT_CLI_VERSION,
  assessCopilotCliVersion,
  detectCopilotCliCompatibility,
  isQualifiedCopilotCliVersion,
  parseCopilotCliVersion,
} from '../copilot-cli-compatibility.js';

describe('Copilot CLI compatibility contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('recognizes GitHub Copilot CLI 1.0.72-1 as the verified contract', () => {
    mocks.detectCli.mockReturnValue({
      available: true,
      runnable: true,
      version: 'GitHub Copilot CLI 1.0.72-1',
      path: 'C:\\Tools\\copilot.exe',
    });

    expect(detectCopilotCliCompatibility()).toMatchObject({
      available: true,
      runnable: true,
      status: 'verified',
      verifiedVersion: VERIFIED_COPILOT_CLI_VERSION,
      detectedVersion: '1.0.72-1',
    });
    expect(mocks.detectCli).toHaveBeenCalledWith('copilot');
  });

  it('marks earlier versions unsupported with upgrade guidance', () => {
    expect(assessCopilotCliVersion('1.0.71-3')).toMatchObject({
      status: 'unsupported',
      guidance: expect.stringContaining('Upgrade GitHub Copilot CLI'),
    });
  });

  it.each([...QUALIFIED_COPILOT_CLI_VERSIONS])(
    'treats qualified version %s as verified against the baseline contract',
    (version) => {
      expect(assessCopilotCliVersion(version)).toMatchObject({
        status: 'verified',
        verifiedVersion: VERIFIED_COPILOT_CLI_VERSION,
        detectedVersion: version,
      });
      expect(isQualifiedCopilotCliVersion(version)).toBe(true);
    },
  );

  it('reports 1.0.75 as verified through qualification rather than exact match', () => {
    mocks.detectCli.mockReturnValue({
      available: true,
      runnable: true,
      version: 'GitHub Copilot CLI 1.0.75.',
      path: 'C:\\Tools\\copilot.exe',
    });

    expect(detectCopilotCliCompatibility()).toMatchObject({
      status: 'verified',
      detectedVersion: '1.0.75',
      message: expect.stringContaining('qualified against'),
    });
  });

  it('keeps unqualified versions out of the verified set', () => {
    for (const version of ['1.0.69-2', '1.0.71-0', '1.0.74-3', '1.0.76']) {
      expect(isQualifiedCopilotCliVersion(version)).toBe(false);
    }
  });

  it.each(['1.0.72-2', '1.0.73-0'])(
    'marks later version %s unverified rather than failed',
    (version) => {
      expect(assessCopilotCliVersion(version)).toMatchObject({
        status: 'unverified',
        message: expect.stringContaining('unverified, not failed'),
      });
    },
  );

  it('extracts the numeric contract version from normal CLI output', () => {
    expect(parseCopilotCliVersion('GitHub Copilot CLI 1.0.72-1')).toBe('1.0.72-1');
  });

  it('keeps a failed version probe available but unverified with diagnostics', () => {
    mocks.detectCli.mockReturnValue({
      available: true,
      runnable: false,
      path: 'C:\\Tools\\copilot.exe',
      error: 'Version probe timed out after 5000ms.',
    });

    expect(detectCopilotCliCompatibility()).toMatchObject({
      available: true,
      runnable: false,
      status: 'unverified',
      path: 'C:\\Tools\\copilot.exe',
      diagnostic: 'Version probe timed out after 5000ms.',
    });
  });
});
