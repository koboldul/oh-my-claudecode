export const HOST_DELIVERY_ACK_ENV = 'OMC_RUNNER_HOST_DELIVERY_ACK';
export const HOST_DELIVERY_DEADLINE_ENV =
  'OMC_RUNNER_HOST_DELIVERY_DEADLINE_AT';
export const HOST_DELIVERY_PROTOCOL = 'omc-host-delivery-v1';
export const HOST_DELIVERY_REQUEST = 'stdout-request';
export const HOST_DELIVERY_RESULT = 'stdout-result';
export const HOST_DELIVERY_ABORT = 'abort';
export const HOST_DELIVERY_PROCESS = 'process-spawn';
export const HOST_PROCESS_IDENTITY_REQUEST = 'process-identity-request';
export const HOST_PROCESS_IDENTITY_RESULT = 'process-identity-result';

let requestSequence = 0;

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deliveryError(message) {
  return new Error(
    typeof message === 'string' && message
      ? message
      : 'host stdout delivery was not acknowledged',
  );
}

async function resolveDeliveryChannel() {
  if (typeof process.send === 'function') {
    return {
      onMessage(listener) {
        process.on('message', listener);
      },
      offMessage(listener) {
        process.off('message', listener);
      },
      onClose(listener) {
        process.once('disconnect', listener);
      },
      offClose(listener) {
        process.off('disconnect', listener);
      },
      async send(message) {
        if (!process.connected) {
          throw deliveryError('runner host-delivery channel is disconnected');
        }
        await new Promise((resolve, reject) => {
          process.send(message, (error) => {
            if (error) reject(error);
            else resolve();
          });
        });
      },
      release() {
        try {
          if (process.connected) process.disconnect();
        } catch {
          // The runner may have already closed the acknowledgement channel.
        }
      },
    };
  }

  const { isMainThread, parentPort } = await import('node:worker_threads');
  if (!isMainThread && parentPort) {
    return {
      onMessage(listener) {
        parentPort.on('message', listener);
      },
      offMessage(listener) {
        parentPort.off('message', listener);
      },
      onClose(listener) {
        parentPort.once('close', listener);
      },
      offClose(listener) {
        parentPort.off('close', listener);
      },
      async send(message) {
        parentPort.postMessage(message);
      },
      release() {
        parentPort.unref();
      },
    };
  }

  throw deliveryError('runner host-delivery channel is unavailable');
}

