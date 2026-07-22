import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, } from "node:fs";
import { EventEmitter } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
const spawnMock = vi.fn();
const unrefMock = vi.fn();
const killMock = vi.fn();
const disconnectMock = vi.fn();
const sendMock = vi.fn();
vi.mock("child_process", () => ({
    spawn: spawnMock,
}));
describe("dispatchNotificationInBackground", () => {
    let root;
    let childEntrypointPath;
    let hookRuntimePath;
    let child;
    beforeEach(() => {
        root = mkdtempSync(join(tmpdir(), "omc-notification-child-"));
        childEntrypointPath = join(root, "notification-child.cjs");
        hookRuntimePath = join(root, "hook-runtime.cjs");
        writeFileSync(childEntrypointPath, "");
        writeFileSync(hookRuntimePath, "");
        child = Object.assign(new EventEmitter(), {
            connected: true,
            disconnect: disconnectMock,
            kill: killMock,
            send: sendMock,
            unref: unrefMock,
        });
        disconnectMock.mockImplementation(() => {
            child.connected = false;
        });
        sendMock.mockImplementation((_message, callback) => {
            queueMicrotask(() => callback?.(null));
            return true;
        });
        spawnMock.mockImplementation(() => {
            queueMicrotask(() => child.emit("spawn"));
            return child;
        });
        delete process.env.OMC_NOTIFY;
    });
    afterEach(() => {
        rmSync(root, { recursive: true, force: true });
        vi.useRealTimers();
        vi.clearAllMocks();
        vi.unstubAllEnvs();
    });
    it("spawns detached notification work with ignored stdio", async () => {
        const { dispatchNotificationInBackground } = await import("../background-notifications.js");
        const result = await dispatchNotificationInBackground("session-start", {
            sessionId: "sess-1",
            projectPath: "/tmp/project",
        }, { childEntrypointPath, hookRuntimePath }, {
            intentId: "intent-1",
            claimId: "claim-1",
        });
        expect(result.status).toBe("acknowledged");
        expect(spawnMock).toHaveBeenCalledOnce();
        expect(spawnMock).toHaveBeenCalledWith(process.execPath, [
            childEntrypointPath,
            hookRuntimePath,
            JSON.stringify("session-start"),
            expect.stringContaining('"sessionId":"sess-1"'),
            "intent-1",
            "claim-1",
        ], expect.objectContaining({
            detached: true,
            stdio: ["ignore", "ignore", "ignore", "ipc"],
            windowsHide: true,
            env: expect.objectContaining({ OMC_HOOK_BACKGROUND_CHILD: "1" }),
        }));
        expect(unrefMock).not.toHaveBeenCalled();
        expect(sendMock).not.toHaveBeenCalled();
        if (result.status !== "acknowledged") {
            throw new Error("spawn was not acknowledged");
        }
        await expect(result.release()).resolves.toBe("released");
        expect(sendMock).toHaveBeenCalledWith({
            type: "omc.notification.dispatch.v1",
            intentId: "intent-1",
            claimId: "claim-1",
        }, expect.any(Function));
        expect(disconnectMock).toHaveBeenCalledOnce();
        expect(unrefMock).toHaveBeenCalledOnce();
    });
    it("can terminate an acknowledged child without detaching it", async () => {
        const { dispatchNotificationInBackground } = await import("../background-notifications.js");
        const result = await dispatchNotificationInBackground("ask-user-question", { sessionId: "sess-1" }, { childEntrypointPath, hookRuntimePath });
        expect(result.status).toBe("acknowledged");
        if (result.status !== "acknowledged") {
            throw new Error("spawn was not acknowledged");
        }
        result.terminate();
        expect(killMock).toHaveBeenCalledOnce();
        expect(disconnectMock).toHaveBeenCalledOnce();
        expect(sendMock).not.toHaveBeenCalled();
        expect(unrefMock).not.toHaveBeenCalled();
    });
    it("returns failed for an asynchronous spawn error", async () => {
        spawnMock.mockImplementation(() => {
            queueMicrotask(() => {
                const error = Object.assign(new Error("spawn ENOENT"), {
                    code: "ENOENT",
                });
                child.emit("error", error);
            });
            return child;
        });
        const { dispatchNotificationInBackground } = await import("../background-notifications.js");
        await expect(dispatchNotificationInBackground("ask-user-question", { sessionId: "sess-1" }, { childEntrypointPath, hookRuntimePath })).resolves.toEqual({ status: "failed" });
        expect(unrefMock).not.toHaveBeenCalled();
    });
    it("times out when the child acknowledges neither spawn nor error", async () => {
        vi.useFakeTimers();
        spawnMock.mockReturnValue(child);
        const { dispatchNotificationInBackground } = await import("../background-notifications.js");
        const result = dispatchNotificationInBackground("ask-user-question", { sessionId: "sess-1" }, { childEntrypointPath, hookRuntimePath });
        await vi.advanceTimersByTimeAsync(1_000);
        await expect(result).resolves.toEqual({ status: "failed" });
        expect(unrefMock).not.toHaveBeenCalled();
    });
    it("does not spawn when notifications are explicitly disabled", async () => {
        vi.stubEnv("OMC_NOTIFY", "0");
        const { dispatchNotificationInBackground } = await import("../background-notifications.js");
        await expect(dispatchNotificationInBackground("session-idle", { sessionId: "sess-1" }, { childEntrypointPath, hookRuntimePath })).resolves.toEqual({ status: "disabled" });
        expect(spawnMock).not.toHaveBeenCalled();
    });
    it("does not derive child modules from import.meta.url", () => {
        const source = readFileSync(new URL("../background-notifications.ts", import.meta.url), "utf8");
        expect(source).not.toContain("import.meta.url");
    });
});
//# sourceMappingURL=background-notifications.test.js.map