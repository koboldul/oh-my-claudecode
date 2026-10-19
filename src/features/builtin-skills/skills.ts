/**
 * Builtin Skills Definitions
 *
 * Loads skills from bundled SKILL.md files in the skills directory.
 * This provides a single source of truth for skill definitions.
 *
 * Skills are loaded from project_root/skills/SKILLNAME/SKILL.md
 *
 * Adapted from oh-my-opencode's builtin-skills feature.
 */

import { existsSync, readFileSync } from 'fs';
import { join, dirname, resolve, relative, isAbsolute, win32 } from 'path';
import type { BuiltinSkill } from './types.js';
import { parseFrontmatter } from '../../utils/frontmatter.js';
import { rewriteOmcCliInvocations } from '../../utils/omc-cli-rendering.js';
import { parseSkillPipelineMetadata, renderSkillPipelineGuidance } from '../../utils/skill-pipeline.js';
import { renderSkillResourcesGuidance } from '../../utils/skill-resources.js';
import { renderSkillRuntimeGuidance } from './runtime-guidance.js';
import { getClaudeConfigDir } from '../../utils/config-dir.js';
import {
  getBuiltinSkillIdentifiers,
  getPackageDir,
  getSkillsDir,
  readBuiltinSkillRegistrations,
} from './registry.js';

export {
  getSkillsDir,
  loadBuiltinSkillRegistrations,
  type BuiltinSkillRegistration,
} from './registry.js';

const SKILLS_DIR = getSkillsDir();
const DEFAULT_DEEP_INTERVIEW_AMBIGUITY_THRESHOLD = 0.2;

function readJsonObject(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) {
    return null;
  }

  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function readDeepInterviewThresholdFromSettings(path: string): number | null {
  const settings = readJsonObject(path);
  const omc = settings?.omc;
  if (!omc || typeof omc !== 'object' || Array.isArray(omc)) {
    return null;
  }

  const deepInterview = (omc as Record<string, unknown>).deepInterview;
  if (!deepInterview || typeof deepInterview !== 'object' || Array.isArray(deepInterview)) {
    return null;
  }

  const threshold = (deepInterview as Record<string, unknown>).ambiguityThreshold;
  return typeof threshold === 'number' && Number.isFinite(threshold) && threshold >= 0 && threshold <= 1
    ? threshold
    : null;
}

type DeepInterviewThresholdResolution = {
  threshold: number;
  source: string;
};

export function getDeepInterviewSettingsPaths(): {
  profile: string;
  project: string;
} {
  return {
    profile: join(getClaudeConfigDir(), 'settings.json'),
    project: join(process.cwd(), '.claude', 'settings.json'),
  };
}

function getDeepInterviewAmbiguityThresholdResolution(): DeepInterviewThresholdResolution {
  const {
    profile: profileSettingsPath,
    project: projectSettingsPath,
  } = getDeepInterviewSettingsPaths();
  const profileThreshold = readDeepInterviewThresholdFromSettings(profileSettingsPath);
  const projectThreshold = readDeepInterviewThresholdFromSettings(projectSettingsPath);

  if (projectThreshold !== null) {
    return { threshold: projectThreshold, source: './.claude/settings.json' };
  }

  if (profileThreshold !== null) {
    return { threshold: profileThreshold, source: '[$CLAUDE_CONFIG_DIR|~/.claude]/settings.json' };
  }

  return { threshold: DEFAULT_DEEP_INTERVIEW_AMBIGUITY_THRESHOLD, source: 'default' };
}

function formatThresholdPercent(threshold: number): string {
  return `${(threshold * 100).toFixed(2).replace(/\.?0+$/, '')}%`;
}

function pathLooksWindows(value: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith('\\\\');
}

export function isPathInsideOrEqual(parentPath: string, candidatePath: string): boolean {
  const pathApi = pathLooksWindows(parentPath) || pathLooksWindows(candidatePath) ? win32 : { relative, isAbsolute };
  const rel = pathApi.relative(parentPath, candidatePath);
  return rel === '' || (!rel.startsWith('..') && !pathApi.isAbsolute(rel));
}

