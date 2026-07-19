import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { detectCli } from '../cli-detection.js';
import { clearResolvedPathCache } from '../model-contract.js';

const windowsIt = process.platform === 'win32' ? it : it.skip;

describe('cli-detection Windows command shims', () => {
  for (const extension of ['cmd', 'bat'] as const) {
    windowsIt(`probes a temporary .${extension} shim from a path containing spaces`, () => {
      const directory = mkdtempSync(join(tmpdir(), 'omc cli shim '));
      const binary = `omc-cli-probe-${process.pid}-${extension}-${Date.now()}`;
      const shimPath = join(directory, `${binary}.${extension}`);
      const originalPath = process.env.PATH;
      const originalPathExt = process.env.PATHEXT;
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

      writeFileSync(
        shimPath,
        [
          '@echo off',
          'if "%~1"=="--version" (',
          `  echo temporary-${extension} 1.0.72-1`,
          '  exit /b 0',
          ')',
          'exit /b 9',
          '',
        ].join('\r\n'),
        'utf8',
      );

      process.env.PATH = [directory, originalPath].filter(Boolean).join(delimiter);
      process.env.PATHEXT = ['.COM', '.EXE', '.BAT', '.CMD'].join(';');
      clearResolvedPathCache();

      try {
        const detected = detectCli(binary);
        expect(detected).toMatchObject({
          available: true,
          runnable: true,
          version: `temporary-${extension} 1.0.72-1`,
        });
        const detectedStat = statSync(detected.path!, { bigint: true });
        const shimStat = statSync(shimPath, { bigint: true });
        expect({
          dev: detectedStat.dev,
          ino: detectedStat.ino,
        }).toEqual({
          dev: shimStat.dev,
          ino: shimStat.ino,
        });
      } finally {
        clearResolvedPathCache();
        warn.mockRestore();
        if (originalPath === undefined) delete process.env.PATH;
        else process.env.PATH = originalPath;
        if (originalPathExt === undefined) delete process.env.PATHEXT;
        else process.env.PATHEXT = originalPathExt;
        rmSync(directory, { recursive: true, force: true });
      }
    });
  }
});
