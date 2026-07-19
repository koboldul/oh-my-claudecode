---
name: omc-doctor
description: Diagnose and fix oh-my-claudecode installation issues
level: 3
---

# Doctor Skill

Note: All `~/.claude/...` paths in this guide respect `CLAUDE_CONFIG_DIR` when that environment variable is set.

## Task: Run Installation Diagnostics

You are the OMC Doctor - diagnose and fix installation issues.

### Step 0: Detect Host Environment (Claude Code vs GitHub Copilot CLI)

OMC runs as a plugin under **both** Claude Code and **GitHub Copilot CLI**. Detect which host(s) have OMC installed before running host-specific checks — otherwise a Copilot-only user sees false CRITICALs for `~/.claude` paths that do not apply to them.

```bash
node -e "const p=require('path'),f=require('fs'),h=require('os').homedir();const ccd=process.env.CLAUDE_CONFIG_DIR||p.join(h,'.claude');const cb=p.join(ccd,'plugins','cache','omc','oh-my-claudecode');let claude='(not installed)';try{const v=f.readdirSync(cb).filter(x=>/^\d/.test(x)).sort((a,c)=>a.localeCompare(c,void 0,{numeric:true}));if(v.length)claude=v[v.length-1]}catch{};const cop=process.env.COPILOT_HOME||p.join(h,'.copilot');const cd=p.join(cop,'installed-plugins','omc','oh-my-claudecode');let copilot='(not installed)';try{if(f.existsSync(cd))copilot=JSON.parse(f.readFileSync(p.join(cd,'package.json'),'utf8')).version||'(installed)'}catch{copilot='(installed)'};console.log('Claude Code install:',claude);console.log('Copilot CLI install:',copilot)"
```

**Diagnosis**:
- **Claude Code install present** (version shown): run Steps 1–7 (they target `~/.claude`).
- **Copilot CLI install present** (version shown): run the **GitHub Copilot CLI checks** section below, and **skip** the Claude-only steps (Step 2 legacy settings hooks, Step 3 legacy bash scripts, Step 4 CLAUDE.md, Step 7 legacy curl content) unless a Claude Code install is also present. Copilot does not read `~/.claude/CLAUDE.md` or `~/.claude/settings.json`, so those are not issues for a Copilot-only install.
- **Both present**: run every section and report per host.
- **Neither present**: CRITICAL - OMC is not installed for any detected host.

### Step 1: Check Plugin Version

_(Claude Code install. For a Copilot-only install, use the GitHub Copilot CLI checks section instead.)_

```bash
# Get installed and latest versions (cross-platform)
node -e "const p=require('path'),f=require('fs'),h=require('os').homedir(),d=process.env.CLAUDE_CONFIG_DIR||p.join(h,'.claude'),b=p.join(d,'plugins','cache','omc','oh-my-claudecode');try{const v=f.readdirSync(b).filter(x=>/^\d/.test(x)).sort((a,c)=>a.localeCompare(c,void 0,{numeric:true}));console.log('Installed:',v.length?v[v.length-1]:'(none)')}catch{console.log('Installed: (none)')}"
npm view oh-my-claude-sisyphus version 2>/dev/null || echo "Latest: (unavailable)"
```

**Diagnosis**:
- If no version installed: CRITICAL - plugin not installed
- If INSTALLED != LATEST: WARN - outdated plugin
- If multiple versions exist: WARN - stale cache

### Step 2: Check for Legacy Hooks in settings.json

Read both `${CLAUDE_CONFIG_DIR:-~/.claude}/settings.json` (profile-level) and `./.claude/settings.json` (project-level) and check if there's a `"hooks"` key with entries like:
- `bash ${CLAUDE_CONFIG_DIR:-$HOME/.claude}/hooks/keyword-detector.sh`
- `bash ${CLAUDE_CONFIG_DIR:-$HOME/.claude}/hooks/persistent-mode.sh`
- `bash ${CLAUDE_CONFIG_DIR:-$HOME/.claude}/hooks/session-start.sh`

**Diagnosis**:
- If found: CRITICAL - legacy hooks causing duplicates

### Step 3: Check for Legacy Bash Hook Scripts

```bash
ls -la "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/hooks/*.sh 2>/dev/null
```

**Diagnosis**:
- If `keyword-detector.sh`, `persistent-mode.sh`, `session-start.sh`, or `stop-continuation.sh` exist: WARN - legacy scripts (can cause confusion)

### Step 4: Check CLAUDE.md

