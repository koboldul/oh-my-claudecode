import type { NotificationEvent, NotificationPayload } from "../notifications/types.js";
export type BackgroundNotificationData = Partial<NotificationPayload> & {
    sessionId: string;
    profileName?: string;
};
export interface BackgroundNotificationRuntimeContext {
    childEntrypointPath: string;
    hookRuntimePath: string;
}
export interface BackgroundNotificationGate {
    readonly intentId: string;
    readonly claimId: string;
}
export interface BackgroundNotificationAcknowledgement {
    readonly status: "acknowledged";
    release(): Promise<"released" | "failed">;
    terminate(): void;
}
export type BackgroundNotificationQueueResult = BackgroundNotificationAcknowledgement | {
    readonly status: "disabled" | "failed";
};
export declare const BACKGROUND_NOTIFICATION_GATE_TYPE = "omc.notification.dispatch.v1";
export declare function resolveBackgroundNotificationRuntimeContext(pluginRoot: string): BackgroundNotificationRuntimeContext;
export declare function runHookNotificationChild(event: NotificationEvent, data: BackgroundNotificationData): Promise<void>;
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
export declare function dispatchNotificationInBackground(event: NotificationEvent, data: BackgroundNotificationData, runtimeContext?: BackgroundNotificationRuntimeContext, requestedGate?: BackgroundNotificationGate): Promise<BackgroundNotificationQueueResult>;
export declare function dispatchDetachedNotificationInBackground(event: NotificationEvent, data: BackgroundNotificationData, runtimeContext?: BackgroundNotificationRuntimeContext): void;
//# sourceMappingURL=background-notifications.d.ts.map