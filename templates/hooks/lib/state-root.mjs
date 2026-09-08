// Thin delegator → src/lib/worktree-paths.ts::resolveSessionStatePaths. DO NOT reimplement here.

/**
 * State Root Resolver (ESM)
 *
 * Single authoritative entry point for resolving the .omc root directory in
 * hook scripts, respecting the OMC_STATE_DIR environment variable.
 *
 * Delegates to getOmcRoot() from dist/lib/worktree-paths.js (the canonical
 * implementation) whenever a canonical root can be located — either via
 * CLAUDE_PLUGIN_ROOT or a validated script-relative package root (see
 * resolveCanonicalRoot() below). Falls back to inline logic when dist is not
 * built — this should never happen in production, but provides a safe
 * fallback during development or first-run scenarios.
 *
 * Inline fallback notes:
 *   - Uses directory path as hash source (not git remote URL). Matches
 *     canonical behavior for local-only repos; may differ for remote-backed
 *     repos when dist is missing — acceptable since dist is always present
 *     in production (a canonical root is always resolvable).
 */

import { join, basename, dirname, resolve } from 'path';
import { existsSync, readFileSync } from 'fs';
import { createHash } from 'crypto';
import { execFileSync } from 'child_process';
import { homedir } from 'os';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function canonicalDistPath(root) {
  return join(root, 'dist', 'lib', 'worktree-paths.js');
}

/**
 * Locate a root directory that has a built dist/lib/worktree-paths.js.
 *
 * Copilot CLI hook children do not reliably export CLAUDE_PLUGIN_ROOT (unlike
 * Claude Code), so when that env var is absent this also tries a
 * script-relative package root. This file ships as a standalone template
 * copied to e.g. ~/.claude/hooks/lib/state-root.mjs, so the script-relative
 * candidate is only trusted when it looks like the real OMC package root
 * (has package.json AND .claude-plugin/plugin.json) — a plain standalone
 * install never has those two levels up and safely falls through to the
 * inline fallback below.
 *
 * @returns {string|null} Root directory with a built dist/, or null.
 */
function resolveCanonicalRoot() {
  const envRoot = process.env.CLAUDE_PLUGIN_ROOT;
  if (envRoot && existsSync(canonicalDistPath(envRoot))) {
    return envRoot;
  }

  const scriptRoot = join(__dirname, '..', '..');
  const looksLikePackageRoot =
    existsSync(join(scriptRoot, 'package.json')) &&
    existsSync(join(scriptRoot, '.claude-plugin', 'plugin.json'));
  if (looksLikePackageRoot && existsSync(canonicalDistPath(scriptRoot))) {
    return scriptRoot;
  }

  return null;
}

function findWorkspaceRoot(directory) {
  if (process.env.OMC_DISABLE_MULTIREPO === '1') return null;
  const home = resolve(homedir());
  let cursor = resolve(directory);
  while (true) {
    if (cursor === home) return null;
    if (existsSync(join(cursor, '.omc-workspace'))) return cursor;
    const parent = dirname(cursor);
    if (parent === cursor) return null;
    cursor = parent;
  }
}

function workspaceIdentifier(workspaceRoot) {
  try {
    const config = JSON.parse(readFileSync(join(workspaceRoot, '.omc-workspace'), 'utf8'));
    if (typeof config.id === 'string' && config.id.trim()) {
      const safeId = config.id.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
      return `${safeId}-${createHash('sha256').update(safeId).digest('hex').slice(0, 16)}`;
    }
  } catch {}
  const hash = createHash('sha256').update(workspaceRoot).digest('hex').slice(0, 16);
  return `${basename(workspaceRoot).replace(/[^a-zA-Z0-9_-]/g, '_')}-${hash}`;
}

function primaryGitRoot(gitRoot) {
  try {
    const commonDir = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: gitRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true, timeout: 5000 }).trim();
    if (basename(commonDir) === '.git' && !commonDir.includes('/.git/modules/')) return dirname(commonDir);
  } catch {}
  return gitRoot;
}

function probeGitRoot(directory) {
  try { return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: directory, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, timeout: 5000 }).trim() || null; }
  catch (error) { if (error?.code === 'ENOENT' || (error?.status === 128 && /not a git repository/i.test(String(error?.stderr ?? '')))) return null; throw error; }
}