```bash
# Check if CLAUDE.md exists
ls -la "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/CLAUDE.md 2>/dev/null

# Check for OMC markers (<!-- OMC:START --> is the canonical marker)
grep -q "<!-- OMC:START -->" "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/CLAUDE.md" 2>/dev/null && echo "Has OMC config" || echo "Missing OMC config in CLAUDE.md"

# Check CLAUDE.md (or deterministic companion) version marker and compare with latest installed plugin cache version
node -e "const p=require('path'),f=require('fs'),h=require('os').homedir(),d=process.env.CLAUDE_CONFIG_DIR||p.join(h,'.claude');const base=p.join(d,'CLAUDE.md');let baseContent='';try{baseContent=f.readFileSync(base,'utf8')}catch{};let candidates=[base];let referenced='';const importMatch=baseContent.match(/CLAUDE-[^ )]*\\.md/);if(importMatch){referenced=p.join(d,importMatch[0]);candidates.push(referenced)}else{const defaultCompanion=p.join(d,'CLAUDE-omc.md');if(f.existsSync(defaultCompanion))candidates.push(defaultCompanion);try{const others=f.readdirSync(d).filter(n=>/^CLAUDE-.*\\.md$/i.test(n)).sort().map(n=>p.join(d,n));for(const o of others){if(candidates.includes(o)===false)candidates.push(o)}}catch{}};let claudeV='(missing)';let claudeSource='(none)';for(const file of candidates){try{const c=f.readFileSync(file,'utf8');const m=c.match(/<!--\\s*OMC:VERSION:([^\\s]+)\\s*-->/i);if(m){claudeV=m[1];claudeSource=file;break}}catch{}};if(claudeV==='(missing)'&&candidates.length>0){claudeV='(missing marker)';claudeSource='scanned deterministic CLAUDE sources';};let pluginV='(none)';try{const b=p.join(d,'plugins','cache','omc','oh-my-claudecode');const v=f.readdirSync(b).filter(x=>/^\\d/.test(x)).sort((a,c)=>a.localeCompare(c,void 0,{numeric:true}));pluginV=v.length?v[v.length-1]:'(none)';}catch{};console.log('CLAUDE.md OMC version:',claudeV);console.log('OMC version source:',claudeSource);console.log('Latest cached plugin version:',pluginV);if(claudeV==='(missing)'||claudeV==='(missing marker)'||pluginV==='(none)'){console.log('VERSION CHECK SKIPPED: missing CLAUDE marker or plugin cache')}else if(claudeV===pluginV){console.log('VERSION MATCH: CLAUDE and plugin cache are aligned')}else{console.log('VERSION DRIFT: CLAUDE.md and plugin versions differ')}"

# Check companion files for file-split pattern (e.g. CLAUDE-omc.md)
find "${CLAUDE_CONFIG_DIR:-$HOME/.claude}" -maxdepth 1 -type f -name 'CLAUDE-*.md' -print 2>/dev/null
while IFS= read -r f; do
  grep -q "<!-- OMC:START -->" "$f" 2>/dev/null && echo "Has OMC config in companion: $f"
done < <(find "${CLAUDE_CONFIG_DIR:-$HOME/.claude}" -maxdepth 1 -type f -name 'CLAUDE-*.md' -print 2>/dev/null)

# Check if CLAUDE.md references a companion file
grep -o "CLAUDE-[^ )]*\.md" "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/CLAUDE.md" 2>/dev/null
```

**Diagnosis**:
- If CLAUDE.md missing: CRITICAL - CLAUDE.md not configured
- If `<!-- OMC:START -->` found in CLAUDE.md: OK
- If `<!-- OMC:START -->` found in a companion file (e.g. `CLAUDE-omc.md`): OK - file-split pattern detected
- If no OMC markers in CLAUDE.md or any companion file: WARN - outdated CLAUDE.md
- If `OMC:VERSION` marker is missing from deterministic CLAUDE source scan (base + referenced companion): WARN - cannot verify CLAUDE.md freshness
- If `CLAUDE.md OMC version` != `Latest cached plugin version`: WARN - version drift detected (run `omc update` or `omc setup`)

### Step 5: Check Ralph Ruby Dependency

Ralph workflows require Ruby. Check for Ruby explicitly so fresh installations get actionable guidance instead of a later opaque Ralph failure.

```bash
if command -v ruby >/dev/null 2>&1; then
  echo "Ruby for Ralph: $(ruby --version 2>/dev/null | head -1)"
else
  echo "Ruby for Ralph: MISSING"
  echo "Install Ruby before using Ralph. Ubuntu/Debian: sudo apt update && sudo apt install ruby-full"
  echo "macOS: brew install ruby"
fi
```

