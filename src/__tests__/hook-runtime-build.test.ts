import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = process.cwd();
const BUILD_SCRIPT = join(REPO_ROOT, 'scripts', 'build-hook-runtime.mjs');
const FIXTURE_ROOT = join(REPO_ROOT, 'src', '__tests__', 'fixtures', 'hooks');

describe('canonical hook runtime bundle', () => {
  it('builds a dependency-closed CJS runtime that normalizes Claude and Copilot fixtures', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'omc-hook-runtime-build-'));

    try {
      const outfile = join(tempRoot, 'bridge', 'hook-runtime.cjs');
      execFileSync(
        process.execPath,
        [BUILD_SCRIPT, '--outfile', outfile],
        { cwd: REPO_ROOT, stdio: 'pipe' },
      );

      expect(existsSync(outfile)).toBe(true);
      expect(readFileSync(outfile, 'utf8')).not.toMatch(
        /require\((?:'|")zod(?:'|")\)/,
      );

      const emptyNodeModules = join(tempRoot, 'empty-node-modules');
      mkdirSync(emptyNodeModules);
      const env = { ...process.env, NODE_PATH: emptyNodeModules };
      const probe = String.raw`
        const { readFileSync } = require('node:fs');
        const runtime = require(process.argv[1]);

        const load = (path) => JSON.parse(readFileSync(path, 'utf8'));
        const summarize = async (fixturePath) => {
          const result = await runtime.runHookPayload(
            'pre-tool-use',
            load(fixturePath),
            () => ({ decision: 'pass' }),
          );
          return {
            host: result.envelope.host,
            contract: result.envelope.contract,
            hookType: result.envelope.hookType,
            originalCallCount: result.envelope.originalCallCount,
            logicalCallCount: result.envelope.logicalCallCount,
            evaluationCount: result.evaluations.length,
            calls: result.envelope.toolCalls.map((call) => ({
              nativeName: call.nativeName,
              canonicalName: call.canonicalName,
              input: call.input,
              status: call.status,
            })),
          };
        };

        Promise.all([
          summarize(process.argv[2]),
          summarize(process.argv[3]),
        ]).then(([claude, copilot]) => {
          process.stdout.write(JSON.stringify({ claude, copilot }));
        }).catch((error) => {
          console.error(error);
          process.exitCode = 1;
        });
      `;
      const output = execFileSync(
        process.execPath,
        [
          '-e',
          probe,
          outfile,
          join(FIXTURE_ROOT, 'claude', 'PreToolUse.json'),
          join(FIXTURE_ROOT, 'copilot-1.0.72-1', 'preToolUse.json'),
        ],
        {
          cwd: tempRoot,
          encoding: 'utf8',
          env,
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      const result = JSON.parse(output) as {
        claude: Record<string, unknown>;
        copilot: Record<string, unknown>;
      };

      expect(result.claude).toMatchObject({
        host: 'claude',
        contract: 'claude-single',
        hookType: 'pre-tool-use',
        originalCallCount: 1,
        logicalCallCount: 1,
        evaluationCount: 1,
        calls: [{
          nativeName: 'Read',
          canonicalName: 'Read',
          input: { file_path: '<path>' },
          status: 'valid',
        }],
      });
      expect(result.copilot).toMatchObject({
        host: 'copilot',
        contract: 'copilot-1.0.72-1',
        hookType: 'pre-tool-use',
        originalCallCount: 2,
        logicalCallCount: 2,
        evaluationCount: 2,
        calls: [
          {
            nativeName: 'glob',
            canonicalName: 'Glob',
            input: { pattern: '<glob-pattern>', paths: '<path-1>' },
            status: 'valid',
          },
          {
            nativeName: 'rg',
            canonicalName: 'Grep',
            input: {
              pattern: '<search-pattern>',
              paths: ['<path-2>', '<path-3>', '<path-4>'],
              output_mode: 'content',
              glob: '<glob-pattern>',
              '-n': true,
              head_limit: 20,
            },
            status: 'valid',
          },
        ],
      });
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
