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

import { join, basename, dirname } from 'path';
import { existsSync } from 'fs';
import { createHash } from 'crypto';
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

  // Inline fallback: respects OMC_STATE_DIR with simplified project identifier
  const customDir = process.env.OMC_STATE_DIR;
  if (customDir) {
    const hash = createHash('sha256').update(directory).digest('hex').slice(0, 16);
    const dirName = basename(directory).replace(/[^a-zA-Z0-9_-]/g, '_');
    return join(customDir, `${dirName}-${hash}`);
  }
  return join(directory, '.omc');
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
