import { spawnSync } from 'child_process';
import { existsSync, readFileSync, readdirSync, realpathSync } from 'fs';
import { resolve, join, relative, sep, dirname, parse, basename } from 'path';
import { posix } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { parseJsonc } from '../../utils/jsonc.js';

const DEVCONTAINER_PRIMARY_CONFIG_PATH = ['.devcontainer', 'devcontainer.json'] as const;
const DEVCONTAINER_DOTFILE_NAME = '.devcontainer.json' as const;
const DEVCONTAINER_CONFIG_DIR = '.devcontainer' as const;
const DEVCONTAINER_LOCAL_FOLDER_LABELS = [
  'devcontainer.local_folder',
  'vsch.local.folder'
] as const;
const DEVCONTAINER_CONFIG_FILE_LABELS = [
  'devcontainer.config_file',
  'vsch.config.file'
] as const;

/**
 * Hard upper bound for every `docker` probe.
 *
 * The MCP server is single-threaded: an unbounded `spawnSync('docker', ...)`
 * against a hung Docker Desktop blocks the event loop forever and makes every
 * later tool call time out. Three seconds is well above a healthy `docker ps`
 * and far below the host's request deadline.
 */
const DOCKER_PROBE_TIMEOUT_MS = 3000;

/**
 * TTL for the resolved devcontainer context cache.
 *
 * `resolveDevContainerContext()` runs once per LSP client lookup (twice per
 * operation via getClientForFile/runWithClientLease), so a short TTL collapses
 * the duplicate probe without permanently hiding a container that was started
 * moments ago.
 */
const DEVCONTAINER_CACHE_TTL_MS = 5000;

/** Bound on the context cache so long-lived servers cannot grow it unboundedly. */
const DEVCONTAINER_CACHE_MAX_ENTRIES = 16;

interface DevContainerCacheEntry {
  expiresAt: number;
  context: DevContainerContext | null;
}

/** LRU + TTL cache keyed by canonical workspace root and container override. */
const devContainerContextCache = new Map<string, DevContainerCacheEntry>();

interface DockerInspectMount {
  Source?: string;
  Destination?: string;
  Type?: string;
}

interface DockerInspectState {
  Running?: boolean;
}

interface DockerInspectConfig {
  Labels?: Record<string, string>;
}

interface DockerInspectResult {
  Id?: string;
  Config?: DockerInspectConfig;
  Mounts?: DockerInspectMount[];
  State?: DockerInspectState;
}

interface DevContainerJson {
  workspaceFolder?: string;
}

export interface DevContainerContext {
  containerId: string;
  hostWorkspaceRoot: string;
  containerWorkspaceRoot: string;
  configFilePath?: string;
}

export function resolveDevContainerContext(workspaceRoot: string): DevContainerContext | null {
  const hostWorkspaceRoot = resolve(workspaceRoot);
  const overrideContainerId = process.env.OMC_LSP_CONTAINER_ID?.trim();
  const cacheKey = `${canonicalWorkspaceCacheKey(hostWorkspaceRoot)}\u0000${overrideContainerId ?? ''}`;

  const cached = readCachedContext(cacheKey);
  if (cached) {
    return cached.context;
  }

  const context = computeDevContainerContext(hostWorkspaceRoot, overrideContainerId);
  writeCachedContext(cacheKey, context);
  return context;
}

/**
 * Clear the devcontainer context cache (useful for testing).
 * @internal
 */
export function clearDevContainerContextCache(): void {
  devContainerContextCache.clear();
}

function canonicalWorkspaceCacheKey(workspaceRoot: string): string {
  let canonical = workspaceRoot;
  try {
    canonical = realpathSync(workspaceRoot);
  } catch {
    // Keep the resolved path when the filesystem cannot canonicalize it.
  }
  return process.platform === 'win32' ? canonical.toLowerCase() : canonical;
}