**Diagnosis**:
- If Ruby is found: OK - Ralph dependency present
- If Ruby is missing: WARN - Ralph workflows may fail until Ruby is installed

### Step 6: Check for Stale Plugin Cache

```bash
# Count versions in cache (cross-platform)
node -e "const p=require('path'),f=require('fs'),h=require('os').homedir(),d=process.env.CLAUDE_CONFIG_DIR||p.join(h,'.claude'),b=p.join(d,'plugins','cache','omc','oh-my-claudecode');try{const v=f.readdirSync(b).filter(x=>/^\d/.test(x));console.log(v.length+' version(s):',v.join(', '))}catch{console.log('0 versions')}"
```

**Diagnosis**:
- If > 1 version: WARN - multiple cached versions (cleanup recommended)

### Step 7: Check for Legacy Curl-Installed Content

Check for legacy agents, commands, and skills installed via curl (before plugin system).
**Important**: Only flag files whose names match actual plugin-provided names. Do NOT flag user's custom agents/commands/skills that are unrelated to OMC.

```bash
# Check for legacy agents directory
ls -la "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/agents/ 2>/dev/null

# Check for legacy commands directory
ls -la "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/commands/ 2>/dev/null

# Check for legacy skills directory
ls -la "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/skills/ 2>/dev/null
```

**Diagnosis**:
- If `~/.claude/agents/` exists with files matching plugin agent names: WARN - legacy agents (now provided by plugin)
- If `~/.claude/commands/` exists with files matching plugin command names: WARN - legacy commands (now provided by plugin)
- If `~/.claude/skills/` exists with files matching plugin skill names: WARN - legacy skills (now provided by plugin)
- If custom files exist that do NOT match plugin names: OK - these are user custom content, do not flag them

**Known plugin agent names** (check agents/ for these):
`architect.md`, `document-specialist.md`, `explore.md`, `executor.md`, `debugger.md`, `planner.md`, `analyst.md`, `critic.md`, `verifier.md`, `test-engineer.md`, `designer.md`, `writer.md`, `qa-tester.md`, `scientist.md`, `security-reviewer.md`, `code-reviewer.md`, `git-master.md`, `code-simplifier.md`

**Known plugin skill names** (check skills/ for these):
`ai-slop-cleaner`, `ask`, `autopilot`, `cancel`, `ccg`, `configure-notifications`, `deep-interview`, `deepinit`, `external-context`, `hud`, `skillify`, `learner`, `mcp-setup`, `omc-doctor`, `omc-setup`, `omc-teams`, `plan`, `project-session-manager`, `ralph`, `ralplan`, `release`, `sciomc`, `setup`, `skill`, `team`, `ultraqa`, `ultrawork`, `visual-verdict`, `writer-memory`

**Known plugin command names** (check commands/ for these):
`ultrawork.md`, `deepsearch.md`

---

## GitHub Copilot CLI checks

Run these when the Copilot CLI install was detected in Step 0. All commands are cross-platform (Node), since Copilot CLI users are often on native Windows. Copilot loads the plugin's `.claude-plugin/plugin.json` skills, `agents/*.md`, `.mcp.json` (`t` MCP server), and `hooks/hooks.json` directly from `${COPILOT_HOME:-~/.copilot}/installed-plugins/omc/oh-my-claudecode`.

### C1: Plugin installed and enabled

```bash
node -e "const p=require('path'),f=require('fs'),h=require('os').homedir();const jr=s=>s.split(/\r?\n/).filter(l=>!/^\s*\/\//.test(l)).join('\n');const cop=process.env.COPILOT_HOME||p.join(h,'.copilot');const dir=p.join(cop,'installed-plugins','omc','oh-my-claudecode');const exists=f.existsSync(dir);let pkgV='(unknown)';try{pkgV=JSON.parse(f.readFileSync(p.join(dir,'package.json'),'utf8')).version}catch{};let cfgV='',en='(unknown)';try{const c=JSON.parse(jr(f.readFileSync(p.join(cop,'config.json'),'utf8')));const ip=(c.installedPlugins||[]).find(x=>x&&x.name==='oh-my-claudecode');if(ip){cfgV=ip.version||'';en=(ip.enabled===false)?false:true}}catch{};let se='(unknown)';try{const s=JSON.parse(jr(f.readFileSync(p.join(cop,'settings.json'),'utf8')));const ep=(s.enabledPlugins||{});if(Object.prototype.hasOwnProperty.call(ep,'oh-my-claudecode@omc'))se=!!ep['oh-my-claudecode@omc']}catch{};if(!exists){console.log('Copilot OMC plugin: (not installed) - checked '+dir)}else{const cfgNote=cfgV?(cfgV===pkgV?'':' (config records '+cfgV+')'):'';console.log('Copilot OMC plugin dir:',dir);console.log('Copilot plugin version:',pkgV+cfgNote);console.log('Copilot plugin enabled (config.json):',en);console.log('Copilot plugin enabled (settings.json):',se)}"
npm view oh-my-claude-sisyphus version 2>/dev/null || echo "Latest: (unavailable)"
copilot --version
```

