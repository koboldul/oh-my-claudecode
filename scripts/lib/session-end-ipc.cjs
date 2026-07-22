#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

const PROTOCOL_VERSION = 2;
const MAX_RAW_BYTES = 64 * 1024;
const MAX_HEADER_BYTES = 4 * 1024;
const MAX_SPOOL_BYTES = MAX_RAW_BYTES + MAX_HEADER_BYTES + 16;
const MAX_IPC_FRAME_BYTES = 4 * 1024;
const MAX_READY_FRAMES = 128;
const MAX_INBOX_BYTES = 12 * 1024 * 1024;
const MAX_CONNECTIONS = 16;
const CONNECT_TIMEOUT_MS = 25;
const ACK_TIMEOUT_MS = 75;
const REQUEST_CLOCK_SKEW_MS = 30_000;
const DONE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_DONE_TOMBSTONES = 256;
const FRAME_MAGIC = Buffer.from('OMCSE2\0\0', 'ascii');
const SAFE_SESSION_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,255}$/;
const SAFE_HEX_32 = /^[a-f0-9]{32}$/;
const SAFE_HEX_64 = /^[a-f0-9]{64}$/;
const SAFE_INSTANCE_ID = /^[a-f0-9]{32}$/;
const SAFE_SPOOL_NAME = /^[a-f0-9]{64}-[a-f0-9]{16}\.frame$/;
const SAFE_CLAIM_NAME = /^[a-f0-9]{64}-[a-f0-9]{16}\.frame\.claim\.json$/;

const ENV_DELTA_KEYS = Object.freeze([
  'CLAUDE_CONFIG_DIR',
  'HOME',
  'USERPROFILE',
  'OMC_NOTIFY',
  'OMC_NOTIFY_PROFILE',
  'OMC_HOOK_CONFIG',
  'OMC_CONFIG_PATH',
  'OMC_TELEGRAM',
  'OMC_DISCORD',
  'OMC_SLACK',
  'OMC_WEBHOOK',
  'OMC_DISCORD_MENTION',
  'OMC_DISCORD_NOTIFIER_BOT_TOKEN',
  'OMC_DISCORD_NOTIFIER_CHANNEL',
  'OMC_DISCORD_WEBHOOK_URL',
  'OMC_TELEGRAM_BOT_TOKEN',
  'OMC_TELEGRAM_NOTIFIER_BOT_TOKEN',
  'OMC_TELEGRAM_CHAT_ID',
  'OMC_TELEGRAM_NOTIFIER_CHAT_ID',
  'OMC_TELEGRAM_NOTIFIER_UID',
  'OMC_SLACK_WEBHOOK_URL',
  'OMC_SLACK_MENTION',
  'OMC_SLACK_BOT_TOKEN',
  'OMC_SLACK_APP_TOKEN',
  'OMC_SLACK_BOT_CHANNEL',
  'OMC_OPENCLAW',
  'OMC_OPENCLAW_CONFIG',
  'OPENCLAW_REPLY_CHANNEL',
  'OPENCLAW_REPLY_TARGET',
  'OPENCLAW_REPLY_THREAD',
  'TMUX',
  'TMUX_PANE',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'all_proxy',
  'no_proxy',
  'NODE_EXTRA_CA_CERTS',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'REQUESTS_CA_BUNDLE',
  'CURL_CA_BUNDLE',
]);

const TEST_ENV_DELTA_KEYS = Object.freeze([
  'OMC_SESSION_END_TEST_PRODUCER_GRACE_MS',
  'OMC_SESSION_END_TEST_WORKER_COMPLETION_FILE',
  'OMC_SESSION_END_TEST_WORKER_PID_FILE',
  'OMC_SESSION_END_TEST_RAW_RECEIPT',
  'OMC_SESSION_END_TEST_SPOOL_RECEIPT',
  'OMC_SESSION_END_TEST_IPC_RECEIPT',
  'OMC_SESSION_END_TEST_ACK_DELAY_MS',
  'OMC_SESSION_END_TEST_CRASH_AFTER_CLAIM',
  'OMC_SESSION_END_TEST_ENV_RECEIPT',
  'OMC_SESSION_END_TEST_ENV_RESTORE_RECEIPT',
  'OMC_SESSION_END_TEST_FORCE_PROCESS_FAILURE',
  'OMC_SESSION_END_TEST_KEEP_RESIDENT_MS',
]);

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function canonicalPath(value) {
  let resolved = path.resolve(value);
  try {
    resolved = fs.realpathSync.native
      ? fs.realpathSync.native(resolved)
      : fs.realpathSync(resolved);
  } catch {
    // A future inbox can be derived before the worktree is fully materialized.
  }
  return process.platform === 'win32'
    ? path.win32.normalize(resolved).toLowerCase()
    : path.normalize(resolved);
}

