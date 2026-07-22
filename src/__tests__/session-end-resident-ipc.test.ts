import { createRequire } from 'node:module';
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const ipc = require('../../scripts/lib/session-end-ipc.cjs') as {
  MAX_IPC_FRAME_BYTES: number;
  MAX_READY_FRAMES: number;
  atomicWritePrivateJson(path: string, value: unknown): void;
  buildSignedRequest(
    control: Record<string, unknown>,
    context: Record<string, string>,
    published: Record<string, unknown>,
    env?: NodeJS.ProcessEnv,
  ): Record<string, unknown>;
  decodeSpoolFrame(frame: Buffer): {
    header: Record<string, unknown>;
    raw: Buffer;
  };
  encodeIpcFrame(value: unknown): Buffer;
  isFreshTimestamp(timestamp: number): boolean;
  publishSessionEndFrame(
    context: Record<string, string>,
    input: {
      producer: 'core' | 'wiki';
      raw: Buffer;
      host: 'claude' | 'copilot';
      env?: NodeJS.ProcessEnv;
    },
  ): {
    eventId: string;
    rawDigest: string;
    spoolName: string;
    readyPath: string;
    producer: 'core' | 'wiki';
  };
  readControl(context: Record<string, string>): Record<string, unknown> | null;
  resolveResidentContext(input: {
    pluginRoot: string;
    directory: string;
    sessionId: string;
    env?: NodeJS.ProcessEnv;
  }): Record<string, string>;
  signObject(token: string, value: unknown): string;
  validateSpoolName(value: string): string;
  verifyObjectMac(token: string, value: unknown): boolean;
};

const directories: string[] = [];

