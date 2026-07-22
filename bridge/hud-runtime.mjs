#!/usr/bin/env node

// src/hud/stdin.ts
import { existsSync as existsSync2, readFileSync as readFileSync2, statSync, writeFileSync as writeFileSync2, mkdirSync as mkdirSync2 } from "fs";
import { dirname as dirname2, join as join3 } from "path";

// src/lib/worktree-paths.ts
import { createHash } from "crypto";
import { execFileSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, readdirSync, writeFileSync, unlinkSync } from "fs";
import { homedir as homedir2, tmpdir } from "os";
import { resolve, normalize as normalize2, relative, sep as sep2, join as join2, isAbsolute, basename, dirname } from "path";

// src/utils/config-dir.ts
import { join, normalize, parse, sep } from "path";
import { homedir } from "os";
function stripTrailingSep(p) {
  if (!p.endsWith(sep)) {
    return p;
  }
  return p === parse(p).root ? p : p.slice(0, -1);
}
function getClaudeConfigDir() {
  const home = homedir();
  const configured = process.env.CLAUDE_CONFIG_DIR?.trim();
  if (!configured) {
    return stripTrailingSep(normalize(join(home, ".claude")));
  }
  if (configured === "~") {
    return stripTrailingSep(normalize(home));
  }
  if (configured.startsWith("~/") || configured.startsWith("~\\")) {
    return stripTrailingSep(normalize(join(home, configured.slice(2))));
  }
  return stripTrailingSep(normalize(configured));
}
function getOmcConfigDir() {
  return join(getClaudeConfigDir(), ".omc");
}
function getUpdateCheckCachePath() {
  return join(getOmcConfigDir(), "update-check.json");
}

// src/utils/encode-project-path.ts
function encodeProjectPath(projectPath) {
  return projectPath.replace(/[^a-zA-Z0-9]/g, "-");
}

// src/lib/worktree-paths.ts
var WORKSPACE_MARKER = ".omc-workspace";
var OmcPaths = {
  ROOT: ".omc",
  STATE: ".omc/state",
  SESSIONS: ".omc/state/sessions",
  PLANS: ".omc/plans",
  RESEARCH: ".omc/research",
  NOTEPAD: ".omc/notepad.md",
  PROJECT_MEMORY: ".omc/project-memory.json",
  DRAFTS: ".omc/drafts",
  NOTEPADS: ".omc/notepads",
  LOGS: ".omc/logs",
  SCIENTIST: ".omc/scientist",
  AUTOPILOT: ".omc/autopilot",
  SKILLS: ".omc/skills",
  SHARED_MEMORY: ".omc/state/shared-memory",
  DEEPINIT_MANIFEST: ".omc/deepinit-manifest.json"
};
var MAX_WORKTREE_CACHE_SIZE = 8;
var worktreeCacheMap = /* @__PURE__ */ new Map();
var toplevelCacheMap = /* @__PURE__ */ new Map();
var superprojectCacheMap = /* @__PURE__ */ new Map();
var workspaceCacheMap = /* @__PURE__ */ new Map();
function findWorkspaceRoot(startDir) {
  if (process.env.OMC_DISABLE_MULTIREPO === "1") return null;
  const effectiveStart = startDir || process.cwd();
  let current;
  try {
    current = resolve(effectiveStart);
  } catch {
    return null;
  }
  if (workspaceCacheMap.has(current)) {
    const cached = workspaceCacheMap.get(current) ?? null;
    workspaceCacheMap.delete(current);
    workspaceCacheMap.set(current, cached);
    return cached;
  }
  const home = (() => {
    try {
      return resolve(homedir2());
    } catch {
      return null;
    }
  })();
  let cursor = current;
  let result = null;
  while (true) {
    if (home && cursor === home) break;
    if (existsSync(join2(cursor, WORKSPACE_MARKER))) {
      result = cursor;
      break;
    }
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  if (workspaceCacheMap.size >= MAX_WORKTREE_CACHE_SIZE) {
    const oldest = workspaceCacheMap.keys().next().value;
    if (oldest !== void 0) workspaceCacheMap.delete(oldest);
  }
  workspaceCacheMap.set(current, result);
  return result;
}
function readWorkspaceMarkerConfig(workspaceRoot) {
  try {
    const raw = readFileSync(join2(workspaceRoot, WORKSPACE_MARKER), "utf-8").trim();
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
    return {};
  } catch {
    return {};
  }
}
function isDefinitiveNonGitError(error) {
  if (!error || typeof error !== "object") return false;
  const { status, stderr } = error;
  if (status !== 128) return false;
  const output = typeof stderr === "string" ? stderr : Buffer.isBuffer(stderr) ? stderr.toString() : "";
  return /not a git repository/i.test(output);
}
function resolveSuperprojectRoot(cwd) {
  const cacheKey = resolve(cwd);
  if (superprojectCacheMap.has(cacheKey)) {
    const cached = superprojectCacheMap.get(cacheKey) ?? null;
    superprojectCacheMap.delete(cacheKey);
    superprojectCacheMap.set(cacheKey, cached);
    return cached;
  }
  let anchor = null;
  let probeCwd = cacheKey;
  let completed = false;
  for (let depth = 0; depth < 32; depth++) {
    let superRoot;
    try {
      superRoot = execFileSync("git", ["rev-parse", "--show-superproject-working-tree"], {
        cwd: probeCwd,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        timeout: 5e3
      }).trim();
    } catch (error) {
      completed = depth === 0 && isDefinitiveNonGitError(error);
      break;
    }
    if (!superRoot) {
      completed = true;
      break;
    }
    anchor = superRoot;
    probeCwd = superRoot;
  }
  if (completed) {
    if (superprojectCacheMap.size >= MAX_WORKTREE_CACHE_SIZE) {
      const oldest = superprojectCacheMap.keys().next().value;
      if (oldest !== void 0) superprojectCacheMap.delete(oldest);
    }
    superprojectCacheMap.set(cacheKey, anchor);
  }
  return anchor;
}
function hasGitMetadataAncestor(directory) {
  if (process.env.GIT_DIR || process.env.GIT_WORK_TREE) return true;
  let probe = resolve(directory);
  while (true) {
    if (existsSync(join2(probe, ".git"))) return true;
    const parent = dirname(probe);
    if (parent === probe) return false;
    probe = parent;
  }
}
function resolveStateAnchorRoot(worktreeRoot) {
  if (worktreeRoot) {
    return hasGitMetadataAncestor(worktreeRoot) ? resolveSuperprojectRoot(worktreeRoot) || worktreeRoot : worktreeRoot;
  }
  return getWorktreeRoot() || process.cwd();
}
function getGitTopLevel(cwd) {
  const effectiveCwd = cwd || process.cwd();
  if (toplevelCacheMap.has(effectiveCwd)) {
    const root = toplevelCacheMap.get(effectiveCwd);
    toplevelCacheMap.delete(effectiveCwd);
    toplevelCacheMap.set(effectiveCwd, root);
    return root || null;
  }
  try {
    const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: effectiveCwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      timeout: 5e3
    }).trim();
    if (toplevelCacheMap.size >= MAX_WORKTREE_CACHE_SIZE) {
      const oldest = toplevelCacheMap.keys().next().value;
      if (oldest !== void 0) toplevelCacheMap.delete(oldest);
    }
    toplevelCacheMap.set(effectiveCwd, root);
    return root;
  } catch {
    return null;
  }
}
function getWorktreeRoot(cwd) {
  const effectiveCwd = cwd || process.cwd();
  if (worktreeCacheMap.has(effectiveCwd)) {
    const root2 = worktreeCacheMap.get(effectiveCwd);
    worktreeCacheMap.delete(effectiveCwd);
    worktreeCacheMap.set(effectiveCwd, root2);
    return root2 || null;
  }
  const root = resolveSuperprojectRoot(effectiveCwd) || getGitTopLevel(effectiveCwd);
  if (!root) {
    return null;
  }
  if (worktreeCacheMap.size >= MAX_WORKTREE_CACHE_SIZE) {
    const oldest = worktreeCacheMap.keys().next().value;
    if (oldest !== void 0) {
      worktreeCacheMap.delete(oldest);
    }
  }
  worktreeCacheMap.set(effectiveCwd, root);
  return root;
}
function validatePath(inputPath) {
  if (inputPath.includes("..")) {
    throw new Error(`Invalid path: path traversal not allowed (${inputPath})`);
  }
  if (inputPath.startsWith("~") || isAbsolute(inputPath)) {
    throw new Error(`Invalid path: absolute paths not allowed (${inputPath})`);
  }
}
var dualDirWarnings = /* @__PURE__ */ new Set();
function getProjectIdentifier(worktreeRoot) {
  const root = worktreeRoot || getGitTopLevel() || process.cwd();
  const workspaceRoot = findWorkspaceRoot(root);
  if (workspaceRoot) {
    const cfg = readWorkspaceMarkerConfig(workspaceRoot);
    if (cfg.id && typeof cfg.id === "string" && cfg.id.trim()) {
      const safeId = cfg.id.trim().replace(/[^a-zA-Z0-9_-]/g, "_");
      const hash3 = createHash("sha256").update(safeId).digest("hex").slice(0, 16);
      return `${safeId}-${hash3}`;
    }
    const hash2 = createHash("sha256").update(workspaceRoot).digest("hex").slice(0, 16);
    const dirName2 = basename(workspaceRoot).replace(/[^a-zA-Z0-9_-]/g, "_");
    return `${dirName2}-${hash2}`;
  }
  let source;
  try {
    const remoteUrl = execFileSync("git", ["remote", "get-url", "origin"], {
      cwd: root,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    }).trim();
    source = remoteUrl || root;
  } catch {
    source = root;
  }
  let primaryRoot = root;
  try {
    const commonDir = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
      cwd: root,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      timeout: 5e3
    }).trim();
    const isGitDir = basename(commonDir) === ".git";
    const isSubmodule = commonDir.includes(`${sep2}.git${sep2}modules`);
    if (isGitDir && !isSubmodule) {
      const resolved = dirname(commonDir);
      if (resolved && resolved !== root) {
        primaryRoot = resolved;
      }
    }
  } catch {
  }
  const hash = createHash("sha256").update(source).digest("hex").slice(0, 16);
  const dirName = basename(primaryRoot).replace(/[^a-zA-Z0-9_-]/g, "_");
  return `${dirName}-${hash}`;
}
function getOmcRoot(worktreeRoot) {
  const customDir = process.env.OMC_STATE_DIR;
  if (customDir) {
    const root2 = worktreeRoot || getGitTopLevel() || process.cwd();
    const projectId = getProjectIdentifier(root2);
    const centralizedPath = join2(customDir, projectId);
    const legacyPath = join2(root2, OmcPaths.ROOT);
    const warningKey = `${legacyPath}:${centralizedPath}`;
    if (!dualDirWarnings.has(warningKey) && existsSync(legacyPath) && existsSync(centralizedPath)) {
      dualDirWarnings.add(warningKey);
      console.warn(
        `[omc] Both legacy state dir (${legacyPath}) and centralized state dir (${centralizedPath}) exist. Using centralized dir. Consider migrating data from the legacy dir and removing it.`
      );
    }
    return centralizedPath;
  }
  const workspaceAnchor = findWorkspaceRoot(worktreeRoot);
  if (workspaceAnchor) {
    return join2(workspaceAnchor, OmcPaths.ROOT);
  }
  const root = resolveStateAnchorRoot(worktreeRoot);
  return join2(root, OmcPaths.ROOT);
}
function resolveOmcPath(relativePath, worktreeRoot) {
  validatePath(relativePath);
  const omcDir = getOmcRoot(worktreeRoot);
  const fullPath = normalize2(resolve(omcDir, relativePath));
  const relativeToOmc = relative(omcDir, fullPath);
  if (relativeToOmc.startsWith("..") || relativeToOmc.startsWith(sep2 + "..")) {
    throw new Error(`Path escapes omc boundary: ${relativePath}`);
  }
  return fullPath;
}
function resolveStatePath(stateName, worktreeRoot) {
  const normalizedName = stateName.endsWith("-state") ? stateName : `${stateName}-state`;
  return resolveOmcPath(`state/${normalizedName}.json`, worktreeRoot);
}
var SESSION_ID_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,255}$/;
var processSessionId = null;
function getProcessSessionId() {
  if (!processSessionId) {
    const pid = process.pid;
    const startTime = Date.now();
    processSessionId = `pid-${pid}-${startTime}`;
  }
  return processSessionId;
}
function validateSessionId(sessionId) {
  if (!sessionId) {
    throw new Error("Session ID cannot be empty");
  }
  if (sessionId.includes("..") || sessionId.includes("/") || sessionId.includes("\\")) {
    throw new Error(`Invalid session ID: path traversal not allowed (${sessionId})`);
  }
  if (!SESSION_ID_REGEX.test(sessionId)) {
    throw new Error(`Invalid session ID: must be alphanumeric with hyphens/underscores, max 256 chars (${sessionId})`);
  }
}
function resolveSessionStatePath(stateName, sessionId, worktreeRoot) {
  validateSessionId(sessionId);
  const normalizedName = stateName.endsWith("-state") ? stateName : `${stateName}-state`;
  return resolveOmcPath(`state/sessions/${sessionId}/${normalizedName}.json`, worktreeRoot);
}
function resolveSessionStatePaths(stateName, sessionId, worktreeRoot, _opts) {
  const normalizedName = stateName.endsWith("-state") ? stateName : `${stateName}-state`;
  const legacy = resolveStatePath(stateName, worktreeRoot);
  if (!sessionId) {
    return {
      sessionScoped: "",
      legacy,
      effectiveRead: legacy,
      effectiveWrite: legacy
    };
  }
  validateSessionId(sessionId);
  const sessionScoped = resolveOmcPath(`state/sessions/${sessionId}/${normalizedName}.json`, worktreeRoot);
  const effectiveRead = existsSync(sessionScoped) ? sessionScoped : legacy;
  return {
    sessionScoped,
    legacy,
    effectiveRead,
    effectiveWrite: sessionScoped
  };
}
function isLegacyStateMigrationEnabled() {
  return process.env.OMC_MIGRATE_LEGACY_STATE === "1";
}
function getSessionStateDir(sessionId, worktreeRoot) {
  validateSessionId(sessionId);
  return join2(getOmcRoot(worktreeRoot), "state", "sessions", sessionId);
}
function listSessionIds(worktreeRoot) {
  const sessionsDir = join2(getOmcRoot(worktreeRoot), "state", "sessions");
  if (!existsSync(sessionsDir)) {
    return [];
  }
  try {
    const entries = readdirSync(sessionsDir, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory() && SESSION_ID_REGEX.test(entry.name)).map((entry) => entry.name);
  } catch {
    return [];
  }
}
function ensureSessionStateDir(sessionId, worktreeRoot) {
  const sessionDir = getSessionStateDir(sessionId, worktreeRoot);
  if (!existsSync(sessionDir)) {
    try {
      mkdirSync(sessionDir, { recursive: true });
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
    }
  }
  return sessionDir;
}
function resolveToWorktreeRoot(directory) {
  const resolveRoot = process.env.OMC_STATE_DIR ? getGitTopLevel : getWorktreeRoot;
  const processDirectory = resolve(process.cwd());
  if (directory) {
    const resolved = resolve(directory);
    if (resolved === processDirectory && !hasGitMetadataAncestor(resolved)) {
      console.error("[worktree] non-git directory provided, falling back to process root", {
        directory: resolved
      });
      return processDirectory;
    }
    const root = resolveRoot(resolved);
    if (root) return root;
    console.error("[worktree] non-git directory provided, falling back to process root", {
      directory: resolved
    });
    if (resolved === processDirectory) return processDirectory;
  }
  return resolveRoot(processDirectory) || processDirectory;
}
function resolveTranscriptPath(transcriptPath, cwd) {
  if (!transcriptPath) return void 0;
  if (existsSync(transcriptPath)) return transcriptPath;
  const worktreeSegmentPattern = /--claude-worktrees-[^/\\]+/;
  if (worktreeSegmentPattern.test(transcriptPath)) {
    const resolved = transcriptPath.replace(worktreeSegmentPattern, "");
    if (existsSync(resolved)) return resolved;
  }
  const effectiveCwd = cwd || process.cwd();
  const normalizedCwd = normalize2(effectiveCwd);
  const worktreeMarker = normalize2("/.claude/worktrees/");
  const markerIdx = normalizedCwd.indexOf(worktreeMarker);
  if (markerIdx !== -1) {
    const mainProjectRoot = normalizedCwd.substring(0, markerIdx);
    const sessionFile = basename(transcriptPath);
    if (sessionFile) {
      const projectsDir = join2(getClaudeConfigDir(), "projects");
      if (existsSync(projectsDir)) {
        const encodedMain = encodeProjectPath(mainProjectRoot);
        const resolvedPath = join2(projectsDir, encodedMain, sessionFile);
        if (existsSync(resolvedPath)) return resolvedPath;
      }
    }
  }
  const worktreeTop = getGitTopLevel(effectiveCwd);
  if (!worktreeTop) return transcriptPath;
  try {
    const gitCommonDir = execFileSync("git", ["rev-parse", "--git-common-dir"], {
      cwd: effectiveCwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      timeout: 5e3
    }).trim();
    const absoluteCommonDir = resolve(effectiveCwd, gitCommonDir);
    let mainRepoRoot = dirname(absoluteCommonDir);
    if (mainRepoRoot.endsWith(join2(".git", "worktrees"))) {
      mainRepoRoot = dirname(dirname(mainRepoRoot));
    }
    try {
      mainRepoRoot = realpathSync(mainRepoRoot);
    } catch {
    }
    let canonicalWorktreeTop = worktreeTop;
    try {
      canonicalWorktreeTop = realpathSync(canonicalWorktreeTop);
    } catch {
    }
    if (mainRepoRoot !== canonicalWorktreeTop) {
      const sessionFile = basename(transcriptPath);
      if (sessionFile) {
        const projectsDir = join2(getClaudeConfigDir(), "projects");
        if (existsSync(projectsDir)) {
          const encodedMain = encodeProjectPath(mainRepoRoot);
          const resolvedPath = join2(projectsDir, encodedMain, sessionFile);
          if (existsSync(resolvedPath)) return resolvedPath;
        }
      }
    }
  } catch {
  }
  return transcriptPath;
}
function validateWorkingDirectory(workingDirectory) {
  const trustedRoot = getGitTopLevel(process.cwd()) || process.cwd();
  if (!workingDirectory) {
    return trustedRoot;
  }
  const resolved = resolve(workingDirectory);
  let trustedRootReal;
  try {
    trustedRootReal = realpathSync(trustedRoot);
  } catch {
    trustedRootReal = trustedRoot;
  }
  const providedRoot = getGitTopLevel(resolved);
  if (providedRoot) {
    let providedRootReal;
    try {
      providedRootReal = realpathSync(providedRoot);
    } catch {
      throw new Error(`workingDirectory '${workingDirectory}' does not exist or is not accessible.`);
    }
    if (providedRootReal !== trustedRootReal) {
      console.error("[worktree] workingDirectory resolved to different git worktree root, using trusted root", {
        workingDirectory: resolved,
        providedRoot: providedRootReal,
        trustedRoot: trustedRootReal
      });
      return trustedRoot;
    }
    return providedRoot;
  }
  let resolvedReal;
  try {
    resolvedReal = realpathSync(resolved);
  } catch {
    throw new Error(`workingDirectory '${workingDirectory}' does not exist or is not accessible.`);
  }
  const rel = relative(trustedRootReal, resolvedReal);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`workingDirectory '${workingDirectory}' is outside the trusted worktree root '${trustedRoot}'.`);
  }
  return trustedRoot;
}

// src/hud/copilot-stdin.ts
function isCopilotStatuslinePayload(value) {
  if (!value || typeof value !== "object") return false;
  const payload = value;
  const workspace = payload.workspace;
  const hasWorkspaceCurrentDir = !!workspace && typeof workspace === "object" && typeof workspace.current_dir === "string";
  return typeof payload.version === "string" && hasWorkspaceCurrentDir && !!payload.ai_used && typeof payload.ai_used === "object";
}
function adaptCopilotStatusline(payload) {
  const result = {};
  if (typeof payload.cwd === "string") {
    result.cwd = payload.cwd;
  }
  if (typeof payload.transcript_path === "string") {
    result.transcript_path = payload.transcript_path;
  }
  const model = payload.model;
  if (model && typeof model === "object") {
    const modelRecord = model;
    const mappedModel = {};
    if (typeof modelRecord.id === "string") mappedModel.id = modelRecord.id;
    if (typeof modelRecord.display_name === "string") {
      mappedModel.display_name = modelRecord.display_name;
    }
    if (Object.keys(mappedModel).length > 0) {
      result.model = mappedModel;
    }
  }
  const contextWindow = payload.context_window;
  if (contextWindow && typeof contextWindow === "object") {
    const contextWindowRecord = contextWindow;
    const mappedContextWindow = {};
    if (typeof contextWindowRecord.displayed_context_limit === "number") {
      mappedContextWindow.context_window_size = contextWindowRecord.displayed_context_limit;
    } else if (typeof contextWindowRecord.context_window_size === "number") {
      mappedContextWindow.context_window_size = contextWindowRecord.context_window_size;
    }
    if (typeof contextWindowRecord.current_context_tokens === "number") {
      mappedContextWindow.total_input_tokens = contextWindowRecord.current_context_tokens;
    }
    if (typeof contextWindowRecord.current_context_used_percentage === "number") {
      mappedContextWindow.used_percentage = contextWindowRecord.current_context_used_percentage;
    } else if (typeof contextWindowRecord.used_percentage === "number") {
      mappedContextWindow.used_percentage = contextWindowRecord.used_percentage;
    }
    const currentUsage = contextWindowRecord.current_usage;
    if (currentUsage && typeof currentUsage === "object") {
      const currentUsageRecord = currentUsage;
      const mappedCurrentUsage = {};
      if (typeof currentUsageRecord.input_tokens === "number") {
        mappedCurrentUsage.input_tokens = currentUsageRecord.input_tokens;
      }
      if (typeof currentUsageRecord.output_tokens === "number") {
        mappedCurrentUsage.output_tokens = currentUsageRecord.output_tokens;
      }
      if (typeof currentUsageRecord.cache_creation_input_tokens === "number") {
        mappedCurrentUsage.cache_creation_input_tokens = currentUsageRecord.cache_creation_input_tokens;
      }
      if (typeof currentUsageRecord.cache_read_input_tokens === "number") {
        mappedCurrentUsage.cache_read_input_tokens = currentUsageRecord.cache_read_input_tokens;
      }
      if (Object.keys(mappedCurrentUsage).length > 0) {
        mappedContextWindow.current_usage = mappedCurrentUsage;
      }
    }
    if (Object.keys(mappedContextWindow).length > 0) {
      result.context_window = mappedContextWindow;
    }
  }
  return result;
}
function normalizeStatuslineStdin(payload) {
  if (isCopilotStatuslinePayload(payload)) {
    return adaptCopilotStatusline(payload);
  }
  return payload;
}

// src/hud/stdin.ts
var TRANSIENT_CONTEXT_PERCENT_TOLERANCE = 3;
var SESSION_ID_ENV_VARS = ["CLAUDE_SESSION_ID", "CLAUDECODE_SESSION_ID"];
function normalizeCandidate(value) {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
function getStdinCachePath() {
  const root = getWorktreeRoot() || process.cwd();
  for (const envVar of SESSION_ID_ENV_VARS) {
    const candidate = normalizeCandidate(process.env[envVar]);
    if (!candidate) continue;
    try {
      return join3(getSessionStateDir(candidate, root), "hud-stdin-cache.json");
    } catch {
    }
  }
  return resolveOmcPath("state/hud-stdin-cache.json", root);
}
function writeStdinCache(stdin) {
  try {
    const cachePath = getStdinCachePath();
    const cacheDir = dirname2(cachePath);
    if (!existsSync2(cacheDir)) {
      mkdirSync2(cacheDir, { recursive: true });
    }
    writeFileSync2(cachePath, JSON.stringify(stdin));
  } catch {
  }
}
function readStdinCache() {
  const root = getWorktreeRoot() || process.cwd();
  const scopedPath = getStdinCachePath();
  const tryRead = (p) => {
    try {
      if (!existsSync2(p)) return null;
      return JSON.parse(readFileSync2(p, "utf-8"));
    } catch {
      return null;
    }
  };
  const scoped = tryRead(scopedPath);
  if (scoped) return scoped;
  const legacyPath = resolveOmcPath("state/hud-stdin-cache.json", root);
  if (scopedPath !== legacyPath) {
    return null;
  }
  return readMostRecentSessionCache(root);
}
function readMostRecentSessionCache(root) {
  let sessionIds;
  try {
    sessionIds = listSessionIds(root);
  } catch {
    return null;
  }
  let bestPath = null;
  let bestMtime = -Infinity;
  for (const sid of sessionIds) {
    let candidate;
    try {
      candidate = join3(getSessionStateDir(sid, root), "hud-stdin-cache.json");
    } catch {
      continue;
    }
    try {
      const st = statSync(candidate);
      if (!st.isFile()) continue;
      if (st.mtimeMs > bestMtime) {
        bestMtime = st.mtimeMs;
        bestPath = candidate;
      }
    } catch {
    }
  }
  if (!bestPath) return null;
  try {
    return JSON.parse(readFileSync2(bestPath, "utf-8"));
  } catch {
    return null;
  }
}
async function readStdin() {
  if (process.stdin.isTTY) {
    return null;
  }
  const chunks = [];
  try {
    process.stdin.setEncoding("utf8");
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    const raw = chunks.join("");
    if (!raw.trim()) {
      return null;
    }
    return normalizeStatuslineStdin(JSON.parse(raw));
  } catch {
    return null;
  }
}
function getCurrentUsage(stdin) {
  return stdin.context_window?.current_usage;
}
function clampPercent(value) {
  if (value == null || !isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, value));
}
function parseResetDate(value) {
  if (value == null) {
    return null;
  }
  const numericValue = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN;
  if (Number.isFinite(numericValue)) {
    const millis = Math.abs(numericValue) < 1e12 ? numericValue * 1e3 : numericValue;
    const date = new Date(millis);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === "string") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}
function getTotalTokens(stdin) {
  const usage = getCurrentUsage(stdin);
  return (usage?.input_tokens ?? 0) + (usage?.cache_creation_input_tokens ?? 0) + (usage?.cache_read_input_tokens ?? 0);
}
function getTotalInputTokens(stdin) {
  return stdin.context_window?.total_input_tokens ?? 0;
}
function getRoundedNativeContextPercent(stdin) {
  const nativePercent = stdin?.context_window?.used_percentage;
  if (typeof nativePercent !== "number" || Number.isNaN(nativePercent)) {
    return null;
  }
  return Math.min(100, Math.max(0, Math.round(nativePercent)));
}
function getPositiveNativeContextPercent(stdin) {
  const nativePercent = stdin?.context_window?.used_percentage;
  if (typeof nativePercent !== "number" || Number.isNaN(nativePercent) || nativePercent <= 0) {
    return null;
  }
  return Math.min(100, Math.max(0, Math.round(nativePercent)));
}
function getManualContextPercent(stdin) {
  const size = stdin.context_window?.context_window_size;
  if (!size || size <= 0) {
    return null;
  }
  const totalTokens = getTotalTokens(stdin);
  return Math.min(100, Math.round(totalTokens / size * 100));
}
function getPositiveManualContextPercent(stdin) {
  const manualPercent = getManualContextPercent(stdin);
  return manualPercent !== null && manualPercent > 0 ? manualPercent : null;
}
function getTotalInputContextPercent(stdin) {
  const size = stdin.context_window?.context_window_size;
  if (!size || size <= 0) {
    return null;
  }
  const totalInputTokens = getTotalInputTokens(stdin);
  if (totalInputTokens <= 0) {
    return null;
  }
  return Math.min(100, Math.round(totalInputTokens / size * 100));
}
function isSameContextStream(current, previous) {
  return current.cwd === previous.cwd && current.transcript_path === previous.transcript_path && current.context_window?.context_window_size === previous.context_window?.context_window_size;
}
function stabilizeContextPercent(stdin, previousStdin) {
  if (getPositiveNativeContextPercent(stdin) !== null) {
    return stdin;
  }
  if (!previousStdin || !isSameContextStream(stdin, previousStdin)) {
    return stdin;
  }
  const previousNativePercent = getRoundedNativeContextPercent(previousStdin);
  if (previousNativePercent === null) {
    return stdin;
  }
  const fallbackPercent = getPositiveManualContextPercent(stdin) ?? getTotalInputContextPercent(stdin);
  if (fallbackPercent === null && getRoundedNativeContextPercent(stdin) === 0) {
    return stdin;
  }
  if (fallbackPercent !== null && Math.abs(fallbackPercent - previousNativePercent) > TRANSIENT_CONTEXT_PERCENT_TOLERANCE) {
    return stdin;
  }
  return {
    ...stdin,
    context_window: {
      ...stdin.context_window,
      used_percentage: previousStdin.context_window?.used_percentage ?? previousNativePercent
    }
  };
}
function getContextPercent(stdin) {
  return getPositiveNativeContextPercent(stdin) ?? getPositiveManualContextPercent(stdin) ?? getTotalInputContextPercent(stdin) ?? 0;
}
function getRateLimitsFromStdin(stdin) {
  const fiveHour = stdin.rate_limits?.five_hour?.used_percentage;
  const sevenDay = stdin.rate_limits?.seven_day?.used_percentage;
  if (fiveHour == null && sevenDay == null) {
    return null;
  }
  return {
    fiveHourPercent: clampPercent(fiveHour),
    weeklyPercent: sevenDay == null ? void 0 : clampPercent(sevenDay),
    fiveHourResetsAt: parseResetDate(stdin.rate_limits?.five_hour?.resets_at),
    weeklyResetsAt: parseResetDate(stdin.rate_limits?.seven_day?.resets_at)
  };
}
function getModelId(stdin) {
  const modelId = stdin.model?.id?.trim();
  return modelId || null;
}
function getModelName(stdin) {
  const displayName = stdin.model?.display_name?.trim();
  return displayName || getModelId(stdin);
}