function findWorktreeScope(directory) {
  let cursor = canonicalPath(directory);
  while (true) {
    try {
      if (
        fs.existsSync(path.join(cursor, '.git'))
        || fs.existsSync(path.join(cursor, '.omc-workspace'))
      ) {
        return cursor;
      }
    } catch {
      break;
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return canonicalPath(directory);
}

function fileBuildSignature(file) {
  try {
    const stat = fs.statSync(file, { bigint: true });
    return `${file}:${stat.size}:${stat.mtimeNs}`;
  } catch {
    return `${file}:missing`;
  }
}

function pluginBuildKey(pluginRoot) {
  const canonicalRoot = canonicalPath(pluginRoot);
  let version = 'unknown';
  try {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(canonicalRoot, 'package.json'), 'utf8'),
    );
    if (typeof packageJson.version === 'string') version = packageJson.version;
  } catch {
    // File signatures below still prevent cross-root resident reuse.
  }
  const signatures = [
    path.join(canonicalRoot, 'bridge', 'hook-runtime.cjs'),
    path.join(canonicalRoot, 'dist', 'hooks', 'session-end', 'index.js'),
    path.join(canonicalRoot, 'dist', 'hooks', 'session-end', 'worker.js'),
    path.join(canonicalRoot, 'dist', 'hooks', 'wiki', 'session-hooks.js'),
  ].map(fileBuildSignature);
  return sha256([canonicalRoot, version, ...signatures].join('\0'));
}

function sessionEndScopeKey(directory) {
  return sha256(findWorktreeScope(directory));
}

function runtimeRoot(env = process.env) {
  if (process.platform === 'win32') {
    const localAppData = env.LOCALAPPDATA || path.join(os.tmpdir(), 'localappdata');
    return path.join(localAppData, 'oh-my-claudecode', 'session-end', 'v2');
  }
  const uid = typeof process.getuid === 'function' ? process.getuid() : 'user';
  const temporaryRoot = env.XDG_RUNTIME_DIR
    || env.TMPDIR
    || env.TMP
    || env.TEMP
    || os.tmpdir();
  return path.join(temporaryRoot, `omc-session-end-${uid}`, 'v2');
}

function validateSessionId(sessionId) {
  if (typeof sessionId !== 'string' || !SAFE_SESSION_ID.test(sessionId)) {
    throw new Error('invalid SessionEnd session id');
  }
  return sessionId;
}

function resolveResidentContext({
  pluginRoot,
  directory,
  sessionId,
  env = process.env,
}) {
  validateSessionId(sessionId);
  const canonicalPluginRoot = canonicalPath(pluginRoot);
  const worktreeRoot = findWorktreeScope(directory);
  const buildKey = pluginBuildKey(canonicalPluginRoot);
  const scopeKey = sessionEndScopeKey(worktreeRoot);
  const sessionKey = sha256(sessionId);
  const root = runtimeRoot(env);
  const contextDir = path.join(
    root,
    'instances',
    buildKey.slice(0, 32),
    scopeKey.slice(0, 32),
    sessionKey.slice(0, 32),
  );
  const endpointKey = sha256(
    [buildKey, scopeKey, sessionId].join('\0'),
  ).slice(0, 40);
  const endpoint = process.platform === 'win32'
    ? `\\\\.\\pipe\\omc-session-end-v2-${endpointKey}`
    : path.join(root, 'sockets', `${endpointKey}.sock`);
  const inboxDir = path.join(contextDir, 'inbox');
  return Object.freeze({
    version: PROTOCOL_VERSION,
    pluginRoot: canonicalPluginRoot,
    worktreeRoot,
    sessionId,
    sessionKey,
    buildKey,
    scopeKey,
    root,
    contextDir,
    endpoint,
    controlPath: path.join(contextDir, 'control.json'),
    bootstrapDir: path.join(contextDir, 'bootstrap'),
    inboxDir,
    readyDir: path.join(inboxDir, 'ready'),
    processingDir: path.join(inboxDir, 'processing'),
    doneDir: path.join(inboxDir, 'done'),
    tempDir: path.join(inboxDir, 'tmp'),
  });
}