function readCachedContext(cacheKey: string): DevContainerCacheEntry | null {
  const entry = devContainerContextCache.get(cacheKey);
  if (!entry) {
    return null;
  }

  if (entry.expiresAt <= Date.now()) {
    devContainerContextCache.delete(cacheKey);
    return null;
  }

  // LRU: refresh recency without extending the TTL.
  devContainerContextCache.delete(cacheKey);
  devContainerContextCache.set(cacheKey, entry);
  return entry;
}

function writeCachedContext(cacheKey: string, context: DevContainerContext | null): void {
  if (devContainerContextCache.size >= DEVCONTAINER_CACHE_MAX_ENTRIES) {
    const oldest = devContainerContextCache.keys().next().value;
    if (oldest !== undefined) {
      devContainerContextCache.delete(oldest);
    }
  }

  devContainerContextCache.set(cacheKey, {
    expiresAt: Date.now() + DEVCONTAINER_CACHE_TTL_MS,
    context
  });
}

function computeDevContainerContext(
  hostWorkspaceRoot: string,
  overrideContainerId?: string
): DevContainerContext | null {
  const configFilePath = resolveDevContainerConfigPath(hostWorkspaceRoot);
  const config = readDevContainerConfig(configFilePath);

  if (overrideContainerId) {
    return buildContextFromContainer(overrideContainerId, hostWorkspaceRoot, configFilePath, config);
  }

  const containerIds = listRunningContainerIds();
  if (containerIds.length === 0) {
    return null;
  }

  let bestMatch: { score: number; context: DevContainerContext } | null = null;

  for (const inspect of inspectContainers(containerIds)) {
    const score = scoreContainerMatch(inspect, hostWorkspaceRoot, configFilePath);
    if (score <= 0) {
      continue;
    }

    const context = buildContextFromInspect(inspect, hostWorkspaceRoot, configFilePath, config);
    if (!context) {
      continue;
    }

    if (!bestMatch || score > bestMatch.score) {
      bestMatch = { score, context };
    }
  }

  return bestMatch?.context ?? null;
}

export function hostPathToContainerPath(filePath: string, context: DevContainerContext | null | undefined): string {
  if (!context) {
    return resolve(filePath);
  }

  const resolvedPath = resolve(filePath);
  const relativePath = relative(context.hostWorkspaceRoot, resolvedPath);
  if (relativePath === '') {
    return context.containerWorkspaceRoot;
  }
  if (relativePath.startsWith('..') || relativePath.includes(`..${sep}`)) {
    return resolvedPath;
  }

  const posixRelativePath = relativePath.split(sep).join('/');
  return posix.join(context.containerWorkspaceRoot, posixRelativePath);
}

export function containerPathToHostPath(filePath: string, context: DevContainerContext | null | undefined): string {
  if (!context) {
    return resolve(filePath);
  }

  const normalizedContainerPath = normalizeContainerPath(filePath);
  const relativePath = posix.relative(context.containerWorkspaceRoot, normalizedContainerPath);
  if (relativePath === '') {
    return context.hostWorkspaceRoot;
  }
  if (relativePath.startsWith('..') || relativePath.includes('../')) {
    return normalizedContainerPath;
  }

  return resolve(context.hostWorkspaceRoot, ...relativePath.split('/'));
}

export function hostUriToContainerUri(uri: string, context: DevContainerContext | null | undefined): string {
  if (!context || !uri.startsWith('file://')) {
    return uri;
  }

  return containerPathToFileUri(hostPathToContainerPath(fileURLToPath(uri), context));
}

export function containerUriToHostUri(uri: string, context: DevContainerContext | null | undefined): string {
  if (!context || !uri.startsWith('file://')) {
    return uri;
  }

  try {
    const parsed = new URL(uri);
    if (parsed.protocol !== 'file:' || parsed.hostname || /%2f|%5c/i.test(parsed.pathname)) {
      return uri;
    }
    const containerPath = decodeURIComponent(parsed.pathname);
    return pathToFileURL(containerPathToHostPath(containerPath, context)).href;
  } catch {
    return uri;
  }
}