// src/hud/transcript.ts
import {
  createReadStream,
  existsSync as existsSync3,
  statSync as statSync2,
  openSync,
  readSync,
  closeSync
} from "fs";
import { createInterface } from "readline";
import { basename as basename2 } from "path";
var MAX_TAIL_BYTES = 4 * 1024 * 1024;
var MAX_AGENT_MAP_SIZE = 100;
var PERMISSION_TOOLS = [
  "Edit",
  "Write",
  "Bash",
  "proxy_Edit",
  "proxy_Write",
  "proxy_Bash"
];
var PERMISSION_THRESHOLD_MS = 3e3;
var pendingPermissionMap = /* @__PURE__ */ new Map();
var THINKING_PART_TYPES = ["thinking", "reasoning"];
var THINKING_RECENCY_MS = 3e4;
var transcriptCache = /* @__PURE__ */ new Map();
var TRANSCRIPT_CACHE_MAX_SIZE = 20;
async function parseTranscript(transcriptPath, options) {
  pendingPermissionMap.clear();
  const result = {
    agents: [],
    todos: [],
    lastActivatedSkill: void 0,
    toolCallCount: 0,
    agentCallCount: 0,
    skillCallCount: 0,
    lastToolName: null
  };
  if (!transcriptPath || !existsSync3(transcriptPath)) {
    return result;
  }
  let cacheKey = null;
  try {
    const stat = statSync2(transcriptPath);
    cacheKey = `${transcriptPath}:${stat.size}:${stat.mtimeMs}`;
    const cached = transcriptCache.get(transcriptPath);
    if (cached?.cacheKey === cacheKey) {
      return finalizeTranscriptResult(cloneTranscriptData(cached.baseResult), options, cached.pendingPermissions);
    }
  } catch {
    return result;
  }
  const agentMap = /* @__PURE__ */ new Map();
  const backgroundAgentMap = /* @__PURE__ */ new Map();
  const latestTodos = [];
  const sessionTokenTotals = {
    inputTokens: 0,
    outputTokens: 0,
    seenUsage: false
  };
  let sessionTotalsReliable = false;
  const observedSessionIds = /* @__PURE__ */ new Set();
  try {
    const stat = statSync2(transcriptPath);
    const fileSize = stat.size;
    if (fileSize > MAX_TAIL_BYTES) {
      const lines = readTailLines(transcriptPath, fileSize, MAX_TAIL_BYTES);
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line);
          processEntry(
            entry,
            agentMap,
            latestTodos,
            result,
            MAX_AGENT_MAP_SIZE,
            backgroundAgentMap,
            sessionTokenTotals,
            observedSessionIds
          );
        } catch {
        }
      }
      sessionTotalsReliable = sessionTokenTotals.seenUsage;
    } else {
      const fileStream = createReadStream(transcriptPath);
      const rl = createInterface({
        input: fileStream,
        crlfDelay: Infinity
      });
      for await (const line of rl) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line);
          processEntry(
            entry,
            agentMap,
            latestTodos,
            result,
            MAX_AGENT_MAP_SIZE,
            backgroundAgentMap,
            sessionTokenTotals,
            observedSessionIds
          );
        } catch {
        }
      }
      sessionTotalsReliable = observedSessionIds.size <= 1;
    }
  } catch {
    return finalizeTranscriptResult(result, options, []);
  }
  const running = Array.from(agentMap.values()).filter(
    (a) => a.status === "running"
  );
  const completed = Array.from(agentMap.values()).filter(
    (a) => a.status === "completed"
  );
  result.agents = [
    ...running,
    ...completed.slice(-(10 - running.length))
  ].slice(0, 10);
  result.todos = latestTodos;
  if (sessionTotalsReliable && sessionTokenTotals.seenUsage) {
    result.sessionTotalTokens = sessionTokenTotals.inputTokens + sessionTokenTotals.outputTokens;
  }
  const pendingPermissions = Array.from(pendingPermissionMap.values()).map(clonePendingPermission);
  const finalized = finalizeTranscriptResult(result, options, pendingPermissions);
  if (cacheKey) {
    if (transcriptCache.size >= TRANSCRIPT_CACHE_MAX_SIZE) {
      transcriptCache.clear();
    }
    transcriptCache.set(transcriptPath, {
      cacheKey,
      baseResult: cloneTranscriptData(finalized),
      pendingPermissions
    });
  }
  return finalized;
}
function cloneDate(value) {
  return value ? new Date(value.getTime()) : void 0;
}
function clonePendingPermission(permission) {
  return {
    ...permission,
    timestamp: new Date(permission.timestamp.getTime())
  };
}
function cloneTranscriptData(result) {
  return {
    ...result,
    agents: result.agents.map((agent) => ({
      ...agent,
      startTime: new Date(agent.startTime.getTime()),
      endTime: cloneDate(agent.endTime)
    })),
    todos: result.todos.map((todo) => ({ ...todo })),
    sessionStart: cloneDate(result.sessionStart),
    lastActivatedSkill: result.lastActivatedSkill ? {
      ...result.lastActivatedSkill,
      timestamp: new Date(result.lastActivatedSkill.timestamp.getTime())
    } : void 0,
    pendingPermission: result.pendingPermission ? clonePendingPermission(result.pendingPermission) : void 0,
    thinkingState: result.thinkingState ? {
      ...result.thinkingState,
      lastSeen: cloneDate(result.thinkingState.lastSeen)
    } : void 0,
    lastRequestTokenUsage: result.lastRequestTokenUsage ? { ...result.lastRequestTokenUsage } : void 0
  };
}
function finalizeTranscriptResult(result, options, pendingPermissions) {
  const staleMinutes = options?.staleTaskThresholdMinutes ?? 30;
  const staleAgentThresholdMs = staleMinutes * 60 * 1e3;
  const now = Date.now();
  for (const agent of result.agents) {
    if (agent.status === "running") {
      const runningTime = now - agent.startTime.getTime();
      if (runningTime > staleAgentThresholdMs) {
        agent.status = "completed";
        agent.endTime = new Date(agent.startTime.getTime() + staleAgentThresholdMs);
      }
    }
  }
  result.pendingPermission = void 0;
  for (const permission of pendingPermissions) {
    const age = now - permission.timestamp.getTime();
    if (age <= PERMISSION_THRESHOLD_MS) {
      result.pendingPermission = clonePendingPermission(permission);
      break;
    }
  }
  if (result.thinkingState?.lastSeen) {
    const age = now - result.thinkingState.lastSeen.getTime();
    result.thinkingState.active = age <= THINKING_RECENCY_MS;
  }
  return result;
}
function readTailLines(filePath, fileSize, maxBytes) {
  const startOffset = Math.max(0, fileSize - maxBytes);
  const bytesToRead = fileSize - startOffset;
  const fd = openSync(filePath, "r");
  const buffer = Buffer.alloc(bytesToRead);
  try {
    readSync(fd, buffer, 0, bytesToRead, startOffset);
  } finally {
    closeSync(fd);
  }
  const content = buffer.toString("utf8");
  const lines = content.split("\n");
  if (startOffset > 0 && lines.length > 0) {
    lines.shift();
  }
  return lines;
}
function extractBackgroundAgentId(content) {
  const text = typeof content === "string" ? content : content.find((c) => c.type === "text")?.text || "";
  const match = text.match(/agentId:\s*([a-zA-Z0-9]+)/);
  return match ? match[1] : null;
}
function parseTaskOutputResult(content) {
  const text = typeof content === "string" ? content : content.find((c) => c.type === "text")?.text || "";
  const taskIdMatch = text.match(/<task-id>([^<]+)<\/task-id>/) || text.match(/<task_id>([^<]+)<\/task_id>/);
  const statusMatch = text.match(/<status>([^<]+)<\/status>/);
  const toolUseIdMatch = text.match(/<tool-use-id>([^<]+)<\/tool-use-id>/) || text.match(/<tool_use_id>([^<]+)<\/tool_use_id>/);
  if (taskIdMatch && statusMatch) {
    return {
      taskId: taskIdMatch[1],
      toolUseId: toolUseIdMatch ? toolUseIdMatch[1] : null,
      status: statusMatch[1]
    };
  }
  return null;
}
function extractTargetSummary(input, toolName) {
  if (!input || typeof input !== "object") return "...";
  const inp = input;
  if (toolName.includes("Edit") || toolName.includes("Write")) {
    const filePath = inp.file_path;
    if (filePath) {
      return basename2(filePath) || filePath;
    }
  }
  if (toolName.includes("Bash")) {
    const cmd = inp.command;
    if (cmd) {
      const trimmed = cmd.trim().substring(0, 20);
      return trimmed.length < cmd.trim().length ? `${trimmed}...` : trimmed;
    }
  }
  return "...";
}
function processEntry(entry, agentMap, latestTodos, result, maxAgentMapSize = 50, backgroundAgentMap, sessionTokenTotals, observedSessionIds) {
  const timestamp2 = entry.timestamp ? new Date(entry.timestamp) : /* @__PURE__ */ new Date();
  if (entry.sessionId) {
    observedSessionIds?.add(entry.sessionId);
  }
  const usage = extractLastRequestTokenUsage(entry.message?.usage);
  if (usage) {
    result.lastRequestTokenUsage = usage;
    if (sessionTokenTotals) {
      sessionTokenTotals.inputTokens += usage.inputTokens;
      sessionTokenTotals.outputTokens += usage.outputTokens;
      sessionTokenTotals.seenUsage = true;
    }
  }
  if (!result.sessionStart && entry.timestamp) {
    result.sessionStart = timestamp2;
  }
  const content = entry.message?.content;
  if (typeof content === "string") {
    if (content.includes("<task-notification>") || content.includes("<task_id>") || content.includes("<task-id>")) {
      const taskOutput = parseTaskOutputResult(content);
      if (taskOutput && taskOutput.status === "completed") {
        let toolUseId;
        if (taskOutput.toolUseId) {
          toolUseId = taskOutput.toolUseId;
        } else if (backgroundAgentMap) {
          toolUseId = backgroundAgentMap.get(taskOutput.taskId);
        }
        if (toolUseId) {
          const agent = agentMap.get(toolUseId);
          if (agent && agent.status === "running") {
            agent.status = "completed";
            agent.endTime = timestamp2;
          }
        }
      }
    }
    return;
  }
  if (!content || !Array.isArray(content)) return;
  for (const block of content) {
    if (THINKING_PART_TYPES.includes(
      block.type
    )) {
      result.thinkingState = {
        active: true,
        lastSeen: timestamp2
      };
    }
    if (block.type === "tool_use" && block.id && block.name) {
      result.toolCallCount++;
      result.lastToolName = block.name;
      if (block.name === "Task" || block.name === "proxy_Task" || block.name === "Agent" || block.name === "proxy_Agent") {
        result.agentCallCount++;
        const input = block.input;
        const agentEntry = {
          id: block.id,
          type: input?.subagent_type ?? "unknown",
          model: input?.model,
          name: input?.name,
          description: input?.description,
          status: "running",
          startTime: timestamp2
        };
        if (agentMap.size >= maxAgentMapSize) {
          let oldestCompleted = null;
          let oldestTime = Infinity;
          for (const [id, agent] of agentMap) {
            if (agent.status === "completed" && agent.startTime) {
              const time = agent.startTime.getTime();
              if (time < oldestTime) {
                oldestTime = time;
                oldestCompleted = id;
              }
            }
          }
          if (oldestCompleted) {
            agentMap.delete(oldestCompleted);
          }
        }
        agentMap.set(block.id, agentEntry);
      } else if (block.name === "TodoWrite" || block.name === "proxy_TodoWrite") {
        const input = block.input;
        if (input?.todos && Array.isArray(input.todos)) {
          latestTodos.length = 0;
          latestTodos.push(
            ...input.todos.map((t) => ({
              content: t.content,
              status: t.status,
              activeForm: t.activeForm
            }))
          );
        }
      } else if (block.name === "Skill" || block.name === "proxy_Skill") {
        result.skillCallCount++;
        const input = block.input;
        if (input?.skill) {
          result.lastActivatedSkill = {
            name: input.skill,
            args: input.args,
            timestamp: timestamp2
          };
        }
      }
      if (PERMISSION_TOOLS.includes(
        block.name
      )) {
        pendingPermissionMap.set(block.id, {
          toolName: block.name.replace("proxy_", ""),
          targetSummary: extractTargetSummary(block.input, block.name),
          timestamp: timestamp2
        });
      }
    }
    if (block.type === "tool_result" && block.tool_use_id) {
      pendingPermissionMap.delete(block.tool_use_id);
      const agent = agentMap.get(block.tool_use_id);
      if (agent) {
        const blockContent = block.content;
        const ASYNC_LAUNCH_PREFIX = "Async agent launched";
        const startsWithAsyncLaunch = (text) => !!text && text.trimStart().startsWith(ASYNC_LAUNCH_PREFIX);
        const isBackgroundLaunch = typeof blockContent === "string" ? startsWithAsyncLaunch(blockContent) : Array.isArray(blockContent) && blockContent.length > 0 && typeof blockContent[0] === "object" && blockContent[0] !== null && blockContent[0].type === "text" && startsWithAsyncLaunch(blockContent[0].text);
        if (isBackgroundLaunch) {
          if (backgroundAgentMap && blockContent) {
            const bgAgentId = extractBackgroundAgentId(blockContent);
            if (bgAgentId) {
              backgroundAgentMap.set(bgAgentId, block.tool_use_id);
            }
          }
        } else {
          agent.status = "completed";
          agent.endTime = timestamp2;
        }
      }
      if (block.content) {
        const taskOutput = parseTaskOutputResult(block.content);
        if (taskOutput && taskOutput.status === "completed") {
          let toolUseId;
          if (taskOutput.toolUseId) {
            toolUseId = taskOutput.toolUseId;
          } else if (backgroundAgentMap) {
            toolUseId = backgroundAgentMap.get(taskOutput.taskId);
          }
          if (toolUseId) {
            const bgAgent = agentMap.get(toolUseId);
            if (bgAgent && bgAgent.status === "running") {
              bgAgent.status = "completed";
              bgAgent.endTime = timestamp2;
            }
          }
        }
      }
    }
  }
}
function extractLastRequestTokenUsage(usage) {
  if (!usage) return null;
  const inputTokens = getNumericUsageValue(usage.input_tokens);
  const outputTokens = getNumericUsageValue(usage.output_tokens);
  const reasoningTokens = getNumericUsageValue(
    usage.reasoning_tokens ?? usage.output_tokens_details?.reasoning_tokens ?? usage.output_tokens_details?.reasoningTokens ?? usage.completion_tokens_details?.reasoning_tokens ?? usage.completion_tokens_details?.reasoningTokens
  );
  if (inputTokens == null && outputTokens == null) {
    return null;
  }
  const normalized = {
    inputTokens: Math.max(0, Math.round(inputTokens ?? 0)),
    outputTokens: Math.max(0, Math.round(outputTokens ?? 0))
  };
  if (reasoningTokens != null && reasoningTokens > 0) {
    normalized.reasoningTokens = Math.max(0, Math.round(reasoningTokens));
  }
  return normalized;
}
function getNumericUsageValue(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// src/hud/state.ts
import { existsSync as existsSync6, readFileSync as readFileSync7, mkdirSync as mkdirSync5, unlinkSync as unlinkSync5 } from "fs";
import { join as join7 } from "path";

// node_modules/jsonc-parser/lib/esm/impl/scanner.js
var CharacterCodes;
(function(CharacterCodes2) {
  CharacterCodes2[CharacterCodes2["lineFeed"] = 10] = "lineFeed";
  CharacterCodes2[CharacterCodes2["carriageReturn"] = 13] = "carriageReturn";
  CharacterCodes2[CharacterCodes2["space"] = 32] = "space";
  CharacterCodes2[CharacterCodes2["_0"] = 48] = "_0";
  CharacterCodes2[CharacterCodes2["_1"] = 49] = "_1";
  CharacterCodes2[CharacterCodes2["_2"] = 50] = "_2";
  CharacterCodes2[CharacterCodes2["_3"] = 51] = "_3";
  CharacterCodes2[CharacterCodes2["_4"] = 52] = "_4";
  CharacterCodes2[CharacterCodes2["_5"] = 53] = "_5";
  CharacterCodes2[CharacterCodes2["_6"] = 54] = "_6";
  CharacterCodes2[CharacterCodes2["_7"] = 55] = "_7";
  CharacterCodes2[CharacterCodes2["_8"] = 56] = "_8";
  CharacterCodes2[CharacterCodes2["_9"] = 57] = "_9";
  CharacterCodes2[CharacterCodes2["a"] = 97] = "a";
  CharacterCodes2[CharacterCodes2["b"] = 98] = "b";
  CharacterCodes2[CharacterCodes2["c"] = 99] = "c";
  CharacterCodes2[CharacterCodes2["d"] = 100] = "d";
  CharacterCodes2[CharacterCodes2["e"] = 101] = "e";
  CharacterCodes2[CharacterCodes2["f"] = 102] = "f";
  CharacterCodes2[CharacterCodes2["g"] = 103] = "g";
  CharacterCodes2[CharacterCodes2["h"] = 104] = "h";
  CharacterCodes2[CharacterCodes2["i"] = 105] = "i";
  CharacterCodes2[CharacterCodes2["j"] = 106] = "j";
  CharacterCodes2[CharacterCodes2["k"] = 107] = "k";
  CharacterCodes2[CharacterCodes2["l"] = 108] = "l";
  CharacterCodes2[CharacterCodes2["m"] = 109] = "m";
  CharacterCodes2[CharacterCodes2["n"] = 110] = "n";
  CharacterCodes2[CharacterCodes2["o"] = 111] = "o";
  CharacterCodes2[CharacterCodes2["p"] = 112] = "p";
  CharacterCodes2[CharacterCodes2["q"] = 113] = "q";
  CharacterCodes2[CharacterCodes2["r"] = 114] = "r";
  CharacterCodes2[CharacterCodes2["s"] = 115] = "s";
  CharacterCodes2[CharacterCodes2["t"] = 116] = "t";
  CharacterCodes2[CharacterCodes2["u"] = 117] = "u";
  CharacterCodes2[CharacterCodes2["v"] = 118] = "v";
  CharacterCodes2[CharacterCodes2["w"] = 119] = "w";
  CharacterCodes2[CharacterCodes2["x"] = 120] = "x";
  CharacterCodes2[CharacterCodes2["y"] = 121] = "y";
  CharacterCodes2[CharacterCodes2["z"] = 122] = "z";
  CharacterCodes2[CharacterCodes2["A"] = 65] = "A";
  CharacterCodes2[CharacterCodes2["B"] = 66] = "B";
  CharacterCodes2[CharacterCodes2["C"] = 67] = "C";
  CharacterCodes2[CharacterCodes2["D"] = 68] = "D";
  CharacterCodes2[CharacterCodes2["E"] = 69] = "E";
  CharacterCodes2[CharacterCodes2["F"] = 70] = "F";
  CharacterCodes2[CharacterCodes2["G"] = 71] = "G";
  CharacterCodes2[CharacterCodes2["H"] = 72] = "H";
  CharacterCodes2[CharacterCodes2["I"] = 73] = "I";
  CharacterCodes2[CharacterCodes2["J"] = 74] = "J";
  CharacterCodes2[CharacterCodes2["K"] = 75] = "K";
  CharacterCodes2[CharacterCodes2["L"] = 76] = "L";
  CharacterCodes2[CharacterCodes2["M"] = 77] = "M";
  CharacterCodes2[CharacterCodes2["N"] = 78] = "N";
  CharacterCodes2[CharacterCodes2["O"] = 79] = "O";
  CharacterCodes2[CharacterCodes2["P"] = 80] = "P";
  CharacterCodes2[CharacterCodes2["Q"] = 81] = "Q";
  CharacterCodes2[CharacterCodes2["R"] = 82] = "R";
  CharacterCodes2[CharacterCodes2["S"] = 83] = "S";
  CharacterCodes2[CharacterCodes2["T"] = 84] = "T";
  CharacterCodes2[CharacterCodes2["U"] = 85] = "U";
  CharacterCodes2[CharacterCodes2["V"] = 86] = "V";
  CharacterCodes2[CharacterCodes2["W"] = 87] = "W";
  CharacterCodes2[CharacterCodes2["X"] = 88] = "X";
  CharacterCodes2[CharacterCodes2["Y"] = 89] = "Y";
  CharacterCodes2[CharacterCodes2["Z"] = 90] = "Z";
  CharacterCodes2[CharacterCodes2["asterisk"] = 42] = "asterisk";
  CharacterCodes2[CharacterCodes2["backslash"] = 92] = "backslash";
  CharacterCodes2[CharacterCodes2["closeBrace"] = 125] = "closeBrace";
  CharacterCodes2[CharacterCodes2["closeBracket"] = 93] = "closeBracket";
  CharacterCodes2[CharacterCodes2["colon"] = 58] = "colon";
  CharacterCodes2[CharacterCodes2["comma"] = 44] = "comma";
  CharacterCodes2[CharacterCodes2["dot"] = 46] = "dot";
  CharacterCodes2[CharacterCodes2["doubleQuote"] = 34] = "doubleQuote";
  CharacterCodes2[CharacterCodes2["minus"] = 45] = "minus";
  CharacterCodes2[CharacterCodes2["openBrace"] = 123] = "openBrace";
  CharacterCodes2[CharacterCodes2["openBracket"] = 91] = "openBracket";
  CharacterCodes2[CharacterCodes2["plus"] = 43] = "plus";
  CharacterCodes2[CharacterCodes2["slash"] = 47] = "slash";
  CharacterCodes2[CharacterCodes2["formFeed"] = 12] = "formFeed";
  CharacterCodes2[CharacterCodes2["tab"] = 9] = "tab";
})(CharacterCodes || (CharacterCodes = {}));

// node_modules/jsonc-parser/lib/esm/impl/string-intern.js
var cachedSpaces = new Array(20).fill(0).map((_, index) => {
  return " ".repeat(index);
});
var maxCachedValues = 200;
var cachedBreakLinesWithSpaces = {
  " ": {
    "\n": new Array(maxCachedValues).fill(0).map((_, index) => {
      return "\n" + " ".repeat(index);
    }),
    "\r": new Array(maxCachedValues).fill(0).map((_, index) => {
      return "\r" + " ".repeat(index);
    }),
    "\r\n": new Array(maxCachedValues).fill(0).map((_, index) => {
      return "\r\n" + " ".repeat(index);
    })
  },
  "	": {
    "\n": new Array(maxCachedValues).fill(0).map((_, index) => {
      return "\n" + "	".repeat(index);
    }),
    "\r": new Array(maxCachedValues).fill(0).map((_, index) => {
      return "\r" + "	".repeat(index);
    }),
    "\r\n": new Array(maxCachedValues).fill(0).map((_, index) => {
      return "\r\n" + "	".repeat(index);
    })
  }
};

// node_modules/jsonc-parser/lib/esm/impl/parser.js
var ParseOptions;
(function(ParseOptions2) {
  ParseOptions2.DEFAULT = {
    allowTrailingComma: false
  };
})(ParseOptions || (ParseOptions = {}));

// node_modules/jsonc-parser/lib/esm/main.js
var ScanError;
(function(ScanError2) {
  ScanError2[ScanError2["None"] = 0] = "None";
  ScanError2[ScanError2["UnexpectedEndOfComment"] = 1] = "UnexpectedEndOfComment";
  ScanError2[ScanError2["UnexpectedEndOfString"] = 2] = "UnexpectedEndOfString";
  ScanError2[ScanError2["UnexpectedEndOfNumber"] = 3] = "UnexpectedEndOfNumber";
  ScanError2[ScanError2["InvalidUnicode"] = 4] = "InvalidUnicode";
  ScanError2[ScanError2["InvalidEscapeCharacter"] = 5] = "InvalidEscapeCharacter";
  ScanError2[ScanError2["InvalidCharacter"] = 6] = "InvalidCharacter";
})(ScanError || (ScanError = {}));
var SyntaxKind;
(function(SyntaxKind2) {
  SyntaxKind2[SyntaxKind2["OpenBraceToken"] = 1] = "OpenBraceToken";
  SyntaxKind2[SyntaxKind2["CloseBraceToken"] = 2] = "CloseBraceToken";
  SyntaxKind2[SyntaxKind2["OpenBracketToken"] = 3] = "OpenBracketToken";
  SyntaxKind2[SyntaxKind2["CloseBracketToken"] = 4] = "CloseBracketToken";
  SyntaxKind2[SyntaxKind2["CommaToken"] = 5] = "CommaToken";
  SyntaxKind2[SyntaxKind2["ColonToken"] = 6] = "ColonToken";
  SyntaxKind2[SyntaxKind2["NullKeyword"] = 7] = "NullKeyword";
  SyntaxKind2[SyntaxKind2["TrueKeyword"] = 8] = "TrueKeyword";
  SyntaxKind2[SyntaxKind2["FalseKeyword"] = 9] = "FalseKeyword";
  SyntaxKind2[SyntaxKind2["StringLiteral"] = 10] = "StringLiteral";
  SyntaxKind2[SyntaxKind2["NumericLiteral"] = 11] = "NumericLiteral";
  SyntaxKind2[SyntaxKind2["LineCommentTrivia"] = 12] = "LineCommentTrivia";
  SyntaxKind2[SyntaxKind2["BlockCommentTrivia"] = 13] = "BlockCommentTrivia";
  SyntaxKind2[SyntaxKind2["LineBreakTrivia"] = 14] = "LineBreakTrivia";
  SyntaxKind2[SyntaxKind2["Trivia"] = 15] = "Trivia";
  SyntaxKind2[SyntaxKind2["Unknown"] = 16] = "Unknown";
  SyntaxKind2[SyntaxKind2["EOF"] = 17] = "EOF";
})(SyntaxKind || (SyntaxKind = {}));
var ParseErrorCode;
(function(ParseErrorCode2) {
  ParseErrorCode2[ParseErrorCode2["InvalidSymbol"] = 1] = "InvalidSymbol";
  ParseErrorCode2[ParseErrorCode2["InvalidNumberFormat"] = 2] = "InvalidNumberFormat";
  ParseErrorCode2[ParseErrorCode2["PropertyNameExpected"] = 3] = "PropertyNameExpected";
  ParseErrorCode2[ParseErrorCode2["ValueExpected"] = 4] = "ValueExpected";
  ParseErrorCode2[ParseErrorCode2["ColonExpected"] = 5] = "ColonExpected";
  ParseErrorCode2[ParseErrorCode2["CommaExpected"] = 6] = "CommaExpected";
  ParseErrorCode2[ParseErrorCode2["CloseBraceExpected"] = 7] = "CloseBraceExpected";
  ParseErrorCode2[ParseErrorCode2["CloseBracketExpected"] = 8] = "CloseBracketExpected";
  ParseErrorCode2[ParseErrorCode2["EndOfFileExpected"] = 9] = "EndOfFileExpected";
  ParseErrorCode2[ParseErrorCode2["InvalidCommentToken"] = 10] = "InvalidCommentToken";
  ParseErrorCode2[ParseErrorCode2["UnexpectedEndOfComment"] = 11] = "UnexpectedEndOfComment";
  ParseErrorCode2[ParseErrorCode2["UnexpectedEndOfString"] = 12] = "UnexpectedEndOfString";
  ParseErrorCode2[ParseErrorCode2["UnexpectedEndOfNumber"] = 13] = "UnexpectedEndOfNumber";
  ParseErrorCode2[ParseErrorCode2["InvalidUnicode"] = 14] = "InvalidUnicode";
  ParseErrorCode2[ParseErrorCode2["InvalidEscapeCharacter"] = 15] = "InvalidEscapeCharacter";
  ParseErrorCode2[ParseErrorCode2["InvalidCharacter"] = 16] = "InvalidCharacter";
})(ParseErrorCode || (ParseErrorCode = {}));

// src/utils/jsonc.ts
function parseJsonc(content) {
  const cleaned = stripJsoncComments(content);
  return JSON.parse(cleaned);
}
function stripJsoncComments(content) {
  return stripTrailingCommas(stripComments2(content));
}
function stripComments2(content) {
  let result = "";
  let i = 0;
  while (i < content.length) {
    if (content[i] === "/" && content[i + 1] === "/") {
      while (i < content.length && content[i] !== "\n") {
        i++;
      }
      continue;
    }
    if (content[i] === "/" && content[i + 1] === "*") {
      i += 2;
      while (i < content.length && !(content[i] === "*" && content[i + 1] === "/")) {
        i++;
      }
      i += 2;
      continue;
    }
    if (content[i] === '"') {
      result += content[i];
      i++;
      while (i < content.length && content[i] !== '"') {
        if (content[i] === "\\") {
          result += content[i];
          i++;
          if (i < content.length) {
            result += content[i];
            i++;
          }
          continue;
        }
        result += content[i];
        i++;
      }
      if (i < content.length) {
        result += content[i];
        i++;
      }
      continue;
    }
    result += content[i];
    i++;
  }
  return result;
}
function stripTrailingCommas(content) {
  let result = "";
  let i = 0;
  while (i < content.length) {
    if (content[i] === '"') {
      result += content[i];
      i++;
      while (i < content.length && content[i] !== '"') {
        if (content[i] === "\\") {
          result += content[i];
          i++;
          if (i < content.length) {
            result += content[i];
            i++;
          }
          continue;
        }
        result += content[i];
        i++;
      }
      if (i < content.length) {
        result += content[i];
        i++;
      }
      continue;
    }
    if (content[i] === ",") {
      let j = i + 1;
      while (j < content.length && /\s/.test(content[j])) {
        j++;
      }
      if (content[j] === "}" || content[j] === "]") {
        i++;
        continue;
      }
    }
    result += content[i];
    i++;
  }
  return result;
}

// src/lib/atomic-write.ts
import * as fsSync from "fs";
import * as path from "path";
import * as crypto from "crypto";
function ensureDirSync(dir) {
  if (fsSync.existsSync(dir)) {
    return;
  }
  try {
    fsSync.mkdirSync(dir, { recursive: true });
  } catch (err) {
    if (err.code === "EEXIST") {
      return;
    }
    throw err;
  }
}
function writeAllSync(fd, content, label) {
  const bytes = Buffer.from(content, "utf-8");
  let offset = 0;
  while (offset < bytes.length) {
    const written = fsSync.writeSync(fd, bytes, offset, bytes.length - offset);
    if (!Number.isInteger(written) || written <= 0) {
      throw new Error(`${label} made no progress`);
    }
    offset += written;
  }
  if (fsSync.fstatSync(fd).size !== bytes.length) {
    throw new Error(`${label} size verification failed`);
  }
}
function atomicWriteFileSync(filePath, content) {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const tempPath = path.join(dir, `.${base}.tmp.${crypto.randomUUID()}`);
  let fd = null;
  let success = false;
  try {
    ensureDirSync(dir);
    fd = fsSync.openSync(tempPath, "wx", 384);
    writeAllSync(fd, content, "atomic write");
    fsSync.fsyncSync(fd);
    fsSync.closeSync(fd);
    fd = null;
    fsSync.renameSync(tempPath, filePath);
    success = true;
    try {
      const dirFd = fsSync.openSync(dir, "r");
      try {
        fsSync.fsyncSync(dirFd);
      } finally {
        fsSync.closeSync(dirFd);
      }
    } catch {
    }
  } finally {
    if (fd !== null) {
      try {
        fsSync.closeSync(fd);
      } catch {
      }
    }
    if (!success) {
      try {
        fsSync.unlinkSync(tempPath);
      } catch {
      }
    }
  }
}
function atomicWriteJsonSync(filePath, data) {
  const jsonContent = JSON.stringify(data, null, 2);
  atomicWriteFileSync(filePath, jsonContent);
}
var ATOMIC_BATCH_MAX_CONTENT_BYTES = 1024 * 1024;

// src/hud/mission-board.ts
import { copyFileSync, existsSync as existsSync5, mkdirSync as mkdirSync4, readFileSync as readFileSync6, readdirSync as readdirSync3, renameSync as renameSync2, unlinkSync as unlinkSync4 } from "node:fs";
import { join as join6 } from "node:path";

// src/lib/file-lock.ts
import {
  openSync as openSync3,
  closeSync as closeSync3,
  fstatSync as fstatSync2,
  fsyncSync as fsyncSync2,
  linkSync,
  lstatSync,
  readdirSync as readdirSync2,
  readSync as readSync2,
  unlinkSync as unlinkSync3,
  writeSync as writeSync2,
  readFileSync as readFileSync5,
  constants as fsConstants
} from "fs";
import { randomUUID as randomUUID2 } from "crypto";
import * as path2 from "path";

// src/platform/index.ts
import { readFileSync as readFileSync4 } from "fs";

// src/platform/process-utils.ts
import { execFileSync as execFileSync2, execFile } from "child_process";
import { promisify } from "util";
import { readFileSync as readFileSync3 } from "fs";
var execFileAsync = promisify(execFile);
function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    if (e && typeof e === "object" && "code" in e && e.code === "EPERM") {
      return true;
    }
    return false;
  }
}
var currentProcessStartIdentitySync;
function parseWindowsDmtfTimestamp(value) {
  const match = value.match(
    /(\d{14})\.(\d{6})([+-])(\d{3})/
  );
  if (!match) return void 0;
  const compact = match[1];
  const year = Number(compact.slice(0, 4));
  const month = Number(compact.slice(4, 6));
  const day = Number(compact.slice(6, 8));
  const hour = Number(compact.slice(8, 10));
  const minute = Number(compact.slice(10, 12));
  const second = Number(compact.slice(12, 14));
  const microseconds = Number(match[2]);
  const offsetMinutes = Number(match[4]) * (match[3] === "-" ? -1 : 1);
  if (year < 1601 || month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59 || !Number.isSafeInteger(microseconds) || !Number.isSafeInteger(offsetMinutes)) {
    return void 0;
  }
  const wallClockMs = Date.UTC(
    year,
    month - 1,
    day,
    hour,
    minute,
    second
  );
  const verified = new Date(wallClockMs);
  if (verified.getUTCFullYear() !== year || verified.getUTCMonth() !== month - 1 || verified.getUTCDate() !== day || verified.getUTCHours() !== hour || verified.getUTCMinutes() !== minute || verified.getUTCSeconds() !== second) {
    return void 0;
  }
  const epochMilliseconds = wallClockMs - offsetMinutes * 6e4;
  return {
    epochMilliseconds,
    epochMicroseconds: BigInt(epochMilliseconds) * 1000n + BigInt(microseconds)
  };
}
function parseWindowsProcessStartIdentity(value) {
  const parsed = parseWindowsDmtfTimestamp(value);
  return parsed ? `windows-dmtf-us:${parsed.epochMicroseconds.toString()}` : void 0;
}
function getProcessStartIdentitySync(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  if (process.env.OMC_TEST_EMERGENCY_PROCESS_START_UNKNOWN_PID === String(pid) || process.env.OMC_TEST_FILE_LOCK_PROCESS_START_UNKNOWN_PID === String(pid)) {
    return null;
  }
  if (pid === process.pid && currentProcessStartIdentitySync !== void 0) {
    return currentProcessStartIdentitySync;
  }
  let identity = null;
  if (process.platform === "linux") {
    try {
      const stat = readFileSync3(`/proc/${pid}/stat`, "utf8");
      const closeParen = stat.lastIndexOf(")");
      if (closeParen >= 0) {
        const fields = stat.slice(closeParen + 2).trim().split(/\s+/);
        identity = fields[19] && /^\d+$/.test(fields[19]) ? fields[19] : null;
      }
    } catch (error) {
      identity = error.code === "ENOENT" ? "absent" : null;
    }
  } else if (process.platform === "darwin") {
    try {
      const stdout = execFileSync2(
        "ps",
        ["-p", String(pid), "-o", "lstart="],
        {
          encoding: "utf8",
          env: { ...process.env, LC_ALL: "C" },
          stdio: ["ignore", "pipe", "ignore"],
          timeout: 1e3,
          windowsHide: true
        }
      );
      const value = new Date(stdout.trim()).getTime();
      identity = Number.isFinite(value) ? String(value) : null;
    } catch {
      identity = isProcessAlive(pid) ? null : "absent";
    }
  } else if (process.platform === "win32") {
    try {
      const stdout = execFileSync2(
        "powershell",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `$p = [System.Diagnostics.Process]::GetProcessById(${pid}); [System.Management.ManagementDateTimeConverter]::ToDmtfDateTime([datetime]$p.StartTime)`
        ],
        {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
          timeout: 5e3,
          windowsHide: true
        }
      );
      identity = parseWindowsProcessStartIdentity(stdout) ?? null;
    } catch {
      try {
        const stdout = execFileSync2(
          "wmic",
          [
            "process",
            "where",
            `ProcessId=${pid}`,
            "get",
            "CreationDate",
            "/format:csv"
          ],
          {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
            timeout: 1e3,
            windowsHide: true
          }
        );
        identity = parseWindowsProcessStartIdentity(stdout) ?? null;
      } catch {
        identity = isProcessAlive(pid) ? null : "absent";
      }
    }
  }
  if (pid === process.pid && identity !== null && identity !== "absent") {
    currentProcessStartIdentitySync = identity;
  }
  return identity;
}

// src/platform/index.ts
var PLATFORM = process.platform;
function isWSL() {
  if (process.env.WSLENV !== void 0) {
    return true;
  }
  try {
    const procVersion = readFileSync4("/proc/version", "utf8");
    return procVersion.toLowerCase().includes("microsoft");
  } catch {
    return false;
  }
}

// src/lib/file-lock.ts
var DEFAULT_STALE_LOCK_MS = 3e4;
var DEFAULT_RETRY_DELAY_MS = 50;
var RECLAMATION_GUARD_SUFFIX = ".reclaim.guard";
var RECLAMATION_RECOVERY_SUFFIX = ".recover";
var RECLAMATION_RECOVERY_CLAIM_SUFFIX = ".reaper.";
var RECLAMATION_GUARD_STALE_MS = 3e4;
var RECLAMATION_RECOVERY_STALE_MS = 3e4;
var MAX_LOCK_MTIME_FUTURE_SKEW_MS = 5 * 6e4;
var RELEASE_GUARD_TIMEOUT_MS = 2e3;
function identityForFd(fd) {
  const stat = fstatSync2(fd);
  return { dev: stat.dev, ino: stat.ino };
}
function identityForPath(lockPath) {
  try {
    const stat = lstatSync(lockPath);
    return { dev: stat.dev, ino: stat.ino };
  } catch {
    return null;
  }
}
function identitiesEqual(left, right) {
  return !!left && left.dev === right.dev && left.ino === right.ino;
}
function parseObservedLock(raw) {
  try {
    const payload = JSON.parse(raw);
    return {
      ...typeof payload.version === "number" ? { version: payload.version } : {},
      ...typeof payload.pid === "number" ? { pid: payload.pid } : {},
      ...typeof payload.processStartIdentity === "string" ? { processStartIdentity: payload.processStartIdentity } : typeof payload.processStart === "string" ? { processStartIdentity: payload.processStart } : {},
      ...typeof payload.nonce === "string" ? { nonce: payload.nonce } : {},
      ...typeof payload.timestamp === "number" ? { timestamp: payload.timestamp } : {}
    };
  } catch {
    return {};
  }
}
function isAuthenticatedOwner(owner) {
  return owner.version === 2 && Number.isSafeInteger(owner.pid) && (owner.pid ?? 0) > 0 && typeof owner.processStartIdentity === "string" && owner.processStartIdentity.length > 0 && typeof owner.nonce === "string" && owner.nonce.length > 0 && Number.isFinite(owner.timestamp);
}
function staleLockObservation(lockPath, staleLockMs, requireAuthenticatedOwner = false) {
  try {
    const stat = lstatSync(lockPath);
    const now = Date.now();
    if (!Number.isFinite(stat.mtimeMs) || stat.mtimeMs > now + MAX_LOCK_MTIME_FUTURE_SKEW_MS) {
      return null;
    }
    const ageMs = Math.max(0, now - stat.mtimeMs);
    if (ageMs < staleLockMs) return null;
    const raw = readFileSync5(lockPath, "utf-8");
    const observation = {
      identity: { dev: stat.dev, ino: stat.ino },
      raw,
      owner: parseObservedLock(raw)
    };
    if (requireAuthenticatedOwner && !isAuthenticatedOwner(observation.owner)) {
      return null;
    }
    const pid = observation.owner.pid;
    if (!pid || !Number.isSafeInteger(pid) || pid <= 0) {
      return observation;
    }
    if (!isProcessAlive(pid)) return observation;
    const expectedStart = observation.owner.processStartIdentity;
    if (!expectedStart) return null;
    const currentStart = getProcessStartIdentitySync(pid);
    if (currentStart === "absent") return observation;
    if (currentStart === null) return null;
    return currentStart === expectedStart ? null : observation;
  } catch {
    return null;
  }
}
function observedLockStillMatches(lockPath, observation) {
  if (!identitiesEqual(identityForPath(lockPath), observation.identity)) {
    return false;
  }
  try {
    return readFileSync5(lockPath, "utf-8") === observation.raw;
  } catch {
    return false;
  }
}
function reapObservedLock(lockPath, observation) {
  try {
    if (!observedLockStillMatches(lockPath, observation)) return false;
    unlinkSync3(lockPath);
    return true;
  } catch {
    return false;
  }
}
function isExistsError(error) {
  return !!error && typeof error === "object" && "code" in error && error.code === "EEXIST";
}
function waitSync(waitMs) {
  if (waitMs <= 0) return;
  const waitBuffer = new SharedArrayBuffer(4);
  try {
    Atomics.wait(new Int32Array(waitBuffer), 0, 0, waitMs);
  } catch {
    const waitUntil = Date.now() + waitMs;
    while (Date.now() < waitUntil) {
    }
  }
}
function recoveryOperationHasContender(recoveryPath, ownClaimPath) {
  const directory = path2.dirname(recoveryPath);
  const prefix = `${path2.basename(recoveryPath)}${RECLAMATION_RECOVERY_CLAIM_SUFFIX}`;
  let names;
  try {
    names = readdirSync2(directory);
  } catch {
    return true;
  }
  for (const name of names) {
    if (!name.startsWith(prefix)) continue;
    const contenderPath = path2.join(directory, name);
    if (contenderPath === ownClaimPath) continue;
    const stale = staleLockObservation(
      contenderPath,
      RECLAMATION_RECOVERY_STALE_MS,
      true
    );
    if (stale) {
      if (reapObservedLock(contenderPath, stale)) continue;
      if (!identityForPath(contenderPath)) continue;
    }
    return true;
  }
  return false;
}
function withRecoveryPathOperation(lockPath, callback) {
  const recoveryPath = `${lockPath}${RECLAMATION_GUARD_SUFFIX}${RECLAMATION_RECOVERY_SUFFIX}`;
  const owner = currentLockOwner();
  if (!owner) return { acquired: false, value: void 0 };
  const claimPath = `${recoveryPath}${RECLAMATION_RECOVERY_CLAIM_SUFFIX}${owner.nonce}`;
  let claim;
  try {
    claim = createOwnedLockAtomically(claimPath, owner);
  } catch (error) {
    if (isExistsError(error)) {
      return { acquired: false, value: void 0 };
    }
    throw error;
  }
  if (!claim) return { acquired: false, value: void 0 };
  try {
    if (recoveryOperationHasContender(recoveryPath, claimPath)) {
      return { acquired: false, value: void 0 };
    }
    return { acquired: true, value: callback() };
  } finally {
    releaseOwnedPath(claim);
  }
}
function withReclamationRecoveryBarrier(lockPath, callback) {
  const recoveryPath = `${lockPath}${RECLAMATION_GUARD_SUFFIX}${RECLAMATION_RECOVERY_SUFFIX}`;
  const operation = withRecoveryPathOperation(lockPath, () => {
    let recovery;
    try {
      recovery = createOwnedLockAtomically(recoveryPath);
    } catch (error) {
      if (!isExistsError(error)) throw error;
      const stale = staleLockObservation(
        recoveryPath,
        RECLAMATION_RECOVERY_STALE_MS,
        true
      );
      if (!stale || !reapObservedLock(recoveryPath, stale)) {
        return { acquired: false, value: void 0 };
      }
      try {
        recovery = createOwnedLockAtomically(recoveryPath);
      } catch (retryError) {
        if (isExistsError(retryError)) {
          return { acquired: false, value: void 0 };
        }
        throw retryError;
      }
    }
    if (!recovery) return { acquired: false, value: void 0 };
    try {
      return { acquired: true, value: callback() };
    } finally {
      releaseOwnedPath(recovery);
    }
  });
  if (!operation.acquired || !operation.value) {
    return { acquired: false, value: void 0 };
  }
  return operation.value;
}
function recoverStaleReclamationRecoveryBarrier(lockPath) {
  const recoveryPath = `${lockPath}${RECLAMATION_GUARD_SUFFIX}${RECLAMATION_RECOVERY_SUFFIX}`;
  const operation = withRecoveryPathOperation(lockPath, () => {
    const stale = staleLockObservation(
      recoveryPath,
      RECLAMATION_RECOVERY_STALE_MS,
      true
    );
    return !!stale && reapObservedLock(recoveryPath, stale);
  });
  return operation.acquired && operation.value === true;
}
function recoverStaleReclamationGuard(lockPath) {
  const guardPath = `${lockPath}${RECLAMATION_GUARD_SUFFIX}`;
  const recovery = withReclamationRecoveryBarrier(lockPath, () => {
    const stale = staleLockObservation(
      guardPath,
      RECLAMATION_GUARD_STALE_MS,
      true
    );
    return !!stale && reapObservedLock(guardPath, stale);
  });
  return recovery.acquired && recovery.value === true;
}
function releaseOwnedPath(handle) {
  const ownedBeforeClose = handleStillOwnsPath(handle);
  try {
    closeSync3(handle.fd);
  } catch {
  }
  if (!ownedBeforeClose || !handleStillOwnsPath(handle)) return;
  try {
    unlinkSync3(handle.path);
  } catch {
  }
}
function withReclamationGuard(lockPath, callback, timeoutMs = 0) {
  const guardPath = `${lockPath}${RECLAMATION_GUARD_SUFFIX}`;
  const recoveryPath = `${guardPath}${RECLAMATION_RECOVERY_SUFFIX}`;
  const deadline = Date.now() + timeoutMs;
  let guard = null;
  while (!guard) {
    if (identityForPath(recoveryPath)) {
      if (recoverStaleReclamationRecoveryBarrier(lockPath)) continue;
      if (Date.now() >= deadline) {
        return { acquired: false, value: void 0 };
      }
      waitSync(Math.min(5, Math.max(1, deadline - Date.now())));
      continue;
    }
    try {
      guard = createOwnedLock(guardPath);
    } catch (error) {
      if (!isExistsError(error)) throw error;
      if (recoverStaleReclamationGuard(lockPath)) continue;
      if (Date.now() >= deadline) {
        return { acquired: false, value: void 0 };
      }
      waitSync(Math.min(5, Math.max(1, deadline - Date.now())));
      continue;
    }
    if (!guard) {
      if (Date.now() >= deadline) {
        return { acquired: false, value: void 0 };
      }
      waitSync(Math.min(5, Math.max(1, deadline - Date.now())));
    }
  }
  if (!guard) return { acquired: false, value: void 0 };
  try {
    return { acquired: true, value: callback() };
  } finally {
    releaseOwnedPath(guard);
  }
}
function currentLockOwner() {
  const processStartIdentity = getProcessStartIdentitySync(process.pid);
  if (processStartIdentity === null || processStartIdentity === "absent") {
    return null;
  }
  return {
    version: 2,
    pid: process.pid,
    processStartIdentity,
    nonce: randomUUID2(),
    timestamp: Date.now()
  };
}
function createOwnedLock(lockPath, suppliedOwner) {
  const owner = suppliedOwner ?? currentLockOwner();
  if (!owner) return null;
  const ownerRaw = JSON.stringify(owner);
  const ownerBytes = Buffer.from(ownerRaw, "utf8");
  const fd = openSync3(
    lockPath,
    fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_RDWR,
    384
  );
  const creationIdentity = identityForFd(fd);
  try {
    let written = 0;
    while (written < ownerBytes.length) {
      const count = writeSync2(
        fd,
        ownerBytes,
        written,
        ownerBytes.length - written,
        written
      );
      if (count <= 0) {
        throw new Error(`Failed to publish file lock owner: ${lockPath}`);
      }
      written += count;
    }
    fsyncSync2(fd);
    const stat = fstatSync2(fd);
    if (stat.size !== ownerBytes.length || !identitiesEqual(identityForPath(lockPath), creationIdentity)) {
      throw new Error(`Failed to verify file lock owner: ${lockPath}`);
    }
    const verifiedBytes = Buffer.alloc(ownerBytes.length);
    let read = 0;
    while (read < verifiedBytes.length) {
      const count = readSync2(
        fd,
        verifiedBytes,
        read,
        verifiedBytes.length - read,
        read
      );
      if (count <= 0) {
        throw new Error(`Failed to verify file lock owner: ${lockPath}`);
      }
      read += count;
    }
    if (!verifiedBytes.equals(ownerBytes)) {
      throw new Error(`Failed to verify file lock owner: ${lockPath}`);
    }
    return {
      fd,
      path: lockPath,
      owner,
      ownerRaw,
      identity: creationIdentity
    };
  } catch (writeErr) {
    try {
      closeSync3(fd);
    } catch {
    }
    try {
      if (identitiesEqual(identityForPath(lockPath), creationIdentity)) {
        unlinkSync3(lockPath);
      }
    } catch {
    }
    throw writeErr;
  }
}
function createOwnedLockAtomically(lockPath, suppliedOwner) {
  const owner = suppliedOwner ?? currentLockOwner();
  if (!owner) return null;
  const publicationPath = path2.join(
    path2.dirname(lockPath),
    `.${path2.basename(lockPath)}.publish.${owner.nonce}.tmp`
  );
  const publication = createOwnedLock(publicationPath, owner);
  if (!publication) return null;
  let linked = false;
  try {
    linkSync(publicationPath, lockPath);
    linked = true;
    const published = {
      ...publication,
      path: lockPath
    };
    if (!handleStillOwnsPath(published)) {
      throw new Error(`Failed to publish file lock owner: ${lockPath}`);
    }
    try {
      if (handleStillOwnsPath(publication)) {
        unlinkSync3(publicationPath);
      }
    } catch {
    }
    return published;
  } catch (error) {
    if (linked) {
      const published = {
        ...publication,
        path: lockPath
      };
      try {
        if (handleStillOwnsPath(published)) unlinkSync3(lockPath);
      } catch {
      }
    }
    releaseOwnedPath(publication);
    throw error;
  }
}
function handleStillOwnsPath(handle) {
  if (!identitiesEqual(identityForPath(handle.path), handle.identity)) {
    return false;
  }
  try {
    const raw = readFileSync5(handle.path, "utf-8");
    if (raw !== handle.ownerRaw) return false;
    const owner = JSON.parse(raw);
    return owner.version === handle.owner.version && owner.pid === handle.owner.pid && owner.processStartIdentity === handle.owner.processStartIdentity && owner.nonce === handle.owner.nonce;
  } catch {
    return false;
  }
}
function lockPathFor(filePath) {
  return filePath + ".lock";
}
function tryAcquireSync(lockPath, staleLockMs) {
  ensureDirSync(path2.dirname(lockPath));
  const guarded = withReclamationGuard(lockPath, () => {
    try {
      return createOwnedLock(lockPath);
    } catch (err) {
      if (err && typeof err === "object" && "code" in err && err.code === "EEXIST") {
        const stale = staleLockObservation(lockPath, staleLockMs);
        if (stale && reapObservedLock(lockPath, stale)) {
          try {
            return createOwnedLock(lockPath);
          } catch {
            return null;
          }
        }
        return null;
      }
      throw err;
    }
  });
  return guarded.acquired ? guarded.value ?? null : null;
}
function acquireFileLockSync(lockPath, opts) {
  const staleLockMs = opts?.staleLockMs ?? DEFAULT_STALE_LOCK_MS;
  const timeoutMs = opts?.timeoutMs ?? 0;
  const retryDelayMs = opts?.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const handle = tryAcquireSync(lockPath, staleLockMs);
  if (handle || timeoutMs <= 0) return handle;
  const deadline = Date.now() + timeoutMs;
  const sharedBuf = new SharedArrayBuffer(4);
  const sharedArr = new Int32Array(sharedBuf);
  while (Date.now() < deadline) {
    const waitMs = Math.min(retryDelayMs, deadline - Date.now());
    try {
      Atomics.wait(sharedArr, 0, 0, waitMs);
    } catch {
      const waitUntil = Date.now() + waitMs;
      while (Date.now() < waitUntil) {
      }
    }
    const retryHandle = tryAcquireSync(lockPath, staleLockMs);
    if (retryHandle) return retryHandle;
  }
  return null;
}
function releaseFileLockSync(handle) {
  try {
    const guarded = withReclamationGuard(handle.path, () => {
      releaseOwnedPath(handle);
    }, RELEASE_GUARD_TIMEOUT_MS);
    if (guarded.acquired) return;
  } catch {
  }
  try {
    const cleanup = withReclamationRecoveryBarrier(handle.path, () => {
      releaseOwnedPath(handle);
    });
    if (cleanup.acquired) return;
  } catch {
  }
  try {
    closeSync3(handle.fd);
  } catch {
  }
}
function withFileLockSync(lockPath, fn, opts) {
  const handle = acquireFileLockSync(lockPath, opts);
  if (!handle) {
    throw new Error(`Failed to acquire file lock: ${lockPath}`);
  }
  try {
    return fn();
  } finally {
    releaseFileLockSync(handle);
  }
}
function sleep(ms) {
  return new Promise((resolve6) => setTimeout(resolve6, ms));
}
async function acquireFileLock(lockPath, opts) {
  const staleLockMs = opts?.staleLockMs ?? DEFAULT_STALE_LOCK_MS;
  const timeoutMs = opts?.timeoutMs ?? 0;
  const retryDelayMs = opts?.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const handle = tryAcquireSync(lockPath, staleLockMs);
  if (handle || timeoutMs <= 0) return handle;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(Math.min(retryDelayMs, deadline - Date.now()));
    const retryHandle = tryAcquireSync(lockPath, staleLockMs);
    if (retryHandle) return retryHandle;
  }
  return null;
}
function releaseFileLock(handle) {
  releaseFileLockSync(handle);
}
async function withFileLock(lockPath, fn, opts) {
  const handle = await acquireFileLock(lockPath, opts);
  if (!handle) {
    throw new Error(`Failed to acquire file lock: ${lockPath}`);
  }
  try {
    return await fn();
  } finally {
    releaseFileLock(handle);
  }
}

