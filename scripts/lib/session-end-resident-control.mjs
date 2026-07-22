import { execFileSync, spawn } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';

const require = createRequire(import.meta.url);
const ipc = require('./session-end-ipc.cjs');

function testResidentDisabled(env) {
  return env.NODE_ENV === 'test'
    && env.OMC_SESSION_END_RESIDENT_TEST_ENABLE !== '1';
}

function windowsAclMarker(context) {
  return join(context.root, '.acl-v2');
}

function hardenWindowsRuntime(context, env) {
  if (process.platform !== 'win32') return true;
  const marker = windowsAclMarker(context);
  if (existsSync(marker)) {
    try {
      const stat = lstatSync(marker);
      return stat.isFile() && !stat.isSymbolicLink();
    } catch {
      return false;
    }
  }
  const username = env.USERNAME;
  if (!username) return false;
  const account = env.USERDOMAIN ? `${env.USERDOMAIN}\\${username}` : username;
  try {
    execFileSync(
      'icacls.exe',
      [
        context.root,
        '/inheritance:r',
        '/grant:r',
        `${account}:(OI)(CI)F`,
        '*S-1-5-18:(OI)(CI)F',
        '/T',
        '/C',
      ],
      {
        stdio: 'ignore',
        timeout: 10_000,
        windowsHide: true,
      },
    );
    writeFileSync(marker, 'user+SYSTEM\n', { encoding: 'utf8', mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}

async function processIdentityModule(pluginRoot) {
  return import(
    pathToFileURL(join(pluginRoot, 'dist', 'platform', 'process-utils.js')).href
  );
}

async function residentLiveness(pluginRoot, control, deadlineAt) {
  try {
    const { isProcessIdentityLive } = await processIdentityModule(pluginRoot);
    return await isProcessIdentityLive(
      control.pid,
      control.processStartIdentity,
      deadlineAt,
    );
  } catch {
    try {
      process.kill(control.pid, 0);
      return 'unknown';
    } catch {
      return 'dead';
    }
  }
}

function removeOwnedEndpoint(context) {
  if (process.platform === 'win32') return;
  try {
    const stat = lstatSync(context.endpoint);
    if (stat.isSocket() && !stat.isSymbolicLink()) unlinkSync(context.endpoint);
  } catch {
    // Missing or already removed.
  }
}

function recoverProcessingFrames(context) {
  let entries = [];
  try {
    entries = readdirSync(context.processingDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isFile() || entry.isSymbolicLink()) continue;
    const source = join(context.processingDir, entry.name);
    if (entry.name.endsWith('.claim.json')) {
      try { unlinkSync(source); } catch { /* best effort */ }
      continue;
    }
    if (!entry.name.endsWith('.frame')) continue;
    const destination = join(context.readyDir, entry.name);
    try {
      if (existsSync(destination)) {
        const sourceFrame = ipc.readSpoolFrame(source);
        const destinationFrame = ipc.readSpoolFrame(destination);
        if (
          sourceFrame.header.eventId === destinationFrame.header.eventId
          && sourceFrame.header.rawDigest === destinationFrame.header.rawDigest
        ) {
          unlinkSync(source);
        }
      } else {
        renameSync(source, destination);
      }
    } catch {
      // Leave ambiguous durable data untouched for manual recovery.
    }
  }
  ipc.fsyncDirectory(context.readyDir);
}

export function cleanStaleSessionEndResident(context) {
  recoverProcessingFrames(context);
  removeOwnedEndpoint(context);
  try { unlinkSync(context.controlPath); } catch { /* best effort */ }
  try {
    for (const entry of readdirSync(context.bootstrapDir, { withFileTypes: true })) {
      if (entry.isFile() && !entry.isSymbolicLink()) {
        unlinkSync(join(context.bootstrapDir, entry.name));
      }
    }
  } catch {
    // Bootstrap cleanup is best effort.
  }
}

function residentEnvironment(env) {
  return {
    ...env,
    OMC_HOOK_BACKGROUND_CHILD: '1',
  };
}

function writeBootstrap(context, env) {
  const instanceId = randomBytes(16).toString('hex');
  const token = randomBytes(32).toString('hex');
  const bootstrapPath = join(
    context.bootstrapDir,
    `bootstrap-${instanceId}.json`,
  );
  ipc.atomicWritePrivateJson(bootstrapPath, {
    v: ipc.PROTOCOL_VERSION,
    instanceId,
    token,
    buildKey: context.buildKey,
    scopeKey: context.scopeKey,
    sessionId: context.sessionId,
    pluginRoot: context.pluginRoot,
    worktreeRoot: context.worktreeRoot,
    endpoint: context.endpoint,
    controlPath: context.controlPath,
    contextDir: context.contextDir,
    createdAt: Date.now(),
    parentPid: process.pid,
    test: env.NODE_ENV === 'test',
  });
  return { bootstrapPath, instanceId };
}

function launchLockPath(context) {
  return join(context.contextDir, 'launch.lock');
}

function acquireLaunchLock(context) {
  const lockPath = launchLockPath(context);
  try {
    writeFileSync(
      lockPath,
      JSON.stringify({ pid: process.pid, createdAt: Date.now() }),
      { encoding: 'utf8', flag: 'wx', mode: 0o600 },
    );
    return true;
  } catch (error) {
    if (error?.code !== 'EEXIST') return false;
  }
  try {
    const stat = lstatSync(lockPath);
    if (
      stat.isFile()
      && !stat.isSymbolicLink()
      && Date.now() - stat.mtimeMs > 10_000
    ) {
      unlinkSync(lockPath);
      writeFileSync(
        lockPath,
        JSON.stringify({ pid: process.pid, createdAt: Date.now() }),
        { encoding: 'utf8', flag: 'wx', mode: 0o600 },
      );
      return true;
    }
  } catch {
    // Another starter may be replacing the stale launch lock.
  }
  return false;
}

function releaseLaunchLock(context) {
  try { unlinkSync(launchLockPath(context)); } catch { /* best effort */ }
}

function recoverSiblingResidentContexts(context, env) {
  const scopeDirectory = join(context.contextDir, '..');
  let sessionDirectories = [];
  try {
    sessionDirectories = readdirSync(scopeDirectory, { withFileTypes: true });
  } catch {
    return;
  }
  let started = 0;
  for (const sessionDirectory of sessionDirectories) {
    if (
      started >= 4
      || !sessionDirectory.isDirectory()
      || sessionDirectory.isSymbolicLink()
      || sessionDirectory.name === basename(context.contextDir)
    ) {
      continue;
    }
    const candidateRoot = join(scopeDirectory, sessionDirectory.name, 'inbox');
    let candidate;
    for (const phase of ['ready', 'processing']) {
      try {
        const frame = readdirSync(join(candidateRoot, phase), {
          withFileTypes: true,
        }).find(entry => (
          entry.isFile()
          && !entry.isSymbolicLink()
          && entry.name.endsWith('.frame')
        ));
        if (frame) {
          candidate = join(candidateRoot, phase, frame.name);
          break;
        }
      } catch {
        // Continue to the other durable phase.
      }
    }
    if (!candidate) continue;
    try {
      const { header } = ipc.readSpoolFrame(candidate);
      if (
        header.buildKey !== context.buildKey
        || header.scopeKey !== context.scopeKey
        || header.sessionId === context.sessionId
      ) {
        continue;
      }
      ipc.validateSessionId(header.sessionId);
      started += 1;
      void ensureSessionEndResident({
        pluginRoot: context.pluginRoot,
        directory: context.worktreeRoot,
        sessionId: header.sessionId,
        timeoutMs: 1_500,
        env,
        recoverSiblings: false,
      });
    } catch {
      // Foreign/corrupt sibling inboxes remain quarantined.
    }
  }
}

function readResidentControl(context) {
  const ready = ipc.readControl(context);
  if (ready) return ready;
  try {
    const control = ipc.readPrivateJson(
      context.controlPath,
      ipc.MAX_HEADER_BYTES,
    );
    if (
      control?.v === ipc.PROTOCOL_VERSION
      && control.buildKey === context.buildKey
      && control.scopeKey === context.scopeKey
      && control.sessionId === context.sessionId
      && control.endpoint === context.endpoint
      && ipc.SAFE_INSTANCE_ID.test(control.instanceId)
      && ipc.SAFE_HEX_64.test(control.token)
      && Number.isInteger(control.pid)
      && control.pid > 0
      && typeof control.processStartIdentity === 'string'
      && control.processStartIdentity.length > 0
      && control.state === 'draining'
    ) {
      return control;
    }
  } catch {
    // Missing or malformed control is stale.
  }
  return null;
}

async function waitForReady(context, instanceId, deadlineAt) {
  while (Date.now() < deadlineAt) {
    const control = ipc.readControl(context);
    if (control && (!instanceId || control.instanceId === instanceId)) {
      const ping = await ipc.pingResident(context, control);
      if (ping.acknowledged) return control;
    }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  return null;
}

export async function ensureSessionEndResident({
  pluginRoot,
  directory,
  sessionId,
  timeoutMs = 1_500,
  env = process.env,
  recoverSiblings = true,
} = {}) {
  if (testResidentDisabled(env)) return { status: 'disabled' };
  let context;
  try {
    context = ipc.resolveResidentContext({
      pluginRoot,
      directory,
      sessionId,
      env,
    });
    ipc.ensureRuntimeLayout(context);
  } catch {
    return { status: 'invalid-context' };
  }

  if (!hardenWindowsRuntime(context, env)) {
    return { status: 'acl-hardening-failed', context };
  }

  const deadlineAt = Date.now() + Math.max(1, Math.min(1_500, timeoutMs));
  const existing = readResidentControl(context);
  if (existing) {
    const liveness = await residentLiveness(
      context.pluginRoot,
      existing,
      Math.min(deadlineAt, Date.now() + 300),
    );
    if (liveness === 'live') {
      const ping = await ipc.pingResident(context, existing);
      if (ping.acknowledged) {
        if (recoverSiblings) recoverSiblingResidentContexts(context, env);
        return { status: 'ready', reused: true, context, control: existing };
      }
      return { status: 'live-unresponsive', context, control: existing };
    }
    if (liveness === 'unknown') {
      return { status: 'identity-unknown', context, control: existing };
    }
    cleanStaleSessionEndResident(context);
  } else if (existsSync(context.controlPath)) {
    cleanStaleSessionEndResident(context);
  }

  if (!acquireLaunchLock(context)) {
    const control = await waitForReady(context, '', deadlineAt);
    return control
      ? { status: 'ready', reused: true, context, control }
      : { status: 'start-in-progress', context };
  }

  let bootstrap;
  try {
    bootstrap = writeBootstrap(context, env);
    const residentPath = join(
      context.pluginRoot,
      'scripts',
      'session-end-resident.mjs',
    );
    if (
      basename(residentPath) !== 'session-end-resident.mjs'
      || !existsSync(residentPath)
    ) {
      throw new Error('resident entrypoint missing');
    }
    const child = spawn(
      process.execPath,
      [residentPath, '--bootstrap', bootstrap.bootstrapPath],
      {
        cwd: context.worktreeRoot,
        detached: true,
        env: residentEnvironment(env),
        stdio: 'ignore',
        windowsHide: true,
      },
    );
    child.on('error', () => {});
    child.unref();
  } catch {
    releaseLaunchLock(context);
    if (bootstrap?.bootstrapPath) {
      try { unlinkSync(bootstrap.bootstrapPath); } catch { /* best effort */ }
    }
    return { status: 'spawn-failed', context };
  }

  const control = await waitForReady(context, bootstrap.instanceId, deadlineAt);
  if (!control) {
    return { status: 'start-timeout', context, instanceId: bootstrap.instanceId };
  }
  releaseLaunchLock(context);
  if (recoverSiblings) recoverSiblingResidentContexts(context, env);
  return { status: 'ready', reused: false, context, control };
}
