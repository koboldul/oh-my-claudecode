import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExecFileException } from 'node:child_process';

const { execFileMock, execFileSyncMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
  execFileSyncMock: vi.fn(),
}));

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return { ...actual, execFile: execFileMock, execFileSync: execFileSyncMock };
});

import { runTscDiagnostics } from '../tsc-runner.js';

const originalPlatform = process.platform;
const originalComspec = process.env.COMSPEC;
const fixtures: string[] = [];

type ExecFileCallback = (error: ExecFileException | null, stdout: string, stderr: string) => void;

function project(withLocalTypescript: boolean): string {
  const directory = mkdtempSync(join(tmpdir(), 'omc-tsc-resolution-'));
  fixtures.push(directory);
  writeFileSync(join(directory, 'tsconfig.json'), '{}');
  if (withLocalTypescript) {
    mkdirSync(join(directory, 'node_modules', 'typescript', 'bin'), { recursive: true });
    writeFileSync(join(directory, 'node_modules', 'typescript', 'package.json'), '{"name":"typescript","version":"5.9.3"}');
    writeFileSync(join(directory, 'node_modules', 'typescript', 'bin', 'tsc'), '');
  }
  return directory;
}

function execError(code: string, extra: Record<string, unknown> = {}): ExecFileException {
  return Object.assign(new Error(`exec tsc ${code}`), {
    code,
    killed: false,
    signal: undefined,
    stdout: '',
    stderr: '',
    ...extra,
  }) as ExecFileException;
}

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

beforeEach(() => {
  execFileMock.mockReset();
  execFileSyncMock.mockReset();
});

afterEach(() => {
  setPlatform(originalPlatform);
  if (originalComspec === undefined) delete process.env.COMSPEC;
  else process.env.COMSPEC = originalComspec;
  for (const directory of fixtures.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('tsc executable resolution', () => {
  it('runs the project-local TypeScript with node on win32', async () => {
    setPlatform('win32');
    const directory = project(true);
    execFileMock.mockImplementation(
      (_file: string, _args: string[], _options: unknown, callback: ExecFileCallback) => {
        callback(null, '', '');
      },
    );

    const result = await runTscDiagnostics(directory);

    expect(result).toMatchObject({ success: true, errorCount: 0 });
    expect(execFileSyncMock).not.toHaveBeenCalled();
    expect(execFileMock).toHaveBeenCalledTimes(1);
    const [file, args, options] = execFileMock.mock.calls[0];
    expect(file).toBe(process.execPath);
    expect(args).toEqual([join(directory, 'node_modules', 'typescript', 'bin', 'tsc'), '--noEmit', '--pretty', 'false']);
    expect(options).toMatchObject({ cwd: directory });
    expect(options).not.toHaveProperty('shell');
  });

  it('runs the project-local TypeScript with node on POSIX even when tsc is not on PATH', async () => {
    setPlatform('linux');
    const directory = project(true);
    execFileMock.mockImplementation(
      (_file: string, _args: string[], _options: unknown, callback: ExecFileCallback) => {
        callback(null, '', '');
      },
    );

    await expect(runTscDiagnostics(directory)).resolves.toMatchObject({ success: true, errorCount: 0 });
    expect(execFileMock.mock.calls[0][0]).toBe(process.execPath);
  });

  it('falls back to a PATH tsc through cmd.exe with a fixed command line on win32', async () => {
    setPlatform('win32');
    process.env.COMSPEC = 'C:\\Windows\\System32\\cmd.exe';
    const directory = project(false);
    execFileSyncMock.mockReturnValue('');
    execFileMock.mockImplementation(
      (_file: string, _args: string[], _options: unknown, callback: ExecFileCallback) => {
        callback(null, '', '');
      },
    );

    await expect(runTscDiagnostics(directory)).resolves.toMatchObject({ success: true, errorCount: 0 });
    expect(execFileSyncMock.mock.calls[0].slice(0, 2)).toEqual(['where.exe', ['tsc']]);
    const [file, args, options] = execFileMock.mock.calls[0];
    expect(file).toBe('C:\\Windows\\System32\\cmd.exe');
    expect(args).toEqual(['/d', '/s', '/c', 'tsc --noEmit --pretty false']);
    expect(options).toMatchObject({ cwd: directory, windowsVerbatimArguments: true });
  });

  it('reports tsc not found when tsc is not on PATH on win32', async () => {
    setPlatform('win32');
    const directory = project(false);
    execFileSyncMock.mockImplementation(() => {
      throw Object.assign(new Error('Command failed: where.exe tsc'), { status: 1 });
    });

    const result = await runTscDiagnostics(directory);

    expect(result.success).toBe(false);
    expect(result.errorCount).toBe(1);
    expect(result.error).toContain('tsc not found');
    expect(execFileSyncMock).toHaveBeenCalledTimes(1);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it('reports tsc not found when no local TypeScript exists and tsc is not on PATH on POSIX', async () => {
    setPlatform('linux');
    const directory = project(false);
    execFileMock.mockImplementation(
      (_file: string, _args: string[], _options: unknown, callback: ExecFileCallback) => {
        callback(execError('ENOENT'), '', '');
      },
    );

    const result = await runTscDiagnostics(directory);

    expect(result.success).toBe(false);
    expect(result.errorCount).toBe(1);
    expect(result.error).toContain('tsc not found');
    expect(result.error).toContain('ENOENT');
  });

  it('still parses file-position diagnostics from the local compiler', async () => {
    setPlatform('win32');
    const directory = project(true);
    execFileMock.mockImplementation(
      (_file: string, _args: string[], _options: unknown, callback: ExecFileCallback) => {
        callback(
          execError('2'),
          "input.ts(1,7): error TS2322: Type 'string' is not assignable to type 'number'.\n",
          '',
        );
      },
    );

    const result = await runTscDiagnostics(directory);

    expect(result.success).toBe(false);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ file: 'input.ts', line: 1, column: 7, code: 'TS2322' }),
    ]);
  });
});
