import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const REPO_ROOT = process.cwd();
const BUILD_SCRIPT = join(REPO_ROOT, "scripts", "build-hud-runtime.mjs");
const FIXTURE_PATH = join(
  REPO_ROOT,
  "src",
  "__tests__",
  "fixtures",
  "hooks",
  "copilot-1.0.72-1",
  "statusLine.json",
);
const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("dependency-closed HUD runtime bundles", () => {
  it("builds setup and statusline entrypoints that run without node_modules", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "omc hud runtime "));
    tempRoots.push(tempRoot);
    const pluginRoot = join(tempRoot, "plugin root with spaces");
    const outdir = join(pluginRoot, "bridge");
    const scriptsLib = join(pluginRoot, "scripts", "lib");
    mkdirSync(scriptsLib, { recursive: true });
    copyFileSync(
      join(REPO_ROOT, "scripts", "lib", "hud-wrapper-template.txt"),
      join(scriptsLib, "hud-wrapper-template.txt"),
    );
    copyFileSync(
      join(REPO_ROOT, "scripts", "lib", "config-dir.mjs"),
      join(scriptsLib, "config-dir.mjs"),
    );
    writeFileSync(
      join(pluginRoot, "package.json"),
      '{"name":"oh-my-claude-sisyphus","version":"0.0.0-test","type":"module"}\n',
    );
    writeFileSync(
      join(pluginRoot, "plugin.json"),
      '{"name":"oh-my-claudecode"}\n',
    );

    const build = spawnSync(
      process.execPath,
      [BUILD_SCRIPT, "--outdir", outdir],
      { cwd: REPO_ROOT, encoding: "utf8" },
    );
    expect(build.status, build.stderr).toBe(0);

    const runtimePath = join(outdir, "hud-runtime.mjs");
    const setupPath = join(outdir, "copilot-hud-setup.mjs");
    expect(existsSync(runtimePath)).toBe(true);
    expect(existsSync(setupPath)).toBe(true);
    expect(existsSync(join(pluginRoot, "node_modules"))).toBe(false);
    for (const artifact of [runtimePath, setupPath]) {
      expect(readFileSync(artifact, "utf8")).not.toMatch(
        /(?:from\s+["']jsonc-parser["']|require\(["']jsonc-parser["']\))/,
      );
    }

    const copilotHome = join(tempRoot, "copilot home with spaces");
    const emptyNodeModules = join(tempRoot, "empty-node-modules");
    const staleRoot = join(tempRoot, "stale plugin root");
    mkdirSync(copilotHome, { recursive: true });
    mkdirSync(emptyNodeModules);
    mkdirSync(join(staleRoot, "bridge"), { recursive: true });
    writeFileSync(
      join(staleRoot, "bridge", "hud-runtime.mjs"),
      'process.stdout.write("STALE_RUNTIME");\n',
    );
    const env = {
      ...process.env,
      COPILOT_HOME: copilotHome,
      HOME: tempRoot,
      NODE_PATH: emptyNodeModules,
      OMC_PLUGIN_ROOT: staleRoot,
      OMC_HUD_DISABLE_NPM_FALLBACK: "1",
    };
    const setup = spawnSync(
      process.execPath,
      [setupPath, "setup", "--json"],
      { cwd: tempRoot, encoding: "utf8", env },
    );
    expect(setup.status, setup.stderr).toBe(0);
    const setupResult = JSON.parse(setup.stdout) as {
      pluginRoot: string;
      runtimePath: string;
      wrapperPath: string;
    };
    expect(setupResult.pluginRoot).toBe(pluginRoot);
    expect(setupResult.runtimePath).toBe(runtimePath);

    const settingsPath = join(copilotHome, "settings.json");
    const settings = JSON.parse(readFileSync(settingsPath, "utf8")) as {
      omcHud?: Record<string, unknown>;
    };
    settings.omcHud = {
      elements: {
        rateLimits: false,
        updateNotification: false,
        sessionSummary: false,
        missionBoard: false,
      },
    };
    writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);

    const workspace = join(tempRoot, "isolated workspace");
    mkdirSync(workspace);
    const payload = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as {
      workspace: { current_dir: string };
      transcript_path: string;
    };
    payload.workspace.current_dir = workspace;
    payload.transcript_path = join(workspace, "missing-transcript.jsonl");
    const render = spawnSync(
      process.execPath,
      [setupResult.wrapperPath],
      {
        cwd: workspace,
        encoding: "utf8",
        env,
        input: JSON.stringify(payload),
        timeout: 15_000,
      },
    );

    expect(render.status, render.stderr).toBe(0);
    expect(render.stdout).toContain("<model-name>");
    expect(render.stdout).not.toContain("STALE_RUNTIME");
    expect(render.stderr).not.toMatch(/MODULE_NOT_FOUND|ERR_MODULE_NOT_FOUND/);
  });
});
