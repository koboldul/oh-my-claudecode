#!/usr/bin/env node
import { runSessionEndEntrypoint } from './lib/session-end-runner.mjs';

void runSessionEndEntrypoint({
  hookName: 'session-end',
  processorExport: 'processSessionEnd',
});