function assertPrivateDirectory(directory) {
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`unsafe SessionEnd runtime directory: ${directory}`);
  }
  if (process.platform !== 'win32') {
    if (
      typeof process.getuid === 'function'
      && typeof stat.uid === 'number'
      && stat.uid !== process.getuid()
    ) {
      throw new Error(`SessionEnd runtime directory is not user-owned: ${directory}`);
    }
    if ((stat.mode & 0o077) !== 0) fs.chmodSync(directory, 0o700);
  }
}

function ensurePrivateDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  assertPrivateDirectory(directory);
}

function ensureRuntimeLayout(context) {
  for (const directory of [
    context.root,
    path.join(context.root, 'instances'),
    path.join(context.root, 'sockets'),
    context.contextDir,
    context.bootstrapDir,
    context.inboxDir,
    context.readyDir,
    context.processingDir,
    context.doneDir,
    context.tempDir,
  ]) {
    ensurePrivateDirectory(directory);
  }
}

function assertPrivateRegularFile(file, maxBytes = Number.POSITIVE_INFINITY) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxBytes) {
    throw new Error(`unsafe SessionEnd runtime file: ${file}`);
  }
  if (process.platform !== 'win32') {
    if (
      typeof process.getuid === 'function'
      && typeof stat.uid === 'number'
      && stat.uid !== process.getuid()
    ) {
      throw new Error(`SessionEnd runtime file is not user-owned: ${file}`);
    }
    if ((stat.mode & 0o077) !== 0) {
      throw new Error(`SessionEnd runtime file is not private: ${file}`);
    }
  }
  return stat;
}

function fsyncDirectory(directory) {
  let fd;
  try {
    fd = fs.openSync(directory, fs.constants.O_RDONLY);
    fs.fsyncSync(fd);
  } catch {
    // Directory fsync is unsupported on some Windows/filesystem combinations.
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* best effort */ }
    }
  }
}

function writeAll(fd, bytes) {
  let offset = 0;
  while (offset < bytes.length) {
    const written = fs.writeSync(fd, bytes, offset, bytes.length - offset);
    if (!Number.isInteger(written) || written <= 0) {
      throw new Error('SessionEnd durable write made no progress');
    }
    offset += written;
  }
}

