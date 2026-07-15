import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadConfig: vi.fn(),
  detectCli: vi.fn(),
}));

vi.mock('../../../config/loader.js', () => ({
  loadConfig: mocks.loadConfig,
}));

vi.mock('../../../team/cli-detection.js', () => ({
  detectCli: mocks.detectCli,
}));

import { doctorTeamRoutingCommand } from '../doctor-team-routing.js';

describe('doctor team-routing Copilot provider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadConfig.mockReturnValue({
      team: {
        roleRouting: {
          'code-reviewer': { provider: 'copilot' },
        },
      },
    });
    mocks.detectCli.mockImplementation((binary: string) => ({
      available: true,
      path: `C:\\Tools\\${binary}.exe`,
      version: `${binary} 1.0.0`,
    }));
  });

  it('probes configured Copilot routing through cross-platform CLI detection', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      expect(await doctorTeamRoutingCommand({ json: true })).toBe(0);
      expect(mocks.detectCli).toHaveBeenCalledWith('claude');
      expect(mocks.detectCli).toHaveBeenCalledWith('copilot');

      const report = JSON.parse(String(log.mock.calls[0]?.[0]));
      expect(report.probes).toEqual(expect.arrayContaining([
        expect.objectContaining({
          provider: 'copilot',
          binary: 'copilot',
          found: true,
          path: 'C:\\Tools\\copilot.exe',
        }),
      ]));
    } finally {
      log.mockRestore();
    }
  });
});
