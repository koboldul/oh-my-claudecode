#!/usr/bin/env node

'use strict';

const GATE_TYPE = 'omc.notification.dispatch.v1';
const GATE_TIMEOUT_MS = 2_000;

const [
  runtimePath,
  serializedEvent,
  serializedData,
  expectedIntentId,
  expectedClaimId,
] = process.argv.slice(2);

function disconnect() {
  try {
    if (process.connected) process.disconnect();
  } catch {
    // The parent may already have closed the channel.
  }
}

function waitForGate() {
  if (
    typeof process.send !== 'function'
    || !process.connected
  ) {
    return Promise.resolve(false);
  }

  return new Promise((resolve) => {
    let settled = false;
    const settle = (accepted) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      process.off('message', onMessage);
      process.off('disconnect', onDisconnect);
      resolve(accepted);
    };
    const onMessage = (message) => {
      settle(
        message !== null
        && typeof message === 'object'
        && message.type === GATE_TYPE
        && message.intentId === expectedIntentId
        && message.claimId === expectedClaimId,
      );
    };
    const onDisconnect = () => {
      settle(false);
    };
    const timeout = setTimeout(() => {
      settle(false);
    }, GATE_TIMEOUT_MS);

    process.once('message', onMessage);
    process.once('disconnect', onDisconnect);
  });
}

async function main() {
  if (
    !runtimePath
    || !serializedEvent
    || !serializedData
    || !expectedIntentId
    || !expectedClaimId
  ) {
    throw new Error('notification child arguments are incomplete');
  }
  const accepted = await waitForGate();
  disconnect();
  if (!accepted) return;

  const runtime = require(runtimePath);
  if (typeof runtime.runHookNotificationChild !== 'function') {
    throw new Error('hook runtime notification child export is unavailable');
  }
  await runtime.runHookNotificationChild(
    JSON.parse(serializedEvent),
    JSON.parse(serializedData),
  );
}

main().catch(() => {
  process.exitCode = 1;
});
