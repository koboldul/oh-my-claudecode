import { afterAll, describe, expect, it, vi } from 'vitest';

const originalSkipParse = process.env.OMC_CLI_SKIP_PARSE;
process.env.OMC_CLI_SKIP_PARSE = '1';

const mocks = vi.hoisted(() => ({
  detectCopilotCliCompatibility: vi.fn(),
}));

vi.mock('../../team/copilot-cli-compatibility.js', () => ({
  detectCopilotCliCompatibility: mocks.detectCopilotCliCompatibility,
}));

afterAll(() => {
  if (originalSkipParse === undefined) {
    delete process.env.OMC_CLI_SKIP_PARSE;
  } else {
    process.env.OMC_CLI_SKIP_PARSE = originalSkipParse;
  }
});

describe('omc doctor copilot CLI parsing', () => {
  it('routes the parent --json option through the real Commander action', async () => {
    mocks.detectCopilotCliCompatibility.mockReturnValue({
      available: true,
      status: 'verified',
      verifiedVersion: '1.0.72-1',
      detectedVersion: '1.0.72-1',
      versionOutput: 'GitHub Copilot CLI 1.0.72-1',
      message: 'verified',
    });

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    try {
      const { buildProgram } = await import('../index.js');
      await buildProgram().parseAsync([
        'node',
        'omc',
        'doctor',
        'copilot',
        '--json',
      ]);

      expect(mocks.detectCopilotCliCompatibility).toHaveBeenCalledOnce();
      expect(log).toHaveBeenCalledTimes(1);
      expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({
        status: 'verified',
        detectedVersion: '1.0.72-1',
      });
      expect(exit).toHaveBeenCalledWith(0);
    } finally {
      log.mockRestore();
      exit.mockRestore();
    }
  });
});
