import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  detectCopilotCliCompatibility: vi.fn(),
}));

vi.mock('../../../team/copilot-cli-compatibility.js', () => ({
  detectCopilotCliCompatibility: mocks.detectCopilotCliCompatibility,
}));

import { doctorCopilotCommand } from '../doctor-copilot.js';

describe('doctor Copilot compatibility diagnostic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes the verified contract', async () => {
    mocks.detectCopilotCliCompatibility.mockReturnValue({
      available: true,
      status: 'verified',
      verifiedVersion: '1.0.72-1',
      detectedVersion: '1.0.72-1',
      versionOutput: 'GitHub Copilot CLI 1.0.72-1',
      message: 'verified',
    });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    expect(await doctorCopilotCommand({ json: true })).toBe(0);
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({
      status: 'verified',
      detectedVersion: '1.0.72-1',
    });

    log.mockRestore();
  });

  it('fails an earlier unsupported version and preserves upgrade guidance', async () => {
    mocks.detectCopilotCliCompatibility.mockReturnValue({
      available: true,
      status: 'unsupported',
      verifiedVersion: '1.0.72-1',
      detectedVersion: '1.0.71-3',
      versionOutput: 'GitHub Copilot CLI 1.0.71-3',
      message: 'unsupported',
      guidance: 'Upgrade GitHub Copilot CLI to at least 1.0.72-1.',
    });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    expect(await doctorCopilotCommand({ json: true })).toBe(1);
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({
      status: 'unsupported',
      guidance: expect.stringContaining('Upgrade GitHub Copilot CLI'),
    });

    log.mockRestore();
  });

  it('warns without failing for a later unverified version', async () => {
    mocks.detectCopilotCliCompatibility.mockReturnValue({
      available: true,
      status: 'unverified',
      verifiedVersion: '1.0.72-1',
      detectedVersion: '1.0.73-0',
      versionOutput: 'GitHub Copilot CLI 1.0.73-0',
      message: 'unverified, not failed',
    });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    expect(await doctorCopilotCommand({ json: true })).toBe(0);
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({
      status: 'unverified',
      detectedVersion: '1.0.73-0',
    });

    log.mockRestore();
  });
});
