import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { getConfigPaths } from "../config/loader.js";
import { getDeepInterviewSettingsPaths } from "../features/builtin-skills/skills.js";
import { getSkillsDir as getLearnerSkillsDir } from "../hooks/learner/finder.js";
import {
  getLegacyOpenClawConfigPath,
  getNotificationConfigPath,
} from "../notifications/config.js";
import { getHookNotificationConfigPath } from "../notifications/hook-config.js";
import { getClaudeConfigDir } from "../utils/config-dir.js";

const ROOT = process.cwd();
const GENERATOR = join(ROOT, "scripts", "generate-copilot-prompts.mjs");
const INVENTORY_PATH = join(
  ROOT,
  "prompt-assets",
  "copilot-capability-matrix.json",
);

type SkillEntry = {
  id: string;
  source: string;
  output: string;
  intendedOutcome: string;
  claudeMechanism: string;
  copilotMechanism: string;
  automatedEvidence: string;
  liveEvidenceRequired: boolean;
  aliases: string[];
  bodyStrategy: string;
  transformations: string[];
  copySupportFiles?: boolean;
  supportFileModes?: Record<string, "100644" | "100755">;
  supportFileChannels?: Record<
    string,
    {
      gitMode: "100755";
      npmTarMode: "0644-or-0755";
      requiredInvocation: 'bash "$VALIDATE_SH"';
      windowsRequirement: string;
    }
  >;
};

type CommandEntry = {
  id: string;
  source: string;
  output: string;
  intendedOutcome: string;
  claudeMechanism: string;
  copilotMechanism: string;
  automatedEvidence: string;
  liveEvidenceRequired: boolean;
  commandOnly: boolean;
  commandMode: "dispatch" | "alias" | "compact";
  targetSkill: string | null;
};

type AliasEntry = {
  id: string;
  targetSkill: string;
  source: string;
  output: string;
  wrapperMode: "command" | "generated";
  description: string;
  intendedOutcome: string;
  automatedEvidence: string;
};

type CapabilityMatrix = {
  schemaVersion: number;
  host: string;
  sourceHost: string;
  generator: string;
  skills: SkillEntry[];
  aliases: AliasEntry[];
  commands: CommandEntry[];
};

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function walkFiles(root: string): string[] {
  return readdirSync(root)
    .flatMap((name) => {
      const path = join(root, name);
      return statSync(path).isDirectory() ? walkFiles(path) : [path];
    })
    .sort();
}

function relativePath(path: string): string {
  return relative(ROOT, path).replace(/\\/g, "/");
}

function normalizedPath(path: string): string {
  return path.replace(/\\/g, "/");
}

let gitIndexModes: Map<string, string> | null = null;

function loadGitIndexModes(): Map<string, string> {
  if (gitIndexModes) return gitIndexModes;
  gitIndexModes = new Map();
  try {
    const output = execFileSync(
      "git",
      [
        "ls-files",
        "--stage",
        "-z",
        "--",
        "skills",
        "commands",
        "skills-copilot",
        "commands-copilot",
      ],
      {
        cwd: ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
    for (const record of output.split("\0")) {
      const match = record.match(/^(\d{6}) [0-9a-f]+ \d\t(.+)$/);
      if (match) gitIndexModes.set(match[2].replace(/\\/g, "/"), match[1]);
    }
  } catch {
    // Isolated package fixtures may not include Git metadata.
  }
  return gitIndexModes;
}

function gitIndexMode(path: string): string | null {
  return loadGitIndexModes().get(relativePath(path)) ?? null;
}

function materializedMode(path: string): string {
  const indexed = gitIndexMode(path);
  if (indexed) return indexed;
  return statSync(path).mode & 0o111 ? "100755" : "100644";
}

function snapshotFiles(
  roots: string[],
): Record<string, { sha256: string; mode: string }> {
  return Object.fromEntries(
    roots.flatMap(walkFiles).map((path) => [
      relativePath(path),
      {
        sha256: createHash("sha256")
          .update(readFileSync(path))
          .digest("hex"),
        mode: materializedMode(path),
      },
    ]),
  );
}

function sourceDigest(path: string): string {
  const normalized = readFileSync(join(ROOT, path), "utf8")
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n");
  return createHash("sha256").update(normalized).digest("hex");
}

function validateFixtureWithGenerator(content: string): void {
  const script = `
    import { validateCopilotPromptSemantics } from ${JSON.stringify(
      pathToFileURL(GENERATOR).href,
    )};
    validateCopilotPromptSemantics(
      "fixture.md",
      process.env.OMC_PROMPT_FIXTURE,
      JSON.parse(process.env.OMC_PROMPT_SKILLS),
    );
  `;
  execFileSync(
    process.execPath,
    ["--input-type=module", "--eval", script],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        OMC_PROMPT_FIXTURE: content,
        OMC_PROMPT_SKILLS: JSON.stringify(
          matrix.skills.map((entry) => entry.id),
        ),
      },
      stdio: "pipe",
    },
  );
}

