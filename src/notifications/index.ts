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

export type {
  NotificationEvent,
  NotificationPlatform,
  NotificationConfig,
  NotificationProfilesConfig,
  NotificationPayload,
  NotificationResult,
  DispatchResult,
  DiscordNotificationConfig,
  DiscordBotNotificationConfig,
  TelegramNotificationConfig,
  SlackNotificationConfig,
  SlackBotNotificationConfig,
  WebhookNotificationConfig,
  EventNotificationConfig,
} from "./types.js";
export type {
  HookNotificationConfig,
  HookEventConfig,
  PlatformTemplateOverride,
  TemplateVariable,
} from "./hook-config-types.js";

export {
  dispatchNotifications,
  sendDiscord,
  sendDiscordBot,
  sendTelegram,
  sendSlack,
  sendSlackBot,
  sendWebhook,
} from "./dispatcher.js";
export {
  formatNotification,
  formatSessionStart,
  formatSessionStop,
  formatSessionEnd,
  formatSessionIdle,
  formatAskUserQuestion,
  formatAgentCall,
  parseTmuxTail,
} from "./formatter.js";
export {
  getCurrentTmuxSession,
  getCurrentTmuxPaneId,
  getTeamTmuxSessions,
  formatTmuxInfo,
} from "./tmux.js";
export {
  getNotificationConfig,
  isEventEnabled,
  getEnabledPlatforms,
  getVerbosity,
  getTmuxTailLines,
  isEventAllowedByVerbosity,
  shouldIncludeTmuxTail,
} from "./config.js";
export {
  getHookConfig,
  resolveEventTemplate,
  resetHookConfigCache,
  mergeHookConfigIntoNotificationConfig,
} from "./hook-config.js";
export {
  interpolateTemplate,
  getDefaultTemplate,
  validateTemplate,
  computeTemplateVariables,
} from "./template-engine.js";
export {
  verifySlackSignature,
  isTimestampValid,
  validateSlackEnvelope,
  validateSlackMessage,
  SlackConnectionStateTracker,
} from "./slack-socket.js";
export type {
  SlackConnectionState,
  SlackValidationResult,
  SlackSocketEnvelope,
} from "./slack-socket.js";
export { redactTokens } from "./redact.js";

import type {
  NotificationEvent,
  NotificationPlatform,
  NotificationPayload,
  DispatchResult,
} from "./types.js";
import {
  getNotificationConfig,
  isEventEnabled,
  getVerbosity,
  getTmuxTailLines,
  isEventAllowedByVerbosity,
  shouldIncludeTmuxTail,
} from "./config.js";
import { formatNotification } from "./formatter.js";
import { dispatchNotifications } from "./dispatcher.js";
import { getCurrentTmuxSession } from "./tmux.js";
import { getHookConfig, resolveEventTemplate } from "./hook-config.js";
import { interpolateTemplate } from "./template-engine.js";
import { basename, join } from "path";
import { existsSync, readFileSync } from "fs";
import { randomUUID } from "crypto";
import { getOmcRoot, getSessionStateDir } from "../lib/worktree-paths.js";
import { atomicWriteJsonSync } from "../lib/atomic-write.js";
import { withStateFileMutationLock } from "../lib/mode-state-io.js";

const NOTIFICATION_RECEIPT_FILE = "notification-delivery-receipts.json";
export const NOTIFICATION_PROVISIONAL_LEASE_MS = 30_000;

interface NotificationReceiptEntry {
  claimed_at_ms: number;
  lease_expires_at_ms?: number;
  session_id: string;
  event: NotificationEvent;
  delivery_status?: "provisional" | "queued" | "retryable";
  claim_id?: string;
  queued_at_ms?: number;
  retryable_at_ms?: number;
}

