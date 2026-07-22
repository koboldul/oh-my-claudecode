import { execFileSync } from "node:child_process";
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
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { parseJsonc } from "../../utils/jsonc.js";
import {
  configureCopilotHud,
  inspectCopilotHud,
} from "../copilot-setup.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(__dirname, "..", "..", "..");
const tempDirs: string[] = [];

function stagePluginRoot(pluginRoot: string, runtimeSource = "export {};\n"): void {
  mkdirSync(join(pluginRoot, "bridge"), { recursive: true });
  mkdirSync(join(pluginRoot, "scripts", "lib"), { recursive: true });
  writeFileSync(join(pluginRoot, "package.json"), '{"type":"module"}\n');
  writeFileSync(join(pluginRoot, "plugin.json"), '{"name":"oh-my-claudecode"}\n');
  writeFileSync(join(pluginRoot, "bridge", "hud-runtime.mjs"), runtimeSource);
  copyFileSync(
    join(packageRoot, "scripts", "lib", "hud-wrapper-template.txt"),
    join(pluginRoot, "scripts", "lib", "hud-wrapper-template.txt"),
  );
  copyFileSync(
    join(packageRoot, "scripts", "lib", "config-dir.mjs"),
    join(pluginRoot, "scripts", "lib", "config-dir.mjs"),
  );
}

function createCopilotHome(prefix = "omc-copilot-hud-"): {
  home: string;
  pluginRoot: string;
} {
  const home = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(home);
  const pluginRoot = join(
    home,
    "installed-plugins",
    "omc",
    "oh-my-claudecode",
  );
  stagePluginRoot(pluginRoot);
  return { home, pluginRoot };
}

function stageGenericWrapper(home: string): string {
  const wrapperPath = join(home, "hud", "omc-hud.mjs");
  mkdirSync(join(home, "hud", "lib"), { recursive: true });
  copyFileSync(
    join(packageRoot, "scripts", "lib", "hud-wrapper-template.txt"),
    wrapperPath,
  );
  copyFileSync(
    join(packageRoot, "scripts", "lib", "config-dir.mjs"),
    join(home, "hud", "lib", "config-dir.mjs"),
  );
  return wrapperPath;
}