function getFrontmatterString(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readSkillBodyOverride(skillPath: string, metadata: Record<string, unknown>, fallbackBody: string): string {
  const bodyPath = getFrontmatterString(metadata, 'omc-full-body');
  if (!bodyPath) {
    return fallbackBody;
  }

  const skillDir = dirname(skillPath);
  const resolvedBodyPath = resolve(skillDir, bodyPath);
  const packageRoot = resolve(getPackageDir());

  if (!isPathInsideOrEqual(packageRoot, resolvedBodyPath)) {
    return fallbackBody;
  }

  try {
    const fullContent = readFileSync(resolvedBodyPath, 'utf-8');
    const { body } = parseFrontmatter(fullContent);
    return body;
  } catch {
    return fallbackBody;
  }
}

function applyDeepInterviewRuntimeSettings(template: string): string {
  const { threshold, source } = getDeepInterviewAmbiguityThresholdResolution();
  const percent = formatThresholdPercent(threshold);

  const withResolvedPlaceholders = template
    .replaceAll('<resolvedThreshold>', `${threshold}`)
    .replaceAll('<resolvedThresholdPercent>', percent)
    .replaceAll('<resolvedThresholdSource>', source);

  const withRuntimeSettings = withResolvedPlaceholders.includes('3.5. **Load runtime settings**:')
    || withResolvedPlaceholders.includes('## Phase 0: Resolve Ambiguity Threshold')
    ? withResolvedPlaceholders
    : withResolvedPlaceholders.replace(
      '4. **Initialize state** via `state_write(mode="deep-interview")`:',
      [
        `3.5. **Load runtime settings** from \`~/.claude/settings.json\` and \`./.claude/settings.json\` before state init (project overrides profile). For this run, use \`ambiguityThreshold = ${threshold}\`.`,
        '4. **Initialize state** via `state_write(mode="deep-interview")`:',
      ].join('\n'),
    );

  return withRuntimeSettings
    .replace('"threshold": 0.2,', `"threshold": ${threshold},`)
    .replace(
      'We\'ll proceed to execution once ambiguity drops below 20%.',
      `We'll proceed to execution once ambiguity drops below ${percent}.`,
    )
    // Fix #2545: replace remaining hardcoded 20%/0.2 references that conflict with runtime threshold injection
    .replace('(default: 20%)', `(default: ${percent})`)
    .replace('(default 0.2)', `(default ${threshold})`)
    .replace('"ambiguityThreshold": 0.2,', `"ambiguityThreshold": ${threshold},`)
    .replace('Gate: ≤20% ambiguity', `Gate: ≤${percent} ambiguity`)
    .replace('(threshold: 20%).', `(threshold: ${percent}).`)
    .replace('ambiguity ≤ 20%', `ambiguity ≤ ${percent}`);
}

function normalizeSkillNameForRuntimeRendering(skillName: string): string {
  return skillName.trim().toLowerCase().replace(/^oh-my-claudecode:/, '').replace(/^omc:/, '');
}

export function renderBundledSkillBody(skillName: string, body: string): string {
  const normalizedSkillName = normalizeSkillNameForRuntimeRendering(skillName);
  const rewrittenBody = rewriteOmcCliInvocations(body.trim());
  return normalizedSkillName === 'deep-interview' || normalizedSkillName === 'deep-dive'
    ? applyDeepInterviewRuntimeSettings(rewrittenBody)
    : rewrittenBody;
}

/**
 * Load a single skill from a SKILL.md file
 */
function loadSkillFromFile(
  skillPath: string,
  skillName: string,
  content: string,
): BuiltinSkill[] {
  try {
    const { metadata, body } = parseFrontmatter(content);
    const { primaryName: safePrimaryName, aliases: safeAliases } =
      getBuiltinSkillIdentifiers(metadata, skillName);
    const pipeline = parseSkillPipelineMetadata(metadata);
    const fullBody = readSkillBodyOverride(skillPath, metadata, body);
    const renderedBody = renderBundledSkillBody(safePrimaryName, fullBody);
    const template = [
      renderedBody,
      renderSkillRuntimeGuidance(safePrimaryName),
      renderSkillPipelineGuidance(safePrimaryName, pipeline),
      renderSkillResourcesGuidance(skillPath),
    ].filter((section) => section.trim().length > 0).join('\n\n');

    const allNames = [safePrimaryName, ...safeAliases];
    const skillEntries: BuiltinSkill[] = [];
    const seen = new Set<string>();

    for (const name of allNames) {
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      skillEntries.push({
        name,
        aliases: name === safePrimaryName ? safeAliases : undefined,
        aliasOf: name === safePrimaryName ? undefined : safePrimaryName,
        deprecatedAlias: name === safePrimaryName ? undefined : true,
        deprecationMessage: name === safePrimaryName
          ? undefined
          : `Skill alias "${name}" is deprecated. Use "${safePrimaryName}" instead.`,
        description: metadata.description || '',
        template,
        // Optional fields from frontmatter
        model: metadata.model,
        agent: metadata.agent,
        argumentHint: metadata['argument-hint'],
        pipeline: name === safePrimaryName ? pipeline : undefined,
      });
    }

    return skillEntries;
  } catch {
    return [];
  }
}

/**
 * Load all skills from the skills/ directory
 */
function loadSkillsFromDirectory(): BuiltinSkill[] {
  if (!existsSync(SKILLS_DIR)) {
    return [];
  }

  const skills: BuiltinSkill[] = [];

  try {
    const registrations = readBuiltinSkillRegistrations();
    for (const registration of registrations) {
      const registeredNames = new Set(
        registration.registeredNames.map((name) => name.toLowerCase()),
      );
      skills.push(...loadSkillFromFile(
        registration.skillPath,
        registration.skillName,
        registration.content,
      ).filter((skill) => registeredNames.has(skill.name.toLowerCase())));
    }
  } catch {
    // Return empty array if directory read fails
    return [];
  }

  return skills;
}

// Cache loaded skills to avoid repeated file reads
let cachedSkills: BuiltinSkill[] | null = null;
let cachedSkillsKey: string | null = null;

function getBuiltinSkillsCacheKey(): string {
  return JSON.stringify({
    deepInterviewAmbiguityThreshold: getDeepInterviewAmbiguityThresholdResolution(),
  });
}

/**
 * Get all builtin skills
 *
 * Skills are loaded from bundled SKILL.md files in the skills/ directory.
 * Results are cached after first load.
 */
export function createBuiltinSkills(): BuiltinSkill[] {
  const cacheKey = getBuiltinSkillsCacheKey();
  if (cachedSkills === null || cachedSkillsKey !== cacheKey) {
    cachedSkills = loadSkillsFromDirectory();
    cachedSkillsKey = cacheKey;
  }
  return cachedSkills;
}

/**
 * Get a skill by name
 */
export function getBuiltinSkill(name: string): BuiltinSkill | undefined {
  const skills = createBuiltinSkills();
  return skills.find(s => s.name.toLowerCase() === name.toLowerCase());
}

export interface ListBuiltinSkillNamesOptions {
  includeAliases?: boolean;
}

/**
 * List all builtin skill names
 */
export function listBuiltinSkillNames(options?: ListBuiltinSkillNamesOptions): string[] {
  const { includeAliases = false } = options ?? {};
  return readBuiltinSkillRegistrations().flatMap((registration) =>
    registration.registeredNames.filter((name) =>
      includeAliases || name === registration.primaryName,
    ),
  );
}

/**
 * Clear the skills cache (useful for testing)
 */
export function clearSkillsCache(): void {
  cachedSkills = null;
  cachedSkillsKey = null;
}