> The `config.json` read strips full-line `//` comments only (the file is JSONC), which preserves `https://` URLs inside string values. `settings.json` is strict JSON but is read the same way for safety.

**Diagnosis**:
- If plugin dir missing: CRITICAL - install with Copilot's `/plugin` command: `/plugin marketplace add https://github.com/Yeachan-Heo/oh-my-claudecode` then `/plugin install oh-my-claudecode`.
- If `enabled` (config.json) or the settings.json flag is `false`: WARN - plugin installed but disabled; re-enable it via Copilot's `/plugin` command.
- If plugin version is behind the latest npm version: WARN - outdated; update via Copilot's `/plugin` command, then restart Copilot CLI.
- If `copilot --version` reports **1.0.72-1**: OK - this is the verified Copilot host contract.
- If it reports an earlier version: CRITICAL - unsupported; upgrade GitHub Copilot CLI to at least 1.0.72-1 using the same package manager used to install it, then rerun `copilot --version`.
- If it reports a later version: WARN - compatibility is unverified, not failed. Continue diagnostics, but note that contract fixtures and live qualification have not yet passed for that version.
- When the OMC terminal CLI is available, `omc doctor copilot` performs this compatibility check and `omc doctor copilot --json` emits the structured result.

### C2: Confirm skills, agents, MCP server, and hooks loaded

Ask the user to run Copilot's `/env` command (it lists loaded instructions, MCP servers, skills, agents, hooks, and plugins) and confirm OMC appears.

**Diagnosis**:
- If `/env` shows the OMC skills, `oh-my-claudecode:*` agents, the `t` MCP server, and `Loaded N hook(s) from 1 plugin(s)`: OK.
- If skills/agents/hooks are missing: WARN - restart Copilot CLI (plugins and hooks are loaded at startup).
- If the `t` MCP server errors: ensure Node.js is on PATH (the server runs `node <plugin>/bridge/mcp-server.cjs`).

### C3: Hook event compatibility (informational)

Copilot CLI 1.0.72-1 has been observed emitting the camelCase `subagentStart` event. Acceptance of Claude-style manifest event names does not prove identical payload shapes, state transitions, or persistence outcomes. OMC's Copilot behavior remains partial parity until each hook path passes versioned fixture and live qualification.

**Diagnosis**:
- Informational - treat camelCase `subagentStart` as observed behavior, not an unsupported event.
- Do not report persistence loops as Claude-identical without version-qualified evidence.
- Do **not** add camelCase mirror events to `hooks/hooks.json`; duplicate manifest entries can double-fire a hook.

### C4: CLAUDE.md / `omc setup` NOT required under Copilot

Copilot CLI does not read `~/.claude/CLAUDE.md`. It uses `AGENTS.md`, `.github/copilot-instructions.md`, and `~/.copilot/copilot-instructions.md`. The Claude-only Steps 2–4 and the `omc setup` / HUD statusline flow are **not** required to use OMC under Copilot.

**Diagnosis**:
- For a Copilot-only install, do **not** report a missing `~/.claude/CLAUDE.md` or missing `omc setup` as an issue.

---

## Report Format

After running all checks, output a report:

```
## OMC Doctor Report

### Summary
[HEALTHY / ISSUES FOUND]

### Checks

Report rows for the host(s) detected in Step 0. Rows marked _(Claude only)_ / _(Copilot only)_ apply to that host; omit rows for a host that is not installed.

| Check | Status | Details |
|-------|--------|---------|
| Host(s) Detected | Claude Code / Copilot CLI / both | from Step 0 |
| Plugin Version _(Claude only)_ | OK/WARN/CRITICAL | ... |
| Legacy Hooks (settings.json) _(Claude only)_ | OK/CRITICAL | ... |
| Legacy Scripts (~/.claude/hooks/) _(Claude only)_ | OK/WARN | ... |
| CLAUDE.md _(Claude only)_ | OK/WARN/CRITICAL | ... |
| Ralph Ruby Dependency | OK/WARN | applies to both hosts |
| Plugin Cache _(Claude only)_ | OK/WARN | ... |
| Legacy Agents (~/.claude/agents/) _(Claude only)_ | OK/WARN | ... |
| Legacy Commands (~/.claude/commands/) _(Claude only)_ | OK/WARN | ... |
| Legacy Skills (~/.claude/skills/) _(Claude only)_ | OK/WARN | ... |
| Copilot Plugin (installed + enabled) _(Copilot only)_ | OK/WARN/CRITICAL | C1 |
| Copilot CLI Contract Version _(Copilot only)_ | OK/WARN/CRITICAL | 1.0.72-1 verified; earlier unsupported; later unverified |
| Copilot Skills/Agents/MCP/Hooks (`/env`) _(Copilot only)_ | OK/WARN | C2 |

### Issues Found
1. [Issue description]
2. [Issue description]

### Recommended Fixes
[List fixes based on issues]
```

