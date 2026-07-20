import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { buildSync } from "esbuild";

const repoRoot = process.cwd();
const scriptPath = resolve(process.cwd(), "scripts/subagent-tracker.mjs");
const loaderPath = resolve(
  process.cwd(),
  "scripts/lib/hook-runtime-loader.mjs",
);
const stdinPath = resolve(process.cwd(), "scripts/lib/stdin.mjs");
const copilotEventFixture = resolve(
  process.cwd(),
  "src",
  "hooks",
  "subagent-tracker",
  "__tests__",
  "fixtures",
  "copilot-session",
);

let fixtureRoot: string;
let fixtureScriptPath: string;
let fixtureWorkspace: string;

beforeAll(() => {
  fixtureRoot = mkdtempSync(join(tmpdir(), "subagent-script-fixture-"));
  fixtureScriptPath = join(fixtureRoot, "scripts", "subagent-tracker.mjs");
  fixtureWorkspace = join(fixtureRoot, "workspace");
  mkdirSync(dirname(fixtureScriptPath), { recursive: true });
  mkdirSync(join(fixtureRoot, "scripts", "lib"), { recursive: true });
  mkdirSync(fixtureWorkspace, { recursive: true });
  copyFileSync(scriptPath, fixtureScriptPath);
  copyFileSync(
    loaderPath,
    join(fixtureRoot, "scripts", "lib", "hook-runtime-loader.mjs"),
  );
  copyFileSync(
    stdinPath,
    join(fixtureRoot, "scripts", "lib", "stdin.mjs"),
  );
  writeFileSync(
    join(fixtureRoot, "package.json"),
    JSON.stringify({ type: "module" }),
  );

  buildSync({
    entryPoints: [
      join(repoRoot, "src", "hooks", "hook-runtime-entry.ts"),
    ],
    bundle: true,
    platform: "node",
    target: "node20",
    format: "cjs",
    outfile: join(fixtureRoot, "bridge", "hook-runtime.cjs"),
    logLevel: "silent",
  });
  buildSync({
    entryPoints: [
      join(repoRoot, "src", "hooks", "subagent-tracker", "index.ts"),
    ],
    bundle: true,
    platform: "node",
    target: "node20",
    format: "esm",
    outfile: join(
      fixtureRoot,
      "dist",
      "hooks",
      "subagent-tracker",
      "index.js",
    ),
    logLevel: "silent",
  });
});

afterAll(() => {
  rmSync(fixtureRoot, { recursive: true, force: true });
});

function runTrackerWithSkip(action: "start" | "stop", skipHooks: string): unknown {
  const stdout = execFileSync(process.execPath, [scriptPath, action], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      OMC_SKIP_HOOKS: skipHooks,
    },
    input: "",
    encoding: "utf8",
  });

  return JSON.parse(stdout.trim());
}

