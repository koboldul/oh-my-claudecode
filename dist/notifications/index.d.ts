/**
 * Notification System - Public API
 *
 * Multi-platform lifecycle notifications for oh-my-claudecode.
 * Sends notifications to Discord, Telegram, Slack, and generic webhooks
 * on session lifecycle events.
 *
 * Usage:
 *   import { notify } from '../notifications/index.js';
 *   await notify('session-start', { sessionId, projectPath, ... });
 */
export type { NotificationEvent, NotificationPlatform, NotificationConfig, NotificationProfilesConfig, NotificationPayload, NotificationResult, DispatchResult, DiscordNotificationConfig, DiscordBotNotificationConfig, TelegramNotificationConfig, SlackNotificationConfig, SlackBotNotificationConfig, WebhookNotificationConfig, EventNotificationConfig, } from "./types.js";
export type { HookNotificationConfig, HookEventConfig, PlatformTemplateOverride, TemplateVariable, } from "./hook-config-types.js";
export { dispatchNotifications, sendDiscord, sendDiscordBot, sendTelegram, sendSlack, sendSlackBot, sendWebhook, } from "./dispatcher.js";
export { formatNotification, formatSessionStart, formatSessionStop, formatSessionEnd, formatSessionIdle, formatAskUserQuestion, formatAgentCall, parseTmuxTail, } from "./formatter.js";
export { getCurrentTmuxSession, getCurrentTmuxPaneId, getTeamTmuxSessions, formatTmuxInfo, } from "./tmux.js";
export { getNotificationConfig, isEventEnabled, getEnabledPlatforms, getVerbosity, getTmuxTailLines, isEventAllowedByVerbosity, shouldIncludeTmuxTail, } from "./config.js";
export { getHookConfig, resolveEventTemplate, resetHookConfigCache, mergeHookConfigIntoNotificationConfig, } from "./hook-config.js";
export { interpolateTemplate, getDefaultTemplate, validateTemplate, computeTemplateVariables, } from "./template-engine.js";
export { verifySlackSignature, isTimestampValid, validateSlackEnvelope, validateSlackMessage, SlackConnectionStateTracker, } from "./slack-socket.js";
export type { SlackConnectionState, SlackValidationResult, SlackSocketEnvelope, } from "./slack-socket.js";
export { redactTokens } from "./redact.js";
import type { NotificationEvent, NotificationPayload, DispatchResult } from "./types.js";
export declare const NOTIFICATION_PROVISIONAL_LEASE_MS = 30000;
export interface NotifyOnceResult {
    status: "sent" | "duplicate" | "skipped" | "failed";
}
export declare function claimNotificationReceipt(intentId: string, event: NotificationEvent, sessionId: string, projectPath: string, nowMs: number): "claimed" | "duplicate" | "failed";
export type ProvisionalNotificationReceiptClaim = {
    status: "claimed";
    claimId: string;
} | {
    status: "duplicate";
} | {
    status: "failed";
};
export declare function claimProvisionalNotificationReceipt(intentId: string, event: NotificationEvent, sessionId: string, projectPath: string, nowMs: number): ProvisionalNotificationReceiptClaim;
export declare function finalizeNotificationReceiptQueued(intentId: string, sessionId: string, projectPath: string, claimId: string, nowMs: number): "finalized" | "changed" | "failed";
export declare function markNotificationReceiptRetryable(intentId: string, sessionId: string, projectPath: string, claimId: string, nowMs: number): "retryable" | "changed" | "failed";
/**
 * High-level notification function.
 *
 * Reads config, checks if the event is enabled, formats the message,
 * and dispatches to all configured platforms. Non-blocking, swallows errors.
 *
 * @param event - The notification event type
 * @param data - Partial payload data (message will be auto-formatted if not provided)
 * @returns DispatchResult or null if notifications are not configured/enabled
 */
export declare function notify(event: NotificationEvent, data: Partial<NotificationPayload> & {
    sessionId: string;
    profileName?: string;
}): Promise<DispatchResult | null>;
/**
 * At-most-once notification dispatch guarded by a durable owner receipt.
 * The receipt is claimed before external dispatch, so a crash may suppress a
 * retry but can never duplicate an interactive notification.
 */
export declare function notifyOnce(intentId: string, event: NotificationEvent, data: Partial<NotificationPayload> & {
    sessionId: string;
    projectPath: string;
    profileName?: string;
}, nowMs?: number): Promise<NotifyOnceResult>;
export type { CustomIntegration, CustomIntegrationType, WebhookIntegrationConfig, CliIntegrationConfig, CustomIntegrationsConfig, ExtendedNotificationConfig, } from "./types.js";
export { sendCustomWebhook, sendCustomCli, dispatchCustomIntegrations, } from "./dispatcher.js";
export { getCustomIntegrationsConfig, getCustomIntegrationsForEvent, hasCustomIntegrationsEnabled, detectLegacyOpenClawConfig, migrateLegacyOpenClawConfig, } from "./config.js";
export { CUSTOM_INTEGRATION_PRESETS, getPresetList, getPreset, isValidPreset, type PresetConfig, type PresetName, } from "./presets.js";
export { TEMPLATE_VARIABLES, getVariablesForEvent, getVariableDocumentation, type TemplateVariableName, } from "./template-variables.js";
export { validateCustomIntegration, checkDuplicateIds, sanitizeArgument, type ValidationResult, } from "./validation.js";
//# sourceMappingURL=index.d.ts.map