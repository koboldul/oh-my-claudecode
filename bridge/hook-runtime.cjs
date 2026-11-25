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
function gitProbeEnvironmentSignature() {
  const fixedEntries = GIT_PROBE_ENVIRONMENT_KEYS.map((key) => JSON.stringify([key, process.env[key] !== void 0, process.env[key] ?? ""]));
  const dynamicEntries = Object.keys(process.env).filter((key) => /^GIT_CONFIG_(?:KEY|VALUE)_\d+$/.test(key)).sort().map((key) => JSON.stringify([key, process.env[key] !== void 0, process.env[key] ?? ""]));
  return [...fixedEntries, ...dynamicEntries].join("\0");
}
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
    const cached = superprojectCacheMap.get(cacheKey);
    if (isStateRootCacheEntryValid(cacheKey, cached)) {
      superprojectCacheMap.delete(cacheKey);
      superprojectCacheMap.set(cacheKey, cached);
      return cached.root;
    }
    superprojectCacheMap.delete(cacheKey);
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
        timeout: 5e3,
        // Force English error text so isDefinitiveNonGitError's stderr match is
        // locale-independent (localized git output otherwise fails to match
        // and mis-classifies a plain "not a repository" as a generic failure).
        env: { ...process.env, LC_ALL: "C" }
      }).trim();
    } catch (error) {
      completed = depth === 0 && isDefinitiveNonGitError(error);
      break;
    }
    if (!superRoot) {
      completed = true;
      break;
    }
    anchor = canonicalizeExistingPath(superRoot) ?? superRoot;
    probeCwd = anchor;
  }
  if (completed) {
    if (superprojectCacheMap.size >= MAX_WORKTREE_CACHE_SIZE) {
      const oldest = superprojectCacheMap.keys().next().value;
      if (oldest !== void 0) superprojectCacheMap.delete(oldest);
    }
    superprojectCacheMap.set(cacheKey, createStateRootCacheEntry(cacheKey, anchor));
  }
  return anchor;
}
function sensitiveAbsoluteRoots() {
  const roots = [];
  const temp = (() => {
    try {
      return (0, import_path2.resolve)((0, import_os2.tmpdir)());
    } catch {
      return null;
    }
  })();
  if (temp) roots.push(temp);
  if (process.platform === "win32") {
    const home = (() => {
      try {
        return (0, import_path2.resolve)((0, import_os2.homedir)());
      } catch {
        return null;
      }
    })();
    roots.push("C:\\Windows", "C:\\Program Files", "C:\\Program Files (x86)", "C:\\ProgramData");
    const drive = (home && /^[a-zA-Z]:/.exec(home))?.[0];
    if (drive) roots.push(`${drive}\\Windows`, `${drive}\\Program Files`, `${drive}\\Program Files (x86)`, `${drive}\\ProgramData`);
  } else {
    roots.push("/var", "/usr", "/etc", "/opt", "/private/var");
  }
  return roots;
}
function isFilesystemRoot(dir) {
  return (0, import_path2.dirname)(dir) === dir;
}
function isWithinPath(ancestor, candidate) {
  const rel = (0, import_path2.relative)(ancestor, candidate);
  return rel === "" || !rel.startsWith(`..${import_path2.sep}`) && rel !== ".." && !(0, import_path2.isAbsolute)(rel);
}
function isSensitiveStateLocation(dir) {
  let candidate;
  try {
    candidate = (0, import_path2.resolve)(dir);
    try {
      candidate = (0, import_fs.realpathSync)(candidate);
    } catch {
    }
  } catch {
    return true;
  }
  const home = (() => {
    try {
      const path3 = (0, import_path2.resolve)((0, import_os2.homedir)());
      try {
        return (0, import_fs.realpathSync)(path3);
      } catch {
        return path3;
      }
    } catch {
      return null;
    }
  })();
  let cursor = candidate;
  for (; ; ) {
    const name = (0, import_path2.basename)(cursor);
    const lowerName = name.toLowerCase();
    if (home && cursor === candidate && (cursor === home || process.platform === "win32" && cursor.toLowerCase() === home.toLowerCase())) return true;
    if (name.startsWith(".") && name !== OmcPaths.ROOT) return true;
    if (SENSITIVE_DIR_BASENAMES.has(lowerName)) return true;
    if (isFilesystemRoot(cursor)) break;
    cursor = (0, import_path2.dirname)(cursor);
  }
  if (candidate === "/tmp" || candidate === "/private/tmp") return true;
  if (isFilesystemRoot(candidate)) return true;
  return sensitiveAbsoluteRoots().some((root) => {
    const normalizedCandidate = process.platform === "win32" ? candidate.toLowerCase() : candidate;
    let canonicalRoot = root;
    try {
      canonicalRoot = (0, import_fs.realpathSync)(root);
    } catch {
    }
    const normalizedRoot = process.platform === "win32" ? canonicalRoot.toLowerCase() : canonicalRoot;
    return normalizedCandidate === normalizedRoot || isWithinPath(normalizedRoot, normalizedCandidate);
  });
}
function resolveNonGitFallbackRoot() {
  const home = (0, import_path2.resolve)((0, import_os2.homedir)());
  if (isFilesystemRoot(home)) {
    throw new Error("Cannot resolve a safe non-git OMC state root: home resolves to the filesystem root.");
  }
  return home;
}
function resolveNonGitStateAnchor(startDir) {
  try {
    const current = (0, import_path2.resolve)(startDir || process.cwd());
    const workspaceRoot = findWorkspaceRoot(current);
    if (workspaceRoot && !isSensitiveStateLocation(workspaceRoot)) return workspaceRoot;
    if (isSensitiveStateLocation(current)) return resolveNonGitFallbackRoot();
    return resolveNonGitFallbackRoot();
  } catch {
    return resolveNonGitFallbackRoot();
  }
}
function resolveStateAnchorRoot(worktreeRoot) {
  if (worktreeRoot) return resolveSuperprojectRoot(worktreeRoot) || worktreeRoot;
  return getWorktreeRoot() || resolveNonGitStateAnchor();
}
function gitErrorStderr(error) {
  if (!error || typeof error !== "object") {
    return "";
  }
  const err = error;
  if (Buffer.isBuffer(err.stderr)) {
    return err.stderr.toString("utf8");
  }
  if (typeof err.stderr === "string") {
    return err.stderr;
  }
  return typeof err.message === "string" ? err.message : "";
}
function isGitCommandPath(path3) {
  if (typeof path3 !== "string" || path3.length === 0) {
    return false;
  }
  const base = (0, import_path2.basename)(path3);
  return base === "git" || base === "git.exe" || base === "git.cmd" || base === "git.bat";
}
function isConfirmedGitExecutableNotFound(error) {
  if (!error || typeof error !== "object") {
    return false;
  }
  const err = error;
  if (err.code !== "ENOENT") {
    return false;
  }
  if (err.killed === true) {
    return false;
  }
  if (typeof err.status === "number") {
    return false;
  }
  if (typeof err.signal === "string" && err.signal.length > 0) {
    return false;
  }
  const syscall = typeof err.syscall === "string" ? err.syscall.toLowerCase() : "";
  if (!syscall.includes("spawn")) {
    return false;
  }
  return syscall.includes("git") || isGitCommandPath(err.path);
}
function isNotAGitRepositoryError(error) {
  if (!error || typeof error !== "object") {
    return false;
  }
  const err = error;
  if (err.code === "ENOENT" || err.code === "ETIMEDOUT" || err.code === "EACCES") {
    return false;
  }
  if (typeof err.signal === "string" && err.signal.length > 0) {
    return false;
  }
  const stderr = gitErrorStderr(error);
  return err.status === 128 && /(?:not a git repository|must be run in a work tree)/i.test(stderr);
}
function formatGitProbeDetail(error) {
  if (!error || typeof error !== "object") {
    return String(error);
  }
  const err = error;
  if (err.code === "ENOENT") {
    return "git executable not found";
  }
  if (err.code === "EACCES") {
    return "git executable not accessible";
  }
  if (err.code === "ETIMEDOUT" || err.killed === true) {
    return "git probe timed out";
  }
  if (typeof err.signal === "string" && err.signal.length > 0) {
    return `git killed by ${err.signal}`;
  }
  const stderr = gitErrorStderr(error).trim();
  if (stderr.length > 0) {
    return stderr.split("\n")[0] ?? stderr;
  }
  if (typeof err.message === "string" && err.message.length > 0) {
    return err.message;
  }
  if (typeof err.status === "number") {
    return `git exited ${err.status}`;
  }
  return "unknown git probe failure";
}
function findGitMetadataDir(start) {
  let current = start;
  for (; ; ) {
    if ((0, import_fs.existsSync)((0, import_path2.join)(current, ".git"))) {
      return current;
    }
    const parent = (0, import_path2.dirname)(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}
function expandPathForCompare(path3) {
  const normalized = (0, import_path2.resolve)(path3);
  try {
    return import_fs.realpathSync.native(normalized);
  } catch {
    try {
      return (0, import_fs.realpathSync)(normalized);
    } catch {
      return null;
    }
  }
}
function canonicalizeExistingPath(path3) {
  try {
    return (0, import_fs.realpathSync)((0, import_path2.resolve)(path3));
  } catch {
    return null;
  }
}
function sameCanonicalPath(left, right) {
  const a = expandPathForCompare(left);
  const b = expandPathForCompare(right);
  if (!a || !b) {
    return false;
  }
  if (a === b) {
    return true;
  }
  if (process.platform !== "win32") {
    return false;
  }
  const fold = (value) => value.replaceAll("/", "\\").toLowerCase();
  return fold(a) === fold(b);
}
function isCredibleGitWorktreeRoot(root) {
  try {
    if (!(0, import_fs.statSync)(root).isDirectory()) {
      return false;
    }
  } catch {
    return false;
  }
  const rootReal = canonicalizeExistingPath(root);
  if (!rootReal) {
    return false;
  }
  const metadataDir = findGitMetadataDir(rootReal);
  return metadataDir !== null && sameCanonicalPath(metadataDir, rootReal);
}
function classifyGitShowToplevelStdout(stdout, cwd) {
  const root = stdout.trim();
  if (root.length === 0 || !(0, import_path2.isAbsolute)(root) || !isCredibleGitWorktreeRoot(root)) {
    return { status: "probe_failed", detail: "malformed git toplevel output" };
  }
  const cwdReal = canonicalizeExistingPath(cwd);
  if (!cwdReal) {
    return { status: "probe_failed", detail: "malformed git toplevel output" };
  }
  const metadataDir = findGitMetadataDir(cwdReal);
  if (!metadataDir || !sameCanonicalPath(metadataDir, root)) {
    return { status: "probe_failed", detail: "malformed git toplevel output" };
  }
  return { status: "ok", root: canonicalizeExistingPath(metadataDir) ?? metadataDir };
}
function classifyGitShowToplevelError(error) {
  if (isNotAGitRepositoryError(error)) {
    return { status: "not_a_repository" };
  }
  if (isConfirmedGitExecutableNotFound(error)) {
    return { status: "git_missing" };
  }
  return { status: "probe_failed", detail: formatGitProbeDetail(error) };
}
function runGitShowToplevel(cwd) {
  if (gitShowToplevelProbeForTests) {
    const result = gitShowToplevelProbeForTests(cwd);
    return Buffer.isBuffer(result) ? result.toString("utf8") : result;
  }
  return (0, import_child_process.execFileSync)("git", ["rev-parse", "--show-toplevel"], {
    cwd,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    timeout: 5e3,
    // Force English error text so isNotAGitRepositoryError's stderr match is
    // locale-independent (localized git output otherwise fails to match and
    // mis-classifies a plain "not a repository" as probe_failed, which then
    // fails closed and breaks callers such as the HUD statusline).
    env: { ...process.env, LC_ALL: "C" }
  });
}
function probeGitTopLevel(cwd) {
  const scope = worktreePathRenderScope.getStore();
  const scopeKey = scope ? canonicalizeExistingPath(cwd) ?? (0, import_path2.resolve)(cwd) : null;
  if (scope && scopeKey) {
    const cached = scope.gitTopLevelProbes.get(scopeKey);
    if (cached) return cached;
  }
  let result;
  try {
    result = classifyGitShowToplevelStdout(runGitShowToplevel(cwd), cwd);
  } catch (error) {
    result = classifyGitShowToplevelError(error);
  }
  if (scope && scopeKey) {
    scope.gitTopLevelProbes.set(scopeKey, result);
  }
  return result;
}
function gitMetadataFileSignature(path3) {
  try {
    const metadata = (0, import_fs.statSync)(path3);
    return [
      path3,
      metadata.dev,
      metadata.ino,
      metadata.mode,
      metadata.size,
      metadata.mtimeMs,
      metadata.ctimeMs
    ].join(":");
  } catch {
    return `${path3}:missing`;
  }
}
function readGitMarker(path3) {
  let descriptor;
  try {
    if (!(0, import_fs.lstatSync)(path3).isFile()) return null;
    descriptor = (0, import_fs.openSync)(path3, "r");
    const buffer = Buffer.alloc(MAX_GIT_MARKER_BYTES);
    const bytesRead = (0, import_fs.readSync)(descriptor, buffer, 0, buffer.length, 0);
    return buffer.toString("utf8", 0, bytesRead);
  } catch {
    return null;
  } finally {
    if (descriptor !== void 0) (0, import_fs.closeSync)(descriptor);
  }
}
function commonGitDirectorySignature(linkedGitDir) {
  const commondirPath = (0, import_path2.join)(linkedGitDir, "commondir");
  try {
    if (!(0, import_fs.existsSync)(commondirPath)) return `${commondirPath}:absent`;
    const marker = readGitMarker(commondirPath);
    if (marker === null) return `${commondirPath}:unreadable`;
    const commonDir = canonicalizeExistingPath((0, import_path2.resolve)(linkedGitDir, marker.trim()));
    if (!commonDir || !(0, import_fs.statSync)(commonDir).isDirectory()) {
      return `${commondirPath}:invalid:${marker}`;
    }
    return [
      commonDir,
      gitMetadataFileSignature(commonDir),
      gitMetadataFileSignature((0, import_path2.join)(commonDir, "HEAD")),
      gitMetadataFileSignature((0, import_path2.join)(commonDir, "index")),
      gitMetadataFileSignature((0, import_path2.join)(commonDir, "config"))
    ].join(":");
  } catch {
    return `${commondirPath}:invalid`;
  }
}
function getGitMetadataSnapshot(cwd) {
  const metadataDir = findGitMetadataDir(canonicalizeExistingPath(cwd) ?? (0, import_path2.resolve)(cwd));
  if (!metadataDir) return null;
  const canonicalDirectory = canonicalizeExistingPath(metadataDir);
  if (!canonicalDirectory) return null;
  const gitPath = (0, import_path2.join)(canonicalDirectory, ".git");
  try {
    const metadata = (0, import_fs.statSync)(gitPath);
    const marker = metadata.isFile() ? readGitMarker(gitPath) : "";
    if (marker === null) return null;
    let metadataPath = gitPath;
    let linkedGitDirSignature = "";
    if (metadata.isFile()) {
      const gitDirMatch = /^\s*gitdir:\s*(.+?)\s*$/im.exec(marker);
      if (!gitDirMatch?.[1]) return null;
      const linkedGitDir = (0, import_path2.resolve)(canonicalDirectory, gitDirMatch[1].trim());
      const linkedGitDirReal = canonicalizeExistingPath(linkedGitDir);
      if (!linkedGitDirReal || !(0, import_fs.statSync)(linkedGitDirReal).isDirectory()) return null;
      metadataPath = linkedGitDirReal;
      linkedGitDirSignature = [
        linkedGitDirReal,
        gitMetadataFileSignature(linkedGitDirReal),
        gitMetadataFileSignature((0, import_path2.join)(linkedGitDirReal, "HEAD")),
        gitMetadataFileSignature((0, import_path2.join)(linkedGitDirReal, "index")),
        gitMetadataFileSignature((0, import_path2.join)(linkedGitDirReal, "config")),
        gitMetadataFileSignature((0, import_path2.join)(linkedGitDirReal, "config.worktree")),
        gitMetadataFileSignature((0, import_path2.join)(linkedGitDirReal, "commondir")),
        gitMetadataFileSignature((0, import_path2.join)(linkedGitDirReal, "gitdir")),
        commonGitDirectorySignature(linkedGitDirReal)
      ].join(":");
    }
    const gitPathReal = canonicalizeExistingPath(gitPath) ?? (0, import_path2.resolve)(gitPath);
    const metadataPathReal = canonicalizeExistingPath(metadataPath) ?? (0, import_path2.resolve)(metadataPath);
    const signature = [
      gitPathReal,
      gitMetadataFileSignature(gitPath),
      marker,
      linkedGitDirSignature,
      metadataPathReal,
      gitMetadataFileSignature((0, import_path2.join)(metadataPathReal, "HEAD")),
      gitMetadataFileSignature((0, import_path2.join)(metadataPathReal, "index")),
      gitMetadataFileSignature((0, import_path2.join)(metadataPathReal, "config")),
      gitMetadataFileSignature((0, import_path2.join)(metadataPathReal, "config.worktree"))
    ].join(":");
    return { directory: canonicalDirectory, signature };
  } catch {
    return null;
  }
}
function getGitTopologySignature(cwd) {
  const start = canonicalizeExistingPath(cwd) ?? (0, import_path2.resolve)(cwd);
  const signatures = [];
  let cursor = start;
  for (; ; ) {
    const gitPath = (0, import_path2.join)(cursor, ".git");
    if ((0, import_fs.existsSync)(gitPath)) {
      let metadataPath = gitPath;
      let marker = "";
      try {
        if ((0, import_fs.statSync)(gitPath).isFile()) {
          marker = readGitMarker(gitPath) ?? "<unreadable>";
          const gitDirMatch = /^\s*gitdir:\s*(.+?)\s*$/im.exec(marker);
          if (gitDirMatch?.[1]) metadataPath = (0, import_path2.resolve)(cursor, gitDirMatch[1].trim());
        }
      } catch {
      }
      const metadataReal = canonicalizeExistingPath(metadataPath) ?? (0, import_path2.resolve)(metadataPath);
      signatures.push([
        cursor,
        gitMetadataFileSignature(gitPath),
        marker,
        gitMetadataFileSignature((0, import_path2.join)(metadataReal, "HEAD")),
        gitMetadataFileSignature((0, import_path2.join)(metadataReal, "index")),
        gitMetadataFileSignature((0, import_path2.join)(metadataReal, "config")),
        gitMetadataFileSignature((0, import_path2.join)(metadataReal, "config.worktree")),
        commonGitDirectorySignature(metadataReal)
      ].join(":"));
    }
    const parent = (0, import_path2.dirname)(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return signatures.join("|");
}
function createStateRootCacheEntry(cwd, root) {
  return {
    root,
    metadataSignature: getGitMetadataSnapshot(cwd)?.signature ?? null,
    topologySignature: getGitTopologySignature(cwd),
    environmentSignature: gitProbeEnvironmentSignature()
  };
}
function isStateRootCacheEntryValid(cwd, entry) {
  return entry.metadataSignature === (getGitMetadataSnapshot(cwd)?.signature ?? null) && entry.topologySignature === getGitTopologySignature(cwd) && entry.environmentSignature === gitProbeEnvironmentSignature();
}
function isGitTopLevelCacheEntryValid(cwd, cached) {
  const current = getGitMetadataSnapshot(cwd);
  if (!current || current.signature !== cached.metadataSignature) return false;
  if (cached.topologySignature !== getGitTopologySignature(cwd)) return false;
  if (cached.environmentSignature !== gitProbeEnvironmentSignature()) return false;
  if (!sameCanonicalPath(current.directory, cached.metadataDir)) return false;
  if (!sameCanonicalPath(current.directory, cached.root)) return false;
  return isCredibleGitWorktreeRoot(cached.root);
}
function cacheGitTopLevel(key, root, cwd) {
  const metadata = getGitMetadataSnapshot(cwd);
  if (!metadata || !sameCanonicalPath(metadata.directory, root)) return;
  if (gitTopLevelCacheMap.size >= MAX_WORKTREE_CACHE_SIZE) {
    const oldest = gitTopLevelCacheMap.keys().next().value;
    if (oldest !== void 0) gitTopLevelCacheMap.delete(oldest);
  }
  gitTopLevelCacheMap.set(key, {
    root,
    metadataDir: metadata.directory,
    metadataSignature: metadata.signature,
    topologySignature: getGitTopologySignature(cwd),
    environmentSignature: gitProbeEnvironmentSignature()
  });
}
function resolveGitTopLevel(cwd, stateLocationOnly = false) {
  const effectiveCwd = cwd || process.cwd();
  const key = canonicalizeExistingPath(effectiveCwd) ?? (0, import_path2.resolve)(effectiveCwd);
  const cached = gitTopLevelCacheMap.get(key);
  if (cached) {
    if (isGitTopLevelCacheEntryValid(effectiveCwd, cached)) {
      gitTopLevelCacheMap.delete(key);
      gitTopLevelCacheMap.set(key, cached);
      return cached.root;
    }
    gitTopLevelCacheMap.delete(key);
  }
  const probe = probeGitTopLevel(effectiveCwd);
  if (probe.status !== "ok") {
    return stateLocationOnly && probe.status === "git_missing" ? findGitMetadataDir(key) : null;
  }
  cacheGitTopLevel(key, probe.root, effectiveCwd);
  return probe.root;
}
function getGitTopLevel(cwd) {
  return resolveGitTopLevel(cwd);
}
function getStateGitTopLevel(cwd) {
  return resolveGitTopLevel(cwd, true);
}
function getWorktreeRoot(cwd) {
  const effectiveCwd = cwd || process.cwd();
  if (worktreeCacheMap.has(effectiveCwd)) {
    const cached = worktreeCacheMap.get(effectiveCwd);
    if (isStateRootCacheEntryValid(effectiveCwd, cached) && cached.root !== null && isCredibleGitWorktreeRoot(cached.root)) {
      worktreeCacheMap.delete(effectiveCwd);
      worktreeCacheMap.set(effectiveCwd, cached);
      return cached.root;
    }
    worktreeCacheMap.delete(effectiveCwd);
  }
  const root = resolveSuperprojectRoot(effectiveCwd) || getStateGitTopLevel(effectiveCwd);
  if (!root) {
    return null;
  }
  if (worktreeCacheMap.size >= MAX_WORKTREE_CACHE_SIZE) {
    const oldest = worktreeCacheMap.keys().next().value;
    if (oldest !== void 0) {
      worktreeCacheMap.delete(oldest);
    }
  }
  worktreeCacheMap.set(effectiveCwd, createStateRootCacheEntry(effectiveCwd, root));
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
function discoverCentralizedDirFromSettings() {
  const candidates = [];
  try {
    candidates.push((0, import_path2.join)(getClaudeConfigDir(), "settings.json"));
  } catch {
  }
  try {
    const cw = process.cwd();
    candidates.push((0, import_path2.join)(cw, ".claude", "settings.json"));
    candidates.push((0, import_path2.join)(cw, ".claude", "settings.local.json"));
  } catch {
  }
  for (const p of candidates) {
    try {
      const raw = (0, import_fs.readFileSync)(p, "utf-8");
      const parsed = JSON.parse(raw);
      const env = parsed?.env;
      const val = env?.OMC_STATE_DIR;
      if (typeof val === "string" && val.trim()) return val.trim();
    } catch {
    }
  }
  return null;
}
function getProjectIdentifier(worktreeRoot) {
  const root = worktreeRoot || getStateGitTopLevel() || process.cwd();
  const operationScope = projectIdentifierOperationScope.getStore();
  const operationScopeKey = operationScope ? canonicalizeExistingPath(root) ?? (0, import_path2.resolve)(root) : null;
  if (operationScope && operationScopeKey) {
    const cached = operationScope.get(operationScopeKey);
    if (cached !== void 0) return cached;
  }
  const scope = worktreePathRenderScope.getStore();
  const scopeKey = scope ? canonicalizeExistingPath(root) ?? (0, import_path2.resolve)(root) : null;
  if (scope && scopeKey) {
    const cached = scope.projectIdentifiers.get(scopeKey);
    if (cached !== void 0) return cached;
  }
  const workspaceRoot = findWorkspaceRoot(root);
  if (workspaceRoot) {
    const cfg = readWorkspaceMarkerConfig(workspaceRoot);
    if (cfg.id && typeof cfg.id === "string" && cfg.id.trim()) {
      const safeId = cfg.id.trim().replace(/[^a-zA-Z0-9_-]/g, "_");
      const hash3 = (0, import_crypto.createHash)("sha256").update(safeId).digest("hex").slice(0, 16);
      const identifier3 = `${safeId}-${hash3}`;
      if (operationScope && operationScopeKey) operationScope.set(operationScopeKey, identifier3);
      if (scope && scopeKey) scope.projectIdentifiers.set(scopeKey, identifier3);
      return identifier3;
    }
    const hash2 = (0, import_crypto.createHash)("sha256").update(workspaceRoot).digest("hex").slice(0, 16);
    const dirName2 = (0, import_path2.basename)(workspaceRoot).replace(/[^a-zA-Z0-9_-]/g, "_");
    const identifier2 = `${dirName2}-${hash2}`;
    if (operationScope && operationScopeKey) operationScope.set(operationScopeKey, identifier2);
    if (scope && scopeKey) scope.projectIdentifiers.set(scopeKey, identifier2);
    return identifier2;
  }
  let remoteUrl = "";
  try {
    remoteUrl = (0, import_child_process.execFileSync)("git", ["remote", "get-url", "origin"], {
      cwd: root,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      timeout: 5e3
    }).trim();
  } catch {
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
  const source = remoteUrl || primaryRoot;
  const hash = (0, import_crypto.createHash)("sha256").update(source).digest("hex").slice(0, 16);
  const dirName = (0, import_path2.basename)(primaryRoot).replace(/[^a-zA-Z0-9_-]/g, "_");
  const identifier = `${dirName}-${hash}`;
  if (operationScope && operationScopeKey) operationScope.set(operationScopeKey, identifier);
  if (scope && scopeKey) scope.projectIdentifiers.set(scopeKey, identifier);
  return identifier;
}
function getOmcRoot(worktreeRoot) {
  const customDir = process.env.OMC_STATE_DIR;
  if (customDir) {
    const root2 = worktreeRoot || getStateGitTopLevel() || process.cwd();
    const workspaceRoot = findWorkspaceRoot(root2);
    const gitTopLevel = getStateGitTopLevel(root2);
    const projectId = !gitTopLevel && !workspaceRoot ? "non-git" : getProjectIdentifier(root2);
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
  if (workspaceAnchor && !isSensitiveStateLocation(workspaceAnchor)) {
    try {
      const legacyPathW = (0, import_path2.join)(workspaceAnchor, OmcPaths.ROOT);
      const discoveredCentral = discoverCentralizedDirFromSettings();
      if (discoveredCentral) {
        const wsCfg = readWorkspaceMarkerConfig(workspaceAnchor);
        let projectIdW;
        if (wsCfg.id && typeof wsCfg.id === "string" && wsCfg.id.trim()) {
          const safeId = wsCfg.id.trim().replace(/[^a-zA-Z0-9_-]/g, "_");
          projectIdW = `${safeId}-${(0, import_crypto.createHash)("sha256").update(safeId).digest("hex").slice(0, 16)}`;
        } else {
          projectIdW = `${(0, import_path2.basename)(workspaceAnchor).replace(/[^a-zA-Z0-9_-]/g, "_")}-${(0, import_crypto.createHash)("sha256").update(workspaceAnchor).digest("hex").slice(0, 16)}`;
        }
        const centralizedPathW = (0, import_path2.join)(discoveredCentral, projectIdW);
        const warningKeyW = `${legacyPathW}:${centralizedPathW}`;
        if (!dualDirWarnings.has(warningKeyW) && (0, import_fs.existsSync)(legacyPathW) && (0, import_fs.existsSync)(centralizedPathW)) {
          dualDirWarnings.add(warningKeyW);
          console.warn(
            `[omc] Both legacy state dir (${legacyPathW}) and centralized state dir (${centralizedPathW}) exist. Using legacy dir (OMC_STATE_DIR not set in this process). Set OMC_STATE_DIR via settings.json env to use centralized dir consistently.`
          );
        }
      }
    } catch {
    }
    return (0, import_path2.join)(workspaceAnchor, OmcPaths.ROOT);
  }
  const root = resolveStateAnchorRoot(worktreeRoot);
  if (!getStateGitTopLevel(root)) {
    return (0, import_path2.join)(resolveNonGitStateAnchor(root), OmcPaths.ROOT);
  }
  try {
    const legacyPath = (0, import_path2.join)(root, OmcPaths.ROOT);
    const discoveredCentral = discoverCentralizedDirFromSettings();
    if (discoveredCentral) {
      const projectId = getProjectIdentifier(root);
      const centralizedPath = (0, import_path2.join)(discoveredCentral, projectId);
      const warningKey = `${legacyPath}:${centralizedPath}`;
      if (!dualDirWarnings.has(warningKey) && (0, import_fs.existsSync)(legacyPath) && (0, import_fs.existsSync)(centralizedPath)) {
        dualDirWarnings.add(warningKey);
        console.warn(
          `[omc] Both legacy state dir (${legacyPath}) and centralized state dir (${centralizedPath}) exist. Using legacy dir (OMC_STATE_DIR not set in this process). Set OMC_STATE_DIR via settings.json env to use centralized dir consistently.`
        );
      }
    }
  } catch {
  }
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
function resolveSessionStatePaths(stateName, sessionId, worktreeRoot, opts) {
  const normalizedName = stateName.endsWith("-state") ? stateName : `${stateName}-state`;
  const fileName = opts?.fileName ?? `${normalizedName}.json`;
  if (opts?.fileName !== void 0 && (fileName.trim() !== fileName || !/^[A-Za-z0-9][A-Za-z0-9_-]*\.json$/.test(fileName))) {
    throw new Error(`Invalid session state filename: ${fileName}`);
  }
  const legacy = opts?.fileName ? resolveOmcPath(`state/${fileName}`, worktreeRoot) : resolveStatePath(stateName, worktreeRoot);
  if (!sessionId) {
    return {
      sessionScoped: "",
      legacy,
      effectiveRead: legacy,
      effectiveWrite: legacy
    };
  }
  validateSessionId(sessionId);
  const sessionScoped = resolveOmcPath(`state/sessions/${sessionId}/${fileName}`, worktreeRoot);
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
    const worktreeTop2 = (0, import_child_process.execFileSync)("git", ["rev-parse", "--show-toplevel"], {
      cwd: effectiveCwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      timeout: 5e3
    }).trim();
    let canonicalWorktreeTop = worktreeTop2;
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
function callerVisibleTrustedRootLabel(trustedRoot) {
  const label = (0, import_path2.basename)(trustedRoot);
  return label.length > 0 ? label : "current repository";
}
function attachCanonicalWorkingDirectoryRoots(target, providedRoot, trustedRoot) {
  canonicalWorkingDirectoryRoots.set(target, { providedRoot, trustedRoot });
}
function canonicalRootAliases(root) {
  if (root.length === 0) {
    return [];
  }
  const aliases = /* @__PURE__ */ new Set([root]);
  try {
    aliases.add((0, import_url.pathToFileURL)(root).href);
  } catch {
  }
  try {
    const real = (0, import_fs.realpathSync)(root);
    aliases.add(real);
    aliases.add((0, import_url.pathToFileURL)(real).href);
  } catch {
  }
  if (import_path2.sep === "\\") {
    aliases.add(root.replaceAll("\\", "/"));
  }
  return [...aliases].sort((a, b) => b.length - a.length);
}
function redactCanonicalRoots(text, providedRoot, trustedRoot) {
  let redacted = text;
  const roots = [...canonicalRootAliases(providedRoot), ...canonicalRootAliases(trustedRoot)].sort((a, b) => b.length - a.length);
  for (const root of roots) {
    redacted = redacted.split(root).join("<redacted>");
  }
  return redacted;
}
function redactErrorStack(stack, providedRoot, trustedRoot) {
  const newline = stack.includes("\r\n") ? "\r\n" : "\n";
  const lines = stack.split(/\r?\n/);
  if (lines.length <= 1) {
    return stack;
  }
  const [header, ...frames] = lines;
  return [header, ...frames.map((frame) => redactCanonicalRoots(frame, providedRoot, trustedRoot))].join(newline);
}
var import_crypto, import_node_async_hooks, import_child_process, import_fs, import_os2, import_path2, import_url, WORKSPACE_MARKER, OmcPaths, MAX_WORKTREE_CACHE_SIZE, worktreeCacheMap, gitTopLevelCacheMap, superprojectCacheMap, canonicalWorkingDirectoryRoots, GIT_PROBE_ENVIRONMENT_KEYS, MAX_GIT_MARKER_BYTES, workspaceCacheMap, SENSITIVE_DIR_BASENAMES, worktreePathRenderScope, projectIdentifierOperationScope, gitShowToplevelProbeForTests, dualDirWarnings, SESSION_ID_REGEX, ForeignWorkingDirectoryError;
var init_worktree_paths = __esm({
  "src/lib/worktree-paths.ts"() {
    "use strict";
    import_crypto = require("crypto");
    import_node_async_hooks = require("node:async_hooks");
    import_child_process = require("child_process");
    import_fs = require("fs");
    import_os2 = require("os");
    import_path2 = require("path");
    import_url = require("url");
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
    gitTopLevelCacheMap = /* @__PURE__ */ new Map();
    superprojectCacheMap = /* @__PURE__ */ new Map();
    canonicalWorkingDirectoryRoots = /* @__PURE__ */ new WeakMap();
    GIT_PROBE_ENVIRONMENT_KEYS = [
      "PATH",
      "GIT_DIR",
      "GIT_WORK_TREE",
      "GIT_COMMON_DIR",
      "GIT_EXEC_PATH",
      "GIT_CEILING_DIRECTORIES",
      "GIT_DISCOVERY_ACROSS_FILESYSTEM",
      "GIT_CONFIG_SYSTEM",
      "GIT_CONFIG_GLOBAL",
      "GIT_CONFIG_NOSYSTEM",
      "GIT_CONFIG_COUNT",
      "GIT_CONFIG_PARAMETERS",
      "GIT_INDEX_FILE",
      "HOME",
      "XDG_CONFIG_HOME"
    ];
    MAX_GIT_MARKER_BYTES = 4096;
    workspaceCacheMap = /* @__PURE__ */ new Map();
    SENSITIVE_DIR_BASENAMES = /* @__PURE__ */ new Set([
      ".ssh",
      ".gnupg",
      ".aws",
      ".azure",
      ".gcloud",
      ".kube",
      "ssh",
      ".pki",
      ".config",
      ".claude",
      ".claude.json",
      ".codex",
      ".gemini",
      ".cursor",
      ".vscode",
      ".ollama",
      ".docker",
      ".npm",
      ".cache",
      ".local",
      "desktop",
      "documents",
      "downloads",
      "pictures",
      "photos",
      "music",
      "movies",
      "videos",
      "public",
      "library"
    ]);
    worktreePathRenderScope = new import_node_async_hooks.AsyncLocalStorage();
    projectIdentifierOperationScope = new import_node_async_hooks.AsyncLocalStorage();
    dualDirWarnings = /* @__PURE__ */ new Set();
    SESSION_ID_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,255}$/;
    ForeignWorkingDirectoryError = class extends Error {
      callerLabel;
      constructor(providedRoot, trustedRoot, callerLabel) {
        super(
          `workingDirectory '${callerLabel}' belongs to a different repository than '${callerVisibleTrustedRootLabel(trustedRoot)}' and was not used. Cross-repository access is not permitted; pass a path inside the current repository or start the session there.`
        );
        this.name = "ForeignWorkingDirectoryError";
        this.callerLabel = callerLabel;
        attachCanonicalWorkingDirectoryRoots(this, providedRoot, trustedRoot);
        Object.defineProperty(this, "stack", {
          value: redactErrorStack(this.stack ?? `${this.name}: ${this.message}`, providedRoot, trustedRoot),
          enumerable: false,
          configurable: true,
          writable: true
        });
      }
      toJSON() {
        return {
          name: this.name,
          message: this.message,
          callerLabel: this.callerLabel
        };
      }
      [/* @__PURE__ */ Symbol.for("nodejs.util.inspect.custom")]() {
        return this.stack ?? `${this.name}: ${this.message}`;
      }
    };
  }
});

// scripts/lib/utf8-bom.mjs
function stripLeadingUtf8Bom(content) {
  return content.startsWith("\uFEFF") ? content.slice(1) : content;
}
var init_utf8_bom = __esm({
  "scripts/lib/utf8-bom.mjs"() {
    "use strict";
  }
});

// src/utils/jsonc.ts
function parseJsonc(content) {
  const cleaned = stripJsoncComments(content);
  return JSON.parse(cleaned);
}
function stripJsoncComments(content) {
  return stripTrailingCommas(stripComments(stripLeadingUtf8Bom(content)));
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
      if (i >= content.length) throw new SyntaxError("Unterminated JSONC block comment");
      i += 2;
      result += " ";
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
var init_jsonc = __esm({
  "src/utils/jsonc.ts"() {
    "use strict";
    init_utf8_bom();
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
      RALPLAN: "ralplan",
      DEEP_INTERVIEW: "deep-interview",
      SELF_IMPROVE: "self-improve"
    };
    MODE_CONFIRMATION_SKILL_MAP = {
      ralph: ["ralph"],
      ultragoal: ["ultragoal"],
      autopilot: ["autopilot"],
      ralplan: ["ralplan"]
    };
    ALL_MODE_NAMES = [
      MODE_NAMES.AUTOPILOT,
      MODE_NAMES.AUTORESEARCH,
      MODE_NAMES.TEAM,
      MODE_NAMES.RALPH,
      MODE_NAMES.RALPLAN,
      MODE_NAMES.DEEP_INTERVIEW,
      MODE_NAMES.SELF_IMPROVE
    ];
    MODE_STATE_FILE_MAP = {
      [MODE_NAMES.AUTOPILOT]: "autopilot-state.json",
      [MODE_NAMES.AUTORESEARCH]: "autoresearch-state.json",
      [MODE_NAMES.TEAM]: "team-state.json",
      [MODE_NAMES.RALPH]: "ralph-state.json",
      [MODE_NAMES.RALPLAN]: "ralplan-state.json",
      [MODE_NAMES.DEEP_INTERVIEW]: "deep-interview-state.json",
      [MODE_NAMES.SELF_IMPROVE]: "self-improve-state.json"
    };
    SESSION_END_MODE_STATE_FILES = [
      { file: MODE_STATE_FILE_MAP[MODE_NAMES.AUTOPILOT], mode: MODE_NAMES.AUTOPILOT },
      { file: MODE_STATE_FILE_MAP[MODE_NAMES.AUTORESEARCH], mode: MODE_NAMES.AUTORESEARCH },
      { file: MODE_STATE_FILE_MAP[MODE_NAMES.TEAM], mode: MODE_NAMES.TEAM },
      { file: MODE_STATE_FILE_MAP[MODE_NAMES.RALPH], mode: MODE_NAMES.RALPH },
      { file: MODE_STATE_FILE_MAP[MODE_NAMES.RALPLAN], mode: MODE_NAMES.RALPLAN },
      { file: MODE_STATE_FILE_MAP[MODE_NAMES.DEEP_INTERVIEW], mode: MODE_NAMES.DEEP_INTERVIEW },
      { file: MODE_STATE_FILE_MAP[MODE_NAMES.SELF_IMPROVE], mode: MODE_NAMES.SELF_IMPROVE },
      { file: "skill-active-state.json", mode: "skill-active" }
    ];
    SESSION_METRICS_MODE_FILES = [
      { file: MODE_STATE_FILE_MAP[MODE_NAMES.AUTOPILOT], mode: MODE_NAMES.AUTOPILOT },
      { file: MODE_STATE_FILE_MAP[MODE_NAMES.AUTORESEARCH], mode: MODE_NAMES.AUTORESEARCH },
      { file: MODE_STATE_FILE_MAP[MODE_NAMES.RALPH], mode: MODE_NAMES.RALPH },
      { file: MODE_STATE_FILE_MAP[MODE_NAMES.RALPLAN], mode: MODE_NAMES.RALPLAN },
      { file: MODE_STATE_FILE_MAP[MODE_NAMES.DEEP_INTERVIEW], mode: MODE_NAMES.DEEP_INTERVIEW },
      { file: MODE_STATE_FILE_MAP[MODE_NAMES.SELF_IMPROVE], mode: MODE_NAMES.SELF_IMPROVE }
    ];
  }
});

// src/lib/file-identity.ts
function fileIdentityOf(stats) {
  return {
    dev: BigInt(stats.dev),
    ino: BigInt(stats.ino)
  };
}
function identitiesEqual(left, right) {
  if (!left) return false;
  const leftIdentity = fileIdentityOf(left);
  const rightIdentity = fileIdentityOf(right);
  if (leftIdentity.ino !== rightIdentity.ino) return false;
  if (leftIdentity.dev === 0n || rightIdentity.dev === 0n) {
    return leftIdentity.ino !== 0n && (process.platform === "win32" || leftIdentity.dev === rightIdentity.dev);
  }
  return leftIdentity.dev === rightIdentity.dev;
}
function sameFileIdentity(left, right) {
  return identitiesEqual(left, right);
}
var init_file_identity = __esm({
  "src/lib/file-identity.ts"() {
    "use strict";
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
function verifyPrivateTempFile(fd, tempPath, label, operations) {
  const fdStats = descriptorStats(fd, operations);
  let pathStats;
  try {
    pathStats = pathnameStats(tempPath, operations);
  } catch {
    throw new Error(`${label} temporary file was replaced before rename`);
  }
  const isWindows = process.platform === "win32";
  const isPrivateRegularSingleLink = (stats) => stats.isFile() && (isWindows ? Number(stats.nlink) <= 1 : Number(stats.nlink) === 1) && (isWindows || (Number(stats.mode) & 511) === 384);
  if (!isPrivateRegularSingleLink(fdStats) || !isPrivateRegularSingleLink(pathStats)) {
    throw new Error(
      `${label} temporary file must be a private regular single-link file`
    );
  }
  if (!identitiesEqual(fdStats, pathStats)) {
    throw new Error(`${label} temporary file was replaced before rename`);
  }
}
function verifyPublishedFile(fd, filePath, label, operations) {
  const fdStats = descriptorStats(fd, operations);
  let pathStats;
  try {
    pathStats = pathnameStats(filePath, operations);
  } catch {
    throw new Error(`${label} target was replaced at publication`);
  }
  if (!pathStats.isFile() || !identitiesEqual(fdStats, pathStats)) {
    throw new Error(`${label} target was replaced at publication`);
  }
}
function preservePriorTarget(filePath, operations) {
  const backupPath = `${filePath}.rollback.${crypto.randomUUID()}`;
  try {
    const stats = (operations?.lstat ?? fsSync.lstatSync)(filePath);
    const isWindows = process.platform === "win32";
    if (!stats.isFile() || (isWindows ? stats.nlink > 1 : stats.nlink !== 1)) {
      return null;
    }
    (operations?.link ?? fsSync.linkSync)(filePath, backupPath);
    return backupPath;
  } catch (error) {
    if (error.code !== "ENOENT") {
      try {
        (operations?.unlink ?? fsSync.unlinkSync)(backupPath);
      } catch {
      }
    }
    return null;
  }
}
function descriptorStats(fd, operations) {
  return operations ? fsSync.fstatSync(fd) : fsSync.fstatSync(fd, { bigint: true });
}
function pathnameStats(filePath, operations) {
  return operations ? operations.lstat(filePath) : fsSync.lstatSync(filePath, { bigint: true });
}
function currentFileIdentity(filePath, operations) {
  try {
    return fileIdentityOf(pathnameStats(filePath, operations));
  } catch {
    return null;
  }
}
function descriptorIdentity(fd, operations) {
  try {
    return fileIdentityOf(descriptorStats(fd, operations));
  } catch {
    return null;
  }
}
function rollbackPriorTarget(filePath, backupPath, expectedIdentity, operations) {
  if (expectedIdentity === null) return;
  const current = currentFileIdentity(filePath, operations);
  if (!identitiesEqual(current, expectedIdentity)) {
    return;
  }
  try {
    if (backupPath === null) {
      (operations?.unlink ?? fsSync.unlinkSync)(filePath);
    } else {
      (operations?.rename ?? fsSync.renameSync)(backupPath, filePath);
    }
  } catch {
  }
}
function removeBackup(backupPath, operations) {
  if (backupPath === null) return;
  try {
    (operations?.unlink ?? fsSync.unlinkSync)(backupPath);
  } catch {
  }
}
async function atomicWriteJson(filePath, data, hooks) {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const tempPath = path.join(dir, `.${base}.tmp.${crypto.randomUUID()}`);
  let success = false;
  let backupPath = null;
  let fd = null;
  try {
    ensureDirSync(dir);
    const jsonContent = Buffer.from(JSON.stringify(data, null, 2), "utf-8");
    fd = await fs.open(tempPath, "wx", 384);
    try {
      let offset = 0;
      while (offset < jsonContent.length) {
        const { bytesWritten } = await fd.write(
          jsonContent,
          offset,
          jsonContent.length - offset,
          offset
        );
        if (bytesWritten === 0) {
          throw new Error("Failed to write complete JSON payload");
        }
        offset += bytesWritten;
      }
      await fd.sync();
      verifyPrivateTempFile(fd.fd, tempPath, "atomic JSON write");
      backupPath = preservePriorTarget(filePath);
      hooks?.beforeRename?.();
      await fs.rename(tempPath, filePath);
      let publishedIdentity = null;
      try {
        verifyPublishedFile(fd.fd, filePath, "atomic JSON write");
        publishedIdentity = descriptorIdentity(fd.fd);
        hooks?.afterRename?.();
        verifyPublishedFile(fd.fd, filePath, "atomic JSON write");
      } catch (error) {
        if (process.platform === "win32") {
          await fd.close();
          fd = null;
        }
        rollbackPriorTarget(
          filePath,
          backupPath,
          publishedIdentity
        );
        throw error;
      }
    } finally {
      if (fd !== null) {
        await fd.close();
        fd = null;
      }
    }
    success = true;
    removeBackup(backupPath);
    try {
      const dirFd = await fs.open(dir, "r");
      try {
        await dirFd.sync();
      } finally {
        await dirFd.close();
      }
    } catch {
    }
  } finally {
    if (!success) {
      await fs.unlink(tempPath).catch(() => {
      });
      removeBackup(backupPath);
    }
  }
}
function atomicWriteFileSync(filePath, content, hooks, operations) {
  if (operations && (!filePath || path.basename(filePath) !== filePath || filePath === "." || filePath === "..")) throw new RangeError("contained atomic write requires a basename");
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const tempPath = path.join(dir, `.${base}.tmp.${crypto.randomUUID()}`);
  let fd = null;
  let success = false;
  let backupPath = null;
  try {
    if (!operations) ensureDirSync(dir);
    fd = operations ? operations.open(tempPath, fsSync.constants.O_CREAT | fsSync.constants.O_EXCL | fsSync.constants.O_WRONLY, 384) : fsSync.openSync(tempPath, "wx", 384);
    writeAllSync(fd, content, "atomic write");
    fsSync.fsyncSync(fd);
    verifyPrivateTempFile(fd, tempPath, "atomic write", operations);
    backupPath = preservePriorTarget(filePath, operations);
    hooks?.beforeRename?.();
    (operations?.rename ?? fsSync.renameSync)(tempPath, filePath);
    let publishedIdentity = null;
    try {
      verifyPublishedFile(fd, filePath, "atomic write", operations);
      publishedIdentity = descriptorIdentity(fd, operations);
      hooks?.afterRename?.();
      verifyPublishedFile(fd, filePath, "atomic write", operations);
    } catch (error) {
      if (process.platform === "win32") {
        fsSync.closeSync(fd);
        fd = null;
      }
      rollbackPriorTarget(
        filePath,
        backupPath,
        publishedIdentity,
        operations
      );
      throw error;
    }
    fsSync.closeSync(fd);
    fd = null;
    success = true;
    removeBackup(backupPath, operations);
    try {
      if (operations) {
        operations.sync();
      } else {
        const dirFd = fsSync.openSync(dir, "r");
        try {
          fsSync.fsyncSync(dirFd);
        } finally {
          fsSync.closeSync(dirFd);
        }
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
        (operations?.unlink ?? fsSync.unlinkSync)(tempPath);
      } catch {
      }
      removeBackup(backupPath, operations);
    }
  }
}
function atomicWriteJsonSync(filePath, data, hooks, operations) {
  const jsonContent = JSON.stringify(data, null, 2);
  atomicWriteFileSync(filePath, jsonContent, hooks, operations);
}
var fs, fsSync, path, crypto, ATOMIC_BATCH_MAX_CONTENT_BYTES;
var init_atomic_write = __esm({
  "src/lib/atomic-write.ts"() {
    "use strict";
    fs = __toESM(require("fs/promises"), 1);
    fsSync = __toESM(require("fs"), 1);
    path = __toESM(require("path"), 1);
    crypto = __toESM(require("crypto"), 1);
    init_file_identity();
    ATOMIC_BATCH_MAX_CONTENT_BYTES = 1024 * 1024;
  }
});

// templates/hooks/lib/process-start-identity.mjs
function normalizeProcessStartIdentity(identity) {
  const ticks = /^ticks:(\d{1,19})$/.exec(identity);
  return ticks ? `windows-dmtf-us:${(BigInt(ticks[1]) - 621355968000000000n) / 10n}` : identity;
}
function encodeProcessStartForFilename(identity) {
  return identity.replace(/:/g, "_c_");
}
function decodeProcessStartFromFilename(encoded) {
  return encoded.replace(/_c_/g, ":");
}
var init_process_start_identity = __esm({
  "templates/hooks/lib/process-start-identity.mjs"() {
    "use strict";
  }
});

// src/platform/process-utils.ts
function processGroupIdSync(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  if (process.platform === "linux") {
    try {
      const stat = (0, import_fs3.readFileSync)(`/proc/${pid}/stat`, "utf8");
      const closeParen = stat.lastIndexOf(")");
      if (closeParen === -1) return null;
      const fields = stat.substring(closeParen + 2).split(" ");
      const group = Number(fields[2]);
      return Number.isInteger(group) && group > 0 ? group : null;
    } catch {
      return null;
    }
  }
  if (process.platform === "darwin") {
    try {
      const result = (0, import_child_process2.spawnSync)("ps", ["-p", String(pid), "-o", "pgid="], {
        encoding: "utf8",
        timeout: 2e3,
        windowsHide: true
      });
      const group = Number(result.stdout?.trim());
      return result.status === 0 && Number.isInteger(group) && group > 0 ? group : null;
    } catch {
      return null;
    }
  }
  return null;
}
async function terminateOwnedProcessGroup(options) {
  const deadline = parseDeadline(options.deadlineAt);
  if (deadline === void 0 || isDeadlineExceeded(deadline)) return "deadline-exceeded";
  if (process.platform === "win32") return "unknown";
  if (!Number.isInteger(options.processGroupId) || options.processGroupId <= 0) return "unknown";
  if (!isProcessAlive(options.pid)) return "already-dead";
  const identity = getProcessStartIdentitySync(options.pid);
  const group = processGroupIdSync(options.pid);
  if (!identity || !group) return "unknown";
  if (identity !== options.expectedStartIdentity || group !== options.processGroupId) return "identity-mismatch";
  if (isDeadlineExceeded(deadline)) return "deadline-exceeded";
  try {
    process.kill(-options.processGroupId, options.force ? "SIGKILL" : "SIGTERM");
    return "terminated";
  } catch (error) {
    const code = error.code;
    if (code === "ESRCH") return isProcessAlive(options.pid) ? "unknown" : "already-dead";
    return "unknown";
  }
}
function remainingDeadlineMs(deadlineAt) {
  if (deadlineAt === void 0) return void 0;
  return Math.max(0, deadlineAt - Date.now());
}
function isDeadlineExceeded(deadlineAt) {
  return deadlineAt !== void 0 && remainingDeadlineMs(deadlineAt) === 0;
}
function parseDeadline(deadlineAt) {
  const value = Date.parse(deadlineAt);
  return Number.isFinite(value) ? value : void 0;
}
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
      const stat = (0, import_fs3.readFileSync)(`/proc/${pid}/stat`, "utf8");
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
async function getProcessStartTime(pid, deadlineAt) {
  if (!Number.isInteger(pid) || pid <= 0 || isDeadlineExceeded(deadlineAt)) return void 0;
  if (process.platform === "win32") {
    return getProcessStartTimeWindows(pid, deadlineAt);
  } else if (process.platform === "darwin") {
    return getProcessStartTimeMacOS(pid, deadlineAt);
  } else if (process.platform === "linux") {
    return getProcessStartTimeLinux(pid, deadlineAt);
  }
  return void 0;
}
async function getProcessStartTimeWindows(pid, deadlineAt) {
  try {
    const { stdout } = await execFileAsync("wmic", [
      "process",
      "where",
      `ProcessId=${pid}`,
      "get",
      "CreationDate",
      "/format:csv"
    ], { timeout: Math.max(1, Math.min(5e3, remainingDeadlineMs(deadlineAt) ?? 5e3)), windowsHide: true });
    const wmicTime = parseWmicCreationDate(stdout);
    if (wmicTime !== void 0) return wmicTime;
  } catch {
  }
  if (isDeadlineExceeded(deadlineAt)) return void 0;
  const cimTime = await getProcessStartTimeWindowsPowerShellCim(pid, deadlineAt);
  if (cimTime !== void 0) return cimTime;
  return isDeadlineExceeded(deadlineAt) ? void 0 : getProcessStartTimeWindowsPowerShellProcess(pid, deadlineAt);
}
function parseWmicCreationDate(stdout) {
  return parseWindowsDmtfTimestamp(stdout)?.epochMilliseconds;
}
async function getProcessStartTimeWindowsPowerShellCim(pid, deadlineAt) {
  try {
    const { stdout } = await execFileAsync(
      "powershell",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `$p = Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" -ErrorAction Stop; if ($p -and $p.CreationDate) { [System.Management.ManagementDateTimeConverter]::ToDmtfDateTime([datetime]$p.CreationDate) }`
      ],
      { timeout: Math.max(1, Math.min(5e3, remainingDeadlineMs(deadlineAt) ?? 5e3)), windowsHide: true }
    );
    return parseWmicCreationDate(stdout);
  } catch {
    return void 0;
  }
}
async function getProcessStartTimeWindowsPowerShellProcess(pid, deadlineAt) {
  try {
    const { stdout } = await execFileAsync(
      "powershell",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if ($p -and $p.StartTime) { [System.Management.ManagementDateTimeConverter]::ToDmtfDateTime([datetime]$p.StartTime) }`
      ],
      { timeout: Math.max(1, Math.min(5e3, remainingDeadlineMs(deadlineAt) ?? 5e3)), windowsHide: true }
    );
    return parseWmicCreationDate(stdout);
  } catch {
    return void 0;
  }
}
async function getProcessStartTimeMacOS(pid, deadlineAt) {
  try {
    const { stdout } = await execFileAsync("ps", ["-p", String(pid), "-o", "lstart="], {
      env: { ...process.env, LC_ALL: "C" },
      timeout: Math.max(1, Math.min(5e3, remainingDeadlineMs(deadlineAt) ?? 5e3)),
      windowsHide: true
    });
    const date = new Date(stdout.trim());
    return isNaN(date.getTime()) ? void 0 : date.getTime();
  } catch {
    return void 0;
  }
}
async function getProcessStartTimeLinux(pid, deadlineAt) {
  if (isDeadlineExceeded(deadlineAt)) return void 0;
  try {
    const stat = await fsPromises.readFile(`/proc/${pid}/stat`, "utf8");
    const closeParen = stat.lastIndexOf(")");
    if (closeParen === -1) return void 0;
    const fields = stat.substring(closeParen + 2).split(" ");
    const startTime = parseInt(fields[19], 10);
    return isNaN(startTime) ? void 0 : startTime;
  } catch {
    return void 0;
  }
}
function dmtfCreationDateToTicks(dmtf) {
  const m = dmtf.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\.(\d{6})([+-])(\d{3})$/);
  if (!m) return null;
  const [, ys, mo, ds, hs, mins, ss, us, sign, off] = m;
  const year = Number(ys), month = Number(mo), day = Number(ds);
  const hour = Number(hs), minute = Number(mins), second = Number(ss);
  const micros = Number(us);
  const offsetMin = Number(off) * (sign === "-" ? -1 : 1);
  if (![year, month, day, hour, minute, second, micros, offsetMin].every(Number.isFinite)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return null;
  if (offsetMin < -840 || offsetMin > 840) return null;
  const wholeUtcMs = Date.UTC(year, month - 1, day, hour, minute, second) - offsetMin * 6e4;
  if (!Number.isFinite(wholeUtcMs)) return null;
  const localMs = wholeUtcMs + offsetMin * 6e4;
  const local = new Date(localMs);
  if (local.getUTCFullYear() !== year || local.getUTCMonth() + 1 !== month || local.getUTCDate() !== day || local.getUTCHours() !== hour || local.getUTCMinutes() !== minute || local.getUTCSeconds() !== second) return null;
  const ticks = BigInt(wholeUtcMs) * 10000n + BigInt(micros) * 10n + 621355968000000000n;
  return `ticks:${ticks.toString()}`;
}
function windowsProcessStartAuthority(identity) {
  const exactTicksText = /^ticks:(\d{1,19})$/.exec(identity)?.[1];
  const legacyDmtf = /^dmtf:(.+)$/.exec(identity)?.[1];
  const source = legacyDmtf ? dmtfCreationDateToTicks(legacyDmtf) : identity;
  if (!source) return void 0;
  const normalized = normalizeProcessStartIdentity(source);
  const epochMicrosecondsText = /^windows-dmtf-us:(\d{1,18})$/.exec(normalized)?.[1];
  if (!epochMicrosecondsText) return void 0;
  const epochMicroseconds = BigInt(epochMicrosecondsText);
  const minimum = WINDOWS_EPOCH_TICKS + epochMicroseconds * 10n;
  const maximum = minimum + 9n;
  if (minimum <= WINDOWS_EPOCH_TICKS || maximum > WINDOWS_MAX_TICKS) {
    return void 0;
  }
  if (exactTicksText) {
    const exactTicks = BigInt(exactTicksText);
    if (exactTicks < minimum || exactTicks > maximum || exactTicks > WINDOWS_MAX_TICKS) {
      return void 0;
    }
    return {
      normalized: `windows-dmtf-us:${epochMicroseconds}`,
      minimum: exactTicks,
      maximum: exactTicks,
      exact: true
    };
  }
  if (!legacyDmtf && !/^windows-dmtf-us:\d{1,18}$/.test(identity)) {
    return void 0;
  }
  return {
    normalized: `windows-dmtf-us:${epochMicroseconds}`,
    minimum,
    maximum,
    exact: false
  };
}
function windowsProcessStartIdentitiesMatch(actual, expected) {
  const actualAuthority = windowsProcessStartAuthority(actual);
  const expectedAuthority = windowsProcessStartAuthority(expected);
  if (!actualAuthority || !expectedAuthority) return void 0;
  return actualAuthority.exact && expectedAuthority.exact ? actualAuthority.minimum === expectedAuthority.minimum : actualAuthority.normalized === expectedAuthority.normalized;
}
function abortReason(signal) {
  return signal.reason instanceof Error ? signal.reason : new Error("process identity warm-up aborted");
}
function execFileForIdentity(command, args, timeoutMs, signal, onProbeSpawn) {
  return new Promise((resolve9, reject) => {
    if (signal?.aborted) {
      reject(abortReason(signal));
      return;
    }
    let child;
    try {
      child = (0, import_child_process2.execFile)(
        command,
        [...args],
        {
          encoding: "utf8",
          signal,
          timeout: Math.max(1, Math.floor(timeoutMs)),
          windowsHide: true
        },
        (error, stdout) => {
          if (error) {
            reject(error);
            return;
          }
          resolve9(stdout);
        }
      );
    } catch (error) {
      reject(error);
      return;
    }
    if (Number.isInteger(child.pid) && child.pid > 0) {
      try {
        onProbeSpawn?.(child.pid);
      } catch {
      }
    }
  });
}
async function getProcessStartIdentityWindows(pid, deadlineAt, signal, onProbeSpawn) {
  for (const executable of ["pwsh", "powershell"]) {
    let executableMissing = false;
    for (const command of [
      `$p = [System.Diagnostics.Process]::GetProcessById(${pid}); if ($p) { $p.StartTime.ToUniversalTime().Ticks }`,
      `$p = Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" -ErrorAction Stop; if ($p -and $p.CreationDate) { ([DateTime]$p.CreationDate).ToUniversalTime().Ticks }`
    ]) {
      if (signal?.aborted) throw abortReason(signal);
      const timeoutMs2 = Math.min(5e3, remainingDeadlineMs(deadlineAt) ?? 5e3);
      if (timeoutMs2 <= 0) return null;
      try {
        const stdout = await execFileForIdentity(
          executable,
          ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command],
          timeoutMs2,
          signal,
          onProbeSpawn
        );
        const ticks = stdout.trim().match(/^\d+$/)?.[0];
        if (ticks) return `ticks:${ticks}`;
      } catch (error) {
        if (signal?.aborted) throw abortReason(signal);
        executableMissing = error.code === "ENOENT";
        if (executableMissing) break;
      }
      if (isDeadlineExceeded(deadlineAt)) return null;
    }
    if (!executableMissing && isDeadlineExceeded(deadlineAt)) return null;
  }
  if (signal?.aborted) throw abortReason(signal);
  const timeoutMs = Math.min(5e3, remainingDeadlineMs(deadlineAt) ?? 5e3);
  if (timeoutMs <= 0) return null;
  try {
    const stdout = await execFileForIdentity(
      "wmic",
      ["process", "where", `ProcessId=${pid}`, "get", "CreationDate", "/format:csv"],
      timeoutMs,
      signal,
      onProbeSpawn
    );
    const match = stdout.match(/(\d{14}\.\d{6}[+-]\d{3})/);
    return match ? dmtfCreationDateToTicks(match[1]) : null;
  } catch {
    if (signal?.aborted) throw abortReason(signal);
    return null;
  }
}
async function getProcessStartIdentity(pid, deadlineAt) {
  if (!Number.isInteger(pid) || pid <= 0 || isDeadlineExceeded(deadlineAt)) return null;
  if (process.platform === "win32") return getProcessStartIdentityWindows(pid, deadlineAt);
  const synchronousIdentity = getProcessStartIdentitySync(pid);
  if (synchronousIdentity === "absent") return null;
  if (synchronousIdentity !== null) return synchronousIdentity;
  const startTime = await getProcessStartTime(pid, deadlineAt);
  return startTime === void 0 || isDeadlineExceeded(deadlineAt) ? null : String(startTime);
}
async function isProcessIdentityLive(pid, expectedStartIdentity, deadlineAt) {
  if (isDeadlineExceeded(deadlineAt)) return "unknown";
  if (!Number.isInteger(pid) || pid <= 0) return "dead";
  if (!isProcessAlive(pid)) return "dead";
  if (typeof expectedStartIdentity !== "string" || !expectedStartIdentity.trim()) return "unknown";
  if (process.platform === "win32") {
    if (!windowsProcessStartAuthority(expectedStartIdentity)) return "unknown";
    const identity2 = await getProcessStartIdentity(pid, deadlineAt);
    if (identity2 === null) return isProcessAlive(pid) ? "unknown" : "dead";
    const matches = windowsProcessStartIdentitiesMatch(
      identity2,
      expectedStartIdentity
    );
    return matches === void 0 ? "unknown" : matches ? "live" : "mismatch";
  }
  let expected = expectedStartIdentity;
  if (expected.startsWith("dmtf:")) {
    const converted = dmtfCreationDateToTicks(expected.slice("dmtf:".length));
    if (!converted) return "unknown";
    expected = converted;
  }
  const identity = await getProcessStartIdentity(pid, deadlineAt);
  if (identity === null) return isProcessAlive(pid) ? "unknown" : "dead";
  return identity === expected ? "live" : "mismatch";
}
var import_child_process2, import_fs3, import_util4, fsPromises, execFileAsync, currentProcessStartIdentitySync, WINDOWS_EPOCH_TICKS, WINDOWS_MAX_TICKS;
var init_process_utils = __esm({
  "src/platform/process-utils.ts"() {
    "use strict";
    import_child_process2 = require("child_process");
    import_fs3 = require("fs");
    import_util4 = require("util");
    fsPromises = __toESM(require("fs/promises"), 1);
    init_process_start_identity();
    execFileAsync = (0, import_util4.promisify)(import_child_process2.execFile);
    WINDOWS_EPOCH_TICKS = 621355968000000000n;
    WINDOWS_MAX_TICKS = 3155378975999999999n;
  }
});

// src/lib/runs-ledger.ts
function isWatchedRunMode(modeName) {
  return WATCHED_RUN_MODES.includes(modeName);
}
function ledgerPath(omcRoot) {
  return (0, import_path4.join)(omcRoot, "state", "runs", "ledger.jsonl");
}
function appendRunLedger(omcRoot, entry) {
  try {
    const dir = (0, import_path4.join)(omcRoot, "state", "runs");
    (0, import_fs4.mkdirSync)(dir, { recursive: true });
    const path3 = ledgerPath(omcRoot);
    rotateIfNeeded(path3);
    (0, import_fs4.appendFileSync)(path3, `${JSON.stringify(entry)}
`, "utf8");
  } catch {
  }
}
function rotateIfNeeded(path3) {
  try {
    const stat = (0, import_fs4.statSync)(path3);
    if (!stat.isFile()) return;
    const lines = (0, import_fs4.readFileSync)(path3, "utf8").split("\n").filter((line) => line.trim().length > 0);
    if (lines.length < LEDGER_TAIL_LINES) return;
    (0, import_fs4.appendFileSync)(`${path3}.1`, `${lines.join("\n")}
`, "utf8");
    (0, import_fs4.writeFileSync)(path3, "", "utf8");
  } catch {
  }
}
function observeModeStateActivation(omcRoot, filePath, previous, next) {
  try {
    if (previous?.active === true || next?.active !== true) return;
    const mode = modeFromStatePath(filePath);
    if (!mode || !isWatchedRunMode(mode)) return;
    activeLoggedPaths.set(filePath, true);
    appendRunLedger(omcRoot, {
      ts: (/* @__PURE__ */ new Date()).toISOString(),
      run: mode,
      sessionId: sessionIdFromStatePath(filePath),
      event: "start",
      outcome: "running"
    });
  } catch {
  }
}
function modeFromStatePath(filePath) {
  const match = filePath.replaceAll("\\", "/").match(/\/([a-z][a-z0-9-]+)-state\.json$/);
  return match?.[1] ?? null;
}
function sessionIdFromStatePath(filePath) {
  const match = filePath.replaceAll("\\", "/").match(/\/state\/sessions\/([^/]+)(?:\/|$)/);
  return match?.[1];
}
var import_fs4, import_path4, WATCHED_RUN_MODES, LEDGER_TAIL_LINES, activeLoggedPaths;
var init_runs_ledger = __esm({
  "src/lib/runs-ledger.ts"() {
    "use strict";
    import_fs4 = require("fs");
    import_path4 = require("path");
    WATCHED_RUN_MODES = ["ralph", "autopilot", "team", "ultragoal"];
    LEDGER_TAIL_LINES = 1e3;
    activeLoggedPaths = /* @__PURE__ */ new Map();
  }
});

// src/lib/mode-state-io.ts
function omcRootFromStatePath(filePath) {
  const normalized = filePath.replaceAll("\\", "/");
  const idx = normalized.lastIndexOf("/state/");
  if (idx === -1) return null;
  return normalized.slice(0, idx);
}
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
function nativeBindingDiagnostic(detail) {
  const normalizedDetail = detail?.split(/\r?\n/, 1)[0].replace(/\s+/g, " ").trim().slice(0, 240);
  const suffix = normalizedDetail ? ` Loader error: ${normalizedDetail}` : "";
  return `better-sqlite3 native binding (${SQLITE_NATIVE_BINDING}) is unavailable. State mutation is using the file-lock fallback. ${SQLITE_NATIVE_BINDING_REMEDIATION}${suffix}`;
}
function isNativeBindingError(error) {
  const message = errorMessage(error);
  return /better[_-]sqlite3(?:\.node)?|bindings(?:\.js)?|MODULE_NOT_FOUND|NODE_MODULE_VERSION|did not self-register|Could not locate the bindings file/i.test(message);
}
function ownProcessStartIdentity() {
  if (ownProcessStartIdentityCache === null) {
    ownProcessStartIdentityCache = getProcessStartIdentitySync(process.pid);
  }
  return ownProcessStartIdentityCache;
}
function sqliteConstructor() {
  if (process.env.NODE_ENV === "test" && process.env.OMC_TEST_BETTER_SQLITE3_LOAD_FAILURE === "1") {
    sqliteBindingLoadError = nativeBindingDiagnostic("simulated native binding load failure");
    return null;
  }
  return Database;
}
function mutationDbPath(lockPath) {
  let current = (0, import_path5.dirname)(lockPath);
  while ((0, import_path5.basename)(current) !== "state") {
    const parent = (0, import_path5.dirname)(current);
    if (parent === current) return (0, import_path5.join)((0, import_path5.dirname)(lockPath), ".state-mutation-locks.db");
    current = parent;
  }
  return (0, import_path5.join)(current, ".state-mutation-locks.db");
}
function ownerFromRow(row) {
  if (!row || row.version !== 1 || typeof row.pid !== "number" || !Number.isSafeInteger(row.pid) || row.pid <= 0 || typeof row.process_start !== "string" || typeof row.created_at !== "string" || typeof row.nonce !== "string") return null;
  return { version: 1, pid: row.pid, processStart: row.process_start, createdAt: row.created_at, nonce: row.nonce };
}
function writeAllSync2(fd, content, label) {
  const bytes = Buffer.from(content, "utf8");
  let offset = 0;
  while (offset < bytes.length) {
    const written = (0, import_fs5.writeSync)(fd, bytes, offset, bytes.length - offset);
    if (!Number.isInteger(written) || written <= 0) throw new Error(`${label} made no progress`);
    offset += written;
  }
  if ((0, import_fs5.fstatSync)(fd).size !== bytes.length) throw new Error(`${label} size verification failed`);
}
function readLockOwner(path3) {
  try {
    const value = JSON.parse((0, import_fs5.readFileSync)(path3, "utf8"));
    const pid = value.pid;
    if (value.version !== 1 || typeof pid !== "number" || !Number.isSafeInteger(pid) || pid <= 0 || typeof value.processStart !== "string" || !/^\S+$/.test(value.processStart) || typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt)) || typeof value.nonce !== "string" || !/^[0-9a-f-]{36}$/i.test(value.nonce)) return null;
    return {
      version: 1,
      pid,
      processStart: value.processStart,
      createdAt: value.createdAt,
      nonce: value.nonce
    };
  } catch (error) {
    return error.code === "ENOENT" ? "absent" : null;
  }
}
function sameOwner(left, right) {
  return left !== null && left.pid === right.pid && left.processStart === right.processStart && left.nonce === right.nonce;
}
function lockArtifactIdentity(path3) {
  try {
    const stats = (0, import_fs5.statSync)(path3, { bigint: true });
    return stats.isFile() ? { dev: stats.dev, ino: stats.ino } : null;
  } catch {
    return null;
  }
}
function lockArtifactSnapshot(path3) {
  const before = lockArtifactIdentity(path3);
  const owner = readLockOwner(path3);
  const after = lockArtifactIdentity(path3);
  if (owner === "absent") {
    return before === null && after === null ? { status: "absent" } : { status: "changed" };
  }
  if (owner === null) return { status: "invalid" };
  if (before === null || after === null || !sameFileIdentity(before, after)) {
    return { status: "changed" };
  }
  return { status: "present", owner, identity: before };
}
function reclaimDeadLockOwner(path3, observedOwner, observedIdentity) {
  const quarantinePath = `${path3}.reclaim.${process.pid}.${(0, import_crypto3.randomUUID)()}`;
  const before = lockArtifactIdentity(path3);
  const currentOwner = readLockOwner(path3);
  const after = lockArtifactIdentity(path3);
  if (currentOwner === "absent" || currentOwner === null || !sameOwner(currentOwner, observedOwner) || before === null || after === null || !sameFileIdentity(before, observedIdentity) || !sameFileIdentity(after, observedIdentity)) {
    return "changed";
  }
  try {
    (0, import_fs5.renameSync)(path3, quarantinePath);
  } catch (error) {
    return error.code === "ENOENT" ? "changed" : "failed";
  }
  let movedOwner = null;
  let movedIdentity = null;
  try {
    movedOwner = readLockOwner(quarantinePath);
    movedIdentity = lockArtifactIdentity(quarantinePath);
    if (movedOwner !== "absent" && movedOwner !== null && movedIdentity !== null && sameFileIdentity(movedIdentity, observedIdentity) && sameOwner(movedOwner, observedOwner)) {
      try {
        (0, import_fs5.unlinkSync)(quarantinePath);
        return "removed";
      } catch {
      }
    }
  } catch {
  }
  try {
    (0, import_fs5.linkSync)(quarantinePath, path3);
    try {
      (0, import_fs5.unlinkSync)(quarantinePath);
    } catch {
    }
  } catch {
  }
  return "changed";
}
function ownerLive(owner) {
  if (process.env.NODE_ENV === "test" && process.env.OMC_TEST_EMERGENCY_PROCESS_START_UNKNOWN_PID === String(owner.pid)) return null;
  const current = processStartIdentity(owner.pid);
  if (current === null) return null;
  return current === "absent" ? false : normalizeProcessStartIdentity(current) === normalizeProcessStartIdentity(owner.processStart);
}
function publishLockOwner(path3, owner) {
  const tempPath = `${path3}.${owner.pid}.${owner.nonce}.tmp`;
  let fd;
  try {
    fd = (0, import_fs5.openSync)(tempPath, "wx", 384);
    writeAllSync2(fd, JSON.stringify(owner), "lock owner publication");
    (0, import_fs5.fsyncSync)(fd);
    (0, import_fs5.closeSync)(fd);
    fd = void 0;
    (0, import_fs5.linkSync)(tempPath, path3);
    try {
      (0, import_fs5.unlinkSync)(tempPath);
    } catch (error) {
      const code = error.code;
      if (code !== "EPERM" && code !== "EBUSY") throw error;
    }
    return true;
  } catch {
    try {
      if (fd !== void 0) (0, import_fs5.closeSync)(fd);
    } catch {
    }
    try {
      (0, import_fs5.unlinkSync)(tempPath);
    } catch {
    }
    return false;
  }
}
function openMutationDb(lockPath) {
  const Database2 = sqliteConstructor();
  if (!Database2) return null;
  let db = null;
  try {
    const dbPath = mutationDbPath(lockPath);
    for (const sidecar of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`, `${dbPath}-journal`]) {
      try {
        const stat = (0, import_fs5.statSync)(sidecar);
        if (!stat.isFile() || stat.nlink !== 1) {
          if (process.env.OMC_LOCK_DEBUG) console.error(`[lock-debug] openMutationDb sidecar-reject ${sidecar} isFile=${stat.isFile()} nlink=${stat.nlink}`);
          return null;
        }
      } catch (error) {
        if (error.code !== "ENOENT") {
          if (process.env.OMC_LOCK_DEBUG) console.error(`[lock-debug] openMutationDb sidecar-stat-error ${sidecar} ${error.code}`);
          return null;
        }
      }
    }
    db = new Database2(dbPath);
    db.pragma("journal_mode = WAL");
    db.pragma("busy_timeout = 2000");
    db.exec("CREATE TABLE IF NOT EXISTS state_mutation_locks (lock_key TEXT PRIMARY KEY, version INTEGER NOT NULL, pid INTEGER NOT NULL, process_start TEXT NOT NULL, created_at TEXT NOT NULL, nonce TEXT NOT NULL)");
    return db;
  } catch (error) {
    if (process.env.OMC_LOCK_DEBUG) console.error(`[lock-debug] openMutationDb open/exec failed for ${lockPath}: ${error?.message}`);
    const detail = isNativeBindingError(error) ? errorMessage(error) : `SQLite backend initialization failed: ${errorMessage(error)}`;
    sqliteBindingLoadError = nativeBindingDiagnostic(detail);
    try {
      db?.close();
    } catch {
    }
    return null;
  }
}
function acquireFileLockAt(path3, attempts) {
  lastMutationLockFailureDetail = null;
  const key = (() => {
    try {
      return (0, import_path5.resolve)((0, import_fs5.realpathSync)((0, import_path5.dirname)(path3)), (0, import_path5.basename)(path3));
    } catch {
      return (0, import_path5.resolve)(path3);
    }
  })();
  const processStart = ownProcessStartIdentity();
  if (!processStart || processStart === "absent") {
    lastMutationLockFailure = "unverifiable";
    return null;
  }
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const owner = {
      version: 1,
      pid: process.pid,
      processStart,
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      nonce: (0, import_crypto3.randomUUID)()
    };
    const tempPath = `${path3}.${owner.pid}.${owner.nonce}.tmp`;
    let fd;
    try {
      fd = (0, import_fs5.openSync)(tempPath, "wx", 384);
      writeAllSync2(fd, JSON.stringify(owner), "lock owner publication");
      (0, import_fs5.fsyncSync)(fd);
      (0, import_fs5.closeSync)(fd);
      fd = void 0;
      (0, import_fs5.linkSync)(tempPath, path3);
      try {
        (0, import_fs5.unlinkSync)(tempPath);
      } catch (error) {
        const code = error.code;
        if (code !== "EPERM" && code !== "EBUSY") throw error;
      }
      const lock = { backend: "file", key, path: path3, owner, depth: 1 };
      localLocks.set(key, lock);
      lastMutationLockFailure = null;
      lastMutationLockFailureDetail = null;
      return lock;
    } catch (error) {
      try {
        if (fd !== void 0) (0, import_fs5.closeSync)(fd);
      } catch {
      }
      try {
        (0, import_fs5.unlinkSync)(tempPath);
      } catch {
      }
      const code = error?.code;
      if (code !== "EEXIST") {
        lastMutationLockFailure = "unverifiable";
        return null;
      }
      const observedIdentity = lockArtifactIdentity(path3);
      if (observedIdentity === null) continue;
      const existing = readLockOwner(path3);
      if (existing === "absent") continue;
      if (!existing) {
        lastMutationLockFailure = "unverifiable";
        return null;
      }
      const recheck = lockArtifactIdentity(path3);
      if (!recheck || !sameFileIdentity(recheck, observedIdentity)) continue;
      const live = ownerLive(existing);
      if (live === null) {
        lastMutationLockFailure = "unverifiable";
        return null;
      }
      if (live) {
        lastMutationLockFailure = "contention";
        if (attempt + 1 < attempts) {
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
          continue;
        }
        return null;
      }
      const reclaimed = reclaimDeadLockOwner(path3, existing, observedIdentity);
      if (reclaimed === "failed") {
        lastMutationLockFailure = "unverifiable";
        return null;
      }
    }
  }
  lastMutationLockFailure = "contention";
  return null;
}
function acquireLockAt(path3, attempts = 50) {
  lastMutationLockFailureDetail = null;
  (0, import_fs5.mkdirSync)((0, import_path5.dirname)(path3), { recursive: true });
  const key = (() => {
    try {
      return (0, import_path5.resolve)((0, import_fs5.realpathSync)((0, import_path5.dirname)(path3)), (0, import_path5.basename)(path3));
    } catch {
      return (0, import_path5.resolve)(path3);
    }
  })();
  const held = localLocks.get(key);
  if (held) {
    held.depth += 1;
    return held;
  }
  const db = openMutationDb(path3);
  if (!db) {
    if (sqliteBindingLoadError) {
      return acquireFileLockAt(path3, attempts);
    }
    if (attempts <= 1) {
      lastMutationLockFailure = "unverifiable";
      return null;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    return acquireLockAt(path3, attempts - 1);
  }
  const processStart = ownProcessStartIdentity();
  if (!processStart) {
    try {
      db.close();
    } catch {
    }
    if (process.env.OMC_LOCK_DEBUG) console.error(`[lock-debug] acquireLockAt processStart-null ${path3}`);
    if (attempts <= 1) {
      lastMutationLockFailure = "unverifiable";
      return null;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    return acquireLockAt(path3, attempts - 1);
  }
  const owner = { version: 1, pid: process.pid, processStart, createdAt: (/* @__PURE__ */ new Date()).toISOString(), nonce: (0, import_crypto3.randomUUID)() };
  try {
    db.exec("BEGIN IMMEDIATE");
    const rawRow = db.prepare("SELECT version, pid, process_start, created_at, nonce FROM state_mutation_locks WHERE lock_key = ?").get(key);
    const observedRow = rawRow ? ownerFromRow(rawRow) : null;
    if (rawRow && !observedRow) {
      db.exec("ROLLBACK");
      db.close();
      lastMutationLockFailure = "unverifiable";
      if (process.env.OMC_LOCK_DEBUG) console.error(`[lock-debug] acquireLockAt row-invalid ${path3}`);
      return null;
    }
    if (observedRow) {
      db.exec("ROLLBACK");
      const live = ownerLive(observedRow);
      if (live === null || live) {
        db.close();
        if (process.env.OMC_LOCK_DEBUG) console.error(`[lock-debug] acquireLockAt row-live=${live} ${path3}`);
        if (live === null || attempts <= 1) {
          lastMutationLockFailure = live === null ? "unverifiable" : "contention";
          return null;
        }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
        return acquireLockAt(path3, attempts - 1);
      }
      db.exec("BEGIN IMMEDIATE");
      const rawCurrentRow = db.prepare("SELECT version, pid, process_start, created_at, nonce FROM state_mutation_locks WHERE lock_key = ?").get(key);
      const currentRow = rawCurrentRow ? ownerFromRow(rawCurrentRow) : null;
      if (rawCurrentRow && !currentRow) {
        db.exec("ROLLBACK");
        db.close();
        lastMutationLockFailure = "unverifiable";
        return null;
      }
      if (!sameOwner(currentRow, observedRow)) {
        db.exec("ROLLBACK");
        db.close();
        if (attempts <= 1) {
          lastMutationLockFailure = "contention";
          return null;
        }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
        return acquireLockAt(path3, attempts - 1);
      }
    }
    const observedArtifact = lockArtifactSnapshot(path3);
    if (observedArtifact.status === "invalid") {
      db.exec("ROLLBACK");
      db.close();
      lastMutationLockFailure = "unverifiable";
      console.error(`[omc-lock] state_mutation_lock_unverifiable: ${path3}`);
      return null;
    }
    if (observedArtifact.status === "changed") {
      db.exec("ROLLBACK");
      db.close();
      if (attempts <= 1) {
        lastMutationLockFailure = "contention";
        return null;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
      return acquireLockAt(path3, attempts - 1);
    }
    if (observedArtifact.status === "present" && (!observedRow || !sameOwner(observedArtifact.owner, observedRow))) {
      db.exec("ROLLBACK");
      const live = ownerLive(observedArtifact.owner);
      if (live === null || live) {
        db.close();
        if (process.env.OMC_LOCK_DEBUG) console.error(`[lock-debug] acquireLockAt artifact-live=${live} ${path3}`);
        if (live === null || attempts <= 1) {
          lastMutationLockFailure = live === null ? "unverifiable" : "contention";
          return null;
        }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
        return acquireLockAt(path3, attempts - 1);
      }
      db.exec("BEGIN IMMEDIATE");
      const rawCurrentRow = db.prepare("SELECT version, pid, process_start, created_at, nonce FROM state_mutation_locks WHERE lock_key = ?").get(key);
      const currentRow = rawCurrentRow ? ownerFromRow(rawCurrentRow) : null;
      if (rawCurrentRow && !currentRow) {
        db.exec("ROLLBACK");
        db.close();
        lastMutationLockFailure = "unverifiable";
        return null;
      }
      const rowChanged = observedRow ? !sameOwner(currentRow, observedRow) : rawCurrentRow !== void 0;
      if (rowChanged) {
        db.exec("ROLLBACK");
        db.close();
        if (attempts <= 1) {
          lastMutationLockFailure = "contention";
          return null;
        }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
        return acquireLockAt(path3, attempts - 1);
      }
      const currentArtifact = lockArtifactSnapshot(path3);
      if (currentArtifact.status === "invalid") {
        db.exec("ROLLBACK");
        db.close();
        lastMutationLockFailure = "unverifiable";
        return null;
      }
      if (currentArtifact.status !== "present" || !sameOwner(currentArtifact.owner, observedArtifact.owner) || !sameFileIdentity(currentArtifact.identity, observedArtifact.identity)) {
        db.exec("ROLLBACK");
        db.close();
        if (attempts <= 1) {
          lastMutationLockFailure = "contention";
          return null;
        }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
        return acquireLockAt(path3, attempts - 1);
      }
    }
    if (observedRow) {
      db.prepare("DELETE FROM state_mutation_locks WHERE lock_key = ?").run(key);
    }
    if (observedArtifact.status === "present") {
      const reclaimed = reclaimDeadLockOwner(path3, observedArtifact.owner, observedArtifact.identity);
      if (reclaimed !== "removed") {
        db.exec("ROLLBACK");
        db.close();
        if (reclaimed === "changed" && attempts > 1) {
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
          return acquireLockAt(path3, attempts - 1);
        }
        lastMutationLockFailure = reclaimed === "changed" ? "contention" : "unverifiable";
        return null;
      }
    }
    db.prepare("INSERT INTO state_mutation_locks (lock_key, version, pid, process_start, created_at, nonce) VALUES (?, 1, ?, ?, ?, ?)").run(key, owner.pid, owner.processStart, owner.createdAt, owner.nonce);
    if (!publishLockOwner(path3, owner)) {
      db.exec("ROLLBACK");
      db.close();
      if (process.env.OMC_LOCK_DEBUG) console.error(`[lock-debug] acquireLockAt publish-failed ${path3}`);
      if (attempts <= 1) {
        lastMutationLockFailure = "contention";
        return null;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
      return acquireLockAt(path3, attempts - 1);
    }
    db.exec("COMMIT");
    const lock = { backend: "sqlite", db, key, path: path3, owner, depth: 1 };
    localLocks.set(key, lock);
    lastMutationLockFailure = null;
    lastMutationLockFailureDetail = null;
    return lock;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
    }
    try {
      db.close();
    } catch {
    }
    const code = error?.code;
    if (process.env.OMC_LOCK_DEBUG) console.error(`[lock-debug] acquireLockAt caught-error ${path3} code=${code} msg=${error?.message}`);
    if ((code === "SQLITE_BUSY" || code === "SQLITE_LOCKED") && attempts > 1) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
      return acquireLockAt(path3, attempts - 1);
    }
    lastMutationLockFailure = code === "SQLITE_BUSY" || code === "SQLITE_LOCKED" ? "contention" : "unverifiable";
    return null;
  }
}
function acquireMutationLock(filePath) {
  return acquireLockAt(`${filePath}.mutation.lock`);
}
function releaseMutationLock(lock) {
  if (!lock) return true;
  if (lock.depth > 1) {
    lock.depth -= 1;
    return true;
  }
  localLocks.delete(lock.key);
  if (lock.backend === "file") {
    try {
      const artifact = readLockOwner(lock.path);
      if (artifact === "absent") return true;
      if (!artifact || !sameOwner(artifact, lock.owner)) {
        lastMutationLockFailure = "unverifiable";
        lastMutationLockFailureDetail = `State mutation lock release failed; owner metadata changed or disappeared: ${lock.path}`;
        console.error(`[omc-lock] state_mutation_lock_release_failed: ${lock.path}`);
        return false;
      }
      (0, import_fs5.unlinkSync)(lock.path);
      return true;
    } catch (error) {
      lastMutationLockFailure = "unverifiable";
      lastMutationLockFailureDetail = `State mutation lock release failed for ${lock.path}: ${error.code ?? "unknown error"}`;
      console.error(`[omc-lock] state_mutation_lock_release_failed: ${lock.path} ${error.code ?? ""}`.trim());
      return false;
    }
  }
  try {
    lock.db.exec("BEGIN IMMEDIATE");
    const row = ownerFromRow(lock.db.prepare("SELECT version, pid, process_start, created_at, nonce FROM state_mutation_locks WHERE lock_key = ?").get(lock.key));
    const artifact = readLockOwner(lock.path);
    if (!sameOwner(row, lock.owner) || !sameOwner(artifact === "absent" ? null : artifact, lock.owner)) {
      lock.db.exec("ROLLBACK");
      lastMutationLockFailure = "unverifiable";
      lastMutationLockFailureDetail = `State mutation lock release failed; owner metadata changed or disappeared: ${lock.path}`;
      console.error(`[omc-lock] state_mutation_lock_release_failed: ${lock.path}`);
      return false;
    }
    (0, import_fs5.unlinkSync)(lock.path);
    lock.db.prepare("DELETE FROM state_mutation_locks WHERE lock_key = ?").run(lock.key);
    lock.db.exec("COMMIT");
    return true;
  } catch (error) {
    try {
      lock.db.exec("ROLLBACK");
    } catch {
    }
    lastMutationLockFailure = "unverifiable";
    lastMutationLockFailureDetail = `State mutation lock release failed for ${lock.path}: ${error.code ?? "unknown error"}`;
    console.error(`[omc-lock] state_mutation_lock_release_failed: ${lock.path} ${error.code ?? ""}`.trim());
    return false;
  } finally {
    try {
      lock.db.close();
    } catch {
    }
  }
}
function withStateFileMutationLock(filePath, callback, requireExclusive = false) {
  void requireExclusive;
  const lock = acquireLockAt(`${filePath}.mutation.lock`);
  if (!lock) return { acquired: false, value: void 0 };
  let value;
  let releaseFailed = false;
  try {
    value = callback();
  } finally {
    releaseFailed = !releaseMutationLock(lock);
  }
  return releaseFailed ? { acquired: false, value: void 0 } : { acquired: true, value };
}
function processStartIdentity(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  if (process.env.NODE_ENV === "test" && process.env.OMC_TEST_EMERGENCY_PROCESS_START_UNKNOWN_PID === String(pid)) return null;
  if (pid !== process.pid) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error.code === "ESRCH") return "absent";
    }
  }
  const identity = getProcessStartIdentitySync(pid);
  if (identity !== null) return identity;
  try {
    process.kill(pid, 0);
    return null;
  } catch (error) {
    const code = error.code;
    return code === "ESRCH" ? "absent" : null;
  }
}
function observeStateFileActivation(filePath, previous, next) {
  const omcRoot = omcRootFromStatePath(filePath);
  if (omcRoot) observeModeStateActivation(omcRoot, filePath, previous, next);
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
  if (!(0, import_fs5.existsSync)(filePath)) return "skipped";
  const lock = acquireMutationLock(filePath);
  if (!lock) return "failed";
  let result = "failed";
  try {
    if (!(0, import_fs5.existsSync)(filePath)) {
      result = "skipped";
    } else {
      let current;
      try {
        current = JSON.parse((0, import_fs5.readFileSync)(filePath, "utf8"));
      } catch {
        current = void 0;
      }
      if (!current) {
        result = "failed";
      } else if (!predicate(current)) {
        result = "skipped";
      } else {
        const next = transform(current);
        atomicWriteJsonSync(filePath, next);
        result = "written";
        observeStateFileActivation(filePath, current, next);
      }
    }
  } catch {
    result = "failed";
  }
  return releaseMutationLock(lock) ? result : "failed";
}
function stateDigest(raw) {
  return (0, import_crypto3.createHash)("sha256").update(raw).digest("hex");
}
function emergencyJournalPath(filePath) {
  return `${filePath}.emergency-journal.json`;
}
function sessionOwnerFromStatePath(filePath) {
  const match = filePath.replaceAll("\\", "/").match(/\/state\/sessions\/([^/]+)(?:\/|$)/);
  return match?.[1];
}
function sameEmergencyOwner(left, right) {
  return left.pid === right.pid && left.processStart === right.processStart && left.nonce === right.nonce;
}
function isEmergencyOwnerLive(owner) {
  const current = processStartIdentity(owner.pid);
  return current === null || current !== "absent" && normalizeProcessStartIdentity(current) === normalizeProcessStartIdentity(owner.processStart);
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
  const processStart = ownProcessStartIdentity();
  if (!processStart) return null;
  return `${path3}.${process.pid}.${encodeProcessStartForFilename(processStart)}.${(0, import_crypto3.randomUUID)()}.tmp`;
}
function publishEmergencyFileExclusive(path3, content) {
  const tempPath = emergencyPublicationTempPath(path3);
  let fd;
  try {
    if (!tempPath) return false;
    (0, import_fs5.mkdirSync)((0, import_path5.dirname)(path3), { recursive: true });
    fd = (0, import_fs5.openSync)(tempPath, "wx", 384);
    const bytes = Buffer.from(content);
    let offset = 0;
    while (offset < bytes.length) {
      const written = (0, import_fs5.writeSync)(fd, bytes, offset, bytes.length - offset);
      if (written <= 0) throw new Error("emergency publication made no progress");
      offset += written;
    }
    (0, import_fs5.fsyncSync)(fd);
    if ((0, import_fs5.statSync)(tempPath).size !== bytes.length) throw new Error("emergency publication truncated");
    (0, import_fs5.closeSync)(fd);
    fd = void 0;
    (0, import_fs5.linkSync)(tempPath, path3);
    (0, import_fs5.unlinkSync)(tempPath);
    return true;
  } catch (error) {
    if (process.env.OMC_LOCK_DEBUG) console.error(`[lock-debug] publishEmergencyFileExclusive failed path=${path3} tempPath=${tempPath} pathExists=${(0, import_fs5.existsSync)(path3)} err=${error?.code} ${error?.message}`);
    return false;
  } finally {
    if (fd !== void 0) {
      try {
        (0, import_fs5.closeSync)(fd);
      } catch {
      }
    }
    if (tempPath) {
      const generation = fileIdentity(tempPath);
      try {
        if (generation && sameFile(tempPath, generation)) (0, import_fs5.unlinkSync)(tempPath);
      } catch {
      }
    }
  }
}
function acquireRecoveryClaim(path3, attempts = 50) {
  const processStart = ownProcessStartIdentity();
  if (!processStart) {
    if (process.env.OMC_LOCK_DEBUG) console.error(`[lock-debug] acquireRecoveryClaim processStart-null ${path3}`);
    if (attempts <= 1) return null;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    return acquireRecoveryClaim(path3, attempts - 1);
  }
  const lock = acquireLockAt(`${path3}.recovery.guard`, attempts);
  if (!lock) {
    if (process.env.OMC_LOCK_DEBUG) console.error(`[lock-debug] acquireRecoveryClaim guard-lock-null ${path3}`);
    return null;
  }
  const existing = readRecoveryClaim(path3);
  if (existing) {
    const live = ownerLive(existing);
    if (live === null || live) {
      releaseMutationLock(lock);
      if (process.env.OMC_LOCK_DEBUG) console.error(`[lock-debug] acquireRecoveryClaim existing-live=${live} ${path3}`);
      return null;
    }
    try {
      (0, import_fs5.unlinkSync)(path3);
    } catch (error) {
      releaseMutationLock(lock);
      if (process.env.OMC_LOCK_DEBUG) console.error(`[lock-debug] acquireRecoveryClaim existing-unlink-failed ${path3} ${error.code}`);
      return null;
    }
  }
  const owner = { version: 1, pid: process.pid, processStart, createdAt: (/* @__PURE__ */ new Date()).toISOString(), nonce: (0, import_crypto3.randomUUID)() };
  if (!publishEmergencyFileExclusive(path3, JSON.stringify(owner))) {
    releaseMutationLock(lock);
    if (process.env.OMC_LOCK_DEBUG) console.error(`[lock-debug] acquireRecoveryClaim publish-failed ${path3}`);
    return null;
  }
  return owner;
}
function readRecoveryClaim(path3) {
  try {
    const owner = JSON.parse((0, import_fs5.readFileSync)(path3, "utf8"));
    return owner.version === 1 && Number.isSafeInteger(owner.pid) && owner.pid > 0 && typeof owner.processStart === "string" && typeof owner.createdAt === "string" && typeof owner.nonce === "string" ? owner : null;
  } catch {
    return null;
  }
}
function sameRecoveryClaim(left, right) {
  return left.pid === right.pid && left.processStart === right.processStart && left.nonce === right.nonce;
}
function releaseRecoveryClaim(path3, owner) {
  const guardPath = `${path3}.recovery.guard`;
  const key = (() => {
    try {
      return (0, import_path5.resolve)((0, import_fs5.realpathSync)((0, import_path5.dirname)(guardPath)), (0, import_path5.basename)(guardPath));
    } catch {
      return (0, import_path5.resolve)(guardPath);
    }
  })();
  const lock = localLocks.get(key);
  if (!lock) return;
  try {
    const current = readRecoveryClaim(path3);
    if (current && sameRecoveryClaim(current, owner)) {
      for (let attempt = 0; attempt < 10; attempt += 1) {
        try {
          (0, import_fs5.unlinkSync)(path3);
          break;
        } catch (error) {
          if (error.code === "ENOENT") break;
          if (attempt === 9) {
            if (process.env.OMC_LOCK_DEBUG) console.error(`[lock-debug] releaseRecoveryClaim unlink-failed-after-retries ${path3} ${error.code}`);
            break;
          }
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
        }
      }
    }
  } catch {
  }
  releaseMutationLock(lock);
}
function readEmergencyJournal(path3) {
  try {
    const journal = JSON.parse((0, import_fs5.readFileSync)(path3, "utf8"));
    if (journal.version !== 1 || typeof journal.transactionId !== "string" || !/^[0-9a-f-]{36}$/i.test(journal.transactionId) || !journal.owner || !Number.isInteger(journal.owner.pid) || journal.owner.pid <= 0 || typeof journal.owner.processStart !== "string" || typeof journal.owner.nonce !== "string" || !/^[0-9a-f-]{36}$/i.test(journal.owner.nonce) || journal.sessionOwner !== void 0 && typeof journal.sessionOwner !== "string" || journal.originalDigest !== void 0 && (typeof journal.originalDigest !== "string" || !/^[0-9a-f]{64}$/i.test(journal.originalDigest)) || journal.intendedDigest !== void 0 && (typeof journal.intendedDigest !== "string" || !/^[0-9a-f]{64}$/i.test(journal.intendedDigest)) || journal.intent !== void 0 && journal.intent !== "clear" && journal.intent !== "publish" || typeof journal.quarantinePath !== "string" || journal.phase !== "preparing" && journal.phase !== "prepared" && journal.phase !== "quarantined" && journal.phase !== "published") return null;
    const complete = typeof journal.originalDigest === "string" && (journal.intent === "clear" || journal.intent === "publish" && typeof journal.intendedDigest === "string");
    return journal.phase === "preparing" || complete ? journal : null;
  } catch {
    return null;
  }
}
function fileIdentity(path3) {
  try {
    const stat = (0, import_fs5.statSync)(path3, { bigint: true });
    return { dev: stat.dev, ino: stat.ino };
  } catch {
    return null;
  }
}
function sameFile(path3, expected) {
  const actual = fileIdentity(path3);
  return actual !== null && sameFileIdentity(actual, expected);
}
function reconcileEmergencyPublicationTemps(filePath, authorizeState) {
  const directory = (0, import_path5.dirname)(filePath);
  const base = filePath.slice(directory.length + 1).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^${base}\\.emergency-(journal\\.json|recovery\\.claim|quarantine\\.[0-9a-f-]{36}\\.payload)\\.(\\d+)\\.([^.]+)\\.([0-9a-f-]{36})\\.tmp$`, "i");
  let names;
  try {
    names = (0, import_fs5.readdirSync)(directory);
  } catch (error) {
    return error.code === "ENOENT";
  }
  for (const name of names) {
    const match = pattern.exec(name);
    if (!match) continue;
    const path3 = (0, import_path5.join)(directory, name);
    const matchedProcessStart = decodeProcessStartFromFilename(match[3]);
    const currentStart = processStartIdentity(Number(match[2]));
    if (currentStart === null || normalizeProcessStartIdentity(currentStart) === normalizeProcessStartIdentity(matchedProcessStart)) return false;
    const generation = fileIdentity(path3);
    try {
      if (!generation) return false;
      const raw = (0, import_fs5.readFileSync)(path3, "utf8");
      if (authorizeState) {
        if (match[1] === "journal.json") {
          const journal = readEmergencyJournal(path3);
          if (!journal || !recoveryGenerationsAuthorized(filePath, journal, authorizeState)) return false;
        } else if (match[1].startsWith("quarantine.")) {
          const state = JSON.parse(raw);
          if (!state || typeof state !== "object" || Array.isArray(state) || !authorizeState(state)) return false;
        } else {
          const claim = readRecoveryClaim(path3);
          if (!claim || claim.pid !== Number(match[2]) || claim.processStart !== matchedProcessStart || claim.nonce !== match[4]) return false;
        }
      }
      if (!sameFile(path3, generation) || stateDigest((0, import_fs5.readFileSync)(path3, "utf8")) !== stateDigest(raw)) return false;
      (0, import_fs5.unlinkSync)(path3);
    } catch {
      return false;
    }
  }
  return true;
}
function captureAndUnlinkPrimary(filePath, quarantinePath, expectedDigest) {
  try {
    (0, import_fs5.linkSync)(filePath, quarantinePath);
    const captured = fileIdentity(quarantinePath);
    if (!captured || stateDigest((0, import_fs5.readFileSync)(quarantinePath, "utf8")) !== expectedDigest || !sameFile(filePath, captured)) return false;
    emergencyReplaceAtCaptureBoundary(filePath);
    if (!sameFile(filePath, captured) || stateDigest((0, import_fs5.readFileSync)(filePath, "utf8")) !== expectedDigest) return false;
    (0, import_fs5.unlinkSync)(filePath);
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
        (0, import_fs5.unlinkSync)(journal.quarantinePath);
      } catch {
      }
    }
    try {
      (0, import_fs5.unlinkSync)(`${journal.quarantinePath}.payload`);
    } catch {
    }
    if (!journalIsOwned(journalPath, journal.transactionId, journal.owner)) return false;
    (0, import_fs5.unlinkSync)(journalPath);
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
    if (!(0, import_fs5.existsSync)(path3)) continue;
    let raw;
    let state;
    try {
      raw = (0, import_fs5.readFileSync)(path3, "utf8");
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
  const directory = (0, import_path5.dirname)(filePath);
  const base = filePath.slice(directory.length + 1).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const tempPattern = new RegExp(`^${base}\\.emergency-recovery\\.claim\\.\\d+\\.[^.]+\\.[0-9a-f-]{36}\\.tmp$`, "i");
  try {
    if ((0, import_fs5.readdirSync)(directory).some((name) => tempPattern.test(name))) {
      if (process.env.OMC_LOCK_DEBUG) console.error(`[lock-debug] hasUnattributable temp-match ${filePath}`);
      return true;
    }
    const claimPath = `${filePath}.emergency-recovery.claim`;
    if (!(0, import_fs5.existsSync)(claimPath)) {
      const result2 = recoveryClaim !== void 0;
      if (result2 && process.env.OMC_LOCK_DEBUG) console.error(`[lock-debug] hasUnattributable no-claim-file-but-recoveryClaim-set ${filePath}`);
      return result2;
    }
    if (!recoveryClaim) {
      if (process.env.OMC_LOCK_DEBUG) console.error(`[lock-debug] hasUnattributable claim-file-exists-no-recoveryClaim ${filePath}`);
      return true;
    }
    const current = readRecoveryClaim(claimPath);
    const result = !current || !sameRecoveryClaim(current, recoveryClaim);
    if (result && process.env.OMC_LOCK_DEBUG) console.error(`[lock-debug] hasUnattributable claim-mismatch ${filePath} current=${JSON.stringify(current)} recoveryClaim=${JSON.stringify(recoveryClaim)}`);
    return result;
  } catch (error) {
    if (process.env.OMC_LOCK_DEBUG) console.error(`[lock-debug] hasUnattributable caught-error ${filePath} ${error?.message}`);
    return true;
  }
}
function sharedRecoveryArtifactsAuthorized(filePath, authorizeState, recoveryClaim) {
  if (!authorizeState) return true;
  if (hasUnattributableRecoveryClaimArtifact(filePath, recoveryClaim)) return false;
  const journalPath = emergencyJournalPath(filePath);
  if (!(0, import_fs5.existsSync)(journalPath)) {
    if (!(0, import_fs5.existsSync)(filePath)) return true;
    try {
      const state = JSON.parse((0, import_fs5.readFileSync)(filePath, "utf8"));
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
    const directory = (0, import_path5.dirname)(filePath);
    for (const name of (0, import_fs5.readdirSync)(directory)) {
      if (name === (0, import_path5.basename)(filePath) || name.startsWith(`${(0, import_path5.basename)(filePath)}.emergency-`)) (0, import_fs5.unlinkSync)((0, import_path5.join)(directory, name));
    }
    for (const replacement of replacements) {
      if ((0, import_path5.dirname)(replacement.path) !== directory) throw new Error("invalid recovery replacement path");
      (0, import_fs5.writeFileSync)(replacement.path, replacement.content);
    }
  } finally {
    delete process.env.OMC_TEST_EMERGENCY_RECOVERY_REPLACEMENT_PATH;
    delete process.env.OMC_TEST_EMERGENCY_RECOVERY_REPLACEMENT_BASE64;
  }
}
function recoverEmergencyStateFile(filePath, options) {
  const pathSessionId = sessionOwnerFromStatePath(filePath);
  const authorizeState = options?.authorizeState ?? (pathSessionId ? (state) => {
    const owner = getStateSessionOwner(state);
    return owner === void 0 || owner === pathSessionId;
  } : void 0);
  const journalPath = emergencyJournalPath(filePath);
  if (!(0, import_fs5.existsSync)(filePath) && !(0, import_fs5.existsSync)(journalPath)) return true;
  if (!sharedRecoveryArtifactsAuthorized(filePath, authorizeState)) {
    if (process.env.OMC_LOCK_DEBUG) console.error(`[lock-debug] recoverEmergency prefilter-false ${filePath}`);
    return false;
  }
  if (!(0, import_fs5.existsSync)(journalPath)) {
    if (!authorizeState) return reconcileEmergencyPublicationTemps(filePath);
    const claimPath2 = `${filePath}.emergency-recovery.claim`;
    const claim2 = acquireRecoveryClaim(claimPath2);
    if (!claim2) {
      if (process.env.OMC_LOCK_DEBUG) console.error(`[lock-debug] recoverEmergency no-journal-claim-null ${filePath}`);
      return false;
    }
    try {
      if ((0, import_fs5.existsSync)(journalPath) || !sharedRecoveryArtifactsAuthorized(filePath, authorizeState, claim2)) {
        if (process.env.OMC_LOCK_DEBUG) console.error(`[lock-debug] recoverEmergency no-journal-revalidate-false ${filePath}`);
        return false;
      }
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
      if (!generation || readEmergencyJournal(journalPath) !== null || !(0, import_fs5.existsSync)(filePath) || !sameFile(journalPath, generation)) return false;
      (0, import_fs5.unlinkSync)(journalPath);
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
  if (!(0, import_fs5.existsSync)(journalPath)) return true;
  const journal = readEmergencyJournal(journalPath);
  if (!journal || journal.quarantinePath !== `${filePath}.emergency-quarantine.${journal.transactionId}`) return false;
  if (isEmergencyOwnerLive(journal.owner)) return false;
  if (!recoveryGenerationsAuthorized(filePath, journal, authorizeState)) return true;
  const owned = () => journalIsOwned(journalPath, journal.transactionId, journal.owner);
  if (!owned()) return false;
  const payloadPath = `${journal.quarantinePath}.payload`;
  const digest = (path3) => {
    try {
      return stateDigest((0, import_fs5.readFileSync)(path3, "utf8"));
    } catch {
      return null;
    }
  };
  if (journal.phase === "preparing") {
    const complete = typeof journal.originalDigest === "string" && (journal.intent === "clear" || journal.intent === "publish" && typeof journal.intendedDigest === "string");
    if (!complete) {
      if ((0, import_fs5.existsSync)(journal.quarantinePath) || (0, import_fs5.existsSync)(payloadPath)) return false;
      return removeOwnedEmergencyArtifacts(journalPath, journal, false);
    }
    const originalStillPrimary = !(0, import_fs5.existsSync)(journal.quarantinePath) && digest(filePath) === journal.originalDigest;
    if (journal.intent === "publish" && digest(payloadPath) !== journal.intendedDigest) {
      return originalStillPrimary && removeOwnedEmergencyArtifacts(journalPath, journal, false);
    }
    if (journal.intent === "clear" && (0, import_fs5.existsSync)(payloadPath)) {
      return originalStillPrimary && removeOwnedEmergencyArtifacts(journalPath, journal, false);
    }
    journal.phase = "prepared";
    return writeEmergencyJournal(journalPath, journal) && recoverDeadEmergencyStateFile(filePath, authorizeState);
  }
  const originalDigest = journal.originalDigest;
  const intent = journal.intent;
  const intendedDigest = journal.intendedDigest;
  const hasPrimary = (0, import_fs5.existsSync)(filePath);
  const hasQuarantine = (0, import_fs5.existsSync)(journal.quarantinePath);
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
        if (owned() && (0, import_fs5.existsSync)(filePath) && (0, import_fs5.existsSync)(journal.quarantinePath) && digest(filePath) !== originalDigest) {
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
    const payload = (0, import_fs5.readFileSync)(payloadPath, "utf8");
    if (stateDigest(payload) !== intendedDigest || !owned()) return false;
    (0, import_fs5.linkSync)(payloadPath, filePath);
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
  return (0, import_crypto3.createHash)("sha256").update(JSON.stringify(state)).digest("hex");
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
        (candidate) => (0, import_path5.resolve)(observation.path) === (0, import_path5.resolve)(candidate)
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
      if (!(0, import_fs5.existsSync)(path3)) {
        return { modeName, status: "not-applicable", paths };
      }
      let current;
      try {
        const parsed = JSON.parse((0, import_fs5.readFileSync)(path3, "utf8"));
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
      if (!(0, import_fs5.existsSync)(path3)) {
        return { modeName, status: "written", paths };
      }
      try {
        const verified = JSON.parse((0, import_fs5.readFileSync)(path3, "utf8"));
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
var import_fs5, import_path5, import_crypto3, import_module, import_meta2, require2, SQLITE_NATIVE_BINDING, SQLITE_NATIVE_BINDING_REMEDIATION, Database, sqliteBindingLoadError, localLocks, lastMutationLockFailure, lastMutationLockFailureDetail, ownProcessStartIdentityCache;
var init_mode_state_io = __esm({
  "src/lib/mode-state-io.ts"() {
    "use strict";
    import_fs5 = require("fs");
    import_path5 = require("path");
    import_crypto3 = require("crypto");
    import_module = require("module");
    init_worktree_paths();
    init_process_utils();
    init_atomic_write();
    init_file_identity();
    init_mode_names();
    init_process_start_identity();
    init_runs_ledger();
    import_meta2 = {};
    require2 = (0, import_module.createRequire)(
      import_meta2.url || (typeof __filename === "string" ? __filename : process.cwd() + "/")
    );
    SQLITE_NATIVE_BINDING = "better_sqlite3.node";
    SQLITE_NATIVE_BINDING_REMEDIATION = "Run `npm rebuild better-sqlite3` in the OMC plugin directory, then restart Claude Code.";
    Database = null;
    sqliteBindingLoadError = null;
    try {
      const loaded2 = require2("better-sqlite3");
      const candidate = typeof loaded2 === "function" ? loaded2 : loaded2 && typeof loaded2 === "object" && "default" in loaded2 ? loaded2.default : null;
      if (typeof candidate !== "function") {
        throw new Error("better-sqlite3 did not export a Database constructor");
      }
      Database = candidate;
    } catch (error) {
      sqliteBindingLoadError = nativeBindingDiagnostic(errorMessage(error));
    }
    localLocks = /* @__PURE__ */ new Map();
    lastMutationLockFailure = null;
    lastMutationLockFailureDetail = null;
    ownProcessStartIdentityCache = null;
  }
});

// src/notifications/hook-config.ts
function getHookNotificationConfigPath() {
  return (0, import_path6.join)(getClaudeConfigDir(), "omc_config.hook.json");
}
function getHookConfig() {
  if (cachedConfig !== void 0) return cachedConfig;
  const configPath = process.env.OMC_HOOK_CONFIG || DEFAULT_CONFIG_PATH;
  if (!(0, import_fs6.existsSync)(configPath)) {
    cachedConfig = null;
    return null;
  }
  try {
    const raw = JSON.parse((0, import_fs6.readFileSync)(configPath, "utf-8"));
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
var import_fs6, import_path6, DEFAULT_CONFIG_PATH, cachedConfig;
var init_hook_config = __esm({
  "src/notifications/hook-config.ts"() {
    "use strict";
    import_fs6 = require("fs");
    import_path6 = require("path");
    init_config_dir();
    DEFAULT_CONFIG_PATH = getHookNotificationConfigPath();
  }
});

// src/notifications/validation.ts
function validateCustomIntegration(integration) {
  const errors = [];
  if (!integration || typeof integration !== "object" || Array.isArray(integration)) {
    return { valid: false, errors: ["Integration must be an object"] };
  }
  if (typeof integration.id !== "string" || !integration.id) {
    errors.push("Integration ID is required");
  } else if (!VALID_ID_PATTERN.test(integration.id)) {
    errors.push("Integration ID must be alphanumeric with hyphens/underscores only");
  }
  if (!integration.type || !["webhook", "cli"].includes(integration.type)) {
    errors.push('Type must be either "webhook" or "cli"');
  }
  if (!Array.isArray(integration.events) || integration.events.length === 0 || !integration.events.every((event) => typeof event === "string")) {
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
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return ["Webhook configuration must be an object"];
  }
  if (typeof config.url !== "string" || !config.url) {
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
    if (typeof config.timeout !== "number" || !Number.isFinite(config.timeout) || config.timeout < MIN_TIMEOUT || config.timeout > MAX_TIMEOUT) {
      errors.push(`Timeout must be between ${MIN_TIMEOUT}ms and ${MAX_TIMEOUT}ms`);
    }
  }
  if (!config.headers || typeof config.headers !== "object" || Array.isArray(config.headers)) {
    errors.push("Headers must be an object of string values");
  } else {
    for (const [key, value] of Object.entries(config.headers)) {
      if (typeof value !== "string") {
        errors.push(`Header value must be a string for key: "${key}"`);
        continue;
      }
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
  if (typeof config.bodyTemplate !== "string") {
    errors.push("Body template must be a string");
  }
  return errors;
}
function validateCliIntegrationConfig(config) {
  const errors = [];
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return ["CLI configuration must be an object"];
  }
  if (typeof config.command !== "string" || !config.command) {
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
  if (!Array.isArray(config.args)) {
    errors.push("Arguments must be an array of strings");
  } else {
    for (const arg of config.args) {
      if (typeof arg !== "string") {
        errors.push("Arguments must be strings");
        continue;
      }
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
    if (typeof config.timeout !== "number" || !Number.isFinite(config.timeout) || config.timeout < MIN_TIMEOUT || config.timeout > MAX_TIMEOUT) {
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
  return (0, import_path7.join)(getClaudeConfigDir(), ".omc-config.json");
}
function readRawConfig() {
  if (!(0, import_fs7.existsSync)(CONFIG_FILE)) return null;
  try {
    return JSON.parse((0, import_fs7.readFileSync)(CONFIG_FILE, "utf-8"));
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
  const envValue = parsePositiveInt(process.env.OMC_NOTIFY_TMUX_TAIL_LINES);
  if (envValue !== void 0) {
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
function parsePositiveInt(value) {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 1 ? value : void 0;
  }
  if (typeof value !== "string") return void 0;
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return void 0;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : void 0;
}
function getLegacyOpenClawConfigPath() {
  return (0, import_path7.join)(getClaudeConfigDir(), "omc_config.openclaw.json");
}
function detectLegacyOpenClawConfig() {
  return (0, import_fs7.existsSync)(LEGACY_OPENCLAW_CONFIG);
}
function migrateLegacyOpenClawConfig() {
  if (!(0, import_fs7.existsSync)(LEGACY_OPENCLAW_CONFIG)) return null;
  try {
    const legacy = JSON.parse((0, import_fs7.readFileSync)(LEGACY_OPENCLAW_CONFIG, "utf-8"));
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
  if (!customIntegrations || typeof customIntegrations !== "object" || Array.isArray(customIntegrations)) return null;
  if (customIntegrations.integrations !== void 0 && !Array.isArray(customIntegrations.integrations)) return null;
  const validIntegrations = [];
  for (const rawIntegration of customIntegrations.integrations || []) {
    let integration = rawIntegration;
    if (integration && typeof integration === "object" && !Array.isArray(integration) && integration.config && typeof integration.config === "object" && !Array.isArray(integration.config) && integration.config.timeout === void 0 && ["webhook", "cli"].includes(integration.type)) {
      integration = { ...integration, config: {
        ...integration.config,
        timeout: integration.type === "webhook" ? 1e4 : 5e3
      } };
    }
    const result = validateCustomIntegration(integration);
    if (result.valid) {
      validIntegrations.push(integration);
    } else {
      console.warn(
        `[notifications] Invalid custom integration "${typeof integration?.id === "string" ? integration.id : "unknown"}": ${result.errors.join(", ")}`
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
var import_fs7, import_path7, CONFIG_FILE, DEFAULT_TMUX_TAIL_LINES, VALID_VERBOSITY_LEVELS, SESSION_EVENTS, LEGACY_OPENCLAW_CONFIG;
var init_config = __esm({
  "src/notifications/config.ts"() {
    "use strict";
    import_fs7 = require("fs");
    import_path7 = require("path");
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
      "session-idle",
      // Approval requests gate a blocked pipeline; like ask-user-question they
      // must never be silently dropped by a coarse verbosity setting.
      "approval-request"
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
  if (payload.projectPath) return (0, import_path8.basename)(payload.projectPath);
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
function formatApprovalRequest(payload) {
  const lines = [`\u{1F514} Approval Required`, ""];
  if (payload.question) {
    lines.push(payload.question);
    lines.push("");
  }
  if (payload.approval) {
    lines.push(`Run: \`${payload.approval.runId}\` | Activation: \`${payload.approval.activationId}\``);
    lines.push("");
  }
  lines.push(`Reply or run \`omc graph approvals decide\` to approve/deny.`);
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
    case "approval-request":
      return formatApprovalRequest(payload);
    case "agent-call":
      return formatAgentCall(payload);
    default:
      return payload.message || `Event: ${payload.event}`;
  }
}
var import_path8, ANSI_ESCAPE_RE, UI_CHROME_RE, CTRL_O_RE, BOX_DRAWING_RE, OMC_HUD_RE, BYPASS_PERM_RE, BARE_PROMPT_RE, MIN_ALNUM_RATIO, REVIEW_SEED_OUTCOME_PATTERNS, REVIEW_SEED_CUE_RE, REVIEW_SEED_LIST_RE, SOURCE_PATH_LINE_RE, STATIC_CODE_ALERT_RE, HELP_USAGE_LINE_RE, STATIC_HELP_CODE_RE, DIFF_HEADER_LINE_RE, STRUCTURED_ALERT_KEYWORD_RE, SEARCH_COMMAND_RE, QUOTED_OR_REGEX_QUERY_RE, ZERO_ALERT_SUMMARY_RE, ALERT_REGEX_LITERAL_RE, GENERIC_HOOK_FAILURE_PROSE_RE, ISSUE_PROMPT_NOISE_RE, PERMISSION_DENIED_SCAN_LINE_RE, CLEAN_DIAGNOSTIC_QUERY_RE, JSONISH_LINE_RE, REQUEST_RESPONSE_LITERAL_RE, CODE_LITERAL_PREFIX_RE, DEFAULT_MAX_TAIL_LINES;
var init_formatter = __esm({
  "src/notifications/formatter.ts"() {
    "use strict";
    import_path8 = require("path");
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
  if (payload.projectPath) return (0, import_path9.basename)(payload.projectPath);
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
      const value = Object.hasOwn(vars, varName) ? vars[varName] : "";
      return value ? content : "";
    }
  );
}
function replaceVariables(template, vars) {
  return template.replace(
    /\{\{(\w+)\}\}/g,
    (_match, varName) => Object.hasOwn(vars, varName) ? vars[varName] : ""
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
function interpolateJsonStringToken(token, vars) {
  const contents = token.slice(1, -1);
  let value = "";
  let cursor = 0;
  for (const match of contents.matchAll(/\{\{(\w+)\}\}/g)) {
    const start = match.index;
    value += JSON.parse(`"${contents.slice(cursor, start)}"`);
    value += vars[match[1]] ?? "";
    cursor = start + match[0].length;
  }
  value += JSON.parse(`"${contents.slice(cursor)}"`);
  return JSON.stringify(value);
}
function interpolateJsonTemplate(template, payload) {
  const vars = computeTemplateVariables(payload);
  const conditioned = processConditionals(template, vars);
  let result = "";
  let cursor = 0;
  for (const match of conditioned.matchAll(/"(?:\\[\s\S]|[^"\\])*"/g)) {
    const start = match.index;
    result += replaceVariables(conditioned.slice(cursor, start), vars);
    try {
      result += interpolateJsonStringToken(match[0], vars);
    } catch {
      result += replaceVariables(match[0], vars);
    }
    cursor = start + match[0].length;
  }
  return result + replaceVariables(conditioned.slice(cursor), vars);
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
var import_path9, KNOWN_VARIABLES, DEFAULT_TEMPLATES;
var init_template_engine = __esm({
  "src/notifications/template-engine.ts"() {
    "use strict";
    init_formatter();
    import_path9 = require("path");
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
      "agent-call": "# Agent Spawned\n{{#if agentName}}\n**Agent:** `{{agentName}}`{{/if}}{{#if agentType}}\n**Type:** `{{agentType}}`{{/if}}\n\n{{footer}}",
      "approval-request": "# \u{1F514} Approval Required\n{{#if question}}\n{{question}}\n{{/if}}\nReply or run `omc graph approvals decide` to approve/deny.\n\n{{footer}}"
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
    const url = new URL(entry);
    const authority = entry.slice(entry.indexOf("://") + 3).split(/[\\/?#]/, 1)[0] ?? "";
    const hostPort = authority.slice(authority.lastIndexOf("@") + 1);
    const hasExplicitPort = /:\d+$/.test(hostPort);
    if (!url.port && !hasExplicitPort) return url.hostname.toLowerCase();
    const port = url.port || (url.protocol === "https:" ? "443" : "80");
    return `${url.hostname.toLowerCase()}:${port}`;
  } catch {
    return entry;
  }
}
function shouldBypassProxy(hostname, port) {
  const noProxy = firstEnvValue(["NO_PROXY", "no_proxy"]);
  if (!noProxy) return false;
  const host = hostname.toLowerCase();
  return noProxy.split(",").some((rawEntry) => {
    const entry = rawEntry.trim().toLowerCase();
    if (!entry) return false;
    if (entry === "*") return true;
    const normalizedEntry = normalizeNoProxyEntry(entry);
    const match = /^(.*?)(?::(\d+))?$/.exec(normalizedEntry);
    if (!match || match[2] && Number(match[2]) !== port) return false;
    const entryHost = match[1].startsWith(".") ? match[1].slice(1) : match[1];
    return host === entryHost || host.endsWith(`.${entryHost}`);
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
    const result = await new Promise((resolve9) => {
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
              resolve9({ platform: "telegram", success: true, messageId });
            } else {
              resolve9({
                platform: "telegram",
                success: false,
                error: `HTTP ${res.statusCode}`
              });
            }
          });
        }
      );
      req.on("error", (e) => {
        resolve9({ platform: "telegram", success: false, error: e.message });
      });
      req.on("timeout", () => {
        req.destroy();
        resolve9({
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
      new Promise((resolve9) => {
        timer = setTimeout(
          () => resolve9([
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
    const headers = {};
    for (const [key, value] of Object.entries(config.headers)) {
      headers[key] = interpolateTemplate(value, payload);
    }
    const contentType = Object.entries(headers).find(([key]) => key.toLowerCase() === "content-type")?.[1] ?? "";
    const isJsonBody = /^application\/(?:json|[^\s;]+\+json)(?:\s*;|$)/i.test(contentType.trim());
    const body = isJsonBody ? interpolateJsonTemplate(config.bodyTemplate, payload) : interpolateTemplate(config.bodyTemplate, payload);
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
var import_https, import_net, import_tls, import_child_process3, import_util5, SEND_TIMEOUT_MS, DISPATCH_TIMEOUT_MS, DISCORD_MAX_CONTENT_LENGTH, TELEGRAM_API_HOST, TELEGRAM_API_PORT, execFileAsync2;
var init_dispatcher = __esm({
  "src/notifications/dispatcher.ts"() {
    "use strict";
    import_https = require("https");
    import_net = require("net");
    import_tls = require("tls");
    init_config();
    import_child_process3 = require("child_process");
    import_util5 = require("util");
    init_template_engine();
    init_config();
    SEND_TIMEOUT_MS = 1e4;
    DISPATCH_TIMEOUT_MS = 15e3;
    DISCORD_MAX_CONTENT_LENGTH = 2e3;
    TELEGRAM_API_HOST = "api.telegram.org";
    TELEGRAM_API_PORT = 443;
    execFileAsync2 = (0, import_util5.promisify)(import_child_process3.execFile);
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
function isUnixLikeOnWindows() {
  if (process.platform !== "win32") return false;
  return Boolean(process.env.MSYSTEM?.trim() || process.env.MINGW_PREFIX?.trim());
}
function isNativeWindowsShell() {
  return process.platform === "win32" && !isUnixLikeOnWindows();
}
function quoteForCmd(arg) {
  assertSafeCmdValue(arg);
  if (arg.length === 0) return '""';
  if (!/[\s"%^&|<>()]/.test(arg)) return arg;
  return `"${arg.replace(/(["%])/g, "$1$1")}"`;
}
function assertSafeCmdValue(value) {
  if (/[\0\r\n]/.test(value)) {
    throw new Error("Native Windows tmux command values cannot contain NUL, CR, or LF characters");
  }
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
  return (0, import_child_process4.execFileSync)(invocation.command, invocation.args, { encoding: "utf-8", ...execOpts, env: resolveEnv(opts) });
}
async function tmuxExecAsync(args, opts) {
  const { stripTmux: _, timeout, ...rest } = opts ?? {};
  const invocation = resolveTmuxInvocation(args);
  return (0, import_util6.promisify)(import_child_process4.execFile)(invocation.command, invocation.args, {
    encoding: "utf-8",
    env: resolveEnv(opts),
    ...timeout !== void 0 ? { timeout } : {},
    ...rest
  });
}
function tmuxShell(command, opts) {
  const { stripTmux: _, ...execOpts } = opts ?? {};
  return (0, import_child_process4.execSync)(`tmux ${command}`, { encoding: "utf-8", ...execOpts, env: resolveEnv(opts) });
}
async function tmuxShellAsync(command, opts) {
  const { stripTmux: _, timeout, ...rest } = opts ?? {};
  return (0, import_util6.promisify)(import_child_process4.exec)(`tmux ${command}`, {
    encoding: "utf-8",
    env: resolveEnv(opts),
    ...timeout !== void 0 ? { timeout } : {},
    ...rest
  });
}
function tmuxSpawn(args, opts) {
  const { stripTmux: _, ...spawnOpts } = opts ?? {};
  const invocation = resolveTmuxInvocation(args);
  return (0, import_child_process4.spawnSync)(invocation.command, invocation.args, { encoding: "utf-8", ...spawnOpts, env: resolveEnv(opts) });
}
async function tmuxCmdAsync(args, opts) {
  if (args.some((a) => a.includes("#{")) && !isNativeWindowsShell()) {
    const escaped = args.map((a) => "'" + a.replace(/'/g, "'\\''") + "'").join(" ");
    return tmuxShellAsync(escaped, opts);
  }
  return tmuxExecAsync(args, opts);
}
function resolveTmuxBinaryPath() {
  if (process.platform !== "win32") {
    return "tmux";
  }
  try {
    const result = (0, import_child_process4.spawnSync)("where", ["tmux"], {
      timeout: 5e3,
      encoding: "utf8"
    });
    if (result.status !== 0) return "tmux";
    const candidates = result.stdout?.split(/\r?\n/).map((line) => line.trim()).filter(Boolean) ?? [];
    const first = candidates[0];
    if (first && ((0, import_path10.isAbsolute)(first) || import_path10.win32.isAbsolute(first))) {
      return first;
    }
  } catch {
  }
  return "tmux";
}
var import_child_process4, import_path10, import_util6;
var init_tmux_utils = __esm({
  "src/cli/tmux-utils.ts"() {
    "use strict";
    import_child_process4 = require("child_process");
    import_path10 = require("path");
    import_util6 = require("util");
  }
});

// src/shared/types.ts
var CANONICAL_TEAM_ROLES, KNOWN_AGENT_NAMES;
var init_types = __esm({
  "src/shared/types.ts"() {
    "use strict";
    CANONICAL_TEAM_ROLES = [
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
    KNOWN_AGENT_NAMES = [
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
  }
});

// src/utils/semver-compare.ts
var init_semver_compare = __esm({
  "src/utils/semver-compare.ts"() {
    "use strict";
  }
});

// src/utils/cache-occupancy.ts
var init_cache_occupancy = __esm({
  "src/utils/cache-occupancy.ts"() {
    "use strict";
    init_config_dir();
  }
});

// src/utils/plugin-cache-validation.ts
var import_path11, PLUGIN_ROOT_REQUIREMENTS;
var init_plugin_cache_validation = __esm({
  "src/utils/plugin-cache-validation.ts"() {
    "use strict";
    import_path11 = require("path");
    PLUGIN_ROOT_REQUIREMENTS = [(0, import_path11.join)("hooks", "hooks.json"), (0, import_path11.join)("scripts", "run.cjs"), "scripts"];
  }
});

// src/utils/paths.ts
function getConfigDir() {
  if (process.platform === "win32") {
    return process.env.APPDATA || (0, import_path12.join)((0, import_os3.homedir)(), "AppData", "Roaming");
  }
  return process.env.XDG_CONFIG_HOME || (0, import_path12.join)((0, import_os3.homedir)(), ".config");
}
function getStateDir() {
  if (process.platform === "win32") {
    return process.env.LOCALAPPDATA || (0, import_path12.join)((0, import_os3.homedir)(), "AppData", "Local");
  }
  return process.env.XDG_STATE_HOME || (0, import_path12.join)((0, import_os3.homedir)(), ".local", "state");
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
  return (0, import_path12.join)(getUserHomeDir(), ".omc");
}
function getGlobalOmcStateRoot() {
  const explicitRoot = process.env.OMC_HOME?.trim();
  if (explicitRoot) {
    return (0, import_path12.join)(explicitRoot, "state");
  }
  if (prefersXdgOmcDirs()) {
    return (0, import_path12.join)(getStateDir(), "omc");
  }
  return (0, import_path12.join)(getLegacyOmcDir(), "state");
}
function getGlobalOmcStatePath(...segments) {
  return (0, import_path12.join)(getGlobalOmcStateRoot(), ...segments);
}
function getLegacyOmcPath(...segments) {
  return (0, import_path12.join)(getLegacyOmcDir(), ...segments);
}
function dedupePaths(paths) {
  return [...new Set(paths)];
}
function getGlobalOmcStateCandidates(...segments) {
  const explicitRoot = process.env.OMC_HOME?.trim();
  if (explicitRoot) {
    return dedupePaths([
      getGlobalOmcStatePath(...segments),
      (0, import_path12.join)(explicitRoot, ...segments)
    ]);
  }
  return dedupePaths([
    getGlobalOmcStatePath(...segments),
    getLegacyOmcPath("state", ...segments)
  ]);
}
var import_path12, import_os3, OCCUPIED_CODES, STALE_THRESHOLD_MS;
var init_paths = __esm({
  "src/utils/paths.ts"() {
    "use strict";
    import_path12 = require("path");
    import_os3 = require("os");
    init_config_dir();
    init_semver_compare();
    init_cache_occupancy();
    init_plugin_cache_validation();
    OCCUPIED_CODES = new Set(
      process.platform === "win32" ? ["EEXIST", "ENOTEMPTY", "ENOTDIR", "EISDIR", "EPERM", "EACCES"] : ["EEXIST", "ENOTEMPTY", "ENOTDIR", "EISDIR"]
    );
    STALE_THRESHOLD_MS = 10 * 60 * 1e3;
  }
});

// src/utils/ssrf-guard.ts
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
  const hostname = parsed.hostname.toLowerCase();
  for (const pattern of BLOCKED_HOST_PATTERNS) {
    if (pattern.test(hostname)) {
      return {
        allowed: false,
        reason: `Hostname '${hostname}' resolves to a blocked internal/private address`
      };
    }
  }
  if (/^0x[0-9a-f]+$/i.test(hostname)) {
    return {
      allowed: false,
      reason: `Hostname '${hostname}' looks like a hex-encoded IP address`
    };
  }
  if (/^\d+$/.test(hostname) && hostname.length > 3) {
    return {
      allowed: false,
      reason: `Hostname '${hostname}' looks like a decimal-encoded IP address`
    };
  }
  if (/^0\d+\./.test(hostname)) {
    return {
      allowed: false,
      reason: `Hostname '${hostname}' looks like an octal-encoded IP address`
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
var BLOCKED_HOST_PATTERNS, ALLOWED_SCHEMES;
var init_ssrf_guard = __esm({
  "src/utils/ssrf-guard.ts"() {
    "use strict";
    BLOCKED_HOST_PATTERNS = [
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
      /^\[?f[cd][0-9a-f]{2}:/i,
      // IPv6 unique local FC00::/7 (RFC 4193)
      /^\[?fe[89ab][0-9a-f]:/i,
      // IPv6 link-local FE80::/10 (RFC 4291)
      /^\[?::\]?$/,
      // IPv6 unspecified
      /^\[?ff[0-9a-f]{2}:/i,
      // IPv6 multicast FF00::/8
      /^\[?::ffff:/i,
      // IPv6-mapped IPv4 (all private ranges accessible via this prefix)
      /^\[?0{0,4}:{0,2}ffff:/i
      // IPv6-mapped IPv4 expanded forms
    ];
    ALLOWED_SCHEMES = ["https:", "http:"];
  }
});

// src/config/models.ts
function nonEmpty(value) {
  const trimmed = value?.trim();
  return trimmed || void 0;
}
function resolveCopilotModel(configured, env = process.env) {
  return nonEmpty(env.OMC_EXTERNAL_MODELS_DEFAULT_COPILOT_MODEL) ?? nonEmpty(env.OMC_COPILOT_DEFAULT_MODEL) ?? nonEmpty(configured) ?? BUILTIN_EXTERNAL_MODEL_DEFAULTS.copilotModel;
}
function resolveCopilotReasoningEffort(configured, env = process.env) {
  const raw = nonEmpty(env.OMC_COPILOT_REASONING_EFFORT) ?? nonEmpty(configured) ?? BUILTIN_EXTERNAL_MODEL_DEFAULTS.copilotReasoningEffort;
  return validateCopilotReasoningEffort(raw);
}
function validateCopilotReasoningEffort(raw) {
  const normalized = raw.toLowerCase();
  if (!COPILOT_REASONING_EFFORTS2.includes(normalized)) {
    throw new Error(
      `[OMC] Copilot reasoning effort: invalid value "${raw}". Allowed: ${COPILOT_REASONING_EFFORTS2.join(", ")}`
    );
  }
  return normalized;
}
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
function getDirectModelEnvValue() {
  for (const key of DIRECT_MODEL_ENV_KEYS) {
    const value = readEnvValue(key);
    if (value) {
      return value;
    }
  }
  return void 0;
}
function getDirectProviderDetectionModelEnvValues() {
  const directModel = getDirectModelEnvValue();
  return directModel ? [directModel] : [];
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
function hasBedrockModelId(modelIds) {
  for (const modelId of modelIds) {
    if (/^((us|eu|ap|global)\.anthropic\.|anthropic\.claude)/i.test(modelId)) {
      return true;
    }
    if (/^arn:aws(-[^:]+)?:bedrock:/i.test(modelId) && /:(inference-profile|application-inference-profile)\//i.test(modelId) && modelId.toLowerCase().includes("claude")) {
      return true;
    }
  }
  return false;
}
function hasVertexModelId(modelIds) {
  return modelIds.some((modelId) => modelId.toLowerCase().startsWith("vertex_ai/"));
}
function hasNonClaudeModelId(modelIds) {
  for (const modelId of modelIds) {
    const lower = modelId.toLowerCase();
    if (!lower.includes("claude") && !CLAUDE_TIER_ALIASES.has(lower)) {
      return true;
    }
  }
  return false;
}
function shouldAutoForceInherit() {
  if (process.env.OMC_ROUTING_FORCE_INHERIT === "true") {
    return true;
  }
  if (process.env.CLAUDE_CODE_USE_BEDROCK === "1") {
    return true;
  }
  if (process.env.CLAUDE_CODE_USE_VERTEX === "1") {
    return true;
  }
  const directModelValues = getDirectProviderDetectionModelEnvValues();
  if (hasBedrockModelId(directModelValues) || hasVertexModelId(directModelValues) || hasNonClaudeModelId(directModelValues)) {
    return true;
  }
  const baseUrl = process.env.ANTHROPIC_BASE_URL || "";
  if (baseUrl) {
    const validation = validateAnthropicBaseUrl(baseUrl);
    if (!validation.allowed) {
      console.error(`[SSRF Guard] Rejecting ANTHROPIC_BASE_URL: ${validation.reason}`);
      return true;
    }
    if (!baseUrl.includes("anthropic.com")) {
      return true;
    }
  }
  return false;
}
var DIRECT_MODEL_ENV_KEYS, CLAUDE_TIER_ALIASES, TIER_ENV_KEYS, CLAUDE_FAMILY_DEFAULTS, BUILTIN_TIER_MODEL_DEFAULTS, CLAUDE_FAMILY_HIGH_VARIANTS, BUILTIN_EXTERNAL_MODEL_DEFAULTS, COPILOT_REASONING_EFFORTS2;
var init_models = __esm({
  "src/config/models.ts"() {
    "use strict";
    init_ssrf_guard();
    DIRECT_MODEL_ENV_KEYS = ["CLAUDE_MODEL", "ANTHROPIC_MODEL"];
    CLAUDE_TIER_ALIASES = /* @__PURE__ */ new Set(["sonnet", "opus", "haiku", "fable"]);
    TIER_ENV_KEYS = {
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
    CLAUDE_FAMILY_DEFAULTS = {
      HAIKU: "claude-haiku-4-5",
      SONNET: "claude-sonnet-5",
      OPUS: "claude-opus-4-8",
      FABLE: "claude-fable-5"
    };
    BUILTIN_TIER_MODEL_DEFAULTS = {
      LOW: CLAUDE_FAMILY_DEFAULTS.HAIKU,
      MEDIUM: CLAUDE_FAMILY_DEFAULTS.SONNET,
      HIGH: CLAUDE_FAMILY_DEFAULTS.OPUS
    };
    CLAUDE_FAMILY_HIGH_VARIANTS = {
      HAIKU: `${CLAUDE_FAMILY_DEFAULTS.HAIKU}-high`,
      SONNET: `${CLAUDE_FAMILY_DEFAULTS.SONNET}-high`,
      OPUS: `${CLAUDE_FAMILY_DEFAULTS.OPUS}-high`,
      FABLE: `${CLAUDE_FAMILY_DEFAULTS.FABLE}-high`
    };
    BUILTIN_EXTERNAL_MODEL_DEFAULTS = {
      codexModel: "gpt-5.3-codex",
      geminiModel: "gemini-3.1-pro-preview",
      antigravityModel: "Gemini 3.1 Pro (High)",
      copilotModel: "gpt-5.6-sol",
      copilotReasoningEffort: "max"
    };
    COPILOT_REASONING_EFFORTS2 = [
      "none",
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
      "max"
    ];
  }
});

// src/features/delegation-routing/types.ts
function normalizeDelegationRole(role) {
  return DEPRECATED_ROLE_ALIASES2[role] ?? role;
}
var DEPRECATED_ROLE_ALIASES2;
var init_types2 = __esm({
  "src/features/delegation-routing/types.ts"() {
    "use strict";
    DEPRECATED_ROLE_ALIASES2 = {
      researcher: "document-specialist",
      "tdd-guide": "test-engineer",
      "api-reviewer": "code-reviewer",
      "performance-reviewer": "code-reviewer",
      "dependency-expert": "document-specialist",
      "quality-strategist": "code-reviewer",
      vision: "document-specialist",
      // Consolidated agent aliases (agent consolidation PR)
      "quality-reviewer": "code-reviewer",
      "deep-executor": "executor",
      "build-fixer": "debugger",
      "harsh-critic": "critic",
      // User-friendly short alias for /team role routing (plan AC-4)
      reviewer: "code-reviewer"
    };
  }
});

// src/features/delegation-routing/resolver.ts
function isDeprecatedMcpProvider(provider) {
  return provider ? DEPRECATED_MCP_PROVIDERS.has(provider) : false;
}
var DEPRECATED_MCP_PROVIDERS;
var init_resolver = __esm({
  "src/features/delegation-routing/resolver.ts"() {
    "use strict";
    init_types2();
    DEPRECATED_MCP_PROVIDERS = /* @__PURE__ */ new Set([
      "codex",
      "gemini"
    ]);
  }
});

// src/features/delegation-routing/index.ts
var init_delegation_routing = __esm({
  "src/features/delegation-routing/index.ts"() {
    "use strict";
    init_resolver();
    init_types2();
  }
});

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
      executionKeywords: ["ralph", "autopilot"]
    }
  };
}
function getConfigPaths() {
  const userConfigDir = getConfigDir();
  return {
    user: (0, import_path13.join)(userConfigDir, "claude-omc", "config.jsonc"),
    project: (0, import_path13.join)(process.cwd(), ".claude", "omc.jsonc")
  };
}
function loadJsoncFile(path3) {
  if (!(0, import_fs8.existsSync)(path3)) {
    return null;
  }
  try {
    const content = (0, import_fs8.readFileSync)(path3, "utf-8");
    const result = parseJsonc(content);
    return result;
  } catch (error) {
    console.error(`Error loading config from ${path3}:`, error);
    return null;
  }
}
function deepMerge(target, source) {
  const result = { ...target };
  const mutableResult = result;
  for (const key of Object.keys(source)) {
    if (key === "__proto__" || key === "constructor" || key === "prototype")
      continue;
    const sourceValue = source[key];
    const targetValue = mutableResult[key];
    if (sourceValue !== void 0 && typeof sourceValue === "object" && sourceValue !== null && !Array.isArray(sourceValue) && typeof targetValue === "object" && targetValue !== null && !Array.isArray(targetValue)) {
      mutableResult[key] = deepMerge(
        targetValue,
        sourceValue
      );
    } else if (sourceValue !== void 0) {
      mutableResult[key] = sourceValue;
    }
  }
  return result;
}
function parseBackgroundTaskLimit(value) {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed <= MAX_BACKGROUND_TASKS ? parsed : null;
}
function loadEnvConfig() {
  const config = {};
  if (process.env.EXA_API_KEY) {
    config.mcpServers = {
      ...config.mcpServers,
      exa: { enabled: true, apiKey: process.env.EXA_API_KEY }
    };
  }
  if (process.env.OMC_PARALLEL_EXECUTION !== void 0) {
    config.features = {
      ...config.features,
      parallelExecution: process.env.OMC_PARALLEL_EXECUTION === "true"
    };
  }
  if (process.env.OMC_LSP_TOOLS !== void 0) {
    config.features = {
      ...config.features,
      lspTools: process.env.OMC_LSP_TOOLS === "true"
    };
  }
  const maxBackgroundTasks = parseBackgroundTaskLimit(
    process.env.OMC_MAX_BACKGROUND_TASKS
  );
  if (maxBackgroundTasks !== null) {
    config.permissions = {
      ...config.permissions,
      maxBackgroundTasks
    };
  }
  if (process.env.OMC_ROUTING_ENABLED !== void 0) {
    config.routing = {
      ...config.routing,
      enabled: process.env.OMC_ROUTING_ENABLED === "true"
    };
  }
  if (process.env.OMC_ROUTING_FORCE_INHERIT !== void 0) {
    config.routing = {
      ...config.routing,
      forceInherit: process.env.OMC_ROUTING_FORCE_INHERIT === "true"
    };
  }
  if (process.env.OMC_ROUTING_DEFAULT_TIER) {
    const tier = process.env.OMC_ROUTING_DEFAULT_TIER.toUpperCase();
    if (tier === "LOW" || tier === "MEDIUM" || tier === "HIGH") {
      config.routing = {
        ...config.routing,
        defaultTier: tier
      };
    }
  }
  const aliasKeys = ["HAIKU", "SONNET", "OPUS", "FABLE"];
  const modelAliases = {};
  for (const key of aliasKeys) {
    const envVal = process.env[`OMC_MODEL_ALIAS_${key}`];
    if (envVal) {
      const lower = key.toLowerCase();
      modelAliases[lower] = envVal.toLowerCase();
    }
  }
  if (Object.keys(modelAliases).length > 0) {
    config.routing = {
      ...config.routing,
      modelAliases
    };
  }
  if (process.env.OMC_ESCALATION_ENABLED !== void 0) {
    config.routing = {
      ...config.routing,
      escalationEnabled: process.env.OMC_ESCALATION_ENABLED === "true"
    };
  }
  const externalModelsDefaults = {};
  if (process.env.OMC_EXTERNAL_MODELS_DEFAULT_PROVIDER) {
    const provider = process.env.OMC_EXTERNAL_MODELS_DEFAULT_PROVIDER;
    if (provider === "codex" || provider === "gemini" || provider === "antigravity" || provider === "copilot") {
      externalModelsDefaults.provider = provider;
    }
  }
  if (process.env.OMC_EXTERNAL_MODELS_DEFAULT_CODEX_MODEL) {
    externalModelsDefaults.codexModel = process.env.OMC_EXTERNAL_MODELS_DEFAULT_CODEX_MODEL;
  } else if (process.env.OMC_CODEX_DEFAULT_MODEL) {
    externalModelsDefaults.codexModel = process.env.OMC_CODEX_DEFAULT_MODEL;
  }
  if (process.env.OMC_EXTERNAL_MODELS_DEFAULT_GEMINI_MODEL) {
    externalModelsDefaults.geminiModel = process.env.OMC_EXTERNAL_MODELS_DEFAULT_GEMINI_MODEL;
  } else if (process.env.OMC_GEMINI_DEFAULT_MODEL) {
    externalModelsDefaults.geminiModel = process.env.OMC_GEMINI_DEFAULT_MODEL;
  }
  if (process.env.OMC_EXTERNAL_MODELS_DEFAULT_GROK_MODEL) {
    externalModelsDefaults.grokModel = process.env.OMC_EXTERNAL_MODELS_DEFAULT_GROK_MODEL;
  } else if (process.env.OMC_GROK_DEFAULT_MODEL) {
    externalModelsDefaults.grokModel = process.env.OMC_GROK_DEFAULT_MODEL;
  }
  if (process.env.OMC_EXTERNAL_MODELS_DEFAULT_CURSOR_MODEL) {
    externalModelsDefaults.cursorModel = process.env.OMC_EXTERNAL_MODELS_DEFAULT_CURSOR_MODEL;
  } else if (process.env.OMC_CURSOR_DEFAULT_MODEL) {
    externalModelsDefaults.cursorModel = process.env.OMC_CURSOR_DEFAULT_MODEL;
  }
  if (process.env.OMC_EXTERNAL_MODELS_DEFAULT_ANTIGRAVITY_MODEL) {
    externalModelsDefaults.antigravityModel = process.env.OMC_EXTERNAL_MODELS_DEFAULT_ANTIGRAVITY_MODEL;
  } else if (process.env.OMC_ANTIGRAVITY_DEFAULT_MODEL) {
    externalModelsDefaults.antigravityModel = process.env.OMC_ANTIGRAVITY_DEFAULT_MODEL;
  }
  if (process.env.OMC_EXTERNAL_MODELS_DEFAULT_COPILOT_MODEL || process.env.OMC_COPILOT_DEFAULT_MODEL) {
    externalModelsDefaults.copilotModel = resolveCopilotModel();
  }
  if (process.env.OMC_COPILOT_REASONING_EFFORT) {
    externalModelsDefaults.copilotReasoningEffort = resolveCopilotReasoningEffort();
  }
  const externalModelsFallback = {
    onModelFailure: "provider_chain"
  };
  if (process.env.OMC_EXTERNAL_MODELS_FALLBACK_POLICY) {
    const policy = process.env.OMC_EXTERNAL_MODELS_FALLBACK_POLICY;
    if (policy === "provider_chain" || policy === "cross_provider" || policy === "claude_only") {
      externalModelsFallback.onModelFailure = policy;
    }
  }
  if (Object.keys(externalModelsDefaults).length > 0 || externalModelsFallback.onModelFailure !== "provider_chain") {
    config.externalModels = {
      defaults: externalModelsDefaults,
      fallbackPolicy: externalModelsFallback
    };
  }
  if (process.env.OMC_DELEGATION_ROUTING_ENABLED !== void 0) {
    config.delegationRouting = {
      ...config.delegationRouting,
      enabled: process.env.OMC_DELEGATION_ROUTING_ENABLED === "true"
    };
  }
  if (process.env.OMC_DELEGATION_ROUTING_DEFAULT_PROVIDER) {
    const provider = process.env.OMC_DELEGATION_ROUTING_DEFAULT_PROVIDER;
    if (["claude", "codex", "gemini"].includes(provider)) {
      config.delegationRouting = {
        ...config.delegationRouting,
        defaultProvider: provider
      };
    }
  }
  const teamRoleOverrides = parseTeamRoleOverridesFromEnv();
  if (teamRoleOverrides) {
    config.team = {
      ...config.team,
      roleRouting: {
        ...config.team?.roleRouting,
        ...teamRoleOverrides
      }
    };
  }
  return config;
}
function warnOnDeprecatedDelegationRouting(config) {
  const deprecatedProviders = /* @__PURE__ */ new Set();
  const defaultProvider = config.delegationRouting?.defaultProvider;
  if (isDeprecatedMcpProvider(defaultProvider)) {
    deprecatedProviders.add(defaultProvider);
  }
  const roles = config.delegationRouting?.roles ?? {};
  for (const route of Object.values(roles)) {
    const provider = route?.provider;
    if (isDeprecatedMcpProvider(provider)) {
      deprecatedProviders.add(provider);
    }
  }
  if (deprecatedProviders.size === 0) {
    return;
  }
  console.warn(
    "[OMC] delegationRouting to Codex/Gemini is deprecated and falls back to Claude Task. Use /team for Codex/Gemini CLI workers instead."
  );
}
function validateTeamConfig(config) {
  const team = config.team;
  if (!team || typeof team !== "object") return;
  const ops = team.ops;
  if (ops && typeof ops === "object") {
    if (ops.defaultAgentType !== void 0) {
      if (typeof ops.defaultAgentType !== "string" || !TEAM_ROLE_PROVIDERS.has(ops.defaultAgentType)) {
        throw new Error(
          `[OMC] team.ops.defaultAgentType: invalid value "${String(ops.defaultAgentType)}". Allowed: ${[...TEAM_ROLE_PROVIDERS].join(", ")}`
        );
      }
    }
    if (ops.worktreeMode !== void 0) {
      const allowed = /* @__PURE__ */ new Set(["disabled", "off", "detached", "branch", "named"]);
      if (typeof ops.worktreeMode !== "string" || !allowed.has(ops.worktreeMode)) {
        throw new Error(
          `[OMC] team.ops.worktreeMode: invalid value "${String(ops.worktreeMode)}". Allowed: ${[...allowed].join(", ")}`
        );
      }
    }
    if (ops.multiplexer !== void 0) {
      const allowed = /* @__PURE__ */ new Set(["tmux", "herdr"]);
      if (typeof ops.multiplexer !== "string" || !allowed.has(ops.multiplexer)) {
        throw new Error(
          `[OMC] team.ops.multiplexer: invalid value "${String(ops.multiplexer)}". Allowed: tmux, herdr`
        );
      }
    }
  }
  const roleRouting = team.roleRouting;
  if (!roleRouting || typeof roleRouting !== "object") return;
  for (const [rawRoleKey, rawSpec] of Object.entries(roleRouting)) {
    const normalized = normalizeDelegationRole(rawRoleKey);
    if (!CANONICAL_TEAM_ROLE_SET.has(normalized)) {
      throw new Error(
        `[OMC] team.roleRouting: unknown role "${rawRoleKey}". Allowed roles: ${[...CANONICAL_TEAM_ROLE_SET].join(", ")}`
      );
    }
    if (!rawSpec || typeof rawSpec !== "object" || Array.isArray(rawSpec)) {
      throw new Error(
        `[OMC] team.roleRouting.${rawRoleKey}: must be an object, got ${Array.isArray(rawSpec) ? "array" : typeof rawSpec}`
      );
    }
    const spec = rawSpec;
    if (normalized === "orchestrator") {
      for (const key of Object.keys(spec)) {
        if (key !== "model") {
          throw new Error(
            `[OMC] team.roleRouting.orchestrator: key "${key}" is not allowed (orchestrator is pinned to claude; only "model" is configurable)`
          );
        }
      }
      if (spec.model !== void 0 && !isValidModelValue(spec.model)) {
        throw new Error(
          `[OMC] team.roleRouting.orchestrator.model: must be a tier name (HIGH|MEDIUM|LOW) or model ID string, got ${typeof spec.model}`
        );
      }
      continue;
    }
    const provider = spec.provider ?? "claude";
    if (spec.provider !== void 0) {
      if (typeof spec.provider !== "string" || !TEAM_ROLE_PROVIDERS.has(spec.provider)) {
        throw new Error(
          `[OMC] team.roleRouting.${rawRoleKey}.provider: invalid value "${String(spec.provider)}". Allowed: ${[...TEAM_ROLE_PROVIDERS].join(", ")}`
        );
      }
    }
    if (spec.model !== void 0 && !isValidModelValue(spec.model)) {
      throw new Error(
        `[OMC] team.roleRouting.${rawRoleKey}.model: must be a tier name (HIGH|MEDIUM|LOW) or a non-empty model ID string`
      );
    }
    if (spec.agent !== void 0) {
      if (typeof spec.agent !== "string" || !KNOWN_AGENT_NAME_SET.has(spec.agent)) {
        throw new Error(
          `[OMC] team.roleRouting.${rawRoleKey}.agent: unknown agent "${String(spec.agent)}". Allowed: ${[...KNOWN_AGENT_NAME_SET].join(", ")}`
        );
      }
    }
    if (spec.reasoningEffort !== void 0) {
      if (typeof spec.reasoningEffort !== "string") {
        throw new Error(
          `[OMC] team.roleRouting.${rawRoleKey}.reasoningEffort: must be a string, got ${typeof spec.reasoningEffort}`
        );
      }
      const allowedForProvider = REASONING_EFFORT_BY_PROVIDER[provider];
      if (!allowedForProvider || !allowedForProvider.has(spec.reasoningEffort)) {
        const allowed = allowedForProvider ? [...allowedForProvider].join("|") : "(not supported for this provider)";
        throw new Error(
          `[OMC] team.roleRouting.${rawRoleKey}.reasoningEffort: invalid value "${spec.reasoningEffort}" for provider "${provider}". Allowed: ${allowed}`
        );
      }
    }
  }
}
function isAutopilotWorkflowSequence(stages) {
  return AUTOPILOT_WORKFLOW_SEQUENCES.some(
    (sequence) => stages.length === sequence.length && stages.every((stage, index) => typeof stage === "string" && stage === sequence[index])
  );
}
function workflowError(source, path3, message) {
  throw new Error(`[OMC] ${source} ${path3}: ${message}`);
}
function validateAutopilotWorkflows(config, source) {
  if (!config || typeof config !== "object" || Array.isArray(config)) return;
  const autopilot = config.autopilot;
  if (autopilot === void 0) return;
  if (!autopilot || typeof autopilot !== "object" || Array.isArray(autopilot)) return;
  const workflows = autopilot.workflows;
  if (workflows === void 0) return;
  if (!workflows || typeof workflows !== "object" || Array.isArray(workflows)) {
    workflowError(source, "autopilot.workflows", "must be an object map");
  }
  for (const [name, profile] of Object.entries(workflows)) {
    const path3 = `autopilot.workflows.${name}`;
    if (!AUTOPILOT_WORKFLOW_NAME.test(name)) {
      workflowError(source, path3, "name must match ^[a-z][a-z0-9-]{0,62}$");
    }
    if (AUTOPILOT_WORKFLOW_RESERVED_NAMES.has(name)) {
      workflowError(source, path3, `name "${name}" is reserved`);
    }
    if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
      workflowError(source, path3, "must be an object");
    }
    const profileRecord = profile;
    for (const key of Object.keys(profileRecord)) {
      if (key !== "version" && key !== "stages") {
        workflowError(source, `${path3}.${key}`, "unknown profile key");
      }
    }
    if (profileRecord.version !== 1) {
      workflowError(source, `${path3}.version`, "must be the number 1");
    }
    if (!Array.isArray(profileRecord.stages)) {
      workflowError(source, `${path3}.stages`, "must be an array");
    }
    if (!isAutopilotWorkflowSequence(profileRecord.stages)) {
      workflowError(
        source,
        `${path3}.stages`,
        "must be one of: [ralplan, execution], [ralplan, execution, ralph], [ralplan, execution, qa], [ralplan, execution, ralph, qa]"
      );
    }
  }
}
function composeAutopilotWorkflows(config, userConfig, projectConfig) {
  const userWorkflows = userConfig?.autopilot?.workflows;
  const projectWorkflows = projectConfig?.autopilot?.workflows;
  if (userWorkflows === void 0 && projectWorkflows === void 0) return config;
  return {
    ...config,
    autopilot: {
      ...config.autopilot,
      workflows: {
        ...userWorkflows,
        ...projectWorkflows
      }
    }
  };
}
function validateAutopilotConfig(config) {
  const autopilot = config.autopilot;
  if (!autopilot || typeof autopilot !== "object") return;
  validateAutopilotWorkflows(config, "effective");
  if (autopilot.execution !== void 0 && (typeof autopilot.execution !== "string" || !AUTOPILOT_EXECUTION_BACKENDS.has(autopilot.execution))) {
    throw new Error(
      `[OMC] autopilot.execution: invalid value "${String(autopilot.execution)}". Allowed: ${[...AUTOPILOT_EXECUTION_BACKENDS].join(", ")}`
    );
  }
  if (autopilot.planning !== void 0 && autopilot.planning !== false && (typeof autopilot.planning !== "string" || !AUTOPILOT_PLANNING_MODES.has(autopilot.planning))) {
    throw new Error(
      `[OMC] autopilot.planning: invalid value "${String(autopilot.planning)}". Allowed: ralplan, direct, false`
    );
  }
  const team = autopilot.team;
  if (!team || typeof team !== "object") return;
  if (team.agentTypes !== void 0) {
    if (!Array.isArray(team.agentTypes)) {
      throw new Error("[OMC] autopilot.team.agentTypes: must be an array");
    }
    for (const agentType of team.agentTypes) {
      if (typeof agentType !== "string" || !AUTOPILOT_TEAM_AGENT_TYPES.has(agentType)) {
        throw new Error(
          `[OMC] autopilot.team.agentTypes: invalid value "${String(agentType)}". Allowed: ${[...AUTOPILOT_TEAM_AGENT_TYPES].join(", ")}`
        );
      }
    }
  }
}
function isValidModelValue(value) {
  if (typeof value !== "string") return false;
  if (value.length === 0) return false;
  return TEAM_ROLE_TIERS.has(value) || value.length > 0;
}
function parseTeamRoleOverridesFromEnv() {
  const raw = process.env.OMC_TEAM_ROLE_OVERRIDES;
  if (!raw) return void 0;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      console.warn(
        "[OMC] OMC_TEAM_ROLE_OVERRIDES: expected a JSON object; ignoring."
      );
      return void 0;
    }
    return parsed;
  } catch (err) {
    console.warn(
      `[OMC] OMC_TEAM_ROLE_OVERRIDES: invalid JSON, ignoring (${err.message})`
    );
    return void 0;
  }
}
function loadConfig() {
  const paths = getConfigPaths();
  let config = buildDefaultConfig();
  const userConfig = loadJsoncFile(paths.user);
  if (userConfig) {
    validateAutopilotWorkflows(userConfig, "user");
    config = deepMerge(config, userConfig);
  }
  const projectConfig = loadJsoncFile(paths.project);
  if (projectConfig) {
    validateAutopilotWorkflows(projectConfig, "project");
    config = deepMerge(config, projectConfig);
  }
  config = composeAutopilotWorkflows(config, userConfig, projectConfig);
  const envConfig = loadEnvConfig();
  config = deepMerge(config, envConfig);
  const externalDefaults = config.externalModels?.defaults;
  if (externalDefaults) {
    externalDefaults.copilotModel = resolveCopilotModel(externalDefaults.copilotModel);
    externalDefaults.copilotReasoningEffort = resolveCopilotReasoningEffort(
      externalDefaults.copilotReasoningEffort
    );
  }
  if (config.routing?.forceInherit !== true && process.env.OMC_ROUTING_FORCE_INHERIT === void 0 && shouldAutoForceInherit()) {
    config.routing = {
      ...config.routing,
      forceInherit: true
    };
  }
  warnOnDeprecatedDelegationRouting(config);
  validateTeamConfig(config);
  validateAutopilotConfig(config);
  return config;
}
var import_fs8, import_path13, DEFAULT_CONFIG, MAX_BACKGROUND_TASKS, CANONICAL_TEAM_ROLE_SET, KNOWN_AGENT_NAME_SET, TEAM_ROLE_PROVIDERS, TEAM_ROLE_TIERS, REASONING_EFFORT_BY_PROVIDER, AUTOPILOT_EXECUTION_BACKENDS, AUTOPILOT_PLANNING_MODES, AUTOPILOT_TEAM_AGENT_TYPES, AUTOPILOT_WORKFLOW_NAME, AUTOPILOT_WORKFLOW_RESERVED_NAMES, AUTOPILOT_WORKFLOW_SEQUENCES;
var init_loader = __esm({
  "src/config/loader.ts"() {
    "use strict";
    import_fs8 = require("fs");
    import_path13 = require("path");
    init_types();
    init_paths();
    init_jsonc();
    init_models();
    init_types2();
    init_delegation_routing();
    DEFAULT_CONFIG = buildDefaultConfig();
    MAX_BACKGROUND_TASKS = 50;
    CANONICAL_TEAM_ROLE_SET = new Set(CANONICAL_TEAM_ROLES);
    KNOWN_AGENT_NAME_SET = new Set(KNOWN_AGENT_NAMES);
    TEAM_ROLE_PROVIDERS = /* @__PURE__ */ new Set(["claude", "codex", "gemini", "grok", "cursor", "antigravity", "copilot"]);
    TEAM_ROLE_TIERS = /* @__PURE__ */ new Set(["HIGH", "MEDIUM", "LOW"]);
    REASONING_EFFORT_BY_PROVIDER = {
      claude: /* @__PURE__ */ new Set(["low", "medium", "high", "xhigh", "max"]),
      codex: /* @__PURE__ */ new Set(["low", "medium", "high", "xhigh", "max", "ultra"]),
      antigravity: /* @__PURE__ */ new Set(["low", "medium", "high", "max"])
    };
    AUTOPILOT_EXECUTION_BACKENDS = /* @__PURE__ */ new Set(["team", "solo"]);
    AUTOPILOT_PLANNING_MODES = /* @__PURE__ */ new Set(["ralplan", "direct"]);
    AUTOPILOT_TEAM_AGENT_TYPES = /* @__PURE__ */ new Set([
      "claude",
      "codex",
      "gemini",
      "grok",
      "cursor",
      "antigravity",
      "copilot"
    ]);
    AUTOPILOT_WORKFLOW_NAME = /^[a-z][a-z0-9-]{0,62}$/;
    AUTOPILOT_WORKFLOW_RESERVED_NAMES = /* @__PURE__ */ new Set([
      "autopilot",
      "ralplan",
      "execution",
      "ralph",
      "qa",
      "autoresearch",
      "ultraqa",
      "self-improve",
      "ultrawork",
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
      "ultragoal",
      "default"
    ]);
    AUTOPILOT_WORKFLOW_SEQUENCES = [
      ["ralplan", "execution"],
      ["ralplan", "execution", "ralph"],
      ["ralplan", "execution", "qa"],
      ["ralplan", "execution", "ralph", "qa"]
    ];
  }
});

// src/team/team-name.ts
function validateTeamName(teamName) {
  if (!TEAM_NAME_PATTERN.test(teamName)) {
    throw new Error(
      `Invalid team name: "${teamName}". Team name must match /^[a-z0-9][a-z0-9-]{0,48}[a-z0-9]$/.`
    );
  }
  return teamName;
}
var TEAM_NAME_PATTERN;
var init_team_name = __esm({
  "src/team/team-name.ts"() {
    "use strict";
    TEAM_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,48}[a-z0-9]$/;
  }
});

// src/team/herdr-session.ts
var herdr_session_exports = {};
__export(herdr_session_exports, {
  HERDR_TEAM_WORKSPACE_LABEL_PREFIX: () => HERDR_TEAM_WORKSPACE_LABEL_PREFIX,
  HerdrError: () => HerdrError,
  buildAgentGetArgs: () => buildAgentGetArgs,
  buildAgentPromptArgs: () => buildAgentPromptArgs,
  buildAgentSendKeysArgs: () => buildAgentSendKeysArgs,
  buildAgentStartArgs: () => buildAgentStartArgs,
  buildHerdrAgentName: () => buildHerdrAgentName,
  buildPaneReadArgs: () => buildPaneReadArgs,
  buildTabCloseArgs: () => buildTabCloseArgs,
  buildTabCreateArgs: () => buildTabCreateArgs,
  buildWorkspaceCloseArgs: () => buildWorkspaceCloseArgs,
  buildWorkspaceCreateArgs: () => buildWorkspaceCreateArgs,
  buildWorkspacePaneListArgs: () => buildWorkspacePaneListArgs,
  captureHerdrWorkerPane: () => captureHerdrWorkerPane,
  destroyHerdrTeam: () => destroyHerdrTeam,
  ensureHerdrServer: () => ensureHerdrServer,
  herdrAgentInfo: () => herdrAgentInfo,
  herdrClosePane: () => herdrClosePane,
  herdrCloseWorkspace: () => herdrCloseWorkspace,
  herdrCreateTeamWorkspace: () => herdrCreateTeamWorkspace,
  herdrCreateWorkerTab: () => herdrCreateWorkerTab,
  herdrCreateWorkspace: () => herdrCreateWorkspace,
  herdrPaneWorkspaceMembership: () => herdrPaneWorkspaceMembership,
  herdrRunPaneCommand: () => herdrRunPaneCommand,
  herdrSendKey: () => herdrSendKey,
  herdrSendPrompt: () => herdrSendPrompt,
  herdrWorkspaceExists: () => herdrWorkspaceExists,
  herdrWorkspaceIdFromPaneId: () => herdrWorkspaceIdFromPaneId,
  herdrWorkspaceIdFromSessionTarget: () => herdrWorkspaceIdFromSessionTarget,
  interruptHerdrWorker: () => interruptHerdrWorker,
  isHerdrBinaryCallable: () => isHerdrBinaryCallable,
  isHerdrWorkerAlive: () => isHerdrWorkerAlive,
  listHerdrAgents: () => listHerdrAgents,
  listHerdrTeams: () => listHerdrTeams,
  parseHerdrEnvelope: () => parseHerdrEnvelope,
  resolveHerdrBinary: () => resolveHerdrBinary,
  runHerdr: () => runHerdr,
  runHerdrRaw: () => runHerdrRaw,
  runHerdrResult: () => runHerdrResult,
  submitToHerdrWorker: () => submitToHerdrWorker,
  teardownHerdrWorker: () => teardownHerdrWorker
});
function parseHerdrEnvelope(stdout) {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) {
    throw new HerdrError("empty_response", "herdr printed no JSON");
  }
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object") return parsed;
  } catch {
  }
  throw new HerdrError(
    "invalid_response",
    "herdr printed non-JSON output",
    trimmed.slice(0, 200)
  );
}
function extractErrorDetail(stderr) {
  const trimmed = stderr.trim();
  if (trimmed.length === 0) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed?.error) {
      return {
        code: parsed.error.code ?? "error",
        message: parsed.error.message ?? "herdr command failed"
      };
    }
  } catch {
  }
  return { code: "error", message: trimmed.slice(0, 300) };
}
function resolveHerdrBinary(env = process.env) {
  const pinned = env.HERDR_BIN_PATH?.trim();
  if (pinned && (0, import_node_path4.isAbsolute)(pinned) && (0, import_node_fs2.existsSync)(pinned)) {
    return pinned;
  }
  return "herdr";
}
async function isHerdrBinaryCallable(bin = resolveHerdrBinary()) {
  if (bin === null) return false;
  return new Promise((resolvePromise) => {
    (0, import_node_child_process.execFile)(bin, ["--version"], { timeout: 5e3 }, (error) => {
      resolvePromise(error === null);
    });
  });
}
async function runHerdr(args, options = {}) {
  const bin = resolveHerdrBinary(options.env);
  if (bin === null) {
    throw new HerdrError("binary_missing", "herdr binary not found");
  }
  const exec2 = options.execFn ?? execFileAsync3;
  const { stdout } = await exec2(bin, args, {
    timeout: options.timeoutMs ?? HERDR_DEFAULT_EXEC_TIMEOUT_MS,
    env: options.env,
    maxBuffer: 8 * 1024 * 1024
  }).catch(
    (error) => {
      const detail = extractErrorDetail(
        String(error.stderr ?? error.stdout ?? "")
      );
      const code = error.code === "ENOENT" ? "binary_missing" : detail?.code ?? "spawn_failed";
      throw new HerdrError(
        code,
        detail?.message ?? error.message,
        String(error.stderr ?? "")
      );
    }
  );
  const envelope = parseHerdrEnvelope(String(stdout));
  if (envelope.error) {
    throw new HerdrError(
      envelope.error.code ?? "error",
      envelope.error.message ?? "herdr command failed"
    );
  }
  return envelope;
}
async function runHerdrResult(args, options = {}) {
  const envelope = await runHerdr(args, options);
  return envelope.result;
}
async function runHerdrRaw(args, options = {}) {
  const bin = resolveHerdrBinary(options.env);
  if (bin === null) {
    throw new HerdrError("binary_missing", "herdr binary not found");
  }
  const exec2 = options.execFn ?? execFileAsync3;
  const { stdout } = await exec2(bin, args, {
    timeout: options.timeoutMs ?? HERDR_DEFAULT_EXEC_TIMEOUT_MS,
    env: options.env,
    maxBuffer: 8 * 1024 * 1024
  }).catch((error) => {
    const detail = extractErrorDetail(String(error.stderr ?? ""));
    const code = error.code === "ENOENT" ? "binary_missing" : detail?.code ?? "spawn_failed";
    throw new HerdrError(
      code,
      detail?.message ?? error.message,
      String(error.stderr ?? "")
    );
  });
  return String(stdout);
}
async function ensureHerdrServer(options = {}) {
  const env = options.env ?? process.env;
  const bin = options.bin ?? resolveHerdrBinary(env);
  if (bin === null)
    throw new HerdrError("binary_missing", "herdr binary not found");
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await runHerdr(["agent", "list"], { env, execFn: options.execFn });
      return "running";
    } catch (error) {
      if (!(error instanceof HerdrError) || error.code !== "server_not_running")
        throw error;
    }
    if (attempt > 0) break;
    const child = (0, import_node_child_process.spawn)(bin, ["server"], {
      stdio: "ignore",
      detached: true,
      env
    });
    let spawnError;
    child.on("error", (error) => {
      spawnError = new HerdrError("spawn", `Failed to spawn Herdr server: ${error instanceof Error ? error.message : String(error)}`);
    });
    child.unref();
    const deadline = Date.now() + HERDR_SERVER_START_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (spawnError) throw spawnError;
      await new Promise(
        (resolveSleep) => setTimeout(resolveSleep, HERDR_SERVER_POLL_INTERVAL_MS)
      );
      if (spawnError) throw spawnError;
      try {
        await runHerdr(["agent", "list"], { env, execFn: options.execFn });
        return "started";
      } catch {
      }
    }
    if (spawnError) throw spawnError;
  }
  throw new HerdrError(
    "server_start_failed",
    "herdr server did not become ready in time"
  );
}
function buildWorkspaceCreateArgs(cwd, label) {
  return ["workspace", "create", "--cwd", cwd, "--label", label, "--no-focus"];
}
function buildTabCreateArgs(workspaceId, cwd, label, env) {
  const args = [
    "tab",
    "create",
    "--workspace",
    workspaceId,
    "--cwd",
    cwd,
    "--label",
    label
  ];
  for (const [key, value] of Object.entries(env ?? {})) {
    args.push("--env", `${key}=${value}`);
  }
  args.push("--no-focus");
  return args;
}
function buildAgentStartArgs(name, kind, paneId, agentArgs = [], timeoutMs = HERDR_AGENT_START_TIMEOUT_MS) {
  const args = [
    "agent",
    "start",
    name,
    "--kind",
    kind,
    "--pane",
    paneId,
    "--timeout",
    String(timeoutMs)
  ];
  if (agentArgs.length > 0) {
    args.push("--", ...agentArgs);
  }
  return args;
}
function buildAgentPromptArgs(name, text) {
  return ["agent", "prompt", name, text];
}
function buildAgentGetArgs(name) {
  return ["agent", "get", name];
}
function buildPaneReadArgs(paneId, lines) {
  return [
    "pane",
    "read",
    paneId,
    "--source",
    "recent-unwrapped",
    "--lines",
    String(lines)
  ];
}
function buildAgentSendKeysArgs(name, key) {
  return ["agent", "send-keys", name, key];
}
function buildTabCloseArgs(tabId) {
  return ["tab", "close", tabId];
}
function buildWorkspaceCloseArgs(workspaceId) {
  return ["workspace", "close", workspaceId];
}
function buildHerdrAgentName(teamName, workerIndex) {
  const sanitized = teamName.toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 10) || "team";
  const hash = (0, import_node_crypto3.createHash)("sha256").update(teamName).digest("hex").slice(0, 4);
  const name = `omx-${sanitized}-${hash}-w${workerIndex}`;
  if (!HERDR_AGENT_NAME_PATTERN.test(name)) {
    throw new HerdrError(
      "invalid_agent_name",
      `derived agent name is invalid: ${name}`
    );
  }
  return name;
}
function herdrWorkspaceIdFromPaneId(paneId) {
  const separator = paneId.indexOf(":");
  if (separator <= 0 || separator === paneId.length - 1) {
    throw new HerdrError("invalid_pane_id", `not a herdr pane id: ${paneId}`);
  }
  return paneId.slice(0, separator);
}
function herdrWorkspaceIdFromSessionTarget(sessionTarget) {
  const prefix = "herdr:";
  if (!sessionTarget.startsWith(prefix)) {
    throw new HerdrError(
      "invalid_session_target",
      `not a herdr session target: ${sessionTarget}`
    );
  }
  const workspaceId = sessionTarget.slice(prefix.length).split(":")[0];
  if (!/^w[0-9a-z]+$/i.test(workspaceId)) {
    throw new HerdrError(
      "invalid_session_target",
      `not a herdr session target: ${sessionTarget}`
    );
  }
  return workspaceId;
}
async function herdrCreateWorkspace(cwd, label, options = {}) {
  await ensureHerdrServer(options);
  const created = await runHerdrResult(buildWorkspaceCreateArgs(cwd, label), {
    env: options.env,
    execFn: options.execFn
  });
  const workspaceId = created?.workspace?.workspace_id;
  if (typeof workspaceId !== "string" || workspaceId.length === 0) {
    throw new HerdrError(
      "missing_workspace_id",
      "workspace create did not return workspace_id"
    );
  }
  return workspaceId;
}
async function herdrCreateTeamWorkspace(cwd, label, options = {}) {
  return herdrCreateWorkspace(cwd, label, options);
}
async function herdrCreateWorkerTab(workspaceId, cwd, label, options = {}) {
  const tab = await runHerdrResult(buildTabCreateArgs(workspaceId, cwd, label), {
    env: options.env,
    execFn: options.execFn
  });
  const paneId = tab?.root_pane?.pane_id;
  if (typeof paneId !== "string" || paneId.length === 0) {
    throw new HerdrError(
      "missing_pane_id",
      "tab create did not return root_pane.pane_id"
    );
  }
  const tabId = typeof tab?.tab?.tab_id === "string" ? tab.tab.tab_id : "";
  return { paneId, tabId };
}
async function herdrRunPaneCommand(paneId, command, options = {}) {
  await runHerdrRaw(["pane", "run", paneId, command], {
    env: options.env,
    execFn: options.execFn
  });
}
async function herdrSendPrompt(paneId, text, options = {}) {
  await runHerdr(["agent", "prompt", paneId, text], {
    env: options.env,
    execFn: options.execFn
  });
}
async function herdrSendKey(paneId, key, options = {}) {
  await runHerdr(["agent", "send-keys", paneId, key], {
    env: options.env,
    execFn: options.execFn
  });
}
async function listHerdrAgents(options = {}) {
  const result = await runHerdrResult(
    ["agent", "list"],
    { env: options.env, execFn: options.execFn }
  );
  const agents = Array.isArray(result?.agents) ? result.agents : [];
  return agents.filter(
    (agent) => typeof agent.pane_id === "string" && agent.pane_id.length > 0
  );
}
async function herdrAgentInfo(paneId, options = {}) {
  const result = await runHerdrResult(
    ["agent", "get", paneId],
    { env: options.env, execFn: options.execFn }
  );
  return result?.agent ?? null;
}
async function submitToHerdrWorker(agentName, text, options = {}) {
  await runHerdr(buildAgentPromptArgs(agentName, text), {
    env: options.env,
    execFn: options.execFn
  });
}
async function interruptHerdrWorker(agentName, options = {}) {
  await runHerdr(buildAgentSendKeysArgs(agentName, "ctrl+c"), {
    env: options.env,
    execFn: options.execFn
  });
}
async function captureHerdrWorkerPane(paneId, lines = 80, options = {}) {
  return runHerdrRaw(buildPaneReadArgs(paneId, lines), {
    env: options.env,
    execFn: options.execFn
  });
}
async function isHerdrWorkerAlive(paneId, options = {}) {
  const result = await runHerdrResult(
    ["agent", "list"],
    { env: options.env, execFn: options.execFn }
  );
  const agents = Array.isArray(result?.agents) ? result.agents : [];
  return agents.some((agent) => agent.pane_id === paneId);
}
function buildWorkspacePaneListArgs(workspaceId) {
  return ["pane", "list", "--workspace", workspaceId];
}
async function herdrWorkspaceExists(workspaceId, options = {}) {
  try {
    await runHerdrResult(
      buildWorkspacePaneListArgs(workspaceId),
      { env: options.env, execFn: options.execFn }
    );
    return "exists";
  } catch {
    return "unavailable";
  }
}
async function herdrPaneWorkspaceMembership(paneId, workspaceId, options = {}) {
  try {
    const result = await runHerdrResult(
      buildWorkspacePaneListArgs(workspaceId),
      { env: options.env, execFn: options.execFn }
    );
    const panes = Array.isArray(result?.panes) ? result.panes : [];
    return panes.some((pane) => pane.pane_id === paneId) ? "member" : "foreign";
  } catch {
    return "unavailable";
  }
}
async function teardownHerdrWorker(paneId, options = {}) {
  await runHerdr(["pane", "close", paneId], {
    env: options.env,
    execFn: options.execFn
  });
}
async function destroyHerdrTeam(workspaceId, options = {}) {
  await runHerdr(buildWorkspaceCloseArgs(workspaceId), {
    env: options.env,
    execFn: options.execFn
  });
}
async function listHerdrTeams(options = {}) {
  const result = await runHerdrResult(["workspace", "list"], { env: options.env, execFn: options.execFn });
  const workspaces = Array.isArray(result?.workspaces) ? result.workspaces : [];
  return workspaces.filter(
    (workspace) => (workspace.label ?? "").startsWith(HERDR_TEAM_WORKSPACE_LABEL_PREFIX)
  ).map((workspace) => ({
    workspaceId: workspace.workspace_id ?? "",
    teamName: (workspace.label ?? "").slice(
      HERDR_TEAM_WORKSPACE_LABEL_PREFIX.length
    ),
    label: workspace.label ?? ""
  })).filter((team) => team.workspaceId.length > 0);
}
var import_node_child_process, import_node_util, import_node_fs2, import_node_path4, import_node_crypto3, execFileAsync3, HERDR_TEAM_WORKSPACE_LABEL_PREFIX, HERDR_AGENT_NAME_PATTERN, HERDR_DEFAULT_EXEC_TIMEOUT_MS, HERDR_AGENT_START_TIMEOUT_MS, HERDR_SERVER_START_TIMEOUT_MS, HERDR_SERVER_POLL_INTERVAL_MS, HerdrError, herdrClosePane, herdrCloseWorkspace;
var init_herdr_session = __esm({
  "src/team/herdr-session.ts"() {
    "use strict";
    import_node_child_process = require("node:child_process");
    import_node_util = require("node:util");
    import_node_fs2 = require("node:fs");
    import_node_path4 = require("node:path");
    import_node_crypto3 = require("node:crypto");
    execFileAsync3 = (0, import_node_util.promisify)(import_node_child_process.execFile);
    HERDR_TEAM_WORKSPACE_LABEL_PREFIX = "omc-team-";
    HERDR_AGENT_NAME_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/;
    HERDR_DEFAULT_EXEC_TIMEOUT_MS = 2e4;
    HERDR_AGENT_START_TIMEOUT_MS = 6e4;
    HERDR_SERVER_START_TIMEOUT_MS = 1e4;
    HERDR_SERVER_POLL_INTERVAL_MS = 250;
    HerdrError = class extends Error {
      constructor(code, message, detail) {
        super(`herdr_${code}: ${message}`);
        this.code = code;
        this.detail = detail;
        this.name = "HerdrError";
      }
    };
    herdrClosePane = teardownHerdrWorker;
    herdrCloseWorkspace = destroyHerdrTeam;
  }
});

// src/team/types.ts
function isAbsoluteTmuxSocketPath(value) {
  return value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\");
}
function isValidTmuxServerIdentity(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value;
  return typeof candidate.socket_path === "string" && candidate.socket_path.length > 0 && candidate.socket_path === candidate.socket_path.trim() && !/[\u0000-\u001f\u007f]/.test(candidate.socket_path) && isAbsoluteTmuxSocketPath(candidate.socket_path) && typeof candidate.server_pid === "number" && Number.isSafeInteger(candidate.server_pid) && candidate.server_pid > 0 && typeof candidate.process_started_at === "string" && candidate.process_started_at.length > 0 && candidate.process_started_at.length <= 1024 && !/[\u0000-\u001f\u007f]/.test(candidate.process_started_at);
}
function isValidTeamInstanceId(value) {
  return typeof value === "string" && TEAM_INSTANCE_ID_PATTERN.test(value);
}
var TEAM_INSTANCE_ID_PATTERN;
var init_types3 = __esm({
  "src/team/types.ts"() {
    "use strict";
    TEAM_INSTANCE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  }
});

// src/graph/runtime/native-contained-fs.ts
function getNativeContainedFs() {
  if (loaded) return loaded;
  let directory = (0, import_node_path5.dirname)((0, import_node_url2.fileURLToPath)(import_meta3.url));
  for (; ; ) {
    const manifest = (0, import_node_path5.join)(directory, "package.json");
    if ((0, import_node_fs3.existsSync)(manifest)) {
      const metadata = JSON.parse((0, import_node_fs3.readFileSync)(manifest, "utf8"));
      if (metadata.name === "oh-my-claude-sisyphus") {
        const binary = (0, import_node_path5.join)(directory, "native", `contained-fs-${process.platform}-${process.arch}.node`);
        try {
          loaded = (0, import_node_module.createRequire)(import_meta3.url)(binary);
          return loaded;
        } catch (cause) {
          throw new Error(`The contained filesystem backend is unavailable at ${binary}. Build it with node scripts/build-contained-fs.mjs (from the installed package directory) before running graph or team commands.`, { cause });
        }
      }
    }
    const parent = (0, import_node_path5.dirname)(directory);
    if (parent === directory) throw new Error("Cannot locate the OMC package for the contained filesystem backend");
    directory = parent;
  }
}
var import_node_fs3, import_node_module, import_node_path5, import_node_url2, import_meta3, loaded;
var init_native_contained_fs = __esm({
  "src/graph/runtime/native-contained-fs.ts"() {
    "use strict";
    import_node_fs3 = require("node:fs");
    import_node_module = require("node:module");
    import_node_path5 = require("node:path");
    import_node_url2 = require("node:url");
    import_meta3 = {};
  }
});

// src/team/state-paths.ts
function normalizeTaskFileStem(taskId) {
  const trimmed = String(taskId).trim().replace(/\.json$/i, "");
  if (/^task-\d+$/.test(trimmed)) return trimmed;
  if (/^\d+$/.test(trimmed)) return `task-${trimmed}`;
  return trimmed;
}
function absPath(cwd, relativePath) {
  if ((0, import_path14.isAbsolute)(relativePath)) return relativePath;
  if (relativePath === ".omc" || relativePath.startsWith(".omc/")) {
    const scope = teamStatePathScope.getStore();
    const root = scope?.canonicalOmcRoot ?? getOmcRoot(cwd);
    return (0, import_path14.join)(root, relativePath.slice(".omc".length).replace(/^\//, ""));
  }
  return (0, import_path14.join)(cwd, relativePath);
}
var import_node_crypto4, import_node_async_hooks2, import_path14, teamStatePathScope, TeamPaths;
var init_state_paths = __esm({
  "src/team/state-paths.ts"() {
    "use strict";
    import_node_crypto4 = require("node:crypto");
    import_node_async_hooks2 = require("node:async_hooks");
    import_path14 = require("path");
    init_worktree_paths();
    teamStatePathScope = new import_node_async_hooks2.AsyncLocalStorage();
    TeamPaths = {
      root: (teamName) => `.omc/state/team/${teamName}`,
      config: (teamName) => `.omc/state/team/${teamName}/config.json`,
      shutdown: (teamName) => `.omc/state/team/${teamName}/shutdown.json`,
      tasks: (teamName) => `.omc/state/team/${teamName}/tasks`,
      taskFile: (teamName, taskId) => `.omc/state/team/${teamName}/tasks/${normalizeTaskFileStem(taskId)}.json`,
      workers: (teamName) => `.omc/state/team/${teamName}/workers`,
      workerDir: (teamName, workerName) => `.omc/state/team/${teamName}/workers/${workerName}`,
      heartbeat: (teamName, workerName) => `.omc/state/team/${teamName}/workers/${workerName}/heartbeat.json`,
      inbox: (teamName, workerName) => `.omc/state/team/${teamName}/workers/${workerName}/inbox.md`,
      outbox: (teamName, workerName) => `.omc/state/team/${teamName}/workers/${workerName}/outbox.jsonl`,
      ready: (teamName, workerName) => `.omc/state/team/${teamName}/workers/${workerName}/.ready`,
      overlay: (teamName, workerName) => `.omc/state/team/${teamName}/workers/${workerName}/AGENTS.md`,
      shutdownAck: (teamName, workerName) => `.omc/state/team/${teamName}/workers/${workerName}/shutdown-ack.json`,
      workerLaunchAttemptRoot: (teamName, workerName, attemptId) => `.omc/state/team/${teamName}/workers/${workerName}/launch-attempts/${attemptId}`,
      workerLaunchCurrent: (teamName, workerName) => `.omc/state/team/${teamName}/workers/${workerName}/launch-attempts/current.json`,
      workerLaunchExpected: (teamName, workerName, attemptId) => `.omc/state/team/${teamName}/workers/${workerName}/launch-attempts/${attemptId}/expected.json`,
      workerLaunchAck: (teamName, workerName, attemptId) => `.omc/state/team/${teamName}/workers/${workerName}/launch-attempts/${attemptId}/ack.json`,
      workerLaunchStarted: (teamName, workerName, attemptId) => `.omc/state/team/${teamName}/workers/${workerName}/launch-attempts/${attemptId}/provider-started.json`,
      workerLaunchTransportOwner: (teamName, workerName, attemptId) => `.omc/state/team/${teamName}/workers/${workerName}/launch-attempts/${attemptId}/transport-owner.json`,
      workerLaunchBootstrapDescriptor: (teamName, workerName, attemptId) => `.omc/state/team/${teamName}/workers/${workerName}/launch-attempts/${attemptId}/bootstrap.json`,
      workerLaunchWrapper: (teamName, workerName, attemptId) => `.omc/state/team/${teamName}/workers/${workerName}/launch-attempts/${attemptId}/launch.cmd`,
      workerLaunchTransportCleanupComplete: (teamName, workerName, attemptId) => `.omc/state/team/${teamName}/workers/${workerName}/launch-attempts/${attemptId}/transport-cleanup-complete.json`,
      workerLaunchDecision: (teamName, workerName, attemptId) => `.omc/state/team/${teamName}/workers/${workerName}/launch-attempts/${attemptId}/decision.json`,
      mailbox: (teamName, workerName) => `.omc/state/team/${teamName}/mailbox/${workerName}.json`,
      mailboxLockDir: (teamName, workerName) => `.omc/state/team/${teamName}/mailbox/.lock-${workerName}`,
      dispatchRequests: (teamName) => `.omc/state/team/${teamName}/dispatch/requests.json`,
      dispatchLockDir: (teamName) => `.omc/state/team/${teamName}/dispatch/.lock`,
      mailboxNotificationLock: (teamName, requestId) => `.omc/state/team/${teamName}/dispatch/.mailbox-notification-${(0, import_node_crypto4.createHash)("sha256").update(requestId).digest("hex")}.lock`,
      workerStatus: (teamName, workerName) => `.omc/state/team/${teamName}/workers/${workerName}/status.json`,
      workerIdleNotify: (teamName) => `.omc/state/team/${teamName}/worker-idle-notify.json`,
      workerPrevNotifyState: (teamName, workerName) => `.omc/state/team/${teamName}/workers/${workerName}/prev-notify-state.json`,
      events: (teamName) => `.omc/state/team/${teamName}/events.jsonl`,
      approval: (teamName, taskId) => `.omc/state/team/${teamName}/approvals/${taskId}.json`,
      manifest: (teamName) => `.omc/state/team/${teamName}/manifest.json`,
      monitorSnapshot: (teamName) => `.omc/state/team/${teamName}/monitor-snapshot.json`,
      summarySnapshot: (teamName) => `.omc/state/team/${teamName}/summary-snapshot.json`,
      phaseState: (teamName) => `.omc/state/team/${teamName}/phase-state.json`,
      scalingLock: (teamName) => `.omc/state/team/${teamName}/.scaling-lock`,
      configMutationLock: (teamName) => `.omc/state/team/${teamName}/.config-mutation.lock`,
      workerIdentity: (teamName, workerName) => `.omc/state/team/${teamName}/workers/${workerName}/identity.json`,
      workerAgentsMd: (teamName) => `.omc/state/team/${teamName}/worker-agents.md`,
      shutdownRequest: (teamName, workerName) => `.omc/state/team/${teamName}/workers/${workerName}/shutdown-request.json`,
      checkpoints: (teamName, taskId, claimTokenHash) => `.omc/state/team/${teamName}/checkpoints/${normalizeTaskFileStem(taskId)}/${claimTokenHash}`,
      checkpoint: (teamName, taskId, claimTokenHash, sequence) => `.omc/state/team/${teamName}/checkpoints/${normalizeTaskFileStem(taskId)}/${claimTokenHash}/${sequence}.json`,
      checkpointLatest: (teamName, taskId, claimTokenHash) => `.omc/state/team/${teamName}/checkpoints/${normalizeTaskFileStem(taskId)}/${claimTokenHash}/latest.json`,
      taskRecoverySidecar: (teamName, recoveryId, taskId) => {
        if (recoveryId.length === 0 || recoveryId.length > 128 || recoveryId === "." || recoveryId === ".." || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(recoveryId)) {
          throw new Error("invalid_recovery_request_id");
        }
        const taskStem = normalizeTaskFileStem(taskId);
        if (!/^task-\d+$/.test(taskStem)) throw new Error("invalid_task_id");
        return `.omc/state/team/${teamName}/recovery/task-sidecars/${recoveryId}/${taskStem}.json`;
      },
      taskRecoveryReservation: (teamName, taskId) => `.omc/state/team/${teamName}/recovery/reservations/${normalizeTaskFileStem(taskId)}.json`,
      ownerEpochs: (teamName) => `.omc/state/team/${teamName}/recovery/owner-epochs`,
      ownerEpoch: (teamName, epoch) => `.omc/state/team/${teamName}/recovery/owner-epochs/${epoch}.json`,
      recoveryOwnerBootstrapCandidate: (teamName, expectedEpoch, nonce) => {
        if (nonce.length === 0 || nonce.length > 128 || nonce === "." || nonce === ".." || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(nonce)) throw new Error("invalid_recovery_owner_bootstrap_nonce");
        return `.omc/state/team/${teamName}/recovery/owner-bootstrap/${expectedEpoch}/${nonce}.json`;
      },
      recoveryIntents: (teamName) => `.omc/state/team/${teamName}/recovery/intents`,
      recoveryIntent: (teamName, recoveryId) => `.omc/state/team/${teamName}/recovery/intents/${recoveryId}.json`,
      recoveryAttempts: (teamName) => `.omc/state/team/${teamName}/recovery/attempts`,
      recoveryAttempt: (teamName, recoveryId) => `.omc/state/team/${teamName}/recovery/attempts/${recoveryId}.json`,
      recoveryActivation: (teamName, recoveryId, paneAttemptId) => `.omc/state/team/${teamName}/recovery/activation/${recoveryId}/${paneAttemptId}`,
      recoveryReady: (teamName, recoveryId, paneAttemptId) => `.omc/state/team/${teamName}/recovery/activation/${recoveryId}/${paneAttemptId}/ready.json`,
      recoveryActivate: (teamName, recoveryId, paneAttemptId) => `.omc/state/team/${teamName}/recovery/activation/${recoveryId}/${paneAttemptId}/activate.json`,
      recoveryRun: (teamName, recoveryId, paneAttemptId) => `.omc/state/team/${teamName}/recovery/activation/${recoveryId}/${paneAttemptId}/run.json`,
      recoveryRequestsRoot: () => ".omc/state/team-recovery/by-request",
      recoveryAdmissionLock: (payloadHash) => `.omc/state/team-recovery/admission-locks/${payloadHash}.lock`,
      recoveryLifecycleLock: (workspaceHash, teamName) => `.omc/state/team-recovery/lifecycle-locks/${workspaceHash}/${teamName}.lock`,
      /**
       * External team-instance authority.  These paths deliberately live outside
       * `.omc/state/team/{teamName}` so cleanup can retain authorization after the
       * state tree is detached or partially removed.
       */
      teamInstanceAuthorityRoot: (workspaceHash, teamName) => `.omc/state/team-recovery/team-instances/${workspaceHash}/${teamName}`,
      teamInstanceReservation: (workspaceHash, teamName) => `.omc/state/team-recovery/team-instances/${workspaceHash}/${teamName}/reservation.json`,
      teamInstanceCleanupRoot: (workspaceHash, teamName, instanceId) => `.omc/state/team-recovery/team-instances/${workspaceHash}/${teamName}/${instanceId}`,
      teamInstanceCleanupReceipt: (workspaceHash, teamName, instanceId) => `.omc/state/team-recovery/team-instances/${workspaceHash}/${teamName}/${instanceId}/cleanup.json`,
      teamInstanceScaleUpRecoveryRoot: (workspaceHash, teamName, instanceId) => `.omc/state/team-recovery/team-instances/${workspaceHash}/${teamName}/scale-up/${instanceId}`,
      teamInstanceScaleUpRecoveryOperationRoot: (workspaceHash, teamName, instanceId, operationId) => `${TeamPaths.teamInstanceScaleUpRecoveryRoot(workspaceHash, teamName, instanceId)}/${operationId}`,
      teamInstanceScaleUpRecoveryEvidence: (workspaceHash, teamName, instanceId, operationId) => `${TeamPaths.teamInstanceScaleUpRecoveryOperationRoot(
        workspaceHash,
        teamName,
        instanceId,
        operationId
      )}/recovery.json`,
      teamInstanceScaleUpRecoveryRetiredOperationRoot: (workspaceHash, teamName, instanceId, operationId) => `.omc/state/team-recovery/team-instances/${workspaceHash}/${teamName}/scale-up-retired/${instanceId}/${operationId}`,
      teamInstanceDetachedRoot: (workspaceHash, teamName, instanceId) => `.omc/state/team-recovery/team-instances/${workspaceHash}/${teamName}/${instanceId}/detached`,
      recoveryRequestPending: (requestId) => `.omc/state/team-recovery/by-request/${requestId}.pending.json`,
      recoveryRequestResult: (requestId) => `.omc/state/team-recovery/by-request/${requestId}.result.json`,
      recoveryResultByTeam: (workspaceHash, teamName, recoveryId) => `.omc/state/team-recovery/by-team/${workspaceHash}/${teamName}/${recoveryId}.json`,
      recoveryFinalIndexLock: (workspaceHash, teamName, recoveryId) => `.omc/state/team-recovery/index-locks/${workspaceHash}/${teamName}/${recoveryId}.lock`,
      scalingRollbackFailure: (teamName, recordedAt) => `.omc/state/team/${teamName}/scaling-rollback/${recordedAt}.json`,
      recoveryPaneRollbackFailure: (teamName, recoveryId, paneAttemptId, recordedAt) => `.omc/state/team/${teamName}/recovery/rollback-failures/${recoveryId}/${paneAttemptId}-${recordedAt}.json`,
      recoveryAuditIndex: () => ".omc/state/team-recovery/audit.jsonl"
    };
  }
});

// src/team/team-owner-epoch.ts
function darwinProcessStartFromKinfo(raw, nowSeconds = Math.floor(Date.now() / 1e3)) {
  if (raw.length < 16) return null;
  const seconds = raw.readBigUInt64LE(0);
  const micros = raw.readBigUInt64LE(8);
  if (seconds < 946684800n || seconds > BigInt(nowSeconds + 86400) || micros >= 1000000n) return null;
  return `${seconds}:${micros}`;
}
function darwinProcessStartIdentityFromNative(pid) {
  try {
    const native = getNativeContainedFs();
    if (typeof native.processStartTime !== "function") return null;
    const started = native.processStartTime(pid);
    if (!started || typeof started !== "object" || Array.isArray(started) || !Number.isSafeInteger(started.seconds) || started.seconds < 946684800 || started.seconds > Math.floor(Date.now() / 1e3) + 86400 || !Number.isSafeInteger(started.microseconds) || started.microseconds < 1 || started.microseconds >= 1e6) return null;
    return `darwin:${started.seconds}:${started.microseconds}`;
  } catch {
    return null;
  }
}
function probeProcessStartIdentityForPlatform(pid, platform, exec2, read, strict) {
  if (!Number.isSafeInteger(pid) || pid < 1) return { identity: null, precise: false };
  try {
    if (platform === "linux") {
      const stat = read(`/proc/${pid}/stat`, "utf8");
      const close = stat.lastIndexOf(")");
      const fields = stat.slice(close + 2).trim().split(/\s+/);
      const ticks = fields[19];
      if (!ticks) return { identity: null, precise: false };
      if (!strict) return { identity: `linux:${ticks}`, precise: false };
      if (!/^[1-9]\d*$/.test(ticks)) return { identity: null, precise: false };
      const bootId = String(read("/proc/sys/kernel/random/boot_id", "utf8")).trim();
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(bootId)) {
        return { identity: null, precise: false };
      }
      return { identity: `linux:${bootId}:${ticks}`, precise: true };
    }
    if (platform === "win32") {
      const command = `$p = [System.Diagnostics.Process]::GetProcessById(${pid}); if ($p) { $p.StartTime.ToUniversalTime().Ticks }`;
      const ticks = exec2(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", command],
        { encoding: "utf8", timeout: PROCESS_IDENTITY_PROBE_TIMEOUT_MS, windowsHide: true }
      ).trim();
      return /^[1-9]\d*$/.test(ticks) ? { identity: `win32:${ticks}`, precise: true } : { identity: null, precise: false };
    }
    if (platform === "darwin") {
      if (strict) {
        const identity = darwinProcessStartIdentityFromNative(pid);
        return identity ? { identity, precise: true } : { identity: null, precise: false };
      }
      try {
        const raw = exec2("/usr/sbin/sysctl", ["-b", `kern.proc.pid.${pid}`], {
          encoding: null,
          maxBuffer: 1024 * 1024,
          stdio: ["ignore", "pipe", "ignore"]
        });
        const birth = darwinProcessStartFromKinfo(Buffer.isBuffer(raw) ? raw : Buffer.from(raw));
        if (birth) return { identity: `darwin:${birth}`, precise: true };
      } catch {
      }
      const started2 = exec2("ps", ["-o", "lstart=", "-p", String(pid)], {
        encoding: "utf8",
        env: { ...process.env, LC_ALL: "C", LANG: "C" }
      }).trim();
      const startedAtMs = Date.parse(started2);
      return started2 && Number.isFinite(startedAtMs) ? { identity: `darwin:${Math.floor(startedAtMs / 1e3)}:0`, precise: false } : { identity: null, precise: false };
    }
    if (strict) return { identity: null, precise: false };
    const started = exec2("ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8" }).trim();
    return started ? { identity: `${platform}:${started}`, precise: false } : { identity: null, precise: false };
  } catch {
    return { identity: null, precise: false };
  }
}
function strictProcessStartIdentityForPlatform(pid, platform = process.platform, exec2 = import_node_child_process2.execFileSync, read = import_fs9.readFileSync) {
  if (!Number.isSafeInteger(pid) || pid < 1 || pid > 2147483647) return null;
  const result = probeProcessStartIdentityForPlatform(pid, platform, exec2, read, true);
  return result.precise ? result.identity : null;
}
function isValidStrictProcessStartIdentity(value, platform = process.platform) {
  if (typeof value !== "string" || value.length > 1024) return false;
  if (platform === "linux") {
    return /^linux:[A-Za-z0-9][A-Za-z0-9._-]*:[1-9]\d*$/.test(value);
  }
  if (platform === "darwin") {
    const match = /^darwin:([1-9]\d*):(\d+)$/.exec(value);
    return match !== null && Number(match[2]) > 0 && Number(match[2]) < 1e6;
  }
  if (platform === "win32") return /^win32:[1-9]\d*$/.test(value);
  return false;
}
function currentStrictProcessStartIdentity(pid = process.pid) {
  return strictProcessStartIdentityForPlatform(pid);
}
function observeProcessIdentity(record) {
  if (!Number.isSafeInteger(record.pid) || record.pid < 1 || !isValidStrictProcessStartIdentity(record.process_started_at)) return "unknown";
  try {
    process.kill(record.pid, 0);
  } catch (error) {
    return error.code === "ESRCH" ? "dead" : "unknown";
  }
  const observed = currentStrictProcessStartIdentity(record.pid);
  if (!observed || !isValidStrictProcessStartIdentity(observed)) return "unknown";
  return observed === record.process_started_at ? "matching" : "dead";
}
var import_fs9, import_node_child_process2, PROCESS_IDENTITY_PROBE_TIMEOUT_MS;
var init_team_owner_epoch = __esm({
  "src/team/team-owner-epoch.ts"() {
    "use strict";
    import_fs9 = require("fs");
    import_node_child_process2 = require("node:child_process");
    init_native_contained_fs();
    init_state_paths();
    PROCESS_IDENTITY_PROBE_TIMEOUT_MS = 3e3;
  }
});

// src/team/pane-readiness.ts
function paneLineLooksLikeIdlePrompt(line, provider) {
  if (provider === void 0) return LEGACY_IDLE_PROMPT_LINE.test(line);
  return PROVIDER_IDLE_PROMPT_LINES[provider].test(line);
}
var LEGACY_IDLE_PROMPT_LINE, CURSOR_IDLE_PROMPT_LINE, PROVIDER_IDLE_PROMPT_LINES;
var init_pane_readiness = __esm({
  "src/team/pane-readiness.ts"() {
    "use strict";
    LEGACY_IDLE_PROMPT_LINE = /^\s*(?:[│┃║▌▐▏▕╎┆┊]\s*)?[›>❯]\s*/u;
    CURSOR_IDLE_PROMPT_LINE = /^\s*(?:[│┃║▌▐▏▕╎┆┊]\s*)?[›>❯→]\s*/u;
    PROVIDER_IDLE_PROMPT_LINES = {
      claude: LEGACY_IDLE_PROMPT_LINE,
      codex: LEGACY_IDLE_PROMPT_LINE,
      gemini: LEGACY_IDLE_PROMPT_LINE,
      cursor: CURSOR_IDLE_PROMPT_LINE,
      grok: LEGACY_IDLE_PROMPT_LINE,
      antigravity: LEGACY_IDLE_PROMPT_LINE,
      copilot: LEGACY_IDLE_PROMPT_LINE
    };
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
  const stat = (0, import_fs10.fstatSync)(fd);
  return { dev: stat.dev, ino: stat.ino };
}
function identityForPath(lockPath) {
  try {
    const stat = (0, import_fs10.lstatSync)(lockPath);
    return { dev: stat.dev, ino: stat.ino };
  } catch {
    return null;
  }
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
function processStartIdentitiesMatch(current, expected) {
  if (current === expected) return true;
  const normalize3 = (identity) => {
    const legacyDmtf = /^dmtf:(.+)$/.exec(identity)?.[1];
    const source = legacyDmtf ? dmtfCreationDateToTicks(legacyDmtf) : identity;
    if (!source) return null;
    const normalized = normalizeProcessStartIdentity(source);
    const epochMicroseconds = /^windows-dmtf-us:(\d{1,18})$/.exec(normalized)?.[1];
    if (epochMicroseconds) {
      const value = BigInt(epochMicroseconds);
      return value > 0n && value <= WINDOWS_MAX_EPOCH_MICROSECONDS ? `windows-dmtf-us:${value}` : null;
    }
    return /^(?:ticks:|windows-dmtf-us:|dmtf:)/.test(identity) ? null : identity;
  };
  const normalizedCurrent = normalize3(current);
  const normalizedExpected = normalize3(expected);
  if (normalizedCurrent === null || normalizedExpected === null) return null;
  const currentIsWindows = normalizedCurrent.startsWith("windows-dmtf-us:");
  const expectedIsWindows = normalizedExpected.startsWith("windows-dmtf-us:");
  if (currentIsWindows !== expectedIsWindows) return null;
  const currentExactTicks = /^ticks:(\d{1,19})$/.exec(current)?.[1];
  const expectedExactTicks = /^ticks:(\d{1,19})$/.exec(expected)?.[1];
  if (currentExactTicks && expectedExactTicks) {
    return BigInt(currentExactTicks) === BigInt(expectedExactTicks);
  }
  return normalizedCurrent === normalizedExpected;
}
function staleLockObservation(lockPath, staleLockMs, requireAuthenticatedOwner = false) {
  try {
    const stat = (0, import_fs10.lstatSync)(lockPath);
    const now = Date.now();
    if (!Number.isFinite(stat.mtimeMs) || stat.mtimeMs > now + MAX_LOCK_MTIME_FUTURE_SKEW_MS) {
      return null;
    }
    const ageMs = Math.max(0, now - stat.mtimeMs);
    if (ageMs < staleLockMs) return null;
    const raw = (0, import_fs10.readFileSync)(lockPath, "utf-8");
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
    const matches = processStartIdentitiesMatch(
      currentStart,
      expectedStart
    );
    return matches === null || matches ? null : observation;
  } catch {
    return null;
  }
}
function observedLockStillMatches(lockPath, observation) {
  if (!identitiesEqual(identityForPath(lockPath), observation.identity)) {
    return false;
  }
  try {
    return (0, import_fs10.readFileSync)(lockPath, "utf-8") === observation.raw;
  } catch {
    return false;
  }
}
function reapObservedLock(lockPath, observation) {
  try {
    if (!observedLockStillMatches(lockPath, observation)) return false;
    (0, import_fs10.unlinkSync)(lockPath);
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
    names = (0, import_fs10.readdirSync)(directory);
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
    (0, import_fs10.closeSync)(handle.fd);
  } catch {
  }
  if (!ownedBeforeClose || !handleStillOwnsPath(handle)) return;
  try {
    (0, import_fs10.unlinkSync)(handle.path);
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
    nonce: (0, import_crypto4.randomUUID)(),
    timestamp: Date.now()
  };
}
function createOwnedLock(lockPath, suppliedOwner) {
  const owner = suppliedOwner ?? currentLockOwner();
  if (!owner) return null;
  const ownerRaw = JSON.stringify(owner);
  const ownerBytes = Buffer.from(ownerRaw, "utf8");
  const fd = (0, import_fs10.openSync)(
    lockPath,
    import_fs10.constants.O_CREAT | import_fs10.constants.O_EXCL | import_fs10.constants.O_RDWR,
    384
  );
  const creationIdentity = identityForFd(fd);
  try {
    let written = 0;
    while (written < ownerBytes.length) {
      const count = (0, import_fs10.writeSync)(
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
    (0, import_fs10.fsyncSync)(fd);
    const stat = (0, import_fs10.fstatSync)(fd);
    if (stat.size !== ownerBytes.length || !identitiesEqual(identityForPath(lockPath), creationIdentity)) {
      throw new Error(`Failed to verify file lock owner: ${lockPath}`);
    }
    const verifiedBytes = Buffer.alloc(ownerBytes.length);
    let read = 0;
    while (read < verifiedBytes.length) {
      const count = (0, import_fs10.readSync)(
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
      (0, import_fs10.closeSync)(fd);
    } catch {
    }
    try {
      if (identitiesEqual(identityForPath(lockPath), creationIdentity)) {
        (0, import_fs10.unlinkSync)(lockPath);
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
    (0, import_fs10.linkSync)(publicationPath, lockPath);
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
        (0, import_fs10.unlinkSync)(publicationPath);
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
        if (handleStillOwnsPath(published)) (0, import_fs10.unlinkSync)(lockPath);
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
    const raw = (0, import_fs10.readFileSync)(handle.path, "utf-8");
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
    (0, import_fs10.closeSync)(handle.fd);
  } catch {
  }
}
function sleep(ms) {
  return new Promise((resolve9) => setTimeout(resolve9, ms));
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
var import_fs10, import_crypto4, path2, DEFAULT_STALE_LOCK_MS, DEFAULT_RETRY_DELAY_MS, RECLAMATION_GUARD_SUFFIX, RECLAMATION_RECOVERY_SUFFIX, RECLAMATION_RECOVERY_CLAIM_SUFFIX, RECLAMATION_GUARD_STALE_MS, RECLAMATION_RECOVERY_STALE_MS, MAX_LOCK_MTIME_FUTURE_SKEW_MS, RELEASE_GUARD_TIMEOUT_MS, WINDOWS_MAX_EPOCH_MICROSECONDS;
var init_file_lock = __esm({
  "src/lib/file-lock.ts"() {
    "use strict";
    import_fs10 = require("fs");
    import_crypto4 = require("crypto");
    path2 = __toESM(require("path"), 1);
    init_process_start_identity();
    init_atomic_write();
    init_file_identity();
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
    WINDOWS_MAX_EPOCH_MICROSECONDS = 253402300799999999n;
  }
});

// src/lib/host-load-gate.ts
var init_host_load_gate = __esm({
  "src/lib/host-load-gate.ts"() {
    "use strict";
    init_paths();
  }
});

// src/team/worker-launch-ack.ts
function buildWindowsSupervisorSource() {
  return [
    '$ErrorActionPreference = "Stop"',
    "$payload = [Console]::In.ReadLine() | ConvertFrom-Json",
    "$json = $payload.canonical_json",
    '$hash = ([Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($json)) | ForEach-Object { $_.ToString("x2") }) -join ""',
    'if ($hash -ne $payload.authority_digest) { throw "worker_launch_authority_digest_mismatch" }',
    'Add-Type @"',
    "using System; using System.Text; using System.Runtime.InteropServices;",
    String.raw`public static partial class O { [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct STARTUPINFO { public int cb; public IntPtr lpReserved; public IntPtr lpDesktop; public IntPtr lpTitle; public int dwX; public int dwY; public int dwXSize; public int dwYSize; public int dwXCountChars; public int dwYCountChars; public int dwFillAttribute; public int dwFlags; public short wShowWindow; public short cbReserved2; public IntPtr lpReserved2; public IntPtr hStdInput; public IntPtr hStdOutput; public IntPtr hStdError; } [StructLayout(LayoutKind.Sequential)] public struct PROCESS_INFORMATION { public IntPtr hProcess; public IntPtr hThread; public uint dwProcessId; public uint dwThreadId; } [StructLayout(LayoutKind.Sequential)] public struct JOBOBJECT_BASIC_LIMIT_INFORMATION { public long PerProcessUserTimeLimit; public long PerJobUserTimeLimit; public uint LimitFlags; public UIntPtr MinimumWorkingSetSize; public UIntPtr MaximumWorkingSetSize; public uint ActiveProcessLimit; public UIntPtr Affinity; public uint PriorityClass; public uint SchedulingClass; } [StructLayout(LayoutKind.Sequential)] public struct IO_COUNTERS { public ulong ReadOperationCount; public ulong WriteOperationCount; public ulong OtherOperationCount; public ulong ReadTransferCount; public ulong WriteTransferCount; public ulong OtherTransferCount; } [StructLayout(LayoutKind.Sequential)] public struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION { public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation; public IO_COUNTERS IoInfo; public UIntPtr ProcessMemoryLimit; public UIntPtr JobMemoryLimit; public UIntPtr PeakProcessMemoryUsed; public UIntPtr PeakJobMemoryUsed; } [DllImport("kernel32.dll", SetLastError=true)] public static extern IntPtr CreateJobObjectW(IntPtr a, string n); [DllImport("kernel32.dll", SetLastError=true)] public static extern bool SetInformationJobObject(IntPtr j, int c, IntPtr i, uint l); [DllImport("kernel32.dll", SetLastError=true)] public static extern bool AssignProcessToJobObject(IntPtr j, IntPtr p); [DllImport("kernel32.dll", SetLastError=true)] public static extern uint ResumeThread(IntPtr h); [DllImport("kernel32.dll", SetLastError=true)] public static extern bool TerminateJobObject(IntPtr j, uint c); [DllImport("kernel32.dll", SetLastError=true)] public static extern bool TerminateProcess(IntPtr p, uint c); [DllImport("kernel32.dll", SetLastError=true)] public static extern uint WaitForSingleObject(IntPtr h, uint ms); [DllImport("kernel32.dll", SetLastError=true)] public static extern bool GetExitCodeProcess(IntPtr h, out uint code); [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h); public static System.Threading.Tasks.Task<string> ReadLineAsync() { return System.Threading.Tasks.Task.Run(() => Console.In.ReadLine()); } public static string Quote(string value) { var b = new StringBuilder(); b.Append('\"'); int slashes = 0; foreach (var c in value) { if (c == '\\') { slashes++; continue; } if (c == '\"') { b.Append('\\', slashes * 2 + 1); b.Append('\"'); slashes = 0; continue; } b.Append('\\', slashes); slashes = 0; b.Append(c); } b.Append('\\', slashes * 2); b.Append('\"'); return b.ToString(); } public static string BuildCommandLine(string[] argv) { var b = new StringBuilder(); for (var i = 0; i < argv.Length; i++) { if (i != 0) b.Append(' '); b.Append(Quote(argv[i])); } return b.ToString(); } public static string CmdQuote(string value) { var b = new StringBuilder(); b.Append('\"'); int slashes = 0; foreach (var c in value) { if (c < ' ') throw new ArgumentException("worker_launch_provider_argv_invalid"); if (c == '\\') { slashes++; continue; } if (c == '\"') { b.Append('\\', slashes * 2); b.Append('\"'); b.Append('\"'); slashes = 0; continue; } b.Append('\\', slashes); slashes = 0; b.Append(c); } b.Append('\\', slashes * 2); b.Append('\"'); return b.ToString(); } public static string BuildCmdLine(string[] argv) { var b = new StringBuilder(); for (var i = 0; i < argv.Length; i++) { if (i != 0) b.Append(' '); b.Append(CmdQuote(argv[i])); } if (b.Length > ${WINDOWS_PROVIDER_LINE_MAX}) throw new ArgumentException("worker_launch_provider_argv_too_long"); return b.ToString(); } }`.split("\n").map((line) => line.trim()).filter((line) => line.length > 0 && !line.startsWith("//")).join(" "),
    String.raw`public static partial class O {
  [StructLayout(LayoutKind.Sequential)]
  private struct SECURITY_ATTRIBUTES {
    public int nLength;
    public IntPtr lpSecurityDescriptor;
    [MarshalAs(UnmanagedType.Bool)] public bool bInheritHandle;
  }
  [StructLayout(LayoutKind.Sequential)]
  private struct STARTUPINFOEX {
    public STARTUPINFO StartupInfo;
    public IntPtr lpAttributeList;
  }
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  private static extern IntPtr CreateFileW(string name, uint access, uint share, ref SECURITY_ATTRIBUTES attributes, uint disposition, uint flags, IntPtr template);
  [DllImport("kernel32.dll", SetLastError=true)]
  private static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, uint flags, ref IntPtr size);
  [DllImport("kernel32.dll", SetLastError=true)]
  private static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attribute, IntPtr value, IntPtr size, IntPtr previous, IntPtr returnedSize);
  [DllImport("kernel32.dll")]
  private static extern void DeleteProcThreadAttributeList(IntPtr list);
  [DllImport("kernel32.dll", EntryPoint="CreateProcessW", CharSet=CharSet.Unicode, SetLastError=true)]
  private static extern bool CreateProcessWithConsole(string app, StringBuilder cmd, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string dir, ref STARTUPINFOEX si, out PROCESS_INFORMATION pi);
  private static System.ComponentModel.Win32Exception LaunchError(string operation) {
    int error = Marshal.GetLastWin32Error();
    return new System.ComponentModel.Win32Exception(error, operation + ": Win32=" + error);
  }
  public static void RequireBatchProvider(string app) {
    // cmd.exe runs a batch argv[0] as part of its command line and would
    // search the cwd and PATH for a relative one; hold it to the same rule.
    if (String.IsNullOrWhiteSpace(app)
        || !System.Text.RegularExpressions.Regex.IsMatch(app, @"^(?:[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+[\\/])")
        || !System.IO.File.Exists(app)) {
      throw new ArgumentException("worker_launch_provider_executable_invalid");
    }
  }
  public static void CreateConsoleProcess(string app, string commandLine, IntPtr environment, string cwd, out PROCESS_INFORMATION pi) {
    pi = new PROCESS_INFORMATION();
    // lpApplicationName must never search a provider-controlled cwd or PATH.
    // Accept only an existing executable at a fully qualified Windows path.
    if (String.IsNullOrWhiteSpace(app)
        || !System.Text.RegularExpressions.Regex.IsMatch(app, @"^(?:[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+[\\/])")
        || !String.Equals(System.IO.Path.GetExtension(app), ".exe", StringComparison.OrdinalIgnoreCase)
        || !System.IO.File.Exists(app)) {
      throw new ArgumentException("worker_launch_provider_executable_invalid");
    }
    IntPtr input = new IntPtr(-1), output = new IntPtr(-1);
    IntPtr attributeList = IntPtr.Zero, handles = IntPtr.Zero;
    bool attributeListInitialized = false;
    try {
      var security = new SECURITY_ATTRIBUTES();
      security.nLength = Marshal.SizeOf(security);
      security.bInheritHandle = true;
      // Open the existing pane console; supervisor standard handles remain
      // dedicated to the authenticated JSON control protocol.
      input = CreateFileW("CONIN$", 0xC0000000, 3, ref security, 3, 0, IntPtr.Zero);
      if (input == new IntPtr(-1)) throw LaunchError("worker_launch_console_input_failed");
      output = CreateFileW("CONOUT$", 0xC0000000, 3, ref security, 3, 0, IntPtr.Zero);
      if (output == new IntPtr(-1)) throw LaunchError("worker_launch_console_output_failed");
      IntPtr size = IntPtr.Zero;
      InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref size);
      if (size == IntPtr.Zero) throw LaunchError("worker_launch_attribute_size_failed");
      attributeList = Marshal.AllocHGlobal(size);
      if (!InitializeProcThreadAttributeList(attributeList, 1, 0, ref size)) throw LaunchError("worker_launch_attribute_init_failed");
      attributeListInitialized = true;
      handles = Marshal.AllocHGlobal(IntPtr.Size * 2);
      Marshal.WriteIntPtr(handles, 0, input);
      Marshal.WriteIntPtr(handles, IntPtr.Size, output);
      if (!UpdateProcThreadAttribute(attributeList, 0, new IntPtr(0x20002), handles, new IntPtr(IntPtr.Size * 2), IntPtr.Zero, IntPtr.Zero)) throw LaunchError("worker_launch_handle_list_failed");
      var startup = new STARTUPINFOEX();
      startup.StartupInfo.cb = Marshal.SizeOf(startup);
      // STARTF_USESTDHANDLES
      startup.StartupInfo.dwFlags = 0x100;
      startup.StartupInfo.hStdInput = input;
      startup.StartupInfo.hStdOutput = output;
      startup.StartupInfo.hStdError = output;
      startup.lpAttributeList = attributeList;
      // Only console input/output are inherited. In particular, neither
      // the JSON pipes nor any supervisor Job handle enters the child.
      if (!CreateProcessWithConsole(app, new StringBuilder(commandLine), IntPtr.Zero, IntPtr.Zero, true, 0x00000004 | 0x00000400 | 0x00080000, environment, cwd, ref startup, out pi)) throw LaunchError("worker_launch_create_process_failed");
    } finally {
      if (attributeListInitialized) DeleteProcThreadAttributeList(attributeList);
      if (handles != IntPtr.Zero) Marshal.FreeHGlobal(handles);
      if (attributeList != IntPtr.Zero) Marshal.FreeHGlobal(attributeList);
      if (output != new IntPtr(-1)) CloseHandle(output);
      if (input != new IntPtr(-1)) CloseHandle(input);
    }
  }
}`,
    '"@',
    "$pi = New-Object O+PROCESS_INFORMATION; $job = [IntPtr]::Zero; $jobAssigned = $false; $envPtr = [IntPtr]::Zero; $cmd = $null",
    "try {",
    // A .cmd/.bat argv[0] is never handed to CreateProcessW, which would run
    // it through cmd.exe with the MSVC-quoted line. cmd.exe from the system
    // directory is started instead with a fixed command line; it expands the
    // cmd-quoted provider line once from its environment block and clears
    // the variable before the provider runs. Every launch sets
    // NoDefaultCurrentDirectoryInExePath so neither that cmd (and a shim's
    // bare `node`) nor a provider's bare-name child runs a command planted in
    // the worker cwd.
    "  $argv = [string[]]$payload.provider_argv; $app = [string]$argv[0]; $providerLine = $null",
    `  if ($app -match '\\.(cmd|bat)[. ]*$') { [O]::RequireBatchProvider($app); $providerLine = [O]::BuildCmdLine($argv); $app = Join-Path ([Environment]::SystemDirectory) 'cmd.exe'; $cmd = '"' + $app + '" /d /v:off /s /c "set "${WINDOWS_PROVIDER_LINE_VAR}=" & %${WINDOWS_PROVIDER_LINE_VAR}%"' } else { $cmd = [O]::BuildCommandLine($argv) }`,
    `  $envPairs = @($payload.provider_env.psobject.Properties | Where-Object { $_.Name -ne '${WINDOWS_PROVIDER_LINE_VAR}' -and $_.Name -ne '${WINDOWS_NO_CWD_EXE_SEARCH_VAR}' } | ForEach-Object { [pscustomobject]@{ Name = $_.Name; Value = $_.Value } }); $envPairs += [pscustomobject]@{ Name = '${WINDOWS_NO_CWD_EXE_SEARCH_VAR}'; Value = '1' }; if ($null -ne $providerLine) { $envPairs += [pscustomobject]@{ Name = '${WINDOWS_PROVIDER_LINE_VAR}'; Value = $providerLine } }; $envPairs = @($envPairs | Sort-Object Name | ForEach-Object { "$($_.Name)=$($_.Value)" }); $envText = (($envPairs -join [char]0) + [char]0 + [char]0); $envBytes = [Text.Encoding]::Unicode.GetBytes($envText); $envPtr = [Runtime.InteropServices.Marshal]::AllocHGlobal($envBytes.Length); [Runtime.InteropServices.Marshal]::Copy($envBytes, 0, $envPtr, $envBytes.Length)`,
    "  [O]::CreateConsoleProcess($app, $cmd, $envPtr, $payload.cwd, [ref]$pi)",
    '  $job = [O]::CreateJobObjectW([IntPtr]::Zero, $null); if ($job -eq [IntPtr]::Zero) { throw "worker_launch_create_job_failed" }; $info = New-Object O+JOBOBJECT_EXTENDED_LIMIT_INFORMATION; $info.BasicLimitInformation.LimitFlags = 0x2000; $ptr = [Runtime.InteropServices.Marshal]::AllocHGlobal([Runtime.InteropServices.Marshal]::SizeOf($info)); try { [Runtime.InteropServices.Marshal]::StructureToPtr($info, $ptr, $false); if (-not [O]::SetInformationJobObject($job, 9, $ptr, [Runtime.InteropServices.Marshal]::SizeOf($info))) { throw "worker_launch_job_config_failed" } } finally { [Runtime.InteropServices.Marshal]::FreeHGlobal($ptr) }; if (-not [O]::AssignProcessToJobObject($job, $pi.hProcess)) { throw "worker_launch_assign_job_failed" }; $jobAssigned = $true; if ([O]::ResumeThread($pi.hThread) -eq [uint32]::MaxValue) { throw "worker_launch_resume_failed" }',
    '  $ticks = ([DateTime]((Get-Process -Id $pi.dwProcessId).StartTime)).ToUniversalTime().Ticks; $ready = @{ protocol="' + WINDOWS_SUPERVISOR_PROTOCOL + '"; kind="ready"; attempt_id=$payload.identity.attempt_id; instance_id=$payload.identity.instance_id; authority_digest=$payload.authority_digest; containment_nonce=$payload.containment_nonce; pid=$pi.dwProcessId; process_start_identity=("ticks:" + $ticks) } | ConvertTo-Json -Compress; [Console]::Out.WriteLine($ready); [Console]::Out.Flush()',
    '  $readTask = [O]::ReadLineAsync(); while ($true) { if ([O]::WaitForSingleObject($pi.hProcess, 50) -eq 0) { $exitCode = [uint32]0; if (-not [O]::GetExitCodeProcess($pi.hProcess, [ref]$exitCode)) { throw "worker_launch_exit_code_failed" }; if (-not [O]::TerminateJobObject($job, $exitCode)) { throw "worker_launch_job_terminate_failed" }; if ([O]::WaitForSingleObject($job, 5000) -ne 0) { throw "worker_launch_job_cleanup_timeout" }; $terminal = @{ protocol="' + WINDOWS_SUPERVISOR_PROTOCOL + '"; kind="terminal"; attempt_id=$payload.identity.attempt_id; instance_id=$payload.identity.instance_id; authority_digest=$payload.authority_digest; containment_nonce=$payload.containment_nonce; pid=$pi.dwProcessId; outcome="exit"; cleanup_verified=$true; exit_code=$exitCode } | ConvertTo-Json -Compress; [Console]::Out.WriteLine($terminal); [Console]::Out.Flush(); break }; if (-not $readTask.IsCompleted) { continue }; $line = $readTask.Result; if ($null -eq $line) { throw "worker_launch_authority_lost" }; $readTask = [O]::ReadLineAsync(); if ([string]::IsNullOrWhiteSpace($line) -or $line.Length -gt 4096) { continue }; try { $msg = $line | ConvertFrom-Json } catch { continue }; if ($msg.protocol -ne "' + WINDOWS_SUPERVISOR_PROTOCOL + '" -or $msg.attempt_id -ne $payload.identity.attempt_id -or $msg.instance_id -ne $payload.identity.instance_id -or $msg.authority_digest -ne $payload.authority_digest -or $msg.containment_nonce -ne $payload.containment_nonce -or $msg.kind -ne "terminate") { continue }; if (-not [O]::TerminateJobObject($job, 1)) { throw "worker_launch_job_terminate_failed" }; if ([O]::WaitForSingleObject($job, 5000) -ne 0) { throw "worker_launch_job_cleanup_timeout" }; $terminal = @{ protocol="' + WINDOWS_SUPERVISOR_PROTOCOL + '"; kind="terminal"; attempt_id=$payload.identity.attempt_id; instance_id=$payload.identity.instance_id; authority_digest=$payload.authority_digest; containment_nonce=$payload.containment_nonce; pid=$pi.dwProcessId; outcome="terminated"; cleanup_verified=$true; exit_code=1 } | ConvertTo-Json -Compress; [Console]::Out.WriteLine($terminal); [Console]::Out.Flush(); break }',
    "} catch { if ($pi.hProcess -ne [IntPtr]::Zero) { if ($jobAssigned) { [O]::TerminateJobObject($job, 1) | Out-Null } else { [O]::TerminateProcess($pi.hProcess, 1) | Out-Null }; [O]::WaitForSingleObject($pi.hProcess, 5000) | Out-Null }; throw } finally { if ($envPtr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::FreeHGlobal($envPtr) }; if ($pi.hThread -ne [IntPtr]::Zero) { [O]::CloseHandle($pi.hThread) | Out-Null }; if ($pi.hProcess -ne [IntPtr]::Zero) { [O]::CloseHandle($pi.hProcess) | Out-Null }; if ($job -ne [IntPtr]::Zero) { [O]::CloseHandle($job) | Out-Null } }"
  ].join("\n");
}
function canonicalAuthorityDigest(input) {
  const env = Object.fromEntries(Object.entries(input.providerEnv).sort(([a], [b]) => a.localeCompare(b)));
  const payload = JSON.stringify({ protocol: WORKER_LAUNCH_AUTHORITY_PROTOCOL, nonce: input.containmentNonce ?? "", supervisor_source_sha256: input.supervisorSourceSha256 ?? "", identity: identityOf(input.identity), provider_argv: [...input.providerArgv], provider_env: env, cwd: (0, import_node_path6.resolve)(input.cwd) });
  return (0, import_node_crypto5.createHash)("sha256").update(payload, "utf8").digest("hex");
}
function sleep2(ms) {
  return new Promise((resolve9) => setTimeout(resolve9, ms));
}
function isExactText(value) {
  return typeof value === "string" && value.length > 0 && value === value.trim();
}
function isValidEnvironmentKey(key) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key);
}
function normalizeProviderEnvironment(value, platform = process.platform) {
  const normalized = {};
  const seen = /* @__PURE__ */ new Set();
  const windows = platform === "win32";
  for (const [key, entry] of Object.entries(value ?? {})) {
    const compareKey = windows ? key.toUpperCase() : key;
    if (seen.has(compareKey)) throw new Error("worker_launch_provider_env_key_alias_conflict");
    seen.add(compareKey);
    if (windows && WINDOWS_RESERVED_ENV_KEYS.has(compareKey)) throw new Error("worker_launch_provider_env_reserved");
    if (WORKER_LAUNCH_INTERNAL_ENV_KEYS.has(key)) continue;
    if (!isValidEnvironmentKey(key)) throw new Error("worker_launch_provider_env_key_invalid");
    if (typeof entry !== "string") throw new Error("worker_launch_provider_env_value_invalid");
    normalized[key] = entry;
  }
  return normalized;
}
function parseEnvPassthrough(value) {
  if (!value || value.trim().length === 0) return [];
  return value.split(",").map((k) => k.trim()).filter((k) => k.length > 0);
}
function buildProviderEnvironment(providerEnv, sourceEnv = process.env, platform = process.platform, envPassthrough) {
  const normalized = normalizeProviderEnvironment(providerEnv, platform);
  const baseline = {};
  const identityKeys = platform === "win32" ? ["USERPROFILE"] : ["HOME", "USER"];
  for (const key of [...SAFE_BASELINE_ENV_KEYS, ...identityKeys]) {
    const value = sourceEnv[key];
    if (typeof value === "string" && value.length > 0) baseline[key] = value;
  }
  if (platform === "win32") {
    const systemRoot = [sourceEnv.SystemRoot, sourceEnv.SYSTEMROOT].find((value) => typeof value === "string" && /^[A-Za-z]:\\/.test(value));
    if (typeof systemRoot === "string") baseline.SystemRoot = systemRoot;
  }
  const passthroughList = envPassthrough ?? parseEnvPassthrough(sourceEnv.OMC_TEAM_WORKER_ENV_PASSTHROUGH);
  for (const key of passthroughList) {
    if (!isValidEnvironmentKey(key)) throw new Error("worker_launch_env_passthrough_key_invalid");
    if (WORKER_LAUNCH_INTERNAL_ENV_KEYS.has(key)) throw new Error("worker_launch_env_passthrough_key_reserved");
    if (platform === "win32" && WINDOWS_RESERVED_ENV_KEYS.has(key.toUpperCase())) throw new Error("worker_launch_env_passthrough_key_reserved");
    const value = sourceEnv[key];
    if (typeof value === "string") baseline[key] = value;
  }
  if (platform === "win32") {
    for (const key of Object.keys(normalized)) {
      const baselineKey = Object.keys(baseline).find((candidate) => candidate.toUpperCase() === key.toUpperCase());
      if (baselineKey) delete baseline[baselineKey];
    }
    const env = { ...baseline, ...normalized };
    for (const key of Object.keys(env)) {
      if (key.toUpperCase() === WINDOWS_NO_CWD_EXE_SEARCH_VAR.toUpperCase()) delete env[key];
    }
    return { ...env, [WINDOWS_NO_CWD_EXE_SEARCH_VAR]: "1" };
  }
  return { ...baseline, ...normalized };
}
function isUuid(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
function isProvider(value) {
  return value === "claude" || value === "codex" || value === "gemini" || value === "cursor" || value === "grok" || value === "antigravity";
}
function identityMatches(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value;
  return record.schema_version === WORKER_LAUNCH_SCHEMA_VERSION && record.attempt_id === expected.attempt_id && record.nonce === expected.nonce && record.instance_id === expected.instance_id && record.team_name === expected.team_name && record.worker_name === expected.worker_name && record.pane_id === expected.pane_id && record.provider === expected.provider && record.created_at === expected.created_at;
}
function isValidIdentity(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value;
  return record.schema_version === WORKER_LAUNCH_SCHEMA_VERSION && isUuid(record.attempt_id) && isUuid(record.nonce) && isValidTeamInstanceId(record.instance_id) && isExactText(record.team_name) && isExactText(record.worker_name) && isExactText(record.pane_id) && isProvider(record.provider) && typeof record.created_at === "string" && Number.isFinite(Date.parse(record.created_at));
}
function identityOf(attempt) {
  return {
    schema_version: attempt.schema_version,
    attempt_id: attempt.attempt_id,
    nonce: attempt.nonce,
    instance_id: attempt.instance_id,
    team_name: attempt.team_name,
    worker_name: attempt.worker_name,
    pane_id: attempt.pane_id,
    provider: attempt.provider,
    created_at: attempt.created_at
  };
}
async function readJson(path3) {
  try {
    return { kind: "value", value: JSON.parse(await (0, import_promises.readFile)(path3, "utf8")) };
  } catch (error) {
    if (error.code === "ENOENT") return { kind: "absent" };
    return { kind: "malformed" };
  }
}
async function isCurrentLaunchIdentity(currentPath, identity) {
  const current = await readJson(currentPath);
  return current.kind === "value" && identityMatches(current.value, identity);
}
async function writeExclusiveAtomic(path3, value) {
  await (0, import_promises.mkdir)((0, import_node_path6.dirname)(path3), { recursive: true });
  const candidate = `${path3}.candidate.${process.pid}.${(0, import_node_crypto5.randomUUID)()}`;
  const handle = await (0, import_promises.open)(candidate, "wx", 384);
  try {
    await handle.writeFile(JSON.stringify(value), "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await (0, import_promises.link)(candidate, path3);
  } finally {
    await (0, import_promises.unlink)(candidate).catch(() => void 0);
  }
}
async function writeExclusiveTextAtomic(path3, value) {
  await (0, import_promises.mkdir)((0, import_node_path6.dirname)(path3), { recursive: true });
  const candidate = `${path3}.candidate.${process.pid}.${(0, import_node_crypto5.randomUUID)()}`;
  const handle = await (0, import_promises.open)(candidate, "wx", 384);
  try {
    await handle.writeFile(value, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await (0, import_promises.link)(candidate, path3);
  } finally {
    await (0, import_promises.unlink)(candidate).catch(() => void 0);
  }
}
function parseExactInteger(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const negative = trimmed.startsWith("-");
  const magnitude = negative || trimmed.startsWith("+") ? trimmed.slice(1) : trimmed;
  const match = DECIMAL_INTEGER_TEXT.exec(magnitude);
  if (!match) return null;
  const integerDigits = match[1] ?? "";
  const fractionDigits = match[2] ?? match[3] ?? "";
  const exponent = match[4] === void 0 ? 0 : Number(match[4]);
  const shift = fractionDigits.length - exponent;
  if (shift > 0) {
    const significand = integerDigits + fractionDigits;
    if (/[1-9]/.test(significand)) {
      const trailingZeros = significand.length - significand.replace(/0+$/, "").length;
      if (trailingZeros < shift) return null;
    }
  }
  const parsed = (negative ? -1 : 1) * Number(magnitude);
  return Number.isSafeInteger(parsed) ? parsed : null;
}
function resolvePositiveInteger(value, fallback) {
  if (value == null || value.trim() === "") return fallback;
  const parsed = parseExactInteger(value);
  return parsed !== null && parsed > 0 ? parsed : fallback;
}
async function prepareWorkerLaunchAttempt(input) {
  const instanceId = input.instanceId;
  if (!isValidTeamInstanceId(instanceId)) throw new Error("worker_launch_instance_id_invalid");
  const attemptId = (0, import_node_crypto5.randomUUID)();
  const identity = {
    schema_version: WORKER_LAUNCH_SCHEMA_VERSION,
    attempt_id: attemptId,
    nonce: (0, import_node_crypto5.randomUUID)(),
    instance_id: instanceId,
    team_name: input.teamName,
    worker_name: input.workerName,
    pane_id: input.paneId,
    provider: input.provider,
    created_at: (/* @__PURE__ */ new Date()).toISOString()
  };
  const attempt = {
    ...identity,
    currentPath: absPath(input.cwd, TeamPaths.workerLaunchCurrent(input.teamName, input.workerName)),
    expectedPath: absPath(input.cwd, TeamPaths.workerLaunchExpected(input.teamName, input.workerName, attemptId)),
    ackPath: absPath(input.cwd, TeamPaths.workerLaunchAck(input.teamName, input.workerName, attemptId)),
    decisionPath: absPath(input.cwd, TeamPaths.workerLaunchDecision(input.teamName, input.workerName, attemptId)),
    startedPath: absPath(input.cwd, TeamPaths.workerLaunchStarted(input.teamName, input.workerName, attemptId)),
    transportOwnerPath: absPath(input.cwd, TeamPaths.workerLaunchTransportOwner(input.teamName, input.workerName, attemptId)),
    bootstrapDescriptorPath: absPath(input.cwd, TeamPaths.workerLaunchBootstrapDescriptor(input.teamName, input.workerName, attemptId)),
    wrapperPath: absPath(input.cwd, TeamPaths.workerLaunchWrapper(input.teamName, input.workerName, attemptId)),
    transportCleanupCompletePath: absPath(input.cwd, TeamPaths.workerLaunchTransportCleanupComplete(input.teamName, input.workerName, attemptId)),
    runtimeCliPath: input.runtimeCliPath,
    ...input.context ? { context: input.context } : {}
  };
  if ((0, import_node_fs4.existsSync)(attempt.expectedPath) || (0, import_node_fs4.existsSync)(attempt.ackPath) || (0, import_node_fs4.existsSync)(attempt.decisionPath) || (0, import_node_fs4.existsSync)(attempt.startedPath) || (0, import_node_fs4.existsSync)(attempt.transportOwnerPath) || (0, import_node_fs4.existsSync)(attempt.bootstrapDescriptorPath) || (0, import_node_fs4.existsSync)(attempt.wrapperPath) || (0, import_node_fs4.existsSync)(attempt.transportCleanupCompletePath)) {
    throw new Error("worker_launch_attempt_path_conflict");
  }
  await writeExclusiveAtomic(attempt.expectedPath, identity);
  try {
    await withFileLock(lockPathFor(attempt.currentPath), async () => {
      await atomicWriteJson(
        attempt.currentPath,
        {
          ...identity,
          runtime_cli_path: input.runtimeCliPath,
          ...input.context ? { context: input.context } : {}
        }
      );
    });
  } catch (error) {
    await (0, import_promises.unlink)(attempt.expectedPath).catch(() => void 0);
    throw error;
  }
  return attempt;
}
function buildWorkerLaunchBootstrapSpec(attempt, providerArgv, cwd, options = {}) {
  if (!isValidIdentity(attempt)) throw new Error("worker_launch_attempt_identity_invalid");
  if ((options.platform ?? process.platform) === "win32" && providerArgv[0] && isWindowsBatchProvider(providerArgv[0])) {
    buildWindowsBatchProviderLine(providerArgv);
  }
  const providerEnv = normalizeProviderEnvironment(options.providerEnv, options.platform ?? process.platform);
  const absoluteCwd = (0, import_node_path6.resolve)(cwd);
  const containmentNonce = (0, import_node_crypto5.randomUUID)();
  const supervisorSourceSha256 = (0, import_node_crypto5.createHash)("sha256").update(buildWindowsSupervisorSource(), "utf8").digest("hex");
  return {
    ...identityOf(attempt),
    current_path: attempt.currentPath,
    expected_path: attempt.expectedPath,
    ack_path: attempt.ackPath,
    decision_path: attempt.decisionPath,
    started_path: attempt.startedPath,
    transport_owner_path: attempt.transportOwnerPath,
    bootstrap_descriptor_path: attempt.bootstrapDescriptorPath,
    wrapper_path: attempt.wrapperPath,
    transport_cleanup_complete_path: attempt.transportCleanupCompletePath,
    provider_argv: [...providerArgv],
    provider_env: providerEnv,
    cwd: absoluteCwd,
    decision_timeout_ms: resolvePositiveInteger(process.env.OMC_TEAM_START_ACK_DECISION_TIMEOUT_MS, DEFAULT_DECISION_TIMEOUT_MS),
    release_after_spawn: options.releaseAfterSpawn === true,
    containment_nonce: containmentNonce,
    authority_digest: canonicalAuthorityDigest({ identity: attempt, providerArgv, providerEnv, cwd: absoluteCwd, containmentNonce, supervisorSourceSha256 }),
    supervisor_source_sha256: supervisorSourceSha256
  };
}
function attemptTransportPathsAreDeterministic(attempt) {
  const expectedRoot = (0, import_node_path6.dirname)(attempt.expectedPath);
  return isDeterministicTransportPath(attempt.expectedPath, attempt.transportOwnerPath, "transport-owner.json") && isDeterministicTransportPath(attempt.expectedPath, attempt.bootstrapDescriptorPath, WORKER_LAUNCH_BOOTSTRAP_DESCRIPTOR_FILE) && isDeterministicTransportPath(attempt.expectedPath, attempt.wrapperPath, "launch.cmd") && isDeterministicTransportPath(attempt.expectedPath, attempt.transportCleanupCompletePath, "transport-cleanup-complete.json") && (0, import_node_path6.resolve)(attempt.expectedPath) === (0, import_node_path6.resolve)((0, import_node_path6.join)(expectedRoot, "expected.json"));
}
function transportOwnerMatches(value, attempt, authorityDigest) {
  if (!identityMatches(value, attempt) || typeof value !== "object" || value === null || value.kind !== WORKER_LAUNCH_TRANSPORT_OWNER_KIND) return false;
  return authorityDigest === void 0 || value.authority_digest === authorityDigest;
}
function cleanupProofMatches(value, attempt) {
  return identityMatches(value, attempt) && typeof value === "object" && value !== null && value.kind === WORKER_LAUNCH_TRANSPORT_CLEANUP_KIND && isExactText(value.reason) && typeof value.written_at === "string" && Number.isFinite(Date.parse(value.written_at));
}
function windowsWrapperRelativePath(cwd, wrapperPath) {
  const relativePath = (0, import_node_path6.relative)((0, import_node_path6.resolve)(cwd), (0, import_node_path6.resolve)(wrapperPath)).replace(/\//g, "\\");
  if (!relativePath || relativePath.startsWith("\\") || /^[A-Za-z]:/.test(relativePath) || !/^[A-Za-z0-9._\\-]+$/.test(relativePath)) {
    throw new Error("worker_launch_transport_relative_path_invalid");
  }
  return relativePath;
}
function buildWorkerLaunchWrapper(attempt, platform = process.platform) {
  if (platform === "win32") {
    const runtimeCli2 = quoteWindowsBatchFileArgument(attempt.runtimeCliPath);
    const nodeExecutable2 = quoteWindowsBatchFileArgument(process.execPath);
    return [
      "@echo off",
      "setlocal DisableDelayedExpansion",
      'set "OMC_WORKER_LAUNCH_SPEC_FILE=%~dp0bootstrap.json"',
      `${nodeExecutable2} ${runtimeCli2} --worker-launch`,
      'set "_OMC_WORKER_LAUNCH_EXIT=%ERRORLEVEL%"',
      'del /f /q "%~f0" >nul 2>&1',
      "endlocal & exit /b %_OMC_WORKER_LAUNCH_EXIT%",
      ""
    ].join("\r\n");
  }
  const runtimeCli = quotePosixShellArgument(attempt.runtimeCliPath);
  const nodeExecutable = quotePosixShellArgument(process.execPath);
  return [
    "#!/bin/sh",
    "set -u",
    'omc_wrapper_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)',
    'export OMC_WORKER_LAUNCH_SPEC_FILE="$omc_wrapper_dir/bootstrap.json"',
    `${nodeExecutable} ${runtimeCli} --worker-launch`,
    "_omc_exit=$?",
    'rm -f -- "$0"',
    "exit $_omc_exit",
    ""
  ].join("\n");
}
function quotePosixShellArgument(value) {
  if (/[\r\n\0]/.test(value)) throw new Error("worker_launch_provider_argv_invalid");
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}
async function materializeWorkerLaunchTransport(input) {
  const { attempt } = input;
  if (!attemptTransportPathsAreDeterministic(attempt)) throw new Error("worker_launch_transport_paths_invalid");
  const spec = buildWorkerLaunchBootstrapSpec(attempt, input.providerArgv, input.cwd, {
    providerEnv: input.providerEnv,
    releaseAfterSpawn: input.releaseAfterSpawn,
    platform: input.platform
  });
  const windowsDelivery = input.windowsDelivery !== false;
  const owner = {
    ...identityOf(attempt),
    kind: WORKER_LAUNCH_TRANSPORT_OWNER_KIND,
    authority_digest: spec.authority_digest
  };
  const wrapperRelativePath = windowsDelivery ? windowsWrapperRelativePath(input.cwd, attempt.wrapperPath) : "";
  const wrapper = buildWorkerLaunchWrapper(attempt, windowsDelivery ? "win32" : input.platform ?? process.platform);
  let ownerCreated = false;
  let descriptorCreated = false;
  let wrapperCreated = false;
  try {
    await withFileLock(lockPathFor(attempt.currentPath), async () => {
      if (!await isCurrentLaunchIdentity(attempt.currentPath, attempt) || (await readJson(`${attempt.decisionPath}.retired`)).kind !== "absent") {
        throw new Error("worker_launch_attempt_inactive");
      }
      const existingOwner = await readJson(attempt.transportOwnerPath);
      if (existingOwner.kind === "malformed" || existingOwner.kind === "value" && !transportOwnerMatches(existingOwner.value, attempt, spec.authority_digest)) {
        throw new Error("worker_launch_transport_owner_conflict");
      }
      if (existingOwner.kind === "absent") {
        await writeExclusiveAtomic(attempt.transportOwnerPath, owner);
        ownerCreated = true;
      }
      if ((0, import_node_fs4.existsSync)(attempt.bootstrapDescriptorPath) || (0, import_node_fs4.existsSync)(attempt.wrapperPath)) {
        throw new Error("worker_launch_transport_path_conflict");
      }
      await writeExclusiveAtomic(attempt.bootstrapDescriptorPath, spec);
      descriptorCreated = true;
      await writeExclusiveTextAtomic(attempt.wrapperPath, wrapper);
      wrapperCreated = true;
    });
  } catch (error) {
    let cleanupVerified = true;
    if (wrapperCreated) {
      await (0, import_promises.unlink)(attempt.wrapperPath).catch(() => {
        cleanupVerified = false;
      });
      cleanupVerified &&= !(0, import_node_fs4.existsSync)(attempt.wrapperPath);
    }
    if (descriptorCreated) {
      await (0, import_promises.unlink)(attempt.bootstrapDescriptorPath).catch(() => {
        cleanupVerified = false;
      });
      cleanupVerified &&= !(0, import_node_fs4.existsSync)(attempt.bootstrapDescriptorPath);
    }
    if (ownerCreated) {
      await (0, import_promises.unlink)(attempt.transportOwnerPath).catch(() => {
        cleanupVerified = false;
      });
      cleanupVerified &&= !(0, import_node_fs4.existsSync)(attempt.transportOwnerPath);
    }
    if (!cleanupVerified) {
      const cleanupError = new Error("worker_launch_transport_partial_cleanup_unverified");
      cleanupError.cause = error;
      throw cleanupError;
    }
    throw error;
  }
  return {
    wrapperPath: attempt.wrapperPath,
    bootstrapDescriptorPath: attempt.bootstrapDescriptorPath,
    wrapperRelativePath
  };
}
async function cleanupWorkerLaunchTransportUnlocked(attempt, reason) {
  const owner = await readJson(attempt.transportOwnerPath);
  const proof = await readJson(attempt.transportCleanupCompletePath);
  if (owner.kind === "malformed" || proof.kind === "malformed") return false;
  if (owner.kind === "value" && !transportOwnerMatches(owner.value, attempt)) return false;
  if (proof.kind === "value" && !cleanupProofMatches(proof.value, attempt)) return false;
  const hasTransportFiles = (0, import_node_fs4.existsSync)(attempt.bootstrapDescriptorPath) || (0, import_node_fs4.existsSync)(attempt.wrapperPath);
  if (owner.kind === "absent") {
    return !hasTransportFiles && (proof.kind === "absent" || cleanupProofMatches(proof.value, attempt));
  }
  await (0, import_promises.unlink)(attempt.bootstrapDescriptorPath).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
  await (0, import_promises.unlink)(attempt.wrapperPath).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
  if ((0, import_node_fs4.existsSync)(attempt.bootstrapDescriptorPath) || (0, import_node_fs4.existsSync)(attempt.wrapperPath)) return false;
  if (proof.kind === "absent") {
    await writeExclusiveAtomic(attempt.transportCleanupCompletePath, {
      ...identityOf(attempt),
      kind: WORKER_LAUNCH_TRANSPORT_CLEANUP_KIND,
      reason,
      written_at: (/* @__PURE__ */ new Date()).toISOString()
    });
  }
  const completed = await readJson(attempt.transportCleanupCompletePath);
  return completed.kind === "value" && cleanupProofMatches(completed.value, attempt) && !(0, import_node_fs4.existsSync)(attempt.bootstrapDescriptorPath) && !(0, import_node_fs4.existsSync)(attempt.wrapperPath);
}
async function cleanupWorkerLaunchTransport(attempt, reason = "transport_cleanup") {
  if (!attemptTransportPathsAreDeterministic(attempt)) return false;
  try {
    return await withFileLock(
      lockPathFor(attempt.currentPath),
      () => cleanupWorkerLaunchTransportUnlocked(attempt, reason),
      { timeoutMs: 5e3, retryDelayMs: 10 }
    );
  } catch {
    return false;
  }
}
async function publishDecision(attempt, decision, reason) {
  const record = {
    ...identityOf(attempt),
    kind: "worker_launch_decision",
    decision,
    reason,
    written_at: (/* @__PURE__ */ new Date()).toISOString()
  };
  try {
    await writeExclusiveAtomic(attempt.decisionPath, record);
    return true;
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const existing = await readJson(attempt.decisionPath);
    return existing.kind === "value" && identityMatches(existing.value, attempt) && existing.value.kind === "worker_launch_decision" && existing.value.decision === decision;
  }
}
async function revokeWorkerLaunchAttempt(attempt, reason) {
  return publishDecision(attempt, "revoked", reason).catch(() => false);
}
async function rejectWorkerLaunchAttempt(attempt, reason) {
  return await revokeWorkerLaunchAttempt(attempt, reason) ? { ok: false, reason } : { ok: false, reason: "decision_conflict" };
}
function acknowledgementResult(value, attempt) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, reason: "ack_malformed" };
  const record = value;
  if (record.kind !== "worker_launch_ack" || typeof record.written_at !== "string" || !Number.isFinite(Date.parse(record.written_at))) return { ok: false, reason: "ack_malformed" };
  return identityMatches(record, attempt) ? null : { ok: false, reason: "ack_mismatch" };
}
async function acceptObservedAcknowledgement(attempt, read) {
  if (read.kind === "absent") return null;
  if (read.kind === "malformed") return { ok: false, reason: "ack_malformed" };
  const invalid = acknowledgementResult(read.value, attempt);
  if (invalid) return invalid;
  try {
    return await withFileLock(lockPathFor(attempt.currentPath), async () => {
      if (!await isCurrentLaunchIdentity(attempt.currentPath, attempt)) {
        return { ok: false, reason: "attempt_superseded" };
      }
      return await publishDecision(attempt, "accepted", "ack_valid") ? { ok: true } : { ok: false, reason: "decision_conflict" };
    });
  } catch {
    return { ok: false, reason: "decision_conflict" };
  }
}
async function awaitWorkerLaunchAcknowledgement(attempt, options = {}) {
  const expected = await readJson(attempt.expectedPath);
  if (expected.kind !== "value" || !identityMatches(expected.value, attempt)) {
    return rejectWorkerLaunchAttempt(attempt, "expected_record_invalid");
  }
  const timeoutMs = options.timeoutMs ?? resolvePositiveInteger(process.env.OMC_TEAM_START_ACK_TIMEOUT_MS, DEFAULT_ACK_TIMEOUT_MS);
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await acceptObservedAcknowledgement(attempt, await readJson(attempt.ackPath));
    if (result) {
      return result.ok ? result : rejectWorkerLaunchAttempt(attempt, result.reason);
    }
    await sleep2(pollIntervalMs);
  }
  const finalResult = await acceptObservedAcknowledgement(attempt, await readJson(attempt.ackPath));
  if (finalResult) {
    return finalResult.ok ? finalResult : rejectWorkerLaunchAttempt(attempt, finalResult.reason);
  }
  return rejectWorkerLaunchAttempt(attempt, "ack_timeout");
}
async function isWorkerLaunchAttemptAccepted(attempt) {
  const decision = await readJson(attempt.decisionPath);
  return decision.kind === "value" && identityMatches(decision.value, attempt) && decision.value.kind === "worker_launch_decision" && decision.value.decision === "accepted";
}
async function isWorkerLaunchAttemptCurrent(attempt) {
  try {
    return await withFileLock(lockPathFor(attempt.currentPath), () => isCurrentLaunchIdentity(attempt.currentPath, attempt));
  } catch {
    return false;
  }
}
async function retireAndCleanupCurrentWorkerLaunchAttempt(attempt, reason, cleanup) {
  const retiredPath = `${attempt.decisionPath}.retired`;
  const cleanupCompletePath = `${retiredPath}.cleanup-complete`;
  const finalizeCleanupUnlocked = () => finishWorkerLaunchRetirementCleanupUnlocked(attempt);
  const finalizeCleanup = async () => {
    try {
      return await withFileLock(
        lockPathFor(attempt.currentPath),
        finalizeCleanupUnlocked,
        { timeoutMs: 1e4, retryDelayMs: 10 }
      );
    } catch {
      return "failed";
    }
  };
  const existingCleanup = await readWorkerLaunchRetirementCleanupState(attempt);
  if (existingCleanup === "valid") {
    return await finalizeCleanup() === "complete";
  }
  if (existingCleanup === "invalid") return false;
  try {
    return await withFileLock(lockPathFor(attempt.currentPath), async () => {
      if (!await isCurrentLaunchIdentity(attempt.currentPath, attempt)) {
        return await finalizeCleanupUnlocked() === "complete";
      }
      if (!await isWorkerLaunchAttemptAccepted(attempt)) return false;
      const existing = await readJson(retiredPath);
      if (existing.kind === "value") {
        if (!identityMatches(existing.value, attempt)) return false;
      } else if (existing.kind === "malformed") {
        return false;
      } else {
        await writeExclusiveAtomic(retiredPath, {
          ...identityOf(attempt),
          kind: "worker_launch_retired",
          reason,
          written_at: (/* @__PURE__ */ new Date()).toISOString()
        });
      }
      if (!await terminateWorkerLaunchProvider(attempt)) return false;
      if (!await cleanup()) return false;
      if (!await cleanupWorkerLaunchTransportUnlocked(attempt, reason)) return false;
      const completed = await readJson(cleanupCompletePath);
      if (completed.kind === "absent") {
        await writeExclusiveAtomic(cleanupCompletePath, {
          ...identityOf(attempt),
          kind: "worker_launch_cleanup_complete",
          reason,
          written_at: (/* @__PURE__ */ new Date()).toISOString()
        });
      } else if (completed.kind !== "value" || !identityMatches(completed.value, attempt) || completed.value.kind !== "worker_launch_cleanup_complete") return false;
      return await finalizeCleanupUnlocked() === "complete";
    }, { timeoutMs: 1e4, retryDelayMs: 10 });
  } catch {
    return false;
  }
}
async function readWorkerLaunchRetirementCleanupState(attempt) {
  const completed = await readJson(`${attempt.decisionPath}.retired.cleanup-complete`);
  if (completed.kind === "absent") return "absent";
  if (completed.kind !== "value" || !identityMatches(completed.value, attempt) || completed.value.kind !== "worker_launch_cleanup_complete") return "invalid";
  return "valid";
}
async function finishWorkerLaunchRetirementCleanupUnlocked(attempt) {
  const cleanupState = await readWorkerLaunchRetirementCleanupState(attempt);
  if (cleanupState === "absent") return "pending";
  if (cleanupState === "invalid") return "failed";
  const current = await readJson(attempt.currentPath);
  if (current.kind === "absent") return "complete";
  if (current.kind !== "value") return "failed";
  if (!identityMatches(current.value, attempt)) return "complete";
  try {
    await (0, import_promises.unlink)(attempt.currentPath);
  } catch (error) {
    if (error.code !== "ENOENT") return "failed";
  }
  const remaining = await readJson(attempt.currentPath);
  if (remaining.kind === "absent") return "complete";
  return remaining.kind === "value" && !identityMatches(remaining.value, attempt) ? "complete" : "failed";
}
function isValidProcessStartIdentity(value) {
  if (typeof value !== "string" || value.length > 1024) return false;
  if (/^\d+$/.test(value) || /^ticks:\d+$/.test(value) || /^dmtf:\d{14}\.\d{6}[+-]\d{3}$/.test(value)) return true;
  if (/^linux:[1-9]\d*$/.test(value) || /^win32:[1-9]\d*$/.test(value)) return true;
  const darwin = /^darwin:([1-9]\d*):(\d+)$/.exec(value);
  return darwin !== null && Number(darwin[2]) < 1e6;
}
async function readWorkerLaunchCleanupProof(attempt, started) {
  const startedPath = "startedPath" in attempt ? attempt.startedPath : attempt.started_path;
  const matchesProcessGroup = (value) => {
    if (process.platform === "win32") return true;
    if (!Number.isSafeInteger(value.process_group_id) || Number(value.process_group_id) <= 0) return false;
    return started === void 0 || Number.isSafeInteger(started.process_group_id) && Number(started.process_group_id) > 0 && value.process_group_id === started.process_group_id;
  };
  const terminal = await readJson(`${startedPath}.terminal`);
  if (terminal.kind === "value" && terminal.value && typeof terminal.value === "object" && !Array.isArray(terminal.value)) {
    const value = terminal.value;
    const matchesStarted = !started || value.pid === started.pid && value.process_start_identity === started.process_start_identity;
    if (matchesStarted && identityMatches(value, attempt) && value.kind === "worker_launch_provider_terminal" && value.outcome === "exit" && value.cleanup_verified === true && Number.isSafeInteger(value.pid) && Number(value.pid) > 0 && isValidProcessStartIdentity(value.process_start_identity) && (process.platform === "win32" || value.child_reaped === void 0 || value.child_reaped === true) && matchesProcessGroup(value)) return true;
  }
  const completed = await readJson(`${startedPath}.termination-complete`);
  if (completed.kind === "value" && completed.value && typeof completed.value === "object" && !Array.isArray(completed.value)) {
    const value = completed.value;
    const matchesStarted = !started || value.pid === started.pid && value.process_start_identity === started.process_start_identity;
    if (matchesStarted && identityMatches(value, attempt) && value.kind === "worker_launch_termination_complete" && value.cleanup_verified === true && Number.isSafeInteger(value.pid) && Number(value.pid) > 0 && isValidProcessStartIdentity(value.process_start_identity) && matchesProcessGroup(value)) return true;
  }
  return false;
}
async function readWorkerLaunchTerminalState(attempt, started) {
  const terminal = await readJson(`${attempt.startedPath}.terminal`);
  if (terminal.kind === "absent") return "absent";
  if (terminal.kind !== "value") return "invalid";
  if (!terminal.value || typeof terminal.value !== "object" || Array.isArray(terminal.value)) return "invalid";
  const value = terminal.value;
  if (!identityMatches(value, attempt) || value.kind !== "worker_launch_provider_terminal" || value.pid !== started.pid || value.process_start_identity !== started.process_start_identity || !Number.isSafeInteger(value.pid) || Number(value.pid) <= 0 || !isValidProcessStartIdentity(value.process_start_identity)) return "invalid";
  if (process.platform === "win32") {
    if (typeof value.cleanup_verified !== "boolean") return "invalid";
    if (value.outcome === "exit" && value.cleanup_verified === true) return "reaped";
    if (value.outcome === "cleanup_unverified" && value.cleanup_verified === false) return "live-unreaped";
    return "invalid";
  }
  const matchesProcessGroup = Number.isSafeInteger(started.process_group_id) && Number(started.process_group_id) > 0 && value.process_group_id === started.process_group_id;
  if (!matchesProcessGroup || typeof value.cleanup_verified !== "boolean") return "invalid";
  if (value.child_reaped === void 0) {
    return value.outcome === "exit" && value.cleanup_verified === true ? "reaped" : "invalid";
  }
  if (typeof value.child_reaped !== "boolean") return "invalid";
  if (value.child_reaped === true && (value.outcome === "exit" || value.outcome === "cleanup_unverified")) return "reaped";
  if (value.child_reaped === false && value.outcome === "cleanup_unverified" && value.cleanup_verified === false) return "live-unreaped";
  return "invalid";
}
async function terminateWorkerLaunchProvider(attempt, timeoutMs = 2e3) {
  const started = await readJson(attempt.startedPath);
  const terminalCleanupVerified = await readWorkerLaunchCleanupProof(
    attempt,
    started.kind === "value" ? started.value : void 0
  );
  if (started.kind === "absent") return terminalCleanupVerified;
  if (started.kind !== "value") return false;
  const record = started.value;
  if (!identityMatches(record, attempt) || record.kind !== "worker_launch_provider_started" || !Number.isSafeInteger(record.pid) || Number(record.pid) <= 0 || !isValidProcessStartIdentity(record.process_start_identity)) return false;
  if (terminalCleanupVerified) return true;
  if (process.platform !== "win32") {
    const terminalState2 = await readWorkerLaunchTerminalState(attempt, record);
    if (terminalState2 === "reaped" || terminalState2 === "invalid") {
      return await readWorkerLaunchCleanupProof(attempt, record);
    }
  }
  if (process.platform !== "win32" && (!Number.isSafeInteger(record.process_group_id) || Number(record.process_group_id) <= 0)) return false;
  const terminationRequestPath = `${attempt.startedPath}.termination-request`;
  const terminationCompletePath = `${attempt.startedPath}.termination-complete`;
  const existingRequest = await readJson(terminationRequestPath);
  if (process.platform === "win32") {
    if (existingRequest.kind === "absent") {
      try {
        await writeExclusiveAtomic(terminationRequestPath, {
          ...identityOf(attempt),
          kind: "worker_launch_termination_request",
          operation: "terminate",
          pid: record.pid,
          process_start_identity: record.process_start_identity,
          authority_digest: record.authority_digest ?? "",
          containment_nonce: record.containment_nonce ?? attempt.nonce,
          written_at: (/* @__PURE__ */ new Date()).toISOString()
        });
      } catch {
        return false;
      }
    } else if (existingRequest.kind !== "value") return false;
    else {
      const request = existingRequest.value;
      if (!identityMatches(request, attempt) || request.kind !== "worker_launch_termination_request" || request.operation !== "terminate" || request.pid !== record.pid || request.process_start_identity !== record.process_start_identity || request.authority_digest !== (record.authority_digest ?? "") || request.containment_nonce !== (record.containment_nonce ?? attempt.nonce)) return false;
    }
    const deadline2 = Date.now() + timeoutMs;
    while (Date.now() < deadline2) {
      const complete = await readJson(terminationCompletePath);
      if (complete.kind === "value") {
        const proof = complete.value;
        if (identityMatches(proof, attempt) && proof.kind === "worker_launch_termination_complete" && proof.cleanup_verified === true && proof.pid === record.pid && proof.process_start_identity === record.process_start_identity && proof.authority_digest === record.authority_digest && proof.containment_nonce === record.containment_nonce) return true;
      }
      await sleep2(20);
    }
    return false;
  }
  if (existingRequest.kind === "absent") {
    try {
      await writeExclusiveAtomic(terminationRequestPath, {
        ...identityOf(attempt),
        kind: "worker_launch_termination_request",
        pid: record.pid,
        process_start_identity: record.process_start_identity,
        containment_nonce: record.containment_nonce ?? attempt.nonce,
        written_at: (/* @__PURE__ */ new Date()).toISOString()
      });
    } catch {
      return false;
    }
  } else {
    const value = existingRequest.kind === "value" ? existingRequest.value : null;
    if (!value || !identityMatches(value, attempt) || value.kind !== "worker_launch_termination_request" || value.pid !== record.pid || value.process_start_identity !== record.process_start_identity) return false;
  }
  const terminalState = await readWorkerLaunchTerminalState(attempt, record);
  if (terminalState === "reaped" || terminalState === "invalid") {
    return await readWorkerLaunchCleanupProof(attempt, record);
  }
  const deadlineAt = new Date(Date.now() + timeoutMs).toISOString();
  const result = await terminateOwnedProcessGroup({
    pid: record.pid,
    expectedStartIdentity: record.process_start_identity,
    processGroupId: record.process_group_id,
    deadlineAt,
    force: true
  });
  if (result === "already-dead" || result === "identity-mismatch") {
    return await readWorkerLaunchCleanupProof(attempt, record);
  }
  if (result !== "terminated") return false;
  const deadline = Date.parse(deadlineAt);
  while (Date.now() < deadline) {
    const liveness = await isProcessIdentityLive(record.pid, record.process_start_identity, deadline);
    if ((liveness === "dead" || liveness === "mismatch") && isProcessGroupAbsent(record.process_group_id)) {
      return publishWorkerLaunchTerminationComplete(terminationCompletePath, attempt, record);
    }
    if (liveness === "unknown") return false;
    await sleep2(20);
  }
  return false;
}
function isProcessGroupAbsent(processGroupId) {
  if (process.platform === "win32" || !Number.isSafeInteger(processGroupId) || Number(processGroupId) <= 0) return false;
  try {
    process.kill(-Number(processGroupId), 0);
    return false;
  } catch (error) {
    return error.code === "ESRCH";
  }
}
async function publishWorkerLaunchTerminationComplete(terminationCompletePath, attempt, record) {
  const existingComplete = await readJson(terminationCompletePath);
  if (existingComplete.kind === "absent") {
    try {
      await writeExclusiveAtomic(terminationCompletePath, {
        ...identityOf(attempt),
        kind: "worker_launch_termination_complete",
        cleanup_verified: true,
        pid: record.pid,
        process_start_identity: record.process_start_identity,
        ...process.platform !== "win32" ? { process_group_id: record.process_group_id } : {},
        written_at: (/* @__PURE__ */ new Date()).toISOString()
      });
      return true;
    } catch {
      return false;
    }
  }
  const value = existingComplete.kind === "value" ? existingComplete.value : null;
  return !!value && identityMatches(value, attempt) && value.kind === "worker_launch_termination_complete" && value.cleanup_verified === true && value.pid === record.pid && value.process_start_identity === record.process_start_identity && (process.platform === "win32" || value.process_group_id === record.process_group_id);
}
async function readValidProviderStarted(attempt, options = {}) {
  const started = await readJson(attempt.startedPath);
  if (!options.allowTerminal && (await readJson(`${attempt.startedPath}.terminal`)).kind !== "absent") return null;
  if (started.kind !== "value") return null;
  if (!started.value || typeof started.value !== "object" || Array.isArray(started.value)) return null;
  const record = started.value;
  if (!options.allowSupervisorCompletion && record.supervisor_completion_path !== void 0 && (typeof record.supervisor_completion_path !== "string" || record.supervisor_completion_path.trim().length === 0 || (0, import_node_fs4.existsSync)(record.supervisor_completion_path))) return null;
  if (options.allowSupervisorCompletion && record.supervisor_completion_path !== void 0 && (typeof record.supervisor_completion_path !== "string" || record.supervisor_completion_path.trim().length === 0)) return null;
  return identityMatches(record, attempt) && record.kind === "worker_launch_provider_started" && Number.isSafeInteger(record.pid) && record.pid > 0 && typeof record.process_start_identity === "string" && record.process_start_identity.trim().length > 0 && (record.containment_nonce === void 0 || isExactText(record.containment_nonce)) && typeof record.written_at === "string" && Number.isFinite(Date.parse(record.written_at)) ? record : null;
}
async function awaitWorkerLaunchProviderStarted(attempt, options = {}) {
  const timeoutMs = options.timeoutMs ?? resolvePositiveInteger(process.env.OMC_TEAM_START_ACK_TIMEOUT_MS, DEFAULT_ACK_TIMEOUT_MS);
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const published = await readValidProviderStarted(attempt);
    if (published) try {
      const handedOff = await withFileLock(lockPathFor(attempt.currentPath), async () => {
        if (!await isCurrentLaunchIdentity(attempt.currentPath, attempt) || !await isWorkerLaunchAttemptAccepted(attempt)) return false;
        const started = await readValidProviderStarted(attempt);
        if (!started) return false;
        return await isProcessIdentityLive(
          started.pid,
          started.process_start_identity,
          deadline
        ) === "live";
      });
      if (handedOff) return true;
    } catch {
    }
    if ((await readJson(`${attempt.decisionPath}.retired`)).kind !== "absent") return false;
    await sleep2(pollIntervalMs);
  }
  return false;
}
function isDeterministicTransportPath(expectedPath, candidate, fileName) {
  return isExactText(candidate) && (0, import_node_path6.resolve)(candidate) === (0, import_node_path6.resolve)((0, import_node_path6.join)((0, import_node_path6.dirname)(expectedPath), fileName));
}
function quoteWindowsCmdArgument(value) {
  if (/[\x00-\x1f]/.test(value)) throw new Error("worker_launch_provider_argv_invalid");
  const escaped = value.replace(/(\\*)"/g, '$1$1""').replace(/(\\+)$/, "$1$1");
  return `"${escaped}"`;
}
function quoteWindowsBatchFileArgument(value) {
  return quoteWindowsCmdArgument(value).replace(/%/g, "%%");
}
function isWindowsBatchProvider(command) {
  return /\.(cmd|bat)[. ]*$/i.test(command);
}
function buildWindowsBatchProviderLine(providerArgv) {
  const line = providerArgv.map(quoteWindowsCmdArgument).join(" ");
  if (line.length > WINDOWS_PROVIDER_LINE_MAX) throw new Error("worker_launch_provider_argv_too_long");
  return line;
}
var import_node_crypto5, import_node_fs4, import_promises, import_node_path6, WORKER_LAUNCH_SCHEMA_VERSION, DEFAULT_ACK_TIMEOUT_MS, DEFAULT_POLL_INTERVAL_MS, DEFAULT_DECISION_TIMEOUT_MS, WORKER_LAUNCH_TRANSPORT_OWNER_KIND, WORKER_LAUNCH_TRANSPORT_CLEANUP_KIND, WORKER_LAUNCH_BOOTSTRAP_DESCRIPTOR_FILE, WORKER_LAUNCH_RECOVERY_GATE_CONTAINED_ENV, WORKER_LAUNCH_INTERNAL_ENV_KEYS, WORKER_LAUNCH_AUTHORITY_PROTOCOL, WINDOWS_SUPERVISOR_PROTOCOL, WINDOWS_PROVIDER_LINE_MAX, WINDOWS_PROVIDER_LINE_VAR, WINDOWS_NO_CWD_EXE_SEARCH_VAR, WINDOWS_RESERVED_ENV_KEYS, SAFE_BASELINE_ENV_KEYS, DECIMAL_INTEGER_TEXT;
var init_worker_launch_ack = __esm({
  "src/team/worker-launch-ack.ts"() {
    "use strict";
    import_node_crypto5 = require("node:crypto");
    import_node_fs4 = require("node:fs");
    import_promises = require("node:fs/promises");
    import_node_path6 = require("node:path");
    init_process_utils();
    init_types3();
    init_state_paths();
    init_atomic_write();
    init_file_lock();
    init_host_load_gate();
    WORKER_LAUNCH_SCHEMA_VERSION = 1;
    DEFAULT_ACK_TIMEOUT_MS = 8e3;
    DEFAULT_POLL_INTERVAL_MS = 25;
    DEFAULT_DECISION_TIMEOUT_MS = 15e3;
    WORKER_LAUNCH_TRANSPORT_OWNER_KIND = "worker_launch_transport_owner";
    WORKER_LAUNCH_TRANSPORT_CLEANUP_KIND = "worker_launch_transport_cleanup_complete";
    WORKER_LAUNCH_BOOTSTRAP_DESCRIPTOR_FILE = "bootstrap.json";
    WORKER_LAUNCH_RECOVERY_GATE_CONTAINED_ENV = "OMC_WORKER_LAUNCH_RECOVERY_GATE_CONTAINED";
    WORKER_LAUNCH_INTERNAL_ENV_KEYS = /* @__PURE__ */ new Set([
      "OMC_WORKER_LAUNCH_SPEC",
      "OMC_WORKER_LAUNCH_SPEC_B64",
      "OMC_WORKER_LAUNCH_SPEC_FILE",
      WORKER_LAUNCH_RECOVERY_GATE_CONTAINED_ENV
    ]);
    WORKER_LAUNCH_AUTHORITY_PROTOCOL = "worker-launch-authority-v1";
    WINDOWS_SUPERVISOR_PROTOCOL = "worker-launch-windows-supervisor-v1";
    WINDOWS_PROVIDER_LINE_MAX = 8e3;
    WINDOWS_PROVIDER_LINE_VAR = "_OMC_PROVIDER_LINE";
    WINDOWS_NO_CWD_EXE_SEARCH_VAR = "NoDefaultCurrentDirectoryInExePath";
    WINDOWS_RESERVED_ENV_KEYS = new Set([...WORKER_LAUNCH_INTERNAL_ENV_KEYS, "SystemRoot"].map((key) => key.toUpperCase()));
    SAFE_BASELINE_ENV_KEYS = ["PATH", "TEMP", "TMP", "TERM", "COLORTERM"];
    DECIMAL_INTEGER_TEXT = /^(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/;
  }
});

// src/team/process-identity-lock.ts
var init_process_identity_lock = __esm({
  "src/team/process-identity-lock.ts"() {
    "use strict";
    init_team_owner_epoch();
  }
});

// src/team/recovery-request-store.ts
var RETENTION_MS;
var init_recovery_request_store = __esm({
  "src/team/recovery-request-store.ts"() {
    "use strict";
    init_types3();
    init_state_paths();
    init_process_identity_lock();
    RETENTION_MS = 7 * 24 * 60 * 60 * 1e3;
  }
});

// src/team/contracts.ts
var init_contracts = __esm({
  "src/team/contracts.ts"() {
    "use strict";
  }
});

// src/team/fs-utils.ts
var init_fs_utils = __esm({
  "src/team/fs-utils.ts"() {
    "use strict";
  }
});

// src/lib/worktree-cleanup-safety.ts
var init_worktree_cleanup_safety = __esm({
  "src/lib/worktree-cleanup-safety.ts"() {
    "use strict";
  }
});

// src/team/git-worktree.ts
var init_git_worktree = __esm({
  "src/team/git-worktree.ts"() {
    "use strict";
    init_fs_utils();
    init_worktree_cleanup_safety();
    init_tmux_session();
    init_file_lock();
    init_state_paths();
    init_contracts();
  }
});

// src/team/team-instance.ts
var init_team_instance = __esm({
  "src/team/team-instance.ts"() {
    "use strict";
    init_contracts();
    init_state_paths();
    init_process_identity_lock();
    init_git_worktree();
    init_team_owner_epoch();
    init_types3();
  }
});

// src/team/governance.ts
var init_governance = __esm({
  "src/team/governance.ts"() {
    "use strict";
    init_types3();
  }
});

// src/team/worker-canonicalization.ts
var init_worker_canonicalization = __esm({
  "src/team/worker-canonicalization.ts"() {
    "use strict";
  }
});

// src/team/monitor.ts
var init_monitor = __esm({
  "src/team/monitor.ts"() {
    "use strict";
    init_types();
    init_contracts();
    init_state_paths();
    init_process_identity_lock();
    init_git_worktree();
    init_governance();
    init_worker_canonicalization();
    init_team_instance();
    init_types3();
  }
});

// src/team/runtime-owner-client.ts
function resolveRuntimeCliPath() {
  if (process.env.OMC_RUNTIME_CLI_PATH) return process.env.OMC_RUNTIME_CLI_PATH;
  if (typeof __dirname !== "undefined" && __dirname) {
    return (0, import_node_path7.basename)(__dirname) === "bridge" ? (0, import_node_path7.join)(__dirname, "runtime-cli.cjs") : (0, import_node_path7.join)(__dirname, "../../bridge/runtime-cli.cjs");
  }
  const entry = process.argv[1];
  if (entry && (0, import_node_path7.basename)(entry) === "runtime-cli.cjs") return entry;
  throw new Error("runtime_owner_bootstrap_path_unavailable");
}
var import_node_path7;
var init_runtime_owner_client = __esm({
  "src/team/runtime-owner-client.ts"() {
    "use strict";
    import_node_path7 = require("node:path");
    init_recovery_request_store();
    init_state_paths();
    init_team_instance();
    init_team_owner_epoch();
    init_types3();
    init_process_identity_lock();
    init_monitor();
  }
});

// src/team/tmux-session.ts
var tmux_session_exports = {};
__export(tmux_session_exports, {
  TMUX_MAILBOX_PANE_ID: () => TMUX_MAILBOX_PANE_ID,
  TMUX_MAILBOX_TARGET: () => TMUX_MAILBOX_TARGET,
  TeamSessionCreationError: () => TeamSessionCreationError,
  adoptWorkerPaneOwnership: () => adoptWorkerPaneOwnership,
  applyMainVerticalLayout: () => applyMainVerticalLayout,
  buildDetachedTmuxServerKeepaliveArgs: () => buildDetachedTmuxServerKeepaliveArgs,
  buildPrivateTmuxSocketPath: () => buildPrivateTmuxSocketPath,
  buildWorkerLaunchSpec: () => buildWorkerLaunchSpec,
  buildWorkerStartCommand: () => buildWorkerStartCommand,
  captureOwnedTeamPane: () => captureOwnedTeamPane,
  captureTeamPane: () => captureTeamPane,
  captureTmuxServerIdentity: () => captureTmuxServerIdentity,
  createTeamSession: () => createTeamSession,
  deliverStartupInbox: () => deliverStartupInbox,
  detectPaneTrustPromptKind: () => detectPaneTrustPromptKind,
  detectTeamMultiplexerContext: () => detectTeamMultiplexerContext,
  getDefaultShell: () => getDefaultShell,
  getOwnedWorkerLiveness: () => getOwnedWorkerLiveness,
  getWorkerLiveness: () => getWorkerLiveness,
  injectToLeaderPane: () => injectToLeaderPane,
  invokeDirectMailboxEffect: () => invokeDirectMailboxEffect,
  isCmuxSurfaceTarget: () => isCmuxSurfaceTarget,
  isHerdrPaneId: () => isHerdrPaneId,
  isHerdrSessionTarget: () => isHerdrSessionTarget,
  isPosixTmuxSession: () => isPosixTmuxSession,
  isSessionAlive: () => isSessionAlive,
  isUnixLikeOnWindows: () => isUnixLikeOnWindows2,
  isWorkerAlive: () => isWorkerAlive,
  killOwnedWorkerPane: () => killOwnedWorkerPane,
  killTeamPane: () => killTeamPane,
  killTeamSession: () => killTeamSession,
  listActiveSessions: () => listActiveSessions,
  normalizeDetachedSessionTarget: () => normalizeDetachedSessionTarget,
  observeTeamSessionTargetPresence: () => observeTeamSessionTargetPresence,
  observeTmuxServerIdentity: () => observeTmuxServerIdentity,
  paneCopyModeObservation: () => paneCopyModeObservation,
  paneHasActiveTask: () => paneHasActiveTask,
  paneHasTrustPrompt: () => paneHasTrustPrompt,
  paneLooksReady: () => paneLooksReady,
  powershellQuote: () => powershellQuote,
  probeStartupPaneActivity: () => probeStartupPaneActivity,
  proveWorkerPaneOwnership: () => proveWorkerPaneOwnership,
  providerForTeamTarget: () => providerForTeamTarget,
  redactBoundedDiagnostic: () => redactBoundedDiagnostic,
  resolveShellFromCandidates: () => resolveShellFromCandidates,
  resolveSplitPaneWorkerPaneIds: () => resolveSplitPaneWorkerPaneIds,
  resolveSupportedShellAffinity: () => resolveSupportedShellAffinity,
  resolveTeamMultiplexer: () => resolveTeamMultiplexer,
  resolveTeamShellReadyTimeoutMs: () => resolveTeamShellReadyTimeoutMs,
  resolveTeamStartSubmitTimeoutMs: () => resolveTeamStartSubmitTimeoutMs,
  retryStartupInboxSubmit: () => retryStartupInboxSubmit,
  runTmuxServerIdentityGuard: () => runTmuxServerIdentityGuard,
  sanitizeName: () => sanitizeName,
  sendTeamPaneKey: () => sendTeamPaneKey,
  sendToWorker: () => sendToWorker,
  sessionName: () => sessionName,
  shellQuote: () => shellQuote,
  shouldAttemptAdaptiveRetry: () => shouldAttemptAdaptiveRetry,
  spawnOwnedWorkerInPane: () => spawnOwnedWorkerInPane,
  spawnWorkerInPane: () => spawnWorkerInPane,
  splitTeamWorkerPane: () => splitTeamWorkerPane,
  splitTeamWorkerPaneWithEvidence: () => splitTeamWorkerPaneWithEvidence,
  strictIdentityUnavailableError: () => strictIdentityUnavailableError,
  tmuxServerGuardCondition: () => tmuxServerGuardCondition,
  tmuxServerGuardConditionPosix: () => tmuxServerGuardConditionPosix,
  tmuxServerGuardConditionPowerShell: () => tmuxServerGuardConditionPowerShell,
  validateTmux: () => validateTmux,
  verifyTeamTargetOwnership: () => verifyTeamTargetOwnership,
  waitForPaneReady: () => waitForPaneReady,
  waitForStartupPaneReady: () => waitForStartupPaneReady,
  workerPaneBelongsToOwnedProviderTarget: () => workerPaneBelongsToOwnedProviderTarget,
  workerPaneBelongsToProviderTarget: () => workerPaneBelongsToProviderTarget,
  workerPaneShellCommand: () => workerPaneShellCommand
});
function tmuxArgsForIdentity(identity, args) {
  return ["-S", identity.socket_path, ...args];
}
function buildDetachedTmuxServerKeepaliveArgs(socketPath) {
  if (!(0, import_path15.isAbsolute)(socketPath) && !import_path15.win32.isAbsolute(socketPath)) {
    throw new Error("tmux_private_socket_path_not_absolute");
  }
  return [
    "-S",
    socketPath,
    "start-server",
    ";",
    "set-option",
    "-g",
    "exit-empty",
    "off"
  ];
}
function buildPrivateTmuxSocketPath() {
  const socketDirectory = process.platform === "darwin" || process.platform === "linux" ? "/tmp" : (0, import_os4.tmpdir)();
  const socketPath = (0, import_path15.join)(
    socketDirectory,
    `o-${process.pid.toString(36)}-${Date.now().toString(36)}-${(0, import_crypto5.randomUUID)().slice(0, 8)}.sock`
  );
  if (Buffer.byteLength(socketPath, "utf8") >= 104) {
    throw new Error("tmux_private_socket_path_too_long");
  }
  return socketPath;
}
function tmuxFormatEscape(value) {
  return value.replace(/#/g, "##");
}
function shellQuote(value) {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}
function powershellQuote(value) {
  const escaped = value.replace(/'/g, "''");
  return `'${escaped}'`;
}
function resolveTmuxServerGuardRuntime() {
  let runtimePath;
  try {
    runtimePath = resolveRuntimeCliPath();
  } catch {
    throw new Error("tmux_server_guard_runtime_path_unavailable");
  }
  if (!(0, import_path15.isAbsolute)(runtimePath) && !import_path15.win32.isAbsolute(runtimePath) || !isRegularFile(runtimePath)) {
    throw new Error("tmux_server_guard_runtime_path_unavailable");
  }
  const nodePath = process.execPath;
  if (!(0, import_path15.isAbsolute)(nodePath) && !import_path15.win32.isAbsolute(nodePath) || !isRegularFile(nodePath)) {
    throw new Error("tmux_server_guard_node_path_unavailable");
  }
  return { nodePath, runtimePath };
}
function isRegularFile(path3) {
  if (!(0, import_fs11.existsSync)(path3)) return false;
  try {
    return (0, import_fs11.statSync)(path3).isFile();
  } catch {
    return false;
  }
}
function tmuxCommandString(args, formatArgs = []) {
  const formats = new Set(formatArgs);
  return args.map(
    (arg) => formats.has(arg) ? shellQuote(arg) : shellQuote(tmuxFormatEscape(arg))
  ).join(" ");
}
function parseExactPositivePid(value) {
  const trimmed = value.trim();
  if (!/^[1-9]\d*$/.test(trimmed)) return null;
  const pid = Number(trimmed);
  return Number.isSafeInteger(pid) && pid > 0 ? pid : null;
}
function parseTmuxServerFields(output) {
  const lines = output.split(/\r?\n/).filter((line) => line.length > 0);
  if (lines.length !== 1) return null;
  const fields = lines[0].split("	");
  if (fields.length !== 2) return null;
  const socketPath = fields[0];
  const pid = parseExactPositivePid(fields[1]);
  if (!socketPath || !isValidTmuxServerIdentity({
    socket_path: socketPath,
    server_pid: pid ?? 0,
    process_started_at: "probe"
  }))
    return null;
  return { socketPath, pid };
}
function buildTmuxServerIdentity(socketPath, pid, processIdentity) {
  const processStartedAt = processIdentity(pid);
  if (!processStartedAt || !isValidStrictProcessStartIdentity(processStartedAt))
    return null;
  if (process.platform === "win32") {
    try {
      process.kill(pid, 0);
    } catch {
      return null;
    }
  }
  const identity = {
    socket_path: socketPath,
    server_pid: pid,
    process_started_at: processStartedAt
  };
  return isValidTmuxServerIdentity(identity) ? identity : null;
}
function parseTmuxCreationRecord(output, resourceFields, processIdentity = currentStrictProcessStartIdentity, knownIdentity) {
  const lines = output.split(/\r?\n/).filter((line) => line.length > 0);
  const candidates = lines.filter(
    (line) => line.split("	").length === resourceFields
  );
  if (candidates.length !== 1) return null;
  const fields = candidates[0].split("	");
  const resource = resourceFields === 4 ? fields[0] : "";
  const paneIndex = resourceFields === 3 ? 0 : 1;
  const paneId = fields[paneIndex];
  const socketPath = fields[resourceFields - 2];
  const pid = parseExactPositivePid(fields[resourceFields - 1]);
  if (resourceFields === 4 && !resource || !/^%\d+$/.test(paneId) || !pid || !socketPath)
    return null;
  const identity = knownIdentity && knownIdentity.socket_path === socketPath && knownIdentity.server_pid === pid ? knownIdentity : buildTmuxServerIdentity(socketPath, pid, processIdentity);
  if (!identity) return null;
  return { resource, paneId, identity };
}
async function captureTmuxServerIdentity(selectedEndpoint, dependencies = {}) {
  const deps = { ...defaultTmuxServerIdentityDependencies, ...dependencies };
  if (selectedEndpoint !== void 0 && !isValidTmuxServerIdentity({
    socket_path: selectedEndpoint,
    server_pid: 1,
    process_started_at: "probe"
  })) {
    return null;
  }
  const args = selectedEndpoint === void 0 ? ["display-message", "-p", "#{socket_path}	#{pid}"] : tmuxArgsForIdentity(
    {
      socket_path: selectedEndpoint,
      server_pid: 1,
      process_started_at: "probe"
    },
    ["display-message", "-p", "#{socket_path}	#{pid}"]
  );
  try {
    const result = await deps.tmuxQuery(
      args,
      selectedEndpoint === void 0 ? void 0 : {
        timeout: 2e3,
        stripTmux: true
      }
    );
    if (result.stderr.trim()) return null;
    const fields = parseTmuxServerFields(result.stdout);
    if (!fields || selectedEndpoint !== void 0 && fields.socketPath !== selectedEndpoint)
      return null;
    return buildTmuxServerIdentity(
      fields.socketPath,
      fields.pid,
      deps.processIdentity
    );
  } catch {
    return null;
  }
}
async function observeTmuxServerIdentity(expected, dependencies = {}) {
  const deps = { ...defaultTmuxServerIdentityDependencies, ...dependencies };
  if (!isValidTmuxServerIdentity(expected) || !isValidStrictProcessStartIdentity(expected.process_started_at))
    return "unknown";
  const singleWindowsProbe = process.platform === "win32" && dependencies.processObservation === void 0;
  if (singleWindowsProbe) {
    try {
      process.kill(expected.server_pid, 0);
    } catch (error) {
      return error.code === "ESRCH" ? "dead" : "unknown";
    }
  } else {
    let processState;
    try {
      processState = deps.processObservation({
        server_pid: expected.server_pid,
        process_started_at: expected.process_started_at
      });
    } catch {
      return "unknown";
    }
    if (processState === "dead") return "dead";
    if (processState !== "matching") return "unknown";
  }
  try {
    const result = await deps.tmuxQuery(
      tmuxArgsForIdentity(expected, ["display-message", "-p", "#{pid}"]),
      { timeout: 2e3, stripTmux: true }
    );
    if (result.stderr.trim()) return "unknown";
    const lines = result.stdout.split(/\r?\n/).filter((line) => line.length > 0);
    if (lines.length !== 1) return "unknown";
    const actualPid = parseExactPositivePid(lines[0]);
    if (actualPid !== expected.server_pid) return "unknown";
    const actualStart = deps.processIdentity(actualPid);
    if (singleWindowsProbe && actualStart && isValidStrictProcessStartIdentity(actualStart) && actualStart !== expected.process_started_at)
      return "dead";
    if (!actualStart || actualStart !== expected.process_started_at)
      return "unknown";
    if (singleWindowsProbe) {
      try {
        process.kill(actualPid, 0);
      } catch (error) {
        return error.code === "ESRCH" ? "dead" : "unknown";
      }
    }
    return "matching";
  } catch {
    return "unknown";
  }
}
function runTmuxServerIdentityGuard(expected, formattedActualServerPid, formattedActualSocket, options = {}) {
  if (!isValidTmuxServerIdentity(expected) || !isValidStrictProcessStartIdentity(expected.process_started_at))
    return 1;
  const actualPid = parseExactPositivePid(formattedActualServerPid);
  if (actualPid !== expected.server_pid) return 1;
  if (formattedActualSocket !== void 0 && formattedActualSocket.trim() !== expected.socket_path)
    return 1;
  const processIdentity = options.processIdentity ?? currentStrictProcessStartIdentity;
  let actualStart;
  try {
    actualStart = processIdentity(actualPid);
  } catch {
    return 1;
  }
  return actualStart === expected.process_started_at ? 0 : 1;
}
function encodeTmuxServerIdentity(identity) {
  return Buffer.from(JSON.stringify(identity), "utf8").toString("base64url");
}
function isPosixTmuxSession() {
  const tmuxValue = process.env.TMUX;
  if (!tmuxValue) return false;
  const parts = tmuxValue.split(",");
  if (parts.length !== 3 || !parts[0] || !/^[0-9]+$/.test(parts[1]))
    return false;
  const socketPath = parts[0].replace(/\\/g, "/");
  return !/^\/tmp\/psmux-[^/]+(?:\/|$)/i.test(socketPath);
}
function tmuxServerGuardCondition(identity) {
  const runtime = resolveTmuxServerGuardRuntime();
  const runtimePath = tmuxFormatEscape(runtime.runtimePath);
  const nodePath = tmuxFormatEscape(runtime.nodePath);
  const encodedIdentity = tmuxFormatEscape(encodeTmuxServerIdentity(identity));
  if (process.platform === "win32" && !isUnixLikeOnWindows2()) {
    return tmuxServerGuardConditionPowerShell(
      nodePath,
      runtimePath,
      encodedIdentity
    );
  }
  if (process.platform === "win32" && isUnixLikeOnWindows2() && !isPosixTmuxSession()) {
    return tmuxServerGuardConditionPowerShell(
      nodePath,
      runtimePath,
      encodedIdentity
    );
  }
  return tmuxServerGuardConditionPosix(nodePath, runtimePath, encodedIdentity);
}
function tmuxServerGuardConditionPosix(nodePath, runtimePath, encodedIdentity) {
  return [
    shellQuote("/usr/bin/env"),
    "-i",
    shellQuote(nodePath),
    shellQuote(runtimePath),
    "--tmux-server-identity-guard",
    shellQuote(encodedIdentity),
    shellQuote("#{pid}"),
    "<",
    shellQuote("/dev/null")
  ].join(" ");
}
function tmuxServerGuardConditionPowerShell(nodePath, runtimePath, encodedIdentity) {
  return [
    "&",
    "{",
    "Remove-Item",
    '@("env:NODE_OPTIONS","env:NODE_PATH","env:NODE_PRESERVE_SYMLINKS")',
    "-ErrorAction",
    "SilentlyContinue",
    ";",
    "&",
    powershellQuote(nodePath),
    powershellQuote(runtimePath),
    powershellQuote("--tmux-server-identity-guard"),
    powershellQuote(encodedIdentity),
    powershellQuote("#{pid}"),
    ";",
    "if ($LASTEXITCODE -eq 0) { exit 0 }",
    "exit 1",
    "}"
  ].join(" ");
}
function tmuxGuardedNativeCommand(identity, nativeCommand) {
  const marker = `OMC_TMUX_GUARD_OK_${randomGuardMarker()}`;
  const condition = tmuxServerGuardCondition(identity);
  return {
    condition,
    success: `${nativeCommand}; display-message -p ${shellQuote(marker)}`,
    failure: `display-message -p ${shellQuote(`OMC_TMUX_GUARD_FAIL_${marker}`)}`,
    marker
  };
}
function randomGuardMarker() {
  guardMarkerCounter = (guardMarkerCounter + 1) % 1e6;
  return `${process.pid}_${Date.now().toString(36)}_${guardMarkerCounter.toString(36)}`;
}
async function runGuardedNativeTmuxCommand(identity, nativeCommand) {
  if (!isValidTmuxServerIdentity(identity))
    return { outcome: "unknown", stdout: "", stderr: "" };
  const guarded = tmuxGuardedNativeCommand(identity, nativeCommand);
  try {
    const result = await tmuxCmdAsync(
      tmuxArgsForIdentity(identity, [
        "if-shell",
        guarded.condition,
        guarded.success,
        guarded.failure
      ]),
      { timeout: 5e3, stripTmux: true }
    );
    if (result.stderr.trim())
      return {
        outcome: "unknown",
        stdout: result.stdout,
        stderr: result.stderr
      };
    const outputLines = result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const failureMarker = `OMC_TMUX_GUARD_FAIL_${guarded.marker}`;
    if (outputLines.includes(failureMarker)) {
      return {
        outcome: "not_executed",
        stdout: result.stdout,
        stderr: result.stderr
      };
    }
    if (outputLines.includes(guarded.marker)) {
      return {
        outcome: "executed",
        stdout: result.stdout,
        stderr: result.stderr
      };
    }
    return { outcome: "unknown", stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return {
      outcome: "unknown",
      stdout: "",
      stderr: isTmuxServerNotFoundError(error) ? "tmux_server_unavailable" : redactBoundedDiagnostic(error)
    };
  }
}
async function runGuardedNativeTmuxCreationCommand(identity, nativeCommand, resourceFields) {
  const result = await runGuardedNativeTmuxCommand(identity, nativeCommand);
  if (result.outcome !== "unknown" || result.stderr.trim()) return result;
  const record = parseTmuxCreationRecord(
    result.stdout,
    resourceFields,
    currentStrictProcessStartIdentity,
    identity
  );
  if (!record || !sameTmuxServerIdentity(record.identity, identity))
    return result;
  return { ...result, outcome: "executed" };
}
function isTmuxServerNotFoundError(error) {
  const value = error;
  const text = [value?.stderr, value?.stdout, value?.message].filter((item) => typeof item === "string").join("\n").toLowerCase();
  return /no server running|failed to connect|can't connect|no such file|connection refused|server exited/.test(
    text
  );
}
function detectTeamMultiplexerContext(env = process.env) {
  if (env.TMUX) return "tmux";
  if (env.CMUX_SURFACE_ID) return "cmux";
  return "none";
}
function isUnixLikeOnWindows2() {
  return process.platform === "win32" && !!(process.env.MSYSTEM || process.env.MINGW_PREFIX);
}
async function applyMainVerticalLayout(teamTarget, options = {}) {
  const identity = options.tmuxServerIdentity;
  if (teamTarget.startsWith("cmux:") || isHerdrSessionTarget(teamTarget))
    return;
  if (!identity) {
    if (options.required) throw new Error("tmux_server_identity_missing");
    return;
  }
  try {
    const widthArgs = [
      "display-message",
      "-p",
      "-t",
      teamTarget,
      "#{window_width}"
    ];
    const widthResult = await tmuxCmdAsync(
      tmuxArgsForIdentity(identity, widthArgs),
      { timeout: 2e3, stripTmux: true }
    );
    const width = parseInt(widthResult.stdout.trim(), 10);
    if (!Number.isFinite(width) || width < 40) {
      throw new Error(
        `team_layout_window_width_invalid:${widthResult.stdout.trim() || "empty"}`
      );
    }
    const half = String(Math.floor(width / 2));
    const setArgs = [
      "set-window-option",
      "-t",
      teamTarget,
      "main-pane-width",
      half
    ];
    const result = await runGuardedNativeTmuxCommand(
      identity,
      tmuxCommandString(setArgs)
    );
    if (result.outcome !== "executed")
      throw new Error("team_layout_server_guard_failed");
  } catch (error) {
    if (options.required || identity) throw error;
    return;
  }
  try {
    const selectArgs = ["select-layout", "-t", teamTarget, "main-vertical"];
    const result = await runGuardedNativeTmuxCommand(
      identity,
      tmuxCommandString(selectArgs)
    );
    if (result.outcome !== "executed")
      throw new Error("team_layout_server_guard_failed");
  } catch (error) {
    if (options.required || identity) throw error;
  }
}
async function configureTmuxClipboardAtIdentity(identity, sessionTarget) {
  const setOption = async (args) => {
    const result2 = await runGuardedNativeTmuxCommand(
      identity,
      tmuxCommandString(args)
    );
    if (result2.outcome !== "executed")
      throw new Error("tmux_server_guard_failed");
  };
  await setOption(["set-option", "-t", sessionTarget, "set-clipboard", "on"]);
  let terminalFeatures = "";
  const result = await tmuxCmdAsync(
    tmuxArgsForIdentity(identity, [
      "show-options",
      "-t",
      sessionTarget,
      "-v",
      "terminal-features"
    ]),
    { timeout: 2e3, stripTmux: true }
  );
  if (result.stderr.trim()) throw new Error("tmux_server_observation_failed");
  terminalFeatures = result.stdout;
  if (!hasUniversalClipboardFeature(terminalFeatures)) {
    await setOption([
      "set-option",
      "-at",
      sessionTarget,
      "terminal-features",
      ",*:clipboard"
    ]);
  }
}
function hasUniversalClipboardFeature(features) {
  return features.split(/\r?\n|,/).map((feature) => feature.trim()).some(
    (feature) => feature === "*:clipboard" || feature.startsWith("*:clipboard:")
  );
}
function isCmuxContext() {
  return detectTeamMultiplexerContext() === "cmux";
}
function isCmuxSurfaceTarget(value) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.startsWith("%")) return false;
  if (isHerdrPaneId(trimmed)) return false;
  return isCmuxContext();
}
function resolveTeamMultiplexer(explicit, env = process.env) {
  if (explicit === "herdr" || explicit === "tmux") return explicit;
  const raw = (env.OMC_TEAM_MULTIPLEXER ?? "").trim().toLowerCase();
  if (raw === "herdr") return "herdr";
  if (raw === "tmux") return "tmux";
  try {
    const pluginConfig = loadConfig();
    if (pluginConfig.team?.ops?.multiplexer === "herdr") return "herdr";
  } catch {
  }
  return "tmux";
}
function isHerdrPaneId(value) {
  return typeof value === "string" && /^w[0-9a-z]+:p[0-9a-z]+$/i.test(value.trim());
}
function isHerdrSessionTarget(value) {
  return typeof value === "string" && value.trim().startsWith("herdr:");
}
function providerForTeamTarget(sessionName2, paneId) {
  if (isHerdrSessionTarget(sessionName2) || isHerdrPaneId(paneId ?? void 0))
    return "herdr";
  if (typeof sessionName2 === "string" && sessionName2.startsWith("cmux:") || typeof paneId === "string" && paneId.trim().length > 0 && !paneId.trim().startsWith("%")) {
    return "cmux";
  }
  return "tmux";
}
async function cmuxExecAsync(args) {
  const result = await execFileAsync4("cmux", args, { encoding: "utf-8" });
  return {
    stdout: typeof result.stdout === "string" ? result.stdout : String(result.stdout ?? ""),
    stderr: typeof result.stderr === "string" ? result.stderr : String(result.stderr ?? "")
  };
}
function getCmuxErrorText(error) {
  if (error instanceof Error) {
    const stderr = typeof error.stderr === "string" ? error.stderr : "";
    return `${error.message}
${stderr}`.trim();
  }
  return String(error);
}
function isCmuxDialectFailure(error) {
  const text = getCmuxErrorText(error);
  return /(?:unknown|unrecognized|invalid|unsupported) (?:command|subcommand|option)|no such (?:command|subcommand)|Found argument .*--surface.*wasn't expected|unexpected argument|unexpected option/i.test(
    text
  );
}
function redactCmuxFailureMessage(error, argLists) {
  let message = getCmuxErrorText(error);
  const commandNames = new Set(argLists.map((args) => args[0]).filter(Boolean));
  const sensitiveArgs = [
    ...new Set(
      argLists.flatMap((args) => args).flatMap((arg) => {
        if (!arg || commandNames.has(arg)) return [];
        const fragments = arg.match(/[A-Za-z0-9_./:@=-]{4,}/g) ?? [];
        return [arg, ...fragments];
      })
    )
  ].sort((a, b) => b.length - a.length);
  for (const arg of sensitiveArgs) {
    message = message.split(arg).join("[redacted]");
  }
  return message;
}
async function cmuxExecPrimaryWithLegacyFallback(primaryArgs, legacyArgs) {
  try {
    return await cmuxExecAsync(primaryArgs);
  } catch (primaryError) {
    if (!isCmuxDialectFailure(primaryError)) {
      const primaryMessage = redactCmuxFailureMessage(primaryError, [
        primaryArgs
      ]);
      const error = new Error(
        `cmux command failed for current form: current=${primaryArgs[0] ?? "<unknown>"} (${primaryMessage})`
      );
      error.cause = primaryError;
      throw error;
    }
    try {
      return await cmuxExecAsync(legacyArgs);
    } catch (legacyError) {
      const primaryMessage = redactCmuxFailureMessage(primaryError, [
        primaryArgs,
        legacyArgs
      ]);
      const legacyMessage = redactCmuxFailureMessage(legacyError, [
        primaryArgs,
        legacyArgs
      ]);
      throw new Error(
        `cmux command failed for both current and legacy forms: current=${primaryArgs[0] ?? "<unknown>"} (${primaryMessage}); legacy=${legacyArgs[0] ?? "<unknown>"} (${legacyMessage})`
      );
    }
  }
}
function parseCmuxSurfaceId(output) {
  const trimmed = output.trim();
  const uuidMatch = trimmed.match(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
  );
  if (uuidMatch) return uuidMatch[0];
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  const token = tokens[0] === "OK" ? tokens[1] : tokens[0];
  if (!token)
    throw new Error(`Failed to resolve cmux surface id: "${trimmed}"`);
  return token;
}
async function cmuxSplitSurface(targetSurfaceId, direction, _cwd) {
  const args = ["new-split", direction, "--surface", targetSurfaceId];
  if (process.env.CMUX_WORKSPACE_ID)
    args.push("--workspace", process.env.CMUX_WORKSPACE_ID);
  const result = await cmuxExecAsync(args);
  let paneId = null;
  try {
    paneId = parseCmuxSurfaceId(result.stdout);
  } catch {
  }
  return { ...result, paneId };
}
async function cmuxSendSurface(surfaceId, text) {
  await cmuxExecPrimaryWithLegacyFallback(
    ["send-surface", "--surface", surfaceId, text],
    ["send", "--surface", surfaceId, text]
  );
}
function normalizeCmuxKey(key) {
  const normalized = key.trim();
  const lower = normalized.toLowerCase();
  const controlKey = normalized.match(/^[Cc]-([A-Za-z])$/);
  if (controlKey?.[1]) {
    const character = controlKey[1].toLowerCase();
    return character === "m" ? "enter" : `ctrl+${character}`;
  }
  switch (lower) {
    case "enter":
    case "return":
    case "tab":
    case "escape":
    case "esc":
    case "backspace":
    case "delete":
    case "up":
    case "down":
    case "left":
    case "right":
      return lower === "return" ? "enter" : lower === "esc" ? "escape" : lower;
    default:
      return normalized;
  }
}
async function cmuxSendSurfaceKey(surfaceId, key) {
  const normalizedKey = normalizeCmuxKey(key);
  await cmuxExecPrimaryWithLegacyFallback(
    ["send-key-surface", "--surface", surfaceId, normalizedKey],
    ["send-key", "--surface", surfaceId, normalizedKey]
  );
}
async function cmuxCaptureSurface(surfaceId) {
  const result = await cmuxExecPrimaryWithLegacyFallback(
    ["read-screen", "--surface", surfaceId],
    ["capture-pane", "--surface", surfaceId, "--scrollback"]
  );
  return result.stdout;
}
async function cmuxCloseSurface(surfaceId) {
  await cmuxExecAsync(["close-surface", "--surface", surfaceId]);
}
function exactTmuxPaneMembershipTarget(providerTarget) {
  if (/^\$\d+$/.test(providerTarget)) {
    return { target: providerTarget, sessionScope: true };
  }
  if (/^@\d+$/.test(providerTarget)) {
    return { target: providerTarget, sessionScope: false };
  }
  if (/^[\$@]/.test(providerTarget)) return null;
  if (!providerTarget.includes(":")) {
    return { target: `=${providerTarget}:`, sessionScope: true };
  }
  const separator = providerTarget.indexOf(":");
  if (separator <= 0 || separator === providerTarget.length - 1) return null;
  if (providerTarget.indexOf(":", separator + 1) !== -1) return null;
  const sessionName2 = providerTarget.slice(0, separator);
  const windowName = providerTarget.slice(separator + 1);
  if (!sessionName2 || !windowName || sessionName2.startsWith("=") || windowName.startsWith("=") || windowName.startsWith("$") && !/^\$\d+$/.test(windowName) || windowName.startsWith("@") && !/^@\d+$/.test(windowName)) {
    return null;
  }
  const sessionTarget = `=${sessionName2}`;
  const windowTarget = /^\d+$/.test(windowName) || /^@\d+$/.test(windowName) ? windowName : `=${windowName}`;
  return { target: `${sessionTarget}:${windowTarget}`, sessionScope: false };
}
function isExactOpaqueCmuxIdentifier(value) {
  return typeof value === "string" && value.length > 0 && value === value.trim() && !/[\x00-\x1f\x7f\s]/.test(value);
}
function parseCmuxResourceIds(output, collectionName) {
  let parsed;
  try {
    parsed = JSON.parse(output);
  } catch {
    return null;
  }
  const entries = Array.isArray(parsed) ? parsed : parsed && typeof parsed === "object" && Array.isArray(parsed[collectionName]) ? parsed[collectionName] : null;
  if (!entries) return null;
  const ids = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry))
      return null;
    const id = entry.id;
    if (!isExactOpaqueCmuxIdentifier(id)) return null;
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}
async function verifyTeamTargetOwnership(target, dependencies = defaultMailboxTargetOwnershipDependencies) {
  const isNativeCmuxPaneFormat = !TMUX_MAILBOX_PANE_ID.test(target.paneId);
  let expectedProvider;
  if (isHerdrSessionTarget(target.providerTarget) && isHerdrPaneId(target.paneId)) {
    expectedProvider = "herdr";
  } else if (target.providerTarget.startsWith("cmux:") && isNativeCmuxPaneFormat) {
    expectedProvider = "cmux";
  } else {
    expectedProvider = "tmux";
  }
  if (target.provider !== expectedProvider)
    return { kind: "provider_mismatch" };
  if (target.provider === "herdr") {
    if (typeof target.providerTarget !== "string" || target.providerTarget.length === 0 || target.providerTarget !== target.providerTarget.trim() || !isHerdrPaneId(target.paneId)) {
      return { kind: "unavailable" };
    }
    try {
      const membership = await herdrPaneWorkspaceMembership(
        target.paneId,
        herdrWorkspaceIdFromSessionTarget(target.providerTarget),
        { execFn: dependencies.herdrExec }
      );
      if (membership === "unavailable") return { kind: "unavailable" };
      if (membership === "foreign") return { kind: "foreign" };
      return {
        kind: "owned",
        provider: "herdr",
        providerTarget: target.providerTarget,
        paneId: target.paneId
      };
    } catch {
      return { kind: "unavailable" };
    }
  }
  if (target.provider === "tmux") {
    if (!isValidTmuxServerIdentity(
      target.tmuxServerIdentity
    ) || typeof target.providerTarget !== "string" || target.providerTarget.length === 0 || target.providerTarget !== target.providerTarget.trim() || !TMUX_MAILBOX_TARGET.test(target.providerTarget) || !TMUX_MAILBOX_PANE_ID.test(target.paneId)) {
      return { kind: "unavailable" };
    }
    const tmuxServerIdentity = target.tmuxServerIdentity;
    if (await observeTmuxServerIdentity(
      tmuxServerIdentity,
      dependencies.serverIdentityDependencies
    ) !== "matching") {
      return { kind: "unavailable" };
    }
    try {
      const membershipTarget = exactTmuxPaneMembershipTarget(
        target.providerTarget
      );
      if (!membershipTarget) return { kind: "unavailable" };
      const result = await dependencies.tmuxExec(
        tmuxArgsForIdentity(tmuxServerIdentity, [
          "list-panes",
          ...membershipTarget.sessionScope ? ["-s"] : [],
          "-t",
          membershipTarget.target,
          "-F",
          "#{pane_id}"
        ])
      );
      if (result.stderr.trim()) return { kind: "unavailable" };
      if (await observeTmuxServerIdentity(
        tmuxServerIdentity,
        dependencies.serverIdentityDependencies
      ) !== "matching")
        return { kind: "unavailable" };
      const paneIds = [];
      for (const line of result.stdout.split(/\r?\n/)) {
        const paneId = line.trim();
        if (!paneId) continue;
        if (!TMUX_MAILBOX_PANE_ID.test(paneId)) return { kind: "unavailable" };
        if (!paneIds.includes(paneId)) paneIds.push(paneId);
      }
      if (paneIds.length === 0) return { kind: "unavailable" };
      return paneIds.includes(target.paneId) ? {
        kind: "owned",
        provider: "tmux",
        providerTarget: target.providerTarget,
        paneId: target.paneId,
        tmuxServerIdentity: { ...tmuxServerIdentity }
      } : { kind: "foreign" };
    } catch {
      return { kind: "unavailable" };
    }
  }
  const workspace = target.providerTarget.slice("cmux:".length);
  if (!isExactOpaqueCmuxIdentifier(workspace) || !isExactOpaqueCmuxIdentifier(target.paneId) || TMUX_MAILBOX_PANE_ID.test(target.paneId)) {
    return { kind: "unavailable" };
  }
  try {
    const panes = parseCmuxResourceIds(
      (await dependencies.cmuxExec([
        "--json",
        "list-panes",
        "--workspace",
        workspace
      ])).stdout,
      "panes"
    );
    if (!panes || panes.length === 0) return { kind: "unavailable" };
    for (const pane of panes) {
      const surfacesOutput = (await dependencies.cmuxExec([
        "--json",
        "list-pane-surfaces",
        "--workspace",
        workspace,
        "--pane",
        pane
      ])).stdout;
      let surfaceList = null;
      try {
        const parsed = JSON.parse(surfacesOutput);
        const entries = Array.isArray(parsed) ? parsed : parsed && typeof parsed === "object" && Array.isArray(parsed.surfaces) ? parsed.surfaces : null;
        if (entries && Array.isArray(entries)) {
          surfaceList = [];
          for (const entry of entries) {
            if (!entry || typeof entry !== "object" || Array.isArray(entry))
              continue;
            const id = entry.id;
            const ref = entry.ref;
            if (isExactOpaqueCmuxIdentifier(id)) {
              surfaceList.push({
                id,
                ref: isExactOpaqueCmuxIdentifier(ref) ? ref : void 0
              });
            }
          }
        }
      } catch {
      }
      if (!surfaceList || surfaceList.length === 0)
        return { kind: "unavailable" };
      if (surfaceList.some(
        (surface) => surface.id === target.paneId || surface.ref === target.paneId
      )) {
        return {
          kind: "owned",
          provider: "cmux",
          providerTarget: target.providerTarget,
          paneId: target.paneId
        };
      }
    }
    return { kind: "foreign" };
  } catch {
    return { kind: "unavailable" };
  }
}
async function verifyCmuxTargetOwnershipWithRetry(target, dependencies) {
  let membership = await verifyTeamTargetOwnership(target, dependencies);
  if (membership.kind === "owned" || membership.kind === "provider_mismatch")
    return membership;
  for (let attempt = 1; attempt < CMUX_MEMBERSHIP_RETRY_ATTEMPTS; attempt++) {
    await sleep3(CMUX_MEMBERSHIP_RETRY_INTERVAL_MS);
    membership = await verifyTeamTargetOwnership(target, dependencies);
    if (membership.kind === "owned" || membership.kind === "provider_mismatch")
      return membership;
  }
  return membership;
}
async function invokeDirectMailboxEffect(target, message, dependencies = defaultDirectMailboxEffectDependencies) {
  if (!target.paneId || !message)
    return { kind: "not_attempted", reason: "mailbox_target_missing" };
  if (target.provider === "cmux" && !isCmuxContext()) {
    return { kind: "not_attempted", reason: "mailbox_membership_unresolvable" };
  }
  if (target.provider === "tmux") {
    const tmuxServerIdentity = target.tmuxServerIdentity;
    if (!isValidTmuxServerIdentity(tmuxServerIdentity)) {
      return {
        kind: "not_attempted",
        reason: "mailbox_membership_unresolvable"
      };
    }
    const serverState = await observeTmuxServerIdentity(
      tmuxServerIdentity,
      dependencies.serverIdentityDependencies
    );
    if (serverState !== "matching") {
      return {
        kind: "not_attempted",
        reason: "mailbox_membership_unresolvable"
      };
    }
    const membership = await verifyTeamTargetOwnership(target, {
      ...defaultMailboxTargetOwnershipDependencies,
      ...dependencies.serverIdentityDependencies ? {
        serverIdentityDependencies: dependencies.serverIdentityDependencies
      } : {}
    });
    if (membership.kind !== "owned") {
      return {
        kind: "not_attempted",
        reason: "mailbox_membership_unresolvable"
      };
    }
    const inputBlockReason = await paneInputBlockReason(
      target.paneId,
      tmuxServerIdentity,
      dependencies.serverIdentityDependencies
    );
    if (inputBlockReason)
      return { kind: "not_attempted", reason: inputBlockReason };
    const text = target.recipientRole === "leader" ? `[OMC_TMUX_INJECT] ${message}`.slice(0, 200) : message;
    try {
      const literal = await runGuardedNativeTmuxCommand(
        tmuxServerIdentity,
        tmuxCommandString(["send-keys", "-t", target.paneId, "-l", "--", text])
      );
      if (literal.outcome !== "executed") {
        return literal.outcome === "not_executed" ? { kind: "not_attempted", reason: "mailbox_membership_unresolvable" } : {
          kind: "attempted_unconfirmed",
          transport: "tmux_send_keys",
          reason: "notification_delivery_uncertain",
          cause: "returned_false"
        };
      }
      const postInputBlockReason = await paneInputBlockReason(
        target.paneId,
        tmuxServerIdentity,
        dependencies.serverIdentityDependencies
      );
      if (postInputBlockReason) {
        return {
          kind: "attempted_unconfirmed",
          transport: "tmux_send_keys",
          reason: "notification_delivery_uncertain",
          cause: "returned_false"
        };
      }
      const enter = await runGuardedNativeTmuxCommand(
        tmuxServerIdentity,
        tmuxCommandString(["send-keys", "-t", target.paneId, "Enter"])
      );
      if (enter.outcome !== "executed") {
        return {
          kind: "attempted_unconfirmed",
          transport: "tmux_send_keys",
          reason: "notification_delivery_uncertain",
          cause: enter.outcome === "unknown" ? "threw" : "returned_false"
        };
      }
      return {
        kind: "confirmed",
        transport: "tmux_send_keys",
        reason: target.recipientRole === "leader" ? "leader_pane_notified" : "worker_pane_notified"
      };
    } catch {
      return {
        kind: "attempted_unconfirmed",
        transport: "tmux_send_keys",
        reason: "notification_delivery_uncertain",
        cause: "threw"
      };
    }
  }
  try {
    const notified = target.recipientRole === "leader" ? await dependencies.sendLeader(
      target.providerTarget,
      target.paneId,
      message
    ) : await dependencies.sendWorker(
      target.providerTarget,
      target.paneId,
      message
    );
    return notified ? {
      kind: "confirmed",
      transport: "tmux_send_keys",
      reason: target.recipientRole === "leader" ? "leader_pane_notified" : "worker_pane_notified"
    } : {
      kind: "attempted_unconfirmed",
      transport: "tmux_send_keys",
      reason: "notification_delivery_uncertain",
      cause: "returned_false"
    };
  } catch {
    return {
      kind: "attempted_unconfirmed",
      transport: "tmux_send_keys",
      reason: "notification_delivery_uncertain",
      cause: "threw"
    };
  }
}
function getDefaultShell() {
  if (process.platform === "win32" && !isUnixLikeOnWindows2()) {
    return process.env.COMSPEC || "cmd.exe";
  }
  const shell = process.env.SHELL || "/bin/bash";
  const name = (0, import_path15.basename)(shell.replace(/\\/g, "/")).replace(
    /\.(exe|cmd|bat)$/i,
    ""
  );
  if (!SUPPORTED_POSIX_SHELLS.has(name)) {
    return "/bin/sh";
  }
  return shell;
}
function pathEntries(envPath) {
  return (envPath ?? "").split(process.platform === "win32" ? ";" : ":").map((entry) => entry.trim()).filter(Boolean);
}
function pathCandidateNames(candidatePath) {
  const base = (0, import_path15.basename)(candidatePath.replace(/\\/g, "/"));
  const bare = base.replace(/\.(exe|cmd|bat)$/i, "");
  if (process.platform === "win32") {
    return Array.from(
      /* @__PURE__ */ new Set([`${bare}.exe`, `${bare}.cmd`, `${bare}.bat`, bare])
    );
  }
  return Array.from(/* @__PURE__ */ new Set([base, bare]));
}
function resolveShellFromPath(candidatePath) {
  for (const dir of pathEntries(process.env.PATH)) {
    for (const name of pathCandidateNames(candidatePath)) {
      const full = (0, import_path15.join)(dir, name);
      if ((0, import_fs11.existsSync)(full)) return full;
    }
  }
  return null;
}
function resolveShellFromCandidates(paths, rcFile) {
  for (const p of paths) {
    if ((0, import_fs11.existsSync)(p)) return { shell: p, rcFile };
    const resolvedFromPath = resolveShellFromPath(p);
    if (resolvedFromPath) return { shell: resolvedFromPath, rcFile };
  }
  return null;
}
function resolveSupportedShellAffinity(shellPath) {
  if (!shellPath) return null;
  const name = (0, import_path15.basename)(shellPath.replace(/\\/g, "/")).replace(
    /\.(exe|cmd|bat)$/i,
    ""
  );
  if (name !== "zsh" && name !== "bash") return null;
  if (!(0, import_fs11.existsSync)(shellPath)) return null;
  const home = process.env.HOME ?? "";
  const rcFile = home ? `${home}/.${name}rc` : null;
  return { shell: shellPath, rcFile };
}
function buildWorkerLaunchSpec(shellPath) {
  if (isUnixLikeOnWindows2()) {
    return { shell: "/bin/sh", rcFile: null };
  }
  const preferred = resolveSupportedShellAffinity(shellPath);
  if (preferred) return preferred;
  const home = process.env.HOME ?? "";
  const zshRc = home ? `${home}/.zshrc` : null;
  const zsh = resolveShellFromCandidates(ZSH_CANDIDATES, zshRc ?? "");
  if (zsh) return { shell: zsh.shell, rcFile: zshRc };
  const bashRc = home ? `${home}/.bashrc` : null;
  const bash = resolveShellFromCandidates(BASH_CANDIDATES, bashRc ?? "");
  if (bash) return { shell: bash.shell, rcFile: bashRc };
  return { shell: "/bin/sh", rcFile: null };
}
function commandFingerprint(value) {
  return (0, import_crypto5.createHash)("sha256").update(value).digest("hex").slice(0, 12);
}
function redactBoundedDiagnostic(error, maxLength = 240) {
  const raw = error instanceof Error ? error.message : String(error);
  const redacted = raw.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 <redacted>").replace(
    /("--?[A-Za-z0-9_-]*(?:api[-_]?key|token|secret|password|credential|auth)[A-Za-z0-9_-]*"\s*,\s*)"[^"]*"/gi,
    '$1"<redacted>"'
  ).replace(
    /("[A-Za-z_][A-Za-z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY|CREDENTIALS?)"\s*:\s*)"[^"]*"/gi,
    '$1"<redacted>"'
  ).replace(
    /(--?[A-Za-z0-9_-]*(?:api[-_]?key|token|secret|password|credential|auth)[A-Za-z0-9_-]*)(?:=|\s+)(?:'[^']*'|"[^"]*"|\S+)/gi,
    "$1=<redacted>"
  ).replace(
    /\b[A-Za-z_][A-Za-z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY|CREDENTIALS?)=[^\s;]+/gi,
    "<redacted>"
  ).replace(/\s+/g, " ").trim();
  return redacted.length > maxLength ? `${redacted.slice(0, maxLength)}\u2026` : redacted;
}
function logWorkerSpawnDiagnostic(message) {
  process.stderr.write(`[team/tmux-session] ${message}
`);
}
function paneCurrentCommandLooksReady(command) {
  const normalized = (0, import_path15.basename)(command.replace(/\\/g, "/")).replace(/\.(exe|cmd|bat)$/i, "").toLowerCase();
  return SUPPORTED_POSIX_SHELLS.has(normalized) || ["cmd", "powershell", "pwsh", "nu", "elvish"].includes(normalized);
}
async function getPaneCurrentCommandStatus(paneId, tmuxServerIdentity) {
  try {
    const args = [
      "display-message",
      "-p",
      "-t",
      paneId,
      "#{pane_dead} #{pane_current_command}"
    ];
    const result = await tmuxCmdAsync(
      tmuxServerIdentity ? tmuxArgsForIdentity(tmuxServerIdentity, args) : args,
      { timeout: 1e3, ...tmuxServerIdentity ? { stripTmux: true } : {} }
    );
    const status = result.stdout.trim();
    const [dead, ...commandParts] = status.split(/\s+/);
    return { dead: dead === "1", command: commandParts.join(" ") };
  } catch {
    return null;
  }
}
function paneCurrentCommandLooksSubmitted(command) {
  return command.length > 0 && !paneCurrentCommandLooksReady(command);
}
function parseExactInteger2(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const negative = trimmed.startsWith("-");
  const magnitude = negative || trimmed.startsWith("+") ? trimmed.slice(1) : trimmed;
  const match = DECIMAL_INTEGER_TEXT2.exec(magnitude);
  if (!match) return null;
  const integerDigits = match[1] ?? "";
  const fractionDigits = match[2] ?? match[3] ?? "";
  const exponent = match[4] === void 0 ? 0 : Number(match[4]);
  const shift = fractionDigits.length - exponent;
  if (shift > 0) {
    const significand = integerDigits + fractionDigits;
    if (/[1-9]/.test(significand)) {
      const trailingZeros = significand.length - significand.replace(/0+$/, "").length;
      if (trailingZeros < shift) return null;
    }
  }
  const parsed = (negative ? -1 : 1) * Number(magnitude);
  return Number.isSafeInteger(parsed) ? parsed : null;
}
function resolveTeamShellReadyTimeoutMs(env = process.env, explicitTimeoutMs) {
  if (Number.isFinite(explicitTimeoutMs) && (explicitTimeoutMs ?? 0) > 0) {
    return Number(explicitTimeoutMs);
  }
  const raw = env.OMC_TEAM_SHELL_READY_TIMEOUT_MS;
  const parsed = raw == null || String(raw).trim() === "" ? null : parseExactInteger2(String(raw));
  return parsed !== null && parsed > 0 ? parsed : 5e3;
}
async function waitForShellReady(paneId, opts = {}) {
  if (isCmuxSurfaceTarget(paneId) || isHerdrPaneId(paneId)) return true;
  if (!opts.tmuxServerIdentity) return false;
  if (!isValidTmuxServerIdentity(opts.tmuxServerIdentity) || await observeTmuxServerIdentity(opts.tmuxServerIdentity) !== "matching")
    return false;
  const timeoutMs = resolveTeamShellReadyTimeoutMs(process.env, opts.timeoutMs);
  const pollIntervalMs = Number.isFinite(opts.pollIntervalMs) && (opts.pollIntervalMs ?? 0) > 0 ? Number(opts.pollIntervalMs) : 50;
  const deadline = Date.now() + timeoutMs;
  let lastStatus = "";
  while (Date.now() < deadline) {
    const status = await getPaneCurrentCommandStatus(
      paneId,
      opts.tmuxServerIdentity
    );
    if (status) {
      lastStatus = `${status.dead ? "1" : "0"} ${status.command}`.trim();
      if (status.dead) return false;
      if (paneCurrentCommandLooksReady(status.command)) {
        return true;
      }
    }
    await sleep3(pollIntervalMs);
  }
  logWorkerSpawnDiagnostic(
    `worker shell readiness timed out pane=${safePaneDiagnosticToken(paneId)} timeoutMs=${timeoutMs} lastStatus=${JSON.stringify(redactBoundedDiagnostic(lastStatus, 128))}`
  );
  return false;
}
async function verifyWorkerStartCommandDelivered(paneId, startCmd, tmuxServerIdentity) {
  if (isCmuxSurfaceTarget(paneId) || isHerdrPaneId(paneId)) return true;
  if (!tmuxServerIdentity) return false;
  const expected = normalizeTmuxCapture(startCmd);
  const compactExpected = normalizeTmuxCaptureForDelivery(startCmd);
  for (let attempt = 1; attempt <= 5; attempt++) {
    const captured = await capturePaneAsync(paneId, {
      joinWrappedLines: true,
      tmuxServerIdentity
    });
    const normalizedCaptured = normalizeTmuxCapture(captured);
    if (normalizedCaptured.includes(expected)) {
      return true;
    }
    if (compactExpected.length > 0 && normalizeTmuxCaptureForDelivery(captured).includes(compactExpected)) {
      return true;
    }
    await sleep3(50);
  }
  return false;
}
function resolveTeamStartSubmitTimeoutMs(env = process.env, explicitTimeoutMs) {
  if (Number.isFinite(explicitTimeoutMs) && (explicitTimeoutMs ?? 0) > 0) {
    return Number(explicitTimeoutMs);
  }
  const raw = env.OMC_TEAM_START_SUBMIT_TIMEOUT_MS;
  const parsed = raw == null || String(raw).trim() === "" ? null : parseExactInteger2(String(raw));
  return parsed !== null && parsed > 0 ? parsed : 8e3;
}
async function verifyWorkerStartCommandSubmitted(paneId, startCmd, opts = {}) {
  if (isCmuxSurfaceTarget(paneId) || isHerdrPaneId(paneId)) return true;
  if (!opts.tmuxServerIdentity) return false;
  const expected = normalizeTmuxCapture(startCmd);
  const compactExpected = normalizeTmuxCaptureForDelivery(startCmd);
  const timeoutMs = resolveTeamStartSubmitTimeoutMs(
    process.env,
    opts.timeoutMs
  );
  const maxPollIntervalMs = Number.isFinite(opts.maxPollIntervalMs) && (opts.maxPollIntervalMs ?? 0) > 0 ? Number(opts.maxPollIntervalMs) : 500;
  let pollIntervalMs = Number.isFinite(opts.initialPollIntervalMs) && (opts.initialPollIntervalMs ?? 0) > 0 ? Number(opts.initialPollIntervalMs) : 50;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const captured = await capturePaneAsync(paneId, {
      joinWrappedLines: true,
      tmuxServerIdentity: opts.tmuxServerIdentity
    });
    const normalizedCaptured = normalizeTmuxCapture(captured);
    const commandStillBuffered = normalizedCaptured.includes(expected) || compactExpected.length > 0 && normalizeTmuxCaptureForDelivery(captured).includes(compactExpected);
    if (!commandStillBuffered) {
      return true;
    }
    const status = await getPaneCurrentCommandStatus(
      paneId,
      opts.tmuxServerIdentity
    );
    if (status?.dead) {
      return false;
    }
    if (status && paneCurrentCommandLooksSubmitted(status.command)) {
      return true;
    }
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break;
    await sleep3(Math.min(pollIntervalMs, remainingMs));
    pollIntervalMs = Math.min(
      Math.max(pollIntervalMs * 2, pollIntervalMs + 1),
      maxPollIntervalMs
    );
  }
  return false;
}
function writePaneEnvFile(values) {
  const directory = (0, import_fs11.mkdtempSync)((0, import_path15.join)((0, import_os4.tmpdir)(), "omc-pane-env-"));
  const file = (0, import_path15.join)(directory, "env");
  const body = Object.entries(values).map(([key, value]) => `export ${key}=${shellQuote(value)}
`).join("");
  (0, import_fs11.writeFileSync)(file, body, { mode: 384, flag: "wx" });
  return file;
}
function discardPaneEnvFile(envFile) {
  if (!envFile) return;
  (0, import_fs11.rmSync)((0, import_path15.dirname)(envFile), { recursive: true, force: true });
}
function workerPaneShellCommand() {
  if (process.platform === "win32" && !isUnixLikeOnWindows2()) {
    return { args: [getDefaultShell()], envFile: null };
  }
  if (process.platform === "win32") return { args: [], envFile: null };
  const shell = getDefaultShell();
  const baseline = buildProviderEnvironment({ SHELL: shell });
  const inline = buildProviderEnvironment(
    { SHELL: shell },
    process.env,
    process.platform,
    []
  );
  const passthrough = Object.fromEntries(
    Object.entries(baseline).filter(([key, value]) => inline[key] !== value)
  );
  const inheritedPaneEnvironment = [
    "TERM",
    "COLORTERM",
    "TMUX",
    "TMUX_PANE",
    "TMUX_TMPDIR",
    "LANG",
    "LC_ALL",
    "LC_CTYPE"
  ].map((key) => `${key}="$${key}"`);
  const inlineAssignments = Object.entries(inline).map(
    ([key, value]) => `${key}=${shellQuote(value)}`
  );
  if (Object.keys(passthrough).length === 0) {
    const command2 = [
      "/usr/bin/env",
      "-i",
      ...inlineAssignments,
      ...inheritedPaneEnvironment,
      shellQuote(shell),
      "-l"
    ].join(" ");
    return { args: [command2], envFile: null };
  }
  const envFile = writePaneEnvFile(passthrough);
  const bootstrap = '. "$OMC_PANE_ENV_FILE" && rm -rf -- "${OMC_PANE_ENV_FILE%/*}" && unset OMC_PANE_ENV_FILE && exec "$SHELL" -l';
  const command = [
    "/usr/bin/env",
    "-i",
    ...inlineAssignments,
    `OMC_PANE_ENV_FILE=${shellQuote(envFile)}`,
    ...inheritedPaneEnvironment,
    "/bin/sh",
    "-c",
    shellQuote(bootstrap)
  ].join(" ");
  return { args: [command], envFile };
}
async function runPaneCreationCommand(identity, nativeCommand, paneShell, resourceFields) {
  let result;
  try {
    result = await runGuardedNativeTmuxCreationCommand(
      identity,
      nativeCommand,
      resourceFields
    );
  } catch (error) {
    discardPaneEnvFile(paneShell.envFile);
    throw error;
  }
  if (result.outcome === "not_executed") discardPaneEnvFile(paneShell.envFile);
  return result;
}
function escapeForCmdSet(value) {
  return value.replace(/(["%])/g, "$1$1");
}
function assertSafeCmdValue2(value) {
  if (/[\r\n\0]/.test(value))
    throw new Error("Invalid Windows command value: contains CR, LF, or NUL");
}
function shellNameFromPath(shellPath) {
  const shellName = (0, import_path15.basename)(shellPath.replace(/\\/g, "/"));
  return shellName.replace(/\.(exe|cmd|bat)$/i, "");
}
function shellEscape(value) {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}
function assertSafeEnvKey(key) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    throw new Error(`Invalid environment key: "${key}"`);
  }
}
function isAbsoluteLaunchBinaryPath(value) {
  return (0, import_path15.isAbsolute)(value) || import_path15.win32.isAbsolute(value);
}
function assertSafeLaunchBinary(launchBinary) {
  if (launchBinary.trim().length === 0) {
    throw new Error("Invalid launchBinary: value cannot be empty");
  }
  if (launchBinary !== launchBinary.trim()) {
    throw new Error(
      "Invalid launchBinary: value cannot have leading/trailing whitespace"
    );
  }
  if (DANGEROUS_LAUNCH_BINARY_CHARS.test(launchBinary)) {
    throw new Error(
      "Invalid launchBinary: contains dangerous shell metacharacters"
    );
  }
  if (/\s/.test(launchBinary) && !isAbsoluteLaunchBinaryPath(launchBinary)) {
    throw new Error("Invalid launchBinary: paths with spaces must be absolute");
  }
}
function getLaunchWords(config) {
  if (config.launchBinary) {
    assertSafeLaunchBinary(config.launchBinary);
    return [config.launchBinary, ...config.launchArgs ?? []];
  }
  if (config.launchCmd) {
    throw new Error(
      "launchCmd is deprecated and has been removed for security reasons. Use launchBinary + launchArgs instead."
    );
  }
  throw new Error(
    "Missing worker launch command. Provide launchBinary or launchCmd."
  );
}
function buildWorkerStartCommand(config) {
  const shell = getDefaultShell();
  const launchSpec = buildWorkerLaunchSpec(process.env.SHELL);
  const providerLaunchWords = getLaunchWords(config);
  const launchWords = config.launchAttempt ? [process.execPath, config.launchAttempt.runtimeCliPath, "--worker-launch"] : providerLaunchWords;
  const envVars = config.launchAttempt ? {
    // Supervised launches carry the attempt-owned bootstrap descriptor by
    // path (never inline): secrets stay out of the process list and tmux
    // scrollback, and the delivered command stays small. The runtime CLI
    // validates and consumes the descriptor before running the provider.
    // Team identity (team_name, worker_name, provider, instance_id) is read
    // from the descriptor, not from environment vars, keeping the typed
    // command under 1024 bytes even with long cwd paths.
    OMC_WORKER_LAUNCH_SPEC_FILE: config.launchAttempt.bootstrapDescriptorPath
  } : config.envVars;
  const shouldSourceRc = process.env.OMC_TEAM_NO_RC !== "1";
  if (process.platform === "win32" && !isUnixLikeOnWindows2()) {
    const windowsEnvVars = { ...envVars };
    if (windowsEnvVars.OMC_WORKER_LAUNCH_SPEC) {
      windowsEnvVars.OMC_WORKER_LAUNCH_SPEC_B64 = Buffer.from(
        windowsEnvVars.OMC_WORKER_LAUNCH_SPEC,
        "utf8"
      ).toString("base64");
      delete windowsEnvVars.OMC_WORKER_LAUNCH_SPEC;
    }
    if (windowsEnvVars.OMC_RECOVERY_GATE_SPEC) {
      windowsEnvVars.OMC_RECOVERY_GATE_SPEC_B64 = Buffer.from(
        windowsEnvVars.OMC_RECOVERY_GATE_SPEC,
        "utf8"
      ).toString("base64");
      delete windowsEnvVars.OMC_RECOVERY_GATE_SPEC;
    }
    const envPrefix = [
      'set "NoDefaultCurrentDirectoryInExePath=1"',
      ...Object.entries(windowsEnvVars).filter(
        ([key]) => key.toUpperCase() !== "NODEFAULTCURRENTDIRECTORYINEXEPATH"
      ).map(([key, value]) => {
        assertSafeEnvKey(key);
        assertSafeCmdValue2(value);
        return `set "${key}=${escapeForCmdSet(value)}"`;
      })
    ].join(" && ");
    const launch = launchWords.map((part) => {
      assertSafeCmdValue2(part);
      return `"${escapeForCmdSet(part)}"`;
    }).join(" ");
    const cmdBody = envPrefix ? `${envPrefix} && ${launch}` : launch;
    return `${shell} /d /s /c "${cmdBody}" & exit /b`;
  }
  const envAssignments = Object.entries(envVars).map(([key, value]) => {
    assertSafeEnvKey(key);
    return `${key}=${shellEscape(value)}`;
  });
  const shellName = shellNameFromPath(shell) || "bash";
  const isFish = shellName === "fish";
  const execArgsCommand = isFish ? "exec $argv" : 'exec "$@"';
  let rcFile = (launchSpec.shell === shell ? launchSpec.rcFile : null) ?? "";
  if (!rcFile && process.env.HOME) {
    rcFile = isFish ? `${process.env.HOME}/.config/fish/config.fish` : `${process.env.HOME}/.${shellName}rc`;
  }
  const script = isFish ? shouldSourceRc && rcFile ? `test -f ${shellEscape(rcFile)}; and source ${shellEscape(rcFile)}; ${execArgsCommand}` : execArgsCommand : shouldSourceRc && rcFile ? `[ -f ${shellEscape(rcFile)} ] && . ${shellEscape(rcFile)}; ${execArgsCommand}` : execArgsCommand;
  const shellFlags = isFish ? ["-l", "-c"] : ["-lc"];
  return [
    shellEscape("env"),
    ...envAssignments,
    ...[shell, ...shellFlags, script, "--", ...launchWords].map(shellEscape)
  ].join(" ");
}
function validateTmux(hasTmuxContext = false) {
  if (hasTmuxContext) {
    return;
  }
  try {
    tmuxShell("-V", { stripTmux: true, timeout: 5e3, stdio: "pipe" });
  } catch {
    throw new Error(
      "tmux is not available. Install it:\n  macOS: brew install tmux\n  Ubuntu/Debian: sudo apt-get install tmux\n  Fedora: sudo dnf install tmux\n  Arch: sudo pacman -S tmux\n  Windows: winget install psmux"
    );
  }
}
function sanitizeName(name) {
  const sanitized = name.replace(/[^a-zA-Z0-9-]/g, "");
  if (sanitized.length === 0) {
    throw new Error(
      `Invalid name: "${name}" contains no valid characters (alphanumeric or hyphen)`
    );
  }
  if (sanitized.length < 2) {
    throw new Error(
      `Invalid name: "${name}" too short after sanitization (minimum 2 characters)`
    );
  }
  return sanitized.slice(0, 50);
}
function sessionName(teamName, workerName) {
  return `${TMUX_SESSION_PREFIX}-${sanitizeName(teamName)}-${sanitizeName(workerName)}`;
}
function isSessionAlive(teamName, workerName) {
  const name = sessionName(teamName, workerName);
  try {
    tmuxExec(["has-session", "-t", name], {
      stripTmux: true,
      stdio: "pipe",
      timeout: 5e3
    });
    return true;
  } catch {
    return false;
  }
}
function listActiveSessions(teamName) {
  const prefix = `${TMUX_SESSION_PREFIX}-${sanitizeName(teamName)}-`;
  try {
    const output = tmuxShell("list-sessions -F '#{session_name}'", {
      timeout: 5e3,
      stdio: ["pipe", "pipe", "pipe"]
    });
    return output.trim().split("\n").filter((s) => s.startsWith(prefix)).map((s) => s.slice(prefix.length));
  } catch {
    return [];
  }
}
function paneIdentityIsProviderNative(provider, paneId) {
  if (provider === "tmux") return /^%\d+$/.test(paneId);
  return paneId.length <= 256 && !paneId.startsWith("%") && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(paneId);
}
function sameTmuxServerIdentity(left, right) {
  return Boolean(
    left && right && left.socket_path === right.socket_path && left.server_pid === right.server_pid && left.process_started_at === right.process_started_at
  );
}
function proveWorkerPaneOwnership(evidence, constraints) {
  if (!evidence.commandSucceeded) return { ok: false, reason: "split_failed" };
  if (evidence.provider === "tmux" && !isValidTmuxServerIdentity(evidence.tmuxServerIdentity)) {
    return { ok: false, reason: "tmux_server_identity_missing" };
  }
  if (evidence.provider === "tmux" && constraints.tmuxServerIdentity && !sameTmuxServerIdentity(
    evidence.tmuxServerIdentity,
    constraints.tmuxServerIdentity
  )) {
    return { ok: false, reason: "tmux_server_identity_mismatch" };
  }
  if (!evidence.paneId) return { ok: false, reason: "pane_id_missing" };
  if (!paneIdentityIsProviderNative(evidence.provider, evidence.paneId))
    return { ok: false, reason: "pane_id_malformed" };
  if (evidence.paneId === constraints.leaderPaneId)
    return { ok: false, reason: "leader_alias" };
  if (constraints.requireNewFromSplitTarget !== false && evidence.paneId === evidence.splitTarget) {
    return { ok: false, reason: "split_target_alias" };
  }
  if (constraints.reservedPaneIds.includes(evidence.paneId))
    return { ok: false, reason: "reserved_worker_alias" };
  return {
    ok: true,
    ownership: {
      provider: evidence.provider,
      providerTarget: constraints.providerTarget,
      paneId: evidence.paneId,
      splitTarget: evidence.splitTarget,
      leaderPaneId: constraints.leaderPaneId,
      reservedPaneIds: [...constraints.reservedPaneIds],
      source: "split",
      ...evidence.provider === "tmux" && evidence.tmuxServerIdentity ? { tmuxServerIdentity: { ...evidence.tmuxServerIdentity } } : {}
    }
  };
}
async function adoptWorkerPaneOwnership(input) {
  if (input.provider === "tmux" && !isValidTmuxServerIdentity(input.tmuxServerIdentity)) {
    return { ok: false, reason: "tmux_server_identity_missing" };
  }
  if (input.provider === "tmux") {
    const serverState = await observeTmuxServerIdentity(
      input.tmuxServerIdentity,
      input.serverIdentityDependencies
    );
    if (serverState !== "matching") {
      return { ok: false, reason: "tmux_server_identity_unknown" };
    }
  }
  const proved = proveWorkerPaneOwnership(
    {
      commandSucceeded: true,
      provider: input.provider,
      splitTarget: "",
      direction: "right",
      rawOutput: "",
      stderr: "",
      paneId: input.paneId,
      ...input.provider === "tmux" ? { tmuxServerIdentity: input.tmuxServerIdentity } : {}
    },
    {
      providerTarget: input.providerTarget,
      leaderPaneId: input.leaderPaneId,
      reservedPaneIds: input.reservedPaneIds,
      requireNewFromSplitTarget: false,
      ...input.provider === "tmux" ? { tmuxServerIdentity: input.tmuxServerIdentity } : {}
    }
  );
  if (!proved.ok) return proved;
  const membershipDependencies = input.dependencies ?? defaultMailboxTargetOwnershipDependencies;
  const dependenciesWithIdentityProbe = input.serverIdentityDependencies ? {
    ...membershipDependencies,
    serverIdentityDependencies: input.serverIdentityDependencies
  } : membershipDependencies;
  const target = {
    provider: input.provider,
    providerTarget: input.providerTarget,
    recipient: "worker",
    recipientRole: "worker",
    paneId: input.paneId,
    ...input.provider === "tmux" ? { tmuxServerIdentity: input.tmuxServerIdentity } : {}
  };
  const membership = input.provider === "cmux" ? await verifyCmuxTargetOwnershipWithRetry(
    target,
    dependenciesWithIdentityProbe
  ) : await verifyTeamTargetOwnership(target, dependenciesWithIdentityProbe);
  if (membership.kind === "foreign")
    return { ok: false, reason: "pane_foreign" };
  if (membership.kind !== "owned")
    return { ok: false, reason: "pane_membership_unavailable" };
  return {
    ok: true,
    ownership: { ...proved.ownership, source: "adopted" }
  };
}
async function workerPaneBelongsToProviderTarget(input, dependencies = input.dependencies ?? defaultMailboxTargetOwnershipDependencies) {
  const target = {
    provider: input.provider,
    providerTarget: input.providerTarget,
    recipient: "worker",
    recipientRole: "worker",
    paneId: input.paneId,
    ...input.provider === "tmux" ? { tmuxServerIdentity: input.tmuxServerIdentity } : {}
  };
  const membership = input.provider === "cmux" ? await verifyCmuxTargetOwnershipWithRetry(target, dependencies) : await verifyTeamTargetOwnership(target, dependencies);
  return membership.kind === "owned";
}
async function workerPaneBelongsToOwnedProviderTarget(input) {
  if (input.provider !== "tmux")
    return workerPaneBelongsToProviderTarget(input);
  if (!isValidTmuxServerIdentity(input.tmuxServerIdentity)) return false;
  if (await observeTmuxServerIdentity(
    input.tmuxServerIdentity,
    input.serverIdentityDependencies
  ) !== "matching") {
    return false;
  }
  const base = input.dependencies ?? defaultMailboxTargetOwnershipDependencies;
  const dependencies = input.serverIdentityDependencies ? { ...base, serverIdentityDependencies: input.serverIdentityDependencies } : base;
  return workerPaneBelongsToProviderTarget(input, dependencies);
}
async function splitTeamWorkerPaneWithEvidence(splitTarget, direction, cwd, provider = isCmuxContext() ? "cmux" : "tmux", tmuxServerIdentity, serverIdentityDependencies, herdrWorkspaceId) {
  try {
    if (provider === "herdr") {
      const workspaceId = herdrWorkspaceId || (isHerdrPaneId(splitTarget) ? herdrWorkspaceIdFromPaneId(splitTarget) : null);
      if (!workspaceId) {
        return {
          commandSucceeded: false,
          provider,
          splitTarget,
          direction,
          rawOutput: "",
          stderr: "herdr_workspace_unknown",
          paneId: null
        };
      }
      const tab = await herdrCreateWorkerTab(workspaceId, cwd, `worker-split`);
      return {
        commandSucceeded: true,
        provider,
        splitTarget,
        direction,
        rawOutput: tab.paneId,
        stderr: "",
        paneId: tab.paneId
      };
    }
    if (provider === "cmux") {
      const splitResult2 = await cmuxSplitSurface(splitTarget, direction, cwd);
      return {
        commandSucceeded: true,
        provider,
        splitTarget,
        direction,
        rawOutput: splitResult2.stdout,
        stderr: splitResult2.stderr,
        paneId: splitResult2.paneId
      };
    }
    const identity = tmuxServerIdentity;
    if (!identity) {
      return {
        commandSucceeded: false,
        provider,
        splitTarget,
        direction,
        rawOutput: "",
        stderr: "tmux_server_identity_unknown",
        paneId: null
      };
    }
    const state = await observeTmuxServerIdentity(
      identity,
      serverIdentityDependencies
    );
    if (state !== "matching") {
      return {
        commandSucceeded: false,
        provider,
        splitTarget,
        direction,
        rawOutput: "",
        stderr: `tmux_server_identity_${state}`,
        paneId: null,
        tmuxServerIdentity: identity
      };
    }
    const splitType = direction === "right" ? "-h" : "-v";
    const splitPaneShell = workerPaneShellCommand();
    const splitArgs = [
      "split-window",
      splitType,
      "-t",
      splitTarget,
      "-d",
      "-P",
      "-F",
      "#{pane_id}	#{socket_path}	#{pid}",
      "-c",
      cwd,
      ...splitPaneShell.args
    ];
    const splitResult = await runPaneCreationCommand(
      identity,
      tmuxCommandString(splitArgs, ["#{pane_id}	#{socket_path}	#{pid}"]),
      splitPaneShell,
      3
    );
    const parsed = splitResult.outcome === "executed" ? parseTmuxCreationRecord(
      splitResult.stdout,
      3,
      serverIdentityDependencies?.processIdentity ?? currentStrictProcessStartIdentity,
      identity
    ) : null;
    const associatedIdentity = parsed?.identity;
    const identityMatches2 = Boolean(
      associatedIdentity && sameTmuxServerIdentity(associatedIdentity, identity)
    );
    const revalidated = identityMatches2 && await observeTmuxServerIdentity(
      identity,
      serverIdentityDependencies
    ) === "matching";
    return {
      commandSucceeded: splitResult.outcome === "executed" && revalidated,
      provider,
      splitTarget,
      direction,
      rawOutput: splitResult.stdout,
      stderr: splitResult.stderr,
      paneId: revalidated ? parsed.paneId : null,
      tmuxServerIdentity: revalidated ? { ...identity } : void 0
    };
  } catch (error) {
    const failure = error;
    return {
      commandSucceeded: false,
      provider,
      splitTarget,
      direction,
      rawOutput: typeof failure.stdout === "string" ? failure.stdout : "",
      stderr: typeof failure.stderr === "string" ? failure.stderr : typeof failure.message === "string" ? failure.message : String(error),
      paneId: null
    };
  }
}
async function splitTeamWorkerPane(splitTarget, direction, cwd) {
  return (await splitTeamWorkerPaneWithEvidence(splitTarget, direction, cwd)).paneId;
}
function strictIdentityUnavailableError(platform, loadNative = getNativeContainedFs) {
  if (platform === "darwin") {
    try {
      loadNative();
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      return new Error(`tmux_server_identity_probe_unavailable: ${detail}`, {
        cause
      });
    }
  }
  return new Error("tmux_server_identity_probe_unavailable");
}
async function createTeamSession(teamName, workerCount, cwd, options = {}) {
  const multiplexerContext = detectTeamMultiplexerContext();
  const inTmux = multiplexerContext === "tmux";
  const inCmux = multiplexerContext === "cmux";
  const herdrBackend = resolveTeamMultiplexer(options.multiplexer) === "herdr";
  const useDedicatedWindow = Boolean(options.newWindow && inTmux);
  if (multiplexerContext === "none" && !herdrBackend) {
    validateTmux();
  }
  if (!inCmux && !herdrBackend && !currentStrictProcessStartIdentity()) {
    throw strictIdentityUnavailableError(process.platform);
  }
  let tmuxServerIdentity;
  let freshDetachedServerIdentity;
  let freshDetachedServerStarted = false;
  let freshSocketPathForEvidence;
  let detachedCreationKnown = false;
  let createdDetachedSession = false;
  let createdDedicatedWindow = false;
  if (inTmux) {
    tmuxServerIdentity = await captureTmuxServerIdentity() ?? void 0;
    if (!tmuxServerIdentity)
      throw new Error("tmux_server_identity_unavailable");
  }
  const envPaneIdRaw = (process.env.TMUX_PANE ?? "").trim();
  const envPaneId = /^%\d+$/.test(envPaneIdRaw) ? envPaneIdRaw : "";
  let sessionAndWindow = "";
  let leaderPaneId = envPaneId;
  let sessionMode = inTmux ? "split-pane" : "detached-session";
  const workerPaneIds = [];
  let untrackedProviderAllocation = false;
  const partialCreationSession = (name = sessionAndWindow, mode = sessionMode) => ({
    sessionName: name || (inCmux ? "cmux:unknown" : ""),
    leaderPaneId,
    workerPaneIds: [...workerPaneIds],
    sessionMode: mode,
    ...tmuxServerIdentity ? { tmuxServerIdentity: { ...tmuxServerIdentity } } : {}
  });
  if (herdrBackend) {
    await ensureHerdrServer();
    const workspaceId = await herdrCreateTeamWorkspace(
      cwd,
      `${TMUX_SESSION_PREFIX}-${sanitizeName(teamName)}`
    );
    sessionAndWindow = `herdr:${workspaceId}`;
    leaderPaneId = (process.env.HERDR_PANE_ID ?? "").trim();
    sessionMode = "split-pane";
  } else if (inCmux) {
    const cmuxLeaderSurface = (process.env.CMUX_SURFACE_ID ?? "").trim();
    if (!cmuxLeaderSurface) {
      throw new Error(
        "CMUX_SURFACE_ID is required to create a cmux team session"
      );
    }
    sessionAndWindow = `cmux:${process.env.CMUX_WORKSPACE_ID || "workspace"}`;
    leaderPaneId = cmuxLeaderSurface;
    sessionMode = "split-pane";
  } else if (!inTmux) {
    const existingDetachedIdentity = await captureTmuxServerIdentity() ?? void 0;
    const detachedSessionName = `${TMUX_SESSION_PREFIX}-${sanitizeName(teamName)}-${Date.now().toString(36)}`;
    const partialDetachedSession = () => ({
      sessionName: sessionAndWindow || `${detachedSessionName}:0`,
      leaderPaneId,
      workerPaneIds: [],
      sessionMode: "detached-session",
      ...tmuxServerIdentity ? { tmuxServerIdentity: { ...tmuxServerIdentity } } : {}
    });
    const detachedPaneShell = workerPaneShellCommand();
    const detachedFormat = "#S:#{window_index}	#{pane_id}	#{socket_path}	#{pid}";
    const detachedArgs = [
      "new-session",
      "-d",
      "-P",
      "-F",
      detachedFormat,
      "-s",
      detachedSessionName,
      "-c",
      cwd,
      ...detachedPaneShell.args
    ];
    const cleanupFreshDetachedServer = async () => {
      if (!freshDetachedServerIdentity) return false;
      const result = await runGuardedNativeTmuxCommand(
        freshDetachedServerIdentity,
        "kill-server"
      ).catch(() => ({ outcome: "unknown" }));
      if (result.outcome === "executed") return true;
      return await observeTmuxServerIdentity(freshDetachedServerIdentity) === "dead";
    };
    const cleanupDetachedSession = async () => {
      if (freshDetachedServerIdentity) return cleanupFreshDetachedServer();
      if (!existingDetachedIdentity || !detachedCreationKnown) return false;
      return await killTeamSession(detachedSessionName, void 0, void 0, {
        sessionMode: "detached-session",
        tmuxServerIdentity: existingDetachedIdentity
      }).catch(() => false);
    };
    let detachedResult;
    if (existingDetachedIdentity) {
      tmuxServerIdentity = existingDetachedIdentity;
      try {
        detachedResult = await runPaneCreationCommand(
          existingDetachedIdentity,
          tmuxCommandString(detachedArgs, [detachedFormat]),
          detachedPaneShell,
          4
        );
      } catch (error) {
        const cleaned = await cleanupDetachedSession();
        if (!cleaned) {
          throw new TeamSessionCreationError(
            `tmux_creation_cleanup_unverified:${error instanceof Error ? error.message : String(error)}`,
            partialDetachedSession()
          );
        }
        throw error;
      }
    } else {
      resolveTmuxServerGuardRuntime();
      const freshSocketPath = buildPrivateTmuxSocketPath();
      freshSocketPathForEvidence = freshSocketPath;
      try {
        freshDetachedServerStarted = true;
        const keepalive = await tmuxExecAsync(
          buildDetachedTmuxServerKeepaliveArgs(freshSocketPath),
          { stripTmux: true, timeout: 5e3 }
        );
        if (keepalive.stderr.trim()) {
          throw new Error(
            `Failed to hold detached tmux server: "${redactBoundedDiagnostic(keepalive.stderr)}"`
          );
        }
        tmuxServerIdentity = await captureTmuxServerIdentity(freshSocketPath) ?? void 0;
        if (!tmuxServerIdentity) {
          throw new Error("tmux_server_identity_unavailable");
        }
        freshDetachedServerIdentity = tmuxServerIdentity;
        detachedResult = await runPaneCreationCommand(
          tmuxServerIdentity,
          tmuxCommandString(detachedArgs, [detachedFormat]),
          detachedPaneShell,
          4
        );
      } catch (error) {
        discardPaneEnvFile(detachedPaneShell.envFile);
        const cleaned = await cleanupDetachedSession();
        if (!cleaned && freshDetachedServerStarted) {
          throw new TeamSessionCreationError(
            `tmux_creation_cleanup_unverified:${error instanceof Error ? error.message : String(error)}`,
            partialDetachedSession(),
            {
              provider: "tmux",
              operation: "start-server",
              rawOutput: "",
              stderr: error instanceof Error ? error.message : String(error),
              socketPath: freshSocketPathForEvidence,
              ...tmuxServerIdentity ? { tmuxServerIdentity } : {}
            }
          );
        }
        throw error;
      }
    }
    if (detachedResult.outcome !== "executed" || detachedResult.stderr.trim()) {
      const cleaned = await cleanupDetachedSession();
      if (!cleaned) {
        throw new TeamSessionCreationError(
          "tmux_creation_cleanup_unverified",
          partialDetachedSession(),
          {
            provider: "tmux",
            operation: "new-session",
            rawOutput: detachedResult.stdout,
            stderr: detachedResult.stderr,
            ...freshSocketPathForEvidence ? { socketPath: freshSocketPathForEvidence } : {},
            ...tmuxServerIdentity ? { tmuxServerIdentity } : {}
          }
        );
      }
      throw new Error(
        `Failed to create detached tmux session: "${detachedResult.stdout.trim()}"`
      );
    }
    const detachedRecord = parseTmuxCreationRecord(
      detachedResult.stdout,
      4,
      currentStrictProcessStartIdentity,
      tmuxServerIdentity
    );
    if (!detachedRecord || existingDetachedIdentity && !sameTmuxServerIdentity(
      detachedRecord.identity,
      existingDetachedIdentity
    )) {
      const cleaned = await cleanupDetachedSession();
      if (!cleaned) {
        throw new TeamSessionCreationError(
          "tmux_creation_cleanup_unverified",
          partialDetachedSession(),
          {
            provider: "tmux",
            operation: "new-session",
            rawOutput: detachedResult.stdout,
            stderr: detachedResult.stderr,
            ...freshSocketPathForEvidence ? { socketPath: freshSocketPathForEvidence } : {},
            ...tmuxServerIdentity ? { tmuxServerIdentity } : {}
          }
        );
      }
      throw new Error(
        `Failed to create detached tmux session: "${detachedResult.stdout.trim()}"`
      );
    }
    if (freshDetachedServerIdentity && !sameTmuxServerIdentity(
      detachedRecord.identity,
      freshDetachedServerIdentity
    )) {
      const cleaned = await cleanupDetachedSession();
      if (!cleaned) {
        throw new TeamSessionCreationError(
          "tmux_creation_cleanup_unverified",
          partialDetachedSession(),
          {
            provider: "tmux",
            operation: "new-session",
            rawOutput: detachedResult.stdout,
            stderr: detachedResult.stderr,
            ...freshSocketPathForEvidence ? { socketPath: freshSocketPathForEvidence } : {},
            tmuxServerIdentity: freshDetachedServerIdentity
          }
        );
      }
      throw new Error("tmux_server_identity_creation_mismatch");
    }
    tmuxServerIdentity = detachedRecord.identity;
    sessionAndWindow = detachedRecord.resource;
    leaderPaneId = detachedRecord.paneId;
    detachedCreationKnown = true;
    createdDetachedSession = true;
    if (freshDetachedServerIdentity) {
      const restored = await runGuardedNativeTmuxCommand(
        tmuxServerIdentity,
        tmuxCommandString(["set-option", "-g", "exit-empty", "on"])
      );
      if (restored.outcome !== "executed") {
        const cleaned = await cleanupDetachedSession();
        if (!cleaned) {
          throw new TeamSessionCreationError(
            "tmux_creation_cleanup_unverified",
            partialDetachedSession(),
            {
              provider: "tmux",
              operation: "new-session",
              rawOutput: detachedResult.stdout,
              stderr: detachedResult.stderr,
              ...freshSocketPathForEvidence ? { socketPath: freshSocketPathForEvidence } : {},
              tmuxServerIdentity: freshDetachedServerIdentity
            }
          );
        }
        throw new Error("tmux_server_identity_restore_failed");
      }
    }
    if (await observeTmuxServerIdentity(tmuxServerIdentity) !== "matching") {
      const cleaned = await cleanupDetachedSession();
      if (!cleaned) {
        throw new TeamSessionCreationError(
          "tmux_creation_cleanup_unverified",
          partialDetachedSession(),
          {
            provider: "tmux",
            operation: "new-session",
            rawOutput: detachedResult.stdout,
            stderr: detachedResult.stderr,
            ...freshSocketPathForEvidence ? { socketPath: freshSocketPathForEvidence } : {},
            ...tmuxServerIdentity ? { tmuxServerIdentity } : {}
          }
        );
      }
      throw new Error("tmux_server_identity_revalidation_failed");
    }
  }
  if (inTmux && envPaneId) {
    try {
      const targetedContextResult = await tmuxExecAsync(
        tmuxArgsForIdentity(tmuxServerIdentity, [
          "display-message",
          "-p",
          "-t",
          envPaneId,
          "#S:#I"
        ]),
        { stripTmux: true, timeout: 2e3 }
      );
      sessionAndWindow = targetedContextResult.stdout.trim();
    } catch {
      sessionAndWindow = "";
      leaderPaneId = "";
    }
  }
  if (!herdrBackend && (!sessionAndWindow || !leaderPaneId)) {
    const contextResult = await tmuxCmdAsync(
      tmuxArgsForIdentity(tmuxServerIdentity, [
        "display-message",
        "-p",
        "#S:#I #{pane_id}"
      ]),
      { stripTmux: true, timeout: 2e3 }
    );
    const contextLine = contextResult.stdout.trim();
    const contextMatch = contextLine.match(/^(\S+)\s+(%\d+)$/);
    if (!contextMatch) {
      throw new Error(`Failed to resolve tmux context: "${contextLine}"`);
    }
    sessionAndWindow = contextMatch[1];
    leaderPaneId = contextMatch[2];
  }
  if (useDedicatedWindow) {
    const targetSession = sessionAndWindow.split(":")[0] ?? sessionAndWindow;
    const windowName = `omc-${sanitizeName(teamName)}`.slice(0, 32);
    const newWindowPaneShell = workerPaneShellCommand();
    const newWindowArgs = [
      "new-window",
      "-d",
      "-P",
      "-F",
      "#S:#I	#{pane_id}	#{socket_path}	#{pid}",
      "-t",
      `=${targetSession}`,
      "-n",
      windowName,
      "-c",
      cwd,
      ...newWindowPaneShell.args
    ];
    let newWindowResult;
    try {
      newWindowResult = await runPaneCreationCommand(
        tmuxServerIdentity,
        tmuxCommandString(newWindowArgs, [
          "#S:#I	#{pane_id}	#{socket_path}	#{pid}"
        ]),
        newWindowPaneShell,
        4
      );
    } catch (error) {
      const creationError = new TeamSessionCreationError(
        `Failed to create team tmux window: ${error instanceof Error ? error.message : String(error)}`,
        partialCreationSession(sessionAndWindow, "dedicated-window"),
        {
          provider: "tmux",
          operation: "new-window",
          rawOutput: "",
          stderr: error instanceof Error ? error.message : String(error),
          ...tmuxServerIdentity ? { tmuxServerIdentity } : {}
        }
      );
      creationError.cleanupStatus = "verified";
      throw creationError;
    }
    const newWindowRecord = newWindowResult.outcome === "executed" ? parseTmuxCreationRecord(
      newWindowResult.stdout,
      4,
      currentStrictProcessStartIdentity,
      tmuxServerIdentity
    ) : null;
    if (!newWindowRecord || !sameTmuxServerIdentity(newWindowRecord.identity, tmuxServerIdentity)) {
      const creationError = new TeamSessionCreationError(
        `Failed to create team tmux window: "${newWindowResult.stdout.trim()}"`,
        partialCreationSession(sessionAndWindow, "dedicated-window"),
        {
          provider: "tmux",
          operation: "new-window",
          rawOutput: newWindowResult.stdout,
          stderr: newWindowResult.stderr,
          tmuxServerIdentity
        }
      );
      if (newWindowResult.outcome === "not_executed") {
        creationError.cleanupStatus = "verified";
      } else {
      }
      throw creationError;
    }
    sessionAndWindow = newWindowRecord.resource;
    leaderPaneId = newWindowRecord.paneId;
    sessionMode = "dedicated-window";
    createdDedicatedWindow = true;
  }
  const teamTarget = sessionAndWindow;
  const resolvedSessionName = teamTarget.split(":")[0];
  if (!inCmux && tmuxServerIdentity) {
    try {
      await configureTmuxClipboardAtIdentity(
        tmuxServerIdentity,
        `=${resolvedSessionName}:`
      );
    } catch {
    }
  }
  const partialSession = () => ({
    sessionName: teamTarget,
    leaderPaneId,
    workerPaneIds: [...workerPaneIds],
    sessionMode,
    ...tmuxServerIdentity ? { tmuxServerIdentity: { ...tmuxServerIdentity } } : {}
  });
  const cleanupCreatedResources = async () => {
    if (!tmuxServerIdentity && !inCmux && !herdrBackend) return false;
    if (untrackedProviderAllocation) {
      const originalServerObservation = tmuxServerIdentity ? await observeTmuxServerIdentity(tmuxServerIdentity) : "unknown";
      if (!createdDetachedSession && !createdDedicatedWindow && originalServerObservation !== "dead") {
        return false;
      }
    }
    if (herdrBackend && workerPaneIds.length === 0) {
      try {
        await herdrCloseWorkspace(herdrWorkspaceIdFromSessionTarget(teamTarget));
        return true;
      } catch {
        return false;
      }
    }
    const ownsProviderResource = createdDetachedSession || createdDedicatedWindow || workerPaneIds.length > 0;
    if (!ownsProviderResource) return true;
    const cleanupTarget = sessionMode === "detached-session" ? resolvedSessionName : teamTarget;
    try {
      return await killTeamSession(cleanupTarget, workerPaneIds, leaderPaneId, {
        sessionMode,
        ...tmuxServerIdentity ? { tmuxServerIdentity } : {}
      });
    } catch {
      return false;
    }
  };
  if (workerCount <= 0) {
    if (!inCmux && !herdrBackend) {
      if (!tmuxServerIdentity)
        throw new Error("tmux_server_identity_unavailable");
      try {
        const result = await runGuardedNativeTmuxCommand(
          tmuxServerIdentity,
          tmuxCommandString([
            "set-option",
            "-t",
            `=${resolvedSessionName}:`,
            "mouse",
            "on"
          ])
        );
        if (result.outcome !== "executed")
          throw new Error("tmux_server_guard_failed");
      } catch {
      }
      if (sessionMode !== "dedicated-window") {
        try {
          const result = await runGuardedNativeTmuxCommand(
            tmuxServerIdentity,
            tmuxCommandString(["select-pane", "-t", leaderPaneId])
          );
          if (result.outcome !== "executed")
            throw new Error("tmux_server_guard_failed");
        } catch {
        }
      }
    }
    if (tmuxServerIdentity && await observeTmuxServerIdentity(tmuxServerIdentity) !== "matching") {
      const cleaned = await cleanupCreatedResources();
      if (!cleaned) {
        throw new TeamSessionCreationError(
          "tmux_server_identity_revalidation_failed:cleanup_unverified",
          partialSession()
        );
      }
      throw new Error("tmux_server_identity_revalidation_failed");
    }
    return {
      sessionName: teamTarget,
      leaderPaneId,
      workerPaneIds,
      sessionMode,
      ...tmuxServerIdentity ? { tmuxServerIdentity } : {}
    };
  }
  try {
    for (let i = 0; i < workerCount; i++) {
      const splitTarget = i === 0 ? leaderPaneId : workerPaneIds[i - 1];
      if (herdrBackend) {
        const workspaceId = herdrWorkspaceIdFromSessionTarget(
          teamTarget || sessionAndWindow
        );
        const tab = await herdrCreateWorkerTab(
          workspaceId,
          cwd,
          `worker-${i + 1}`
        );
        workerPaneIds.push(tab.paneId);
        continue;
      }
      if (inCmux) {
        const direction = i === 0 ? "right" : "down";
        const split = await cmuxSplitSurface(splitTarget, direction, cwd);
        if (!split.paneId) {
          const creationError = new TeamSessionCreationError(
            `Failed to resolve cmux surface id: ${JSON.stringify(split.stdout.trim())}`,
            partialSession(),
            {
              provider: "cmux",
              operation: "new-split",
              rawOutput: split.stdout,
              stderr: split.stderr
            }
          );
          untrackedProviderAllocation = true;
          throw creationError;
        }
        workerPaneIds.push(split.paneId);
        continue;
      }
      const splitType = i === 0 ? "-h" : "-v";
      const splitPaneShell = workerPaneShellCommand();
      const splitArgs = [
        "split-window",
        splitType,
        "-t",
        splitTarget,
        "-d",
        "-P",
        "-F",
        "#{pane_id}	#{socket_path}	#{pid}",
        "-c",
        cwd,
        ...splitPaneShell.args
      ];
      const splitResult = await runPaneCreationCommand(
        tmuxServerIdentity,
        tmuxCommandString(splitArgs, ["#{pane_id}	#{socket_path}	#{pid}"]),
        splitPaneShell,
        3
      );
      if (splitResult.outcome !== "executed") {
        const creationError = new TeamSessionCreationError(
          `tmux_server_guard_${splitResult.outcome}`,
          partialSession(),
          {
            provider: "tmux",
            operation: "split-window",
            rawOutput: splitResult.stdout,
            stderr: splitResult.stderr,
            tmuxServerIdentity
          }
        );
        if (splitResult.outcome === "not_executed") {
          creationError.cleanupStatus = "verified";
        } else {
          untrackedProviderAllocation = true;
        }
        throw creationError;
      }
      const splitRecord = parseTmuxCreationRecord(
        splitResult.stdout,
        3,
        currentStrictProcessStartIdentity,
        tmuxServerIdentity
      );
      if (!splitRecord || !sameTmuxServerIdentity(splitRecord.identity, tmuxServerIdentity)) {
        const creationError = new TeamSessionCreationError(
          `Failed to create team tmux pane: "${splitResult.stdout.trim()}"`,
          partialSession(),
          {
            provider: "tmux",
            operation: "split-window",
            rawOutput: splitResult.stdout,
            stderr: splitResult.stderr,
            tmuxServerIdentity
          }
        );
        untrackedProviderAllocation = true;
        throw creationError;
      }
      workerPaneIds.push(splitRecord.paneId);
    }
    if (!inCmux && !herdrBackend) {
      await applyMainVerticalLayout(teamTarget, {
        required: true,
        tmuxServerIdentity
      });
      try {
        const result = await runGuardedNativeTmuxCommand(
          tmuxServerIdentity,
          tmuxCommandString([
            "set-option",
            "-t",
            `=${resolvedSessionName}:`,
            "mouse",
            "on"
          ])
        );
        if (result.outcome !== "executed")
          throw new Error("tmux_server_guard_failed");
      } catch {
      }
      if (sessionMode !== "dedicated-window") {
        try {
          const result = await runGuardedNativeTmuxCommand(
            tmuxServerIdentity,
            tmuxCommandString(["select-pane", "-t", leaderPaneId])
          );
          if (result.outcome !== "executed")
            throw new Error("tmux_server_guard_failed");
        } catch {
        }
      }
    }
  } catch (error) {
    const cleaned = await cleanupCreatedResources();
    if (!cleaned) {
      throw new TeamSessionCreationError(
        `tmux_creation_cleanup_unverified:${error instanceof Error ? error.message : String(error)}`,
        partialSession(),
        error instanceof TeamSessionCreationError ? error.creationEvidence : void 0
      );
    }
    if (error instanceof TeamSessionCreationError)
      error.cleanupStatus = "verified";
    throw error;
  }
  try {
    await Promise.all(
      workerPaneIds.map(
        (workerPaneId) => waitForShellReady(workerPaneId, {
          timeoutMs: 5e3,
          tmuxServerIdentity
        })
      )
    );
    if (tmuxServerIdentity && await observeTmuxServerIdentity(tmuxServerIdentity) !== "matching") {
      throw new Error("tmux_server_identity_revalidation_failed");
    }
  } catch (error) {
    const cleaned = await cleanupCreatedResources();
    if (!cleaned) {
      throw new TeamSessionCreationError(
        `tmux_creation_cleanup_unverified:${error instanceof Error ? error.message : String(error)}`,
        partialSession(),
        error instanceof TeamSessionCreationError ? error.creationEvidence : void 0
      );
    }
    if (error instanceof TeamSessionCreationError)
      error.cleanupStatus = "verified";
    throw error;
  }
  return {
    sessionName: teamTarget,
    leaderPaneId,
    workerPaneIds,
    sessionMode,
    ...tmuxServerIdentity ? { tmuxServerIdentity } : {}
  };
}
async function spawnWorkerInPane(sessionName2, paneId, config) {
  validateTeamName(config.teamName);
  const ownedTmuxIdentity = config.tmuxServerIdentity;
  if (!isCmuxSurfaceTarget(paneId) && !isHerdrPaneId(paneId) && !ownedTmuxIdentity) {
    throw new Error("worker_start_tmux_server_identity_missing");
  }
  if (ownedTmuxIdentity) {
    if (!isValidTmuxServerIdentity(ownedTmuxIdentity) || await observeTmuxServerIdentity(ownedTmuxIdentity) !== "matching") {
      throw new Error("worker_start_tmux_server_identity_unverified");
    }
  }
  if (config.launchAttempt && config.launchAttempt.pane_id !== paneId) {
    throw new Error("worker_launch_attempt_pane_mismatch");
  }
  let startCmd = "";
  let fingerprint = config.launchAttempt?.attempt_id.slice(0, 12) ?? "unbuilt";
  let materializedTransport;
  const nativeAttemptTransport = process.platform === "win32" && !isUnixLikeOnWindows2() && Boolean(config.launchAttempt) && !isCmuxSurfaceTarget(paneId);
  const supervisedLaunch = Boolean(config.launchAttempt);
  const requireAcknowledgement = async () => {
    if (!config.launchAttempt) return;
    const accepted2 = await awaitWorkerLaunchAcknowledgement(
      config.launchAttempt
    );
    if (!accepted2.ok) {
      throw new Error(
        `worker_start_ack_${accepted2.reason}:${config.workerName}:${paneId}:${config.launchAttempt.attempt_id.slice(0, 12)}`
      );
    }
    if (!await awaitWorkerLaunchProviderStarted(config.launchAttempt)) {
      throw new Error(
        `worker_start_provider_failed:${config.workerName}:${paneId}:${config.launchAttempt.attempt_id.slice(0, 12)}`
      );
    }
  };
  try {
    if (supervisedLaunch && config.launchAttempt) {
      materializedTransport = await materializeWorkerLaunchTransport({
        attempt: config.launchAttempt,
        providerArgv: getLaunchWords(config),
        cwd: config.cwd,
        providerEnv: config.envVars,
        releaseAfterSpawn: Boolean(config.envVars.OMC_RECOVERY_GATE_SPEC),
        windowsDelivery: nativeAttemptTransport
      });
      startCmd = nativeAttemptTransport ? materializedTransport.wrapperRelativePath : buildWorkerStartCommand(config);
    } else {
      startCmd = buildWorkerStartCommand(config);
    }
    const transportKind = nativeAttemptTransport ? "attempt_wrapper" : supervisedLaunch ? "attempt_descriptor" : "inline";
    fingerprint = commandFingerprint(startCmd);
    const commandBytes = Buffer.byteLength(startCmd, "utf8");
    logWorkerSpawnDiagnostic(
      `worker start delivery begin session=${sessionName2} pane=${paneId} worker=${config.workerName} cmdSha=${fingerprint} cmdBytes=${commandBytes} transport=${transportKind}`
    );
    if (isHerdrPaneId(paneId)) {
      await herdrRunPaneCommand(paneId, startCmd);
      await requireAcknowledgement();
      logWorkerSpawnDiagnostic(
        `worker start delivery accepted session=${sessionName2} pane=${paneId} worker=${config.workerName} cmdSha=${fingerprint} transport=herdr_pane_run`
      );
      return;
    }
    if (isCmuxSurfaceTarget(paneId)) {
      await cmuxSendSurface(paneId, startCmd);
      await cmuxSendSurfaceKey(paneId, "Enter");
      await requireAcknowledgement();
      logWorkerSpawnDiagnostic(
        `worker start delivery accepted session=${sessionName2} pane=${paneId} worker=${config.workerName} cmdSha=${fingerprint}`
      );
      return;
    }
    const shellReady = await waitForShellReady(paneId, {
      tmuxServerIdentity: ownedTmuxIdentity
    });
    if (!shellReady) {
      throw new Error(
        `worker_start_shell_not_ready:${config.workerName}:${paneId}:${fingerprint}`
      );
    }
    const sendArgs = ["send-keys", "-t", paneId, "-l", startCmd];
    const sendResult = await (async () => {
      const result = await runGuardedNativeTmuxCommand(
        ownedTmuxIdentity,
        tmuxCommandString(sendArgs)
      );
      if (result.outcome !== "executed")
        throw new Error("worker_start_tmux_server_guard_failed");
      return result;
    })();
    logWorkerSpawnDiagnostic(
      `worker start send-keys literal session=${sessionName2} pane=${paneId} worker=${config.workerName} cmdSha=${fingerprint} cmdBytes=${commandBytes} sendStatus=0 stderr=${JSON.stringify(redactBoundedDiagnostic(sendResult.stderr))}`
    );
    if (!config.launchAttempt) {
      const delivered = await verifyWorkerStartCommandDelivered(
        paneId,
        startCmd,
        ownedTmuxIdentity
      );
      if (!delivered) {
        throw new Error(
          `worker_start_delivery_unverified:${config.workerName}:${paneId}:${fingerprint}`
        );
      }
    }
    const enterArgs = ["send-keys", "-t", paneId, "Enter"];
    const enterResult = await (async () => {
      const result = await runGuardedNativeTmuxCommand(
        ownedTmuxIdentity,
        tmuxCommandString(enterArgs)
      );
      if (result.outcome !== "executed")
        throw new Error("worker_start_tmux_server_guard_failed");
      return result;
    })();
    logWorkerSpawnDiagnostic(
      `worker start submit key sent session=${sessionName2} pane=${paneId} worker=${config.workerName} cmdSha=${fingerprint} cmdBytes=${commandBytes} sendStatus=0 stderr=${JSON.stringify(redactBoundedDiagnostic(enterResult.stderr))}`
    );
    if (nativeAttemptTransport) {
      const [status, observation] = await Promise.all([
        getPaneCurrentCommandStatus(paneId, ownedTmuxIdentity),
        capturePaneObservation(paneId, {
          operation: "worker-start-post-enter",
          ...ownedTmuxIdentity ? { tmuxServerIdentity: ownedTmuxIdentity } : {}
        })
      ]);
      const captured = observation.ok ? observation.captured : "";
      const captureSha = captured ? commandFingerprint(captured) : "none";
      logWorkerSpawnDiagnostic(
        `worker start post-enter observation session=${sessionName2} pane=${paneId} worker=${config.workerName} cmdSha=${fingerprint} paneStatus=${JSON.stringify(
          status ? `${status.dead ? "1" : "0"} ${redactBoundedDiagnostic(status.command, 96)}` : "unavailable"
        )} captureOk=${observation.ok} captureBytes=${Buffer.byteLength(captured, "utf8")} captureSha=${captureSha}`
      );
    }
    if (config.launchAttempt) {
      await requireAcknowledgement();
    } else {
      const submitted = await verifyWorkerStartCommandSubmitted(
        paneId,
        startCmd,
        {
          tmuxServerIdentity: ownedTmuxIdentity
        }
      );
      if (!submitted) {
        throw new Error(
          `worker_start_submit_unverified:${config.workerName}:${paneId}:${fingerprint}`
        );
      }
    }
  } catch (error) {
    if (config.launchAttempt) {
      await revokeWorkerLaunchAttempt(
        config.launchAttempt,
        "launch_failed"
      ).catch(() => void 0);
    }
    if (config.launchAttempt && (!materializedTransport || (0, import_fs11.existsSync)(materializedTransport.bootstrapDescriptorPath))) {
      const cleaned = await cleanupWorkerLaunchTransport(
        config.launchAttempt,
        "launch_failed"
      ).catch(() => false);
      if (!cleaned) {
        logWorkerSpawnDiagnostic(
          `worker start transport cleanup unverified session=${sessionName2} pane=${paneId} worker=${config.workerName} cmdSha=${fingerprint}`
        );
      }
    }
    logWorkerSpawnDiagnostic(
      `worker start failed session=${sessionName2} pane=${paneId} worker=${config.workerName} cmdSha=${fingerprint} error=${JSON.stringify(redactBoundedDiagnostic(error))}`
    );
    throw error;
  }
}
async function spawnOwnedWorkerInPane(sessionName2, ownership, config) {
  if (ownership.provider === "tmux" && !isValidTmuxServerIdentity(ownership.tmuxServerIdentity)) {
    throw new Error("worker_launch_tmux_server_identity_missing");
  }
  if (!config.provider) throw new Error("worker_launch_provider_missing");
  if (!config.launchBootstrapPath)
    throw new Error("worker_launch_bootstrap_path_missing");
  if (!config.launchStateCwd)
    throw new Error("worker_launch_state_cwd_missing");
  const instanceId = config.instanceId;
  if (!isValidTeamInstanceId(instanceId))
    throw new Error("worker_launch_instance_id_invalid");
  const attempt = await prepareWorkerLaunchAttempt({
    cwd: config.launchStateCwd,
    teamName: config.teamName,
    workerName: config.workerName,
    instanceId,
    paneId: ownership.paneId,
    provider: config.provider,
    runtimeCliPath: config.launchBootstrapPath,
    ...config.launchContext ? { context: config.launchContext } : {}
  });
  try {
    const launchEnv = {
      ...config.envVars,
      OMC_WORKER_LAUNCH_ATTEMPT_ID: attempt.attempt_id
    };
    if (launchEnv.OMC_RECOVERY_GATE_SPEC) {
      const gate = JSON.parse(launchEnv.OMC_RECOVERY_GATE_SPEC);
      launchEnv.OMC_RECOVERY_GATE_SPEC = JSON.stringify({
        ...gate,
        launchAttempt: attempt
      });
    }
    await spawnWorkerInPane(sessionName2, ownership.paneId, {
      ...config,
      envVars: launchEnv,
      launchAttempt: attempt,
      ...ownership.provider === "tmux" && ownership.tmuxServerIdentity ? { tmuxServerIdentity: ownership.tmuxServerIdentity } : {}
    });
    return { ownership, attempt, provider: config.provider };
  } catch (error) {
    const cleaned = await retireAndCleanupCurrentWorkerLaunchAttempt(
      attempt,
      "launch_failed",
      async () => {
        try {
          await killOwnedWorkerPane(ownership);
          return await getOwnedWorkerLiveness(ownership) === "dead";
        } catch {
          return false;
        }
      }
    ).catch(() => false);
    if (!cleaned)
      throw new Error(
        `worker_launch_cleanup_unverified:${config.workerName}:${ownership.paneId}`
      );
    throw error;
  }
}
function normalizeTmuxCapture(value) {
  return value.replace(/\r/g, "").replace(/\s+/g, " ").trim();
}
function normalizeTmuxCaptureForDelivery(value) {
  return value.replace(/\r/g, "").replace(/\s+/g, "");
}
function safePaneDiagnosticToken(paneId) {
  return paneId.replace(/[^A-Za-z0-9%._:-]/g, "?").slice(0, 128);
}
async function capturePaneObservation(paneId, opts = {}) {
  try {
    if (isCmuxSurfaceTarget(paneId)) {
      return { ok: true, captured: await cmuxCaptureSurface(paneId) };
    }
    if (isHerdrPaneId(paneId)) {
      try {
        return { ok: true, captured: await captureHerdrWorkerPane(paneId) };
      } catch (error) {
        return {
          ok: false,
          error: `herdr_capture_failed:${error instanceof Error ? error.message : String(error)}`
        };
      }
    }
    if (opts.tmuxServerIdentity) {
      if (!isValidTmuxServerIdentity(opts.tmuxServerIdentity) || await observeTmuxServerIdentity(
        opts.tmuxServerIdentity,
        opts.serverIdentityDependencies
      ) !== "matching") {
        return { ok: false, error: "tmux_server_identity_unverified" };
      }
    }
    const args = opts.joinWrappedLines ? ["capture-pane", "-J", "-t", paneId, "-p", "-S", "-80"] : ["capture-pane", "-t", paneId, "-p", "-S", "-80"];
    const result = opts.tmuxServerIdentity ? await tmuxExecAsync(
      tmuxArgsForIdentity(opts.tmuxServerIdentity, args),
      { timeout: 2e3, stripTmux: true }
    ) : await tmuxExecAsync(args);
    if (opts.tmuxServerIdentity && await observeTmuxServerIdentity(
      opts.tmuxServerIdentity,
      opts.serverIdentityDependencies
    ) !== "matching") {
      return { ok: false, error: "tmux_server_identity_changed" };
    }
    return { ok: true, captured: result.stdout };
  } catch (error) {
    const operation = (opts.operation ?? "capture").replace(/[^A-Za-z0-9._-]/g, "?").slice(0, 64);
    const message = redactBoundedDiagnostic(error);
    logWorkerSpawnDiagnostic(
      `pane capture failed operation=${operation} pane=${safePaneDiagnosticToken(paneId)} error=${JSON.stringify(message)}`
    );
    return { ok: false, error: message };
  }
}
async function capturePaneAsync(paneId, opts = {}) {
  const observation = await capturePaneObservation(paneId, opts);
  return observation.ok ? observation.captured : "";
}
async function captureTeamPane(paneId, options = {}) {
  return capturePaneAsync(paneId, options);
}
async function captureOwnedTeamPane(ownership, options = {}) {
  if (ownership.provider === "cmux")
    return captureTeamPane(ownership.paneId, options);
  if (!isValidTmuxServerIdentity(ownership.tmuxServerIdentity) || !TMUX_MAILBOX_PANE_ID.test(ownership.paneId))
    return "";
  return captureTeamPane(ownership.paneId, {
    ...options,
    tmuxServerIdentity: ownership.tmuxServerIdentity
  });
}
async function sendTeamPaneKey(paneId, key, tmuxServerIdentity) {
  if (isHerdrPaneId(paneId)) {
    await herdrSendKey(
      paneId,
      key === "C-c" ? "ctrl+c" : key
    );
    return;
  }
  if (isCmuxSurfaceTarget(paneId)) {
    await cmuxSendSurfaceKey(paneId, key);
    return;
  }
  if (!tmuxServerIdentity) throw new Error("tmux_server_identity_missing");
  if (!isValidTmuxServerIdentity(tmuxServerIdentity) || await observeTmuxServerIdentity(tmuxServerIdentity) !== "matching") {
    throw new Error("tmux_server_identity_unverified");
  }
  const result = await runGuardedNativeTmuxCommand(
    tmuxServerIdentity,
    tmuxCommandString(["send-keys", "-t", paneId, key])
  );
  if (result.outcome !== "executed")
    throw new Error("tmux_server_guard_failed");
}
async function guardedSendLiteralAndEnter(paneId, text, tmuxServerIdentity) {
  if (await paneInputBlockReason(paneId, tmuxServerIdentity)) return false;
  const literal = await runGuardedNativeTmuxCommand(
    tmuxServerIdentity,
    tmuxCommandString(["send-keys", "-t", paneId, "-l", "--", text])
  );
  if (literal.outcome !== "executed") return false;
  if (await paneInputBlockReason(paneId, tmuxServerIdentity)) return false;
  const enter = await runGuardedNativeTmuxCommand(
    tmuxServerIdentity,
    tmuxCommandString(["send-keys", "-t", paneId, "Enter"])
  );
  return enter.outcome === "executed";
}
async function paneInputBlockReason(paneId, tmuxServerIdentity, serverIdentityDependencies) {
  const observation = await capturePaneObservation(paneId, {
    operation: "guarded-notification",
    tmuxServerIdentity,
    ...serverIdentityDependencies ? { serverIdentityDependencies } : {}
  });
  if (!observation.ok || !observation.captured.trim())
    return "mailbox_membership_unresolvable";
  const trustPrompt = detectPaneTrustPromptKind(observation.captured);
  if (trustPrompt === "codex_directory") return "codex_workspace_untrusted";
  if (trustPrompt === "cursor_workspace_trust")
    return "cursor_workspace_untrusted";
  if (trustPrompt) return "trust_prompt_pending";
  return void 0;
}
async function killTeamPane(paneId) {
  if (isCmuxSurfaceTarget(paneId)) {
    await cmuxCloseSurface(paneId);
    return;
  }
  throw new Error("tmux_server_identity_required");
}
async function killOwnedWorkerPane(ownership) {
  if (ownership.paneId === ownership.leaderPaneId) {
    throw new Error("owned_pane_leader_excluded");
  }
  if (ownership.reservedPaneIds.includes(ownership.paneId)) {
    throw new Error("owned_pane_reserved_excluded");
  }
  if (ownership.provider === "tmux") {
    if (!isValidTmuxServerIdentity(ownership.tmuxServerIdentity)) {
      throw new Error("owned_pane_tmux_server_identity_missing");
    }
    const serverState = await observeTmuxServerIdentity(
      ownership.tmuxServerIdentity
    );
    if (serverState === "dead") return;
    if (serverState !== "matching") {
      throw new Error("owned_pane_tmux_server_identity_unknown");
    }
  }
  const membership = await verifyTeamTargetOwnership({
    provider: ownership.provider,
    providerTarget: ownership.providerTarget,
    recipient: "worker",
    recipientRole: "worker",
    paneId: ownership.paneId,
    ...ownership.provider === "tmux" ? { tmuxServerIdentity: ownership.tmuxServerIdentity } : {}
  });
  if (membership.kind !== "owned")
    throw new Error("owned_pane_membership_unverified");
  if (ownership.provider === "herdr") {
    await herdrClosePane(ownership.paneId);
    return;
  }
  if (ownership.provider === "cmux") {
    await cmuxCloseSurface(ownership.paneId);
    return;
  }
  const result = await runGuardedNativeTmuxCommand(
    ownership.tmuxServerIdentity,
    tmuxCommandString(["kill-pane", "-t", ownership.paneId])
  );
  if (result.outcome !== "executed") {
    throw new Error("owned_pane_tmux_server_guard_failed");
  }
}
function detectPaneTrustPromptKind(captured, provider) {
  const lines = captured.split("\n").map((l) => l.replace(/\r/g, "").trim()).filter((l) => l.length > 0);
  const tail = lines.slice(-12);
  const lastCodexPromptIndex = lines.findLastIndex(
    (line) => paneLineLooksLikeIdlePrompt(line, "codex")
  );
  const activeCodexPrompt = lastCodexPromptIndex >= 0 ? lines[lastCodexPromptIndex].replace(
    /^\s*(?:[│┃║▌▐▏▕╎┆┊]\s*)?[›>❯]\s*/,
    ""
  ) : "";
  const lastCodexTrustQuestionIndex = lines.findLastIndex(
    (line, index) => /Trust this folder\?/i.test(lines.slice(index, index + 2).join(" "))
  );
  const previousTrustChoiceWasRendered = lastCodexTrustQuestionIndex >= 0 && lines.slice(lastCodexTrustQuestionIndex + 1, lastCodexPromptIndex).some((line) => {
    const prompt = line.replace(/^\s*(?:[│┃║▌▐▏▕╎┆┊]\s*)?[›>❯]\s*/, "");
    return /^(?:1(?:\.|$)|2(?:\.|$))/i.test(prompt);
  });
  const lastCodexPromptIsTrustChoice = lastCodexPromptIndex >= 0 && (/^(?:1(?:\.|$)|2(?:\.|$))/i.test(activeCodexPrompt) || activeCodexPrompt === "" && !previousTrustChoiceWasRendered);
  const codexTrustQuestionIsActive = lastCodexTrustQuestionIndex >= 0 && (lastCodexPromptIndex < lastCodexTrustQuestionIndex || lastCodexPromptIsTrustChoice);
  if ((provider === void 0 || provider === "codex") && codexTrustQuestionIsActive) {
    return "codex_directory";
  }
  const hasCursorTrustBanner = tail.some(
    (l) => /Workspace Trust Required/i.test(l)
  );
  const hasCursorTrustHint = tail.some(
    (l) => /Pass\s+--trust,\s*--yolo,\s*or\s+-f/i.test(l)
  );
  if ((provider === void 0 || provider === "cursor") && hasCursorTrustBanner && (hasCursorTrustHint || tail.some(
    (l) => /Do you trust the contents of this directory\?/i.test(l)
  ))) {
    return "cursor_workspace_trust";
  }
  const claudeQuestionLines = lines.slice(-20);
  const hasClaudeDirectoryQuestion = claudeQuestionLines.some(
    (_, index) => /(?:Do you trust the files in this folder|Quick safety check:\s*Is this a project you created or one you trust)\?/i.test(
      claudeQuestionLines.slice(index, index + 3).join(" ")
    )
  );
  const hasClaudeDirectoryNoChoice = tail.some(
    (l) => /\bNo,\s*exit\b/i.test(l)
  );
  const hasClaudeDirectoryYesChoice = tail.some(
    (l) => /\bYes,\s*(?:proceed|I trust this folder)\b/i.test(l)
  );
  if ((provider === void 0 || provider === "claude") && hasClaudeDirectoryQuestion && hasClaudeDirectoryNoChoice && hasClaudeDirectoryYesChoice) {
    return "claude_directory";
  }
  const hasDirectoryQuestion = tail.some(
    (l) => /Do you trust the contents of this directory\?/i.test(l)
  );
  const hasDirectoryChoices = tail.some(
    (l) => /Yes,\s*continue|No,\s*quit|Press enter to continue/i.test(l)
  );
  if (hasDirectoryQuestion && hasDirectoryChoices) return "directory";
  const hasHookReview = tail.some((l) => /Hooks need review/i.test(l));
  const hasHookTrustChoice = tail.some(
    (l) => /Continue without trusting/i.test(l)
  );
  const hasHookConfirm = tail.some(
    (l) => /Press enter to confirm or esc to go back/i.test(l)
  );
  if (hasHookReview && hasHookTrustChoice && hasHookConfirm)
    return "codex_hooks";
  return null;
}
function paneHasTrustPrompt(captured, provider) {
  return detectPaneTrustPromptKind(captured, provider) !== null;
}
function paneHasClaudeStartupBanner(captured, provider) {
  const lines = captured.split("\n").map((line) => line.replace(/\r/g, "").trim()).filter((line) => line.length > 0).slice(-20);
  const lastPromptIndex = lines.findLastIndex(
    (line) => paneLineLooksLikeIdlePrompt(line, provider)
  );
  if (lastPromptIndex >= 0) return false;
  const lastStartupBannerIndex = lines.findLastIndex(
    (line) => /bypass\s+permissions\s+on/i.test(line) || /shift\+tab\s+to\s+cycle/i.test(line) || /^⏵⏵\s+/.test(line)
  );
  return lastStartupBannerIndex >= 0;
}
function paneIsBootstrapping(captured, provider) {
  if (paneHasClaudeStartupBanner(captured, provider)) return true;
  const lines = captured.split("\n").map((line) => line.replace(/\r/g, "").trim()).filter((line) => line.length > 0);
  return lines.some(
    (line) => /\b(loading|initializing|starting up)\b/i.test(line) || /\bmodel:\s*loading\b/i.test(line) || /\bconnecting\s+to\b/i.test(line)
  );
}
function paneHasActiveTask(captured, provider) {
  const lines = captured.split("\n").map((l) => l.replace(/\r/g, "").trim()).filter((l) => l.length > 0);
  const tail = lines.slice(-40);
  if (provider === "cursor" && tail.some((l) => /ctrl\+c\s+to\s+stop/i.test(l)))
    return true;
  if (tail.some((l) => /\b\d+\s+background terminal running\b/i.test(l)))
    return true;
  if (tail.some((l) => /esc to interrupt/i.test(l))) return true;
  if (tail.some((l) => /\bbackground terminal running\b/i.test(l))) return true;
  if (tail.some(
    (l) => /^[·✻✢✳✶✽✺✹✸✷*]\s+[A-Za-z][A-Za-z0-9''-]*(?:\s+[A-Za-z][A-Za-z0-9''-]*){0,3}(?:…|\.{3})(?:\s*\(.*\))?$/u.test(
      l
    )
  ))
    return true;
  return false;
}
function paneLooksReady(captured, provider) {
  const content = captured.trimEnd();
  if (content === "") return false;
  const lines = content.split("\n").map((line) => line.replace(/\r/g, "").trimEnd()).filter((line) => line.trim() !== "");
  if (lines.length === 0) return false;
  const trustPrompt = detectPaneTrustPromptKind(content, provider);
  if (trustPrompt === "cursor_workspace_trust" || trustPrompt === "codex_directory")
    return false;
  if (paneHasTrustPrompt(content, provider)) return true;
  if (paneIsBootstrapping(content, provider)) return false;
  const lastLine = lines[lines.length - 1];
  if (paneLineLooksLikeIdlePrompt(lastLine, provider)) return true;
  return lines.some((line) => paneLineLooksLikeIdlePrompt(line, provider));
}
async function waitForPaneReady(paneId, opts = {}) {
  if (!isCmuxSurfaceTarget(paneId) && !opts.tmuxServerIdentity) return false;
  const timeoutMs = Number.isFinite(opts.timeoutMs) && (opts.timeoutMs ?? 0) > 0 ? Number(opts.timeoutMs) : 3e4;
  const pollIntervalMs = Number.isFinite(opts.pollIntervalMs) && (opts.pollIntervalMs ?? 0) > 0 ? Number(opts.pollIntervalMs) : 250;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const captured = await capturePaneAsync(paneId, {
      tmuxServerIdentity: opts.tmuxServerIdentity
    });
    if (paneLooksReady(captured, opts.provider) && !paneHasActiveTask(captured, opts.provider)) {
      return true;
    }
    await sleep3(pollIntervalMs);
  }
  console.warn(
    `[tmux-session] waitForPaneReady: pane ${paneId} timed out after ${timeoutMs}ms (set OMC_TEAM_READY_TIMEOUT_MS to tune)`
  );
  return false;
}
function paneTailContainsLiteralLine(captured, text) {
  return normalizeTmuxCapture(captured).includes(normalizeTmuxCapture(text));
}
async function paneCopyModeObservation(paneId, tmuxServerIdentity) {
  if (isHerdrPaneId(paneId)) return false;
  if (isCmuxSurfaceTarget(paneId)) return false;
  if (!tmuxServerIdentity) return null;
  if (!isValidTmuxServerIdentity(tmuxServerIdentity) || await observeTmuxServerIdentity(tmuxServerIdentity) !== "matching")
    return null;
  try {
    const result = await tmuxCmdAsync(
      tmuxArgsForIdentity(tmuxServerIdentity, [
        "display-message",
        "-t",
        paneId,
        "-p",
        "#{pane_in_mode}"
      ]),
      { timeout: 2e3, stripTmux: true }
    );
    if (result.stderr.trim()) return null;
    if (await observeTmuxServerIdentity(tmuxServerIdentity) !== "matching")
      return null;
    const state = result.stdout.trim();
    return state === "1" ? true : state === "0" ? false : null;
  } catch (error) {
    logWorkerSpawnDiagnostic(
      `pane query failed operation=copy-mode pane=${safePaneDiagnosticToken(paneId)} error=${JSON.stringify(redactBoundedDiagnostic(error))}`
    );
    return null;
  }
}
async function paneInCopyMode(paneId) {
  return await paneCopyModeObservation(paneId) ?? false;
}
async function sendLiteralPaneText(paneId, text, tmuxServerIdentity) {
  if (isHerdrPaneId(paneId)) {
    await herdrSendPrompt(paneId, text);
    return;
  }
  if (isCmuxSurfaceTarget(paneId)) {
    await cmuxSendSurface(paneId, text);
    return;
  }
  if (!tmuxServerIdentity) throw new Error("tmux_server_identity_missing");
  if (!isValidTmuxServerIdentity(tmuxServerIdentity) || await observeTmuxServerIdentity(tmuxServerIdentity) !== "matching") {
    throw new Error("tmux_server_identity_unverified");
  }
  const result = await runGuardedNativeTmuxCommand(
    tmuxServerIdentity,
    tmuxCommandString(["send-keys", "-t", paneId, "-l", "--", text])
  );
  if (result.outcome !== "executed")
    throw new Error("tmux_server_guard_failed");
}
async function startupContextIsActive(context, attemptAlreadyFenced = false) {
  if (context.ownership.provider === "tmux" && !isValidTmuxServerIdentity(context.ownership.tmuxServerIdentity))
    return false;
  return context.ownership.paneId === context.attempt.pane_id && context.provider === context.attempt.provider && await isWorkerLaunchAttemptAccepted(context.attempt) && (attemptAlreadyFenced || await isWorkerLaunchAttemptCurrent(context.attempt));
}
async function waitForStartupPaneReady(context, opts = {}) {
  if (context.ownership.paneId !== context.attempt.pane_id || context.provider !== context.attempt.provider) {
    return { ok: false, reason: "ownership_mismatch" };
  }
  const timeoutMs = Number.isFinite(opts.timeoutMs) && (opts.timeoutMs ?? 0) > 0 ? Number(opts.timeoutMs) : 3e4;
  const pollIntervalMs = Number.isFinite(opts.pollIntervalMs) && (opts.pollIntervalMs ?? 0) > 0 ? Number(opts.pollIntervalMs) : 250;
  const deadline = Date.now() + timeoutMs;
  const handledSelectors = /* @__PURE__ */ new Set();
  while (Date.now() < deadline) {
    if (!await startupContextIsActive(context, opts.attemptAlreadyFenced))
      return { ok: false, reason: "attempt_inactive" };
    const copyMode = await paneCopyModeObservation(
      context.ownership.paneId,
      context.ownership.tmuxServerIdentity
    );
    if (copyMode === null) return { ok: false, reason: "copy_mode_unknown" };
    if (copyMode) return { ok: false, reason: "copy_mode" };
    const observation = await capturePaneObservation(context.ownership.paneId, {
      operation: "startup-readiness",
      ...context.ownership.provider === "tmux" ? { tmuxServerIdentity: context.ownership.tmuxServerIdentity } : {}
    });
    if (!observation.ok) return { ok: false, reason: "capture_failed" };
    const captured = observation.captured;
    const selector = detectPaneTrustPromptKind(captured, context.provider);
    if (selector) {
      if (selector === "codex_directory")
        return { ok: false, reason: "codex_workspace_untrusted" };
      if (selector === "cursor_workspace_trust") {
        return { ok: false, reason: "cursor_workspace_untrusted" };
      }
      const providerSupportsSelector = selector === "codex_hooks" ? context.provider === "codex" : selector === "claude_directory" ? context.provider === "claude" : context.provider === "codex" || context.provider === "claude";
      if (!providerSupportsSelector)
        return { ok: false, reason: "selector_unsupported" };
      if (handledSelectors.has(selector))
        return { ok: false, reason: "selector_persistent" };
      if (selector === "claude_directory") {
        await sendTeamPaneKey(
          context.ownership.paneId,
          "Down",
          context.ownership.tmuxServerIdentity
        );
      } else {
        await sendLiteralPaneText(
          context.ownership.paneId,
          selector === "directory" ? "1" : "3",
          context.ownership.tmuxServerIdentity
        );
      }
      await sendTeamPaneKey(
        context.ownership.paneId,
        "Enter",
        context.ownership.tmuxServerIdentity
      );
      handledSelectors.add(selector);
      await sleep3(pollIntervalMs);
      continue;
    }
    if (paneHasActiveTask(captured, context.provider))
      return { ok: false, reason: "pane_busy" };
    if (paneLooksReady(captured, context.provider)) return { ok: true };
    await sleep3(pollIntervalMs);
  }
  return { ok: false, reason: "readiness_timeout" };
}
async function startupPaneSubmitBlockReason(context, attemptAlreadyFenced) {
  if (!await startupContextIsActive(context, attemptAlreadyFenced))
    return "attempt_inactive";
  const copyMode = await paneCopyModeObservation(
    context.ownership.paneId,
    context.ownership.tmuxServerIdentity
  );
  if (copyMode === null) return "copy_mode_unknown";
  if (copyMode) return "copy_mode";
  const observation = await capturePaneObservation(context.ownership.paneId, {
    operation: "startup-submit",
    ...context.ownership.provider === "tmux" ? { tmuxServerIdentity: context.ownership.tmuxServerIdentity } : {}
  });
  if (!observation.ok || !observation.captured.trim()) return "capture_failed";
  const selector = detectPaneTrustPromptKind(
    observation.captured,
    context.provider
  );
  if (selector === "codex_directory") return "codex_workspace_untrusted";
  if (selector === "cursor_workspace_trust")
    return "cursor_workspace_untrusted";
  if (selector) return "selector_persistent";
  return void 0;
}
async function deliverStartupInbox(context, message, options = {}) {
  if (message.length > 200) return { ok: false, reason: "message_too_long" };
  const ready = await waitForStartupPaneReady(context, {
    attemptAlreadyFenced: options.attemptAlreadyFenced
  });
  if (!ready.ok) return { ok: false, reason: ready.reason };
  try {
    const preInputBlockReason = await startupPaneSubmitBlockReason(
      context,
      options.attemptAlreadyFenced ?? false
    );
    if (preInputBlockReason) return { ok: false, reason: preInputBlockReason };
    await sendLiteralPaneText(
      context.ownership.paneId,
      message,
      context.ownership.tmuxServerIdentity
    );
    await sleep3(100);
    for (let submitIndex = 0; submitIndex < 2; submitIndex++) {
      const submitBlockReason = await startupPaneSubmitBlockReason(
        context,
        options.attemptAlreadyFenced ?? false
      );
      if (submitBlockReason) return { ok: false, reason: submitBlockReason };
      await sendTeamPaneKey(
        context.ownership.paneId,
        "Enter",
        context.ownership.tmuxServerIdentity
      );
      if (submitIndex === 0) await sleep3(120);
    }
    return { ok: true, kind: "attempted_unconfirmed" };
  } catch (error) {
    logWorkerSpawnDiagnostic(
      `startup inbox attempt failed pane=${safePaneDiagnosticToken(context.ownership.paneId)} attempt=${context.attempt.attempt_id.slice(0, 12)} error=${JSON.stringify(redactBoundedDiagnostic(error))}`
    );
    return { ok: false, reason: "startup_send_failed" };
  }
}
async function probeStartupPaneActivity(context, options = {}) {
  if (!await startupContextIsActive(context, options.attemptAlreadyFenced))
    return "unknown";
  const membership = await verifyTeamTargetOwnership({
    provider: context.ownership.provider,
    providerTarget: context.ownership.providerTarget,
    recipient: "worker",
    recipientRole: "worker",
    paneId: context.ownership.paneId,
    ...context.ownership.provider === "tmux" ? { tmuxServerIdentity: context.ownership.tmuxServerIdentity } : {}
  });
  if (membership.kind !== "owned") return "unknown";
  const liveness = await getOwnedWorkerLiveness(context.ownership);
  if (liveness !== "alive") return liveness;
  const copyMode = await paneCopyModeObservation(
    context.ownership.paneId,
    context.ownership.tmuxServerIdentity
  );
  if (copyMode !== false) return "unknown";
  const observation = await capturePaneObservation(context.ownership.paneId, {
    operation: "startup-activity-probe",
    ...context.ownership.provider === "tmux" ? { tmuxServerIdentity: context.ownership.tmuxServerIdentity } : {}
  });
  if (!observation.ok) return "unknown";
  if (detectPaneTrustPromptKind(observation.captured, context.provider))
    return "idle";
  return paneHasActiveTask(observation.captured, context.provider) ? "busy" : "idle";
}
async function retryStartupInboxSubmit(context, message, options = {}) {
  if (!await startupContextIsActive(context, options.attemptAlreadyFenced))
    return "unavailable";
  const copyMode = await paneCopyModeObservation(
    context.ownership.paneId,
    context.ownership.tmuxServerIdentity
  );
  if (copyMode !== false) return "unavailable";
  const observation = await capturePaneObservation(context.ownership.paneId, {
    operation: "startup-submit-retry",
    ...context.ownership.provider === "tmux" ? { tmuxServerIdentity: context.ownership.tmuxServerIdentity } : {}
  });
  if (!observation.ok || detectPaneTrustPromptKind(observation.captured, context.provider))
    return "unavailable";
  if (paneHasActiveTask(observation.captured, context.provider))
    return "pane_busy";
  if (!paneTailContainsLiteralLine(observation.captured, message))
    return "unavailable";
  try {
    await sendTeamPaneKey(
      context.ownership.paneId,
      "Enter",
      context.ownership.tmuxServerIdentity
    );
    return "resubmitted";
  } catch {
    return "unavailable";
  }
}
function shouldAttemptAdaptiveRetry(args) {
  if (process.env.OMC_TEAM_AUTO_INTERRUPT_RETRY === "0") return false;
  if (args.retriesAttempted >= 1) return false;
  if (args.paneInCopyMode) return false;
  if (!args.paneBusy) return false;
  if (typeof args.latestCapture !== "string") return false;
  if (!paneTailContainsLiteralLine(args.latestCapture, args.message))
    return false;
  if (paneHasActiveTask(args.latestCapture)) return false;
  if (!paneLooksReady(args.latestCapture)) return false;
  return true;
}
async function sendToWorker(_sessionName, paneId, message, tmuxServerIdentity) {
  if (message.length > 200) {
    console.warn(
      `[tmux-session] sendToWorker: message rejected (${message.length} chars exceeds 200 char limit)`
    );
    return false;
  }
  if (!isCmuxSurfaceTarget(paneId) && !isHerdrPaneId(paneId) && !tmuxServerIdentity)
    return false;
  if (tmuxServerIdentity) {
    return guardedSendLiteralAndEnter(paneId, message, tmuxServerIdentity);
  }
  try {
    const sendKey = async (key) => {
      await sendTeamPaneKey(paneId, key);
    };
    if (await paneInCopyMode(paneId)) {
      return false;
    }
    const initialObservation = await capturePaneObservation(paneId, {
      operation: "worker-direct-send"
    });
    if (!initialObservation.ok || !initialObservation.captured.trim())
      return false;
    const initialCapture = initialObservation.captured;
    if (paneHasClaudeStartupBanner(initialCapture)) {
      return false;
    }
    const paneBusy = paneHasActiveTask(initialCapture);
    const trustPromptKind = detectPaneTrustPromptKind(initialCapture);
    if (trustPromptKind === "directory") {
      await sendKey("C-m");
      await sleep3(120);
      await sendKey("C-m");
      await sleep3(200);
    } else if (trustPromptKind === "codex_hooks") {
      await sendKey("3");
      await sleep3(120);
      await sendKey("C-m");
      await sleep3(200);
    } else if (trustPromptKind) {
      return false;
    }
    if (isHerdrPaneId(paneId)) {
      await herdrSendPrompt(paneId, message);
      return true;
    } else if (isCmuxSurfaceTarget(paneId)) {
      await cmuxSendSurface(paneId, message);
    } else {
      return false;
    }
    await sleep3(150);
    const preSubmitObservation = await capturePaneObservation(paneId, {
      operation: "worker-direct-submit"
    });
    if (!preSubmitObservation.ok || !preSubmitObservation.captured.trim() || paneHasTrustPrompt(preSubmitObservation.captured))
      return false;
    const sendSubmitKey = async (key) => {
      const observation = await capturePaneObservation(paneId, {
        operation: "worker-direct-submit-key"
      });
      if (!observation.ok || !observation.captured.trim() || paneHasTrustPrompt(observation.captured))
        return false;
      await sendKey(key);
      return true;
    };
    const submitRounds = 6;
    for (let round = 0; round < submitRounds; round++) {
      await sleep3(100);
      if (round === 0 && paneBusy) {
        if (!await sendSubmitKey("Tab")) return false;
        await sleep3(80);
        if (!await sendSubmitKey("C-m")) return false;
      } else {
        if (!await sendSubmitKey("C-m")) return false;
        await sleep3(200);
        if (!await sendSubmitKey("C-m")) return false;
      }
      await sleep3(140);
      const checkObservation = await capturePaneObservation(paneId, {
        operation: "worker-direct-submit-check"
      });
      if (!checkObservation.ok || !checkObservation.captured.trim() || paneHasTrustPrompt(checkObservation.captured))
        return false;
      if (!paneTailContainsLiteralLine(checkObservation.captured, message))
        return true;
      await sleep3(140);
    }
    if (await paneInCopyMode(paneId)) {
      return false;
    }
    const finalObservation = await capturePaneObservation(paneId, {
      operation: "worker-direct-final-submit"
    });
    if (!finalObservation.ok || !finalObservation.captured.trim() || paneHasTrustPrompt(finalObservation.captured))
      return false;
    const finalCapture = finalObservation.captured;
    const paneModeBeforeAdaptiveRetry = await paneInCopyMode(paneId);
    if (shouldAttemptAdaptiveRetry({
      paneBusy,
      latestCapture: finalCapture,
      message,
      paneInCopyMode: paneModeBeforeAdaptiveRetry,
      retriesAttempted: 0
    })) {
      if (await paneInCopyMode(paneId)) {
        return false;
      }
      if (!await sendSubmitKey("C-u")) return false;
      await sleep3(80);
      if (await paneInCopyMode(paneId)) {
        return false;
      }
      if (isCmuxSurfaceTarget(paneId)) {
        const retryInputObservation = await capturePaneObservation(paneId, {
          operation: "worker-direct-retry-input"
        });
        if (!retryInputObservation.ok || !retryInputObservation.captured.trim() || paneHasTrustPrompt(retryInputObservation.captured))
          return false;
        await cmuxSendSurface(paneId, message);
      } else if (isHerdrPaneId(paneId)) {
        await herdrSendPrompt(paneId, message);
      } else {
        return false;
      }
      await sleep3(120);
      for (let round = 0; round < 4; round++) {
        if (!await sendSubmitKey("C-m")) return false;
        await sleep3(180);
        if (!await sendSubmitKey("C-m")) return false;
        await sleep3(140);
        const retryObservation = await capturePaneObservation(paneId, {
          operation: "worker-direct-retry-check"
        });
        if (!retryObservation.ok || !retryObservation.captured.trim() || paneHasTrustPrompt(retryObservation.captured))
          return false;
        if (!paneTailContainsLiteralLine(retryObservation.captured, message))
          return true;
      }
    }
    if (await paneInCopyMode(paneId)) {
      return false;
    }
    if (!await sendSubmitKey("C-m")) return false;
    await sleep3(120);
    if (!await sendSubmitKey("C-m")) return false;
    await sleep3(140);
    const finalCheckObservation = await capturePaneObservation(paneId, {
      operation: "worker-direct-final-check"
    });
    if (!finalCheckObservation.ok || !finalCheckObservation.captured.trim() || paneHasTrustPrompt(finalCheckObservation.captured)) {
      return false;
    }
    return !paneTailContainsLiteralLine(
      finalCheckObservation.captured,
      message
    );
  } catch {
    return false;
  }
}
async function injectToLeaderPane(sessionName2, leaderPaneId, message, tmuxServerIdentity) {
  const prefixed = `[OMC_TMUX_INJECT] ${message}`.slice(0, 200);
  if (!isCmuxSurfaceTarget(leaderPaneId) && !isHerdrPaneId(leaderPaneId) && !tmuxServerIdentity) return false;
  if (tmuxServerIdentity) {
    return guardedSendLiteralAndEnter(
      leaderPaneId,
      prefixed,
      tmuxServerIdentity
    );
  }
  try {
    if (await paneInCopyMode(leaderPaneId)) {
      return false;
    }
    const captured = await capturePaneAsync(leaderPaneId);
    if (paneHasActiveTask(captured)) {
      if (isCmuxSurfaceTarget(leaderPaneId)) {
        await cmuxSendSurfaceKey(leaderPaneId, "C-c");
      } else if (isHerdrPaneId(leaderPaneId)) {
        await herdrSendKey(leaderPaneId, "ctrl+c");
      } else {
        return false;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
  } catch {
  }
  return sendToWorker(sessionName2, leaderPaneId, prefixed);
}
function isTmuxPaneNotFoundError(error) {
  const err = error;
  const text = [err?.stderr, err?.stdout, err?.message].filter((part) => typeof part === "string").join("\n").toLowerCase();
  return /can't find pane|can't find window|can't find session|no such pane|pane not found|unknown pane/.test(
    text
  );
}
async function getWorkerLiveness(paneId) {
  if (isHerdrPaneId(paneId)) {
    try {
      return await isHerdrWorkerAlive(paneId) ? "alive" : "dead";
    } catch {
      return "unknown";
    }
  }
  if (isCmuxSurfaceTarget(paneId)) {
    try {
      await cmuxCaptureSurface(paneId);
      return "alive";
    } catch {
      return "unknown";
    }
  }
  if (!TMUX_MAILBOX_PANE_ID.test(paneId)) return "unknown";
  try {
    const result = await tmuxCmdAsync([
      "display-message",
      "-t",
      paneId,
      "-p",
      "#{pane_dead}"
    ]);
    const state = result.stdout.replace(/\r?\n$/, "");
    if (state === "0") return "alive";
    if (state === "1") return "dead";
    return getTmuxPaneLivenessFromInventory(paneId);
  } catch (error) {
    return isTmuxPaneNotFoundError(error) ? "dead" : "unknown";
  }
}
async function observeTmuxServerIdentityWithBoundedRecheck(identity, dependencies = {}) {
  if (!isValidTmuxServerIdentity(identity)) return "unknown";
  const deps = {
    ...defaultTmuxServerIdentityDependencies,
    ...dependencies
  };
  const initialState = await observeTmuxServerIdentity(identity, dependencies);
  if (initialState !== "unknown") return initialState;
  for (let attempt = 1; attempt < TMUX_LIVENESS_SERVER_RECHECK_ATTEMPTS; attempt += 1) {
    await sleep3(TMUX_LIVENESS_SERVER_RECHECK_DELAY_MS);
    let processState;
    try {
      processState = deps.processObservation({
        server_pid: identity.server_pid,
        process_started_at: identity.process_started_at
      });
    } catch {
      return "unknown";
    }
    if (processState === "dead") return "dead";
  }
  return "unknown";
}
async function getWorkerLivenessAtTmuxIdentity(paneId, identity, dependencies = {}) {
  if (!isValidTmuxServerIdentity(identity) || !TMUX_MAILBOX_PANE_ID.test(paneId))
    return "unknown";
  let result;
  let queryError;
  try {
    result = await tmuxCmdAsync(
      tmuxArgsForIdentity(identity, [
        "display-message",
        "-t",
        paneId,
        "-p",
        "#{pane_dead}"
      ]),
      { timeout: 2e3, stripTmux: true }
    );
  } catch (error) {
    queryError = error;
  }
  const afterState = await observeTmuxServerIdentityWithBoundedRecheck(
    identity,
    dependencies
  );
  if (afterState === "dead") return "dead";
  if (afterState !== "matching") return "unknown";
  if (queryError !== void 0) {
    return isTmuxPaneNotFoundError(queryError) ? "dead" : "unknown";
  }
  if (!result) return "unknown";
  if (result.stderr.trim()) {
    return isTmuxPaneNotFoundError(result) ? "dead" : "unknown";
  }
  const state = result.stdout.replace(/\r?\n$/, "");
  if (state === "0") return "alive";
  if (state === "1") return "dead";
  return getTmuxPaneLivenessFromInventory(paneId, identity, dependencies);
}
async function getOwnedWorkerLiveness(ownership, dependencies = {}) {
  if (ownership.provider === "cmux") return getWorkerLiveness(ownership.paneId);
  if (ownership.provider === "herdr")
    return getWorkerLiveness(ownership.paneId);
  if (!isValidTmuxServerIdentity(ownership.tmuxServerIdentity))
    return "unknown";
  const serverState = await observeTmuxServerIdentityWithBoundedRecheck(
    ownership.tmuxServerIdentity,
    dependencies
  );
  if (serverState === "dead") return "dead";
  if (serverState !== "matching") return "unknown";
  return getWorkerLivenessAtTmuxIdentity(
    ownership.paneId,
    ownership.tmuxServerIdentity,
    dependencies
  );
}
async function isWorkerAlive(paneId) {
  return await getWorkerLiveness(paneId) === "alive";
}
function isPaneId(value) {
  return typeof value === "string" && (/^%\d+$/.test(value.trim()) || isCmuxSurfaceTarget(value));
}
function dedupeWorkerPaneIds(paneIds, leaderPaneId) {
  const unique = /* @__PURE__ */ new Set();
  for (const paneId of paneIds) {
    if (!isPaneId(paneId)) continue;
    const normalized = paneId.trim();
    if (normalized === leaderPaneId) continue;
    unique.add(normalized);
  }
  return [...unique];
}
function parseTmuxQueryLines(output) {
  if (!output) return null;
  const lines = output.split(/\r?\n/);
  if (lines[lines.length - 1] === "") lines.pop();
  if (!lines.length || lines.some((line) => line.length === 0)) return null;
  return lines;
}
function parseTmuxSessionRecords(output) {
  const lines = parseTmuxQueryLines(output);
  if (!lines) return null;
  const records = [];
  const ids = /* @__PURE__ */ new Set();
  const names = /* @__PURE__ */ new Set();
  for (const line of lines) {
    const match = line.match(/^(\$\d+)\t([^\t\r\n]+)$/);
    if (!match) return null;
    const [, id, name] = match;
    if (!id || !name || ids.has(id) || names.has(name)) return null;
    ids.add(id);
    names.add(name);
    records.push({ id, name });
  }
  return records;
}
function parseTmuxPaneRecords(output) {
  const lines = parseTmuxQueryLines(output);
  if (!lines) return null;
  const records = [];
  const ids = /* @__PURE__ */ new Set();
  for (const line of lines) {
    const match = line.match(/^(%\d+) ([01])$/);
    if (!match) return null;
    const [, id, dead] = match;
    if (!id || !dead || ids.has(id)) return null;
    ids.add(id);
    records.push({ id, dead });
  }
  return records;
}
async function getTmuxPaneLivenessFromInventory(paneId, tmuxServerIdentity, dependencies = {}) {
  if (tmuxServerIdentity) {
    const beforeState = await observeTmuxServerIdentityWithBoundedRecheck(
      tmuxServerIdentity,
      dependencies
    );
    if (beforeState === "dead") return "dead";
    if (beforeState !== "matching") return "unknown";
  }
  let result;
  let queryError;
  try {
    const args = ["list-panes", "-a", "-F", "#{pane_id} #{pane_dead}"];
    result = await tmuxCmdAsync(
      tmuxServerIdentity ? tmuxArgsForIdentity(tmuxServerIdentity, args) : args,
      tmuxServerIdentity ? { timeout: 2e3, stripTmux: true } : void 0
    );
  } catch (error) {
    queryError = error;
  }
  if (tmuxServerIdentity) {
    const afterState = await observeTmuxServerIdentityWithBoundedRecheck(
      tmuxServerIdentity,
      dependencies
    );
    if (afterState === "dead") return "dead";
    if (afterState !== "matching") return "unknown";
  }
  if (queryError !== void 0 || !result || result.stderr.trim())
    return "unknown";
  const panes = parseTmuxPaneRecords(result.stdout);
  if (!panes) return "unknown";
  const matches = panes.filter((pane2) => pane2.id === paneId);
  if (matches.length > 1) return "unknown";
  const pane = matches[0];
  if (!pane) {
    return "dead";
  }
  return pane.dead === "0" ? "alive" : "dead";
}
function parseTmuxWindowRecords(output) {
  const lines = parseTmuxQueryLines(output);
  if (!lines) return null;
  const records = [];
  const ids = /* @__PURE__ */ new Set();
  const targets = /* @__PURE__ */ new Set();
  for (const line of lines) {
    const match = line.match(/^(@\d+)\t(\$\d+)\t([^\t\r\n]+)\t(\d+)$/);
    if (!match) return null;
    const [, id, sessionId, sessionName2, index] = match;
    const target = `${sessionName2}:${index}`;
    if (!id || !sessionId || !sessionName2 || !index || ids.has(id) || targets.has(target)) {
      return null;
    }
    ids.add(id);
    targets.add(target);
    records.push({ id, sessionId, sessionName: sessionName2, index });
  }
  return records;
}
async function listTmuxSessionsForCleanup(tmuxServerIdentity) {
  try {
    const args = ["list-sessions", "-F", "#{session_id}	#{session_name}"];
    const result = await tmuxCmdAsync(
      tmuxServerIdentity ? tmuxArgsForIdentity(tmuxServerIdentity, args) : args,
      tmuxServerIdentity ? { timeout: 2e3, stripTmux: true } : void 0
    );
    if (result.stderr.trim()) return null;
    return parseTmuxSessionRecords(result.stdout);
  } catch {
    return null;
  }
}
async function listTmuxWindowsForCleanup(tmuxServerIdentity) {
  try {
    const args = [
      "list-windows",
      "-a",
      "-F",
      "#{window_id}	#{session_id}	#{session_name}	#{window_index}"
    ];
    const result = await tmuxCmdAsync(
      tmuxServerIdentity ? tmuxArgsForIdentity(tmuxServerIdentity, args) : args,
      tmuxServerIdentity ? { timeout: 2e3, stripTmux: true } : void 0
    );
    if (result.stderr.trim()) return null;
    return parseTmuxWindowRecords(result.stdout);
  } catch {
    return null;
  }
}
function parseDedicatedWindowTarget(sessionName2) {
  const separator = sessionName2.indexOf(":");
  if (separator <= 0 || separator === sessionName2.length - 1) return null;
  if (sessionName2.indexOf(":", separator + 1) !== -1) return null;
  const targetSession = sessionName2.slice(0, separator);
  const rawIndex = sessionName2.slice(separator + 1);
  if (!/^\d+$/.test(rawIndex)) return null;
  const numericIndex = Number(rawIndex);
  if (!Number.isSafeInteger(numericIndex)) return null;
  return { sessionName: targetSession, windowIndex: String(numericIndex) };
}
function normalizeDetachedSessionTarget(sessionName2) {
  const detachedTarget = sessionName2.includes(":") ? parseDedicatedWindowTarget(sessionName2) : null;
  const sessionTarget = detachedTarget ? detachedTarget.sessionName : sessionName2;
  return sessionTarget && /^[^\s:]+$/.test(sessionTarget) ? sessionTarget : null;
}
async function resolveSplitPaneWorkerPaneIds(_sessionName, recordedPaneIds, leaderPaneId) {
  return dedupeWorkerPaneIds(recordedPaneIds ?? [], leaderPaneId);
}
async function observeTeamSessionTargetPresence(args) {
  const provider = providerForTeamTarget(args.sessionName);
  if (provider === "tmux") {
    if (!isValidTmuxServerIdentity(args.tmuxServerIdentity))
      return { kind: "unknown" };
    const serverState = await observeTmuxServerIdentity(
      args.tmuxServerIdentity
    );
    if (serverState === "dead") return { kind: "absent" };
    if (serverState !== "matching") return { kind: "unknown" };
  }
  const ownership = await verifyTeamTargetOwnership({
    provider,
    providerTarget: args.sessionName,
    recipient: "leader-fixed",
    recipientRole: "leader",
    paneId: args.leaderPaneId,
    ...provider === "tmux" ? { tmuxServerIdentity: args.tmuxServerIdentity } : {}
  });
  if (ownership.kind === "owned") return { kind: "owned" };
  if (provider !== "tmux" || !isValidTmuxServerIdentity(args.tmuxServerIdentity)) {
    return { kind: "unknown" };
  }
  if (args.sessionMode === "dedicated-window") {
    const target = parseDedicatedWindowTarget(args.sessionName);
    if (!target) return { kind: "unknown" };
    const windows = await listTmuxWindowsForCleanup(args.tmuxServerIdentity);
    if (!windows) return { kind: "unknown" };
    const matches2 = windows.filter(
      (window) => window.sessionName === target.sessionName && window.index === target.windowIndex
    );
    if (matches2.length > 1) return { kind: "unknown" };
    return matches2.length === 0 ? { kind: "absent" } : { kind: "present_unowned" };
  }
  const sessionTarget = normalizeDetachedSessionTarget(args.sessionName);
  if (!sessionTarget) return { kind: "unknown" };
  const sessions = await listTmuxSessionsForCleanup(args.tmuxServerIdentity);
  if (!sessions) return { kind: "unknown" };
  const matches = sessions.filter((session) => session.name === sessionTarget);
  if (matches.length > 1) return { kind: "unknown" };
  return matches.length === 0 ? { kind: "absent" } : { kind: "present_unowned" };
}
async function killTeamSession(sessionName2, workerPaneIds, leaderPaneId, options = {}) {
  const sessionMode = options.sessionMode ?? (sessionName2.includes(":") ? "split-pane" : "detached-session");
  const provider = providerForTeamTarget(sessionName2);
  const identity = options.tmuxServerIdentity;
  if (provider === "tmux") {
    if (!isValidTmuxServerIdentity(identity)) return false;
    const serverState = await observeTmuxServerIdentity(identity);
    if (serverState === "dead") return true;
    if (serverState !== "matching") return false;
  }
  if (sessionMode === "split-pane") {
    if (!workerPaneIds?.length) return false;
    let cleaned = true;
    for (const id of workerPaneIds) {
      if (id === leaderPaneId) continue;
      try {
        if (provider === "tmux" && !TMUX_MAILBOX_PANE_ID.test(id)) {
          cleaned = false;
          continue;
        }
        const membership = await verifyTeamTargetOwnership({
          provider,
          providerTarget: sessionName2,
          recipient: "worker",
          recipientRole: "worker",
          paneId: id,
          ...provider === "tmux" ? { tmuxServerIdentity: identity } : {}
        });
        if (membership.kind !== "owned") {
          if (provider === "herdr" && membership.kind === "foreign") {
            continue;
          }
          cleaned = false;
          continue;
        }
        if (provider === "herdr") await herdrClosePane(id);
        else if (provider === "cmux") await cmuxCloseSurface(id);
        else {
          const result2 = await runGuardedNativeTmuxCommand(
            identity,
            tmuxCommandString(["kill-pane", "-t", id])
          );
          if (result2.outcome !== "executed") {
            const state = await observeTmuxServerIdentity(identity);
            if (state !== "dead") cleaned = false;
          }
        }
      } catch {
        cleaned = false;
      }
    }
    if (cleaned && provider === "herdr") {
      try {
        await herdrCloseWorkspace(
          herdrWorkspaceIdFromSessionTarget(sessionName2)
        );
      } catch {
        return false;
      }
    }
    return cleaned;
  }
  if (sessionMode === "dedicated-window") {
    const target = parseDedicatedWindowTarget(sessionName2);
    if (!target) return false;
    const windows = await listTmuxWindowsForCleanup(identity);
    if (!windows) return false;
    const matches2 = windows.filter(
      (window2) => window2.sessionName === target.sessionName && window2.index === target.windowIndex
    );
    if (matches2.length > 1) return false;
    const window = matches2[0];
    if (!window) {
      return true;
    }
    const result2 = await runGuardedNativeTmuxCommand(
      identity,
      tmuxCommandString(["kill-window", "-t", window.id])
    );
    if (result2.outcome === "executed") return true;
    return await observeTmuxServerIdentity(identity) === "dead";
  }
  const sessionTarget = normalizeDetachedSessionTarget(sessionName2);
  if (!sessionTarget) return false;
  if (process.env.OMC_TEAM_ALLOW_KILL_CURRENT_SESSION !== "1" && process.env.TMUX) {
    try {
      const current = await tmuxCmdAsync(
        tmuxArgsForIdentity(identity, ["display-message", "-p", "#S"]),
        { timeout: 2e3, stripTmux: true }
      );
      const currentLines = parseTmuxQueryLines(current.stdout);
      if (!currentLines || currentLines.length !== 1) return false;
      const currentSessionName = currentLines[0];
      if (currentSessionName === sessionTarget) return false;
    } catch {
      return false;
    }
  }
  const sessions = await listTmuxSessionsForCleanup(identity);
  if (!sessions) return false;
  const matches = sessions.filter((session2) => session2.name === sessionTarget);
  if (matches.length > 1) return false;
  const session = matches[0];
  if (!session) {
    return true;
  }
  const result = await runGuardedNativeTmuxCommand(
    identity,
    tmuxCommandString(["kill-session", "-t", session.id])
  );
  if (result.outcome === "executed") return true;
  return await observeTmuxServerIdentity(identity) === "dead";
}
var import_fs11, import_crypto5, import_child_process5, import_util7, import_path15, import_os4, sleep3, execFileAsync4, TMUX_SESSION_PREFIX, TMUX_LIVENESS_SERVER_RECHECK_ATTEMPTS, TMUX_LIVENESS_SERVER_RECHECK_DELAY_MS, CMUX_MEMBERSHIP_RETRY_ATTEMPTS, CMUX_MEMBERSHIP_RETRY_INTERVAL_MS, defaultTmuxServerIdentityDependencies, guardMarkerCounter, TMUX_MAILBOX_PANE_ID, TMUX_MAILBOX_TARGET, defaultMailboxTargetOwnershipDependencies, defaultDirectMailboxEffectDependencies, TeamSessionCreationError, SUPPORTED_POSIX_SHELLS, ZSH_CANDIDATES, BASH_CANDIDATES, DECIMAL_INTEGER_TEXT2, DANGEROUS_LAUNCH_BINARY_CHARS;
var init_tmux_session = __esm({
  "src/team/tmux-session.ts"() {
    "use strict";
    import_fs11 = require("fs");
    import_crypto5 = require("crypto");
    import_child_process5 = require("child_process");
    import_util7 = require("util");
    import_path15 = require("path");
    import_os4 = require("os");
    init_loader();
    init_team_name();
    init_herdr_session();
    init_tmux_utils();
    init_types3();
    init_team_owner_epoch();
    init_native_contained_fs();
    init_pane_readiness();
    init_worker_launch_ack();
    init_runtime_owner_client();
    sleep3 = (ms) => new Promise((r) => setTimeout(r, ms));
    execFileAsync4 = (0, import_util7.promisify)(import_child_process5.execFile);
    TMUX_SESSION_PREFIX = "omc-team";
    TMUX_LIVENESS_SERVER_RECHECK_ATTEMPTS = 3;
    TMUX_LIVENESS_SERVER_RECHECK_DELAY_MS = 20;
    CMUX_MEMBERSHIP_RETRY_ATTEMPTS = 20;
    CMUX_MEMBERSHIP_RETRY_INTERVAL_MS = 50;
    defaultTmuxServerIdentityDependencies = {
      tmuxQuery: (args, options) => tmuxCmdAsync(args, options),
      processIdentity: currentStrictProcessStartIdentity,
      processObservation: (record) => observeProcessIdentity({
        pid: record.server_pid,
        process_started_at: record.process_started_at
      })
    };
    guardMarkerCounter = 0;
    TMUX_MAILBOX_PANE_ID = /^%\d+$/;
    TMUX_MAILBOX_TARGET = /^[^\s:]+(?::[^\s:]+)?$/;
    defaultMailboxTargetOwnershipDependencies = {
      tmuxExec: (args) => tmuxExecAsync(args),
      cmuxExec: cmuxExecAsync
    };
    defaultDirectMailboxEffectDependencies = {
      sendWorker: sendToWorker,
      sendLeader: injectToLeaderPane
    };
    TeamSessionCreationError = class extends Error {
      partialSession;
      creationEvidence;
      cleanupStatus = "unknown";
      constructor(message, partialSession, creationEvidence) {
        super(message);
        this.name = "TeamSessionCreationError";
        this.partialSession = {
          ...partialSession,
          workerPaneIds: [...partialSession.workerPaneIds],
          ...partialSession.tmuxServerIdentity ? { tmuxServerIdentity: { ...partialSession.tmuxServerIdentity } } : {}
        };
        if (creationEvidence) {
          this.creationEvidence = {
            ...creationEvidence,
            ...creationEvidence.socketPath ? { socketPath: creationEvidence.socketPath } : {},
            ...creationEvidence.tmuxServerIdentity ? { tmuxServerIdentity: { ...creationEvidence.tmuxServerIdentity } } : {}
          };
        }
      }
    };
    SUPPORTED_POSIX_SHELLS = /* @__PURE__ */ new Set(["sh", "bash", "zsh", "fish", "ksh"]);
    ZSH_CANDIDATES = [
      "/bin/zsh",
      "/usr/bin/zsh",
      "/usr/local/bin/zsh",
      "/opt/homebrew/bin/zsh"
    ];
    BASH_CANDIDATES = ["/bin/bash", "/usr/bin/bash"];
    DECIMAL_INTEGER_TEXT2 = /^(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/;
    DANGEROUS_LAUNCH_BINARY_CHARS = /[;&|`$()<>\n\r\t\0]/;
  }
});

// src/notifications/tmux.ts
var tmux_exports = {};
__export(tmux_exports, {
  formatTmuxInfo: () => formatTmuxInfo,
  getCurrentHerdrPaneId: () => getCurrentHerdrPaneId,
  getCurrentTmuxPaneId: () => getCurrentTmuxPaneId,
  getCurrentTmuxSession: () => getCurrentTmuxSession,
  getTeamHerdrWorkspaces: () => getTeamHerdrWorkspaces,
  getTeamTmuxSessions: () => getTeamTmuxSessions
});
function getCurrentHerdrPaneId(env = process.env) {
  const paneId = env.HERDR_PANE_ID?.trim();
  return paneId && isHerdrPaneId(paneId) ? paneId : null;
}
function herdrSessionMarker(paneId) {
  try {
    return `herdr:${herdrWorkspaceIdFromPaneId(paneId)}`;
  } catch {
    return null;
  }
}
function getCurrentTmuxSession() {
  const herdrPane = getCurrentHerdrPaneId();
  if (herdrPane) {
    return herdrSessionMarker(herdrPane);
  }
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
      if (match) return match.slice(paneId.length + 1) || null;
    }
    const sessionName2 = tmuxShell("display-message -p '#S'", {
      timeout: 3e3,
      stdio: ["pipe", "pipe", "pipe"]
    }).trim();
    return sessionName2 || null;
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
  const herdrPane = getCurrentHerdrPaneId();
  if (herdrPane) {
    const marker = herdrSessionMarker(herdrPane);
    return marker ? `herdr: ${marker.slice("herdr:".length)}` : null;
  }
  const session = getCurrentTmuxSession();
  if (!session) return null;
  return `tmux: ${session}`;
}
function getCurrentTmuxPaneId() {
  const herdrPane = getCurrentHerdrPaneId();
  if (herdrPane) return herdrPane;
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
async function getTeamHerdrWorkspaces(teamName) {
  const sanitized = teamName.replace(/[^a-zA-Z0-9-]/g, "");
  if (!sanitized) return [];
  try {
    const teams = await listHerdrTeams();
    return teams.filter((team) => team.teamName === sanitized);
  } catch {
    return [];
  }
}
var init_tmux = __esm({
  "src/notifications/tmux.ts"() {
    "use strict";
    init_tmux_utils();
    init_tmux_session();
    init_herdr_session();
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
  const expectedSignature = "v0=" + (0, import_crypto6.createHmac)("sha256", signingSecret).update(sigBasestring).digest("hex");
  try {
    return (0, import_crypto6.timingSafeEqual)(
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
var import_crypto6, MAX_TIMESTAMP_AGE_SECONDS, VALID_ENVELOPE_TYPES, SlackConnectionStateTracker;
var init_slack_socket = __esm({
  "src/notifications/slack-socket.ts"() {
    "use strict";
    import_crypto6 = require("crypto");
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
  getPaneHistorySize: () => getPaneHistorySize,
  resetPaneTailPositions: () => resetPaneTailPositions
});
function isValidPaneId(paneId) {
  return /^%\d+$/.test(paneId);
}
function readPaneTailState(stateDir) {
  const path3 = (0, import_path16.join)(stateDir, STATE_FILE);
  try {
    if ((0, import_fs12.existsSync)(path3)) {
      const parsed = JSON.parse((0, import_fs12.readFileSync)(path3, "utf-8"));
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
    (0, import_fs12.mkdirSync)(stateDir, { recursive: true });
    (0, import_fs12.writeFileSync)((0, import_path16.join)(stateDir, STATE_FILE), JSON.stringify(state), { mode: 384 });
  } catch {
  }
}
function resetPaneTailPositions(stateDir) {
  writePaneTailState(stateDir, {});
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
function getNewPaneTail(paneId, stateDir, maxLines = DEFAULT_MAX_LINES2) {
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
var import_fs12, import_path16, STATE_FILE, DEFAULT_MAX_LINES2;
var init_pane_fresh_capture = __esm({
  "src/features/rate-limit-wait/pane-fresh-capture.ts"() {
    "use strict";
    import_fs12 = require("fs");
    import_path16 = require("path");
    init_tmux_utils();
    STATE_FILE = "pane-tail-positions.json";
    DEFAULT_MAX_LINES2 = 15;
  }
});

// src/features/rate-limit-wait/tmux-detector.ts
var tmux_detector_exports = {};
__export(tmux_detector_exports, {
  analyzePaneContent: () => analyzePaneContent,
  capturePaneContent: () => capturePaneContent,
  formatBlockedPanesSummary: () => formatBlockedPanesSummary,
  isHerdrDetectorEnabled: () => isHerdrDetectorEnabled,
  isInsideTmux: () => isInsideTmux,
  isPaneAlive: () => isPaneAlive,
  isTmuxAvailable: () => isTmuxAvailable,
  listTmuxPanes: () => listTmuxPanes,
  revalidateBlockedHerdrPanes: () => revalidateBlockedHerdrPanes,
  revalidateBlockedPanes: () => revalidateBlockedPanes,
  scanForBlockedHerdrPanes: () => scanForBlockedHerdrPanes,
  scanForBlockedPanes: () => scanForBlockedPanes,
  sendHerdrResumeSequence: () => sendHerdrResumeSequence,
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
function isLiveMenuContextSeparator(line) {
  return LIVE_MENU_DIVIDER_PATTERN.test(line) || LIVE_MENU_LABEL_PATTERN.test(line);
}
function hasLiveResumeMenuPrompt(lines) {
  const lastLine = lines.at(-1) ?? "";
  const hasConfirmation = LIVE_CONFIRMATION_PROMPT_PATTERN.test(lastLine);
  if (!hasConfirmation && !LIVE_RESUME_OPTION_PATTERN.test(lastLine)) return false;
  let firstOptionIndex = lines.length - (hasConfirmation ? 2 : 1);
  if (firstOptionIndex < 0 || !LIVE_MENU_OPTION_PATTERN.test(lines[firstOptionIndex] ?? "")) {
    return false;
  }
  while (firstOptionIndex > 0 && LIVE_MENU_OPTION_PATTERN.test(lines[firstOptionIndex - 1] ?? "")) {
    firstOptionIndex--;
  }
  if (!LIVE_RESUME_OPTION_PATTERN.test(lines[firstOptionIndex] ?? "")) return false;
  let contextIndex = firstOptionIndex - 1;
  while (contextIndex >= 0 && isLiveMenuContextSeparator(lines[contextIndex] ?? "")) {
    contextIndex--;
  }
  if (contextIndex >= 0 && RATE_LIMIT_PATTERNS.some(
    (pattern) => pattern.test(lines[contextIndex] ?? "")
  )) {
    return true;
  }
  if (contextIndex >= 0 && LIVE_MENU_QUESTION_PATTERN.test(lines[contextIndex] ?? "")) {
    contextIndex--;
    while (contextIndex >= 0 && isLiveMenuContextSeparator(lines[contextIndex] ?? "")) {
      contextIndex--;
    }
    return contextIndex >= 0 && RATE_LIMIT_PATTERNS.some(
      (pattern) => pattern.test(lines[contextIndex] ?? "")
    );
  }
  return false;
}
function hasLiveWaitAndContinuePrompt(lines) {
  const promptIndex = lines.length - 1;
  if ((lines[promptIndex] ?? "").trim() !== ">") return false;
  let firstOptionIndex = promptIndex - 1;
  while (firstOptionIndex >= 0 && LIVE_MENU_OPTION_PATTERN.test(lines[firstOptionIndex] ?? "")) {
    firstOptionIndex--;
  }
  firstOptionIndex++;
  if (firstOptionIndex >= promptIndex || !LIVE_RESUME_OPTION_PATTERN.test(lines[firstOptionIndex] ?? "") || !lines.slice(firstOptionIndex, promptIndex).every((line) => LIVE_MENU_OPTION_PATTERN.test(line))) {
    return false;
  }
  let questionIndex = firstOptionIndex - 1;
  while (questionIndex >= 0 && isLiveMenuContextSeparator(lines[questionIndex] ?? "")) {
    questionIndex--;
  }
  if (questionIndex < 0 || !LIVE_MENU_QUESTION_PATTERN.test(lines[questionIndex] ?? "")) {
    return false;
  }
  let contextLinesChecked = 0;
  for (let contextIndex = questionIndex - 1; contextIndex >= 0 && contextLinesChecked < 3; contextIndex--) {
    const line = lines[contextIndex] ?? "";
    if (isLiveMenuContextSeparator(line)) continue;
    contextLinesChecked++;
    if (RATE_LIMIT_PATTERNS.some((pattern) => pattern.test(line))) return true;
  }
  return false;
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
function parseTmuxPanes(result) {
  const panes = [];
  for (const line of result.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const match = line.match(/^([^:]*):(\d+)\.(\d+) (%\d+) ([01]) (.*)$/);
    if (!match) continue;
    const [, session, windowIndexStr, paneIndexStr, paneId, activeStr, rest] = match;
    const [windowName, ...titleParts] = rest.split(" ");
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
}
function listTmuxPanesStrict() {
  if (!isTmuxAvailable()) {
    return null;
  }
  try {
    const format = "#{session_name}:#{window_index}.#{pane_index} #{pane_id} #{pane_active} #{window_name} #{pane_title}";
    const result = tmuxExec(["list-panes", "-a", "-F", format], {
      stripTmux: true,
      timeout: 5e3
    });
    return parseTmuxPanes(result);
  } catch (error) {
    console.error("[TmuxDetector] Error listing panes:", error);
    return null;
  }
}
function listTmuxPanes() {
  return listTmuxPanesStrict() ?? [];
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
function capturePaneContentStrict(paneId, lines) {
  if (!isTmuxAvailable()) {
    return null;
  }
  if (isHerdrPaneId(paneId)) {
    return null;
  }
  if (!isValidPaneId2(paneId)) {
    console.error(`[TmuxDetector] Invalid pane ID format: ${paneId}`);
    return null;
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
    return null;
  }
}
function capturePaneContent(paneId, lines = 15) {
  return capturePaneContentStrict(paneId, lines) ?? "";
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
function revalidateBlockedPanes(trackedPanes, lines = 15) {
  if (trackedPanes.length === 0) return [];
  const livePanes = listTmuxPanesStrict();
  if (livePanes === null) return null;
  const resumable = [];
  for (const tracked of trackedPanes) {
    if (!isValidPaneId2(tracked.id)) continue;
    const current = livePanes.find(
      (pane) => pane.id === tracked.id && pane.session === tracked.session && pane.windowIndex === tracked.windowIndex && pane.paneIndex === tracked.paneIndex
    );
    if (!current) continue;
    const content = capturePaneContentStrict(current.id, lines);
    if (content === null) return null;
    const analysis = analyzePaneContent(content);
    const recentLines = content.split(/\r?\n/).filter((line) => line.trim() && !OMC_HUD_STATUS_LINE_PATTERN.test(line) && !OMC_HUD_MODE_LINE_PATTERN.test(line)).join("\n");
    const recentLineList = recentLines.split("\n");
    const hasLivePrompt = hasLiveResumeMenuPrompt(recentLineList) || hasLiveWaitAndContinuePrompt(recentLineList);
    if (!analysis.isBlocked || !LIVE_RESUME_OPTION_PATTERN.test(recentLines) || !hasLivePrompt) continue;
    resumable.push({
      ...current,
      analysis,
      firstDetectedAt: tracked.firstDetectedAt,
      resumeAttempted: tracked.resumeAttempted,
      resumeSuccessful: tracked.resumeSuccessful
    });
  }
  return resumable;
}
function sendResumeSequence(paneId) {
  if (!isTmuxAvailable()) {
    return false;
  }
  if (isHerdrPaneId(paneId)) {
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
  if (isHerdrPaneId(paneId)) {
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
function isHerdrDetectorEnabled(env = process.env) {
  return resolveTeamMultiplexer(void 0, env) === "herdr";
}
function herdrBlockedPane(agent, analysis) {
  const paneId = agent.pane_id;
  let session = paneId;
  try {
    session = herdrWorkspaceIdFromPaneId(paneId);
  } catch {
  }
  return {
    id: paneId,
    session,
    windowIndex: 0,
    windowName: agent.name ?? agent.agent ?? "",
    paneIndex: 0,
    isActive: true,
    analysis,
    firstDetectedAt: /* @__PURE__ */ new Date(),
    resumeAttempted: false
  };
}
async function scanForBlockedHerdrPanes(lines = 15) {
  let agents;
  try {
    agents = await listHerdrAgents();
  } catch {
    return [];
  }
  const blocked = [];
  for (const agent of agents) {
    const paneId = agent.pane_id;
    let content;
    try {
      content = await captureHerdrWorkerPane(paneId, Math.max(1, Math.min(100, Math.floor(lines))));
    } catch {
      continue;
    }
    const analysis = analyzePaneContent(content);
    if (analysis.isBlocked) {
      blocked.push(herdrBlockedPane(agent, analysis));
    }
  }
  return blocked;
}
async function revalidateBlockedHerdrPanes(trackedPanes, lines = 15) {
  if (trackedPanes.length === 0) return [];
  let agents;
  try {
    agents = await listHerdrAgents();
  } catch {
    return null;
  }
  const liveIds = new Set(agents.map((agent) => agent.pane_id));
  const resumable = [];
  for (const tracked of trackedPanes) {
    if (!isHerdrPaneId(tracked.id)) continue;
    if (!liveIds.has(tracked.id)) continue;
    let content;
    try {
      content = await captureHerdrWorkerPane(tracked.id, lines);
    } catch {
      return null;
    }
    const analysis = analyzePaneContent(content);
    const recentLines = content.split(/\r?\n/).filter((line) => line.trim() && !OMC_HUD_STATUS_LINE_PATTERN.test(line) && !OMC_HUD_MODE_LINE_PATTERN.test(line)).join("\n");
    const recentLineList = recentLines.split("\n");
    const hasLivePrompt = hasLiveResumeMenuPrompt(recentLineList) || hasLiveWaitAndContinuePrompt(recentLineList);
    if (!analysis.isBlocked || !LIVE_RESUME_OPTION_PATTERN.test(recentLines) || !hasLivePrompt) continue;
    resumable.push({
      ...tracked,
      analysis
    });
  }
  return resumable;
}
async function sendHerdrResumeSequence(paneId) {
  if (!isHerdrPaneId(paneId)) {
    console.error(`[TmuxDetector] Not a herdr pane ID: ${paneId}`);
    return false;
  }
  try {
    await herdrSendKey(paneId, "enter");
    return true;
  } catch (error) {
    console.error(`[TmuxDetector] Error sending herdr resume to pane ${paneId}:`, error);
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
var RATE_LIMIT_PATTERNS, CLAUDE_CODE_PATTERNS, OMC_HUD_STATUS_LINE_PATTERN, OMC_HUD_MODE_LINE_PATTERN, SAVED_TRANSCRIPT_COMMAND_PATTERN, SAVED_TRANSCRIPT_LABEL_PATTERN, OMC_HUD_RATE_LIMIT_SCREEN_PATTERNS, WEEKLY_RATE_LIMIT_PATTERN, GIT_OUTPUT_LINE_PATTERNS, WAITING_PATTERNS, LIVE_RESUME_OPTION_PATTERN, LIVE_CONFIRMATION_PROMPT_PATTERN, LIVE_MENU_OPTION_PATTERN, LIVE_MENU_QUESTION_PATTERN, LIVE_MENU_DIVIDER_PATTERN, LIVE_MENU_LABEL_PATTERN;
var init_tmux_detector = __esm({
  "src/features/rate-limit-wait/tmux-detector.ts"() {
    "use strict";
    init_tmux_utils();
    init_pane_fresh_capture();
    init_herdr_session();
    init_tmux_session();
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
    OMC_HUD_STATUS_LINE_PATTERN = /^\s*\[OMC#[^\]\s]+\](?:\s*\|.*)?\s*$/i;
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
    LIVE_RESUME_OPTION_PATTERN = /^\s*(?:❯\s*)?(?:\[1\]|1[.)]?)\s+(?:continue|resume|retry|try again|stop and wait|wait and continue automatically)\b/im;
    LIVE_CONFIRMATION_PROMPT_PATTERN = /^\s*(?:enter to confirm(?:\s*·\s*esc to cancel)?|enter choice:)\s*$/i;
    LIVE_MENU_OPTION_PATTERN = /^\s*(?:❯\s*)?(?:\[\d+\]|\d+[.)]?)\s+/;
    LIVE_MENU_QUESTION_PATTERN = /^\s*what (?:would you like|do you want) to do\?\s*$/i;
    LIVE_MENU_DIVIDER_PATTERN = /^\s*[-─━═]+\s*$/;
    LIVE_MENU_LABEL_PATTERN = /^\s*options:\s*$/i;
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
  return (0, import_path17.join)(getRegistryStateDir(), "reply-session-registry.jsonl");
}
function getRegistryReadPaths() {
  if (process.env["OMC_TEST_REGISTRY_DIR"]) {
    return [getRegistryPath()];
  }
  return getGlobalOmcStateCandidates("reply-session-registry.jsonl");
}
function getLockPath() {
  return (0, import_path17.join)(getRegistryStateDir(), "reply-session-registry.lock");
}
function ensureRegistryDir() {
  const registryDir = (0, import_path17.dirname)(getRegistryPath());
  if (!(0, import_fs13.existsSync)(registryDir)) {
    (0, import_fs13.mkdirSync)(registryDir, { recursive: true, mode: 448 });
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
    const raw = (0, import_fs13.readFileSync)(getLockPath(), "utf-8");
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
    const currentRaw = (0, import_fs13.readFileSync)(getLockPath(), "utf-8");
    if (currentRaw !== snapshot.raw) {
      return false;
    }
  } catch {
    return false;
  }
  try {
    (0, import_fs13.unlinkSync)(getLockPath());
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
      const token = (0, import_crypto7.randomUUID)();
      const fd = (0, import_fs13.openSync)(
        getLockPath(),
        import_fs13.constants.O_CREAT | import_fs13.constants.O_EXCL | import_fs13.constants.O_WRONLY,
        SECURE_FILE_MODE
      );
      const lockPayload = JSON.stringify({
        pid: process.pid,
        acquiredAt: Date.now(),
        token
      });
      (0, import_fs13.writeSync)(fd, lockPayload, null, "utf-8");
      return { fd, token };
    } catch (error) {
      const err = error;
      if (err.code !== "EEXIST") {
        throw error;
      }
      try {
        const lockAgeMs = Date.now() - (0, import_fs13.statSync)(getLockPath()).mtimeMs;
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
    (0, import_fs13.closeSync)(lock.fd);
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
    const fd = (0, import_fs13.openSync)(
      getRegistryPath(),
      import_fs13.constants.O_WRONLY | import_fs13.constants.O_APPEND | import_fs13.constants.O_CREAT,
      SECURE_FILE_MODE
    );
    try {
      (0, import_fs13.writeSync)(fd, Buffer.from(line, "utf-8"));
      return true;
    } finally {
      (0, import_fs13.closeSync)(fd);
    }
  }) ?? false;
}
function loadAllMappings() {
  return withRegistryLock(() => readAllMappingsUnsafe()) ?? readAllMappingsUnsafe();
}
function readAllMappingsUnsafe() {
  for (const registryPath of getRegistryReadPaths()) {
    if (!(0, import_fs13.existsSync)(registryPath)) {
      continue;
    }
    try {
      const content = (0, import_fs13.readFileSync)(registryPath, "utf-8");
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
  const content = mappings.length === 0 ? "" : mappings.map((m) => JSON.stringify(m)).join("\n") + "\n";
  atomicWriteFileSync(getRegistryPath(), content);
}
var import_fs13, import_path17, import_crypto7, SECURE_FILE_MODE, MAX_AGE_MS, LOCK_TIMEOUT_MS, LOCK_RETRY_MS, LOCK_STALE_MS, LOCK_MAX_WAIT_MS, SLEEP_ARRAY;
var init_session_registry = __esm({
  "src/notifications/session-registry.ts"() {
    "use strict";
    import_fs13 = require("fs");
    import_path17 = require("path");
    import_crypto7 = require("crypto");
    init_atomic_write();
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
  getCurrentHerdrPaneId: () => getCurrentHerdrPaneId,
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
  getTeamHerdrWorkspaces: () => getTeamHerdrWorkspaces,
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
  return (0, import_path18.join)(
    getSessionStateDir(sessionId, projectPath),
    NOTIFICATION_RECEIPT_FILE
  );
}
function claimNotificationReceipt(intentId, event, sessionId, projectPath, nowMs) {
  try {
    const receiptPath = notificationReceiptPath(sessionId, projectPath);
    const locked = withStateFileMutationLock(receiptPath, () => {
      let state = { version: 2, receipts: {} };
      if ((0, import_fs14.existsSync)(receiptPath)) {
        try {
          const parsed = JSON.parse((0, import_fs14.readFileSync)(receiptPath, "utf8"));
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
  const claimId = (0, import_crypto8.randomUUID)();
  try {
    const receiptPath = notificationReceiptPath(sessionId, projectPath);
    const locked = withStateFileMutationLock(receiptPath, () => {
      let state = { version: 2, receipts: {} };
      if ((0, import_fs14.existsSync)(receiptPath)) {
        try {
          const parsed = JSON.parse((0, import_fs14.readFileSync)(receiptPath, "utf8"));
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
      if (!(0, import_fs14.existsSync)(receiptPath)) return "changed";
      let state;
      try {
        const parsed = JSON.parse((0, import_fs14.readFileSync)(receiptPath, "utf8"));
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
      if (!(0, import_fs14.existsSync)(receiptPath)) return "changed";
      let state;
      try {
        const parsed = JSON.parse((0, import_fs14.readFileSync)(receiptPath, "utf8"));
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
      projectName: data.projectName || (data.projectPath ? (0, import_path18.basename)(data.projectPath) : void 0),
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
      replyThread: data.replyThread ?? process.env.OPENCLAW_REPLY_THREAD ?? void 0,
      approval: data.approval
    };
    if (shouldIncludeTmuxTail(verbosity) && payload.tmuxPaneId && (event === "session-idle" || event === "session-end" || event === "session-stop")) {
      try {
        const { isHerdrPaneId: isHerdrPaneId2 } = await Promise.resolve().then(() => (init_tmux_session(), tmux_session_exports));
        const tailLines = getTmuxTailLines(config);
        let rawTail;
        if (isHerdrPaneId2(payload.tmuxPaneId)) {
          const { captureHerdrWorkerPane: captureHerdrWorkerPane2 } = await Promise.resolve().then(() => (init_herdr_session(), herdr_session_exports));
          try {
            rawTail = await captureHerdrWorkerPane2(payload.tmuxPaneId, tailLines);
          } catch {
          }
        } else {
          const { capturePaneContent: capturePaneContent2 } = await Promise.resolve().then(() => (init_tmux_detector(), tmux_detector_exports));
          const { getNewPaneTail: getNewPaneTail2 } = await Promise.resolve().then(() => (init_pane_fresh_capture(), pane_fresh_capture_exports));
          rawTail = payload.projectPath ? getNewPaneTail2(payload.tmuxPaneId, (0, import_path18.join)(getOmcRoot(payload.projectPath), "state"), tailLines) : capturePaneContent2(payload.tmuxPaneId, tailLines);
        }
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
    if (result.anySuccess && (payload.tmuxPaneId || payload.event === "approval-request")) {
      try {
        const { registerMessage: registerMessage2 } = await Promise.resolve().then(() => (init_session_registry(), session_registry_exports));
        for (const r of result.results) {
          if (r.success && r.messageId && (r.platform === "discord-bot" || r.platform === "telegram" || r.platform === "slack-bot")) {
            registerMessage2({
              platform: r.platform,
              messageId: r.messageId,
              sessionId: payload.sessionId,
              tmuxPaneId: payload.tmuxPaneId ?? "",
              tmuxSessionName: payload.tmuxSession || "",
              event: payload.event,
              createdAt: (/* @__PURE__ */ new Date()).toISOString(),
              projectPath: payload.projectPath,
              ...payload.approval ? { approvalRef: payload.approval } : {},
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
var import_path18, import_fs14, import_crypto8, NOTIFICATION_RECEIPT_FILE, NOTIFICATION_PROVISIONAL_LEASE_MS;
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
    import_path18 = require("path");
    import_fs14 = require("fs");
    import_crypto8 = require("crypto");
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
  recordReadBudgetWarningLocked: () => recordReadBudgetWarningLocked,
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
  let errorMessage2 = "";
  const maps = errorMaps.filter((m) => !!m).slice().reverse();
  for (const map of maps) {
    errorMessage2 = map(fullIssue, { data, defaultError: errorMessage2 }).message;
  }
  return {
    ...issueData,
    path: fullPath,
    message: errorMessage2
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
  const turnId = firstStringField(raw, ["turn_id", "turnId"]);
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
    ...turnId !== void 0 ? { turnId } : {},
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
var import_node_path2 = require("node:path");
init_worktree_paths();

// src/features/builtin-skills/registry.ts
var import_node_path = require("node:path");
var import_node_url = require("node:url");

// src/utils/frontmatter.ts
init_utf8_bom();
function unquoteYamlScalar(value) {
  if (value.startsWith('"') && value.endsWith('"')) return value.slice(1, -1);
  if (value.startsWith("'") && value.endsWith("'"))
    return value.slice(1, -1).replace(/''/g, "'");
  return value;
}
function stripOptionalQuotes(value) {
  const trimmed = value.trim();
  return unquoteYamlScalar(trimmed).trim();
}
var BLOCK_SCALAR_HEADER = /^([|>])(?:(?:([+-])([1-9])?)|(?:([1-9])([+-])?))?(?:[ \t]+#.*)?$/;
function parseBlockScalarHeader(rawValue) {
  const match = BLOCK_SCALAR_HEADER.exec(rawValue);
  if (!match) return null;
  const chompingIndicator = match[2] ?? match[5];
  const indentIndicator = match[3] ?? match[4];
  return {
    folded: match[1] === ">",
    chomping: chompingIndicator === "+" ? "keep" : chompingIndicator === "-" ? "strip" : "clip",
    ...indentIndicator ? { indentIndicator: Number(indentIndicator) } : {}
  };
}
function countLeadingYamlSpaces(line) {
  let count = 0;
  while (line[count] === " ") count++;
  return count;
}
function isBlankBlockScalarLine(line) {
  return countLeadingYamlSpaces(line) === line.length;
}
function getBlockScalarContentIndent(lines, startIndex, parentIndent, header) {
  if (header.indentIndicator !== void 0) {
    return { value: parentIndent + header.indentIndicator, isDetermined: true };
  }
  let leadingBlankIndent = parentIndent;
  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i];
    const indent = countLeadingYamlSpaces(line);
    if (isBlankBlockScalarLine(line)) {
      leadingBlankIndent = Math.max(leadingBlankIndent, indent);
      continue;
    }
    if (indent > parentIndent) {
      if (line[indent] === "#" && indent < leadingBlankIndent) {
        return { value: leadingBlankIndent, isDetermined: false };
      }
      return { value: indent, isDetermined: true };
    }
    break;
  }
  return { value: parentIndent + 1, isDetermined: false };
}
function readBlockScalar(blockLines, header, contentIndent) {
  const rows = blockLines.map((line) => {
    const indent = countLeadingYamlSpaces(line);
    if (isBlankBlockScalarLine(line) && !contentIndent.isDetermined)
      return { text: "", moreIndented: false };
    const moreIndented = indent > contentIndent.value || line[contentIndent.value] === "	";
    return {
      text: line.slice(Math.min(contentIndent.value, indent)),
      moreIndented
    };
  });
  let value;
  if (header.folded) {
    value = foldBlockScalarRows(rows);
  } else {
    value = rows.map((row) => row.text).join("\n") + (rows.length > 0 ? "\n" : "");
  }
  if (header.chomping === "keep") return value;
  const withoutTrailingBreaks = value.replace(/\n+$/, "");
  if (header.chomping === "strip" || !rows.some((row) => row.text !== ""))
    return withoutTrailingBreaks;
  return `${withoutTrailingBreaks}
`;
}
function foldBlockScalarRows(rows) {
  let value = "";
  let previous;
  let pendingEmptyLines = 0;
  for (const row of rows) {
    if (row.text === "") {
      pendingEmptyLines++;
      continue;
    }
    if (!previous) {
      value += "\n".repeat(pendingEmptyLines);
    } else if (pendingEmptyLines > 0) {
      const preservedBreak = previous.moreIndented || row.moreIndented ? 1 : 0;
      value += "\n".repeat(pendingEmptyLines + preservedBreak);
    } else {
      value += previous.moreIndented || row.moreIndented ? "\n" : " ";
    }
    value += row.text;
    previous = row;
    pendingEmptyLines = 0;
  }
  return value + "\n".repeat(previous ? pendingEmptyLines + 1 : pendingEmptyLines);
}
function parseFrontmatter(content) {
  const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/;
  const match = stripLeadingUtf8Bom(content).match(frontmatterRegex);
  if (!match) {
    return { metadata: {}, body: content };
  }
  const [, yamlContent, body] = match;
  const metadata = {};
  const lines = yamlContent.split(/\r?\n/);
  const rootLine = lines.find((line) => {
    const trimmed = line.trimStart();
    return trimmed.length > 0 && !trimmed.startsWith("#") && trimmed.includes(":");
  });
  const rootIndent = rootLine === void 0 ? void 0 : rootLine.length - rootLine.trimStart().length;
  let flowDepth = 0;
  let quote = null;
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    const trimmed = line.trimStart();
    const indent = line.length - trimmed.length;
    if (flowDepth === 0) {
      if (!trimmed || trimmed.startsWith("#")) continue;
      if (indent !== rootIndent) continue;
      const colonIndex = line.indexOf(":");
      if (colonIndex === -1) continue;
      const key = line.slice(0, colonIndex).trim();
      const rawValue = line.slice(colonIndex + 1).trim();
      const blockHeader = parseBlockScalarHeader(rawValue);
      if (blockHeader) {
        const contentIndent = getBlockScalarContentIndent(
          lines,
          lineIndex + 1,
          rootIndent,
          blockHeader
        );
        const blockLines = [];
        while (lineIndex + 1 < lines.length) {
          const nextLine = lines[lineIndex + 1];
          const nextIndent = countLeadingYamlSpaces(nextLine);
          if (!isBlankBlockScalarLine(nextLine) && nextIndent < contentIndent.value)
            break;
          blockLines.push(lines[++lineIndex]);
        }
        metadata[key] = readBlockScalar(blockLines, blockHeader, contentIndent);
        continue;
      }
      metadata[key] = stripOptionalQuotes(rawValue);
    } else {
    }
    let scanFrom = 0;
    if (flowDepth === 0) {
      const colonIndex = line.indexOf(":");
      const valueStart = colonIndex === -1 ? -1 : line.slice(colonIndex + 1).search(/\S/);
      if (colonIndex !== -1 && valueStart !== -1) {
        const firstValueChar = line[colonIndex + 1 + valueStart];
        if (firstValueChar === "{" || firstValueChar === "[") {
          scanFrom = colonIndex + 1 + valueStart;
        }
      }
      if (scanFrom === 0) continue;
    }
    for (let i = scanFrom; i < line.length; i++) {
      const char = line[i];
      if (quote) {
        if (quote === '"' && char === "\\") {
          i++;
          continue;
        }
        if (char === quote) {
          if (quote === "'" && line[i + 1] === "'") {
            i++;
            continue;
          }
          quote = null;
        }
        continue;
      }
      if (char === '"' || char === "'") {
        quote = char;
        continue;
      }
      if (char === "#" && (i === 0 || line[i - 1] === " " || line[i - 1] === "	")) {
        break;
      }
      if (char === "{" || char === "[") {
        flowDepth++;
      } else if ((char === "}" || char === "]") && flowDepth > 0) {
        flowDepth--;
      }
    }
  }
  return { metadata, body };
}
function parseFrontmatterAliases(rawAliases) {
  return parseFrontmatterList(rawAliases);
}
function splitFlowSequenceItems(inner) {
  const items = [];
  let current = "";
  let quote = null;
  for (let i = 0; i < inner.length; i++) {
    const char = inner[i];
    if (quote) {
      current += char;
      if (quote === '"' && char === "\\" && i + 1 < inner.length) {
        current += inner[++i];
      } else if (quote === "'" && char === "'" && inner[i + 1] === "'") {
        current += inner[++i];
      } else if (char === quote) {
        quote = null;
      }
    } else if ((char === '"' || char === "'") && current.trim() === "") {
      quote = char;
      current += char;
    } else if (char === ",") {
      items.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  items.push(current);
  return items;
}
function parseFrontmatterList(rawValue) {
  if (!rawValue) return [];
  const trimmed = rawValue.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    const inner = trimmed.slice(1, -1).trim();
    if (!inner) return [];
    return splitFlowSequenceItems(inner).map((item) => stripOptionalQuotes(item)).filter((item) => item.length > 0);
  }
  const singleValue = stripOptionalQuotes(trimmed);
  return singleValue ? [singleValue] : [];
}

// src/config/builtin-skill-entitlements.json
var builtin_skill_entitlements_default = {
  schemaVersion: 1,
  skininthegamebrosOnlySkills: []
};

// src/features/builtin-skills/registry.ts
var import_meta = {};
function getPackageDir() {
  if (typeof __dirname !== "undefined" && __dirname) {
    const currentDirName = (0, import_node_path.basename)(__dirname);
    const parentDirName = (0, import_node_path.basename)((0, import_node_path.dirname)(__dirname));
    const grandparentDirName = (0, import_node_path.basename)((0, import_node_path.dirname)((0, import_node_path.dirname)(__dirname)));
    if (currentDirName === "bridge") {
      return (0, import_node_path.join)(__dirname, "..");
    }
    if (currentDirName === "builtin-skills" && parentDirName === "features" && (grandparentDirName === "src" || grandparentDirName === "dist")) {
      return (0, import_node_path.join)(__dirname, "..", "..", "..");
    }
  }
  try {
    const __filename2 = (0, import_node_url.fileURLToPath)(import_meta.url);
    const __dirname2 = (0, import_node_path.dirname)(__filename2);
    return (0, import_node_path.join)(__dirname2, "..", "..", "..");
  } catch {
    return process.cwd();
  }
}
var SKILLS_DIR = (0, import_node_path.join)(getPackageDir(), "skills");
var CC_NATIVE_COMMANDS = /* @__PURE__ */ new Set([
  "review",
  "plan",
  "security-review",
  "init",
  "doctor",
  "help",
  "config",
  "clear",
  "compact",
  "memory"
]);
var SKININTHEGAMEBROS_ONLY_SKILLS = new Set(
  builtin_skill_entitlements_default.skininthegamebrosOnlySkills.map((skill) => skill.trim().toLowerCase())
);
function toSafeSkillName(name) {
  const normalized = name.trim();
  return CC_NATIVE_COMMANDS.has(normalized.toLowerCase()) ? `omc-${normalized}` : normalized;
}
function getBuiltinSkillIdentifiers(metadata, skillName) {
  const primaryName = toSafeSkillName(metadata.name || skillName);
  const aliases = Array.from(new Set(
    parseFrontmatterAliases(metadata.aliases).map(toSafeSkillName).filter(
      (alias) => alias.length > 0 && alias.toLowerCase() !== primaryName.toLowerCase()
    )
  ));
  return { primaryName, aliases };
}
function loadBuiltinSkillRegistrations(skillsDirectories, readText, listDirectories, userType) {
  const registrations = [];
  const seenNames = /* @__PURE__ */ new Set();
  for (const skillsDirectory of skillsDirectories) {
    const skillNames = [...listDirectories(skillsDirectory)].sort((a, b) => {
      if (a === "skillify") return -1;
      if (b === "skillify") return 1;
      return a.localeCompare(b);
    });
    for (const skillName of skillNames) {
      if (SKININTHEGAMEBROS_ONLY_SKILLS.has(skillName.toLowerCase()) && userType !== "ant") continue;
      const skillPath = (0, import_node_path.join)(skillsDirectory, skillName, "SKILL.md");
      const content = readText(skillPath);
      if (content === null) continue;
      const { metadata } = parseFrontmatter(content);
      const { primaryName, aliases } = getBuiltinSkillIdentifiers(metadata, skillName);
      const registeredNames = [primaryName, ...aliases].filter((name) => {
        const key = name.toLowerCase();
        if (seenNames.has(key)) return false;
        seenNames.add(key);
        return true;
      });
      registrations.push({
        skillPath,
        skillName,
        content,
        primaryName,
        registeredNames
      });
    }
  }
  return registrations;
}
function getSkillsDir() {
  return SKILLS_DIR;
}

// src/hooks/pre-tool-enforcer/snapshot.ts
init_jsonc();

// scripts/lib/read-budget-preflight.mjs
var import_fs2 = require("fs");
var import_path3 = require("path");
var READ_BUDGET_STATE_FILENAME = "read-budget-warnings.json";
var READ_BUDGET_WARNING_RETENTION_SECONDS = 6 * 3600;
var DEFAULT_MAX_LINES = 1500;
var DEFAULT_MAX_BYTES = 45e3;
var DEFAULT_MODE = "warn-then-deny";
var HUGE_FILE_BYTES = 5 * 1024 * 1024;
var READ_TOOL_NAMES = /* @__PURE__ */ new Set(["Read", "View"]);
var BINARY_SNIFF_BYTES = 8 * 1024;
var BINARY_EXTENSIONS = /* @__PURE__ */ new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".bmp",
  ".ico",
  ".tiff",
  ".tif",
  ".webp",
  ".avif",
  ".heic",
  ".pdf",
  ".psd",
  ".ai",
  ".sketch",
  ".mp3",
  ".wav",
  ".flac",
  ".ogg",
  ".m4a",
  ".aac",
  ".mp4",
  ".mov",
  ".avi",
  ".mkv",
  ".webm",
  ".wmv",
  ".zip",
  ".gz",
  ".tgz",
  ".bz2",
  ".xz",
  ".7z",
  ".rar",
  ".tar",
  ".jar",
  ".war",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".bin",
  ".o",
  ".a",
  ".obj",
  ".class",
  ".wasm",
  ".node",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".eot",
  ".db",
  ".sqlite",
  ".sqlite3",
  ".mdb",
  ".pyc",
  ".pyo",
  ".dat",
  ".iso",
  ".dmg",
  ".pkg",
  ".deb",
  ".rpm"
]);
function parsePositiveDecimalInteger(value) {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}
function resolveMaxLines(cfg, env) {
  const fromEnv = parsePositiveDecimalInteger(env.OMC_READ_BUDGET_MAX_LINES);
  if (fromEnv !== null) return fromEnv;
  if (Number.isFinite(cfg?.maxLines) && cfg.maxLines > 0) return cfg.maxLines;
  return DEFAULT_MAX_LINES;
}
function resolveMaxBytes(cfg, env) {
  const fromEnv = parsePositiveDecimalInteger(env.OMC_READ_BUDGET_MAX_BYTES);
  if (fromEnv !== null) return fromEnv;
  if (Number.isFinite(cfg?.maxBytes) && cfg.maxBytes > 0) return cfg.maxBytes;
  return DEFAULT_MAX_BYTES;
}
function resolveMode(cfg) {
  const mode = typeof cfg?.mode === "string" ? cfg.mode.trim() : "";
  return mode === "deny" || mode === "warn" ? mode : DEFAULT_MODE;
}
function globToRegExp(pattern) {
  let out = "";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "*") {
      if (pattern[i + 1] === "*") {
        out += ".*";
        i++;
        if (pattern[i + 1] === "/") i++;
      } else {
        out += "[^/]*";
      }
      continue;
    }
    if (ch === "?") {
      out += "[^/]";
      continue;
    }
    out += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${out}$`);
}
function isAllowlisted(cfg, absolutePath, cwd) {
  const patterns = Array.isArray(cfg?.allowPaths) ? cfg.allowPaths : [];
  if (patterns.length === 0) return false;
  const rel = (0, import_path3.relative)(cwd, absolutePath).split("\\").join("/");
  const abs = absolutePath.split("\\").join("/");
  for (const pattern of patterns) {
    if (typeof pattern !== "string" || !pattern.trim()) continue;
    let re;
    try {
      re = globToRegExp(pattern.trim().split("\\").join("/"));
    } catch {
      continue;
    }
    if (re.test(rel) || re.test(abs)) return true;
  }
  return false;
}
function hasTargetedRange(toolInput) {
  for (const key of ["offset", "limit", "startLine", "endLine", "start_line", "end_line"]) {
    const value = toolInput?.[key];
    if (typeof value === "number" && Number.isFinite(value)) return true;
    if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return true;
  }
  const viewRange = toolInput?.view_range ?? toolInput?.viewRange;
  if (Array.isArray(viewRange) && viewRange.length === 2 && Number.isInteger(viewRange[0]) && viewRange[0] >= 1 && Number.isInteger(viewRange[1]) && (viewRange[1] >= viewRange[0] || viewRange[1] === -1 && viewRange[0] > 1)) return true;
  const pages = toolInput?.pages;
  if (Array.isArray(pages) && pages.length > 0) return true;
  if (typeof pages === "number" && Number.isFinite(pages)) return true;
  if (typeof pages === "string" && pages.trim() !== "") return true;
  return false;
}
function extractReadPath(toolInput) {
  for (const key of ["file_path", "filePath", "path", "file"]) {
    const value = toolInput?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}
function extractBareCatPath(command) {
  if (typeof command !== "string") return null;
  const trimmed = command.trim();
  if (!trimmed || /[|><;&`]|\$\(/.test(trimmed)) return null;
  const match = /^cat\s+(?!-)(\S+)$/.exec(trimmed);
  if (!match) return null;
  const candidate = match[1].replace(/^['"]|['"]$/g, "");
  return candidate || null;
}
function looksBinary(absolutePath) {
  if (BINARY_EXTENSIONS.has((0, import_path3.extname)(absolutePath).toLowerCase())) return true;
  let fd;
  try {
    fd = (0, import_fs2.openSync)(absolutePath, "r");
    const buffer = Buffer.allocUnsafe(BINARY_SNIFF_BYTES);
    const read = (0, import_fs2.readSync)(fd, buffer, 0, BINARY_SNIFF_BYTES, 0);
    for (let i = 0; i < read; i++) {
      if (buffer[i] === 0) return true;
    }
    return false;
  } catch {
    return true;
  } finally {
    if (fd !== void 0) {
      try {
        (0, import_fs2.closeSync)(fd);
      } catch {
      }
    }
  }
}
function countLines(absolutePath, byteSize) {
  if (byteSize > HUGE_FILE_BYTES) return Number.POSITIVE_INFINITY;
  const content = (0, import_fs2.readFileSync)(absolutePath, "utf-8");
  if (content === "") return 0;
  let lines = 1;
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) === 10) lines++;
  }
  if (content.charCodeAt(content.length - 1) === 10) lines--;
  return lines;
}
function measure(absolutePath, maxLines, maxBytes) {
  const stats = (0, import_fs2.statSync)(absolutePath);
  if (!stats.isFile()) return null;
  if (looksBinary(absolutePath)) return null;
  const byteSize = stats.size;
  if (byteSize > maxBytes) {
    return { over: true, lineCount: Number.NaN, byteSize, trigger: "bytes" };
  }
  const lineCount = countLines(absolutePath, byteSize);
  if (lineCount > maxLines) return { over: true, lineCount, byteSize, trigger: "lines" };
  return { over: false, lineCount, byteSize, trigger: "lines" };
}
function pruneReadBudgetWarnings(warned, referenceSec) {
  const cutoff = referenceSec - READ_BUDGET_WARNING_RETENTION_SECONDS;
  return Object.fromEntries(Object.entries(warned ?? {}).filter(
    ([, ts]) => typeof ts === "number" && Number.isFinite(ts) && ts > cutoff
  ));
}
function describeSize(measurement, maxLines, maxBytes) {
  if (measurement.trigger === "bytes") {
    return `${measurement.byteSize} bytes (budget ${maxBytes})`;
  }
  if (!Number.isFinite(measurement.lineCount)) {
    return `over 5 MB (line budget ${maxLines})`;
  }
  return `${measurement.lineCount} lines (budget ${maxLines})`;
}
function remedy(displayPath) {
  return `Re-read \`${displayPath}\` with \`offset\`/\`limit\` for the range you need, delegate the sweep to a subagent, or use \`ast_grep_search\`/\`lsp_document_symbols\` when a structural view is what you are after.`;
}
function warnReason(displayPath, measurement, maxLines, maxBytes) {
  return `[OMC READ BUDGET] \`${displayPath}\` is ${describeSize(measurement, maxLines, maxBytes)}. This full read is allowed once. ${remedy(displayPath)} Read caps its own output at 25,000 tokens, so a full read of a file this size returns a partial view that still reads like a complete answer. Further full reads of this file are denied \u2014 off switch: \`OMC_READ_BUDGET=off\`.`;
}
function denyReason(displayPath, measurement, maxLines, maxBytes) {
  return `[OMC READ BUDGET] Denied: \`${displayPath}\` is ${describeSize(measurement, maxLines, maxBytes)} and this call has no \`offset\`/\`limit\`. ${remedy(displayPath)} Allowlist verbatim-value paths via \`context.readBudget.allowPaths\`, raise \`context.readBudget.maxLines\`/\`context.readBudget.maxBytes\`, or disable with \`OMC_READ_BUDGET=off\`.`;
}
function prepareReadBudget({
  toolName,
  toolInput,
  env,
  config,
  cwd
} = {}) {
  if (!toolName) return null;
  if ((env?.OMC_READ_BUDGET || "").trim().toLowerCase() === "off") return null;
  const cfg = config?.context?.readBudget;
  if (cfg && cfg.enabled === false) return null;
  const input = toolInput && typeof toolInput === "object" ? toolInput : {};
  let rawPath = null;
  if (READ_TOOL_NAMES.has(toolName)) {
    if (hasTargetedRange(input)) return null;
    rawPath = extractReadPath(input);
  } else if (toolName === "Bash") {
    rawPath = extractBareCatPath(input.command);
  }
  if (!rawPath) return null;
  const absolutePath = (0, import_path3.isAbsolute)(rawPath) ? (0, import_path3.resolve)(rawPath) : (0, import_path3.resolve)(cwd, rawPath);
  if (isAllowlisted(cfg, absolutePath, cwd)) return null;
  return {
    path: absolutePath,
    displayPath: (0, import_path3.relative)(cwd, absolutePath).split("\\").join("/") || rawPath,
    maxLines: resolveMaxLines(cfg, env ?? {}),
    maxBytes: resolveMaxBytes(cfg, env ?? {}),
    mode: resolveMode(cfg)
  };
}
function measureReadBudget(candidate) {
  try {
    if (!(0, import_fs2.existsSync)(candidate.path)) return null;
    return measure(candidate.path, candidate.maxLines, candidate.maxBytes);
  } catch {
    return null;
  }
}
function evaluateReadBudgetObservation(candidate, measurement, warned) {
  if (!measurement || !measurement.over) return null;
  const { path: path3, displayPath, maxLines, maxBytes, mode } = candidate;
  const base = {
    path: path3,
    lineCount: measurement.lineCount,
    byteSize: measurement.byteSize,
    trigger: measurement.trigger
  };
  const warn = { decision: "warn", reason: warnReason(displayPath, measurement, maxLines, maxBytes), ...base };
  const block = { decision: "block", reason: denyReason(displayPath, measurement, maxLines, maxBytes), ...base };
  if (mode === "warn") return warn;
  if (mode === "deny") return block;
  return warned ? block : warn;
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
  if (value === void 0) return fallback;
  const normalized = value.trim();
  if (!/^[+-]?\d+$/.test(normalized)) return fallback;
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed)) return fallback;
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
  if (!configured) return (0, import_node_path2.join)(home, ".claude");
  if (configured === "~") return home;
  if (configured.startsWith("~/") || configured.startsWith("~\\")) {
    return (0, import_node_path2.join)(home, configured.slice(2));
  }
  return configured;
}
function resolveUserConfigDirectory(environment) {
  const home = resolveHome(environment);
  if (process.platform === "win32") {
    return stringValue(environment.APPDATA) || (0, import_node_path2.join)(home, "AppData", "Roaming");
  }
  return stringValue(environment.XDG_CONFIG_HOME) || (0, import_node_path2.join)(home, ".config");
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
function loadSkillAgentTypes(envelope, directory, environment, readText, listDirectories, fileExists, runtimePluginRoot) {
  const agentTypes = [...new Set(envelope.toolCalls.filter(
    (call) => call.canonicalName === "Task" || call.canonicalName === "Agent"
  ).map((call) => getAgentType(call.input)).filter(Boolean))];
  if (agentTypes.length === 0) return {};
  const pluginRoots = [...new Set([
    stringValue(environment.CLAUDE_PLUGIN_ROOT),
    runtimePluginRoot ?? "",
    (0, import_node_path2.dirname)(getSkillsDir())
  ].filter(Boolean))];
  const registrations = loadBuiltinSkillRegistrations(
    pluginRoots.map((root) => (0, import_node_path2.join)(root, "skills")),
    readText,
    listDirectories,
    environment.USER_TYPE
  );
  const names = /* @__PURE__ */ new Map();
  const directoryNames = /* @__PURE__ */ new Map();
  for (const registration of registrations) {
    for (const name of registration.registeredNames) {
      names.set(name.toLowerCase(), registration.primaryName);
    }
    const key = registration.skillName.toLowerCase();
    if (!directoryNames.has(key)) {
      directoryNames.set(key, registration.primaryName);
    }
  }
  const pluginAgentDirectories = pluginRoots.flatMap(
    (root) => envelope.host === "copilot" ? [(0, import_node_path2.join)(root, "agents-copilot"), (0, import_node_path2.join)(root, "agents")] : [(0, import_node_path2.join)(root, "agents")]
  );
  const nativeAgentDirectories = envelope.host === "copilot" ? [
    (0, import_node_path2.join)(directory, ".github", "agents"),
    (0, import_node_path2.join)(directory, ".copilot", "agents"),
    (0, import_node_path2.join)(resolveHome(environment), ".copilot", "agents")
  ] : [
    (0, import_node_path2.join)(directory, ".claude", "agents"),
    (0, import_node_path2.join)(resolveClaudeConfigDirectory(environment), "agents")
  ];
  return Object.fromEntries(agentTypes.flatMap((agentType) => {
    const namespaced = /^(?:oh-my-claudecode|omc):/i.test(agentType);
    const name = agentType.replace(/^(?:oh-my-claudecode|omc):/i, "").toLowerCase();
    if (!/^[a-z0-9_-]+$/.test(name)) return [];
    const agentDirectories = [
      ...pluginAgentDirectories,
      ...namespaced ? [] : nativeAgentDirectories
    ];
    if (agentDirectories.some(
      (path3) => fileExists((0, import_node_path2.join)(path3, `${name}.md`)) || fileExists((0, import_node_path2.join)(path3, `${name}.agent.md`))
    )) return [];
    const primary = names.get(name) ?? (namespaced ? directoryNames.get(name) : void 0);
    return primary ? [[agentType, primary]] : [];
  }));
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
function readAgentDefinitionModel(agentType, host, environment, currentDirectory, readText, runtimePluginRoot) {
  const canonical = normalizeAgentType(agentType);
  if (!/^[a-zA-Z0-9_-]+$/.test(canonical)) return null;
  const pluginRoot = stringValue(environment.CLAUDE_PLUGIN_ROOT);
  const candidateRoots = [
    ...pluginRoot ? [pluginRoot] : [],
    ...host === "copilot" && runtimePluginRoot ? [runtimePluginRoot] : [],
    currentDirectory
  ];
  for (const root of candidateRoots) {
    const definitionPath = host === "copilot" ? (0, import_node_path2.join)(root, "agents-copilot", `${canonical}.agent.md`) : (0, import_node_path2.join)(root, "agents", `${canonical}.md`);
    const content = readText(definitionPath);
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
function readTracking(directory, stateDir, sessionId, readJson2, resolvePaths) {
  const paths = resolvePaths(
    "subagent-tracking",
    SESSION_ID_PATTERN.test(sessionId) ? sessionId : void 0,
    directory
  );
  for (const path3 of [
    paths.sessionScoped,
    paths.legacy,
    (0, import_node_path2.join)(stateDir, "subagent-tracking.json")
  ].filter(Boolean)) {
    const state = asRecord(readJson2(path3));
    if (!state || !Array.isArray(state.agents)) continue;
    if (state.total_spawned !== void 0 && (typeof state.total_spawned !== "number" || !Number.isSafeInteger(state.total_spawned) || state.total_spawned < 0)) continue;
    const owner = stringValue(state.session_id) || stringValue(asRecord(state._meta)?.sessionId);
    if (sessionId && owner && owner !== sessionId) continue;
    return extractTracking(state);
  }
  return { running: 0, total: 0 };
}
function loadReadBudgetSnapshot(envelope, directory, stateDir, environment, config, observedAtSec, readJson2, measure2, disabled) {
  const statePath = (0, import_node_path2.join)(stateDir, READ_BUDGET_STATE_FILENAME);
  if (disabled) return { statePath, warnings: {}, observations: {} };
  const observations = {};
  const measurements = /* @__PURE__ */ new Map();
  for (const call of envelope.toolCalls) {
    if (call.malformed) continue;
    const candidate = prepareReadBudget({
      toolName: call.canonicalName,
      toolInput: call.input,
      env: environment,
      config,
      cwd: directory
    });
    if (!candidate) continue;
    const key = `${candidate.path}\0${candidate.maxLines}\0${candidate.maxBytes}`;
    if (!measurements.has(key)) {
      measurements.set(key, cloneObservation(measure2(candidate)));
    }
    const measurement = measurements.get(key);
    if (measurement) observations[call.id] = { candidate, measurement };
  }
  if (Object.keys(observations).length === 0) {
    return { statePath, warnings: {}, observations };
  }
  const stored = asRecord(readJson2(statePath));
  const intentIds = asRecord(stored?.intentIds);
  const warned = pruneReadBudgetWarnings(
    asRecord(stored?.warned) ?? {},
    observedAtSec
  );
  const warnings = Object.fromEntries(Object.entries(warned).filter(
    ([, timestamp]) => Number.isSafeInteger(timestamp) && timestamp >= Math.floor(PRE_TOOL_MIN_EPOCH_MS / 1e3) && timestamp <= observedAtSec + Math.floor(PRE_TOOL_MAX_FUTURE_SKEW_MS / 1e3)
  ).map(([path3, warnedAtSec]) => [
    path3,
    {
      warnedAtSec,
      ...typeof intentIds?.[path3] === "string" ? { intentId: intentIds[path3] } : {}
    }
  ]));
  return { statePath, warnings, observations };
}
function sessionStatePath(stateDir, sessionId, fileName) {
  return SESSION_ID_PATTERN.test(sessionId) ? (0, import_node_path2.join)(stateDir, "sessions", sessionId, fileName) : null;
}
function readOwnedState(stateDir, sessionId, fileName, readJson2, allowLegacyFallback = false) {
  if (sessionId && !SESSION_ID_PATTERN.test(sessionId)) {
    return { path: "", state: null };
  }
  const sessionPath = sessionStatePath(stateDir, sessionId, fileName);
  const legacyPath = (0, import_node_path2.join)(stateDir, fileName);
  const paths = sessionPath ? [
    sessionPath,
    ...allowLegacyFallback ? [legacyPath] : []
  ] : [legacyPath];
  for (const path3 of paths) {
    const state = asRecord(readJson2(path3));
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
function readCanonicalTeam(stateDir, sessionId, readJson2, listDirectories) {
  if (!SESSION_ID_PATTERN.test(sessionId)) return { active: false };
  const teamRoot = (0, import_node_path2.join)(stateDir, "team");
  for (const teamName of listDirectories(teamRoot)) {
    const manifest = asRecord(readJson2((0, import_node_path2.join)(teamRoot, teamName, "manifest.json")));
    const phase = asRecord(readJson2((0, import_node_path2.join)(teamRoot, teamName, "phase-state.json")));
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
  if (transcript === null || !transcriptPath || !sessionId || (0, import_node_path2.basename)(transcriptPath).replace(/\.jsonl$/i, "") !== sessionId) {
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
  const readJson2 = (path3) => {
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
  const disabled = environment.DISABLE_OMC === "1" || (environment.OMC_SKIP_HOOKS ?? "").split(",").map((value) => value.trim()).includes("pre-tool-use");
  const runtimeDirectory = currentDirectory();
  const directory = envelope.directory || runtimeDirectory;
  const omcRoot = resolveOmcRoot(directory);
  const stateDir = (0, import_node_path2.join)(omcRoot, "state");
  const sessionId = envelope.sessionId ?? "";
  const deliveryId = deliveryIdForEnvelope(envelope, createDeliveryNonce);
  const userOmcConfigPath = (0, import_node_path2.join)(
    resolveClaudeConfigDirectory(environment),
    ".omc-config.json"
  );
  const projectOmcConfigPath = (0, import_node_path2.join)(omcRoot, "config.json");
  const globalOmcConfig = asRecord(readJson2(userOmcConfigPath));
  const projectOmcConfig = asRecord(readJson2(projectOmcConfigPath));
  const omcConfig = globalOmcConfig ?? projectOmcConfig ?? {};
  const readBudgetConfig = {
    context: {
      readBudget: {
        ...asRecord(asRecord(globalOmcConfig?.context)?.readBudget) ?? {},
        ...asRecord(asRecord(projectOmcConfig?.context)?.readBudget) ?? {}
      }
    }
  };
  const userConfig = loadJsoncRecord(
    (0, import_node_path2.join)(
      resolveUserConfigDirectory(environment),
      "claude-omc",
      "config.jsonc"
    ),
    readText
  );
  const projectConfig = loadJsoncRecord(
    (0, import_node_path2.join)(directory, ".claude", "omc.jsonc"),
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
        envelope.host,
        environment,
        runtimeDirectory,
        readText,
        dependencies.pluginRoot
      )
    ])
  );
  const configuredCopilotModel = stringValue(environment.OMC_EXTERNAL_MODELS_DEFAULT_COPILOT_MODEL) || stringValue(environment.OMC_COPILOT_DEFAULT_MODEL) || resolveConfiguredCopilotDefault(
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
    model: configuredCopilotModel || COPILOT_DEFAULT_MODEL,
    modelOverride: configuredCopilotModel,
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
        readJson2,
        fileName === "ultragoal-state.json" || fileName === "team-state.json"
      )
    ])
  );
  const invalidSessionId = sessionId.length > 0 && !SESSION_ID_PATTERN.test(sessionId);
  const swarmSummaryPath = sessionStatePath(
    stateDir,
    sessionId,
    "swarm-summary.json"
  ) ?? (invalidSessionId ? null : (0, import_node_path2.join)(stateDir, "swarm-summary.json"));
  const swarmMarkerPath = sessionStatePath(
    stateDir,
    sessionId,
    "swarm-active.marker"
  ) ?? (invalidSessionId ? null : (0, import_node_path2.join)(stateDir, "swarm-active.marker"));
  const swarmSummary = swarmSummaryPath ? asRecord(readJson2(swarmSummaryPath)) : null;
  const modeActive = Object.values(modeStates).some(
    (candidate) => hasActiveModeState(candidate.state)
  ) || swarmMarkerPath !== null && fileExists(swarmMarkerPath) && swarmSummary?.active === true;
  const coarseTeamState = modeStates.team?.state ?? null;
  const canonicalTeam = readCanonicalTeam(
    stateDir,
    sessionId,
    readJson2,
    listDirectories
  );
  const team = coarseTeamState?.active === true ? {
    active: true,
    teamName: stringValue(coarseTeamState.team_name) || stringValue(coarseTeamState.teamName) || "team"
  } : canonicalTeam;
  const todoCounts = extractTodoCounts([
    readJson2((0, import_node_path2.join)(omcRoot, "todos.json")),
    readJson2((0, import_node_path2.join)(directory, ".claude", "todos.json"))
  ]);
  const todoLabel = todoCounts.pending + todoCounts.inProgress > 0 ? `[${todoCounts.inProgress} active, ${todoCounts.pending} pending] ` : "";
  const tracking = readTracking(
    directory,
    stateDir,
    sessionId,
    readJson2,
    dependencies.resolveSessionStatePaths ?? resolveSessionStatePaths
  );
  const transcriptPath = envelope.transcriptPath;
  const transcriptTail = transcriptPath ? readTextTail(transcriptPath, TRANSCRIPT_TAIL_BYTES) ?? "" : "";
  const needsTranscriptGoal = !!transcriptPath && !envelope.eventPayload.goal && !!sessionId && (0, import_node_path2.basename)(transcriptPath).replace(/\.jsonl$/i, "") === sessionId;
  const transcriptContent = needsTranscriptGoal ? readText(transcriptPath, MAX_TRANSCRIPT_BYTES) : null;
  const transcriptGoal = envelope.eventPayload.goal ? cloneObservation(envelope.eventPayload.goal) : extractGoalFromTranscript(transcriptContent, transcriptPath, sessionId);
  const contextThreshold = numberFromEnvironment(
    environment.OMC_AGENT_PREFLIGHT_CONTEXT_THRESHOLD,
    DEFAULT_CONTEXT_THRESHOLD,
    1,
    100
  );
  const ultragoalState = modeStates.ultragoal?.state ?? null;
  const ultragoalPlan = asRecord(readJson2((0, import_node_path2.join)(omcRoot, "ultragoal", "goals.json"))) ?? asRecord(readJson2((0, import_node_path2.join)(directory, ".omc", "ultragoal", "goals.json")));
  const forceDelegation = parseForceDelegationConfig(omcConfig);
  const forceDelegationState2 = asRecord(
    readJson2((0, import_node_path2.join)(stateDir, "force-agent-delegation-events.json"))
  );
  const forceDelegationGeneration = typeof forceDelegationState2?.generation === "number" && Number.isSafeInteger(forceDelegationState2.generation) && forceDelegationState2.generation >= 0 ? forceDelegationState2.generation : 0;
  const forceDelegationLedger = {
    generation: forceDelegationGeneration,
    events: parseForceDelegationEvents(
      forceDelegationState2,
      observedAtSec
    )
  };
  const advisoryPath2 = sessionId && !SESSION_ID_PATTERN.test(sessionId) ? "" : SESSION_ID_PATTERN.test(sessionId) ? (0, import_node_path2.join)(
    stateDir,
    "sessions",
    sessionId,
    "pre-tool-advisory-throttle.json"
  ) : (0, import_node_path2.join)(stateDir, "pre-tool-advisory-throttle.json");
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
    disabled,
    quietLevel: numberFromEnvironment(environment.OMC_QUIET, 0, 0),
    todo: {
      ...todoCounts,
      label: todoLabel
    },
    tracking,
    readBudget: loadReadBudgetSnapshot(
      envelope,
      directory,
      stateDir,
      environment,
      readBudgetConfig,
      observedAtSec,
      readJson2,
      dependencies.measureReadBudget ?? measureReadBudget,
      disabled
    ),
    team,
    modeActive,
    modeStates,
    omcConfig,
    skillAgentTypes: loadSkillAgentTypes(
      envelope,
      directory,
      environment,
      readText,
      listDirectories,
      fileExists,
      dependencies.pluginRoot
    ),
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
      entries: advisoryPath2 ? parseAdvisoryEntries(readJson2(advisoryPath2), advisoryNowMs) : {}
    }
  };
  return deepFreeze(snapshot);
}

// src/hooks/pre-tool-enforcer/evaluate.ts
var import_node_crypto2 = require("node:crypto");
var import_node_path3 = require("node:path");
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
var JEV_MODEL_TIERS = /* @__PURE__ */ new Set([
  "haiku",
  "sonnet",
  "opus",
  "fable"
]);
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
var SLOP_WARNING_MESSAGE = "[SLOP WARNING] Detected fallback/workaround language in this tool input. Do not make potential slop: avoid ad-hoc fallback layers, workaround shims, or environment-specific patches unless explicitly justified. For architecture concerns, consult the architect for a concrete design first. If this seems environment-specific, ask the user to confirm constraints before proceeding.";
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
      const canonicalAgent = normalizeAgentType2(agentType);
      const configuredModel = snapshot.modelRouting.configuredAgentModels[canonicalAgent];
      const defaults = snapshot.modelRouting.copilotDefaults;
      const model = configuredModel !== "inherit" ? configuredModel || defaults.modelOverride || snapshot.modelRouting.agentDefinitionModels[canonicalAgent] || defaults.model : defaults.model;
      updatedInput.model = model;
      patch.model = model;
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
function asJevModelTier(model) {
  return model === "haiku" || model === "sonnet" || model === "opus" || model === "fable" ? model : null;
}
function modelRoutingJevObservation(call, snapshot, evaluation) {
  if (evaluation.denyReason || !AGENT_HEAVY_TOOLS.has(call.canonicalName) || !isRecord4(call.input)) {
    return void 0;
  }
  const originalInput = call.input;
  const modifiedInput = evaluation.updatedInput ?? originalInput;
  let selectedModel = nonEmptyString(modifiedInput.model);
  if (!selectedModel) {
    const agentType = getAgentType2(originalInput);
    if (agentType) {
      selectedModel = snapshot.modelRouting.agentDefinitionModels[normalizeAgentType2(agentType)] ?? "";
    }
  }
  const normalized = isTierAlias(selectedModel) ? selectedModel.toLowerCase() : normalizeToCcAlias(selectedModel);
  const model = asJevModelTier(normalized);
  if (!model) return void 0;
  return {
    originalInput,
    modifiedInput,
    injected: evaluation.updatedInput !== void 0,
    model
  };
}
function applyJevModelRoutingOverride(call, envelope, snapshot, evaluation, observation, overrides) {
  const override = overrides[call.id];
  if (envelope.host !== "claude" || evaluation.denyReason || !AGENT_HEAVY_TOOLS.has(call.canonicalName) || !override || !isRecord4(call.input)) {
    return evaluation;
  }
  const patch = typeof override === "string" ? { model: override } : override;
  if (typeof override === "string" && !observation) return evaluation;
  const updatedInput = evaluation.updatedInput ?? call.input;
  const nextInput = { ...updatedInput };
  if (patch.model && JEV_MODEL_TIERS.has(patch.model) && (!snapshot.modelRouting.forceInherit || resolveTierAliasToSafeModel(patch.model, snapshot))) {
    nextInput.model = patch.model;
  }
  if (typeof patch.effort === "string") nextInput.effort = patch.effort;
  if (typeof patch.prompt === "string") nextInput.prompt = patch.prompt;
  if (Object.keys(nextInput).every((key) => nextInput[key] === updatedInput[key])) return evaluation;
  return {
    ...evaluation,
    updatedInput: nextInput
  };
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
  if (projectPath && (0, import_node_path3.resolve)(projectPath) !== (0, import_node_path3.resolve)(snapshot.directory)) {
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
  if (!SLOP_RISK_TOOL_NAMES.has(call.canonicalName)) {
    return { warned: false, message: "" };
  }
  const promptValues = [
    ...envelope.eventPayload.promptAliases ?? [],
    envelope.eventPayload.message
  ];
  const inspectedText = [
    ...collectStringValues(call.input),
    ...collectStringValues(promptValues)
  ].join("\n");
  if (!SLOP_FALLBACK_LANGUAGE_PATTERN.test(inspectedText)) {
    return { warned: false, message: "" };
  }
  const paths = collectLikelyPathValues(call.input);
  if (paths.some((value) => SLOP_SELF_REFERENCE_PATH_PATTERN.test(value))) {
    return { warned: false, message: "" };
  }
  if (paths.some((value) => SLOP_DOC_CONTEXT_PATTERN.test(value))) {
    return { warned: false, message: "" };
  }
  const hasAction = stripSlopQuotedAndCodeContexts(inspectedText).split(/[\r\n!?;]+/).map((segment) => segment.trim()).filter(Boolean).some(
    (segment) => SLOP_FALLBACK_ACTION_PATTERNS.some(
      (pattern) => pattern.test(removeBenignSlopSpans(segment))
    )
  );
  if (!hasAction) return { warned: false, message: "" };
  return {
    warned: true,
    message: SLOP_WARNING_MESSAGE
  };
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
function deniedCallPlan(call, reason, effects, nextLedger, presentationKind = "hook-deny", mutation, jevObservations) {
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
    nextForceDelegationLedger: nextLedger,
    ...jevObservations ? { jevObservations } : {}
  };
}
function evaluatePreToolCall(call, envelope, snapshot, ledger, readBudgetWarnings = snapshot.readBudget.warnings, modelRoutingOverrides = {}) {
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
  if (AGENT_HEAVY_TOOLS.has(call.canonicalName) && isRecord4(call.input)) {
    const agentType = getAgentType2(call.input);
    const primary = snapshot.skillAgentTypes[agentType];
    if (primary) {
      const name = agentType.replace(/^(?:oh-my-claudecode|omc):/i, "");
      const queriedName = name.toLowerCase() === primary.toLowerCase() ? `"${agentType}"` : `"${agentType}" (alias of "${primary}")`;
      const field = nonEmptyString(call.input.subagent_type) ? "subagent_type" : "agent_type";
      return deniedCallPlan(
        call,
        `[SKILL vs AGENT] ${queriedName} is a Skill, not an agent. Do NOT call it via ${call.canonicalName}(${field}=...) \u2014 that agent type does not exist. Use the Skill tool instead: Skill(skill="oh-my-claudecode:${primary}"). Do NOT substitute a similarly-named agent as a "closest match".`,
        effects,
        ledger
      );
    }
  }
  let readBudgetWarning = "";
  const readObservation = snapshot.readBudget.observations[call.id];
  if (readObservation) {
    const { candidate, measurement } = readObservation;
    const intentId = effectIntentId(
      snapshot,
      call,
      "pretool.read-budget-warning.v1",
      candidate.path
    );
    const previous = readBudgetWarnings[candidate.path];
    const readBudget = evaluateReadBudgetObservation(
      candidate,
      measurement,
      !!previous && previous.warnedAtSec > snapshot.observedAtSec - READ_BUDGET_WARNING_RETENTION_SECONDS && previous.intentId !== intentId
    );
    if (readBudget?.decision === "block") {
      return deniedCallPlan(
        call,
        readBudget.reason,
        effects,
        ledger
      );
    }
    if (readBudget?.decision === "warn") {
      readBudgetWarning = readBudget.reason;
      if (candidate.mode === "warn-then-deny") {
        const payload = {
          version: PRE_TOOL_EFFECT_PAYLOAD_VERSION,
          intentId,
          originalIndex: call.originalIndex,
          stateDir: snapshot.stateDir,
          path: candidate.path,
          observedAtSec: snapshot.observedAtSec
        };
        effects.push(hookEffect(
          call,
          "pretool.read-budget-warning.v1",
          payload,
          "accepted",
          true
        ));
      }
    }
  }
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
  const baseModelRouting = evaluateModelRouting(call, envelope, snapshot);
  if (baseModelRouting.denyReason) {
    return deniedCallPlan(call, baseModelRouting.denyReason, effects, ledger);
  }
  const modelRoutingObservation = modelRoutingJevObservation(
    call,
    snapshot,
    baseModelRouting
  );
  const modelRouting = applyJevModelRoutingOverride(
    call,
    envelope,
    snapshot,
    baseModelRouting,
    modelRoutingObservation,
    modelRoutingOverrides
  );
  const routingObservations = modelRoutingObservation ? { modelRouting: modelRoutingObservation } : void 0;
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
      mutation,
      routingObservations
    );
  }
  if (AGENT_HEAVY_TOOLS.has(call.canonicalName) && snapshot.transcript.contextPercent >= snapshot.transcript.contextThreshold) {
    return deniedCallPlan(
      call,
      buildPreflightReason(snapshot),
      effects,
      forceDelegation.nextLedger,
      "raw-block",
      mutation,
      routingObservations
    );
  }
  const slopWarning = generateSlopWarning(call, envelope);
  const override = modelRoutingOverrides[call.id];
  const effectiveSlopWarning = typeof override === "object" && typeof override.slopWarning === "boolean" ? override.slopWarning : slopWarning.warned;
  const jevObservations = {
    ...routingObservations ?? {},
    slopWarning: slopWarning.warned
  };
  let advisoryCandidate;
  if (!BUILT_IN_TASK_LIST_TOOL_NAMES.has(call.canonicalName)) {
    const effectiveInput = modelRouting.updatedInput ?? (isRecord4(call.input) ? call.input : null);
    const baseMessage = call.canonicalName === "Task" || call.canonicalName === "Agent" ? generateAgentMessage(effectiveInput, snapshot) : generateToolMessage(call.canonicalName, snapshot);
    const message = combineMessages(
      modelRouting.warning,
      effectiveSlopWarning ? SLOP_WARNING_MESSAGE : "",
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
    contexts: readBudgetWarning ? [readBudgetWarning] : [],
    effects
  };
  let legacyPresentation;
  if (advisoryCandidate) {
    legacyPresentation = {
      kind: "context",
      callId: call.id,
      context: combineMessages(readBudgetWarning, advisoryCandidate.message),
      ...modelRouting.updatedInput ? { updatedInput: modelRouting.updatedInput } : {},
      advisoryIntentId: advisoryCandidate.intentId
    };
  } else if (readBudgetWarning) {
    legacyPresentation = {
      kind: "context",
      callId: call.id,
      context: readBudgetWarning,
      ...modelRouting.updatedInput ? { updatedInput: modelRouting.updatedInput } : {}
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
    ...advisoryCandidate ? { advisoryCandidate } : {},
    jevObservations
  };
}
function hasBatchSafetyIssue2(envelope) {
  return envelope.issues.some(
    (issue) => issue.batchSafety === true || issue.scope === "batch" && issue.severity === "safety"
  );
}
function planPreToolBatch(envelope, snapshot, modelRoutingOverrides = {}) {
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
  const readBudgetWarnings = { ...snapshot.readBudget.warnings };
  const seenAdvisoryHashes = /* @__PURE__ */ new Set();
  const calls = [];
  for (const call of [...envelope.toolCalls].filter((candidate) => !candidate.malformed).sort((left, right) => left.originalIndex - right.originalIndex)) {
    let plan = evaluatePreToolCall(
      call,
      envelope,
      snapshot,
      ledger,
      readBudgetWarnings,
      modelRoutingOverrides
    );
    ledger = plan.nextForceDelegationLedger;
    if (plan.evaluation.decision === "pass" || plan.evaluation.decision === "allow") {
      for (const effect of plan.evaluation.effects ?? []) {
        if (effect.type !== "pretool.read-budget-warning.v1") continue;
        const payload = effect.payload;
        if (!isRecord4(payload) || payload.version !== PRE_TOOL_EFFECT_PAYLOAD_VERSION || typeof payload.path !== "string" || typeof payload.observedAtSec !== "number" || typeof payload.intentId !== "string") continue;
        readBudgetWarnings[payload.path] = {
          warnedAtSec: payload.observedAtSec,
          intentId: payload.intentId
        };
      }
    }
    const advisory = plan.advisoryCandidate;
    if (advisory && seenAdvisoryHashes.has(advisory.messageHash)) {
      const effects = (plan.evaluation.effects ?? []).filter(
        (effect) => effect.type !== "pretool.advisory-claim.v1"
      );
      const updatedInput = plan.legacyPresentation.kind === "context" ? plan.legacyPresentation.updatedInput : void 0;
      const unthrottledContext = plan.evaluation.contexts?.join("\n\n");
      plan = {
        ...plan,
        evaluation: {
          ...plan.evaluation,
          effects
        },
        legacyPresentation: unthrottledContext ? {
          kind: "context",
          callId: call.id,
          context: unthrottledContext,
          ...updatedInput ? { updatedInput } : {}
        } : updatedInput ? {
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
var import_node_fs5 = require("node:fs");
var import_node_path8 = require("node:path");
init_atomic_write();
init_mode_state_io();
init_notifications();

// src/hooks/background-notifications.ts
var import_child_process6 = require("child_process");
var import_crypto9 = require("crypto");
var import_fs15 = require("fs");
var import_path19 = require("path");
var SPAWN_ACKNOWLEDGEMENT_TIMEOUT_MS = 500;
var GATE_RELEASE_TIMEOUT_MS = 500;
var BACKGROUND_NOTIFICATION_GATE_TYPE = "omc.notification.dispatch.v1";
function resolveBackgroundNotificationRuntimeContext(pluginRoot) {
  const root = (0, import_path19.resolve)(pluginRoot);
  return {
    childEntrypointPath: (0, import_path19.join)(
      root,
      "scripts",
      "lib",
      "notification-child.cjs"
    ),
    hookRuntimePath: (0, import_path19.join)(root, "bridge", "hook-runtime.cjs")
  };
}
function defaultRuntimeContext() {
  const environmentRoot = process.env.CLAUDE_PLUGIN_ROOT?.trim();
  if (environmentRoot) {
    return resolveBackgroundNotificationRuntimeContext(environmentRoot);
  }
  if (typeof __dirname === "undefined" || !__dirname) return null;
  const root = (0, import_path19.basename)(__dirname) === "bridge" ? (0, import_path19.dirname)(__dirname) : (0, import_path19.resolve)(__dirname, "..", "..");
  return resolveBackgroundNotificationRuntimeContext(root);
}
function isFile(path3) {
  try {
    return (0, import_fs15.existsSync)(path3) && (0, import_fs15.statSync)(path3).isFile();
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
    intentId: (0, import_crypto9.randomUUID)(),
    claimId: (0, import_crypto9.randomUUID)()
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
        cwd: (0, import_path19.dirname)(process.execPath),
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
var import_fs17 = require("fs");
init_atomic_write();
init_mode_state_io();
init_worktree_paths();

// src/hooks/subagent-tracker/index.ts
init_worktree_paths();
init_file_lock();

// src/hooks/subagent-tracker/session-replay.ts
var import_fs16 = require("fs");
var import_path20 = require("path");
init_worktree_paths();
init_atomic_write();
init_mode_state_io();
var REPLAY_PREFIX = "agent-replay-";
var MAX_REPLAY_SIZE_BYTES = 5 * 1024 * 1024;
var sessionStartTimes = /* @__PURE__ */ new Map();
function getReplayFilePath(directory, sessionId) {
  const stateDir = (0, import_path20.join)(getOmcRoot(directory), "state");
  if (!(0, import_fs16.existsSync)(stateDir)) {
    (0, import_fs16.mkdirSync)(stateDir, { recursive: true });
  }
  const safeId = sessionId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return (0, import_path20.join)(stateDir, `${REPLAY_PREFIX}${safeId}.jsonl`);
}
function appendReplayEventOnce(directory, sessionId, intentId, event, observedAtMs = Date.now()) {
  if (!intentId) return { status: "failed" };
  try {
    const filePath = getReplayFilePath(directory, sessionId);
    const locked = withStateFileMutationLock(filePath, () => {
      let lines = [];
      if ((0, import_fs16.existsSync)(filePath)) {
        try {
          if ((0, import_fs16.statSync)(filePath).size > MAX_REPLAY_SIZE_BYTES) {
            return { status: "failed" };
          }
          lines = (0, import_fs16.readFileSync)(filePath, "utf8").split("\n").filter(Boolean);
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
init_worker_canonicalization();

// src/hooks/subagent-tracker/worktree-evidence.ts
var GIT_MAX_BUFFER = 32 * 1024 * 1024;

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
  team: "none",
  "omc-teams": "none",
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
  // === Heavy protection (long-running, 10 reinforcements) ===
  deepinit: "heavy"
};
var RETIRED_SKILL_NAMES = /* @__PURE__ */ new Set(["ultrawork", "ccg"]);
function getSkillProtection(skillName, rawSkillName) {
  if (rawSkillName != null && !rawSkillName.toLowerCase().startsWith("oh-my-claudecode:")) {
    return "none";
  }
  const normalized = skillName.toLowerCase().replace(/^oh-my-claudecode:/, "");
  if (RETIRED_SKILL_NAMES.has(normalized)) return "none";
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
  if (!(0, import_fs17.existsSync)(path3)) return { status: "missing" };
  try {
    const raw = JSON.parse((0, import_fs17.readFileSync)(path3, "utf-8"));
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
    if (!(0, import_fs17.existsSync)(path3)) return true;
    try {
      (0, import_fs17.unlinkSync)(path3);
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
      const sessionExists = (0, import_fs17.existsSync)(sessionPath);
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
        const rootMatches = options.rootState === null ? !(0, import_fs17.existsSync)(rootPath) : options.rootState !== void 0 && desiredRoot ? rootStatesEqual(observation.rootState, desiredRoot) : ledgersEqual(observation.rootLedger, expectedLedger);
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
  if (!(0, import_node_fs5.existsSync)(path3)) return { status: "missing" };
  try {
    const parsed = JSON.parse((0, import_node_fs5.readFileSync)(path3, "utf8"));
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
function reserveAndPlanPreToolBatch(envelope, snapshot, modelRoutingOverrides = {}) {
  if (!snapshot.forceDelegation?.enforce) {
    return {
      status: "planned",
      plan: planPreToolBatch(envelope, snapshot, modelRoutingOverrides),
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
  const path3 = (0, import_node_path8.join)(snapshot.stateDir, FORCE_DELEGATION_STATE_FILE);
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
      const plan = planPreToolBatch(
        envelope,
        currentSnapshot,
        modelRoutingOverrides
      );
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
    const path3 = (0, import_node_path8.join)(payload.stateDir, FORCE_DELEGATION_STATE_FILE);
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
function recordReadBudgetWarningLocked(payload) {
  if (!payload.intentId || !(0, import_node_path8.isAbsolute)(payload.path) || !validEpochSeconds(payload.observedAtSec, Math.floor(Date.now() / 1e3))) return { status: "failed" };
  const path3 = (0, import_node_path8.join)(payload.stateDir, READ_BUDGET_STATE_FILENAME);
  try {
    const locked = withStateFileMutationLock(path3, () => {
      const lockNowSec = Math.floor(Date.now() / 1e3);
      if (!validEpochSeconds(payload.observedAtSec, lockNowSec) || payload.observedAtSec <= lockNowSec - READ_BUDGET_WARNING_RETENTION_SECONDS) return { status: "failed" };
      const inspected = inspectJsonRecord(path3);
      if (inspected.status === "corrupt") return { status: "failed" };
      const stored = inspected.status === "valid" ? inspected.value : null;
      const generation = storedGeneration(stored?.generation);
      if (generation === null || stored?.warned !== void 0 && !isRecord5(stored.warned) || stored?.intentIds !== void 0 && !isRecord5(stored.intentIds)) return { status: "failed" };
      const warned = Object.fromEntries(Object.entries(pruneReadBudgetWarnings(
        isRecord5(stored?.warned) ? stored.warned : {},
        lockNowSec
      )).filter(([, timestamp]) => validEpochSeconds(timestamp, lockNowSec)));
      const priorIntents = isRecord5(stored?.intentIds) ? stored.intentIds : {};
      if (warned[payload.path] !== void 0) {
        return {
          status: priorIntents[payload.path] === payload.intentId ? "duplicate" : "changed"
        };
      }
      const intentIds = Object.fromEntries(Object.keys(warned).filter((key) => typeof priorIntents[key] === "string").map((key) => [key, priorIntents[key]]));
      warned[payload.path] = payload.observedAtSec;
      intentIds[payload.path] = payload.intentId;
      const next = nextGeneration(generation);
      if (next === null) return { status: "failed" };
      atomicWriteJsonSync(path3, {
        version: 1,
        generation: next,
        warned,
        intentIds
      });
      const committed = inspectJsonRecord(path3);
      if (committed.status !== "valid" || storedGeneration(committed.value.generation) !== next || !isRecord5(committed.value.warned) || committed.value.warned[payload.path] !== payload.observedAtSec || !isRecord5(committed.value.intentIds) || committed.value.intentIds[payload.path] !== payload.intentId) return { status: "failed" };
      return { status: "written" };
    });
    return locked.acquired && locked.value ? locked.value : { status: "failed" };
  } catch {
    return { status: "failed" };
  }
}
function advisoryPath(stateDir, sessionId) {
  if (sessionId && !SESSION_ID_PATTERN3.test(sessionId)) return null;
  return sessionId ? (0, import_node_path8.join)(stateDir, "sessions", sessionId, ADVISORY_STATE_FILE) : (0, import_node_path8.join)(stateDir, ADVISORY_STATE_FILE);
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
  recordReadBudgetWarning: recordReadBudgetWarningLocked,
  upsertSupportSkill,
  confirmMode,
  claimAdvisory: claimAdvisoryThrottleLocked,
  notifyAskUser
};
function isPreToolEffect(effect) {
  return typeof effect.callId === "string" && (effect.commitOn === "accepted" || effect.commitOn === "always") && isRecord5(effect.payload) && effect.payload.version === PRE_TOOL_EFFECT_PAYLOAD_VERSION && typeof effect.payload.intentId === "string" && typeof effect.payload.originalIndex === "number" && [
    "pretool.trace-skill-attempt.v1",
    "pretool.force-delegation-attempt.v1",
    "pretool.read-budget-warning.v1",
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
      case "pretool.read-budget-warning.v1": {
        const payload = effect.payload;
        if (!("path" in payload)) {
          return { ...base, status: "failed", detail: "Invalid read-budget warning payload." };
        }
        const result = (dependencies.recordReadBudgetWarning ?? recordReadBudgetWarningLocked)(payload);
        return {
          ...base,
          status: resultStatus(result.status),
          ...result.status === "changed" ? {
            detail: "[OMC READ BUDGET] Another accepted full read already consumed the warning allowance. Retry with a bounded range."
          } : result.status === "failed" ? { detail: "Read-budget warning state could not be verified." } : {}
        };
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
function suppressedPresentation(presentation, context) {
  if (context) {
    return {
      kind: "context",
      callId: presentation.callId,
      context,
      ...presentation.kind === "context" && presentation.updatedInput ? { updatedInput: presentation.updatedInput } : {}
    };
  }
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
  return claim === "throttled" ? suppressedPresentation(
    solePresentation,
    reduction.contexts.join("\n\n")
  ) : solePresentation;
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
  recordReadBudgetWarningLocked,
  reduceHookEvaluations,
  reserveAndPlanPreToolBatch,
  runHookJson,
  runHookNotificationChild,
  runHookPayload,
  sanitizeHookEvaluation,
  writeForceDelegationAttemptLocked
});
