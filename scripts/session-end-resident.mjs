#!/usr/bin/env node

import {
  chmodSync,
  existsSync,
  lstatSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadHookRuntime, describeHookRunFailure } from './lib/hook-runtime-loader.mjs';

const require = createRequire(import.meta.url);
const ipc = require('./lib/session-end-ipc.cjs');

const BOOTSTRAP_ARG = '--bootstrap';
const PROCESSING_RETRY_MS = 250;
const RECOVERY_SCAN_MS = 1_000;
const MANIFEST_SCAN_MS = 500;
const ADMISSION_IDLE_MS = 1_000;
const MAX_LIFETIME_MS = 12 * 60 * 60 * 1000;
const REPLAY_NONCE_LIMIT = 1_024;
const REPLAY_NONCE_TTL_MS = 60_000;
const validEnvironmentKeys = new Set([
  ...ipc.ENV_DELTA_KEYS,
  ...ipc.TEST_ENV_DELTA_KEYS,
]);

function readBootstrap() {
  const index = process.argv.indexOf(BOOTSTRAP_ARG);
  if (index < 0 || process.argv.length !== index + 2) {
    throw new Error('invalid SessionEnd resident bootstrap arguments');
  }
  const bootstrapPath = resolve(process.argv[index + 1]);
  const bootstrap = ipc.readPrivateJson(bootstrapPath, ipc.MAX_HEADER_BYTES);
  const context = ipc.resolveResidentContext({
    pluginRoot: bootstrap.pluginRoot,
    directory: bootstrap.worktreeRoot,
    sessionId: bootstrap.sessionId,
  });
  if (
    bootstrap?.v !== ipc.PROTOCOL_VERSION
    || !ipc.SAFE_INSTANCE_ID.test(bootstrap.instanceId)
    || !ipc.SAFE_HEX_64.test(bootstrap.token)
    || bootstrap.buildKey !== context.buildKey
    || bootstrap.scopeKey !== context.scopeKey
    || bootstrap.endpoint !== context.endpoint
    || bootstrap.controlPath !== context.controlPath
    || bootstrap.contextDir !== context.contextDir
    || dirname(bootstrapPath) !== context.bootstrapDir
    || basename(bootstrapPath) !== `bootstrap-${bootstrap.instanceId}.json`
  ) {
    throw new Error('SessionEnd resident bootstrap context mismatch');
  }
  try { unlinkSync(bootstrapPath); } catch { /* already consumed */ }
  return { bootstrap, context };
}