interface NotificationReceiptState {
  version: 2;
  receipts: Record<string, NotificationReceiptEntry>;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function isNotificationReceiptState(
  value: unknown,
  sessionId: string,
): value is NotificationReceiptState {
  if (!isPlainRecord(value) || value.version !== 2) return false;
  if (!isPlainRecord(value.receipts)) return false;
  return Object.entries(value.receipts).every(([intentId, receipt]) => {
    if (
      intentId.length === 0
      || !isPlainRecord(receipt)
      || typeof receipt.claimed_at_ms !== "number"
      || !Number.isFinite(receipt.claimed_at_ms)
      || receipt.session_id !== sessionId
      || typeof receipt.event !== "string"
      || receipt.event.length === 0
    ) {
      return false;
    }
    if (receipt.delivery_status === undefined) {
      return receipt.claim_id === undefined
        && receipt.lease_expires_at_ms === undefined
        && receipt.queued_at_ms === undefined
        && receipt.retryable_at_ms === undefined;
    }
    if (
      !["provisional", "queued", "retryable"]
        .includes(String(receipt.delivery_status))
      || typeof receipt.claim_id !== "string"
      || receipt.claim_id.length === 0
    ) {
      return false;
    }
    if (
      receipt.lease_expires_at_ms !== undefined
      && (
        typeof receipt.lease_expires_at_ms !== "number"
        || !Number.isFinite(receipt.lease_expires_at_ms)
      )
    ) {
      return false;
    }
    if (receipt.delivery_status === "queued") {
      return typeof receipt.queued_at_ms === "number"
        && Number.isFinite(receipt.queued_at_ms)
        && receipt.lease_expires_at_ms === undefined
        && receipt.retryable_at_ms === undefined;
    }
    if (receipt.delivery_status === "retryable") {
      return typeof receipt.retryable_at_ms === "number"
        && Number.isFinite(receipt.retryable_at_ms)
        && receipt.lease_expires_at_ms === undefined
        && receipt.queued_at_ms === undefined;
    }
    return receipt.queued_at_ms === undefined
      && receipt.retryable_at_ms === undefined;
  });
}

export interface NotifyOnceResult {
  status: "sent" | "duplicate" | "skipped" | "failed";
}

function notificationReceiptPath(
  sessionId: string,
  projectPath: string,
): string {
  return join(
    getSessionStateDir(sessionId, projectPath),
    NOTIFICATION_RECEIPT_FILE,
  );
}

export function claimNotificationReceipt(
  intentId: string,
  event: NotificationEvent,
  sessionId: string,
  projectPath: string,
  nowMs: number,
): "claimed" | "duplicate" | "failed" {
  try {
    const receiptPath = notificationReceiptPath(sessionId, projectPath);
    const locked = withStateFileMutationLock(receiptPath, () => {
      let state: NotificationReceiptState = { version: 2, receipts: {} };
      if (existsSync(receiptPath)) {
        try {
          const parsed = JSON.parse(readFileSync(receiptPath, "utf8"));
          if (!isNotificationReceiptState(parsed, sessionId)) {
            return "failed" as const;
          }
          state = parsed;
        } catch {
          return "failed" as const;
        }
      }

      const receipts = { ...state.receipts };
      if (receipts[intentId]) return "duplicate" as const;

      receipts[intentId] = {
        claimed_at_ms: nowMs,
        session_id: sessionId,
        event,
      };
      atomicWriteJsonSync(receiptPath, {
        version: 2,
        receipts,
      } satisfies NotificationReceiptState);
      return "claimed" as const;
    });

    return locked.acquired && locked.value
      ? locked.value
      : "failed";
  } catch {
    return "failed";
  }
}

export type ProvisionalNotificationReceiptClaim =
  | { status: "claimed"; claimId: string }
  | { status: "duplicate" }
  | { status: "failed" };

function boundedProvisionalLeaseExpiry(
  receipt: NotificationReceiptEntry,
): number {
  const maximum = receipt.claimed_at_ms
    + NOTIFICATION_PROVISIONAL_LEASE_MS;
  if (!Number.isFinite(maximum)) return receipt.claimed_at_ms;
  return Math.min(
    receipt.lease_expires_at_ms ?? maximum,
    maximum,
  );
}

export function claimProvisionalNotificationReceipt(
  intentId: string,
  event: NotificationEvent,
  sessionId: string,
  projectPath: string,
  nowMs: number,
): ProvisionalNotificationReceiptClaim {
  if (
    !intentId
    || !projectPath
    || !Number.isFinite(nowMs)
  ) {
    return { status: "failed" };
  }
  const claimId = randomUUID();
  try {
    const receiptPath = notificationReceiptPath(sessionId, projectPath);
    const locked = withStateFileMutationLock(receiptPath, () => {
      let state: NotificationReceiptState = { version: 2, receipts: {} };
      if (existsSync(receiptPath)) {
        try {
          const parsed = JSON.parse(readFileSync(receiptPath, "utf8"));
          if (!isNotificationReceiptState(parsed, sessionId)) {
            return { status: "failed" as const };
          }
          state = parsed;
        } catch {
          return { status: "failed" as const };
        }
      }

      const current = state.receipts[intentId];
      if (current) {
        if (current.delivery_status === "provisional") {
          if (nowMs < boundedProvisionalLeaseExpiry(current)) {
            return { status: "duplicate" as const };
          }
        } else if (current.delivery_status !== "retryable") {
          return { status: "duplicate" as const };
        }
      }
      const leaseExpiresAtMs = Math.min(
        Number.MAX_SAFE_INTEGER,
        nowMs + NOTIFICATION_PROVISIONAL_LEASE_MS,
      );
      atomicWriteJsonSync(receiptPath, {
        version: 2,
        receipts: {
          ...state.receipts,
          [intentId]: {
            claimed_at_ms: nowMs,
            lease_expires_at_ms: leaseExpiresAtMs,
            session_id: sessionId,
            event,
            delivery_status: "provisional",
            claim_id: claimId,
          },
        },
      } satisfies NotificationReceiptState);
      return { status: "claimed" as const, claimId };
    });
    return locked.acquired && locked.value
      ? locked.value
      : { status: "failed" };
  } catch {
    return { status: "failed" };
  }
}

export function finalizeNotificationReceiptQueued(
  intentId: string,
  sessionId: string,
  projectPath: string,
  claimId: string,
  nowMs: number,
): "finalized" | "changed" | "failed" {
  try {
    const receiptPath = notificationReceiptPath(sessionId, projectPath);
    const locked = withStateFileMutationLock(receiptPath, () => {
      if (!existsSync(receiptPath)) return "changed" as const;
      let state: NotificationReceiptState;
      try {
        const parsed = JSON.parse(readFileSync(receiptPath, "utf8"));
        if (!isNotificationReceiptState(parsed, sessionId)) {
          return "failed" as const;
        }
        state = parsed;
      } catch {
        return "failed" as const;
      }
      const current = state.receipts[intentId];
      if (
        !current
        || current.claim_id !== claimId
        || (
          current.delivery_status !== "provisional"
          && current.delivery_status !== "queued"
        )
      ) {
        return "changed" as const;
      }
      if (current.delivery_status === "queued") return "finalized" as const;

      const queued = { ...current };
      delete queued.lease_expires_at_ms;
      atomicWriteJsonSync(receiptPath, {
        version: 2,
        receipts: {
          ...state.receipts,
          [intentId]: {
            ...queued,
            delivery_status: "queued",
            queued_at_ms: nowMs,
          },
        },
      } satisfies NotificationReceiptState);
      return "finalized" as const;
    });
    return locked.acquired && locked.value ? locked.value : "failed";
  } catch {
    return "failed";
  }
}

export function markNotificationReceiptRetryable(
  intentId: string,
  sessionId: string,
  projectPath: string,
  claimId: string,
  nowMs: number,
): "retryable" | "changed" | "failed" {
  try {
    const receiptPath = notificationReceiptPath(sessionId, projectPath);
    const locked = withStateFileMutationLock(receiptPath, () => {
      if (!existsSync(receiptPath)) return "changed" as const;
      let state: NotificationReceiptState;
      try {
        const parsed = JSON.parse(readFileSync(receiptPath, "utf8"));
        if (!isNotificationReceiptState(parsed, sessionId)) {
          return "failed" as const;
        }
        state = parsed;
      } catch {
        return "failed" as const;
      }
      const current = state.receipts[intentId];
      if (
        !current
        || current.delivery_status !== "provisional"
        || current.claim_id !== claimId
      ) {
        return "changed" as const;
      }
      const retryable = { ...current };
      delete retryable.lease_expires_at_ms;
      atomicWriteJsonSync(receiptPath, {
        version: 2,
        receipts: {
          ...state.receipts,
          [intentId]: {
            ...retryable,
            delivery_status: "retryable",
            retryable_at_ms: nowMs,
          },
        },
      } satisfies NotificationReceiptState);
      return "retryable" as const;
    });
    return locked.acquired && locked.value ? locked.value : "failed";
  } catch {
    return "failed";
  }
}

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
export async function notify(
  event: NotificationEvent,
  data: Partial<NotificationPayload> & { sessionId: string; profileName?: string },
): Promise<DispatchResult | null> {
  // OMC_NOTIFY=0 suppresses all CCNotifier events (set by `omc --notify false`)
  if (process.env.OMC_NOTIFY === '0') {
    return null;
  }

  try {
    const config = getNotificationConfig(data.profileName);
    if (!config || !isEventEnabled(config, event)) {
      return null;
    }

    // Verbosity filter (second gate after isEventEnabled).  An explicitly
    // enabled ask-user-question event is user intent to surface an interactive
    // block, so do not let the default "session" verbosity silently drop it.
    const verbosity = getVerbosity(config);
    const isExplicitAskUserQuestionEvent =
      event === "ask-user-question" &&
      config.events?.["ask-user-question"]?.enabled === true;
    if (
      !isExplicitAskUserQuestionEvent &&
      !isEventAllowedByVerbosity(verbosity, event)
    ) {
      return null;
    }

    // Get tmux pane ID
    const { getCurrentTmuxPaneId } = await import("./tmux.js");

    // Build the full payload
    const payload: NotificationPayload = {
      event,
      sessionId: data.sessionId,
      message: "", // Will be formatted below
      timestamp: data.timestamp || new Date().toISOString(),
      tmuxSession: data.tmuxSession ?? getCurrentTmuxSession() ?? undefined,
      tmuxPaneId: data.tmuxPaneId ?? getCurrentTmuxPaneId() ?? undefined,
      projectPath: data.projectPath,
      projectName:
        data.projectName ||
        (data.projectPath ? basename(data.projectPath) : undefined),
      modesUsed: data.modesUsed,
      contextSummary: data.contextSummary,
      durationMs: data.durationMs,
      agentsSpawned: data.agentsSpawned,
      agentsCompleted: data.agentsCompleted,
      reason: data.reason,
      activeMode: data.activeMode,
      iteration: data.iteration,
      maxIterations: data.maxIterations,
      question: data.question,
      askUserQuestionPrompts: data.askUserQuestionPrompts,
      incompleteTasks: data.incompleteTasks,
      agentName: data.agentName,
      agentType: data.agentType,
      replyChannel: data.replyChannel ?? process.env.OPENCLAW_REPLY_CHANNEL ?? undefined,
      replyTarget: data.replyTarget ?? process.env.OPENCLAW_REPLY_TARGET ?? undefined,
      replyThread: data.replyThread ?? process.env.OPENCLAW_REPLY_THREAD ?? undefined,
    };

    // Capture tmux tail for events that benefit from it
    if (
      shouldIncludeTmuxTail(verbosity) &&
      payload.tmuxPaneId &&
      (event === "session-idle" || event === "session-end" || event === "session-stop")
    ) {
      try {
        const { capturePaneContent } = await import(
          "../features/rate-limit-wait/tmux-detector.js"
        );
        const { getNewPaneTail } = await import(
          "../features/rate-limit-wait/pane-fresh-capture.js"
        );
        const tailLines = getTmuxTailLines(config);
        const rawTail = payload.projectPath
          ? getNewPaneTail(payload.tmuxPaneId, join(getOmcRoot(payload.projectPath), "state"), tailLines)
          : capturePaneContent(payload.tmuxPaneId, tailLines);
        if (rawTail) {
          payload.tmuxTail = rawTail;
          payload.maxTailLines = tailLines;
        }
      } catch {
        // Non-blocking: tmux capture is best-effort
      }
    }

    // Format the message (default for all platforms)
    const defaultMessage = data.message || formatNotification(payload);
    payload.message = defaultMessage;

    // Per-platform template resolution (only when hook config has overrides)
    let platformMessages: Map<NotificationPlatform, string> | undefined;
    if (!data.message) {
      const hookConfig = getHookConfig();
      if (hookConfig?.enabled) {
        const platforms: NotificationPlatform[] = [
          "discord", "discord-bot", "telegram", "slack", "slack-bot", "webhook",
        ];
        const map = new Map<NotificationPlatform, string>();
        for (const platform of platforms) {
          const template = resolveEventTemplate(hookConfig, event, platform);
          if (template) {
            const resolved = interpolateTemplate(template, payload);
            if (resolved !== defaultMessage) {
              map.set(platform, resolved);
            }
          }
        }
        if (map.size > 0) {
          platformMessages = map;
        }
      }
    }

    // Dispatch to all enabled platforms
    const result = await dispatchNotifications(
      config, event, payload, platformMessages,
    );

    // NEW: Register message IDs for reply correlation
    if (result.anySuccess && payload.tmuxPaneId) {
      try {
        const { registerMessage } = await import("./session-registry.js");
        for (const r of result.results) {
          if (
            r.success &&
            r.messageId &&
            (r.platform === "discord-bot" || r.platform === "telegram" || r.platform === "slack-bot")
          ) {
            registerMessage({
              platform: r.platform,
              messageId: r.messageId,
              sessionId: payload.sessionId,
              tmuxPaneId: payload.tmuxPaneId,
              tmuxSessionName: payload.tmuxSession || "",
              event: payload.event,
              createdAt: new Date().toISOString(),
              projectPath: payload.projectPath,
              ...(payload.event === "ask-user-question" && payload.askUserQuestionPrompts?.[0]
                ? {
                    askUserQuestionOptionCount: payload.askUserQuestionPrompts[0].options.length,
                    askUserQuestionAllowOther: payload.askUserQuestionPrompts[0].allowOther !== false,
                  }
                : {}),
            });
          }
        }
      } catch {
        // Non-fatal: reply correlation is best-effort
      }
    }

    return result;
  } catch (error) {
    // Never let notification failures propagate to hooks
    console.error(
      "[notifications] Error:",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

/**
 * At-most-once notification dispatch guarded by a durable owner receipt.
 * The receipt is claimed before external dispatch, so a crash may suppress a
 * retry but can never duplicate an interactive notification.
 */
export async function notifyOnce(
  intentId: string,
  event: NotificationEvent,
  data: Partial<NotificationPayload> & {
    sessionId: string;
    projectPath: string;
    profileName?: string;
  },
  nowMs = Date.now(),
): Promise<NotifyOnceResult> {
  if (!intentId || !data.projectPath) return { status: "failed" };
  const claim = claimNotificationReceipt(
    intentId,
    event,
    data.sessionId,
    data.projectPath,
    nowMs,
  );
  if (claim === "duplicate") return { status: "duplicate" };
  if (claim === "failed") return { status: "failed" };

  const result = await notify(event, data);
  if (!result) return { status: "skipped" };
  return {
    status: result.anySuccess ? "sent" : "skipped",
  };
}

// ============================================================================
// CUSTOM INTEGRATION EXPORTS (Added for Notification Refactor)
// ============================================================================

export type {
  CustomIntegration,
  CustomIntegrationType,
  WebhookIntegrationConfig,
  CliIntegrationConfig,
  CustomIntegrationsConfig,
  ExtendedNotificationConfig,
} from "./types.js";

export {
  sendCustomWebhook,
  sendCustomCli,
  dispatchCustomIntegrations,
} from "./dispatcher.js";

export {
  getCustomIntegrationsConfig,
  getCustomIntegrationsForEvent,
  hasCustomIntegrationsEnabled,
  detectLegacyOpenClawConfig,
  migrateLegacyOpenClawConfig,
} from "./config.js";

export {
  CUSTOM_INTEGRATION_PRESETS,
  getPresetList,
  getPreset,
  isValidPreset,
  type PresetConfig,
  type PresetName,
} from "./presets.js";

export {
  TEMPLATE_VARIABLES,
  getVariablesForEvent,
  getVariableDocumentation,
  type TemplateVariableName,
} from "./template-variables.js";

export {
  validateCustomIntegration,
  checkDuplicateIds,
  sanitizeArgument,
  type ValidationResult,
} from "./validation.js";
