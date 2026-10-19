import { readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter, parseFrontmatterAliases } from '../../utils/frontmatter.js';
import entitlementManifest from '../../config/builtin-skill-entitlements.json' with { type: 'json' };
/**
 * Identifier discovery must not import skill rendering: its provider guidance
 * loads delegation/agent definitions and probes external CLIs.
 */
export function getPackageDir() {
    if (typeof __dirname !== 'undefined' && __dirname) {
        const currentDirName = basename(__dirname);
        const parentDirName = basename(dirname(__dirname));
        const grandparentDirName = basename(dirname(dirname(__dirname)));
        if (currentDirName === 'bridge') {
            return join(__dirname, '..');
        }
        if (currentDirName === 'builtin-skills'
            && parentDirName === 'features'
            && (grandparentDirName === 'src' || grandparentDirName === 'dist')) {
            return join(__dirname, '..', '..', '..');
        }
    }
    try {
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = dirname(__filename);
        return join(__dirname, '..', '..', '..');
    }
    catch {
        return process.cwd();
    }
}
const SKILLS_DIR = join(getPackageDir(), 'skills');
const CC_NATIVE_COMMANDS = new Set([
    'review',
    'plan',
    'security-review',
    'init',
    'doctor',
    'help',
    'config',
    'clear',
    'compact',
    'memory',
]);
const SKININTHEGAMEBROS_ONLY_SKILLS = new Set(entitlementManifest.skininthegamebrosOnlySkills.map((skill) => skill.trim().toLowerCase()));
function toSafeSkillName(name) {
    const normalized = name.trim();
    return CC_NATIVE_COMMANDS.has(normalized.toLowerCase())
        ? `omc-${normalized}`
        : normalized;
}
export function getBuiltinSkillIdentifiers(metadata, skillName) {
    const primaryName = toSafeSkillName(metadata.name || skillName);
    const aliases = Array.from(new Set(parseFrontmatterAliases(metadata.aliases)
        .map(toSafeSkillName)
        .filter((alias) => alias.length > 0
        && alias.toLowerCase() !== primaryName.toLowerCase())));
    return { primaryName, aliases };
}
/**
 * Share runtime identifier claims without rendering skill bodies or reading
 * settings. Callers supply observations so hooks can cache and freeze them.
 */
export function loadBuiltinSkillRegistrations(skillsDirectories, readText, listDirectories, userType) {
    const registrations = [];
    const seenNames = new Set();
    for (const skillsDirectory of skillsDirectories) {
        const skillNames = [...listDirectories(skillsDirectory)].sort((a, b) => {
            if (a === 'skillify')
                return -1;
            if (b === 'skillify')
                return 1;
            return a.localeCompare(b);
        });
        for (const skillName of skillNames) {
            if (SKININTHEGAMEBROS_ONLY_SKILLS.has(skillName.toLowerCase())
                && userType !== 'ant')
                continue;
            const skillPath = join(skillsDirectory, skillName, 'SKILL.md');
            const content = readText(skillPath);
            if (content === null)
                continue;
            const { metadata } = parseFrontmatter(content);
            const { primaryName, aliases } = getBuiltinSkillIdentifiers(metadata, skillName);
            const registeredNames = [primaryName, ...aliases].filter((name) => {
                const key = name.toLowerCase();
                if (seenNames.has(key))
                    return false;
                seenNames.add(key);
                return true;
            });
            registrations.push({
                skillPath,
                skillName,
                content,
                primaryName,
                registeredNames,
            });
        }
    }
    return registrations;
}
/** Default metadata observations for the plugin loader and delegation helpers. */
export function readBuiltinSkillRegistrations() {
    return loadBuiltinSkillRegistrations([SKILLS_DIR], (path) => {
        try {
            return readFileSync(path, 'utf-8');
        }
        catch {
            return null;
        }
    }, (path) => {
        try {
            return readdirSync(path, { withFileTypes: true })
                .filter((entry) => entry.isDirectory())
                .map((entry) => entry.name);
        }
        catch {
            return [];
        }
    }, process.env.USER_TYPE);
}
export function getSkillsDir() {
    return SKILLS_DIR;
}
//# sourceMappingURL=registry.js.map