function resolveDevContainerConfigPath(workspaceRoot: string): string | undefined {
  let dir = workspaceRoot;

  while (true) {
    const configFilePath = resolveDevContainerConfigPathAt(dir);
    if (configFilePath) {
      return configFilePath;
    }

    const parsed = parse(dir);
    if (parsed.root === dir) {
      return undefined;
    }

    dir = dirname(dir);
  }
}

function resolveDevContainerConfigPathAt(dir: string): string | undefined {
  const primaryConfigPath = join(dir, ...DEVCONTAINER_PRIMARY_CONFIG_PATH);
  if (existsSync(primaryConfigPath)) {
    return primaryConfigPath;
  }

  const dotfileConfigPath = join(dir, DEVCONTAINER_DOTFILE_NAME);
  if (existsSync(dotfileConfigPath)) {
    return dotfileConfigPath;
  }

  const devcontainerDir = join(dir, DEVCONTAINER_CONFIG_DIR);
  if (!existsSync(devcontainerDir)) {
    return undefined;
  }

  const nestedConfigPaths = readdirSync(devcontainerDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => join(devcontainerDir, entry.name, 'devcontainer.json'))
    .filter(existsSync)
    .sort((left, right) => left.localeCompare(right));

  return nestedConfigPaths[0];
}

function deriveHostDevContainerRoot(configFilePath: string): string {
  const resolvedConfigPath = resolve(configFilePath);
  if (basename(resolvedConfigPath) === DEVCONTAINER_DOTFILE_NAME) {
    return dirname(resolvedConfigPath);
  }

  const configParentDir = dirname(resolvedConfigPath);
  if (basename(configParentDir) === DEVCONTAINER_CONFIG_DIR) {
    return dirname(configParentDir);
  }

  const configGrandparentDir = dirname(configParentDir);
  if (basename(configGrandparentDir) === DEVCONTAINER_CONFIG_DIR) {
    return dirname(configGrandparentDir);
  }

  return dirname(configParentDir);
}

function readDevContainerConfig(configFilePath?: string): DevContainerJson | null {
  if (!configFilePath || !existsSync(configFilePath)) {
    return null;
  }

  try {
    const parsed = parseJsonc(readFileSync(configFilePath, 'utf-8'));
    return typeof parsed === 'object' && parsed !== null ? parsed as DevContainerJson : null;
  } catch {
    return null;
  }
}

function listRunningContainerIds(): string[] {
  const result = runDocker(['ps', '-q']);
  if (!result || result.status !== 0) {
    return [];
  }

  return readDockerStdout(result)
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
}

function inspectContainers(containerIds: string[]): DockerInspectResult[] {
  if (containerIds.length === 0) {
    return [];
  }

  const result = runDocker(['inspect', ...containerIds]);
  if (!result || result.status !== 0) {
    return [];
  }

  try {
    const parsed = JSON.parse(readDockerStdout(result)) as DockerInspectResult[];
    return parsed.filter(inspect => Boolean(inspect?.Id) && inspect.State?.Running !== false);
  } catch {
    return [];
  }
}

function readDockerStdout(result: ReturnType<typeof spawnSync>): string {
  const { stdout } = result;
  if (typeof stdout === 'string') {
    return stdout;
  }
  // A killed probe can leave stdout null; treat it as empty output.
  return stdout ? stdout.toString('utf8') : '';
}

function buildContextFromContainer(
  containerId: string,
  hostWorkspaceRoot: string,
  configFilePath?: string,
  config?: DevContainerJson | null
): DevContainerContext | null {
  const inspect = inspectContainers([containerId])[0];
  if (!inspect) {
    return null;
  }

  return buildContextFromInspect(inspect, hostWorkspaceRoot, configFilePath, config);
}