function transformTeamFixtureWithGenerator(content: string): string {
  const script = `
    import { transformCopilotTeamReference } from ${JSON.stringify(
      pathToFileURL(GENERATOR).href,
    )};
    process.stdout.write(
      transformCopilotTeamReference(process.env.OMC_PROMPT_FIXTURE),
    );
  `;
  return execFileSync(
    process.execPath,
    ["--input-type=module", "--eval", script],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        OMC_PROMPT_FIXTURE: content,
      },
      encoding: "utf8",
    },
  );
}

const matrix = readJson<CapabilityMatrix>(INVENTORY_PATH);

describe("Copilot prompt asset generation", () => {
  it("inventories every skill and command, including command-only aliases", () => {
    expect(matrix.schemaVersion).toBe(2);
    expect(matrix.host).toBe("github-copilot");
    expect(matrix.sourceHost).toBe("claude-code");
    expect(matrix.generator).toBe("scripts/generate-copilot-prompts.mjs");
    expect(matrix.skills).toHaveLength(41);
    expect(matrix.aliases).toHaveLength(4);
    expect(matrix.commands).toHaveLength(28);

    const sourceSkills = readdirSync(join(ROOT, "skills"), {
      withFileTypes: true,
    })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    const sourceCommands = readdirSync(join(ROOT, "commands"))
      .filter((file) => file.endsWith(".md"))
      .map((file) => file.replace(/\.md$/, ""))
      .sort();

    expect(matrix.skills.map((entry) => entry.id).sort()).toEqual(sourceSkills);
    expect(matrix.commands.map((entry) => entry.id).sort()).toEqual(
      sourceCommands,
    );

    for (const entry of [
      ...matrix.skills,
      ...matrix.aliases,
      ...matrix.commands,
    ]) {
      expect(entry.intendedOutcome).not.toBe("");
      expect(entry.automatedEvidence).not.toBe("");
      if ("claudeMechanism" in entry) {
        expect(entry.claudeMechanism).not.toBe("");
        expect(entry.copilotMechanism).not.toBe("");
        expect(typeof entry.liveEvidenceRequired).toBe("boolean");
      }
    }

    const publicAliases = matrix.skills
      .flatMap((entry) =>
        entry.aliases.map((alias) => [alias, entry.id] as const),
      )
      .sort(([left], [right]) => left.localeCompare(right));
    expect(
      matrix.aliases
        .map((entry) => [entry.id, entry.targetSkill] as const)
        .sort(([left], [right]) => left.localeCompare(right)),
    ).toEqual(publicAliases);

    expect(
      matrix.commands.find((entry) => entry.id === "compact"),
    ).toMatchObject({
      commandOnly: true,
      commandMode: "compact",
      targetSkill: null,
    });
    expect(matrix.commands.find((entry) => entry.id === "psm")).toMatchObject({
      commandOnly: false,
      commandMode: "alias",
      targetSkill: "project-session-manager",
    });
    expect(
      matrix.commands.find((entry) => entry.id === "learner"),
    ).toMatchObject({
      commandMode: "alias",
      targetSkill: "skillify",
    });
    expect(
      matrix.skills.find((entry) => entry.id === "project-session-manager")
        ?.aliases,
    ).toContain("psm");

    for (const entry of matrix.aliases) {
      const generated = readFileSync(join(ROOT, entry.output), "utf8");
      expect(generated).toContain(
        `skills-copilot/${entry.targetSkill}/SKILL.md`,
      );
      if (entry.wrapperMode === "command") {
        expect(
          matrix.commands.find((command) => command.id === entry.id),
        ).toMatchObject({
          commandMode: "alias",
          targetSkill: entry.targetSkill,
          source: entry.source,
          output: entry.output,
        });
      }
    }
  });

  it("routes Copilot to generated prompts while Claude stays canonical", () => {
    const claudeManifest = readJson<{
      agents: string;
      skills: string[];
      commands: string;
    }>(join(ROOT, ".claude-plugin", "plugin.json"));
    const copilotManifest = readJson<{
      agents: string;
      skills: string[];
      commands: string;
    }>(join(ROOT, "plugin.json"));

    expect(claudeManifest.agents).toBe("./agents/");
    expect(claudeManifest.commands).toBe("./commands/");
    expect([...claudeManifest.skills].sort()).toEqual(
      matrix.skills.map((entry) => `./skills/${entry.id}/`).sort(),
    );

    expect(copilotManifest.agents).toBe("./agents-copilot/");
    expect(copilotManifest.commands).toBe("./commands-copilot/");
    expect([...copilotManifest.skills].sort()).toEqual(
      matrix.skills
        .map((entry) => `./skills-copilot/${entry.id}/`)
        .sort(),
    );
  });

  it("keeps generated assets deterministic without touching canonical prompts", () => {
    const canonicalBefore = snapshotFiles([
      join(ROOT, "skills"),
      join(ROOT, "commands"),
    ]);
    const generatedBefore = snapshotFiles([
      join(ROOT, "skills-copilot"),
      join(ROOT, "commands-copilot"),
    ]);

    execFileSync(process.execPath, [GENERATOR], { cwd: ROOT });
    execFileSync(process.execPath, [GENERATOR, "--check"], { cwd: ROOT });

    expect(
      snapshotFiles([join(ROOT, "skills"), join(ROOT, "commands")]),
    ).toEqual(canonicalBefore);
    expect(
      snapshotFiles([
        join(ROOT, "skills-copilot"),
        join(ROOT, "commands-copilot"),
      ]),
    ).toEqual(generatedBefore);
  });

  it("generates the complete main prompt surface with source provenance", () => {
    const generatedSkills = readdirSync(join(ROOT, "skills-copilot"), {
      withFileTypes: true,
    })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    const generatedCommands = readdirSync(join(ROOT, "commands-copilot"))
      .filter((file) => file.endsWith(".md"))
      .map((file) => file.replace(/\.md$/, ""))
      .sort();

    expect(generatedSkills).toEqual(
      matrix.skills.map((entry) => entry.id).sort(),
    );
    expect(generatedCommands).toEqual(
      [
        ...new Set([
          ...matrix.commands.map((entry) => entry.id),
          ...matrix.aliases.map((entry) => entry.id),
        ]),
      ].sort(),
    );

    for (const entry of [
      ...matrix.skills,
      ...matrix.commands,
      ...matrix.aliases.filter((alias) => alias.wrapperMode === "generated"),
    ]) {
      const generated = readFileSync(join(ROOT, entry.output), "utf8");
      expect(generated).toContain(
        "<!-- Generated by scripts/generate-copilot-prompts.mjs. Do not edit directly. -->",
      );
      expect(generated).toContain(
        `<!-- Source: ${entry.source}; sha256=${sourceDigest(entry.source)} -->`,
      );
    }
  });

  it("preserves copied support-file bytes and canonical Git modes", () => {
    for (const entry of matrix.skills.filter(
      ({ copySupportFiles }) => copySupportFiles !== false,
    )) {
      const sourceDir = join(ROOT, entry.source, "..");
      const outputDir = join(ROOT, entry.output, "..");

      for (const sourcePath of walkFiles(sourceDir)) {
        if (sourcePath === join(ROOT, entry.source)) continue;
        const supportPath = relative(sourceDir, sourcePath).replace(/\\/g, "/");
        const outputPath = join(outputDir, supportPath);
        const expectedMode = entry.supportFileModes?.[supportPath] ?? "100644";

        expect(materializedMode(sourcePath), entry.source).toBe(expectedMode);
        expect(materializedMode(outputPath), entry.output).toBe(expectedMode);

        if (!sourcePath.endsWith(".md")) {
          expect(readFileSync(outputPath).equals(readFileSync(sourcePath))).toBe(
            true,
          );
        } else {
          expect(readFileSync(outputPath, "utf8")).toContain(
            `<!-- Source: ${relativePath(sourcePath)}; sha256=${sourceDigest(
              relativePath(sourcePath),
            )} -->`,
          );
        }
      }
    }
  });

  it("records and uses the shell-explicit self-improve validator contract", () => {
    const selfImprove = matrix.skills.find(({ id }) => id === "self-improve");
    const channel =
      selfImprove?.supportFileChannels?.["scripts/validate.sh"];
    expect(channel).toEqual({
      gitMode: "100755",
      npmTarMode: "0644-or-0755",
      requiredInvocation: 'bash "$VALIDATE_SH"',
      windowsRequirement: "Bash via Git Bash, WSL, or MSYS2",
    });

    const prompt = readFileSync(
      join(ROOT, "skills-copilot", "self-improve", "SKILL.md"),
      "utf8",
    );
    expect(prompt).toContain("npm archives may normalize it to mode `0644`");
    expect(prompt).toContain(
      'VALIDATE_SH="$(cd "{skill_dir}/scripts" && pwd -P)/validate.sh"',
    );
    expect(prompt).toContain('bash "$VALIDATE_SH"');
    expect(prompt).toContain("On Windows, use Git Bash, WSL, or MSYS2 Bash");
    expect(prompt).toContain(
      "git-mode=100755; npm-tar-mode=0644-or-0755",
    );
    expect(prompt).not.toContain("./validate.sh");
  });

  it("removes unsupported Claude-only mechanisms and contradictory team semantics", () => {
    const generatedMarkdown = [
      ...walkFiles(join(ROOT, "skills-copilot")),
      ...walkFiles(join(ROOT, "commands-copilot")),
    ]
      .filter((path) => path.endsWith(".md"))
      .map((path) => [relativePath(path), readFileSync(path, "utf8")] as const);

    const forbidden = [
      /\b(?:Task|Agent)\(\s*subagent_type\s*=/,
      /\bAgent\(/,
      /\b(?:haiku|sonnet|opus)\b/i,
      /\bAskUserQuestion\b/,
      /\bSkill\(/,
      /\bTodoWrite\b/,
      /\bTeam(?:Create|Delete)\b/,
      /\bimplicit(?:[\s-]+agent)?[\s-]+teams?\b/i,
      /\bteam[\s-]*mates?\b/i,
      /\b(?:native|built[\s-]*in|shared)[^\n.]{0,48}\bteam[\s-]+membership\b/i,
      /\b(?:native|built[\s-]*in|shared)[^\n.]{0,48}\bteam[\s-]+messag(?:e|es|ing)\b/i,
      /\bone\b[^\n.]{0,32}\bteam\b[^\n.]{0,32}\bper session\b/i,
      /\bspawn(?:s|ed|ing)?\b[^\n.]{0,48}\binto\b[^\n.]{0,24}\bteam\b/i,
      /\b(?:Task|task|skill)\(\s*\)/,
      /\bCLAUDE_PLUGIN_ROOT\b/,
      /\bBash tool\b/,
      /\bclaude\s+mcp\b/i,
      /claude --dangerously-skip-permissions/i,
      /(?:^|[^A-Za-z0-9_-])(?:\.\/)?\.copilot[\\/]omc\.jsonc\b/m,
      /(?:COPILOT_HOME[^}\n]*\}|(?:~|\$HOME)[\\/]\.copilot)[\\/]\.omc-config\.json\b/,
      /(?:COPILOT_HOME[^}\n]*\}|(?:~|\$HOME)[\\/]\.copilot)[\\/]omc_config\.hook\.json\b/,
      /(?:COPILOT_HOME[^}\n]*\}|(?:~|\$HOME)[\\/]\.copilot)[\\/]skills[\\/]omc-learned\b/,
    ];
    const copilotHostConfigPrompts = new Set([
      "skills-copilot/hud/SKILL.md",
      "skills-copilot/mcp-setup/SKILL.md",
      "skills-copilot/omc-doctor/SKILL.md",
      "skills-copilot/omc-setup/SKILL.md",
      "skills-copilot/setup/SKILL.md",
    ]);

    for (const [path, content] of generatedMarkdown) {
      for (const pattern of forbidden) {
        expect(content, `${path}: ${pattern}`).not.toMatch(pattern);
      }
      if (
        /\bCOPILOT_HOME\b|(?:^|[^A-Za-z0-9_-])(?:~|\$HOME)[\\/]\.copilot(?:[\\/]|$)/m.test(
          content,
        )
      ) {
        expect(copilotHostConfigPrompts.has(path), path).toBe(true);
      }
    }
  });

  it("rejects invalid generated tool calls and reordered team contradictions", () => {
    const invalid = [
      "Task()",
      "task()",
      "skill()",
      'Task(model="deep")',
      'Task(executor, "implement it")',
      'skill("compact")',
      "Use an implicit-agent-team for the work.",
      "Workers join an implicit agent team.",
      "Task agents use a shared inbox.",
      "The host provides native team messaging.",
      "Spawn workers into the team.",
      "Use **Claude built-in team mode** for this work.",
      "A mode for teams is built—in to Claude Code.",
      "Claude Code provides a TEAM_mode, natively.",
      "This **team** is native.",
      "A team is, implicitly, created for these workers.",
      "For Claude, native orchestration uses team mode.",
      "Run ./validate.sh before benchmarking.",
    ];

    for (const content of invalid) {
      expect(
        () => validateFixtureWithGenerator(content),
        content,
      ).toThrow();
    }

    expect(() =>
      validateFixtureWithGenerator(
        'Task(agent_type="oh-my-claudecode:executor", prompt="implement") skill("ralph")',
      ),
    ).not.toThrow();
    expect(() =>
      validateFixtureWithGenerator(
        "External OMC CLI team workers can use native cmux splits.",
      ),
    ).not.toThrow();
  });

  it("replaces the complete deep-dive Phase 3 team section", () => {
    const source = readFileSync(
      join(ROOT, "skills", "deep-dive", "SKILL.md"),
      "utf8",
    );
    const transformed = transformTeamFixtureWithGenerator(source);
    const phaseStart = transformed.indexOf("## Phase 3: Trace Execution");
    const phaseEnd = transformed.indexOf("## Phase 4:", phaseStart);
    const phaseThree = transformed.slice(phaseStart, phaseEnd);
    const normalizedPhaseThree = phaseThree.replace(/\s+/g, " ");

    expect(phaseThree).toContain("### Copilot Task Coordination");
    expect(phaseThree).toContain(
      'Task(agent_type="oh-my-claudecode:tracer", prompt="...")',
    );
    expect(normalizedPhaseThree).toContain("three independent tracer lanes");
    expect(normalizedPhaseThree).toContain(
      "lead conversation owns coordination",
    );
    expect(normalizedPhaseThree).toContain("explicit follow-up Task calls");
    expect(normalizedPhaseThree).toContain(
      "available read, search, and shell tools",
    );
    expect(phaseThree).toContain("**Parallelism fallback**");
    expect(phaseThree).not.toContain("Team Mode Orchestration");
    expect(phaseThree).not.toContain("Claude built-in team mode");
    expect(phaseThree).not.toContain("Team mode fallback");
    expect(transformed).toContain(
      "Phase 3 runs trace with 3 independent Task lanes",
    );
    validateFixtureWithGenerator(phaseThree);
  });

  it("keeps runtime-owned paths aligned with their source resolvers", () => {
    const claudeConfigDir = normalizedPath(getClaudeConfigDir());
    const learnerSkillsDir = normalizedPath(getLearnerSkillsDir("user"));
    const configPaths = getConfigPaths();
    const deepInterviewSettingsPaths = getDeepInterviewSettingsPaths();

    expect(normalizedPath(getNotificationConfigPath())).toBe(
      `${claudeConfigDir}/.omc-config.json`,
    );
    expect(normalizedPath(getHookNotificationConfigPath())).toBe(
      `${claudeConfigDir}/omc_config.hook.json`,
    );
    expect(normalizedPath(getLegacyOpenClawConfigPath())).toBe(
      `${claudeConfigDir}/omc_config.openclaw.json`,
    );
    expect(learnerSkillsDir).toBe(
      `${claudeConfigDir}/skills/omc-learned`,
    );
    expect(normalizedPath(configPaths.project)).toBe(
      `${normalizedPath(ROOT)}/.claude/omc.jsonc`,
    );
    expect(normalizedPath(configPaths.user)).toMatch(
      /\/claude-omc\/config\.jsonc$/,
    );
    expect(normalizedPath(deepInterviewSettingsPaths.profile)).toBe(
      `${claudeConfigDir}/settings.json`,
    );
    expect(normalizedPath(deepInterviewSettingsPaths.project)).toBe(
      `${normalizedPath(ROOT)}/.claude/settings.json`,
    );

    const notificationPrompt = readFileSync(
      join(ROOT, "skills-copilot", "configure-notifications", "SKILL.md"),
      "utf8",
    );
    expect(notificationPrompt).toContain(
      "${CLAUDE_CONFIG_DIR:-~/.claude}/.omc-config.json",
    );
    expect(notificationPrompt).toContain(
      "${CLAUDE_CONFIG_DIR:-~/.claude}/omc_config.hook.json",
    );
    expect(notificationPrompt).not.toContain(
      "${COPILOT_HOME:-~/.copilot}/.omc-config.json",
    );

    for (const skill of ["autopilot", "ralph", "ralplan"]) {
      const content = readFileSync(
        join(ROOT, "skills-copilot", skill, "SKILL.md"),
        "utf8",
      );
      expect(content).toContain(".claude/omc.jsonc");
      expect(content).not.toContain(".copilot/omc.jsonc");
    }

    for (const skill of ["deep-dive", "deep-interview", "sciomc"]) {
      const content = readFileSync(
        join(ROOT, "skills-copilot", skill, "SKILL.md"),
        "utf8",
      );
      expect(content).toContain(".claude/settings.json");
      expect(content).not.toContain(".copilot/settings.json");
    }

    for (const skill of ["learner", "skill", "skillify"]) {
      const content = readFileSync(
        join(ROOT, "skills-copilot", skill, "SKILL.md"),
        "utf8",
      );
      expect(content).toContain("skills/omc-learned");
      expect(content).not.toContain(".copilot/skills/omc-learned");
    }

    const hudPrompt = readFileSync(
      join(ROOT, "skills-copilot", "hud", "SKILL.md"),
      "utf8",
    );
    expect(hudPrompt).toContain(
      "${COPILOT_HOME:-~/.copilot}/settings.json",
    );
  });

  it("keeps generated HUD guidance synchronized with the native Copilot helper", () => {
    const hudPrompt = readFileSync(
      join(ROOT, "skills-copilot", "hud", "SKILL.md"),
      "utf8",
    );
    expect(hudPrompt).toContain("bridge/copilot-hud-setup.mjs");
    expect(hudPrompt).toContain("bridge/hud-runtime.mjs");
    expect(hudPrompt).toContain("/oh-my-claudecode:hud repair");
    expect(hudPrompt).toContain("/oh-my-claudecode:hud doctor");
    expect(hudPrompt).toContain("JSONC-preserving");
    expect(hudPrompt).toContain("`--replace` only after");
    expect(hudPrompt).toContain("Qterm and manual terminal integration are not required");

    const setupPrompt = readFileSync(
      join(ROOT, "skills-copilot", "omc-setup", "SKILL.md"),
      "utf8",
    );
    expect(setupPrompt).toContain("/oh-my-claudecode:hud status");
    expect(setupPrompt).toContain("/oh-my-claudecode:hud setup");
    expect(setupPrompt).toContain("/oh-my-claudecode:hud repair");
    expect(setupPrompt).toContain(
      "${COPILOT_HOME:-~/.copilot}/settings.json",
    );

    const doctorPrompt = readFileSync(
      join(ROOT, "skills-copilot", "omc-doctor", "SKILL.md"),
      "utf8",
    );
    expect(doctorPrompt).toContain("bridge/copilot-hud-setup.mjs");
    expect(doctorPrompt).toContain("hud/omc-hud.mjs");
    expect(doctorPrompt).toContain(
      "`missing`, `omc`, `third-party`, or `invalid`",
    );
    expect(doctorPrompt).toContain("without mutation");
    expect(doctorPrompt).toContain(
      "permissionRequest` matcher as routing only",
    );
  });

  it("preserves Ultragoal concurrency and completion contracts for Copilot", () => {
    const prompt = readFileSync(
      join(ROOT, "skills-copilot", "ultragoal", "SKILL.md"),
      "utf8",
    );

    expect(prompt).toContain("## Source concurrency contract");
    expect(prompt).toContain("--plan-id <stable-id>");
    expect(prompt).toContain("--auto-plan-id");
    expect(prompt).toContain(".omc/ultragoal/plans/{planId}/");
    expect(prompt).toContain("same `--plan-id <id>`");
    expect(prompt).toContain("`complete-goals`");
    expect(prompt).toContain("first nonterminal goal");
    expect(prompt).toContain("`checkpoint --goal-id <id> --status");
    expect(prompt).toContain("<complete|failed|blocked>`");
    expect(prompt).toContain("`record-review-blockers`");
    expect(prompt).toContain("ai-slop-cleaner");
    expect(prompt).toContain("passing verification commands");
    expect(prompt).toContain("`APPROVE`");
    expect(prompt).toContain("architect status `CLEAR`");
    expect(prompt).toContain("`--quality-gate-json`");
  });

  it("wires generated prompt directories into the npm package surface", () => {
    const packageJson = readJson<{
      files: string[];
      scripts: Record<string, string>;
    }>(join(ROOT, "package.json"));

    expect(packageJson.files).toEqual(
      expect.arrayContaining([
        "commands-copilot",
        "skills-copilot",
        "prompt-assets",
      ]),
    );
    expect(packageJson.scripts["generate:copilot-prompts"]).toBe(
      "node scripts/generate-copilot-prompts.mjs",
    );
    expect(packageJson.scripts["check:copilot-prompts"]).toBe(
      "node scripts/generate-copilot-prompts.mjs --check",
    );
    expect(packageJson.scripts.build).toContain(
      "node scripts/generate-copilot-prompts.mjs",
    );
  });
});