// src/utils/string-width.ts
function isCJKCharacter(codePoint) {
  return (
    // CJK Unified Ideographs (Chinese characters)
    codePoint >= 19968 && codePoint <= 40959 || // CJK Unified Ideographs Extension A
    codePoint >= 13312 && codePoint <= 19903 || // CJK Unified Ideographs Extension B-F (rare characters)
    codePoint >= 131072 && codePoint <= 191471 || // CJK Compatibility Ideographs
    codePoint >= 63744 && codePoint <= 64255 || // Hangul Syllables (Korean)
    codePoint >= 44032 && codePoint <= 55215 || // Hangul Jamo (Korean components)
    codePoint >= 4352 && codePoint <= 4607 || // Hangul Compatibility Jamo
    codePoint >= 12592 && codePoint <= 12687 || // Hangul Jamo Extended-A
    codePoint >= 43360 && codePoint <= 43391 || // Hangul Jamo Extended-B
    codePoint >= 55216 && codePoint <= 55295 || // Hiragana (Japanese)
    codePoint >= 12352 && codePoint <= 12447 || // Katakana (Japanese)
    codePoint >= 12448 && codePoint <= 12543 || // Katakana Phonetic Extensions
    codePoint >= 12784 && codePoint <= 12799 || // Full-width ASCII variants
    codePoint >= 65281 && codePoint <= 65376 || // Full-width punctuation and symbols
    codePoint >= 65504 && codePoint <= 65510 || // CJK Symbols and Punctuation
    codePoint >= 12288 && codePoint <= 12351 || // Enclosed CJK Letters and Months
    codePoint >= 12800 && codePoint <= 13055 || // CJK Compatibility
    codePoint >= 13056 && codePoint <= 13311 || // CJK Compatibility Forms
    codePoint >= 65072 && codePoint <= 65103
  );
}
function isZeroWidth(codePoint) {
  return (
    // Zero-width characters
    codePoint === 8203 || // Zero Width Space
    codePoint === 8204 || // Zero Width Non-Joiner
    codePoint === 8205 || // Zero Width Joiner
    codePoint === 65279 || // Byte Order Mark / Zero Width No-Break Space
    // Combining diacritical marks (they modify previous character)
    codePoint >= 768 && codePoint <= 879 || // Combining Diacritical Marks Extended
    codePoint >= 6832 && codePoint <= 6911 || // Combining Diacritical Marks Supplement
    codePoint >= 7616 && codePoint <= 7679 || // Combining Diacritical Marks for Symbols
    codePoint >= 8400 && codePoint <= 8447 || // Combining Half Marks
    codePoint >= 65056 && codePoint <= 65071
  );
}
function getCharWidth(char) {
  const codePoint = char.codePointAt(0);
  if (codePoint === void 0) return 0;
  if (isZeroWidth(codePoint)) return 0;
  if (isCJKCharacter(codePoint)) return 2;
  return 1;
}
function stringWidth(str) {
  if (!str) return 0;
  const stripped = stripAnsi(str);
  let width = 0;
  for (const char of stripped) {
    width += getCharWidth(char);
  }
  return width;
}
function stripAnsi(str) {
  return str.replace(
    /\x1b\[[0-9;]*[a-zA-Z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g,
    ""
  );
}
function truncateToWidth(str, maxWidth, suffix = "...") {
  if (!str || maxWidth <= 0) return "";
  const strWidth = stringWidth(str);
  if (strWidth <= maxWidth) return str;
  const suffixWidth = stringWidth(suffix);
  const targetWidth = maxWidth - suffixWidth;
  if (targetWidth <= 0) {
    return truncateToWidthNoSuffix(suffix, maxWidth);
  }
  return truncateToWidthNoSuffix(str, targetWidth) + suffix;
}
function truncateToWidthNoSuffix(str, maxWidth) {
  let width = 0;
  let result = "";
  for (const char of str) {
    const charWidth = getCharWidth(char);
    if (width + charWidth > maxWidth) break;
    result += char;
    width += charWidth;
  }
  return result;
}

// src/team/worker-canonicalization.ts
function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}
function hasAssignedTasks(worker) {
  return Array.isArray(worker.assigned_tasks) && worker.assigned_tasks.length > 0;
}
function workerPriority(worker) {
  if (hasText(worker.pane_id)) return 4;
  if (typeof worker.pid === "number" && Number.isFinite(worker.pid)) return 3;
  if (hasAssignedTasks(worker)) return 2;
  if (typeof worker.index === "number" && worker.index > 0) return 1;
  return 0;
}
function mergeAssignedTasks(primary, secondary) {
  const merged = [];
  for (const taskId of [...primary ?? [], ...secondary ?? []]) {
    if (typeof taskId !== "string" || taskId.trim() === "" || merged.includes(taskId)) continue;
    merged.push(taskId);
  }
  return merged;
}
function backfillText(primary, secondary) {
  return hasText(primary) ? primary : secondary;
}
function backfillBoolean(primary, secondary) {
  return typeof primary === "boolean" ? primary : secondary;
}
function backfillNumber(primary, secondary, predicate) {
  const isUsable = (value) => typeof value === "number" && Number.isFinite(value) && (predicate ? predicate(value) : true);
  return isUsable(primary) ? primary : isUsable(secondary) ? secondary : void 0;
}
function chooseWinningWorker(existing, incoming) {
  const existingPriority = workerPriority(existing);
  const incomingPriority = workerPriority(incoming);
  if (incomingPriority > existingPriority) return { winner: incoming, loser: existing };
  if (incomingPriority < existingPriority) return { winner: existing, loser: incoming };
  if ((incoming.index ?? 0) >= (existing.index ?? 0)) return { winner: incoming, loser: existing };
  return { winner: existing, loser: incoming };
}
function canonicalizeWorkers(workers) {
  const byName = /* @__PURE__ */ new Map();
  const duplicateNames = /* @__PURE__ */ new Set();
  for (const worker of workers) {
    const name = typeof worker.name === "string" ? worker.name.trim() : "";
    if (!name) continue;
    const normalized = {
      ...worker,
      name,
      assigned_tasks: Array.isArray(worker.assigned_tasks) ? worker.assigned_tasks : []
    };
    const existing = byName.get(name);
    if (!existing) {
      byName.set(name, normalized);
      continue;
    }
    duplicateNames.add(name);
    const { winner, loser } = chooseWinningWorker(existing, normalized);
    byName.set(name, {
      ...winner,
      name,
      assigned_tasks: mergeAssignedTasks(winner.assigned_tasks, loser.assigned_tasks),
      pane_id: backfillText(winner.pane_id, loser.pane_id),
      pid: backfillNumber(winner.pid, loser.pid),
      index: backfillNumber(winner.index, loser.index, (value) => value > 0) ?? 0,
      role: backfillText(winner.role, loser.role) ?? winner.role,
      worker_cli: backfillText(winner.worker_cli, loser.worker_cli),
      working_dir: backfillText(winner.working_dir, loser.working_dir),
      worktree_repo_root: backfillText(winner.worktree_repo_root, loser.worktree_repo_root),
      worktree_path: backfillText(winner.worktree_path, loser.worktree_path),
      worktree_branch: backfillText(winner.worktree_branch, loser.worktree_branch),
      worktree_detached: backfillBoolean(winner.worktree_detached, loser.worktree_detached),
      worktree_created: backfillBoolean(winner.worktree_created, loser.worktree_created),
      team_state_root: backfillText(winner.team_state_root, loser.team_state_root)
    });
  }
  return {
    workers: Array.from(byName.values()),
    duplicateNames: Array.from(duplicateNames.values())
  };
}

// src/hud/mission-board.ts
var DEFAULT_CONFIG = {
  enabled: false,
  maxMissions: 2,
  maxAgentsPerMission: 3,
  maxTimelineEvents: 3,
  persistCompletedForMinutes: 20
};
var STATUS_ORDER = {
  running: 0,
  blocked: 1,
  waiting: 2,
  done: 3
};
var MISSION_STATE_LOCK_OPTS = {
  timeoutMs: 5e3,
  retryDelayMs: 50,
  staleLockMs: 3e4
};
var DEFAULT_MISSION_BOARD_CONFIG = DEFAULT_CONFIG;
function resolveConfig(config) {
  return {
    ...DEFAULT_CONFIG,
    ...config,
    enabled: config?.enabled ?? DEFAULT_CONFIG.enabled
  };
}
function readJsonSafe(path3) {
  if (!existsSync5(path3)) return null;
  try {
    return JSON.parse(readFileSync6(path3, "utf-8"));
  } catch {
    return null;
  }
}
function readJsonLinesSafe(path3) {
  if (!existsSync5(path3)) return [];
  try {
    return readFileSync6(path3, "utf-8").split("\n").map((line) => line.trim()).filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}
function maybeMigrateLegacyLocked(paths) {
  if (!isLegacyStateMigrationEnabled()) return;
  if (!paths.sessionScoped) return;
  if (existsSync5(paths.sessionScoped)) return;
  if (!existsSync5(paths.legacy)) return;
  const sentinel = `${paths.sessionScoped}.migrating.${process.pid}.${Date.now()}`;
  try {
    const sessionDir = join6(paths.sessionScoped, "..");
    if (!existsSync5(sessionDir)) {
      mkdirSync4(sessionDir, { recursive: true });
    }
    copyFileSync(paths.legacy, sentinel);
    if (existsSync5(paths.sessionScoped)) return;
    renameSync2(sentinel, paths.sessionScoped);
  } catch {
  } finally {
    try {
      unlinkSync4(sentinel);
    } catch {
    }
  }
}
function readResolvedState(paths, sessionId) {
  return sessionId ? readJsonSafe(paths.sessionScoped) : readJsonSafe(paths.effectiveRead);
}
function waitForMissionLock(ms) {
  const buffer = new SharedArrayBuffer(4);
  const view = new Int32Array(buffer);
  try {
    Atomics.wait(view, 0, 0, ms);
  } catch {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
    }
  }
}
function withMissionStateLock(lockPath, update) {
  const deadline = Date.now() + MISSION_STATE_LOCK_OPTS.timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    let lockAcquired = false;
    try {
      return withFileLockSync(lockPath, () => {
        lockAcquired = true;
        return update();
      }, {
        ...MISSION_STATE_LOCK_OPTS,
        timeoutMs: Math.min(250, deadline - Date.now())
      });
    } catch (error) {
      if (lockAcquired) throw error;
      lastError = error;
    }
    waitForMissionLock(MISSION_STATE_LOCK_OPTS.retryDelayMs);
  }
  throw lastError instanceof Error ? lastError : new Error(`Failed to acquire mission state lock: ${lockPath}`);
}
function updateState(directory, sessionId, update) {
  const paths = resolveSessionStatePaths("mission-state", sessionId, directory);
  const writePath = paths.effectiveWrite;
  const stateDir = join6(writePath, "..");
  if (!existsSync5(stateDir)) {
    mkdirSync4(stateDir, { recursive: true });
  }
  return withMissionStateLock(writePath + ".lock", () => {
    maybeMigrateLegacyLocked(paths);
    const state = update(readResolvedState(paths, sessionId));
    atomicWriteJsonSync(writePath, state);
    return state;
  });
}
function parseTime(value) {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
function compactText(value, width = 64) {
  const trimmed = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  if (!trimmed) return null;
  return truncateToWidth(trimmed, width);
}
function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--:--";
  return date.toISOString().slice(11, 16);
}
function latest(...values) {
  return values.filter((value) => Boolean(value)).sort((left, right) => parseTime(right) - parseTime(left))[0];
}
function summarizeTask(task) {
  if (!task) return null;
  return compactText(task.result || task.summary || task.error || task.subject || task.description, 56);
}
function deriveTeamStatus(taskCounts, agents) {
  if (taskCounts.inProgress > 0 || agents.some((agent) => agent.status === "running")) {
    return "running";
  }
  if (taskCounts.blocked > 0 || taskCounts.failed > 0 || agents.some((agent) => agent.status === "blocked")) {
    return "blocked";
  }
  if (taskCounts.total > 0 && taskCounts.completed === taskCounts.total) {
    return "done";
  }
  return "waiting";
}
function deriveWorkerStatus(workerStatus, task) {
  if (workerStatus?.state === "blocked" || workerStatus?.state === "failed" || task?.status === "blocked" || task?.status === "failed") return "blocked";
  if (workerStatus?.state === "working" || task?.status === "in_progress") return "running";
  if (workerStatus?.state === "done" || task?.status === "completed") return "done";
  return "waiting";
}
function collectTeamMission(teamRoot, teamName, config) {
  const teamConfig = readJsonSafe(join6(teamRoot, "config.json"));
  if (!teamConfig) return null;
  const workers = canonicalizeWorkers((Array.isArray(teamConfig.workers) ? teamConfig.workers : []).map((worker, index) => ({
    name: worker.name ?? "",
    index: index + 1,
    role: worker.role ?? "worker",
    assigned_tasks: Array.isArray(worker.assigned_tasks) ? worker.assigned_tasks : []
  }))).workers;
  const tasksDir = join6(teamRoot, "tasks");
  const tasks = existsSync5(tasksDir) ? readdirSync3(tasksDir).filter((entry) => /^(?:task-)?\d+\.json$/i.test(entry)).map((entry) => readJsonSafe(join6(tasksDir, entry))).filter((task) => Boolean(task?.id)) : [];
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const taskCounts = {
    total: tasks.length,
    pending: tasks.filter((task) => task.status === "pending").length,
    blocked: tasks.filter((task) => task.status === "blocked").length,
    inProgress: tasks.filter((task) => task.status === "in_progress").length,
    completed: tasks.filter((task) => task.status === "completed").length,
    failed: tasks.filter((task) => task.status === "failed").length
  };
  const timeline = [];
  for (const event of readJsonLinesSafe(join6(teamRoot, "events.jsonl"))) {
    if (!event.created_at || !event.type) continue;
    if (event.type === "task_completed" || event.type === "task_failed") {
      timeline.push({
        id: `event:${event.event_id || `${event.type}:${event.created_at}`}`,
        at: event.created_at,
        kind: event.type === "task_completed" ? "completion" : "failure",
        agent: event.worker || "leader-fixed",
        detail: compactText(`${event.type === "task_completed" ? "completed" : "failed"} task ${event.task_id ?? "?"}`, 72) || event.type,
        sourceKey: `event:${event.event_id || event.type}`
      });
    } else if (event.type === "team_leader_nudge" || event.type === "worker_idle" || event.type === "worker_stopped") {
      timeline.push({
        id: `event:${event.event_id || `${event.type}:${event.created_at}`}`,
        at: event.created_at,
        kind: "update",
        agent: event.worker || "leader-fixed",
        detail: compactText(event.reason || event.type.replace(/_/g, " "), 72) || event.type,
        sourceKey: `event:${event.event_id || event.type}`
      });
    }
  }
  for (const worker of workers) {
    const workerName = worker.name?.trim();
    if (!workerName) continue;
    const mailbox = readJsonSafe(join6(teamRoot, "mailbox", `${workerName}.json`));
    for (const message of mailbox?.messages ?? []) {
      if (!message.created_at || !message.body) continue;
      timeline.push({
        id: `handoff:${message.message_id || `${workerName}:${message.created_at}`}`,
        at: message.created_at,
        kind: "handoff",
        agent: workerName,
        detail: compactText(message.body, 72) || "handoff",
        sourceKey: `handoff:${message.message_id || workerName}`
      });
    }
  }
  timeline.sort((left, right) => parseTime(left.at) - parseTime(right.at));
  const agents = workers.slice(0, config.maxAgentsPerMission).map((worker) => {
    const workerName = worker.name?.trim() || "worker";
    const workerStatus = readJsonSafe(join6(teamRoot, "workers", workerName, "status.json"));
    const heartbeat = readJsonSafe(join6(teamRoot, "workers", workerName, "heartbeat.json"));
    const ownedTasks = tasks.filter((task) => task.owner === workerName);
    const currentTask = (workerStatus?.current_task_id ? taskById.get(workerStatus.current_task_id) : void 0) || ownedTasks.find((task) => task.status === "in_progress") || ownedTasks.find((task) => task.status === "blocked") || (worker.assigned_tasks || []).map((taskId) => taskById.get(taskId)).find(Boolean) || void 0;
    const completedTask = [...ownedTasks].filter((task) => task.status === "completed" || task.status === "failed").sort((left, right) => parseTime(right.completed_at) - parseTime(left.completed_at))[0];
    const latestTimeline = [...timeline].reverse().find((entry) => entry.agent === workerName);
    const ownership = Array.from(new Set([
      ...worker.assigned_tasks || [],
      ...ownedTasks.map((task) => task.id || "")
    ].filter(Boolean))).map((taskId) => `#${taskId}`).join(",");
    return {
      name: workerName,
      role: worker.role,
      ownership: ownership || void 0,
      status: deriveWorkerStatus(workerStatus ?? null, currentTask),
      currentStep: compactText(
        workerStatus?.reason || (currentTask?.id && currentTask.subject ? `#${currentTask.id} ${currentTask.subject}` : currentTask?.subject) || currentTask?.description,
        56
      ),
      latestUpdate: compactText(workerStatus?.reason || latestTimeline?.detail || summarizeTask(currentTask), 64),
      completedSummary: summarizeTask(completedTask),
      updatedAt: latest(workerStatus?.updated_at, heartbeat?.last_turn_at, latestTimeline?.at, completedTask?.completed_at)
    };
  });
  const createdAt = teamConfig.created_at || latest(...timeline.map((entry) => entry.at)) || (/* @__PURE__ */ new Date()).toISOString();
  const updatedAt = latest(createdAt, ...timeline.map((entry) => entry.at), ...agents.map((agent) => agent.updatedAt)) || createdAt;
  return {
    id: `team:${teamName}`,
    source: "team",
    teamName,
    name: teamName,
    objective: compactText(teamConfig.task, 72) || teamName,
    createdAt,
    updatedAt,
    status: deriveTeamStatus(taskCounts, agents),
    workerCount: workers.length,
    taskCounts,
    agents,
    timeline: timeline.slice(-config.maxTimelineEvents)
  };
}
function mergeMissions(previous, teamMissions, config) {
  const previousMissions = previous?.missions || [];
  const sessionMissions = previousMissions.filter((mission) => mission.source === "session");
  const currentIds = new Set(teamMissions.map((mission) => mission.id));
  const cutoff = Date.now() - config.persistCompletedForMinutes * 6e4;
  const preservedTeams = previousMissions.filter((mission) => mission.source === "team" && !currentIds.has(mission.id) && mission.status === "done" && parseTime(mission.updatedAt) >= cutoff);
  return [...teamMissions, ...sessionMissions, ...preservedTeams].sort((left, right) => {
    const statusDelta = STATUS_ORDER[left.status] - STATUS_ORDER[right.status];
    if (statusDelta !== 0) return statusDelta;
    return parseTime(right.updatedAt) - parseTime(left.updatedAt);
  }).slice(0, config.maxMissions);
}
function refreshMissionBoardState(directory, rawConfig = DEFAULT_CONFIG, sessionId) {
  const effectiveSessionId = sessionId ?? getProcessSessionId();
  const config = resolveConfig(rawConfig);
  const teamsRoot = join6(getOmcRoot(directory), "state", "team");
  const teamMissions = existsSync5(teamsRoot) ? readdirSync3(teamsRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => collectTeamMission(join6(teamsRoot, entry.name), entry.name, config)).filter((mission) => Boolean(mission)) : [];
  return updateState(directory, effectiveSessionId, (previous) => ({
    updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    missions: mergeMissions(previous, teamMissions, config)
  }));
}
function renderMissionBoard(state, rawConfig = DEFAULT_CONFIG) {
  if (!state || !Array.isArray(state.missions) || state.missions.length === 0) return [];
  const config = resolveConfig(rawConfig);
  const lines = [];
  for (const mission of state.missions.slice(0, config.maxMissions)) {
    const summary = [
      `${mission.taskCounts.completed}/${mission.taskCounts.total} done`,
      ...mission.taskCounts.inProgress > 0 ? [`${mission.taskCounts.inProgress} active`] : [],
      ...mission.taskCounts.blocked > 0 ? [`${mission.taskCounts.blocked} blocked`] : [],
      ...mission.taskCounts.pending > 0 ? [`${mission.taskCounts.pending} waiting`] : [],
      ...mission.taskCounts.failed > 0 ? [`${mission.taskCounts.failed} failed`] : []
    ].join(" \xB7 ");
    lines.push(`MISSION ${mission.name} [${mission.status}] \xB7 ${summary} \xB7 ${mission.objective}`);
    for (const agent of mission.agents.slice(0, config.maxAgentsPerMission)) {
      const badge = agent.status === "running" ? "run" : agent.status === "blocked" ? "blk" : agent.status === "done" ? "done" : "wait";
      const detail = agent.status === "done" ? agent.completedSummary || agent.latestUpdate || agent.currentStep || "done" : agent.latestUpdate || agent.currentStep || "no update";
      lines.push(`  [${badge}] ${agent.name}${agent.role ? ` (${agent.role})` : ""}${agent.ownership ? ` \xB7 own:${agent.ownership}` : ""} \xB7 ${detail}`);
    }
    if (mission.timeline.length > 0) {
      const timeline = mission.timeline.slice(-config.maxTimelineEvents).map((entry) => {
        const label = entry.kind === "completion" ? "done" : entry.kind === "failure" ? "fail" : entry.kind;
        return `${formatTime(entry.at)} ${label} ${entry.agent}: ${entry.detail}`;
      }).join(" | ");
      lines.push(`  timeline: ${timeline}`);
    }
  }
  return lines;
}

// src/hud/types.ts
var DEFAULT_HUD_LABELS = {
  context: "ctx",
  tokens: "tok",
  tool: "T",
  agent: "A",
  skill: "S",
  ralph: "ralph",
  background: "bg",
  thinking: "thinking",
  model: "Model",
  staged: "+",
  modified: "!",
  untracked: "?",
  ahead: "\u21E1",
  behind: "\u21E3"
};
var HUD_LOCALE_LABELS = {
  en: DEFAULT_HUD_LABELS,
  "zh-CN": {
    context: "\u4E0A\u4E0B\u6587",
    tokens: "\u4EE4\u724C",
    tool: "\u5DE5\u5177",
    agent: "\u667A\u80FD\u4F53",
    skill: "\u6280\u80FD",
    ralph: "\u5FAA\u73AF",
    background: "\u540E\u53F0",
    thinking: "\u601D\u8003",
    model: "\u6A21\u578B",
    staged: "\u5DF2\u6682\u5B58",
    modified: "\u5DF2\u4FEE\u6539",
    untracked: "\u672A\u8DDF\u8E2A",
    ahead: "\u9886\u5148",
    behind: "\u843D\u540E"
  }
};
var HUD_LABEL_KEYS = Object.freeze(
  Object.keys(DEFAULT_HUD_LABELS)
);
function isHudLocale(value) {
  return value === "en" || value === "zh-CN";
}
function sanitizeHudLabels(labels) {
  if (!labels || typeof labels !== "object") return {};
  const sanitized = {};
  for (const key of HUD_LABEL_KEYS) {
    const value = labels[key];
    if (typeof value === "string" && value.length > 0) {
      sanitized[key] = value;
    }
  }
  return sanitized;
}
function resolveHudLabels(locale, labels) {
  return {
    ...DEFAULT_HUD_LABELS,
    ...isHudLocale(locale) ? HUD_LOCALE_LABELS[locale] : {},
    ...sanitizeHudLabels(labels)
  };
}
var DEFAULT_ELEMENT_ORDER = {
  line1: ["hostname", "cwd", "gitRepo", "gitBranch", "gitStatus", "apiKeySource", "profile"],
  main: [
    "omcLabel",
    "model",
    "enterpriseCost",
    "rateLimits",
    "customBuckets",
    "permission",
    "thinking",
    "promptTime",
    "session",
    "tokens",
    "ralph",
    "autopilot",
    "prd",
    "skills",
    "lastSkill",
    "contextBar",
    "agents",
    "background",
    "callCounts",
    "lastTool",
    "sessionSummary"
  ],
  detail: ["missionBoard", "agents", "contextWarning", "payloadWarning", "todos"]
};
var DEFAULT_HUD_USAGE_POLL_INTERVAL_MS = 90 * 1e3;
var DEFAULT_HUD_CONFIG = {
  preset: "focused",
  locale: "en",
  labels: DEFAULT_HUD_LABELS,
  elements: {
    cwd: false,
    // Disabled by default for backward compatibility
    cwdFormat: "relative",
    useHyperlinks: false,
    gitRepo: false,
    // Disabled by default for backward compatibility
    gitBranch: false,
    // Disabled by default for backward compatibility
    gitStatus: false,
    // Disabled by default for backward compatibility
    gitInfoPosition: "above",
    // Git info above main HUD line (backward compatible)
    model: true,
    // Show only when Claude Code statusline stdin provides a model
    modelFormat: "versioned",
    // Preserve model version by default
    omcLabel: true,
    updateNotification: true,
    // Preserve existing update prompt behavior by default
    rateLimits: true,
    // Show rate limits by default
    ralph: true,
    autopilot: true,
    prdStory: true,
    activeSkills: true,
    contextBar: true,
    agents: true,
    agentsFormat: "multiline",
    // Multi-line for rich agent visualization
    agentsMaxLines: 5,
    // Show up to 5 agent detail lines
    backgroundTasks: true,
    todos: true,
    lastSkill: true,
    permissionStatus: false,
    // Disabled: heuristic-based, causes false positives
    thinking: true,
    thinkingFormat: "text",
    // Text format for backward compatibility
    apiKeySource: false,
    // Disabled by default
    hostname: false,
    profile: true,
    // Show profile name when CLAUDE_CONFIG_DIR is set
    missionBoard: false,
    // Opt-in mission board for whole-run progress tracking
    promptTime: true,
    // Show last prompt time by default
    sessionHealth: true,
    showSessionDuration: true,
    showHealthIndicator: true,
    showTokens: false,
    useBars: false,
    // Disabled by default for backwards compatibility
    showCallCounts: true,
    // Show tool/agent/skill call counts by default (Issue #710)
    callCountsFormat: "auto",
    // Preserve platform-based emoji/ASCII defaults unless explicitly overridden
    showLastTool: false,
    sessionSummary: false,
    // Disabled by default - opt-in AI-generated session summary
    maxOutputLines: 4,
    safeMode: true
    // Enabled by default to prevent terminal rendering corruption (Issue #346)
  },
  thresholds: {
    contextWarning: 70,
    contextCompactSuggestion: 80,
    contextCritical: 85,
    ralphWarning: 7
  },
  staleTaskThresholdMinutes: 10,
  contextLimitWarning: {
    threshold: 80,
    autoCompact: false
  },
  missionBoard: DEFAULT_MISSION_BOARD_CONFIG,
  usageApiPollIntervalMs: DEFAULT_HUD_USAGE_POLL_INTERVAL_MS,
  wrapMode: "truncate"
};
var PRESET_CONFIGS = {
  minimal: {
    cwd: false,
    cwdFormat: "folder",
    useHyperlinks: false,
    gitRepo: false,
    gitBranch: false,
    gitStatus: false,
    gitInfoPosition: "above",
    model: true,
    modelFormat: "versioned",
    omcLabel: true,
    updateNotification: true,
    rateLimits: true,
    ralph: true,
    autopilot: true,
    prdStory: false,
    activeSkills: true,
    lastSkill: true,
    contextBar: false,
    agents: true,
    agentsFormat: "count",
    agentsMaxLines: 0,
    backgroundTasks: false,
    todos: true,
    permissionStatus: false,
    thinking: false,
    thinkingFormat: "text",
    apiKeySource: false,
    hostname: false,
    profile: true,
    missionBoard: false,
    promptTime: false,
    sessionHealth: false,
    showSessionDuration: true,
    showHealthIndicator: true,
    showTokens: false,
    useBars: false,
    showCallCounts: false,
    showLastTool: false,
    sessionSummary: false,
    maxOutputLines: 2,
    safeMode: true
  },
  focused: {
    cwd: false,
    cwdFormat: "relative",
    useHyperlinks: false,
    gitRepo: false,
    gitBranch: true,
    gitStatus: true,
    gitInfoPosition: "above",
    model: true,
    modelFormat: "versioned",
    omcLabel: true,
    updateNotification: true,
    rateLimits: true,
    ralph: true,
    autopilot: true,
    prdStory: true,
    activeSkills: true,
    lastSkill: true,
    contextBar: true,
    agents: true,
    agentsFormat: "multiline",
    agentsMaxLines: 3,
    backgroundTasks: true,
    todos: true,
    permissionStatus: false,
    thinking: true,
    thinkingFormat: "text",
    apiKeySource: false,
    hostname: false,
    profile: true,
    missionBoard: false,
    promptTime: true,
    sessionHealth: true,
    showSessionDuration: true,
    showHealthIndicator: true,
    showTokens: false,
    useBars: true,
    showCallCounts: true,
    showLastTool: false,
    sessionSummary: false,
    // Opt-in: sends transcript to claude -p
    maxOutputLines: 4,
    safeMode: true
  },
  full: {
    cwd: false,
    cwdFormat: "relative",
    useHyperlinks: false,
    gitRepo: true,
    gitBranch: true,
    gitStatus: true,
    gitInfoPosition: "above",
    model: true,
    modelFormat: "versioned",
    omcLabel: true,
    updateNotification: true,
    rateLimits: true,
    ralph: true,
    autopilot: true,
    prdStory: true,
    activeSkills: true,
    lastSkill: true,
    contextBar: true,
    agents: true,
    agentsFormat: "multiline",
    agentsMaxLines: 10,
    backgroundTasks: true,
    todos: true,
    permissionStatus: false,
    thinking: true,
    thinkingFormat: "text",
    apiKeySource: true,
    hostname: false,
    profile: true,
    missionBoard: false,
    promptTime: true,
    sessionHealth: true,
    showSessionDuration: true,
    showHealthIndicator: true,
    showTokens: false,
    useBars: true,
    showCallCounts: true,
    showLastTool: false,
    sessionSummary: false,
    // Opt-in: sends transcript to claude -p
    maxOutputLines: 12,
    safeMode: true
  },
  opencode: {
    cwd: false,
    cwdFormat: "relative",
    useHyperlinks: false,
    gitRepo: false,
    gitBranch: true,
    gitStatus: false,
    gitInfoPosition: "above",
    model: true,
    modelFormat: "versioned",
    omcLabel: true,
    updateNotification: true,
    rateLimits: false,
    ralph: true,
    autopilot: true,
    prdStory: false,
    activeSkills: true,
    lastSkill: true,
    contextBar: true,
    agents: true,
    agentsFormat: "codes",
    agentsMaxLines: 0,
    backgroundTasks: false,
    todos: true,
    permissionStatus: false,
    thinking: true,
    thinkingFormat: "text",
    apiKeySource: false,
    hostname: false,
    profile: true,
    missionBoard: false,
    promptTime: true,
    sessionHealth: true,
    showSessionDuration: true,
    showHealthIndicator: true,
    showTokens: false,
    useBars: false,
    showCallCounts: true,
    showLastTool: false,
    sessionSummary: false,
    maxOutputLines: 4,
    safeMode: true
  },
  dense: {
    cwd: false,
    cwdFormat: "relative",
    useHyperlinks: false,
    gitRepo: true,
    gitBranch: true,
    gitStatus: true,
    gitInfoPosition: "above",
    model: true,
    modelFormat: "versioned",
    omcLabel: true,
    updateNotification: true,
    rateLimits: true,
    ralph: true,
    autopilot: true,
    prdStory: true,
    activeSkills: true,
    lastSkill: true,
    contextBar: true,
    agents: true,
    agentsFormat: "multiline",
    agentsMaxLines: 5,
    backgroundTasks: true,
    todos: true,
    permissionStatus: false,
    thinking: true,
    thinkingFormat: "text",
    apiKeySource: true,
    hostname: false,
    profile: true,
    missionBoard: false,
    promptTime: true,
    sessionHealth: true,
    showSessionDuration: true,
    showHealthIndicator: true,
    showTokens: false,
    useBars: true,
    showCallCounts: true,
    showLastTool: false,
    sessionSummary: false,
    // Opt-in: sends transcript to claude -p
    maxOutputLines: 6,
    safeMode: true
  }
};