function buildContextFromInspect(
  inspect: DockerInspectResult,
  hostWorkspaceRoot: string,
  configFilePath?: string,
  config?: DevContainerJson | null
): DevContainerContext | null {
  const containerWorkspaceRoot = deriveContainerWorkspaceRoot(inspect, hostWorkspaceRoot, config?.workspaceFolder);
  if (!containerWorkspaceRoot || !inspect.Id) {
    return null;
  }

  return {
    containerId: inspect.Id,
    hostWorkspaceRoot,
    containerWorkspaceRoot,
    configFilePath
  };
}

function deriveContainerWorkspaceRoot(
  inspect: DockerInspectResult,
  hostWorkspaceRoot: string,
  workspaceFolder?: string
): string | null {
  const mounts = Array.isArray(inspect.Mounts) ? inspect.Mounts : [];

  let bestMountMatch: { sourceLength: number; destination: string } | null = null;
  for (const mount of mounts) {
    const source = mount.Source ? resolve(mount.Source) : '';
    const destination = mount.Destination ? normalizeContainerPath(mount.Destination) : '';
    if (!source || !destination) {
      continue;
    }

    if (source === hostWorkspaceRoot) {
      return destination;
    }

    const relativePath = relative(source, hostWorkspaceRoot);
    if (relativePath === '' || relativePath.startsWith('..') || relativePath.includes(`..${sep}`)) {
      continue;
    }

    if (!bestMountMatch || source.length > bestMountMatch.sourceLength) {
      bestMountMatch = {
        sourceLength: source.length,
        destination: posix.join(destination, relativePath.split(sep).join('/'))
      };
    }
  }

  if (bestMountMatch) {
    return bestMountMatch.destination;
  }

  return workspaceFolder ? normalizeContainerPath(workspaceFolder) : null;
}

function scoreContainerMatch(
  inspect: DockerInspectResult,
  hostWorkspaceRoot: string,
  configFilePath?: string
): number {
  const labels = inspect.Config?.Labels ?? {};
  let score = 0;
  let hasDevContainerLabelMatch = false;
  const expectedLocalFolder = configFilePath
    ? deriveHostDevContainerRoot(configFilePath)
    : resolve(hostWorkspaceRoot);

  for (const label of DEVCONTAINER_LOCAL_FOLDER_LABELS) {
    if (labels[label] && resolve(labels[label]) === expectedLocalFolder) {
      score += 4;
      hasDevContainerLabelMatch = true;
    }
  }

  if (configFilePath) {
    for (const label of DEVCONTAINER_CONFIG_FILE_LABELS) {
      if (labels[label] && resolve(labels[label]) === configFilePath) {
        score += 3;
        hasDevContainerLabelMatch = true;
      }
    }
  }

  const mappedWorkspaceRoot = deriveContainerWorkspaceRoot(inspect, hostWorkspaceRoot);
  if (mappedWorkspaceRoot && (Boolean(configFilePath) || hasDevContainerLabelMatch)) {
    score += 1;
  }

  return score;
}

function normalizeContainerPath(filePath: string): string {
  return posix.normalize(filePath.replace(/\\/g, '/'));
}

function containerPathToFileUri(filePath: string): string {
  const normalizedPath = normalizeContainerPath(filePath);
  const encodedPath = normalizedPath
    .split('/')
    .map(segment => encodeURIComponent(segment))
    .join('/');
  return `file://${encodedPath.startsWith('/') ? encodedPath : `/${encodedPath}`}`;
}

function runDocker(args: string[]): ReturnType<typeof spawnSync> | null {
  const result = spawnSync('docker', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: DOCKER_PROBE_TIMEOUT_MS,
    killSignal: 'SIGKILL',
    windowsHide: true
  });

  // A hung/absent Docker daemon must degrade to "no devcontainer", never throw
  // and never block. `signal` is set when the timeout killed the probe.
  if (result.error || result.signal) {
    return null;
  }

  return result;
}
