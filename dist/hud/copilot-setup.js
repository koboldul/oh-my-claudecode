/**
 * Native GitHub Copilot CLI HUD setup.
 *
 * Installs the shared HUD wrapper under COPILOT_HOME and updates only the
 * Copilot settings.json statusLine entry. JSONC edits preserve comments and
 * unrelated keys, and third-party status lines are never replaced without an
 * explicit opt-in.
 */
import { chmodSync, existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, normalize, parse as parsePath, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { applyEdits, modify, parse as parseJsonc, printParseErrorCode, } from "jsonc-parser";
import { isOmcStatusLine } from "../installer/index.js";
import { atomicWriteFileSync } from "../lib/atomic-write.js";
import { buildHudWrapper } from "../lib/hud-wrapper-template.js";
function stripTrailingSeparator(value) {
    if (!value.endsWith(sep))
        return value;
    return value === parsePath(value).root ? value : value.slice(0, -1);
}
function resolveHomeSetting(configured, home, fallbackDirectory) {
    const value = configured?.trim();
    if (!value) {
        return stripTrailingSeparator(normalize(join(home, fallbackDirectory)));
    }
    if (value === "~") {
        return stripTrailingSeparator(normalize(home));
    }
    if (value.startsWith("~/") || value.startsWith("~\\")) {
        return stripTrailingSeparator(normalize(join(home, value.slice(2))));
    }
    return stripTrailingSeparator(normalize(value));
}
export function getCopilotHome(env = process.env, home = homedir()) {
    return resolveHomeSetting(env.COPILOT_HOME, home, ".copilot");
}
function getDefaultPackageRoot() {
    let candidate = dirname(fileURLToPath(import.meta.url));
    while (true) {
        if (existsSync(join(candidate, "package.json"))
            && existsSync(join(candidate, "scripts", "lib", "hud-wrapper-template.txt"))) {
            return candidate;
        }
        const parent = dirname(candidate);
        if (parent === candidate)
            break;
        candidate = parent;
    }
    return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
}
function quoteCommandPath(value) {
    return `"${value.replace(/\\/g, "/").replace(/"/g, '\\"')}"`;
}
export function buildCopilotStatusLineCommand(nodePath, wrapperPath) {
    return `${quoteCommandPath(nodePath)} ${quoteCommandPath(wrapperPath)}`;
}
function readSettings(settingsPath) {
    if (!existsSync(settingsPath)) {
        return {
            content: "{\n}\n",
            settings: {},
            valid: true,
        };
    }
    const raw = readFileSync(settingsPath, "utf8");
    const content = raw.trim().length === 0 ? "{\n}\n" : raw;
    const errors = [];
    const parsed = parseJsonc(content, errors, {
        allowTrailingComma: true,
        disallowComments: false,
    });
    if (errors.length > 0
        || !parsed
        || typeof parsed !== "object"
        || Array.isArray(parsed)) {
        const detail = errors.length > 0
            ? errors.map((error) => printParseErrorCode(error.error)).join(", ")
            : "settings root must be an object";
        return {
            content,
            settings: {},
            valid: false,
            diagnostic: `Copilot settings.json is invalid JSONC (${detail}); no files were changed.`,
        };
    }
    return {
        content,
        settings: parsed,
        valid: true,
    };
}
function getOwnership(settingsValid, statusLine) {
    if (!settingsValid)
        return "invalid";
    if (!statusLine)
        return "missing";
    return isOmcStatusLine(statusLine) ? "omc" : "third-party";
}
function matchesExpectedStatusLine(statusLine, expectedCommand) {
    if (!statusLine || typeof statusLine !== "object")
        return false;
    const value = statusLine;
    return value.type === "command" && value.command === expectedCommand;
}
function detectFormatting(content) {
    const eol = content.includes("\r\n") ? "\r\n" : "\n";
    const indent = content.match(/\r?\n([ \t]+)"/)?.[1];
    const insertSpaces = !indent?.includes("\t");
    return {
        eol,
        insertSpaces,
        tabSize: insertSpaces && indent ? indent.length : 2,
        insertFinalNewline: content.endsWith("\n"),
    };
}
function updateStatusLineJsonc(content, existingStatusLine, command) {
    const formattingOptions = detectFormatting(content);
    const desired = { type: "command", command };
    if (existingStatusLine
        && typeof existingStatusLine === "object"
        && !Array.isArray(existingStatusLine)
        && isOmcStatusLine(existingStatusLine)) {
        let updated = content;
        const existing = existingStatusLine;
        if (existing.type !== "command") {
            updated = applyEdits(updated, modify(updated, ["statusLine", "type"], "command", { formattingOptions }));
        }
        if (existing.command !== command) {
            updated = applyEdits(updated, modify(updated, ["statusLine", "command"], command, { formattingOptions }));
        }
        return updated;
    }
    return applyEdits(content, modify(content, ["statusLine"], desired, { formattingOptions }));
}
function readOptionalFile(path) {
    try {
        return readFileSync(path, "utf8");
    }
    catch {
        return null;
    }
}
function buildSnapshot(options) {
    const home = options.homeDir ?? homedir();
    const copilotHome = options.copilotHome
        ? resolveHomeSetting(options.copilotHome, home, ".copilot")
        : getCopilotHome(process.env, home);
    const packageRoot = resolve(options.packageRoot ?? getDefaultPackageRoot());
    const settingsPath = join(copilotHome, "settings.json");
    const wrapperPath = join(copilotHome, "hud", "omc-hud.mjs");
    const helperPath = join(copilotHome, "hud", "lib", "config-dir.mjs");
    const pluginRoot = packageRoot;
    const runtimePath = join(pluginRoot, "bridge", "hud-runtime.mjs");
    const expectedCommand = buildCopilotStatusLineCommand(options.nodePath ?? process.execPath, wrapperPath);
    const parsedSettings = readSettings(settingsPath);
    const statusLine = parsedSettings.settings.statusLine;
    const ownership = getOwnership(parsedSettings.valid, statusLine);
    const wrapperContent = (() => {
        try {
            const wrapper = buildHudWrapper(packageRoot);
            const marker = 'const configuredPluginRoot = "";';
            if (!wrapper.includes(marker))
                return null;
            return wrapper.replace(marker, `const configuredPluginRoot = ${JSON.stringify(pluginRoot)};`);
        }
        catch {
            return null;
        }
    })();
    const helperContent = readOptionalFile(join(packageRoot, "scripts", "lib", "config-dir.mjs"));
    const installedWrapper = readOptionalFile(wrapperPath);
    const installedHelper = readOptionalFile(helperPath);
    const wrapperInstalled = installedWrapper !== null;
    const wrapperCurrent = wrapperContent !== null && installedWrapper === wrapperContent;
    const helperCurrent = helperContent !== null && installedHelper === helperContent;
    const runtimeAvailable = existsSync(runtimePath);
    const configured = ownership === "omc"
        && matchesExpectedStatusLine(statusLine, expectedCommand);
    const needsRepair = !runtimeAvailable
        || !configured
        || !wrapperCurrent
        || !helperCurrent;
    let diagnostic;
    if (!parsedSettings.valid) {
        diagnostic = parsedSettings.diagnostic
            ?? "Copilot settings.json is invalid JSONC; no files were changed.";
    }
    else if (ownership === "third-party") {
        diagnostic =
            "Copilot statusLine is owned by another tool; no files were changed. "
                + "Use --replace only after the user explicitly approves replacement.";
    }
    else if (!runtimeAvailable) {
        diagnostic =
            `Copilot HUD runtime is missing at ${runtimePath}. `
                + "Update or reinstall the oh-my-claudecode Copilot plugin.";
    }
    else if (wrapperContent === null || helperContent === null) {
        diagnostic =
            "The installed plugin does not contain the canonical HUD wrapper assets. "
                + "Update or reinstall the oh-my-claudecode Copilot plugin.";
    }
    else if (needsRepair) {
        diagnostic = "Copilot HUD setup is missing or stale and can be repaired.";
    }
    else {
        diagnostic = "Copilot HUD is configured and ready.";
    }
    return {
        copilotHome,
        settingsPath,
        wrapperPath,
        pluginRoot,
        runtimePath,
        expectedCommand,
        ownership,
        settingsValid: parsedSettings.valid,
        runtimeAvailable,
        wrapperInstalled,
        wrapperCurrent,
        configured,
        needsRepair,
        diagnostic,
        settingsContent: parsedSettings.content,
        settings: parsedSettings.settings,
        wrapperContent,
        helperContent,
        helperPath,
        helperCurrent,
    };
}
function toPublicStatus(snapshot) {
    const { settingsContent: _settingsContent, settings: _settings, wrapperContent: _wrapperContent, helperContent: _helperContent, helperPath: _helperPath, helperCurrent: _helperCurrent, ...status } = snapshot;
    return status;
}
export function inspectCopilotHud(options = {}) {
    return toPublicStatus(buildSnapshot(options));
}
function writeIfChanged(path, content, executable = false) {
    if (readOptionalFile(path) === content)
        return false;
    atomicWriteFileSync(path, content);
    if (executable && process.platform !== "win32") {
        chmodSync(path, 0o755);
    }
    return true;
}
export function configureCopilotHud(options = {}) {
    const before = buildSnapshot(options);
    const replaceExisting = options.replaceExisting === true;
    const replacedThirdParty = before.ownership === "third-party" && replaceExisting;
    if (!before.settingsValid
        || (before.ownership === "third-party" && !replaceExisting)
        || !before.runtimeAvailable
        || before.wrapperContent === null
        || before.helperContent === null) {
        return {
            ...toPublicStatus(before),
            changed: false,
            replacedThirdParty: false,
        };
    }
    const wrapperChanged = writeIfChanged(before.wrapperPath, before.wrapperContent, true);
    const helperChanged = writeIfChanged(before.helperPath, before.helperContent);
    let settingsChanged = false;
    if (before.ownership !== "omc"
        || !matchesExpectedStatusLine(before.settings.statusLine, before.expectedCommand)) {
        const updatedSettings = updateStatusLineJsonc(before.settingsContent, before.settings.statusLine, before.expectedCommand);
        if (updatedSettings !== before.settingsContent) {
            atomicWriteFileSync(before.settingsPath, updatedSettings);
            settingsChanged = true;
        }
    }
    const after = buildSnapshot(options);
    return {
        ...toPublicStatus(after),
        changed: wrapperChanged || helperChanged || settingsChanged,
        replacedThirdParty,
    };
}
function printHumanStatus(action, result) {
    console.log(`[OMC] Copilot HUD ${action}: ${result.diagnostic}`);
    console.log(`  Copilot home: ${result.copilotHome}`);
    console.log(`  Plugin root: ${result.pluginRoot}`);
    console.log(`  statusLine ownership: ${result.ownership}`);
    console.log(`  Command: ${result.expectedCommand}`);
    if ("changed" in result) {
        console.log(`  Changed: ${result.changed ? "yes" : "no"}`);
    }
}
function runCli(args) {
    const pluginDirIndex = args.indexOf("--plugin-dir");
    const action = (args.find((arg, index) => !arg.startsWith("-")
        && (pluginDirIndex < 0 || index !== pluginDirIndex + 1)) ?? "status");
    if (!["setup", "repair", "status", "doctor"].includes(action)) {
        console.error("Usage: copilot-hud-setup.mjs [setup|repair|status|doctor] [--replace] [--json] [--plugin-dir <path>]");
        return 2;
    }
    if (pluginDirIndex >= 0 && !args[pluginDirIndex + 1]) {
        console.error("--plugin-dir requires a path");
        return 2;
    }
    const options = {
        replaceExisting: args.includes("--replace"),
        packageRoot: pluginDirIndex >= 0
            ? resolve(args[pluginDirIndex + 1])
            : undefined,
    };
    const result = action === "setup" || action === "repair"
        ? configureCopilotHud(options)
        : inspectCopilotHud(options);
    if (args.includes("--json")) {
        console.log(JSON.stringify(result, null, 2));
    }
    else {
        printHumanStatus(action, result);
    }
    if (!result.settingsValid || result.ownership === "third-party")
        return 2;
    return result.needsRepair ? 1 : 0;
}
const entrypoint = process.argv[1];
if (entrypoint && resolve(entrypoint) === resolve(fileURLToPath(import.meta.url))) {
    process.exitCode = runCli(process.argv.slice(2));
}
//# sourceMappingURL=copilot-setup.js.map