export async function observeHostDeliveryAbort() {
  if (process.env[HOST_DELIVERY_ACK_ENV] !== '1') {
    return {
      signal: undefined,
      async throwIfAborted() {},
      reportChildProcess() {},
      async queryCurrentProcessStartIdentity() {
        return null;
      },
      close() {},
    };
  }

  const channel = await resolveDeliveryChannel();
  const abortController = new AbortController();
  let aborted = false;
  let abortMessage = 'runner host-delivery transaction was aborted';
  const abort = (message) => {
    if (aborted) return;
    aborted = true;
    abortMessage = message;
    abortController.abort(deliveryError(message));
  };
  const onMessage = (message) => {
    if (
      !isRecord(message)
      || message.protocol !== HOST_DELIVERY_PROTOCOL
      || message.kind !== HOST_DELIVERY_ABORT
    ) {
      return;
    }
    if (typeof message.error === 'string' && message.error) {
      abortMessage = message.error;
    }
    abort(abortMessage);
  };
  const onClose = () => {
    abort('runner host-delivery channel closed before output was ready');
  };
  channel.onMessage(onMessage);
  channel.onClose(onClose);

  return {
    signal: abortController.signal,
    async throwIfAborted() {
      await new Promise((resolve) => setImmediate(resolve));
      if (aborted) throw deliveryError(abortMessage);
    },
    reportChildProcess(role, pid) {
      if (
        typeof role !== 'string'
        || !role
        || !Number.isInteger(pid)
        || pid <= 0
      ) {
        return;
      }
      void channel.send({
        protocol: HOST_DELIVERY_PROTOCOL,
        kind: HOST_DELIVERY_PROCESS,
        role,
        pid,
      }).catch(() => {
        // Process observability must not affect the hook transaction.
      });
    },
    async queryCurrentProcessStartIdentity() {
      if (aborted) throw deliveryError(abortMessage);
      const requestId =
        `${process.pid}:${Date.now()}:${requestSequence += 1}`;
      const deadlineAt = Number(
        process.env[HOST_DELIVERY_DEADLINE_ENV],
      );
      const timeoutMs = Number.isSafeInteger(deadlineAt)
        ? deadlineAt - Date.now()
        : 5_000;
      if (timeoutMs <= 0) {
        throw deliveryError(
          'runner host-delivery deadline elapsed before process identity lookup',
        );
      }

      return new Promise((resolve, reject) => {
        let settled = false;
        const cleanup = () => {
          clearTimeout(timer);
          channel.offMessage(onIdentityMessage);
          channel.offClose(onIdentityClose);
          abortController.signal.removeEventListener(
            'abort',
            onIdentityAbort,
          );
        };
        const finish = (identity, error) => {
          if (settled) return;
          settled = true;
          cleanup();
          if (error) reject(error);
          else resolve(identity);
        };
        const onIdentityMessage = (message) => {
          if (
            !isRecord(message)
            || message.protocol !== HOST_DELIVERY_PROTOCOL
            || message.kind !== HOST_PROCESS_IDENTITY_RESULT
            || message.id !== requestId
            || message.pid !== process.pid
          ) {
            return;
          }
          const ticks =
            typeof message.identity === 'string'
            && /^ticks:\d{1,19}$/.test(message.identity)
              ? message.identity
              : null;
          finish(message.ok === true ? ticks : null);
        };
        const onIdentityClose = () => {
          finish(
            null,
            deliveryError(
              'runner host-delivery channel closed during process identity lookup',
            ),
          );
        };
        const onIdentityAbort = () => {
          finish(null, deliveryError(abortMessage));
        };
        const timer = setTimeout(() => {
          finish(
            null,
            deliveryError(
              'runner host-delivery deadline elapsed during process identity lookup',
            ),
          );
        }, Math.max(1, Math.floor(timeoutMs)));

        channel.onMessage(onIdentityMessage);
        channel.onClose(onIdentityClose);
        abortController.signal.addEventListener(
          'abort',
          onIdentityAbort,
          { once: true },
        );
        void channel.send({
          protocol: HOST_DELIVERY_PROTOCOL,
          kind: HOST_PROCESS_IDENTITY_REQUEST,
          id: requestId,
          pid: process.pid,
        }).catch((error) => {
          finish(
            null,
            error instanceof Error
              ? error
              : deliveryError(String(error)),
          );
        });
      });
    },
    close() {
      channel.offMessage(onMessage);
      channel.offClose(onClose);
    },
  };
}

export async function awaitHostStdoutDelivery(payload, timeoutMs) {
  if (process.env[HOST_DELIVERY_ACK_ENV] !== '1') return;
  if (typeof payload !== 'string') {
    throw new TypeError('host stdout delivery payload must be a string');
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError('host stdout delivery timeoutMs must be positive');
  }

  const channel = await resolveDeliveryChannel();
  const requestId = `${process.pid}:${Date.now()}:${requestSequence += 1}`;
  const byteLength = Buffer.byteLength(payload, 'utf8');

  await new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      channel.offMessage(onMessage);
      channel.offClose(onClose);
      channel.release();
    };
    const finish = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve();
    };
    const onMessage = (message) => {
      if (
        !isRecord(message)
        || message.protocol !== HOST_DELIVERY_PROTOCOL
        || message.kind !== HOST_DELIVERY_RESULT
        || message.id !== requestId
      ) {
        return;
      }
      finish(message.ok === true ? undefined : deliveryError(message.error));
    };
    const onClose = () => {
      finish(deliveryError('runner host-delivery channel closed before acknowledgement'));
    };
    const timer = setTimeout(() => {
      finish(deliveryError(
        `host stdout acknowledgement timed out after ${Math.floor(timeoutMs)}ms`,
      ));
    }, Math.max(1, Math.floor(timeoutMs)));

    channel.onMessage(onMessage);
    channel.onClose(onClose);
    void channel.send({
      protocol: HOST_DELIVERY_PROTOCOL,
      kind: HOST_DELIVERY_REQUEST,
      id: requestId,
      bytes: byteLength,
      payload,
      timeoutMs: Math.max(1, Math.floor(timeoutMs)),
    }).catch((error) => {
      finish(error instanceof Error ? error : deliveryError(String(error)));
    });
  });
}