function runFixtureTracker(
  action: "start" | "stop",
  payload: Record<string, unknown>,
  env: Record<string, string> = {},
): Promise<{
  output: Record<string, unknown>;
  stderr: string;
}> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(
      process.execPath,
      [fixtureScriptPath, action],
      {
        cwd: fixtureWorkspace,
        env: {
          ...process.env,
          DISABLE_OMC: "",
          OMC_SKIP_HOOKS: "",
          ...env,
        },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", rejectRun);
    child.once("close", (code) => {
      if (code !== 0) {
        rejectRun(new Error(
          `subagent tracker exited ${String(code)}: ${stderr}`,
        ));
        return;
      }
      try {
        resolveRun({
          output: JSON.parse(stdout.trim()) as Record<string, unknown>,
          stderr,
        });
      } catch (error) {
        rejectRun(error);
      }
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

function readFixtureState(sessionId: string): {
  agents: Array<{
    agent_id: string;
    status: string;
    correlation_strategy?: string;
    synthetic_correlation?: boolean;
  }>;
  total_spawned: number;
  total_completed: number;
  total_failed: number;
} {
  const statePath = join(
    fixtureWorkspace,
    ".omc",
    "state",
    "sessions",
    sessionId,
    "subagent-tracking-state.json",
  );
  return JSON.parse(readFileSync(statePath, "utf8")) as {
    agents: Array<{
      agent_id: string;
      status: string;
      correlation_strategy?: string;
      synthetic_correlation?: boolean;
    }>;
    total_spawned: number;
    total_completed: number;
    total_failed: number;
  };
}

function readFixtureMissionState(sessionId: string): {
  missions: Array<{
    agents: Array<{ ownership?: string; status: string }>;
    taskCounts: {
      total: number;
      inProgress: number;
      completed: number;
    };
  }>;
} {
  const statePath = join(
    fixtureWorkspace,
    ".omc",
    "state",
    "sessions",
    sessionId,
    "mission-state.json",
  );
  return JSON.parse(readFileSync(statePath, "utf8")) as {
    missions: Array<{
      agents: Array<{ ownership?: string; status: string }>;
      taskCounts: {
        total: number;
        inProgress: number;
        completed: number;
      };
    }>;
  };
}

function createFailureFixture(options: {
  runtimeSource?: string;
  trackerSource: string;
}): {
  root: string;
  script: string;
  workspace: string;
} {
  const root = mkdtempSync(join(tmpdir(), "subagent-script-failure-"));
  const script = join(root, "scripts", "subagent-tracker.mjs");
  const workspace = join(root, "workspace");
  mkdirSync(join(root, "scripts", "lib"), { recursive: true });
  mkdirSync(join(root, "bridge"), { recursive: true });
  mkdirSync(join(root, "dist", "hooks", "subagent-tracker"), {
    recursive: true,
  });
  mkdirSync(workspace, { recursive: true });
  copyFileSync(scriptPath, script);
  copyFileSync(
    loaderPath,
    join(root, "scripts", "lib", "hook-runtime-loader.mjs"),
  );
  copyFileSync(
    stdinPath,
    join(root, "scripts", "lib", "stdin.mjs"),
  );
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ type: "module" }),
  );
  if (options.runtimeSource) {
    writeFileSync(
      join(root, "bridge", "hook-runtime.cjs"),
      options.runtimeSource,
    );
  } else {
    copyFileSync(
      join(fixtureRoot, "bridge", "hook-runtime.cjs"),
      join(root, "bridge", "hook-runtime.cjs"),
    );
  }
  writeFileSync(
    join(root, "dist", "hooks", "subagent-tracker", "index.js"),
    options.trackerSource,
  );
  return { root, script, workspace };
}

function runScriptFixture(
  script: string,
  workspace: string,
  action: "start" | "stop",
  input: string,
): {
  output: Record<string, unknown>;
  stderr: string;
} {
  const result = spawnSync(process.execPath, [script, action], {
    cwd: workspace,
    env: {
      ...process.env,
      DISABLE_OMC: "",
      OMC_SKIP_HOOKS: "",
    },
    input,
    encoding: "utf8",
  });
  expect(result.status).toBe(0);
  return {
    output: JSON.parse(result.stdout.trim()) as Record<string, unknown>,
    stderr: result.stderr,
  };
}

describe("subagent-tracker script skip guard", () => {
  it("honors the subagent-stop skip token before reading or importing hook logic", () => {
    expect(runTrackerWithSkip("stop", "keyword-detector, subagent-stop")).toEqual({
      continue: true,
      suppressOutput: true,
    });
  });

  it("honors the umbrella subagent-tracker skip token", () => {
    expect(runTrackerWithSkip("start", "subagent-tracker")).toEqual({
      continue: true,
      suppressOutput: true,
    });
  });

  it("uses only the canonical runtime adapter and encoder in production", () => {
    const source = readFileSync(scriptPath, "utf8");
    expect(source).toContain("loadHookRuntime()");
    expect(source).toContain("runtime.runHookJson(");
    expect(source).toContain("runtime.buildLegacyProcessorInput(");
    expect(source).toContain("runtime.encodeHookOutput(");
    expect(source).not.toContain("JSON.parse(input)");
  });

  it("surfaces a visible optional fail-open diagnostic when the bundle is missing", () => {
    const root = mkdtempSync(join(tmpdir(), "subagent-script-no-runtime-"));
    const missingRuntimeScript = join(
      root,
      "scripts",
      "subagent-tracker.mjs",
    );
    mkdirSync(join(root, "scripts", "lib"), { recursive: true });
    copyFileSync(scriptPath, missingRuntimeScript);
    copyFileSync(
      loaderPath,
      join(root, "scripts", "lib", "hook-runtime-loader.mjs"),
    );
    copyFileSync(
      stdinPath,
      join(root, "scripts", "lib", "stdin.mjs"),
    );

    try {
      const result = spawnSync(
        process.execPath,
        [missingRuntimeScript, "start"],
        {
          input: JSON.stringify({
            sessionId: "missing-runtime",
            cwd: root,
            agentName: "executor",
            timestamp: Date.now(),
          }),
          encoding: "utf8",
        },
      );

      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout.trim())).toEqual({ continue: true });
      expect(result.stderr).toContain("[subagent-start]");
      expect(result.stderr).toContain(
        "continuing without optional hook behavior",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails open visibly when canonical input normalization rejects a stop", () => {
    const result = runScriptFixture(
      fixtureScriptPath,
      fixtureWorkspace,
      "stop",
      "{",
    );

    expect(result.output).toEqual({ continue: true });
    expect(result.output).not.toHaveProperty("decision");
    expect(result.stderr).toContain("[subagent-stop]");
    expect(result.stderr).toContain(
      "continuing without optional hook behavior",
    );
  });

  it("fails open visibly when the canonical processor adapter rejects a stop", () => {
    const fixture = createFailureFixture({
      trackerSource: `
        export function processSubagentStart() {
          throw new Error("processor exploded");
        }
        export function processSubagentStop() {
          throw new Error("processor exploded");
        }
      `,
    });

    try {
      const result = runScriptFixture(
        fixture.script,
        fixture.workspace,
        "stop",
        JSON.stringify({
          sessionId: "processor-failure",
          cwd: fixture.workspace,
          agentName: "executor",
          timestamp: Date.now(),
        }),
      );

      expect(result.output).toEqual({ continue: true });
      expect(result.output).not.toHaveProperty("decision");
      expect(result.stderr).toContain("processor exploded");
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it("fails open visibly instead of encoding a reduction failure as a stop block", () => {
    const fixture = createFailureFixture({
      trackerSource: `
        export function processSubagentStart() {
          return { continue: true };
        }
        export function processSubagentStop() {
          return { continue: true };
        }
      `,
      runtimeSource: `
        const noop = () => ({});
        module.exports = {
          normalizeHookEnvelope: noop,
          runHookPayload: noop,
          runHookJson: async () => ({
            envelope: { issues: [] },
            evaluations: [],
            reduction: {
              decision: "deny",
              reason: "synthetic reduction failure",
              callDecisions: [{
                source: "adapter",
                decision: "deny",
                reason: "synthetic reduction failure"
              }]
            }
          }),
          reduceHookEvaluations: noop,
          encodeHookOutput: () => ({ decision: "block" }),
          buildLegacyProcessorInput: noop,
          normalizeLegacyHookInput: noop,
          adaptLegacyHookOutput: noop
        };
      `,
    });

    try {
      const result = runScriptFixture(
        fixture.script,
        fixture.workspace,
        "stop",
        JSON.stringify({
          sessionId: "reduction-failure",
          cwd: fixture.workspace,
          agentName: "executor",
          timestamp: Date.now(),
        }),
      );

      expect(result.output).toEqual({ continue: true });
      expect(result.output).not.toHaveProperty("decision");
      expect(result.stderr).toContain("synthetic reduction failure");
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it("uses Copilot event-log IDs for subprocess identity and idempotency", async () => {
    const sessionId = "script-event-evidence";
    const baseTimestamp = Date.parse("2026-07-19T20:00:00.000Z");
    const common = {
      sessionId,
      transcriptPath: copilotEventFixture,
      cwd: fixtureWorkspace,
      agentName: "executor",
      agentDisplayName: "Executor",
    };

    await runFixtureTracker("start", {
      ...common,
      timestamp: baseTimestamp,
    });
    await runFixtureTracker("start", {
      ...common,
      timestamp: baseTimestamp,
    });
    await runFixtureTracker("start", {
      ...common,
      timestamp: baseTimestamp + 250,
    });

    const started = readFixtureState(sessionId);
    expect(started.total_spawned).toBe(2);
    expect(started.agents.map((agent) => agent.agent_id).sort()).toEqual([
      "call_fixture_agent_a",
      "call_fixture_agent_b",
    ]);

    await runFixtureTracker("stop", {
      ...common,
      timestamp: baseTimestamp + 5_000,
    });
    await runFixtureTracker("stop", {
      ...common,
      timestamp: baseTimestamp + 5_000,
    });
    await runFixtureTracker("stop", {
      ...common,
      timestamp: baseTimestamp + 6_000,
    });

    const completed = readFixtureState(sessionId);
    expect(completed.total_spawned).toBe(2);
    expect(completed.total_completed).toBe(2);
    expect(completed.agents.every(
      (agent) => agent.status === "completed",
    )).toBe(true);
  });

  it("preserves all 19 same-name Copilot lifecycles through subprocesses", async () => {
    const sessionId = "script-copilot-19";
    const transcriptPath = join(fixtureWorkspace, "transcript.jsonl");
    const baseTimestamp = Date.now();
    let peakRunning = 0;

    const startResults = await Promise.all(
      Array.from({ length: 19 }, (_, index) =>
        runFixtureTracker("start", {
          sessionId,
          transcriptPath,
          cwd: fixtureWorkspace,
          agentName: "executor",
          agentDisplayName: "Executor",
          agentDescription: "Same-name parallel lifecycle",
          timestamp: baseTimestamp,
        }, {
          OMC_HOOK_DELIVERY_RECEIPT: `start-${index}`,
        }),
      ),
    );
    for (const { output, stderr } of startResults) {
      expect(stderr).toBe("");
      const context = String(output.additionalContext ?? "");
      const runningMatch = context.match(/; (\d+) agent\(s\) running$/);
      peakRunning = Math.max(
        peakRunning,
        Number(runningMatch?.[1] ?? 0),
      );
    }

    const startedState = readFixtureState(sessionId);
    const startedMission = readFixtureMissionState(sessionId).missions[0];
    expect(new Set(
      startedState.agents.map((agent) => agent.agent_id),
    ).size).toBe(19);
    expect(startedState.agents.every(
      (agent) => /^[0-9a-f]{12}-[0-9a-f]{12}$/.test(agent.agent_id),
    )).toBe(true);
    expect(startedMission.agents).toHaveLength(19);
    expect(startedMission.taskCounts).toMatchObject({
      total: 19,
      inProgress: 19,
      completed: 0,
    });

    const stopResults = await Promise.all(
      Array.from({ length: 19 }, (_, index) =>
        runFixtureTracker("stop", {
          sessionId,
          transcriptPath,
          cwd: fixtureWorkspace,
          agentName: "executor",
          agentDisplayName: "Executor",
          timestamp: baseTimestamp + 1_000,
        }, {
          OMC_HOOK_DELIVERY_RECEIPT: `stop-${index}`,
        }),
      ),
    );
    for (const { output, stderr } of stopResults) {
      expect(output).toEqual({});
      expect(stderr).toBe("");
    }

    const state = readFixtureState(sessionId);
    const mission = readFixtureMissionState(sessionId).missions[0];

    expect(peakRunning).toBe(19);
    expect(state.total_spawned).toBe(19);
    expect(state.total_completed).toBe(19);
    expect(state.total_failed).toBe(0);
    expect(state.agents).toHaveLength(19);
    expect(state.agents.filter((agent) => agent.status === "running"))
      .toHaveLength(0);
    expect(state.agents.every(
      (agent) =>
        agent.correlation_strategy === "agent-name-fifo"
        && agent.synthetic_correlation === true,
    )).toBe(true);
    expect(mission.agents).toHaveLength(19);
    expect(mission.agents.every((agent) => agent.status === "done"))
      .toBe(true);
    expect(mission.taskCounts).toMatchObject({
      total: 19,
      inProgress: 0,
      completed: 19,
    });
  });
});
