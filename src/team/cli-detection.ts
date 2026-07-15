// Re-exports from model-contract.ts for backward compatibility
// and additional CLI detection utilities
export { isCliAvailable, validateCliAvailable, getContract, type CliAgentType } from './model-contract.js';
import { spawnSync } from 'child_process';
import { win32 as win32Path } from 'path';

export interface CliInfo {
  available: boolean;
  version?: string;
  path?: string;
}

export function detectCli(binary: string): CliInfo {
  try {
    const versionOptions = {
      timeout: 5000,
      shell: process.platform === 'win32' && binary !== 'copilot',
    };
    let resolvedBinary = binary;
    let versionResult = spawnSync(resolvedBinary, ['--version'], versionOptions);
    const probeError = versionResult.error as NodeJS.ErrnoException | undefined;
    if (process.platform === 'win32' && binary === 'copilot' && probeError?.code === 'ENOENT') {
      const pathResult = spawnSync('where', [binary], { timeout: 5000, encoding: 'utf8' });
      const firstPath = pathResult.stdout
        ?.toString()
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean)
        .find(line => /\.(exe|com|cmd|bat)$/i.test(line));
      if (pathResult.status === 0 && firstPath && win32Path.isAbsolute(firstPath)) {
        resolvedBinary = firstPath;
        versionResult = /\.(cmd|bat)$/i.test(resolvedBinary)
          ? spawnSync(
              process.env.COMSPEC || 'cmd.exe',
              ['/d', '/s', '/c', `"${resolvedBinary}" --version`],
              { timeout: 5000 },
            )
          : spawnSync(resolvedBinary, ['--version'], { timeout: 5000, shell: false });
      }
    }
    if (versionResult.status === 0) {
      return {
        available: true,
        version: versionResult.stdout?.toString().trim(),
        path: resolvedBinary === binary
          ? spawnSync(process.platform === 'win32' ? 'where' : 'which', [binary], { timeout: 5000 })
              .stdout?.toString().trim()
          : resolvedBinary,
      };
    }
    return { available: false };
  } catch {
    return { available: false };
  }
}

export function detectAllClis(): Record<string, CliInfo> {
  return {
    claude: detectCli('claude'),
    codex: detectCli('codex'),
    gemini: detectCli('gemini'),
    cursor: detectCli('cursor-agent'),
    grok: detectCli('grok'),
    antigravity: detectCli('agy'),
    copilot: detectCli('copilot'),
  };
}
