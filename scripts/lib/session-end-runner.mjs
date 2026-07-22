import { appendFileSync, writeFileSync } from 'node:fs';
import { readSessionEndFrame } from './stdin.mjs';

const WORKER_ARG = '--omc-session-end-envelope-worker';
const CAPTURE_SYMBOL = Symbol.for('omc.session-end.captured-envelope');
const fallback = { continue: true, suppressOutput: true };
const silentStdout = { write: () => true };

function isJsonObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function writeTestReceipt(name, data) {
  const receiptPath = process.env[name];
  if (
    process.env.NODE_ENV !== 'test'
    || typeof receiptPath !== 'string'
    || receiptPath.length === 0
  ) {
    return;
  }
  writeFileSync(receiptPath, data, { mode: 0o600 });
}

function workerDiagnosticStream() {
  const diagnosticPath = process.env.OMC_SESSION_END_DIAGNOSTIC_PATH;
  if (typeof diagnosticPath !== 'string' || diagnosticPath.length === 0) {
    return process.stderr;
  }
  return {
    write(value) {
      try {
        appendFileSync(diagnosticPath, String(value), {
          encoding: 'utf8',
          mode: 0o600,
        });
        return true;
      } catch {
        return false;
      }
    },
  };
}

async function executeCanonical(value, processorExport) {
  const [loader, processorModule] = await Promise.all([
    import('./hook-runtime-loader.mjs'),
    import('../../dist/hooks/session-end/index.js'),
  ]);
  const runtime = await loader.loadHookRuntimeAsync();
  const processor = processorModule[processorExport];
  if (typeof processor !== 'function') {
    throw new Error(`SessionEnd processor export "${processorExport}" is unavailable`);
  }

  let legacyOutput;
  const result = await runtime.runHookPayload(
    'session-end',
    value,
    async (unit, envelope) => {
      legacyOutput = await processor(
        runtime.buildLegacyProcessorInput(envelope, unit),
      );
      return legacyOutput;
    },
  );
  const failure = loader.describeHookRunFailure(runtime, result);
  if (failure) throw new Error(failure);
  return { legacyOutput, loader, result, runtime };
}

async function surfaceWorkerFailure(error, hookName) {
  try {
    const { surfaceOptionalHookFailure } = await import('./hook-runtime-loader.mjs');
    surfaceOptionalHookFailure(error, {
      hookName,
      stdout: silentStdout,
      stderr: workerDiagnosticStream(),
    });
  } catch {
    const detail = error instanceof Error ? error.message : String(error);
    workerDiagnosticStream().write(
      `[${hookName}] Canonical SessionEnd worker failed; continuing without optional hook behavior: ${detail}\n`,
    );
    process.exitCode = 0;
  }
}

async function runEnvelopeWorker(hookName, processorExport, captured) {
  let status = 'failed';
  try {
    const { raw, value } = captured;
    if (!Buffer.isBuffer(raw) || !isJsonObject(value)) {
      throw new Error('SessionEnd capture worker supplied an invalid envelope');
    }
    writeTestReceipt('OMC_SESSION_END_TEST_RAW_RECEIPT', raw);
    writeTestReceipt(
      'OMC_SESSION_END_TEST_WORKER_PID_FILE',
      Buffer.from(String(process.pid)),
    );

    await executeCanonical(value, processorExport);
    status = 'completed';
  } catch (error) {
    await surfaceWorkerFailure(error, hookName);
  } finally {
    writeTestReceipt(
      'OMC_SESSION_END_TEST_WORKER_COMPLETION_FILE',
      Buffer.from(JSON.stringify({ pid: process.pid, status })),
    );
  }
}

async function runForeground(hookName, processorExport) {
  const frame = await readSessionEndFrame();
  if (frame.status !== 'ok') {
    console.log(JSON.stringify(fallback));
    return;
  }

  try {
    const canonical = await executeCanonical(frame.value, processorExport);
    console.log(JSON.stringify(
      canonical.loader.encodeLegacyCompatibleHookOutput(
        canonical.runtime,
        canonical.result,
        canonical.legacyOutput,
      ),
    ));
  } catch (error) {
    const { surfaceOptionalHookFailure } = await import('./hook-runtime-loader.mjs');
    surfaceOptionalHookFailure(error, { hookName });
  }
}

export async function runSessionEndEntrypoint({
  hookName,
  processorExport,
}) {
  const captured = globalThis[CAPTURE_SYMBOL];
  if (captured !== undefined) {
    delete globalThis[CAPTURE_SYMBOL];
    await runEnvelopeWorker(hookName, processorExport, captured);
    return;
  }

  const workerIndex = process.argv.indexOf(WORKER_ARG);
  if (workerIndex >= 0) {
    process.stderr.write(
      `[${hookName}] SessionEnd worker received no captured envelope.\n`,
    );
    return;
  }

  await runForeground(hookName, processorExport);
}
