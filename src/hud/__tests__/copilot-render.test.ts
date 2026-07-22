import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resetContextDisplayState } from "../elements/context.js";
import { render } from "../render.js";
import {
  DEFAULT_HUD_CONFIG,
  type HudConfig,
  type HudRenderContext,
  type StatuslineStdin,
} from "../types.js";
import { getContextPercent, getModelId, getModelName } from "../stdin.js";
import { normalizeStatuslineStdin } from "../copilot-stdin.js";

function loadFixture(): Record<string, unknown> {
  return JSON.parse(
    readFileSync(
      join(
        process.cwd(),
        "src",
        "__tests__",
        "fixtures",
        "hooks",
        "copilot-1.0.72-1",
        "statusLine.json",
      ),
      "utf8",
    ),
  ) as Record<string, unknown>;
}

function createConfig(): HudConfig {
  return {
    ...DEFAULT_HUD_CONFIG,
    elements: {
      ...DEFAULT_HUD_CONFIG.elements,
      hostname: false,
      cwd: false,
      gitRepo: false,
      gitBranch: false,
      gitStatus: false,
      omcLabel: false,
      model: true,
      showEnterpriseCost: false,
      rateLimits: true,
      permissionStatus: false,
      thinking: false,
      showTokens: false,
      promptTime: false,
      sessionHealth: false,
      ralph: false,
      autopilot: false,
      prdStory: false,
      activeSkills: false,
      lastSkill: false,
      contextBar: true,
      agents: false,
      backgroundTasks: false,
      todos: false,
      showCallCounts: false,
      apiKeySource: false,
      profile: false,
      updateNotification: false,
      sessionSummary: false,
      showLastTool: false,
    },
  };
}

function createContext(stdin: StatuslineStdin): HudRenderContext {
  return {
    contextPercent: getContextPercent(stdin),
    contextAvailable: stdin.context_window !== undefined,
    modelName: getModelName(stdin),
    modelId: getModelId(stdin),
    ralph: null,
    ultrawork: null,
    prd: null,
    autopilot: null,
    activeAgents: [],
    todos: [],
    backgroundTasks: [],
    cwd: stdin.cwd ?? process.cwd(),
    lastSkill: null,
    rateLimitsResult: null,
    customBuckets: null,
    pendingPermission: null,
    thinkingState: null,
    sessionHealth: null,
    omcVersion: null,
    updateAvailable: null,
    toolCallCount: 0,
    agentCallCount: 0,
    skillCallCount: 0,
    promptTime: null,
    apiKeySource: null,
    profileName: null,
    sessionSummary: null,
  };
}

describe("Copilot HUD rendering", () => {
  it("renders only normalized fields present in the captured statusLine fixture", async () => {
    resetContextDisplayState();
    const stdin = normalizeStatuslineStdin(loadFixture());
    const output = await render(createContext(stdin), createConfig());

    expect(output).toContain("Model: <model-name>");
    expect(output).toContain("ctx:");
    expect(output).toContain("0%");
    expect(output).not.toContain("usage:");
    expect(output).not.toContain("5h:");
    expect(output).not.toContain("week:");
  });

  it("omits model and context elements when Copilot did not provide them", async () => {
    resetContextDisplayState();
    const stdin = normalizeStatuslineStdin({
      version: "1.0.72-1",
      workspace: { current_dir: "<cwd>" },
      ai_used: { total_nano_aiu: 0, formatted: "0" },
    });
    const output = await render(createContext(stdin), createConfig());

    expect(output).not.toContain("model:");
    expect(output).not.toContain("ctx:");
  });
});