function runWrapper(
  wrapperPath: string,
  home: string,
  env: NodeJS.ProcessEnv = {},
): string {
  return execFileSync(process.execPath, [wrapperPath], {
    cwd: home,
    env: {
      ...process.env,
      COPILOT_HOME: home,
      OMC_HUD_DISABLE_NPM_FALLBACK: "1",
      OMC_PLUGIN_ROOT: "",
      CLAUDE_PLUGIN_ROOT: "",
      ...env,
    },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

afterEach(() => {
  delete process.env.COPILOT_HOME;
  delete process.env.CLAUDE_CONFIG_DIR;
  while (tempDirs.length > 0) {
    const path = tempDirs.pop();
    if (path) rmSync(path, { recursive: true, force: true });
  }
});

describe("native Copilot HUD setup", () => {
  it("preserves JSONC comments and unknown keys and is byte-idempotent", () => {
    const { home } = createCopilotHome();
    const settingsPath = join(home, "settings.json");
    writeFileSync(
      settingsPath,
      `{
  // keep this comment
  "theme": "dark",
  "unknown": { "nested": true },
}
`,
    );

    const first = configureCopilotHud({
      copilotHome: home,
      packageRoot: join(
        home,
        "installed-plugins",
        "omc",
        "oh-my-claudecode",
      ),
      nodePath: process.execPath,
    });
    const afterFirst = readFileSync(settingsPath, "utf8");
    const parsed = parseJsonc(afterFirst) as Record<string, unknown>;

    expect(first.changed).toBe(true);
    expect(first.configured).toBe(true);
    expect(afterFirst).toContain("// keep this comment");
    expect(parsed.theme).toBe("dark");
    expect(parsed.unknown).toEqual({ nested: true });
    expect(parsed.statusLine).toEqual({
      type: "command",
      command: first.expectedCommand,
    });

    const second = configureCopilotHud({
      copilotHome: home,
      packageRoot: first.pluginRoot,
      nodePath: process.execPath,
    });

    expect(second.changed).toBe(false);
    expect(readFileSync(settingsPath, "utf8")).toBe(afterFirst);
  });

  it("refuses a third-party statusLine until replacement is explicit", () => {
    const { home } = createCopilotHome();
    const settingsPath = join(home, "settings.json");
    const original = `{
  // owned elsewhere
  "statusLine": {
    "type": "command",
    "command": "third-party-status"
  }
}
`;
    writeFileSync(settingsPath, original);

    const refused = configureCopilotHud({
      copilotHome: home,
      packageRoot: join(
        home,
        "installed-plugins",
        "omc",
        "oh-my-claudecode",
      ),
    });

    expect(refused.changed).toBe(false);
    expect(refused.ownership).toBe("third-party");
    expect(refused.diagnostic).toContain("explicitly approves");
    expect(readFileSync(settingsPath, "utf8")).toBe(original);
    expect(existsSync(join(home, "hud", "omc-hud.mjs"))).toBe(false);

    const replaced = configureCopilotHud({
      copilotHome: home,
      packageRoot: refused.pluginRoot,
      replaceExisting: true,
    });

    expect(replaced.changed).toBe(true);
    expect(replaced.replacedThirdParty).toBe(true);
    expect(replaced.ownership).toBe("omc");
  });

  it("repairs an OMC-owned entry without deleting nested unknown keys", () => {
    const { home } = createCopilotHome();
    const settingsPath = join(home, "settings.json");
    writeFileSync(
      settingsPath,
      `{
  "statusLine": {
    // keep OMC metadata
    "type": "command",
    "command": "node /old/path/omc-hud.mjs",
    "keep": "metadata"
  }
}
`,
    );

    const result = configureCopilotHud({
      copilotHome: home,
      packageRoot: join(
        home,
        "installed-plugins",
        "omc",
        "oh-my-claudecode",
      ),
    });
    const content = readFileSync(settingsPath, "utf8");
    const settings = parseJsonc(content) as {
      statusLine: Record<string, unknown>;
    };

    expect(result.changed).toBe(true);
    expect(content).toContain("// keep OMC metadata");
    expect(settings.statusLine.keep).toBe("metadata");
    expect(settings.statusLine.command).toBe(result.expectedCommand);
  });

  it("uses only COPILOT_HOME and never writes the Claude config", () => {
    const { home } = createCopilotHome("omc-isolated-copilot-");
    const claudeHome = mkdtempSync(join(tmpdir(), "omc-isolated-claude-"));
    tempDirs.push(claudeHome);
    const claudeSettings = join(claudeHome, "settings.json");
    writeFileSync(claudeSettings, '{"sentinel":"claude"}\n');
    process.env.COPILOT_HOME = home;
    process.env.CLAUDE_CONFIG_DIR = claudeHome;

    const result = configureCopilotHud({
      packageRoot: join(
        home,
        "installed-plugins",
        "omc",
        "oh-my-claudecode",
      ),
    });

    expect(result.copilotHome).toBe(home);
    expect(result.settingsPath).toBe(join(home, "settings.json"));
    expect(readFileSync(claudeSettings, "utf8")).toBe(
      '{"sentinel":"claude"}\n',
    );
    expect(existsSync(join(home, "settings.json"))).toBe(true);
  });

  it("quotes paths with spaces and the wrapper resolves the installed Copilot plugin", () => {
    const { home, pluginRoot } = createCopilotHome("omc copilot hud ");
    const sentinelPath = join(home, "wrapper-result.json");
    writeFileSync(
      join(pluginRoot, "bridge", "hud-runtime.mjs"),
      `import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(sentinelPath)}, JSON.stringify({
  host: process.env.OMC_HOST,
  configDir: process.env.CLAUDE_CONFIG_DIR
}));
`,
    );

    const result = configureCopilotHud({
      copilotHome: home,
      packageRoot: pluginRoot,
      nodePath: process.execPath,
    });

    expect(result.expectedCommand).toContain(`"${process.execPath.replace(/\\/g, "/")}"`);
    expect(result.expectedCommand).toContain(`"${result.wrapperPath.replace(/\\/g, "/")}"`);

    execFileSync(process.execPath, [result.wrapperPath], {
      cwd: home,
      env: {
        ...process.env,
        COPILOT_HOME: home,
        OMC_HUD_DISABLE_NPM_FALLBACK: "1",
        OMC_PLUGIN_ROOT: "",
        CLAUDE_PLUGIN_ROOT: "",
      },
      stdio: "pipe",
    });

    expect(JSON.parse(readFileSync(sentinelPath, "utf8"))).toEqual({
      host: "copilot",
      configDir: home,
    });

    const wrapper = readFileSync(result.wrapperPath, "utf8");
    expect(wrapper).toContain(`const configuredPluginRoot = ${JSON.stringify(pluginRoot)};`);
    expect(wrapper).toContain('"bridge", "hud-runtime.mjs"');
    expect(wrapper).not.toMatch(/qterm/i);
    expect(wrapper).not.toMatch(/manual integration/i);
  });

  it("status inspection diagnoses missing runtime without mutation", () => {
    const { home, pluginRoot } = createCopilotHome();
    rmSync(join(pluginRoot, "bridge", "hud-runtime.mjs"));

    const status = inspectCopilotHud({
      copilotHome: home,
      packageRoot: pluginRoot,
    });

    expect(status.runtimeAvailable).toBe(false);
    expect(status.needsRepair).toBe(true);
    expect(status.diagnostic).toContain("runtime is missing");
    expect(existsSync(join(home, "settings.json"))).toBe(false);
  });

  it("prefers custom marketplace metadata over stale environment roots", () => {
    const home = mkdtempSync(join(tmpdir(), "omc-custom-marketplace-"));
    tempDirs.push(home);
    const customRoot = join(home, "installed-plugins", "custom market", "oh-my-claudecode");
    const staleRoot = join(home, "stale env root");
    stagePluginRoot(customRoot, 'process.stdout.write("CUSTOM_MARKETPLACE");\n');
    stagePluginRoot(staleRoot, 'process.stdout.write("STALE_ENV");\n');
    writeFileSync(
      join(home, "config.json"),
      `{
  // Copilot metadata is authoritative
  "installedPlugins": [{
    "name": "oh-my-claudecode",
    "marketplace": "custom market",
    "cache_path": ${JSON.stringify(customRoot)},
  }],
}
`,
    );

    const output = runWrapper(stageGenericWrapper(home), home, {
      OMC_PLUGIN_ROOT: staleRoot,
    });

    expect(output).toBe("CUSTOM_MARKETPLACE");
  });

  it("resolves direct-install metadata", () => {
    const home = mkdtempSync(join(tmpdir(), "omc-direct-install-"));
    tempDirs.push(home);
    const directRoot = join(
      home,
      "installed-plugins",
      "_direct",
      "koboldul--oh-my-claudecode",
    );
    stagePluginRoot(directRoot, 'process.stdout.write("DIRECT_INSTALL");\n');
    writeFileSync(
      join(home, "config.json"),
      JSON.stringify({
        installedPlugins: [{
          name: "oh-my-claudecode",
          marketplace: "",
          cache_path: directRoot,
        }],
      }),
    );

    expect(runWrapper(stageGenericWrapper(home), home)).toBe("DIRECT_INSTALL");
  });

  it("uses the canonical default marketplace path only as the final fallback", () => {
    const { home, pluginRoot } = createCopilotHome("omc-default-marketplace-");
    writeFileSync(
      join(pluginRoot, "bridge", "hud-runtime.mjs"),
      'process.stdout.write("DEFAULT_MARKETPLACE");\n',
    );

    expect(runWrapper(stageGenericWrapper(home), home)).toBe(
      "DEFAULT_MARKETPLACE",
    );
  });

  it("embeds an explicit local plugin root ahead of metadata and stale env", () => {
    const home = mkdtempSync(join(tmpdir(), "omc-local-plugin-home-"));
    tempDirs.push(home);
    const localRoot = join(home, "local plugin root with spaces");
    const metadataRoot = join(home, "installed-plugins", "custom", "oh-my-claudecode");
    const staleRoot = join(home, "stale environment");
    stagePluginRoot(localRoot, 'process.stdout.write("LOCAL_PLUGIN_ROOT");\n');
    stagePluginRoot(metadataRoot, 'process.stdout.write("METADATA_ROOT");\n');
    stagePluginRoot(staleRoot, 'process.stdout.write("STALE_ENV");\n');
    writeFileSync(
      join(home, "config.json"),
      JSON.stringify({
        installedPlugins: [{
          name: "oh-my-claudecode",
          marketplace: "custom",
          cache_path: metadataRoot,
        }],
      }),
    );
    const setup = configureCopilotHud({
      copilotHome: home,
      packageRoot: localRoot,
    });

    expect(runWrapper(setup.wrapperPath, home, {
      OMC_PLUGIN_ROOT: staleRoot,
    })).toBe("LOCAL_PLUGIN_ROOT");
  });

  it("infers a wrapper-colocated plugin root before installed metadata", () => {
    const home = mkdtempSync(join(tmpdir(), "omc-colocated-plugin-home-"));
    tempDirs.push(home);
    const colocatedRoot = join(home, "local checkout");
    const metadataRoot = join(home, "installed-plugins", "custom", "oh-my-claudecode");
    stagePluginRoot(colocatedRoot, 'process.stdout.write("COLOCATED_ROOT");\n');
    stagePluginRoot(metadataRoot, 'process.stdout.write("METADATA_ROOT");\n');
    writeFileSync(
      join(home, "config.json"),
      JSON.stringify({
        installedPlugins: [{
          name: "oh-my-claudecode",
          marketplace: "custom",
          cache_path: metadataRoot,
        }],
      }),
    );
    const wrapperPath = join(colocatedRoot, "hud", "omc-hud.mjs");
    mkdirSync(join(colocatedRoot, "hud", "lib"), { recursive: true });
    copyFileSync(
      join(packageRoot, "scripts", "lib", "hud-wrapper-template.txt"),
      wrapperPath,
    );
    copyFileSync(
      join(packageRoot, "scripts", "lib", "config-dir.mjs"),
      join(colocatedRoot, "hud", "lib", "config-dir.mjs"),
    );

    expect(runWrapper(wrapperPath, home, {
      OMC_HOST: "copilot",
      CLAUDE_CONFIG_DIR: "",
    })).toBe("COLOCATED_ROOT");
  });
});
