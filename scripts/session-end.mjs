#!/usr/bin/env node
#!/usr/bin/env node
import { runSessionEndEntrypoint } from './lib/session-end-runner.mjs';
import { isMainThread } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export async function runSessionEndHook() {
  return runSessionEndEntrypoint({
    hookName: 'session-end',
    processorExport: 'processSessionEnd',
  });
}

if (!isMainThread || (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))) {
  void runSessionEndHook();
}