// src/hud/background-cleanup.ts
var STALE_TASK_THRESHOLD_MS = 30 * 60 * 1e3;
function getTaskStartMs(task) {
  const raw = task.startedAt ?? task.startTime;
  if (!raw) return NaN;
  return new Date(raw).getTime();
}
async function cleanupStaleBackgroundTasks(thresholdMs = STALE_TASK_THRESHOLD_MS, directory, sessionId) {
  const state = readHudState(directory, sessionId);
  if (!state || !state.backgroundTasks) {
    return 0;
  }
  const now = Date.now();
  const originalCount = state.backgroundTasks.length;
  let statusChanged = false;
  for (const task of state.backgroundTasks) {
    if (task.status === "running") {
      const startMs = getTaskStartMs(task);
      if (Number.isNaN(startMs)) {
        task.status = "failed";
        task.completedAt = (/* @__PURE__ */ new Date()).toISOString();
        statusChanged = true;
      } else {
        const taskAge = now - startMs;
        if (taskAge > thresholdMs) {
          task.status = "failed";
          task.completedAt = (/* @__PURE__ */ new Date()).toISOString();
          statusChanged = true;
        }
      }
    }
  }
  state.backgroundTasks = state.backgroundTasks.filter((task) => {
    if (task.status === "running") return true;
    if (task.completedAt) {
      const completedMs = new Date(task.completedAt).getTime();
      if (Number.isNaN(completedMs)) return true;
      return now - completedMs < thresholdMs;
    }
    return true;
  });
  if (state.backgroundTasks.length > 20) {
    const running = state.backgroundTasks.filter((t) => t.status === "running");
    const nonRunning = state.backgroundTasks.filter((t) => t.status !== "running").slice(-Math.max(0, 20 - running.length));
    state.backgroundTasks = [...running, ...nonRunning];
  }
  const removedCount = originalCount - state.backgroundTasks.length;
  if (removedCount > 0 || statusChanged) {
    state.timestamp = (/* @__PURE__ */ new Date()).toISOString();
    writeHudState(state, directory, sessionId);
  }
  return removedCount;
}
async function detectOrphanedTasks(directory, sessionId) {
  const state = readHudState(directory, sessionId);
  if (!state || !state.backgroundTasks) {
    return [];
  }
  const orphaned = [];
  for (const task of state.backgroundTasks) {
    if (task.status === "running") {
      const taskAge = Date.now() - new Date(task.startedAt).getTime();
      const TWO_HOURS_MS = 2 * 60 * 60 * 1e3;
      if (taskAge > TWO_HOURS_MS) {
        orphaned.push(task);
      }
    }
  }
  return orphaned;
}
async function markOrphanedTasksAsStale(directory, sessionId) {
  const state = readHudState(directory, sessionId);
  if (!state || !state.backgroundTasks) {
    return 0;
  }
  const orphaned = await detectOrphanedTasks(directory, sessionId);
  let marked = 0;
  for (const orphanedTask of orphaned) {
    const task = state.backgroundTasks.find((t) => t.id === orphanedTask.id);
    if (task && task.status === "running") {
      task.status = "completed";
      marked++;
    }
  }
  if (marked > 0) {
    writeHudState(state, directory, sessionId);
  }
  return marked;
}

// src/hud/state.ts
function getLocalStateFilePath(directory) {
  const baseDir = validateWorkingDirectory(directory);
  const omcStateDir = join7(getOmcRoot(baseDir), "state");
  return join7(omcStateDir, "hud-state.json");
}
function getLegacyRootStateFilePath(directory) {
  const baseDir = validateWorkingDirectory(directory);
  return join7(getOmcRoot(baseDir), "hud-state.json");
}
function getStateFilePath(directory, sessionId) {
  const baseDir = validateWorkingDirectory(directory);
  if (sessionId) {
    return resolveSessionStatePath("hud", sessionId, baseDir);
  }
  return getLocalStateFilePath(baseDir);
}
function getSettingsFilePath() {
  return join7(getClaudeConfigDir(), "settings.json");
}
function getConfigFilePath() {
  return join7(getClaudeConfigDir(), ".omc", "hud-config.json");
}
function readJsonFile(filePath) {
  if (!existsSync6(filePath)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync7(filePath, "utf-8"));
  } catch {
    return null;
  }
}
function getLegacyHudConfig() {
  return readJsonFile(getConfigFilePath());
}
function mergeElements(primary, secondary) {
  return {
    ...primary ?? {},
    ...secondary ?? {}
  };
}
function mergeThresholds(primary, secondary) {
  return {
    ...primary ?? {},
    ...secondary ?? {}
  };
}
function mergeContextLimitWarning(primary, secondary) {
  return {
    ...primary ?? {},
    ...secondary ?? {}
  };
}
function mergeMissionBoardConfig(primary, secondary) {
  return {
    ...primary ?? {},
    ...secondary ?? {}
  };
}
function ensureStateDir(directory) {
  const baseDir = validateWorkingDirectory(directory);
  const omcStateDir = join7(getOmcRoot(baseDir), "state");
  if (!existsSync6(omcStateDir)) {
    mkdirSync5(omcStateDir, { recursive: true });
  }
}
function ensureHudStateDir(directory, sessionId) {
  if (sessionId) {
    ensureSessionStateDir(sessionId, validateWorkingDirectory(directory));
    return;
  }
  ensureStateDir(directory);
}
function readHudState(directory, sessionId) {
  if (sessionId) {
    const sessionStateFile = getStateFilePath(directory, sessionId);
    if (!existsSync6(sessionStateFile)) {
      return null;
    }
    try {
      const content = readFileSync7(sessionStateFile, "utf-8");
      return JSON.parse(content);
    } catch (error) {
      console.error(
        "[HUD] Failed to read session state:",
        error instanceof Error ? error.message : error
      );
      return null;
    }
  }
  const localStateFile = getLocalStateFilePath(directory);
  if (existsSync6(localStateFile)) {
    try {
      const content = readFileSync7(localStateFile, "utf-8");
      return JSON.parse(content);
    } catch (error) {
      console.error(
        "[HUD] Failed to read local state:",
        error instanceof Error ? error.message : error
      );
    }
  }
  const legacyStateFile = getLegacyRootStateFilePath(directory);
  if (existsSync6(legacyStateFile)) {
    try {
      const content = readFileSync7(legacyStateFile, "utf-8");
      return JSON.parse(content);
    } catch (error) {
      console.error(
        "[HUD] Failed to read legacy state:",
        error instanceof Error ? error.message : error
      );
      return null;
    }
  }
  return null;
}
function writeHudState(state, directory, sessionId) {
  try {
    ensureHudStateDir(directory, sessionId);
    const stateFile = getStateFilePath(directory, sessionId);
    const nextState = sessionId ? { ...state, sessionId } : state;
    atomicWriteJsonSync(stateFile, nextState);
    if (sessionId) {
      const legacyCandidates = [
        getLegacyRootStateFilePath(directory)
      ];
      for (const legacyFile of legacyCandidates) {
        if (!existsSync6(legacyFile)) {
          continue;
        }
        try {
          const content = readFileSync7(legacyFile, "utf-8");
          const legacyState = JSON.parse(content);
          if (!legacyState.sessionId || legacyState.sessionId === sessionId) {
            unlinkSync5(legacyFile);
          }
        } catch {
        }
      }
    }
    return true;
  } catch (error) {
    console.error(
      "[HUD] Failed to write state:",
      error instanceof Error ? error.message : error
    );
    return false;
  }
}
function getRunningTasks(state) {
  if (!state) return [];
  return state.backgroundTasks.filter((task) => task.status === "running");
}
function readHudConfig() {
  const settingsFile = getSettingsFilePath();
  const legacyConfig = getLegacyHudConfig();
  if (existsSync6(settingsFile)) {
    try {
      const content = readFileSync7(settingsFile, "utf-8");
      const settings = parseJsonc(content);
      if (settings.omcHud) {
        return mergeWithDefaults({
          ...legacyConfig,
          ...settings.omcHud,
          elements: mergeElements(
            legacyConfig?.elements,
            settings.omcHud.elements
          ),
          thresholds: mergeThresholds(
            legacyConfig?.thresholds,
            settings.omcHud.thresholds
          ),
          contextLimitWarning: mergeContextLimitWarning(
            legacyConfig?.contextLimitWarning,
            settings.omcHud.contextLimitWarning
          ),
          missionBoard: mergeMissionBoardConfig(
            legacyConfig?.missionBoard,
            settings.omcHud.missionBoard
          ),
          locale: isHudLocale(settings.omcHud.locale) ? settings.omcHud.locale : legacyConfig?.locale,
          labels: {
            ...sanitizeHudLabels(legacyConfig?.labels),
            ...sanitizeHudLabels(settings.omcHud.labels)
          }
        });
      }
    } catch (error) {
      console.error(
        "[HUD] Failed to read settings.json:",
        error instanceof Error ? error.message : error
      );
    }
  }
  if (legacyConfig) {
    return mergeWithDefaults(legacyConfig);
  }
  return mergeWithDefaults({});
}
function mergeWithDefaults(config) {
  const preset = config.preset ?? DEFAULT_HUD_CONFIG.preset;
  const presetElements = PRESET_CONFIGS[preset] ?? {};
  const missionBoardEnabled = config.missionBoard?.enabled ?? config.elements?.missionBoard ?? DEFAULT_HUD_CONFIG.missionBoard?.enabled ?? false;
  const missionBoard = {
    ...DEFAULT_MISSION_BOARD_CONFIG,
    ...DEFAULT_HUD_CONFIG.missionBoard,
    ...config.missionBoard,
    enabled: missionBoardEnabled
  };
  const locale = isHudLocale(config.locale) ? config.locale : DEFAULT_HUD_CONFIG.locale;
  return {
    preset,
    locale,
    labels: resolveHudLabels(locale, config.labels),
    elements: {
      ...DEFAULT_HUD_CONFIG.elements,
      // Base defaults
      ...presetElements,
      // Preset overrides
      ...config.elements
      // User overrides
    },
    thresholds: {
      ...DEFAULT_HUD_CONFIG.thresholds,
      ...config.thresholds
    },
    staleTaskThresholdMinutes: config.staleTaskThresholdMinutes ?? DEFAULT_HUD_CONFIG.staleTaskThresholdMinutes,
    contextLimitWarning: {
      ...DEFAULT_HUD_CONFIG.contextLimitWarning,
      ...config.contextLimitWarning
    },
    missionBoard,
    usageApiPollIntervalMs: config.usageApiPollIntervalMs ?? DEFAULT_HUD_CONFIG.usageApiPollIntervalMs,
    ...config.elementOrder !== void 0 ? { elementOrder: config.elementOrder } : {},
    wrapMode: config.wrapMode ?? DEFAULT_HUD_CONFIG.wrapMode,
    ...config.rateLimitsProvider ? { rateLimitsProvider: config.rateLimitsProvider } : {},
    ...config.maxWidth != null ? { maxWidth: config.maxWidth } : {},
    ...config.layout ? { layout: config.layout } : {}
  };
}
async function initializeHUDState(directory, sessionId) {
  const removedStale = await cleanupStaleBackgroundTasks(void 0, directory, sessionId);
  const markedOrphaned = await markOrphanedTasksAsStale(directory, sessionId);
  if (removedStale > 0 || markedOrphaned > 0) {
    console.error(
      `HUD cleanup: removed ${removedStale} stale tasks, marked ${markedOrphaned} orphaned tasks`
    );
  }
}

// src/hud/omc-state.ts
import { existsSync as existsSync7, readFileSync as readFileSync8, statSync as statSync3, readdirSync as readdirSync4 } from "fs";
import { join as join9 } from "path";

// src/hooks/autopilot/named-workflow-resume-validator.ts
import { basename as basename5, join as join8, parse as parse3, relative as relative2, resolve as resolve2, sep as sep3 } from "path";

// src/hooks/autopilot/pipeline.ts
import { createHash as createHash2 } from "crypto";

// src/lib/mode-names.ts
var MODE_NAMES = {
  AUTOPILOT: "autopilot",
  AUTORESEARCH: "autoresearch",
  TEAM: "team",
  RALPH: "ralph",
  ULTRAWORK: "ultrawork",
  ULTRAQA: "ultraqa",
  RALPLAN: "ralplan",
  DEEP_INTERVIEW: "deep-interview",
  MERGE_READINESS: "merge-readiness",
  SELF_IMPROVE: "self-improve"
};
var ALL_MODE_NAMES = [
  MODE_NAMES.AUTOPILOT,
  MODE_NAMES.AUTORESEARCH,
  MODE_NAMES.TEAM,
  MODE_NAMES.RALPH,
  MODE_NAMES.ULTRAWORK,
  MODE_NAMES.ULTRAQA,
  MODE_NAMES.RALPLAN,
  MODE_NAMES.DEEP_INTERVIEW,
  MODE_NAMES.MERGE_READINESS,
  MODE_NAMES.SELF_IMPROVE
];
var MODE_STATE_FILE_MAP = {
  [MODE_NAMES.AUTOPILOT]: "autopilot-state.json",
  [MODE_NAMES.AUTORESEARCH]: "autoresearch-state.json",
  [MODE_NAMES.TEAM]: "team-state.json",
  [MODE_NAMES.RALPH]: "ralph-state.json",
  [MODE_NAMES.ULTRAWORK]: "ultrawork-state.json",
  [MODE_NAMES.ULTRAQA]: "ultraqa-state.json",
  [MODE_NAMES.RALPLAN]: "ralplan-state.json",
  [MODE_NAMES.DEEP_INTERVIEW]: "deep-interview-state.json",
  [MODE_NAMES.MERGE_READINESS]: "merge-readiness-state.json",
  [MODE_NAMES.SELF_IMPROVE]: "self-improve-state.json"
};
var SESSION_END_MODE_STATE_FILES = [
  { file: MODE_STATE_FILE_MAP[MODE_NAMES.AUTOPILOT], mode: MODE_NAMES.AUTOPILOT },
  { file: MODE_STATE_FILE_MAP[MODE_NAMES.AUTORESEARCH], mode: MODE_NAMES.AUTORESEARCH },
  { file: MODE_STATE_FILE_MAP[MODE_NAMES.TEAM], mode: MODE_NAMES.TEAM },
  { file: MODE_STATE_FILE_MAP[MODE_NAMES.RALPH], mode: MODE_NAMES.RALPH },
  { file: MODE_STATE_FILE_MAP[MODE_NAMES.ULTRAWORK], mode: MODE_NAMES.ULTRAWORK },
  { file: MODE_STATE_FILE_MAP[MODE_NAMES.ULTRAQA], mode: MODE_NAMES.ULTRAQA },
  { file: MODE_STATE_FILE_MAP[MODE_NAMES.RALPLAN], mode: MODE_NAMES.RALPLAN },
  { file: MODE_STATE_FILE_MAP[MODE_NAMES.DEEP_INTERVIEW], mode: MODE_NAMES.DEEP_INTERVIEW },
  { file: MODE_STATE_FILE_MAP[MODE_NAMES.SELF_IMPROVE], mode: MODE_NAMES.SELF_IMPROVE },
  { file: "skill-active-state.json", mode: "skill-active" }
];
var SESSION_METRICS_MODE_FILES = [
  { file: MODE_STATE_FILE_MAP[MODE_NAMES.AUTOPILOT], mode: MODE_NAMES.AUTOPILOT },
  { file: MODE_STATE_FILE_MAP[MODE_NAMES.AUTORESEARCH], mode: MODE_NAMES.AUTORESEARCH },
  { file: MODE_STATE_FILE_MAP[MODE_NAMES.RALPH], mode: MODE_NAMES.RALPH },
  { file: MODE_STATE_FILE_MAP[MODE_NAMES.ULTRAWORK], mode: MODE_NAMES.ULTRAWORK },
  { file: MODE_STATE_FILE_MAP[MODE_NAMES.RALPLAN], mode: MODE_NAMES.RALPLAN },
  { file: MODE_STATE_FILE_MAP[MODE_NAMES.DEEP_INTERVIEW], mode: MODE_NAMES.DEEP_INTERVIEW },
  { file: MODE_STATE_FILE_MAP[MODE_NAMES.MERGE_READINESS], mode: MODE_NAMES.MERGE_READINESS },
  { file: MODE_STATE_FILE_MAP[MODE_NAMES.SELF_IMPROVE], mode: MODE_NAMES.SELF_IMPROVE }
];

// src/lib/mode-state-io.ts
var RECOVERY_CLAIM_SCRIPT = String.raw`
const fs = require('fs');
const [operation, claimPath, expectedRaw] = process.argv.slice(1);
const keys = ['createdAt', 'nonce', 'pid', 'processStart', 'version'];
function readOwner() {
  try {
    const value = JSON.parse(fs.readFileSync(claimPath, 'utf8'));
    const actual = Object.keys(value).sort();
    if (actual.length !== keys.length || !actual.every((key, index) => key === keys[index]) || value.version !== 1 || !Number.isSafeInteger(value.pid) || value.pid <= 0 || typeof value.processStart !== 'string' || !/^\d+$/.test(value.processStart) || typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt)) || typeof value.nonce !== 'string' || !/^[0-9a-f-]{36}$/i.test(value.nonce)) return null;
    return value;
  } catch (error) { return error && error.code === 'ENOENT' ? 'absent' : null; }
}
function exact(left, right) { return left.pid === right.pid && left.processStart === right.processStart && left.nonce === right.nonce; }
function stale(owner) {
  if (process.platform !== 'linux') return null;
  try {
    const stat = fs.readFileSync('/proc/' + owner.pid + '/stat', 'utf8');
    const end = stat.lastIndexOf(')');
    const fields = end >= 0 ? stat.slice(end + 2).trim().split(/\s+/) : [];
    const start = fields[19] && /^\d+$/.test(fields[19]) ? fields[19] : null;
    return start === null ? null : start !== owner.processStart;
  } catch (error) { return error && error.code === 'ENOENT' ? true : null; }
}
let expected;
try { expected = JSON.parse(expectedRaw); } catch { process.exit(3); }
if (operation === 'release') {
  const current = readOwner();
  if (current === 'absent') process.exit(0);
  if (!current || !exact(current, expected)) process.exit(4);
  try { fs.unlinkSync(claimPath); process.exit(0); } catch { process.exit(3); }
}
const current = readOwner();
if (current !== 'absent') {
  if (!current) process.exit(3);
  const isStale = stale(current);
  if (isStale !== true) process.exit(isStale === false ? 2 : 3);
  try { fs.unlinkSync(claimPath); } catch { process.exit(3); }
}
let fd;
try {
  fd = fs.openSync(claimPath, 'wx', 0o600);
  const bytes = Buffer.from(JSON.stringify(expected));
  let offset = 0;
  while (offset < bytes.length) {
    const written = fs.writeSync(fd, bytes, offset, bytes.length - offset);
    if (written <= 0) throw new Error('recovery claim made no progress');
    offset += written;
  }
  fs.fsyncSync(fd);
  if (fs.statSync(claimPath).size !== bytes.length) throw new Error('recovery claim truncated');
  fs.closeSync(fd);
  process.exit(0);
} catch { try { if (fd !== undefined) fs.closeSync(fd); } catch {} try { fs.unlinkSync(claimPath); } catch {} process.exit(3); }
`;

// src/shared/types.ts
var CANONICAL_TEAM_ROLES = [
  "orchestrator",
  "planner",
  "analyst",
  "architect",
  "executor",
  "debugger",
  "critic",
  "code-reviewer",
  "security-reviewer",
  "test-engineer",
  "designer",
  "writer",
  "code-simplifier",
  "explore",
  "document-specialist"
];
var CURSOR_EXECUTOR_TEAM_ROLES = ["executor"];
var KNOWN_AGENT_NAMES = [
  "omc",
  "explore",
  "analyst",
  "planner",
  "architect",
  "debugger",
  "executor",
  "verifier",
  "securityReviewer",
  "codeReviewer",
  "testEngineer",
  "designer",
  "writer",
  "qaTester",
  "scientist",
  "tracer",
  "gitMaster",
  "codeSimplifier",
  "critic",
  "documentSpecialist"
];

// src/utils/paths.ts
var STALE_THRESHOLD_MS = 24 * 60 * 60 * 1e3;

// src/utils/ssrf-guard.ts
var BLOCKED_HOST_PATTERNS = [
  // Exact matches
  /^localhost$/i,
  /^127\.[0-9]+\.[0-9]+\.[0-9]+$/,
  // Loopback
  /^10\.[0-9]+\.[0-9]+\.[0-9]+$/,
  // Class A private
  /^172\.(1[6-9]|2[0-9]|3[0-1])\.[0-9]+\.[0-9]+$/,
  // Class B private
  /^192\.168\.[0-9]+\.[0-9]+$/,
  // Class C private
  /^169\.254\.[0-9]+\.[0-9]+$/,
  // Link-local
  /^(0|22[4-9]|23[0-9])\.[0-9]+\.[0-9]+\.[0-9]+$/,
  // Multicast, reserved
  /^\[?::1\]?$/,
  // IPv6 loopback
  /^\[?fc00:/i,
  // IPv6 unique local
  /^\[?fe80:/i,
  // IPv6 link-local
  /^\[?::ffff:/i,
  // IPv6-mapped IPv4 (all private ranges accessible via this prefix)
  /^\[?0{0,4}:{0,2}ffff:/i
  // IPv6-mapped IPv4 expanded forms
];
var ALLOWED_SCHEMES = ["https:", "http:"];
function validateUrlForSSRF(urlString) {
  if (!urlString || typeof urlString !== "string") {
    return { allowed: false, reason: "URL is empty or invalid" };
  }
  let parsed;
  try {
    parsed = new URL(urlString);
  } catch {
    return { allowed: false, reason: "Invalid URL format" };
  }
  if (!ALLOWED_SCHEMES.includes(parsed.protocol)) {
    return { allowed: false, reason: `Protocol '${parsed.protocol}' is not allowed` };
  }
  const hostname2 = parsed.hostname.toLowerCase();
  for (const pattern of BLOCKED_HOST_PATTERNS) {
    if (pattern.test(hostname2)) {
      return {
        allowed: false,
        reason: `Hostname '${hostname2}' resolves to a blocked internal/private address`
      };
    }
  }
  if (/^0x[0-9a-f]+$/i.test(hostname2)) {
    return {
      allowed: false,
      reason: `Hostname '${hostname2}' looks like a hex-encoded IP address`
    };
  }
  if (/^\d+$/.test(hostname2) && hostname2.length > 3) {
    return {
      allowed: false,
      reason: `Hostname '${hostname2}' looks like a decimal-encoded IP address`
    };
  }
  if (/^0\d+\./.test(hostname2)) {
    return {
      allowed: false,
      reason: `Hostname '${hostname2}' looks like an octal-encoded IP address`
    };
  }
  if (parsed.username || parsed.password) {
    return { allowed: false, reason: "URLs with embedded credentials are not allowed" };
  }
  const dangerousPaths = [
    "/metadata",
    "/meta-data",
    "/latest/meta-data",
    "/computeMetadata"
  ];
  const pathLower = parsed.pathname.toLowerCase();
  for (const dangerous of dangerousPaths) {
    if (pathLower.startsWith(dangerous)) {
      return {
        allowed: false,
        reason: `Path '${parsed.pathname}' is blocked (cloud metadata access)`
      };
    }
  }
  return { allowed: true };
}
function validateAnthropicBaseUrl(urlString) {
  const result = validateUrlForSSRF(urlString);
  if (!result.allowed) {
    return result;
  }
  let parsed;
  try {
    parsed = new URL(urlString);
  } catch {
    return { allowed: false, reason: "Invalid URL" };
  }
  if (parsed.protocol === "http:") {
    console.warn("[SSRF Guard] Warning: Using HTTP instead of HTTPS for ANTHROPIC_BASE_URL");
  }
  return { allowed: true };
}

// src/config/models.ts
var TIER_ENV_KEYS = {
  LOW: [
    "OMC_MODEL_LOW",
    "CLAUDE_CODE_BEDROCK_HAIKU_MODEL",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL"
  ],
  MEDIUM: [
    "OMC_MODEL_MEDIUM",
    "CLAUDE_CODE_BEDROCK_SONNET_MODEL",
    "ANTHROPIC_DEFAULT_SONNET_MODEL"
  ],
  HIGH: [
    "OMC_MODEL_HIGH",
    "CLAUDE_CODE_BEDROCK_OPUS_MODEL",
    "ANTHROPIC_DEFAULT_OPUS_MODEL"
  ]
};
var CLAUDE_FAMILY_DEFAULTS = {
  HAIKU: "claude-haiku-4-5",
  SONNET: "claude-sonnet-5",
  OPUS: "claude-opus-4-8",
  FABLE: "claude-fable-5"
};
var BUILTIN_TIER_MODEL_DEFAULTS = {
  LOW: CLAUDE_FAMILY_DEFAULTS.HAIKU,
  MEDIUM: CLAUDE_FAMILY_DEFAULTS.SONNET,
  HIGH: CLAUDE_FAMILY_DEFAULTS.OPUS
};
var CLAUDE_FAMILY_HIGH_VARIANTS = {
  HAIKU: `${CLAUDE_FAMILY_DEFAULTS.HAIKU}-high`,
  SONNET: `${CLAUDE_FAMILY_DEFAULTS.SONNET}-high`,
  OPUS: `${CLAUDE_FAMILY_DEFAULTS.OPUS}-high`,
  FABLE: `${CLAUDE_FAMILY_DEFAULTS.FABLE}-high`
};
var BUILTIN_EXTERNAL_MODEL_DEFAULTS = {
  codexModel: "gpt-5.3-codex",
  geminiModel: "gemini-3.1-pro-preview",
  antigravityModel: "Gemini 3.1 Pro (High)",
  copilotModel: "gpt-5.6-sol",
  copilotReasoningEffort: "max"
};
function readEnvValue(key) {
  const value = process.env[key]?.trim();
  return value || void 0;
}
function resolveTierModelFromEnv(tier) {
  for (const key of TIER_ENV_KEYS[tier]) {
    const value = readEnvValue(key);
    if (value) {
      return value;
    }
  }
  return void 0;
}
function getDefaultModelHigh() {
  return resolveTierModelFromEnv("HIGH") || BUILTIN_TIER_MODEL_DEFAULTS.HIGH;
}
function getDefaultModelMedium() {
  return resolveTierModelFromEnv("MEDIUM") || BUILTIN_TIER_MODEL_DEFAULTS.MEDIUM;
}
function getDefaultModelLow() {
  return resolveTierModelFromEnv("LOW") || BUILTIN_TIER_MODEL_DEFAULTS.LOW;
}
function getDefaultTierModels() {
  return {
    LOW: getDefaultModelLow(),
    MEDIUM: getDefaultModelMedium(),
    HIGH: getDefaultModelHigh()
  };
}

// src/config/loader.ts
function buildDefaultConfig() {
  const defaultTierModels = getDefaultTierModels();
  return {
    agents: {
      omc: { model: defaultTierModels.HIGH },
      explore: { model: defaultTierModels.LOW },
      analyst: { model: defaultTierModels.HIGH },
      planner: { model: defaultTierModels.HIGH },
      architect: { model: defaultTierModels.HIGH },
      debugger: { model: defaultTierModels.MEDIUM },
      executor: { model: defaultTierModels.MEDIUM },
      verifier: { model: defaultTierModels.MEDIUM },
      securityReviewer: { model: defaultTierModels.MEDIUM },
      codeReviewer: { model: defaultTierModels.HIGH },
      testEngineer: { model: defaultTierModels.MEDIUM },
      designer: { model: defaultTierModels.MEDIUM },
      writer: { model: defaultTierModels.LOW },
      qaTester: { model: defaultTierModels.MEDIUM },
      scientist: { model: defaultTierModels.MEDIUM },
      tracer: { model: defaultTierModels.MEDIUM },
      gitMaster: { model: defaultTierModels.MEDIUM },
      codeSimplifier: { model: defaultTierModels.HIGH },
      critic: { model: defaultTierModels.HIGH },
      documentSpecialist: { model: defaultTierModels.MEDIUM }
    },
    features: {
      parallelExecution: true,
      lspTools: true,
      // Real LSP integration with language servers
      astTools: true,
      // Real AST tools using ast-grep
      continuationEnforcement: true,
      autoContextInjection: true
    },
    mcpServers: {
      exa: { enabled: true },
      context7: { enabled: true }
    },
    companyContext: {
      onError: "warn"
    },
    permissions: {
      allowBash: true,
      allowEdit: true,
      allowWrite: true,
      maxBackgroundTasks: 5
    },
    magicKeywords: {
      ultrawork: ["ultrawork", "ulw", "uw"],
      search: ["search", "find", "locate"],
      analyze: ["analyze", "investigate", "examine"],
      ultrathink: ["ultrathink", "think", "reason", "ponder"]
    },
    // Intelligent model routing configuration
    routing: {
      enabled: true,
      defaultTier: "MEDIUM",
      forceInherit: false,
      escalationEnabled: true,
      maxEscalations: 2,
      tierModels: { ...defaultTierModels },
      agentOverrides: {
        architect: {
          tier: "HIGH",
          reason: "Advisory agent requires deep reasoning"
        },
        planner: {
          tier: "HIGH",
          reason: "Strategic planning requires deep reasoning"
        },
        critic: {
          tier: "HIGH",
          reason: "Critical review requires deep reasoning"
        },
        analyst: {
          tier: "HIGH",
          reason: "Pre-planning analysis requires deep reasoning"
        },
        explore: { tier: "LOW", reason: "Exploration is search-focused" },
        writer: { tier: "LOW", reason: "Documentation is straightforward" }
      },
      escalationKeywords: [
        "critical",
        "production",
        "urgent",
        "security",
        "breaking",
        "architecture",
        "refactor",
        "redesign",
        "root cause"
      ],
      simplificationKeywords: [
        "find",
        "list",
        "show",
        "where",
        "search",
        "locate",
        "grep"
      ]
    },
    // External models configuration (Codex, Gemini)
    // Static defaults only — env var overrides applied in loadEnvConfig()
    externalModels: {
      defaults: {
        codexModel: BUILTIN_EXTERNAL_MODEL_DEFAULTS.codexModel,
        geminiModel: BUILTIN_EXTERNAL_MODEL_DEFAULTS.geminiModel,
        antigravityModel: BUILTIN_EXTERNAL_MODEL_DEFAULTS.antigravityModel,
        copilotModel: BUILTIN_EXTERNAL_MODEL_DEFAULTS.copilotModel,
        copilotReasoningEffort: BUILTIN_EXTERNAL_MODEL_DEFAULTS.copilotReasoningEffort
      },
      fallbackPolicy: {
        onModelFailure: "provider_chain",
        allowCrossProvider: false,
        crossProviderOrder: ["codex", "gemini"]
      }
    },
    // Delegation routing configuration (opt-in feature for external model routing)
    delegationRouting: {
      enabled: false,
      defaultProvider: "claude",
      roles: {}
    },
    // /team role routing (Option E — /team-scoped per-role provider & model)
    // Empty defaults: zero behavior change until user opts in.
    team: {
      ops: {},
      roleRouting: {}
    },
    autopilot: {
      execution: "solo"
    },
    planOutput: {
      directory: ".omc/plans",
      filenameTemplate: "{{name}}.md"
    },
    teleport: {
      symlinkNodeModules: true
    },
    startupCodebaseMap: {
      enabled: true,
      maxFiles: 200,
      maxDepth: 4
    },
    taskSizeDetection: {
      enabled: true,
      smallWordLimit: 50,
      largeWordLimit: 200,
      suppressHeavyModesForSmallTasks: true
    },
    promptPrerequisites: {
      enabled: true,
      sectionNames: {
        memory: ["M\xC9MOIRE", "MEMOIRE", "MEMORY"],
        skills: ["SKILLS"],
        verifyFirst: ["VERIFY-FIRST", "VERIFY FIRST", "VERIFY_FIRST"],
        context: ["CONTEXT"]
      },
      blockingTools: ["Edit", "MultiEdit", "Write", "Agent", "Task"],
      executionKeywords: ["ralph", "ultrawork", "autopilot"]
    }
  };
}
var DEFAULT_CONFIG2 = buildDefaultConfig();
var CANONICAL_TEAM_ROLE_SET = new Set(CANONICAL_TEAM_ROLES);
var CURSOR_EXECUTOR_TEAM_ROLE_SET = new Set(CURSOR_EXECUTOR_TEAM_ROLES);
var KNOWN_AGENT_NAME_SET = new Set(KNOWN_AGENT_NAMES);

// src/hooks/subagent-tracker/session-replay.ts
var MAX_REPLAY_SIZE_BYTES = 5 * 1024 * 1024;

// src/hooks/subagent-tracker/index.ts
var STALE_THRESHOLD_MS2 = 5 * 60 * 1e3;
var COPILOT_EVENT_TAIL_BYTES = 256 * 1024;
var LOCK_OPTS = {
  timeoutMs: 500,
  retryDelayMs: 50,
  staleLockMs: 3e4
};
var LIFECYCLE_LOCK_OPTS = {
  ...LOCK_OPTS,
  timeoutMs: 5e3
};

// src/hooks/skill-state/index.ts
var WORKFLOW_TOMBSTONE_TTL_MS = 24 * 60 * 60 * 1e3;
var PROTECTION_CONFIGS = {
  none: { maxReinforcements: 0, staleTtlMs: 0 },
  light: { maxReinforcements: 3, staleTtlMs: 5 * 60 * 1e3 },
  // 5 min
  medium: { maxReinforcements: 5, staleTtlMs: 15 * 60 * 1e3 },
  // 15 min
  heavy: { maxReinforcements: 10, staleTtlMs: 30 * 60 * 1e3 }
  // 30 min
};

// src/hooks/mode-registry/index.ts
var MODE_CONFIGS = {
  [MODE_NAMES.AUTOPILOT]: {
    name: "Autopilot",
    stateFile: MODE_STATE_FILE_MAP[MODE_NAMES.AUTOPILOT],
    activeProperty: "active"
  },
  [MODE_NAMES.AUTORESEARCH]: {
    name: "Autoresearch",
    stateFile: MODE_STATE_FILE_MAP[MODE_NAMES.AUTORESEARCH],
    activeProperty: "active",
    hasGlobalState: false
  },
  [MODE_NAMES.TEAM]: {
    name: "Team",
    stateFile: MODE_STATE_FILE_MAP[MODE_NAMES.TEAM],
    activeProperty: "active",
    hasGlobalState: false
  },
  [MODE_NAMES.RALPH]: {
    name: "Ralph",
    stateFile: MODE_STATE_FILE_MAP[MODE_NAMES.RALPH],
    markerFile: "ralph-verification.json",
    activeProperty: "active",
    hasGlobalState: false
  },
  [MODE_NAMES.ULTRAWORK]: {
    name: "Ultrawork",
    stateFile: MODE_STATE_FILE_MAP[MODE_NAMES.ULTRAWORK],
    activeProperty: "active",
    hasGlobalState: false
  },
  [MODE_NAMES.ULTRAQA]: {
    name: "UltraQA",
    stateFile: MODE_STATE_FILE_MAP[MODE_NAMES.ULTRAQA],
    activeProperty: "active"
  },
  [MODE_NAMES.DEEP_INTERVIEW]: {
    name: "Deep Interview",
    stateFile: MODE_STATE_FILE_MAP[MODE_NAMES.DEEP_INTERVIEW],
    activeProperty: "active"
  },
  [MODE_NAMES.MERGE_READINESS]: {
    name: "Merge Readiness",
    stateFile: MODE_STATE_FILE_MAP[MODE_NAMES.MERGE_READINESS],
    activeProperty: "active"
  },
  [MODE_NAMES.SELF_IMPROVE]: {
    name: "Self Improve",
    stateFile: MODE_STATE_FILE_MAP[MODE_NAMES.SELF_IMPROVE],
    activeProperty: "active"
  }
};
var EXCLUSIVE_MODES = [MODE_NAMES.AUTOPILOT, MODE_NAMES.AUTORESEARCH];
var WORKFLOW_SLOT_TOMBSTONE_TTL_MS = 24 * 60 * 60 * 1e3;

// src/hooks/autopilot/pipeline.ts
var WORKFLOW_STAGE_SEQUENCES = [
  ["ralplan", "execution"],
  ["ralplan", "execution", "ralph"],
  ["ralplan", "execution", "qa"],
  ["ralplan", "execution", "ralph", "qa"]
];
function isWorkflowStageSequence(stages) {
  return WORKFLOW_STAGE_SEQUENCES.some(
    (sequence) => stages.length === sequence.length && stages.every((stage, index) => stage === sequence[index])
  );
}
var RESERVED_WORKFLOW_NAMES = /* @__PURE__ */ new Set([
  "autopilot",
  "ralplan",
  "execution",
  "ralph",
  "qa",
  "autoresearch",
  "ultraqa",
  "merge-readiness",
  "self-improve",
  "ultrawork",
  "ultragoal",
  "ultrapilot",
  "swarm",
  "pipeline",
  "plan",
  "team",
  "cancel",
  "deep-interview",
  "deepsearch",
  "ultrathink",
  "tdd",
  "code-review",
  "security-review",
  "analyze",
  "search",
  "default"
]);
function canonicalizeJson(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new TypeError("Canonical JSON requires finite numbers");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalizeJson).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalizeJson(record[key])}`).join(",")}}`;
  }
  throw new TypeError("Canonical JSON requires JSON-compatible values");
}
function normalizeWorkflowProfile(profile) {
  if (!profile || typeof profile !== "object" || Array.isArray(profile))
    return null;
  const record = profile;
  if (record.version !== 1 || !Array.isArray(record.stages)) return null;
  if (Object.keys(record).some((key) => key !== "version" && key !== "stages"))
    return null;
  const stages = record.stages;
  if (!stages.every((stage) => typeof stage === "string")) return null;
  if (!isWorkflowStageSequence(stages)) return null;
  return {
    version: 1,
    stages: [...stages]
  };
}
function createWorkflowDescriptor(workflowName, profile) {
  if (!/^[a-z][a-z0-9-]{0,62}$/.test(workflowName) || RESERVED_WORKFLOW_NAMES.has(workflowName))
    return null;
  const normalized = normalizeWorkflowProfile(profile);
  if (!normalized) return null;
  const canonical = canonicalizeJson({
    descriptorVersion: 1,
    workflowName,
    profileVersion: 1,
    stages: normalized.stages
  });
  return {
    descriptorVersion: 1,
    workflowName,
    profileVersion: 1,
    stages: normalized.stages,
    profileHash: createHash2("sha256").update(canonical).digest("hex")
  };
}
function verifyWorkflowDescriptor(descriptor) {
  if (!descriptor || typeof descriptor !== "object" || Array.isArray(descriptor))
    return false;
  const record = descriptor;
  const expectedKeys = [
    "descriptorVersion",
    "profileHash",
    "profileVersion",
    "stages",
    "workflowName"
  ];
  if (Object.keys(record).length !== expectedKeys.length || expectedKeys.some((key) => !(key in record)) || record.descriptorVersion !== 1 || typeof record.workflowName !== "string" || typeof record.profileHash !== "string") {
    return false;
  }
  const expected = createWorkflowDescriptor(record.workflowName, {
    version: record.profileVersion,
    stages: record.stages
  });
  return expected !== null && expected.profileHash === record.profileHash;
}

// src/hooks/autopilot/named-workflow-resume-validator.ts
var NAMED_SIGNALS = {
  ralplan: "PIPELINE_RALPLAN_COMPLETE",
  execution: "PIPELINE_EXECUTION_COMPLETE",
  ralph: "PIPELINE_RALPH_COMPLETE",
  qa: "PIPELINE_QA_COMPLETE"
};
var TRANSCRIPT_CHUNK_BYTES = 64 * 1024;
var MAX_JSONL_RECORD_BYTES = 8 * 1024 * 1024;
function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function exactKeys(value, keys) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
function safeInteger(value) {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}
function timestamp(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}
function validFileIdentity(value) {
  return isRecord(value) && exactKeys(value, [
    "device",
    "inode",
    "size",
    "mtimeNs",
    "ctimeNs",
    "contentSha256"
  ]) && safeInteger(value.device) && safeInteger(value.inode) && safeInteger(value.size) && typeof value.mtimeNs === "string" && /^\d+$/.test(value.mtimeNs) && typeof value.ctimeNs === "string" && /^\d+$/.test(value.ctimeNs) && typeof value.contentSha256 === "string" && /^[a-f0-9]{64}$/.test(value.contentSha256);
}
function validBoundaryShape(value, sessionId) {
  if (!isRecord(value) || !exactKeys(value, [
    "transcriptPath",
    "transcriptRoot",
    "transcriptBasename",
    "sessionId",
    "byteOffset",
    "fileIdentity"
  ]) || typeof sessionId !== "string" || value.sessionId !== sessionId || typeof value.transcriptRoot !== "string" || resolve2(value.transcriptRoot) !== value.transcriptRoot || typeof value.transcriptPath !== "string" || resolve2(value.transcriptPath) !== value.transcriptPath || basename5(value.transcriptPath) !== `${sessionId}.jsonl` || value.transcriptBasename !== `${sessionId}.jsonl` || !safeInteger(value.byteOffset) || !validFileIdentity(value.fileIdentity) || value.fileIdentity.size !== value.byteOffset)
    return false;
  const relativePath = relative2(value.transcriptRoot, value.transcriptPath);
  return relativePath.length > 0 && relativePath !== ".." && !relativePath.startsWith(`..${sep3}`);
}
function validateNamedWorkflowStateStructure(state, sessionId) {
  if (!Object.prototype.hasOwnProperty.call(state, "workflow") || !Object.prototype.hasOwnProperty.call(state, "workflowRunId") || !Object.prototype.hasOwnProperty.call(state, "pipelineTracking")) return null;
  const workflow = state.workflow;
  const tracking = state.pipelineTracking;
  const task = typeof state.prompt === "string" ? state.prompt.trim() : "";
  if (!verifyWorkflowDescriptor(workflow) || typeof sessionId !== "string" || typeof state.session_id !== "string" || state.session_id !== sessionId || !isRecord(tracking) || task.length === 0 || typeof state.active !== "boolean" || typeof state.workflowRunId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    state.workflowRunId
  ))
    return null;
  const terminal = state.phase === "complete";
  if (terminal && state.active) return null;
  const maximumStageIndex = terminal ? workflow.stages.length : workflow.stages.length - 1;
  if (!exactKeys(tracking, ["stages", "currentStageIndex", "trackingRevision", "activationBoundary", "completionObservations"]) || !Array.isArray(tracking.stages) || !Array.isArray(tracking.completionObservations) || !safeInteger(tracking.currentStageIndex) || !safeInteger(tracking.trackingRevision) || tracking.currentStageIndex > maximumStageIndex || tracking.trackingRevision !== tracking.currentStageIndex || tracking.completionObservations.length !== tracking.currentStageIndex || terminal && (tracking.currentStageIndex !== workflow.stages.length || tracking.trackingRevision !== workflow.stages.length || tracking.completionObservations.length !== workflow.stages.length) || !validBoundaryShape(tracking.activationBoundary, sessionId) || tracking.stages.length !== workflow.stages.length)
    return null;
  for (let index = 0; index < tracking.stages.length; index += 1) {
    const stage = tracking.stages[index];
    if (!isRecord(stage)) return null;
    const status = terminal ? "complete" : index < tracking.currentStageIndex ? "complete" : index === tracking.currentStageIndex ? "active" : "pending";
    const keys = status === "complete" ? ["id", "status", "iterations", "startedAt", "completedAt"] : status === "active" ? ["id", "status", "iterations", "startedAt"] : ["id", "status", "iterations"];
    if (!exactKeys(stage, keys) || stage.id !== workflow.stages[index] || stage.status !== status || !safeInteger(stage.iterations) || stage.startedAt !== void 0 && !timestamp(stage.startedAt) || stage.completedAt !== void 0 && !timestamp(stage.completedAt)) return null;
  }
  let previousObservation = null;
  for (let index = 0; index < tracking.completionObservations.length; index += 1) {
    const observation = tracking.completionObservations[index];
    if (!isRecord(observation) || !exactKeys(observation, ["stageId", "sessionId", "signalId", "lineNumber", "byteOffset", "recordContentSha256", "stableFile", "activationBoundary", "observedAt"]) || observation.stageId !== workflow.stages[index] || observation.sessionId !== sessionId || observation.signalId !== NAMED_SIGNALS[String(observation.stageId)] || !safeInteger(observation.lineNumber) || !safeInteger(observation.byteOffset) || typeof observation.recordContentSha256 !== "string" || !/^[a-f0-9]{64}$/.test(observation.recordContentSha256) || !validFileIdentity(observation.stableFile) || !validBoundaryShape(observation.activationBoundary, sessionId) || !timestamp(observation.observedAt)) return null;
    const boundary = observation.activationBoundary;
    const stable = observation.stableFile;
    if (Number(observation.byteOffset) < Number(boundary.byteOffset) || Number(stable.size) <= Number(observation.byteOffset)) return null;
    if (previousObservation) {
      const previousBoundary = previousObservation.activationBoundary;
      const previousStable = previousObservation.stableFile;
      if (boundary.transcriptPath !== previousBoundary.transcriptPath || boundary.byteOffset !== previousStable.size || JSON.stringify(boundary.fileIdentity) !== JSON.stringify(previousStable)) return null;
    }
    previousObservation = observation;
  }
  if (previousObservation) {
    const current = tracking.activationBoundary;
    const stable = previousObservation.stableFile;
    const boundary = previousObservation.activationBoundary;
    if (current.transcriptPath !== boundary.transcriptPath || current.byteOffset !== stable.size || JSON.stringify(current.fileIdentity) !== JSON.stringify(stable)) return null;
  }
  if (terminal ? state.phase !== "complete" : state.phase !== workflow.stages[tracking.currentStageIndex]) return null;
  return { tracking, task };
}