function fixture(label: string) {
  const root = mkdtempSync(join(tmpdir(), `omc-resident-ipc-${label}-`));
  directories.push(root);
  const pluginRoot = join(root, 'plugin');
  const project = join(root, 'project');
  const runtime = join(root, 'runtime');
  mkdirSync(join(pluginRoot, 'bridge'), { recursive: true });
  mkdirSync(join(pluginRoot, 'dist', 'hooks', 'session-end'), {
    recursive: true,
  });
  mkdirSync(join(pluginRoot, 'dist', 'hooks', 'wiki'), { recursive: true });
  mkdirSync(join(project, '.git'), { recursive: true });
  writeFileSync(
    join(pluginRoot, 'package.json'),
    JSON.stringify({ version: '1.2.3' }),
  );
  for (const file of [
    join(pluginRoot, 'bridge', 'hook-runtime.cjs'),
    join(pluginRoot, 'dist', 'hooks', 'session-end', 'index.js'),
    join(pluginRoot, 'dist', 'hooks', 'session-end', 'worker.js'),
    join(pluginRoot, 'dist', 'hooks', 'wiki', 'session-hooks.js'),
  ]) {
    writeFileSync(file, `// ${label}\n`);
  }
  const env = {
    ...process.env,
    LOCALAPPDATA: runtime,
    TMPDIR: runtime,
    TMP: runtime,
    TEMP: runtime,
  };
  const context = ipc.resolveResidentContext({
    pluginRoot,
    directory: project,
    sessionId: 'resident-session',
    env,
  });
  return { context, env, pluginRoot, project, root };
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('SessionEnd resident IPC primitives', () => {
  it('writes a private framed durable spool without persisting secret deltas', () => {
    const { context, env } = fixture('framed-spool');
    const raw = Buffer.from(JSON.stringify({
      session_id: 'resident-session',
      cwd: context.worktreeRoot,
    }));
    const secret = 'resident-secret-must-not-be-spooled';
    const first = ipc.publishSessionEndFrame(context, {
      producer: 'core',
      raw,
      host: 'claude',
      env: { ...env, OMC_TELEGRAM_BOT_TOKEN: secret },
    });
    const second = ipc.publishSessionEndFrame(context, {
      producer: 'core',
      raw,
      host: 'claude',
      env,
    });

    expect(first.eventId).toBe(second.eventId);
    expect(first.rawDigest).toBe(second.rawDigest);
    expect(first.spoolName).not.toBe(second.spoolName);
    const bytes = readFileSync(first.readyPath);
    expect(bytes.includes(Buffer.from(secret))).toBe(false);
    const decoded = ipc.decodeSpoolFrame(bytes);
    expect(decoded.raw).toEqual(raw);
    expect(decoded.header).toMatchObject({
      v: 2,
      eventId: first.eventId,
      rawDigest: first.rawDigest,
      producer: 'core',
      sessionId: 'resident-session',
    });
    if (process.platform !== 'win32') {
      expect(lstatSync(first.readyPath).mode & 0o077).toBe(0);
    }
  });

  it('uses a mandatory 256-bit token and bounds signed requests to one 4KiB frame', () => {
    const { context, env } = fixture('signed-request');
    const published = ipc.publishSessionEndFrame(context, {
      producer: 'core',
      raw: Buffer.from(JSON.stringify({
        session_id: 'resident-session',
        cwd: context.worktreeRoot,
      })),
      host: 'claude',
      env,
    });
    const token = 'ab'.repeat(32);
    const control = {
      instanceId: 'cd'.repeat(16),
      token,
    };
    const request = ipc.buildSignedRequest(
      control,
      context,
      published,
      {
        ...env,
        OMC_TELEGRAM_BOT_TOKEN: 'x'.repeat(8_192),
        OMC_SLACK_BOT_TOKEN: 'short-secret',
      },
    );
    const frame = ipc.encodeIpcFrame(request);

    expect(token).toHaveLength(64);
    expect(frame.length).toBeLessThanOrEqual(ipc.MAX_IPC_FRAME_BYTES);
    expect(ipc.verifyObjectMac(token, request)).toBe(true);
    expect(request.env).toMatchObject({
      OMC_SLACK_BOT_TOKEN: 'short-secret',
    });
    expect(request.env).not.toHaveProperty('OMC_TELEGRAM_BOT_TOKEN');

    const tampered = { ...request, rawDigest: '00'.repeat(32) };
    expect(ipc.verifyObjectMac(token, tampered)).toBe(false);
    expect(ipc.signObject(token, request)).toBe(request.mac);
  });

  it('rejects traversal, oversize frames, and stale request timestamps', () => {
    expect(() => ipc.validateSpoolName('../event.frame')).toThrow();
    expect(() => ipc.validateSpoolName('event/child.frame')).toThrow();
    expect(() => ipc.encodeIpcFrame({
      payload: 'x'.repeat(ipc.MAX_IPC_FRAME_BYTES),
    })).toThrow(/4KiB/);
    expect(ipc.isFreshTimestamp(Date.now() - 60_000)).toBe(false);
    expect(ipc.isFreshTimestamp(Date.now() + 60_000)).toBe(false);
    expect(ipc.isFreshTimestamp(Date.now())).toBe(true);
  });

  it('isolates the same session id across worktree scopes', () => {
    const first = fixture('scope-one');
    const second = fixture('scope-two');
    const secondContext = ipc.resolveResidentContext({
      pluginRoot: first.pluginRoot,
      directory: second.project,
      sessionId: 'resident-session',
      env: first.env,
    });

    expect(first.context.scopeKey).not.toBe(secondContext.scopeKey);
    expect(first.context.contextDir).not.toBe(secondContext.contextDir);
    expect(first.context.controlPath).not.toBe(secondContext.controlPath);
    expect(first.context.endpoint).not.toBe(secondContext.endpoint);
  });

  it('enforces a bounded inbox instead of accepting unbounded durable frames', () => {
    const { context, env } = fixture('bounded-inbox');
    ipc.publishSessionEndFrame(context, {
      producer: 'core',
      raw: Buffer.from(JSON.stringify({
        session_id: 'resident-session',
        cwd: context.worktreeRoot,
      })),
      host: 'claude',
      env,
    });
    for (let index = 1; index < ipc.MAX_READY_FRAMES; index += 1) {
      writeFileSync(join(context.readyDir, `placeholder-${index}`), 'x');
    }
    expect(() => ipc.publishSessionEndFrame(context, {
      producer: 'wiki',
      raw: Buffer.from('{}'),
      host: 'claude',
      env,
    })).toThrow(/inbox is full/);
  });

  const symlinkTest = process.platform === 'win32' ? it.skip : it;
  symlinkTest('rejects symlinked control discovery', () => {
    const { context } = fixture('control-symlink');
    mkdirSync(context.contextDir, { recursive: true });
    const target = join(context.contextDir, 'foreign-control.json');
    writeFileSync(target, '{}', { mode: 0o600 });
    symlinkSync(target, context.controlPath);
    expect(ipc.readControl(context)).toBeNull();
  });

  it('rejects group-readable control discovery on POSIX', () => {
    const { context } = fixture('control-mode');
    if (process.platform === 'win32') return;
    mkdirSync(context.contextDir, { recursive: true });
    ipc.atomicWritePrivateJson(context.controlPath, {
      v: 2,
      state: 'ready',
      instanceId: 'ab'.repeat(16),
      token: 'cd'.repeat(32),
      buildKey: context.buildKey,
      scopeKey: context.scopeKey,
      sessionId: context.sessionId,
      endpoint: context.endpoint,
      pid: process.pid,
      processStartIdentity: 'identity',
    });
    chmodSync(context.controlPath, 0o644);
    expect(ipc.readControl(context)).toBeNull();
  });
});
