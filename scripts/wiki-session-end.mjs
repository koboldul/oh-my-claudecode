#!/usr/bin/env node
import { runSessionEndEntrypoint } from './lib/session-end-runner.mjs';

void runSessionEndEntrypoint({
  hookName: 'wiki-session-end',
  processorExport: 'processWikiSessionEnd',
});