// src/hud/omc-state.ts
var MAX_STATE_AGE_MS = 2 * 60 * 60 * 1e3;
function isStateFileStale(filePath) {
  try {
    const stat = statSync3(filePath);
    const age = Date.now() - stat.mtimeMs;
    return age > MAX_STATE_AGE_MS;
  } catch {
    return true;
  }
}
function resolveStatePath2(directory, filename, sessionId) {
  const omcRoot = getOmcRoot(directory);
  if (sessionId) {
    const sessionPath = join9(omcRoot, "state", "sessions", sessionId, filename);
    return existsSync7(sessionPath) ? sessionPath : null;
  }
  let bestPath = null;
  let bestMtime = 0;
  const sessionsDir = join9(omcRoot, "state", "sessions");
  if (existsSync7(sessionsDir)) {
    try {
      const entries = readdirSync4(sessionsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const sessionFile = join9(sessionsDir, entry.name, filename);
        if (existsSync7(sessionFile)) {
          try {
            const mtime = statSync3(sessionFile).mtimeMs;
            if (mtime > bestMtime) {
              bestMtime = mtime;
              bestPath = sessionFile;
            }
          } catch {
          }
        }
      }
    } catch {
    }
  }
  const newPath = join9(omcRoot, "state", filename);
  if (existsSync7(newPath)) {
    try {
      const mtime = statSync3(newPath).mtimeMs;
      if (mtime > bestMtime) {
        bestMtime = mtime;
        bestPath = newPath;
      }
    } catch {
      if (!bestPath) bestPath = newPath;
    }
  }
  const legacyPath = join9(omcRoot, filename);
  if (existsSync7(legacyPath)) {
    try {
      const mtime = statSync3(legacyPath).mtimeMs;
      if (mtime > bestMtime) {
        bestPath = legacyPath;
      }
    } catch {
      if (!bestPath) bestPath = legacyPath;
    }
  }
  return bestPath;
}
function readRalphStateForHud(directory, sessionId) {
  const stateFile = resolveStatePath2(directory, "ralph-state.json", sessionId);
  if (!stateFile) {
    return null;
  }
  if (isStateFileStale(stateFile)) {
    return null;
  }
  try {
    const content = readFileSync8(stateFile, "utf-8");
    const state = JSON.parse(content);
    if (!state.active) {
      return null;
    }
    return {
      active: state.active,
      iteration: state.iteration,
      maxIterations: state.max_iterations,
      prdMode: state.prd_mode,
      currentStoryId: state.current_story_id
    };
  } catch {
    return null;
  }
}
function readUltraworkStateForHud(directory, sessionId) {
  const localFile = resolveStatePath2(directory, "ultrawork-state.json", sessionId);
  if (!localFile || isStateFileStale(localFile)) {
    return null;
  }
  try {
    const content = readFileSync8(localFile, "utf-8");
    const state = JSON.parse(content);
    if (!state.active) {
      return null;
    }
    return {
      active: state.active,
      reinforcementCount: state.reinforcement_count
    };
  } catch {
    return null;
  }
}
function readPrdStateForHud(directory) {
  let prdPath = join9(directory, "prd.json");
  if (!existsSync7(prdPath)) {
    prdPath = join9(getOmcRoot(directory), "prd.json");
    if (!existsSync7(prdPath)) {
      return null;
    }
  }
  try {
    const content = readFileSync8(prdPath, "utf-8");
    const prd = JSON.parse(content);
    if (!prd.userStories || !Array.isArray(prd.userStories)) {
      return null;
    }
    const stories = prd.userStories;
    const completed = stories.filter((s) => s.passes).length;
    const total = stories.length;
    const incomplete = stories.filter((s) => !s.passes).sort((a, b) => a.priority - b.priority);
    return {
      currentStoryId: incomplete[0]?.id || null,
      completed,
      total
    };
  } catch {
    return null;
  }
}
function hasNamedWorkflowMarker(state) {
  const record = state;
  return ["workflow", "workflowRunId", "pipelineTracking"].some((marker) => Object.prototype.hasOwnProperty.call(record, marker));
}
function getWorkflowHudState(state) {
  if (!hasNamedWorkflowMarker(state)) {
    return void 0;
  }
  const record = state;
  const sessionId = typeof record.session_id === "string" ? record.session_id : void 0;
  if (!sessionId || !validateNamedWorkflowStateStructure(state, sessionId)) {
    return { invalid: true };
  }
  const workflow = state.workflow;
  const pipelineTracking = state.pipelineTracking;
  const currentStageIndex = pipelineTracking.currentStageIndex;
  const currentStage = pipelineTracking.stages[currentStageIndex]?.id;
  return {
    name: workflow.workflowName,
    version: workflow.profileVersion,
    shortHash: workflow.profileHash.slice(0, 12),
    currentStage: currentStage ?? "complete",
    currentStageIndex: Math.min(currentStageIndex + 1, workflow.stages.length),
    stagesTotal: workflow.stages.length
  };
}
function readAutopilotStateForHud(directory, sessionId) {
  const stateFile = resolveStatePath2(directory, "autopilot-state.json", sessionId);
  if (!stateFile) {
    return null;
  }
  if (isStateFileStale(stateFile)) {
    return null;
  }
  try {
    const content = readFileSync8(stateFile, "utf-8");
    const state = JSON.parse(content);
    if (!state.active) {
      return null;
    }
    const phase = state.phase ?? state.current_phase;
    if (!phase) {
      return null;
    }
    return {
      active: state.active,
      phase,
      iteration: state.iteration,
      maxIterations: state.max_iterations,
      tasksCompleted: state.execution?.tasks_completed,
      tasksTotal: state.execution?.tasks_total,
      filesCreated: state.execution?.files_created?.length,
      workflow: getWorkflowHudState(state)
    };
  } catch {
    return null;
  }
}

// src/hud/usage-api.ts
import { existsSync as existsSync8, readFileSync as readFileSync9, writeFileSync as writeFileSync3, renameSync as renameSync3, unlinkSync as unlinkSync6, mkdirSync as mkdirSync6 } from "fs";
import { join as join10, dirname as dirname5 } from "path";
import { execFileSync as execFileSync3 } from "child_process";
import { createHash as createHash3 } from "crypto";
import { userInfo } from "os";
import https from "https";
var CACHE_TTL_FAILURE_MS = 15 * 1e3;
var CACHE_TTL_TRANSIENT_NETWORK_MS = 2 * 60 * 1e3;
var MAX_RATE_LIMITED_BACKOFF_MS = 5 * 60 * 1e3;
var API_TIMEOUT_MS = 1e4;
var MAX_STALE_DATA_MS = 15 * 60 * 1e3;
var TOKEN_REFRESH_URL_HOSTNAME = "platform.claude.com";
var USAGE_CACHE_LOCK_OPTS = { staleLockMs: API_TIMEOUT_MS + 5e3 };
var TOKEN_REFRESH_URL_PATH = "/v1/oauth/token";
var DEFAULT_OAUTH_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
function isEnterpriseUsageContext(options) {
  if (!options) return true;
  const subscriptionType = options.subscriptionType?.toLowerCase() ?? null;
  const rateLimitTier = options.rateLimitTier ?? null;
  if (subscriptionType == null && rateLimitTier == null) return true;
  return subscriptionType === "enterprise" || /claude_zero/i.test(rateLimitTier ?? "");
}
var ZAI_UNIT_WEEK = 6;
function isZaiHost(urlString) {
  try {
    const url = new URL(urlString);
    const hostname2 = url.hostname.toLowerCase();
    return hostname2 === "z.ai" || hostname2.endsWith(".z.ai");
  } catch {
    return false;
  }
}
function isMinimaxHost(urlString) {
  try {
    const url = new URL(urlString);
    const hostname2 = url.hostname.toLowerCase();
    return hostname2 === "minimax.io" || hostname2.endsWith(".minimax.io") || hostname2 === "minimaxi.com" || hostname2.endsWith(".minimaxi.com") || hostname2 === "minimax.com" || hostname2.endsWith(".minimax.com");
  } catch {
    return false;
  }
}
function getLegacyCachePath() {
  return join10(getClaudeConfigDir(), "plugins", "oh-my-claudecode", ".usage-cache.json");
}
function getCachePath(source) {
  return join10(getClaudeConfigDir(), "plugins", "oh-my-claudecode", `.usage-cache-${source}.json`);
}
function migrateLegacyCache(source) {
  try {
    const legacyPath = getLegacyCachePath();
    if (!existsSync8(legacyPath)) return;
    if (existsSync8(getCachePath(source))) return;
    const content = readFileSync9(legacyPath, "utf-8");
    const cache = JSON.parse(content);
    if (cache.source !== source) return;
    const newPath = getCachePath(source);
    const cacheDir = dirname5(newPath);
    if (!existsSync8(cacheDir)) {
      mkdirSync6(cacheDir, { recursive: true });
    }
    writeFileSync3(newPath, content);
  } catch {
  }
}
function readCache(source) {
  try {
    const cachePath = getCachePath(source);
    if (!existsSync8(cachePath)) return null;
    const content = readFileSync9(cachePath, "utf-8");
    const cache = JSON.parse(content);
    if (cache.data) {
      if (cache.data.fiveHourResetsAt) {
        cache.data.fiveHourResetsAt = new Date(cache.data.fiveHourResetsAt);
      }
      if (cache.data.weeklyResetsAt) {
        cache.data.weeklyResetsAt = new Date(cache.data.weeklyResetsAt);
      }
      if (cache.data.sonnetWeeklyResetsAt) {
        cache.data.sonnetWeeklyResetsAt = new Date(cache.data.sonnetWeeklyResetsAt);
      }
      if (cache.data.opusWeeklyResetsAt) {
        cache.data.opusWeeklyResetsAt = new Date(cache.data.opusWeeklyResetsAt);
      }
      if (cache.data.monthlyResetsAt) {
        cache.data.monthlyResetsAt = new Date(cache.data.monthlyResetsAt);
      }
      if (cache.data.extraUsageResetsAt) {
        cache.data.extraUsageResetsAt = new Date(cache.data.extraUsageResetsAt);
      }
    }
    return cache;
  } catch {
    return null;
  }
}
function writeCache(opts) {
  try {
    const cachePath = getCachePath(opts.source);
    const cacheDir = dirname5(cachePath);
    if (!existsSync8(cacheDir)) {
      mkdirSync6(cacheDir, { recursive: true });
    }
    const cache = {
      timestamp: Date.now(),
      data: opts.data,
      error: opts.error,
      errorReason: opts.errorReason,
      source: opts.source,
      rateLimited: opts.rateLimited || void 0,
      rateLimitedCount: opts.rateLimitedCount && opts.rateLimitedCount > 0 ? opts.rateLimitedCount : void 0,
      rateLimitedUntil: opts.rateLimitedUntil,
      lastSuccessAt: opts.lastSuccessAt
    };
    writeFileSync3(cachePath, JSON.stringify(cache, null, 2));
  } catch {
  }
}
function sanitizePollIntervalMs(value) {
  if (value == null || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_HUD_USAGE_POLL_INTERVAL_MS;
  }
  return Math.max(1e3, Math.floor(value));
}
function getUsagePollIntervalMs() {
  try {
    return sanitizePollIntervalMs(readHudConfig().usageApiPollIntervalMs);
  } catch {
    return DEFAULT_HUD_USAGE_POLL_INTERVAL_MS;
  }
}
function getRateLimitedBackoffMs(pollIntervalMs, count) {
  const normalizedPollIntervalMs = sanitizePollIntervalMs(pollIntervalMs);
  return Math.min(
    normalizedPollIntervalMs * Math.pow(2, Math.max(0, count - 1)),
    MAX_RATE_LIMITED_BACKOFF_MS
  );
}
function getTransientNetworkBackoffMs(pollIntervalMs) {
  return Math.max(CACHE_TTL_TRANSIENT_NETWORK_MS, sanitizePollIntervalMs(pollIntervalMs));
}
function isCacheValid(cache, pollIntervalMs) {
  if (cache.rateLimited) {
    if (cache.rateLimitedUntil != null) {
      return Date.now() < cache.rateLimitedUntil;
    }
    const count = cache.rateLimitedCount || 1;
    return Date.now() - cache.timestamp < getRateLimitedBackoffMs(pollIntervalMs, count);
  }
  const ttl = cache.error ? cache.errorReason === "network" ? getTransientNetworkBackoffMs(pollIntervalMs) : CACHE_TTL_FAILURE_MS : sanitizePollIntervalMs(pollIntervalMs);
  return Date.now() - cache.timestamp < ttl;
}
function hasUsableStaleData(cache) {
  if (!cache?.data) {
    return false;
  }
  if (cache.lastSuccessAt && Date.now() - cache.lastSuccessAt > MAX_STALE_DATA_MS) {
    return false;
  }
  return true;
}
function getCachedUsageResult(cache) {
  if (cache.rateLimited) {
    if (!hasUsableStaleData(cache) && cache.data) {
      return { rateLimits: null, error: "rate_limited" };
    }
    return { rateLimits: cache.data, error: "rate_limited", stale: cache.data ? true : void 0 };
  }
  if (cache.error) {
    const errorReason = cache.errorReason || "network";
    if (hasUsableStaleData(cache)) {
      return { rateLimits: cache.data, error: errorReason, stale: true };
    }
    return { rateLimits: null, error: errorReason };
  }
  return { rateLimits: cache.data };
}
function createRateLimitedCacheEntry(source, data, pollIntervalMs, previousCount, lastSuccessAt) {
  const timestamp2 = Date.now();
  const rateLimitedCount = previousCount + 1;
  return {
    timestamp: timestamp2,
    data,
    error: false,
    errorReason: "rate_limited",
    source,
    rateLimited: true,
    rateLimitedCount,
    rateLimitedUntil: timestamp2 + getRateLimitedBackoffMs(pollIntervalMs, rateLimitedCount),
    lastSuccessAt
  };
}
function getKeychainServiceName() {
  const configDir = process.env.CLAUDE_CONFIG_DIR;
  if (configDir) {
    const hash = createHash3("sha256").update(configDir).digest("hex").slice(0, 8);
    return `Claude Code-credentials-${hash}`;
  }
  return "Claude Code-credentials";
}
function isCredentialExpired(creds) {
  return creds.expiresAt != null && creds.expiresAt <= Date.now();
}
function readKeychainCredential(serviceName, account) {
  try {
    const args = account ? ["find-generic-password", "-s", serviceName, "-a", account, "-w"] : ["find-generic-password", "-s", serviceName, "-w"];
    const result = execFileSync3("/usr/bin/security", args, {
      encoding: "utf-8",
      timeout: 2e3,
      stdio: ["pipe", "pipe", "pipe"]
    }).trim();
    if (!result) return null;
    const parsed = JSON.parse(result);
    const creds = parsed.claudeAiOauth || parsed;
    if (!creds.accessToken) return null;
    return {
      accessToken: creds.accessToken,
      expiresAt: creds.expiresAt,
      refreshToken: creds.refreshToken,
      source: "keychain",
      keychainAccount: account ?? null,
      subscriptionType: creds.subscriptionType,
      rateLimitTier: creds.rateLimitTier
    };
  } catch {
    return null;
  }
}
function readKeychainCredentials() {
  if (process.platform !== "darwin") return null;
  const serviceName = getKeychainServiceName();
  const candidateAccounts = [];
  try {
    const username = userInfo().username?.trim();
    if (username) {
      candidateAccounts.push(username);
    }
  } catch {
  }
  candidateAccounts.push(void 0);
  let expiredFallback = null;
  for (const account of candidateAccounts) {
    const creds = readKeychainCredential(serviceName, account);
    if (!creds) continue;
    if (!isCredentialExpired(creds)) {
      return creds;
    }
    expiredFallback ??= creds;
  }
  return expiredFallback;
}
function readFileCredentials() {
  try {
    const credPath = join10(getClaudeConfigDir(), ".credentials.json");
    if (!existsSync8(credPath)) return null;
    const content = readFileSync9(credPath, "utf-8");
    const parsed = JSON.parse(content);
    const creds = parsed.claudeAiOauth || parsed;
    if (creds.accessToken) {
      return {
        accessToken: creds.accessToken,
        expiresAt: creds.expiresAt,
        refreshToken: creds.refreshToken,
        source: "file",
        subscriptionType: creds.subscriptionType,
        rateLimitTier: creds.rateLimitTier
      };
    }
  } catch {
  }
  return null;
}
function getCredentials() {
  const keychainCreds = readKeychainCredentials();
  if (keychainCreds) return keychainCreds;
  return readFileCredentials();
}
function getSubscriptionInfo() {
  try {
    const creds = getCredentials();
    return {
      subscriptionType: creds?.subscriptionType ?? null,
      rateLimitTier: creds?.rateLimitTier ?? null
    };
  } catch {
    return { subscriptionType: null, rateLimitTier: null };
  }
}
function validateCredentials(creds) {
  if (!creds.accessToken) return false;
  return !isCredentialExpired(creds);
}
function refreshAccessToken(refreshToken) {
  return new Promise((resolve6) => {
    const clientId = process.env.CLAUDE_CODE_OAUTH_CLIENT_ID || DEFAULT_OAUTH_CLIENT_ID;
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId
    }).toString();
    const req = https.request(
      {
        hostname: TOKEN_REFRESH_URL_HOSTNAME,
        path: TOKEN_REFRESH_URL_PATH,
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(body)
        },
        timeout: API_TIMEOUT_MS
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          if (res.statusCode === 200) {
            try {
              const parsed = JSON.parse(data);
              if (parsed.access_token) {
                resolve6({
                  accessToken: parsed.access_token,
                  refreshToken: parsed.refresh_token || refreshToken,
                  expiresAt: parsed.expires_in ? Date.now() + parsed.expires_in * 1e3 : parsed.expires_at
                });
                return;
              }
            } catch {
            }
          }
          if (process.env.OMC_DEBUG) {
            console.error(`[usage-api] Token refresh failed: HTTP ${res.statusCode}`);
          }
          resolve6(null);
        });
      }
    );
    req.on("error", () => resolve6(null));
    req.on("timeout", () => {
      req.destroy();
      resolve6(null);
    });
    req.end(body);
  });
}
function fetchUsageFromApi(accessToken) {
  return new Promise((resolve6) => {
    const req = https.request(
      {
        hostname: "api.anthropic.com",
        path: "/api/oauth/usage",
        method: "GET",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "anthropic-beta": "oauth-2025-04-20",
          "Content-Type": "application/json"
        },
        timeout: API_TIMEOUT_MS
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          if (res.statusCode === 200) {
            try {
              resolve6({ data: JSON.parse(data) });
            } catch {
              resolve6({ data: null });
            }
          } else if (res.statusCode === 429) {
            if (process.env.OMC_DEBUG) {
              console.error(`[usage-api] Anthropic API returned 429 (rate limited)`);
            }
            resolve6({ data: null, rateLimited: true });
          } else {
            resolve6({ data: null });
          }
        });
      }
    );
    req.on("error", () => resolve6({ data: null }));
    req.on("timeout", () => {
      req.destroy();
      resolve6({ data: null });
    });
    req.end();
  });
}
function fetchUsageFromZai() {
  return new Promise((resolve6) => {
    const baseUrl = process.env.ANTHROPIC_BASE_URL;
    const authToken = process.env.ANTHROPIC_AUTH_TOKEN;
    if (!baseUrl || !authToken) {
      resolve6({ data: null });
      return;
    }
    const validation = validateAnthropicBaseUrl(baseUrl);
    if (!validation.allowed) {
      console.error(`[SSRF Guard] Blocking usage API call: ${validation.reason}`);
      resolve6({ data: null });
      return;
    }
    try {
      const url = new URL(baseUrl);
      const baseDomain = `${url.protocol}//${url.host}`;
      const quotaLimitUrl = `${baseDomain}/api/monitor/usage/quota/limit`;
      const urlObj = new URL(quotaLimitUrl);
      const req = https.request(
        {
          hostname: urlObj.hostname,
          path: urlObj.pathname,
          method: "GET",
          headers: {
            "Authorization": authToken,
            "Content-Type": "application/json",
            "Accept-Language": "en-US,en"
          },
          timeout: API_TIMEOUT_MS
        },
        (res) => {
          let data = "";
          res.on("data", (chunk) => {
            data += chunk;
          });
          res.on("end", () => {
            if (res.statusCode === 200) {
              try {
                resolve6({ data: JSON.parse(data) });
              } catch {
                resolve6({ data: null });
              }
            } else if (res.statusCode === 429) {
              if (process.env.OMC_DEBUG) {
                console.error(`[usage-api] z.ai API returned 429 (rate limited)`);
              }
              resolve6({ data: null, rateLimited: true });
            } else {
              resolve6({ data: null });
            }
          });
        }
      );
      req.on("error", () => resolve6({ data: null }));
      req.on("timeout", () => {
        req.destroy();
        resolve6({ data: null });
      });
      req.end();
    } catch {
      resolve6({ data: null });
    }
  });
}
function writeKeychainCredentials(creds) {
  if (process.platform !== "darwin") return;
  try {
    const serviceName = getKeychainServiceName();
    const account = creds.keychainAccount ?? void 0;
    const readArgs = account ? ["find-generic-password", "-s", serviceName, "-a", account, "-w"] : ["find-generic-password", "-s", serviceName, "-w"];
    let existing = {};
    try {
      const raw = execFileSync3("/usr/bin/security", readArgs, {
        encoding: "utf-8",
        timeout: 2e3,
        stdio: ["pipe", "pipe", "pipe"]
      }).trim();
      if (raw) existing = JSON.parse(raw);
    } catch {
    }
    if (existing.claudeAiOauth && typeof existing.claudeAiOauth === "object") {
      const inner = existing.claudeAiOauth;
      inner.accessToken = creds.accessToken;
      if (creds.expiresAt != null) inner.expiresAt = creds.expiresAt;
      if (creds.refreshToken) inner.refreshToken = creds.refreshToken;
    } else {
      existing.accessToken = creds.accessToken;
      if (creds.expiresAt != null) existing.expiresAt = creds.expiresAt;
      if (creds.refreshToken) existing.refreshToken = creds.refreshToken;
    }
    const newJson = JSON.stringify(existing);
    const writeArgs = account ? ["add-generic-password", "-s", serviceName, "-a", account, "-w", newJson, "-U"] : ["add-generic-password", "-s", serviceName, "-w", newJson, "-U"];
    execFileSync3("/usr/bin/security", writeArgs, {
      encoding: "utf-8",
      timeout: 2e3,
      stdio: ["pipe", "pipe", "pipe"]
    });
  } catch {
    if (process.env.OMC_DEBUG) {
      console.error("[usage-api] Failed to write back refreshed credentials to Keychain");
    }
  }
}
function writeBackCredentials(creds) {
  if (creds.source === "keychain") {
    writeKeychainCredentials(creds);
    return;
  }
  try {
    const credPath = join10(getClaudeConfigDir(), ".credentials.json");
    if (!existsSync8(credPath)) return;
    const content = readFileSync9(credPath, "utf-8");
    const parsed = JSON.parse(content);
    if (parsed.claudeAiOauth) {
      parsed.claudeAiOauth.accessToken = creds.accessToken;
      if (creds.expiresAt != null) {
        parsed.claudeAiOauth.expiresAt = creds.expiresAt;
      }
      if (creds.refreshToken) {
        parsed.claudeAiOauth.refreshToken = creds.refreshToken;
      }
    } else {
      parsed.accessToken = creds.accessToken;
      if (creds.expiresAt != null) {
        parsed.expiresAt = creds.expiresAt;
      }
      if (creds.refreshToken) {
        parsed.refreshToken = creds.refreshToken;
      }
    }
    const tmpPath = `${credPath}.tmp.${process.pid}`;
    try {
      writeFileSync3(tmpPath, JSON.stringify(parsed, null, 2), { mode: 384 });
      renameSync3(tmpPath, credPath);
    } catch (writeErr) {
      try {
        if (existsSync8(tmpPath)) {
          unlinkSync6(tmpPath);
        }
      } catch {
      }
      throw writeErr;
    }
  } catch {
    if (process.env.OMC_DEBUG) {
      console.error("[usage-api] Failed to write back refreshed credentials");
    }
  }
}
function clamp(v) {
  if (v == null || !isFinite(v)) return 0;
  return Math.max(0, Math.min(100, v));
}
function minorUnitDecimals(currency, decimalPlaces) {
  if (decimalPlaces != null && Number.isInteger(decimalPlaces) && decimalPlaces >= 0 && decimalPlaces <= 4) {
    return decimalPlaces;
  }
  if (currency === "USD") return 2;
  return null;
}
function parseUsageResponse(response, options) {
  const fiveHour = response.five_hour?.utilization;
  const sevenDay = response.seven_day?.utilization;
  const sonnetSevenDay = response.seven_day_sonnet?.utilization;
  const opusSevenDay = response.seven_day_opus?.utilization;
  const extra = response.extra_usage;
  const usedCredits = extra?.used_credits;
  const extraCurrency = (extra?.currency ?? "USD").toUpperCase();
  const minorDecimals = minorUnitDecimals(extraCurrency, extra?.decimal_places);
  const minorDivisor = minorDecimals == null ? null : 10 ** minorDecimals;
  const isEnterpriseContext = isEnterpriseUsageContext(options);
  const hasUsableEnterprise = isEnterpriseContext && usedCredits != null && minorDivisor != null;
  const hasUsableUsdExtraUsage = extra?.limit_usd != null && extra.limit_usd > 0;
  const hasUsableCreditExtraUsage = !isEnterpriseContext && usedCredits != null && extraCurrency === "USD" && extra?.monthly_limit != null && extra.monthly_limit > 0;
  const hasUsableExtraUsage = hasUsableUsdExtraUsage || hasUsableCreditExtraUsage;
  if (fiveHour == null && sevenDay == null && sonnetSevenDay == null && opusSevenDay == null && !hasUsableEnterprise && !hasUsableExtraUsage) return null;
  const parseDate = (dateStr) => {
    if (!dateStr) return null;
    try {
      const date = new Date(dateStr);
      return isNaN(date.getTime()) ? null : date;
    } catch {
      return null;
    }
  };
  const sonnetResetsAt = response.seven_day_sonnet?.resets_at;
  const result = {
    fiveHourPercent: clamp(fiveHour),
    fiveHourResetsAt: parseDate(response.five_hour?.resets_at)
  };
  if (sevenDay != null) {
    result.weeklyPercent = clamp(sevenDay);
    result.weeklyResetsAt = parseDate(response.seven_day?.resets_at);
  }
  if (sonnetSevenDay != null) {
    result.sonnetWeeklyPercent = clamp(sonnetSevenDay);
    result.sonnetWeeklyResetsAt = parseDate(sonnetResetsAt);
  }
  const opusResetsAt = response.seven_day_opus?.resets_at;
  if (opusSevenDay != null) {
    result.opusWeeklyPercent = clamp(opusSevenDay);
    result.opusWeeklyResetsAt = parseDate(opusResetsAt);
  }
  if (extra != null) {
    const currency = extraCurrency;
    if (extra.used_credits != null && minorDivisor != null && isEnterpriseContext) {
      result.enterpriseSpentUsd = extra.used_credits / minorDivisor;
      result.enterpriseLimitUsd = extra.monthly_limit == null ? null : extra.monthly_limit / minorDivisor;
      result.enterpriseCurrency = currency;
      if (minorDecimals != null) result.enterpriseDecimalPlaces = minorDecimals;
      if (extra.monthly_limit != null && extra.monthly_limit > 0) {
        result.enterpriseUtilization = clamp(extra.used_credits / extra.monthly_limit * 100);
      }
    } else if (extra.used_credits != null && currency === "USD" && !isEnterpriseContext && extra.monthly_limit != null && extra.monthly_limit > 0) {
      const spentUsd = extra.used_credits / 100;
      result.extraUsageSpentUsd = spentUsd;
      result.extraUsageLimitUsd = extra.monthly_limit / 100;
      result.extraUsagePercent = extra.utilization != null ? clamp(extra.utilization) : clamp(extra.used_credits / extra.monthly_limit * 100);
      result.extraUsageResetsAt = parseDate(extra.resets_at);
    } else if (extra.limit_usd != null && extra.limit_usd > 0) {
      const spentUsd = extra.spent_usd ?? 0;
      result.extraUsageSpentUsd = spentUsd;
      result.extraUsageLimitUsd = extra.limit_usd;
      result.extraUsagePercent = extra.utilization != null ? clamp(extra.utilization) : clamp(spentUsd / extra.limit_usd * 100);
      result.extraUsageResetsAt = parseDate(extra.resets_at);
    }
  }
  return result;
}
function parseZaiResponse(response) {
  const limits = response.data?.limits;
  if (!limits || limits.length === 0) return null;
  const allTokensLimits = limits.filter((l) => l.type === "TOKENS_LIMIT");
  const timeLimit = limits.find((l) => l.type === "TIME_LIMIT");
  if (allTokensLimits.length === 0 && !timeLimit) return null;
  const parseResetTime = (timestamp2) => {
    if (!timestamp2) return null;
    try {
      const date = new Date(timestamp2);
      return isNaN(date.getTime()) ? null : date;
    } catch {
      return null;
    }
  };
  const sortByResetTime = (a, b) => {
    const aTime = a.nextResetTime && a.nextResetTime > 0 ? a.nextResetTime : Infinity;
    const bTime = b.nextResetTime && b.nextResetTime > 0 ? b.nextResetTime : Infinity;
    if (aTime !== bTime) return aTime - bTime;
    return (a.percentage ?? 0) - (b.percentage ?? 0);
  };
  const weeklyByUnit = allTokensLimits.find((l) => l.unit === ZAI_UNIT_WEEK);
  let fiveHourBucket;
  let weeklyBucket;
  if (weeklyByUnit) {
    weeklyBucket = weeklyByUnit;
    fiveHourBucket = allTokensLimits.filter((l) => l.unit !== ZAI_UNIT_WEEK).slice().sort(sortByResetTime)[0];
  } else {
    const sorted = allTokensLimits.slice().sort(sortByResetTime);
    fiveHourBucket = sorted[0];
    weeklyBucket = sorted[1];
  }
  if (allTokensLimits.length > 2 && process.env.OMC_DEBUG) {
    console.error(
      `[usage-api] z.ai returned ${allTokensLimits.length} TOKENS_LIMIT entries; using unit-based classification`
    );
  }
  const result = {
    fiveHourPercent: clamp(fiveHourBucket?.percentage),
    fiveHourResetsAt: parseResetTime(fiveHourBucket?.nextResetTime),
    monthlyPercent: timeLimit ? clamp(timeLimit.percentage) : void 0,
    monthlyResetsAt: timeLimit ? parseResetTime(timeLimit.nextResetTime) ?? null : void 0
  };
  if (weeklyBucket) {
    result.weeklyPercent = clamp(weeklyBucket.percentage);
    result.weeklyResetsAt = parseResetTime(weeklyBucket.nextResetTime);
  }
  return result;
}
function fetchUsageFromMinimax(apiKey) {
  return new Promise((resolve6) => {
    const baseUrl = process.env.ANTHROPIC_BASE_URL;
    if (!baseUrl) {
      resolve6({ data: null });
      return;
    }
    const validation = validateAnthropicBaseUrl(baseUrl);
    if (!validation.allowed) {
      console.error(`[SSRF Guard] Blocking usage API call: ${validation.reason}`);
      resolve6({ data: null });
      return;
    }
    try {
      const url = new URL(baseUrl);
      const baseDomain = `${url.protocol}//${url.host}`;
      const quotaUrl = `${baseDomain}/v1/api/openplatform/coding_plan/remains`;
      const urlObj = new URL(quotaUrl);
      const req = https.request(
        {
          hostname: urlObj.hostname,
          path: urlObj.pathname,
          method: "GET",
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json"
          },
          timeout: API_TIMEOUT_MS
        },
        (res) => {
          let data = "";
          res.on("data", (chunk) => {
            data += chunk;
          });
          res.on("end", () => {
            if (res.statusCode === 200) {
              try {
                resolve6({ data: JSON.parse(data) });
              } catch {
                resolve6({ data: null });
              }
            } else if (res.statusCode === 429) {
              if (process.env.OMC_DEBUG) {
                console.error(`[usage-api] MiniMax API returned 429 (rate limited)`);
              }
              resolve6({ data: null, rateLimited: true });
            } else {
              resolve6({ data: null });
            }
          });
        }
      );
      req.on("error", () => resolve6({ data: null }));
      req.on("timeout", () => {
        req.destroy();
        resolve6({ data: null });
      });
      req.end();
    } catch {
      resolve6({ data: null });
    }
  });
}
function parseMinimaxResponse(response) {
  if (response.base_resp?.status_code != null && response.base_resp.status_code !== 0) {
    return null;
  }
  const models = response.model_remains;
  if (!models || models.length === 0) return null;
  const codingModel = models.find((m) => m.model_name.toLowerCase().startsWith("minimax-m"));
  if (!codingModel) {
    if (process.env.OMC_DEBUG) {
      console.error("[usage-api] No MiniMax-M* model found in coding plan response");
    }
    return null;
  }
  const intervalTotal = codingModel.current_interval_total_count;
  const intervalUsed = intervalTotal - codingModel.current_interval_usage_count;
  const intervalPercent = intervalTotal > 0 ? intervalUsed / intervalTotal * 100 : 0;
  const weeklyTotal = codingModel.current_weekly_total_count;
  const weeklyUsed = weeklyTotal - codingModel.current_weekly_usage_count;
  const weeklyPercent = weeklyTotal > 0 ? weeklyUsed / weeklyTotal * 100 : 0;
  const parseResetTime = (timestamp2) => {
    if (!timestamp2) return null;
    try {
      const date = new Date(timestamp2);
      return isNaN(date.getTime()) ? null : date;
    } catch {
      return null;
    }
  };
  return {
    fiveHourPercent: clamp(intervalPercent),
    fiveHourResetsAt: parseResetTime(codingModel.end_time),
    weeklyPercent: clamp(weeklyPercent),
    weeklyResetsAt: parseResetTime(codingModel.weekly_end_time)
  };
}
async function fetchAndCacheUsage(opts) {
  const { source, fetchFn, parseFn, cache, pollIntervalMs } = opts;
  const result = await fetchFn();
  if (result.rateLimited) {
    const prevLastSuccess = cache?.lastSuccessAt;
    const rateLimitedCache = createRateLimitedCacheEntry(source, cache?.data || null, pollIntervalMs, cache?.rateLimitedCount || 0, prevLastSuccess);
    writeCache({
      data: rateLimitedCache.data,
      error: rateLimitedCache.error,
      source,
      rateLimited: true,
      rateLimitedCount: rateLimitedCache.rateLimitedCount,
      rateLimitedUntil: rateLimitedCache.rateLimitedUntil,
      errorReason: "rate_limited",
      lastSuccessAt: rateLimitedCache.lastSuccessAt
    });
    if (rateLimitedCache.data) {
      if (prevLastSuccess && Date.now() - prevLastSuccess > MAX_STALE_DATA_MS) {
        return { rateLimits: null, error: "rate_limited" };
      }
      return { rateLimits: rateLimitedCache.data, error: "rate_limited", stale: true };
    }
    return { rateLimits: null, error: "rate_limited" };
  }
  if (!result.data) {
    const fallbackData = hasUsableStaleData(cache) ? cache.data : null;
    writeCache({
      data: fallbackData,
      error: true,
      source,
      errorReason: "network",
      lastSuccessAt: cache?.lastSuccessAt
    });
    if (fallbackData) {
      return { rateLimits: fallbackData, error: "network", stale: true };
    }
    return { rateLimits: null, error: "network" };
  }
  const usage = parseFn(result.data);
  writeCache({ data: usage, error: !usage, source, lastSuccessAt: Date.now() });
  return { rateLimits: usage };
}
async function getUsage() {
  const baseUrl = process.env.ANTHROPIC_BASE_URL;
  const authToken = process.env.ANTHROPIC_AUTH_TOKEN;
  const isMinimax = baseUrl != null && isMinimaxHost(baseUrl);
  const isZai = baseUrl != null && isZaiHost(baseUrl);
  const minimaxApiKey = process.env.MINIMAX_API_KEY || authToken;
  const currentSource = isMinimax ? "minimax" : isZai && authToken ? "zai" : "anthropic";
  const pollIntervalMs = getUsagePollIntervalMs();
  migrateLegacyCache(currentSource);
  const initialCache = readCache(currentSource);
  if (initialCache && isCacheValid(initialCache, pollIntervalMs) && initialCache.source === currentSource) {
    return getCachedUsageResult(initialCache);
  }
  try {
    return await withFileLock(lockPathFor(getCachePath(currentSource)), async () => {
      const cache = readCache(currentSource);
      if (cache && isCacheValid(cache, pollIntervalMs) && cache.source === currentSource) {
        return getCachedUsageResult(cache);
      }
      if (isMinimax) {
        if (!minimaxApiKey) {
          writeCache({ data: null, error: true, source: "minimax", errorReason: "no_credentials" });
          return { rateLimits: null, error: "no_credentials" };
        }
        return fetchAndCacheUsage({
          source: "minimax",
          fetchFn: () => fetchUsageFromMinimax(minimaxApiKey),
          parseFn: parseMinimaxResponse,
          cache,
          pollIntervalMs
        });
      }
      if (isZai && authToken) {
        return fetchAndCacheUsage({
          source: "zai",
          fetchFn: () => fetchUsageFromZai(),
          parseFn: parseZaiResponse,
          cache,
          pollIntervalMs
        });
      }
      let creds = getCredentials();
      if (creds) {
        if (!validateCredentials(creds)) {
          if (creds.refreshToken) {
            const refreshed = await refreshAccessToken(creds.refreshToken);
            if (refreshed) {
              creds = { ...creds, ...refreshed };
              writeBackCredentials(creds);
            } else {
              writeCache({ data: null, error: true, source: "anthropic", errorReason: "auth" });
              return { rateLimits: null, error: "auth" };
            }
          } else {
            writeCache({ data: null, error: true, source: "anthropic", errorReason: "auth" });
            return { rateLimits: null, error: "auth" };
          }
        }
        const accessToken = creds.accessToken;
        const subscriptionType = creds.subscriptionType;
        const rateLimitTier = creds.rateLimitTier;
        return fetchAndCacheUsage({
          source: "anthropic",
          fetchFn: () => fetchUsageFromApi(accessToken),
          parseFn: (data) => parseUsageResponse(data, {
            subscriptionType,
            rateLimitTier
          }),
          cache,
          pollIntervalMs
        });
      }
      writeCache({ data: null, error: true, source: "anthropic", errorReason: "no_credentials" });
      return { rateLimits: null, error: "no_credentials" };
    }, USAGE_CACHE_LOCK_OPTS);
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Failed to acquire file lock")) {
      if (initialCache?.data) {
        return { rateLimits: initialCache.data, stale: true };
      }
      return { rateLimits: null, error: "network" };
    }
    return { rateLimits: null, error: "network" };
  }
}

