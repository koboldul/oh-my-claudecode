import { spawn } from "child_process";
import { randomUUID } from "crypto";
import { existsSync, statSync } from "fs";
import { basename, dirname, join, resolve } from "path";
const SPAWN_ACKNOWLEDGEMENT_TIMEOUT_MS = 500;
const GATE_RELEASE_TIMEOUT_MS = 500;
export const BACKGROUND_NOTIFICATION_GATE_TYPE = "omc.notification.dispatch.v1";
export function resolveBackgroundNotificationRuntimeContext(pluginRoot) {
    const root = resolve(pluginRoot);
    return {
        childEntrypointPath: join(root, "scripts", "lib", "notification-child.cjs"),
        hookRuntimePath: join(root, "bridge", "hook-runtime.cjs"),
    };
}
function defaultRuntimeContext() {
    const environmentRoot = process.env.CLAUDE_PLUGIN_ROOT?.trim();
    if (environmentRoot) {
        return resolveBackgroundNotificationRuntimeContext(environmentRoot);
    }
    if (typeof __dirname === "undefined" || !__dirname)
        return null;
    const root = basename(__dirname) === "bridge"
        ? dirname(__dirname)
        : resolve(__dirname, "..", "..");
    return resolveBackgroundNotificationRuntimeContext(root);
}
function isFile(path) {
    try {
        return existsSync(path) && statSync(path).isFile();
    }
    catch {
        return false;
    }
}
function terminateChild(child) {
    try {
        child.kill();
    }
    catch {
        // The child may already have exited.
    }
}
function disconnectChild(child) {
    try {
        if (child.connected)
            child.disconnect();
    }
    catch {
        // The IPC channel may already be closed.
    }
}
function acknowledgedChild(child, gate) {
    let handled = false;
    return {
        status: "acknowledged",
        release() {
            if (handled)
                return Promise.resolve("failed");
            handled = true;
            return new Promise((resolveRelease) => {
                let settled = false;
                const settle = (result) => {
                    if (settled)
                        return;
                    settled = true;
                    clearTimeout(timeout);
                    if (result === "released") {
                        disconnectChild(child);
                        child.unref();
                    }
                    else {
                        terminateChild(child);
                        disconnectChild(child);
                    }
                    resolveRelease(result);
                };
                const timeout = setTimeout(() => {
                    settle("failed");
                }, GATE_RELEASE_TIMEOUT_MS);
                try {
                    child.send({
                        type: BACKGROUND_NOTIFICATION_GATE_TYPE,
                        intentId: gate.intentId,
                        claimId: gate.claimId,
                    }, (error) => {
                        settle(error ? "failed" : "released");
                    });
                }
                catch {
                    settle("failed");
                }
            });
        },
        terminate() {
            if (handled)
                return;
            handled = true;
            terminateChild(child);
            disconnectChild(child);
        },
    };
}
export async function runHookNotificationChild(event, data) {
    const { notify } = await import("../notifications/index.js");
    await notify(event, data);
}
/**
 * Dispatch hook-triggered notifications from an isolated detached Node process.
 *
 * Hook foreground processes have a strict stdout JSON protocol, and some CI
 * checks fail on unexpected stderr. Running notification work in-process means
 * late console output from notification formatters, transport failures, custom
 * integrations, or transitive modules can pollute the foreground hook streams.
 * The child ignores stdout/stderr and waits on IPC. Callers release the gate
 * only after any durable queue bookkeeping is complete.
 */
export async function dispatchNotificationInBackground(event, data, runtimeContext, requestedGate) {
    if (process.env.OMC_NOTIFY === "0")
        return { status: "disabled" };
    let serializedEvent;
    let serializedData;
    try {
        serializedEvent = JSON.stringify(event);
        serializedData = JSON.stringify(data);
    }
    catch {
        return { status: "failed" };
    }
    const resolvedContext = runtimeContext ?? defaultRuntimeContext();
    const gate = requestedGate ?? {
        intentId: randomUUID(),
        claimId: randomUUID(),
    };
    if (!resolvedContext
        || !isFile(resolvedContext.childEntrypointPath)
        || !isFile(resolvedContext.hookRuntimePath)
        || !gate.intentId
        || !gate.claimId) {
        return { status: "failed" };
    }
    let child;
    try {
        child = spawn(process.execPath, [
            resolvedContext.childEntrypointPath,
            resolvedContext.hookRuntimePath,
            serializedEvent,
            serializedData,
            gate.intentId,
            gate.claimId,
        ], {
            cwd: dirname(process.execPath),
            detached: true,
            stdio: ["ignore", "ignore", "ignore", "ipc"],
            windowsHide: true,
            env: {
                ...process.env,
                OMC_HOOK_BACKGROUND_CHILD: "1",
            },
        });
    }
    catch {
        return { status: "failed" };
    }
    return new Promise((resolveQueue) => {
        let settled = false;
        const settle = (result) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timeout);
            resolveQueue(result);
        };
        const timeout = setTimeout(() => {
            settle({ status: "failed" });
        }, SPAWN_ACKNOWLEDGEMENT_TIMEOUT_MS);
        child.once("error", () => {
            settle({ status: "failed" });
        });
        child.once("spawn", () => {
            if (settled) {
                terminateChild(child);
                return;
            }
            settle(acknowledgedChild(child, gate));
        });
    });
}
export function dispatchDetachedNotificationInBackground(event, data, runtimeContext) {
    void dispatchNotificationInBackground(event, data, runtimeContext).then((result) => {
        if (result.status !== "acknowledged")
            return;
        void result.release();
    }, () => { });
}
//# sourceMappingURL=background-notifications.js.map