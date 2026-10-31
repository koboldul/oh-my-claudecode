'use strict';

const { spawn } = require('node:child_process');
const { writeSync } = require('node:fs');
const { tmpdir } = require('node:os');

const WRITE_CHUNK_BYTES = 16 * 1024;
let writerResultSent = false;

function errorDetail(error) {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

function sendWriterResult(result) {
  if (writerResultSent) return;
  writerResultSent = true;
  if (typeof process.send !== 'function' || !process.connected) {
    process.exit(result.ok ? 0 : 1);
    return;
  }
  process.send(result, () => process.exit(result.ok ? 0 : 1));
}

function runWriter() {
  const chunks = [];
  process.stdin.on('data', chunk => chunks.push(chunk));
  process.stdin.on('end', () => {
    const payload = Buffer.concat(chunks);
    try {
      let offset = 0;
      while (offset < payload.length) {
        const written = writeSync(
          1,
          payload,
          offset,
          Math.min(WRITE_CHUNK_BYTES, payload.length - offset),
        );
        if (written <= 0) {
          throw new Error('stdout write completed without delivering bytes');
        }
        offset += written;
      }
      sendWriterResult({ ok: true });
    } catch (error) {
      sendWriterResult({
        ok: false,
        error: errorDetail(error),
        ...(error?.code ? { code: error.code } : {}),
      });
    }
  });
  process.stdin.on('error', error => {
    sendWriterResult({
      ok: false,
      error: errorDetail(error),
      ...(error?.code ? { code: error.code } : {}),
    });
  });
  process.stdin.resume();
}

function writeHostStdoutAndWait(payload, timeoutMs, onSpawn) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return Promise.reject(new TypeError('stdout writer timeoutMs must be positive'));
  }
  const bytes = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  const writer = spawn(process.execPath, [__filename, '--writer'], {
    cwd: tmpdir(),
    stdio: ['pipe', 1, 'ignore', 'ipc'],
    windowsHide: true,
  });
  if (typeof onSpawn === 'function') {
    try { onSpawn(writer); } catch { /* test instrumentation is best-effort */ }
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let result;

    const finish = error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };
    const stop = error => {
      try { writer.stdin.destroy(); } catch { /* already closed */ }
      try { writer.kill(); } catch { /* already exited */ }
      try {
        if (writer.connected) writer.disconnect();
      } catch {
        // The writer may have already closed its IPC channel.
      }
      try { writer.unref(); } catch { /* already released */ }
      finish(error);
    };
    const timer = setTimeout(() => {
      stop(new Error(
        `stdout flush timed out after ${Math.floor(timeoutMs)}ms`,
      ));
    }, Math.max(1, Math.floor(timeoutMs)));

    writer.once('error', error => stop(error));
    writer.stdin.once('error', error => stop(error));
    writer.on('message', message => {
      result = message;
    });
    writer.once('exit', (code, signal) => {
      if (result?.ok === true && code === 0) {
        finish();
        return;
      }
      const error = new Error(
        result?.error
        || `stdout writer exited before flush completed (${code ?? signal})`,
      );
      if (result?.code) error.code = result.code;
      finish(error);
    });
    try {
      writer.stdin.end(bytes);
    } catch (error) {
      stop(error);
    }
  });
}

if (require.main === module && process.argv[2] === '--writer') {
  runWriter();
}

module.exports = {
  writeHostStdoutAndWait,
};
