import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("HUD skill Copilot guidance", () => {
  const content = readFileSync(
    join(process.cwd(), "skills", "hud", "SKILL.md"),
    "utf8",
  );

  it("routes Copilot to native ownership-safe setup and diagnostics", () => {
    expect(content).toContain("## Host Dispatch");
    expect(content).toContain("${COPILOT_HOME:-~/.copilot}");
    expect(content).toContain("bridge/copilot-hud-setup.mjs");
    expect(content).toContain("bridge/hud-runtime.mjs");
    expect(content).toContain("installedPlugins[].cache_path");
    expect(content).toContain("JSONC");
    expect(content).toContain("third-party");
    expect(content).toContain("explicitly approves");
    expect(content).toContain("repair");
    expect(content).toContain("doctor");
  });

  it("keeps Copilot isolated from Claude config and rejects manual integration claims", () => {
    expect(content).toContain("Never read or write `~/.claude`");
    expect(content).toContain("Qterm and manual terminal integration are not");
  });
});