function isSafeWorkspaceRoot(workspaceRoot) {
  const home = resolve(homedir());
  const normalized = workspaceRoot.replace(/\\/g, '/');
  let cursor = workspaceRoot;
  while (true) {
    const name = basename(cursor).toLowerCase();
    if (cursor === home || cursor === '/' || cursor === '/tmp' || name.startsWith('.') || ['.ssh', '.gnupg', '.aws', '.config', '.claude', '.codex', '.cache', '.npm', 'desktop', 'documents', 'downloads', 'pictures', 'music'].includes(name)) return false;
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return normalized !== '';
}

/**
 * Resolve the .omc root directory, respecting OMC_STATE_DIR.
 *
 * @param {string} directory - Worktree root directory
 * @returns {Promise<string>} Absolute path to the .omc root
 */
export async function resolveOmcStateRoot(directory) {
  const canonicalRoot = resolveCanonicalRoot();
  if (canonicalRoot) {
    try {
      const { getOmcRoot } = await import(
        pathToFileURL(canonicalDistPath(canonicalRoot)).href
      );
      return getOmcRoot(directory);
    } catch {
      // dist not built or unavailable — fall through to inline fallback
    }
  }

  // Inline fallback: preserve the canonical non-git namespace when the
  // generated distribution is unavailable, while retaining a stable
  // project-specific identity for valid Git repositories.
  const customDir = process.env.OMC_STATE_DIR;
  if (customDir) {
    const workspaceRoot = findWorkspaceRoot(directory);
    if (workspaceRoot) return join(customDir, workspaceIdentifier(workspaceRoot));
    const gitRoot = probeGitRoot(directory);
    if (!gitRoot) return join(customDir, 'non-git');
    const primaryRoot = primaryGitRoot(gitRoot);
    let source = primaryRoot;
    try {
      source = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: gitRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true, timeout: 5000 }).trim() || primaryRoot;
    } catch {}
    const hash = createHash('sha256').update(source).digest('hex').slice(0, 16);
    const dirName = basename(primaryRoot).replace(/[^a-zA-Z0-9_-]/g, '_');
    return join(customDir, `${dirName}-${hash}`);
  }
  const workspaceRoot = findWorkspaceRoot(directory);
  if (workspaceRoot && isSafeWorkspaceRoot(workspaceRoot)) return join(workspaceRoot, '.omc');
  const gitRoot = probeGitRoot(directory);
  if (gitRoot) return join(gitRoot, '.omc');
  const home = resolve(homedir());
  return join(home, '.omc');
}

/**
 * Resolve session-scoped state paths for a given directory, state name, and session ID.
 * Delegates to resolveSessionStatePaths() in dist/lib/worktree-paths.js.
 *
 * @param {string} directory - Worktree root directory
 * @param {string} stateName - State name (e.g., "ralph", "ultrawork")
 * @param {string} [sessionId] - Optional session identifier
 * @returns {Promise<{readPath: string, writePath: string}>} Unbranded path pair
 */
export async function resolveSessionStatePathsForHook(directory, stateName, sessionId) {
  const canonicalRoot = resolveCanonicalRoot();
  if (canonicalRoot) {
    try {
      const { resolveSessionStatePaths } = await import(
        pathToFileURL(canonicalDistPath(canonicalRoot)).href
      );
      const result = resolveSessionStatePaths(stateName, sessionId, directory);
      return { readPath: result.effectiveRead, writePath: result.effectiveWrite };
    } catch {
      // dist not built or unavailable — fall through to inline fallback
    }
  }

  // Inline fallback: basic session-scoped path derivation (production always uses dist above)
  const omcRoot = await resolveOmcStateRoot(directory);
  const normalizedName = stateName.endsWith('-state') ? stateName : `${stateName}-state`;
  const legacy = join(omcRoot, 'state', `${normalizedName}.json`);
  if (!sessionId) {
    return { readPath: legacy, writePath: legacy };
  }
  const sessionScoped = join(omcRoot, 'state', 'sessions', sessionId, `${normalizedName}.json`);
  // effectiveRead probes the session-scoped file first and falls back to the
  // legacy path when it does not exist yet (mirrors resolveSessionStatePaths).
  const readPath = existsSync(sessionScoped) ? sessionScoped : legacy;
  return { readPath, writePath: sessionScoped };
}
