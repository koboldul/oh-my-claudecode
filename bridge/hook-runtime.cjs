"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/utils/config-dir.ts
function stripTrailingSep(p) {
  if (!p.endsWith(import_path.sep)) {
    return p;
  }
  return p === (0, import_path.parse)(p).root ? p : p.slice(0, -1);
}
function getClaudeConfigDir() {
  const home = (0, import_os.homedir)();
  const configured = process.env.CLAUDE_CONFIG_DIR?.trim();
  if (!configured) {
    return stripTrailingSep((0, import_path.normalize)((0, import_path.join)(home, ".claude")));
  }
  if (configured === "~") {
    return stripTrailingSep((0, import_path.normalize)(home));
  }
  if (configured.startsWith("~/") || configured.startsWith("~\\")) {
    return stripTrailingSep((0, import_path.normalize)((0, import_path.join)(home, configured.slice(2))));
  }
  return stripTrailingSep((0, import_path.normalize)(configured));
}
var import_path, import_os;
var init_config_dir = __esm({
  "src/utils/config-dir.ts"() {
    "use strict";
    import_path = require("path");
    import_os = require("os");
  }
});

// src/utils/encode-project-path.ts
function encodeProjectPath(projectPath) {
  return projectPath.replace(/[^a-zA-Z0-9]/g, "-");
}
var init_encode_project_path = __esm({
  "src/utils/encode-project-path.ts"() {
    "use strict";
  }
});

// src/lib/worktree-paths.ts
function findWorkspaceRoot(startDir) {
  if (process.env.OMC_DISABLE_MULTIREPO === "1") return null;
  const effectiveStart = startDir || process.cwd();
  let current;
  try {
    current = (0, import_path2.resolve)(effectiveStart);
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
      return (0, import_path2.resolve)((0, import_os2.homedir)());
    } catch {
      return null;
    }
  })();
  let cursor = current;
  let result = null;
  while (true) {
    if (home && cursor === home) break;
    if ((0, import_fs.existsSync)((0, import_path2.join)(cursor, WORKSPACE_MARKER))) {
      result = cursor;
      break;
    }
    const parent = (0, import_path2.dirname)(cursor);
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
    const raw = (0, import_fs.readFileSync)((0, import_path2.join)(workspaceRoot, WORKSPACE_MARKER), "utf-8").trim();
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
  const cacheKey = (0, import_path2.resolve)(cwd);
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
      superRoot = (0, import_child_process.execFileSync)("git", ["rev-parse", "--show-superproject-working-tree"], {
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
  let probe = (0, import_path2.resolve)(directory);
  while (true) {
    if ((0, import_fs.existsSync)((0, import_path2.join)(probe, ".git"))) return true;
    const parent = (0, import_path2.dirname)(probe);
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
    const root = (0, import_child_process.execFileSync)("git", ["rev-parse", "--show-toplevel"], {
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
  if (inputPath.startsWith("~") || (0, import_path2.isAbsolute)(inputPath)) {
    throw new Error(`Invalid path: absolute paths not allowed (${inputPath})`);
  }
}
function getProjectIdentifier(worktreeRoot) {
  const root = worktreeRoot || getGitTopLevel() || process.cwd();
  const workspaceRoot = findWorkspaceRoot(root);
  if (workspaceRoot) {
    const cfg = readWorkspaceMarkerConfig(workspaceRoot);
    if (cfg.id && typeof cfg.id === "string" && cfg.id.trim()) {
      const safeId = cfg.id.trim().replace(/[^a-zA-Z0-9_-]/g, "_");
      const hash3 = (0, import_crypto.createHash)("sha256").update(safeId).digest("hex").slice(0, 16);
      return `${safeId}-${hash3}`;
    }
    const hash2 = (0, import_crypto.createHash)("sha256").update(workspaceRoot).digest("hex").slice(0, 16);
    const dirName2 = (0, import_path2.basename)(workspaceRoot).replace(/[^a-zA-Z0-9_-]/g, "_");
    return `${dirName2}-${hash2}`;
  }
  let source;
  try {
    const remoteUrl = (0, import_child_process.execFileSync)("git", ["remote", "get-url", "origin"], {
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
    const commonDir = (0, import_child_process.execFileSync)("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
      cwd: root,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      timeout: 5e3
    }).trim();
    const isGitDir = (0, import_path2.basename)(commonDir) === ".git";
    const isSubmodule = commonDir.includes(`${import_path2.sep}.git${import_path2.sep}modules`);
    if (isGitDir && !isSubmodule) {
      const resolved = (0, import_path2.dirname)(commonDir);
      if (resolved && resolved !== root) {
        primaryRoot = resolved;
      }
    }
  } catch {
  }
  const hash = (0, import_crypto.createHash)("sha256").update(source).digest("hex").slice(0, 16);
  const dirName = (0, import_path2.basename)(primaryRoot).replace(/[^a-zA-Z0-9_-]/g, "_");
  return `${dirName}-${hash}`;
}
function getOmcRoot(worktreeRoot) {
  const customDir = process.env.OMC_STATE_DIR;
  if (customDir) {
    const root2 = worktreeRoot || getGitTopLevel() || process.cwd();
    const projectId = getProjectIdentifier(root2);
    const centralizedPath = (0, import_path2.join)(customDir, projectId);
    const legacyPath = (0, import_path2.join)(root2, OmcPaths.ROOT);
    const warningKey = `${legacyPath}:${centralizedPath}`;
    if (!dualDirWarnings.has(warningKey) && (0, import_fs.existsSync)(legacyPath) && (0, import_fs.existsSync)(centralizedPath)) {
      dualDirWarnings.add(warningKey);
      console.warn(
        `[omc] Both legacy state dir (${legacyPath}) and centralized state dir (${centralizedPath}) exist. Using centralized dir. Consider migrating data from the legacy dir and removing it.`
      );
    }
    return centralizedPath;
  }
  const workspaceAnchor = findWorkspaceRoot(worktreeRoot);
  if (workspaceAnchor) {
    return (0, import_path2.join)(workspaceAnchor, OmcPaths.ROOT);
  }
  const root = resolveStateAnchorRoot(worktreeRoot);
  return (0, import_path2.join)(root, OmcPaths.ROOT);
}
function resolveOmcPath(relativePath, worktreeRoot) {
  validatePath(relativePath);
  const omcDir = getOmcRoot(worktreeRoot);
  const fullPath = (0, import_path2.normalize)((0, import_path2.resolve)(omcDir, relativePath));
  const relativeToOmc = (0, import_path2.relative)(omcDir, fullPath);
  if (relativeToOmc.startsWith("..") || relativeToOmc.startsWith(import_path2.sep + "..")) {
    throw new Error(`Path escapes omc boundary: ${relativePath}`);
  }
  return fullPath;
}
function resolveStatePath(stateName, worktreeRoot) {
  const normalizedName = stateName.endsWith("-state") ? stateName : `${stateName}-state`;
  return resolveOmcPath(`state/${normalizedName}.json`, worktreeRoot);
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
  const effectiveRead = (0, import_fs.existsSync)(sessionScoped) ? sessionScoped : legacy;
  return {
    sessionScoped,
    legacy,
    effectiveRead,
    effectiveWrite: sessionScoped
  };
}
function getSessionStateDir(sessionId, worktreeRoot) {
  validateSessionId(sessionId);
  return (0, import_path2.join)(getOmcRoot(worktreeRoot), "state", "sessions", sessionId);
}
function resolveTranscriptPath(transcriptPath, cwd) {
  if (!transcriptPath) return void 0;
  if ((0, import_fs.existsSync)(transcriptPath)) return transcriptPath;
  const worktreeSegmentPattern = /--claude-worktrees-[^/\\]+/;
  if (worktreeSegmentPattern.test(transcriptPath)) {
    const resolved = transcriptPath.replace(worktreeSegmentPattern, "");
    if ((0, import_fs.existsSync)(resolved)) return resolved;
  }
  const effectiveCwd = cwd || process.cwd();
  const normalizedCwd = (0, import_path2.normalize)(effectiveCwd);
  const worktreeMarker = (0, import_path2.normalize)("/.claude/worktrees/");
  const markerIdx = normalizedCwd.indexOf(worktreeMarker);
  if (markerIdx !== -1) {
    const mainProjectRoot = normalizedCwd.substring(0, markerIdx);
    const sessionFile = (0, import_path2.basename)(transcriptPath);
    if (sessionFile) {
      const projectsDir = (0, import_path2.join)(getClaudeConfigDir(), "projects");
      if ((0, import_fs.existsSync)(projectsDir)) {
        const encodedMain = encodeProjectPath(mainProjectRoot);
        const resolvedPath = (0, import_path2.join)(projectsDir, encodedMain, sessionFile);
        if ((0, import_fs.existsSync)(resolvedPath)) return resolvedPath;
      }
    }
  }
  const worktreeTop = getGitTopLevel(effectiveCwd);
  if (!worktreeTop) return transcriptPath;
  try {
    const gitCommonDir = (0, import_child_process.execFileSync)("git", ["rev-parse", "--git-common-dir"], {
      cwd: effectiveCwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      timeout: 5e3
    }).trim();
    const absoluteCommonDir = (0, import_path2.resolve)(effectiveCwd, gitCommonDir);
    let mainRepoRoot = (0, import_path2.dirname)(absoluteCommonDir);
    if (mainRepoRoot.endsWith((0, import_path2.join)(".git", "worktrees"))) {
      mainRepoRoot = (0, import_path2.dirname)((0, import_path2.dirname)(mainRepoRoot));
    }
    try {
      mainRepoRoot = (0, import_fs.realpathSync)(mainRepoRoot);
    } catch {
    }
    let canonicalWorktreeTop = worktreeTop;
    try {
      canonicalWorktreeTop = (0, import_fs.realpathSync)(canonicalWorktreeTop);
    } catch {
    }
    if (mainRepoRoot !== canonicalWorktreeTop) {
      const sessionFile = (0, import_path2.basename)(transcriptPath);
      if (sessionFile) {
        const projectsDir = (0, import_path2.join)(getClaudeConfigDir(), "projects");
        if ((0, import_fs.existsSync)(projectsDir)) {
          const encodedMain = encodeProjectPath(mainRepoRoot);
          const resolvedPath = (0, import_path2.join)(projectsDir, encodedMain, sessionFile);
          if ((0, import_fs.existsSync)(resolvedPath)) return resolvedPath;
        }
      }
    }
  } catch {
  }
  return transcriptPath;
}
var import_crypto, import_child_process, import_fs, import_os2, import_path2, WORKSPACE_MARKER, OmcPaths, MAX_WORKTREE_CACHE_SIZE, worktreeCacheMap, toplevelCacheMap, superprojectCacheMap, workspaceCacheMap, dualDirWarnings, SESSION_ID_REGEX;
var init_worktree_paths = __esm({
  "src/lib/worktree-paths.ts"() {
    "use strict";
    import_crypto = require("crypto");
    import_child_process = require("child_process");
    import_fs = require("fs");
    import_os2 = require("os");
    import_path2 = require("path");
    init_config_dir();
    init_encode_project_path();
    WORKSPACE_MARKER = ".omc-workspace";
    OmcPaths = {
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
    MAX_WORKTREE_CACHE_SIZE = 8;
    worktreeCacheMap = /* @__PURE__ */ new Map();
    toplevelCacheMap = /* @__PURE__ */ new Map();
    superprojectCacheMap = /* @__PURE__ */ new Map();
    workspaceCacheMap = /* @__PURE__ */ new Map();
    dualDirWarnings = /* @__PURE__ */ new Set();
    SESSION_ID_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,255}$/;
  }
});

// src/lib/mode-names.ts
var MODE_NAMES, MODE_CONFIRMATION_SKILL_MAP, ALL_MODE_NAMES, MODE_STATE_FILE_MAP, SESSION_END_MODE_STATE_FILES, SESSION_METRICS_MODE_FILES;
var init_mode_names = __esm({
  "src/lib/mode-names.ts"() {
    "use strict";
    MODE_NAMES = {
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
    MODE_CONFIRMATION_SKILL_MAP = {
      ralph: ["ralph", "ultrawork"],
      ultragoal: ["ultragoal"],
      ultrawork: ["ultrawork"],
      autopilot: ["autopilot"],
      ralplan: ["ralplan"]
    };
    ALL_MODE_NAMES = [
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
    MODE_STATE_FILE_MAP = {
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
    SESSION_END_MODE_STATE_FILES = [
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
    SESSION_METRICS_MODE_FILES = [
      { file: MODE_STATE_FILE_MAP[MODE_NAMES.AUTOPILOT], mode: MODE_NAMES.AUTOPILOT },
      { file: MODE_STATE_FILE_MAP[MODE_NAMES.AUTORESEARCH], mode: MODE_NAMES.AUTORESEARCH },
      { file: MODE_STATE_FILE_MAP[MODE_NAMES.RALPH], mode: MODE_NAMES.RALPH },
      { file: MODE_STATE_FILE_MAP[MODE_NAMES.ULTRAWORK], mode: MODE_NAMES.ULTRAWORK },
      { file: MODE_STATE_FILE_MAP[MODE_NAMES.RALPLAN], mode: MODE_NAMES.RALPLAN },
      { file: MODE_STATE_FILE_MAP[MODE_NAMES.DEEP_INTERVIEW], mode: MODE_NAMES.DEEP_INTERVIEW },
      { file: MODE_STATE_FILE_MAP[MODE_NAMES.MERGE_READINESS], mode: MODE_NAMES.MERGE_READINESS },
      { file: MODE_STATE_FILE_MAP[MODE_NAMES.SELF_IMPROVE], mode: MODE_NAMES.SELF_IMPROVE }
    ];
  }
});

// src/lib/atomic-write.ts
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
var fsSync, path, crypto, ATOMIC_BATCH_MAX_CONTENT_BYTES;
var init_atomic_write = __esm({
  "src/lib/atomic-write.ts"() {
    "use strict";
    fsSync = __toESM(require("fs"), 1);
    path = __toESM(require("path"), 1);
    crypto = __toESM(require("crypto"), 1);
    ATOMIC_BATCH_MAX_CONTENT_BYTES = 1024 * 1024;
  }
});

// src/platform/process-utils.ts
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
      const stat = (0, import_fs2.readFileSync)(`/proc/${pid}/stat`, "utf8");
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
      const stdout = (0, import_child_process2.execFileSync)(
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
      const stdout = (0, import_child_process2.execFileSync)(
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
        const stdout = (0, import_child_process2.execFileSync)(
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
var import_child_process2, import_util4, import_fs2, execFileAsync, currentProcessStartIdentitySync;
var init_process_utils = __esm({
  "src/platform/process-utils.ts"() {
    "use strict";
    import_child_process2 = require("child_process");
    import_util4 = require("util");
    import_fs2 = require("fs");
    execFileAsync = (0, import_util4.promisify)(import_child_process2.execFile);
  }
});

// src/platform/index.ts
var PLATFORM;
var init_platform = __esm({
  "src/platform/index.ts"() {
    "use strict";
    init_process_utils();
    PLATFORM = process.platform;
  }
});

// src/lib/file-lock.ts
function identityForFd(fd) {
  const stat = (0, import_fs3.fstatSync)(fd);
  return { dev: stat.dev, ino: stat.ino };
}
function identityForPath(lockPath) {
  try {
    const stat = (0, import_fs3.lstatSync)(lockPath);
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
    const stat = (0, import_fs3.lstatSync)(lockPath);
    const now = Date.now();
    if (!Number.isFinite(stat.mtimeMs) || stat.mtimeMs > now + MAX_LOCK_MTIME_FUTURE_SKEW_MS) {
      return null;
    }
    const ageMs = Math.max(0, now - stat.mtimeMs);
    if (ageMs < staleLockMs) return null;
    const raw = (0, import_fs3.readFileSync)(lockPath, "utf-8");
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
    return (0, import_fs3.readFileSync)(lockPath, "utf-8") === observation.raw;
  } catch {
    return false;
  }
}
function reapObservedLock(lockPath, observation) {
  try {
    if (!observedLockStillMatches(lockPath, observation)) return false;
    (0, import_fs3.unlinkSync)(lockPath);
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
    names = (0, import_fs3.readdirSync)(directory);
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
    (0, import_fs3.closeSync)(handle.fd);
  } catch {
  }
  if (!ownedBeforeClose || !handleStillOwnsPath(handle)) return;
  try {
    (0, import_fs3.unlinkSync)(handle.path);
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
  const processStartIdentity2 = getProcessStartIdentitySync(process.pid);
  if (processStartIdentity2 === null || processStartIdentity2 === "absent") {
    return null;
  }
  return {
    version: 2,
    pid: process.pid,
    processStartIdentity: processStartIdentity2,
    nonce: (0, import_crypto3.randomUUID)(),
    timestamp: Date.now()
  };
}
function createOwnedLock(lockPath, suppliedOwner) {
  const owner = suppliedOwner ?? currentLockOwner();
  if (!owner) return null;
  const ownerRaw = JSON.stringify(owner);
  const ownerBytes = Buffer.from(ownerRaw, "utf8");
  const fd = (0, import_fs3.openSync)(
    lockPath,
    import_fs3.constants.O_CREAT | import_fs3.constants.O_EXCL | import_fs3.constants.O_RDWR,
    384
  );
  const creationIdentity = identityForFd(fd);
  try {
    let written = 0;
    while (written < ownerBytes.length) {
      const count = (0, import_fs3.writeSync)(
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
    (0, import_fs3.fsyncSync)(fd);
    const stat = (0, import_fs3.fstatSync)(fd);
    if (stat.size !== ownerBytes.length || !identitiesEqual(identityForPath(lockPath), creationIdentity)) {
      throw new Error(`Failed to verify file lock owner: ${lockPath}`);
    }
    const verifiedBytes = Buffer.alloc(ownerBytes.length);
    let read = 0;
    while (read < verifiedBytes.length) {
      const count = (0, import_fs3.readSync)(
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
      (0, import_fs3.closeSync)(fd);
    } catch {
    }
    try {
      if (identitiesEqual(identityForPath(lockPath), creationIdentity)) {
        (0, import_fs3.unlinkSync)(lockPath);
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
    (0, import_fs3.linkSync)(publicationPath, lockPath);
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
        (0, import_fs3.unlinkSync)(publicationPath);
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
        if (handleStillOwnsPath(published)) (0, import_fs3.unlinkSync)(lockPath);
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
    const raw = (0, import_fs3.readFileSync)(handle.path, "utf-8");
    if (raw !== handle.ownerRaw) return false;
    const owner = JSON.parse(raw);
    return owner.version === handle.owner.version && owner.pid === handle.owner.pid && owner.processStartIdentity === handle.owner.processStartIdentity && owner.nonce === handle.owner.nonce;
  } catch {
    return false;
  }
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
    (0, import_fs3.closeSync)(handle.fd);
  } catch {
  }
}
var import_fs3, import_crypto3, path2, DEFAULT_STALE_LOCK_MS, DEFAULT_RETRY_DELAY_MS, RECLAMATION_GUARD_SUFFIX, RECLAMATION_RECOVERY_SUFFIX, RECLAMATION_RECOVERY_CLAIM_SUFFIX, RECLAMATION_GUARD_STALE_MS, RECLAMATION_RECOVERY_STALE_MS, MAX_LOCK_MTIME_FUTURE_SKEW_MS, RELEASE_GUARD_TIMEOUT_MS;
var init_file_lock = __esm({
  "src/lib/file-lock.ts"() {
    "use strict";
    import_fs3 = require("fs");
    import_crypto3 = require("crypto");
    path2 = __toESM(require("path"), 1);
    init_atomic_write();
    init_platform();
    DEFAULT_STALE_LOCK_MS = 3e4;
    DEFAULT_RETRY_DELAY_MS = 50;
    RECLAMATION_GUARD_SUFFIX = ".reclaim.guard";
    RECLAMATION_RECOVERY_SUFFIX = ".recover";
    RECLAMATION_RECOVERY_CLAIM_SUFFIX = ".reaper.";
    RECLAMATION_GUARD_STALE_MS = 3e4;
    RECLAMATION_RECOVERY_STALE_MS = 3e4;
    MAX_LOCK_MTIME_FUTURE_SKEW_MS = 5 * 6e4;
    RELEASE_GUARD_TIMEOUT_MS = 2e3;
  }
});

// src/lib/mode-state-io.ts
function flockPath() {
  return process.env.NODE_ENV === "test" && process.env.OMC_TEST_FLOCK_AVAILABLE === "0" ? null : (0, import_fs4.existsSync)("/usr/bin/flock") ? "/usr/bin/flock" : (0, import_fs4.existsSync)("/bin/flock") ? "/bin/flock" : null;
}
function processStartIdentity(pid) {
  const identity = getProcessStartIdentitySync(pid);
  if (identity === null || identity === "absent") return identity;
  return identity.match(/\d+$/)?.[0] ?? null;
}
function acquireLockAt(path3) {
  try {
    return acquireFileLockSync(path3, {
      timeoutMs: 500,
      retryDelayMs: 10,
      staleLockMs: 3e4
    });
  } catch {
    return null;
  }
}
function acquireMutationLock(filePath) {
  return acquireLockAt(`${filePath}.mutation.lock`);
}
function releaseMutationLock(lock) {
  if (!lock) return;
  releaseFileLockSync(lock);
}
function withStateFileMutationLock(filePath, callback, _requireExclusive = true) {
  const lock = acquireLockAt(`${filePath}.mutation.lock`);
  if (!lock) return { acquired: false, value: void 0 };
  try {
    return { acquired: true, value: callback() };
  } finally {
    releaseMutationLock(lock);
  }
}
function writeStateFileLockedIf(filePath, predicate, transform) {
  if (!recoverEmergencyStateFile(filePath)) return "failed";
  if (process.env.NODE_ENV === "test" && process.env.OMC_TEST_CONDITIONAL_WRITE_REPLACEMENT_PATH === filePath && process.env.OMC_TEST_CONDITIONAL_WRITE_REPLACEMENT_BASE64) {
    try {
      const replacement = JSON.parse(Buffer.from(process.env.OMC_TEST_CONDITIONAL_WRITE_REPLACEMENT_BASE64, "base64").toString("utf8"));
      atomicWriteJsonSync(filePath, replacement);
    } finally {
      delete process.env.OMC_TEST_CONDITIONAL_WRITE_REPLACEMENT_PATH;
      delete process.env.OMC_TEST_CONDITIONAL_WRITE_REPLACEMENT_BASE64;
    }
  }
  if (!(0, import_fs4.existsSync)(filePath)) return "skipped";
  const lock = acquireMutationLock(filePath);
  if (!lock) return "failed";
  try {
    if (!(0, import_fs4.existsSync)(filePath)) return "skipped";
    let current;
    try {
      current = JSON.parse((0, import_fs4.readFileSync)(filePath, "utf8"));
    } catch {
      return "failed";
    }
    if (!predicate(current)) return "skipped";
    atomicWriteJsonSync(filePath, transform(current));
    return "written";
  } catch {
    return "failed";
  } finally {
    releaseMutationLock(lock);
  }
}
function stateDigest(raw) {
  return (0, import_crypto4.createHash)("sha256").update(raw).digest("hex");
}
function emergencyJournalPath(filePath) {
  return `${filePath}.emergency-journal.json`;
}
function sameEmergencyOwner(left, right) {
  return left.pid === right.pid && left.processStart === right.processStart && left.nonce === right.nonce;
}
function isEmergencyOwnerLive(owner) {
  const current = processStartIdentity(owner.pid);
  return current === null || current !== "absent" && current === owner.processStart;
}
function journalIsOwned(path3, transactionId, owner) {
  const current = readEmergencyJournal(path3);
  return current !== null && current.transactionId === transactionId && sameEmergencyOwner(current.owner, owner);
}
function writeEmergencyJournal(path3, journal, requireOwnership = true) {
  try {
    if (requireOwnership && !journalIsOwned(path3, journal.transactionId, journal.owner)) return false;
    atomicWriteJsonSync(path3, journal);
    return !requireOwnership || journalIsOwned(path3, journal.transactionId, journal.owner);
  } catch {
    return false;
  }
}
function emergencyPublicationTempPath(path3) {
  const processStart = processStartIdentity(process.pid);
  if (!processStart || processStart === "absent") return null;
  return `${path3}.${process.pid}.${processStart}.${(0, import_crypto4.randomUUID)()}.tmp`;
}
function publishEmergencyFileExclusive(path3, content) {
  const tempPath = emergencyPublicationTempPath(path3);
  let fd;
  try {
    if (!tempPath) return false;
    (0, import_fs4.mkdirSync)((0, import_path3.dirname)(path3), { recursive: true });
    fd = (0, import_fs4.openSync)(tempPath, "wx", 384);
    const bytes = Buffer.from(content);
    let offset = 0;
    while (offset < bytes.length) {
      const written = (0, import_fs4.writeSync)(fd, bytes, offset, bytes.length - offset);
      if (written <= 0) throw new Error("emergency publication made no progress");
      offset += written;
    }
    (0, import_fs4.fsyncSync)(fd);
    if ((0, import_fs4.statSync)(tempPath).size !== bytes.length) throw new Error("emergency publication truncated");
    (0, import_fs4.closeSync)(fd);
    fd = void 0;
    (0, import_fs4.linkSync)(tempPath, path3);
    (0, import_fs4.unlinkSync)(tempPath);
    return true;
  } catch {
    return false;
  } finally {
    if (fd !== void 0) {
      try {
        (0, import_fs4.closeSync)(fd);
      } catch {
      }
    }
    if (tempPath) {
      const generation = fileIdentity(tempPath);
      try {
        if (generation && sameFile(tempPath, generation)) (0, import_fs4.unlinkSync)(tempPath);
      } catch {
      }
    }
  }
}
function guardedRecoveryClaim(path3, operation, owner) {
  const flock = flockPath();
  if (!flock) return "unverifiable";
  const result = (0, import_child_process3.spawnSync)(flock, ["-x", `${path3}.recovery.guard`, process.execPath, "-e", RECOVERY_CLAIM_SCRIPT, operation, path3, JSON.stringify(owner)], { stdio: "ignore", timeout: 2e3 });
  if (result.status === 0) return "claimed";
  if (result.status === 2) return "live";
  if (result.status === 4) return "replaced";
  return "unverifiable";
}
function acquireRecoveryClaim(path3) {
  const processStart = processStartIdentity(process.pid);
  if (!processStart || processStart === "absent") return null;
  const owner = { version: 1, pid: process.pid, processStart, createdAt: (/* @__PURE__ */ new Date()).toISOString(), nonce: (0, import_crypto4.randomUUID)() };
  if (!flockPath()) return publishEmergencyFileExclusive(path3, JSON.stringify(owner)) ? owner : null;
  return guardedRecoveryClaim(path3, "acquire", owner) === "claimed" ? owner : null;
}
function readRecoveryClaim(path3) {
  try {
    const owner = JSON.parse((0, import_fs4.readFileSync)(path3, "utf8"));
    return owner.version === 1 && Number.isSafeInteger(owner.pid) && owner.pid > 0 && typeof owner.processStart === "string" && typeof owner.createdAt === "string" && typeof owner.nonce === "string" ? owner : null;
  } catch {
    return null;
  }
}
function sameRecoveryClaim(left, right) {
  return left.pid === right.pid && left.processStart === right.processStart && left.nonce === right.nonce;
}
function releaseRecoveryClaim(path3, owner) {
  if (!flockPath()) {
    try {
      const current = readRecoveryClaim(path3);
      if (current && sameRecoveryClaim(current, owner)) (0, import_fs4.unlinkSync)(path3);
    } catch {
    }
    return;
  }
  guardedRecoveryClaim(path3, "release", owner);
}
function readEmergencyJournal(path3) {
  try {
    const journal = JSON.parse((0, import_fs4.readFileSync)(path3, "utf8"));
    if (journal.version !== 1 || typeof journal.transactionId !== "string" || !/^[0-9a-f-]{36}$/i.test(journal.transactionId) || !journal.owner || !Number.isInteger(journal.owner.pid) || journal.owner.pid <= 0 || typeof journal.owner.processStart !== "string" || typeof journal.owner.nonce !== "string" || !/^[0-9a-f-]{36}$/i.test(journal.owner.nonce) || journal.sessionOwner !== void 0 && typeof journal.sessionOwner !== "string" || journal.originalDigest !== void 0 && (typeof journal.originalDigest !== "string" || !/^[0-9a-f]{64}$/i.test(journal.originalDigest)) || journal.intendedDigest !== void 0 && (typeof journal.intendedDigest !== "string" || !/^[0-9a-f]{64}$/i.test(journal.intendedDigest)) || journal.intent !== void 0 && journal.intent !== "clear" && journal.intent !== "publish" || typeof journal.quarantinePath !== "string" || journal.phase !== "preparing" && journal.phase !== "prepared" && journal.phase !== "quarantined" && journal.phase !== "published") return null;
    const complete = typeof journal.originalDigest === "string" && (journal.intent === "clear" || journal.intent === "publish" && typeof journal.intendedDigest === "string");
    return journal.phase === "preparing" || complete ? journal : null;
  } catch {
    return null;
  }
}
function fileIdentity(path3) {
  try {
    const stat = (0, import_fs4.statSync)(path3);
    return { dev: stat.dev, ino: stat.ino };
  } catch {
    return null;
  }
}
function sameFile(path3, expected) {
  const actual = fileIdentity(path3);
  return actual !== null && actual.dev === expected.dev && actual.ino === expected.ino;
}
function reconcileEmergencyPublicationTemps(filePath, authorizeState) {
  const directory = (0, import_path3.dirname)(filePath);
  const base = filePath.slice(directory.length + 1).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^${base}\\.emergency-(journal\\.json|recovery\\.claim|quarantine\\.[0-9a-f-]{36}\\.payload)\\.(\\d+)\\.(\\d+)\\.([0-9a-f-]{36})\\.tmp$`, "i");
  let names;
  try {
    names = (0, import_fs4.readdirSync)(directory);
  } catch (error) {
    return error.code === "ENOENT";
  }
  for (const name of names) {
    const match = pattern.exec(name);
    if (!match) continue;
    const path3 = (0, import_path3.join)(directory, name);
    const currentStart = processStartIdentity(Number(match[2]));
    if (currentStart === null || currentStart === match[3]) return false;
    const generation = fileIdentity(path3);
    try {
      if (!generation) return false;
      const raw = (0, import_fs4.readFileSync)(path3, "utf8");
      if (authorizeState) {
        if (match[1] === "journal.json") {
          const journal = readEmergencyJournal(path3);
          if (!journal || !recoveryGenerationsAuthorized(filePath, journal, authorizeState)) return false;
        } else if (match[1].startsWith("quarantine.")) {
          const state = JSON.parse(raw);
          if (!state || typeof state !== "object" || Array.isArray(state) || !authorizeState(state)) return false;
        } else {
          const claim = readRecoveryClaim(path3);
          if (!claim || claim.pid !== Number(match[2]) || claim.processStart !== match[3] || claim.nonce !== match[4]) return false;
        }
      }
      if (!sameFile(path3, generation) || stateDigest((0, import_fs4.readFileSync)(path3, "utf8")) !== stateDigest(raw)) return false;
      (0, import_fs4.unlinkSync)(path3);
    } catch {
      return false;
    }
  }
  return true;
}
function captureAndUnlinkPrimary(filePath, quarantinePath, expectedDigest) {
  try {
    (0, import_fs4.linkSync)(filePath, quarantinePath);
    const captured = fileIdentity(quarantinePath);
    if (!captured || stateDigest((0, import_fs4.readFileSync)(quarantinePath, "utf8")) !== expectedDigest || !sameFile(filePath, captured)) return false;
    emergencyReplaceAtCaptureBoundary(filePath);
    if (!sameFile(filePath, captured) || stateDigest((0, import_fs4.readFileSync)(filePath, "utf8")) !== expectedDigest) return false;
    (0, import_fs4.unlinkSync)(filePath);
    return true;
  } catch {
    return false;
  }
}
function removeOwnedEmergencyArtifacts(journalPath, journal, removeQuarantine) {
  try {
    if (!journalIsOwned(journalPath, journal.transactionId, journal.owner)) return false;
    if (removeQuarantine) {
      try {
        (0, import_fs4.unlinkSync)(journal.quarantinePath);
      } catch {
      }
    }
    try {
      (0, import_fs4.unlinkSync)(`${journal.quarantinePath}.payload`);
    } catch {
    }
    if (!journalIsOwned(journalPath, journal.transactionId, journal.owner)) return false;
    (0, import_fs4.unlinkSync)(journalPath);
    return true;
  } catch {
    return false;
  }
}
function recoveryGenerationsAuthorized(filePath, journal, authorizeState) {
  if (!authorizeState) return true;
  const paths = [
    filePath,
    ...journal ? [journal.quarantinePath, `${journal.quarantinePath}.payload`] : []
  ];
  let authenticatedJournalGeneration = journal === null;
  for (const path3 of paths) {
    if (!(0, import_fs4.existsSync)(path3)) continue;
    let raw;
    let state;
    try {
      raw = (0, import_fs4.readFileSync)(path3, "utf8");
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
      state = parsed;
    } catch {
      return false;
    }
    if (!authorizeState(state)) return false;
    if (journal && (stateDigest(raw) === journal.originalDigest || journal.intent === "publish" && stateDigest(raw) === journal.intendedDigest)) authenticatedJournalGeneration = true;
  }
  return authenticatedJournalGeneration;
}
function hasUnattributableRecoveryClaimArtifact(filePath, recoveryClaim) {
  const directory = (0, import_path3.dirname)(filePath);
  const base = filePath.slice(directory.length + 1).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const tempPattern = new RegExp(`^${base}\\.emergency-recovery\\.claim\\.\\d+\\.\\d+\\.[0-9a-f-]{36}\\.tmp$`, "i");
  try {
    if ((0, import_fs4.readdirSync)(directory).some((name) => tempPattern.test(name))) return true;
    const claimPath = `${filePath}.emergency-recovery.claim`;
    if (!(0, import_fs4.existsSync)(claimPath)) return recoveryClaim !== void 0;
    if (!recoveryClaim) return true;
    const current = readRecoveryClaim(claimPath);
    return !current || !sameRecoveryClaim(current, recoveryClaim);
  } catch {
    return true;
  }
}
function sharedRecoveryArtifactsAuthorized(filePath, authorizeState, recoveryClaim) {
  if (!authorizeState) return true;
  if (hasUnattributableRecoveryClaimArtifact(filePath, recoveryClaim)) return false;
  const journalPath = emergencyJournalPath(filePath);
  if (!(0, import_fs4.existsSync)(journalPath)) {
    if (!(0, import_fs4.existsSync)(filePath)) return true;
    try {
      const state = JSON.parse((0, import_fs4.readFileSync)(filePath, "utf8"));
      return state !== null && typeof state === "object" && !Array.isArray(state) && authorizeState(state);
    } catch {
      return false;
    }
  }
  const journal = readEmergencyJournal(journalPath);
  return journal !== null && recoveryGenerationsAuthorized(filePath, journal, authorizeState);
}
function emergencyReplaceAtRecoveryBoundary(filePath) {
  if (process.env.NODE_ENV !== "test" || process.env.OMC_TEST_EMERGENCY_RECOVERY_REPLACEMENT_PATH !== filePath || !process.env.OMC_TEST_EMERGENCY_RECOVERY_REPLACEMENT_BASE64) return;
  try {
    const replacements = JSON.parse(Buffer.from(process.env.OMC_TEST_EMERGENCY_RECOVERY_REPLACEMENT_BASE64, "base64").toString("utf8"));
    const directory = (0, import_path3.dirname)(filePath);
    for (const name of (0, import_fs4.readdirSync)(directory)) {
      if (name === (0, import_path3.basename)(filePath) || name.startsWith(`${(0, import_path3.basename)(filePath)}.emergency-`)) (0, import_fs4.unlinkSync)((0, import_path3.join)(directory, name));
    }
    for (const replacement of replacements) {
      if ((0, import_path3.dirname)(replacement.path) !== directory) throw new Error("invalid recovery replacement path");
      (0, import_fs4.writeFileSync)(replacement.path, replacement.content);
    }
  } finally {
    delete process.env.OMC_TEST_EMERGENCY_RECOVERY_REPLACEMENT_PATH;
    delete process.env.OMC_TEST_EMERGENCY_RECOVERY_REPLACEMENT_BASE64;
  }
}
function recoverEmergencyStateFile(filePath, options) {
  const authorizeState = options?.authorizeState;
  const journalPath = emergencyJournalPath(filePath);
  if (!sharedRecoveryArtifactsAuthorized(filePath, authorizeState)) return false;
  if (!(0, import_fs4.existsSync)(journalPath)) {
    if (!authorizeState) return reconcileEmergencyPublicationTemps(filePath);
    const claimPath2 = `${filePath}.emergency-recovery.claim`;
    const claim2 = acquireRecoveryClaim(claimPath2);
    if (!claim2) return false;
    try {
      if ((0, import_fs4.existsSync)(journalPath) || !sharedRecoveryArtifactsAuthorized(filePath, authorizeState, claim2)) return false;
      return reconcileEmergencyPublicationTemps(filePath, authorizeState);
    } finally {
      releaseRecoveryClaim(claimPath2, claim2);
    }
  }
  const journal = readEmergencyJournal(journalPath);
  if (!journal) {
    if (authorizeState) return false;
    const claimPath2 = `${filePath}.emergency-recovery.claim`;
    const claim2 = acquireRecoveryClaim(claimPath2);
    if (!claim2) return false;
    try {
      const generation = fileIdentity(journalPath);
      emergencyReplaceAtRecoveryBoundary(filePath);
      const current = readEmergencyJournal(journalPath);
      if (!recoveryGenerationsAuthorized(filePath, current, authorizeState)) return true;
      if (!reconcileEmergencyPublicationTemps(filePath, authorizeState)) return false;
      if (!generation || readEmergencyJournal(journalPath) !== null || !(0, import_fs4.existsSync)(filePath) || !sameFile(journalPath, generation)) return false;
      (0, import_fs4.unlinkSync)(journalPath);
      return true;
    } catch {
      return false;
    } finally {
      releaseRecoveryClaim(claimPath2, claim2);
    }
  }
  const claimPath = `${filePath}.emergency-recovery.claim`;
  const claim = acquireRecoveryClaim(claimPath);
  if (!claim) return false;
  try {
    if (!sharedRecoveryArtifactsAuthorized(filePath, authorizeState, claim)) return false;
    emergencyReplaceAtRecoveryBoundary(filePath);
    const current = readEmergencyJournal(journalPath);
    if (!recoveryGenerationsAuthorized(filePath, current, authorizeState)) return true;
    if (!reconcileEmergencyPublicationTemps(filePath, authorizeState)) return false;
    if (!current || current.quarantinePath !== `${filePath}.emergency-quarantine.${current.transactionId}` || isEmergencyOwnerLive(current.owner)) return false;
    return recoverDeadEmergencyStateFile(filePath, authorizeState);
  } finally {
    releaseRecoveryClaim(claimPath, claim);
  }
}
function recoverDeadEmergencyStateFile(filePath, authorizeState) {
  const journalPath = emergencyJournalPath(filePath);
  if (!(0, import_fs4.existsSync)(journalPath)) return true;
  const journal = readEmergencyJournal(journalPath);
  if (!journal || journal.quarantinePath !== `${filePath}.emergency-quarantine.${journal.transactionId}`) return false;
  if (isEmergencyOwnerLive(journal.owner)) return false;
  if (!recoveryGenerationsAuthorized(filePath, journal, authorizeState)) return true;
  const owned = () => journalIsOwned(journalPath, journal.transactionId, journal.owner);
  if (!owned()) return false;
  const payloadPath = `${journal.quarantinePath}.payload`;
  const digest = (path3) => {
    try {
      return stateDigest((0, import_fs4.readFileSync)(path3, "utf8"));
    } catch {
      return null;
    }
  };
  if (journal.phase === "preparing") {
    const complete = typeof journal.originalDigest === "string" && (journal.intent === "clear" || journal.intent === "publish" && typeof journal.intendedDigest === "string");
    if (!complete) {
      if ((0, import_fs4.existsSync)(journal.quarantinePath) || (0, import_fs4.existsSync)(payloadPath)) return false;
      return removeOwnedEmergencyArtifacts(journalPath, journal, false);
    }
    const originalStillPrimary = !(0, import_fs4.existsSync)(journal.quarantinePath) && digest(filePath) === journal.originalDigest;
    if (journal.intent === "publish" && digest(payloadPath) !== journal.intendedDigest) {
      return originalStillPrimary && removeOwnedEmergencyArtifacts(journalPath, journal, false);
    }
    if (journal.intent === "clear" && (0, import_fs4.existsSync)(payloadPath)) {
      return originalStillPrimary && removeOwnedEmergencyArtifacts(journalPath, journal, false);
    }
    journal.phase = "prepared";
    return writeEmergencyJournal(journalPath, journal) && recoverDeadEmergencyStateFile(filePath, authorizeState);
  }
  const originalDigest = journal.originalDigest;
  const intent = journal.intent;
  const intendedDigest = journal.intendedDigest;
  const hasPrimary = (0, import_fs4.existsSync)(filePath);
  const hasQuarantine = (0, import_fs4.existsSync)(journal.quarantinePath);
  const finalize = () => removeOwnedEmergencyArtifacts(journalPath, journal, hasQuarantine);
  if (hasPrimary && hasQuarantine) {
    if (intent === "publish" && digest(filePath) === intendedDigest && digest(journal.quarantinePath) === originalDigest) return finalize();
    return removeOwnedEmergencyArtifacts(journalPath, journal, true);
  }
  if (hasPrimary) {
    if (!hasQuarantine && journal.phase === "prepared" && digest(filePath) === originalDigest) {
      if (intent === "publish" && digest(payloadPath) !== intendedDigest) return false;
      if (!owned()) return false;
      if (!captureAndUnlinkPrimary(filePath, journal.quarantinePath, originalDigest)) {
        if (owned() && (0, import_fs4.existsSync)(filePath) && (0, import_fs4.existsSync)(journal.quarantinePath) && digest(filePath) !== originalDigest) {
          removeOwnedEmergencyArtifacts(journalPath, journal, true);
        }
        return false;
      }
      journal.phase = "quarantined";
      return writeEmergencyJournal(journalPath, journal) && recoverDeadEmergencyStateFile(filePath, authorizeState);
    }
    return false;
  }
  if (!hasQuarantine) {
    return intent === "clear" && journal.phase === "published" && removeOwnedEmergencyArtifacts(journalPath, journal, false);
  }
  if (digest(journal.quarantinePath) !== originalDigest || !owned()) return false;
  try {
    if (intent === "clear") return removeOwnedEmergencyArtifacts(journalPath, journal, true);
    const payload = (0, import_fs4.readFileSync)(payloadPath, "utf8");
    if (stateDigest(payload) !== intendedDigest || !owned()) return false;
    (0, import_fs4.linkSync)(payloadPath, filePath);
    journal.phase = "published";
    if (!writeEmergencyJournal(journalPath, journal)) return false;
    return removeOwnedEmergencyArtifacts(journalPath, journal, true);
  } catch {
    return false;
  }
}
function emergencyReplaceAtCaptureBoundary(filePath) {
  if (process.env.NODE_ENV !== "test" || process.env.OMC_TEST_EMERGENCY_CAPTURE_REPLACEMENT_PATH !== filePath || !process.env.OMC_TEST_EMERGENCY_CAPTURE_REPLACEMENT_BASE64) return;
  try {
    const replacement = JSON.parse(Buffer.from(process.env.OMC_TEST_EMERGENCY_CAPTURE_REPLACEMENT_BASE64, "base64").toString("utf8"));
    atomicWriteJsonSync(filePath, replacement);
  } finally {
    delete process.env.OMC_TEST_EMERGENCY_CAPTURE_REPLACEMENT_PATH;
    delete process.env.OMC_TEST_EMERGENCY_CAPTURE_REPLACEMENT_BASE64;
  }
}
function getStateSessionOwner(state) {
  if (!state || typeof state !== "object") {
    return void 0;
  }
  const meta = state._meta;
  if (meta && typeof meta === "object") {
    const metaSessionId = meta.sessionId;
    if (typeof metaSessionId === "string" && metaSessionId) {
      return metaSessionId;
    }
  }
  const topLevelSessionId = state.session_id;
  return typeof topLevelSessionId === "string" && topLevelSessionId ? topLevelSessionId : void 0;
}
function canClearStateForSession(state, sessionId) {
  const ownerSessionId = getStateSessionOwner(state);
  return !ownerSessionId || ownerSessionId === sessionId;
}
function modeConfirmationGeneration(state) {
  const meta = state._meta && typeof state._meta === "object" && !Array.isArray(state._meta) ? state._meta : null;
  const value = state.generation ?? meta?.generation;
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
function modeConfirmationTimestamp(state) {
  const value = typeof state.awaiting_confirmation_set_at === "string" && state.awaiting_confirmation_set_at.trim() ? state.awaiting_confirmation_set_at.trim() : typeof state.started_at === "string" ? state.started_at.trim() : "";
  return value;
}
function modeConfirmationDigest(state) {
  return (0, import_crypto4.createHash)("sha256").update(JSON.stringify(state)).digest("hex");
}
function confirmModeAwaitingConfirmationLocked(directory, modeName, sessionId, observation) {
  let paths;
  try {
    const resolved = resolveSessionStatePaths(
      modeName,
      sessionId || void 0,
      directory
    );
    if (observation) {
      const allowedPaths = sessionId ? [resolved.sessionScoped, resolved.legacy] : [resolved.legacy];
      const allowedPath = allowedPaths.find(
        (candidate) => (0, import_path3.resolve)(observation.path) === (0, import_path3.resolve)(candidate)
      );
      if (!observation.path || !sessionId || !allowedPath || observation.ownerSessionId && observation.ownerSessionId !== sessionId) {
        return { modeName, status: "failed", paths: [] };
      }
      paths = [allowedPath];
    } else {
      paths = sessionId ? [resolved.sessionScoped, resolved.legacy] : [resolved.legacy];
    }
  } catch {
    return { modeName, status: "failed", paths: [] };
  }
  if (observation) {
    const path3 = paths[0];
    if (!recoverEmergencyStateFile(path3)) {
      return { modeName, status: "failed", paths };
    }
    if (process.env.NODE_ENV === "test" && process.env.OMC_TEST_CONDITIONAL_WRITE_REPLACEMENT_PATH === path3 && process.env.OMC_TEST_CONDITIONAL_WRITE_REPLACEMENT_BASE64) {
      try {
        const replacement = JSON.parse(Buffer.from(
          process.env.OMC_TEST_CONDITIONAL_WRITE_REPLACEMENT_BASE64,
          "base64"
        ).toString("utf8"));
        atomicWriteJsonSync(path3, replacement);
      } finally {
        delete process.env.OMC_TEST_CONDITIONAL_WRITE_REPLACEMENT_PATH;
        delete process.env.OMC_TEST_CONDITIONAL_WRITE_REPLACEMENT_BASE64;
      }
    }
    const lock = acquireMutationLock(path3);
    if (!lock) return { modeName, status: "failed", paths };
    try {
      if (!(0, import_fs4.existsSync)(path3)) {
        return { modeName, status: "not-applicable", paths };
      }
      let current;
      try {
        const parsed = JSON.parse((0, import_fs4.readFileSync)(path3, "utf8"));
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
          return { modeName, status: "failed", paths };
        }
        current = parsed;
      } catch {
        return { modeName, status: "failed", paths };
      }
      if (current.awaiting_confirmation !== true) {
        return { modeName, status: "not-applicable", paths };
      }
      if (!observation.ownerSessionId) {
        return { modeName, status: "failed", paths };
      }
      if (getStateSessionOwner(current) !== observation.ownerSessionId || modeConfirmationGeneration(current) !== observation.generation || modeConfirmationTimestamp(current) !== observation.confirmationTimestamp || modeConfirmationDigest(current) !== observation.digest) {
        return { modeName, status: "changed", paths };
      }
      const next = { ...current };
      delete next.awaiting_confirmation;
      delete next.awaiting_confirmation_set_at;
      atomicWriteJsonSync(path3, next);
      if (!(0, import_fs4.existsSync)(path3)) {
        return { modeName, status: "written", paths };
      }
      try {
        const verified = JSON.parse((0, import_fs4.readFileSync)(path3, "utf8"));
        if (verified === null || typeof verified !== "object" || Array.isArray(verified) || verified.awaiting_confirmation === true) {
          return { modeName, status: "failed", paths };
        }
      } catch {
        return { modeName, status: "failed", paths };
      }
      return { modeName, status: "written", paths };
    } catch {
      return { modeName, status: "failed", paths };
    } finally {
      releaseMutationLock(lock);
    }
  }
  let wrote = false;
  let failed = false;
  for (const path3 of [...new Set(paths.filter(Boolean))]) {
    try {
      const result = writeStateFileLockedIf(
        path3,
        (current) => current.awaiting_confirmation === true && (!sessionId || canClearStateForSession(current, sessionId)),
        (current) => {
          const next = { ...current };
          delete next.awaiting_confirmation;
          delete next.awaiting_confirmation_set_at;
          return next;
        }
      );
      wrote ||= result === "written";
      failed ||= result === "failed";
    } catch {
      failed = true;
    }
  }
  return {
    modeName,
    status: failed ? "failed" : wrote ? "written" : "skipped",
    paths
  };
}
var import_fs4, import_path3, import_crypto4, import_child_process3, RECOVERY_CLAIM_SCRIPT;
var init_mode_state_io = __esm({
  "src/lib/mode-state-io.ts"() {
    "use strict";
    import_fs4 = require("fs");
    import_path3 = require("path");
    import_crypto4 = require("crypto");
    import_child_process3 = require("child_process");
    init_worktree_paths();
    init_atomic_write();
    init_file_lock();
    init_mode_names();
    init_process_utils();
    RECOVERY_CLAIM_SCRIPT = String.raw`
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
  }
});

// src/notifications/hook-config.ts
function getHookNotificationConfigPath() {
  return (0, import_path4.join)(getClaudeConfigDir(), "omc_config.hook.json");
}
function getHookConfig() {
  if (cachedConfig !== void 0) return cachedConfig;
  const configPath = process.env.OMC_HOOK_CONFIG || DEFAULT_CONFIG_PATH;
  if (!(0, import_fs5.existsSync)(configPath)) {
    cachedConfig = null;
    return null;
  }
  try {
    const raw = JSON.parse((0, import_fs5.readFileSync)(configPath, "utf-8"));
    if (!raw || raw.enabled === false) {
      cachedConfig = null;
      return null;
    }
    cachedConfig = raw;
    return cachedConfig;
  } catch {
    cachedConfig = null;
    return null;
  }
}
function resetHookConfigCache() {
  cachedConfig = void 0;
}
function resolveEventTemplate(hookConfig, event, platform) {
  if (!hookConfig) return null;
  const eventConfig = hookConfig.events?.[event];
  if (eventConfig) {
    const platformOverride = eventConfig.platforms?.[platform];
    if (platformOverride?.template) return platformOverride.template;
    if (eventConfig.template) return eventConfig.template;
  }
  return hookConfig.defaultTemplate || null;
}
function mergeHookConfigIntoNotificationConfig(hookConfig, notifConfig) {
  if (!hookConfig.events) return notifConfig;
  const merged = { ...notifConfig };
  const events = { ...merged.events || {} };
  for (const [eventName, hookEventConfig] of Object.entries(hookConfig.events)) {
    if (!hookEventConfig) continue;
    const event = eventName;
    const existing = events[event];
    events[event] = {
      ...existing || {},
      enabled: hookEventConfig.enabled
    };
  }
  merged.events = events;
  return merged;
}
var import_fs5, import_path4, DEFAULT_CONFIG_PATH, cachedConfig;
var init_hook_config = __esm({
  "src/notifications/hook-config.ts"() {
    "use strict";
    import_fs5 = require("fs");
    import_path4 = require("path");
    init_config_dir();
    DEFAULT_CONFIG_PATH = getHookNotificationConfigPath();
  }
});

// src/notifications/validation.ts
function validateCustomIntegration(integration) {
  const errors = [];
  if (!integration.id) {
    errors.push("Integration ID is required");
  } else if (!VALID_ID_PATTERN.test(integration.id)) {
    errors.push("Integration ID must be alphanumeric with hyphens/underscores only");
  }
  if (!integration.type || !["webhook", "cli"].includes(integration.type)) {
    errors.push('Type must be either "webhook" or "cli"');
  }
  if (!integration.events || integration.events.length === 0) {
    errors.push("At least one event must be selected");
  }
  if (integration.type === "webhook") {
    const webhookErrors = validateWebhookIntegrationConfig(integration.config);
    errors.push(...webhookErrors);
  } else if (integration.type === "cli") {
    const cliErrors = validateCliIntegrationConfig(integration.config);
    errors.push(...cliErrors);
  }
  return { valid: errors.length === 0, errors };
}
function validateWebhookIntegrationConfig(config) {
  const errors = [];
  if (!config.url) {
    errors.push("Webhook URL is required");
  } else {
    try {
      const url = new URL(config.url);
      if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
        errors.push("Webhook URL must use HTTPS (except localhost for development)");
      }
      if (url.protocol === "file:" || url.protocol === "ftp:" || url.protocol === "sftp:") {
        errors.push(`Protocol "${url.protocol}" is not allowed`);
      }
    } catch {
      errors.push("Invalid webhook URL");
    }
  }
  if (!config.method) {
    errors.push("HTTP method is required");
  } else if (!VALID_HTTP_METHODS.includes(config.method)) {
    errors.push(`Invalid HTTP method. Must be one of: ${VALID_HTTP_METHODS.join(", ")}`);
  }
  if (config.timeout !== void 0) {
    if (config.timeout < MIN_TIMEOUT || config.timeout > MAX_TIMEOUT) {
      errors.push(`Timeout must be between ${MIN_TIMEOUT}ms and ${MAX_TIMEOUT}ms`);
    }
  }
  if (config.headers) {
    for (const [key, value] of Object.entries(config.headers)) {
      if (/[\r\n]/.test(key)) {
        errors.push(`Header name contains invalid characters: "${key}"`);
      }
      if (/[\r\n]/.test(String(value))) {
        errors.push(`Header value contains invalid characters for key: "${key}"`);
      }
      if (/\0/.test(key) || /\0/.test(String(value))) {
        errors.push(`Header contains null bytes: "${key}"`);
      }
    }
  }
  return errors;
}
function validateCliIntegrationConfig(config) {
  const errors = [];
  if (!config.command) {
    errors.push("Command is required");
  } else {
    if (config.command.includes(" ")) {
      errors.push("Command must be a single executable path (no spaces or arguments)");
    }
    const shellMetacharacters = /[;&|`$(){}[\]<>!#*?~]/;
    if (shellMetacharacters.test(config.command)) {
      errors.push("Command contains shell metacharacters");
    }
  }
  if (config.args && Array.isArray(config.args)) {
    for (const arg of config.args) {
      const withoutTemplates = arg.replace(/\{\{[^}]+\}\}/g, "");
      const shellMetacharacters = /[;&|`$(){}[\]<>!#*?~]/;
      if (shellMetacharacters.test(withoutTemplates)) {
        errors.push(`Argument contains shell metacharacters: "${arg}"`);
      }
      if (/\0/.test(arg)) {
        errors.push(`Argument contains null bytes: "${arg}"`);
      }
    }
  }
  if (config.timeout !== void 0) {
    if (config.timeout < MIN_TIMEOUT || config.timeout > MAX_TIMEOUT) {
      errors.push(`Timeout must be between ${MIN_TIMEOUT}ms and ${MAX_TIMEOUT}ms`);
    }
  }
  return errors;
}
function checkDuplicateIds(integrations) {
  const seen = /* @__PURE__ */ new Set();
  const duplicates = [];
  for (const integration of integrations) {
    if (seen.has(integration.id)) {
      duplicates.push(integration.id);
    }
    seen.add(integration.id);
  }
  return duplicates;
}
function sanitizeArgument(arg) {
  let sanitized = arg.replace(/\0/g, "");
  sanitized = sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
  return sanitized;
}
var VALID_HTTP_METHODS, MIN_TIMEOUT, MAX_TIMEOUT, VALID_ID_PATTERN;
var init_validation = __esm({
  "src/notifications/validation.ts"() {
    "use strict";
    VALID_HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];
    MIN_TIMEOUT = 1e3;
    MAX_TIMEOUT = 6e4;
    VALID_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
  }
});

// src/notifications/config.ts
function getNotificationConfigPath() {
  return (0, import_path5.join)(getClaudeConfigDir(), ".omc-config.json");
}
function readRawConfig() {
  if (!(0, import_fs6.existsSync)(CONFIG_FILE)) return null;
  try {
    return JSON.parse((0, import_fs6.readFileSync)(CONFIG_FILE, "utf-8"));
  } catch {
    return null;
  }
}
function migrateStopHookCallbacks(raw) {
  const callbacks = raw.stopHookCallbacks;
  if (!callbacks) return null;
  const config = {
    enabled: true,
    events: {
      "session-end": { enabled: true }
    }
  };
  const telegram = callbacks.telegram;
  if (telegram?.enabled) {
    const telegramConfig = {
      enabled: true,
      botToken: telegram.botToken || "",
      chatId: telegram.chatId || ""
    };
    config.telegram = telegramConfig;
  }
  const discord = callbacks.discord;
  if (discord?.enabled) {
    const discordConfig = {
      enabled: true,
      webhookUrl: discord.webhookUrl || ""
    };
    config.discord = discordConfig;
  }
  return config;
}
function normalizeOptional(value) {
  const trimmed = value?.trim();
  return trimmed || void 0;
}
function validateMention(raw) {
  const mention = normalizeOptional(raw);
  if (!mention) return void 0;
  if (/^<@!?\d{17,20}>$/.test(mention) || /^<@&\d{17,20}>$/.test(mention)) {
    return mention;
  }
  return void 0;
}
function validateSlackChannel(raw) {
  const channel = normalizeOptional(raw);
  if (!channel) return void 0;
  if (/^[CG][A-Z0-9]{8,11}$/.test(channel)) return channel;
  if (/^#?[a-z0-9][a-z0-9_-]{0,79}$/.test(channel)) return channel;
  return void 0;
}
function validateSlackUsername(raw) {
  const username = normalizeOptional(raw);
  if (!username) return void 0;
  if (username.length > 80) return void 0;
  if (/^[a-zA-Z0-9][a-zA-Z0-9 _.'"-]{0,79}$/.test(username)) return username;
  return void 0;
}
function validateSlackMention(raw) {
  const mention = normalizeOptional(raw);
  if (!mention) return void 0;
  if (/^<@[UW][A-Z0-9]{8,11}>$/.test(mention)) return mention;
  if (/^<!(?:channel|here|everyone)>$/.test(mention)) return mention;
  if (/^<!subteam\^S[A-Z0-9]{8,11}>$/.test(mention)) return mention;
  return void 0;
}
function parseMentionAllowedMentions(mention) {
  if (!mention) return {};
  const userMatch = mention.match(/^<@!?(\d{17,20})>$/);
  if (userMatch) return { users: [userMatch[1]] };
  const roleMatch = mention.match(/^<@&(\d{17,20})>$/);
  if (roleMatch) return { roles: [roleMatch[1]] };
  return {};
}
function buildConfigFromEnv() {
  const config = { enabled: false };
  let hasAnyPlatform = false;
  const discordMention = validateMention(process.env.OMC_DISCORD_MENTION);
  const discordBotToken = process.env.OMC_DISCORD_NOTIFIER_BOT_TOKEN;
  const discordChannel = process.env.OMC_DISCORD_NOTIFIER_CHANNEL;
  if (discordBotToken && discordChannel) {
    config["discord-bot"] = {
      enabled: true,
      botToken: discordBotToken,
      channelId: discordChannel,
      mention: discordMention
    };
    hasAnyPlatform = true;
  }
  const discordWebhook = process.env.OMC_DISCORD_WEBHOOK_URL;
  if (discordWebhook) {
    config.discord = {
      enabled: true,
      webhookUrl: discordWebhook,
      mention: discordMention
    };
    hasAnyPlatform = true;
  }
  const telegramToken = process.env.OMC_TELEGRAM_BOT_TOKEN || process.env.OMC_TELEGRAM_NOTIFIER_BOT_TOKEN;
  const telegramChatId = process.env.OMC_TELEGRAM_CHAT_ID || process.env.OMC_TELEGRAM_NOTIFIER_CHAT_ID || process.env.OMC_TELEGRAM_NOTIFIER_UID;
  if (telegramToken && telegramChatId) {
    config.telegram = {
      enabled: true,
      botToken: telegramToken,
      chatId: telegramChatId
    };
    hasAnyPlatform = true;
  }
  const slackWebhook = process.env.OMC_SLACK_WEBHOOK_URL;
  if (slackWebhook) {
    config.slack = {
      enabled: true,
      webhookUrl: slackWebhook,
      mention: validateSlackMention(process.env.OMC_SLACK_MENTION)
    };
    hasAnyPlatform = true;
  }
  const slackBotToken = process.env.OMC_SLACK_BOT_TOKEN;
  const slackBotChannel = process.env.OMC_SLACK_BOT_CHANNEL;
  if (slackBotToken && slackBotChannel) {
    config["slack-bot"] = {
      enabled: true,
      appToken: process.env.OMC_SLACK_APP_TOKEN,
      botToken: slackBotToken,
      channelId: slackBotChannel,
      mention: validateSlackMention(process.env.OMC_SLACK_MENTION)
    };
    hasAnyPlatform = true;
  }
  if (!hasAnyPlatform) return null;
  config.enabled = true;
  return config;
}
function mergeEnvIntoFileConfig(fileConfig, envConfig) {
  const merged = { ...fileConfig };
  if (!merged["discord-bot"] && envConfig["discord-bot"]) {
    merged["discord-bot"] = envConfig["discord-bot"];
  } else if (merged["discord-bot"] && envConfig["discord-bot"]) {
    merged["discord-bot"] = {
      ...merged["discord-bot"],
      botToken: merged["discord-bot"].botToken || envConfig["discord-bot"].botToken,
      channelId: merged["discord-bot"].channelId || envConfig["discord-bot"].channelId,
      mention: merged["discord-bot"].mention !== void 0 ? validateMention(merged["discord-bot"].mention) : envConfig["discord-bot"].mention
    };
  } else if (merged["discord-bot"]) {
    merged["discord-bot"] = {
      ...merged["discord-bot"],
      mention: validateMention(merged["discord-bot"].mention)
    };
  }
  if (!merged.discord && envConfig.discord) {
    merged.discord = envConfig.discord;
  } else if (merged.discord && envConfig.discord) {
    merged.discord = {
      ...merged.discord,
      webhookUrl: merged.discord.webhookUrl || envConfig.discord.webhookUrl,
      mention: merged.discord.mention !== void 0 ? validateMention(merged.discord.mention) : envConfig.discord.mention
    };
  } else if (merged.discord) {
    merged.discord = {
      ...merged.discord,
      mention: validateMention(merged.discord.mention)
    };
  }
  if (!merged.telegram && envConfig.telegram) {
    merged.telegram = envConfig.telegram;
  }
  if (!merged.slack && envConfig.slack) {
    merged.slack = envConfig.slack;
  } else if (merged.slack && envConfig.slack) {
    merged.slack = {
      ...merged.slack,
      webhookUrl: merged.slack.webhookUrl || envConfig.slack.webhookUrl,
      mention: merged.slack.mention !== void 0 ? validateSlackMention(merged.slack.mention) : envConfig.slack.mention
    };
  } else if (merged.slack) {
    merged.slack = {
      ...merged.slack,
      mention: validateSlackMention(merged.slack.mention)
    };
  }
  if (!merged["slack-bot"] && envConfig["slack-bot"]) {
    merged["slack-bot"] = envConfig["slack-bot"];
  } else if (merged["slack-bot"] && envConfig["slack-bot"]) {
    merged["slack-bot"] = {
      ...merged["slack-bot"],
      appToken: merged["slack-bot"].appToken || envConfig["slack-bot"].appToken,
      botToken: merged["slack-bot"].botToken || envConfig["slack-bot"].botToken,
      channelId: merged["slack-bot"].channelId || envConfig["slack-bot"].channelId,
      mention: merged["slack-bot"].mention !== void 0 ? validateSlackMention(merged["slack-bot"].mention) : envConfig["slack-bot"].mention
    };
  } else if (merged["slack-bot"]) {
    merged["slack-bot"] = {
      ...merged["slack-bot"],
      mention: validateSlackMention(merged["slack-bot"].mention)
    };
  }
  return merged;
}
function applyHookAndEnvMerge(config) {
  const hookConfig = getHookConfig();
  let merged = config;
  if (hookConfig?.enabled && hookConfig.events) {
    merged = mergeHookConfigIntoNotificationConfig(hookConfig, merged);
  }
  return applyEnvMerge(merged);
}
function applyEnvMerge(config) {
  const envConfig = buildConfigFromEnv();
  let merged = envConfig ? mergeEnvIntoFileConfig(config, envConfig) : config;
  const envMention = validateMention(process.env.OMC_DISCORD_MENTION);
  if (envMention) {
    if (merged["discord-bot"] && merged["discord-bot"].mention == null) {
      merged = { ...merged, "discord-bot": { ...merged["discord-bot"], mention: envMention } };
    }
    if (merged.discord && merged.discord.mention == null) {
      merged = { ...merged, discord: { ...merged.discord, mention: envMention } };
    }
  }
  const envSlackMention = validateSlackMention(process.env.OMC_SLACK_MENTION);
  if (envSlackMention) {
    if (merged.slack && merged.slack.mention == null) {
      merged = { ...merged, slack: { ...merged.slack, mention: envSlackMention } };
    }
    if (merged["slack-bot"] && merged["slack-bot"].mention == null) {
      merged = { ...merged, "slack-bot": { ...merged["slack-bot"], mention: envSlackMention } };
    }
  }
  return merged;
}
function getVerbosity(config) {
  const envValue = process.env.OMC_NOTIFY_VERBOSITY;
  if (envValue && VALID_VERBOSITY_LEVELS.has(envValue)) {
    return envValue;
  }
  if (config.verbosity && VALID_VERBOSITY_LEVELS.has(config.verbosity)) {
    return config.verbosity;
  }
  return "session";
}
function getTmuxTailLines(config) {
  const envValue = Number.parseInt(process.env.OMC_NOTIFY_TMUX_TAIL_LINES ?? "", 10);
  if (Number.isInteger(envValue) && envValue >= 1) {
    return envValue;
  }
  const configValue = config.tmuxTailLines;
  if (typeof configValue === "number" && Number.isInteger(configValue) && configValue >= 1) {
    return configValue;
  }
  return DEFAULT_TMUX_TAIL_LINES;
}
function isEventAllowedByVerbosity(verbosity, event) {
  switch (verbosity) {
    case "verbose":
      return true;
    case "agent":
      return SESSION_EVENTS.has(event) || event === "agent-call";
    case "session":
    case "minimal":
      return SESSION_EVENTS.has(event);
    default:
      return SESSION_EVENTS.has(event);
  }
}
function shouldIncludeTmuxTail(verbosity) {
  return verbosity !== "minimal";
}
function getNotificationConfig(profileName) {
  const raw = readRawConfig();
  const effectiveProfile = profileName || process.env.OMC_NOTIFY_PROFILE;
  if (effectiveProfile && raw) {
    const profiles = raw.notificationProfiles;
    if (profiles && profiles[effectiveProfile]) {
      const profileConfig = profiles[effectiveProfile];
      if (typeof profileConfig.enabled !== "boolean") {
        return null;
      }
      return applyHookAndEnvMerge(profileConfig);
    }
    console.warn(
      `[notifications] Profile "${effectiveProfile}" not found, using default`
    );
  }
  if (raw) {
    const notifications = raw.notifications;
    if (notifications) {
      if (typeof notifications.enabled !== "boolean") {
        return null;
      }
      return applyHookAndEnvMerge(notifications);
    }
  }
  const envConfig = buildConfigFromEnv();
  if (envConfig) return envConfig;
  if (raw) {
    return migrateStopHookCallbacks(raw);
  }
  return null;
}
function isPlatformActivated(platform) {
  if (platform === "telegram") return process.env.OMC_TELEGRAM === "1";
  if (platform === "discord" || platform === "discord-bot")
    return process.env.OMC_DISCORD === "1";
  if (platform === "slack" || platform === "slack-bot")
    return process.env.OMC_SLACK === "1";
  if (platform === "webhook") return process.env.OMC_WEBHOOK === "1";
  return false;
}
function isEventEnabled(config, event) {
  if (!config.enabled) return false;
  const eventConfig = config.events?.[event];
  if (eventConfig && eventConfig.enabled === false) return false;
  if (!eventConfig) {
    return !!(isPlatformActivated("discord") && config.discord?.enabled || isPlatformActivated("discord-bot") && config["discord-bot"]?.enabled || isPlatformActivated("telegram") && config.telegram?.enabled || isPlatformActivated("slack") && config.slack?.enabled || isPlatformActivated("slack-bot") && config["slack-bot"]?.enabled || isPlatformActivated("webhook") && config.webhook?.enabled);
  }
  if (isPlatformActivated("discord") && eventConfig.discord?.enabled || isPlatformActivated("discord-bot") && eventConfig["discord-bot"]?.enabled || isPlatformActivated("telegram") && eventConfig.telegram?.enabled || isPlatformActivated("slack") && eventConfig.slack?.enabled || isPlatformActivated("slack-bot") && eventConfig["slack-bot"]?.enabled || isPlatformActivated("webhook") && eventConfig.webhook?.enabled) {
    return true;
  }
  return !!(isPlatformActivated("discord") && config.discord?.enabled || isPlatformActivated("discord-bot") && config["discord-bot"]?.enabled || isPlatformActivated("telegram") && config.telegram?.enabled || isPlatformActivated("slack") && config.slack?.enabled || isPlatformActivated("slack-bot") && config["slack-bot"]?.enabled || isPlatformActivated("webhook") && config.webhook?.enabled);
}
function getEnabledPlatforms(config, event) {
  if (!config.enabled) return [];
  const platforms = [];
  const eventConfig = config.events?.[event];
  if (eventConfig && eventConfig.enabled === false) return [];
  const checkPlatform = (platform) => {
    if (!isPlatformActivated(platform)) return;
    const eventPlatform = eventConfig?.[platform];
    if (eventPlatform && typeof eventPlatform === "object" && "enabled" in eventPlatform) {
      if (eventPlatform.enabled) {
        platforms.push(platform);
      }
      return;
    }
    const topLevel = config[platform];
    if (topLevel && typeof topLevel === "object" && "enabled" in topLevel && topLevel.enabled) {
      platforms.push(platform);
    }
  };
  checkPlatform("discord");
  checkPlatform("discord-bot");
  checkPlatform("telegram");
  checkPlatform("slack");
  checkPlatform("slack-bot");
  checkPlatform("webhook");
  return platforms;
}
function getLegacyOpenClawConfigPath() {
  return (0, import_path5.join)(getClaudeConfigDir(), "omc_config.openclaw.json");
}
function detectLegacyOpenClawConfig() {
  return (0, import_fs6.existsSync)(LEGACY_OPENCLAW_CONFIG);
}
function migrateLegacyOpenClawConfig() {
  if (!(0, import_fs6.existsSync)(LEGACY_OPENCLAW_CONFIG)) return null;
  try {
    const legacy = JSON.parse((0, import_fs6.readFileSync)(LEGACY_OPENCLAW_CONFIG, "utf-8"));
    const gateways = legacy.gateways;
    if (!gateways || Object.keys(gateways).length === 0) return null;
    const gateway = Object.values(gateways)[0];
    const gatewayName = Object.keys(gateways)[0];
    const hooks = legacy.hooks;
    const events = [];
    if (hooks) {
      for (const [hookName, hookConfig] of Object.entries(hooks)) {
        if (hookConfig?.enabled) {
          const eventName = hookName.replace(/([A-Z])/g, "-$1").toLowerCase();
          events.push(eventName);
        }
      }
    }
    const integration = {
      id: `migrated-${gatewayName}`,
      type: "webhook",
      preset: "openclaw",
      enabled: legacy.enabled !== false,
      config: {
        url: gateway.url || "",
        method: gateway.method || "POST",
        headers: gateway.headers || { "Content-Type": "application/json" },
        bodyTemplate: JSON.stringify({
          event: "{{event}}",
          instruction: "Session {{sessionId}} {{event}}",
          timestamp: "{{timestamp}}",
          context: {
            projectPath: "{{projectPath}}",
            projectName: "{{projectName}}",
            sessionId: "{{sessionId}}"
          }
        }, null, 2),
        timeout: gateway.timeout || 1e4
      },
      events
    };
    return integration;
  } catch {
    return null;
  }
}
function getCustomIntegrationsConfig() {
  const raw = readRawConfig();
  if (!raw) return null;
  const customIntegrations = raw.customIntegrations;
  if (!customIntegrations) return null;
  const validIntegrations = [];
  for (const integration of customIntegrations.integrations || []) {
    const result = validateCustomIntegration(integration);
    if (result.valid) {
      validIntegrations.push(integration);
    } else {
      console.warn(
        `[notifications] Invalid custom integration "${integration.id}": ${result.errors.join(", ")}`
      );
    }
  }
  const duplicates = checkDuplicateIds(validIntegrations);
  if (duplicates.length > 0) {
    console.warn(
      `[notifications] Duplicate custom integration IDs found: ${duplicates.join(", ")}`
    );
  }
  return {
    enabled: customIntegrations.enabled !== false,
    integrations: validIntegrations
  };
}
function getCustomIntegrationsForEvent(event) {
  const config = getCustomIntegrationsConfig();
  if (!config?.enabled) return [];
  return config.integrations.filter(
    (i) => i.enabled && i.events.includes(event)
  );
}
function hasCustomIntegrationsEnabled(event) {
  const config = getCustomIntegrationsConfig();
  if (!config?.enabled) return false;
  if (!event) return config.integrations.some((i) => i.enabled);
  return config.integrations.some(
    (i) => i.enabled && i.events.includes(event)
  );
}
var import_fs6, import_path5, CONFIG_FILE, DEFAULT_TMUX_TAIL_LINES, VALID_VERBOSITY_LEVELS, SESSION_EVENTS, LEGACY_OPENCLAW_CONFIG;
var init_config = __esm({
  "src/notifications/config.ts"() {
    "use strict";
    import_fs6 = require("fs");
    import_path5 = require("path");
    init_config_dir();
    init_hook_config();
    init_validation();
    CONFIG_FILE = getNotificationConfigPath();
    DEFAULT_TMUX_TAIL_LINES = 15;
    VALID_VERBOSITY_LEVELS = /* @__PURE__ */ new Set([
      "verbose",
      "agent",
      "session",
      "minimal"
    ]);
    SESSION_EVENTS = /* @__PURE__ */ new Set([
      "session-start",
      "session-stop",
      "session-end",
      "session-idle"
    ]);
    LEGACY_OPENCLAW_CONFIG = getLegacyOpenClawConfigPath();
  }
});

// src/notifications/formatter.ts
function formatDuration(ms) {
  if (!ms) return "unknown";
  const seconds = Math.floor(ms / 1e3);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}
function projectDisplay(payload) {
  if (payload.projectName) return payload.projectName;
  if (payload.projectPath) return (0, import_path6.basename)(payload.projectPath);
  return "unknown";
}
function buildFooter(payload, markdown) {
  const parts = [];
  if (payload.tmuxSession) {
    parts.push(
      markdown ? `**tmux:** \`${payload.tmuxSession}\`` : `tmux: ${payload.tmuxSession}`
    );
  }
  parts.push(
    markdown ? `**project:** \`${projectDisplay(payload)}\`` : `project: ${projectDisplay(payload)}`
  );
  return parts.join(markdown ? " | " : " | ");
}
function formatSessionStart(payload) {
  const time = new Date(payload.timestamp).toLocaleTimeString();
  const project = projectDisplay(payload);
  const lines = [
    `# Session Started`,
    "",
    `**Session:** \`${payload.sessionId}\``,
    `**Project:** \`${project}\``,
    `**Time:** ${time}`
  ];
  if (payload.tmuxSession) {
    lines.push(`**tmux:** \`${payload.tmuxSession}\``);
  }
  return lines.join("\n");
}
function formatSessionStop(payload) {
  const lines = [`# Session Continuing`, ""];
  if (payload.activeMode) {
    lines.push(`**Mode:** ${payload.activeMode}`);
  }
  if (payload.iteration != null && payload.maxIterations != null) {
    lines.push(`**Iteration:** ${payload.iteration}/${payload.maxIterations}`);
  }
  if (payload.incompleteTasks != null && payload.incompleteTasks > 0) {
    lines.push(`**Incomplete tasks:** ${payload.incompleteTasks}`);
  }
  lines.push("");
  lines.push(buildFooter(payload, true));
  return lines.join("\n");
}
function formatSessionEnd(payload) {
  const duration = formatDuration(payload.durationMs);
  const lines = [
    `# Session Ended`,
    "",
    `**Session:** \`${payload.sessionId}\``,
    `**Duration:** ${duration}`,
    `**Reason:** ${payload.reason || "unknown"}`
  ];
  if (payload.agentsSpawned != null) {
    lines.push(
      `**Agents:** ${payload.agentsCompleted ?? 0}/${payload.agentsSpawned} completed`
    );
  }
  if (payload.modesUsed && payload.modesUsed.length > 0) {
    lines.push(`**Modes:** ${payload.modesUsed.join(", ")}`);
  }
  if (payload.contextSummary) {
    lines.push("", `**Summary:** ${payload.contextSummary}`);
  }
  appendTmuxTail(lines, payload);
  lines.push("");
  lines.push(buildFooter(payload, true));
  return lines.join("\n");
}
function formatSessionIdle(payload) {
  const lines = [`# Session Idle`, ""];
  lines.push(`Claude has finished and is waiting for input.`);
  lines.push("");
  if (payload.reason) {
    lines.push(`**Reason:** ${payload.reason}`);
  }
  if (payload.modesUsed && payload.modesUsed.length > 0) {
    lines.push(`**Modes:** ${payload.modesUsed.join(", ")}`);
  }
  appendTmuxTail(lines, payload);
  lines.push("");
  lines.push(buildFooter(payload, true));
  return lines.join("\n");
}
function extractReviewSeedOutcomeKeys(line) {
  return REVIEW_SEED_OUTCOME_PATTERNS.filter(({ pattern }) => pattern.test(line)).map(({ key }) => key);
}
function trimReviewSeedPrefix(lines) {
  if (lines.length === 0) return lines;
  const prefix = lines.slice(0, 10);
  const distinctOutcomes = /* @__PURE__ */ new Set();
  let hasCue = false;
  let hasListMarker = false;
  let candidateEnd = -1;
  for (let index = 0; index < prefix.length; index += 1) {
    const line = prefix[index];
    const outcomeKeys = extractReviewSeedOutcomeKeys(line);
    const isCueLine = REVIEW_SEED_CUE_RE.test(line);
    const isSeedLine = outcomeKeys.length > 0 || isCueLine || candidateEnd >= 0 && REVIEW_SEED_LIST_RE.test(line);
    outcomeKeys.forEach((key) => distinctOutcomes.add(key));
    if (isCueLine) hasCue = true;
    if (REVIEW_SEED_LIST_RE.test(line)) hasListMarker = true;
    if (isSeedLine) {
      candidateEnd = index;
      continue;
    }
    if (candidateEnd >= 0) break;
  }
  const qualifies = candidateEnd >= 0 && hasCue && (distinctOutcomes.size >= 2 || hasListMarker);
  if (!qualifies) return lines;
  return lines.slice(candidateEnd + 1);
}
function looksLikeStructuredAlertLiteral(line) {
  const trimmed = line.trim();
  if (!STRUCTURED_ALERT_KEYWORD_RE.test(trimmed)) return false;
  if (/^(?:\{.*\}|\[.*\])$/.test(trimmed) && /["'{\[\]}:,]/.test(trimmed)) return true;
  if (JSONISH_LINE_RE.test(trimmed)) return true;
  if (CODE_LITERAL_PREFIX_RE.test(trimmed) && /["'`{}[\]()=>]/.test(trimmed)) return true;
  return false;
}
function looksLikeAlertSearchCommand(line) {
  const trimmed = line.trim();
  return SEARCH_COMMAND_RE.test(trimmed) && STRUCTURED_ALERT_KEYWORD_RE.test(trimmed) && (QUOTED_OR_REGEX_QUERY_RE.test(trimmed) || trimmed.includes("|"));
}
function looksLikeAlertRegexLiteral(line) {
  const trimmed = line.trim();
  return STRUCTURED_ALERT_KEYWORD_RE.test(trimmed) && ALERT_REGEX_LITERAL_RE.test(trimmed);
}
function isCommandBoilerplateLine(line) {
  return /^(?:command failed with exit code \d+:|exit code \d+)$/i.test(line.trim());
}
function stripLeadingNoisePrefix(lines) {
  let index = 0;
  while (index < lines.length) {
    const line = lines[index].trim();
    if (PERMISSION_DENIED_SCAN_LINE_RE.test(line) || CLEAN_DIAGNOSTIC_QUERY_RE.test(line) || GENERIC_HOOK_FAILURE_PROSE_RE.test(line) || ISSUE_PROMPT_NOISE_RE.test(line) || ZERO_ALERT_SUMMARY_RE.test(line) || isCommandBoilerplateLine(line)) {
      index += 1;
      continue;
    }
    break;
  }
  return index > 0 ? lines.slice(index) : lines;
}
function parseTmuxTail(raw, maxLines = DEFAULT_MAX_TAIL_LINES) {
  const meaningful = [];
  for (const line of raw.split("\n")) {
    const stripped = line.replace(ANSI_ESCAPE_RE, "");
    const trimmed2 = stripped.trim();
    if (!trimmed2) continue;
    if (UI_CHROME_RE.test(trimmed2)) continue;
    if (CTRL_O_RE.test(trimmed2)) continue;
    if (BOX_DRAWING_RE.test(trimmed2)) continue;
    if (OMC_HUD_RE.test(trimmed2)) continue;
    if (BYPASS_PERM_RE.test(trimmed2)) continue;
    if (BARE_PROMPT_RE.test(trimmed2)) continue;
    if (DIFF_HEADER_LINE_RE.test(trimmed2)) continue;
    if (looksLikeAlertSearchCommand(trimmed2)) continue;
    if (REQUEST_RESPONSE_LITERAL_RE.test(trimmed2)) continue;
    if (HELP_USAGE_LINE_RE.test(trimmed2)) continue;
    if (STATIC_HELP_CODE_RE.test(trimmed2)) continue;
    if (ZERO_ALERT_SUMMARY_RE.test(trimmed2)) continue;
    if (GENERIC_HOOK_FAILURE_PROSE_RE.test(trimmed2)) continue;
    if (ISSUE_PROMPT_NOISE_RE.test(trimmed2)) continue;
    if (PERMISSION_DENIED_SCAN_LINE_RE.test(trimmed2)) continue;
    if (CLEAN_DIAGNOSTIC_QUERY_RE.test(trimmed2)) continue;
    if (SOURCE_PATH_LINE_RE.test(trimmed2) && STATIC_CODE_ALERT_RE.test(trimmed2)) continue;
    if (SOURCE_PATH_LINE_RE.test(trimmed2)) {
      const sourceContent = trimmed2.replace(SOURCE_PATH_LINE_RE, "").trim();
      if (looksLikeStructuredAlertLiteral(sourceContent) || looksLikeAlertRegexLiteral(sourceContent)) continue;
    }
    if (looksLikeAlertRegexLiteral(trimmed2)) continue;
    if (looksLikeStructuredAlertLiteral(trimmed2)) continue;
    const alnumCount = (trimmed2.match(/[a-zA-Z0-9]/g) || []).length;
    if (trimmed2.length >= 8 && alnumCount / trimmed2.length < MIN_ALNUM_RATIO) continue;
    meaningful.push(stripped.trimEnd());
  }
  const trimmed = trimReviewSeedPrefix(meaningful);
  return stripLeadingNoisePrefix(trimmed).slice(-maxLines).join("\n");
}
function appendTmuxTail(lines, payload) {
  if (payload.tmuxTail) {
    const parsed = parseTmuxTail(payload.tmuxTail, payload.maxTailLines);
    if (parsed) {
      lines.push("");
      lines.push("**Recent output:**");
      lines.push("```");
      lines.push(parsed);
      lines.push("```");
    }
  }
}
function formatAgentCall(payload) {
  const lines = [`# Agent Spawned`, ""];
  if (payload.agentName) {
    lines.push(`**Agent:** \`${payload.agentName}\``);
  }
  if (payload.agentType) {
    lines.push(`**Type:** \`${payload.agentType}\``);
  }
  lines.push("");
  lines.push(buildFooter(payload, true));
  return lines.join("\n");
}
function formatAskUserQuestion(payload) {
  const lines = [`# Input Needed`, ""];
  if (payload.question) {
    lines.push(`**Question:** ${payload.question}`);
    lines.push("");
  }
  if (payload.askUserQuestionPrompts?.length) {
    for (const [promptIndex, prompt] of payload.askUserQuestionPrompts.entries()) {
      if (payload.askUserQuestionPrompts.length > 1) {
        lines.push(`**${prompt.header || `Question ${promptIndex + 1}`}:** ${prompt.question}`);
      }
      if (prompt.options.length > 0 || prompt.allowOther !== false) {
        lines.push("**Options:**");
        prompt.options.forEach((option, optionIndex) => {
          const description = option.description ? ` \u2014 ${option.description}` : "";
          lines.push(`${optionIndex + 1}. ${option.label}${description}`);
        });
        if (prompt.allowOther !== false) {
          lines.push(`${prompt.options.length + 1}. ${prompt.otherLabel || "Other"} \u2014 reply with free text`);
        }
        lines.push("");
      }
    }
  }
  lines.push(`Claude is waiting for your response.`);
  lines.push("");
  lines.push(buildFooter(payload, true));
  return lines.join("\n");
}
function formatNotification(payload) {
  switch (payload.event) {
    case "session-start":
      return formatSessionStart(payload);
    case "session-stop":
      return formatSessionStop(payload);
    case "session-end":
      return formatSessionEnd(payload);
    case "session-idle":
      return formatSessionIdle(payload);
    case "ask-user-question":
      return formatAskUserQuestion(payload);
    case "agent-call":
      return formatAgentCall(payload);
    default:
      return payload.message || `Event: ${payload.event}`;
  }
}
var import_path6, ANSI_ESCAPE_RE, UI_CHROME_RE, CTRL_O_RE, BOX_DRAWING_RE, OMC_HUD_RE, BYPASS_PERM_RE, BARE_PROMPT_RE, MIN_ALNUM_RATIO, REVIEW_SEED_OUTCOME_PATTERNS, REVIEW_SEED_CUE_RE, REVIEW_SEED_LIST_RE, SOURCE_PATH_LINE_RE, STATIC_CODE_ALERT_RE, HELP_USAGE_LINE_RE, STATIC_HELP_CODE_RE, DIFF_HEADER_LINE_RE, STRUCTURED_ALERT_KEYWORD_RE, SEARCH_COMMAND_RE, QUOTED_OR_REGEX_QUERY_RE, ZERO_ALERT_SUMMARY_RE, ALERT_REGEX_LITERAL_RE, GENERIC_HOOK_FAILURE_PROSE_RE, ISSUE_PROMPT_NOISE_RE, PERMISSION_DENIED_SCAN_LINE_RE, CLEAN_DIAGNOSTIC_QUERY_RE, JSONISH_LINE_RE, REQUEST_RESPONSE_LITERAL_RE, CODE_LITERAL_PREFIX_RE, DEFAULT_MAX_TAIL_LINES;
var init_formatter = __esm({
  "src/notifications/formatter.ts"() {
    "use strict";
    import_path6 = require("path");
    ANSI_ESCAPE_RE = /\x1b(?:[@-Z\\-_]|\[[0-9;]*[a-zA-Z])/g;
    UI_CHROME_RE = /^[●⎿✻·◼]/;
    CTRL_O_RE = /ctrl\+o to expand/i;
    BOX_DRAWING_RE = /^[\s─═│║┌┐└┘┬┴├┤╔╗╚╝╠╣╦╩╬╟╢╤╧╪━┃┏┓┗┛┣┫┳┻╋┠┨┯┷┿╂]+$/;
    OMC_HUD_RE = /\[OMC[#\]]/;
    BYPASS_PERM_RE = /^⏵/;
    BARE_PROMPT_RE = /^[❯>$%#]+$/;
    MIN_ALNUM_RATIO = 0.15;
    REVIEW_SEED_OUTCOME_PATTERNS = [
      { key: "approve", pattern: /\bapprove\b/i },
      { key: "request-changes", pattern: /\brequest[- ]changes\b/i },
      { key: "follow-up-fix", pattern: /\bfollow[- ]up[- ]fix\b/i },
      { key: "blocked", pattern: /\bblocked\b/i },
      { key: "error", pattern: /\berrors?\b/i },
      { key: "failure", pattern: /\bfail(?:ed|ure|ures)?\b/i },
      { key: "conflict", pattern: /\bconflicts?\b/i }
    ];
    REVIEW_SEED_CUE_RE = /\b(review|verdict|respond|reply|return|output|classification|classify|decision|choose|label)\b/i;
    REVIEW_SEED_LIST_RE = /^(?:[-*•]|\d+[.)]|[A-Z][A-Z_-]+:|\([a-z0-9]+\))/;
    SOURCE_PATH_LINE_RE = /^(?:\.\/)?[A-Za-z0-9_./-]+:\d+:/;
    STATIC_CODE_ALERT_RE = /(?:\blog_error\b|\becho\b).*?(?:"error\||"Usage:)|==\s*"error"/;
    HELP_USAGE_LINE_RE = /^(?:Usage|Examples?|Commands?|Options?|Flags?):/i;
    STATIC_HELP_CODE_RE = /^(?:log_error\s+"Usage:|if\s+\[\[.*==\s*"error".*\]\];?\s*then$)/;
    DIFF_HEADER_LINE_RE = /^(?:diff --git\b|index\s+[0-9a-f]{6,}\.\.[0-9a-f]{6,}\b|@@\s+[-+]\d|---\s+\S|\+\+\+\s+\S)/i;
    STRUCTURED_ALERT_KEYWORD_RE = /\b(?:error|errors?|fail(?:ed|ure|ures)?|conflict|conflicts|operation_failed|claim_conflict|invalid_transition|blocked_dependency|worker_notify_failed)\b/i;
    SEARCH_COMMAND_RE = /^(?:[$❯>#]\s*)?(?:rg|ripgrep|grep|egrep|fgrep)\b/i;
    QUOTED_OR_REGEX_QUERY_RE = /(?:"[^"\n]+"|'[^'\n]+'|`[^`\n]+`|\/[^/\n]+\/[a-z]*)/i;
    ZERO_ALERT_SUMMARY_RE = /\b(?:0|zero)\s+(?:errors?|fail(?:ed|ures?)?|conflicts?)\b|\b(?:errors?|fail(?:ed|ures?)?|conflicts?)\s*[:=]\s*0\b|\btotalErrors\s*[:=]\s*0\b|\b(?:TypeScript|LSP)\s+check\s+passed:\s*0 errors,\s*0 warnings\b/i;
    ALERT_REGEX_LITERAL_RE = /(?:^|[=(:,]\s*)(?:new\s+RegExp\(|\/)(?=[^)\n;]*\b(?:error|errors?|fail(?:ed|ure|ures)?|conflict|conflicts|operation_failed|claim_conflict|invalid_transition|blocked_dependency|worker_notify_failed)\b)/i;
    GENERIC_HOOK_FAILURE_PROSE_RE = /^The Bash output indicates (?:a )?(?:command\/setup|command|setup) failure\b/i;
    ISSUE_PROMPT_NOISE_RE = /^(?:fix|review|investigate|analyze|search|find|look\s+for|debug|harden)\b.*\b(?:issue|pr)\s*#\d+\b.*\b(?:error|errors?|fail(?:ed|ure|ures)?|conflict|conflicts)\b/i;
    PERMISSION_DENIED_SCAN_LINE_RE = /^(?:find|grep|rg): .*permission denied$/i;
    CLEAN_DIAGNOSTIC_QUERY_RE = /^(?:[$❯>#]\s*)?(?:rg|ripgrep|grep)\b.*\b(?:severity\s*[:=]\s*["']?error["']?|diagnostic(?:s)?|lsp_diagnostics(?:_directory)?)\b/i;
    JSONISH_LINE_RE = /^(?:[{[]|"(?:[^"\\]|\\.)+"\s*:|'(?:[^'\\]|\\.)+'\s*:)/;
    REQUEST_RESPONSE_LITERAL_RE = /^(?:payload|request|response|input|output|args|params|body|mcp)\s*[:=]\s*[{[]/i;
    CODE_LITERAL_PREFIX_RE = /^(?:[+-]\s*(?:[{[]|"(?:[^"\\]|\\.)+"\s*:|'(?:[^'\\]|\\.)+'\s*:|(?:const|let|var|return|throw|if|await|expect|mock|vi\.)\b|[A-Za-z_$][\w$-]*\s*:)|(?:const|let|var|return|throw|if|await|expect|mock|vi\.)\b)/;
    DEFAULT_MAX_TAIL_LINES = 15;
  }
});

// src/notifications/template-engine.ts
function formatDuration2(ms) {
  if (!ms) return "unknown";
  const seconds = Math.floor(ms / 1e3);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}
function getProjectDisplay(payload) {
  if (payload.projectName) return payload.projectName;
  if (payload.projectPath) return (0, import_path7.basename)(payload.projectPath);
  return "unknown";
}
function buildFooterText(payload) {
  const parts = [];
  if (payload.tmuxSession) {
    parts.push(`**tmux:** \`${payload.tmuxSession}\``);
  }
  parts.push(`**project:** \`${getProjectDisplay(payload)}\``);
  return parts.join(" | ");
}
function buildTmuxTailBlock(payload) {
  if (!payload.tmuxTail) return "";
  const parsed = parseTmuxTail(payload.tmuxTail, payload.maxTailLines);
  if (!parsed) return "";
  return `

**Recent output:**
\`\`\`
${parsed}
\`\`\``;
}
function computeTemplateVariables(payload) {
  const vars = {};
  vars.event = payload.event || "";
  vars.sessionId = payload.sessionId || "";
  vars.message = payload.message || "";
  vars.timestamp = payload.timestamp || "";
  vars.tmuxSession = payload.tmuxSession || "";
  vars.projectPath = payload.projectPath || "";
  vars.projectName = payload.projectName || "";
  vars.modesUsed = payload.modesUsed?.join(", ") || "";
  vars.contextSummary = payload.contextSummary || "";
  vars.durationMs = payload.durationMs != null ? String(payload.durationMs) : "";
  vars.agentsSpawned = payload.agentsSpawned != null ? String(payload.agentsSpawned) : "";
  vars.agentsCompleted = payload.agentsCompleted != null ? String(payload.agentsCompleted) : "";
  vars.reason = payload.reason || "";
  vars.activeMode = payload.activeMode || "";
  vars.iteration = payload.iteration != null ? String(payload.iteration) : "";
  vars.maxIterations = payload.maxIterations != null ? String(payload.maxIterations) : "";
  vars.question = payload.question || "";
  vars.questionOptions = payload.askUserQuestionPrompts?.map((prompt) => {
    const optionLines = prompt.options.map((option, index) => {
      const description = option.description ? ` \u2014 ${option.description}` : "";
      return `${index + 1}. ${option.label}${description}`;
    });
    if (prompt.allowOther !== false) {
      optionLines.push(`${prompt.options.length + 1}. ${prompt.otherLabel || "Other"} \u2014 reply with free text`);
    }
    return optionLines.join("\n");
  }).filter(Boolean).join("\n\n") || "";
  vars.incompleteTasks = payload.incompleteTasks != null ? String(payload.incompleteTasks) : "";
  vars.agentName = payload.agentName || "";
  vars.agentType = payload.agentType || "";
  vars.tmuxTail = payload.tmuxTail || "";
  vars.tmuxPaneId = payload.tmuxPaneId || "";
  vars.replyChannel = payload.replyChannel || "";
  vars.replyTarget = payload.replyTarget || "";
  vars.replyThread = payload.replyThread || "";
  vars.duration = formatDuration2(payload.durationMs);
  vars.time = payload.timestamp ? new Date(payload.timestamp).toLocaleTimeString() : "";
  vars.modesDisplay = payload.modesUsed && payload.modesUsed.length > 0 ? payload.modesUsed.join(", ") : "";
  vars.iterationDisplay = payload.iteration != null && payload.maxIterations != null ? `${payload.iteration}/${payload.maxIterations}` : "";
  vars.agentDisplay = payload.agentsSpawned != null ? `${payload.agentsCompleted ?? 0}/${payload.agentsSpawned} completed` : "";
  vars.projectDisplay = getProjectDisplay(payload);
  vars.footer = buildFooterText(payload);
  vars.tmuxTailBlock = buildTmuxTailBlock(payload);
  vars.reasonDisplay = payload.reason || "unknown";
  return vars;
}
function processConditionals(template, vars) {
  return template.replace(
    /\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g,
    (_match, varName, content) => {
      const value = vars[varName] || "";
      return value ? content : "";
    }
  );
}
function replaceVariables(template, vars) {
  return template.replace(
    /\{\{(\w+)\}\}/g,
    (_match, varName) => vars[varName] ?? ""
  );
}
function postProcess(text) {
  return text.trimEnd();
}
function interpolateTemplate(template, payload) {
  const vars = computeTemplateVariables(payload);
  let result = processConditionals(template, vars);
  result = replaceVariables(result, vars);
  result = postProcess(result);
  return result;
}
function validateTemplate(template) {
  const unknownVars = [];
  for (const m of template.matchAll(/\{\{#if\s+(\w+)\}\}/g)) {
    if (!KNOWN_VARIABLES.has(m[1]) && !unknownVars.includes(m[1])) {
      unknownVars.push(m[1]);
    }
  }
  for (const m of template.matchAll(/\{\{(?!#if\s|\/if)(\w+)\}\}/g)) {
    if (!KNOWN_VARIABLES.has(m[1]) && !unknownVars.includes(m[1])) {
      unknownVars.push(m[1]);
    }
  }
  return { valid: unknownVars.length === 0, unknownVars };
}
function getDefaultTemplate(event) {
  return DEFAULT_TEMPLATES[event] || `Event: {{event}}`;
}
var import_path7, KNOWN_VARIABLES, DEFAULT_TEMPLATES;
var init_template_engine = __esm({
  "src/notifications/template-engine.ts"() {
    "use strict";
    init_formatter();
    import_path7 = require("path");
    KNOWN_VARIABLES = /* @__PURE__ */ new Set([
      // Raw payload fields
      "event",
      "sessionId",
      "message",
      "timestamp",
      "tmuxSession",
      "projectPath",
      "projectName",
      "modesUsed",
      "contextSummary",
      "durationMs",
      "agentsSpawned",
      "agentsCompleted",
      "reason",
      "activeMode",
      "iteration",
      "maxIterations",
      "question",
      "questionOptions",
      "incompleteTasks",
      "agentName",
      "agentType",
      "tmuxTail",
      "tmuxPaneId",
      "replyChannel",
      "replyTarget",
      "replyThread",
      // Computed variables
      "duration",
      "time",
      "modesDisplay",
      "iterationDisplay",
      "agentDisplay",
      "projectDisplay",
      "footer",
      "tmuxTailBlock",
      "reasonDisplay"
    ]);
    DEFAULT_TEMPLATES = {
      "session-start": "# Session Started\n\n**Session:** `{{sessionId}}`\n**Project:** `{{projectDisplay}}`\n**Time:** {{time}}{{#if tmuxSession}}\n**tmux:** `{{tmuxSession}}`{{/if}}",
      "session-stop": "# Session Continuing\n{{#if activeMode}}\n**Mode:** {{activeMode}}{{/if}}{{#if iterationDisplay}}\n**Iteration:** {{iterationDisplay}}{{/if}}{{#if incompleteTasks}}\n**Incomplete tasks:** {{incompleteTasks}}{{/if}}\n\n{{footer}}",
      "session-end": "# Session Ended\n\n**Session:** `{{sessionId}}`\n**Duration:** {{duration}}\n**Reason:** {{reasonDisplay}}{{#if agentDisplay}}\n**Agents:** {{agentDisplay}}{{/if}}{{#if modesDisplay}}\n**Modes:** {{modesDisplay}}{{/if}}{{#if contextSummary}}\n\n**Summary:** {{contextSummary}}{{/if}}{{tmuxTailBlock}}\n\n{{footer}}",
      "session-idle": "# Session Idle\n\nClaude has finished and is waiting for input.\n{{#if reason}}\n**Reason:** {{reason}}{{/if}}{{#if modesDisplay}}\n**Modes:** {{modesDisplay}}{{/if}}{{tmuxTailBlock}}\n\n{{footer}}",
      "ask-user-question": "# Input Needed\n{{#if question}}\n**Question:** {{question}}\n{{/if}}\nClaude is waiting for your response.\n\n{{footer}}",
      "agent-call": "# Agent Spawned\n{{#if agentName}}\n**Agent:** `{{agentName}}`{{/if}}{{#if agentType}}\n**Type:** `{{agentType}}`{{/if}}\n\n{{footer}}"
    };
  }
});

// src/notifications/dispatcher.ts
function firstEnvValue(names) {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return void 0;
}
function normalizeNoProxyEntry(entry) {
  if (!entry.startsWith("http://") && !entry.startsWith("https://")) {
    return entry;
  }
  try {
    return new URL(entry).host.toLowerCase();
  } catch {
    return entry;
  }
}
function shouldBypassProxy(hostname, port) {
  const noProxy = firstEnvValue(["NO_PROXY", "no_proxy"]);
  if (!noProxy) return false;
  const host = hostname.toLowerCase();
  const hostWithPort = `${host}:${port}`;
  return noProxy.split(",").some((rawEntry) => {
    const entry = rawEntry.trim().toLowerCase();
    if (!entry) return false;
    if (entry === "*") return true;
    const normalizedEntry = normalizeNoProxyEntry(entry);
    const entryHost = normalizedEntry.startsWith(".") ? normalizedEntry.slice(1) : normalizedEntry.split(":")[0];
    return host === normalizedEntry || hostWithPort === normalizedEntry || host === entryHost || host.endsWith(`.${entryHost}`);
  });
}
function getTelegramProxyUrl() {
  if (shouldBypassProxy(TELEGRAM_API_HOST, TELEGRAM_API_PORT)) return void 0;
  const proxy = firstEnvValue([
    "HTTPS_PROXY",
    "https_proxy",
    "HTTP_PROXY",
    "http_proxy"
  ]);
  if (!proxy) return void 0;
  try {
    return new URL(proxy);
  } catch {
    return void 0;
  }
}
function createTelegramProxyConnection(proxyUrl) {
  return ((_options, callback) => {
    const proxyHost = proxyUrl.hostname;
    const proxyPort = Number(
      proxyUrl.port || (proxyUrl.protocol === "https:" ? 443 : 80)
    );
    const connectSocket = proxyUrl.protocol === "https:" ? (0, import_tls.connect)({ host: proxyHost, port: proxyPort, servername: proxyHost }) : (0, import_net.connect)({ host: proxyHost, port: proxyPort });
    let tlsSocket;
    let settled = false;
    const handshakeTimer = setTimeout(() => {
      fail(new Error("Proxy CONNECT timeout"));
    }, SEND_TIMEOUT_MS);
    const fail = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(handshakeTimer);
      connectSocket.destroy();
      tlsSocket?.destroy();
      callback(error);
    };
    connectSocket.once("error", fail);
    connectSocket.once(proxyUrl.protocol === "https:" ? "secureConnect" : "connect", () => {
      const auth = proxyUrl.username || proxyUrl.password ? `Proxy-Authorization: Basic ${Buffer.from(
        `${decodeURIComponent(proxyUrl.username)}:${decodeURIComponent(proxyUrl.password)}`
      ).toString("base64")}\r
` : "";
      connectSocket.write(
        `CONNECT ${TELEGRAM_API_HOST}:${TELEGRAM_API_PORT} HTTP/1.1\r
Host: ${TELEGRAM_API_HOST}:${TELEGRAM_API_PORT}\r
` + auth + "Connection: close\r\n\r\n"
      );
    });
    let response = Buffer.alloc(0);
    connectSocket.on("data", (chunk) => {
      response = Buffer.concat([response, chunk]);
      const headerEnd = response.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;
      const statusLine = response.toString("ascii", 0, headerEnd).split("\r\n")[0] || "";
      const status = /^HTTP\/\d(?:\.\d)?\s+(\d{3})/.exec(statusLine)?.[1];
      if (!status || !status.startsWith("2")) {
        fail(new Error(`Proxy CONNECT failed: ${status || "unknown"}`));
        return;
      }
      connectSocket.removeAllListeners("data");
      connectSocket.removeListener("error", fail);
      tlsSocket = (0, import_tls.connect)(
        { socket: connectSocket, servername: TELEGRAM_API_HOST },
        () => {
          if (settled) return;
          settled = true;
          clearTimeout(handshakeTimer);
          callback(null, tlsSocket);
        }
      );
      tlsSocket.once("error", fail);
    });
    return void 0;
  });
}
function telegramRequestOptions(bodyLength, botToken) {
  const options = {
    hostname: TELEGRAM_API_HOST,
    path: `/bot${botToken}/sendMessage`,
    method: "POST",
    family: 4,
    // Force IPv4 - fetch/undici has IPv6 issues on some systems
    headers: {
      "Content-Type": "application/json",
      "Content-Length": bodyLength
    },
    timeout: SEND_TIMEOUT_MS
  };
  const proxyUrl = getTelegramProxyUrl();
  if (proxyUrl) {
    options.createConnection = createTelegramProxyConnection(proxyUrl);
  }
  return options;
}
function composeDiscordContent(message, mention) {
  const mentionParsed = parseMentionAllowedMentions(mention);
  const allowed_mentions = {
    parse: [],
    // disable implicit @everyone/@here
    users: mentionParsed.users,
    roles: mentionParsed.roles
  };
  let content;
  if (mention) {
    const prefix = `${mention}
`;
    const maxBody = DISCORD_MAX_CONTENT_LENGTH - prefix.length;
    const body = message.length > maxBody ? message.slice(0, maxBody - 1) + "\u2026" : message;
    content = `${prefix}${body}`;
  } else {
    content = message.length > DISCORD_MAX_CONTENT_LENGTH ? message.slice(0, DISCORD_MAX_CONTENT_LENGTH - 1) + "\u2026" : message;
  }
  return { content, allowed_mentions };
}
function validateDiscordUrl(webhookUrl) {
  try {
    const url = new URL(webhookUrl);
    const allowedHosts = ["discord.com", "discordapp.com"];
    if (!allowedHosts.some(
      (host) => url.hostname === host || url.hostname.endsWith(`.${host}`)
    )) {
      return false;
    }
    return url.protocol === "https:";
  } catch {
    return false;
  }
}
function validateTelegramToken(token) {
  return /^[0-9]+:[A-Za-z0-9_-]+$/.test(token);
}
function validateSlackUrl(webhookUrl) {
  try {
    const url = new URL(webhookUrl);
    return url.protocol === "https:" && (url.hostname === "hooks.slack.com" || url.hostname.endsWith(".hooks.slack.com"));
  } catch {
    return false;
  }
}
function validateWebhookUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:";
  } catch {
    return false;
  }
}
async function sendDiscord(config, payload) {
  if (!config.enabled || !config.webhookUrl) {
    return { platform: "discord", success: false, error: "Not configured" };
  }
  if (!validateDiscordUrl(config.webhookUrl)) {
    return {
      platform: "discord",
      success: false,
      error: "Invalid webhook URL"
    };
  }
  try {
    const { content, allowed_mentions } = composeDiscordContent(
      payload.message,
      config.mention
    );
    const body = { content, allowed_mentions };
    if (config.username) {
      body.username = config.username;
    }
    const response = await fetch(config.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS)
    });
    if (!response.ok) {
      return {
        platform: "discord",
        success: false,
        error: `HTTP ${response.status}`
      };
    }
    return { platform: "discord", success: true };
  } catch (error) {
    return {
      platform: "discord",
      success: false,
      error: error instanceof Error ? error.message : "Unknown error"
    };
  }
}
async function sendDiscordBot(config, payload) {
  if (!config.enabled) {
    return { platform: "discord-bot", success: false, error: "Not enabled" };
  }
  const botToken = config.botToken;
  const channelId = config.channelId;
  if (!botToken || !channelId) {
    return {
      platform: "discord-bot",
      success: false,
      error: "Missing botToken or channelId"
    };
  }
  try {
    const { content, allowed_mentions } = composeDiscordContent(
      payload.message,
      config.mention
    );
    const url = `https://discord.com/api/v10/channels/${channelId}/messages`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bot ${botToken}`
      },
      body: JSON.stringify({ content, allowed_mentions }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS)
    });
    if (!response.ok) {
      return {
        platform: "discord-bot",
        success: false,
        error: `HTTP ${response.status}`
      };
    }
    let messageId;
    try {
      const data = await response.json();
      messageId = data?.id;
    } catch {
    }
    return { platform: "discord-bot", success: true, messageId };
  } catch (error) {
    return {
      platform: "discord-bot",
      success: false,
      error: error instanceof Error ? error.message : "Unknown error"
    };
  }
}
async function sendTelegram(config, payload) {
  if (!config.enabled || !config.botToken || !config.chatId) {
    return { platform: "telegram", success: false, error: "Not configured" };
  }
  if (!validateTelegramToken(config.botToken)) {
    return {
      platform: "telegram",
      success: false,
      error: "Invalid bot token format"
    };
  }
  try {
    const body = JSON.stringify({
      chat_id: config.chatId,
      text: payload.message,
      parse_mode: config.parseMode || "Markdown"
    });
    const result = await new Promise((resolve5) => {
      const req = (0, import_https.request)(
        telegramRequestOptions(Buffer.byteLength(body), config.botToken),
        (res) => {
          const chunks = [];
          res.on("data", (chunk) => chunks.push(chunk));
          res.on("end", () => {
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              let messageId;
              try {
                const body2 = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
                if (body2?.result?.message_id !== void 0) {
                  messageId = String(body2.result.message_id);
                }
              } catch {
              }
              resolve5({ platform: "telegram", success: true, messageId });
            } else {
              resolve5({
                platform: "telegram",
                success: false,
                error: `HTTP ${res.statusCode}`
              });
            }
          });
        }
      );
      req.on("error", (e) => {
        resolve5({ platform: "telegram", success: false, error: e.message });
      });
      req.on("timeout", () => {
        req.destroy();
        resolve5({
          platform: "telegram",
          success: false,
          error: "Request timeout"
        });
      });
      req.write(body);
      req.end();
    });
    return result;
  } catch (error) {
    return {
      platform: "telegram",
      success: false,
      error: error instanceof Error ? error.message : "Unknown error"
    };
  }
}
function composeSlackText(message, mention) {
  const validatedMention = validateSlackMention(mention);
  if (validatedMention) {
    return `${validatedMention}
${message}`;
  }
  return message;
}
async function sendSlack(config, payload) {
  if (!config.enabled || !config.webhookUrl) {
    return { platform: "slack", success: false, error: "Not configured" };
  }
  if (!validateSlackUrl(config.webhookUrl)) {
    return { platform: "slack", success: false, error: "Invalid webhook URL" };
  }
  try {
    const text = composeSlackText(payload.message, config.mention);
    const body = { text };
    const validatedChannel = validateSlackChannel(config.channel);
    if (validatedChannel) {
      body.channel = validatedChannel;
    }
    const validatedUsername = validateSlackUsername(config.username);
    if (validatedUsername) {
      body.username = validatedUsername;
    }
    const response = await fetch(config.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS)
    });
    if (!response.ok) {
      return {
        platform: "slack",
        success: false,
        error: `HTTP ${response.status}`
      };
    }
    return { platform: "slack", success: true };
  } catch (error) {
    return {
      platform: "slack",
      success: false,
      error: error instanceof Error ? error.message : "Unknown error"
    };
  }
}
async function sendSlackBot(config, payload) {
  if (!config.enabled) {
    return { platform: "slack-bot", success: false, error: "Not enabled" };
  }
  const botToken = config.botToken;
  const channelId = config.channelId;
  if (!botToken || !channelId) {
    return {
      platform: "slack-bot",
      success: false,
      error: "Missing botToken or channelId"
    };
  }
  try {
    const text = composeSlackText(payload.message, config.mention);
    const response = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${botToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ channel: channelId, text }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS)
    });
    if (!response.ok) {
      return {
        platform: "slack-bot",
        success: false,
        error: `HTTP ${response.status}`
      };
    }
    const data = await response.json();
    if (!data.ok) {
      return {
        platform: "slack-bot",
        success: false,
        error: data.error || "Slack API error"
      };
    }
    return { platform: "slack-bot", success: true, messageId: data.ts };
  } catch (error) {
    return {
      platform: "slack-bot",
      success: false,
      error: error instanceof Error ? error.message : "Unknown error"
    };
  }
}
async function sendWebhook(config, payload) {
  if (!config.enabled || !config.url) {
    return { platform: "webhook", success: false, error: "Not configured" };
  }
  if (!validateWebhookUrl(config.url)) {
    return {
      platform: "webhook",
      success: false,
      error: "Invalid URL (HTTPS required)"
    };
  }
  try {
    const headers = {
      "Content-Type": "application/json",
      ...config.headers
    };
    const response = await fetch(config.url, {
      method: config.method || "POST",
      headers,
      body: JSON.stringify({
        event: payload.event,
        session_id: payload.sessionId,
        message: payload.message,
        timestamp: payload.timestamp,
        tmux_session: payload.tmuxSession,
        project_name: payload.projectName,
        project_path: payload.projectPath,
        modes_used: payload.modesUsed,
        duration_ms: payload.durationMs,
        reason: payload.reason,
        active_mode: payload.activeMode,
        question: payload.question,
        ask_user_question_prompts: payload.askUserQuestionPrompts,
        ...payload.replyChannel && { channel: payload.replyChannel },
        ...payload.replyTarget && { to: payload.replyTarget },
        ...payload.replyThread && { thread_id: payload.replyThread }
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS)
    });
    if (!response.ok) {
      return {
        platform: "webhook",
        success: false,
        error: `HTTP ${response.status}`
      };
    }
    return { platform: "webhook", success: true };
  } catch (error) {
    return {
      platform: "webhook",
      success: false,
      error: error instanceof Error ? error.message : "Unknown error"
    };
  }
}
function getEffectivePlatformConfig(platform, config, event) {
  const topLevel = config[platform];
  const eventConfig = config.events?.[event];
  const eventPlatform = eventConfig?.[platform];
  if (eventPlatform && typeof eventPlatform === "object" && "enabled" in eventPlatform) {
    if (topLevel && typeof topLevel === "object") {
      return { ...topLevel, ...eventPlatform };
    }
    return eventPlatform;
  }
  return topLevel;
}
async function dispatchNotifications(config, event, payload, platformMessages) {
  const promises = [];
  const payloadFor = (platform) => platformMessages?.has(platform) ? { ...payload, message: platformMessages.get(platform) } : payload;
  const discordConfig = getEffectivePlatformConfig(
    "discord",
    config,
    event
  );
  if (discordConfig?.enabled) {
    promises.push(sendDiscord(discordConfig, payloadFor("discord")));
  }
  const telegramConfig = getEffectivePlatformConfig(
    "telegram",
    config,
    event
  );
  if (telegramConfig?.enabled) {
    promises.push(sendTelegram(telegramConfig, payloadFor("telegram")));
  }
  const slackConfig = getEffectivePlatformConfig(
    "slack",
    config,
    event
  );
  if (slackConfig?.enabled) {
    promises.push(sendSlack(slackConfig, payloadFor("slack")));
  }
  const webhookConfig = getEffectivePlatformConfig(
    "webhook",
    config,
    event
  );
  if (webhookConfig?.enabled) {
    promises.push(sendWebhook(webhookConfig, payloadFor("webhook")));
  }
  const discordBotConfig = getEffectivePlatformConfig(
    "discord-bot",
    config,
    event
  );
  if (discordBotConfig?.enabled) {
    promises.push(sendDiscordBot(discordBotConfig, payloadFor("discord-bot")));
  }
  const slackBotConfig = getEffectivePlatformConfig(
    "slack-bot",
    config,
    event
  );
  if (slackBotConfig?.enabled) {
    promises.push(sendSlackBot(slackBotConfig, payloadFor("slack-bot")));
  }
  if (promises.length === 0) {
    return { event, results: [], anySuccess: false };
  }
  let timer;
  try {
    const results = await Promise.race([
      Promise.allSettled(promises).then(
        (settled) => settled.map(
          (s) => s.status === "fulfilled" ? s.value : {
            platform: "unknown",
            success: false,
            error: String(s.reason)
          }
        )
      ),
      new Promise((resolve5) => {
        timer = setTimeout(
          () => resolve5([
            {
              platform: "unknown",
              success: false,
              error: "Dispatch timeout"
            }
          ]),
          DISPATCH_TIMEOUT_MS
        );
      })
    ]);
    return {
      event,
      results,
      anySuccess: results.some((r) => r.success)
    };
  } catch (error) {
    return {
      event,
      results: [
        {
          platform: "unknown",
          success: false,
          error: String(error)
        }
      ],
      anySuccess: false
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
async function sendCustomWebhook(integration, payload) {
  const config = integration.config;
  try {
    const url = interpolateTemplate(config.url, payload);
    const body = interpolateTemplate(config.bodyTemplate, payload);
    const headers = {};
    for (const [key, value] of Object.entries(config.headers)) {
      headers[key] = interpolateTemplate(value, payload);
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeout);
    try {
      const response = await fetch(url, {
        method: config.method,
        headers,
        body: config.method !== "GET" ? body : void 0,
        signal: controller.signal
      });
      if (!response.ok) {
        return {
          platform: "webhook",
          success: false,
          error: `HTTP ${response.status}: ${response.statusText}`
        };
      }
      return {
        platform: "webhook",
        success: true
      };
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    return {
      platform: "webhook",
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}
async function sendCustomCli(integration, payload) {
  const config = integration.config;
  try {
    const args = config.args.map((arg) => interpolateTemplate(arg, payload));
    await execFileAsync2(config.command, args, {
      timeout: config.timeout,
      killSignal: "SIGTERM"
    });
    return {
      platform: "webhook",
      // Group with webhooks in results
      success: true
    };
  } catch (error) {
    return {
      platform: "webhook",
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}
async function dispatchCustomIntegrations(event, payload) {
  const integrations = getCustomIntegrationsForEvent(event);
  if (integrations.length === 0) return [];
  const results = [];
  for (const integration of integrations) {
    let result;
    if (integration.type === "webhook") {
      result = await sendCustomWebhook(integration, payload);
    } else if (integration.type === "cli") {
      result = await sendCustomCli(integration, payload);
    } else {
      result = {
        platform: "webhook",
        success: false,
        error: `Unknown integration type: ${integration.type}`
      };
    }
    results.push(result);
  }
  return results;
}
var import_https, import_net, import_tls, import_child_process4, import_util5, SEND_TIMEOUT_MS, DISPATCH_TIMEOUT_MS, DISCORD_MAX_CONTENT_LENGTH, TELEGRAM_API_HOST, TELEGRAM_API_PORT, execFileAsync2;
var init_dispatcher = __esm({
  "src/notifications/dispatcher.ts"() {
    "use strict";
    import_https = require("https");
    import_net = require("net");
    import_tls = require("tls");
    init_config();
    import_child_process4 = require("child_process");
    import_util5 = require("util");
    init_template_engine();
    init_config();
    SEND_TIMEOUT_MS = 1e4;
    DISPATCH_TIMEOUT_MS = 15e3;
    DISCORD_MAX_CONTENT_LENGTH = 2e3;
    TELEGRAM_API_HOST = "api.telegram.org";
    TELEGRAM_API_PORT = 443;
    execFileAsync2 = (0, import_util5.promisify)(import_child_process4.execFile);
  }
});

// src/cli/tmux-utils.ts
function tmuxEnv() {
  const { TMUX: _, PSMUX_SESSION: __, ...env } = process.env;
  return env;
}
function resolveEnv(opts) {
  return opts?.stripTmux ? tmuxEnv() : process.env;
}
function quoteForCmd(arg) {
  if (arg.length === 0) return '""';
  if (!/[\s"%^&|<>()]/.test(arg)) return arg;
  return `"${arg.replace(/(["%])/g, "$1$1")}"`;
}
function resolveTmuxInvocation(args) {
  const resolvedBinary = resolveTmuxBinaryPath();
  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(resolvedBinary)) {
    const comspec = process.env.COMSPEC || "cmd.exe";
    const commandLine = [quoteForCmd(resolvedBinary), ...args.map(quoteForCmd)].join(" ");
    return {
      command: comspec,
      args: ["/d", "/s", "/c", commandLine]
    };
  }
  return {
    command: resolvedBinary,
    args
  };
}
function tmuxExec(args, opts) {
  const { stripTmux: _, ...execOpts } = opts ?? {};
  const invocation = resolveTmuxInvocation(args);
  return (0, import_child_process5.execFileSync)(invocation.command, invocation.args, { encoding: "utf-8", ...execOpts, env: resolveEnv(opts) });
}
function tmuxShell(command, opts) {
  const { stripTmux: _, ...execOpts } = opts ?? {};
  return (0, import_child_process5.execSync)(`tmux ${command}`, { encoding: "utf-8", ...execOpts, env: resolveEnv(opts) });
}
function tmuxSpawn(args, opts) {
  const { stripTmux: _, ...spawnOpts } = opts ?? {};
  const invocation = resolveTmuxInvocation(args);
  return (0, import_child_process5.spawnSync)(invocation.command, invocation.args, { encoding: "utf-8", ...spawnOpts, env: resolveEnv(opts) });
}
function resolveTmuxBinaryPath() {
  if (process.platform !== "win32") {
    return "tmux";
  }
  try {
    const result = (0, import_child_process5.spawnSync)("where", ["tmux"], {
      timeout: 5e3,
      encoding: "utf8"
    });
    if (result.status !== 0) return "tmux";
    const candidates = result.stdout?.split(/\r?\n/).map((line) => line.trim()).filter(Boolean) ?? [];
    const first = candidates[0];
    if (first && ((0, import_path8.isAbsolute)(first) || import_path8.win32.isAbsolute(first))) {
      return first;
    }
  } catch {
  }
  return "tmux";
}
var import_child_process5, import_path8;
var init_tmux_utils = __esm({
  "src/cli/tmux-utils.ts"() {
    "use strict";
    import_child_process5 = require("child_process");
    import_path8 = require("path");
  }
});

// src/notifications/tmux.ts
var tmux_exports = {};
__export(tmux_exports, {
  formatTmuxInfo: () => formatTmuxInfo,
  getCurrentTmuxPaneId: () => getCurrentTmuxPaneId,
  getCurrentTmuxSession: () => getCurrentTmuxSession,
  getTeamTmuxSessions: () => getTeamTmuxSessions
});
function getCurrentTmuxSession() {
  if (!process.env.TMUX) {
    return null;
  }
  try {
    const paneId = process.env.TMUX_PANE;
    if (paneId) {
      const lines = tmuxShell("list-panes -a -F '#{pane_id} #{session_name}'", {
        timeout: 3e3,
        stdio: ["pipe", "pipe", "pipe"]
      }).split("\n");
      const match = lines.find((l) => l.startsWith(paneId + " "));
      if (match) return match.split(" ")[1] ?? null;
    }
    const sessionName = tmuxShell("display-message -p '#S'", {
      timeout: 3e3,
      stdio: ["pipe", "pipe", "pipe"]
    }).trim();
    return sessionName || null;
  } catch {
    return null;
  }
}
function getTeamTmuxSessions(teamName) {
  const sanitized = teamName.replace(/[^a-zA-Z0-9-]/g, "");
  if (!sanitized) return [];
  const prefix = `omc-team-${sanitized}-`;
  try {
    const output = tmuxShell("list-sessions -F '#{session_name}'", {
      timeout: 3e3,
      stdio: ["pipe", "pipe", "pipe"]
    });
    return output.trim().split("\n").filter((s) => s.startsWith(prefix)).map((s) => s.slice(prefix.length));
  } catch {
    return [];
  }
}
function formatTmuxInfo() {
  const session = getCurrentTmuxSession();
  if (!session) return null;
  return `tmux: ${session}`;
}
function getCurrentTmuxPaneId() {
  if (!process.env.TMUX) return null;
  const envPane = process.env.TMUX_PANE;
  if (envPane && /^%\d+$/.test(envPane)) return envPane;
  try {
    const paneId = tmuxShell("display-message -p '#{pane_id}'", {
      timeout: 3e3,
      stdio: ["pipe", "pipe", "pipe"]
    }).trim();
    return paneId && /^%\d+$/.test(paneId) ? paneId : null;
  } catch {
    return null;
  }
}
var init_tmux = __esm({
  "src/notifications/tmux.ts"() {
    "use strict";
    init_tmux_utils();
  }
});

// src/notifications/redact.ts
function redactTokens(input) {
  return input.replace(/\b(xox[bpae]-)[A-Za-z0-9-]+/g, "$1****").replace(/\b(xapp-)[A-Za-z0-9-]+/g, "$1****").replace(/\/bot(\d+):[A-Za-z0-9_-]+/g, "/bot$1:****").replace(/\b(\d{8,12}):[A-Za-z0-9_-]{20,}\b/g, "$1:****").replace(/(Bearer\s+)\S+/gi, "$1****").replace(/(Bot\s+)\S+/gi, "$1****").replace(/\b(sk-ant-api)[A-Za-z0-9_-]+/g, "$1****").replace(/\b(ghp_)[A-Za-z0-9]+/g, "$1****").replace(/\b(gho_)[A-Za-z0-9]+/g, "$1****").replace(/\b(ghs_)[A-Za-z0-9]+/g, "$1****").replace(/\b(github_pat_)[A-Za-z0-9_]+/g, "$1****").replace(/\b(AKIA)[A-Z0-9]{16}\b/g, "$1****");
}
var init_redact = __esm({
  "src/notifications/redact.ts"() {
    "use strict";
  }
});

// src/notifications/slack-socket.ts
function verifySlackSignature(signingSecret, signature, timestamp, body) {
  if (!signingSecret || !signature || !timestamp) {
    return false;
  }
  if (!isTimestampValid(timestamp)) {
    return false;
  }
  const sigBasestring = `v0:${timestamp}:${body}`;
  const expectedSignature = "v0=" + (0, import_crypto5.createHmac)("sha256", signingSecret).update(sigBasestring).digest("hex");
  try {
    return (0, import_crypto5.timingSafeEqual)(
      Buffer.from(expectedSignature),
      Buffer.from(signature)
    );
  } catch {
    return false;
  }
}
function isTimestampValid(timestamp, maxAgeSeconds = MAX_TIMESTAMP_AGE_SECONDS) {
  const requestTime = parseInt(timestamp, 10);
  if (isNaN(requestTime)) {
    return false;
  }
  const now = Math.floor(Date.now() / 1e3);
  return Math.abs(now - requestTime) <= maxAgeSeconds;
}
function validateSlackEnvelope(data) {
  if (typeof data !== "object" || data === null) {
    return { valid: false, reason: "Message is not an object" };
  }
  const envelope = data;
  if (typeof envelope.type !== "string" || !envelope.type.trim()) {
    return { valid: false, reason: "Missing or empty message type" };
  }
  if (!VALID_ENVELOPE_TYPES.has(envelope.type)) {
    return {
      valid: false,
      reason: `Unknown envelope type: ${envelope.type}`
    };
  }
  const isControlFrame = envelope.type === "hello" || envelope.type === "disconnect";
  if (!isControlFrame && (typeof envelope.envelope_id !== "string" || !envelope.envelope_id.trim())) {
    return { valid: false, reason: "Missing or empty envelope_id" };
  }
  if (envelope.type === "events_api") {
    if (typeof envelope.payload !== "object" || envelope.payload === null) {
      return {
        valid: false,
        reason: "events_api envelope missing payload"
      };
    }
  }
  return { valid: true };
}
function validateSlackMessage(rawMessage, connectionState, signingSecret, signature, timestamp) {
  if (!connectionState.canProcessMessages()) {
    return {
      valid: false,
      reason: `Connection not authenticated (state: ${connectionState.getState()})`
    };
  }
  let parsed;
  try {
    parsed = JSON.parse(rawMessage);
  } catch {
    return { valid: false, reason: "Invalid JSON message" };
  }
  const envelopeResult = validateSlackEnvelope(parsed);
  if (!envelopeResult.valid) {
    return envelopeResult;
  }
  if (signingSecret && signature && timestamp) {
    if (!verifySlackSignature(signingSecret, signature, timestamp, rawMessage)) {
      return { valid: false, reason: "Signature verification failed" };
    }
  } else if (signingSecret && (!signature || !timestamp)) {
    return {
      valid: false,
      reason: "Signing secret configured but signature/timestamp missing"
    };
  }
  return { valid: true };
}
var import_crypto5, MAX_TIMESTAMP_AGE_SECONDS, VALID_ENVELOPE_TYPES, SlackConnectionStateTracker;
var init_slack_socket = __esm({
  "src/notifications/slack-socket.ts"() {
    "use strict";
    import_crypto5 = require("crypto");
    init_redact();
    MAX_TIMESTAMP_AGE_SECONDS = 300;
    VALID_ENVELOPE_TYPES = /* @__PURE__ */ new Set([
      "events_api",
      "slash_commands",
      "interactive",
      "hello",
      "disconnect"
    ]);
    SlackConnectionStateTracker = class {
      state = "disconnected";
      authenticatedAt = null;
      reconnectCount = 0;
      maxReconnectAttempts;
      messageQueue = [];
      maxQueueSize;
      constructor(options) {
        this.maxReconnectAttempts = options?.maxReconnectAttempts ?? 5;
        this.maxQueueSize = options?.maxQueueSize ?? 100;
      }
      getState() {
        return this.state;
      }
      getReconnectCount() {
        return this.reconnectCount;
      }
      getAuthenticatedAt() {
        return this.authenticatedAt;
      }
      /** Transition to connecting state. */
      onConnecting() {
        this.state = "connecting";
      }
      /**
       * Transition to authenticated state (received 'hello' message).
       * Resets reconnect counter on successful authentication.
       */
      onAuthenticated() {
        this.state = "authenticated";
        this.authenticatedAt = Date.now();
        this.reconnectCount = 0;
      }
      /**
       * Transition to reconnecting state.
       * Increments reconnect counter and clears authentication timestamp.
       */
      onReconnecting() {
        this.state = "reconnecting";
        this.reconnectCount++;
        this.authenticatedAt = null;
      }
      /**
       * Transition to disconnected state.
       * Clears message queue to prevent processing stale messages.
       */
      onDisconnected() {
        this.state = "disconnected";
        this.authenticatedAt = null;
        this.messageQueue = [];
      }
      /** Check if maximum reconnection attempts have been exceeded. */
      hasExceededMaxReconnects() {
        return this.reconnectCount >= this.maxReconnectAttempts;
      }
      /**
       * Check if messages can be safely processed in the current state.
       * Only allows processing when the connection is authenticated.
       */
      canProcessMessages() {
        return this.state === "authenticated";
      }
      /**
       * Queue a message for processing after reconnection.
       * Drops oldest messages when queue exceeds maxQueueSize to
       * prevent unbounded memory growth.
       *
       * Returns true if queued, false if queue is at capacity (oldest was dropped).
       */
      queueMessage(envelope) {
        const wasFull = this.messageQueue.length >= this.maxQueueSize;
        if (wasFull) {
          this.messageQueue.shift();
        }
        this.messageQueue.push(envelope);
        return !wasFull;
      }
      /**
       * Drain the message queue (called after re-authentication).
       * Returns queued messages and clears the queue.
       */
      drainQueue() {
        const messages = [...this.messageQueue];
        this.messageQueue = [];
        return messages;
      }
      /** Get current queue size. */
      getQueueSize() {
        return this.messageQueue.length;
      }
    };
  }
});

// src/notifications/presets.ts
function getPresetList() {
  return Object.entries(CUSTOM_INTEGRATION_PRESETS).map(([id, preset]) => ({
    id,
    name: preset.name,
    description: preset.description,
    type: preset.type
  }));
}
function getPreset(id) {
  return CUSTOM_INTEGRATION_PRESETS[id];
}
function isValidPreset(id) {
  return id in CUSTOM_INTEGRATION_PRESETS;
}
var CUSTOM_INTEGRATION_PRESETS;
var init_presets = __esm({
  "src/notifications/presets.ts"() {
    "use strict";
    CUSTOM_INTEGRATION_PRESETS = {
      openclaw: {
        name: "OpenClaw Gateway",
        description: "Wake external automations and AI agents on hook events",
        type: "webhook",
        defaultConfig: {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          bodyTemplate: JSON.stringify({
            event: "{{event}}",
            instruction: "Session {{sessionId}} {{event}} for project {{projectName}}",
            timestamp: "{{timestamp}}",
            context: {
              projectPath: "{{projectPath}}",
              projectName: "{{projectName}}",
              sessionId: "{{sessionId}}"
            }
          }, null, 2),
          timeout: 1e4
        },
        suggestedEvents: ["session-start", "session-end", "stop"],
        documentationUrl: "https://github.com/your-org/openclaw"
      },
      n8n: {
        name: "n8n Webhook",
        description: "Trigger n8n workflows on OMC events",
        type: "webhook",
        defaultConfig: {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          bodyTemplate: JSON.stringify({
            event: "{{event}}",
            sessionId: "{{sessionId}}",
            projectName: "{{projectName}}",
            projectPath: "{{projectPath}}",
            timestamp: "{{timestamp}}",
            tmuxSession: "{{tmuxSession}}"
          }, null, 2),
          timeout: 1e4
        },
        suggestedEvents: ["session-end", "ask-user-question"],
        documentationUrl: "https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/"
      },
      customAgentGateway: {
        name: "Custom Agent Gateway",
        description: "Send notifications to a custom agent webhook",
        type: "webhook",
        defaultConfig: {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          bodyTemplate: JSON.stringify({
            type: "{{event}}",
            session: "{{sessionId}}",
            project: "{{projectName}}",
            timestamp: "{{timestamp}}"
          }, null, 2),
          timeout: 5e3
        },
        suggestedEvents: ["session-end", "session-start"],
        documentationUrl: "https://code.claude.com/docs/en/hooks"
      },
      "generic-webhook": {
        name: "Generic Webhook",
        description: "Custom webhook integration",
        type: "webhook",
        defaultConfig: {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          bodyTemplate: JSON.stringify({
            event: "{{event}}",
            sessionId: "{{sessionId}}",
            projectName: "{{projectName}}",
            timestamp: "{{timestamp}}"
          }, null, 2),
          timeout: 1e4
        },
        suggestedEvents: ["session-end"]
      },
      "generic-cli": {
        name: "Generic CLI Command",
        description: "Execute custom command on events",
        type: "cli",
        defaultConfig: {
          command: "curl",
          args: ["-X", "POST", "-d", "event={{event}}&session={{sessionId}}", "https://example.com/webhook"],
          timeout: 5e3
        },
        suggestedEvents: ["session-end"]
      }
    };
  }
});

// src/notifications/template-variables.ts
function getVariablesForEvent(event) {
  return Object.entries(TEMPLATE_VARIABLES).filter(
    ([_, variable]) => variable.availableIn.includes("*") || variable.availableIn.includes(event)
  ).map(([name, _]) => name);
}
function getVariableDocumentation() {
  const lines = ["Available Template Variables:", ""];
  for (const [name, variable] of Object.entries(TEMPLATE_VARIABLES)) {
    const events = variable.availableIn.includes("*") ? "all events" : variable.availableIn.join(", ");
    lines.push(`  {{${name}}}`);
    lines.push(`    ${variable.description}`);
    lines.push(`    Example: ${variable.example}`);
    lines.push(`    Available in: ${events}`);
    lines.push("");
  }
  return lines.join("\n");
}
var TEMPLATE_VARIABLES;
var init_template_variables = __esm({
  "src/notifications/template-variables.ts"() {
    "use strict";
    TEMPLATE_VARIABLES = {
      // Core session info
      sessionId: {
        description: "Unique session identifier",
        example: "sess_abc123def456",
        availableIn: ["session-start", "session-end", "session-stop", "session-idle", "ask-user-question"]
      },
      projectPath: {
        description: "Full path to project directory",
        example: "/home/user/projects/my-app",
        availableIn: ["*"]
      },
      projectName: {
        description: "Project directory name (basename)",
        example: "my-app",
        availableIn: ["*"]
      },
      timestamp: {
        description: "ISO 8601 timestamp",
        example: "2026-03-05T14:30:00Z",
        availableIn: ["*"]
      },
      event: {
        description: "Hook event name",
        example: "session-end",
        availableIn: ["*"]
      },
      // Session metrics (session-end only)
      durationMs: {
        description: "Session duration in milliseconds",
        example: "45000",
        availableIn: ["session-end"]
      },
      duration: {
        description: "Human-readable duration",
        example: "45s",
        availableIn: ["session-end"]
      },
      agentsSpawned: {
        description: "Number of agents spawned",
        example: "5",
        availableIn: ["session-end"]
      },
      agentsCompleted: {
        description: "Number of agents completed",
        example: "4",
        availableIn: ["session-end"]
      },
      reason: {
        description: "Session end reason",
        example: "completed",
        availableIn: ["session-end", "session-stop"]
      },
      // Context info
      contextSummary: {
        description: "Summary of session context",
        example: "Task completed successfully",
        availableIn: ["session-end"]
      },
      tmuxSession: {
        description: "tmux session name",
        example: "claude:my-project",
        availableIn: ["*"]
      },
      tmuxPaneId: {
        description: "tmux pane identifier",
        example: "%42",
        availableIn: ["*"]
      },
      // Ask user question
      question: {
        description: "Question text when input is needed",
        example: "Which file should I edit?",
        availableIn: ["ask-user-question"]
      },
      questionOptions: {
        description: "Formatted AskUserQuestion options, including the Other/free-text choice when available",
        example: "1. PostgreSQL \u2014 relational DB\n2. Other \u2014 reply with free text",
        availableIn: ["ask-user-question"]
      },
      // Mode info
      activeMode: {
        description: "Currently active OMC mode",
        example: "ralph",
        availableIn: ["*"]
      },
      modesUsed: {
        description: "Comma-separated list of modes used",
        example: "autopilot,ultrawork",
        availableIn: ["session-end"]
      },
      // Computed/display helpers
      time: {
        description: "Locale time string",
        example: "2:30 PM",
        availableIn: ["*"]
      },
      footer: {
        description: "tmux + project info line",
        example: "tmux:my-session | project:my-app",
        availableIn: ["*"]
      },
      projectDisplay: {
        description: "Project name with fallbacks",
        example: "my-app (~/projects)",
        availableIn: ["*"]
      }
    };
  }
});

// src/features/rate-limit-wait/pane-fresh-capture.ts
var pane_fresh_capture_exports = {};
__export(pane_fresh_capture_exports, {
  getNewPaneTail: () => getNewPaneTail,
  getPaneHistorySize: () => getPaneHistorySize
});
function isValidPaneId(paneId) {
  return /^%\d+$/.test(paneId);
}
function readPaneTailState(stateDir) {
  const path3 = (0, import_path9.join)(stateDir, STATE_FILE);
  try {
    if ((0, import_fs7.existsSync)(path3)) {
      const parsed = JSON.parse((0, import_fs7.readFileSync)(path3, "utf-8"));
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        return parsed;
      }
    }
  } catch {
  }
  return {};
}
function writePaneTailState(stateDir, state) {
  try {
    (0, import_fs7.mkdirSync)(stateDir, { recursive: true });
    (0, import_fs7.writeFileSync)((0, import_path9.join)(stateDir, STATE_FILE), JSON.stringify(state), { mode: 384 });
  } catch {
  }
}
function getPaneHistorySize(paneId) {
  try {
    const raw = tmuxExec(
      ["display-message", "-t", paneId, "-p", "#{pane_dead} #{history_size}"],
      { stripTmux: true, timeout: 3e3 }
    ).trim();
    const parts = raw.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      const [paneDeadRaw, historySizeRaw] = parts;
      if (paneDeadRaw === "1") {
        return null;
      }
      const n2 = parseInt(historySizeRaw ?? "", 10);
      return Number.isFinite(n2) && n2 >= 0 ? n2 : null;
    }
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : null;
  } catch {
    return null;
  }
}
function capturePaneLines(paneId, lines) {
  try {
    const safeLines = Math.max(1, Math.min(500, Math.floor(lines)));
    return tmuxExec(
      ["capture-pane", "-t", paneId, "-p", "-S", `-${safeLines}`],
      { stripTmux: true, timeout: 5e3 }
    );
  } catch {
    return "";
  }
}
function getNewPaneTail(paneId, stateDir, maxLines = DEFAULT_MAX_LINES) {
  if (!isValidPaneId(paneId)) {
    return "";
  }
  const currentSize = getPaneHistorySize(paneId);
  if (currentSize === null) {
    return "";
  }
  const state = readPaneTailState(stateDir);
  const lastSize = state[paneId] ?? -1;
  state[paneId] = currentSize;
  writePaneTailState(stateDir, state);
  if (lastSize < 0) {
    return capturePaneLines(paneId, maxLines);
  }
  const newLines = currentSize - lastSize;
  if (newLines <= 0) {
    return "";
  }
  return capturePaneLines(paneId, Math.min(newLines, maxLines));
}
var import_fs7, import_path9, STATE_FILE, DEFAULT_MAX_LINES;
var init_pane_fresh_capture = __esm({
  "src/features/rate-limit-wait/pane-fresh-capture.ts"() {
    "use strict";
    import_fs7 = require("fs");
    import_path9 = require("path");
    init_tmux_utils();
    STATE_FILE = "pane-tail-positions.json";
    DEFAULT_MAX_LINES = 15;
  }
});

// src/features/rate-limit-wait/tmux-detector.ts
var tmux_detector_exports = {};
__export(tmux_detector_exports, {
  analyzePaneContent: () => analyzePaneContent,
  capturePaneContent: () => capturePaneContent,
  formatBlockedPanesSummary: () => formatBlockedPanesSummary,
  isInsideTmux: () => isInsideTmux,
  isPaneAlive: () => isPaneAlive,
  isTmuxAvailable: () => isTmuxAvailable,
  listTmuxPanes: () => listTmuxPanes,
  scanForBlockedPanes: () => scanForBlockedPanes,
  sendResumeSequence: () => sendResumeSequence,
  sendToPane: () => sendToPane
});
function isValidPaneId2(paneId) {
  return /^%\d+$/.test(paneId);
}
function sanitizeForTmux(text) {
  return text.replace(/'/g, "'\\''");
}
function hasOmcRateLimitScreenText(content) {
  return OMC_HUD_RATE_LIMIT_SCREEN_PATTERNS.some((pattern) => pattern.test(content));
}
function hasSavedTranscriptContext(content) {
  return content.split("\n").some(
    (line) => SAVED_TRANSCRIPT_COMMAND_PATTERN.test(line) || SAVED_TRANSCRIPT_LABEL_PATTERN.test(line)
  );
}
function hasLiveOmcHudEvidence(content) {
  if (hasSavedTranscriptContext(content)) {
    return false;
  }
  const nonEmptyLines = content.split("\n").map((line) => line.trimEnd()).filter((line) => line.trim().length > 0);
  const hudStatusIndex = nonEmptyLines.findIndex((line) => OMC_HUD_STATUS_LINE_PATTERN.test(line));
  if (hudStatusIndex === -1) {
    return false;
  }
  const modeLineIndex = nonEmptyLines.findIndex(
    (line, index) => index > hudStatusIndex && OMC_HUD_MODE_LINE_PATTERN.test(line)
  );
  if (modeLineIndex === -1) {
    return false;
  }
  const isFooterBlock = hudStatusIndex >= nonEmptyLines.length - 4 && modeLineIndex === nonEmptyLines.length - 1 && modeLineIndex - hudStatusIndex <= 2;
  return isFooterBlock;
}
function stripGitOutputLines(content) {
  return content.split("\n").filter((line) => !GIT_OUTPUT_LINE_PATTERNS.some((p) => p.test(line.trimStart()))).join("\n");
}
function isTmuxAvailable() {
  try {
    const result = tmuxSpawn(["-V"], { stripTmux: true, stdio: "pipe", timeout: 3e3 });
    return result.status === 0;
  } catch {
    return false;
  }
}
function isInsideTmux() {
  return !!process.env.TMUX;
}
function listTmuxPanes() {
  if (!isTmuxAvailable()) {
    return [];
  }
  try {
    const format = "#{session_name}:#{window_index}.#{pane_index} #{pane_id} #{pane_active} #{window_name} #{pane_title}";
    const result = tmuxExec(["list-panes", "-a", "-F", format], {
      stripTmux: true,
      timeout: 5e3
    });
    const panes = [];
    for (const line of result.trim().split("\n")) {
      if (!line.trim()) continue;
      const parts = line.split(" ");
      if (parts.length < 4) continue;
      const [location, paneId, activeStr, windowName, ...titleParts] = parts;
      const [sessionWindow, paneIndexStr] = location.split(".");
      const [session, windowIndexStr] = sessionWindow.split(":");
      panes.push({
        id: paneId,
        session,
        windowIndex: parseInt(windowIndexStr, 10),
        windowName,
        paneIndex: parseInt(paneIndexStr, 10),
        title: titleParts.join(" ") || void 0,
        isActive: activeStr === "1"
      });
    }
    return panes;
  } catch (error) {
    console.error("[TmuxDetector] Error listing panes:", error);
    return [];
  }
}
function isPaneAlive(paneId) {
  if (!isTmuxAvailable()) {
    return false;
  }
  if (!isValidPaneId2(paneId)) {
    return false;
  }
  try {
    const result = tmuxExec(
      ["display-message", "-t", paneId, "-p", "#{pane_dead}"],
      { stripTmux: true, stdio: "pipe", timeout: 3e3 }
    );
    return result.trim() === "0";
  } catch {
    return false;
  }
}
function capturePaneContent(paneId, lines = 15) {
  if (!isTmuxAvailable()) {
    return "";
  }
  if (!isValidPaneId2(paneId)) {
    console.error(`[TmuxDetector] Invalid pane ID format: ${paneId}`);
    return "";
  }
  const safeLines = Math.max(1, Math.min(100, Math.floor(lines)));
  try {
    const result = tmuxExec(["capture-pane", "-t", paneId, "-p", "-S", `-${safeLines}`], {
      stripTmux: true,
      timeout: 5e3
    });
    return result;
  } catch (error) {
    console.error(`[TmuxDetector] Error capturing pane ${paneId}:`, error);
    return "";
  }
}
function analyzePaneContent(content) {
  if (!content.trim()) {
    return {
      hasClaudeCode: false,
      hasRateLimitMessage: false,
      isBlocked: false,
      confidence: 0
    };
  }
  const cleanedContent = stripGitOutputLines(content);
  const hasClaudeText = CLAUDE_CODE_PATTERNS.some((pattern) => pattern.test(cleanedContent));
  const hasLiveOmcHud = hasLiveOmcHudEvidence(cleanedContent);
  const hasClaudeCode = hasClaudeText || hasLiveOmcHud && hasOmcRateLimitScreenText(cleanedContent);
  const rateLimitMatches = RATE_LIMIT_PATTERNS.filter(
    (pattern) => pattern.test(cleanedContent)
  );
  const hasRateLimitMessage = rateLimitMatches.length > 0;
  const isWaiting = WAITING_PATTERNS.some((pattern) => pattern.test(cleanedContent));
  let rateLimitType;
  if (hasRateLimitMessage) {
    if (/5[- ]?hour/i.test(cleanedContent)) {
      rateLimitType = "five_hour";
    } else if (WEEKLY_RATE_LIMIT_PATTERN.test(cleanedContent)) {
      rateLimitType = "weekly";
    } else {
      rateLimitType = "unknown";
    }
  }
  let confidence = 0;
  if (hasClaudeCode) confidence += 0.4;
  if (hasRateLimitMessage) confidence += 0.4;
  if (isWaiting) confidence += 0.2;
  if (rateLimitMatches.length > 1) confidence += 0.1;
  const isBlocked = hasClaudeCode && hasRateLimitMessage && confidence >= 0.6;
  return {
    hasClaudeCode,
    hasRateLimitMessage,
    isBlocked,
    rateLimitType,
    confidence: Math.min(1, confidence)
  };
}
function scanForBlockedPanes(lines = 15, stateDir) {
  const panes = listTmuxPanes();
  const blocked = [];
  for (const pane of panes) {
    let content;
    if (stateDir) {
      content = getNewPaneTail(pane.id, stateDir, lines);
      if (!content) continue;
    } else {
      content = capturePaneContent(pane.id, lines);
    }
    const analysis = analyzePaneContent(content);
    if (analysis.isBlocked) {
      blocked.push({
        ...pane,
        analysis,
        firstDetectedAt: /* @__PURE__ */ new Date(),
        resumeAttempted: false
      });
    }
  }
  return blocked;
}
function sendResumeSequence(paneId) {
  if (!isTmuxAvailable()) {
    return false;
  }
  if (!isValidPaneId2(paneId)) {
    console.error(`[TmuxDetector] Invalid pane ID format: ${paneId}`);
    return false;
  }
  try {
    tmuxExec(["send-keys", "-t", paneId, "1", "Enter"], {
      stripTmux: true,
      timeout: 2e3
    });
    return true;
  } catch (error) {
    console.error(`[TmuxDetector] Error sending resume to pane ${paneId}:`, error);
    return false;
  }
}
function sendToPane(paneId, text, pressEnter = true) {
  if (!isTmuxAvailable()) {
    return false;
  }
  if (!isValidPaneId2(paneId)) {
    console.error(`[TmuxDetector] Invalid pane ID format: ${paneId}`);
    return false;
  }
  try {
    const sanitizedText = sanitizeForTmux(text);
    tmuxExec(["send-keys", "-t", paneId, "-l", sanitizedText], {
      stripTmux: true,
      timeout: 2e3
    });
    if (pressEnter) {
      tmuxExec(["send-keys", "-t", paneId, "Enter"], {
        stripTmux: true,
        timeout: 2e3
      });
    }
    return true;
  } catch (error) {
    console.error(`[TmuxDetector] Error sending to pane ${paneId}:`, error);
    return false;
  }
}
function formatBlockedPanesSummary(blockedPanes) {
  if (blockedPanes.length === 0) {
    return "No blocked Claude Code sessions detected.";
  }
  const lines = [
    `Found ${blockedPanes.length} blocked Claude Code session(s):`,
    ""
  ];
  for (const pane of blockedPanes) {
    const location = `${pane.session}:${pane.windowIndex}.${pane.paneIndex}`;
    const confidence = Math.round(pane.analysis.confidence * 100);
    const limitType = pane.analysis.rateLimitType || "unknown";
    const status = pane.resumeAttempted ? pane.resumeSuccessful ? " [RESUMED]" : " [RESUME FAILED]" : "";
    lines.push(`  \u2022 ${location} (${pane.id}) - ${limitType} limit, ${confidence}% confidence${status}`);
  }
  return lines.join("\n");
}
var RATE_LIMIT_PATTERNS, CLAUDE_CODE_PATTERNS, OMC_HUD_STATUS_LINE_PATTERN, OMC_HUD_MODE_LINE_PATTERN, SAVED_TRANSCRIPT_COMMAND_PATTERN, SAVED_TRANSCRIPT_LABEL_PATTERN, OMC_HUD_RATE_LIMIT_SCREEN_PATTERNS, WEEKLY_RATE_LIMIT_PATTERN, GIT_OUTPUT_LINE_PATTERNS, WAITING_PATTERNS;
var init_tmux_detector = __esm({
  "src/features/rate-limit-wait/tmux-detector.ts"() {
    "use strict";
    init_tmux_utils();
    init_pane_fresh_capture();
    RATE_LIMIT_PATTERNS = [
      /rate limit/i,
      /usage limit/i,
      /quota exceeded/i,
      /too many requests/i,
      /please wait/i,
      /try again later/i,
      /limit reached/i,
      /hit your limit/i,
      /hit .+ limit/i,
      /resets? .+ at/i,
      /5[- ]?hour/i,
      // Require adjacent rate-limit vocabulary to avoid false-positives from git commit
      // messages or documentation that contain the bare word "weekly" (e.g. "fix weekly
      // report generation", "update weekly standup notes").
      /\bweekly\s+(?:usage\s+)?(?:limit|quota|cap|allowance|allocation)\b/i
    ];
    CLAUDE_CODE_PATTERNS = [
      /claude/i,
      /anthropic/i,
      /\$ claude/,
      /claude code/i,
      /conversation/i,
      /assistant/i
    ];
    OMC_HUD_STATUS_LINE_PATTERN = /^\s*\[OMC#[^\]\s]*\]\s*\|.*\b(?:Model:|ctx:|session:|5h:|wk:|thinking)\b/i;
    OMC_HUD_MODE_LINE_PATTERN = /^\s*⏵⏵\s+.*\(shift\+tab to cycle\)/i;
    SAVED_TRANSCRIPT_COMMAND_PATTERN = /^\s*(?:[$#%]|❯)\s*(?:cat|bat|less|more|tail|head|sed|awk)\b.*(?:hud|transcript|terminal|output|copied|\.txt)\b/i;
    SAVED_TRANSCRIPT_LABEL_PATTERN = /\b(?:copied\s+from|saved\s+terminal\s+output|terminal\s+transcript|copied\s+hud)\b/i;
    OMC_HUD_RATE_LIMIT_SCREEN_PATTERNS = [
      /you(?:'|’)ve\s+(?:hit|reached)\s+(?:your\s+)?(?:session\s+|usage\s+)?limit/i,
      /\b(?:session|usage|weekly|5[- ]?hour)\s+(?:usage\s+)?(?:limit|quota|cap|allowance|allocation)\b/i,
      /\blimit\s+resets?\b/i,
      /stop\s+and\s+wait\s+for\s+limit\s+to\s+reset/i
    ];
    WEEKLY_RATE_LIMIT_PATTERN = /\bweekly\s+(?:usage\s+)?(?:limit|quota|cap|allowance|allocation)\b/i;
    GIT_OUTPUT_LINE_PATTERNS = [
      /^commit\s+[0-9a-f]{6,40}\b/,
      // git log commit hash
      /^Author:\s+\S/,
      // git log author
      /^Date:\s+\S/,
      // git log date
      /^Merge:\s+[0-9a-f]{6,}/,
      // git log merge line
      /^diff\s+--git\s+a\//,
      // git diff header
      /^(?:---|\+\+\+)\s+[ab]\//,
      // git diff file paths
      /^@@\s+-\d+/
      // git diff hunk header
    ];
    WAITING_PATTERNS = [
      /\[\d+\]/,
      // Menu selection prompt like [1], [2], [3]
      /^\s*❯?\s*\d+\.\s/m,
      // Menu selection prompt like "❯ 1. ..." or "  2. ..."
      /continue\?/i,
      // Continue prompt
      /press enter/i,
      /waiting for/i,
      /select an option/i,
      /choice:/i,
      /enter to confirm/i
    ];
  }
});

// src/utils/paths.ts
function getStateDir() {
  if (process.platform === "win32") {
    return process.env.LOCALAPPDATA || (0, import_path10.join)((0, import_os3.homedir)(), "AppData", "Local");
  }
  return process.env.XDG_STATE_HOME || (0, import_path10.join)((0, import_os3.homedir)(), ".local", "state");
}
function prefersXdgOmcDirs() {
  return process.platform !== "win32" && process.platform !== "darwin";
}
function getUserHomeDir() {
  if (process.platform === "win32") {
    return process.env.USERPROFILE || process.env.HOME || (0, import_os3.homedir)();
  }
  return process.env.HOME || (0, import_os3.homedir)();
}
function getLegacyOmcDir() {
  return (0, import_path10.join)(getUserHomeDir(), ".omc");
}
function getGlobalOmcStateRoot() {
  const explicitRoot = process.env.OMC_HOME?.trim();
  if (explicitRoot) {
    return (0, import_path10.join)(explicitRoot, "state");
  }
  if (prefersXdgOmcDirs()) {
    return (0, import_path10.join)(getStateDir(), "omc");
  }
  return (0, import_path10.join)(getLegacyOmcDir(), "state");
}
function getGlobalOmcStatePath(...segments) {
  return (0, import_path10.join)(getGlobalOmcStateRoot(), ...segments);
}
function getLegacyOmcPath(...segments) {
  return (0, import_path10.join)(getLegacyOmcDir(), ...segments);
}
function dedupePaths(paths) {
  return [...new Set(paths)];
}
function getGlobalOmcStateCandidates(...segments) {
  const explicitRoot = process.env.OMC_HOME?.trim();
  if (explicitRoot) {
    return dedupePaths([
      getGlobalOmcStatePath(...segments),
      (0, import_path10.join)(explicitRoot, ...segments)
    ]);
  }
  return dedupePaths([
    getGlobalOmcStatePath(...segments),
    getLegacyOmcPath("state", ...segments)
  ]);
}
var import_path10, import_os3, STALE_THRESHOLD_MS;
var init_paths = __esm({
  "src/utils/paths.ts"() {
    "use strict";
    import_path10 = require("path");
    import_os3 = require("os");
    init_config_dir();
    STALE_THRESHOLD_MS = 24 * 60 * 60 * 1e3;
  }
});

// src/notifications/session-registry.ts
var session_registry_exports = {};
__export(session_registry_exports, {
  loadAllMappings: () => loadAllMappings,
  lockRegistryIfEmpty: () => lockRegistryIfEmpty,
  lookupByMessageId: () => lookupByMessageId,
  pruneStale: () => pruneStale,
  registerMessage: () => registerMessage,
  removeMessagesByPane: () => removeMessagesByPane,
  removeSession: () => removeSession
});
function getRegistryStateDir() {
  return process.env["OMC_TEST_REGISTRY_DIR"] ?? getGlobalOmcStateRoot();
}
function getRegistryPath() {
  return (0, import_path11.join)(getRegistryStateDir(), "reply-session-registry.jsonl");
}
function getRegistryReadPaths() {
  if (process.env["OMC_TEST_REGISTRY_DIR"]) {
    return [getRegistryPath()];
  }
  return getGlobalOmcStateCandidates("reply-session-registry.jsonl");
}
function getLockPath() {
  return (0, import_path11.join)(getRegistryStateDir(), "reply-session-registry.lock");
}
function ensureRegistryDir() {
  const registryDir = (0, import_path11.dirname)(getRegistryPath());
  if (!(0, import_fs8.existsSync)(registryDir)) {
    (0, import_fs8.mkdirSync)(registryDir, { recursive: true, mode: 448 });
  }
}
function sleepMs(ms) {
  try {
    Atomics.wait(SLEEP_ARRAY, 0, 0, ms);
  } catch {
    const waitUntil = Date.now() + ms;
    while (Date.now() < waitUntil) {
    }
  }
}
function readLockSnapshot() {
  try {
    const raw = (0, import_fs8.readFileSync)(getLockPath(), "utf-8");
    const trimmed = raw.trim();
    if (!trimmed) {
      return { raw, pid: null, token: null };
    }
    try {
      const parsed = JSON.parse(trimmed);
      const pid = typeof parsed.pid === "number" && Number.isFinite(parsed.pid) ? parsed.pid : null;
      const token = typeof parsed.token === "string" && parsed.token.length > 0 ? parsed.token : null;
      return { raw, pid, token };
    } catch {
      const [pidStr] = trimmed.split(":");
      const parsedPid = Number.parseInt(pidStr ?? "", 10);
      return {
        raw,
        pid: Number.isFinite(parsedPid) && parsedPid > 0 ? parsedPid : null,
        token: null
      };
    }
  } catch {
    return null;
  }
}
function removeLockIfUnchanged(snapshot) {
  try {
    const currentRaw = (0, import_fs8.readFileSync)(getLockPath(), "utf-8");
    if (currentRaw !== snapshot.raw) {
      return false;
    }
  } catch {
    return false;
  }
  try {
    (0, import_fs8.unlinkSync)(getLockPath());
    return true;
  } catch {
    return false;
  }
}
function acquireRegistryLock() {
  ensureRegistryDir();
  const started = Date.now();
  while (Date.now() - started < LOCK_TIMEOUT_MS) {
    try {
      const token = (0, import_crypto6.randomUUID)();
      const fd = (0, import_fs8.openSync)(
        getLockPath(),
        import_fs8.constants.O_CREAT | import_fs8.constants.O_EXCL | import_fs8.constants.O_WRONLY,
        SECURE_FILE_MODE
      );
      const lockPayload = JSON.stringify({
        pid: process.pid,
        acquiredAt: Date.now(),
        token
      });
      (0, import_fs8.writeSync)(fd, lockPayload, null, "utf-8");
      return { fd, token };
    } catch (error) {
      const err = error;
      if (err.code !== "EEXIST") {
        throw error;
      }
      try {
        const lockAgeMs = Date.now() - (0, import_fs8.statSync)(getLockPath()).mtimeMs;
        if (lockAgeMs > LOCK_STALE_MS) {
          const snapshot = readLockSnapshot();
          if (!snapshot) {
            sleepMs(LOCK_RETRY_MS);
            continue;
          }
          if (snapshot.pid !== null && isProcessAlive(snapshot.pid)) {
            sleepMs(LOCK_RETRY_MS);
            continue;
          }
          if (removeLockIfUnchanged(snapshot)) {
            continue;
          }
        }
      } catch {
      }
      sleepMs(LOCK_RETRY_MS);
    }
  }
  return null;
}
function acquireRegistryLockOrWait(maxWaitMs = LOCK_MAX_WAIT_MS) {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const lock = acquireRegistryLock();
    if (lock !== null) {
      return lock;
    }
    sleepMs(LOCK_RETRY_MS);
  }
  return null;
}
function releaseRegistryLock(lock) {
  try {
    (0, import_fs8.closeSync)(lock.fd);
  } catch {
  }
  const snapshot = readLockSnapshot();
  if (!snapshot || snapshot.token !== lock.token) {
    return;
  }
  removeLockIfUnchanged(snapshot);
}
function withRegistryLock(onLocked) {
  const lock = acquireRegistryLockOrWait();
  if (lock === null) return null;
  try {
    return onLocked();
  } finally {
    releaseRegistryLock(lock);
  }
}
function lockRegistryIfEmpty() {
  const lock = acquireRegistryLock();
  if (lock === null) return null;
  if (readAllMappingsUnsafe().length > 0) {
    releaseRegistryLock(lock);
    return "active";
  }
  let released = false;
  return () => {
    if (!released) {
      released = true;
      releaseRegistryLock(lock);
    }
  };
}
function registerMessage(mapping) {
  return withRegistryLock(() => {
    ensureRegistryDir();
    const existing = readAllMappingsUnsafe().find(
      (candidate) => candidate.platform === mapping.platform && candidate.messageId === mapping.messageId && candidate.sessionId === mapping.sessionId && candidate.tmuxPaneId === mapping.tmuxPaneId
    );
    if (existing) return true;
    const line = JSON.stringify(mapping) + "\n";
    const fd = (0, import_fs8.openSync)(
      getRegistryPath(),
      import_fs8.constants.O_WRONLY | import_fs8.constants.O_APPEND | import_fs8.constants.O_CREAT,
      SECURE_FILE_MODE
    );
    try {
      (0, import_fs8.writeSync)(fd, Buffer.from(line, "utf-8"));
      return true;
    } finally {
      (0, import_fs8.closeSync)(fd);
    }
  }) ?? false;
}
function loadAllMappings() {
  return withRegistryLock(() => readAllMappingsUnsafe()) ?? readAllMappingsUnsafe();
}
function readAllMappingsUnsafe() {
  for (const registryPath of getRegistryReadPaths()) {
    if (!(0, import_fs8.existsSync)(registryPath)) {
      continue;
    }
    try {
      const content = (0, import_fs8.readFileSync)(registryPath, "utf-8");
      return content.split("\n").filter((line) => line.trim()).map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      }).filter((m) => m !== null);
    } catch {
      continue;
    }
  }
  return [];
}
function lookupByMessageId(platform, messageId) {
  const mappings = loadAllMappings();
  return mappings.findLast((m) => m.platform === platform && m.messageId === messageId) ?? null;
}
function removeSession(sessionId) {
  return withRegistryLock(() => {
    const mappings = readAllMappingsUnsafe();
    const filtered = mappings.filter((m) => m.sessionId !== sessionId);
    if (filtered.length !== mappings.length) rewriteRegistryUnsafe(filtered);
    return true;
  }) ?? false;
}
function removeMessagesByPane(paneId) {
  return withRegistryLock(() => {
    const mappings = readAllMappingsUnsafe();
    const filtered = mappings.filter((m) => m.tmuxPaneId !== paneId);
    if (filtered.length !== mappings.length) rewriteRegistryUnsafe(filtered);
    return true;
  }) ?? false;
}
function pruneStale() {
  return withRegistryLock(() => {
    const now = Date.now();
    const mappings = readAllMappingsUnsafe();
    const filtered = mappings.filter((m) => {
      try {
        return now - new Date(m.createdAt).getTime() < MAX_AGE_MS;
      } catch {
        return false;
      }
    });
    if (filtered.length !== mappings.length) rewriteRegistryUnsafe(filtered);
    return true;
  }) ?? false;
}
function rewriteRegistryUnsafe(mappings) {
  ensureRegistryDir();
  if (mappings.length === 0) {
    (0, import_fs8.writeFileSync)(getRegistryPath(), "", { mode: SECURE_FILE_MODE });
    return;
  }
  const content = mappings.map((m) => JSON.stringify(m)).join("\n") + "\n";
  (0, import_fs8.writeFileSync)(getRegistryPath(), content, { mode: SECURE_FILE_MODE });
}
var import_fs8, import_path11, import_crypto6, SECURE_FILE_MODE, MAX_AGE_MS, LOCK_TIMEOUT_MS, LOCK_RETRY_MS, LOCK_STALE_MS, LOCK_MAX_WAIT_MS, SLEEP_ARRAY;
var init_session_registry = __esm({
  "src/notifications/session-registry.ts"() {
    "use strict";
    import_fs8 = require("fs");
    import_path11 = require("path");
    import_crypto6 = require("crypto");
    init_platform();
    init_paths();
    SECURE_FILE_MODE = 384;
    MAX_AGE_MS = 24 * 60 * 60 * 1e3;
    LOCK_TIMEOUT_MS = 2e3;
    LOCK_RETRY_MS = 20;
    LOCK_STALE_MS = 1e4;
    LOCK_MAX_WAIT_MS = 1e4;
    SLEEP_ARRAY = new Int32Array(new SharedArrayBuffer(4));
  }
});

// src/notifications/index.ts
var notifications_exports = {};
__export(notifications_exports, {
  CUSTOM_INTEGRATION_PRESETS: () => CUSTOM_INTEGRATION_PRESETS,
  NOTIFICATION_PROVISIONAL_LEASE_MS: () => NOTIFICATION_PROVISIONAL_LEASE_MS,
  SlackConnectionStateTracker: () => SlackConnectionStateTracker,
  TEMPLATE_VARIABLES: () => TEMPLATE_VARIABLES,
  checkDuplicateIds: () => checkDuplicateIds,
  claimNotificationReceipt: () => claimNotificationReceipt,
  claimProvisionalNotificationReceipt: () => claimProvisionalNotificationReceipt,
  computeTemplateVariables: () => computeTemplateVariables,
  detectLegacyOpenClawConfig: () => detectLegacyOpenClawConfig,
  dispatchCustomIntegrations: () => dispatchCustomIntegrations,
  dispatchNotifications: () => dispatchNotifications,
  finalizeNotificationReceiptQueued: () => finalizeNotificationReceiptQueued,
  formatAgentCall: () => formatAgentCall,
  formatAskUserQuestion: () => formatAskUserQuestion,
  formatNotification: () => formatNotification,
  formatSessionEnd: () => formatSessionEnd,
  formatSessionIdle: () => formatSessionIdle,
  formatSessionStart: () => formatSessionStart,
  formatSessionStop: () => formatSessionStop,
  formatTmuxInfo: () => formatTmuxInfo,
  getCurrentTmuxPaneId: () => getCurrentTmuxPaneId,
  getCurrentTmuxSession: () => getCurrentTmuxSession,
  getCustomIntegrationsConfig: () => getCustomIntegrationsConfig,
  getCustomIntegrationsForEvent: () => getCustomIntegrationsForEvent,
  getDefaultTemplate: () => getDefaultTemplate,
  getEnabledPlatforms: () => getEnabledPlatforms,
  getHookConfig: () => getHookConfig,
  getNotificationConfig: () => getNotificationConfig,
  getPreset: () => getPreset,
  getPresetList: () => getPresetList,
  getTeamTmuxSessions: () => getTeamTmuxSessions,
  getTmuxTailLines: () => getTmuxTailLines,
  getVariableDocumentation: () => getVariableDocumentation,
  getVariablesForEvent: () => getVariablesForEvent,
  getVerbosity: () => getVerbosity,
  hasCustomIntegrationsEnabled: () => hasCustomIntegrationsEnabled,
  interpolateTemplate: () => interpolateTemplate,
  isEventAllowedByVerbosity: () => isEventAllowedByVerbosity,
  isEventEnabled: () => isEventEnabled,
  isTimestampValid: () => isTimestampValid,
  isValidPreset: () => isValidPreset,
  markNotificationReceiptRetryable: () => markNotificationReceiptRetryable,
  mergeHookConfigIntoNotificationConfig: () => mergeHookConfigIntoNotificationConfig,
  migrateLegacyOpenClawConfig: () => migrateLegacyOpenClawConfig,
  notify: () => notify,
  notifyOnce: () => notifyOnce,
  parseTmuxTail: () => parseTmuxTail,
  redactTokens: () => redactTokens,
  resetHookConfigCache: () => resetHookConfigCache,
  resolveEventTemplate: () => resolveEventTemplate,
  sanitizeArgument: () => sanitizeArgument,
  sendCustomCli: () => sendCustomCli,
  sendCustomWebhook: () => sendCustomWebhook,
  sendDiscord: () => sendDiscord,
  sendDiscordBot: () => sendDiscordBot,
  sendSlack: () => sendSlack,
  sendSlackBot: () => sendSlackBot,
  sendTelegram: () => sendTelegram,
  sendWebhook: () => sendWebhook,
  shouldIncludeTmuxTail: () => shouldIncludeTmuxTail,
  validateCustomIntegration: () => validateCustomIntegration,
  validateSlackEnvelope: () => validateSlackEnvelope,
  validateSlackMessage: () => validateSlackMessage,
  validateTemplate: () => validateTemplate,
  verifySlackSignature: () => verifySlackSignature
});
function isPlainRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}
function isNotificationReceiptState(value, sessionId) {
  if (!isPlainRecord(value) || value.version !== 2) return false;
  if (!isPlainRecord(value.receipts)) return false;
  return Object.entries(value.receipts).every(([intentId, receipt]) => {
    if (intentId.length === 0 || !isPlainRecord(receipt) || typeof receipt.claimed_at_ms !== "number" || !Number.isFinite(receipt.claimed_at_ms) || receipt.session_id !== sessionId || typeof receipt.event !== "string" || receipt.event.length === 0) {
      return false;
    }
    if (receipt.delivery_status === void 0) {
      return receipt.claim_id === void 0 && receipt.lease_expires_at_ms === void 0 && receipt.queued_at_ms === void 0 && receipt.retryable_at_ms === void 0;
    }
    if (!["provisional", "queued", "retryable"].includes(String(receipt.delivery_status)) || typeof receipt.claim_id !== "string" || receipt.claim_id.length === 0) {
      return false;
    }
    if (receipt.lease_expires_at_ms !== void 0 && (typeof receipt.lease_expires_at_ms !== "number" || !Number.isFinite(receipt.lease_expires_at_ms))) {
      return false;
    }
    if (receipt.delivery_status === "queued") {
      return typeof receipt.queued_at_ms === "number" && Number.isFinite(receipt.queued_at_ms) && receipt.lease_expires_at_ms === void 0 && receipt.retryable_at_ms === void 0;
    }
    if (receipt.delivery_status === "retryable") {
      return typeof receipt.retryable_at_ms === "number" && Number.isFinite(receipt.retryable_at_ms) && receipt.lease_expires_at_ms === void 0 && receipt.queued_at_ms === void 0;
    }
    return receipt.queued_at_ms === void 0 && receipt.retryable_at_ms === void 0;
  });
}
function notificationReceiptPath(sessionId, projectPath) {
  return (0, import_path12.join)(
    getSessionStateDir(sessionId, projectPath),
    NOTIFICATION_RECEIPT_FILE
  );
}
function claimNotificationReceipt(intentId, event, sessionId, projectPath, nowMs) {
  try {
    const receiptPath = notificationReceiptPath(sessionId, projectPath);
    const locked = withStateFileMutationLock(receiptPath, () => {
      let state = { version: 2, receipts: {} };
      if ((0, import_fs9.existsSync)(receiptPath)) {
        try {
          const parsed = JSON.parse((0, import_fs9.readFileSync)(receiptPath, "utf8"));
          if (!isNotificationReceiptState(parsed, sessionId)) {
            return "failed";
          }
          state = parsed;
        } catch {
          return "failed";
        }
      }
      const receipts = { ...state.receipts };
      if (receipts[intentId]) return "duplicate";
      receipts[intentId] = {
        claimed_at_ms: nowMs,
        session_id: sessionId,
        event
      };
      atomicWriteJsonSync(receiptPath, {
        version: 2,
        receipts
      });
      return "claimed";
    });
    return locked.acquired && locked.value ? locked.value : "failed";
  } catch {
    return "failed";
  }
}
function boundedProvisionalLeaseExpiry(receipt) {
  const maximum = receipt.claimed_at_ms + NOTIFICATION_PROVISIONAL_LEASE_MS;
  if (!Number.isFinite(maximum)) return receipt.claimed_at_ms;
  return Math.min(
    receipt.lease_expires_at_ms ?? maximum,
    maximum
  );
}
function claimProvisionalNotificationReceipt(intentId, event, sessionId, projectPath, nowMs) {
  if (!intentId || !projectPath || !Number.isFinite(nowMs)) {
    return { status: "failed" };
  }
  const claimId = (0, import_crypto7.randomUUID)();
  try {
    const receiptPath = notificationReceiptPath(sessionId, projectPath);
    const locked = withStateFileMutationLock(receiptPath, () => {
      let state = { version: 2, receipts: {} };
      if ((0, import_fs9.existsSync)(receiptPath)) {
        try {
          const parsed = JSON.parse((0, import_fs9.readFileSync)(receiptPath, "utf8"));
          if (!isNotificationReceiptState(parsed, sessionId)) {
            return { status: "failed" };
          }
          state = parsed;
        } catch {
          return { status: "failed" };
        }
      }
      const current = state.receipts[intentId];
      if (current) {
        if (current.delivery_status === "provisional") {
          if (nowMs < boundedProvisionalLeaseExpiry(current)) {
            return { status: "duplicate" };
          }
        } else if (current.delivery_status !== "retryable") {
          return { status: "duplicate" };
        }
      }
      const leaseExpiresAtMs = Math.min(
        Number.MAX_SAFE_INTEGER,
        nowMs + NOTIFICATION_PROVISIONAL_LEASE_MS
      );
      atomicWriteJsonSync(receiptPath, {
        version: 2,
        receipts: {
          ...state.receipts,
          [intentId]: {
            claimed_at_ms: nowMs,
            lease_expires_at_ms: leaseExpiresAtMs,
            session_id: sessionId,
            event,
            delivery_status: "provisional",
            claim_id: claimId
          }
        }
      });
      return { status: "claimed", claimId };
    });
    return locked.acquired && locked.value ? locked.value : { status: "failed" };
  } catch {
    return { status: "failed" };
  }
}
function finalizeNotificationReceiptQueued(intentId, sessionId, projectPath, claimId, nowMs) {
  try {
    const receiptPath = notificationReceiptPath(sessionId, projectPath);
    const locked = withStateFileMutationLock(receiptPath, () => {
      if (!(0, import_fs9.existsSync)(receiptPath)) return "changed";
      let state;
      try {
        const parsed = JSON.parse((0, import_fs9.readFileSync)(receiptPath, "utf8"));
        if (!isNotificationReceiptState(parsed, sessionId)) {
          return "failed";
        }
        state = parsed;
      } catch {
        return "failed";
      }
      const current = state.receipts[intentId];
      if (!current || current.claim_id !== claimId || current.delivery_status !== "provisional" && current.delivery_status !== "queued") {
        return "changed";
      }
      if (current.delivery_status === "queued") return "finalized";
      const queued = { ...current };
      delete queued.lease_expires_at_ms;
      atomicWriteJsonSync(receiptPath, {
        version: 2,
        receipts: {
          ...state.receipts,
          [intentId]: {
            ...queued,
            delivery_status: "queued",
            queued_at_ms: nowMs
          }
        }
      });
      return "finalized";
    });
    return locked.acquired && locked.value ? locked.value : "failed";
  } catch {
    return "failed";
  }
}
function markNotificationReceiptRetryable(intentId, sessionId, projectPath, claimId, nowMs) {
  try {
    const receiptPath = notificationReceiptPath(sessionId, projectPath);
    const locked = withStateFileMutationLock(receiptPath, () => {
      if (!(0, import_fs9.existsSync)(receiptPath)) return "changed";
      let state;
      try {
        const parsed = JSON.parse((0, import_fs9.readFileSync)(receiptPath, "utf8"));
        if (!isNotificationReceiptState(parsed, sessionId)) {
          return "failed";
        }
        state = parsed;
      } catch {
        return "failed";
      }
      const current = state.receipts[intentId];
      if (!current || current.delivery_status !== "provisional" || current.claim_id !== claimId) {
        return "changed";
      }
      const retryable = { ...current };
      delete retryable.lease_expires_at_ms;
      atomicWriteJsonSync(receiptPath, {
        version: 2,
        receipts: {
          ...state.receipts,
          [intentId]: {
            ...retryable,
            delivery_status: "retryable",
            retryable_at_ms: nowMs
          }
        }
      });
      return "retryable";
    });
    return locked.acquired && locked.value ? locked.value : "failed";
  } catch {
    return "failed";
  }
}
async function notify(event, data) {
  if (process.env.OMC_NOTIFY === "0") {
    return null;
  }
  try {
    const config = getNotificationConfig(data.profileName);
    if (!config || !isEventEnabled(config, event)) {
      return null;
    }
    const verbosity = getVerbosity(config);
    const isExplicitAskUserQuestionEvent = event === "ask-user-question" && config.events?.["ask-user-question"]?.enabled === true;
    if (!isExplicitAskUserQuestionEvent && !isEventAllowedByVerbosity(verbosity, event)) {
      return null;
    }
    const { getCurrentTmuxPaneId: getCurrentTmuxPaneId2 } = await Promise.resolve().then(() => (init_tmux(), tmux_exports));
    const payload = {
      event,
      sessionId: data.sessionId,
      message: "",
      // Will be formatted below
      timestamp: data.timestamp || (/* @__PURE__ */ new Date()).toISOString(),
      tmuxSession: data.tmuxSession ?? getCurrentTmuxSession() ?? void 0,
      tmuxPaneId: data.tmuxPaneId ?? getCurrentTmuxPaneId2() ?? void 0,
      projectPath: data.projectPath,
      projectName: data.projectName || (data.projectPath ? (0, import_path12.basename)(data.projectPath) : void 0),
      modesUsed: data.modesUsed,
      contextSummary: data.contextSummary,
      durationMs: data.durationMs,
      agentsSpawned: data.agentsSpawned,
      agentsCompleted: data.agentsCompleted,
      reason: data.reason,
      activeMode: data.activeMode,
      iteration: data.iteration,
      maxIterations: data.maxIterations,
      question: data.question,
      askUserQuestionPrompts: data.askUserQuestionPrompts,
      incompleteTasks: data.incompleteTasks,
      agentName: data.agentName,
      agentType: data.agentType,
      replyChannel: data.replyChannel ?? process.env.OPENCLAW_REPLY_CHANNEL ?? void 0,
      replyTarget: data.replyTarget ?? process.env.OPENCLAW_REPLY_TARGET ?? void 0,
      replyThread: data.replyThread ?? process.env.OPENCLAW_REPLY_THREAD ?? void 0
    };
    if (shouldIncludeTmuxTail(verbosity) && payload.tmuxPaneId && (event === "session-idle" || event === "session-end" || event === "session-stop")) {
      try {
        const { capturePaneContent: capturePaneContent2 } = await Promise.resolve().then(() => (init_tmux_detector(), tmux_detector_exports));
        const { getNewPaneTail: getNewPaneTail2 } = await Promise.resolve().then(() => (init_pane_fresh_capture(), pane_fresh_capture_exports));
        const tailLines = getTmuxTailLines(config);
        const rawTail = payload.projectPath ? getNewPaneTail2(payload.tmuxPaneId, (0, import_path12.join)(getOmcRoot(payload.projectPath), "state"), tailLines) : capturePaneContent2(payload.tmuxPaneId, tailLines);
        if (rawTail) {
          payload.tmuxTail = rawTail;
          payload.maxTailLines = tailLines;
        }
      } catch {
      }
    }
    const defaultMessage = data.message || formatNotification(payload);
    payload.message = defaultMessage;
    let platformMessages;
    if (!data.message) {
      const hookConfig = getHookConfig();
      if (hookConfig?.enabled) {
        const platforms = [
          "discord",
          "discord-bot",
          "telegram",
          "slack",
          "slack-bot",
          "webhook"
        ];
        const map = /* @__PURE__ */ new Map();
        for (const platform of platforms) {
          const template = resolveEventTemplate(hookConfig, event, platform);
          if (template) {
            const resolved = interpolateTemplate(template, payload);
            if (resolved !== defaultMessage) {
              map.set(platform, resolved);
            }
          }
        }
        if (map.size > 0) {
          platformMessages = map;
        }
      }
    }
    const result = await dispatchNotifications(
      config,
      event,
      payload,
      platformMessages
    );
    if (result.anySuccess && payload.tmuxPaneId) {
      try {
        const { registerMessage: registerMessage2 } = await Promise.resolve().then(() => (init_session_registry(), session_registry_exports));
        for (const r of result.results) {
          if (r.success && r.messageId && (r.platform === "discord-bot" || r.platform === "telegram" || r.platform === "slack-bot")) {
            registerMessage2({
              platform: r.platform,
              messageId: r.messageId,
              sessionId: payload.sessionId,
              tmuxPaneId: payload.tmuxPaneId,
              tmuxSessionName: payload.tmuxSession || "",
              event: payload.event,
              createdAt: (/* @__PURE__ */ new Date()).toISOString(),
              projectPath: payload.projectPath,
              ...payload.event === "ask-user-question" && payload.askUserQuestionPrompts?.[0] ? {
                askUserQuestionOptionCount: payload.askUserQuestionPrompts[0].options.length,
                askUserQuestionAllowOther: payload.askUserQuestionPrompts[0].allowOther !== false
              } : {}
            });
          }
        }
      } catch {
      }
    }
    return result;
  } catch (error) {
    console.error(
      "[notifications] Error:",
      error instanceof Error ? error.message : error
    );
    return null;
  }
}
async function notifyOnce(intentId, event, data, nowMs = Date.now()) {
  if (!intentId || !data.projectPath) return { status: "failed" };
  const claim = claimNotificationReceipt(
    intentId,
    event,
    data.sessionId,
    data.projectPath,
    nowMs
  );
  if (claim === "duplicate") return { status: "duplicate" };
  if (claim === "failed") return { status: "failed" };
  const result = await notify(event, data);
  if (!result) return { status: "skipped" };
  return {
    status: result.anySuccess ? "sent" : "skipped"
  };
}
var import_path12, import_fs9, import_crypto7, NOTIFICATION_RECEIPT_FILE, NOTIFICATION_PROVISIONAL_LEASE_MS;
var init_notifications = __esm({
  "src/notifications/index.ts"() {
    "use strict";
    init_dispatcher();
    init_formatter();
    init_tmux();
    init_config();
    init_hook_config();
    init_template_engine();
    init_slack_socket();
    init_redact();
    init_config();
    init_formatter();
    init_dispatcher();
    init_tmux();
    init_hook_config();
    init_template_engine();
    import_path12 = require("path");
    import_fs9 = require("fs");
    import_crypto7 = require("crypto");
    init_worktree_paths();
    init_atomic_write();
    init_mode_state_io();
    init_dispatcher();
    init_config();
    init_presets();
    init_template_variables();
    init_validation();
    NOTIFICATION_RECEIPT_FILE = "notification-delivery-receipts.json";
    NOTIFICATION_PROVISIONAL_LEASE_MS = 3e4;
  }
});

// src/hooks/hook-runtime-entry.ts
var hook_runtime_entry_exports = {};
__export(hook_runtime_entry_exports, {
  CLAUDE_SINGLE_CAPABILITIES: () => CLAUDE_SINGLE_CAPABILITIES,
  COPILOT_1072_CAPABILITIES: () => COPILOT_1072_CAPABILITIES,
  DEFAULT_PRE_TOOL_EFFECT_DEPENDENCIES: () => DEFAULT_PRE_TOOL_EFFECT_DEPENDENCIES,
  adaptLegacyHookOutput: () => adaptLegacyHookOutput,
  boundHookContexts: () => boundHookContexts,
  buildAdvisoryCandidate: () => buildAdvisoryCandidate,
  buildLegacyProcessorInput: () => buildLegacyProcessorInput,
  canEncodeHookMutation: () => canEncodeHookMutation,
  claimAdvisoryThrottleLocked: () => claimAdvisoryThrottleLocked,
  commitPreToolEffects: () => commitPreToolEffects,
  describeHookRunFailure: () => describeHookRunFailure,
  detectHookContract: () => detectHookContract,
  encodeClaudeHookOutput: () => encodeClaudeHookOutput,
  encodeCopilotHookOutput: () => encodeCopilotHookOutput,
  encodeHookOutput: () => encodeHookOutput,
  encodeLegacyCompatibleHookOutput: () => encodeLegacyCompatibleHookOutput,
  encodePreToolEnforcerOutput: () => encodePreToolEnforcerOutput,
  evaluateForceDelegationPure: () => evaluateForceDelegationPure,
  evaluateModelRouting: () => evaluateModelRouting,
  evaluatePreToolCall: () => evaluatePreToolCall,
  evaluateUltragoal: () => evaluateUltragoal,
  finalizePreToolReduction: () => finalizePreToolReduction,
  formatUnknownError: () => formatUnknownError,
  interpretLegacyOutput: () => interpretLegacyOutput,
  loadPreToolBatchSnapshot: () => loadPreToolBatchSnapshot,
  normalizeHookEnvelope: () => normalizeHookEnvelope,
  normalizeHookInput: () => normalizeHookInput,
  normalizeLegacyHookInput: () => normalizeLegacyHookInput,
  planPreToolBatch: () => planPreToolBatch,
  reduceHookEvaluations: () => reduceHookEvaluations,
  reserveAndPlanPreToolBatch: () => reserveAndPlanPreToolBatch,
  runHookJson: () => runHookJson,
  runHookNotificationChild: () => runHookNotificationChild,
  runHookPayload: () => runHookPayload,
  sanitizeHookEvaluation: () => sanitizeHookEvaluation,
  writeForceDelegationAttemptLocked: () => writeForceDelegationAttemptLocked
});
module.exports = __toCommonJS(hook_runtime_entry_exports);

// src/hooks/bridge-normalize.ts
var import_crypto2 = require("crypto");

// node_modules/zod/v3/external.js
var external_exports = {};
__export(external_exports, {
  BRAND: () => BRAND,
  DIRTY: () => DIRTY,
  EMPTY_PATH: () => EMPTY_PATH,
  INVALID: () => INVALID,
  NEVER: () => NEVER,
  OK: () => OK,
  ParseStatus: () => ParseStatus,
  Schema: () => ZodType,
  ZodAny: () => ZodAny,
  ZodArray: () => ZodArray,
  ZodBigInt: () => ZodBigInt,
  ZodBoolean: () => ZodBoolean,
  ZodBranded: () => ZodBranded,
  ZodCatch: () => ZodCatch,
  ZodDate: () => ZodDate,
  ZodDefault: () => ZodDefault,
  ZodDiscriminatedUnion: () => ZodDiscriminatedUnion,
  ZodEffects: () => ZodEffects,
  ZodEnum: () => ZodEnum,
  ZodError: () => ZodError,
  ZodFirstPartyTypeKind: () => ZodFirstPartyTypeKind,
  ZodFunction: () => ZodFunction,
  ZodIntersection: () => ZodIntersection,
  ZodIssueCode: () => ZodIssueCode,
  ZodLazy: () => ZodLazy,
  ZodLiteral: () => ZodLiteral,
  ZodMap: () => ZodMap,
  ZodNaN: () => ZodNaN,
  ZodNativeEnum: () => ZodNativeEnum,
  ZodNever: () => ZodNever,
  ZodNull: () => ZodNull,
  ZodNullable: () => ZodNullable,
  ZodNumber: () => ZodNumber,
  ZodObject: () => ZodObject,
  ZodOptional: () => ZodOptional,
  ZodParsedType: () => ZodParsedType,
  ZodPipeline: () => ZodPipeline,
  ZodPromise: () => ZodPromise,
  ZodReadonly: () => ZodReadonly,
  ZodRecord: () => ZodRecord,
  ZodSchema: () => ZodType,
  ZodSet: () => ZodSet,
  ZodString: () => ZodString,
  ZodSymbol: () => ZodSymbol,
  ZodTransformer: () => ZodEffects,
  ZodTuple: () => ZodTuple,
  ZodType: () => ZodType,
  ZodUndefined: () => ZodUndefined,
  ZodUnion: () => ZodUnion,
  ZodUnknown: () => ZodUnknown,
  ZodVoid: () => ZodVoid,
  addIssueToContext: () => addIssueToContext,
  any: () => anyType,
  array: () => arrayType,
  bigint: () => bigIntType,
  boolean: () => booleanType,
  coerce: () => coerce,
  custom: () => custom,
  date: () => dateType,
  datetimeRegex: () => datetimeRegex,
  defaultErrorMap: () => en_default,
  discriminatedUnion: () => discriminatedUnionType,
  effect: () => effectsType,
  enum: () => enumType,
  function: () => functionType,
  getErrorMap: () => getErrorMap,
  getParsedType: () => getParsedType,
  instanceof: () => instanceOfType,
  intersection: () => intersectionType,
  isAborted: () => isAborted,
  isAsync: () => isAsync,
  isDirty: () => isDirty,
  isValid: () => isValid,
  late: () => late,
  lazy: () => lazyType,
  literal: () => literalType,
  makeIssue: () => makeIssue,
  map: () => mapType,
  nan: () => nanType,
  nativeEnum: () => nativeEnumType,
  never: () => neverType,
  null: () => nullType,
  nullable: () => nullableType,
  number: () => numberType,
  object: () => objectType,
  objectUtil: () => objectUtil,
  oboolean: () => oboolean,
  onumber: () => onumber,
  optional: () => optionalType,
  ostring: () => ostring,
  pipeline: () => pipelineType,
  preprocess: () => preprocessType,
  promise: () => promiseType,
  quotelessJson: () => quotelessJson,
  record: () => recordType,
  set: () => setType,
  setErrorMap: () => setErrorMap,
  strictObject: () => strictObjectType,
  string: () => stringType,
  symbol: () => symbolType,
  transformer: () => effectsType,
  tuple: () => tupleType,
  undefined: () => undefinedType,
  union: () => unionType,
  unknown: () => unknownType,
  util: () => util,
  void: () => voidType
});

// node_modules/zod/v3/helpers/util.js
var util;
(function(util2) {
  util2.assertEqual = (_) => {
  };
  function assertIs(_arg) {
  }
  util2.assertIs = assertIs;
  function assertNever(_x) {
    throw new Error();
  }
  util2.assertNever = assertNever;
  util2.arrayToEnum = (items) => {
    const obj = {};
    for (const item of items) {
      obj[item] = item;
    }
    return obj;
  };
  util2.getValidEnumValues = (obj) => {
    const validKeys = util2.objectKeys(obj).filter((k) => typeof obj[obj[k]] !== "number");
    const filtered = {};
    for (const k of validKeys) {
      filtered[k] = obj[k];
    }
    return util2.objectValues(filtered);
  };
  util2.objectValues = (obj) => {
    return util2.objectKeys(obj).map(function(e) {
      return obj[e];
    });
  };
  util2.objectKeys = typeof Object.keys === "function" ? (obj) => Object.keys(obj) : (object) => {
    const keys = [];
    for (const key in object) {
      if (Object.prototype.hasOwnProperty.call(object, key)) {
        keys.push(key);
      }
    }
    return keys;
  };
  util2.find = (arr, checker) => {
    for (const item of arr) {
      if (checker(item))
        return item;
    }
    return void 0;
  };
  util2.isInteger = typeof Number.isInteger === "function" ? (val) => Number.isInteger(val) : (val) => typeof val === "number" && Number.isFinite(val) && Math.floor(val) === val;
  function joinValues(array, separator = " | ") {
    return array.map((val) => typeof val === "string" ? `'${val}'` : val).join(separator);
  }
  util2.joinValues = joinValues;
  util2.jsonStringifyReplacer = (_, value) => {
    if (typeof value === "bigint") {
      return value.toString();
    }
    return value;
  };
})(util || (util = {}));
var objectUtil;
(function(objectUtil2) {
  objectUtil2.mergeShapes = (first, second) => {
    return {
      ...first,
      ...second
      // second overwrites first
    };
  };
})(objectUtil || (objectUtil = {}));
var ZodParsedType = util.arrayToEnum([
  "string",
  "nan",
  "number",
  "integer",
  "float",
  "boolean",
  "date",
  "bigint",
  "symbol",
  "function",
  "undefined",
  "null",
  "array",
  "object",
  "unknown",
  "promise",
  "void",
  "never",
  "map",
  "set"
]);
var getParsedType = (data) => {
  const t = typeof data;
  switch (t) {
    case "undefined":
      return ZodParsedType.undefined;
    case "string":
      return ZodParsedType.string;
    case "number":
      return Number.isNaN(data) ? ZodParsedType.nan : ZodParsedType.number;
    case "boolean":
      return ZodParsedType.boolean;
    case "function":
      return ZodParsedType.function;
    case "bigint":
      return ZodParsedType.bigint;
    case "symbol":
      return ZodParsedType.symbol;
    case "object":
      if (Array.isArray(data)) {
        return ZodParsedType.array;
      }
      if (data === null) {
        return ZodParsedType.null;
      }
      if (data.then && typeof data.then === "function" && data.catch && typeof data.catch === "function") {
        return ZodParsedType.promise;
      }
      if (typeof Map !== "undefined" && data instanceof Map) {
        return ZodParsedType.map;
      }
      if (typeof Set !== "undefined" && data instanceof Set) {
        return ZodParsedType.set;
      }
      if (typeof Date !== "undefined" && data instanceof Date) {
        return ZodParsedType.date;
      }
      return ZodParsedType.object;
    default:
      return ZodParsedType.unknown;
  }
};

// node_modules/zod/v3/ZodError.js
var ZodIssueCode = util.arrayToEnum([
  "invalid_type",
  "invalid_literal",
  "custom",
  "invalid_union",
  "invalid_union_discriminator",
  "invalid_enum_value",
  "unrecognized_keys",
  "invalid_arguments",
  "invalid_return_type",
  "invalid_date",
  "invalid_string",
  "too_small",
  "too_big",
  "invalid_intersection_types",
  "not_multiple_of",
  "not_finite"
]);
var quotelessJson = (obj) => {
  const json = JSON.stringify(obj, null, 2);
  return json.replace(/"([^"]+)":/g, "$1:");
};
var ZodError = class _ZodError extends Error {
  get errors() {
    return this.issues;
  }
  constructor(issues) {
    super();
    this.issues = [];
    this.addIssue = (sub) => {
      this.issues = [...this.issues, sub];
    };
    this.addIssues = (subs = []) => {
      this.issues = [...this.issues, ...subs];
    };
    const actualProto = new.target.prototype;
    if (Object.setPrototypeOf) {
      Object.setPrototypeOf(this, actualProto);
    } else {
      this.__proto__ = actualProto;
    }
    this.name = "ZodError";
    this.issues = issues;
  }
  format(_mapper) {
    const mapper = _mapper || function(issue) {
      return issue.message;
    };
    const fieldErrors = { _errors: [] };
    const processError = (error) => {
      for (const issue of error.issues) {
        if (issue.code === "invalid_union") {
          issue.unionErrors.map(processError);
        } else if (issue.code === "invalid_return_type") {
          processError(issue.returnTypeError);
        } else if (issue.code === "invalid_arguments") {
          processError(issue.argumentsError);
        } else if (issue.path.length === 0) {
          fieldErrors._errors.push(mapper(issue));
        } else {
          let curr = fieldErrors;
          let i = 0;
          while (i < issue.path.length) {
            const el = issue.path[i];
            const terminal = i === issue.path.length - 1;
            if (!terminal) {
              curr[el] = curr[el] || { _errors: [] };
            } else {
              curr[el] = curr[el] || { _errors: [] };
              curr[el]._errors.push(mapper(issue));
            }
            curr = curr[el];
            i++;
          }
        }
      }
    };
    processError(this);
    return fieldErrors;
  }
  static assert(value) {
    if (!(value instanceof _ZodError)) {
      throw new Error(`Not a ZodError: ${value}`);
    }
  }
  toString() {
    return this.message;
  }
  get message() {
    return JSON.stringify(this.issues, util.jsonStringifyReplacer, 2);
  }
  get isEmpty() {
    return this.issues.length === 0;
  }
  flatten(mapper = (issue) => issue.message) {
    const fieldErrors = {};
    const formErrors = [];
    for (const sub of this.issues) {
      if (sub.path.length > 0) {
        const firstEl = sub.path[0];
        fieldErrors[firstEl] = fieldErrors[firstEl] || [];
        fieldErrors[firstEl].push(mapper(sub));
      } else {
        formErrors.push(mapper(sub));
      }
    }
    return { formErrors, fieldErrors };
  }
  get formErrors() {
    return this.flatten();
  }
};
ZodError.create = (issues) => {
  const error = new ZodError(issues);
  return error;
};

// node_modules/zod/v3/locales/en.js
var errorMap = (issue, _ctx) => {
  let message;
  switch (issue.code) {
    case ZodIssueCode.invalid_type:
      if (issue.received === ZodParsedType.undefined) {
        message = "Required";
      } else {
        message = `Expected ${issue.expected}, received ${issue.received}`;
      }
      break;
    case ZodIssueCode.invalid_literal:
      message = `Invalid literal value, expected ${JSON.stringify(issue.expected, util.jsonStringifyReplacer)}`;
      break;
    case ZodIssueCode.unrecognized_keys:
      message = `Unrecognized key(s) in object: ${util.joinValues(issue.keys, ", ")}`;
      break;
    case ZodIssueCode.invalid_union:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_union_discriminator:
      message = `Invalid discriminator value. Expected ${util.joinValues(issue.options)}`;
      break;
    case ZodIssueCode.invalid_enum_value:
      message = `Invalid enum value. Expected ${util.joinValues(issue.options)}, received '${issue.received}'`;
      break;
    case ZodIssueCode.invalid_arguments:
      message = `Invalid function arguments`;
      break;
    case ZodIssueCode.invalid_return_type:
      message = `Invalid function return type`;
      break;
    case ZodIssueCode.invalid_date:
      message = `Invalid date`;
      break;
    case ZodIssueCode.invalid_string:
      if (typeof issue.validation === "object") {
        if ("includes" in issue.validation) {
          message = `Invalid input: must include "${issue.validation.includes}"`;
          if (typeof issue.validation.position === "number") {
            message = `${message} at one or more positions greater than or equal to ${issue.validation.position}`;
          }
        } else if ("startsWith" in issue.validation) {
          message = `Invalid input: must start with "${issue.validation.startsWith}"`;
        } else if ("endsWith" in issue.validation) {
          message = `Invalid input: must end with "${issue.validation.endsWith}"`;
        } else {
          util.assertNever(issue.validation);
        }
      } else if (issue.validation !== "regex") {
        message = `Invalid ${issue.validation}`;
      } else {
        message = "Invalid";
      }
      break;
    case ZodIssueCode.too_small:
      if (issue.type === "array")
        message = `Array must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `more than`} ${issue.minimum} element(s)`;
      else if (issue.type === "string")
        message = `String must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `over`} ${issue.minimum} character(s)`;
      else if (issue.type === "number")
        message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
      else if (issue.type === "bigint")
        message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
      else if (issue.type === "date")
        message = `Date must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${new Date(Number(issue.minimum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.too_big:
      if (issue.type === "array")
        message = `Array must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `less than`} ${issue.maximum} element(s)`;
      else if (issue.type === "string")
        message = `String must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `under`} ${issue.maximum} character(s)`;
      else if (issue.type === "number")
        message = `Number must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
      else if (issue.type === "bigint")
        message = `BigInt must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
      else if (issue.type === "date")
        message = `Date must be ${issue.exact ? `exactly` : issue.inclusive ? `smaller than or equal to` : `smaller than`} ${new Date(Number(issue.maximum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.custom:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_intersection_types:
      message = `Intersection results could not be merged`;
      break;
    case ZodIssueCode.not_multiple_of:
      message = `Number must be a multiple of ${issue.multipleOf}`;
      break;
    case ZodIssueCode.not_finite:
      message = "Number must be finite";
      break;
    default:
      message = _ctx.defaultError;
      util.assertNever(issue);
  }
  return { message };
};
var en_default = errorMap;

// node_modules/zod/v3/errors.js
var overrideErrorMap = en_default;
function setErrorMap(map) {
  overrideErrorMap = map;
}
function getErrorMap() {
  return overrideErrorMap;
}

// node_modules/zod/v3/helpers/parseUtil.js
var makeIssue = (params) => {
  const { data, path: path3, errorMaps, issueData } = params;
  const fullPath = [...path3, ...issueData.path || []];
  const fullIssue = {
    ...issueData,
    path: fullPath
  };
  if (issueData.message !== void 0) {
    return {
      ...issueData,
      path: fullPath,
      message: issueData.message
    };
  }
  let errorMessage = "";
  const maps = errorMaps.filter((m) => !!m).slice().reverse();
  for (const map of maps) {
    errorMessage = map(fullIssue, { data, defaultError: errorMessage }).message;
  }
  return {
    ...issueData,
    path: fullPath,
    message: errorMessage
  };
};
var EMPTY_PATH = [];
function addIssueToContext(ctx, issueData) {
  const overrideMap = getErrorMap();
  const issue = makeIssue({
    issueData,
    data: ctx.data,
    path: ctx.path,
    errorMaps: [
      ctx.common.contextualErrorMap,
      // contextual error map is first priority
      ctx.schemaErrorMap,
      // then schema-bound map if available
      overrideMap,
      // then global override map
      overrideMap === en_default ? void 0 : en_default
      // then global default map
    ].filter((x) => !!x)
  });
  ctx.common.issues.push(issue);
}
var ParseStatus = class _ParseStatus {
  constructor() {
    this.value = "valid";
  }
  dirty() {
    if (this.value === "valid")
      this.value = "dirty";
  }
  abort() {
    if (this.value !== "aborted")
      this.value = "aborted";
  }
  static mergeArray(status, results) {
    const arrayValue = [];
    for (const s of results) {
      if (s.status === "aborted")
        return INVALID;
      if (s.status === "dirty")
        status.dirty();
      arrayValue.push(s.value);
    }
    return { status: status.value, value: arrayValue };
  }
  static async mergeObjectAsync(status, pairs) {
    const syncPairs = [];
    for (const pair of pairs) {
      const key = await pair.key;
      const value = await pair.value;
      syncPairs.push({
        key,
        value
      });
    }
    return _ParseStatus.mergeObjectSync(status, syncPairs);
  }
  static mergeObjectSync(status, pairs) {
    const finalObject = {};
    for (const pair of pairs) {
      const { key, value } = pair;
      if (key.status === "aborted")
        return INVALID;
      if (value.status === "aborted")
        return INVALID;
      if (key.status === "dirty")
        status.dirty();
      if (value.status === "dirty")
        status.dirty();
      if (key.value !== "__proto__" && (typeof value.value !== "undefined" || pair.alwaysSet)) {
        finalObject[key.value] = value.value;
      }
    }
    return { status: status.value, value: finalObject };
  }
};
var INVALID = Object.freeze({
  status: "aborted"
});
var DIRTY = (value) => ({ status: "dirty", value });
var OK = (value) => ({ status: "valid", value });
var isAborted = (x) => x.status === "aborted";
var isDirty = (x) => x.status === "dirty";
var isValid = (x) => x.status === "valid";
var isAsync = (x) => typeof Promise !== "undefined" && x instanceof Promise;

// node_modules/zod/v3/helpers/errorUtil.js
var errorUtil;
(function(errorUtil2) {
  errorUtil2.errToObj = (message) => typeof message === "string" ? { message } : message || {};
  errorUtil2.toString = (message) => typeof message === "string" ? message : message?.message;
})(errorUtil || (errorUtil = {}));

// node_modules/zod/v3/types.js
var ParseInputLazyPath = class {
  constructor(parent, value, path3, key) {
    this._cachedPath = [];
    this.parent = parent;
    this.data = value;
    this._path = path3;
    this._key = key;
  }
  get path() {
    if (!this._cachedPath.length) {
      if (Array.isArray(this._key)) {
        this._cachedPath.push(...this._path, ...this._key);
      } else {
        this._cachedPath.push(...this._path, this._key);
      }
    }
    return this._cachedPath;
  }
};
var handleResult = (ctx, result) => {
  if (isValid(result)) {
    return { success: true, data: result.value };
  } else {
    if (!ctx.common.issues.length) {
      throw new Error("Validation failed but no issues detected.");
    }
    return {
      success: false,
      get error() {
        if (this._error)
          return this._error;
        const error = new ZodError(ctx.common.issues);
        this._error = error;
        return this._error;
      }
    };
  }
};
function processCreateParams(params) {
  if (!params)
    return {};
  const { errorMap: errorMap2, invalid_type_error, required_error, description } = params;
  if (errorMap2 && (invalid_type_error || required_error)) {
    throw new Error(`Can't use "invalid_type_error" or "required_error" in conjunction with custom error map.`);
  }
  if (errorMap2)
    return { errorMap: errorMap2, description };
  const customMap = (iss, ctx) => {
    const { message } = params;
    if (iss.code === "invalid_enum_value") {
      return { message: message ?? ctx.defaultError };
    }
    if (typeof ctx.data === "undefined") {
      return { message: message ?? required_error ?? ctx.defaultError };
    }
    if (iss.code !== "invalid_type")
      return { message: ctx.defaultError };
    return { message: message ?? invalid_type_error ?? ctx.defaultError };
  };
  return { errorMap: customMap, description };
}
var ZodType = class {
  get description() {
    return this._def.description;
  }
  _getType(input) {
    return getParsedType(input.data);
  }
  _getOrReturnCtx(input, ctx) {
    return ctx || {
      common: input.parent.common,
      data: input.data,
      parsedType: getParsedType(input.data),
      schemaErrorMap: this._def.errorMap,
      path: input.path,
      parent: input.parent
    };
  }
  _processInputParams(input) {
    return {
      status: new ParseStatus(),
      ctx: {
        common: input.parent.common,
        data: input.data,
        parsedType: getParsedType(input.data),
        schemaErrorMap: this._def.errorMap,
        path: input.path,
        parent: input.parent
      }
    };
  }
  _parseSync(input) {
    const result = this._parse(input);
    if (isAsync(result)) {
      throw new Error("Synchronous parse encountered promise.");
    }
    return result;
  }
  _parseAsync(input) {
    const result = this._parse(input);
    return Promise.resolve(result);
  }
  parse(data, params) {
    const result = this.safeParse(data, params);
    if (result.success)
      return result.data;
    throw result.error;
  }
  safeParse(data, params) {
    const ctx = {
      common: {
        issues: [],
        async: params?.async ?? false,
        contextualErrorMap: params?.errorMap
      },
      path: params?.path || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    const result = this._parseSync({ data, path: ctx.path, parent: ctx });
    return handleResult(ctx, result);
  }
  "~validate"(data) {
    const ctx = {
      common: {
        issues: [],
        async: !!this["~standard"].async
      },
      path: [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    if (!this["~standard"].async) {
      try {
        const result = this._parseSync({ data, path: [], parent: ctx });
        return isValid(result) ? {
          value: result.value
        } : {
          issues: ctx.common.issues
        };
      } catch (err) {
        if (err?.message?.toLowerCase()?.includes("encountered")) {
          this["~standard"].async = true;
        }
        ctx.common = {
          issues: [],
          async: true
        };
      }
    }
    return this._parseAsync({ data, path: [], parent: ctx }).then((result) => isValid(result) ? {
      value: result.value
    } : {
      issues: ctx.common.issues
    });
  }
  async parseAsync(data, params) {
    const result = await this.safeParseAsync(data, params);
    if (result.success)
      return result.data;
    throw result.error;
  }
  async safeParseAsync(data, params) {
    const ctx = {
      common: {
        issues: [],
        contextualErrorMap: params?.errorMap,
        async: true
      },
      path: params?.path || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    const maybeAsyncResult = this._parse({ data, path: ctx.path, parent: ctx });
    const result = await (isAsync(maybeAsyncResult) ? maybeAsyncResult : Promise.resolve(maybeAsyncResult));
    return handleResult(ctx, result);
  }
  refine(check, message) {
    const getIssueProperties = (val) => {
      if (typeof message === "string" || typeof message === "undefined") {
        return { message };
      } else if (typeof message === "function") {
        return message(val);
      } else {
        return message;
      }
    };
    return this._refinement((val, ctx) => {
      const result = check(val);
      const setError = () => ctx.addIssue({
        code: ZodIssueCode.custom,
        ...getIssueProperties(val)
      });
      if (typeof Promise !== "undefined" && result instanceof Promise) {
        return result.then((data) => {
          if (!data) {
            setError();
            return false;
          } else {
            return true;
          }
        });
      }
      if (!result) {
        setError();
        return false;
      } else {
        return true;
      }
    });
  }
  refinement(check, refinementData) {
    return this._refinement((val, ctx) => {
      if (!check(val)) {
        ctx.addIssue(typeof refinementData === "function" ? refinementData(val, ctx) : refinementData);
        return false;
      } else {
        return true;
      }
    });
  }
  _refinement(refinement) {
    return new ZodEffects({
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "refinement", refinement }
    });
  }
  superRefine(refinement) {
    return this._refinement(refinement);
  }
  constructor(def) {
    this.spa = this.safeParseAsync;
    this._def = def;
    this.parse = this.parse.bind(this);
    this.safeParse = this.safeParse.bind(this);
    this.parseAsync = this.parseAsync.bind(this);
    this.safeParseAsync = this.safeParseAsync.bind(this);
    this.spa = this.spa.bind(this);
    this.refine = this.refine.bind(this);
    this.refinement = this.refinement.bind(this);
    this.superRefine = this.superRefine.bind(this);
    this.optional = this.optional.bind(this);
    this.nullable = this.nullable.bind(this);
    this.nullish = this.nullish.bind(this);
    this.array = this.array.bind(this);
    this.promise = this.promise.bind(this);
    this.or = this.or.bind(this);
    this.and = this.and.bind(this);
    this.transform = this.transform.bind(this);
    this.brand = this.brand.bind(this);
    this.default = this.default.bind(this);
    this.catch = this.catch.bind(this);
    this.describe = this.describe.bind(this);
    this.pipe = this.pipe.bind(this);
    this.readonly = this.readonly.bind(this);
    this.isNullable = this.isNullable.bind(this);
    this.isOptional = this.isOptional.bind(this);
    this["~standard"] = {
      version: 1,
      vendor: "zod",
      validate: (data) => this["~validate"](data)
    };
  }
  optional() {
    return ZodOptional.create(this, this._def);
  }
  nullable() {
    return ZodNullable.create(this, this._def);
  }
  nullish() {
    return this.nullable().optional();
  }
  array() {
    return ZodArray.create(this);
  }
  promise() {
    return ZodPromise.create(this, this._def);
  }
  or(option) {
    return ZodUnion.create([this, option], this._def);
  }
  and(incoming) {
    return ZodIntersection.create(this, incoming, this._def);
  }
  transform(transform) {
    return new ZodEffects({
      ...processCreateParams(this._def),
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "transform", transform }
    });
  }
  default(def) {
    const defaultValueFunc = typeof def === "function" ? def : () => def;
    return new ZodDefault({
      ...processCreateParams(this._def),
      innerType: this,
      defaultValue: defaultValueFunc,
      typeName: ZodFirstPartyTypeKind.ZodDefault
    });
  }
  brand() {
    return new ZodBranded({
      typeName: ZodFirstPartyTypeKind.ZodBranded,
      type: this,
      ...processCreateParams(this._def)
    });
  }
  catch(def) {
    const catchValueFunc = typeof def === "function" ? def : () => def;
    return new ZodCatch({
      ...processCreateParams(this._def),
      innerType: this,
      catchValue: catchValueFunc,
      typeName: ZodFirstPartyTypeKind.ZodCatch
    });
  }
  describe(description) {
    const This = this.constructor;
    return new This({
      ...this._def,
      description
    });
  }
  pipe(target) {
    return ZodPipeline.create(this, target);
  }
  readonly() {
    return ZodReadonly.create(this);
  }
  isOptional() {
    return this.safeParse(void 0).success;
  }
  isNullable() {
    return this.safeParse(null).success;
  }
};
var cuidRegex = /^c[^\s-]{8,}$/i;
var cuid2Regex = /^[0-9a-z]+$/;
var ulidRegex = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
var uuidRegex = /^[0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12}$/i;
var nanoidRegex = /^[a-z0-9_-]{21}$/i;
var jwtRegex = /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*$/;
var durationRegex = /^[-+]?P(?!$)(?:(?:[-+]?\d+Y)|(?:[-+]?\d+[.,]\d+Y$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:(?:[-+]?\d+W)|(?:[-+]?\d+[.,]\d+W$))?(?:(?:[-+]?\d+D)|(?:[-+]?\d+[.,]\d+D$))?(?:T(?=[\d+-])(?:(?:[-+]?\d+H)|(?:[-+]?\d+[.,]\d+H$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:[-+]?\d+(?:[.,]\d+)?S)?)??$/;
var emailRegex = /^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-\.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9\-]*\.)+[A-Z]{2,}$/i;
var _emojiRegex = `^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$`;
var emojiRegex;
var ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
var ipv4CidrRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/(3[0-2]|[12]?[0-9])$/;
var ipv6Regex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;
var ipv6CidrRegex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
var base64Regex = /^([0-9a-zA-Z+/]{4})*(([0-9a-zA-Z+/]{2}==)|([0-9a-zA-Z+/]{3}=))?$/;
var base64urlRegex = /^([0-9a-zA-Z-_]{4})*(([0-9a-zA-Z-_]{2}(==)?)|([0-9a-zA-Z-_]{3}(=)?))?$/;
var dateRegexSource = `((\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-((0[13578]|1[02])-(0[1-9]|[12]\\d|3[01])|(0[469]|11)-(0[1-9]|[12]\\d|30)|(02)-(0[1-9]|1\\d|2[0-8])))`;
var dateRegex = new RegExp(`^${dateRegexSource}$`);
function timeRegexSource(args) {
  let secondsRegexSource = `[0-5]\\d`;
  if (args.precision) {
    secondsRegexSource = `${secondsRegexSource}\\.\\d{${args.precision}}`;
  } else if (args.precision == null) {
    secondsRegexSource = `${secondsRegexSource}(\\.\\d+)?`;
  }
  const secondsQuantifier = args.precision ? "+" : "?";
  return `([01]\\d|2[0-3]):[0-5]\\d(:${secondsRegexSource})${secondsQuantifier}`;
}
function timeRegex(args) {
  return new RegExp(`^${timeRegexSource(args)}$`);
}
function datetimeRegex(args) {
  let regex = `${dateRegexSource}T${timeRegexSource(args)}`;
  const opts = [];
  opts.push(args.local ? `Z?` : `Z`);
  if (args.offset)
    opts.push(`([+-]\\d{2}:?\\d{2})`);
  regex = `${regex}(${opts.join("|")})`;
  return new RegExp(`^${regex}$`);
}
function isValidIP(ip, version) {
  if ((version === "v4" || !version) && ipv4Regex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6Regex.test(ip)) {
    return true;
  }
  return false;
}
function isValidJWT(jwt, alg) {
  if (!jwtRegex.test(jwt))
    return false;
  try {
    const [header] = jwt.split(".");
    if (!header)
      return false;
    const base64 = header.replace(/-/g, "+").replace(/_/g, "/").padEnd(header.length + (4 - header.length % 4) % 4, "=");
    const decoded = JSON.parse(atob(base64));
    if (typeof decoded !== "object" || decoded === null)
      return false;
    if ("typ" in decoded && decoded?.typ !== "JWT")
      return false;
    if (!decoded.alg)
      return false;
    if (alg && decoded.alg !== alg)
      return false;
    return true;
  } catch {
    return false;
  }
}
function isValidCidr(ip, version) {
  if ((version === "v4" || !version) && ipv4CidrRegex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6CidrRegex.test(ip)) {
    return true;
  }
  return false;
}
var ZodString = class _ZodString extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = String(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.string) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.string,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    const status = new ParseStatus();
    let ctx = void 0;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        if (input.data.length < check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        if (input.data.length > check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "length") {
        const tooBig = input.data.length > check.value;
        const tooSmall = input.data.length < check.value;
        if (tooBig || tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          if (tooBig) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_big,
              maximum: check.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check.message
            });
          } else if (tooSmall) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_small,
              minimum: check.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check.message
            });
          }
          status.dirty();
        }
      } else if (check.kind === "email") {
        if (!emailRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "email",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "emoji") {
        if (!emojiRegex) {
          emojiRegex = new RegExp(_emojiRegex, "u");
        }
        if (!emojiRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "emoji",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "uuid") {
        if (!uuidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "uuid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "nanoid") {
        if (!nanoidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "nanoid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cuid") {
        if (!cuidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cuid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cuid2") {
        if (!cuid2Regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cuid2",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "ulid") {
        if (!ulidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "ulid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "url") {
        try {
          new URL(input.data);
        } catch {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "url",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "regex") {
        check.regex.lastIndex = 0;
        const testResult = check.regex.test(input.data);
        if (!testResult) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "regex",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "trim") {
        input.data = input.data.trim();
      } else if (check.kind === "includes") {
        if (!input.data.includes(check.value, check.position)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { includes: check.value, position: check.position },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "toLowerCase") {
        input.data = input.data.toLowerCase();
      } else if (check.kind === "toUpperCase") {
        input.data = input.data.toUpperCase();
      } else if (check.kind === "startsWith") {
        if (!input.data.startsWith(check.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { startsWith: check.value },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "endsWith") {
        if (!input.data.endsWith(check.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { endsWith: check.value },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "datetime") {
        const regex = datetimeRegex(check);
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "datetime",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "date") {
        const regex = dateRegex;
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "date",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "time") {
        const regex = timeRegex(check);
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "time",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "duration") {
        if (!durationRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "duration",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "ip") {
        if (!isValidIP(input.data, check.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "ip",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "jwt") {
        if (!isValidJWT(input.data, check.alg)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "jwt",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cidr") {
        if (!isValidCidr(input.data, check.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cidr",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "base64") {
        if (!base64Regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "base64",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "base64url") {
        if (!base64urlRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "base64url",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  _regex(regex, validation, message) {
    return this.refinement((data) => regex.test(data), {
      validation,
      code: ZodIssueCode.invalid_string,
      ...errorUtil.errToObj(message)
    });
  }
  _addCheck(check) {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  email(message) {
    return this._addCheck({ kind: "email", ...errorUtil.errToObj(message) });
  }
  url(message) {
    return this._addCheck({ kind: "url", ...errorUtil.errToObj(message) });
  }
  emoji(message) {
    return this._addCheck({ kind: "emoji", ...errorUtil.errToObj(message) });
  }
  uuid(message) {
    return this._addCheck({ kind: "uuid", ...errorUtil.errToObj(message) });
  }
  nanoid(message) {
    return this._addCheck({ kind: "nanoid", ...errorUtil.errToObj(message) });
  }
  cuid(message) {
    return this._addCheck({ kind: "cuid", ...errorUtil.errToObj(message) });
  }
  cuid2(message) {
    return this._addCheck({ kind: "cuid2", ...errorUtil.errToObj(message) });
  }
  ulid(message) {
    return this._addCheck({ kind: "ulid", ...errorUtil.errToObj(message) });
  }
  base64(message) {
    return this._addCheck({ kind: "base64", ...errorUtil.errToObj(message) });
  }
  base64url(message) {
    return this._addCheck({
      kind: "base64url",
      ...errorUtil.errToObj(message)
    });
  }
  jwt(options) {
    return this._addCheck({ kind: "jwt", ...errorUtil.errToObj(options) });
  }
  ip(options) {
    return this._addCheck({ kind: "ip", ...errorUtil.errToObj(options) });
  }
  cidr(options) {
    return this._addCheck({ kind: "cidr", ...errorUtil.errToObj(options) });
  }
  datetime(options) {
    if (typeof options === "string") {
      return this._addCheck({
        kind: "datetime",
        precision: null,
        offset: false,
        local: false,
        message: options
      });
    }
    return this._addCheck({
      kind: "datetime",
      precision: typeof options?.precision === "undefined" ? null : options?.precision,
      offset: options?.offset ?? false,
      local: options?.local ?? false,
      ...errorUtil.errToObj(options?.message)
    });
  }
  date(message) {
    return this._addCheck({ kind: "date", message });
  }
  time(options) {
    if (typeof options === "string") {
      return this._addCheck({
        kind: "time",
        precision: null,
        message: options
      });
    }
    return this._addCheck({
      kind: "time",
      precision: typeof options?.precision === "undefined" ? null : options?.precision,
      ...errorUtil.errToObj(options?.message)
    });
  }
  duration(message) {
    return this._addCheck({ kind: "duration", ...errorUtil.errToObj(message) });
  }
  regex(regex, message) {
    return this._addCheck({
      kind: "regex",
      regex,
      ...errorUtil.errToObj(message)
    });
  }
  includes(value, options) {
    return this._addCheck({
      kind: "includes",
      value,
      position: options?.position,
      ...errorUtil.errToObj(options?.message)
    });
  }
  startsWith(value, message) {
    return this._addCheck({
      kind: "startsWith",
      value,
      ...errorUtil.errToObj(message)
    });
  }
  endsWith(value, message) {
    return this._addCheck({
      kind: "endsWith",
      value,
      ...errorUtil.errToObj(message)
    });
  }
  min(minLength, message) {
    return this._addCheck({
      kind: "min",
      value: minLength,
      ...errorUtil.errToObj(message)
    });
  }
  max(maxLength, message) {
    return this._addCheck({
      kind: "max",
      value: maxLength,
      ...errorUtil.errToObj(message)
    });
  }
  length(len, message) {
    return this._addCheck({
      kind: "length",
      value: len,
      ...errorUtil.errToObj(message)
    });
  }
  /**
   * Equivalent to `.min(1)`
   */
  nonempty(message) {
    return this.min(1, errorUtil.errToObj(message));
  }
  trim() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "trim" }]
    });
  }
  toLowerCase() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "toLowerCase" }]
    });
  }
  toUpperCase() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "toUpperCase" }]
    });
  }
  get isDatetime() {
    return !!this._def.checks.find((ch) => ch.kind === "datetime");
  }
  get isDate() {
    return !!this._def.checks.find((ch) => ch.kind === "date");
  }
  get isTime() {
    return !!this._def.checks.find((ch) => ch.kind === "time");
  }
  get isDuration() {
    return !!this._def.checks.find((ch) => ch.kind === "duration");
  }
  get isEmail() {
    return !!this._def.checks.find((ch) => ch.kind === "email");
  }
  get isURL() {
    return !!this._def.checks.find((ch) => ch.kind === "url");
  }
  get isEmoji() {
    return !!this._def.checks.find((ch) => ch.kind === "emoji");
  }
  get isUUID() {
    return !!this._def.checks.find((ch) => ch.kind === "uuid");
  }
  get isNANOID() {
    return !!this._def.checks.find((ch) => ch.kind === "nanoid");
  }
  get isCUID() {
    return !!this._def.checks.find((ch) => ch.kind === "cuid");
  }
  get isCUID2() {
    return !!this._def.checks.find((ch) => ch.kind === "cuid2");
  }
  get isULID() {
    return !!this._def.checks.find((ch) => ch.kind === "ulid");
  }
  get isIP() {
    return !!this._def.checks.find((ch) => ch.kind === "ip");
  }
  get isCIDR() {
    return !!this._def.checks.find((ch) => ch.kind === "cidr");
  }
  get isBase64() {
    return !!this._def.checks.find((ch) => ch.kind === "base64");
  }
  get isBase64url() {
    return !!this._def.checks.find((ch) => ch.kind === "base64url");
  }
  get minLength() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxLength() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
};
ZodString.create = (params) => {
  return new ZodString({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodString,
    coerce: params?.coerce ?? false,
    ...processCreateParams(params)
  });
};
function floatSafeRemainder(val, step) {
  const valDecCount = (val.toString().split(".")[1] || "").length;
  const stepDecCount = (step.toString().split(".")[1] || "").length;
  const decCount = valDecCount > stepDecCount ? valDecCount : stepDecCount;
  const valInt = Number.parseInt(val.toFixed(decCount).replace(".", ""));
  const stepInt = Number.parseInt(step.toFixed(decCount).replace(".", ""));
  return valInt % stepInt / 10 ** decCount;
}
var ZodNumber = class _ZodNumber extends ZodType {
  constructor() {
    super(...arguments);
    this.min = this.gte;
    this.max = this.lte;
    this.step = this.multipleOf;
  }
  _parse(input) {
    if (this._def.coerce) {
      input.data = Number(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.number) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.number,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    let ctx = void 0;
    const status = new ParseStatus();
    for (const check of this._def.checks) {
      if (check.kind === "int") {
        if (!util.isInteger(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_type,
            expected: "integer",
            received: "float",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "min") {
        const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check.value,
            type: "number",
            inclusive: check.inclusive,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check.value,
            type: "number",
            inclusive: check.inclusive,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "multipleOf") {
        if (floatSafeRemainder(input.data, check.value) !== 0) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check.value,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "finite") {
        if (!Number.isFinite(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_finite,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil.toString(message));
  }
  setLimit(kind, value, inclusive, message) {
    return new _ZodNumber({
      ...this._def,
      checks: [
        ...this._def.checks,
        {
          kind,
          value,
          inclusive,
          message: errorUtil.toString(message)
        }
      ]
    });
  }
  _addCheck(check) {
    return new _ZodNumber({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  int(message) {
    return this._addCheck({
      kind: "int",
      message: errorUtil.toString(message)
    });
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil.toString(message)
    });
  }
  finite(message) {
    return this._addCheck({
      kind: "finite",
      message: errorUtil.toString(message)
    });
  }
  safe(message) {
    return this._addCheck({
      kind: "min",
      inclusive: true,
      value: Number.MIN_SAFE_INTEGER,
      message: errorUtil.toString(message)
    })._addCheck({
      kind: "max",
      inclusive: true,
      value: Number.MAX_SAFE_INTEGER,
      message: errorUtil.toString(message)
    });
  }
  get minValue() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxValue() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
  get isInt() {
    return !!this._def.checks.find((ch) => ch.kind === "int" || ch.kind === "multipleOf" && util.isInteger(ch.value));
  }
  get isFinite() {
    let max = null;
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "finite" || ch.kind === "int" || ch.kind === "multipleOf") {
        return true;
      } else if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      } else if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return Number.isFinite(min) && Number.isFinite(max);
  }
};
ZodNumber.create = (params) => {
  return new ZodNumber({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodNumber,
    coerce: params?.coerce || false,
    ...processCreateParams(params)
  });
};
var ZodBigInt = class _ZodBigInt extends ZodType {
  constructor() {
    super(...arguments);
    this.min = this.gte;
    this.max = this.lte;
  }
  _parse(input) {
    if (this._def.coerce) {
      try {
        input.data = BigInt(input.data);
      } catch {
        return this._getInvalidInput(input);
      }
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.bigint) {
      return this._getInvalidInput(input);
    }
    let ctx = void 0;
    const status = new ParseStatus();
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            type: "bigint",
            minimum: check.value,
            inclusive: check.inclusive,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            type: "bigint",
            maximum: check.value,
            inclusive: check.inclusive,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "multipleOf") {
        if (input.data % check.value !== BigInt(0)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check.value,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  _getInvalidInput(input) {
    const ctx = this._getOrReturnCtx(input);
    addIssueToContext(ctx, {
      code: ZodIssueCode.invalid_type,
      expected: ZodParsedType.bigint,
      received: ctx.parsedType
    });
    return INVALID;
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil.toString(message));
  }
  setLimit(kind, value, inclusive, message) {
    return new _ZodBigInt({
      ...this._def,
      checks: [
        ...this._def.checks,
        {
          kind,
          value,
          inclusive,
          message: errorUtil.toString(message)
        }
      ]
    });
  }
  _addCheck(check) {
    return new _ZodBigInt({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil.toString(message)
    });
  }
  get minValue() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxValue() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
};
ZodBigInt.create = (params) => {
  return new ZodBigInt({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodBigInt,
    coerce: params?.coerce ?? false,
    ...processCreateParams(params)
  });
};
var ZodBoolean = class extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = Boolean(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.boolean) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.boolean,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodBoolean.create = (params) => {
  return new ZodBoolean({
    typeName: ZodFirstPartyTypeKind.ZodBoolean,
    coerce: params?.coerce || false,
    ...processCreateParams(params)
  });
};
var ZodDate = class _ZodDate extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = new Date(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.date) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.date,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    if (Number.isNaN(input.data.getTime())) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_date
      });
      return INVALID;
    }
    const status = new ParseStatus();
    let ctx = void 0;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        if (input.data.getTime() < check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            message: check.message,
            inclusive: true,
            exact: false,
            minimum: check.value,
            type: "date"
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        if (input.data.getTime() > check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            message: check.message,
            inclusive: true,
            exact: false,
            maximum: check.value,
            type: "date"
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return {
      status: status.value,
      value: new Date(input.data.getTime())
    };
  }
  _addCheck(check) {
    return new _ZodDate({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  min(minDate, message) {
    return this._addCheck({
      kind: "min",
      value: minDate.getTime(),
      message: errorUtil.toString(message)
    });
  }
  max(maxDate, message) {
    return this._addCheck({
      kind: "max",
      value: maxDate.getTime(),
      message: errorUtil.toString(message)
    });
  }
  get minDate() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min != null ? new Date(min) : null;
  }
  get maxDate() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max != null ? new Date(max) : null;
  }
};
ZodDate.create = (params) => {
  return new ZodDate({
    checks: [],
    coerce: params?.coerce || false,
    typeName: ZodFirstPartyTypeKind.ZodDate,
    ...processCreateParams(params)
  });
};
var ZodSymbol = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.symbol) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.symbol,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodSymbol.create = (params) => {
  return new ZodSymbol({
    typeName: ZodFirstPartyTypeKind.ZodSymbol,
    ...processCreateParams(params)
  });
};
var ZodUndefined = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.undefined) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.undefined,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodUndefined.create = (params) => {
  return new ZodUndefined({
    typeName: ZodFirstPartyTypeKind.ZodUndefined,
    ...processCreateParams(params)
  });
};
var ZodNull = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.null) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.null,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodNull.create = (params) => {
  return new ZodNull({
    typeName: ZodFirstPartyTypeKind.ZodNull,
    ...processCreateParams(params)
  });
};
var ZodAny = class extends ZodType {
  constructor() {
    super(...arguments);
    this._any = true;
  }
  _parse(input) {
    return OK(input.data);
  }
};
ZodAny.create = (params) => {
  return new ZodAny({
    typeName: ZodFirstPartyTypeKind.ZodAny,
    ...processCreateParams(params)
  });
};
var ZodUnknown = class extends ZodType {
  constructor() {
    super(...arguments);
    this._unknown = true;
  }
  _parse(input) {
    return OK(input.data);
  }
};
ZodUnknown.create = (params) => {
  return new ZodUnknown({
    typeName: ZodFirstPartyTypeKind.ZodUnknown,
    ...processCreateParams(params)
  });
};
var ZodNever = class extends ZodType {
  _parse(input) {
    const ctx = this._getOrReturnCtx(input);
    addIssueToContext(ctx, {
      code: ZodIssueCode.invalid_type,
      expected: ZodParsedType.never,
      received: ctx.parsedType
    });
    return INVALID;
  }
};
ZodNever.create = (params) => {
  return new ZodNever({
    typeName: ZodFirstPartyTypeKind.ZodNever,
    ...processCreateParams(params)
  });
};
var ZodVoid = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.undefined) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.void,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodVoid.create = (params) => {
  return new ZodVoid({
    typeName: ZodFirstPartyTypeKind.ZodVoid,
    ...processCreateParams(params)
  });
};
var ZodArray = class _ZodArray extends ZodType {
  _parse(input) {
    const { ctx, status } = this._processInputParams(input);
    const def = this._def;
    if (ctx.parsedType !== ZodParsedType.array) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.array,
        received: ctx.parsedType
      });
      return INVALID;
    }
    if (def.exactLength !== null) {
      const tooBig = ctx.data.length > def.exactLength.value;
      const tooSmall = ctx.data.length < def.exactLength.value;
      if (tooBig || tooSmall) {
        addIssueToContext(ctx, {
          code: tooBig ? ZodIssueCode.too_big : ZodIssueCode.too_small,
          minimum: tooSmall ? def.exactLength.value : void 0,
          maximum: tooBig ? def.exactLength.value : void 0,
          type: "array",
          inclusive: true,
          exact: true,
          message: def.exactLength.message
        });
        status.dirty();
      }
    }
    if (def.minLength !== null) {
      if (ctx.data.length < def.minLength.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_small,
          minimum: def.minLength.value,
          type: "array",
          inclusive: true,
          exact: false,
          message: def.minLength.message
        });
        status.dirty();
      }
    }
    if (def.maxLength !== null) {
      if (ctx.data.length > def.maxLength.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_big,
          maximum: def.maxLength.value,
          type: "array",
          inclusive: true,
          exact: false,
          message: def.maxLength.message
        });
        status.dirty();
      }
    }
    if (ctx.common.async) {
      return Promise.all([...ctx.data].map((item, i) => {
        return def.type._parseAsync(new ParseInputLazyPath(ctx, item, ctx.path, i));
      })).then((result2) => {
        return ParseStatus.mergeArray(status, result2);
      });
    }
    const result = [...ctx.data].map((item, i) => {
      return def.type._parseSync(new ParseInputLazyPath(ctx, item, ctx.path, i));
    });
    return ParseStatus.mergeArray(status, result);
  }
  get element() {
    return this._def.type;
  }
  min(minLength, message) {
    return new _ZodArray({
      ...this._def,
      minLength: { value: minLength, message: errorUtil.toString(message) }
    });
  }
  max(maxLength, message) {
    return new _ZodArray({
      ...this._def,
      maxLength: { value: maxLength, message: errorUtil.toString(message) }
    });
  }
  length(len, message) {
    return new _ZodArray({
      ...this._def,
      exactLength: { value: len, message: errorUtil.toString(message) }
    });
  }
  nonempty(message) {
    return this.min(1, message);
  }
};
ZodArray.create = (schema, params) => {
  return new ZodArray({
    type: schema,
    minLength: null,
    maxLength: null,
    exactLength: null,
    typeName: ZodFirstPartyTypeKind.ZodArray,
    ...processCreateParams(params)
  });
};
function deepPartialify(schema) {
  if (schema instanceof ZodObject) {
    const newShape = {};
    for (const key in schema.shape) {
      const fieldSchema = schema.shape[key];
      newShape[key] = ZodOptional.create(deepPartialify(fieldSchema));
    }
    return new ZodObject({
      ...schema._def,
      shape: () => newShape
    });
  } else if (schema instanceof ZodArray) {
    return new ZodArray({
      ...schema._def,
      type: deepPartialify(schema.element)
    });
  } else if (schema instanceof ZodOptional) {
    return ZodOptional.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodNullable) {
    return ZodNullable.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodTuple) {
    return ZodTuple.create(schema.items.map((item) => deepPartialify(item)));
  } else {
    return schema;
  }
}
var ZodObject = class _ZodObject extends ZodType {
  constructor() {
    super(...arguments);
    this._cached = null;
    this.nonstrict = this.passthrough;
    this.augment = this.extend;
  }
  _getCached() {
    if (this._cached !== null)
      return this._cached;
    const shape = this._def.shape();
    const keys = util.objectKeys(shape);
    this._cached = { shape, keys };
    return this._cached;
  }
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.object) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    const { status, ctx } = this._processInputParams(input);
    const { shape, keys: shapeKeys } = this._getCached();
    const extraKeys = [];
    if (!(this._def.catchall instanceof ZodNever && this._def.unknownKeys === "strip")) {
      for (const key in ctx.data) {
        if (!shapeKeys.includes(key)) {
          extraKeys.push(key);
        }
      }
    }
    const pairs = [];
    for (const key of shapeKeys) {
      const keyValidator = shape[key];
      const value = ctx.data[key];
      pairs.push({
        key: { status: "valid", value: key },
        value: keyValidator._parse(new ParseInputLazyPath(ctx, value, ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (this._def.catchall instanceof ZodNever) {
      const unknownKeys = this._def.unknownKeys;
      if (unknownKeys === "passthrough") {
        for (const key of extraKeys) {
          pairs.push({
            key: { status: "valid", value: key },
            value: { status: "valid", value: ctx.data[key] }
          });
        }
      } else if (unknownKeys === "strict") {
        if (extraKeys.length > 0) {
          addIssueToContext(ctx, {
            code: ZodIssueCode.unrecognized_keys,
            keys: extraKeys
          });
          status.dirty();
        }
      } else if (unknownKeys === "strip") {
      } else {
        throw new Error(`Internal ZodObject error: invalid unknownKeys value.`);
      }
    } else {
      const catchall = this._def.catchall;
      for (const key of extraKeys) {
        const value = ctx.data[key];
        pairs.push({
          key: { status: "valid", value: key },
          value: catchall._parse(
            new ParseInputLazyPath(ctx, value, ctx.path, key)
            //, ctx.child(key), value, getParsedType(value)
          ),
          alwaysSet: key in ctx.data
        });
      }
    }
    if (ctx.common.async) {
      return Promise.resolve().then(async () => {
        const syncPairs = [];
        for (const pair of pairs) {
          const key = await pair.key;
          const value = await pair.value;
          syncPairs.push({
            key,
            value,
            alwaysSet: pair.alwaysSet
          });
        }
        return syncPairs;
      }).then((syncPairs) => {
        return ParseStatus.mergeObjectSync(status, syncPairs);
      });
    } else {
      return ParseStatus.mergeObjectSync(status, pairs);
    }
  }
  get shape() {
    return this._def.shape();
  }
  strict(message) {
    errorUtil.errToObj;
    return new _ZodObject({
      ...this._def,
      unknownKeys: "strict",
      ...message !== void 0 ? {
        errorMap: (issue, ctx) => {
          const defaultError = this._def.errorMap?.(issue, ctx).message ?? ctx.defaultError;
          if (issue.code === "unrecognized_keys")
            return {
              message: errorUtil.errToObj(message).message ?? defaultError
            };
          return {
            message: defaultError
          };
        }
      } : {}
    });
  }
  strip() {
    return new _ZodObject({
      ...this._def,
      unknownKeys: "strip"
    });
  }
  passthrough() {
    return new _ZodObject({
      ...this._def,
      unknownKeys: "passthrough"
    });
  }
  // const AugmentFactory =
  //   <Def extends ZodObjectDef>(def: Def) =>
  //   <Augmentation extends ZodRawShape>(
  //     augmentation: Augmentation
  //   ): ZodObject<
  //     extendShape<ReturnType<Def["shape"]>, Augmentation>,
  //     Def["unknownKeys"],
  //     Def["catchall"]
  //   > => {
  //     return new ZodObject({
  //       ...def,
  //       shape: () => ({
  //         ...def.shape(),
  //         ...augmentation,
  //       }),
  //     }) as any;
  //   };
  extend(augmentation) {
    return new _ZodObject({
      ...this._def,
      shape: () => ({
        ...this._def.shape(),
        ...augmentation
      })
    });
  }
  /**
   * Prior to zod@1.0.12 there was a bug in the
   * inferred type of merged objects. Please
   * upgrade if you are experiencing issues.
   */
  merge(merging) {
    const merged = new _ZodObject({
      unknownKeys: merging._def.unknownKeys,
      catchall: merging._def.catchall,
      shape: () => ({
        ...this._def.shape(),
        ...merging._def.shape()
      }),
      typeName: ZodFirstPartyTypeKind.ZodObject
    });
    return merged;
  }
  // merge<
  //   Incoming extends AnyZodObject,
  //   Augmentation extends Incoming["shape"],
  //   NewOutput extends {
  //     [k in keyof Augmentation | keyof Output]: k extends keyof Augmentation
  //       ? Augmentation[k]["_output"]
  //       : k extends keyof Output
  //       ? Output[k]
  //       : never;
  //   },
  //   NewInput extends {
  //     [k in keyof Augmentation | keyof Input]: k extends keyof Augmentation
  //       ? Augmentation[k]["_input"]
  //       : k extends keyof Input
  //       ? Input[k]
  //       : never;
  //   }
  // >(
  //   merging: Incoming
  // ): ZodObject<
  //   extendShape<T, ReturnType<Incoming["_def"]["shape"]>>,
  //   Incoming["_def"]["unknownKeys"],
  //   Incoming["_def"]["catchall"],
  //   NewOutput,
  //   NewInput
  // > {
  //   const merged: any = new ZodObject({
  //     unknownKeys: merging._def.unknownKeys,
  //     catchall: merging._def.catchall,
  //     shape: () =>
  //       objectUtil.mergeShapes(this._def.shape(), merging._def.shape()),
  //     typeName: ZodFirstPartyTypeKind.ZodObject,
  //   }) as any;
  //   return merged;
  // }
  setKey(key, schema) {
    return this.augment({ [key]: schema });
  }
  // merge<Incoming extends AnyZodObject>(
  //   merging: Incoming
  // ): //ZodObject<T & Incoming["_shape"], UnknownKeys, Catchall> = (merging) => {
  // ZodObject<
  //   extendShape<T, ReturnType<Incoming["_def"]["shape"]>>,
  //   Incoming["_def"]["unknownKeys"],
  //   Incoming["_def"]["catchall"]
  // > {
  //   // const mergedShape = objectUtil.mergeShapes(
  //   //   this._def.shape(),
  //   //   merging._def.shape()
  //   // );
  //   const merged: any = new ZodObject({
  //     unknownKeys: merging._def.unknownKeys,
  //     catchall: merging._def.catchall,
  //     shape: () =>
  //       objectUtil.mergeShapes(this._def.shape(), merging._def.shape()),
  //     typeName: ZodFirstPartyTypeKind.ZodObject,
  //   }) as any;
  //   return merged;
  // }
  catchall(index) {
    return new _ZodObject({
      ...this._def,
      catchall: index
    });
  }
  pick(mask) {
    const shape = {};
    for (const key of util.objectKeys(mask)) {
      if (mask[key] && this.shape[key]) {
        shape[key] = this.shape[key];
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => shape
    });
  }
  omit(mask) {
    const shape = {};
    for (const key of util.objectKeys(this.shape)) {
      if (!mask[key]) {
        shape[key] = this.shape[key];
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => shape
    });
  }
  /**
   * @deprecated
   */
  deepPartial() {
    return deepPartialify(this);
  }
  partial(mask) {
    const newShape = {};
    for (const key of util.objectKeys(this.shape)) {
      const fieldSchema = this.shape[key];
      if (mask && !mask[key]) {
        newShape[key] = fieldSchema;
      } else {
        newShape[key] = fieldSchema.optional();
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => newShape
    });
  }
  required(mask) {
    const newShape = {};
    for (const key of util.objectKeys(this.shape)) {
      if (mask && !mask[key]) {
        newShape[key] = this.shape[key];
      } else {
        const fieldSchema = this.shape[key];
        let newField = fieldSchema;
        while (newField instanceof ZodOptional) {
          newField = newField._def.innerType;
        }
        newShape[key] = newField;
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => newShape
    });
  }
  keyof() {
    return createZodEnum(util.objectKeys(this.shape));
  }
};
ZodObject.create = (shape, params) => {
  return new ZodObject({
    shape: () => shape,
    unknownKeys: "strip",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
ZodObject.strictCreate = (shape, params) => {
  return new ZodObject({
    shape: () => shape,
    unknownKeys: "strict",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
ZodObject.lazycreate = (shape, params) => {
  return new ZodObject({
    shape,
    unknownKeys: "strip",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
var ZodUnion = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const options = this._def.options;
    function handleResults(results) {
      for (const result of results) {
        if (result.result.status === "valid") {
          return result.result;
        }
      }
      for (const result of results) {
        if (result.result.status === "dirty") {
          ctx.common.issues.push(...result.ctx.common.issues);
          return result.result;
        }
      }
      const unionErrors = results.map((result) => new ZodError(result.ctx.common.issues));
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union,
        unionErrors
      });
      return INVALID;
    }
    if (ctx.common.async) {
      return Promise.all(options.map(async (option) => {
        const childCtx = {
          ...ctx,
          common: {
            ...ctx.common,
            issues: []
          },
          parent: null
        };
        return {
          result: await option._parseAsync({
            data: ctx.data,
            path: ctx.path,
            parent: childCtx
          }),
          ctx: childCtx
        };
      })).then(handleResults);
    } else {
      let dirty = void 0;
      const issues = [];
      for (const option of options) {
        const childCtx = {
          ...ctx,
          common: {
            ...ctx.common,
            issues: []
          },
          parent: null
        };
        const result = option._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: childCtx
        });
        if (result.status === "valid") {
          return result;
        } else if (result.status === "dirty" && !dirty) {
          dirty = { result, ctx: childCtx };
        }
        if (childCtx.common.issues.length) {
          issues.push(childCtx.common.issues);
        }
      }
      if (dirty) {
        ctx.common.issues.push(...dirty.ctx.common.issues);
        return dirty.result;
      }
      const unionErrors = issues.map((issues2) => new ZodError(issues2));
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union,
        unionErrors
      });
      return INVALID;
    }
  }
  get options() {
    return this._def.options;
  }
};
ZodUnion.create = (types, params) => {
  return new ZodUnion({
    options: types,
    typeName: ZodFirstPartyTypeKind.ZodUnion,
    ...processCreateParams(params)
  });
};
var getDiscriminator = (type) => {
  if (type instanceof ZodLazy) {
    return getDiscriminator(type.schema);
  } else if (type instanceof ZodEffects) {
    return getDiscriminator(type.innerType());
  } else if (type instanceof ZodLiteral) {
    return [type.value];
  } else if (type instanceof ZodEnum) {
    return type.options;
  } else if (type instanceof ZodNativeEnum) {
    return util.objectValues(type.enum);
  } else if (type instanceof ZodDefault) {
    return getDiscriminator(type._def.innerType);
  } else if (type instanceof ZodUndefined) {
    return [void 0];
  } else if (type instanceof ZodNull) {
    return [null];
  } else if (type instanceof ZodOptional) {
    return [void 0, ...getDiscriminator(type.unwrap())];
  } else if (type instanceof ZodNullable) {
    return [null, ...getDiscriminator(type.unwrap())];
  } else if (type instanceof ZodBranded) {
    return getDiscriminator(type.unwrap());
  } else if (type instanceof ZodReadonly) {
    return getDiscriminator(type.unwrap());
  } else if (type instanceof ZodCatch) {
    return getDiscriminator(type._def.innerType);
  } else {
    return [];
  }
};
var ZodDiscriminatedUnion = class _ZodDiscriminatedUnion extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.object) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const discriminator = this.discriminator;
    const discriminatorValue = ctx.data[discriminator];
    const option = this.optionsMap.get(discriminatorValue);
    if (!option) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union_discriminator,
        options: Array.from(this.optionsMap.keys()),
        path: [discriminator]
      });
      return INVALID;
    }
    if (ctx.common.async) {
      return option._parseAsync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
    } else {
      return option._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
    }
  }
  get discriminator() {
    return this._def.discriminator;
  }
  get options() {
    return this._def.options;
  }
  get optionsMap() {
    return this._def.optionsMap;
  }
  /**
   * The constructor of the discriminated union schema. Its behaviour is very similar to that of the normal z.union() constructor.
   * However, it only allows a union of objects, all of which need to share a discriminator property. This property must
   * have a different value for each object in the union.
   * @param discriminator the name of the discriminator property
   * @param types an array of object schemas
   * @param params
   */
  static create(discriminator, options, params) {
    const optionsMap = /* @__PURE__ */ new Map();
    for (const type of options) {
      const discriminatorValues = getDiscriminator(type.shape[discriminator]);
      if (!discriminatorValues.length) {
        throw new Error(`A discriminator value for key \`${discriminator}\` could not be extracted from all schema options`);
      }
      for (const value of discriminatorValues) {
        if (optionsMap.has(value)) {
          throw new Error(`Discriminator property ${String(discriminator)} has duplicate value ${String(value)}`);
        }
        optionsMap.set(value, type);
      }
    }
    return new _ZodDiscriminatedUnion({
      typeName: ZodFirstPartyTypeKind.ZodDiscriminatedUnion,
      discriminator,
      options,
      optionsMap,
      ...processCreateParams(params)
    });
  }
};
function mergeValues(a, b) {
  const aType = getParsedType(a);
  const bType = getParsedType(b);
  if (a === b) {
    return { valid: true, data: a };
  } else if (aType === ZodParsedType.object && bType === ZodParsedType.object) {
    const bKeys = util.objectKeys(b);
    const sharedKeys = util.objectKeys(a).filter((key) => bKeys.indexOf(key) !== -1);
    const newObj = { ...a, ...b };
    for (const key of sharedKeys) {
      const sharedValue = mergeValues(a[key], b[key]);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newObj[key] = sharedValue.data;
    }
    return { valid: true, data: newObj };
  } else if (aType === ZodParsedType.array && bType === ZodParsedType.array) {
    if (a.length !== b.length) {
      return { valid: false };
    }
    const newArray = [];
    for (let index = 0; index < a.length; index++) {
      const itemA = a[index];
      const itemB = b[index];
      const sharedValue = mergeValues(itemA, itemB);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newArray.push(sharedValue.data);
    }
    return { valid: true, data: newArray };
  } else if (aType === ZodParsedType.date && bType === ZodParsedType.date && +a === +b) {
    return { valid: true, data: a };
  } else {
    return { valid: false };
  }
}
var ZodIntersection = class extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    const handleParsed = (parsedLeft, parsedRight) => {
      if (isAborted(parsedLeft) || isAborted(parsedRight)) {
        return INVALID;
      }
      const merged = mergeValues(parsedLeft.value, parsedRight.value);
      if (!merged.valid) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.invalid_intersection_types
        });
        return INVALID;
      }
      if (isDirty(parsedLeft) || isDirty(parsedRight)) {
        status.dirty();
      }
      return { status: status.value, value: merged.data };
    };
    if (ctx.common.async) {
      return Promise.all([
        this._def.left._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        }),
        this._def.right._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        })
      ]).then(([left, right]) => handleParsed(left, right));
    } else {
      return handleParsed(this._def.left._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      }), this._def.right._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      }));
    }
  }
};
ZodIntersection.create = (left, right, params) => {
  return new ZodIntersection({
    left,
    right,
    typeName: ZodFirstPartyTypeKind.ZodIntersection,
    ...processCreateParams(params)
  });
};
var ZodTuple = class _ZodTuple extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.array) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.array,
        received: ctx.parsedType
      });
      return INVALID;
    }
    if (ctx.data.length < this._def.items.length) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.too_small,
        minimum: this._def.items.length,
        inclusive: true,
        exact: false,
        type: "array"
      });
      return INVALID;
    }
    const rest = this._def.rest;
    if (!rest && ctx.data.length > this._def.items.length) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.too_big,
        maximum: this._def.items.length,
        inclusive: true,
        exact: false,
        type: "array"
      });
      status.dirty();
    }
    const items = [...ctx.data].map((item, itemIndex) => {
      const schema = this._def.items[itemIndex] || this._def.rest;
      if (!schema)
        return null;
      return schema._parse(new ParseInputLazyPath(ctx, item, ctx.path, itemIndex));
    }).filter((x) => !!x);
    if (ctx.common.async) {
      return Promise.all(items).then((results) => {
        return ParseStatus.mergeArray(status, results);
      });
    } else {
      return ParseStatus.mergeArray(status, items);
    }
  }
  get items() {
    return this._def.items;
  }
  rest(rest) {
    return new _ZodTuple({
      ...this._def,
      rest
    });
  }
};
ZodTuple.create = (schemas, params) => {
  if (!Array.isArray(schemas)) {
    throw new Error("You must pass an array of schemas to z.tuple([ ... ])");
  }
  return new ZodTuple({
    items: schemas,
    typeName: ZodFirstPartyTypeKind.ZodTuple,
    rest: null,
    ...processCreateParams(params)
  });
};
var ZodRecord = class _ZodRecord extends ZodType {
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.object) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const pairs = [];
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    for (const key in ctx.data) {
      pairs.push({
        key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, key)),
        value: valueType._parse(new ParseInputLazyPath(ctx, ctx.data[key], ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (ctx.common.async) {
      return ParseStatus.mergeObjectAsync(status, pairs);
    } else {
      return ParseStatus.mergeObjectSync(status, pairs);
    }
  }
  get element() {
    return this._def.valueType;
  }
  static create(first, second, third) {
    if (second instanceof ZodType) {
      return new _ZodRecord({
        keyType: first,
        valueType: second,
        typeName: ZodFirstPartyTypeKind.ZodRecord,
        ...processCreateParams(third)
      });
    }
    return new _ZodRecord({
      keyType: ZodString.create(),
      valueType: first,
      typeName: ZodFirstPartyTypeKind.ZodRecord,
      ...processCreateParams(second)
    });
  }
};
var ZodMap = class extends ZodType {
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.map) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.map,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    const pairs = [...ctx.data.entries()].map(([key, value], index) => {
      return {
        key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, [index, "key"])),
        value: valueType._parse(new ParseInputLazyPath(ctx, value, ctx.path, [index, "value"]))
      };
    });
    if (ctx.common.async) {
      const finalMap = /* @__PURE__ */ new Map();
      return Promise.resolve().then(async () => {
        for (const pair of pairs) {
          const key = await pair.key;
          const value = await pair.value;
          if (key.status === "aborted" || value.status === "aborted") {
            return INVALID;
          }
          if (key.status === "dirty" || value.status === "dirty") {
            status.dirty();
          }
          finalMap.set(key.value, value.value);
        }
        return { status: status.value, value: finalMap };
      });
    } else {
      const finalMap = /* @__PURE__ */ new Map();
      for (const pair of pairs) {
        const key = pair.key;
        const value = pair.value;
        if (key.status === "aborted" || value.status === "aborted") {
          return INVALID;
        }
        if (key.status === "dirty" || value.status === "dirty") {
          status.dirty();
        }
        finalMap.set(key.value, value.value);
      }
      return { status: status.value, value: finalMap };
    }
  }
};
ZodMap.create = (keyType, valueType, params) => {
  return new ZodMap({
    valueType,
    keyType,
    typeName: ZodFirstPartyTypeKind.ZodMap,
    ...processCreateParams(params)
  });
};
var ZodSet = class _ZodSet extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.set) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.set,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const def = this._def;
    if (def.minSize !== null) {
      if (ctx.data.size < def.minSize.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_small,
          minimum: def.minSize.value,
          type: "set",
          inclusive: true,
          exact: false,
          message: def.minSize.message
        });
        status.dirty();
      }
    }
    if (def.maxSize !== null) {
      if (ctx.data.size > def.maxSize.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_big,
          maximum: def.maxSize.value,
          type: "set",
          inclusive: true,
          exact: false,
          message: def.maxSize.message
        });
        status.dirty();
      }
    }
    const valueType = this._def.valueType;
    function finalizeSet(elements2) {
      const parsedSet = /* @__PURE__ */ new Set();
      for (const element of elements2) {
        if (element.status === "aborted")
          return INVALID;
        if (element.status === "dirty")
          status.dirty();
        parsedSet.add(element.value);
      }
      return { status: status.value, value: parsedSet };
    }
    const elements = [...ctx.data.values()].map((item, i) => valueType._parse(new ParseInputLazyPath(ctx, item, ctx.path, i)));
    if (ctx.common.async) {
      return Promise.all(elements).then((elements2) => finalizeSet(elements2));
    } else {
      return finalizeSet(elements);
    }
  }
  min(minSize, message) {
    return new _ZodSet({
      ...this._def,
      minSize: { value: minSize, message: errorUtil.toString(message) }
    });
  }
  max(maxSize, message) {
    return new _ZodSet({
      ...this._def,
      maxSize: { value: maxSize, message: errorUtil.toString(message) }
    });
  }
  size(size, message) {
    return this.min(size, message).max(size, message);
  }
  nonempty(message) {
    return this.min(1, message);
  }
};
ZodSet.create = (valueType, params) => {
  return new ZodSet({
    valueType,
    minSize: null,
    maxSize: null,
    typeName: ZodFirstPartyTypeKind.ZodSet,
    ...processCreateParams(params)
  });
};
var ZodFunction = class _ZodFunction extends ZodType {
  constructor() {
    super(...arguments);
    this.validate = this.implement;
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.function) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.function,
        received: ctx.parsedType
      });
      return INVALID;
    }
    function makeArgsIssue(args, error) {
      return makeIssue({
        data: args,
        path: ctx.path,
        errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode.invalid_arguments,
          argumentsError: error
        }
      });
    }
    function makeReturnsIssue(returns, error) {
      return makeIssue({
        data: returns,
        path: ctx.path,
        errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode.invalid_return_type,
          returnTypeError: error
        }
      });
    }
    const params = { errorMap: ctx.common.contextualErrorMap };
    const fn = ctx.data;
    if (this._def.returns instanceof ZodPromise) {
      const me = this;
      return OK(async function(...args) {
        const error = new ZodError([]);
        const parsedArgs = await me._def.args.parseAsync(args, params).catch((e) => {
          error.addIssue(makeArgsIssue(args, e));
          throw error;
        });
        const result = await Reflect.apply(fn, this, parsedArgs);
        const parsedReturns = await me._def.returns._def.type.parseAsync(result, params).catch((e) => {
          error.addIssue(makeReturnsIssue(result, e));
          throw error;
        });
        return parsedReturns;
      });
    } else {
      const me = this;
      return OK(function(...args) {
        const parsedArgs = me._def.args.safeParse(args, params);
        if (!parsedArgs.success) {
          throw new ZodError([makeArgsIssue(args, parsedArgs.error)]);
        }
        const result = Reflect.apply(fn, this, parsedArgs.data);
        const parsedReturns = me._def.returns.safeParse(result, params);
        if (!parsedReturns.success) {
          throw new ZodError([makeReturnsIssue(result, parsedReturns.error)]);
        }
        return parsedReturns.data;
      });
    }
  }
  parameters() {
    return this._def.args;
  }
  returnType() {
    return this._def.returns;
  }
  args(...items) {
    return new _ZodFunction({
      ...this._def,
      args: ZodTuple.create(items).rest(ZodUnknown.create())
    });
  }
  returns(returnType) {
    return new _ZodFunction({
      ...this._def,
      returns: returnType
    });
  }
  implement(func) {
    const validatedFunc = this.parse(func);
    return validatedFunc;
  }
  strictImplement(func) {
    const validatedFunc = this.parse(func);
    return validatedFunc;
  }
  static create(args, returns, params) {
    return new _ZodFunction({
      args: args ? args : ZodTuple.create([]).rest(ZodUnknown.create()),
      returns: returns || ZodUnknown.create(),
      typeName: ZodFirstPartyTypeKind.ZodFunction,
      ...processCreateParams(params)
    });
  }
};
var ZodLazy = class extends ZodType {
  get schema() {
    return this._def.getter();
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const lazySchema = this._def.getter();
    return lazySchema._parse({ data: ctx.data, path: ctx.path, parent: ctx });
  }
};
ZodLazy.create = (getter, params) => {
  return new ZodLazy({
    getter,
    typeName: ZodFirstPartyTypeKind.ZodLazy,
    ...processCreateParams(params)
  });
};
var ZodLiteral = class extends ZodType {
  _parse(input) {
    if (input.data !== this._def.value) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_literal,
        expected: this._def.value
      });
      return INVALID;
    }
    return { status: "valid", value: input.data };
  }
  get value() {
    return this._def.value;
  }
};
ZodLiteral.create = (value, params) => {
  return new ZodLiteral({
    value,
    typeName: ZodFirstPartyTypeKind.ZodLiteral,
    ...processCreateParams(params)
  });
};
function createZodEnum(values, params) {
  return new ZodEnum({
    values,
    typeName: ZodFirstPartyTypeKind.ZodEnum,
    ...processCreateParams(params)
  });
}
var ZodEnum = class _ZodEnum extends ZodType {
  _parse(input) {
    if (typeof input.data !== "string") {
      const ctx = this._getOrReturnCtx(input);
      const expectedValues = this._def.values;
      addIssueToContext(ctx, {
        expected: util.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode.invalid_type
      });
      return INVALID;
    }
    if (!this._cache) {
      this._cache = new Set(this._def.values);
    }
    if (!this._cache.has(input.data)) {
      const ctx = this._getOrReturnCtx(input);
      const expectedValues = this._def.values;
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_enum_value,
        options: expectedValues
      });
      return INVALID;
    }
    return OK(input.data);
  }
  get options() {
    return this._def.values;
  }
  get enum() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  get Values() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  get Enum() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  extract(values, newDef = this._def) {
    return _ZodEnum.create(values, {
      ...this._def,
      ...newDef
    });
  }
  exclude(values, newDef = this._def) {
    return _ZodEnum.create(this.options.filter((opt) => !values.includes(opt)), {
      ...this._def,
      ...newDef
    });
  }
};
ZodEnum.create = createZodEnum;
var ZodNativeEnum = class extends ZodType {
  _parse(input) {
    const nativeEnumValues = util.getValidEnumValues(this._def.values);
    const ctx = this._getOrReturnCtx(input);
    if (ctx.parsedType !== ZodParsedType.string && ctx.parsedType !== ZodParsedType.number) {
      const expectedValues = util.objectValues(nativeEnumValues);
      addIssueToContext(ctx, {
        expected: util.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode.invalid_type
      });
      return INVALID;
    }
    if (!this._cache) {
      this._cache = new Set(util.getValidEnumValues(this._def.values));
    }
    if (!this._cache.has(input.data)) {
      const expectedValues = util.objectValues(nativeEnumValues);
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_enum_value,
        options: expectedValues
      });
      return INVALID;
    }
    return OK(input.data);
  }
  get enum() {
    return this._def.values;
  }
};
ZodNativeEnum.create = (values, params) => {
  return new ZodNativeEnum({
    values,
    typeName: ZodFirstPartyTypeKind.ZodNativeEnum,
    ...processCreateParams(params)
  });
};
var ZodPromise = class extends ZodType {
  unwrap() {
    return this._def.type;
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.promise && ctx.common.async === false) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.promise,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const promisified = ctx.parsedType === ZodParsedType.promise ? ctx.data : Promise.resolve(ctx.data);
    return OK(promisified.then((data) => {
      return this._def.type.parseAsync(data, {
        path: ctx.path,
        errorMap: ctx.common.contextualErrorMap
      });
    }));
  }
};
ZodPromise.create = (schema, params) => {
  return new ZodPromise({
    type: schema,
    typeName: ZodFirstPartyTypeKind.ZodPromise,
    ...processCreateParams(params)
  });
};
var ZodEffects = class extends ZodType {
  innerType() {
    return this._def.schema;
  }
  sourceType() {
    return this._def.schema._def.typeName === ZodFirstPartyTypeKind.ZodEffects ? this._def.schema.sourceType() : this._def.schema;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    const effect = this._def.effect || null;
    const checkCtx = {
      addIssue: (arg) => {
        addIssueToContext(ctx, arg);
        if (arg.fatal) {
          status.abort();
        } else {
          status.dirty();
        }
      },
      get path() {
        return ctx.path;
      }
    };
    checkCtx.addIssue = checkCtx.addIssue.bind(checkCtx);
    if (effect.type === "preprocess") {
      const processed = effect.transform(ctx.data, checkCtx);
      if (ctx.common.async) {
        return Promise.resolve(processed).then(async (processed2) => {
          if (status.value === "aborted")
            return INVALID;
          const result = await this._def.schema._parseAsync({
            data: processed2,
            path: ctx.path,
            parent: ctx
          });
          if (result.status === "aborted")
            return INVALID;
          if (result.status === "dirty")
            return DIRTY(result.value);
          if (status.value === "dirty")
            return DIRTY(result.value);
          return result;
        });
      } else {
        if (status.value === "aborted")
          return INVALID;
        const result = this._def.schema._parseSync({
          data: processed,
          path: ctx.path,
          parent: ctx
        });
        if (result.status === "aborted")
          return INVALID;
        if (result.status === "dirty")
          return DIRTY(result.value);
        if (status.value === "dirty")
          return DIRTY(result.value);
        return result;
      }
    }
    if (effect.type === "refinement") {
      const executeRefinement = (acc) => {
        const result = effect.refinement(acc, checkCtx);
        if (ctx.common.async) {
          return Promise.resolve(result);
        }
        if (result instanceof Promise) {
          throw new Error("Async refinement encountered during synchronous parse operation. Use .parseAsync instead.");
        }
        return acc;
      };
      if (ctx.common.async === false) {
        const inner = this._def.schema._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (inner.status === "aborted")
          return INVALID;
        if (inner.status === "dirty")
          status.dirty();
        executeRefinement(inner.value);
        return { status: status.value, value: inner.value };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((inner) => {
          if (inner.status === "aborted")
            return INVALID;
          if (inner.status === "dirty")
            status.dirty();
          return executeRefinement(inner.value).then(() => {
            return { status: status.value, value: inner.value };
          });
        });
      }
    }
    if (effect.type === "transform") {
      if (ctx.common.async === false) {
        const base = this._def.schema._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (!isValid(base))
          return INVALID;
        const result = effect.transform(base.value, checkCtx);
        if (result instanceof Promise) {
          throw new Error(`Asynchronous transform encountered during synchronous parse operation. Use .parseAsync instead.`);
        }
        return { status: status.value, value: result };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((base) => {
          if (!isValid(base))
            return INVALID;
          return Promise.resolve(effect.transform(base.value, checkCtx)).then((result) => ({
            status: status.value,
            value: result
          }));
        });
      }
    }
    util.assertNever(effect);
  }
};
ZodEffects.create = (schema, effect, params) => {
  return new ZodEffects({
    schema,
    typeName: ZodFirstPartyTypeKind.ZodEffects,
    effect,
    ...processCreateParams(params)
  });
};
ZodEffects.createWithPreprocess = (preprocess, schema, params) => {
  return new ZodEffects({
    schema,
    effect: { type: "preprocess", transform: preprocess },
    typeName: ZodFirstPartyTypeKind.ZodEffects,
    ...processCreateParams(params)
  });
};
var ZodOptional = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType === ZodParsedType.undefined) {
      return OK(void 0);
    }
    return this._def.innerType._parse(input);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodOptional.create = (type, params) => {
  return new ZodOptional({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodOptional,
    ...processCreateParams(params)
  });
};
var ZodNullable = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType === ZodParsedType.null) {
      return OK(null);
    }
    return this._def.innerType._parse(input);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodNullable.create = (type, params) => {
  return new ZodNullable({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodNullable,
    ...processCreateParams(params)
  });
};
var ZodDefault = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    let data = ctx.data;
    if (ctx.parsedType === ZodParsedType.undefined) {
      data = this._def.defaultValue();
    }
    return this._def.innerType._parse({
      data,
      path: ctx.path,
      parent: ctx
    });
  }
  removeDefault() {
    return this._def.innerType;
  }
};
ZodDefault.create = (type, params) => {
  return new ZodDefault({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodDefault,
    defaultValue: typeof params.default === "function" ? params.default : () => params.default,
    ...processCreateParams(params)
  });
};
var ZodCatch = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const newCtx = {
      ...ctx,
      common: {
        ...ctx.common,
        issues: []
      }
    };
    const result = this._def.innerType._parse({
      data: newCtx.data,
      path: newCtx.path,
      parent: {
        ...newCtx
      }
    });
    if (isAsync(result)) {
      return result.then((result2) => {
        return {
          status: "valid",
          value: result2.status === "valid" ? result2.value : this._def.catchValue({
            get error() {
              return new ZodError(newCtx.common.issues);
            },
            input: newCtx.data
          })
        };
      });
    } else {
      return {
        status: "valid",
        value: result.status === "valid" ? result.value : this._def.catchValue({
          get error() {
            return new ZodError(newCtx.common.issues);
          },
          input: newCtx.data
        })
      };
    }
  }
  removeCatch() {
    return this._def.innerType;
  }
};
ZodCatch.create = (type, params) => {
  return new ZodCatch({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodCatch,
    catchValue: typeof params.catch === "function" ? params.catch : () => params.catch,
    ...processCreateParams(params)
  });
};
var ZodNaN = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.nan) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.nan,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return { status: "valid", value: input.data };
  }
};
ZodNaN.create = (params) => {
  return new ZodNaN({
    typeName: ZodFirstPartyTypeKind.ZodNaN,
    ...processCreateParams(params)
  });
};
var BRAND = /* @__PURE__ */ Symbol("zod_brand");
var ZodBranded = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const data = ctx.data;
    return this._def.type._parse({
      data,
      path: ctx.path,
      parent: ctx
    });
  }
  unwrap() {
    return this._def.type;
  }
};
var ZodPipeline = class _ZodPipeline extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.common.async) {
      const handleAsync = async () => {
        const inResult = await this._def.in._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (inResult.status === "aborted")
          return INVALID;
        if (inResult.status === "dirty") {
          status.dirty();
          return DIRTY(inResult.value);
        } else {
          return this._def.out._parseAsync({
            data: inResult.value,
            path: ctx.path,
            parent: ctx
          });
        }
      };
      return handleAsync();
    } else {
      const inResult = this._def.in._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
      if (inResult.status === "aborted")
        return INVALID;
      if (inResult.status === "dirty") {
        status.dirty();
        return {
          status: "dirty",
          value: inResult.value
        };
      } else {
        return this._def.out._parseSync({
          data: inResult.value,
          path: ctx.path,
          parent: ctx
        });
      }
    }
  }
  static create(a, b) {
    return new _ZodPipeline({
      in: a,
      out: b,
      typeName: ZodFirstPartyTypeKind.ZodPipeline
    });
  }
};
var ZodReadonly = class extends ZodType {
  _parse(input) {
    const result = this._def.innerType._parse(input);
    const freeze = (data) => {
      if (isValid(data)) {
        data.value = Object.freeze(data.value);
      }
      return data;
    };
    return isAsync(result) ? result.then((data) => freeze(data)) : freeze(result);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodReadonly.create = (type, params) => {
  return new ZodReadonly({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodReadonly,
    ...processCreateParams(params)
  });
};
function cleanParams(params, data) {
  const p = typeof params === "function" ? params(data) : typeof params === "string" ? { message: params } : params;
  const p2 = typeof p === "string" ? { message: p } : p;
  return p2;
}
function custom(check, _params = {}, fatal) {
  if (check)
    return ZodAny.create().superRefine((data, ctx) => {
      const r = check(data);
      if (r instanceof Promise) {
        return r.then((r2) => {
          if (!r2) {
            const params = cleanParams(_params, data);
            const _fatal = params.fatal ?? fatal ?? true;
            ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
          }
        });
      }
      if (!r) {
        const params = cleanParams(_params, data);
        const _fatal = params.fatal ?? fatal ?? true;
        ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
      }
      return;
    });
  return ZodAny.create();
}
var late = {
  object: ZodObject.lazycreate
};
var ZodFirstPartyTypeKind;
(function(ZodFirstPartyTypeKind2) {
  ZodFirstPartyTypeKind2["ZodString"] = "ZodString";
  ZodFirstPartyTypeKind2["ZodNumber"] = "ZodNumber";
  ZodFirstPartyTypeKind2["ZodNaN"] = "ZodNaN";
  ZodFirstPartyTypeKind2["ZodBigInt"] = "ZodBigInt";
  ZodFirstPartyTypeKind2["ZodBoolean"] = "ZodBoolean";
  ZodFirstPartyTypeKind2["ZodDate"] = "ZodDate";
  ZodFirstPartyTypeKind2["ZodSymbol"] = "ZodSymbol";
  ZodFirstPartyTypeKind2["ZodUndefined"] = "ZodUndefined";
  ZodFirstPartyTypeKind2["ZodNull"] = "ZodNull";
  ZodFirstPartyTypeKind2["ZodAny"] = "ZodAny";
  ZodFirstPartyTypeKind2["ZodUnknown"] = "ZodUnknown";
  ZodFirstPartyTypeKind2["ZodNever"] = "ZodNever";
  ZodFirstPartyTypeKind2["ZodVoid"] = "ZodVoid";
  ZodFirstPartyTypeKind2["ZodArray"] = "ZodArray";
  ZodFirstPartyTypeKind2["ZodObject"] = "ZodObject";
  ZodFirstPartyTypeKind2["ZodUnion"] = "ZodUnion";
  ZodFirstPartyTypeKind2["ZodDiscriminatedUnion"] = "ZodDiscriminatedUnion";
  ZodFirstPartyTypeKind2["ZodIntersection"] = "ZodIntersection";
  ZodFirstPartyTypeKind2["ZodTuple"] = "ZodTuple";
  ZodFirstPartyTypeKind2["ZodRecord"] = "ZodRecord";
  ZodFirstPartyTypeKind2["ZodMap"] = "ZodMap";
  ZodFirstPartyTypeKind2["ZodSet"] = "ZodSet";
  ZodFirstPartyTypeKind2["ZodFunction"] = "ZodFunction";
  ZodFirstPartyTypeKind2["ZodLazy"] = "ZodLazy";
  ZodFirstPartyTypeKind2["ZodLiteral"] = "ZodLiteral";
  ZodFirstPartyTypeKind2["ZodEnum"] = "ZodEnum";
  ZodFirstPartyTypeKind2["ZodEffects"] = "ZodEffects";
  ZodFirstPartyTypeKind2["ZodNativeEnum"] = "ZodNativeEnum";
  ZodFirstPartyTypeKind2["ZodOptional"] = "ZodOptional";
  ZodFirstPartyTypeKind2["ZodNullable"] = "ZodNullable";
  ZodFirstPartyTypeKind2["ZodDefault"] = "ZodDefault";
  ZodFirstPartyTypeKind2["ZodCatch"] = "ZodCatch";
  ZodFirstPartyTypeKind2["ZodPromise"] = "ZodPromise";
  ZodFirstPartyTypeKind2["ZodBranded"] = "ZodBranded";
  ZodFirstPartyTypeKind2["ZodPipeline"] = "ZodPipeline";
  ZodFirstPartyTypeKind2["ZodReadonly"] = "ZodReadonly";
})(ZodFirstPartyTypeKind || (ZodFirstPartyTypeKind = {}));
var instanceOfType = (cls, params = {
  message: `Input not instance of ${cls.name}`
}) => custom((data) => data instanceof cls, params);
var stringType = ZodString.create;
var numberType = ZodNumber.create;
var nanType = ZodNaN.create;
var bigIntType = ZodBigInt.create;
var booleanType = ZodBoolean.create;
var dateType = ZodDate.create;
var symbolType = ZodSymbol.create;
var undefinedType = ZodUndefined.create;
var nullType = ZodNull.create;
var anyType = ZodAny.create;
var unknownType = ZodUnknown.create;
var neverType = ZodNever.create;
var voidType = ZodVoid.create;
var arrayType = ZodArray.create;
var objectType = ZodObject.create;
var strictObjectType = ZodObject.strictCreate;
var unionType = ZodUnion.create;
var discriminatedUnionType = ZodDiscriminatedUnion.create;
var intersectionType = ZodIntersection.create;
var tupleType = ZodTuple.create;
var recordType = ZodRecord.create;
var mapType = ZodMap.create;
var setType = ZodSet.create;
var functionType = ZodFunction.create;
var lazyType = ZodLazy.create;
var literalType = ZodLiteral.create;
var enumType = ZodEnum.create;
var nativeEnumType = ZodNativeEnum.create;
var promiseType = ZodPromise.create;
var effectsType = ZodEffects.create;
var optionalType = ZodOptional.create;
var nullableType = ZodNullable.create;
var preprocessType = ZodEffects.createWithPreprocess;
var pipelineType = ZodPipeline.create;
var ostring = () => stringType().optional();
var onumber = () => numberType().optional();
var oboolean = () => booleanType().optional();
var coerce = {
  string: ((arg) => ZodString.create({ ...arg, coerce: true })),
  number: ((arg) => ZodNumber.create({ ...arg, coerce: true })),
  boolean: ((arg) => ZodBoolean.create({
    ...arg,
    coerce: true
  })),
  bigint: ((arg) => ZodBigInt.create({ ...arg, coerce: true })),
  date: ((arg) => ZodDate.create({ ...arg, coerce: true }))
};
var NEVER = INVALID;

// src/hooks/bridge-normalize.ts
init_worktree_paths();

// src/hooks/hook-protocol.ts
var MAX_UNKNOWN_ERROR_LENGTH = 500;
function boundUnknownErrorText(text) {
  return text.length <= MAX_UNKNOWN_ERROR_LENGTH ? text : `${text.slice(0, MAX_UNKNOWN_ERROR_LENGTH - 1)}\u2026`;
}
function formatUnknownError(value) {
  if (typeof value === "string") return boundUnknownErrorText(value);
  if (typeof value === "symbol") {
    try {
      return boundUnknownErrorText(value.toString());
    } catch {
      return "<unprintable thrown value>";
    }
  }
  try {
    if (value instanceof Error) {
      try {
        if (typeof value.message === "string" && value.message.length > 0) {
          return boundUnknownErrorText(value.message);
        }
      } catch {
      }
    }
  } catch {
  }
  try {
    const serialized = JSON.stringify(value);
    if (typeof serialized === "string" && serialized.length > 0) {
      return boundUnknownErrorText(serialized);
    }
  } catch {
  }
  try {
    const text = String(value);
    if (text.length > 0) return boundUnknownErrorText(text);
  } catch {
  }
  try {
    return boundUnknownErrorText(Object.prototype.toString.call(value));
  } catch {
    return "<unprintable thrown value>";
  }
}
var CLAUDE_SINGLE_CAPABILITIES = Object.freeze({
  batchInput: false,
  correlatedDecisionOutput: true,
  correlatedMutationOutput: true,
  singletonMutationOutput: true
});
var COPILOT_1072_CAPABILITIES = Object.freeze({
  batchInput: true,
  correlatedDecisionOutput: false,
  correlatedMutationOutput: false,
  singletonMutationOutput: true
});

// src/hooks/bridge-normalize.ts
var HookInputSchema = external_exports.object({
  // snake_case fields from Claude Code
  tool_name: external_exports.string().optional(),
  tool_input: external_exports.unknown().optional(),
  tool_response: external_exports.unknown().optional(),
  session_id: external_exports.string().optional(),
  cwd: external_exports.string().optional(),
  hook_event_name: external_exports.string().optional(),
  // camelCase fields (fallback / already normalized)
  toolName: external_exports.string().optional(),
  toolInput: external_exports.unknown().optional(),
  toolOutput: external_exports.unknown().optional(),
  toolResponse: external_exports.unknown().optional(),
  sessionId: external_exports.string().optional(),
  directory: external_exports.string().optional(),
  hookEventName: external_exports.string().optional(),
  // Fields that are the same in both conventions
  prompt: external_exports.string().optional(),
  message: external_exports.object({ content: external_exports.string().optional() }).optional(),
  parts: external_exports.array(external_exports.object({ type: external_exports.string(), text: external_exports.string().optional() })).optional(),
  model: external_exports.string().optional(),
  model_id: external_exports.string().optional(),
  modelId: external_exports.string().optional(),
  agent_name: external_exports.string().optional(),
  agentName: external_exports.string().optional(),
  // Stop hook fields
  stop_reason: external_exports.string().optional(),
  stopReason: external_exports.string().optional(),
  user_requested: external_exports.boolean().optional(),
  userRequested: external_exports.boolean().optional()
}).passthrough();
var MAX_STABLE_SERIALIZATION_DEPTH = 128;
var StableSerializationError = class extends Error {
};
var CLAUDE_ENVELOPE_MARKERS = /* @__PURE__ */ new Set([
  "hook_event_name",
  "session_id",
  "tool_name",
  "tool_input",
  "tool_response",
  "transcript_path",
  "stop_reason",
  "agent_id",
  "agent_type",
  "tool_use_id",
  "permission_mode"
]);
var COPILOT_ENVELOPE_MARKERS = /* @__PURE__ */ new Set([
  "sessionId",
  "toolCalls",
  "toolName",
  "toolArgs",
  "toolResult",
  "hookName",
  "transcriptPath",
  "stopReason",
  "initialPrompt",
  "promptId",
  "agentName",
  "agentDisplayName",
  "agentDescription",
  "customInstructions"
]);
var COPILOT_TOOL_ALIASES = {
  agent: "Task",
  apply_patch: "Edit",
  ask_user: "AskUserQuestion",
  bash: "Bash",
  create: "Write",
  edit: "Edit",
  glob: "Glob",
  grep: "Grep",
  powershell: "Bash",
  pwsh: "Bash",
  read: "Read",
  rg: "Grep",
  skill: "Skill",
  str_replace_editor: "Edit",
  task: "Task",
  update_todo: "TodoWrite",
  view: "Read",
  web_fetch: "WebFetch",
  web_search: "WebSearch",
  write: "Write"
};
var EVENT_NAME_ALIASES = {
  AgentStop: "stop",
  Notification: "notification",
  PermissionRequest: "permission-request",
  PostToolUse: "post-tool-use",
  PostToolUseFailure: "post-tool-use-failure",
  PreCompact: "pre-compact",
  PreToolUse: "pre-tool-use",
  SessionEnd: "session-end",
  SessionStart: "session-start",
  Stop: "stop",
  SubagentStart: "subagent-start",
  SubagentStop: "subagent-stop",
  UserPromptSubmit: "user-prompt-submit",
  agentStop: "stop",
  notification: "notification",
  permissionRequest: "permission-request",
  postToolUse: "post-tool-use",
  postToolUseFailure: "post-tool-use-failure",
  preCompact: "pre-compact",
  preToolUse: "pre-tool-use",
  sessionEnd: "session-end",
  sessionStart: "session-start",
  subagentStart: "subagent-start",
  subagentStop: "subagent-stop",
  userPromptSubmitted: "user-prompt-submit"
};
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function hasOwn(input, key) {
  return Object.prototype.hasOwnProperty.call(input, key);
}
function stringField(input, key) {
  const value = input[key];
  return typeof value === "string" && value.length > 0 ? value : void 0;
}
function firstDefinedField(input, keys) {
  for (const key of keys) {
    if (hasOwn(input, key) && input[key] !== void 0) return input[key];
  }
  return void 0;
}
function firstStringField(input, keys) {
  for (const key of keys) {
    const value = stringField(input, key);
    if (value !== void 0) return value;
  }
  return void 0;
}
function normalizeLastAssistantMessage(input) {
  if (hasOwn(input, "last_assistant_message")) {
    const value = input.last_assistant_message;
    return typeof value === "string" ? value.trim() : "";
  }
  for (const key of [
    "lastAssistantMessage",
    "message",
    "output",
    "response",
    "text"
  ]) {
    const value = input[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return void 0;
}
function firstNumberField(input, keys) {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return void 0;
}
function firstBooleanField(input, keys) {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "boolean") return value;
  }
  return void 0;
}
function firstArrayField(input, keys) {
  for (const key of keys) {
    const value = input[key];
    if (Array.isArray(value)) return [...value];
  }
  return void 0;
}
function hostFieldKeys(host, snakeCase, camelCase, ...fallbacks) {
  return host === "claude" ? [snakeCase, camelCase, ...fallbacks] : [camelCase, snakeCase, ...fallbacks];
}
function normalizeGoalSnapshot(raw) {
  const context = isRecord(raw.context) ? raw.context : void 0;
  const candidates = [
    { value: raw.goal, source: "payload" },
    { value: raw.claude_goal, source: "payload" },
    { value: raw.claudeGoal, source: "payload" },
    { value: raw.goal_state, source: "payload" },
    { value: raw.goalState, source: "payload" },
    { value: raw.codex_goal, source: "payload" },
    { value: raw.codexGoal, source: "payload" },
    { value: context?.goal, source: "context" },
    { value: context?.claude_goal, source: "context" },
    { value: context?.claudeGoal, source: "context" }
  ];
  for (const candidate of candidates) {
    const value = isRecord(candidate.value) && isRecord(candidate.value.goal) ? candidate.value.goal : candidate.value;
    if (!isRecord(value)) continue;
    const objective = firstStringField(
      value,
      ["objective", "condition", "prompt", "description"]
    );
    const status = firstStringField(value, ["status", "state"]);
    if (objective === void 0 && status === void 0) continue;
    return {
      ...objective !== void 0 ? { objective } : {},
      ...status !== void 0 ? { status } : {},
      source: candidate.source
    };
  }
  return void 0;
}
function normalizeEventPayload(raw, host, hookType) {
  const prompt = firstStringField(raw, ["prompt"]);
  const userPrompt = firstStringField(
    raw,
    hostFieldKeys(host, "user_prompt", "userPrompt")
  );
  const initialPrompt = firstStringField(raw, ["initialPrompt", "initial_prompt"]);
  const promptId = firstStringField(raw, hostFieldKeys(host, "prompt_id", "promptId"));
  const message = firstDefinedField(raw, ["message"]);
  const messagePrompt = isRecord(message) ? firstStringField(message, ["content"]) : typeof message === "string" && message.length > 0 ? message : void 0;
  const parts = firstArrayField(raw, ["parts"]);
  const partsPrompt = parts?.flatMap((part) => isRecord(part) && part.type === "text" && typeof part.text === "string" && part.text.length > 0 ? [part.text] : []).join(" ");
  const promptAliases = [...new Set(
    [
      prompt,
      userPrompt,
      initialPrompt,
      messagePrompt,
      partsPrompt || void 0
    ].filter(
      (value) => value !== void 0
    )
  )];
  const goal = normalizeGoalSnapshot(raw);
  const source = firstStringField(raw, ["source"]);
  const model = firstStringField(raw, hostFieldKeys(host, "model_id", "modelId", "model"));
  const timestamp = firstNumberField(raw, ["timestamp"]);
  const toolOutput = firstDefinedField(
    raw,
    host === "claude" ? ["tool_response", "toolOutput", "toolResponse", "toolResult", "output", "result"] : ["toolResult", "toolOutput", "toolResponse", "tool_response", "output", "result"]
  );
  const toolError = firstDefinedField(raw, ["error", "toolError", "tool_error"]);
  const contextWindow = firstDefinedField(
    raw,
    hostFieldKeys(host, "context_window", "contextWindow")
  );
  const trigger = firstStringField(raw, ["trigger"]);
  const customInstructions = firstStringField(
    raw,
    hostFieldKeys(host, "custom_instructions", "customInstructions")
  );
  const permissionSuggestions = firstArrayField(
    raw,
    hostFieldKeys(host, "permission_suggestions", "permissionSuggestions")
  );
  const permissionMode = firstStringField(
    raw,
    hostFieldKeys(host, "permission_mode", "permissionMode")
  );
  const durationMs = firstNumberField(
    raw,
    hostFieldKeys(host, "duration_ms", "durationMs")
  );
  const interrupted = firstBooleanField(
    raw,
    hostFieldKeys(host, "is_interrupt", "isInterrupt")
  );
  const stopHookActive = firstBooleanField(
    raw,
    hostFieldKeys(host, "stop_hook_active", "stopHookActive")
  );
  const lastAssistantMessage = normalizeLastAssistantMessage(raw);
  const endTurnReason = firstStringField(
    raw,
    hostFieldKeys(host, "end_turn_reason", "endTurnReason")
  );
  const reason = firstStringField(raw, ["reason"]);
  const backgroundTasks = firstArrayField(
    raw,
    hostFieldKeys(host, "background_tasks", "backgroundTasks")
  );
  const sessionCrons = firstArrayField(
    raw,
    hostFieldKeys(host, "session_crons", "sessionCrons")
  );
  const agentTranscriptPath = firstStringField(
    raw,
    hostFieldKeys(host, "agent_transcript_path", "agentTranscriptPath")
  );
  const parentSessionId = firstStringField(
    raw,
    hostFieldKeys(host, "parent_session_id", "parentSessionId")
  );
  const userRequested = firstBooleanField(
    raw,
    hostFieldKeys(host, "user_requested", "userRequested")
  );
  const status = firstDefinedField(raw, ["status"]);
  const eventKey = hookType.replace(/[^a-z]/gi, "").toLowerCase();
  const sessionEndReason = eventKey === "sessionend" ? firstStringField(raw, ["reason"]) : void 0;
  const notificationType = firstStringField(
    raw,
    hostFieldKeys(host, "notification_type", "notificationType")
  );
  const notificationTitle = firstStringField(
    raw,
    hostFieldKeys(host, "notification_title", "notificationTitle", "title")
  );
  const notificationData = firstDefinedField(
    raw,
    hostFieldKeys(host, "notification_data", "notificationData", "data")
  );
  const notification = eventKey === "notification" || notificationType !== void 0 || notificationTitle !== void 0 || notificationData !== void 0 ? {
    ...notificationType !== void 0 ? { type: notificationType } : {},
    ...notificationTitle !== void 0 ? { title: notificationTitle } : {},
    ...message !== void 0 ? { message } : {},
    ...notificationData !== void 0 ? { data: notificationData } : {}
  } : void 0;
  return {
    ...prompt !== void 0 ? { prompt } : {},
    ...userPrompt !== void 0 ? { userPrompt } : {},
    ...promptAliases.length > 0 ? { promptAliases } : {},
    ...initialPrompt !== void 0 ? { initialPrompt } : {},
    ...promptId !== void 0 ? { promptId } : {},
    ...goal !== void 0 ? { goal } : {},
    ...source !== void 0 ? { source } : {},
    ...model !== void 0 ? { model } : {},
    ...timestamp !== void 0 ? { timestamp } : {},
    ...message !== void 0 ? { message } : {},
    ...parts !== void 0 ? { parts } : {},
    ...toolOutput !== void 0 ? { toolOutput } : {},
    ...toolError !== void 0 ? { toolError } : {},
    ...contextWindow !== void 0 ? { contextWindow } : {},
    ...notification !== void 0 ? { notification } : {},
    ...trigger !== void 0 ? { trigger } : {},
    ...customInstructions !== void 0 ? { customInstructions } : {},
    ...sessionEndReason !== void 0 ? { sessionEndReason } : {},
    ...permissionSuggestions !== void 0 ? { permissionSuggestions } : {},
    ...permissionMode !== void 0 ? { permissionMode } : {},
    ...durationMs !== void 0 ? { durationMs } : {},
    ...interrupted !== void 0 ? { interrupted } : {},
    ...stopHookActive !== void 0 ? { stopHookActive } : {},
    ...lastAssistantMessage !== void 0 ? { lastAssistantMessage } : {},
    ...endTurnReason !== void 0 ? { endTurnReason } : {},
    ...reason !== void 0 ? { reason } : {},
    ...backgroundTasks !== void 0 ? { backgroundTasks } : {},
    ...sessionCrons !== void 0 ? { sessionCrons } : {},
    ...agentTranscriptPath !== void 0 ? { agentTranscriptPath } : {},
    ...parentSessionId !== void 0 ? { parentSessionId } : {},
    ...userRequested !== void 0 ? { userRequested } : {},
    ...status !== void 0 ? { status } : {}
  };
}
function stableSerialize(value, seen = /* @__PURE__ */ new Set(), depth = 0) {
  if (depth > MAX_STABLE_SERIALIZATION_DEPTH) {
    throw new StableSerializationError(
      `Tool arguments exceed the maximum fingerprint depth of ${MAX_STABLE_SERIALIZATION_DEPTH}.`
    );
  }
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
    case "boolean":
      return JSON.stringify(value);
    case "number":
      return Number.isFinite(value) ? JSON.stringify(value) : JSON.stringify(String(value));
    case "bigint":
      return JSON.stringify(`${value.toString()}n`);
    case "undefined":
      return '"__undefined__"';
    case "function":
      return '"__function__"';
    case "symbol":
      return JSON.stringify(String(value));
    case "object":
      break;
  }
  const objectValue = value;
  if (seen.has(objectValue)) return '"__circular__"';
  seen.add(objectValue);
  let serialized;
  if (Array.isArray(value)) {
    serialized = `[${value.map((item) => stableSerialize(item, seen, depth + 1)).join(",")}]`;
  } else {
    const entries = Object.entries(value).filter(([, child]) => !["undefined", "function", "symbol"].includes(typeof child)).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(
      ([key, child]) => `${JSON.stringify(key)}:${stableSerialize(child, seen, depth + 1)}`
    );
    serialized = `{${entries.join(",")}}`;
  }
  seen.delete(objectValue);
  return serialized;
}
function shellDialectForTool(host, nativeName) {
  const normalized = nativeName.toLowerCase().replace(/^proxy_/, "");
  if (normalized === "powershell" || normalized === "pwsh") return "powershell";
  if (normalized === "bash" || host === "claude" && normalized === "shell") return "posix";
  if (host === "claude" && nativeName === "Bash") return "posix";
  return void 0;
}
function malformedCallIssue(code, message, originalIndex, callId) {
  return {
    code,
    message,
    severity: "safety",
    scope: "call",
    originalIndex,
    callId
  };
}
function parseSerializedArgs(rawArgs, originalIndex, callId) {
  if (typeof rawArgs !== "string") {
    return {
      input: rawArgs,
      issue: malformedCallIssue(
        "malformed-tool-args",
        `Tool call at index ${originalIndex} must provide serialized JSON args.`,
        originalIndex,
        callId
      )
    };
  }
  try {
    return { input: JSON.parse(rawArgs) };
  } catch {
    return {
      input: rawArgs,
      issue: malformedCallIssue(
        "malformed-tool-args",
        `Tool call at index ${originalIndex} contains malformed JSON args.`,
        originalIndex,
        callId
      )
    };
  }
}
function syntheticCallId(originalIndex) {
  return `__missing_tool_call_id_${originalIndex}`;
}
function normalizeHostDecision(value) {
  if (typeof value === "string") {
    const decision = value === "block" ? "deny" : value;
    if (["pass", "allow", "ask", "deny"].includes(decision)) {
      return { decision };
    }
    return void 0;
  }
  if (!isRecord(value)) return void 0;
  const rawDecision = value.decision ?? value.behavior;
  const normalized = normalizeHostDecision(rawDecision);
  if (!normalized) return void 0;
  const reason = stringField(value, "reason");
  return reason ? { ...normalized, reason } : normalized;
}
function inferHookType(raw, hookType) {
  if (hookType) return hookType;
  const nativeEvent = stringField(raw, "hook_event_name") ?? stringField(raw, "hookName") ?? stringField(raw, "hookEventName");
  if (!nativeEvent) return "unknown";
  return EVENT_NAME_ALIASES[nativeEvent] ?? nativeEvent;
}
function detectHookContract(raw, _hookType) {
  if (!isRecord(raw)) {
    return {
      host: "claude",
      contract: "claude-single",
      capabilities: CLAUDE_SINGLE_CAPABILITIES
    };
  }
  for (const marker of CLAUDE_ENVELOPE_MARKERS) {
    if (hasOwn(raw, marker)) {
      return {
        host: "claude",
        contract: "claude-single",
        capabilities: CLAUDE_SINGLE_CAPABILITIES
      };
    }
  }
  for (const marker of COPILOT_ENVELOPE_MARKERS) {
    if (hasOwn(raw, marker)) {
      return {
        host: "copilot",
        contract: "copilot-1.0.72-1",
        capabilities: COPILOT_1072_CAPABILITIES
      };
    }
  }
  return {
    host: "claude",
    contract: "claude-single",
    capabilities: CLAUDE_SINGLE_CAPABILITIES
  };
}
function canonicalToolName(host, nativeName) {
  const unproxiedName = nativeName.replace(/^proxy_/, "");
  if (host === "copilot") {
    return COPILOT_TOOL_ALIASES[unproxiedName.toLowerCase()] ?? unproxiedName;
  }
  return unproxiedName === "powershell" || unproxiedName === "pwsh" ? "Bash" : unproxiedName;
}
function stableCallFingerprint(name, parsedInput) {
  return (0, import_crypto2.createHash)("sha256").update(name).update("\0").update(stableSerialize(parsedInput)).digest("hex");
}
function safeCallFingerprint(name, parsedInput, rawArgs, originalIndex, callId) {
  try {
    return { fingerprint: stableCallFingerprint(name, parsedInput) };
  } catch (error) {
    const detail = formatUnknownError(error);
    const fallback = typeof rawArgs === "string" ? rawArgs : `${typeof rawArgs}:serialization-unavailable`;
    return {
      fingerprint: (0, import_crypto2.createHash)("sha256").update(name).update("\0serialization-error\0").update(fallback).digest("hex"),
      issue: malformedCallIssue(
        "tool-call-serialization-failed",
        `Tool call at index ${originalIndex} could not be fingerprinted safely: ${detail}`,
        originalIndex,
        callId
      )
    };
  }
}
function decodeCopilotToolCall(rawCall, originalIndex) {
  if (!isRecord(rawCall)) {
    const issue = malformedCallIssue(
      "malformed-tool-call",
      `Tool call at index ${originalIndex} must be an object.`,
      originalIndex
    );
    const id2 = syntheticCallId(originalIndex);
    const fingerprint2 = safeCallFingerprint("", rawCall, rawCall, originalIndex, id2);
    return {
      id: id2,
      idSource: "synthetic",
      correlation: "unavailable",
      originalIndex,
      duplicateIndices: [],
      nativeName: "",
      canonicalName: "",
      input: rawCall,
      rawArgs: rawCall,
      fingerprint: fingerprint2.fingerprint,
      status: "malformed",
      malformed: true,
      issues: fingerprint2.issue ? [issue, fingerprint2.issue] : [issue]
    };
  }
  const issues = [];
  const rawId = stringField(rawCall, "id");
  const id = rawId ?? syntheticCallId(originalIndex);
  if (!rawId) {
    issues.push(
      malformedCallIssue(
        "missing-tool-call-id",
        `Tool call at index ${originalIndex} is missing a correlation ID.`,
        originalIndex,
        id
      )
    );
  }
  const nativeName = stringField(rawCall, "name") ?? "";
  if (!nativeName) {
    issues.push(
      malformedCallIssue(
        "missing-tool-name",
        `Tool call at index ${originalIndex} is missing a tool name.`,
        originalIndex,
        id
      )
    );
  }
  const rawArgs = rawCall.args;
  const parsedArgs = parseSerializedArgs(rawArgs, originalIndex, id);
  if (parsedArgs.issue) issues.push(parsedArgs.issue);
  const fingerprint = safeCallFingerprint(
    nativeName,
    parsedArgs.input,
    rawArgs,
    originalIndex,
    id
  );
  if (fingerprint.issue) issues.push(fingerprint.issue);
  const malformed = issues.length > 0;
  return {
    id,
    idSource: rawId ? "host" : "synthetic",
    correlation: rawId ? "host-id" : "unavailable",
    originalIndex,
    duplicateIndices: [],
    nativeName,
    canonicalName: canonicalToolName("copilot", nativeName),
    shellDialect: shellDialectForTool("copilot", nativeName),
    input: parsedArgs.input,
    rawArgs,
    fingerprint: fingerprint.fingerprint,
    status: malformed ? "malformed" : "valid",
    malformed,
    issues
  };
}
function dedupeCanonicalToolCalls(calls) {
  const uniqueCalls = [];
  const issues = [];
  const indexById = /* @__PURE__ */ new Map();
  for (const call of calls) {
    const existingIndex = indexById.get(call.id);
    if (existingIndex === void 0) {
      indexById.set(call.id, uniqueCalls.length);
      uniqueCalls.push({
        ...call,
        duplicateIndices: [...call.duplicateIndices],
        issues: [...call.issues]
      });
      continue;
    }
    const existing = uniqueCalls[existingIndex];
    if (existing.fingerprint === call.fingerprint) {
      const malformed = existing.malformed || existing.status === "malformed" || existing.issues.length > 0 || call.malformed || call.status === "malformed" || call.issues.length > 0;
      uniqueCalls[existingIndex] = {
        ...existing,
        duplicateIndices: [
          ...existing.duplicateIndices,
          call.originalIndex,
          ...call.duplicateIndices
        ],
        issues: [
          ...existing.issues,
          ...call.issues
        ],
        status: malformed ? "malformed" : "valid",
        malformed
      };
      continue;
    }
    issues.push({
      code: "conflicting-duplicate-id",
      message: `Tool call ID "${call.id}" has conflicting names or arguments.`,
      severity: "safety",
      scope: "batch",
      originalIndex: call.originalIndex,
      callId: call.id,
      batchSafety: true
    });
  }
  return { calls: uniqueCalls, issues };
}
function decodeSingleToolCall(host, raw) {
  const nativeName = host === "claude" ? stringField(raw, "tool_name") ?? stringField(raw, "toolName") : stringField(raw, "toolName") ?? stringField(raw, "tool_name");
  if (!nativeName) return void 0;
  const hostId = stringField(raw, "tool_use_id") ?? stringField(raw, "toolUseId") ?? stringField(raw, "toolCallId");
  const issues = [];
  let input;
  let rawArgs;
  if (host === "copilot" && hasOwn(raw, "toolArgs")) {
    rawArgs = raw.toolArgs;
    if (typeof rawArgs === "string") {
      try {
        input = JSON.parse(rawArgs);
      } catch {
        input = rawArgs;
      }
    } else {
      input = rawArgs;
    }
  } else {
    input = host === "claude" ? raw.tool_input ?? raw.toolInput : raw.toolInput ?? raw.tool_input;
    rawArgs = input;
  }
  const fingerprint = safeCallFingerprint(
    nativeName,
    input,
    rawArgs,
    0,
    hostId
  );
  if (fingerprint.issue) issues.push(fingerprint.issue);
  const id = hostId ?? `__single_tool_call_${fingerprint.fingerprint.slice(0, 24)}`;
  const malformed = issues.length > 0;
  return {
    id,
    idSource: hostId ? "host" : "synthetic",
    correlation: hostId ? "host-id" : "unavailable",
    originalIndex: 0,
    duplicateIndices: [],
    nativeName,
    canonicalName: canonicalToolName(host, nativeName),
    shellDialect: shellDialectForTool(host, nativeName),
    input,
    rawArgs,
    fingerprint: fingerprint.fingerprint,
    status: malformed ? "malformed" : "valid",
    malformed,
    issues
  };
}
function normalizeHookEnvelope(raw, hookType) {
  const detected = detectHookContract(raw, hookType);
  if (!isRecord(raw)) {
    return {
      ...detected,
      hookType: hookType ?? "unknown",
      eventPayload: {},
      originalCallCount: 0,
      logicalCallCount: 0,
      toolCalls: [],
      issues: [{
        code: "invalid-envelope",
        message: "Hook input must be a JSON object.",
        severity: "safety",
        scope: "batch",
        batchSafety: true
      }]
    };
  }
  const issues = [];
  let decodedCalls = [];
  if (detected.host === "copilot" && hasOwn(raw, "toolCalls")) {
    if (Array.isArray(raw.toolCalls)) {
      decodedCalls = raw.toolCalls.map((call, index) => decodeCopilotToolCall(call, index));
    } else {
      issues.push({
        code: "invalid-tool-calls",
        message: "Copilot toolCalls must be an array.",
        severity: "safety",
        scope: "batch",
        batchSafety: true
      });
    }
  } else {
    const singleCall = decodeSingleToolCall(detected.host, raw);
    if (singleCall) decodedCalls = [singleCall];
  }
  for (const call of decodedCalls) {
    issues.push(...call.issues);
  }
  const deduped = dedupeCanonicalToolCalls(decodedCalls);
  issues.push(...deduped.issues);
  const canonicalHookType = inferHookType(raw, hookType);
  const sessionId = detected.host === "claude" ? stringField(raw, "session_id") ?? stringField(raw, "sessionId") ?? stringField(raw, "sessionid") : stringField(raw, "sessionId") ?? stringField(raw, "session_id") ?? stringField(raw, "sessionid");
  const directory = stringField(raw, "cwd") ?? stringField(raw, "directory");
  const rawTranscriptPath = detected.host === "claude" ? stringField(raw, "transcript_path") ?? stringField(raw, "transcriptPath") : stringField(raw, "transcriptPath") ?? stringField(raw, "transcript_path");
  const transcriptPath = resolveTranscriptPath(rawTranscriptPath, directory);
  const stopReason = detected.host === "claude" ? stringField(raw, "stop_reason") ?? stringField(raw, "stopReason") : stringField(raw, "stopReason") ?? stringField(raw, "stop_reason");
  const agentId = stringField(raw, "agent_id") ?? stringField(raw, "agentId");
  const agentName = detected.host === "claude" ? stringField(raw, "agent_type") ?? stringField(raw, "agent_name") ?? stringField(raw, "agentName") : stringField(raw, "agentName") ?? stringField(raw, "agent_type") ?? stringField(raw, "agent_name");
  const agentDisplayName = stringField(raw, "agentDisplayName") ?? stringField(raw, "agent_display_name");
  const agentDescription = stringField(raw, "agentDescription") ?? stringField(raw, "agent_description");
  let agent;
  if (agentId || agentName || agentDisplayName || agentDescription) {
    agent = {
      ...agentId ? { id: agentId } : {},
      ...agentName ? { name: agentName } : {},
      ...agentDisplayName ? { displayName: agentDisplayName } : {},
      ...agentDescription ? { description: agentDescription } : {},
      correlation: agentId ? "host-id" : "unavailable"
    };
  }
  const hostDecision = detected.host === "copilot" && canonicalHookType === "permission-request" ? void 0 : normalizeHostDecision(raw.hostDecision) ?? normalizeHostDecision(raw.nativeDecision);
  return {
    ...detected,
    hookType: canonicalHookType,
    sessionId,
    directory,
    transcriptPath,
    stopReason,
    eventPayload: normalizeEventPayload(raw, detected.host, canonicalHookType),
    originalCallCount: decodedCalls.length,
    logicalCallCount: deduped.calls.length,
    toolCalls: deduped.calls,
    agent,
    issues,
    hostDecision
  };
}
var SENSITIVE_HOOKS = /* @__PURE__ */ new Set([
  "permission-request",
  "setup-init",
  "setup-maintenance",
  "session-end"
]);
var KNOWN_FIELDS = /* @__PURE__ */ new Set([
  // Core normalized fields
  "sessionId",
  "toolName",
  "toolInput",
  "toolOutput",
  "directory",
  "prompt",
  "message",
  "parts",
  "hookEventName",
  // Stop hook fields
  "stop_reason",
  "stopReason",
  "user_requested",
  "userRequested",
  // Permission hook fields
  "permission_mode",
  "tool_use_id",
  "transcript_path",
  // Subagent fields
  "agent_id",
  "agent_name",
  "agent_type",
  "parent_session_id",
  "agentName",
  "model",
  "model_id",
  "modelId",
  // Common extra fields from Claude Code
  "input",
  "output",
  "result",
  "error",
  "status",
  // Session-end fields
  "reason"
]);
var CAMEL_CASE_MARKERS = /* @__PURE__ */ new Set(["sessionId", "toolName", "directory"]);
function hasSnakeCaseKeys(obj) {
  for (const key of Object.keys(obj)) {
    if (key.includes("_")) return true;
  }
  return false;
}
function isAlreadyCamelCase(obj) {
  let hasMarker = false;
  for (const marker of CAMEL_CASE_MARKERS) {
    if (marker in obj) {
      hasMarker = true;
      break;
    }
  }
  if (!hasMarker) return false;
  return !hasSnakeCaseKeys(obj);
}
function normalizeHookInput(raw, hookType) {
  if (typeof raw !== "object" || raw === null) {
    return {};
  }
  const rawObj = raw;
  if (isAlreadyCamelCase(rawObj)) {
    const passthrough = filterPassthrough(rawObj, hookType);
    if (passthrough.transcript_path) {
      passthrough.transcript_path = resolveTranscriptPath(
        passthrough.transcript_path,
        rawObj.directory
      );
    }
    return {
      sessionId: rawObj.sessionId,
      toolName: rawObj.toolName,
      toolInput: rawObj.toolInput,
      toolOutput: rawObj.toolOutput ?? rawObj.toolResponse,
      directory: rawObj.directory,
      prompt: rawObj.prompt,
      message: rawObj.message,
      parts: rawObj.parts,
      ...passthrough
    };
  }
  const parsed = HookInputSchema.safeParse(raw);
  if (!parsed.success) {
    console.error("[bridge-normalize] Zod validation warning:", parsed.error.issues.map((i) => i.message).join(", "));
  }
  const input = parsed.success ? parsed.data : raw;
  const extraFields = filterPassthrough(input, hookType);
  if (extraFields.transcript_path) {
    extraFields.transcript_path = resolveTranscriptPath(
      extraFields.transcript_path,
      input.cwd ?? input.directory
    );
  }
  return {
    sessionId: input.session_id ?? input.sessionId,
    toolName: input.tool_name ?? input.toolName,
    toolInput: input.tool_input ?? input.toolInput,
    // tool_response maps to toolOutput for backward compatibility
    toolOutput: input.tool_response ?? input.toolOutput ?? input.toolResponse,
    directory: input.cwd ?? input.directory,
    prompt: input.prompt,
    message: input.message,
    parts: input.parts,
    // Pass through extra fields with sensitivity filtering
    ...extraFields
  };
}
function filterPassthrough(input, hookType) {
  const MAPPED_KEYS = /* @__PURE__ */ new Set([
    "tool_name",
    "toolName",
    "tool_input",
    "toolInput",
    "tool_response",
    "toolOutput",
    "toolResponse",
    "session_id",
    "sessionId",
    "cwd",
    "directory",
    "hook_event_name",
    "hookEventName",
    "prompt",
    "message",
    "parts"
  ]);
  const isSensitive = hookType != null && SENSITIVE_HOOKS.has(hookType);
  const extra = {};
  for (const [key, value] of Object.entries(input)) {
    if (MAPPED_KEYS.has(key) || value === void 0) continue;
    if (isSensitive) {
      if (KNOWN_FIELDS.has(key)) {
        extra[key] = value;
      }
    } else {
      extra[key] = value;
      if (!KNOWN_FIELDS.has(key)) {
        console.error(`[bridge-normalize] Unknown field "${key}" passed through for hook "${hookType ?? "unknown"}"`);
      }
    }
  }
  return extra;
}

// src/hooks/hook-output.ts
var COPILOT_CONTEXT_OUTPUT_EVENTS = /* @__PURE__ */ new Set([
  "notification",
  "posttooluse",
  "posttoolusefailure",
  "sessionstart",
  "subagentstart",
  "userpromptsubmit"
]);
var CLAUDE_CONTEXT_EVENT_NAMES = {
  posttooluse: "PostToolUse",
  posttoolusefailure: "PostToolUseFailure",
  sessionstart: "SessionStart",
  setupinit: "Setup",
  setupmaintenance: "Setup",
  subagentstart: "SubagentStart",
  userpromptsubmit: "UserPromptSubmit"
};
function normalizeEventName(hookType) {
  return hookType.replace(/[^a-z]/gi, "").toLowerCase();
}
function canEncodeHookMutation(envelope, decision) {
  const eventName = normalizeEventName(envelope.hookType);
  if (eventName === "pretooluse") return decision !== "deny";
  return envelope.host === "claude" && eventName === "permissionrequest" && decision === "allow";
}
function nonEmptyText(value) {
  return value && value.trim().length > 0 ? value : void 0;
}
function encodedDecisionReason(reduction, fallback) {
  return nonEmptyText(reduction.reason) ?? fallback;
}
function singletonMutationInput(envelope, reduction) {
  const logicalCallCount = Number.isInteger(envelope.logicalCallCount) ? envelope.logicalCallCount : envelope.toolCalls.length;
  if (logicalCallCount !== 1 || !envelope.capabilities.singletonMutationOutput || reduction.mutations.length !== 1) {
    return void 0;
  }
  const mutation = reduction.mutations[0];
  return mutation.input;
}
function encodeStopOutput(reduction) {
  if (reduction.decision !== "deny") return {};
  return {
    decision: "block",
    reason: encodedDecisionReason(
      reduction,
      "Hook requested another agent turn."
    )
  };
}
function encodeCopilotPreToolUseOutput(envelope, reduction) {
  const output = {};
  if (reduction.decision !== "pass") {
    output.permissionDecision = reduction.decision;
    if (reduction.decision === "deny" || reduction.decision === "ask") {
      output.permissionDecisionReason = encodedDecisionReason(
        reduction,
        reduction.decision === "deny" ? "Hook denied this tool call." : "Hook requires confirmation for this tool call."
      );
    }
  }
  const mutation = canEncodeHookMutation(envelope, reduction.decision) ? singletonMutationInput(envelope, reduction) : void 0;
  if (mutation) output.modifiedArgs = mutation;
  const context = nonEmptyText(reduction.context);
  if (context) output.additionalContext = context;
  return output;
}
function encodeCopilotPermissionRequestOutput(reduction) {
  if (reduction.decision === "allow") {
    return { behavior: "allow" };
  }
  if (reduction.decision === "deny") {
    return {
      behavior: "deny",
      message: encodedDecisionReason(
        reduction,
        "Hook denied this permission request."
      )
    };
  }
  return {};
}
function encodeCopilotHookOutput(envelope, reduction) {
  const eventName = normalizeEventName(envelope.hookType);
  if (eventName === "pretooluse") {
    return encodeCopilotPreToolUseOutput(envelope, reduction);
  }
  if (eventName === "agentstop" || eventName === "stop" || eventName === "subagentstop") {
    return encodeStopOutput(reduction);
  }
  if (eventName === "permissionrequest") {
    return encodeCopilotPermissionRequestOutput(reduction);
  }
  const context = nonEmptyText(reduction.context);
  return context && COPILOT_CONTEXT_OUTPUT_EVENTS.has(eventName) ? { additionalContext: context } : {};
}
function encodeClaudePreToolUseOutput(envelope, reduction) {
  const hookSpecificOutput = {
    hookEventName: "PreToolUse"
  };
  if (reduction.decision !== "pass") {
    hookSpecificOutput.permissionDecision = reduction.decision;
    if (reduction.decision === "deny" || reduction.decision === "ask") {
      hookSpecificOutput.permissionDecisionReason = encodedDecisionReason(
        reduction,
        reduction.decision === "deny" ? "Hook denied this tool call." : "Hook requires confirmation for this tool call."
      );
    }
  }
  const mutation = canEncodeHookMutation(envelope, reduction.decision) ? singletonMutationInput(envelope, reduction) : void 0;
  if (mutation) hookSpecificOutput.updatedInput = mutation;
  const context = nonEmptyText(reduction.context);
  if (context) hookSpecificOutput.additionalContext = context;
  return Object.keys(hookSpecificOutput).length === 1 ? {} : {
    continue: true,
    hookSpecificOutput
  };
}
function encodeClaudePermissionRequestOutput(envelope, reduction) {
  if (reduction.decision !== "allow" && reduction.decision !== "deny") {
    return {};
  }
  const decision = {
    behavior: reduction.decision
  };
  if (reduction.decision === "allow") {
    const mutation = canEncodeHookMutation(envelope, reduction.decision) ? singletonMutationInput(envelope, reduction) : void 0;
    if (mutation) decision.updatedInput = mutation;
  } else {
    decision.message = encodedDecisionReason(
      reduction,
      "Hook denied this permission request."
    );
  }
  return {
    continue: true,
    hookSpecificOutput: {
      hookEventName: "PermissionRequest",
      decision
    }
  };
}
function encodeClaudeHookOutput(envelope, reduction) {
  const eventName = normalizeEventName(envelope.hookType);
  if (eventName === "pretooluse") {
    return encodeClaudePreToolUseOutput(envelope, reduction);
  }
  if (eventName === "agentstop" || eventName === "stop" || eventName === "subagentstop") {
    return encodeStopOutput(reduction);
  }
  if (eventName === "permissionrequest") {
    return encodeClaudePermissionRequestOutput(envelope, reduction);
  }
  const hookEventName = CLAUDE_CONTEXT_EVENT_NAMES[eventName];
  const context = nonEmptyText(reduction.context);
  return hookEventName && context ? {
    continue: true,
    hookSpecificOutput: {
      hookEventName,
      additionalContext: context
    }
  } : {};
}
function encodeHookOutput(envelope, reduction) {
  return envelope.host === "copilot" ? encodeCopilotHookOutput(envelope, reduction) : encodeClaudeHookOutput(envelope, reduction);
}

// src/hooks/hook-runtime.ts
var MAX_HOOK_CONTEXT_MESSAGES = 8;
var MAX_HOOK_CONTEXT_CHARACTERS = 6e3;
var PERMISSION_SENSITIVE_EVENTS = /* @__PURE__ */ new Set([
  "permissionrequest",
  "pretooluse"
]);
var READ_ONLY_CANONICAL_TOOLS = /* @__PURE__ */ new Set([
  "Glob",
  "Grep",
  "Read",
  "WebFetch",
  "WebSearch"
]);
function isRecord2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isPlainObject(value) {
  if (!isRecord2(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}
function normalizeEventName2(hookType) {
  return hookType.replace(/[^a-z]/gi, "").toLowerCase();
}
function isPermissionSensitiveEvent(hookType) {
  return PERMISSION_SENSITIVE_EVENTS.has(normalizeEventName2(hookType));
}
function isDecision(value) {
  return value === "pass" || value === "allow" || value === "ask" || value === "deny";
}
function normalizeDecision(value) {
  if (value === "block") return "deny";
  return isDecision(value) ? value : void 0;
}
function isEvaluationSource(value) {
  return value === "host" || value === "adapter" || value === "handler";
}
function adapterDenyEvaluation(detail, fallbackCallId) {
  return {
    ...fallbackCallId ? { callId: fallbackCallId } : {},
    source: "adapter",
    decision: "deny",
    reason: `Malformed hook evaluation: ${detail}`,
    contexts: [],
    effects: []
  };
}
function validateEffects(value) {
  if (!Array.isArray(value)) {
    throw new TypeError("effects must be an array");
  }
  return value.map((effect, index) => {
    if (!isRecord2(effect)) {
      throw new TypeError(`effects[${index}] must be an object`);
    }
    if (typeof effect.type !== "string" || effect.type.trim().length === 0) {
      throw new TypeError(`effects[${index}].type must be a non-empty string`);
    }
    if (hasOwn2(effect, "callId") && effect.callId !== void 0 && (typeof effect.callId !== "string" || effect.callId.trim().length === 0)) {
      throw new TypeError(`effects[${index}].callId must be a non-empty string`);
    }
    if (hasOwn2(effect, "commitOn") && effect.commitOn !== void 0 && effect.commitOn !== "accepted" && effect.commitOn !== "always") {
      throw new TypeError(`effects[${index}].commitOn is invalid`);
    }
    if (hasOwn2(effect, "critical") && effect.critical !== void 0 && typeof effect.critical !== "boolean") {
      throw new TypeError(`effects[${index}].critical must be boolean`);
    }
    return {
      type: effect.type,
      ...hasOwn2(effect, "payload") ? { payload: effect.payload } : {},
      ...typeof effect.callId === "string" ? { callId: effect.callId } : {},
      ...effect.commitOn === "accepted" || effect.commitOn === "always" ? { commitOn: effect.commitOn } : {},
      ...typeof effect.critical === "boolean" ? { critical: effect.critical } : {}
    };
  });
}
function sanitizeHookEvaluation(value, fallbackCallId) {
  try {
    if (!isRecord2(value)) {
      return adapterDenyEvaluation("evaluation must be an object", fallbackCallId);
    }
    if (!isDecision(value.decision)) {
      return adapterDenyEvaluation("decision is missing or invalid", fallbackCallId);
    }
    let callId = fallbackCallId;
    if (hasOwn2(value, "callId") && value.callId !== void 0) {
      if (typeof value.callId !== "string" || value.callId.trim().length === 0) {
        return adapterDenyEvaluation("callId must be a non-empty string", fallbackCallId);
      }
      callId = value.callId;
    }
    let source = "handler";
    if (hasOwn2(value, "source") && value.source !== void 0) {
      if (!isEvaluationSource(value.source)) {
        return adapterDenyEvaluation("source is invalid", callId);
      }
      source = value.source;
    }
    let reason;
    if (hasOwn2(value, "reason") && value.reason !== void 0) {
      if (typeof value.reason !== "string") {
        return adapterDenyEvaluation("reason must be a string", callId);
      }
      reason = value.reason;
    }
    let contexts = [];
    if (hasOwn2(value, "contexts") && value.contexts !== void 0) {
      if (!Array.isArray(value.contexts) || value.contexts.some((context) => typeof context !== "string")) {
        return adapterDenyEvaluation("contexts must be an array of strings", callId);
      }
      contexts = [...value.contexts];
    }
    let mutation;
    if (hasOwn2(value, "mutation") && value.mutation !== void 0) {
      const rawMutation = value.mutation;
      if (!isRecord2(rawMutation) || !hasOwn2(rawMutation, "input") || rawMutation.requirement !== "optional" && rawMutation.requirement !== "required") {
        return adapterDenyEvaluation(
          "mutation must contain input and a valid requirement",
          callId
        );
      }
      let retryHint;
      if (rawMutation.retryHint !== void 0) {
        if (!isRecord2(rawMutation.retryHint) || typeof rawMutation.retryHint.instruction !== "string" || rawMutation.retryHint.instruction.trim().length === 0 || rawMutation.retryHint.patch !== void 0 && !isPlainObject(rawMutation.retryHint.patch)) {
          return adapterDenyEvaluation(
            "mutation.retryHint must contain a non-empty instruction and optional plain-object patch",
            callId
          );
        }
        retryHint = {
          instruction: rawMutation.retryHint.instruction,
          ...rawMutation.retryHint.patch !== void 0 ? { patch: rawMutation.retryHint.patch } : {}
        };
      }
      mutation = {
        input: rawMutation.input,
        requirement: rawMutation.requirement,
        ...retryHint ? { retryHint } : {}
      };
    }
    let effects = [];
    if (hasOwn2(value, "effects") && value.effects !== void 0) {
      try {
        effects = validateEffects(value.effects);
      } catch (error) {
        const detail = formatUnknownError(error);
        return adapterDenyEvaluation(detail, callId);
      }
    }
    return {
      ...callId ? { callId } : {},
      source,
      decision: value.decision,
      ...reason !== void 0 ? { reason } : {},
      ...mutation ? { mutation } : {},
      contexts,
      effects
    };
  } catch (error) {
    const detail = formatUnknownError(error);
    return adapterDenyEvaluation(`validation failed: ${detail}`, fallbackCallId);
  }
}
function firstReason(candidates, decision) {
  return candidates.find((candidate) => candidate.decision === decision)?.reason;
}
function aggregateDecision(candidates) {
  if (candidates.some(({ decision }) => decision === "deny")) return "deny";
  if (candidates.some(({ decision }) => decision === "ask")) return "ask";
  const hasAllow = candidates.some(({ decision }) => decision === "allow");
  const hasPass = candidates.some(({ decision }) => decision === "pass");
  return hasAllow && !hasPass ? "allow" : "pass";
}
function normalizationSafetyIssue(envelope) {
  const batchIssue = envelope.issues.find(
    (issue) => issue.batchSafety || issue.scope === "batch" && issue.severity === "safety"
  );
  if (batchIssue) return batchIssue;
  if (!isPermissionSensitiveEvent(envelope.hookType)) return void 0;
  return envelope.issues.find((issue) => {
    if (issue.severity !== "safety") return false;
    if (issue.code !== "malformed-tool-args") return true;
    const call = envelope.toolCalls.find(
      (candidate) => candidate.originalIndex === issue.originalIndex || candidate.id === issue.callId
    );
    return !call || !READ_ONLY_CANONICAL_TOOLS.has(call.canonicalName);
  });
}
function mutationRepresentationIssue(envelope, decision, callId, input) {
  if (!canEncodeHookMutation(envelope, decision)) {
    return `${envelope.host} ${envelope.hookType} output for decision "${decision}" does not encode input mutation`;
  }
  const logicalCallCount = Number.isInteger(envelope.logicalCallCount) ? envelope.logicalCallCount : envelope.toolCalls.length;
  if (logicalCallCount > 1) {
    if (!callId || !envelope.capabilities.correlatedMutationOutput) {
      return "correlated multi-call mutation output is unsupported";
    }
    if (!envelope.toolCalls.some((call) => call.id === callId)) {
      return `callId "${callId}" does not identify a logical call in the batch`;
    }
  } else {
    if (logicalCallCount !== 1) {
      return "mutation output requires exactly one logical call";
    }
    if (!envelope.capabilities.singletonMutationOutput) {
      return "singleton mutation output is unsupported";
    }
    if (callId) {
      const onlyCall = envelope.toolCalls[0];
      if (!onlyCall || callId !== onlyCall.id) {
        const expectedCall = onlyCall ? `"${onlyCall.id}"` : "the sole logical call";
        return `callId "${callId}" does not match ${expectedCall}`;
      }
    }
  }
  return isPlainObject(input) ? void 0 : "replacement input must be a plain object";
}
function normalizeEffects(evaluations) {
  return evaluations.flatMap(
    (evaluation) => (evaluation.effects ?? []).map((effect) => ({
      ...effect,
      callId: effect.callId ?? evaluation.callId,
      commitOn: effect.commitOn ?? "accepted",
      critical: effect.critical ?? false
    }))
  );
}
function allLogicalCallsExplicitlyAllowed(envelope, evaluations) {
  const logicalCallCount = Number.isInteger(envelope.logicalCallCount) ? envelope.logicalCallCount : envelope.toolCalls.length;
  if (logicalCallCount === 0 || envelope.toolCalls.length !== logicalCallCount || envelope.toolCalls.some((call) => call.malformed)) {
    return false;
  }
  const allowedCallIds = new Set(
    evaluations.filter(
      (evaluation) => evaluation.decision === "allow" && typeof evaluation.callId === "string"
    ).map((evaluation) => evaluation.callId)
  );
  return envelope.toolCalls.every((call) => allowedCallIds.has(call.id));
}
function adapterReductionFailure(error) {
  const detail = formatUnknownError(error);
  const reason = `Hook reduction failed safely: ${detail}`;
  const callDecision = {
    source: "adapter",
    decision: "deny",
    reason
  };
  return {
    decision: "deny",
    reason,
    retry: false,
    unchanged: true,
    contexts: [],
    diagnostics: [],
    mutations: [],
    mutationRetryHints: [],
    callDecisions: [callDecision],
    effects: [],
    stagedEffects: []
  };
}
function boundHookContexts(messages, maxMessages = MAX_HOOK_CONTEXT_MESSAGES, maxCharacters = MAX_HOOK_CONTEXT_CHARACTERS) {
  if (maxMessages <= 0 || maxCharacters <= 0) return [];
  const bounded = [];
  const seen = /* @__PURE__ */ new Set();
  let usedCharacters = 0;
  for (const rawMessage of messages) {
    const message = rawMessage.trim();
    if (!message || seen.has(message) || bounded.length >= maxMessages) continue;
    seen.add(message);
    const separatorLength = bounded.length > 0 ? 2 : 0;
    const remaining = maxCharacters - usedCharacters - separatorLength;
    if (remaining <= 0) break;
    let nextMessage = message;
    let truncated = false;
    if (nextMessage.length > remaining) {
      if (remaining === 1) {
        nextMessage = "\u2026";
      } else {
        nextMessage = `${nextMessage.slice(0, remaining - 1)}\u2026`;
      }
      truncated = true;
    }
    bounded.push(nextMessage);
    usedCharacters += separatorLength + nextMessage.length;
    if (truncated) break;
  }
  return bounded;
}
function reduceHookEvaluations(envelope, evaluations) {
  try {
    return reduceHookEvaluationsInternal(envelope, evaluations);
  } catch (error) {
    return adapterReductionFailure(error);
  }
}
function reduceHookEvaluationsInternal(envelope, evaluations) {
  const normalizedEvaluations = evaluations.map(
    (evaluation, index) => sanitizeHookEvaluation(
      evaluation,
      envelope.toolCalls[index]?.id
    )
  );
  const decisionCandidates = [];
  if (envelope.hostDecision) {
    decisionCandidates.push({
      source: "host",
      decision: envelope.hostDecision.decision,
      reason: envelope.hostDecision.reason
    });
  }
  for (const evaluation of normalizedEvaluations) {
    decisionCandidates.push({
      callId: evaluation.callId,
      source: evaluation.source ?? "handler",
      decision: evaluation.decision,
      reason: evaluation.reason
    });
  }
  const callDecisions = decisionCandidates.map((candidate) => ({
    ...candidate
  }));
  const safetyIssue = normalizationSafetyIssue(envelope);
  const immutableHostDeny = decisionCandidates.find(
    ({ source, decision: decision2 }) => source === "host" && decision2 === "deny"
  );
  const logicalCallCount = Number.isInteger(envelope.logicalCallCount) ? envelope.logicalCallCount : envelope.toolCalls.length;
  const emptyPermissionEnvelope = isPermissionSensitiveEvent(envelope.hookType) && logicalCallCount === 0;
  let decision = aggregateDecision(decisionCandidates);
  let reason = decision === "deny" ? firstReason(decisionCandidates, "deny") : decision === "ask" ? firstReason(decisionCandidates, "ask") : void 0;
  let retry = false;
  const diagnostics = [];
  const mutations = [];
  const mutationRetryHints = [];
  if (safetyIssue) {
    decision = "deny";
    reason = safetyIssue.message;
  } else if (emptyPermissionEnvelope) {
    decision = "deny";
    reason = "Permission-sensitive hook envelope contains no logical tool calls.";
  } else if (immutableHostDeny) {
    decision = "deny";
    reason = immutableHostDeny.reason ?? "The host denied this hook operation.";
  }
  const correlationUnavailable = logicalCallCount > 1 && !envelope.capabilities.correlatedDecisionOutput;
  if (decision === "ask" && correlationUnavailable) {
    const askReason = reason ? `${reason} ` : "";
    decision = "deny";
    retry = true;
    reason = `${askReason}This host cannot correlate confirmation to one call in the batch; retry or confirm the calls separately.`;
  }
  if (decision === "allow" && !allLogicalCallsExplicitlyAllowed(envelope, normalizedEvaluations)) {
    decision = "pass";
    diagnostics.push(
      "Aggregate allow was reduced to pass because not every logical tool call was explicitly evaluated and allowed."
    );
  }
  let discardedOptionalMutation = false;
  const mutationDecision = decision;
  const requiredMutationReasons = [];
  for (const evaluation of normalizedEvaluations) {
    if (!evaluation.mutation) continue;
    const representationIssue = mutationRepresentationIssue(
      envelope,
      mutationDecision,
      evaluation.callId,
      evaluation.mutation.input
    );
    if (!representationIssue) {
      mutations.push({
        callId: evaluation.callId,
        input: evaluation.mutation.input,
        requirement: evaluation.mutation.requirement,
        ...evaluation.mutation.retryHint ? { retryHint: evaluation.mutation.retryHint } : {}
      });
      continue;
    }
    const callLabel = evaluation.callId ? ` for call "${evaluation.callId}"` : "";
    if (evaluation.mutation.requirement === "required") {
      retry = true;
      const retryInstruction = evaluation.mutation.retryHint?.instruction;
      if (evaluation.mutation.retryHint) {
        mutationRetryHints.push({
          ...evaluation.callId ? { callId: evaluation.callId } : {},
          ...evaluation.mutation.retryHint
        });
      }
      const mutationReason = `Required input mutation${callLabel} cannot be represented by ${envelope.contract} because ${representationIssue}; ` + (retryInstruction ? `retry with this exact per-call patch: ${retryInstruction}.` : "retry the call separately with the required input changes.");
      requiredMutationReasons.push(mutationReason);
      diagnostics.push(mutationReason);
      continue;
    }
    discardedOptionalMutation = true;
    diagnostics.push(
      `Optional input mutation${callLabel} was not applied because ${envelope.contract} cannot represent it: ${representationIssue}; the original input will be used.`
    );
  }
  if (requiredMutationReasons.length > 0) {
    decision = "deny";
    reason = [
      reason,
      ...requiredMutationReasons
    ].filter(Boolean).join(" ");
    mutations.length = 0;
  }
  if (discardedOptionalMutation && decision !== "deny" && decision !== "ask") {
    decision = "pass";
    mutations.length = 0;
  }
  const boundedDiagnostics = boundHookContexts(diagnostics);
  const contexts = boundHookContexts([
    ...normalizedEvaluations.flatMap((evaluation) => evaluation.contexts ?? []),
    ...boundedDiagnostics
  ]);
  const allEffects = normalizeEffects(normalizedEvaluations);
  const accepted2 = decision === "pass" || decision === "allow";
  const stagedEffects = allEffects.filter(
    (effect) => effect.commitOn === "always" || accepted2
  );
  return {
    decision,
    reason,
    retry,
    unchanged: mutations.length === 0,
    contexts,
    context: contexts.length > 0 ? contexts.join("\n\n") : void 0,
    diagnostics: boundedDiagnostics,
    mutations,
    mutationRetryHints,
    callDecisions,
    effects: stagedEffects,
    stagedEffects
  };
}
function interpretLegacyOutput(_hookType, output) {
  try {
    if (!isRecord2(output)) {
      return adapterDenyEvaluation("processor output must be an object");
    }
    const recognized = [
      "continue",
      "suppressOutput",
      "hookSpecificOutput",
      "decision",
      "message",
      "systemMessage",
      "modifiedInput",
      "effects"
    ].some((key) => hasOwn2(output, key));
    if (!recognized) {
      return adapterDenyEvaluation("processor output has no recognized fields");
    }
    if (hasOwn2(output, "continue") && output.continue !== void 0 && typeof output.continue !== "boolean") {
      return adapterDenyEvaluation("continue must be boolean");
    }
    if (hasOwn2(output, "suppressOutput") && output.suppressOutput !== void 0 && typeof output.suppressOutput !== "boolean") {
      return adapterDenyEvaluation("suppressOutput must be boolean");
    }
    if (hasOwn2(output, "reason") && output.reason !== void 0 && typeof output.reason !== "string") {
      return adapterDenyEvaluation("reason must be a string");
    }
    if (hasOwn2(output, "mutationRequirement") && output.mutationRequirement !== void 0 && output.mutationRequirement !== "optional" && output.mutationRequirement !== "required") {
      return adapterDenyEvaluation("mutationRequirement is invalid");
    }
    let hookSpecificOutput = {};
    if (hasOwn2(output, "hookSpecificOutput") && output.hookSpecificOutput !== void 0) {
      if (!isRecord2(output.hookSpecificOutput)) {
        return adapterDenyEvaluation("hookSpecificOutput must be an object");
      }
      hookSpecificOutput = output.hookSpecificOutput;
    }
    let nestedDecision = {};
    if (hasOwn2(hookSpecificOutput, "decision") && hookSpecificOutput.decision !== void 0) {
      if (!isRecord2(hookSpecificOutput.decision)) {
        return adapterDenyEvaluation("hookSpecificOutput.decision must be an object");
      }
      nestedDecision = hookSpecificOutput.decision;
    }
    for (const [container, key, label] of [
      [output, "message", "message"],
      [output, "systemMessage", "systemMessage"],
      [hookSpecificOutput, "additionalContext", "hookSpecificOutput.additionalContext"],
      [hookSpecificOutput, "permissionDecisionReason", "permissionDecisionReason"],
      [nestedDecision, "reason", "hookSpecificOutput.decision.reason"]
    ]) {
      if (hasOwn2(container, key) && container[key] !== void 0 && typeof container[key] !== "string") {
        return adapterDenyEvaluation(`${label} must be a string`);
      }
    }
    const candidates = [];
    if (output.continue === false) {
      candidates.push({
        source: "handler",
        decision: "deny",
        reason: typeof output.reason === "string" ? output.reason : typeof output.message === "string" ? output.message : void 0
      });
    }
    if (hasOwn2(hookSpecificOutput, "permissionDecision") && hookSpecificOutput.permissionDecision !== void 0) {
      const permissionDecision = normalizeDecision(hookSpecificOutput.permissionDecision);
      if (!permissionDecision) {
        return adapterDenyEvaluation("permissionDecision is invalid");
      }
      candidates.push({
        source: "handler",
        decision: permissionDecision,
        reason: typeof hookSpecificOutput.permissionDecisionReason === "string" ? hookSpecificOutput.permissionDecisionReason : void 0
      });
    }
    if (hasOwn2(nestedDecision, "behavior") && nestedDecision.behavior !== void 0) {
      const behaviorDecision = normalizeDecision(nestedDecision.behavior);
      if (!behaviorDecision) {
        return adapterDenyEvaluation("hookSpecificOutput.decision.behavior is invalid");
      }
      candidates.push({
        source: "handler",
        decision: behaviorDecision,
        reason: typeof nestedDecision.reason === "string" ? nestedDecision.reason : void 0
      });
    }
    if (hasOwn2(output, "decision") && output.decision !== void 0) {
      const rootDecision = normalizeDecision(output.decision);
      if (!rootDecision) {
        return adapterDenyEvaluation("decision is invalid");
      }
      candidates.push({
        source: "handler",
        decision: rootDecision,
        reason: typeof output.reason === "string" ? output.reason : void 0
      });
    }
    const decision = aggregateDecision(candidates);
    const reason = decision === "deny" ? firstReason(candidates, "deny") : decision === "ask" ? firstReason(candidates, "ask") : void 0;
    const hasNestedUpdatedInput = hasOwn2(nestedDecision, "updatedInput");
    const hasHookUpdatedInput = hasOwn2(hookSpecificOutput, "updatedInput");
    const hasRootModifiedInput = hasOwn2(output, "modifiedInput");
    const hasUpdatedInput = hasNestedUpdatedInput || hasHookUpdatedInput || hasRootModifiedInput;
    const updatedInput = hasNestedUpdatedInput ? nestedDecision.updatedInput : hasHookUpdatedInput ? hookSpecificOutput.updatedInput : output.modifiedInput;
    const mutationRequirement = hasNestedUpdatedInput || output.mutationRequirement === "required" ? "required" : "optional";
    const contexts = [
      output.message,
      output.systemMessage,
      hookSpecificOutput.additionalContext
    ].filter((value) => typeof value === "string");
    return sanitizeHookEvaluation({
      source: "handler",
      decision,
      ...reason !== void 0 ? { reason } : {},
      ...hasUpdatedInput ? {
        mutation: {
          input: updatedInput,
          requirement: mutationRequirement
        }
      } : {},
      contexts,
      effects: hasOwn2(output, "effects") ? output.effects : []
    });
  } catch (error) {
    const detail = formatUnknownError(error);
    return adapterDenyEvaluation(`legacy output validation failed: ${detail}`);
  }
}
function hasOwn2(input, key) {
  return Object.prototype.hasOwnProperty.call(input, key);
}
function hasBatchSafetyIssue(envelope) {
  return envelope.issues.some(
    (issue) => issue.batchSafety || issue.scope === "batch" && issue.severity === "safety"
  );
}
function isCanonicalEvaluationOutput(value) {
  return isRecord2(value) && hasOwn2(value, "decision") && isDecision(value.decision) && !hasOwn2(value, "continue") && !hasOwn2(value, "hookSpecificOutput");
}
async function runHookPayload(hookType, raw, processor) {
  let envelope;
  try {
    envelope = normalizeHookEnvelope(raw, hookType);
  } catch (error) {
    const detail = formatUnknownError(error);
    envelope = {
      host: "claude",
      contract: "claude-single",
      hookType,
      eventPayload: {},
      originalCallCount: 0,
      logicalCallCount: 0,
      toolCalls: [],
      capabilities: CLAUDE_SINGLE_CAPABILITIES,
      issues: [{
        code: "invalid-envelope",
        message: `Hook input normalization failed safely: ${detail}`,
        severity: "safety",
        scope: "batch",
        batchSafety: true
      }]
    };
  }
  const evaluations = [];
  if (!hasBatchSafetyIssue(envelope)) {
    const validCalls = envelope.toolCalls.filter((call) => !call.malformed);
    const units = envelope.toolCalls.length === 0 ? isPermissionSensitiveEvent(envelope.hookType) ? [] : [{ originalIndex: 0, input: envelope }] : validCalls.map((call) => ({
      call,
      callId: call.id,
      originalIndex: call.originalIndex,
      input: call.input
    }));
    for (const unit of units) {
      try {
        const output = await processor(unit, envelope);
        const evaluation = isCanonicalEvaluationOutput(output) ? sanitizeHookEvaluation(output, unit.callId) : interpretLegacyOutput(hookType, output);
        evaluations.push(sanitizeHookEvaluation(evaluation, unit.callId));
      } catch (error) {
        const message = formatUnknownError(error);
        evaluations.push({
          callId: unit.callId,
          source: "adapter",
          decision: "deny",
          reason: `Hook processor failed: ${message}`,
          contexts: [],
          effects: []
        });
      }
    }
  }
  return {
    envelope,
    evaluations,
    reduction: reduceHookEvaluations(envelope, evaluations)
  };
}
async function runHookJson(hookType, json, processor) {
  let raw;
  try {
    raw = JSON.parse(json);
  } catch {
    raw = json;
  }
  return runHookPayload(hookType, raw, processor);
}

// src/hooks/pre-tool-enforcer/snapshot.ts
var import_node_crypto = require("node:crypto");
var import_node_fs = require("node:fs");
var import_node_os = require("node:os");
var import_node_path = require("node:path");
init_worktree_paths();

// src/utils/jsonc.ts
function parseJsonc(content) {
  const cleaned = stripJsoncComments(content);
  return JSON.parse(cleaned);
}
function stripJsoncComments(content) {
  return stripTrailingCommas(stripComments(content));
}
function stripComments(content) {
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

// src/hooks/pre-tool-enforcer/types.ts
var PRE_TOOL_SNAPSHOT_VERSION = 1;
var PRE_TOOL_EFFECT_PAYLOAD_VERSION = 1;
var PRE_TOOL_MAX_FUTURE_SKEW_MS = 5 * 60 * 1e3;
var PRE_TOOL_MIN_EPOCH_MS = Date.UTC(2e3, 0, 1);

// src/hooks/pre-tool-enforcer/snapshot.ts
var SESSION_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,255}$/;
var MAX_TRANSCRIPT_BYTES = 25 * 1024 * 1024;
var TRANSCRIPT_TAIL_BYTES = 4096;
var DEFAULT_CONTEXT_THRESHOLD = 72;
var DEFAULT_ADVISORY_COOLDOWN_MS = 5 * 60 * 1e3;
var FORCE_DELEGATION_RETENTION_SECONDS = 60 * 60;
var COPILOT_DEFAULT_MODEL = "gpt-5.6-sol";
var COPILOT_DEFAULT_REASONING_EFFORT = "max";
var COPILOT_REASONING_EFFORTS = /* @__PURE__ */ new Set([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max"
]);
var MODE_STATE_FILES = [
  "autopilot-state.json",
  "ultrapilot-state.json",
  "ralph-state.json",
  "ultragoal-state.json",
  "ultrawork-state.json",
  "ultraqa-state.json",
  "ralplan-state.json",
  "pipeline-state.json",
  "team-state.json",
  "omc-teams-state.json"
];
var ULTRAGOAL_TERMINAL_PHASES = /* @__PURE__ */ new Set([
  "complete",
  "completed",
  "done",
  "all-done",
  "all_done",
  "failed",
  "cancelled",
  "canceled",
  "aborted"
]);
var GOAL_COMMAND_MARKER = /<command-name>\s*\/goal\s*<\/command-name>/;
var GOAL_COMMAND_ARGS = /<command-args>([\s\S]*?)<\/command-args>/;
var GOAL_BEARING_HINT = /\/goal|Goal set|Goal cleared|local-command-stdout/;
var AGENT_CONFIG_KEY_MAP = {
  explore: "explore",
  analyst: "analyst",
  planner: "planner",
  architect: "architect",
  debugger: "debugger",
  executor: "executor",
  verifier: "verifier",
  "security-reviewer": "securityReviewer",
  "code-reviewer": "codeReviewer",
  "test-engineer": "testEngineer",
  designer: "designer",
  writer: "writer",
  "qa-tester": "qaTester",
  scientist: "scientist",
  tracer: "tracer",
  "git-master": "gitMaster",
  "code-simplifier": "codeSimplifier",
  critic: "critic",
  "document-specialist": "documentSpecialist"
};
var DEPRECATED_ROLE_ALIASES = {
  researcher: "document-specialist",
  "tdd-guide": "test-engineer",
  "api-reviewer": "code-reviewer",
  "performance-reviewer": "code-reviewer",
  "dependency-expert": "document-specialist",
  "quality-strategist": "code-reviewer",
  vision: "document-specialist",
  "quality-reviewer": "code-reviewer",
  "deep-executor": "executor",
  "build-fixer": "debugger",
  "harsh-critic": "critic",
  reviewer: "code-reviewer"
};
function isRecord3(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function asRecord(value) {
  return isRecord3(value) ? value : null;
}
function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}
function numberFromEnvironment(value, fallback, minimum = Number.NEGATIVE_INFINITY, maximum = Number.POSITIVE_INFINITY) {
  if (value === void 0 || value === "") return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
}
function timestampFromEnvironment(value, fallback) {
  if (value === void 0 || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= PRE_TOOL_MIN_EPOCH_MS && parsed <= fallback + PRE_TOOL_MAX_FUTURE_SKEW_MS ? parsed : fallback;
}
function resolveHome(environment) {
  return stringValue(environment.USERPROFILE) || stringValue(environment.HOME) || (0, import_node_os.homedir)();
}
function resolveClaudeConfigDirectory(environment) {
  const home = resolveHome(environment);
  const configured = stringValue(environment.CLAUDE_CONFIG_DIR);
  if (!configured) return (0, import_node_path.join)(home, ".claude");
  if (configured === "~") return home;
  if (configured.startsWith("~/") || configured.startsWith("~\\")) {
    return (0, import_node_path.join)(home, configured.slice(2));
  }
  return configured;
}
function resolveUserConfigDirectory(environment) {
  const home = resolveHome(environment);
  if (process.platform === "win32") {
    return stringValue(environment.APPDATA) || (0, import_node_path.join)(home, "AppData", "Roaming");
  }
  return stringValue(environment.XDG_CONFIG_HOME) || (0, import_node_path.join)(home, ".config");
}
function defaultReadText(path3, maxBytes = Number.POSITIVE_INFINITY) {
  let linkStat;
  try {
    linkStat = (0, import_node_fs.lstatSync)(path3);
  } catch {
    return null;
  }
  if (linkStat.isSymbolicLink() || !linkStat.isFile() || linkStat.size > maxBytes) {
    return null;
  }
  let fd = -1;
  try {
    fd = (0, import_node_fs.openSync)(path3, "r");
    const stat = (0, import_node_fs.fstatSync)(fd);
    if (!stat.isFile() || stat.size > maxBytes) return null;
    const buffer = Buffer.allocUnsafe(stat.size);
    let offset = 0;
    while (offset < stat.size) {
      const read = (0, import_node_fs.readSync)(fd, buffer, offset, stat.size - offset, offset);
      if (read <= 0) break;
      offset += read;
    }
    return buffer.toString("utf8", 0, offset);
  } catch {
    return null;
  } finally {
    if (fd !== -1) {
      try {
        (0, import_node_fs.closeSync)(fd);
      } catch {
      }
    }
  }
}
function defaultReadTextTail(path3, maxBytes) {
  let linkStat;
  try {
    linkStat = (0, import_node_fs.lstatSync)(path3);
  } catch {
    return null;
  }
  if (linkStat.isSymbolicLink() || !linkStat.isFile()) return null;
  let fd = -1;
  try {
    fd = (0, import_node_fs.openSync)(path3, "r");
    const stat = (0, import_node_fs.fstatSync)(fd);
    if (!stat.isFile()) return null;
    const length = Math.min(stat.size, Math.max(0, maxBytes));
    const start = Math.max(0, stat.size - length);
    const buffer = Buffer.allocUnsafe(length);
    let offset = 0;
    while (offset < length) {
      const read = (0, import_node_fs.readSync)(
        fd,
        buffer,
        offset,
        length - offset,
        start + offset
      );
      if (read <= 0) break;
      offset += read;
    }
    return buffer.toString("utf8", 0, offset);
  } catch {
    return null;
  } finally {
    if (fd !== -1) {
      try {
        (0, import_node_fs.closeSync)(fd);
      } catch {
      }
    }
  }
}
function defaultReadJson(path3) {
  try {
    if (!(0, import_node_fs.existsSync)(path3)) return null;
    return JSON.parse((0, import_node_fs.readFileSync)(path3, "utf8"));
  } catch {
    return null;
  }
}
function defaultListDirectories(path3) {
  try {
    return (0, import_node_fs.readdirSync)(path3, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  } catch {
    return [];
  }
}
function deepFreeze(value, seen = /* @__PURE__ */ new Set()) {
  if (!value || typeof value !== "object") return value;
  const objectValue = value;
  if (seen.has(objectValue)) return value;
  seen.add(objectValue);
  for (const child of Object.values(value)) {
    deepFreeze(child, seen);
  }
  return Object.freeze(value);
}
function cloneObservation(value) {
  try {
    return structuredClone(value);
  } catch {
    if (Array.isArray(value)) {
      return value.map((item) => cloneObservation(item));
    }
    if (isRecord3(value)) {
      return Object.fromEntries(
        Object.entries(value).map(([key, child]) => [
          key,
          cloneObservation(child)
        ])
      );
    }
    return value;
  }
}
function getAgentType(input) {
  if (!isRecord3(input)) return "";
  return stringValue(input.subagent_type) || stringValue(input.agent_type);
}
function normalizeAgentType(rawAgentType) {
  const unprefixed = rawAgentType.replace(/^oh-my-claudecode:/, "");
  return DEPRECATED_ROLE_ALIASES[unprefixed] ?? unprefixed;
}
function loadJsoncRecord(path3, readText) {
  const content = readText(path3);
  if (content === null) return null;
  try {
    return asRecord(parseJsonc(content));
  } catch {
    return null;
  }
}
function resolveConfiguredAgentModel(agentType, projectConfig, userConfig) {
  const canonical = normalizeAgentType(agentType);
  const configKey = AGENT_CONFIG_KEY_MAP[canonical];
  if (!configKey) return null;
  for (const config of [projectConfig, userConfig]) {
    const agents = asRecord(config?.agents);
    const agent = asRecord(agents?.[configKey]);
    const model = stringValue(agent?.model);
    if (model) return model;
  }
  return null;
}
function resolveConfiguredCopilotDefault(key, projectConfig, userConfig) {
  for (const config of [projectConfig, userConfig]) {
    const externalModels = asRecord(config?.externalModels);
    const defaults = asRecord(externalModels?.defaults);
    const value = stringValue(defaults?.[key]);
    if (value) return value;
  }
  return "";
}
function readAgentDefinitionModel(agentType, environment, currentDirectory, readText) {
  const canonical = normalizeAgentType(agentType);
  if (!/^[a-zA-Z0-9_-]+$/.test(canonical)) return null;
  const pluginRoot = stringValue(environment.CLAUDE_PLUGIN_ROOT);
  const candidateRoots = [
    ...pluginRoot ? [pluginRoot] : [],
    currentDirectory
  ];
  for (const root of candidateRoots) {
    const content = readText((0, import_node_path.join)(root, "agents", `${canonical}.md`));
    if (content === null) continue;
    const frontmatter = content.replace(/^\uFEFF/, "").match(
      /^---[\r\n]+([\s\S]*?)[\r\n]+---/
    );
    if (!frontmatter) return null;
    const model = frontmatter[1].match(/^model:\s*(\S+)/m);
    return model ? model[1].trim().replace(/^["']|["']$/g, "") : null;
  }
  return null;
}
function extractTodoCounts(values) {
  let pending = 0;
  let inProgress = 0;
  for (const value of values) {
    const record = asRecord(value);
    const todos = Array.isArray(record?.todos) ? record.todos : Array.isArray(value) ? value : [];
    for (const todo of todos) {
      const status = isRecord3(todo) ? todo.status : void 0;
      if (status === "pending") pending += 1;
      if (status === "in_progress") inProgress += 1;
    }
  }
  return { pending, inProgress };
}
function extractTracking(value) {
  const record = asRecord(value);
  const agents = Array.isArray(record?.agents) ? record.agents : [];
  return {
    running: agents.filter(
      (agent) => isRecord3(agent) && agent.status === "running"
    ).length,
    total: typeof record?.total_spawned === "number" ? record.total_spawned : 0
  };
}
function sessionStatePath(stateDir, sessionId, fileName) {
  return SESSION_ID_PATTERN.test(sessionId) ? (0, import_node_path.join)(stateDir, "sessions", sessionId, fileName) : null;
}
function readOwnedState(stateDir, sessionId, fileName, readJson, allowLegacyFallback = false) {
  if (sessionId && !SESSION_ID_PATTERN.test(sessionId)) {
    return { path: "", state: null };
  }
  const sessionPath = sessionStatePath(stateDir, sessionId, fileName);
  const legacyPath = (0, import_node_path.join)(stateDir, fileName);
  const paths = sessionPath ? [
    sessionPath,
    ...allowLegacyFallback ? [legacyPath] : []
  ] : [legacyPath];
  for (const path3 of paths) {
    const state = asRecord(readJson(path3));
    if (!state) continue;
    const owner = stringValue(state.session_id) || stringValue(asRecord(state._meta)?.sessionId);
    const isLegacyFallback = !!sessionPath && path3 === legacyPath;
    if (isLegacyFallback && owner !== sessionId) continue;
    if (sessionId && owner && owner !== sessionId) continue;
    return { path: path3, state };
  }
  return { path: paths[0] ?? legacyPath, state: null };
}
function hasActiveModeState(state) {
  return state?.active === true;
}
function mapCanonicalTeamPhase(rawPhase) {
  switch (stringValue(rawPhase).toLowerCase()) {
    case "initializing":
    case "planning":
      return "team-plan";
    case "executing":
      return "team-exec";
    case "fixing":
      return "team-fix";
    case "completed":
      return "complete";
    case "failed":
      return "failed";
    default:
      return "";
  }
}
function readCanonicalTeam(stateDir, sessionId, readJson, listDirectories) {
  if (!SESSION_ID_PATTERN.test(sessionId)) return { active: false };
  const teamRoot = (0, import_node_path.join)(stateDir, "team");
  for (const teamName of listDirectories(teamRoot)) {
    const manifest = asRecord(readJson((0, import_node_path.join)(teamRoot, teamName, "manifest.json")));
    const phase = asRecord(readJson((0, import_node_path.join)(teamRoot, teamName, "phase-state.json")));
    const leader = asRecord(manifest?.leader);
    if (stringValue(leader?.session_id) !== sessionId) continue;
    const stage = mapCanonicalTeamPhase(phase?.current_phase);
    if (!stage) continue;
    return {
      active: stage !== "complete" && stage !== "failed",
      teamName
    };
  }
  return { active: false };
}
function normalizePhase(value) {
  return stringValue(value).toLowerCase();
}
function expectedUltragoalObjective(state, plan) {
  for (const value of [
    state?.claude_goal_objective,
    state?.claudeGoalObjective,
    state?.codex_objective,
    state?.codexObjective,
    state?.goal_objective,
    state?.goalObjective,
    state?.objective
  ]) {
    const objective = stringValue(value);
    if (objective) return objective;
  }
  const claudeObjective = stringValue(plan?.claudeObjective);
  if (claudeObjective) return claudeObjective;
  const aggregate = asRecord(plan?.aggregateCompletion);
  const aggregateObjective = stringValue(aggregate?.objective);
  if (aggregateObjective) return aggregateObjective;
  const goals = Array.isArray(plan?.goals) ? plan.goals : [];
  const activeGoal = goals.find(
    (goal) => isRecord3(goal) && goal.status === "in_progress"
  );
  return isRecord3(activeGoal) ? stringValue(activeGoal.objective) : "";
}
function isUltragoalTerminal(state, plan) {
  if (!state) return true;
  if (state.active === false || stringValue(state.completed_at) !== "" || state.all_done === true || state.done === true) {
    return true;
  }
  const phase = normalizePhase(
    state.current_phase ?? state.phase ?? state.status
  );
  if (phase && ULTRAGOAL_TERMINAL_PHASES.has(phase)) return true;
  const aggregate = asRecord(plan?.aggregateCompletion);
  if (aggregate?.status === "complete") return true;
  const goals = Array.isArray(plan?.goals) ? plan.goals : [];
  return goals.length > 0 && goals.every((goal) => {
    if (!isRecord3(goal)) return false;
    const status = normalizePhase(goal.status);
    return status === "complete" || status === "review_blocked";
  });
}
function extractGoalFromTranscript(transcript, transcriptPath, sessionId) {
  if (transcript === null || !transcriptPath || !sessionId || (0, import_node_path.basename)(transcriptPath).replace(/\.jsonl$/i, "") !== sessionId) {
    return void 0;
  }
  let objective = "";
  for (const line of transcript.split("\n")) {
    if (!line || !GOAL_BEARING_HINT.test(line)) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      return void 0;
    }
    const record = asRecord(entry);
    const message = asRecord(record?.message);
    if (record?.type !== "user" || message?.role !== "user" || typeof message.content !== "string" || !GOAL_COMMAND_MARKER.test(message.content)) {
      continue;
    }
    const args = message.content.match(GOAL_COMMAND_ARGS)?.[1]?.trim() ?? "";
    objective = args === "" || args.toLowerCase() === "clear" ? "" : args;
  }
  return objective ? { objective, status: "active", source: "transcript" } : void 0;
}
function estimateContextPercent(tail) {
  const windowMatches = tail.match(/"context_window"\s{0,5}:\s{0,5}(\d+)/g);
  const inputMatches = tail.match(/"input_tokens"\s{0,5}:\s{0,5}(\d+)/g);
  if (!windowMatches || !inputMatches) return 0;
  const contextWindow = Number.parseInt(
    windowMatches.at(-1)?.match(/(\d+)/)?.[1] ?? "0",
    10
  );
  const inputTokens = Number.parseInt(
    inputMatches.at(-1)?.match(/(\d+)/)?.[1] ?? "0",
    10
  );
  return contextWindow > 0 ? Math.round(inputTokens / contextWindow * 100) : 0;
}
function parseForceDelegationConfig(value) {
  const routing = asRecord(asRecord(value)?.routing);
  const raw = asRecord(routing?.forceDelegation);
  if (!raw || raw.enforce !== true || !Array.isArray(raw.rules)) return null;
  return {
    enforce: true,
    rules: raw.rules.filter(isRecord3).map((rule) => ({
      ...typeof rule.pattern === "string" ? { pattern: rule.pattern } : {},
      ...isRecord3(rule.threshold) ? {
        threshold: {
          ...typeof rule.threshold.count === "number" ? { count: rule.threshold.count } : {},
          ...typeof rule.threshold.windowSeconds === "number" ? { windowSeconds: rule.threshold.windowSeconds } : {}
        }
      } : {},
      ...typeof rule.denyMessage === "string" ? { denyMessage: rule.denyMessage } : {},
      ...typeof rule.bypassEnv === "string" ? { bypassEnv: rule.bypassEnv } : {}
    }))
  };
}
function parseForceDelegationEvents(value, nowSec) {
  const events = Array.isArray(asRecord(value)?.events) ? asRecord(value).events : [];
  const cutoff = nowSec - FORCE_DELEGATION_RETENTION_SECONDS;
  return events.flatMap((event, originalIndex) => {
    if (!isRecord3(event)) return [];
    const observedAtSec = typeof event.observedAtSec === "number" ? event.observedAtSec : typeof event.t === "number" ? event.t : Number.NaN;
    const toolName = stringValue(event.toolName) || stringValue(event.tool);
    if (!Number.isSafeInteger(observedAtSec) || observedAtSec < Math.floor(PRE_TOOL_MIN_EPOCH_MS / 1e3) || observedAtSec <= cutoff || observedAtSec > nowSec + Math.floor(PRE_TOOL_MAX_FUTURE_SKEW_MS / 1e3) || !toolName) {
      return [];
    }
    return [{
      toolName,
      observedAtSec,
      originalIndex: typeof event.originalIndex === "number" ? event.originalIndex : originalIndex,
      ...typeof event.intentId === "string" ? { intentId: event.intentId } : typeof event.intent_id === "string" ? { intentId: event.intent_id } : {}
    }];
  });
}
function parseAdvisoryEntries(value, nowMs) {
  const entries = asRecord(asRecord(value)?.entries);
  if (!entries) return {};
  return Object.fromEntries(
    Object.entries(entries).flatMap(([key, entry]) => {
      if (!isRecord3(entry)) return [];
      const lastEmittedAtMs = entry.last_emitted_at_ms;
      if (typeof lastEmittedAtMs !== "number" || !Number.isSafeInteger(lastEmittedAtMs) || lastEmittedAtMs < PRE_TOOL_MIN_EPOCH_MS || lastEmittedAtMs > nowMs + PRE_TOOL_MAX_FUTURE_SKEW_MS) {
        return [];
      }
      return [[key, {
        last_emitted_at_ms: lastEmittedAtMs,
        ...typeof entry.message === "string" ? { message: entry.message } : {},
        ...typeof entry.intent_id === "string" ? { intent_id: entry.intent_id } : {}
      }]];
    })
  );
}
function deliveryIdForEnvelope(envelope, createNonce) {
  if (envelope.toolCalls.length > 0 && envelope.toolCalls.every((call) => call.idSource === "host")) {
    const identity = envelope.toolCalls.map((call) => `${call.id}\0${call.fingerprint}`).join("\0");
    return (0, import_node_crypto.createHash)("sha256").update(envelope.contract).update("\0").update(envelope.sessionId ?? "").update("\0").update(identity).digest("hex");
  }
  return `delivery-${createNonce()}`;
}
function loadPreToolBatchSnapshot(envelope, dependencies = {}) {
  const now = dependencies.now ?? Date.now;
  const createDeliveryNonce = dependencies.createDeliveryNonce ?? import_node_crypto.randomUUID;
  const currentDirectory = dependencies.currentDirectory ?? process.cwd;
  const environmentProvider = dependencies.environment ?? (() => ({ ...process.env }));
  const resolveOmcRoot = dependencies.resolveOmcRoot ?? getOmcRoot;
  const rawReadJson = dependencies.readJson ?? defaultReadJson;
  const rawReadText = dependencies.readText ?? defaultReadText;
  const rawReadTextTail = dependencies.readTextTail ?? defaultReadTextTail;
  const rawListDirectories = dependencies.listDirectories ?? defaultListDirectories;
  const rawFileExists = dependencies.fileExists ?? import_node_fs.existsSync;
  const jsonCache = /* @__PURE__ */ new Map();
  const textCache = /* @__PURE__ */ new Map();
  const textTailCache = /* @__PURE__ */ new Map();
  const directoryCache = /* @__PURE__ */ new Map();
  const existenceCache = /* @__PURE__ */ new Map();
  const readJson = (path3) => {
    if (!jsonCache.has(path3)) {
      jsonCache.set(path3, cloneObservation(rawReadJson(path3)));
    }
    return jsonCache.get(path3);
  };
  const readText = (path3, maxBytes) => {
    const key = `${path3}\0${maxBytes ?? ""}`;
    if (!textCache.has(key)) {
      textCache.set(key, rawReadText(path3, maxBytes));
    }
    return textCache.get(key) ?? null;
  };
  const readTextTail = (path3, maxBytes) => {
    const key = `${path3}\0${maxBytes}`;
    if (!textTailCache.has(key)) {
      textTailCache.set(key, rawReadTextTail(path3, maxBytes));
    }
    return textTailCache.get(key) ?? null;
  };
  const listDirectories = (path3) => {
    if (!directoryCache.has(path3)) {
      directoryCache.set(path3, [...rawListDirectories(path3)]);
    }
    return directoryCache.get(path3) ?? [];
  };
  const fileExists = (path3) => {
    if (!existenceCache.has(path3)) {
      existenceCache.set(path3, rawFileExists(path3));
    }
    return existenceCache.get(path3) ?? false;
  };
  const loadedAtMs = now();
  const observedAt = new Date(loadedAtMs).toISOString();
  const observedAtSec = Math.floor(loadedAtMs / 1e3);
  const environment = { ...environmentProvider() };
  const runtimeDirectory = currentDirectory();
  const directory = envelope.directory || runtimeDirectory;
  const omcRoot = resolveOmcRoot(directory);
  const stateDir = (0, import_node_path.join)(omcRoot, "state");
  const sessionId = envelope.sessionId ?? "";
  const deliveryId = deliveryIdForEnvelope(envelope, createDeliveryNonce);
  const userOmcConfigPath = (0, import_node_path.join)(
    resolveClaudeConfigDirectory(environment),
    ".omc-config.json"
  );
  const projectOmcConfigPath = (0, import_node_path.join)(omcRoot, "config.json");
  const omcConfig = asRecord(readJson(userOmcConfigPath)) ?? asRecord(readJson(projectOmcConfigPath)) ?? {};
  const userConfig = loadJsoncRecord(
    (0, import_node_path.join)(
      resolveUserConfigDirectory(environment),
      "claude-omc",
      "config.jsonc"
    ),
    readText
  );
  const projectConfig = loadJsoncRecord(
    (0, import_node_path.join)(directory, ".claude", "omc.jsonc"),
    readText
  );
  const agentTypes = [...new Set(
    envelope.toolCalls.map((call) => getAgentType(call.input)).filter(Boolean).map(normalizeAgentType)
  )];
  const configuredAgentModels = Object.fromEntries(
    agentTypes.map((agentType) => [
      agentType,
      resolveConfiguredAgentModel(agentType, projectConfig, userConfig)
    ])
  );
  const agentDefinitionModels = Object.fromEntries(
    agentTypes.map((agentType) => [
      agentType,
      readAgentDefinitionModel(
        agentType,
        environment,
        runtimeDirectory,
        readText
      )
    ])
  );
  const configuredCopilotModel = resolveConfiguredCopilotDefault(
    "copilotModel",
    projectConfig,
    userConfig
  );
  const configuredCopilotEffort = stringValue(
    environment.OMC_COPILOT_REASONING_EFFORT
  ) || resolveConfiguredCopilotDefault(
    "copilotReasoningEffort",
    projectConfig,
    userConfig
  ) || COPILOT_DEFAULT_REASONING_EFFORT;
  const normalizedCopilotEffort = configuredCopilotEffort.toLowerCase();
  const copilotEffortValid = COPILOT_REASONING_EFFORTS.has(
    normalizedCopilotEffort
  );
  const copilotDefaults = {
    model: stringValue(environment.OMC_EXTERNAL_MODELS_DEFAULT_COPILOT_MODEL) || stringValue(environment.OMC_COPILOT_DEFAULT_MODEL) || configuredCopilotModel || COPILOT_DEFAULT_MODEL,
    reasoningEffort: copilotEffortValid ? normalizedCopilotEffort : COPILOT_DEFAULT_REASONING_EFFORT,
    warning: copilotEffortValid ? "" : `[COPILOT MODEL] Ignoring invalid reasoning effort "${configuredCopilotEffort}". Expected one of: ${[...COPILOT_REASONING_EFFORTS].join(", ")}. Using "${COPILOT_DEFAULT_REASONING_EFFORT}".`
  };
  const modeStates = Object.fromEntries(
    MODE_STATE_FILES.map((fileName) => [
      fileName.replace(/-state\.json$/, ""),
      readOwnedState(
        stateDir,
        sessionId,
        fileName,
        readJson,
        fileName === "ultragoal-state.json" || fileName === "team-state.json"
      )
    ])
  );
  const invalidSessionId = sessionId.length > 0 && !SESSION_ID_PATTERN.test(sessionId);
  const swarmSummaryPath = sessionStatePath(
    stateDir,
    sessionId,
    "swarm-summary.json"
  ) ?? (invalidSessionId ? null : (0, import_node_path.join)(stateDir, "swarm-summary.json"));
  const swarmMarkerPath = sessionStatePath(
    stateDir,
    sessionId,
    "swarm-active.marker"
  ) ?? (invalidSessionId ? null : (0, import_node_path.join)(stateDir, "swarm-active.marker"));
  const swarmSummary = swarmSummaryPath ? asRecord(readJson(swarmSummaryPath)) : null;
  const modeActive = Object.values(modeStates).some(
    (candidate) => hasActiveModeState(candidate.state)
  ) || swarmMarkerPath !== null && fileExists(swarmMarkerPath) && swarmSummary?.active === true;
  const coarseTeamState = modeStates.team?.state ?? null;
  const canonicalTeam = readCanonicalTeam(
    stateDir,
    sessionId,
    readJson,
    listDirectories
  );
  const team = coarseTeamState?.active === true ? {
    active: true,
    teamName: stringValue(coarseTeamState.team_name) || stringValue(coarseTeamState.teamName) || "team"
  } : canonicalTeam;
  const todoCounts = extractTodoCounts([
    readJson((0, import_node_path.join)(omcRoot, "todos.json")),
    readJson((0, import_node_path.join)(directory, ".claude", "todos.json"))
  ]);
  const todoLabel = todoCounts.pending + todoCounts.inProgress > 0 ? `[${todoCounts.inProgress} active, ${todoCounts.pending} pending] ` : "";
  const tracking = extractTracking(
    readJson((0, import_node_path.join)(stateDir, "subagent-tracking.json"))
  );
  const transcriptPath = envelope.transcriptPath;
  const transcriptTail = transcriptPath ? readTextTail(transcriptPath, TRANSCRIPT_TAIL_BYTES) ?? "" : "";
  const needsTranscriptGoal = !!transcriptPath && !envelope.eventPayload.goal && !!sessionId && (0, import_node_path.basename)(transcriptPath).replace(/\.jsonl$/i, "") === sessionId;
  const transcriptContent = needsTranscriptGoal ? readText(transcriptPath, MAX_TRANSCRIPT_BYTES) : null;
  const transcriptGoal = envelope.eventPayload.goal ? cloneObservation(envelope.eventPayload.goal) : extractGoalFromTranscript(transcriptContent, transcriptPath, sessionId);
  const contextThreshold = numberFromEnvironment(
    environment.OMC_AGENT_PREFLIGHT_CONTEXT_THRESHOLD,
    DEFAULT_CONTEXT_THRESHOLD,
    1,
    100
  );
  const ultragoalState = modeStates.ultragoal?.state ?? null;
  const ultragoalPlan = asRecord(readJson((0, import_node_path.join)(omcRoot, "ultragoal", "goals.json"))) ?? asRecord(readJson((0, import_node_path.join)(directory, ".omc", "ultragoal", "goals.json")));
  const forceDelegation = parseForceDelegationConfig(omcConfig);
  const forceDelegationState2 = asRecord(
    readJson((0, import_node_path.join)(stateDir, "force-agent-delegation-events.json"))
  );
  const forceDelegationGeneration = typeof forceDelegationState2?.generation === "number" && Number.isSafeInteger(forceDelegationState2.generation) && forceDelegationState2.generation >= 0 ? forceDelegationState2.generation : 0;
  const forceDelegationLedger = {
    generation: forceDelegationGeneration,
    events: parseForceDelegationEvents(
      forceDelegationState2,
      observedAtSec
    )
  };
  const advisoryPath2 = sessionId && !SESSION_ID_PATTERN.test(sessionId) ? "" : SESSION_ID_PATTERN.test(sessionId) ? (0, import_node_path.join)(
    stateDir,
    "sessions",
    sessionId,
    "pre-tool-advisory-throttle.json"
  ) : (0, import_node_path.join)(stateDir, "pre-tool-advisory-throttle.json");
  const advisoryCooldownMs = numberFromEnvironment(
    environment.OMC_PRE_TOOL_ADVISORY_COOLDOWN_MS,
    DEFAULT_ADVISORY_COOLDOWN_MS,
    0
  );
  const advisoryNowMs = timestampFromEnvironment(
    environment.OMC_PRE_TOOL_ADVISORY_NOW_MS,
    loadedAtMs
  );
  const routing = asRecord(omcConfig.routing);
  const snapshot = {
    version: PRE_TOOL_SNAPSHOT_VERSION,
    loadedAtMs,
    observedAt,
    observedAtSec,
    directory,
    omcRoot,
    stateDir,
    sessionId,
    deliveryId,
    environment,
    disabled: environment.DISABLE_OMC === "1" || (environment.OMC_SKIP_HOOKS ?? "").split(",").map((value) => value.trim()).includes("pre-tool-use"),
    quietLevel: numberFromEnvironment(environment.OMC_QUIET, 0, 0),
    todo: {
      ...todoCounts,
      label: todoLabel
    },
    tracking,
    team,
    modeActive,
    modeStates,
    omcConfig,
    modelRouting: {
      forceInherit: environment.OMC_ROUTING_FORCE_INHERIT === "true" || routing?.forceInherit === true,
      claudeModel: stringValue(environment.CLAUDE_MODEL),
      anthropicModel: stringValue(environment.ANTHROPIC_MODEL),
      anthropicBaseUrl: stringValue(environment.ANTHROPIC_BASE_URL),
      useBedrock: environment.CLAUDE_CODE_USE_BEDROCK === "1",
      useVertex: environment.CLAUDE_CODE_USE_VERTEX === "1",
      configuredAgentModels,
      agentDefinitionModels,
      copilotDefaults,
      tierEnvironment: Object.fromEntries(
        Object.entries(environment).filter(
          ([key, value]) => value !== void 0 && (key === "OMC_SUBAGENT_MODEL" || key.startsWith("CLAUDE_CODE_BEDROCK_") || key.startsWith("ANTHROPIC_DEFAULT_"))
        ).map(([key, value]) => [key, value ?? ""])
      )
    },
    transcript: {
      ...transcriptPath ? { path: transcriptPath } : {},
      tail: transcriptTail,
      contextPercent: estimateContextPercent(transcriptTail),
      contextThreshold,
      ...transcriptGoal ? { goal: transcriptGoal } : {}
    },
    ultragoal: {
      state: ultragoalState,
      ...modeStates.ultragoal?.path ? { statePath: modeStates.ultragoal.path } : {},
      plan: ultragoalPlan,
      expectedObjective: expectedUltragoalObjective(
        ultragoalState,
        ultragoalPlan
      ),
      terminal: isUltragoalTerminal(
        ultragoalState,
        ultragoalPlan
      ),
      ...transcriptGoal ? { goal: transcriptGoal } : {}
    },
    forceDelegation,
    forceDelegationLedger,
    advisoryThrottle: {
      path: advisoryPath2,
      nowMs: advisoryNowMs,
      cooldownMs: advisoryCooldownMs,
      entries: advisoryPath2 ? parseAdvisoryEntries(readJson(advisoryPath2), advisoryNowMs) : {}
    }
  };
  return deepFreeze(snapshot);
}

// src/hooks/pre-tool-enforcer/evaluate.ts
var import_node_crypto2 = require("node:crypto");
var import_node_path2 = require("node:path");
init_mode_names();
var BUILT_IN_TASK_LIST_TOOL_NAMES = /* @__PURE__ */ new Set([
  "TaskCreate",
  "TaskUpdate",
  "TaskList",
  "TaskGet",
  "TaskOutput",
  "TaskStop"
]);
var AGENT_HEAVY_TOOLS = /* @__PURE__ */ new Set(["Task", "Agent"]);
var FORCE_DELEGATION_RETENTION_SECONDS2 = 60 * 60;
var FORCE_DELEGATION_DEFAULT_WINDOW_SECONDS = 120;
var AWAITING_CONFIRMATION_TTL_MS = 2 * 60 * 1e3;
var STATE_STALE_MS = 2 * 60 * 60 * 1e3;
var TIER_ALIASES = /* @__PURE__ */ new Set(["sonnet", "opus", "haiku", "fable"]);
var TIER_TO_DEFAULT_ENV_KEYS = {
  haiku: [
    "OMC_SUBAGENT_MODEL",
    "CLAUDE_CODE_BEDROCK_HAIKU_MODEL",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL"
  ],
  sonnet: [
    "OMC_SUBAGENT_MODEL",
    "CLAUDE_CODE_BEDROCK_SONNET_MODEL",
    "ANTHROPIC_DEFAULT_SONNET_MODEL"
  ],
  opus: [
    "OMC_SUBAGENT_MODEL",
    "CLAUDE_CODE_BEDROCK_OPUS_MODEL",
    "ANTHROPIC_DEFAULT_OPUS_MODEL"
  ],
  fable: [
    "OMC_SUBAGENT_MODEL",
    "CLAUDE_CODE_BEDROCK_FABLE_MODEL",
    "ANTHROPIC_DEFAULT_FABLE_MODEL"
  ]
};
var SKILL_PROTECTION = {
  autopilot: "none",
  autoresearch: "none",
  ralph: "none",
  ultragoal: "none",
  ultrawork: "none",
  team: "none",
  "omc-teams": "none",
  ultraqa: "none",
  ralplan: "none",
  "self-improve": "none",
  cancel: "none",
  trace: "none",
  hud: "none",
  "omc-doctor": "none",
  "omc-help": "none",
  "learn-about-omc": "none",
  note: "none",
  skill: "light",
  ask: "light",
  "configure-notifications": "light",
  "omc-plan": "medium",
  plan: "medium",
  "deep-interview": "heavy",
  review: "medium",
  "external-context": "medium",
  "ai-slop-cleaner": "medium",
  sciomc: "medium",
  skillify: "medium",
  learner: "medium",
  "omc-setup": "medium",
  setup: "medium",
  "mcp-setup": "medium",
  "project-session-manager": "medium",
  psm: "medium",
  "writer-memory": "medium",
  "ralph-init": "medium",
  release: "medium",
  ccg: "medium",
  deepinit: "heavy"
};
var SLOP_RISK_TOOL_NAMES = /* @__PURE__ */ new Set([
  "Task",
  "TaskCreate",
  "TaskUpdate",
  "Agent",
  "Bash",
  "Edit",
  "MultiEdit",
  "Write",
  "NotebookEdit"
]);
var SLOP_FALLBACK_LANGUAGE_PATTERN = /\b(?:fallback|fall\s+back|workaround|work\s+around)\b/i;
var SLOP_FALLBACK_ACTION_PATTERNS = [
  /\b(?:add|build|create|implement|introduce|make|patch|use|using|write)\s+(?:an?\s+|the\s+)?(?:fallback|workaround)\b/i,
  /\b(?:fallback|workaround)\s+(?:layer|path|handler|shim|patch|implementation|mechanism|mode)\b/i,
  /\bworkaround\s+(?:it|this|that|the|a|an)\b/i,
  /\b(?:fall\s+back|fallback)\s+(?:to|on|onto)\b/i,
  /\bwork\s+around\s+(?:it|this|that|the|a|an)\b/i,
  /\bwork\s+around\s+(?!(?:it|this|that|the|a|an)\b)(?:[a-z0-9][\w-]*\s+){0,5}[a-z0-9][\w-]*\b/i,
  /(?:^|[\s"'`=:/\\])[\w.-]*(?:fallback|workaround)[\w.-]*\.(?:cjs|js|mjs|py|sh|ts|tsx)\b/i
];
var SLOP_BENIGN_TECHNICAL_PATTERNS = [
  /\bfail[-\s]?soft\s+fallback(?:\s+(?:value|behavior|behaviour|result|semantics?))?\b/i,
  /\bfallback\s+(?:value|variable|parameter|argument|option|setting|config(?:uration)?|default)\b/i,
  /\bfallback\s+to\s+(?:the\s+)?default(?:\s+(?:config(?:uration)?|settings?|value|behavior|behaviour|option))?\b/i,
  /\b(?:workaround|work\s+around)\s+for\s+(?:commit|change|issue|bug|regression|version|release|pr|pull\s+request|#[0-9]+|[a-f0-9]{7,40}\b)/i,
  /\b(?:memory|sql|sqlite|mysql|postgres(?:ql)?|typescript|node|browser|runtime)\s+workaround\b/i
];
var SLOP_DOC_CONTEXT_PATTERN = /(?:^|[/\\])(?:docs?|documentation|guides?|instructions?|prompts?|\.om[ctx])(?:[/\\]|$)|\.(?:md|mdx|txt|rst)$/i;
var SLOP_SELF_REFERENCE_PATH_PATTERN = /(?:^|[/\\])(?:pre-tool-enforcer(?:\.mjs)?|pre-tool-enforcer\.test\.ts)(?:$|[/\\])/i;
function isRecord4(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function nonEmptyString(value) {
  return typeof value === "string" ? value.trim() : "";
}
function getAgentType2(input) {
  return nonEmptyString(input.subagent_type) || nonEmptyString(input.agent_type);
}
function normalizeAgentType2(agentType) {
  const normalized = agentType.replace(/^oh-my-claudecode:/, "");
  const aliases = {
    researcher: "document-specialist",
    "tdd-guide": "test-engineer",
    "api-reviewer": "code-reviewer",
    "performance-reviewer": "code-reviewer",
    "dependency-expert": "document-specialist",
    "quality-strategist": "code-reviewer",
    vision: "document-specialist",
    "quality-reviewer": "code-reviewer",
    "deep-executor": "executor",
    "build-fixer": "debugger",
    "harsh-critic": "critic",
    reviewer: "code-reviewer"
  };
  return aliases[normalized] ?? normalized;
}
function effectIntentId(snapshot, call, effectType, target) {
  return (0, import_node_crypto2.createHash)("sha256").update(snapshot.stateDir).update("\0").update(snapshot.sessionId).update("\0").update(snapshot.deliveryId).update("\0").update(call.id).update("\0").update(call.fingerprint).update("\0").update(effectType).update("\0").update(target).digest("hex");
}
function hookEffect(call, type, payload, commitOn, critical = false) {
  return {
    type,
    payload,
    callId: call.id,
    commitOn,
    critical
  };
}
function extractSkill(input) {
  if (!isRecord4(input)) return null;
  const rawSkillName = nonEmptyString(input.skill) || nonEmptyString(input.skill_name) || nonEmptyString(input.skillName) || nonEmptyString(input.command);
  if (!rawSkillName) return null;
  const skillName = rawSkillName.includes(":") ? rawSkillName.split(":").at(-1)?.toLowerCase() ?? "" : rawSkillName.toLowerCase();
  return skillName ? { skillName, rawSkillName } : null;
}
function skillProtection(skillName, rawSkillName) {
  if (!rawSkillName.toLowerCase().startsWith("oh-my-claudecode:")) {
    return "none";
  }
  return SKILL_PROTECTION[skillName] ?? "none";
}
function isBundledOmcSubagent(agentType) {
  return /^oh-my-claudecode:[a-zA-Z0-9_-]+$/.test(agentType);
}
function isProviderSpecificModelId(modelId) {
  if (/^((us|eu|ap|global)\.anthropic\.|anthropic\.claude)/i.test(modelId)) {
    return true;
  }
  if (/^arn:aws(-[^:]+)?:bedrock:/i.test(modelId)) return true;
  return modelId.toLowerCase().startsWith("vertex_ai/");
}
function hasExtendedContextSuffix(modelId) {
  return /\[\d+[mk]\]$/i.test(modelId);
}
function isSubagentSafeModelId(modelId) {
  return isProviderSpecificModelId(modelId) && !hasExtendedContextSuffix(modelId);
}
function isTierAlias(modelId) {
  return TIER_ALIASES.has(modelId.toLowerCase());
}
function normalizeToCcAlias(model) {
  const lower = model.toLowerCase();
  if (lower.includes("opus")) return "opus";
  if (lower.includes("sonnet")) return "sonnet";
  if (lower.includes("haiku")) return "haiku";
  if (lower.includes("fable")) return "fable";
  return null;
}
function isBedrockProvider(snapshot) {
  if (snapshot.modelRouting.useBedrock) return true;
  const modelId = snapshot.modelRouting.claudeModel || snapshot.modelRouting.anthropicModel;
  if (/^((us|eu|ap|global)\.anthropic\.|anthropic\.claude)/i.test(modelId)) {
    return true;
  }
  return /^arn:aws(-[^:]+)?:bedrock:/i.test(modelId) && /:(inference-profile|application-inference-profile)\//i.test(modelId) && modelId.toLowerCase().includes("claude");
}
function isVertexProvider(snapshot) {
  if (snapshot.modelRouting.useVertex) return true;
  const modelId = snapshot.modelRouting.claudeModel || snapshot.modelRouting.anthropicModel;
  return modelId.toLowerCase().startsWith("vertex_ai/");
}
function isNonClaudeProvider(snapshot) {
  if (isBedrockProvider(snapshot) || isVertexProvider(snapshot)) return true;
  const modelId = snapshot.modelRouting.claudeModel || snapshot.modelRouting.anthropicModel;
  if (modelId && !modelId.toLowerCase().includes("claude")) return true;
  if (snapshot.modelRouting.anthropicBaseUrl && !snapshot.modelRouting.anthropicBaseUrl.includes("anthropic.com")) {
    return true;
  }
  const activeModels = [
    snapshot.modelRouting.claudeModel,
    snapshot.modelRouting.anthropicModel
  ].filter(Boolean);
  const hasNormalClaude = activeModels.some(
    (model) => model.toLowerCase().includes("claude") && !isProviderSpecificModelId(model)
  );
  return snapshot.modelRouting.forceInherit && !hasNormalClaude;
}
function resolveTierAliasToSafeModel(tierAlias, snapshot) {
  const keys = TIER_TO_DEFAULT_ENV_KEYS[tierAlias.toLowerCase()];
  if (!keys) return "";
  for (const key of keys) {
    const value = snapshot.modelRouting.tierEnvironment[key]?.trim() ?? "";
    const isAnthropicDefault = key.startsWith("ANTHROPIC_DEFAULT_");
    const isNativeClaudeCode = isAnthropicDefault || key.startsWith("CLAUDE_CODE_BEDROCK_");
    const valid = isNativeClaudeCode ? isProviderSpecificModelId(value) || isAnthropicDefault && value.length > 0 && isNonClaudeProvider(snapshot) && !isBedrockProvider(snapshot) && !isVertexProvider(snapshot) : isSubagentSafeModelId(value);
    if (value && valid) return value;
  }
  return "";
}
function formatPatchValue(value) {
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}
function requiredMutation(call, input, patch) {
  const instruction = `call ${call.id}: ${Object.entries(patch).map(([key, value]) => `${key}=${formatPatchValue(value)}`).join(", ")}`;
  return {
    input,
    requirement: "required",
    retryHint: {
      instruction,
      patch
    }
  };
}
function evaluateModelRouting(call, envelope, snapshot) {
  if (call.canonicalName !== "Task" && call.canonicalName !== "Agent" || !isRecord4(call.input)) {
    return { warning: "" };
  }
  const input = call.input;
  const toolModel = nonEmptyString(input.model);
  const agentType = getAgentType2(input);
  if (envelope.host === "copilot" && isBundledOmcSubagent(agentType)) {
    const hasExplicitModel = Object.hasOwn(input, "model") && input.model !== void 0 && input.model !== null;
    const hasExplicitReasoning = Object.hasOwn(input, "reasoning_effort") && input.reasoning_effort !== void 0 && input.reasoning_effort !== null || Object.hasOwn(input, "reasoningEffort") && input.reasoningEffort !== void 0 && input.reasoningEffort !== null;
    if (hasExplicitModel && hasExplicitReasoning) return { warning: "" };
    const updatedInput = { ...input };
    const patch = {};
    if (!hasExplicitModel) {
      updatedInput.model = snapshot.modelRouting.copilotDefaults.model;
      patch.model = snapshot.modelRouting.copilotDefaults.model;
    }
    if (!hasExplicitReasoning) {
      updatedInput.reasoning_effort = snapshot.modelRouting.copilotDefaults.reasoningEffort;
      patch.reasoning_effort = snapshot.modelRouting.copilotDefaults.reasoningEffort;
    }
    return {
      updatedInput,
      warning: hasExplicitReasoning ? "" : snapshot.modelRouting.copilotDefaults.warning
    };
  }
  if (snapshot.modelRouting.forceInherit) {
    const claudeModel = snapshot.modelRouting.claudeModel;
    const anthropicModel = snapshot.modelRouting.anthropicModel;
    const sessionHasLmSuffix = hasExtendedContextSuffix(claudeModel) || hasExtendedContextSuffix(anthropicModel);
    const sessionModel = hasExtendedContextSuffix(claudeModel) ? claudeModel : hasExtendedContextSuffix(anthropicModel) ? anthropicModel : claudeModel || anthropicModel;
    if (toolModel) {
      if (!(isTierAlias(toolModel) && resolveTierAliasToSafeModel(toolModel, snapshot)) && !isSubagentSafeModelId(toolModel)) {
        const tier = isTierAlias(toolModel) ? toolModel.toUpperCase() : (normalizeToCcAlias(toolModel) ?? "").toUpperCase();
        const guidance = tier ? `Set ANTHROPIC_DEFAULT_${tier}_MODEL=<valid-bedrock-id> in settings.json env, or set OMC_SUBAGENT_MODEL as a global override.` : "Remove the `model` parameter, or set ANTHROPIC_DEFAULT_SONNET_MODEL=<valid-bedrock-id> in settings.json env.";
        return {
          warning: "",
          denyReason: `[MODEL ROUTING] This environment uses a non-standard provider (Bedrock/Vertex/proxy). ${guidance} The model "${toolModel}" is not valid for this provider.`
        };
      }
    } else if (sessionHasLmSuffix) {
      const tierAlias = normalizeToCcAlias(sessionModel) || "sonnet";
      const resolvedSafe = resolveTierAliasToSafeModel(tierAlias, snapshot);
      const suggestion = resolvedSafe ? `Pass model="${tierAlias}" explicitly on this ${call.canonicalName} call \u2014 tier aliases resolve cleanly on Bedrock.` : `Pass model="${tierAlias}" explicitly on this ${call.canonicalName} call, and set ANTHROPIC_DEFAULT_${tierAlias.toUpperCase()}_MODEL=<valid-bedrock-id> in settings.json env.`;
      return {
        warning: "",
        denyReason: `[MODEL ROUTING] Your session model "${sessionModel}" has a context-window suffix ([1m]) that sub-agents cannot inherit \u2014 the runtime strips it to a bare Anthropic model ID which is invalid on Bedrock. ${suggestion}`
      };
    }
    if (!toolModel && nonEmptyString(input.subagent_type)) {
      const canonicalAgent = normalizeAgentType2(
        nonEmptyString(input.subagent_type)
      );
      const definitionModel = snapshot.modelRouting.agentDefinitionModels[canonicalAgent];
      const tierAlias = definitionModel ? normalizeToCcAlias(definitionModel) : null;
      const resolvedModel = tierAlias ? resolveTierAliasToSafeModel(tierAlias, snapshot) : "";
      if (definitionModel && !isSubagentSafeModelId(definitionModel) && !isTierAlias(definitionModel) && resolvedModel) {
        return {
          warning: "",
          denyReason: `[MODEL ROUTING] Agent type "${canonicalAgent}" has model "${definitionModel}" in its definition, which is not valid for this Bedrock/Vertex/proxy environment. Add model="${tierAlias}" to this ${call.canonicalName} call \u2014 tier aliases resolve to configured provider models (${resolvedModel}).`
        };
      }
    }
    return { warning: "" };
  }
  if (!toolModel && agentType) {
    const canonicalAgent = normalizeAgentType2(agentType);
    const configured = snapshot.modelRouting.configuredAgentModels[canonicalAgent];
    if (configured && configured !== "inherit") {
      const normalizedModel = normalizeToCcAlias(configured);
      if (normalizedModel) {
        return {
          updatedInput: { ...input, model: normalizedModel },
          warning: ""
        };
      }
    }
  }
  return { warning: "" };
}
function normalizeText(value) {
  return nonEmptyString(value).replace(/\s+/g, " ").toLowerCase();
}
function observedModeGeneration(state) {
  const meta = state && isRecord4(state._meta) ? state._meta : null;
  const value = state?.generation ?? meta?.generation;
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
function observedModeOwnerSessionId(state) {
  const meta = state && isRecord4(state._meta) ? state._meta : null;
  return nonEmptyString(meta?.sessionId) || nonEmptyString(state?.session_id);
}
function observedModeConfirmationTimestamp(state) {
  return state ? nonEmptyString(state.awaiting_confirmation_set_at) || nonEmptyString(state.started_at) : "";
}
function observedModeStateDigest(state) {
  return (0, import_node_crypto2.createHash)("sha256").update(JSON.stringify(state)).digest("hex");
}
function isAwaitingConfirmation(state, nowMs) {
  if (state.awaiting_confirmation !== true) return false;
  const timestamp = nonEmptyString(state.awaiting_confirmation_set_at) || nonEmptyString(state.started_at);
  if (!timestamp) return false;
  const timestampMs = new Date(timestamp).getTime();
  const age = nowMs - timestampMs;
  return Number.isFinite(age) && age >= 0 && age < AWAITING_CONFIRMATION_TTL_MS;
}
function isStaleState(state, nowMs) {
  const timestamps = [
    state.last_checked_at,
    state.updated_at,
    state.started_at
  ].map((value) => new Date(nonEmptyString(value)).getTime()).filter(Number.isFinite);
  return timestamps.length === 0 || nowMs - Math.max(...timestamps) > STATE_STALE_MS;
}
function isSingleShellCommand(command) {
  return command.trim().length > 0 && !/[\n\r;&|`]|\$\(|<\(|>\(/.test(command);
}
function isCancelBootstrap(call) {
  const input = isRecord4(call.input) ? call.input : {};
  if (call.canonicalName === "Skill" && extractSkill(input)?.skillName === "cancel") {
    return true;
  }
  if (call.canonicalName === "ToolSearch") return true;
  if (call.canonicalName === "Read") {
    const filePath = nonEmptyString(input.file_path) || nonEmptyString(input.path);
    const normalized = filePath.replace(/\\/g, "/");
    if (/(?:^|\/)(?:skills|skill-bodies)\/cancel\/SKILL\.md$/i.test(normalized)) {
      return true;
    }
  }
  if (/state_(?:clear|read|write|list_active|get_status)$/i.test(call.nativeName)) {
    return true;
  }
  if (/^mcp__.*__state_(?:clear|read|write|list_active|get_status)$/i.test(call.nativeName)) {
    return true;
  }
  if (call.canonicalName !== "Bash") return false;
  const command = nonEmptyString(input.command);
  return isSingleShellCommand(command) && /^(?:omc|oh-my-claudecode|gjc)\s+(?:state\s+(?:clear|read|write|list-active|get-status)|cancel)\b/.test(
    command
  );
}
function isUltragoalBootstrap(call) {
  const input = isRecord4(call.input) ? call.input : {};
  if (call.canonicalName === "Skill" && extractSkill(input)?.skillName === "ultragoal") {
    return true;
  }
  if (call.canonicalName !== "Bash") return false;
  const command = nonEmptyString(input.command);
  return isSingleShellCommand(command) && /^(?:omc|oh-my-claudecode)\s+ultragoal\s+(?:create(?:-goals)?|complete(?:-goals)?|next|start-next|status|checkpoint|record-review-blockers)\b/.test(
    command
  );
}
function evaluateUltragoal(call, snapshot) {
  if (snapshot.environment.ALLOW_ULTRAGOAL_WITHOUT_GOAL === "1") {
    return void 0;
  }
  if (isUltragoalBootstrap(call) || isCancelBootstrap(call)) return void 0;
  const state = snapshot.ultragoal.state;
  if (!state || state.active !== true) return void 0;
  if (isStaleState(state, snapshot.loadedAtMs)) return void 0;
  const projectPath = nonEmptyString(state.project_path);
  if (projectPath && (0, import_node_path2.resolve)(projectPath) !== (0, import_node_path2.resolve)(snapshot.directory)) {
    return void 0;
  }
  if (snapshot.ultragoal.terminal) return void 0;
  if (isAwaitingConfirmation(state, snapshot.loadedAtMs)) return void 0;
  const expected = snapshot.ultragoal.expectedObjective;
  const actual = snapshot.ultragoal.goal;
  const actualObjective = normalizeText(actual?.objective);
  const expectedObjective = normalizeText(expected);
  const status = normalizeText(actual?.status);
  const activeStatus = status === "" || status === "active" || status === "in_progress" || status === "running";
  if (!expectedObjective && actualObjective && activeStatus) return void 0;
  if (actualObjective && expectedObjective && actualObjective === expectedObjective && activeStatus) {
    return void 0;
  }
  const mismatch = actualObjective ? `current Claude /goal appears unrelated: "${actual?.objective}".` : "no active Claude /goal snapshot was visible to the hook.";
  return `[ULTRAGOAL /GOAL REQUIRED] Active ultragoal state requires the matching Claude /goal before tools run; ${mismatch} Activate /goal with the ultragoal objective, or set ALLOW_ULTRAGOAL_WITHOUT_GOAL=1 to bypass this guard intentionally. Expected objective: ${expected || "<record one in ultragoal-state.json or .omc/ultragoal/goals.json>"}`;
}
function patternMatches(pattern, toolName) {
  if (!pattern) return false;
  try {
    return new RegExp(`^(?:${pattern})$`).test(toolName);
  } catch {
    return false;
  }
}
function forceDelegationReason(rule, observed, toolName, windowSeconds, count) {
  return rule.denyMessage || `[OMC] Force-agent-delegation: ${observed} ${toolName} in last ${windowSeconds}s (threshold ${count}). Delegate to an Agent instead. Bypass: ${rule.bypassEnv || "ALLOW_RAW_READ"}=1.`;
}
function evaluateForceDelegationPure(call, snapshot, ledger) {
  const config = snapshot.forceDelegation;
  if (!config?.enforce) {
    return { nextLedger: ledger };
  }
  const cutoff = snapshot.observedAtSec - FORCE_DELEGATION_RETENTION_SECONDS2;
  const intentId = effectIntentId(
    snapshot,
    call,
    "pretool.force-delegation-attempt.v1",
    call.canonicalName
  );
  const currentEvent = {
    toolName: call.canonicalName,
    observedAtSec: snapshot.observedAtSec,
    originalIndex: call.originalIndex,
    intentId
  };
  const retainedEvents = ledger.events.filter(
    (event) => event.observedAtSec > cutoff && event.observedAtSec <= snapshot.observedAtSec
  );
  const existingIndex = retainedEvents.findIndex(
    (event) => event.intentId === intentId
  );
  const events = existingIndex >= 0 ? retainedEvents : [...retainedEvents, currentEvent];
  const nextLedger = {
    events
  };
  const payload = {
    version: PRE_TOOL_EFFECT_PAYLOAD_VERSION,
    intentId,
    originalIndex: call.originalIndex,
    stateDir: snapshot.stateDir,
    toolName: call.canonicalName,
    observedAtSec: snapshot.observedAtSec
  };
  const effect = hookEffect(
    call,
    "pretool.force-delegation-attempt.v1",
    payload,
    "always"
  );
  for (const rule of config.rules) {
    if (!patternMatches(rule.pattern, call.canonicalName)) continue;
    if (rule.bypassEnv && snapshot.environment[rule.bypassEnv] === "1") {
      continue;
    }
    const count = Number.isFinite(rule.threshold?.count) ? Number(rule.threshold?.count) : 0;
    const windowSeconds = Number.isFinite(rule.threshold?.windowSeconds) ? Number(rule.threshold?.windowSeconds) : FORCE_DELEGATION_DEFAULT_WINDOW_SECONDS;
    if (count <= 0) continue;
    const windowCutoff = snapshot.observedAtSec - windowSeconds;
    const observed = nextLedger.events.filter(
      (event) => event.observedAtSec > windowCutoff && patternMatches(rule.pattern, event.toolName)
    ).length;
    if (observed >= count) {
      return {
        nextLedger,
        effect,
        denyReason: forceDelegationReason(
          rule,
          observed,
          call.canonicalName,
          windowSeconds,
          count
        )
      };
    }
  }
  return { nextLedger, effect };
}
function collectStringValues(value, output = [], depth = 0) {
  if (depth > 5 || output.length > 100) return output;
  if (typeof value === "string") {
    output.push(value);
    return output;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStringValues(item, output, depth + 1);
    return output;
  }
  if (isRecord4(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (/^(cwd|directory|session_?id|transcript_?path|hook_event_name)$/i.test(key)) {
        continue;
      }
      collectStringValues(child, output, depth + 1);
    }
  }
  return output;
}
function collectLikelyPathValues(value, output = [], depth = 0) {
  if (depth > 5 || output.length > 100 || !isRecord4(value)) return output;
  for (const [key, child] of Object.entries(value)) {
    if (typeof child === "string" && /(?:^|_)(?:file_?path|path|filename|target|command)$/i.test(key)) {
      output.push(child);
      continue;
    }
    if (Array.isArray(child)) {
      for (const item of child) {
        if (isRecord4(item)) collectLikelyPathValues(item, output, depth + 1);
      }
    } else if (isRecord4(child)) {
      collectLikelyPathValues(child, output, depth + 1);
    }
  }
  return output;
}
function stripSlopQuotedAndCodeContexts(text) {
  return text.replace(/```[\s\S]*?```/g, "\n").replace(/`[^`\r\n]*`/g, " ").replace(/(["'])(?:\\.|(?!\1)[^\\\r\n])*\1/g, " ");
}
function removeBenignSlopSpans(text) {
  return SLOP_BENIGN_TECHNICAL_PATTERNS.reduce((result, pattern) => {
    const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
    return result.replace(new RegExp(pattern.source, flags), " ");
  }, text);
}
function generateSlopWarning(call, envelope) {
  if (!SLOP_RISK_TOOL_NAMES.has(call.canonicalName)) return "";
  const promptValues = [
    ...envelope.eventPayload.promptAliases ?? [],
    envelope.eventPayload.message
  ];
  const inspectedText = [
    ...collectStringValues(call.input),
    ...collectStringValues(promptValues)
  ].join("\n");
  if (!SLOP_FALLBACK_LANGUAGE_PATTERN.test(inspectedText)) return "";
  const paths = collectLikelyPathValues(call.input);
  if (paths.some((value) => SLOP_SELF_REFERENCE_PATH_PATTERN.test(value))) {
    return "";
  }
  if (paths.some((value) => SLOP_DOC_CONTEXT_PATTERN.test(value))) return "";
  const hasAction = stripSlopQuotedAndCodeContexts(inspectedText).split(/[\r\n!?;]+/).map((segment) => segment.trim()).filter(Boolean).some(
    (segment) => SLOP_FALLBACK_ACTION_PATTERNS.some(
      (pattern) => pattern.test(removeBenignSlopSpans(segment))
    )
  );
  if (!hasAction) return "";
  return "[SLOP WARNING] Detected fallback/workaround language in this tool input. Do not make potential slop: avoid ad-hoc fallback layers, workaround shims, or environment-specific patches unless explicitly justified. For architecture concerns, consult the architect for a concrete design first. If this seems environment-specific, ask the user to confirm constraints before proceeding.";
}
function generateAgentMessage(input, snapshot) {
  if (!input) {
    return snapshot.quietLevel >= 2 ? "" : `${snapshot.todo.label}Launch multiple agents in parallel when tasks are independent. Use run_in_background for long operations.`;
  }
  const agentType = getAgentType2(input) || "unknown";
  const model = nonEmptyString(input.model) || "inherit";
  const description = nonEmptyString(input.description);
  const background = input.run_in_background === true || input.mode === "background" ? " [BACKGROUND]" : "";
  if (snapshot.team.active && !nonEmptyString(input.name)) {
    const teamName = snapshot.team.teamName || "team";
    return `[TEAM ROUTING REQUIRED] Team "${teamName}" is active but you are spawning an unnamed subagent. Claude Code 2.1.178+ uses the session's implicit native agent team; TeamCreate and TeamDelete are removed. Spawn teammates directly with Agent/Task name="worker-N" and subagent_type="${agentType}". Do NOT rely on team_name for routing; native Claude Code accepts it only as ignored legacy metadata.`;
  }
  if (snapshot.quietLevel >= 2) return "";
  const parts = [
    `${snapshot.todo.label}Spawning agent: ${agentType} (${model})${background}`
  ];
  if (description) parts.push(`Task: ${description}`);
  if (snapshot.tracking.running > 0) {
    parts.push(`Active agents: ${snapshot.tracking.running}`);
  }
  return parts.join(" | ");
}
function generateToolMessage(toolName, snapshot) {
  if (snapshot.quietLevel >= 1 && ["Bash", "Edit", "Write", "Read", "Grep", "Glob"].includes(toolName)) {
    return "";
  }
  if (snapshot.quietLevel >= 2 && toolName === "TodoWrite") return "";
  const prefix = snapshot.todo.label;
  const messages = {
    TodoWrite: `${prefix}Mark todos in_progress BEFORE starting, completed IMMEDIATELY after finishing.`,
    Bash: `${prefix}Use parallel execution for independent tasks. Use run_in_background for long operations (npm install, builds, tests).`,
    Edit: `${prefix}Verify changes work after editing. Test functionality before marking complete.`,
    Write: `${prefix}Verify changes work after editing. Test functionality before marking complete.`,
    Read: `${prefix}Read multiple files in parallel when possible for faster analysis.`,
    Grep: `${prefix}Combine searches in parallel when investigating multiple patterns.`,
    Glob: `${prefix}Combine searches in parallel when investigating multiple patterns.`
  };
  if (messages[toolName]) return messages[toolName];
  return snapshot.modeActive ? `${prefix}The boulder never stops. Continue until all tasks complete.` : "";
}
function combineMessages(...messages) {
  return messages.filter(Boolean).join("\n\n");
}
function extractAskUserQuestion(input) {
  if (!isRecord4(input) || !Array.isArray(input.questions)) {
    return "User input requested";
  }
  const questions = input.questions.map(
    (question) => isRecord4(question) ? nonEmptyString(question.question) : ""
  ).filter(Boolean);
  return questions.join("; ") || "User input requested";
}
function buildAdvisoryCandidate(call, snapshot, message) {
  if (!message) return void 0;
  const messageHash = (0, import_node_crypto2.createHash)("sha256").update(message).digest("hex");
  const intentId = effectIntentId(
    snapshot,
    call,
    "pretool.advisory-claim.v1",
    messageHash
  );
  return {
    message,
    messageHash,
    intentId,
    effect: hookEffect(
      call,
      "pretool.advisory-claim.v1",
      {
        version: PRE_TOOL_EFFECT_PAYLOAD_VERSION,
        intentId,
        originalIndex: call.originalIndex,
        stateDir: snapshot.stateDir,
        sessionId: snapshot.sessionId,
        message,
        messageHash,
        nowMs: snapshot.advisoryThrottle.nowMs,
        cooldownMs: snapshot.advisoryThrottle.cooldownMs
      },
      "accepted"
    )
  };
}
function buildPreflightReason(snapshot) {
  return `[OMC] Preflight context guard: ${snapshot.transcript.contextPercent}% used (threshold: ${snapshot.transcript.contextThreshold}%). Avoid spawning additional agent-heavy tasks until context is reduced. Safe recovery: (1) pause new Task fan-out, (2) run /compact now, (3) if compact fails, open a fresh session and continue from .omc/state + .omc/notepad.md.`;
}
function deniedCallPlan(call, reason, effects, nextLedger, presentationKind = "hook-deny", mutation) {
  const evaluation = {
    callId: call.id,
    source: "handler",
    decision: "deny",
    reason,
    ...mutation ? { mutation } : {},
    contexts: [],
    effects
  };
  const legacyPresentation = {
    kind: presentationKind,
    callId: call.id,
    reason
  };
  return {
    call,
    evaluation,
    legacyPresentation,
    nextForceDelegationLedger: nextLedger
  };
}
function evaluatePreToolCall(call, envelope, snapshot, ledger) {
  if (snapshot.disabled) {
    return {
      call,
      evaluation: {
        callId: call.id,
        source: "handler",
        decision: "pass",
        contexts: [],
        effects: []
      },
      legacyPresentation: { kind: "continue", callId: call.id },
      nextForceDelegationLedger: ledger
    };
  }
  const effects = [];
  if (call.canonicalName === "Skill") {
    const skill = extractSkill(call.input);
    if (skill) {
      if (snapshot.directory && snapshot.sessionId) {
        const intentId = effectIntentId(
          snapshot,
          call,
          "pretool.trace-skill-attempt.v1",
          skill.rawSkillName
        );
        const payload = {
          version: PRE_TOOL_EFFECT_PAYLOAD_VERSION,
          intentId,
          originalIndex: call.originalIndex,
          directory: snapshot.directory,
          sessionId: snapshot.sessionId,
          skillName: skill.skillName,
          rawSkillName: skill.rawSkillName,
          observedAt: snapshot.observedAt,
          observedAtMs: snapshot.loadedAtMs
        };
        effects.push(hookEffect(
          call,
          "pretool.trace-skill-attempt.v1",
          payload,
          "always"
        ));
      }
      const protection = skillProtection(
        skill.skillName,
        skill.rawSkillName
      );
      if (protection !== "none") {
        const intentId = effectIntentId(
          snapshot,
          call,
          "pretool.support-skill-upsert.v1",
          skill.skillName
        );
        const payload = {
          version: PRE_TOOL_EFFECT_PAYLOAD_VERSION,
          intentId,
          originalIndex: call.originalIndex,
          directory: snapshot.directory,
          sessionId: snapshot.sessionId,
          skillName: skill.skillName,
          rawSkillName: skill.rawSkillName,
          protection,
          observedAt: snapshot.observedAt
        };
        effects.push(hookEffect(
          call,
          "pretool.support-skill-upsert.v1",
          payload,
          "accepted"
        ));
      }
      for (const modeName of MODE_CONFIRMATION_SKILL_MAP[skill.skillName] ?? []) {
        const observation = snapshot.modeStates[modeName] ?? {
          path: "",
          state: null
        };
        const intentId = effectIntentId(
          snapshot,
          call,
          "pretool.mode-confirm.v1",
          modeName
        );
        const payload = {
          version: PRE_TOOL_EFFECT_PAYLOAD_VERSION,
          intentId,
          originalIndex: call.originalIndex,
          directory: snapshot.directory,
          stateDir: snapshot.stateDir,
          sessionId: snapshot.sessionId,
          modeName,
          observedPath: observation.path,
          observedOwnerSessionId: observedModeOwnerSessionId(observation.state),
          observedGeneration: observedModeGeneration(observation.state),
          observedConfirmationTimestamp: observedModeConfirmationTimestamp(observation.state),
          observedStateDigest: observedModeStateDigest(observation.state)
        };
        effects.push(hookEffect(
          call,
          "pretool.mode-confirm.v1",
          payload,
          "accepted",
          true
        ));
      }
    }
  }
  const ultragoalReason = evaluateUltragoal(call, snapshot);
  if (ultragoalReason) {
    return deniedCallPlan(call, ultragoalReason, effects, ledger);
  }
  const modelRouting = evaluateModelRouting(call, envelope, snapshot);
  if (modelRouting.denyReason) {
    return deniedCallPlan(call, modelRouting.denyReason, effects, ledger);
  }
  const mutation = modelRouting.updatedInput ? requiredMutation(
    call,
    modelRouting.updatedInput,
    Object.fromEntries(
      Object.entries(modelRouting.updatedInput).filter(
        ([key, value]) => !isRecord4(call.input) || call.input[key] !== value
      )
    )
  ) : void 0;
  if (call.canonicalName === "AskUserQuestion") {
    const question = extractAskUserQuestion(call.input);
    const intentId = effectIntentId(
      snapshot,
      call,
      "pretool.ask-user-notify.v1",
      question
    );
    const payload = {
      version: PRE_TOOL_EFFECT_PAYLOAD_VERSION,
      intentId,
      originalIndex: call.originalIndex,
      directory: snapshot.directory,
      sessionId: snapshot.sessionId,
      question
    };
    effects.push(hookEffect(
      call,
      "pretool.ask-user-notify.v1",
      payload,
      "accepted"
    ));
  }
  const forceDelegation = evaluateForceDelegationPure(
    call,
    snapshot,
    ledger
  );
  if (forceDelegation.effect) effects.push(forceDelegation.effect);
  if (forceDelegation.denyReason) {
    return deniedCallPlan(
      call,
      forceDelegation.denyReason,
      effects,
      forceDelegation.nextLedger,
      "hook-deny",
      mutation
    );
  }
  if (AGENT_HEAVY_TOOLS.has(call.canonicalName) && snapshot.transcript.contextPercent >= snapshot.transcript.contextThreshold) {
    return deniedCallPlan(
      call,
      buildPreflightReason(snapshot),
      effects,
      forceDelegation.nextLedger,
      "raw-block",
      mutation
    );
  }
  let advisoryCandidate;
  if (!BUILT_IN_TASK_LIST_TOOL_NAMES.has(call.canonicalName)) {
    const effectiveInput = modelRouting.updatedInput ?? (isRecord4(call.input) ? call.input : null);
    const baseMessage = call.canonicalName === "Task" || call.canonicalName === "Agent" ? generateAgentMessage(effectiveInput, snapshot) : generateToolMessage(call.canonicalName, snapshot);
    const message = combineMessages(
      modelRouting.warning,
      generateSlopWarning(call, envelope),
      baseMessage
    );
    advisoryCandidate = buildAdvisoryCandidate(call, snapshot, message);
    if (advisoryCandidate) effects.push(advisoryCandidate.effect);
  }
  const evaluation = {
    callId: call.id,
    source: "handler",
    decision: "pass",
    ...mutation ? { mutation } : {},
    contexts: [],
    effects
  };
  let legacyPresentation;
  if (advisoryCandidate) {
    legacyPresentation = {
      kind: "context",
      callId: call.id,
      context: advisoryCandidate.message,
      ...modelRouting.updatedInput ? { updatedInput: modelRouting.updatedInput } : {},
      advisoryIntentId: advisoryCandidate.intentId
    };
  } else if (modelRouting.updatedInput) {
    legacyPresentation = {
      kind: "suppressed-with-mutation",
      callId: call.id,
      updatedInput: modelRouting.updatedInput
    };
  } else {
    legacyPresentation = {
      kind: "suppressed",
      callId: call.id
    };
  }
  return {
    call,
    evaluation,
    legacyPresentation,
    nextForceDelegationLedger: forceDelegation.nextLedger,
    ...advisoryCandidate ? { advisoryCandidate } : {}
  };
}
function hasBatchSafetyIssue2(envelope) {
  return envelope.issues.some(
    (issue) => issue.batchSafety === true || issue.scope === "batch" && issue.severity === "safety"
  );
}
function planPreToolBatch(envelope, snapshot) {
  if (hasBatchSafetyIssue2(envelope)) {
    return {
      envelope,
      snapshot,
      calls: [],
      evaluations: [],
      legacyPresentations: [],
      finalForceDelegationLedger: snapshot.forceDelegationLedger
    };
  }
  let ledger = snapshot.forceDelegationLedger;
  const seenAdvisoryHashes = /* @__PURE__ */ new Set();
  const calls = [];
  for (const call of [...envelope.toolCalls].filter((candidate) => !candidate.malformed).sort((left, right) => left.originalIndex - right.originalIndex)) {
    let plan = evaluatePreToolCall(call, envelope, snapshot, ledger);
    ledger = plan.nextForceDelegationLedger;
    const advisory = plan.advisoryCandidate;
    if (advisory && seenAdvisoryHashes.has(advisory.messageHash)) {
      const effects = (plan.evaluation.effects ?? []).filter(
        (effect) => effect.type !== "pretool.advisory-claim.v1"
      );
      const updatedInput = plan.legacyPresentation.kind === "context" ? plan.legacyPresentation.updatedInput : void 0;
      plan = {
        ...plan,
        evaluation: {
          ...plan.evaluation,
          effects
        },
        legacyPresentation: updatedInput ? {
          kind: "suppressed-with-mutation",
          callId: call.id,
          updatedInput
        } : {
          kind: "suppressed",
          callId: call.id
        },
        advisoryCandidate: void 0
      };
    } else if (advisory) {
      seenAdvisoryHashes.add(advisory.messageHash);
    }
    calls.push(plan);
  }
  return {
    envelope,
    snapshot,
    calls,
    evaluations: calls.map((call) => call.evaluation),
    legacyPresentations: calls.map((call) => call.legacyPresentation),
    finalForceDelegationLedger: ledger
  };
}

// src/hooks/pre-tool-enforcer/effects.ts
var import_node_fs2 = require("node:fs");
var import_node_path3 = require("node:path");
init_atomic_write();
init_mode_state_io();
init_notifications();

// src/hooks/background-notifications.ts
var import_child_process6 = require("child_process");
var import_crypto8 = require("crypto");
var import_fs10 = require("fs");
var import_path13 = require("path");
var SPAWN_ACKNOWLEDGEMENT_TIMEOUT_MS = 500;
var GATE_RELEASE_TIMEOUT_MS = 500;
var BACKGROUND_NOTIFICATION_GATE_TYPE = "omc.notification.dispatch.v1";
function resolveBackgroundNotificationRuntimeContext(pluginRoot) {
  const root = (0, import_path13.resolve)(pluginRoot);
  return {
    childEntrypointPath: (0, import_path13.join)(
      root,
      "scripts",
      "lib",
      "notification-child.cjs"
    ),
    hookRuntimePath: (0, import_path13.join)(root, "bridge", "hook-runtime.cjs")
  };
}
function defaultRuntimeContext() {
  const environmentRoot = process.env.CLAUDE_PLUGIN_ROOT?.trim();
  if (environmentRoot) {
    return resolveBackgroundNotificationRuntimeContext(environmentRoot);
  }
  if (typeof __dirname === "undefined" || !__dirname) return null;
  const root = (0, import_path13.basename)(__dirname) === "bridge" ? (0, import_path13.dirname)(__dirname) : (0, import_path13.resolve)(__dirname, "..", "..");
  return resolveBackgroundNotificationRuntimeContext(root);
}
function isFile(path3) {
  try {
    return (0, import_fs10.existsSync)(path3) && (0, import_fs10.statSync)(path3).isFile();
  } catch {
    return false;
  }
}
function terminateChild(child) {
  try {
    child.kill();
  } catch {
  }
}
function disconnectChild(child) {
  try {
    if (child.connected) child.disconnect();
  } catch {
  }
}
function acknowledgedChild(child, gate) {
  let handled = false;
  return {
    status: "acknowledged",
    release() {
      if (handled) return Promise.resolve("failed");
      handled = true;
      return new Promise((resolveRelease) => {
        let settled = false;
        const settle = (result) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          if (result === "released") {
            disconnectChild(child);
            child.unref();
          } else {
            terminateChild(child);
            disconnectChild(child);
          }
          resolveRelease(result);
        };
        const timeout = setTimeout(() => {
          settle("failed");
        }, GATE_RELEASE_TIMEOUT_MS);
        try {
          child.send({
            type: BACKGROUND_NOTIFICATION_GATE_TYPE,
            intentId: gate.intentId,
            claimId: gate.claimId
          }, (error) => {
            settle(error ? "failed" : "released");
          });
        } catch {
          settle("failed");
        }
      });
    },
    terminate() {
      if (handled) return;
      handled = true;
      terminateChild(child);
      disconnectChild(child);
    }
  };
}
async function runHookNotificationChild(event, data) {
  const { notify: notify2 } = await Promise.resolve().then(() => (init_notifications(), notifications_exports));
  await notify2(event, data);
}
async function dispatchNotificationInBackground(event, data, runtimeContext, requestedGate) {
  if (process.env.OMC_NOTIFY === "0") return { status: "disabled" };
  let serializedEvent;
  let serializedData;
  try {
    serializedEvent = JSON.stringify(event);
    serializedData = JSON.stringify(data);
  } catch {
    return { status: "failed" };
  }
  const resolvedContext = runtimeContext ?? defaultRuntimeContext();
  const gate = requestedGate ?? {
    intentId: (0, import_crypto8.randomUUID)(),
    claimId: (0, import_crypto8.randomUUID)()
  };
  if (!resolvedContext || !isFile(resolvedContext.childEntrypointPath) || !isFile(resolvedContext.hookRuntimePath) || !gate.intentId || !gate.claimId) {
    return { status: "failed" };
  }
  let child;
  try {
    child = (0, import_child_process6.spawn)(
      process.execPath,
      [
        resolvedContext.childEntrypointPath,
        resolvedContext.hookRuntimePath,
        serializedEvent,
        serializedData,
        gate.intentId,
        gate.claimId
      ],
      {
        cwd: (0, import_path13.dirname)(process.execPath),
        detached: true,
        stdio: ["ignore", "ignore", "ignore", "ipc"],
        windowsHide: true,
        env: {
          ...process.env,
          OMC_HOOK_BACKGROUND_CHILD: "1"
        }
      }
    );
  } catch {
    return { status: "failed" };
  }
  return new Promise((resolveQueue) => {
    let settled = false;
    const settle = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolveQueue(result);
    };
    const timeout = setTimeout(() => {
      settle({ status: "failed" });
    }, SPAWN_ACKNOWLEDGEMENT_TIMEOUT_MS);
    child.once("error", () => {
      settle({ status: "failed" });
    });
    child.once("spawn", () => {
      if (settled) {
        terminateChild(child);
        return;
      }
      settle(acknowledgedChild(child, gate));
    });
  });
}

// src/hooks/skill-state/index.ts
var import_fs12 = require("fs");
init_worktree_paths();
init_atomic_write();
init_mode_state_io();

// src/hooks/subagent-tracker/index.ts
init_worktree_paths();
init_file_lock();

// src/hooks/subagent-tracker/session-replay.ts
var import_fs11 = require("fs");
var import_path14 = require("path");
init_worktree_paths();
init_atomic_write();
init_mode_state_io();
var REPLAY_PREFIX = "agent-replay-";
var MAX_REPLAY_SIZE_BYTES = 5 * 1024 * 1024;
var sessionStartTimes = /* @__PURE__ */ new Map();
function getReplayFilePath(directory, sessionId) {
  const stateDir = (0, import_path14.join)(getOmcRoot(directory), "state");
  if (!(0, import_fs11.existsSync)(stateDir)) {
    (0, import_fs11.mkdirSync)(stateDir, { recursive: true });
  }
  const safeId = sessionId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return (0, import_path14.join)(stateDir, `${REPLAY_PREFIX}${safeId}.jsonl`);
}
function appendReplayEventOnce(directory, sessionId, intentId, event, observedAtMs = Date.now()) {
  if (!intentId) return { status: "failed" };
  try {
    const filePath = getReplayFilePath(directory, sessionId);
    const locked = withStateFileMutationLock(filePath, () => {
      let lines = [];
      if ((0, import_fs11.existsSync)(filePath)) {
        try {
          if ((0, import_fs11.statSync)(filePath).size > MAX_REPLAY_SIZE_BYTES) {
            return { status: "failed" };
          }
          lines = (0, import_fs11.readFileSync)(filePath, "utf8").split("\n").filter(Boolean);
        } catch {
          return { status: "failed" };
        }
      }
      if (!sessionStartTimes.has(sessionId)) {
        sessionStartTimes.set(sessionId, observedAtMs);
      }
      const start = sessionStartTimes.get(sessionId) ?? observedAtMs;
      const replayEvent = {
        t: Math.round((observedAtMs - start) / 1e3 * 10) / 10,
        ...event,
        intent_id: intentId
      };
      const serialized = JSON.stringify(replayEvent);
      const existingIndex = lines.findIndex((line) => {
        try {
          return JSON.parse(line).intent_id === intentId;
        } catch {
          return false;
        }
      });
      if (existingIndex >= 0) {
        let existingEvent;
        try {
          existingEvent = JSON.parse(lines[existingIndex]);
        } catch {
          return { status: "failed" };
        }
        const reconciledEvent = {
          ...replayEvent,
          t: existingEvent.t
        };
        if (Object.prototype.hasOwnProperty.call(existingEvent, "observed_at")) {
          reconciledEvent.observed_at = existingEvent.observed_at;
        } else {
          delete reconciledEvent.observed_at;
        }
        const reconciled = JSON.stringify(reconciledEvent);
        if (lines[existingIndex] === reconciled) {
          return { status: "duplicate" };
        }
        lines[existingIndex] = reconciled;
        atomicWriteFileSync(filePath, `${lines.join("\n")}
`);
        return { status: "reconciled" };
      }
      lines.push(serialized);
      atomicWriteFileSync(filePath, `${lines.join("\n")}
`);
      return { status: "appended" };
    });
    return locked.acquired && locked.value ? locked.value : { status: "failed" };
  } catch {
    return { status: "failed" };
  }
}

// src/hud/mission-board.ts
init_atomic_write();
init_file_lock();
init_worktree_paths();

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
var SKILL_ACTIVE_STATE_MODE = "skill-active";
var WORKFLOW_TOMBSTONE_TTL_MS = 24 * 60 * 60 * 1e3;
var SKILL_SEEN_INTENT_LIMIT = 128;
var SESSION_ID_PATTERN2 = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,255}$/;
var PROTECTION_CONFIGS = {
  none: { maxReinforcements: 0, staleTtlMs: 0 },
  light: { maxReinforcements: 3, staleTtlMs: 5 * 60 * 1e3 },
  // 5 min
  medium: { maxReinforcements: 5, staleTtlMs: 15 * 60 * 1e3 },
  // 15 min
  heavy: { maxReinforcements: 10, staleTtlMs: 30 * 60 * 1e3 }
  // 30 min
};
var SKILL_PROTECTION2 = {
  // === Canonical workflow skills — bypass support-skill protection; flow through the workflow-slot path ===
  autopilot: "none",
  autoresearch: "none",
  ralph: "none",
  ultrawork: "none",
  team: "none",
  "omc-teams": "none",
  ultraqa: "none",
  ralplan: "none",
  "self-improve": "none",
  cancel: "none",
  // === Instant / read-only → no protection needed ===
  trace: "none",
  hud: "none",
  "omc-doctor": "none",
  "omc-help": "none",
  "learn-about-omc": "none",
  note: "none",
  // === Light protection (simple shortcuts, 3 reinforcements) ===
  skill: "light",
  ask: "light",
  "configure-notifications": "light",
  // === Medium protection (review/planning, 5 reinforcements) ===
  "omc-plan": "medium",
  plan: "medium",
  "deep-interview": "heavy",
  review: "medium",
  "external-context": "medium",
  "ai-slop-cleaner": "medium",
  sciomc: "medium",
  skillify: "medium",
  learner: "medium",
  "omc-setup": "medium",
  setup: "medium",
  "mcp-setup": "medium",
  "project-session-manager": "medium",
  psm: "medium",
  "writer-memory": "medium",
  "ralph-init": "medium",
  release: "medium",
  ccg: "medium",
  // === Heavy protection (long-running, 10 reinforcements) ===
  deepinit: "heavy"
};
function getSkillProtection(skillName, rawSkillName) {
  if (rawSkillName != null && !rawSkillName.toLowerCase().startsWith("oh-my-claudecode:")) {
    return "none";
  }
  const normalized = skillName.toLowerCase().replace(/^oh-my-claudecode:/, "");
  return SKILL_PROTECTION2[normalized] ?? "none";
}
function isWorkflowSkillCompleted(slot) {
  return typeof slot.completed_at === "string" && slot.completed_at.trim().length > 0;
}
function emptySkillActiveStateV2() {
  return { version: 2, active_skills: {} };
}
function isEmptyV2(state) {
  return Object.keys(state.active_skills).length === 0 && !state.support_skill && (state.seen_intents?.length ?? 0) === 0 && Object.keys(state.session_ledgers ?? {}).length === 0 && Object.keys(state.session_tombstones ?? {}).length === 0 && !state.global_ledger;
}
var SkillStateCorruptionError = class extends Error {
  path;
  constructor(path3) {
    super(`Corrupt skill-active state: ${path3}`);
    this.name = "SkillStateCorruptionError";
    this.path = path3;
  }
};
function isPlainRecord2(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function isValidActiveSkillsShape(value) {
  return value === void 0 || isPlainRecord2(value) && Object.values(value).every((slot) => isPlainRecord2(slot));
}
function isValidSupportSkillShape(value) {
  return value === void 0 || value === null || isPlainRecord2(value);
}
function isValidSessionLedgerShape(value) {
  if (!isPlainRecord2(value)) return false;
  return isValidActiveSkillsShape(value.active_skills) && isValidSupportSkillShape(value.support_skill) && (value.generation === void 0 || typeof value.generation === "number" && Number.isSafeInteger(value.generation) && value.generation >= 0) && (value.seen_intents === void 0 || Array.isArray(value.seen_intents));
}
function isValidSkillStatePayload(value) {
  if (!isPlainRecord2(value)) return false;
  const { _meta, ...state } = value;
  void _meta;
  const looksV2 = state.version === 2 || "active_skills" in state || "support_skill" in state || "global_ledger" in state || "session_ledgers" in state || "session_tombstones" in state;
  if (looksV2) {
    if (state.version !== void 0 && state.version !== 2) return false;
    if (state.generation !== void 0 && (typeof state.generation !== "number" || !Number.isSafeInteger(state.generation) || state.generation < 0)) {
      return false;
    }
    if (!isValidActiveSkillsShape(state.active_skills)) return false;
    if (!isValidSupportSkillShape(state.support_skill)) return false;
    if (state.global_ledger !== void 0 && !isValidSessionLedgerShape(state.global_ledger)) {
      return false;
    }
    if (state.session_ledgers !== void 0) {
      if (!isPlainRecord2(state.session_ledgers)) return false;
      if (!Object.entries(state.session_ledgers).every(
        ([sessionId, ledger]) => SESSION_ID_PATTERN2.test(sessionId) && isValidSessionLedgerShape(ledger)
      )) {
        return false;
      }
    }
    if (state.session_tombstones !== void 0) {
      if (!isPlainRecord2(state.session_tombstones)) return false;
      if (!Object.entries(state.session_tombstones).every(
        ([sessionId, generation]) => SESSION_ID_PATTERN2.test(sessionId) && typeof generation === "number" && Number.isSafeInteger(generation) && generation >= 0
      )) {
        return false;
      }
    }
    return true;
  }
  return typeof state.active === "boolean" && typeof state.skill_name === "string";
}
function inspectSkillStateFile(path3) {
  if (!(0, import_fs12.existsSync)(path3)) return { status: "missing" };
  try {
    const raw = JSON.parse((0, import_fs12.readFileSync)(path3, "utf-8"));
    return isValidSkillStatePayload(raw) ? { status: "valid", raw } : { status: "corrupt" };
  } catch {
    return { status: "corrupt" };
  }
}
function readRawFromPath(path3) {
  const inspected = inspectSkillStateFile(path3);
  if (inspected.status === "missing") return null;
  if (inspected.status === "corrupt") {
    throw new SkillStateCorruptionError(path3);
  }
  return inspected.raw;
}
function isLegacyScalarSkillState(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const state = raw;
  return state.version !== 2 && typeof state.active === "boolean" && typeof state.skill_name === "string" && !("active_skills" in state) && !("support_skill" in state);
}
function normalizedGeneration(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}
function nextSkillGeneration(generation) {
  return generation < Number.MAX_SAFE_INTEGER ? generation + 1 : null;
}
function normalizeSeenIntents(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(
    value.filter(
      (intent) => typeof intent === "string" && intent.length > 0
    )
  )].slice(-SKILL_SEEN_INTENT_LIMIT);
}
function normalizeActiveSkills(value) {
  const activeSkills = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return activeSkills;
  }
  for (const [name, slot] of Object.entries(
    value
  )) {
    if (slot && typeof slot === "object" && !Array.isArray(slot)) {
      activeSkills[name] = { ...slot };
    }
  }
  return activeSkills;
}
function normalizeSupportSkill(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? { ...value } : null;
}
function normalizeSessionLedger(value) {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const supportSkill = normalizeSupportSkill(record.support_skill);
  return {
    generation: normalizedGeneration(record.generation),
    seen_intents: normalizeSeenIntents([
      ...Array.isArray(record.seen_intents) ? record.seen_intents : [],
      ...supportSkill?.last_intent_id ? [supportSkill.last_intent_id] : []
    ]),
    active_skills: normalizeActiveSkills(record.active_skills),
    support_skill: supportSkill
  };
}
function stateFromLedger(ledger) {
  return {
    version: 2,
    generation: ledger.generation,
    seen_intents: [...ledger.seen_intents],
    active_skills: { ...ledger.active_skills },
    support_skill: ledger.support_skill ? { ...ledger.support_skill } : null
  };
}
function ledgerFromState(state) {
  return normalizeSessionLedger(state);
}
function normalizeToV2(raw) {
  if (!raw || typeof raw !== "object") {
    return emptySkillActiveStateV2();
  }
  const obj = raw;
  const { _meta, ...rest } = obj;
  void _meta;
  const state = rest;
  const looksV2 = state.version === 2 || "active_skills" in state || "support_skill" in state || "global_ledger" in state || "session_ledgers" in state || "session_tombstones" in state;
  if (looksV2) {
    const sessionLedgers = {};
    const sessionTombstones = {};
    if (state.session_ledgers && typeof state.session_ledgers === "object" && !Array.isArray(state.session_ledgers)) {
      for (const [sessionId, ledger] of Object.entries(
        state.session_ledgers
      )) {
        if (SESSION_ID_PATTERN2.test(sessionId)) {
          sessionLedgers[sessionId] = sanitizeLedgerForSession(
            normalizeSessionLedger(ledger),
            sessionId
          );
        }
      }
    }
    if (state.session_tombstones && typeof state.session_tombstones === "object" && !Array.isArray(state.session_tombstones)) {
      for (const [sessionId, generation] of Object.entries(
        state.session_tombstones
      )) {
        if (SESSION_ID_PATTERN2.test(sessionId) && typeof generation === "number" && Number.isSafeInteger(generation) && generation >= 0) {
          sessionTombstones[sessionId] = generation;
        }
      }
    }
    return {
      version: 2,
      generation: normalizedGeneration(state.generation),
      seen_intents: normalizeSeenIntents(state.seen_intents),
      active_skills: normalizeActiveSkills(state.active_skills),
      support_skill: normalizeSupportSkill(state.support_skill),
      ...state.global_ledger ? { global_ledger: normalizeSessionLedger(state.global_ledger) } : {},
      ...Object.keys(sessionLedgers).length > 0 ? { session_ledgers: sessionLedgers } : {},
      ...Object.keys(sessionTombstones).length > 0 ? { session_tombstones: sessionTombstones } : {}
    };
  }
  if (typeof state.active === "boolean" && typeof state.skill_name === "string") {
    return {
      version: 2,
      active_skills: {},
      support_skill: state
    };
  }
  return emptySkillActiveStateV2();
}
function rawStateSessionOwner(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return void 0;
  const record = raw;
  const meta = record._meta && typeof record._meta === "object" ? record._meta : null;
  const owner = meta?.sessionId ?? record.session_id;
  return typeof owner === "string" && owner.length > 0 ? owner : void 0;
}
function migrateLegacyRootLedger(root, raw) {
  if (root.global_ledger || Object.keys(root.session_ledgers ?? {}).length > 0 || Object.keys(root.session_tombstones ?? {}).length > 0) {
    return root;
  }
  const legacyLedger = ledgerFromState(root);
  if (Object.keys(legacyLedger.active_skills).length === 0 && !legacyLedger.support_skill && legacyLedger.seen_intents.length === 0) {
    return root;
  }
  const owner = rawStateSessionOwner(raw);
  if (owner && SESSION_ID_PATTERN2.test(owner)) {
    return {
      ...root,
      session_ledgers: {
        [owner]: sanitizeLedgerForSession(legacyLedger, owner)
      }
    };
  }
  return {
    ...root,
    global_ledger: legacyLedger
  };
}
function sanitizeSessionLedger(state, sessionId) {
  const activeSkills = Object.fromEntries(
    Object.entries(state.active_skills).flatMap(([name, slot]) => {
      if (slot.session_id && slot.session_id !== sessionId) return [];
      return [[name, {
        ...slot,
        session_id: sessionId
      }]];
    })
  );
  const support = state.support_skill && (!state.support_skill.session_id || state.support_skill.session_id === sessionId) ? {
    ...state.support_skill,
    session_id: sessionId
  } : null;
  return {
    version: 2,
    generation: normalizedGeneration(state.generation),
    seen_intents: normalizeSeenIntents(state.seen_intents),
    active_skills: activeSkills,
    support_skill: support
  };
}
function sanitizeLedgerForSession(ledger, sessionId) {
  return ledgerFromState(
    sanitizeSessionLedger(stateFromLedger(ledger), sessionId)
  );
}
function comparableLedger(ledger) {
  return {
    generation: ledger.generation,
    seen_intents: ledger.seen_intents,
    active_skills: Object.fromEntries(
      Object.entries(ledger.active_skills).sort(([left], [right]) => left.localeCompare(right))
    ),
    support_skill: ledger.support_skill ?? null
  };
}
function ledgersEqual(left, right) {
  if (!left || !right) return left === right;
  return JSON.stringify(comparableLedger(left)) === JSON.stringify(comparableLedger(right));
}
function selectAuthoritativeLedger(rootLedger, sessionLedger, tombstoneGeneration) {
  const highestLiveGeneration = Math.max(
    rootLedger?.generation ?? 0,
    sessionLedger?.generation ?? 0
  );
  if (tombstoneGeneration !== void 0 && tombstoneGeneration >= highestLiveGeneration) {
    return {
      generation: tombstoneGeneration,
      seen_intents: [],
      active_skills: {},
      support_skill: null
    };
  }
  if (!rootLedger) return sessionLedger ?? normalizeSessionLedger(null);
  if (!sessionLedger) return rootLedger;
  if (rootLedger.generation > sessionLedger.generation) return rootLedger;
  return sessionLedger;
}
function slotProjectionTime(slot) {
  const timestamps = isWorkflowSkillCompleted(slot) ? [slot.completed_at] : [slot.started_at, slot.last_confirmed_at];
  return timestamps.reduce((latest, timestamp) => {
    const parsed = typeof timestamp === "string" ? Date.parse(timestamp) : Number.NaN;
    return Number.isFinite(parsed) ? Math.max(latest, parsed) : latest;
  }, Number.NEGATIVE_INFINITY);
}
function preferProjectedSlot(current, candidate) {
  if (!current) return candidate;
  const currentTime = slotProjectionTime(current);
  const candidateTime = slotProjectionTime(candidate);
  if (candidateTime !== currentTime) {
    return candidateTime > currentTime ? candidate : current;
  }
  const currentCompleted = isWorkflowSkillCompleted(current);
  const candidateCompleted = isWorkflowSkillCompleted(candidate);
  if (currentCompleted !== candidateCompleted) {
    return candidateCompleted ? current : candidate;
  }
  return candidate.session_id.localeCompare(current.session_id) > 0 ? candidate : current;
}
function aggregateRootProjection(root) {
  const ledgers = [
    ...root.global_ledger ? [{ key: "", ledger: root.global_ledger }] : [],
    ...Object.entries(root.session_ledgers ?? {}).map(
      ([key, ledger]) => ({ key, ledger })
    )
  ].sort((left, right) => left.key.localeCompare(right.key));
  const activeSkills = {};
  let supportSkill = null;
  for (const { ledger } of ledgers) {
    for (const [skillName, slot] of Object.entries(ledger.active_skills)) {
      activeSkills[skillName] = preferProjectedSlot(
        activeSkills[skillName],
        slot
      );
    }
    if (ledger.support_skill) {
      supportSkill = ledger.support_skill;
    }
  }
  return {
    ...root,
    version: 2,
    generation: ledgers.reduce(
      (highest, { ledger }) => Math.max(highest, ledger.generation),
      Math.max(
        normalizedGeneration(root.generation),
        ...Object.values(root.session_tombstones ?? {})
      )
    ),
    seen_intents: root.global_ledger?.seen_intents ?? [],
    active_skills: activeSkills,
    support_skill: supportSkill
  };
}
function appendSeenIntent(seenIntents, intentId) {
  if (!intentId) return normalizeSeenIntents(seenIntents);
  return normalizeSeenIntents([
    ...seenIntents.filter((candidate) => candidate !== intentId),
    intentId
  ]);
}
function writeSkillLedgerFile(path3, state, sessionId) {
  if (!state || isEmptyV2(state)) {
    if (!(0, import_fs12.existsSync)(path3)) return true;
    try {
      (0, import_fs12.unlinkSync)(path3);
      return true;
    } catch {
      return false;
    }
  }
  try {
    atomicWriteJsonSync(path3, {
      ...state,
      version: 2,
      _meta: {
        written_at: (/* @__PURE__ */ new Date()).toISOString(),
        mode: SKILL_ACTIVE_STATE_MODE,
        generation: normalizedGeneration(state.generation),
        ...sessionId ? { sessionId } : {}
      }
    });
    return true;
  } catch {
    return false;
  }
}
function observeSessionLedgerCommit(rootPath, sessionPath, sessionId) {
  const rootRaw = readRawFromPath(rootPath);
  const rootState = migrateLegacyRootLedger(
    normalizeToV2(rootRaw),
    rootRaw
  );
  const sessionRaw = readRawFromPath(sessionPath);
  return {
    rootState,
    rootLedger: rootState.session_ledgers?.[sessionId],
    tombstoneGeneration: rootState.session_tombstones?.[sessionId],
    sessionLedger: sessionRaw === null ? void 0 : ledgerFromState(sanitizeSessionLedger(
      normalizeToV2(sessionRaw),
      sessionId
    ))
  };
}
function comparableRootState(state) {
  const sessionLedgers = Object.fromEntries(
    Object.entries(state.session_ledgers ?? {}).sort(([left], [right]) => left.localeCompare(right)).map(([sessionId, ledger]) => [
      sessionId,
      comparableLedger(ledger)
    ])
  );
  return {
    generation: normalizedGeneration(state.generation),
    seen_intents: normalizeSeenIntents(state.seen_intents),
    active_skills: Object.fromEntries(
      Object.entries(state.active_skills).sort(([left], [right]) => left.localeCompare(right))
    ),
    support_skill: state.support_skill ?? null,
    global_ledger: state.global_ledger ? comparableLedger(state.global_ledger) : null,
    session_ledgers: sessionLedgers,
    session_tombstones: Object.fromEntries(
      Object.entries(state.session_tombstones ?? {}).sort(([left], [right]) => left.localeCompare(right))
    )
  };
}
function normalizedRootState(raw) {
  return aggregateRootProjection(
    migrateLegacyRootLedger(normalizeToV2(raw), raw)
  );
}
function rootStatesEqual(left, right) {
  return JSON.stringify(comparableRootState(left)) === JSON.stringify(comparableRootState(right));
}
function mutateSkillActiveStateLocked(directory, sessionId, mutate, options = {}) {
  if (sessionId && !SESSION_ID_PATTERN2.test(sessionId)) {
    return { status: "failed" };
  }
  const rootPath = resolveStatePath("skill-active", directory);
  try {
    const locked = withStateFileMutationLock(rootPath, () => {
      const rootRaw = readRawFromPath(rootPath);
      let root = migrateLegacyRootLedger(normalizeToV2(rootRaw), rootRaw);
      if (!sessionId) {
        const currentLedger = root.global_ledger ?? normalizeSessionLedger(null);
        const current2 = stateFromLedger(currentLedger);
        const duplicate2 = !!options.intentId && currentLedger.seen_intents.includes(options.intentId);
        if (duplicate2 && options.rootState === void 0) {
          return { status: "skipped", state: current2 };
        }
        const mutationResult2 = duplicate2 ? current2 : mutate(current2);
        const explicitNoop2 = !duplicate2 && mutationResult2 === current2;
        if (explicitNoop2 && options.rootState === void 0) {
          return { status: "skipped", state: current2 };
        }
        const mutated2 = duplicate2 || explicitNoop2 ? current2 : normalizeToV2(mutationResult2);
        const contentChanged2 = !ledgersEqual(
          currentLedger,
          ledgerFromState({
            ...mutated2,
            generation: currentLedger.generation,
            seen_intents: currentLedger.seen_intents
          })
        );
        if (!contentChanged2 && !options.intentId && options.rootState === void 0) {
          return {
            status: "skipped",
            state: current2
          };
        }
        let nextLedger2 = currentLedger;
        if (!duplicate2 && !explicitNoop2 && contentChanged2) {
          const generation = nextSkillGeneration(currentLedger.generation);
          if (generation === null) {
            return { status: "failed" };
          }
          nextLedger2 = {
            ...ledgerFromState(mutated2),
            generation,
            seen_intents: appendSeenIntent(
              currentLedger.seen_intents,
              options.intentId
            )
          };
        }
        const globalIsEmpty = Object.keys(nextLedger2.active_skills).length === 0 && !nextLedger2.support_skill && nextLedger2.seen_intents.length === 0;
        const mutatedRoot = aggregateRootProjection({
          ...root,
          global_ledger: globalIsEmpty ? void 0 : nextLedger2
        });
        const desiredRoot2 = options.rootState === void 0 ? mutatedRoot : options.rootState === null ? null : normalizedRootState(options.rootState);
        const writeSucceeded = writeSkillLedgerFile(
          rootPath,
          desiredRoot2 && !isEmptyV2(desiredRoot2) ? desiredRoot2 : null
        );
        const persistedRead = inspectSkillStateFile(rootPath);
        const committed = desiredRoot2 === null || isEmptyV2(desiredRoot2) ? persistedRead.status === "missing" : persistedRead.status === "valid" && rootStatesEqual(
          normalizedRootState(persistedRead.raw),
          desiredRoot2
        );
        if (!committed) {
          return { status: "failed" };
        }
        return {
          status: duplicate2 || explicitNoop2 || !writeSucceeded ? "repaired" : "written",
          state: stateFromLedger(nextLedger2)
        };
      }
      const sessionPath = resolveSessionStatePath(
        "skill-active",
        sessionId,
        directory
      );
      const sessionExists = (0, import_fs12.existsSync)(sessionPath);
      const rootLedger = root.session_ledgers?.[sessionId];
      const sessionRaw = sessionExists ? readRawFromPath(sessionPath) : null;
      const sessionLedger = sessionRaw !== null ? ledgerFromState(sanitizeSessionLedger(
        normalizeToV2(sessionRaw),
        sessionId
      )) : void 0;
      const authoritative = selectAuthoritativeLedger(
        rootLedger,
        sessionLedger,
        root.session_tombstones?.[sessionId]
      );
      const copiesMatch = ledgersEqual(rootLedger, authoritative) && ledgersEqual(sessionLedger, authoritative);
      const current = sanitizeSessionLedger(
        stateFromLedger(authoritative),
        sessionId
      );
      const duplicate = !!options.intentId && authoritative.seen_intents.includes(options.intentId);
      const mutationResult = duplicate ? current : mutate(current);
      const explicitNoop = !duplicate && mutationResult === current;
      const mutated = duplicate || explicitNoop ? current : sanitizeSessionLedger(normalizeToV2(mutationResult), sessionId);
      const candidateLedger = ledgerFromState({
        ...mutated,
        generation: authoritative.generation,
        seen_intents: authoritative.seen_intents
      });
      const contentChanged = !ledgersEqual(
        authoritative,
        candidateLedger
      );
      if (!contentChanged && !options.intentId && options.rootState === void 0 && (isLegacyScalarSkillState(rootRaw) || isLegacyScalarSkillState(sessionRaw))) {
        return { status: "skipped", state: current };
      }
      if ((duplicate || explicitNoop) && copiesMatch && options.rootState === void 0) {
        return { status: "skipped", state: current };
      }
      if (!contentChanged && !options.intentId && copiesMatch && options.rootState === void 0) {
        return { status: "skipped", state: current };
      }
      let nextLedger = authoritative;
      if (!duplicate && !explicitNoop) {
        const generation = nextSkillGeneration(Math.max(
          rootLedger?.generation ?? 0,
          sessionLedger?.generation ?? 0,
          root.session_tombstones?.[sessionId] ?? 0
        ));
        if (generation === null) {
          return { status: "failed" };
        }
        nextLedger = {
          ...ledgerFromState(mutated),
          generation,
          seen_intents: appendSeenIntent(
            authoritative.seen_intents,
            options.intentId
          )
        };
      }
      const sessionLedgers = {
        ...root.session_ledgers ?? {}
      };
      const sessionTombstones = {
        ...root.session_tombstones ?? {}
      };
      const localIsEmpty = Object.keys(nextLedger.active_skills).length === 0 && !nextLedger.support_skill && nextLedger.seen_intents.length === 0;
      if (localIsEmpty) {
        delete sessionLedgers[sessionId];
        if (!duplicate && !explicitNoop) delete sessionTombstones[sessionId];
      } else {
        sessionLedgers[sessionId] = nextLedger;
        delete sessionTombstones[sessionId];
      }
      root = aggregateRootProjection({
        ...root,
        session_ledgers: Object.keys(sessionLedgers).length > 0 ? sessionLedgers : void 0,
        session_tombstones: Object.keys(sessionTombstones).length > 0 ? sessionTombstones : void 0
      });
      const nextSessionState = localIsEmpty ? null : stateFromLedger(nextLedger);
      const desiredRoot = options.rootState === void 0 ? root : options.rootState === null ? null : normalizedRootState(options.rootState);
      const expectedLedger = localIsEmpty ? void 0 : nextLedger;
      let authoritativeCommitVisible = false;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const rootWriteSucceeded = writeSkillLedgerFile(
          rootPath,
          desiredRoot && !isEmptyV2(desiredRoot) ? desiredRoot : null
        );
        const sessionWriteSucceeded = writeSkillLedgerFile(
          sessionPath,
          nextSessionState,
          sessionId
        );
        const observation = observeSessionLedgerCommit(
          rootPath,
          sessionPath,
          sessionId
        );
        const sessionMatches = ledgersEqual(
          observation.sessionLedger,
          expectedLedger
        );
        const rootMatches = options.rootState === null ? !(0, import_fs12.existsSync)(rootPath) : options.rootState !== void 0 && desiredRoot ? rootStatesEqual(observation.rootState, desiredRoot) : ledgersEqual(observation.rootLedger, expectedLedger);
        if (rootMatches && sessionMatches) {
          return {
            status: duplicate || explicitNoop || !copiesMatch && !contentChanged || !rootWriteSucceeded || !sessionWriteSucceeded ? "repaired" : "written",
            state: nextSessionState ?? emptySkillActiveStateV2()
          };
        }
        if (expectedLedger) {
          authoritativeCommitVisible ||= ledgersEqual(
            selectAuthoritativeLedger(
              observation.rootLedger,
              observation.sessionLedger,
              observation.tombstoneGeneration
            ),
            expectedLedger
          );
        } else if (options.rootState !== void 0) {
          authoritativeCommitVisible ||= sessionMatches || rootMatches;
        } else {
          const observed = selectAuthoritativeLedger(
            observation.rootLedger,
            observation.sessionLedger,
            observation.tombstoneGeneration
          );
          authoritativeCommitVisible ||= Object.keys(observed.active_skills).length === 0 && !observed.support_skill && observed.seen_intents.length === 0 && (observation.tombstoneGeneration !== void 0 || observation.rootLedger === void 0 && observation.sessionLedger === void 0);
        }
      }
      return authoritativeCommitVisible ? {
        status: "repaired",
        state: nextSessionState ?? emptySkillActiveStateV2()
      } : { status: "failed" };
    });
    return locked.acquired && locked.value ? locked.value : { status: "failed" };
  } catch {
    return { status: "failed" };
  }
}
function upsertSupportSkillActiveStateLocked(directory, skillName, sessionId, rawSkillName, options = {}) {
  const protection = getSkillProtection(skillName, rawSkillName);
  if (protection === "none") return { status: "skipped" };
  const normalized = skillName.toLowerCase().replace(/^oh-my-claudecode:/, "");
  const config = PROTECTION_CONFIGS[protection];
  const observedAt = options.observedAt ?? (/* @__PURE__ */ new Date()).toISOString();
  const result = mutateSkillActiveStateLocked(
    directory,
    sessionId,
    (current) => {
      const existing = current.support_skill;
      if (existing?.active && existing.skill_name !== normalized) {
        return current;
      }
      const support = {
        active: true,
        skill_name: normalized,
        session_id: sessionId,
        started_at: observedAt,
        last_checked_at: observedAt,
        reinforcement_count: 0,
        max_reinforcements: config.maxReinforcements,
        stale_ttl_ms: config.staleTtlMs,
        ...options.intentId ? { last_intent_id: options.intentId } : {}
      };
      return {
        ...current,
        support_skill: support
      };
    },
    {
      ...options.intentId ? { intentId: options.intentId } : {}
    }
  );
  return {
    status: result.status,
    ...result.state?.support_skill ? { state: result.state.support_skill } : {}
  };
}

// src/hooks/pre-tool-enforcer/effects.ts
var SESSION_ID_PATTERN3 = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,255}$/;
var FORCE_DELEGATION_STATE_FILE = "force-agent-delegation-events.json";
var FORCE_DELEGATION_RETENTION_SECONDS3 = 60 * 60;
var FORCE_DELEGATION_MAX_EVENTS = 2e3;
var ADVISORY_STATE_FILE = "pre-tool-advisory-throttle.json";
var ADVISORY_MAX_ENTRIES = 100;
var ADVISORY_MIN_PRUNE_WINDOW_MS = 60 * 60 * 1e3;
function isRecord5(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function inspectJsonRecord(path3) {
  if (!(0, import_node_fs2.existsSync)(path3)) return { status: "missing" };
  try {
    const parsed = JSON.parse((0, import_node_fs2.readFileSync)(path3, "utf8"));
    return isRecord5(parsed) ? { status: "valid", value: parsed } : { status: "corrupt" };
  } catch {
    return { status: "corrupt" };
  }
}
function storedGeneration(value) {
  if (value === void 0) return 0;
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
function nextGeneration(generation) {
  return generation < Number.MAX_SAFE_INTEGER ? generation + 1 : null;
}
function validEpochSeconds(value, referenceSec) {
  return Number.isSafeInteger(value) && value >= Math.floor(PRE_TOOL_MIN_EPOCH_MS / 1e3) && value <= referenceSec + Math.floor(PRE_TOOL_MAX_FUTURE_SKEW_MS / 1e3);
}
function validEpochMilliseconds(value, referenceMs) {
  return Number.isSafeInteger(value) && value >= PRE_TOOL_MIN_EPOCH_MS && value <= referenceMs + PRE_TOOL_MAX_FUTURE_SKEW_MS;
}
function forceDelegationEvents(value, referenceSec) {
  if (!Array.isArray(value?.events)) return [];
  return value.events.flatMap((event) => {
    if (!isRecord5(event)) return [];
    const tool = typeof event.tool === "string" ? event.tool : typeof event.toolName === "string" ? event.toolName : "";
    const t = typeof event.t === "number" ? event.t : typeof event.observedAtSec === "number" ? event.observedAtSec : Number.NaN;
    const intentId = typeof event.intentId === "string" ? event.intentId : typeof event.intent_id === "string" ? event.intent_id : "";
    const disposition = event.disposition === "rejected" ? "rejected" : "accepted";
    if (!tool || !validEpochSeconds(t, referenceSec)) return [];
    return [{
      tool,
      t,
      originalIndex: typeof event.originalIndex === "number" ? event.originalIndex : 0,
      intentId,
      disposition: event.disposition === "reserved" ? "reserved" : disposition
    }];
  });
}
function forceDelegationState(value, referenceSec) {
  const generation = storedGeneration(value?.generation);
  if (generation === null) return null;
  return {
    generation,
    events: forceDelegationEvents(value, referenceSec)
  };
}
function boundedForceDelegationEvents(events, retentionReferenceSec, validationReferenceSec = retentionReferenceSec) {
  const cutoff = retentionReferenceSec - FORCE_DELEGATION_RETENTION_SECONDS3;
  return [...events].filter(
    (event) => event.t > cutoff && validEpochSeconds(event.t, validationReferenceSec)
  ).sort(
    (left, right) => left.t - right.t || left.originalIndex - right.originalIndex
  ).slice(-FORCE_DELEGATION_MAX_EVENTS);
}
function reserveAndPlanPreToolBatch(envelope, snapshot) {
  if (!snapshot.forceDelegation?.enforce) {
    return {
      status: "planned",
      plan: planPreToolBatch(envelope, snapshot),
      generation: snapshot.forceDelegationLedger.generation ?? 0
    };
  }
  if (!validEpochSeconds(
    snapshot.observedAtSec,
    Math.floor(Date.now() / 1e3)
  )) {
    return {
      status: "failed",
      reason: "Invalid force-delegation observation timestamp."
    };
  }
  const path3 = (0, import_node_path3.join)(snapshot.stateDir, FORCE_DELEGATION_STATE_FILE);
  try {
    const locked = withStateFileMutationLock(path3, () => {
      const lockNowMs = Date.now();
      const lockNowSec = Math.floor(lockNowMs / 1e3);
      const inspected = inspectJsonRecord(path3);
      if (inspected.status === "corrupt") {
        return {
          status: "failed",
          reason: "Corrupt force-delegation reservation ledger."
        };
      }
      const persisted = forceDelegationState(
        inspected.status === "valid" ? inspected.value : null,
        lockNowSec
      );
      if (!persisted) {
        return {
          status: "failed",
          reason: "Invalid force-delegation reservation generation."
        };
      }
      const currentSnapshot = {
        ...snapshot,
        observedAtSec: lockNowSec,
        forceDelegationLedger: {
          generation: persisted.generation,
          events: persisted.events.map((event) => ({
            toolName: event.tool,
            observedAtSec: event.t,
            originalIndex: event.originalIndex,
            ...event.intentId ? { intentId: event.intentId } : {}
          }))
        }
      };
      const plan = planPreToolBatch(envelope, currentSnapshot);
      const reservations = plan.evaluations.flatMap(
        (evaluation) => evaluation.effects ?? []
      ).filter(
        (effect) => effect.type === "pretool.force-delegation-attempt.v1"
      );
      const events = [...persisted.events];
      let changed = false;
      for (const reservation of reservations) {
        const payload = reservation.payload;
        if (!validEpochSeconds(payload.observedAtSec, lockNowSec)) {
          return {
            status: "failed",
            reason: "Invalid force-delegation reservation timestamp."
          };
        }
        if (events.some((event) => event.intentId === payload.intentId)) {
          continue;
        }
        events.push({
          tool: payload.toolName,
          t: payload.observedAtSec,
          originalIndex: payload.originalIndex,
          intentId: payload.intentId,
          disposition: "reserved"
        });
        changed = true;
      }
      const generation = changed ? nextGeneration(persisted.generation) : persisted.generation;
      if (generation === null) {
        return {
          status: "failed",
          reason: "Force-delegation reservation generation exhausted."
        };
      }
      if (changed) {
        atomicWriteJsonSync(path3, {
          version: 3,
          generation,
          events: boundedForceDelegationEvents(
            events,
            lockNowSec
          )
        });
      }
      return {
        status: "planned",
        plan,
        generation
      };
    });
    return locked.acquired && locked.value ? locked.value : {
      status: "failed",
      reason: "Force-delegation reservation lock unavailable."
    };
  } catch {
    return {
      status: "failed",
      reason: "Force-delegation reservation failed."
    };
  }
}
function writeForceDelegationAttemptLocked(payload, disposition) {
  if (!validEpochSeconds(
    payload.observedAtSec,
    Math.floor(Date.now() / 1e3)
  )) {
    return { status: "failed" };
  }
  try {
    const path3 = (0, import_node_path3.join)(payload.stateDir, FORCE_DELEGATION_STATE_FILE);
    const locked = withStateFileMutationLock(path3, () => {
      const lockNowSec = Math.floor(Date.now() / 1e3);
      const inspected = inspectJsonRecord(path3);
      if (inspected.status === "corrupt") {
        return { status: "failed" };
      }
      const persistedState = forceDelegationState(
        inspected.status === "valid" ? inspected.value : null,
        lockNowSec
      );
      if (!persistedState) return { status: "failed" };
      const events = boundedForceDelegationEvents(
        persistedState.events,
        payload.observedAtSec,
        lockNowSec
      );
      const nextEvent = {
        tool: payload.toolName,
        t: payload.observedAtSec,
        originalIndex: payload.originalIndex,
        intentId: payload.intentId,
        disposition
      };
      const existingIndex = events.findIndex(
        (event) => event.intentId === payload.intentId
      );
      let status;
      if (existingIndex >= 0) {
        const existing = events[existingIndex];
        const reconciledEvent = {
          ...nextEvent,
          t: existing.t
        };
        if (existing.tool === reconciledEvent.tool && existing.originalIndex === reconciledEvent.originalIndex && existing.disposition === reconciledEvent.disposition) {
          return { status: "duplicate" };
        }
        events[existingIndex] = reconciledEvent;
        status = "reconciled";
      } else {
        events.push(nextEvent);
        status = "written";
      }
      const bounded = boundedForceDelegationEvents(
        events,
        payload.observedAtSec,
        lockNowSec
      );
      const generation = nextGeneration(persistedState.generation);
      if (generation === null) return { status: "failed" };
      atomicWriteJsonSync(path3, {
        version: 3,
        generation,
        events: bounded
      });
      return { status };
    });
    return locked.acquired && locked.value ? locked.value : { status: "failed" };
  } catch {
    return { status: "failed" };
  }
}
function advisoryPath(stateDir, sessionId) {
  if (sessionId && !SESSION_ID_PATTERN3.test(sessionId)) return null;
  return sessionId ? (0, import_node_path3.join)(stateDir, "sessions", sessionId, ADVISORY_STATE_FILE) : (0, import_node_path3.join)(stateDir, ADVISORY_STATE_FILE);
}
function advisoryEntries(value, referenceMs) {
  const entries = isRecord5(value?.entries) ? value.entries : {};
  return Object.fromEntries(
    Object.entries(entries).flatMap(([key, entry]) => {
      if (!isRecord5(entry)) return [];
      const last = Number(entry.last_emitted_at_ms);
      if (!validEpochMilliseconds(last, referenceMs)) return [];
      return [[key, {
        last_emitted_at_ms: last,
        message: typeof entry.message === "string" ? entry.message : "",
        intent_id: typeof entry.intent_id === "string" ? entry.intent_id : ""
      }]];
    })
  );
}
function pruneAdvisoryEntries(entries, retentionHorizonMs, cooldownMs, protectedKey) {
  const pruneWindow = Math.max(
    cooldownMs * 2,
    ADVISORY_MIN_PRUNE_WINDOW_MS
  );
  const protectedEntry = protectedKey ? entries[protectedKey] : void 0;
  const retainedPriorEntries = Object.entries(entries).filter(
    ([key, entry]) => key !== protectedKey && Number.isFinite(entry.last_emitted_at_ms) && retentionHorizonMs - entry.last_emitted_at_ms <= pruneWindow
  ).sort(
    ([leftKey, left], [rightKey, right]) => right.last_emitted_at_ms - left.last_emitted_at_ms || leftKey.localeCompare(rightKey)
  ).slice(
    0,
    protectedEntry ? Math.max(0, ADVISORY_MAX_ENTRIES - 1) : ADVISORY_MAX_ENTRIES
  );
  return Object.fromEntries([
    ...protectedEntry && protectedKey ? [[protectedKey, protectedEntry]] : [],
    ...retainedPriorEntries
  ]);
}
function claimAdvisoryThrottleLocked(payload) {
  if (!payload.message || payload.cooldownMs <= 0) return "granted";
  if (!validEpochMilliseconds(payload.nowMs, Date.now())) {
    return "indeterminate";
  }
  try {
    const path3 = advisoryPath(payload.stateDir, payload.sessionId);
    if (!path3) return "indeterminate";
    const locked = withStateFileMutationLock(path3, () => {
      const lockNowMs = Date.now();
      if (!validEpochMilliseconds(payload.nowMs, lockNowMs)) {
        return "indeterminate";
      }
      const inspected = inspectJsonRecord(path3);
      if (inspected.status === "corrupt") return "indeterminate";
      const stored = inspected.status === "valid" ? inspected.value : null;
      const generation = storedGeneration(stored?.generation);
      if (generation === null) return "indeterminate";
      const persisted = advisoryEntries(stored, lockNowMs);
      const previous = persisted[payload.messageHash];
      if (previous?.intent_id === payload.intentId) {
        return "throttled";
      }
      if (previous && (previous.last_emitted_at_ms > payload.nowMs || payload.nowMs - previous.last_emitted_at_ms < payload.cooldownMs)) {
        return "throttled";
      }
      const retentionHorizonMs = Object.values(persisted).reduce(
        (latest, entry) => Math.max(latest, entry.last_emitted_at_ms),
        payload.nowMs
      );
      const updatedAtHorizonMs = Math.max(
        retentionHorizonMs,
        typeof stored?.updated_at === "string" && validEpochMilliseconds(
          Date.parse(stored.updated_at),
          lockNowMs
        ) ? Date.parse(stored.updated_at) : 0
      );
      const entries = pruneAdvisoryEntries(
        persisted,
        retentionHorizonMs,
        payload.cooldownMs
      );
      entries[payload.messageHash] = {
        last_emitted_at_ms: payload.nowMs,
        message: payload.message,
        intent_id: payload.intentId
      };
      const bounded = pruneAdvisoryEntries(
        entries,
        retentionHorizonMs,
        payload.cooldownMs,
        payload.messageHash
      );
      const next = nextGeneration(generation);
      if (next === null) return "indeterminate";
      atomicWriteJsonSync(path3, {
        version: 2,
        generation: next,
        entries: bounded,
        updated_at: new Date(updatedAtHorizonMs).toISOString()
      });
      const committed = inspectJsonRecord(path3);
      if (committed.status !== "valid") return "indeterminate";
      const committedClaim = advisoryEntries(
        committed.value,
        lockNowMs
      )[payload.messageHash];
      if (storedGeneration(committed.value.generation) !== next || committedClaim?.intent_id !== payload.intentId || committedClaim.last_emitted_at_ms !== payload.nowMs) {
        return "indeterminate";
      }
      return "granted";
    });
    return locked.acquired && locked.value ? locked.value : "indeterminate";
  } catch {
    return "indeterminate";
  }
}
function appendTraceAttempt(payload, disposition) {
  if (payload.sessionId && !SESSION_ID_PATTERN3.test(payload.sessionId)) {
    return { status: "failed" };
  }
  return appendReplayEventOnce(
    payload.directory,
    payload.sessionId,
    payload.intentId,
    {
      agent: "system",
      event: "skill_invoked",
      skill_name: payload.rawSkillName,
      skill_source: "pre-tool-use",
      attempt: true,
      disposition,
      observed_at: payload.observedAt
    },
    payload.observedAtMs
  );
}
function upsertSupportSkill(payload) {
  const result = upsertSupportSkillActiveStateLocked(
    payload.directory,
    payload.skillName,
    payload.sessionId || void 0,
    payload.rawSkillName,
    {
      observedAt: payload.observedAt,
      intentId: payload.intentId
    }
  );
  return { status: result.status };
}
function confirmMode(payload) {
  const result = confirmModeAwaitingConfirmationLocked(
    payload.directory,
    payload.modeName,
    payload.sessionId || void 0,
    {
      path: payload.observedPath,
      ownerSessionId: payload.observedOwnerSessionId,
      generation: payload.observedGeneration,
      confirmationTimestamp: payload.observedConfirmationTimestamp,
      digest: payload.observedStateDigest
    }
  );
  return { status: result.status };
}
async function notifyAskUser(payload, runtimeContext) {
  if (process.env.OMC_NOTIFY === "0") return { status: "skipped" };
  if (!runtimeContext.notificationChildEntrypointPath || !runtimeContext.hookRuntimePath) {
    return { status: "failed" };
  }
  const claim = claimProvisionalNotificationReceipt(
    payload.intentId,
    "ask-user-question",
    payload.sessionId,
    payload.directory,
    Date.now()
  );
  if (claim.status === "duplicate") return { status: "duplicate" };
  if (claim.status === "failed") return { status: "failed" };
  const dispatch = await dispatchNotificationInBackground(
    "ask-user-question",
    {
      sessionId: payload.sessionId,
      projectPath: payload.directory,
      question: payload.question
    },
    {
      childEntrypointPath: runtimeContext.notificationChildEntrypointPath,
      hookRuntimePath: runtimeContext.hookRuntimePath
    },
    {
      intentId: payload.intentId,
      claimId: claim.claimId
    }
  );
  if (dispatch.status === "acknowledged") {
    const finalized = finalizeNotificationReceiptQueued(
      payload.intentId,
      payload.sessionId,
      payload.directory,
      claim.claimId,
      Date.now()
    );
    if (finalized === "finalized") {
      return await dispatch.release() === "released" ? { status: "queued" } : { status: "failed" };
    }
    dispatch.terminate();
    markNotificationReceiptRetryable(
      payload.intentId,
      payload.sessionId,
      payload.directory,
      claim.claimId,
      Date.now()
    );
    return { status: "failed" };
  }
  markNotificationReceiptRetryable(
    payload.intentId,
    payload.sessionId,
    payload.directory,
    claim.claimId,
    Date.now()
  );
  return dispatch.status === "disabled" ? { status: "skipped" } : { status: "failed" };
}
var DEFAULT_PRE_TOOL_EFFECT_DEPENDENCIES = {
  appendTraceAttempt,
  writeForceDelegationAttempt: writeForceDelegationAttemptLocked,
  upsertSupportSkill,
  confirmMode,
  claimAdvisory: claimAdvisoryThrottleLocked,
  notifyAskUser
};
function isPreToolEffect(effect) {
  return typeof effect.callId === "string" && (effect.commitOn === "accepted" || effect.commitOn === "always") && isRecord5(effect.payload) && effect.payload.version === PRE_TOOL_EFFECT_PAYLOAD_VERSION && typeof effect.payload.intentId === "string" && typeof effect.payload.originalIndex === "number" && [
    "pretool.trace-skill-attempt.v1",
    "pretool.force-delegation-attempt.v1",
    "pretool.support-skill-upsert.v1",
    "pretool.mode-confirm.v1",
    "pretool.advisory-claim.v1",
    "pretool.ask-user-notify.v1"
  ].includes(effect.type);
}
function resultStatus(status) {
  switch (status) {
    case "written":
    case "appended":
    case "reconciled":
    case "repaired":
    case "sent":
    case "queued":
      return "committed";
    case "duplicate":
      return "duplicate";
    case "skipped":
      return "skipped";
    default:
      return "failed";
  }
}
async function commitOneEffect(effect, disposition, dependencies, runtimeContext) {
  const base = {
    type: effect.type,
    intentId: effect.payload.intentId,
    callId: effect.callId,
    originalIndex: effect.payload.originalIndex,
    commitOn: effect.commitOn,
    critical: effect.critical === true,
    disposition
  };
  try {
    switch (effect.type) {
      case "pretool.trace-skill-attempt.v1": {
        const result = dependencies.appendTraceAttempt(
          effect.payload,
          disposition
        );
        return { ...base, status: resultStatus(result.status) };
      }
      case "pretool.force-delegation-attempt.v1": {
        const result = dependencies.writeForceDelegationAttempt(
          effect.payload,
          disposition
        );
        return { ...base, status: resultStatus(result.status) };
      }
      case "pretool.support-skill-upsert.v1": {
        const result = dependencies.upsertSupportSkill(
          effect.payload
        );
        return { ...base, status: resultStatus(result.status) };
      }
      case "pretool.mode-confirm.v1": {
        const result = dependencies.confirmMode(
          effect.payload
        );
        const committed = result.status === "written" || result.status === "not-applicable";
        return {
          ...base,
          status: committed ? "committed" : "failed",
          ...!committed ? {
            detail: result.status === "changed" ? "mode confirmation state changed; retry required" : "mode confirmation could not be verified"
          } : {}
        };
      }
      case "pretool.advisory-claim.v1": {
        const claim = dependencies.claimAdvisory(
          effect.payload
        );
        return {
          ...base,
          status: claim === "indeterminate" ? "failed" : "committed",
          advisoryClaim: claim
        };
      }
      case "pretool.ask-user-notify.v1": {
        const result = await dependencies.notifyAskUser(
          effect.payload,
          runtimeContext
        );
        return { ...base, status: resultStatus(result.status) };
      }
    }
  } catch (error) {
    return {
      ...base,
      status: "failed",
      detail: error instanceof Error ? error.message : String(error),
      ...effect.type === "pretool.advisory-claim.v1" ? { advisoryClaim: "indeterminate" } : {}
    };
  }
}
async function commitPreToolEffects(stagedEffects, reduction, dependencies = DEFAULT_PRE_TOOL_EFFECT_DEPENDENCIES, runtimeContext = {}) {
  const disposition = reduction.decision === "pass" || reduction.decision === "allow" ? "accepted" : "rejected";
  const indexed = stagedEffects.map((effect, index) => ({ effect, index })).filter(
    (entry) => isPreToolEffect(entry.effect)
  ).filter(
    ({ effect }) => effect.commitOn === "always" || disposition === "accepted"
  ).sort((left, right) => {
    const commitOrder = Number(left.effect.commitOn === "accepted") - Number(right.effect.commitOn === "accepted");
    return commitOrder || left.effect.payload.originalIndex - right.effect.payload.originalIndex || left.index - right.index;
  });
  const seen = /* @__PURE__ */ new Set();
  const results = [];
  const advisoryClaims = {};
  for (const { effect } of indexed) {
    if (seen.has(effect.payload.intentId)) {
      const duplicate = {
        type: effect.type,
        intentId: effect.payload.intentId,
        callId: effect.callId,
        originalIndex: effect.payload.originalIndex,
        commitOn: effect.commitOn,
        critical: effect.critical === true,
        status: "duplicate",
        disposition,
        ...effect.type === "pretool.advisory-claim.v1" ? { advisoryClaim: "throttled" } : {}
      };
      results.push(duplicate);
      if (duplicate.advisoryClaim) {
        advisoryClaims[duplicate.intentId] = duplicate.advisoryClaim;
      }
      continue;
    }
    seen.add(effect.payload.intentId);
    const result = await commitOneEffect(
      effect,
      disposition,
      dependencies,
      runtimeContext
    );
    results.push(result);
    if (result.advisoryClaim) {
      advisoryClaims[result.intentId] = result.advisoryClaim;
    }
  }
  return {
    disposition,
    results,
    advisoryClaims
  };
}

// src/hooks/pre-tool-enforcer/output.ts
function accepted(reduction) {
  return reduction.decision === "pass" || reduction.decision === "allow";
}
function finalizedContexts(plan, reduction, commitReport) {
  const advisoryMessages = plan.calls.flatMap((call) => {
    const candidate = call.advisoryCandidate;
    if (!candidate) return [];
    const claim = commitReport.advisoryClaims[candidate.intentId] ?? "indeterminate";
    return claim === "throttled" ? [] : [candidate.message];
  });
  return boundHookContexts([
    ...reduction.contexts,
    ...advisoryMessages
  ]);
}
function suppressedPresentation(presentation) {
  return presentation.kind === "context" && presentation.updatedInput ? {
    kind: "suppressed-with-mutation",
    callId: presentation.callId,
    updatedInput: presentation.updatedInput
  } : {
    kind: "suppressed",
    callId: presentation.callId
  };
}
function finalizeLegacyPresentation(plan, reduction, commitReport) {
  const solePresentation = plan.legacyPresentations.length === 1 ? plan.legacyPresentations[0] : void 0;
  if (!accepted(reduction)) {
    if (solePresentation?.kind === "raw-block") {
      return {
        ...solePresentation,
        reason: reduction.reason || solePresentation.reason
      };
    }
    return {
      kind: "hook-deny",
      callId: solePresentation?.callId,
      reason: reduction.reason || "Hook denied this tool call."
    };
  }
  if (!solePresentation) {
    return { kind: "suppressed" };
  }
  if (solePresentation.kind !== "context" || !solePresentation.advisoryIntentId) {
    return solePresentation;
  }
  const claim = commitReport.advisoryClaims[solePresentation.advisoryIntentId] ?? "indeterminate";
  return claim === "throttled" ? suppressedPresentation(solePresentation) : solePresentation;
}
function finalizePreToolReduction(plan, reduction, commitReport) {
  const contexts = accepted(reduction) ? finalizedContexts(plan, reduction, commitReport) : [...reduction.contexts];
  const finalizedReduction = {
    ...reduction,
    contexts,
    ...contexts.length > 0 ? { context: contexts.join("\n\n") } : { context: void 0 }
  };
  return {
    reduction: finalizedReduction,
    legacyPresentation: plan.envelope.host === "claude" ? finalizeLegacyPresentation(plan, finalizedReduction, commitReport) : void 0,
    commitReport
  };
}
function encodeClaudeLegacyPresentation(presentation) {
  switch (presentation.kind) {
    case "continue":
      return { continue: true };
    case "suppressed":
      return { continue: true, suppressOutput: true };
    case "suppressed-with-mutation":
      return {
        continue: true,
        suppressOutput: true,
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          updatedInput: presentation.updatedInput
        }
      };
    case "hook-deny":
      return {
        continue: true,
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: presentation.reason
        }
      };
    case "raw-block":
      return {
        decision: "block",
        reason: presentation.reason
      };
    case "context":
      return {
        continue: true,
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          additionalContext: presentation.context,
          ...presentation.updatedInput ? { updatedInput: presentation.updatedInput } : {}
        }
      };
  }
}
function encodePreToolEnforcerOutput(envelope, finalized) {
  if (envelope.host === "copilot") {
    return encodeHookOutput(envelope, finalized.reduction);
  }
  return finalized.legacyPresentation ? encodeClaudeLegacyPresentation(finalized.legacyPresentation) : encodeHookOutput(envelope, finalized.reduction);
}

// src/hooks/hook-runtime-entry.ts
var LEGACY_HOOK_EVENT_NAMES = {
  notification: "Notification",
  "permission-request": "PermissionRequest",
  "post-tool-use": "PostToolUse",
  "post-tool-use-failure": "PostToolUseFailure",
  "pre-compact": "PreCompact",
  "pre-tool-use": "PreToolUse",
  "session-end": "SessionEnd",
  "session-start": "SessionStart",
  stop: "Stop",
  "subagent-start": "SubagentStart",
  "subagent-stop": "SubagentStop",
  "user-prompt-submit": "UserPromptSubmit"
};
function primaryPrompt(eventPayload) {
  return eventPayload.prompt ?? eventPayload.userPrompt ?? eventPayload.initialPrompt ?? eventPayload.promptAliases?.[0];
}
function normalizeLegacyHookInput(raw, hookType) {
  return normalizeHookInput(raw, hookType);
}
function buildLegacyProcessorInput(envelope, unit, options = {}) {
  const call = unit.call;
  const eventPayload = envelope.eventPayload;
  const toolName = call ? options.toolNameSource === "native" ? call.nativeName : call.canonicalName : void 0;
  const prompt = primaryPrompt(eventPayload);
  const hookEventName = LEGACY_HOOK_EVENT_NAMES[envelope.hookType];
  return {
    ...eventPayload,
    ...prompt !== void 0 ? { prompt } : {},
    host: envelope.host,
    contract: envelope.contract,
    hookType: envelope.hookType,
    eventPayload,
    originalIndex: unit.originalIndex,
    ...envelope.sessionId !== void 0 ? {
      sessionId: envelope.sessionId,
      session_id: envelope.sessionId
    } : {},
    ...envelope.directory !== void 0 ? {
      directory: envelope.directory,
      cwd: envelope.directory
    } : {},
    ...envelope.transcriptPath !== void 0 ? {
      transcriptPath: envelope.transcriptPath,
      transcript_path: envelope.transcriptPath
    } : {},
    ...envelope.stopReason !== void 0 ? {
      stopReason: envelope.stopReason,
      stop_reason: envelope.stopReason
    } : {},
    ...eventPayload.endTurnReason !== void 0 ? { end_turn_reason: eventPayload.endTurnReason } : {},
    ...eventPayload.stopHookActive !== void 0 ? { stop_hook_active: eventPayload.stopHookActive } : {},
    ...eventPayload.lastAssistantMessage !== void 0 ? { last_assistant_message: eventPayload.lastAssistantMessage } : {},
    ...eventPayload.userRequested !== void 0 ? { user_requested: eventPayload.userRequested } : {},
    ...hookEventName !== void 0 ? { hook_event_name: hookEventName } : {},
    ...eventPayload.permissionMode !== void 0 ? { permission_mode: eventPayload.permissionMode } : {},
    ...eventPayload.customInstructions !== void 0 ? { custom_instructions: eventPayload.customInstructions } : {},
    ...eventPayload.userPrompt !== void 0 ? { user_prompt: eventPayload.userPrompt } : {},
    ...eventPayload.initialPrompt !== void 0 ? { initial_prompt: eventPayload.initialPrompt } : {},
    ...eventPayload.promptId !== void 0 ? { prompt_id: eventPayload.promptId } : {},
    ...eventPayload.sessionEndReason !== void 0 || eventPayload.reason !== void 0 ? { reason: eventPayload.sessionEndReason ?? eventPayload.reason } : {},
    ...envelope.agent !== void 0 ? {
      agent: envelope.agent,
      ...envelope.agent.id !== void 0 ? { agentId: envelope.agent.id } : {},
      ...envelope.agent.name !== void 0 ? { agentName: envelope.agent.name } : {},
      ...envelope.agent.displayName !== void 0 ? { agentDisplayName: envelope.agent.displayName } : {},
      ...envelope.agent.description !== void 0 ? { agentDescription: envelope.agent.description } : {}
    } : {},
    ...call ? {
      callId: call.id,
      toolUseId: call.id,
      toolCallId: call.id,
      toolName,
      nativeToolName: call.nativeName,
      canonicalToolName: call.canonicalName,
      toolInput: unit.input,
      rawToolArgs: call.rawArgs,
      ...call.shellDialect !== void 0 ? { shellDialect: call.shellDialect } : {}
    } : {}
  };
}
function describeHookRunFailure(result) {
  const failures = [];
  for (const issue of result.envelope.issues) {
    if (issue.severity === "safety" || issue.batchSafety === true) {
      failures.push(
        issue.message || issue.code || "hook input normalization failed"
      );
    }
  }
  for (const evaluation of result.evaluations) {
    if (evaluation.source === "adapter" && evaluation.decision === "deny") {
      failures.push(
        evaluation.reason || "legacy processor adapter failed"
      );
    }
  }
  for (const decision of result.reduction.callDecisions) {
    if (decision.source === "adapter" && decision.decision === "deny") {
      failures.push(decision.reason || "hook reduction failed");
    }
  }
  if (result.reduction.decision !== "pass") {
    failures.push(
      result.reduction.reason || `unexpected ${result.reduction.decision} reduction`
    );
  }
  return failures.length > 0 ? [...new Set(failures)].join("; ") : void 0;
}
function encodeLegacyCompatibleHookOutput(envelope, reduction, legacyOutput) {
  if (envelope.host === "copilot") {
    return encodeHookOutput(envelope, reduction);
  }
  if (typeof legacyOutput === "object" && legacyOutput !== null && !Array.isArray(legacyOutput)) {
    return legacyOutput;
  }
  return encodeHookOutput(envelope, reduction);
}
function adaptLegacyHookOutput(hookType, output) {
  return interpretLegacyOutput(hookType, output);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  CLAUDE_SINGLE_CAPABILITIES,
  COPILOT_1072_CAPABILITIES,
  DEFAULT_PRE_TOOL_EFFECT_DEPENDENCIES,
  adaptLegacyHookOutput,
  boundHookContexts,
  buildAdvisoryCandidate,
  buildLegacyProcessorInput,
  canEncodeHookMutation,
  claimAdvisoryThrottleLocked,
  commitPreToolEffects,
  describeHookRunFailure,
  detectHookContract,
  encodeClaudeHookOutput,
  encodeCopilotHookOutput,
  encodeHookOutput,
  encodeLegacyCompatibleHookOutput,
  encodePreToolEnforcerOutput,
  evaluateForceDelegationPure,
  evaluateModelRouting,
  evaluatePreToolCall,
  evaluateUltragoal,
  finalizePreToolReduction,
  formatUnknownError,
  interpretLegacyOutput,
  loadPreToolBatchSnapshot,
  normalizeHookEnvelope,
  normalizeHookInput,
  normalizeLegacyHookInput,
  planPreToolBatch,
  reduceHookEvaluations,
  reserveAndPlanPreToolBatch,
  runHookJson,
  runHookNotificationChild,
  runHookPayload,
  sanitizeHookEvaluation,
  writeForceDelegationAttemptLocked
});
