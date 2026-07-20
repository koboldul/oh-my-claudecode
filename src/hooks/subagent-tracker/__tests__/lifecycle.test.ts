import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  flushPendingWrites,
  processSubagentStart,
  processSubagentStop,
  readTrackingState,
} from "../index.js";
import {
  getReplaySummary,
  readReplayEvents,
} from "../session-replay.js";

const COPILOT_EVENT_FIXTURE = join(
  process.cwd(),
  "src",
  "hooks",
  "subagent-tracker",
  "__tests__",
  "fixtures",
  "copilot-session",
);
const COPILOT_EVENT_FILE = join(COPILOT_EVENT_FIXTURE, "events.jsonl");

describe("subagent tracker canonical lifecycle", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(
      tmpdir(),
      `subagent-lifecycle-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(join(testDir, ".omc", "state"), { recursive: true });
  });

  afterEach(() => {
    flushPendingWrites();
    rmSync(testDir, { recursive: true, force: true });
  });

  it("resolves stable Copilot IDs from fixture-backed event evidence", () => {
    const sessionId = "copilot-event-evidence";
    const baseTimestamp = Date.parse("2026-07-19T20:00:00.000Z");
    const common = {
      host: "copilot" as const,
      sessionId,
      transcriptPath: COPILOT_EVENT_FIXTURE,
      directory: testDir,
      agentName: "executor",
      agentDisplayName: "Executor",
    };

    const firstStart = processSubagentStart({
      ...common,
      timestamp: baseTimestamp,
    });
    const duplicateStart = processSubagentStart({
      ...common,
      timestamp: baseTimestamp,
    });
    const secondStart = processSubagentStart({
      ...common,
      transcriptPath: COPILOT_EVENT_FILE,
      timestamp: baseTimestamp + 250,
    });

    expect(firstStart.tracking).toMatchObject({
      agent_id: "call_fixture_agent_a",
      correlation_strategy: "host-id",
      correlation_status: "host-id",
      synthetic_correlation: false,
    });
    expect(duplicateStart.tracking).toMatchObject({
      agent_id: "call_fixture_agent_a",
      duplicate: true,
    });
    expect(secondStart.tracking).toMatchObject({
      agent_id: "call_fixture_agent_b",
      correlation_strategy: "host-id",
      correlation_status: "host-id",
    });

    const firstStop = processSubagentStop({
      ...common,
      timestamp: baseTimestamp + 5_000,
    });
    const duplicateStop = processSubagentStop({
      ...common,
      timestamp: baseTimestamp + 5_000,
    });
    processSubagentStop({
      ...common,
      transcriptPath: COPILOT_EVENT_FILE,
      timestamp: baseTimestamp + 6_000,
    });

    expect(firstStop.tracking?.agent_id).toBe("call_fixture_agent_a");
    expect(duplicateStop.tracking).toMatchObject({
      agent_id: "call_fixture_agent_a",
      duplicate: true,
    });

    const state = readTrackingState(testDir, sessionId);
    expect(state.total_spawned).toBe(2);
    expect(state.total_completed).toBe(2);
    expect(state.lifecycle_sequence).toBeUndefined();
    expect(state.agents.map((agent) => agent.agent_id).sort()).toEqual([
      "call_fixture_agent_a",
      "call_fixture_agent_b",
    ]);
    expect(state.agents.every(
      (agent) =>
        agent.id_source === "host"
        && agent.host_id_source === "event-log"
        && agent.correlation_status === "host-id",
    )).toBe(true);
  });

  it("tracks 19 parallel same-name Copilot agents without collapsing counts", () => {
    const sessionId = "copilot-parallel-19";
    const transcriptPath = join(testDir, "transcript.jsonl");
    const baseTimestamp = Date.now();
    const starts = Array.from({ length: 19 }, (_, index) => ({
      host: "copilot" as const,
      sessionId,
      transcriptPath,
      directory: testDir,
      agentName: "executor",
      agentDisplayName: "Executor",
      agentDescription: "Implement the assigned lifecycle task",
      timestamp: baseTimestamp,
      deliveryReceipt: `start-${index}`,
    }));

    let peakRunning = 0;
    for (const start of starts) {
      const output = processSubagentStart(start);
      peakRunning = Math.max(
        peakRunning,
        output.hookSpecificOutput?.agent_count ?? 0,
      );
      expect(output.tracking).toMatchObject({
        agent_name: "executor",
        correlation_strategy: "synthetic-start-id",
        correlation_status: "unavailable",
        synthetic_correlation: true,
      });
    }

    const duplicateStart = processSubagentStart(starts[0]);
    expect(duplicateStart.tracking?.duplicate).toBe(true);

    const startedState = readTrackingState(testDir, sessionId);
    const startIds = startedState.agents.map((agent) => agent.agent_id);
    expect(new Set(startIds).size).toBe(19);
    expect(startedState.total_spawned).toBe(19);
    expect(startedState.agents.filter((agent) => agent.status === "running"))
      .toHaveLength(19);
    expect(peakRunning).toBe(19);
    expect(startedState.agents[0]).toMatchObject({
      agent_name: "executor",
      agent_display_name: "Executor",
      agent_description: "Implement the assigned lifecycle task",
      id_source: "synthetic",
      correlation_status: "unavailable",
    });
    expect(startIds.every(
      (agentId) => /^[0-9a-f]{12}-[0-9a-f]{12}$/.test(agentId),
    )).toBe(true);

    const firstStop = {
      host: "copilot" as const,
      sessionId,
      transcriptPath,
      directory: testDir,
      agentName: "executor",
      agentDisplayName: "Executor",
      timestamp: baseTimestamp + 1_000,
      deliveryReceipt: "stop-0",
    };
    const firstStopOutput = processSubagentStop(firstStop);
    expect(firstStopOutput.tracking).toMatchObject({
      agent_id: startIds[0],
      correlation_strategy: "agent-name-fifo",
      synthetic_correlation: true,
    });

    const duplicateStop = processSubagentStop(firstStop);
    expect(duplicateStop.tracking).toMatchObject({
      agent_id: startIds[0],
      duplicate: true,
    });
    const afterDuplicateStop = readTrackingState(testDir, sessionId);
    expect(afterDuplicateStop.agents.find(
      (agent) => agent.agent_id === startIds[1],
    )?.status).toBe("running");

    for (let index = 1; index < starts.length; index++) {
      processSubagentStop({
        ...firstStop,
        deliveryReceipt: `stop-${index}`,
      });
    }

    const finalState = readTrackingState(testDir, sessionId);
    expect(finalState.total_spawned).toBe(19);
    expect(finalState.total_completed).toBe(19);
    expect(finalState.total_failed).toBe(0);
    expect(finalState.agents).toHaveLength(19);
    expect(finalState.agents.filter((agent) => agent.status === "running"))
      .toHaveLength(0);
    expect(finalState.agents.filter((agent) => agent.status !== "running"))
      .toHaveLength(19);
    expect(finalState.agents.every(
      (agent) =>
        agent.correlation_strategy === "agent-name-fifo"
        && agent.synthetic_correlation === true,
    )).toBe(true);
  });

  it("separates synthetic identity allocation from delivery idempotency", () => {
    const timestamp = Date.now();
    const event = {
      host: "copilot" as const,
      sessionId: "copilot-identical-deliveries",
      transcriptPath: join(testDir, "transcript.jsonl"),
      directory: testDir,
      agentName: "executor",
      agentDisplayName: "Executor",
      agentDescription: "Byte-identical same-millisecond start",
      timestamp,
    };

    const first = processSubagentStart(event);
    const second = processSubagentStart(event);
    const state = readTrackingState(testDir, event.sessionId);
    expect(state.total_spawned).toBe(2);
    expect(state.agents).toHaveLength(2);
    expect(first.tracking?.agent_id).not.toBe(second.tracking?.agent_id);

    const receiptEvent = {
      ...event,
      sessionId: "copilot-retried-delivery",
      deliveryReceipt: "stable-delivery-receipt",
    };
    processSubagentStart(receiptEvent);
    const duplicate = processSubagentStart(receiptEvent);
    const receiptState = readTrackingState(testDir, receiptEvent.sessionId);
    expect(receiptState.total_spawned).toBe(1);
    expect(receiptState.agents).toHaveLength(1);
    expect(duplicate.tracking?.duplicate).toBe(true);
  });

  it("reconciles reordered Copilot stop/start pairs idempotently", () => {
    const sessionId = "copilot-reordered";
    const transcriptPath = join(testDir, "transcript.jsonl");
    const baseTimestamp = Date.now();
    const stop = {
      host: "copilot" as const,
      sessionId,
      transcriptPath,
      directory: testDir,
      agentName: "reviewer",
      agentDisplayName: "Reviewer",
      timestamp: baseTimestamp + 100,
      deliveryReceipt: "stop-reviewer",
    };
    const start = {
      host: "copilot" as const,
      sessionId,
      transcriptPath,
      directory: testDir,
      agentName: "reviewer",
      agentDisplayName: "Reviewer",
      agentDescription: "Review the focused diff",
      timestamp: baseTimestamp,
      deliveryReceipt: "start-reviewer",
    };

    const stopOutput = processSubagentStop(stop);
    const startOutput = processSubagentStart(start);
    processSubagentStop(stop);
    processSubagentStart(start);

    const state = readTrackingState(testDir, sessionId);
    expect(state.total_spawned).toBe(1);
    expect(state.total_completed).toBe(1);
    expect(state.agents).toHaveLength(1);
    expect(state.agents[0]).toMatchObject({
      status: "completed",
      agent_name: "reviewer",
      agent_display_name: "Reviewer",
      agent_description: "Review the focused diff",
      id_source: "synthetic",
      correlation_strategy: "reordered-agent-name",
      synthetic_correlation: true,
      reordered: true,
    });
    expect(state.agents[0].agent_id)
      .toMatch(/^[0-9a-f]{12}-[0-9a-f]{12}$/);
    expect(state.agents[0].start_event_id).toBeDefined();
    expect(state.agents[0].stop_event_id).toBeDefined();
    expect(startOutput.tracking).toMatchObject({
      agent_id: stopOutput.tracking?.agent_id,
      correlation_strategy: "reordered-agent-name",
      correlation_status: "unavailable",
      synthetic_correlation: true,
      reordered: true,
    });
    const replayEvents = readReplayEvents(testDir, sessionId);
    expect(replayEvents.filter(
      (event) => event.event === "agent_reconcile",
    )).toHaveLength(1);
    expect(getReplaySummary(testDir, sessionId)).toMatchObject({
      agents_spawned: 1,
      agents_completed: 1,
      agents_failed: 0,
    });
    expect(getReplaySummary(testDir, sessionId).agents_untracked_stops)
      .toBeUndefined();
  });

  it.each([
    {
      name: "outside the reconciliation window",
      stopOffset: 31_001,
      startOffset: 0,
    },
    {
      name: "chronologically before the start",
      stopOffset: 0,
      startOffset: 1,
    },
  ])("does not reconcile a reordered stop $name", ({
    stopOffset,
    startOffset,
  }) => {
    const sessionId = `copilot-unrelated-stop-${stopOffset}`;
    const transcriptPath = join(testDir, "transcript.jsonl");
    const baseTimestamp = Date.now();

    processSubagentStop({
      host: "copilot",
      sessionId,
      transcriptPath,
      directory: testDir,
      agentName: "reviewer",
      timestamp: baseTimestamp + stopOffset,
      deliveryReceipt: `stop-${stopOffset}`,
    });
    const startOutput = processSubagentStart({
      host: "copilot",
      sessionId,
      transcriptPath,
      directory: testDir,
      agentName: "reviewer",
      timestamp: baseTimestamp + startOffset,
      deliveryReceipt: `start-${startOffset}`,
    });

    const state = readTrackingState(testDir, sessionId);
    expect(state.total_spawned).toBe(1);
    expect(state.total_completed).toBe(1);
    expect(state.agents).toHaveLength(2);
    expect(state.agents.filter((agent) => agent.status === "running"))
      .toHaveLength(1);
    expect(startOutput.tracking?.reordered).not.toBe(true);
  });

  it("keeps an expired exact-ID stop from closing a future Claude start", () => {
    const sessionId = "claude-expired-reordered-stop";
    const transcriptPath = join(testDir, "transcript.jsonl");
    const baseTimestamp = Date.now();
    const expiredStop = {
      host: "claude" as const,
      sessionId,
      transcriptPath,
      directory: testDir,
      agentId: "claude-reused-id",
      agentName: "oh-my-claudecode:executor",
      timestamp: baseTimestamp + 31_001,
    };

    processSubagentStop(expiredStop);
    processSubagentStart({
      host: "claude",
      sessionId,
      transcriptPath,
      directory: testDir,
      agentId: "claude-reused-id",
      agentName: "oh-my-claudecode:executor",
      timestamp: baseTimestamp,
    });
    const duplicate = processSubagentStop(expiredStop);

    const state = readTrackingState(testDir, sessionId);
    expect(duplicate.tracking?.duplicate).toBe(true);
    expect(state.agents.find(
      (agent) => agent.agent_id === "claude-reused-id",
    )?.status).toBe("running");
    expect(state.total_spawned).toBe(1);
    expect(state.total_completed).toBe(1);
  });

  it("uses exact Claude IDs and keeps synthetic IDs session-scoped", () => {
    const timestamp = Date.now();
    const claudeSession = "claude-normalized";
    processSubagentStart({
      host: "claude",
      sessionId: claudeSession,
      transcriptPath: join(testDir, "claude.jsonl"),
      directory: testDir,
      agentId: "claude-agent-1",
      agentName: "oh-my-claudecode:executor",
      timestamp,
    });
    const claudeStop = processSubagentStop({
      host: "claude",
      sessionId: claudeSession,
      transcriptPath: join(testDir, "claude.jsonl"),
      directory: testDir,
      agentId: "claude-agent-1",
      agentName: "oh-my-claudecode:executor",
      timestamp: timestamp + 1,
      lastAssistantMessage: "Completed with evidence.",
    });

    const claudeState = readTrackingState(testDir, claudeSession);
    expect(claudeState.agents[0]).toMatchObject({
      agent_id: "claude-agent-1",
      agent_type: "oh-my-claudecode:executor",
      id_source: "host",
      correlation_strategy: "host-id",
      synthetic_correlation: false,
      status: "completed",
      output_summary: "Completed with evidence.",
    });
    expect(claudeStop.tracking).toMatchObject({
      agent_id: "claude-agent-1",
      correlation_strategy: "host-id",
      synthetic_correlation: false,
    });

    const copilotEvent = {
      host: "copilot" as const,
      transcriptPath: join(testDir, "copilot.jsonl"),
      directory: testDir,
      agentName: "executor",
      agentDisplayName: "Executor",
      agentDescription: "Same stable event fields",
      timestamp,
    };
    processSubagentStart({ ...copilotEvent, sessionId: "synthetic-session-a" });
    processSubagentStart({ ...copilotEvent, sessionId: "synthetic-session-b" });

    const firstId = readTrackingState(
      testDir,
      "synthetic-session-a",
    ).agents[0].agent_id;
    const secondId = readTrackingState(
      testDir,
      "synthetic-session-b",
    ).agents[0].agent_id;
    expect(firstId).not.toBe(secondId);
  });
});