---

## Auto-Fix (if user confirms)

If issues found, ask user: "Would you like me to fix these issues automatically?"

If yes, apply fixes:

### Fix: Legacy Hooks in settings.json
Remove the `"hooks"` section from `${CLAUDE_CONFIG_DIR:-~/.claude}/settings.json` (keep other settings intact)

### Fix: Legacy Bash Scripts
```bash
rm -f "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/hooks/keyword-detector.sh
rm -f "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/hooks/persistent-mode.sh
rm -f "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/hooks/session-start.sh
rm -f "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/hooks/stop-continuation.sh
```

### Fix: Outdated Plugin
```bash
# Clear plugin cache (cross-platform)
node -e "const p=require('path'),f=require('fs'),d=process.env.CLAUDE_CONFIG_DIR||p.join(require('os').homedir(),'.claude'),b=p.join(d,'plugins','cache','omc','oh-my-claudecode');try{f.rmSync(b,{recursive:true,force:true});console.log('Plugin cache cleared. Restart Claude Code to fetch latest version.')}catch{console.log('No plugin cache found')}"
```

### Fix: Stale Cache (multiple versions)
```bash
# Keep only latest version (cross-platform)
node -e "const p=require('path'),f=require('fs'),h=require('os').homedir(),d=process.env.CLAUDE_CONFIG_DIR||p.join(h,'.claude'),b=p.join(d,'plugins','cache','omc','oh-my-claudecode');try{const v=f.readdirSync(b).filter(x=>/^\d/.test(x)).sort((a,c)=>a.localeCompare(c,void 0,{numeric:true}));v.slice(0,-1).forEach(x=>f.rmSync(p.join(b,x),{recursive:true,force:true}));console.log('Removed',v.length-1,'old version(s)')}catch(e){console.log('No cache to clean')}"
```

### Fix: Missing/Outdated CLAUDE.md
Fetch latest from GitHub and write to `${CLAUDE_CONFIG_DIR:-~/.claude}/CLAUDE.md`:
```
WebFetch(url: "https://raw.githubusercontent.com/Yeachan-Heo/oh-my-claudecode/main/docs/CLAUDE.md", prompt: "Return the complete raw markdown content exactly as-is")
```

### Fix: Legacy Curl-Installed Content

Remove legacy agents, commands, and skills directories (now provided by plugin):

```bash
# Backup first (optional - ask user)
# mv "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/agents "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/agents.bak
# mv "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/commands "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/commands.bak
# mv "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/skills "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/skills.bak

# Or remove directly
rm -rf "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/agents
rm -rf "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/commands
rm -rf "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/skills
```

**Note**: Only remove if these contain oh-my-claudecode-related files. If user has custom agents/commands/skills, warn them and ask before removing.

### Fix: GitHub Copilot CLI plugin (install / enable / update)

These are **user-run** Copilot slash commands (there is no `~/.claude` cache to clear for Copilot). Guide the user to run them in their Copilot CLI session:

- **Not installed** → `/plugin marketplace add https://github.com/Yeachan-Heo/oh-my-claudecode` then `/plugin install oh-my-claudecode`
- **Installed but disabled** → re-enable via Copilot's `/plugin` command
- **Outdated** → update via Copilot's `/plugin` command

Then **restart Copilot CLI** so plugins and hooks reload (they are read at startup). Do not delete `${COPILOT_HOME:-~/.copilot}/installed-plugins/...` by hand unless the user asks — let Copilot's `/plugin` manager own that directory.

---

## Post-Fix

After applying fixes, inform the user based on the host:
> Fixes applied. **Restart Claude Code** (or **restart Copilot CLI** if you use OMC under GitHub Copilot CLI) for changes to take effect.