function atomicWritePrivateFile(file, bytes) {
  ensurePrivateDirectory(path.dirname(file));
  const temporary = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${crypto.randomBytes(12).toString('hex')}.tmp`,
  );
  let fd;
  let renamed = false;
  try {
    fd = fs.openSync(
      temporary,
      fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY,
      0o600,
    );
    writeAll(fd, bytes);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(temporary, file);
    renamed = true;
    fsyncDirectory(path.dirname(file));
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* best effort */ }
    }
    if (!renamed) {
      try { fs.unlinkSync(temporary); } catch { /* best effort */ }
    }
  }
}

function atomicWritePrivateJson(file, value) {
  atomicWritePrivateFile(file, Buffer.from(JSON.stringify(value), 'utf8'));
}

function readPrivateJson(file, maxBytes = MAX_HEADER_BYTES) {
  assertPrivateRegularFile(file, maxBytes);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .filter(key => key !== 'mac')
        .sort()
        .map(key => [key, stableValue(value[key])]),
    );
  }
  return value;
}

function signingPayload(value) {
  return JSON.stringify(stableValue(value));
}

function signObject(tokenHex, value) {
  if (!SAFE_HEX_64.test(tokenHex)) throw new Error('invalid SessionEnd IPC token');
  return crypto
    .createHmac('sha256', Buffer.from(tokenHex, 'hex'))
    .update(signingPayload(value))
    .digest('hex');
}

function verifyObjectMac(tokenHex, value) {
  if (!value || typeof value.mac !== 'string' || !SAFE_HEX_64.test(value.mac)) {
    return false;
  }
  let expected;
  try {
    expected = signObject(tokenHex, value);
  } catch {
    return false;
  }
  return crypto.timingSafeEqual(
    Buffer.from(expected, 'hex'),
    Buffer.from(value.mac, 'hex'),
  );
}

function encodeIpcFrame(value) {
  const body = Buffer.from(JSON.stringify(value), 'utf8');
  if (body.length + 4 > MAX_IPC_FRAME_BYTES) {
    throw new Error('SessionEnd IPC request exceeds 4KiB');
  }
  const frame = Buffer.allocUnsafe(body.length + 4);
  frame.writeUInt32BE(body.length, 0);
  body.copy(frame, 4);
  return frame;
}

function decodeIpcFrame(frame) {
  if (!Buffer.isBuffer(frame) || frame.length < 4 || frame.length > MAX_IPC_FRAME_BYTES) {
    throw new Error('invalid SessionEnd IPC frame length');
  }
  const bodyLength = frame.readUInt32BE(0);
  if (bodyLength < 2 || bodyLength + 4 !== frame.length) {
    throw new Error('invalid SessionEnd IPC frame boundary');
  }
  const value = JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(frame.subarray(4)),
  );
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('SessionEnd IPC frame is not an object');
  }
  return value;
}

function encodeSpoolFrame(header, raw) {
  if (!Buffer.isBuffer(raw) || raw.length < 1 || raw.length > MAX_RAW_BYTES) {
    throw new Error('invalid SessionEnd raw capture size');
  }
  const headerBytes = Buffer.from(JSON.stringify(header), 'utf8');
  if (headerBytes.length < 2 || headerBytes.length > MAX_HEADER_BYTES) {
    throw new Error('invalid SessionEnd spool header size');
  }
  const frame = Buffer.allocUnsafe(16 + headerBytes.length + raw.length);
  FRAME_MAGIC.copy(frame, 0);
  frame.writeUInt32BE(headerBytes.length, 8);
  frame.writeUInt32BE(raw.length, 12);
  headerBytes.copy(frame, 16);
  raw.copy(frame, 16 + headerBytes.length);
  return frame;
}

function decodeSpoolFrame(frame) {
  if (
    !Buffer.isBuffer(frame)
    || frame.length < 18
    || frame.length > MAX_SPOOL_BYTES
    || !frame.subarray(0, 8).equals(FRAME_MAGIC)
  ) {
    throw new Error('invalid SessionEnd spool frame');
  }
  const headerLength = frame.readUInt32BE(8);
  const rawLength = frame.readUInt32BE(12);
  if (
    headerLength < 2
    || headerLength > MAX_HEADER_BYTES
    || rawLength < 1
    || rawLength > MAX_RAW_BYTES
    || 16 + headerLength + rawLength !== frame.length
  ) {
    throw new Error('invalid SessionEnd spool frame boundary');
  }
  const header = JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(
      frame.subarray(16, 16 + headerLength),
    ),
  );
  if (!header || typeof header !== 'object' || Array.isArray(header)) {
    throw new Error('invalid SessionEnd spool header');
  }
  const raw = frame.subarray(16 + headerLength);
  if (sha256(raw) !== header.rawDigest) {
    throw new Error('SessionEnd spool digest mismatch');
  }
  return { header, raw };
}

function inboxUsage(context) {
  let files = 0;
  const candidates = [];
  let exactBytesRequired = false;
  for (const [directory, isValidName] of [
    [context.readyDir, name => SAFE_SPOOL_NAME.test(name)],
    [
      context.processingDir,
      name => SAFE_SPOOL_NAME.test(name) || SAFE_CLAIM_NAME.test(name),
    ],
  ]) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isFile() || entry.isSymbolicLink()) continue;
      files += 1;
      candidates.push(path.join(directory, entry.name));
      if (!isValidName(entry.name)) exactBytesRequired = true;
    }
  }

  // Every valid durable artifact is bounded by MAX_SPOOL_BYTES, so below this
  // conservative ceiling the byte quota cannot be exceeded. Avoid O(n) stat
  // calls on the foreground path while a resident is batching many claims.
  if (
    !exactBytesRequired
    && files * MAX_SPOOL_BYTES + MAX_RAW_BYTES <= MAX_INBOX_BYTES
  ) {
    return { files, bytes: files * MAX_SPOOL_BYTES };
  }

  let bytes = 0;
  for (const file of candidates) bytes += fs.statSync(file).size;
  return { files, bytes };
}

function pruneDoneTombstones(context, now = Date.now()) {
  let entries;
  try {
    entries = fs.readdirSync(context.doneDir, { withFileTypes: true })
      .filter(entry => entry.isFile() && !entry.isSymbolicLink())
      .map(entry => {
        const file = path.join(context.doneDir, entry.name);
        const stat = fs.statSync(file);
        return { file, mtimeMs: stat.mtimeMs };
      })
      .sort((left, right) => right.mtimeMs - left.mtimeMs);
  } catch {
    return;
  }
  entries.forEach((entry, index) => {
    if (index < MAX_DONE_TOMBSTONES && now - entry.mtimeMs <= DONE_TTL_MS) return;
    try { fs.unlinkSync(entry.file); } catch { /* best effort */ }
  });
}

function publishSessionEndFrame(context, {
  producer,
  raw,
  host,
  env = process.env,
  runtimeReady = false,
}) {
  if (producer !== 'core' && producer !== 'wiki') {
    throw new Error('invalid SessionEnd producer');
  }
  if (runtimeReady) {
    assertPrivateDirectory(context.readyDir);
    assertPrivateDirectory(context.processingDir);
    assertPrivateDirectory(context.tempDir);
  } else {
    ensureRuntimeLayout(context);
  }
  const usage = inboxUsage(context);
  if (usage.files >= MAX_READY_FRAMES || usage.bytes + raw.length > MAX_INBOX_BYTES) {
    throw new Error('SessionEnd durable inbox is full');
  }

  const rawDigest = sha256(raw);
  const eventId = sha256([
    context.buildKey,
    context.scopeKey,
    context.sessionId,
    producer,
    rawDigest,
  ].join('\0'));
  const createdAt = Date.now();
  const header = {
    v: PROTOCOL_VERSION,
    eventId,
    rawDigest,
    producer,
    sessionId: context.sessionId,
    scopeKey: context.scopeKey,
    buildKey: context.buildKey,
    createdAt,
    host: host === 'copilot' ? 'copilot' : 'claude',
  };
  const frame = encodeSpoolFrame(header, raw);
  const spoolName = `${eventId}-${crypto.randomBytes(8).toString('hex')}.frame`;
  const temporary = path.join(
    context.tempDir,
    `.${spoolName}.${crypto.randomBytes(8).toString('hex')}.tmp`,
  );
  const readyPath = path.join(context.readyDir, spoolName);
  let fd;
  let renamed = false;
  try {
    fd = fs.openSync(
      temporary,
      fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY,
      0o600,
    );
    writeAll(fd, frame);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(temporary, readyPath);
    renamed = true;
    fsyncDirectory(context.readyDir);
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* best effort */ }
    }
    if (!renamed) {
      try { fs.unlinkSync(temporary); } catch { /* best effort */ }
    }
  }

  if (
    env.NODE_ENV === 'test'
    && typeof env.OMC_SESSION_END_TEST_SPOOL_RECEIPT === 'string'
    && env.OMC_SESSION_END_TEST_SPOOL_RECEIPT.length > 0
  ) {
    try {
      fs.writeFileSync(
        env.OMC_SESSION_END_TEST_SPOOL_RECEIPT,
        readyPath,
        { encoding: 'utf8', mode: 0o600 },
      );
    } catch {
      // Test receipts do not participate in durability.
    }
  }

  return Object.freeze({
    eventId,
    rawDigest,
    spoolName,
    readyPath,
    createdAt,
    producer,
  });
}

function validateSpoolName(spoolName) {
  if (
    typeof spoolName !== 'string'
    || !SAFE_SPOOL_NAME.test(spoolName)
    || path.basename(spoolName) !== spoolName
  ) {
    throw new Error('invalid SessionEnd spool name');
  }
  return spoolName;
}

function spoolPaths(context, spoolName, eventId) {
  validateSpoolName(spoolName);
  if (!SAFE_HEX_64.test(eventId)) throw new Error('invalid SessionEnd event id');
  return {
    readyPath: path.join(context.readyDir, spoolName),
    processingPath: path.join(context.processingDir, spoolName),
    claimPath: path.join(context.processingDir, `${spoolName}.claim.json`),
    donePath: path.join(context.doneDir, `${eventId}.json`),
  };
}

function readSpoolFrame(file) {
  assertPrivateRegularFile(file, MAX_SPOOL_BYTES);
  const fd = fs.openSync(
    file,
    fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0),
  );
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size < 18 || stat.size > MAX_SPOOL_BYTES) {
      throw new Error('invalid SessionEnd spool file');
    }
    return decodeSpoolFrame(fs.readFileSync(fd));
  } finally {
    fs.closeSync(fd);
  }
}

function readControl(context) {
  try {
    const control = readPrivateJson(context.controlPath, MAX_HEADER_BYTES);
    if (
      control?.v !== PROTOCOL_VERSION
      || control.buildKey !== context.buildKey
      || control.scopeKey !== context.scopeKey
      || control.sessionId !== context.sessionId
      || control.endpoint !== context.endpoint
      || !SAFE_INSTANCE_ID.test(control.instanceId)
      || !SAFE_HEX_64.test(control.token)
      || !Number.isInteger(control.pid)
      || control.pid <= 0
      || typeof control.processStartIdentity !== 'string'
      || control.processStartIdentity.length === 0
      || control.state !== 'ready'
    ) {
      return null;
    }
    return control;
  } catch {
    return null;
  }
}

function collectEnvironmentDelta(env) {
  const keys = env.NODE_ENV === 'test'
    ? [...ENV_DELTA_KEYS, ...TEST_ENV_DELTA_KEYS]
    : ENV_DELTA_KEYS;
  const delta = {};
  for (const key of keys) {
    const value = env[key];
    if (typeof value !== 'string' || value.length === 0 || value.length > 2048) {
      continue;
    }
    delta[key] = value;
  }
  return delta;
}

function buildSignedRequest(control, context, published, env = process.env) {
  const base = {
    v: PROTOCOL_VERSION,
    kind: 'event',
    instanceId: control.instanceId,
    buildKey: context.buildKey,
    scopeKey: context.scopeKey,
    sessionId: context.sessionId,
    eventId: published.eventId,
    rawDigest: published.rawDigest,
    producer: published.producer,
    spool: published.spoolName,
    timestamp: Date.now(),
    nonce: crypto.randomBytes(16).toString('hex'),
    env: {},
  };
  for (const [key, value] of Object.entries(collectEnvironmentDelta(env))) {
    const candidate = { ...base, env: { ...base.env, [key]: value } };
    candidate.mac = signObject(control.token, candidate);
    try {
      encodeIpcFrame(candidate);
      base.env[key] = value;
    } catch {
      // Keep the authenticated request within the mandatory single-frame cap.
    }
  }
  base.mac = signObject(control.token, base);
  encodeIpcFrame(base);
  return base;
}

function buildSignedPing(control, context) {
  const request = {
    v: PROTOCOL_VERSION,
    kind: 'ping',
    instanceId: control.instanceId,
    buildKey: context.buildKey,
    scopeKey: context.scopeKey,
    sessionId: context.sessionId,
    timestamp: Date.now(),
    nonce: crypto.randomBytes(16).toString('hex'),
  };
  request.mac = signObject(control.token, request);
  return request;
}

function verifyAck(control, request, ack) {
  return Boolean(
    ack
    && ack.v === PROTOCOL_VERSION
    && ack.instanceId === control.instanceId
    && ack.nonce === request.nonce
    && ack.kind === (request.kind === 'ping' ? 'pong' : 'ack')
    && (request.kind === 'ping' || ack.eventId === request.eventId)
    && typeof ack.timestamp === 'number'
    && Math.abs(Date.now() - ack.timestamp) <= REQUEST_CLOCK_SKEW_MS
    && verifyObjectMac(control.token, ack)
  );
}

function exchange(control, request, {
  connectTimeoutMs = CONNECT_TIMEOUT_MS,
  ackTimeoutMs = ACK_TIMEOUT_MS,
} = {}) {
  return new Promise(resolve => {
    const startedAt = Date.now();
    let connectedAt;
    let settled = false;
    let connectTimer;
    let ackTimer;
    let received = Buffer.alloc(0);
    const socket = net.createConnection(control.endpoint);
    socket.unref();

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(connectTimer);
      clearTimeout(ackTimer);
      socket.removeAllListeners();
      socket.destroy();
      resolve({
        acknowledged: false,
        connectMs: connectedAt === undefined ? undefined : connectedAt - startedAt,
        ackMs: connectedAt === undefined ? undefined : Date.now() - connectedAt,
        totalMs: Date.now() - startedAt,
        ...result,
      });
    };

    connectTimer = setTimeout(
      () => finish({ code: 'connect-timeout' }),
      connectTimeoutMs,
    );
    socket.once('connect', () => {
      connectedAt = Date.now();
      clearTimeout(connectTimer);
      try {
        socket.write(encodeIpcFrame(request));
      } catch {
        finish({ code: 'request-encode-failed' });
        return;
      }
      ackTimer = setTimeout(
        () => finish({ code: 'ack-timeout' }),
        ackTimeoutMs,
      );
    });
    socket.on('data', chunk => {
      received = Buffer.concat([received, Buffer.from(chunk)]);
      if (received.length > MAX_IPC_FRAME_BYTES) {
        finish({ code: 'oversize-ack' });
        return;
      }
      if (received.length < 4) return;
      const bodyLength = received.readUInt32BE(0);
      const totalLength = bodyLength + 4;
      if (totalLength > MAX_IPC_FRAME_BYTES) {
        finish({ code: 'oversize-ack' });
        return;
      }
      if (received.length < totalLength) return;
      if (received.length !== totalLength) {
        finish({ code: 'multi-frame-ack' });
        return;
      }
      let ack;
      try {
        ack = decodeIpcFrame(received);
      } catch {
        finish({ code: 'invalid-ack' });
        return;
      }
      if (!verifyAck(control, request, ack)) {
        finish({ code: 'unauthenticated-ack' });
        return;
      }
      finish({
        acknowledged: true,
        code: ack.status || 'ok',
        ack,
      });
    });
    socket.once('error', error => {
      finish({ code: error?.code || 'socket-error' });
    });
    socket.once('close', () => {
      if (!settled) finish({ code: 'connection-closed' });
    });
  });
}

async function notifyResident(context, control, published, env = process.env) {
  const request = buildSignedRequest(control, context, published, env);
  return exchange(control, request);
}

async function pingResident(context, control) {
  return exchange(control, buildSignedPing(control, context));
}

function extractSessionEndCoordinates(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const sessionId = typeof value.session_id === 'string'
    ? value.session_id
    : typeof value.sessionId === 'string'
      ? value.sessionId
      : null;
  const directory = typeof value.cwd === 'string'
    ? value.cwd
    : typeof value.directory === 'string'
      ? value.directory
      : null;
  if (!sessionId || !directory) return null;
  try {
    validateSessionId(sessionId);
    return { sessionId, directory };
  } catch {
    return null;
  }
}

function isFreshTimestamp(timestamp, now = Date.now()) {
  return Number.isFinite(timestamp)
    && Math.abs(now - timestamp) <= REQUEST_CLOCK_SKEW_MS;
}

module.exports = {
  ACK_TIMEOUT_MS,
  CONNECT_TIMEOUT_MS,
  DONE_TTL_MS,
  ENV_DELTA_KEYS,
  MAX_CONNECTIONS,
  MAX_DONE_TOMBSTONES,
  MAX_HEADER_BYTES,
  MAX_INBOX_BYTES,
  MAX_IPC_FRAME_BYTES,
  MAX_RAW_BYTES,
  MAX_READY_FRAMES,
  MAX_SPOOL_BYTES,
  PROTOCOL_VERSION,
  REQUEST_CLOCK_SKEW_MS,
  SAFE_HEX_32,
  SAFE_HEX_64,
  SAFE_INSTANCE_ID,
  TEST_ENV_DELTA_KEYS,
  atomicWritePrivateFile,
  atomicWritePrivateJson,
  buildSignedPing,
  buildSignedRequest,
  collectEnvironmentDelta,
  decodeIpcFrame,
  decodeSpoolFrame,
  encodeIpcFrame,
  encodeSpoolFrame,
  ensurePrivateDirectory,
  ensureRuntimeLayout,
  exchange,
  extractSessionEndCoordinates,
  fsyncDirectory,
  inboxUsage,
  isFreshTimestamp,
  notifyResident,
  pingResident,
  pluginBuildKey,
  pruneDoneTombstones,
  publishSessionEndFrame,
  readControl,
  readPrivateJson,
  readSpoolFrame,
  resolveResidentContext,
  runtimeRoot,
  sessionEndScopeKey,
  sha256,
  signObject,
  spoolPaths,
  stableValue,
  validateSessionId,
  validateSpoolName,
  verifyObjectMac,
};