function removeSocket(endpoint) {
  if (process.platform === 'win32') return;
  try {
    const stat = lstatSync(endpoint);
    if (!stat.isSocket() || stat.isSymbolicLink()) {
      throw new Error('unsafe SessionEnd socket path');
    }
    unlinkSync(endpoint);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

function validateEnvironmentDelta(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const delta = {};
  for (const [key, entry] of Object.entries(value)) {
    if (
      !validEnvironmentKeys.has(key)
      || typeof entry !== 'string'
      || entry.length === 0
      || entry.length > 2048
    ) {
      throw new Error('invalid SessionEnd environment delta');
    }
    delta[key] = entry;
  }
  return delta;
}

async function withEnvironmentDelta(delta, operation) {
  const previous = new Map();
  for (const [key, value] of Object.entries(delta)) {
    previous.set(key, process.env[key]);
    process.env[key] = value;
  }
  try {
    return await operation();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function writeTestReceiptPath(receiptPath, data) {
  if (
    process.env.NODE_ENV !== 'test'
    || typeof receiptPath !== 'string'
    || receiptPath.length === 0
  ) {
    return;
  }
  try {
    writeFileSync(receiptPath, data, { mode: 0o600 });
  } catch {
    // Test receipts never affect resident durability.
  }
}

function writeTestReceipt(name, data) {
  writeTestReceiptPath(process.env[name], data);
}

function signedResponse(token, value) {
  const response = { v: ipc.PROTOCOL_VERSION, timestamp: Date.now(), ...value };
  response.mac = ipc.signObject(token, response);
  return response;
}

function validateCommonRequest(request, bootstrap, context, replayNonces) {
  if (
    request?.v !== ipc.PROTOCOL_VERSION
    || (request.kind !== 'event' && request.kind !== 'ping')
    || request.instanceId !== bootstrap.instanceId
    || request.buildKey !== context.buildKey
    || request.scopeKey !== context.scopeKey
    || request.sessionId !== context.sessionId
    || !ipc.isFreshTimestamp(request.timestamp)
    || typeof request.nonce !== 'string'
    || !ipc.SAFE_HEX_32.test(request.nonce)
    || !ipc.verifyObjectMac(bootstrap.token, request)
  ) {
    return false;
  }
  if (replayNonces.has(request.nonce)) return false;
  const now = Date.now();
  replayNonces.set(request.nonce, now);
  if (replayNonces.size > REPLAY_NONCE_LIMIT) {
    for (const [nonce, seenAt] of replayNonces) {
      if (
        now - seenAt > REPLAY_NONCE_TTL_MS
        || replayNonces.size > REPLAY_NONCE_LIMIT
      ) {
        replayNonces.delete(nonce);
      }
    }
  }
  return true;
}

function validateEventRequest(request, context) {
  if (
    !ipc.SAFE_HEX_64.test(request.eventId)
    || !ipc.SAFE_HEX_64.test(request.rawDigest)
    || (request.producer !== 'core' && request.producer !== 'wiki')
  ) {
    throw new Error('invalid SessionEnd event request');
  }
  ipc.validateSpoolName(request.spool);
  if (!request.spool.startsWith(`${request.eventId}-`)) {
    throw new Error('SessionEnd spool/event mismatch');
  }
  const paths = ipc.spoolPaths(context, request.spool, request.eventId);
  return {
    paths,
    envDelta: validateEnvironmentDelta(request.env),
  };
}

function frameMatchesRequest(frame, request, context) {
  const header = frame.header;
  return Boolean(
    header?.v === ipc.PROTOCOL_VERSION
    && header.eventId === request.eventId
    && header.rawDigest === request.rawDigest
    && header.producer === request.producer
    && header.sessionId === context.sessionId
    && header.scopeKey === context.scopeKey
    && header.buildKey === context.buildKey
  );
}

function readDone(paths, request) {
  try {
    const done = ipc.readPrivateJson(paths.donePath, ipc.MAX_HEADER_BYTES);
    return done?.eventId === request.eventId
      && done.rawDigest === request.rawDigest
      && done.producer === request.producer;
  } catch {
    return false;
  }
}

function readClaim(paths) {
  try {
    return ipc.readPrivateJson(paths.claimPath, ipc.MAX_HEADER_BYTES);
  } catch {
    return null;
  }
}

function claimFrame(context, request, paths, owner) {
  if (readDone(paths, request)) {
    try {
      if (existsSync(paths.readyPath)) unlinkSync(paths.readyPath);
      if (existsSync(paths.processingPath)) unlinkSync(paths.processingPath);
      if (existsSync(paths.claimPath)) unlinkSync(paths.claimPath);
    } catch {
      // The manifest/done tombstone remains authoritative.
    }
    return { status: 'done' };
  }

  if (existsSync(paths.processingPath)) {
    const frame = ipc.readSpoolFrame(paths.processingPath);
    const claim = readClaim(paths);
    if (!frameMatchesRequest(frame, request, context)) {
      throw new Error('processing SessionEnd frame mismatch');
    }
    if (
      claim
      && claim.eventId === request.eventId
      && claim.rawDigest === request.rawDigest
    ) {
      return { status: 'processing' };
    }
    throw new Error('processing SessionEnd frame has no durable claim');
  }

  const frame = ipc.readSpoolFrame(paths.readyPath);
  if (!frameMatchesRequest(frame, request, context)) {
    throw new Error('ready SessionEnd frame mismatch');
  }
  renameSync(paths.readyPath, paths.processingPath);
  ipc.fsyncDirectory(context.processingDir);
  const priorClaim = readClaim(paths);
  const attempts = Number.isInteger(priorClaim?.attempts)
    ? priorClaim.attempts + 1
    : 1;
  ipc.atomicWritePrivateJson(paths.claimPath, {
    v: ipc.PROTOCOL_VERSION,
    instanceId: owner.instanceId,
    pid: process.pid,
    processStartIdentity: owner.processStartIdentity,
    eventId: request.eventId,
    rawDigest: request.rawDigest,
    producer: request.producer,
    spool: request.spool,
    claimedAt: Date.now(),
    attempts,
  });
  return {
    status: 'claimed',
    work: {
      request,
      paths,
      envDelta: owner.envDelta,
    },
  };
}

function finishClaim(context, work, admission) {
  ipc.atomicWritePrivateJson(work.paths.donePath, {
    v: ipc.PROTOCOL_VERSION,
    eventId: work.request.eventId,
    rawDigest: work.request.rawDigest,
    producer: work.request.producer,
    sessionId: context.sessionId,
    scopeKey: context.scopeKey,
    admittedAt: Date.now(),
    manifestDirectory: admission?.directory ?? context.worktreeRoot,
    manifestSessionId: admission?.sessionId ?? context.sessionId,
  });
  try { unlinkSync(work.paths.processingPath); } catch { /* tombstone is durable */ }
  try { unlinkSync(work.paths.claimPath); } catch { /* tombstone is durable */ }
  ipc.fsyncDirectory(context.processingDir);
  ipc.pruneDoneTombstones(context);
}

function returnClaimForRetry(context, work, error) {
  const claim = readClaim(work.paths);
  try {
    ipc.atomicWritePrivateJson(work.paths.claimPath, {
      ...claim,
      failedAt: Date.now(),
      lastError: error instanceof Error ? error.message.slice(0, 500) : 'unknown',
    });
  } catch {
    // The processing frame still remains durable.
  }
  const attempts = Number.isInteger(claim?.attempts) ? claim.attempts : 1;
  if (attempts >= 3) return;
  setTimeout(() => {
    try {
      if (
        existsSync(work.paths.processingPath)
        && !existsSync(work.paths.readyPath)
      ) {
        renameSync(work.paths.processingPath, work.paths.readyPath);
        ipc.fsyncDirectory(context.readyDir);
      }
    } catch {
      // Next SessionStart can recover the durable processing frame.
    }
  }, PROCESSING_RETRY_MS).unref();
}

async function processClaim({
  context,
  work,
  runtime,
  sessionEndModule,
  workerModule,
  processStartIdentity,
  hasQueuedAdmissions,
}) {
  const frame = ipc.readSpoolFrame(work.paths.processingPath);
  if (!frameMatchesRequest(frame, work.request, context)) {
    throw new Error('claimed SessionEnd frame changed before admission');
  }
  const raw = Buffer.from(frame.raw);
  const value = JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(raw),
  );
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('claimed SessionEnd payload is not an object');
  }
  const coordinates = ipc.extractSessionEndCoordinates(value);
  if (!coordinates || coordinates.sessionId !== context.sessionId) {
    throw new Error('claimed SessionEnd payload/session mismatch');
  }
  const payloadContext = ipc.resolveResidentContext({
    pluginRoot: context.pluginRoot,
    directory: coordinates.directory,
    sessionId: coordinates.sessionId,
  });
  if (
    payloadContext.buildKey !== context.buildKey
    || payloadContext.scopeKey !== context.scopeKey
  ) {
    throw new Error('claimed SessionEnd payload/scope mismatch');
  }

  const restoreReceiptPath =
    work.envDelta.OMC_SESSION_END_TEST_ENV_RESTORE_RECEIPT;
  try {
    return await withEnvironmentDelta(work.envDelta, async () => {
      writeTestReceipt(
        'OMC_SESSION_END_TEST_ENV_RECEIPT',
        Buffer.from(JSON.stringify({
          hasRequestsCaBundle: Object.prototype.hasOwnProperty.call(
            process.env,
            'REQUESTS_CA_BUNDLE',
          ),
          requestsCaBundle: process.env.REQUESTS_CA_BUNDLE ?? null,
        })),
      );
      if (
        process.env.NODE_ENV === 'test'
        && process.env.OMC_SESSION_END_TEST_FORCE_PROCESS_FAILURE === '1'
      ) {
        throw new Error('forced SessionEnd resident processing failure');
      }
      writeTestReceipt('OMC_SESSION_END_TEST_RAW_RECEIPT', raw);
      writeTestReceipt(
        'OMC_SESSION_END_TEST_WORKER_PID_FILE',
        Buffer.from(String(process.pid)),
      );
      let admission;
      const result = await runtime.runHookPayload(
        'session-end',
        value,
        async (unit, envelope) => {
          const legacyInput = runtime.buildLegacyProcessorInput(envelope, unit);
          const input = {
            ...legacyInput,
            session_id: coordinates.sessionId,
            cwd: coordinates.directory,
            transcript_path:
              envelope.transcriptPath
              ?? legacyInput.transcript_path
              ?? legacyInput.transcriptPath
              ?? '',
            permission_mode:
              value.permission_mode
              ?? value.permissionMode
              ?? legacyInput.permission_mode
              ?? legacyInput.permissionMode
              ?? 'default',
            hook_event_name: 'SessionEnd',
            reason:
              value.reason
              ?? value.sessionEndReason
              ?? legacyInput.reason
              ?? 'other',
          };
          const event = {
            eventId: work.request.eventId,
            rawDigest: work.request.rawDigest,
          };
          admission = work.request.producer === 'core'
            ? await sessionEndModule.admitSessionEnd(input, event)
            : await sessionEndModule.admitWikiSessionEnd(input, event);
          return admission.output;
        },
      );
      const failure = describeHookRunFailure(runtime, result);
      if (failure) throw new Error(failure);
      if (!admission) throw new Error('SessionEnd admission produced no result');

      if (admission.admitted && !hasQueuedAdmissions()) {
        await workerModule.processSessionEndWorker({
          directory: admission.directory,
          sessionId: admission.sessionId,
          processStartIdentity,
        });
      }
      finishClaim(context, work, admission);
      if (!hasQueuedAdmissions()) {
        writeTestReceipt(
          'OMC_SESSION_END_TEST_WORKER_COMPLETION_FILE',
          Buffer.from(JSON.stringify({
            pid: process.pid,
            eventId: work.request.eventId,
            status: 'completed',
          })),
        );
      }
      return admission;
    });
  } finally {
    writeTestReceiptPath(
      restoreReceiptPath,
      Buffer.from(JSON.stringify({
        hasRequestsCaBundle: Object.prototype.hasOwnProperty.call(
          process.env,
          'REQUESTS_CA_BUNDLE',
        ),
        requestsCaBundle: process.env.REQUESTS_CA_BUNDLE ?? null,
      })),
    );
  }
}

async function recoverProcessing(context, processUtils, currentIdentity) {
  for (const entry of readdirSync(context.processingDir, { withFileTypes: true })) {
    if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith('.frame')) {
      continue;
    }
    const processingPath = join(context.processingDir, entry.name);
    const claimPath = `${processingPath}.claim.json`;
    let reclaim = false;
    try {
      const claim = ipc.readPrivateJson(claimPath, ipc.MAX_HEADER_BYTES);
      if (
        claim.pid === process.pid
        && claim.processStartIdentity === currentIdentity
      ) {
        reclaim = true;
      } else {
        const liveness = await processUtils.isProcessIdentityLive(
          claim.pid,
          claim.processStartIdentity,
          Date.now() + 500,
        );
        reclaim = liveness === 'dead' || liveness === 'mismatch';
      }
    } catch {
      try {
        reclaim = Date.now() - statSync(processingPath).mtimeMs >= 1_000;
      } catch {
        reclaim = false;
      }
    }
    if (!reclaim) continue;
    const readyPath = join(context.readyDir, entry.name);
    try {
      if (!existsSync(readyPath)) renameSync(processingPath, readyPath);
      else unlinkSync(processingPath);
      try { unlinkSync(claimPath); } catch { /* best effort */ }
    } catch {
      // Leave ambiguous data untouched.
    }
  }
  ipc.fsyncDirectory(context.readyDir);
}

function requestFromFrame(frame, context) {
  const { header } = frame;
  return {
    v: ipc.PROTOCOL_VERSION,
    kind: 'event',
    instanceId: '',
    buildKey: context.buildKey,
    scopeKey: context.scopeKey,
    sessionId: context.sessionId,
    eventId: header.eventId,
    rawDigest: header.rawDigest,
    producer: header.producer,
    spool: '',
    timestamp: header.createdAt,
    nonce: '',
    env: {},
  };
}

async function main() {
  const { bootstrap, context } = readBootstrap();
  ipc.ensureRuntimeLayout(context);
  const [
    processUtils,
    sessionEndModule,
    workerModule,
    cleanupManifestModule,
  ] = await Promise.all([
    import(pathToFileURL(join(context.pluginRoot, 'dist', 'platform', 'process-utils.js')).href),
    import(pathToFileURL(join(context.pluginRoot, 'dist', 'hooks', 'session-end', 'index.js')).href),
    import(pathToFileURL(join(context.pluginRoot, 'dist', 'hooks', 'session-end', 'worker.js')).href),
    import(pathToFileURL(join(context.pluginRoot, 'dist', 'hooks', 'session-end', 'cleanup-manifest.js')).href),
    import(pathToFileURL(join(context.pluginRoot, 'dist', 'hooks', 'wiki', 'session-hooks.js')).href),
  ]);
  const runtime = loadHookRuntime({ pluginRoot: context.pluginRoot });
  const processStartIdentity = await processUtils.getProcessStartIdentity(
    process.pid,
    Date.now() + 1_000,
  );
  if (!processStartIdentity) {
    throw new Error('SessionEnd resident process identity unavailable');
  }

  await recoverProcessing(context, processUtils, processStartIdentity);
  removeSocket(context.endpoint);

  const replayNonces = new Map();
  let activeConnections = 0;
  let activeWork = 0;
  let admissionTimer;
  let pendingWork = [];
  let shuttingDown = false;
  let processingQueue = Promise.resolve();
  let terminalSince;
  const startedAt = Date.now();

  const enqueue = work => {
    activeWork += 1;
    processingQueue = processingQueue
      .then(() => processClaim({
        context,
        work,
        runtime,
        sessionEndModule,
        workerModule,
        processStartIdentity,
        hasQueuedAdmissions: () => (
          activeWork > 1
          || pendingWork.length > 0
          || admissionTimer !== undefined
        ),
      }))
      .catch(error => {
        returnClaimForRetry(context, work, error);
      })
      .finally(() => {
        activeWork -= 1;
      });
  };

  const scheduleAdmission = work => {
    if (work) pendingWork.push(work);
    if (pendingWork.length === 0) return;
    clearTimeout(admissionTimer);
    admissionTimer = setTimeout(() => {
      admissionTimer = undefined;
      const readyWork = pendingWork;
      pendingWork = [];
      for (const item of readyWork) enqueue(item);
    }, ADMISSION_IDLE_MS);
  };

  const claimRecoveredReady = spoolName => {
    try {
      ipc.validateSpoolName(spoolName);
      const readyPath = join(context.readyDir, spoolName);
      const frame = ipc.readSpoolFrame(readyPath);
      const request = requestFromFrame(frame, context);
      request.spool = spoolName;
      request.instanceId = bootstrap.instanceId;
      const paths = ipc.spoolPaths(context, spoolName, request.eventId);
      const claimed = claimFrame(context, request, paths, {
        instanceId: bootstrap.instanceId,
        processStartIdentity,
        envDelta: {},
      });
      scheduleAdmission(claimed.work);
    } catch {
      // Corrupt or foreign frames remain quarantined for bounded manual review.
    }
  };

  const scanReady = () => {
    let entries = [];
    try {
      entries = readdirSync(context.readyDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.slice(0, ipc.MAX_READY_FRAMES)) {
      if (entry.isFile() && !entry.isSymbolicLink() && entry.name.endsWith('.frame')) {
        claimRecoveredReady(entry.name);
      }
    }
  };

  const server = net.createServer(socket => {
    if (shuttingDown || activeConnections >= ipc.MAX_CONNECTIONS) {
      socket.destroy();
      return;
    }
    activeConnections += 1;
    let received = Buffer.alloc(0);
    let handled = false;
    const finishConnection = () => {
      activeConnections = Math.max(0, activeConnections - 1);
    };
    socket.setTimeout(200, () => socket.destroy());
    socket.once('close', finishConnection);
    socket.once('error', () => {});
    socket.on('data', chunk => {
      if (handled) {
        socket.destroy();
        return;
      }
      received = Buffer.concat([received, Buffer.from(chunk)]);
      if (received.length > ipc.MAX_IPC_FRAME_BYTES) {
        socket.destroy();
        return;
      }
      if (received.length < 4) return;
      const bodyLength = received.readUInt32BE(0);
      const totalLength = bodyLength + 4;
      if (totalLength > ipc.MAX_IPC_FRAME_BYTES) {
        socket.destroy();
        return;
      }
      if (received.length < totalLength) return;
      if (received.length !== totalLength) {
        socket.destroy();
        return;
      }
      handled = true;
      let request;
      try {
        request = ipc.decodeIpcFrame(received);
        if (!validateCommonRequest(request, bootstrap, context, replayNonces)) {
          socket.destroy();
          return;
        }
        if (request.kind === 'ping') {
          socket.end(ipc.encodeIpcFrame(signedResponse(bootstrap.token, {
            kind: 'pong',
            instanceId: bootstrap.instanceId,
            nonce: request.nonce,
            status: 'ready',
          })));
          return;
        }
        const { paths, envDelta } = validateEventRequest(request, context);
        const claimed = claimFrame(context, request, paths, {
          instanceId: bootstrap.instanceId,
          processStartIdentity,
          envDelta,
        });
        if (
          process.env.NODE_ENV === 'test'
          && envDelta.OMC_SESSION_END_TEST_CRASH_AFTER_CLAIM === 'before-ack'
        ) {
          process.exit(91);
        }
        const ack = signedResponse(bootstrap.token, {
          kind: 'ack',
          instanceId: bootstrap.instanceId,
          nonce: request.nonce,
          eventId: request.eventId,
          status: claimed.status,
        });
        const delay = process.env.NODE_ENV === 'test'
          ? Number(envDelta.OMC_SESSION_END_TEST_ACK_DELAY_MS ?? 0)
          : 0;
        const sendAck = () => {
          socket.end(ipc.encodeIpcFrame(ack));
          scheduleAdmission(claimed.work);
          if (
            process.env.NODE_ENV === 'test'
            && envDelta.OMC_SESSION_END_TEST_CRASH_AFTER_CLAIM === 'after-ack'
          ) {
            setImmediate(() => process.exit(92));
          }
        };
        if (Number.isFinite(delay) && delay > 0) setTimeout(sendAck, delay);
        else sendAck();
      } catch {
        socket.destroy();
      }
    });
  });
  server.maxConnections = ipc.MAX_CONNECTIONS;

  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(context.endpoint, () => {
      server.off('error', rejectListen);
      resolveListen();
    });
  });
  if (process.platform !== 'win32') chmodSync(context.endpoint, 0o600);

  const control = {
    v: ipc.PROTOCOL_VERSION,
    state: 'ready',
    instanceId: bootstrap.instanceId,
    token: bootstrap.token,
    buildKey: context.buildKey,
    scopeKey: context.scopeKey,
    sessionId: context.sessionId,
    pluginRoot: context.pluginRoot,
    worktreeRoot: context.worktreeRoot,
    endpoint: context.endpoint,
    pid: process.pid,
    processStartIdentity,
    startedAt,
  };
  ipc.atomicWritePrivateJson(context.controlPath, control);
  try { unlinkSync(join(context.contextDir, 'launch.lock')); } catch { /* best effort */ }

  const recoveryTimer = setInterval(() => {
    scanReady();
    if (
      activeWork === 0
      && pendingWork.length === 0
      && admissionTimer === undefined
    ) {
      void workerModule.reconcileSessionEndJobsInProcess?.(
        context.worktreeRoot,
        undefined,
        processStartIdentity,
      );
    }
  }, RECOVERY_SCAN_MS);
  const manifestTimer = setInterval(() => {
    const job = cleanupManifestModule.readSessionEndJob(
      context.worktreeRoot,
      context.sessionId,
    );
    let inboxEmpty = false;
    try {
      inboxEmpty = readdirSync(context.readyDir).length === 0
        && readdirSync(context.processingDir)
          .filter(name => name.endsWith('.frame')).length === 0;
    } catch {
      inboxEmpty = false;
    }
    if (job?.phase === 'complete' && inboxEmpty && activeWork === 0) {
      terminalSince ??= Date.now();
      const keepResidentMs = process.env.NODE_ENV === 'test'
        ? Number(process.env.OMC_SESSION_END_TEST_KEEP_RESIDENT_MS ?? 0)
        : 0;
      if (Date.now() - terminalSince >= Math.max(250, keepResidentMs || 0)) {
        void shutdown();
      }
    } else {
      terminalSince = undefined;
    }
    if (
      Date.now() - startedAt >= MAX_LIFETIME_MS
      && activeWork === 0
      && pendingWork.length === 0
    ) {
      void shutdown();
    }
  }, MANIFEST_SCAN_MS);

  async function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    clearTimeout(admissionTimer);
    clearInterval(recoveryTimer);
    clearInterval(manifestTimer);
    try {
      ipc.atomicWritePrivateJson(context.controlPath, {
        ...control,
        state: 'draining',
        drainingAt: Date.now(),
      });
    } catch {
      // Clients will fail authentication/connection and retain their spools.
    }
    await new Promise(resolveClose => server.close(resolveClose));
    await Promise.race([
      processingQueue,
      new Promise(resolveWait => setTimeout(resolveWait, 5_000)),
    ]);
    removeSocket(context.endpoint);
    try {
      const current = ipc.readPrivateJson(context.controlPath, ipc.MAX_HEADER_BYTES);
      if (current?.instanceId === bootstrap.instanceId) unlinkSync(context.controlPath);
    } catch {
      // Missing or replaced control is not ours to remove.
    }
    ipc.pruneDoneTombstones(context);
  }

  process.once('SIGTERM', () => { void shutdown(); });
  process.once('SIGINT', () => { void shutdown(); });
  process.once('beforeExit', () => { removeSocket(context.endpoint); });

  scanReady();
  if (
    activeWork === 0
    && pendingWork.length === 0
    && admissionTimer === undefined
  ) {
    void workerModule.reconcileSessionEndJobsInProcess?.(
      context.worktreeRoot,
      undefined,
      processStartIdentity,
    );
  }
}

void main().catch(() => {
  process.exitCode = 0;
});
