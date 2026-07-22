#!/usr/bin/env node
'use strict';

const {
  appendFileSync,
  closeSync,
  fstatSync,
  readFileSync,
  realpathSync,
  unlinkSync,
} = require('fs');
const { tmpdir } = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const WORKER_ARG = '--omc-session-end-envelope-worker';
const CAPTURE_SYMBOL = Symbol.for('omc.session-end.captured-envelope');
const MAX_INPUT_BYTES = 64 * 1024;

function comparisonPath(value) {
  const normalized = path.resolve(value);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function validateTarget(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096) {
    throw new Error('invalid canonical SessionEnd target');
  }
  const targetPath = path.resolve(realpathSync(value));
  const scriptName = path.basename(targetPath);
  if (scriptName !== 'session-end.mjs' && scriptName !== 'wiki-session-end.mjs') {
    throw new Error('unexpected canonical SessionEnd target');
  }
  return targetPath;
}

function validateSpoolPath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096) {
    throw new Error('invalid SessionEnd spool path');
  }
  const spoolPath = path.resolve(value);
  if (
    comparisonPath(path.dirname(spoolPath)) !== comparisonPath(tmpdir())
    || !path.basename(spoolPath).startsWith('.omc-session-end-')
  ) {
    throw new Error('SessionEnd spool path is outside the private temp namespace');
  }
  return spoolPath;
}

function readEnvelope(fd) {
  const stat = fstatSync(fd);
  if (!stat.isFile() || stat.size < 1 || stat.size > MAX_INPUT_BYTES) {
    throw new Error('invalid SessionEnd spool size');
  }
  if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) {
    throw new Error('SessionEnd spool permissions are not private');
  }
  const raw = readFileSync(fd);
  if (raw.length !== stat.size) {
    throw new Error('SessionEnd spool changed while being captured');
  }
  const input = new TextDecoder('utf-8', { fatal: true }).decode(raw);
  const value = JSON.parse(input);
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('SessionEnd spool did not contain a JSON object');
  }
  return { raw, value };
}

function removeSpool(spoolPath) {
  try { unlinkSync(spoolPath); } catch { /* already removed */ }
}

function diagnosticPath(spoolPath) {
  let expected;
  try {
    expected = `${validateSpoolPath(spoolPath)}.error.log`;
  } catch {
    expected = path.join(
      tmpdir(),
      `.omc-session-end-bootstrap-${process.pid}.error.log`,
    );
  }
  return expected;
}

function writeBootstrapFailure(targetPath, spoolPath, error, captured) {
  const hookName = path.basename(targetPath || 'session-end').replace(/\.mjs$/, '');
  const detail = error instanceof Error ? error.message : String(error);
  const phase = captured
    ? 'after input capture'
    : 'before input capture';
  const message =
    `[${hookName}] SessionEnd worker failed ${phase}: ${detail}\n`;
  try {
    appendFileSync(diagnosticPath(spoolPath), message, {
      encoding: 'utf8',
      mode: 0o600,
    });
  } catch {
    // A diagnostics failure must not turn an optional SessionEnd hook fatal.
  }
}

async function main() {
  const targetValue = process.argv[2];
  const workerArg = process.argv[3];
  const spoolValue = process.argv[4];
  let targetPath;
  let spoolPath;
  let captured = false;
  try {
    if (process.argv.length !== 5 || workerArg !== WORKER_ARG) {
      throw new Error('invalid bounded SessionEnd worker envelope');
    }
    targetPath = validateTarget(targetValue);
    spoolPath = validateSpoolPath(spoolValue);
    const envelope = readEnvelope(4);
    closeSync(4);
    removeSpool(spoolPath);
    process.env.OMC_SESSION_END_DIAGNOSTIC_PATH = diagnosticPath(spoolPath);
    globalThis[CAPTURE_SYMBOL] = envelope;
    captured = true;
    await import(pathToFileURL(targetPath).href);
  } catch (error) {
    try { closeSync(4); } catch { /* best-effort close */ }
    if (spoolPath) removeSpool(spoolPath);
    writeBootstrapFailure(
      targetPath || targetValue,
      spoolPath || spoolValue,
      error,
      captured,
    );
    process.exitCode = 0;
  }
}

void main();