// src/hud/custom-rate-provider.ts
import { spawn } from "child_process";
import { existsSync as existsSync9, readFileSync as readFileSync10, writeFileSync as writeFileSync4, mkdirSync as mkdirSync7 } from "fs";
import { join as join11, dirname as dirname6 } from "path";
var CACHE_TTL_MS = 3e4;
var DEFAULT_TIMEOUT_MS = 800;
function getCachePath2() {
  return join11(
    getClaudeConfigDir(),
    "plugins",
    "oh-my-claudecode",
    ".custom-rate-cache.json"
  );
}
function readCache2() {
  try {
    const p = getCachePath2();
    if (!existsSync9(p)) return null;
    return JSON.parse(readFileSync10(p, "utf-8"));
  } catch {
    return null;
  }
}
function writeCache2(buckets) {
  try {
    const p = getCachePath2();
    const dir = dirname6(p);
    if (!existsSync9(dir)) mkdirSync7(dir, { recursive: true });
    const cache = { timestamp: Date.now(), buckets };
    writeFileSync4(p, JSON.stringify(cache, null, 2));
  } catch {
  }
}
function isCacheValid2(cache) {
  return Date.now() - cache.timestamp < CACHE_TTL_MS;
}
function spawnWithTimeout(cmd, timeoutMs) {
  return new Promise((resolve6, reject) => {
    const [executable, ...args] = Array.isArray(cmd) ? cmd : ["sh", "-c", cmd];
    const child = spawn(executable, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
        }
      }, 200);
      reject(new Error(`Custom rate limit command timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (!timedOut) {
        if (code === 0) {
          resolve6(stdout);
        } else {
          reject(new Error(`Command exited with code ${code}`));
        }
      }
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      if (!timedOut) reject(err);
    });
  });
}
function parseOutput(raw, periods) {
  let parsed;
  try {
    parsed = JSON.parse(raw.trim());
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || parsed.version !== 1 || !Array.isArray(parsed.buckets)) {
    return null;
  }
  const buckets = parsed.buckets.filter((b) => {
    if (typeof b.id !== "string" || typeof b.label !== "string") return false;
    if (!b.usage || typeof b.usage.type !== "string") return false;
    const u = b.usage;
    if (u.type === "percent") return typeof u.value === "number";
    if (u.type === "credit") {
      return typeof u.used === "number" && typeof u.limit === "number";
    }
    if (u.type === "string") return typeof u.value === "string";
    return false;
  });
  if (periods && periods.length > 0) {
    return buckets.filter((b) => periods.includes(b.id));
  }
  return buckets;
}
async function executeCustomProvider(config) {
  const cache = readCache2();
  if (cache && isCacheValid2(cache)) {
    return { buckets: cache.buckets, stale: false };
  }
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  try {
    const stdout = await spawnWithTimeout(config.command, timeoutMs);
    const buckets = parseOutput(stdout, config.periods);
    if (buckets === null) {
      if (process.env.OMC_DEBUG) {
        console.error("[custom-rate-provider] Invalid output format from command");
      }
      if (cache) return { buckets: cache.buckets, stale: true };
      return { buckets: [], stale: false, error: "invalid output" };
    }
    writeCache2(buckets);
    return { buckets, stale: false };
  } catch (err) {
    if (process.env.OMC_DEBUG) {
      console.error(
        "[custom-rate-provider] Command failed:",
        err instanceof Error ? err.message : err
      );
    }
    if (cache) return { buckets: cache.buckets, stale: true };
    return { buckets: [], stale: false, error: "command failed" };
  }
}

// src/hud/colors.ts
var RESET = "\x1B[0m";
var DIM = "\x1B[2m";
var BOLD = "\x1B[1m";
var RED = "\x1B[31m";
var GREEN = "\x1B[32m";
var YELLOW = "\x1B[33m";
var MAGENTA = "\x1B[35m";
var CYAN = "\x1B[36m";
function green(text) {
  return `${GREEN}${text}${RESET}`;
}
function yellow(text) {
  return `${YELLOW}${text}${RESET}`;
}
function red(text) {
  return `${RED}${text}${RESET}`;
}
function cyan(text) {
  return `${CYAN}${text}${RESET}`;
}
function dim(text) {
  return `${DIM}${text}${RESET}`;
}
function bold(text) {
  return `${BOLD}${text}${RESET}`;
}
function getModelTierColor(model) {
  if (!model) return CYAN;
  const tier = model.toLowerCase();
  if (tier.includes("opus")) return MAGENTA;
  if (tier.includes("sonnet")) return YELLOW;
  if (tier.includes("haiku")) return GREEN;
  return CYAN;
}
function getDurationColor(durationMs) {
  const minutes = durationMs / 6e4;
  if (minutes >= 5) return RED;
  if (minutes >= 2) return YELLOW;
  return GREEN;
}

// src/lib/version.ts
import { readFileSync as readFileSync11, existsSync as existsSync10, lstatSync as lstatSync2, realpathSync as realpathSync2 } from "fs";
import { join as join12, dirname as dirname7 } from "path";
import { fileURLToPath } from "url";
function getRuntimePackageVersion() {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname2 = dirname7(__filename);
    for (let i = 0; i < 5; i++) {
      const candidate = join12(__dirname2, ...Array(i + 1).fill(".."), "package.json");
      try {
        const pkg = JSON.parse(readFileSync11(candidate, "utf-8"));
        if (pkg.name && pkg.version) {
          return pkg.version;
        }
      } catch {
        continue;
      }
    }
  } catch {
  }
  try {
    const __filename = fileURLToPath(import.meta.url);
    const pathMatch = __filename.match(/oh-my-claudecode\/(\d+\.\d+\.\d+[^/]*)\//);
    if (pathMatch?.[1]) {
      return pathMatch[1];
    }
  } catch {
  }
  return "unknown";
}
function isRuntimePackageLocal() {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname2 = dirname7(__filename);
    let pkgRoot = null;
    for (let i = 0; i < 5; i++) {
      const candidate = join12(__dirname2, ...Array(i + 1).fill(".."));
      if (existsSync10(join12(candidate, "package.json"))) {
        pkgRoot = candidate;
        break;
      }
    }
    if (!pkgRoot) return false;
    if (existsSync10(join12(pkgRoot, ".git"))) return true;
    if (existsSync10(join12(pkgRoot, "src"))) return true;
    try {
      const real = realpathSync2(pkgRoot);
      const norm = (p) => p.replace(/\\/g, "/").replace(/\/+$/, "");
      if (norm(real) !== norm(pkgRoot)) return true;
    } catch {
    }
    let cursor = pkgRoot;
    for (let i = 0; i < 6; i++) {
      const parent = dirname7(cursor);
      if (parent === cursor) break;
      try {
        if (lstatSync2(cursor).isSymbolicLink()) return true;
      } catch {
      }
      cursor = parent;
    }
  } catch {
  }
  return false;
}

// src/hud/elements/ralph.ts
var RED2 = "\x1B[31m";
var YELLOW2 = "\x1B[33m";
var GREEN2 = "\x1B[32m";
function renderRalph(state, thresholds, labels = DEFAULT_HUD_LABELS) {
  if (!state?.active) {
    return null;
  }
  const { iteration, maxIterations } = state;
  const warningThreshold = thresholds.ralphWarning;
  const criticalThreshold = Math.floor(maxIterations * 0.9);
  let color;
  if (iteration >= criticalThreshold) {
    color = RED2;
  } else if (iteration >= warningThreshold) {
    color = YELLOW2;
  } else {
    color = GREEN2;
  }
  return `${labels.ralph}:${color}${iteration}/${maxIterations}${RESET}`;
}

// src/hud/elements/agents.ts
var CYAN2 = "\x1B[36m";
var AGENT_TYPE_CODES = {
  // ============================================================
  // BUILD/ANALYSIS LANE
  // ============================================================
  // Explore - 'E' for Explore (haiku)
  explore: "e",
  // Analyst - 'T' for aTalyst (A taken by Architect)
  analyst: "T",
  // opus
  // Planner - 'P' for Planner
  planner: "P",
  // opus
  // Architect - 'A' for Architect
  architect: "A",
  // opus
  // Debugger - 'g' for debuGger (d taken by designer)
  debugger: "g",
  // sonnet
  // Executor - 'x' for eXecutor (sonnet default, opus for complex tasks)
  executor: "x",
  // sonnet/opus
  // Verifier - 'V' for Verifier (but vision uses 'v'... use uppercase 'V' for governance role)
  verifier: "V",
  // sonnet
  // ============================================================
  // REVIEW LANE
  // ============================================================
  // Style Reviewer - 'Y' for stYle
  "style-reviewer": "y",
  // haiku
  // API Reviewer - 'I' for Interface/API
  "api-reviewer": "i",
  // sonnet
  // Security Reviewer - 'K' for Security (S taken by Scientist)
  "security-reviewer": "K",
  // sonnet
  // Performance Reviewer - 'O' for perfOrmance
  "performance-reviewer": "o",
  // sonnet
  // Code Reviewer - 'R' for Review (uppercase, opus tier)
  "code-reviewer": "R",
  // opus
  // ============================================================
  // DOMAIN SPECIALISTS
  // ============================================================
  // Dependency Expert - 'L' for Library expert
  "dependency-expert": "l",
  // sonnet
  // Test Engineer - 'T' (but analyst uses 'T'... use uppercase 'T')
  "test-engineer": "t",
  // sonnet
  // Quality Strategist - 'Qs' for Quality Strategist (disambiguated from quality-reviewer)
  "quality-strategist": "Qs",
  // sonnet
  // Designer - 'd' for Designer
  designer: "d",
  // sonnet
  // Writer - 'W' for Writer
  writer: "w",
  // haiku
  // QA Tester - 'Q' for QA
  "qa-tester": "q",
  // sonnet
  // Scientist - 'S' for Scientist
  scientist: "s",
  // sonnet
  // Git Master - 'M' for Master
  "git-master": "m",
  // sonnet
  // ============================================================
  // PRODUCT LANE
  // ============================================================
  // Product Manager - 'Pm' for Product Manager (disambiguated from planner)
  "product-manager": "Pm",
  // sonnet
  // UX Researcher - 'u' for Ux
  "ux-researcher": "u",
  // sonnet
  // Information Architect - 'Ia' for Information Architect (disambiguated from api-reviewer)
  "information-architect": "Ia",
  // sonnet
  // Product Analyst - 'a' for analyst
  "product-analyst": "a",
  // sonnet
  // ============================================================
  // COORDINATION
  // ============================================================
  // Critic - 'C' for Critic
  critic: "C",
  // opus
  // Vision - 'V' for Vision (lowercase since sonnet)
  vision: "v",
  // sonnet
  // Document Specialist - 'D' for Document
  "document-specialist": "D",
  // sonnet
  // ============================================================
  // BACKWARD COMPATIBILITY (Deprecated)
  // ============================================================
  // Researcher - 'r' for Researcher (deprecated, points to document-specialist)
  researcher: "r"
  // sonnet
};
function getAgentCode(agentType, model) {
  const parts = agentType.split(":");
  const shortName = parts[parts.length - 1] || agentType;
  let code = AGENT_TYPE_CODES[shortName];
  if (!code) {
    code = shortName.charAt(0).toUpperCase();
  }
  if (model) {
    const tier = model.toLowerCase();
    if (code.length === 1) {
      code = tier.includes("opus") ? code.toUpperCase() : code.toLowerCase();
    } else {
      const first = tier.includes("opus") ? code[0].toUpperCase() : code[0].toLowerCase();
      code = first + code.slice(1);
    }
  }
  return code;
}
function formatDuration(durationMs) {
  const seconds = Math.floor(durationMs / 1e3);
  const minutes = Math.floor(seconds / 60);
  if (seconds < 10) {
    return "";
  } else if (seconds < 60) {
    return `(${seconds}s)`;
  } else if (minutes < 10) {
    return `(${minutes}m)`;
  } else {
    return "!";
  }
}
function renderAgents(agents) {
  const running = agents.filter((a) => a.status === "running").length;
  if (running === 0) {
    return null;
  }
  return `agents:${CYAN2}${running}${RESET}`;
}
function sortByFreshest(agents) {
  return [...agents].sort((a, b) => b.startTime.getTime() - a.startTime.getTime());
}
function renderAgentsCoded(agents) {
  const running = sortByFreshest(agents.filter((a) => a.status === "running"));
  if (running.length === 0) {
    return null;
  }
  const codes = running.map((a) => {
    const code = getAgentCode(a.type, a.model);
    const color = getModelTierColor(a.model);
    return `${color}${code}${RESET}`;
  });
  return `agents:${codes.join("")}`;
}
function renderAgentsCodedWithDuration(agents) {
  const running = sortByFreshest(agents.filter((a) => a.status === "running"));
  if (running.length === 0) {
    return null;
  }
  const now = Date.now();
  const codes = running.map((a) => {
    const code = getAgentCode(a.type, a.model);
    const durationMs = now - a.startTime.getTime();
    const duration = formatDuration(durationMs);
    const modelColor = getModelTierColor(a.model);
    if (duration === "!") {
      const durationColor = getDurationColor(durationMs);
      return `${modelColor}${code}${durationColor}!${RESET}`;
    } else if (duration) {
      return `${modelColor}${code}${dim(duration)}${RESET}`;
    } else {
      return `${modelColor}${code}${RESET}`;
    }
  });
  return `agents:${codes.join("")}`;
}
function renderAgentsDetailed(agents) {
  const running = sortByFreshest(agents.filter((a) => a.status === "running"));
  if (running.length === 0) {
    return null;
  }
  const now = Date.now();
  const names = running.map((a) => {
    const parts = a.type.split(":");
    let name = parts[parts.length - 1] || a.type;
    if (name === "executor") name = "exec";
    if (name === "deep-executor") name = "exec";
    if (name === "designer") name = "design";
    if (name === "qa-tester") name = "qa";
    if (name === "scientist") name = "sci";
    if (name === "security-reviewer") name = "sec";
    if (name === "build-fixer") name = "debug";
    if (name === "code-reviewer") name = "review";
    if (name === "git-master") name = "git";
    if (name === "style-reviewer") name = "style";
    if (name === "quality-reviewer") name = "review";
    if (name === "api-reviewer") name = "api-rev";
    if (name === "performance-reviewer") name = "perf";
    if (name === "dependency-expert") name = "dep-exp";
    if (name === "document-specialist") name = "doc-spec";
    if (name === "test-engineer") name = "test-eng";
    if (name === "quality-strategist") name = "qs";
    if (name === "debugger") name = "debug";
    if (name === "verifier") name = "verify";
    if (name === "product-manager") name = "pm";
    if (name === "ux-researcher") name = "uxr";
    if (name === "information-architect") name = "ia";
    if (name === "product-analyst") name = "pa";
    const durationMs = now - a.startTime.getTime();
    const duration = formatDuration(durationMs);
    return duration ? `${name}${duration}` : name;
  });
  return `agents:[${CYAN2}${names.join(",")}${RESET}]`;
}
function truncateDescription(desc, maxWidth = 20) {
  if (!desc) return "...";
  return truncateToWidth(desc, maxWidth);
}
function getShortAgentName(agentType) {
  const parts = agentType.split(":");
  const name = parts[parts.length - 1] || agentType;
  const abbrevs = {
    // Build/Analysis Lane
    "executor": "exec",
    "deep-executor": "exec",
    // deprecated alias
    "debugger": "debug",
    "verifier": "verify",
    // Review Lane
    "style-reviewer": "style",
    "quality-reviewer": "review",
    // deprecated alias
    "api-reviewer": "api-rev",
    "security-reviewer": "sec",
    "performance-reviewer": "perf",
    "code-reviewer": "review",
    // Domain Specialists
    "dependency-expert": "dep-exp",
    "document-specialist": "doc-spec",
    "test-engineer": "test-eng",
    "quality-strategist": "qs",
    "build-fixer": "debug",
    // deprecated alias
    "designer": "design",
    "qa-tester": "qa",
    "scientist": "sci",
    "git-master": "git",
    // Product Lane
    "product-manager": "pm",
    "ux-researcher": "uxr",
    "information-architect": "ia",
    "product-analyst": "pa",
    // Backward compat
    "researcher": "dep-exp"
  };
  return abbrevs[name] || name;
}
function getTeammateName(agent) {
  const name = agent.name?.trim();
  return name ? name : null;
}
function getAgentDisplayName(agent) {
  const teammateName = getTeammateName(agent);
  return teammateName ? `tm:${teammateName}` : getShortAgentName(agent.type);
}
function getAgentDisplayMarker(agent) {
  return getTeammateName(agent) ? "\u25C6" : getAgentCode(agent.type, agent.model);
}
function getAgentDisplayColor(agent) {
  return getTeammateName(agent) ? CYAN2 : getModelTierColor(agent.model);
}
function renderAgentsWithDescriptions(agents) {
  const running = sortByFreshest(agents.filter((a) => a.status === "running"));
  if (running.length === 0) {
    return null;
  }
  const now = Date.now();
  const entries = running.map((a) => {
    const code = getAgentDisplayMarker(a);
    const color = getAgentDisplayColor(a);
    const teammateName = getTeammateName(a);
    const displayName = getAgentDisplayName(a);
    const desc = truncateDescription(a.description, teammateName ? 30 : 25);
    const label = teammateName ? `${displayName}${desc ? ` ${desc}` : ""}` : desc;
    const durationMs = now - a.startTime.getTime();
    const duration = formatDuration(durationMs);
    let entry = `${color}${code}${RESET}:${dim(label)}`;
    if (duration && duration !== "!") {
      entry += dim(duration);
    } else if (duration === "!") {
      const durationColor = getDurationColor(durationMs);
      entry += `${durationColor}!${RESET}`;
    }
    return entry;
  });
  return entries.join(dim(" | "));
}
function renderAgentsDescOnly(agents) {
  const running = sortByFreshest(agents.filter((a) => a.status === "running"));
  if (running.length === 0) {
    return null;
  }
  const now = Date.now();
  const descriptions = running.map((a) => {
    const color = getAgentDisplayColor(a);
    const shortName = getAgentDisplayName(a);
    const desc = a.description ? truncateDescription(a.description, 20) : shortName;
    const durationMs = now - a.startTime.getTime();
    const duration = formatDuration(durationMs);
    if (duration === "!") {
      const durationColor = getDurationColor(durationMs);
      return `${color}${desc}${durationColor}!${RESET}`;
    } else if (duration) {
      return `${color}${desc}${dim(duration)}${RESET}`;
    }
    return `${color}${desc}${RESET}`;
  });
  return `[${descriptions.join(dim(", "))}]`;
}
function formatDurationPadded(durationMs) {
  const seconds = Math.floor(durationMs / 1e3);
  const minutes = Math.floor(seconds / 60);
  if (seconds < 10) {
    return "    ";
  } else if (seconds < 60) {
    return `${seconds}s`.padStart(4);
  } else if (minutes < 10) {
    return `${minutes}m`.padStart(4);
  } else {
    return `${minutes}m`.padStart(4);
  }
}
function renderAgentsMultiLine(agents, maxLines = 5) {
  const running = sortByFreshest(agents.filter((a) => a.status === "running"));
  if (running.length === 0) {
    return { headerPart: null, detailLines: [] };
  }
  const headerPart = `agents:${CYAN2}${running.length}${RESET}`;
  const now = Date.now();
  const detailLines = [];
  const displayCount = Math.min(running.length, maxLines);
  running.slice(0, maxLines).forEach((a, index) => {
    const isLast = index === displayCount - 1 && running.length <= maxLines;
    const prefix = isLast ? "\u2514\u2500" : "\u251C\u2500";
    const code = getAgentDisplayMarker(a);
    const color = getAgentDisplayColor(a);
    const shortName = getAgentDisplayName(a).padEnd(12);
    const durationMs = now - a.startTime.getTime();
    const duration = formatDurationPadded(durationMs);
    const durationColor = getDurationColor(durationMs);
    const desc = a.description || "...";
    const truncatedDesc = truncateToWidth(desc, 45);
    detailLines.push(
      `${dim(prefix)} ${color}${code}${RESET} ${dim(shortName)}${durationColor}${duration}${RESET}  ${truncatedDesc}`
    );
  });
  if (running.length > maxLines) {
    const remaining = running.length - maxLines;
    detailLines.push(`${dim(`\u2514\u2500 +${remaining} more agents...`)}`);
  }
  return { headerPart, detailLines };
}
function renderAgentsByFormat(agents, format2) {
  switch (format2) {
    case "count":
      return renderAgents(agents);
    case "codes":
      return renderAgentsCoded(agents);
    case "codes-duration":
      return renderAgentsCodedWithDuration(agents);
    case "detailed":
      return renderAgentsDetailed(agents);
    case "descriptions":
      return renderAgentsWithDescriptions(agents);
    case "tasks":
      return renderAgentsDescOnly(agents);
    case "multiline":
      return renderAgentsMultiLine(agents).headerPart;
    default:
      return renderAgentsCoded(agents);
  }
}

// src/hud/elements/todos.ts
var GREEN3 = "\x1B[32m";
var YELLOW3 = "\x1B[33m";
var CYAN3 = "\x1B[36m";
var DIM2 = "\x1B[2m";
function renderTodosWithCurrent(todos) {
  if (todos.length === 0) {
    return null;
  }
  const completed = todos.filter((t) => t.status === "completed").length;
  const total = todos.length;
  const inProgress = todos.find((t) => t.status === "in_progress");
  const percent = completed / total * 100;
  let color;
  if (percent >= 80) {
    color = GREEN3;
  } else if (percent >= 50) {
    color = YELLOW3;
  } else {
    color = CYAN3;
  }
  let result = `todos:${color}${completed}/${total}${RESET}`;
  if (inProgress) {
    const activeText = inProgress.activeForm || inProgress.content || "...";
    const truncated = truncateToWidth(activeText, 30);
    result += ` ${DIM2}(working: ${truncated})${RESET}`;
  }
  return result;
}

// src/hud/elements/skills.ts
var MAGENTA2 = "\x1B[35m";
var BRIGHT_MAGENTA = "\x1B[95m";
function truncate(str, maxWidth) {
  return truncateToWidth(str, maxWidth);
}
function getSkillDisplayName(skillName) {
  return skillName.split(":").pop() || skillName;
}
function isActiveMode(skillName, ultrawork, ralph) {
  if (skillName === "ultrawork" && ultrawork?.active) return true;
  if (skillName === "ralph" && ralph?.active) return true;
  if (skillName === "ultrawork+ralph" && ultrawork?.active && ralph?.active) return true;
  return false;
}
function renderSkills(ultrawork, ralph, lastSkill) {
  const parts = [];
  if (ralph?.active && ultrawork?.active) {
    parts.push(`${BRIGHT_MAGENTA}ultrawork+ralph${RESET}`);
  } else if (ultrawork?.active) {
    parts.push(`${MAGENTA2}ultrawork${RESET}`);
  } else if (ralph?.active) {
    parts.push(`${MAGENTA2}ralph${RESET}`);
  }
  if (lastSkill && !isActiveMode(lastSkill.name, ultrawork, ralph)) {
    const argsDisplay = lastSkill.args ? `(${truncate(lastSkill.args, 15)})` : "";
    const displayName = getSkillDisplayName(lastSkill.name);
    parts.push(cyan(`skill:${displayName}${argsDisplay}`));
  }
  return parts.length > 0 ? parts.join(" ") : null;
}
function renderLastSkill(lastSkill) {
  if (!lastSkill) return null;
  const argsDisplay = lastSkill.args ? `(${truncate(lastSkill.args, 15)})` : "";
  const displayName = getSkillDisplayName(lastSkill.name);
  return cyan(`skill:${displayName}${argsDisplay}`);
}

// src/hud/elements/context.ts
var GREEN4 = "\x1B[32m";
var YELLOW4 = "\x1B[33m";
var RED3 = "\x1B[31m";
var DIM3 = "\x1B[2m";
var CONTEXT_DISPLAY_HYSTERESIS = 2;
var CONTEXT_DISPLAY_STATE_TTL_MS = 5e3;
var lastDisplayedPercent = null;
var lastDisplayedSeverity = null;
var lastDisplayScope = null;
var lastDisplayUpdatedAt = 0;
function clampContextPercent(percent) {
  return Math.min(100, Math.max(0, Math.round(percent)));
}
function getContextSeverity(safePercent, thresholds) {
  if (safePercent >= thresholds.contextCritical) {
    return "critical";
  }
  if (safePercent >= thresholds.contextCompactSuggestion) {
    return "compact";
  }
  if (safePercent >= thresholds.contextWarning) {
    return "warning";
  }
  return "normal";
}
function getContextDisplayStyle(safePercent, thresholds) {
  const severity = getContextSeverity(safePercent, thresholds);
  switch (severity) {
    case "critical":
      return { color: RED3, suffix: " CRITICAL" };
    case "compact":
      return { color: YELLOW4, suffix: " COMPRESS?" };
    case "warning":
      return { color: YELLOW4, suffix: "" };
    default:
      return { color: GREEN4, suffix: "" };
  }
}
function getStableContextDisplayPercent(percent, thresholds, displayScope) {
  const safePercent = clampContextPercent(percent);
  const severity = getContextSeverity(safePercent, thresholds);
  const nextScope = displayScope ?? null;
  const now = Date.now();
  if (nextScope !== lastDisplayScope) {
    lastDisplayedPercent = null;
    lastDisplayedSeverity = null;
    lastDisplayScope = nextScope;
  }
  if (lastDisplayedPercent === null || lastDisplayedSeverity === null || now - lastDisplayUpdatedAt > CONTEXT_DISPLAY_STATE_TTL_MS) {
    lastDisplayedPercent = safePercent;
    lastDisplayedSeverity = severity;
    lastDisplayUpdatedAt = now;
    return safePercent;
  }
  if (severity !== lastDisplayedSeverity) {
    lastDisplayedPercent = safePercent;
    lastDisplayedSeverity = severity;
    lastDisplayUpdatedAt = now;
    return safePercent;
  }
  if (Math.abs(safePercent - lastDisplayedPercent) <= CONTEXT_DISPLAY_HYSTERESIS) {
    lastDisplayUpdatedAt = now;
    return lastDisplayedPercent;
  }
  lastDisplayedPercent = safePercent;
  lastDisplayedSeverity = severity;
  lastDisplayUpdatedAt = now;
  return safePercent;
}
function renderContext(percent, thresholds, displayScope, labels = DEFAULT_HUD_LABELS) {
  const safePercent = getStableContextDisplayPercent(percent, thresholds, displayScope);
  const { color, suffix } = getContextDisplayStyle(safePercent, thresholds);
  return `${labels.context}:${color}${safePercent}%${suffix}${RESET}`;
}
function renderContextWithBar(percent, thresholds, barWidth = 10, displayScope, labels = DEFAULT_HUD_LABELS) {
  const safePercent = getStableContextDisplayPercent(percent, thresholds, displayScope);
  const filled = Math.round(safePercent / 100 * barWidth);
  const empty = barWidth - filled;
  const { color, suffix } = getContextDisplayStyle(safePercent, thresholds);
  const bar = `${color}${"\u2588".repeat(filled)}${DIM3}${"\u2591".repeat(empty)}${RESET}`;
  return `${labels.context}:[${bar}]${color}${safePercent}%${suffix}${RESET}`;
}

// src/hud/elements/background.ts
var CYAN4 = "\x1B[36m";
var GREEN5 = "\x1B[32m";
var YELLOW5 = "\x1B[33m";
var MAX_CONCURRENT = 5;
function renderBackground(tasks, labels = DEFAULT_HUD_LABELS) {
  const running = tasks.filter((t) => t.status === "running").length;
  if (running === 0) {
    return null;
  }
  let color;
  if (running >= MAX_CONCURRENT) {
    color = YELLOW5;
  } else if (running >= MAX_CONCURRENT - 1) {
    color = CYAN4;
  } else {
    color = GREEN5;
  }
  return `${labels.background}:${color}${running}/${MAX_CONCURRENT}${RESET}`;
}

// src/hud/elements/prd.ts
var CYAN5 = "\x1B[36m";
var GREEN6 = "\x1B[32m";
function renderPrd(state) {
  if (!state) {
    return null;
  }
  const { currentStoryId, completed, total } = state;
  if (completed === total) {
    return `${GREEN6}PRD:done${RESET}`;
  }
  if (currentStoryId) {
    return `${CYAN5}${currentStoryId}${RESET}`;
  }
  return null;
}

// src/hud/elements/limits.ts
var GREEN7 = "\x1B[32m";
var YELLOW6 = "\x1B[33m";
var RED4 = "\x1B[31m";
var DIM4 = "\x1B[2m";
var WARNING_THRESHOLD = 70;
var CRITICAL_THRESHOLD = 90;
function getColor(percent) {
  if (percent >= CRITICAL_THRESHOLD) {
    return RED4;
  } else if (percent >= WARNING_THRESHOLD) {
    return YELLOW6;
  }
  return GREEN7;
}
function formatResetTime(date) {
  if (!date) return null;
  const now = Date.now();
  const resetMs = date.getTime();
  const diffMs = resetMs - now;
  if (diffMs <= 0) return null;
  const diffMinutes = Math.floor(diffMs / 6e4);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays > 0) {
    const remainingHours = diffHours % 24;
    return `${diffDays}d${remainingHours}h`;
  }
  const remainingMinutes = diffMinutes % 60;
  return `${diffHours}h${remainingMinutes}m`;
}
function renderRateLimits(limits, stale) {
  if (!limits) return null;
  const staleMarker = stale ? `${DIM4}*${RESET}` : "";
  const resetPrefix = stale ? "~" : "";
  const fiveHour = Math.min(100, Math.max(0, Math.round(limits.fiveHourPercent)));
  const fiveHourColor = getColor(fiveHour);
  const fiveHourReset = formatResetTime(limits.fiveHourResetsAt);
  const fiveHourPart = fiveHourReset ? `5h:${fiveHourColor}${fiveHour}%${RESET}${staleMarker}${DIM4}(${resetPrefix}${fiveHourReset})${RESET}` : `5h:${fiveHourColor}${fiveHour}%${RESET}${staleMarker}`;
  const parts = [fiveHourPart];
  if (limits.weeklyPercent != null) {
    const weekly = Math.min(100, Math.max(0, Math.round(limits.weeklyPercent)));
    const weeklyColor = getColor(weekly);
    const weeklyReset = formatResetTime(limits.weeklyResetsAt);
    const weeklyPart = weeklyReset ? `${DIM4}wk:${RESET}${weeklyColor}${weekly}%${RESET}${staleMarker}${DIM4}(${resetPrefix}${weeklyReset})${RESET}` : `${DIM4}wk:${RESET}${weeklyColor}${weekly}%${RESET}${staleMarker}`;
    parts.push(weeklyPart);
  }
  if (limits.monthlyPercent != null) {
    const monthly = Math.min(100, Math.max(0, Math.round(limits.monthlyPercent)));
    const monthlyColor = getColor(monthly);
    const monthlyReset = formatResetTime(limits.monthlyResetsAt);
    const monthlyPart = monthlyReset ? `${DIM4}mo:${RESET}${monthlyColor}${monthly}%${RESET}${staleMarker}${DIM4}(${resetPrefix}${monthlyReset})${RESET}` : `${DIM4}mo:${RESET}${monthlyColor}${monthly}%${RESET}${staleMarker}`;
    parts.push(monthlyPart);
  }
  if (limits.sonnetWeeklyPercent != null) {
    const sonnet = Math.min(100, Math.max(0, Math.round(limits.sonnetWeeklyPercent)));
    const sonnetColor = getColor(sonnet);
    const sonnetReset = formatResetTime(limits.sonnetWeeklyResetsAt);
    const sonnetPart = sonnetReset ? `${DIM4}sn:${RESET}${sonnetColor}${sonnet}%${RESET}${staleMarker}${DIM4}(${resetPrefix}${sonnetReset})${RESET}` : `${DIM4}sn:${RESET}${sonnetColor}${sonnet}%${RESET}${staleMarker}`;
    parts.push(sonnetPart);
  }
  if (limits.opusWeeklyPercent != null) {
    const opus = Math.min(100, Math.max(0, Math.round(limits.opusWeeklyPercent)));
    const opusColor = getColor(opus);
    const opusReset = formatResetTime(limits.opusWeeklyResetsAt);
    const opusPart = opusReset ? `${DIM4}op:${RESET}${opusColor}${opus}%${RESET}${staleMarker}${DIM4}(${resetPrefix}${opusReset})${RESET}` : `${DIM4}op:${RESET}${opusColor}${opus}%${RESET}${staleMarker}`;
    parts.push(opusPart);
  }
  if (limits.extraUsagePercent != null && limits.extraUsageLimitUsd != null) {
    const extra = Math.min(100, Math.max(0, Math.round(limits.extraUsagePercent)));
    const extraColor = getColor(extra);
    const extraReset = formatResetTime(limits.extraUsageResetsAt);
    const dollarPart = `${DIM4}($${(limits.extraUsageSpentUsd ?? 0).toFixed(2)}/$${limits.extraUsageLimitUsd.toFixed(2)})${RESET}`;
    const extraPart = extraReset ? `${DIM4}extra:${RESET}${extraColor}${extra}%${RESET}${staleMarker}${dollarPart}${DIM4}(${resetPrefix}${extraReset})${RESET}` : `${DIM4}extra:${RESET}${extraColor}${extra}%${RESET}${staleMarker}${dollarPart}`;
    parts.push(extraPart);
  }
  return parts.join(" ");
}
function renderRateLimitsWithBar(limits, barWidth = 8, stale) {
  if (!limits) return null;
  const staleMarker = stale ? `${DIM4}*${RESET}` : "";
  const resetPrefix = stale ? "~" : "";
  const fiveHour = Math.min(100, Math.max(0, Math.round(limits.fiveHourPercent)));
  const fiveHourColor = getColor(fiveHour);
  const fiveHourFilled = Math.round(fiveHour / 100 * barWidth);
  const fiveHourEmpty = barWidth - fiveHourFilled;
  const fiveHourBar = `${fiveHourColor}${"\u2588".repeat(fiveHourFilled)}${DIM4}${"\u2591".repeat(fiveHourEmpty)}${RESET}`;
  const fiveHourReset = formatResetTime(limits.fiveHourResetsAt);
  const fiveHourPart = fiveHourReset ? `5h:[${fiveHourBar}]${fiveHourColor}${fiveHour}%${RESET}${staleMarker}${DIM4}(${resetPrefix}${fiveHourReset})${RESET}` : `5h:[${fiveHourBar}]${fiveHourColor}${fiveHour}%${RESET}${staleMarker}`;
  const parts = [fiveHourPart];
  if (limits.weeklyPercent != null) {
    const weekly = Math.min(100, Math.max(0, Math.round(limits.weeklyPercent)));
    const weeklyColor = getColor(weekly);
    const weeklyFilled = Math.round(weekly / 100 * barWidth);
    const weeklyEmpty = barWidth - weeklyFilled;
    const weeklyBar = `${weeklyColor}${"\u2588".repeat(weeklyFilled)}${DIM4}${"\u2591".repeat(weeklyEmpty)}${RESET}`;
    const weeklyReset = formatResetTime(limits.weeklyResetsAt);
    const weeklyPart = weeklyReset ? `${DIM4}wk:${RESET}[${weeklyBar}]${weeklyColor}${weekly}%${RESET}${staleMarker}${DIM4}(${resetPrefix}${weeklyReset})${RESET}` : `${DIM4}wk:${RESET}[${weeklyBar}]${weeklyColor}${weekly}%${RESET}${staleMarker}`;
    parts.push(weeklyPart);
  }
  if (limits.monthlyPercent != null) {
    const monthly = Math.min(100, Math.max(0, Math.round(limits.monthlyPercent)));
    const monthlyColor = getColor(monthly);
    const monthlyFilled = Math.round(monthly / 100 * barWidth);
    const monthlyEmpty = barWidth - monthlyFilled;
    const monthlyBar = `${monthlyColor}${"\u2588".repeat(monthlyFilled)}${DIM4}${"\u2591".repeat(monthlyEmpty)}${RESET}`;
    const monthlyReset = formatResetTime(limits.monthlyResetsAt);
    const monthlyPart = monthlyReset ? `${DIM4}mo:${RESET}[${monthlyBar}]${monthlyColor}${monthly}%${RESET}${staleMarker}${DIM4}(${resetPrefix}${monthlyReset})${RESET}` : `${DIM4}mo:${RESET}[${monthlyBar}]${monthlyColor}${monthly}%${RESET}${staleMarker}`;
    parts.push(monthlyPart);
  }
  if (limits.sonnetWeeklyPercent != null) {
    const sonnet = Math.min(100, Math.max(0, Math.round(limits.sonnetWeeklyPercent)));
    const sonnetColor = getColor(sonnet);
    const sonnetFilled = Math.round(sonnet / 100 * barWidth);
    const sonnetEmpty = barWidth - sonnetFilled;
    const sonnetBar = `${sonnetColor}${"\u2588".repeat(sonnetFilled)}${DIM4}${"\u2591".repeat(sonnetEmpty)}${RESET}`;
    const sonnetReset = formatResetTime(limits.sonnetWeeklyResetsAt);
    const sonnetPart = sonnetReset ? `${DIM4}sn:${RESET}[${sonnetBar}]${sonnetColor}${sonnet}%${RESET}${staleMarker}${DIM4}(${resetPrefix}${sonnetReset})${RESET}` : `${DIM4}sn:${RESET}[${sonnetBar}]${sonnetColor}${sonnet}%${RESET}${staleMarker}`;
    parts.push(sonnetPart);
  }
  if (limits.opusWeeklyPercent != null) {
    const opus = Math.min(100, Math.max(0, Math.round(limits.opusWeeklyPercent)));
    const opusColor = getColor(opus);
    const opusFilled = Math.round(opus / 100 * barWidth);
    const opusEmpty = barWidth - opusFilled;
    const opusBar = `${opusColor}${"\u2588".repeat(opusFilled)}${DIM4}${"\u2591".repeat(opusEmpty)}${RESET}`;
    const opusReset = formatResetTime(limits.opusWeeklyResetsAt);
    const opusPart = opusReset ? `${DIM4}op:${RESET}[${opusBar}]${opusColor}${opus}%${RESET}${staleMarker}${DIM4}(${resetPrefix}${opusReset})${RESET}` : `${DIM4}op:${RESET}[${opusBar}]${opusColor}${opus}%${RESET}${staleMarker}`;
    parts.push(opusPart);
  }
  if (limits.extraUsagePercent != null && limits.extraUsageLimitUsd != null) {
    const extra = Math.min(100, Math.max(0, Math.round(limits.extraUsagePercent)));
    const extraColor = getColor(extra);
    const extraFilled = Math.round(extra / 100 * barWidth);
    const extraEmpty = barWidth - extraFilled;
    const extraBar = `${extraColor}${"\u2588".repeat(extraFilled)}${DIM4}${"\u2591".repeat(extraEmpty)}${RESET}`;
    const extraReset = formatResetTime(limits.extraUsageResetsAt);
    const dollarPart = `${DIM4}($${(limits.extraUsageSpentUsd ?? 0).toFixed(2)}/$${limits.extraUsageLimitUsd.toFixed(2)})${RESET}`;
    const extraPart = extraReset ? `${DIM4}extra:${RESET}[${extraBar}]${extraColor}${extra}%${RESET}${staleMarker}${dollarPart}${DIM4}(${resetPrefix}${extraReset})${RESET}` : `${DIM4}extra:${RESET}[${extraBar}]${extraColor}${extra}%${RESET}${staleMarker}${dollarPart}`;
    parts.push(extraPart);
  }
  return parts.join(" ");
}
function renderRateLimitsError(result) {
  if (!result?.error) return null;
  if (result.error === "no_credentials") return null;
  if (result.error === "rate_limited") {
    return result.rateLimits ? null : `${DIM4}[API 429]${RESET}`;
  }
  if (result.error === "auth") return `${YELLOW6}[API auth]${RESET}`;
  return `${YELLOW6}[API err]${RESET}`;
}
function renderApiKeyUsageHint(result, apiKeyMode, hasCustomProvider) {
  if (!apiKeyMode) return null;
  if (hasCustomProvider) return null;
  if (result?.error !== "no_credentials") return null;
  return `${DIM4}[usage: set omcHud.rateLimitsProvider]${RESET}`;
}
function bucketUsagePercent(usage) {
  if (usage.type === "percent") return usage.value;
  if (usage.type === "credit" && usage.limit > 0) return usage.used / usage.limit * 100;
  return null;
}
function renderBucketUsageValue(usage) {
  if (usage.type === "percent") return `${Math.round(usage.value)}%`;
  if (usage.type === "credit") return `${usage.used}/${usage.limit}`;
  return usage.value;
}
function renderCustomBuckets(result, thresholdPercent = 85) {
  if (result.error && result.buckets.length === 0) {
    return `${YELLOW6}[cmd:err]${RESET}`;
  }
  if (result.buckets.length === 0) return null;
  const staleMarker = result.stale ? `${DIM4}*${RESET}` : "";
  const parts = result.buckets.map((bucket) => {
    const pct = bucketUsagePercent(bucket.usage);
    const color = pct != null ? getColor(pct) : "";
    const colorReset = pct != null ? RESET : "";
    const usageStr = renderBucketUsageValue(bucket.usage);
    let resetPart = "";
    if (bucket.resetsAt && pct != null && pct >= thresholdPercent) {
      const d = new Date(bucket.resetsAt);
      if (!isNaN(d.getTime())) {
        const str = formatResetTime(d);
        if (str) resetPart = `${DIM4}(${str})${RESET}`;
      }
    }
    return `${DIM4}${bucket.label}:${RESET}${color}${usageStr}${colorReset}${staleMarker}${resetPart}`;
  });
  return parts.join(" ");
}

// src/hud/elements/permission.ts
function renderPermission(pending) {
  if (!pending) return null;
  return `${yellow("APPROVE?")} ${dim(pending.toolName.toLowerCase())}:${pending.targetSummary}`;
}

// src/hud/elements/thinking.ts
var CYAN6 = "\x1B[36m";
function renderThinking(state, format2 = "text", labels = DEFAULT_HUD_LABELS) {
  if (!state?.active) return null;
  switch (format2) {
    case "bubble":
      return "\u{1F4AD}";
    case "brain":
      return "\u{1F9E0}";
    case "face":
      return "\u{1F914}";
    case "text":
      return `${CYAN6}${labels.thinking}${RESET}`;
    default:
      return "\u{1F4AD}";
  }
}

// src/hud/elements/session.ts
function renderSession(session) {
  if (!session) return null;
  const colorize = session.health === "critical" ? red : session.health === "warning" ? yellow : green;
  return `session:${colorize(`${session.durationMinutes}m`)}`;
}

// src/cli/utils/formatting.ts
function formatTokenCount(tokens) {
  if (tokens < 1e3) return `${tokens}`;
  if (tokens < 1e6) return `${(tokens / 1e3).toFixed(1)}k`;
  return `${(tokens / 1e6).toFixed(2)}M`;
}

// src/hud/elements/token-usage.ts
function renderTokenUsage(usage, sessionTotalTokens, labels = DEFAULT_HUD_LABELS) {
  if (!usage) return null;
  const hasUsage = usage.inputTokens > 0 || usage.outputTokens > 0;
  if (!hasUsage) return null;
  const parts = [
    `${labels.tokens}:i${formatTokenCount(usage.inputTokens)}/o${formatTokenCount(usage.outputTokens)}`
  ];
  if (usage.reasoningTokens && usage.reasoningTokens > 0) {
    parts.push(`r${formatTokenCount(usage.reasoningTokens)}`);
  }
  if (sessionTotalTokens && sessionTotalTokens > 0) {
    parts.push(`s${formatTokenCount(sessionTotalTokens)}`);
  }
  return parts.join(" ");
}

// src/hud/elements/enterprise-cost.ts
var GREEN8 = "\x1B[32m";
var YELLOW7 = "\x1B[33m";
var RED5 = "\x1B[31m";
var DIM5 = "\x1B[2m";
var WARNING_THRESHOLD2 = 70;
var CRITICAL_THRESHOLD2 = 90;
function getColor2(percent) {
  if (percent >= CRITICAL_THRESHOLD2) return RED5;
  if (percent >= WARNING_THRESHOLD2) return YELLOW7;
  return GREEN8;
}
function formatMoney(amount, decimals) {
  const [intPart, decPart] = amount.toFixed(decimals).split(".");
  const withCommas = (intPart ?? "0").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return decPart ? `${withCommas}.${decPart}` : withCommas;
}
function currencyPrefix(currency) {
  return currency.toUpperCase() === "USD" ? "$" : `${currency.toUpperCase()} `;
}
function renderEnterpriseCost(limits, stale) {
  if (!limits || limits.enterpriseSpentUsd === void 0) return null;
  const staleMarker = stale ? `${DIM5}*${RESET}` : "";
  const currency = limits.enterpriseCurrency ?? "USD";
  const prefix = currencyPrefix(currency);
  const decimals = limits.enterpriseDecimalPlaces ?? 2;
  const spentStr = formatMoney(limits.enterpriseSpentUsd, decimals);
  if (limits.enterpriseLimitUsd == null) {
    return `${DIM5}spent:${RESET}${prefix}${spentStr}${staleMarker}`;
  }
  const limitStr = formatMoney(limits.enterpriseLimitUsd, decimals);
  const utilization = limits.enterpriseUtilization ?? 0;
  const rounded = Math.min(100, Math.max(0, Math.round(utilization)));
  const color = getColor2(rounded);
  return `${DIM5}spent:${RESET}${prefix}${spentStr}/${prefix}${limitStr} ${color}(${rounded}%)${RESET}${staleMarker}`;
}

// src/hud/elements/prompt-time.ts
function formatElapsed(ms) {
  const totalSeconds = Math.floor(ms / 1e3);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) return `${totalMinutes}m${totalSeconds % 60}s`;
  const hours = Math.floor(totalMinutes / 60);
  return `${hours}h${totalMinutes % 60}m`;
}
function renderPromptTime(promptTime, now) {
  if (!promptTime) return null;
  if (now) {
    const elapsed = now.getTime() - promptTime.getTime();
    if (elapsed >= 0) {
      return `${dim("\u23F1")}${formatElapsed(elapsed)}`;
    }
  }
  const hours = String(promptTime.getHours()).padStart(2, "0");
  const minutes = String(promptTime.getMinutes()).padStart(2, "0");
  const seconds = String(promptTime.getSeconds()).padStart(2, "0");
  return `${dim("prompt:")}${hours}:${minutes}:${seconds}`;
}

// src/hud/elements/autopilot.ts
var CYAN7 = "\x1B[36m";
var GREEN9 = "\x1B[32m";
var YELLOW8 = "\x1B[33m";
var RED6 = "\x1B[31m";
var MAGENTA3 = "\x1B[35m";
var PHASE_NAMES = {
  expansion: "Expand",
  planning: "Plan",
  execution: "Build",
  qa: "QA",
  validation: "Verify",
  complete: "Done",
  failed: "Failed"
};
var PHASE_INDEX = {
  expansion: 1,
  planning: 2,
  execution: 3,
  qa: 4,
  validation: 5,
  complete: 5,
  failed: 0
};
function renderAutopilot(state, _thresholds) {
  if (!state?.active) {
    return null;
  }
  if (state.workflow?.invalid) {
    return `${CYAN7}[AUTOPILOT]${RESET} ${RED6}workflow:invalid${RESET}`;
  }
  if (state.workflow?.name && state.workflow.currentStage && state.workflow.currentStageIndex && state.workflow.stagesTotal) {
    const workflowName = state.workflow.name.slice(0, 32);
    return `${CYAN7}[AUTOPILOT]${RESET} workflow:${workflowName} v${state.workflow.version}#${state.workflow.shortHash} | ${state.workflow.currentStage} ${state.workflow.currentStageIndex}/${state.workflow.stagesTotal}`;
  }
  const { phase, iteration, maxIterations, tasksCompleted, tasksTotal, filesCreated } = state;
  const phaseNum = PHASE_INDEX[phase] || 0;
  const phaseName = PHASE_NAMES[phase] || phase;
  let phaseColor;
  switch (phase) {
    case "complete":
      phaseColor = GREEN9;
      break;
    case "failed":
      phaseColor = RED6;
      break;
    case "validation":
      phaseColor = MAGENTA3;
      break;
    case "qa":
      phaseColor = YELLOW8;
      break;
    default:
      phaseColor = CYAN7;
  }
  let output = `${CYAN7}[AUTOPILOT]${RESET} Phase ${phaseColor}${phaseNum}/5${RESET}: ${phaseName}`;
  if (iteration > 1) {
    output += ` (iter ${iteration}/${maxIterations})`;
  }
  if (phase === "execution" && tasksTotal && tasksTotal > 0) {
    const taskColor = tasksCompleted === tasksTotal ? GREEN9 : YELLOW8;
    output += ` | Tasks: ${taskColor}${tasksCompleted || 0}/${tasksTotal}${RESET}`;
  }
  if (filesCreated && filesCreated > 0) {
    output += ` | ${filesCreated} files`;
  }
  return output;
}

// src/hud/elements/cwd.ts
import { homedir as homedir3 } from "node:os";
import { basename as basename6, dirname as dirname8 } from "node:path";
function osc8Link(url, text) {
  return `\x1B]8;;${url}\x1B\\${text}\x1B]8;;\x1B\\`;
}
function pathToFileUrl(absPath) {
  const normalized = absPath.replace(/\\/g, "/");
  if (/^[A-Za-z]:\//.test(normalized)) {
    return `file:///${normalized}`;
  }
  return `file://${normalized}`;
}
function renderCwd(cwd, format2 = "relative", useHyperlinks = false) {
  if (!cwd) return null;
  let displayPath;
  switch (format2) {
    case "relative": {
      const home = homedir3().replace(/\\/g, "/");
      const normalizedCwd = cwd.replace(/\\/g, "/");
      if (normalizedCwd === home) {
        displayPath = "~";
      } else if (normalizedCwd.startsWith(`${home}/`)) {
        displayPath = "~" + normalizedCwd.slice(home.length);
      } else {
        displayPath = cwd;
      }
      break;
    }
    case "absolute":
      displayPath = cwd;
      break;
    case "folder": {
      const parent = basename6(dirname8(cwd));
      const folder = basename6(cwd);
      displayPath = parent ? `${parent}/${folder}` : folder;
      break;
    }
    default:
      displayPath = cwd;
  }
  const rendered = `${dim(displayPath)}`;
  if (useHyperlinks) {
    const url = pathToFileUrl(cwd);
    return osc8Link(url, rendered);
  }
  return rendered;
}

// src/hud/elements/hostname.ts
import { hostname } from "node:os";
function renderHostname() {
  const full = hostname();
  if (!full) return null;
  const short = full.split(".")[0];
  if (!short) return null;
  return cyan(`host:${short}`);
}

// src/hud/elements/git.ts
import { execFileSync as execFileSync4 } from "node:child_process";
import { realpathSync as realpathSync3 } from "node:fs";
import { resolve as resolve3, basename as basename7 } from "node:path";
var CACHE_TTL_MS2 = 3e4;
var repoCache = /* @__PURE__ */ new Map();
var branchCache = /* @__PURE__ */ new Map();
var worktreeCache = /* @__PURE__ */ new Map();
var statusCache = /* @__PURE__ */ new Map();
function git(args, cwd) {
  return execFileSync4("git", args, {
    cwd,
    encoding: "utf-8",
    timeout: 1e3,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true
  }).trim();
}
function getGitRepoName(cwd) {
  const key = cwd ? resolve3(cwd) : process.cwd();
  const cached = repoCache.get(key);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.value;
  }
  let result = null;
  try {
    const url = git(["remote", "get-url", "origin"], cwd);
    if (!url) {
      result = null;
    } else {
      const match = url.match(/\/([^/]+?)(?:\.git)?$/) || url.match(/:([^/]+?)(?:\.git)?$/);
      result = match ? match[1].replace(/\.git$/, "") : null;
    }
  } catch {
    result = null;
  }
  repoCache.set(key, { value: result, expiresAt: Date.now() + CACHE_TTL_MS2 });
  return result;
}
function getGitBranch(cwd) {
  const key = cwd ? resolve3(cwd) : process.cwd();
  const cached = branchCache.get(key);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.value;
  }
  let result = null;
  try {
    const branch = git(["branch", "--show-current"], cwd);
    result = branch || null;
  } catch {
    result = null;
  }
  branchCache.set(key, { value: result, expiresAt: Date.now() + CACHE_TTL_MS2 });
  return result;
}
function getWorktreeInfo(cwd) {
  const key = cwd ? resolve3(cwd) : process.cwd();
  const cached = worktreeCache.get(key);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.value;
  }
  let result = { isWorktree: false, worktreeName: null };
  try {
    const gitDir = git(["rev-parse", "--git-dir"], cwd);
    const gitCommonDir = git(["rev-parse", "--git-common-dir"], cwd);
    let resolvedGitDir = resolve3(key, gitDir);
    let resolvedCommonDir = resolve3(key, gitCommonDir);
    try {
      resolvedGitDir = realpathSync3(resolvedGitDir);
    } catch {
    }
    try {
      resolvedCommonDir = realpathSync3(resolvedCommonDir);
    } catch {
    }
    if (resolvedGitDir !== resolvedCommonDir) {
      result = { isWorktree: true, worktreeName: basename7(resolvedGitDir) };
    }
  } catch {
  }
  worktreeCache.set(key, { value: result, expiresAt: Date.now() + CACHE_TTL_MS2 });
  return result;
}
function renderGitRepo(cwd) {
  const repo = getGitRepoName(cwd);
  if (!repo) return null;
  return `${dim("repo:")}${cyan(repo)}`;
}
function renderGitBranch(cwd) {
  const branch = getGitBranch(cwd);
  if (!branch) return null;
  const wtInfo = getWorktreeInfo(cwd);
  if (wtInfo.isWorktree && wtInfo.worktreeName) {
    return `${dim("branch:")}${cyan(branch)} ${dim("(wt:")}${cyan(wtInfo.worktreeName)}${dim(")")}`;
  }
  return `${dim("branch:")}${cyan(branch)}`;
}
function getGitStatusCounts(cwd) {
  const key = cwd ? resolve3(cwd) : process.cwd();
  const cached = statusCache.get(key);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.value;
  }
  let result = null;
  try {
    const output = git(["--no-optional-locks", "status", "--porcelain", "-b"], cwd);
    let staged = 0, modified = 0, untracked = 0, ahead = 0, behind = 0;
    if (output) {
      const lines = output.split("\n");
      const branchLine = lines[0];
      const aheadMatch = branchLine.match(/\bahead (\d+)/);
      const behindMatch = branchLine.match(/\bbehind (\d+)/);
      if (aheadMatch) ahead = parseInt(aheadMatch[1], 10);
      if (behindMatch) behind = parseInt(behindMatch[1], 10);
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line || line.length < 2) continue;
        const idx = line[0];
        const wt = line[1];
        if (idx === "?") {
          untracked++;
        } else {
          if (idx !== " " && idx !== "?") staged++;
          if (wt === "M" || wt === "D") modified++;
        }
      }
    }
    result = { staged, modified, untracked, ahead, behind };
  } catch {
    result = null;
  }
  statusCache.set(key, { value: result, expiresAt: Date.now() + CACHE_TTL_MS2 });
  return result;
}
function renderGitStatus(cwd, labels = DEFAULT_HUD_LABELS) {
  const counts = getGitStatusCounts(cwd);
  if (!counts) return null;
  const { staged, modified, untracked, ahead, behind } = counts;
  if (staged === 0 && modified === 0 && untracked === 0 && ahead === 0 && behind === 0) {
    return null;
  }
  const parts = [];
  if (staged > 0) parts.push(`${green(labels.staged)}${staged}`);
  if (modified > 0) parts.push(`${red(labels.modified)}${modified}`);
  if (untracked > 0) parts.push(`${cyan(labels.untracked)}${untracked}`);
  if (ahead > 0) parts.push(`${green(labels.ahead)}${ahead}`);
  if (behind > 0) parts.push(`${red(labels.behind)}${behind}`);
  return parts.join(" ");
}

// src/hud/elements/multi-repo.ts
import { execFileSync as execFileSync5 } from "node:child_process";
import { existsSync as existsSync11, readdirSync as readdirSync5, statSync as statSync4 } from "node:fs";
import { basename as basename8, join as join13, resolve as resolve4 } from "node:path";
var ACTIVITY_WINDOW_MS = 5 * 60 * 1e3;
var SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var CACHE_TTL_MS3 = 3e4;
var multiRepoCache = /* @__PURE__ */ new Map();
function isGitRepo(dir) {
  try {
    execFileSync5("git", ["rev-parse", "--show-toplevel"], {
      cwd: dir,
      encoding: "utf-8",
      timeout: 1e3,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });
    return true;
  } catch {
    return false;
  }
}
function looksLikeRepo(entryPath) {
  return existsSync11(join13(entryPath, ".git"));
}
function countActiveSessions(cwd) {
  const sessionsDir = join13(getOmcRoot(cwd), "state", "sessions");
  if (!existsSync11(sessionsDir)) return 0;
  const now = Date.now();
  let active = 0;
  try {
    const entries = readdirSync5(sessionsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (!SESSION_ID_PATTERN.test(entry.name)) continue;
      const dirPath = join13(sessionsDir, entry.name);
      let fresh = false;
      try {
        if (now - statSync4(dirPath).mtimeMs < ACTIVITY_WINDOW_MS) {
          fresh = true;
        } else {
          for (const f of readdirSync5(dirPath)) {
            try {
              if (now - statSync4(join13(dirPath, f)).mtimeMs < ACTIVITY_WINDOW_MS) {
                fresh = true;
                break;
              }
            } catch {
            }
          }
        }
      } catch {
      }
      if (fresh) active++;
    }
  } catch {
    return 0;
  }
  return active;
}
function detectMultiRepo(cwd) {
  const key = cwd ? resolve4(cwd) : process.cwd();
  const cached = multiRepoCache.get(key);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.value;
  }
  let result = null;
  try {
    if (isGitRepo(key)) {
      multiRepoCache.set(key, { value: null, expiresAt: Date.now() + CACHE_TTL_MS3 });
      return null;
    }
    let subrepoCount = 0;
    try {
      const entries = readdirSync5(key, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith(".")) continue;
        if (looksLikeRepo(join13(key, entry.name))) subrepoCount++;
      }
    } catch {
    }
    if (subrepoCount < 2) {
      multiRepoCache.set(key, { value: null, expiresAt: Date.now() + CACHE_TTL_MS3 });
      return null;
    }
    const hasMarker = existsSync11(join13(key, ".omc-workspace"));
    const activeSessions = hasMarker ? countActiveSessions(key) : 0;
    result = {
      isMultiRepo: true,
      hasMarker,
      parentName: basename8(key),
      subrepoCount,
      activeSessions
    };
  } catch {
    result = null;
  }
  multiRepoCache.set(key, { value: result, expiresAt: Date.now() + CACHE_TTL_MS3 });
  return result;
}
function renderMultiRepo(cwd) {
  const info = detectMultiRepo(cwd);
  if (!info || !info.isMultiRepo) return null;
  if (!info.hasMarker) {
    return yellow("\u26A0 multi-repo detected") + dim(" \u2014 run: ") + cyan(`echo {} > "${info.parentName}/.omc-workspace"`) + dim(" to enable shared state");
  }
  const sessionsPart = info.activeSessions > 0 ? ` ${dim("sessions:~")}${green(String(info.activeSessions))}` : ` ${dim("sessions:~")}${dim("0")}`;
  return `${dim("mr:")}${cyan(info.parentName)} ${dim("repos:")}${cyan(String(info.subrepoCount))}` + sessionsPart;
}

// src/hud/elements/model.ts
function extractVersion(modelId) {
  const idMatch = modelId.match(/(?:opus|sonnet|haiku)-(\d+)-(\d+)/i);
  if (idMatch) return `${idMatch[1]}.${idMatch[2]}`;
  const singleSegmentIdMatch = modelId.match(/(?:^|[.-])claude-(?:opus|sonnet|haiku)-(\d+)$/i);
  if (singleSegmentIdMatch) return singleSegmentIdMatch[1];
  const legacyIdMatch = modelId.match(/claude-(\d+)(?:-(\d+))?-(?:opus|sonnet|haiku)/i);
  if (legacyIdMatch) {
    return legacyIdMatch[2] ? `${legacyIdMatch[1]}.${legacyIdMatch[2]}` : legacyIdMatch[1];
  }
  const displayMatch = modelId.match(/(?:opus|sonnet|haiku)\s+(\d+(?:\.\d+)?)/i);
  if (displayMatch) return displayMatch[1];
  return null;
}
function formatModelName(modelId, format2 = "short") {
  if (!modelId) return null;
  if (format2 === "full") {
    return truncateToWidth(modelId, 40);
  }
  const id = modelId.toLowerCase();
  let shortName = null;
  if (id.includes("opus")) shortName = "Opus";
  else if (id.includes("sonnet")) shortName = "Sonnet";
  else if (id.includes("haiku")) shortName = "Haiku";
  if (!shortName) {
    return truncateToWidth(modelId, 20);
  }
  if (format2 === "versioned") {
    const version = extractVersion(id);
    if (version) return `${shortName} ${version}`;
  }
  return shortName;
}
function renderModel(modelId, format2 = "versioned", labels = DEFAULT_HUD_LABELS) {
  const name = formatModelName(modelId, format2);
  if (!name) return null;
  return cyan(`${labels.model}: ${name}`);
}

// src/hud/elements/api-key-source.ts
import { existsSync as existsSync12, readFileSync as readFileSync12 } from "fs";
import { join as join14 } from "path";
function settingsFileHasApiKey(filePath) {
  try {
    if (!existsSync12(filePath)) return false;
    const content = readFileSync12(filePath, "utf-8");
    const settings = JSON.parse(content);
    const env = settings?.env;
    if (typeof env !== "object" || env === null) return false;
    return "ANTHROPIC_API_KEY" in env;
  } catch {
    return false;
  }
}
function detectApiKeySource(cwd) {
  if (cwd) {
    const projectSettings = join14(cwd, ".claude", "settings.local.json");
    if (settingsFileHasApiKey(projectSettings)) return "project";
  }
  const globalSettings = join14(getClaudeConfigDir(), "settings.json");
  if (settingsFileHasApiKey(globalSettings)) return "global";
  if (process.env.ANTHROPIC_API_KEY) return "env";
  return null;
}
function renderApiKeySource(source) {
  if (!source) return null;
  return `${dim("key:")}${cyan(source)}`;
}

// src/hud/elements/call-counts.ts
function shouldUseAscii(format2 = "auto") {
  if (format2 === "ascii") return true;
  if (format2 === "emoji") return false;
  return process.platform === "win32" || isWSL();
}
function getIcons(format2 = "auto", labels = DEFAULT_HUD_LABELS) {
  const useAscii = shouldUseAscii(format2);
  return {
    tool: useAscii ? `${labels.tool}:` : "\u{1F527}",
    agent: useAscii ? `${labels.agent}:` : "\u{1F916}",
    skill: useAscii ? `${labels.skill}:` : "\u26A1"
  };
}
function renderCallCounts(toolCalls, agentInvocations, skillUsages, format2 = "auto", labels = DEFAULT_HUD_LABELS) {
  const parts = [];
  const icons = getIcons(format2, labels);
  if (toolCalls > 0) {
    parts.push(`${icons.tool}${toolCalls}`);
  }
  if (agentInvocations > 0) {
    parts.push(`${icons.agent}${agentInvocations}`);
  }
  if (skillUsages > 0) {
    parts.push(`${icons.skill}${skillUsages}`);
  }
  return parts.length > 0 ? parts.join(" ") : null;
}

// src/hud/elements/context-warning.ts
var YELLOW9 = "\x1B[33m";
var RED7 = "\x1B[31m";
var BOLD2 = "\x1B[1m";
function renderContextLimitWarning(contextPercent, threshold, autoCompact) {
  const safePercent = Math.min(100, Math.max(0, Math.round(contextPercent)));
  if (safePercent < threshold) {
    return null;
  }
  const isCritical = safePercent >= 90;
  const color = isCritical ? RED7 : YELLOW9;
  const icon = isCritical ? "!!" : "!";
  const action = autoCompact ? "(auto-compact queued)" : "run /compact";
  return `${color}${BOLD2}[${icon}] ctx ${safePercent}% >= ${threshold}% threshold - ${action}${RESET}`;
}
function renderPayloadLimitWarning(payloadEstimate) {
  if (!payloadEstimate || payloadEstimate.pressure === "normal") {
    return null;
  }
  const isCritical = payloadEstimate.pressure === "critical";
  const color = isCritical ? RED7 : YELLOW9;
  const icon = isCritical ? "!!" : "!";
  const action = isCritical ? "compact may fail; consider new session" : "consider /compact soon";
  return `${color}${BOLD2}[${icon}] ${payloadEstimate.label} - ${action}${RESET}`;
}

// src/hud/elements/session-summary.ts
function renderSessionSummary(summaryState) {
  if (!summaryState?.summary) return null;
  return dim("summary:") + summaryState.summary;
}

// src/hud/elements/last-tool.ts
function renderLastTool(lastToolName) {
  if (!lastToolName) return null;
  return `${dim("tool:")}${lastToolName}`;
}

// src/hud/render.ts
var ANSI_REGEX = /\x1b\[[0-9;]*[a-zA-Z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/;
var PLAIN_SEPARATOR = " | ";
var DIM_SEPARATOR = dim(PLAIN_SEPARATOR);
function buildMainElementOrder(elementOrder) {
  if (!Array.isArray(elementOrder) || elementOrder.length === 0) {
    return DEFAULT_ELEMENT_ORDER.main;
  }
  const known = new Set(DEFAULT_ELEMENT_ORDER.main);
  const seen = /* @__PURE__ */ new Set();
  const configured = elementOrder.filter((name) => {
    if (!known.has(name) || seen.has(name)) {
      return false;
    }
    seen.add(name);
    return true;
  });
  const remaining = DEFAULT_ELEMENT_ORDER.main.filter(
    (name) => !configured.includes(name)
  );
  return [...configured, ...remaining];
}
function truncateLineToMaxWidth(line, maxWidth) {
  if (maxWidth <= 0) return "";
  if (stringWidth(line) <= maxWidth) return line;
  const ELLIPSIS = "...";
  const ellipsisWidth = 3;
  const targetWidth = Math.max(0, maxWidth - ellipsisWidth);
  let visibleWidth = 0;
  let result = "";
  let hasAnsi = false;
  let i = 0;
  while (i < line.length) {
    const remaining = line.slice(i);
    const ansiMatch = remaining.match(ANSI_REGEX);
    if (ansiMatch && ansiMatch.index === 0) {
      result += ansiMatch[0];
      hasAnsi = true;
      i += ansiMatch[0].length;
      continue;
    }
    const codePoint = line.codePointAt(i);
    const codeUnits = codePoint > 65535 ? 2 : 1;
    const char = line.slice(i, i + codeUnits);
    const charWidth = getCharWidth(char);
    if (visibleWidth + charWidth > targetWidth) break;
    result += char;
    visibleWidth += charWidth;
    i += codeUnits;
  }
  const reset = hasAnsi ? "\x1B[0m" : "";
  return result + reset + ELLIPSIS;
}
function wrapLineToMaxWidth(line, maxWidth) {
  if (maxWidth <= 0) return [""];
  if (stringWidth(line) <= maxWidth) return [line];
  const separator = line.includes(DIM_SEPARATOR) ? DIM_SEPARATOR : line.includes(PLAIN_SEPARATOR) ? PLAIN_SEPARATOR : null;
  if (!separator) {
    return [truncateLineToMaxWidth(line, maxWidth)];
  }
  const segments = line.split(separator);
  if (segments.length <= 1) {
    return [truncateLineToMaxWidth(line, maxWidth)];
  }
  const wrapped = [];
  let current = segments[0] ?? "";
  for (let i = 1; i < segments.length; i += 1) {
    const nextSegment = segments[i] ?? "";
    const candidate = `${current}${separator}${nextSegment}`;
    if (stringWidth(candidate) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (stringWidth(current) > maxWidth) {
      wrapped.push(truncateLineToMaxWidth(current, maxWidth));
    } else {
      wrapped.push(current);
    }
    current = nextSegment;
  }
  if (stringWidth(current) > maxWidth) {
    wrapped.push(truncateLineToMaxWidth(current, maxWidth));
  } else {
    wrapped.push(current);
  }
  return wrapped;
}
function applyMaxWidthByMode(lines, maxWidth, wrapMode) {
  if (!maxWidth || maxWidth <= 0) return lines;
  if (wrapMode === "wrap") {
    return lines.flatMap((line) => wrapLineToMaxWidth(line, maxWidth));
  }
  return lines.map((line) => truncateLineToMaxWidth(line, maxWidth));
}
function limitOutputLines(lines, maxLines) {
  const limit = Math.max(
    1,
    maxLines ?? DEFAULT_HUD_CONFIG.elements.maxOutputLines
  );
  if (lines.length <= limit) {
    return lines;
  }
  const truncatedCount = lines.length - limit + 1;
  return [...lines.slice(0, limit - 1), `... (+${truncatedCount} lines)`];
}
async function render(context, config) {
  const { elements: enabledElements } = config;
  const hudLabels = config.labels ?? DEFAULT_HUD_LABELS;
  const rendered = /* @__PURE__ */ new Map();
  const renderedDetail = /* @__PURE__ */ new Map();
  if (enabledElements.hostname) {
    const hostnameElement = renderHostname();
    if (hostnameElement) rendered.set("hostname", hostnameElement);
  }
  if (enabledElements.cwd) {
    const cwdElement = renderCwd(
      context.cwd,
      enabledElements.cwdFormat || "relative",
      enabledElements.useHyperlinks ?? false
    );
    if (cwdElement) rendered.set("cwd", cwdElement);
  }
  const multiRepoElement = enabledElements.gitRepo ? renderMultiRepo(context.cwd) : null;
  if (multiRepoElement) {
    rendered.set("gitRepo", multiRepoElement);
  } else {
    if (enabledElements.gitRepo) {
      const gitRepoElement = renderGitRepo(context.cwd);
      if (gitRepoElement) rendered.set("gitRepo", gitRepoElement);
    }
    if (enabledElements.gitBranch) {
      const gitBranchElement = renderGitBranch(context.cwd);
      if (gitBranchElement) rendered.set("gitBranch", gitBranchElement);
    }
    if (enabledElements.gitStatus) {
      const gitStatusElement = renderGitStatus(context.cwd, hudLabels);
      if (gitStatusElement) rendered.set("gitStatus", gitStatusElement);
    }
  }
  const modelSource = enabledElements.modelFormat === "full" ? context.modelId ?? context.modelName : context.modelName;
  if (enabledElements.model && modelSource) {
    const modelElement = renderModel(
      modelSource,
      enabledElements.modelFormat,
      hudLabels
    );
    if (modelElement) rendered.set("model", modelElement);
  }
  if (enabledElements.apiKeySource && context.apiKeySource) {
    const keySource = renderApiKeySource(context.apiKeySource);
    if (keySource) rendered.set("apiKeySource", keySource);
  }
  if (enabledElements.profile && context.profileName) {
    rendered.set("profile", bold(`profile:${context.profileName}`));
  }
  if (enabledElements.omcLabel) {
    const localSuffix = isRuntimePackageLocal() ? "L" : "";
    const versionTag = context.omcVersion ? `#${context.omcVersion}${localSuffix}` : localSuffix ? `#${localSuffix}` : "";
    if (enabledElements.updateNotification !== false && context.updateAvailable) {
      rendered.set(
        "omcLabel",
        bold(`[OMC${versionTag}] -> ${context.updateAvailable} omc update`)
      );
    } else {
      rendered.set("omcLabel", bold(`[OMC${versionTag}]`));
    }
  }
  const isEnterprise = enabledElements.enterpriseMode !== void 0 ? enabledElements.enterpriseMode : (context.subscriptionType ?? "").toLowerCase() === "enterprise" || /claude_zero/i.test(context.rateLimitTier ?? "");
  const enterpriseCostReplacesRateLimits = isEnterprise && context.rateLimitsResult?.rateLimits?.enterpriseSpentUsd !== void 0;
  if (enabledElements.rateLimits && context.rateLimitsResult && !enterpriseCostReplacesRateLimits) {
    if (context.rateLimitsResult.rateLimits) {
      const stale = context.rateLimitsResult.stale;
      const limits = enabledElements.useBars ? renderRateLimitsWithBar(
        context.rateLimitsResult.rateLimits,
        void 0,
        stale
      ) : renderRateLimits(context.rateLimitsResult.rateLimits, stale);
      if (limits) rendered.set("rateLimits", limits);
    } else {
      const errorIndicator = renderRateLimitsError(context.rateLimitsResult);
      if (errorIndicator) {
        rendered.set("rateLimits", errorIndicator);
      } else {
        const hint = renderApiKeyUsageHint(
          context.rateLimitsResult,
          context.apiKeyMode ?? false,
          config.rateLimitsProvider?.type === "custom"
        );
        if (hint) rendered.set("rateLimits", hint);
      }
    }
  }
  if (context.customBuckets) {
    const thresholdPercent = config.rateLimitsProvider?.resetsAtDisplayThresholdPercent;
    const custom = renderCustomBuckets(context.customBuckets, thresholdPercent);
    if (custom) rendered.set("customBuckets", custom);
  }
  if (enabledElements.permissionStatus && context.pendingPermission) {
    const permission = renderPermission(context.pendingPermission);
    if (permission) rendered.set("permission", permission);
  }
  if (enabledElements.thinking && context.thinkingState) {
    const thinking = renderThinking(
      context.thinkingState,
      enabledElements.thinkingFormat,
      hudLabels
    );
    if (thinking) rendered.set("thinking", thinking);
  }
  if (enabledElements.promptTime) {
    const prompt = renderPromptTime(context.promptTime, /* @__PURE__ */ new Date());
    if (prompt) rendered.set("promptTime", prompt);
  }
  if (enabledElements.sessionHealth && context.sessionHealth) {
    const showDuration = enabledElements.showSessionDuration ?? true;
    if (showDuration) {
      const session = renderSession(context.sessionHealth);
      if (session) rendered.set("session", session);
    }
  }
  if (isEnterprise && enabledElements.showEnterpriseCost !== false) {
    const stale = context.rateLimitsResult?.stale;
    const cost = renderEnterpriseCost(
      context.rateLimitsResult?.rateLimits,
      stale
    );
    if (cost) {
      rendered.set("enterpriseCost", cost);
    } else if (enabledElements.showTokens === true) {
      const tokenUsage = renderTokenUsage(
        context.lastRequestTokenUsage,
        context.sessionTotalTokens,
        hudLabels
      );
      if (tokenUsage) rendered.set("tokens", tokenUsage);
    }
  } else if (enabledElements.showTokens === true) {
    const tokenUsage = renderTokenUsage(
      context.lastRequestTokenUsage,
      context.sessionTotalTokens,
      hudLabels
    );
    if (tokenUsage) rendered.set("tokens", tokenUsage);
  }
  if (enabledElements.ralph && context.ralph) {
    const ralph = renderRalph(context.ralph, config.thresholds, hudLabels);
    if (ralph) rendered.set("ralph", ralph);
  }
  if (enabledElements.autopilot && context.autopilot) {
    const autopilot = renderAutopilot(context.autopilot, config.thresholds);
    if (autopilot) rendered.set("autopilot", autopilot);
  }
  if (enabledElements.prdStory && context.prd) {
    const prd = renderPrd(context.prd);
    if (prd) rendered.set("prd", prd);
  }
  if (enabledElements.activeSkills) {
    const skills = renderSkills(
      context.ultrawork,
      context.ralph,
      enabledElements.lastSkill ?? true ? context.lastSkill : null
    );
    if (skills) rendered.set("skills", skills);
  }
  if ((enabledElements.lastSkill ?? true) && !enabledElements.activeSkills) {
    const lastSkillElement = renderLastSkill(context.lastSkill);
    if (lastSkillElement) rendered.set("lastSkill", lastSkillElement);
  }
  if (enabledElements.contextBar && context.contextAvailable !== false) {
    const ctx = enabledElements.useBars ? renderContextWithBar(
      context.contextPercent,
      config.thresholds,
      10,
      context.contextDisplayScope,
      hudLabels
    ) : renderContext(
      context.contextPercent,
      config.thresholds,
      context.contextDisplayScope,
      hudLabels
    );
    if (ctx) rendered.set("contextBar", ctx);
  }
  if (enabledElements.agents) {
    const format2 = enabledElements.agentsFormat || "codes";
    if (format2 === "multiline") {
      const maxLines = enabledElements.agentsMaxLines || 5;
      const result = renderAgentsMultiLine(context.activeAgents, maxLines);
      if (result.headerPart) rendered.set("agents", result.headerPart);
      if (result.detailLines.length > 0) {
        renderedDetail.set("agents", result.detailLines);
      }
    } else {
      const agents = renderAgentsByFormat(context.activeAgents, format2);
      if (agents) rendered.set("agents", agents);
    }
  }
  if (enabledElements.backgroundTasks) {
    const bg = renderBackground(context.backgroundTasks, hudLabels);
    if (bg) rendered.set("background", bg);
  }
  const showCounts = enabledElements.showCallCounts ?? true;
  if (showCounts) {
    const counts = renderCallCounts(
      context.toolCallCount,
      context.agentCallCount,
      context.skillCallCount,
      enabledElements.callCountsFormat ?? "auto",
      hudLabels
    );
    if (counts) rendered.set("callCounts", counts);
  }
  if (enabledElements.showLastTool === true) {
    const tool = renderLastTool(context.lastToolName ?? null);
    if (tool) rendered.set("lastTool", tool);
  }
  if (enabledElements.sessionSummary && context.sessionSummary) {
    const summary = renderSessionSummary(context.sessionSummary);
    if (summary) rendered.set("sessionSummary", summary);
  }
  if (context.missionBoard && (config.missionBoard?.enabled ?? config.elements.missionBoard ?? false)) {
    const mbLines = renderMissionBoard(context.missionBoard, config.missionBoard);
    if (mbLines.length > 0) renderedDetail.set("missionBoard", mbLines);
  }
  if (context.contextAvailable !== false) {
    const ctxWarning = renderContextLimitWarning(
      context.contextPercent,
      config.contextLimitWarning.threshold,
      config.contextLimitWarning.autoCompact
    );
    if (ctxWarning) renderedDetail.set("contextWarning", [ctxWarning]);
  }
  const payloadWarning = renderPayloadLimitWarning(context.payloadEstimate);
  if (payloadWarning) renderedDetail.set("payloadWarning", [payloadWarning]);
  if (enabledElements.todos) {
    const todos = renderTodosWithCurrent(context.todos);
    if (todos) renderedDetail.set("todos", [todos]);
  }
  const safeArray = (v, fallback) => Array.isArray(v) ? v : fallback;
  const effectiveLayout = {
    line1: safeArray(config.layout?.line1, DEFAULT_ELEMENT_ORDER.line1),
    // `layout.main` remains the advanced authoritative layout control.
    // `elementOrder` is a narrow convenience alias for the main HUD line only.
    main: safeArray(config.layout?.main, buildMainElementOrder(config.elementOrder)),
    detail: safeArray(config.layout?.detail, DEFAULT_ELEMENT_ORDER.detail)
  };
  function collectInline(order) {
    const result = [];
    for (const name of order) {
      const el = rendered.get(name);
      if (el) {
        result.push(el);
      } else {
        const lines = renderedDetail.get(name);
        if (lines && lines.length > 0) result.push(lines.join(" "));
      }
    }
    return result;
  }
  function collectDetailLines(order) {
    const result = [];
    for (const name of order) {
      const lines = renderedDetail.get(name);
      if (lines) result.push(...lines);
      if (!lines) {
        const inline = rendered.get(name);
        if (inline) result.push(inline);
      }
    }
    return result;
  }
  const gitElements = collectInline(effectiveLayout.line1);
  const elements = collectInline(effectiveLayout.main);
  const detailLines = collectDetailLines(effectiveLayout.detail);
  const outputLines = [];
  const gitInfoLine = gitElements.length > 0 ? gitElements.join(dim(PLAIN_SEPARATOR)) : null;
  const headerLine = elements.length > 0 ? elements.join(dim(PLAIN_SEPARATOR)) : null;
  const gitPosition = config.elements.gitInfoPosition ?? "above";
  if (gitPosition === "above") {
    if (gitInfoLine) {
      outputLines.push(gitInfoLine);
    }
    if (headerLine) {
      outputLines.push(headerLine);
    }
  } else {
    if (headerLine) {
      outputLines.push(headerLine);
    }
    if (gitInfoLine) {
      outputLines.push(gitInfoLine);
    }
  }
  const widthAdjustedLines = applyMaxWidthByMode(
    [...outputLines, ...detailLines],
    config.maxWidth,
    config.wrapMode
  );
  const limitedLines = limitOutputLines(
    widthAdjustedLines,
    config.elements.maxOutputLines
  );
  const finalLines = config.maxWidth && config.maxWidth > 0 ? limitedLines.map(
    (line) => truncateLineToMaxWidth(line, config.maxWidth)
  ) : limitedLines;
  return finalLines.join("\n");
}

// src/hud/sanitize.ts
var CSI_NON_SGR_REGEX = /\x1b\[\??[0-9;]*[A-LN-Za-ln-z]/g;
var OSC_REGEX = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
var SIMPLE_ESC_REGEX = /\x1b[^[\]]/g;
function stripAnsi2(text) {
  return text.replace(CSI_NON_SGR_REGEX, "").replace(OSC_REGEX, "").replace(SIMPLE_ESC_REGEX, "");
}
function replaceUnicodeBlocks(text) {
  return text.replace(/█/g, "#").replace(/░/g, "-").replace(/▓/g, "=").replace(/▒/g, "-");
}
function sanitizeOutput(output) {
  let sanitized = stripAnsi2(output);
  sanitized = replaceUnicodeBlocks(sanitized);
  const lines = sanitized.split("\n").map((line) => line.trimEnd());
  sanitized = lines.join("\n");
  sanitized = sanitized.replace(/^\n+|\n+$/g, "");
  return sanitized;
}

// src/hud/payload-estimate.ts
import { closeSync as closeSync4, existsSync as existsSync13, openSync as openSync4, readSync as readSync3, statSync as statSync5 } from "fs";
var ANTHROPIC_REQUEST_PAYLOAD_LIMIT_BYTES = 32e6;
var PAYLOAD_WARNING_BYTES = 22e6;
var PAYLOAD_CRITICAL_BYTES = 26e6;
var COMPACT_BOUNDARY_MARKER = "compact_boundary";
var COMPACT_BOUNDARY_MARKER_BYTES = Buffer.from(COMPACT_BOUNDARY_MARKER);
var SCAN_CHUNK_BYTES = 64 * 1024;
var MAX_BOUNDARY_LINE_BYTES = 256 * 1024;
function toPressure(bytes) {
  if (bytes >= PAYLOAD_CRITICAL_BYTES) return "critical";
  if (bytes >= PAYLOAD_WARNING_BYTES) return "warning";
  return "normal";
}
function formatPayloadMegabytes(bytes) {
  const mb = bytes / 1e6;
  if (mb < 10) return mb.toFixed(1);
  return String(Math.round(mb));
}
function formatPayloadEstimateLabel(estimatedBytes, limitBytes = ANTHROPIC_REQUEST_PAYLOAD_LIMIT_BYTES) {
  return `payload est ~${formatPayloadMegabytes(estimatedBytes)} MB / ${formatPayloadMegabytes(limitBytes)} MB`;
}
function createPayloadEstimate(estimatedBytes, limitBytes = ANTHROPIC_REQUEST_PAYLOAD_LIMIT_BYTES) {
  if (!Number.isFinite(estimatedBytes) || estimatedBytes < 0) return null;
  return {
    estimatedBytes,
    limitBytes,
    pressure: toPressure(estimatedBytes),
    label: formatPayloadEstimateLabel(estimatedBytes, limitBytes)
  };
}
function containsCompactBoundaryMarker(value) {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) {
    return value.some(containsCompactBoundaryMarker);
  }
  return Object.entries(value).some(([key, nestedValue]) => {
    if (key === COMPACT_BOUNDARY_MARKER) return true;
    if ((key === "type" || key === "subtype" || key === "event" || key === "kind") && nestedValue === COMPACT_BOUNDARY_MARKER) {
      return true;
    }
    return containsCompactBoundaryMarker(nestedValue);
  });
}
function isCompactBoundaryLine(line) {
  const text = line.toString("utf8").trim();
  if (!text.includes(COMPACT_BOUNDARY_MARKER)) return false;
  if (text === COMPACT_BOUNDARY_MARKER) return true;
  try {
    return containsCompactBoundaryMarker(JSON.parse(text));
  } catch {
    return false;
  }
}
function findByteBackward(fd, fromExclusive, byte) {
  let end = fromExclusive;
  const buffer = Buffer.allocUnsafe(SCAN_CHUNK_BYTES);
  while (end > 0) {
    const start = Math.max(0, end - SCAN_CHUNK_BYTES);
    const length = end - start;
    readSync3(fd, buffer, 0, length, start);
    const index = buffer.subarray(0, length).lastIndexOf(byte);
    if (index !== -1) return start + index;
    end = start;
  }
  return -1;
}
function findByteForward(fd, fromInclusive, size, byte) {
  let start = fromInclusive;
  const buffer = Buffer.allocUnsafe(SCAN_CHUNK_BYTES);
  while (start < size) {
    const length = Math.min(SCAN_CHUNK_BYTES, size - start);
    readSync3(fd, buffer, 0, length, start);
    const index = buffer.subarray(0, length).indexOf(byte);
    if (index !== -1) return start + index;
    start += length;
  }
  return -1;
}
function readLineContainingOffset(fd, size, offset) {
  const previousNewline = findByteBackward(fd, offset, 10);
  const nextNewline = findByteForward(fd, offset, size, 10);
  const startOffset = previousNewline === -1 ? 0 : previousNewline + 1;
  const endOffset = nextNewline === -1 ? size : nextNewline + 1;
  const length = endOffset - startOffset;
  if (length <= 0 || length > MAX_BOUNDARY_LINE_BYTES) return null;
  const line = Buffer.allocUnsafe(length);
  readSync3(fd, line, 0, length, startOffset);
  return { line, endOffset };
}
function findLastCompactBoundaryEndOffset(transcriptPath, size) {
  if (size <= 0) return null;
  const fd = openSync4(transcriptPath, "r");
  try {
    let end = size;
    const buffer = Buffer.allocUnsafe(Math.min(SCAN_CHUNK_BYTES, size));
    while (end > 0) {
      const start = Math.max(0, end - SCAN_CHUNK_BYTES);
      const length = end - start;
      readSync3(fd, buffer, 0, length, start);
      const chunk = buffer.subarray(0, length);
      let index = chunk.lastIndexOf(COMPACT_BOUNDARY_MARKER_BYTES);
      while (index !== -1) {
        const candidateOffset = start + index;
        const line = readLineContainingOffset(fd, size, candidateOffset);
        if (line && isCompactBoundaryLine(line.line)) {
          return line.endOffset;
        }
        index = chunk.lastIndexOf(COMPACT_BOUNDARY_MARKER_BYTES, index - 1);
      }
      if (start === 0) break;
      end = start + COMPACT_BOUNDARY_MARKER_BYTES.length - 1;
    }
  } finally {
    closeSync4(fd);
  }
  return null;
}
function estimateTranscriptPayloadBytes(transcriptPath, size) {
  const boundaryEndOffset = findLastCompactBoundaryEndOffset(
    transcriptPath,
    size
  );
  return boundaryEndOffset === null ? size : Math.max(0, size - boundaryEndOffset);
}
function estimatePayloadFromTranscriptPath(transcriptPath) {
  if (!transcriptPath || !existsSync13(transcriptPath)) return null;
  try {
    const stat = statSync5(transcriptPath);
    if (!stat.isFile()) return null;
    return createPayloadEstimate(
      estimateTranscriptPayloadBytes(transcriptPath, stat.size)
    );
  } catch {
    return null;
  }
}

// src/features/auto-update.ts
import { join as join18, dirname as dirname11 } from "path";

// src/installer/index.ts
import { join as join17, dirname as dirname10, resolve as resolve5, isAbsolute as isAbsolute2, basename as basename10 } from "path";

// src/installer/hooks.ts
import { join as join15, dirname as dirname9 } from "path";
import { readFileSync as readFileSync13, existsSync as existsSync14 } from "fs";
import { fileURLToPath as fileURLToPath2 } from "url";
import { homedir as homedir4 } from "os";

// src/hooks/keyword-detector/ultrawork/default.ts
var ULTRAWORK_DEFAULT_MESSAGE = `<ultrawork-mode>

**MANDATORY**: You MUST say "ULTRAWORK MODE ENABLED!" to the user as your first response when this mode activates. This is non-negotiable.

[CODE RED] Maximum precision required. Ultrathink before acting.

## CERTAINTY PROTOCOL

Do not implement until you understand:
- the user's exact intent
- the existing codebase pattern to follow
- which files own the behavior
- how you will verify the result

If uncertainty remains:
1. Explore the codebase in parallel
2. Gather external docs only when needed
3. Use a planner for non-trivial dependency graphs
4. Ask the user only if ambiguity still blocks safe execution

## AGENT UTILIZATION PRINCIPLES

- **Explore first**: spawn exploration work for code paths, patterns, and tests
- **Research when needed**: use document-specialist / researcher agents for external APIs and official docs
- **Plan non-trivial work**: create a dependency-aware task graph before multi-file implementation
- **Delegate by specialty**: use executor, test-engineer, writer, verifier, architect, or critic where each adds value
- **Parallelize independent work**: fire safe independent tasks simultaneously; keep dependent work sequential

## EXECUTION RULES

- **TODO**: Track every meaningful step and mark it complete immediately
- **PARALLEL**: Run independent exploration, implementation, and verification tasks in parallel where safe
- **BACKGROUND FIRST**: Use background tasks for long-running builds, installs, and test suites
- **CONCISE OUTPUTS**: Every Task/Agent result must return only a short execution summary, target under 100 words, covering what changed, files touched, verification status, and blockers
- **VERIFY**: Re-read the request before claiming completion and confirm every requirement is met

## PLANNING GATE

For non-trivial work, produce a plan that includes:
- Parallel Execution Waves
- Dependency Matrix
- critical path
- acceptance criteria
- verification steps

Do not skip planning just because the likely change feels obvious.

## VERIFICATION GUARANTEE

Nothing is done without proof.

Before reporting completion, collect evidence for:
- build/typecheck success
- relevant tests passing
- manual QA or direct feature exercise when applicable
- no new diagnostics on changed files

WITHOUT evidence = NOT verified = NOT done.

</ultrawork-mode>

---
`;
function getDefaultUltraworkMessage() {
  return ULTRAWORK_DEFAULT_MESSAGE;
}

// src/installer/hooks.ts
function getPackageDir() {
  if (typeof __dirname !== "undefined") {
    return join15(__dirname, "..");
  }
  try {
    const __filename = fileURLToPath2(import.meta.url);
    const __dirname2 = dirname9(__filename);
    return join15(__dirname2, "..", "..");
  } catch {
    return process.cwd();
  }
}
function loadTemplate(filename) {
  const templatePath = join15(getPackageDir(), "templates", "hooks", filename);
  if (!existsSync14(templatePath)) {
    return "";
  }
  return readFileSync13(templatePath, "utf-8");
}
function isWindows() {
  return process.platform === "win32";
}
function normalizePath(value) {
  return value.replace(/\\/g, "/").replace(/\/+$/, "");
}
function isDefaultClaudeConfigDir() {
  return normalizePath(getClaudeConfigDir()) === normalizePath(join15(homedir4(), ".claude"));
}
function quoteCommandPath(path3) {
  return `"${path3.replace(/"/g, '\\"')}"`;
}
function buildHookCommand(filename) {
  if (isWindows()) {
    return `node ${quoteCommandPath(join15(getClaudeConfigDir(), "hooks", filename).replace(/\\/g, "/"))}`;
  }
  if (isDefaultClaudeConfigDir()) {
    return `node "\${CLAUDE_CONFIG_DIR:-$HOME/.claude}/hooks/${filename}"`;
  }
  return `node ${quoteCommandPath(join15(getClaudeConfigDir(), "hooks", filename).replace(/\\/g, "/"))}`;
}
var ULTRAWORK_MESSAGE = getDefaultUltraworkMessage();
var KEYWORD_DETECTOR_SCRIPT_NODE = loadTemplate(
  "keyword-detector.mjs"
);
var STOP_CONTINUATION_SCRIPT_NODE = loadTemplate(
  "stop-continuation.mjs"
);
var PERSISTENT_MODE_SCRIPT_NODE = loadTemplate("persistent-mode.mjs");
var CODE_SIMPLIFIER_SCRIPT_NODE = loadTemplate("code-simplifier.mjs");
var SESSION_START_SCRIPT_NODE = loadTemplate("session-start.mjs");
var POST_TOOL_USE_SCRIPT_NODE = loadTemplate("post-tool-use.mjs");
var HOOKS_SETTINGS_CONFIG_NODE = {
  hooks: {
    UserPromptSubmit: [
      {
        hooks: [
          {
            type: "command",
            command: buildHookCommand("keyword-detector.mjs")
          }
        ]
      }
    ],
    SessionStart: [
      {
        hooks: [
          {
            type: "command",
            command: buildHookCommand("session-start.mjs")
          }
        ]
      }
    ],
    PreToolUse: [
      {
        hooks: [
          {
            type: "command",
            command: buildHookCommand("pre-tool-use.mjs")
          }
        ]
      }
    ],
    PostToolUse: [
      {
        hooks: [
          {
            type: "command",
            command: buildHookCommand("post-tool-use.mjs")
          }
        ]
      }
    ],
    PostToolUseFailure: [
      {
        hooks: [
          {
            type: "command",
            command: buildHookCommand("post-tool-use-failure.mjs")
          }
        ]
      }
    ],
    Stop: [
      {
        hooks: [
          {
            type: "command",
            command: buildHookCommand("persistent-mode.mjs")
          }
        ]
      },
      {
        hooks: [
          {
            type: "command",
            command: buildHookCommand("code-simplifier.mjs")
          }
        ]
      }
    ]
  }
};

// src/lib/paths.ts
var OMC_PLUGIN_MARKETPLACE_SLUG = "omc";
var OMC_PLUGIN_PACKAGE_NAME = "oh-my-claudecode";
var OMC_PLUGIN_CACHE_REL = `plugins/cache/${OMC_PLUGIN_MARKETPLACE_SLUG}/${OMC_PLUGIN_PACKAGE_NAME}`;
var OMC_PLUGIN_MARKETPLACE_REL = `plugins/marketplaces/${OMC_PLUGIN_MARKETPLACE_SLUG}`;
var OMC_CONFIG_FILE_REL = ".omc-config.json";

// src/utils/user-skill-compat.ts
import { basename as basename9, join as join16 } from "path";
var CLAUDE_SKILLS_DIR = join16(getClaudeConfigDir(), "skills");
var OMC_LEARNED_DIR = join16(CLAUDE_SKILLS_DIR, "omc-learned");

// src/installer/claude-md-transaction.ts
var CLAUDE_MD_IMPORT_START = "<!-- OMC:IMPORT:START -->";
var CLAUDE_MD_IMPORT_END = "<!-- OMC:IMPORT:END -->";
var CLAUDE_MD_IMPORT_BLOCK = `${CLAUDE_MD_IMPORT_START}
@CLAUDE-omc.md
${CLAUDE_MD_IMPORT_END}
`;

// src/installer/index.ts
var CLAUDE_CONFIG_DIR = getClaudeConfigDir();
var AGENTS_DIR = join17(CLAUDE_CONFIG_DIR, "agents");
var COMMANDS_DIR = join17(CLAUDE_CONFIG_DIR, "commands");
var SKILLS_DIR = join17(CLAUDE_CONFIG_DIR, "skills");
var HOOKS_DIR = join17(CLAUDE_CONFIG_DIR, "hooks");
var HUD_DIR = join17(CLAUDE_CONFIG_DIR, "hud");
var SETTINGS_FILE = join17(CLAUDE_CONFIG_DIR, "settings.json");
var VERSION_FILE = join17(CLAUDE_CONFIG_DIR, ".omc-version.json");
var VERSION = getRuntimePackageVersion();

// src/features/auto-update.ts
var REPO_OWNER = "Yeachan-Heo";
var REPO_NAME = "oh-my-claudecode";
var GITHUB_API_URL = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}`;
var GITHUB_RAW_URL = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}`;
var CLAUDE_CONFIG_DIR2 = getClaudeConfigDir();
var VERSION_FILE2 = join18(CLAUDE_CONFIG_DIR2, ".omc-version.json");
var CONFIG_FILE = join18(CLAUDE_CONFIG_DIR2, OMC_CONFIG_FILE_REL);
function compareVersions(a, b) {
  const cleanA = a.replace(/^v/, "");
  const cleanB = b.replace(/^v/, "");
  const partsA = cleanA.split(".").map((n) => parseInt(n, 10) || 0);
  const partsB = cleanB.split(".").map((n) => parseInt(n, 10) || 0);
  const maxLength = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < maxLength; i++) {
    const numA = partsA[i] || 0;
    const numB = partsB[i] || 0;
    if (numA < numB) return -1;
    if (numA > numB) return 1;
  }
  return 0;
}
var SILENT_UPDATE_STATE_FILE = join18(CLAUDE_CONFIG_DIR2, ".omc-silent-update.json");

// src/hud/index.ts
import { writeFileSync as writeFileSync5, mkdirSync as mkdirSync8, existsSync as existsSync15, readFileSync as readFileSync14 } from "fs";
import { access, readFile } from "fs/promises";
import { join as join19, basename as basename11, dirname as dirname12 } from "path";
import { spawn as spawn2 } from "child_process";
import { fileURLToPath as fileURLToPath3 } from "url";
function extractSessionIdFromPath(transcriptPath) {
  if (!transcriptPath) return null;
  const match = transcriptPath.match(/([0-9a-f-]{36})(?:\.jsonl)?$/i);
  return match ? match[1] : null;
}
function mergeStdinRateLimits(stdinRateLimits, usageResult) {
  if (!stdinRateLimits) {
    return usageResult;
  }
  return {
    ...usageResult ?? {},
    rateLimits: {
      ...usageResult?.rateLimits ?? {},
      ...stdinRateLimits
    }
  };
}
function readSessionSummary(stateDir, sessionId) {
  const statePath = join19(stateDir, `session-summary-${sessionId}.json`);
  if (!existsSync15(statePath)) return null;
  try {
    return JSON.parse(readFileSync14(statePath, "utf-8"));
  } catch {
    return null;
  }
}
var lastSummarySpawnTimestamp = 0;
var summaryProcessPid = null;
function _resetSummarySpawnTimestamp() {
  lastSummarySpawnTimestamp = 0;
  summaryProcessPid = null;
}
function _getSummaryProcessPid() {
  return summaryProcessPid;
}
function spawnSessionSummaryScript(transcriptPath, stateDir, sessionId) {
  if (summaryProcessPid !== null) {
    try {
      process.kill(summaryProcessPid, 0);
      return;
    } catch {
      summaryProcessPid = null;
    }
  }
  const now = Date.now();
  if (now - lastSummarySpawnTimestamp < 12e4) {
    return;
  }
  lastSummarySpawnTimestamp = now;
  const thisDir = dirname12(fileURLToPath3(import.meta.url));
  const scriptPath = [
    join19(thisDir, "..", "..", "scripts", "session-summary.mjs"),
    join19(thisDir, "..", "scripts", "session-summary.mjs")
  ].find((candidate) => existsSync15(candidate));
  if (!scriptPath) {
    if (process.env.OMC_DEBUG) {
      console.error("[HUD] session-summary script not found");
    }
    return;
  }
  try {
    const child = spawn2(
      "node",
      [scriptPath, transcriptPath, stateDir, sessionId],
      {
        stdio: "ignore",
        detached: true,
        env: { ...process.env, CLAUDE_CODE_ENTRYPOINT: "session-summary" }
      }
    );
    summaryProcessPid = child.pid ?? null;
    child.unref();
  } catch (error) {
    summaryProcessPid = null;
    if (process.env.OMC_DEBUG) {
      console.error(
        "[HUD] Failed to spawn session-summary:",
        error instanceof Error ? error.message : error
      );
    }
  }
}
async function calculateSessionHealth(sessionStart, contextPercent) {
  const durationMs = sessionStart ? Date.now() - sessionStart.getTime() : 0;
  const durationMinutes = Math.floor(durationMs / 6e4);
  let health = "healthy";
  if (durationMinutes > 120 || contextPercent > 85) health = "critical";
  else if (durationMinutes > 60 || contextPercent > 70) health = "warning";
  return { durationMinutes, messageCount: 0, health };
}
function showDiagnostic() {
  const version = getRuntimePackageVersion();
  const configDir = getClaudeConfigDir();
  const isCopilot = process.env.OMC_HOST?.toLowerCase() === "copilot";
  const hostName = isCopilot ? "GitHub Copilot CLI" : "Claude Code";
  const hudScript = join19(configDir, "hud", "omc-hud.mjs");
  const settingsFile = join19(configDir, "settings.json");
  const hudExists = existsSync15(hudScript);
  let statusLineOk = false;
  try {
    const settings = parseJsonc(readFileSync14(settingsFile, "utf-8"));
    const sl = settings.statusLine;
    if (sl && typeof sl === "object" && typeof sl.command === "string") {
      statusLineOk = sl.command.includes("omc-hud");
    } else if (typeof sl === "string") {
      statusLineOk = sl.includes("omc-hud");
    }
  } catch {
  }
  const config = readHudConfig();
  const preset = config.preset ?? "focused";
  console.log(`[OMC] HUD v${version} | preset: ${preset}`);
  console.log(`  HUD script:  ${hudExists ? "installed" : "MISSING"}`);
  console.log(`  statusLine:  ${statusLineOk ? "configured" : "NOT configured"}`);
  if (!hudExists || !statusLineOk) {
    console.log("  Run /oh-my-claudecode:hud setup to fix.");
  } else {
    console.log(`  HUD renders automatically inside ${hostName} sessions.`);
  }
}
async function main(watchMode = false, skipInit = false) {
  try {
    const previousStdinCache = readStdinCache();
    let stdin = await readStdin();
    if (stdin) {
      stdin = stabilizeContextPercent(stdin, previousStdinCache);
      writeStdinCache(stdin);
    } else if (watchMode) {
      stdin = previousStdinCache;
      if (!stdin) {
        console.log("[OMC] Starting...");
        return;
      }
    } else {
      showDiagnostic();
      return;
    }
    const cwd = resolveToWorktreeRoot(stdin.cwd || void 0);
    const config = { ...readHudConfig() };
    if (config.maxWidth === void 0) {
      const cols = process.stderr.columns || process.stdout.columns || parseInt(process.env.COLUMNS ?? "0", 10) || 0;
      if (cols > 0) {
        config.maxWidth = cols;
        if (config.wrapMode === "truncate") config.wrapMode = "wrap";
      }
    }
    const resolvedTranscriptPath = resolveTranscriptPath(
      stdin.transcript_path,
      cwd
    );
    const transcriptData = await parseTranscript(resolvedTranscriptPath, {
      staleTaskThresholdMinutes: config.staleTaskThresholdMinutes
    });
    const currentSessionId = extractSessionIdFromPath(
      resolvedTranscriptPath ?? stdin.transcript_path ?? ""
    );
    if (!skipInit) {
      await initializeHUDState(cwd, currentSessionId ?? void 0);
    }
    const ralph = readRalphStateForHud(cwd, currentSessionId ?? void 0);
    const ultrawork = readUltraworkStateForHud(
      cwd,
      currentSessionId ?? void 0
    );
    const prd = readPrdStateForHud(cwd);
    const autopilot = readAutopilotStateForHud(
      cwd,
      currentSessionId ?? void 0
    );
    const hudState = readHudState(cwd, currentSessionId ?? void 0);
    const _backgroundTasks = hudState?.backgroundTasks || [];
    let sessionStart = transcriptData.sessionStart;
    const sameSession = hudState?.sessionId === currentSessionId;
    if (sameSession && hudState?.sessionStartTimestamp) {
      const persisted = new Date(hudState.sessionStartTimestamp);
      if (!isNaN(persisted.getTime())) {
        sessionStart = persisted;
      }
    } else if (sessionStart) {
      const stateToWrite = hudState || {
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        backgroundTasks: []
      };
      stateToWrite.sessionStartTimestamp = sessionStart.toISOString();
      stateToWrite.sessionId = currentSessionId ?? void 0;
      stateToWrite.timestamp = (/* @__PURE__ */ new Date()).toISOString();
      writeHudState(stateToWrite, cwd, currentSessionId ?? void 0);
    }
    const stdinRateLimits = getRateLimitsFromStdin(stdin);
    const usageResult = config.elements.rateLimits === false ? null : await getUsage();
    const rateLimitsResult = config.elements.rateLimits === false ? null : mergeStdinRateLimits(stdinRateLimits, usageResult);
    const customBuckets = config.rateLimitsProvider?.type === "custom" ? await executeCustomProvider(config.rateLimitsProvider) : null;
    let omcVersion = null;
    let updateAvailable = null;
    try {
      omcVersion = getRuntimePackageVersion();
      if (omcVersion === "unknown") omcVersion = null;
    } catch (error) {
      if (process.env.OMC_DEBUG) {
        console.error(
          "[HUD] Version detection error:",
          error instanceof Error ? error.message : error
        );
      }
    }
    try {
      const updateCacheFile = getUpdateCheckCachePath();
      await access(updateCacheFile);
      const content = await readFile(updateCacheFile, "utf-8");
      const cached = JSON.parse(content);
      if (cached?.latestVersion && omcVersion && compareVersions(omcVersion, cached.latestVersion) < 0) {
        updateAvailable = cached.latestVersion;
      }
    } catch (error) {
      if (process.env.OMC_DEBUG) {
        console.error(
          "[HUD] Update cache read error:",
          error instanceof Error ? error.message : error
        );
      }
    }
    let sessionSummary = null;
    const sessionSummaryEnabled = config.elements.sessionSummary ?? false;
    if (sessionSummaryEnabled && resolvedTranscriptPath && currentSessionId) {
      const omcStateDir = join19(getOmcRoot(cwd), "state");
      sessionSummary = readSessionSummary(omcStateDir, currentSessionId);
      const shouldSpawn = !sessionSummary?.generatedAt || Date.now() - new Date(sessionSummary.generatedAt).getTime() > 6e4;
      if (shouldSpawn) {
        spawnSessionSummaryScript(
          resolvedTranscriptPath,
          omcStateDir,
          currentSessionId
        );
      }
    }
    const missionBoardEnabled = config.missionBoard?.enabled ?? config.elements.missionBoard ?? false;
    const missionBoard = missionBoardEnabled ? await refreshMissionBoardState(cwd, config.missionBoard) : null;
    const contextPercent = getContextPercent(stdin);
    const payloadEstimate = estimatePayloadFromTranscriptPath(resolvedTranscriptPath);
    const subscriptionInfo = (() => {
      try {
        return getSubscriptionInfo() ?? { subscriptionType: null, rateLimitTier: null };
      } catch {
        return { subscriptionType: null, rateLimitTier: null };
      }
    })();
    const context = {
      contextPercent,
      contextAvailable: stdin.context_window !== void 0,
      contextDisplayScope: currentSessionId ?? cwd,
      modelName: getModelName(stdin),
      modelId: getModelId(stdin),
      ralph,
      ultrawork,
      prd,
      autopilot,
      activeAgents: transcriptData.agents.filter((a) => a.status === "running"),
      todos: transcriptData.todos,
      backgroundTasks: getRunningTasks(hudState),
      cwd,
      missionBoard,
      lastSkill: transcriptData.lastActivatedSkill || null,
      rateLimitsResult,
      customBuckets,
      pendingPermission: transcriptData.pendingPermission || null,
      thinkingState: transcriptData.thinkingState || null,
      sessionHealth: await calculateSessionHealth(sessionStart, contextPercent),
      lastRequestTokenUsage: transcriptData.lastRequestTokenUsage || null,
      sessionTotalTokens: transcriptData.sessionTotalTokens ?? null,
      omcVersion,
      updateAvailable,
      toolCallCount: transcriptData.toolCallCount,
      agentCallCount: transcriptData.agentCallCount,
      skillCallCount: transcriptData.skillCallCount,
      promptTime: hudState?.lastPromptTimestamp ? new Date(hudState.lastPromptTimestamp) : null,
      apiKeySource: config.elements.apiKeySource ? detectApiKeySource(cwd) : null,
      apiKeyMode: detectApiKeySource(cwd) !== null,
      subscriptionType: subscriptionInfo.subscriptionType,
      rateLimitTier: subscriptionInfo.rateLimitTier,
      profileName: process.env.CLAUDE_CONFIG_DIR ? basename11(process.env.CLAUDE_CONFIG_DIR).replace(/^\./, "") : null,
      sessionSummary,
      lastToolName: transcriptData.lastToolName,
      payloadEstimate
    };
    if (process.env.OMC_DEBUG) {
      console.error(
        "[HUD DEBUG] stdin.context_window:",
        JSON.stringify(stdin.context_window)
      );
      console.error(
        "[HUD DEBUG] sessionHealth:",
        JSON.stringify(context.sessionHealth)
      );
    }
    if (context.contextAvailable !== false && config.contextLimitWarning.autoCompact && context.contextPercent >= config.contextLimitWarning.threshold) {
      try {
        const omcStateDir = join19(getOmcRoot(cwd), "state");
        mkdirSync8(omcStateDir, { recursive: true });
        const triggerFile = join19(omcStateDir, "compact-requested.json");
        writeFileSync5(
          triggerFile,
          JSON.stringify({
            requestedAt: (/* @__PURE__ */ new Date()).toISOString(),
            contextPercent: context.contextPercent,
            threshold: config.contextLimitWarning.threshold
          })
        );
      } catch (error) {
        if (process.env.OMC_DEBUG) {
          console.error(
            "[HUD] Auto-compact trigger write error:",
            error instanceof Error ? error.message : error
          );
        }
      }
    }
    let output = await render(context, config);
    const useSafeMode = config.elements.safeMode !== false && (config.elements.safeMode || process.platform === "win32");
    if (useSafeMode) {
      output = sanitizeOutput(output);
      console.log(output);
    } else {
      const formattedOutput = output.replace(/ /g, "\xA0");
      console.log(formattedOutput);
    }
  } catch (error) {
    const isInstallError = error instanceof Error && (error.message.includes("ENOENT") || error.message.includes("MODULE_NOT_FOUND") || error.message.includes("Cannot find module"));
    if (isInstallError) {
      if (process.env.OMC_HOST?.toLowerCase() === "copilot") {
        console.log("[OMC] run /oh-my-claudecode:hud repair or /oh-my-claudecode:setup doctor");
      } else {
        console.log("[OMC] run /omc-setup to install properly");
      }
    } else {
      console.log("[OMC] HUD error - check stderr");
      console.error(
        "[OMC HUD Error]",
        error instanceof Error ? error.message : error
      );
    }
  }
}
main();
export {
  _getSummaryProcessPid,
  _resetSummarySpawnTimestamp,
  main
};
