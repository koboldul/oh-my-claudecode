import * as fs from 'fs';
import * as path from 'path';
import { getOmcRoot, getGitTopLevel } from '../../lib/worktree-paths.js';
import { getClaudeConfigDir } from '../../utils/config-dir.js';
const SAFE_PATTERNS = [
    /^git (status|diff|log|branch|show|fetch)/,
    /^npm run (lint|build|check|typecheck)/,
    /^pnpm (lint|build|check|typecheck|run (lint|build|check|typecheck))/,
    /^yarn (lint|build|check|typecheck|run (lint|build|check|typecheck))/,
    /^tsc( |$)/,
    /^gh (issue|pr) (view|list|status)\b/,
    /^eslint /,
    /^prettier /,
    /^cargo (check|clippy|build)/,
    /^ls( |$)/,
    // REMOVED: cat, head, tail - they allow reading arbitrary files
];
// Shell metacharacters that enable command chaining and injection
// See GitHub Issue #146 for full list of dangerous characters
// Note: Quotes ("') intentionally excluded - they're needed for paths with spaces
// and command substitution is already caught by $ detection
const DANGEROUS_SHELL_CHARS = /[;&|`$()<>\n\r\t\0\\{}\[\]*?~!#]/;
// Exact first-line shape emitted for safe POSIX git commit/tag message heredocs.
// The git arguments before -m/--message are restricted to non-shell token chars.
const SAFE_POSIX_HEREDOC_FIRST_LINE = /^git[ \t]+(?:commit|tag)(?:[ \t]+[A-Za-z0-9_./:@%+=,-]+)*[ \t]+(?:-m|--message)[ \t]+"\$\(cat[ \t]+<<(-?)[ \t]*(['"])([A-Za-z_][A-Za-z0-9_]*)\2$/;
const DANGEROUS_POWERSHELL_CHARS = /[;&|`$(){}<>\n\r\t\0\[\]*?!#@,]/;
const SAFE_POWERSHELL_TOKEN = /^[A-Za-z0-9_./=+-]+$/;
const POWERSHELL_PROVIDER_PATH = /^[A-Za-z][A-Za-z0-9_-]*:/;
const SAFE_POWERSHELL_GIT_STATUS_FLAGS = new Set([
    '--short', '-s', '--branch', '-b', '--show-stash', '--long',
    '--porcelain', '-z', '-v', '-vv', '--verbose', '--ahead-behind',
    '--no-ahead-behind', '--renames', '--no-renames', '--ignored',
    '--untracked-files', '-u', '--column', '--no-column', '--find-renames',
    '--ignore-submodules', '--',
]);
const SAFE_POWERSHELL_GIT_STATUS_OPTIONS = [
    /^--porcelain=(?:v1|v2)$/,
    /^--untracked-files=(?:no|normal|all)$/,
    /^-u(?:no|normal|all)$/,
    /^--ignored=(?:no|traditional|matching)$/,
    /^--column=(?:always|never|auto)$/,
    /^--find-renames(?:=[0-9]+)?$/,
    /^--ignore-submodules=(?:none|untracked|dirty|all)$/,
];
const SAFE_POWERSHELL_GIT_DIFF_FLAGS = new Set([
    '--cached', '--staged', '--stat', '--shortstat', '--numstat',
    '--name-only', '--name-status', '--check', '--summary', '--patch', '-p',
    '--no-patch', '-s', '--raw', '--color', '--no-color', '--minimal',
    '--patience', '--histogram', '--word-diff', '--color-words',
    '--no-renames', '--find-renames', '-M', '--find-copies', '-C',
    '--full-index', '--binary', '--relative', '--no-relative', '--text', '-a',
    '--ignore-space-at-eol', '--ignore-space-change', '-b',
    '--ignore-all-space', '-w', '--ignore-blank-lines', '--exit-code',
    '--quiet', '--submodule', '--ignore-submodules', '--',
]);
const SAFE_POWERSHELL_GIT_DIFF_OPTIONS = [
    /^--color=(?:always|never|auto)$/,
    /^--word-diff=(?:plain|color|porcelain|none)$/,
    /^--diff-algorithm=(?:myers|minimal|patience|histogram)$/,
    /^--find-renames(?:=[0-9]+)?$/,
    /^--find-copies(?:=[0-9]+)?$/,
    /^--unified=[0-9]+$/,
    /^-U[0-9]+$/,
    /^--inter-hunk-context=[0-9]+$/,
    /^--abbrev=[0-9]+$/,
    /^--submodule=(?:short|log|diff)$/,
    /^--ignore-submodules=(?:none|untracked|dirty|all)$/,
];
const SAFE_POWERSHELL_GIT_LOG_FLAGS = new Set([
    '--oneline', '--graph', '--decorate', '--no-decorate', '--stat',
    '--shortstat', '--numstat', '--name-only', '--name-status', '--summary',
    '--all', '--branches', '--tags', '--remotes', '--first-parent',
    '--merges', '--no-merges', '--reverse', '--topo-order', '--date-order',
    '--author-date-order', '--full-history', '--simplify-merges', '--dense',
    '--sparse', '--boundary', '--cherry', '--cherry-mark', '--cherry-pick',
    '--left-right', '--walk-reflogs', '-g', '--reflog', '--patch', '-p',
    '--no-patch', '-s', '--color', '--no-color', '--',
]);
const SAFE_POWERSHELL_GIT_LOG_OPTIONS = [
    /^-[0-9]+$/,
    /^-n[0-9]+$/,
    /^--max-count=[0-9]+$/,
    /^--skip=[0-9]+$/,
    /^--pretty=(?:oneline|short|medium|full|fuller|reference|email|raw)$/,
    /^--decorate=(?:short|full|auto|no)$/,
    /^--color=(?:always|never|auto)$/,
    /^--date=(?:relative|local|iso|iso-strict|rfc|short|raw|human|unix)$/,
    /^--branches=[A-Za-z0-9._/+=-]+$/,
    /^--tags=[A-Za-z0-9._/+=-]+$/,
    /^--remotes=[A-Za-z0-9._/+=-]+$/,
];
const SAFE_POWERSHELL_GIT_SHOW_FLAGS = new Set([
    '--stat', '--shortstat', '--numstat', '--name-only', '--name-status',
    '--summary', '--oneline', '--decorate', '--no-decorate', '--patch', '-p',
    '--no-patch', '-s', '--raw', '--color', '--no-color', '--full-index',
    '--binary', '--first-parent', '--',
]);
const SAFE_POWERSHELL_GIT_SHOW_OPTIONS = [
    /^--pretty=(?:oneline|short|medium|full|fuller|reference|email|raw)$/,
    /^--decorate=(?:short|full|auto|no)$/,
    /^--color=(?:always|never|auto)$/,
    /^--unified=[0-9]+$/,
    /^-U[0-9]+$/,
    /^--abbrev=[0-9]+$/,
];
const SAFE_POWERSHELL_GIT_BRANCH_FLAGS = new Set([
    '-a', '--all', '-r', '--remotes', '--show-current', '-v', '-vv',
    '--verbose', '--color', '--no-color', '--column', '--no-column',
    '--ignore-case', '--no-abbrev', '--contains', '--no-contains', '--merged',
    '--no-merged',
]);
const SAFE_POWERSHELL_GIT_BRANCH_OPTIONS = [
    /^--color=(?:always|never|auto)$/,
    /^--column=(?:always|never|auto)$/,
    /^--sort=-?[A-Za-z0-9._/+=-]+$/,
    /^--abbrev=[0-9]+$/,
    /^--contains=[A-Za-z0-9._/+=-]+$/,
    /^--no-contains=[A-Za-z0-9._/+=-]+$/,
    /^--merged=[A-Za-z0-9._/+=-]+$/,
    /^--no-merged=[A-Za-z0-9._/+=-]+$/,
    /^--points-at=[A-Za-z0-9._/+=-]+$/,
    /^--list=[A-Za-z0-9][A-Za-z0-9._/-]*$/,
];
const SAFE_POWERSHELL_GIT_BRANCH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const SAFE_POWERSHELL_GIT_NUMERIC_VALUE = /^[0-9]+$/;
const SAFE_POWERSHELL_GIT_DIFF_NUMERIC_FLAGS = new Set([
    '-U',
    '--unified',
    '--inter-hunk-context',
    '--abbrev',
]);
const SAFE_POWERSHELL_GIT_LOG_NUMERIC_FLAGS = new Set([
    '-n',
    '--max-count',
    '--skip',
]);
const SAFE_POWERSHELL_GIT_SHOW_NUMERIC_FLAGS = new Set([
    '-U',
    '--unified',
    '--abbrev',
]);
const SAFE_POWERSHELL_PACKAGE_SCRIPTS = new Set([
    'lint',
    'build',
    'check',
    'typecheck',
]);
const SAFE_RIPGREP_FLAGS = new Set([
    '-n',
    '--line-number',
    '-S',
    '--smart-case',
    '-F',
    '--fixed-strings',
    '-i',
    '--ignore-case',
    '--no-heading',
]);
const BACKGROUND_MUTATION_SUBAGENTS = new Set([
    'executor',
    'designer',
    'writer',
    'debugger',
    'git-master',
    'test-engineer',
    'qa-tester',
    'document-specialist',
]);
function readPermissionStringEntries(filePath, key) {
    try {
        if (!fs.existsSync(filePath)) {
            return [];
        }
        const settings = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        const entries = settings?.permissions?.[key] ?? settings?.[key];
        return Array.isArray(entries) ? entries.filter((entry) => typeof entry === 'string') : [];
    }
    catch {
        return [];
    }
}
export function getClaudePermissionAllowEntries(directory) {
    const projectSettingsPath = path.join(directory, '.claude', 'settings.local.json');
    const globalConfigDir = getClaudeConfigDir();
    const candidatePaths = [
        projectSettingsPath,
        path.join(globalConfigDir, 'settings.local.json'),
        path.join(globalConfigDir, 'settings.json'),
    ];
    const allowEntries = new Set();
    for (const candidatePath of candidatePaths) {
        for (const entry of readPermissionStringEntries(candidatePath, 'allow')) {
            allowEntries.add(entry.trim());
        }
    }
    return [...allowEntries];
}
function hasGenericToolPermission(allowEntries, toolName) {
    return allowEntries.some(entry => entry === toolName || entry.startsWith(`${toolName}(`));
}
export function hasClaudePermissionApproval(directory, toolName, command) {
    const allowEntries = getClaudePermissionAllowEntries(directory);
    if (toolName !== 'Bash') {
        return hasGenericToolPermission(allowEntries, toolName);
    }
    if (allowEntries.includes('Bash')) {
        return true;
    }
    const trimmedCommand = command?.trim();
    if (!trimmedCommand) {
        return false;
    }
    return allowEntries.includes(`Bash(${trimmedCommand})`);
}
export function getClaudePermissionAskEntries(directory) {
    const projectSettingsPath = path.join(directory, '.claude', 'settings.local.json');
    const globalConfigDir = getClaudeConfigDir();
    const candidatePaths = [
        projectSettingsPath,
        path.join(globalConfigDir, 'settings.local.json'),
        path.join(globalConfigDir, 'settings.json'),
    ];
    const askEntries = new Set();
    for (const candidatePath of candidatePaths) {
        for (const entry of readPermissionStringEntries(candidatePath, 'ask')) {
            askEntries.add(entry.trim());
        }
    }
    return [...askEntries];
}
function commandMatchesPermissionPattern(command, pattern) {
    const trimmedPattern = pattern.trim();
    if (!trimmedPattern) {
        return false;
    }
    if (!trimmedPattern.includes('*')) {
        return command === trimmedPattern;
    }
    const normalizedPrefix = trimmedPattern.replace(/[\s:]*\*+$/, '').trimEnd();
    if (!normalizedPrefix) {
        return false;
    }
    if (!command.startsWith(normalizedPrefix)) {
        return false;
    }
    const nextChar = command.charAt(normalizedPrefix.length);
    return nextChar === '' || /[\s:=(["']/.test(nextChar);
}
export function hasClaudePermissionAsk(directory, toolName, command) {
    const askEntries = getClaudePermissionAskEntries(directory);
    if (toolName !== 'Bash') {
        return hasGenericToolPermission(askEntries, toolName);
    }
    const trimmedCommand = command?.trim();
    if (!trimmedCommand) {
        return false;
    }
    return askEntries.some(entry => {
        if (entry === 'Bash') {
            return true;
        }
        if (!entry.startsWith('Bash(') || !entry.endsWith(')')) {
            return false;
        }
        return commandMatchesPermissionPattern(trimmedCommand, entry.slice(5, -1));
    });
}
export function getBackgroundTaskPermissionFallback(directory, subagentType) {
    const normalizedSubagentType = subagentType?.trim().toLowerCase();
    if (!normalizedSubagentType || !BACKGROUND_MUTATION_SUBAGENTS.has(normalizedSubagentType)) {
        return { shouldFallback: false, missingTools: [] };
    }
    const missingTools = ['Edit', 'Write'].filter(toolName => !hasClaudePermissionApproval(directory, toolName));
    return {
        shouldFallback: missingTools.length > 0,
        missingTools,
    };
}
export function getBackgroundBashPermissionFallback(directory, command) {
    if (!command) {
        return { shouldFallback: false, missingTools: [] };
    }
    if (hasClaudePermissionAsk(directory, 'Bash', command)) {
        return { shouldFallback: true, missingTools: ['Bash'] };
    }
    if (isSafeAutoApprovedCommand(command, directory)) {
        return { shouldFallback: false, missingTools: [] };
    }
    return hasClaudePermissionApproval(directory, 'Bash', command)
        ? { shouldFallback: false, missingTools: [] }
        : { shouldFallback: true, missingTools: ['Bash'] };
}
function tokenizeShellCommand(command) {
    const tokens = [];
    let current = '';
    let quote = null;
    for (const char of command.trim()) {
        if (quote) {
            if (char === quote) {
                quote = null;
            }
            else {
                current += char;
            }
            continue;
        }
        if (char === '"' || char === "'") {
            quote = char;
            continue;
        }
        if (/\s/.test(char)) {
            if (current) {
                tokens.push(current);
                current = '';
            }
            continue;
        }
        current += char;
    }
    if (quote) {
        return null;
    }
    if (current) {
        tokens.push(current);
    }
    return tokens.length > 0 ? tokens : null;
}
function isSensitiveRepoRelativePath(repoRelativePath) {
    const normalized = repoRelativePath.replace(/\\/g, '/').replace(/^\.\//, '');
    if (!normalized || normalized === '.') {
        return false;
    }
    return (normalized === '.git' ||
        normalized.startsWith('.git/') ||
        normalized.includes('/.git/') ||
        normalized === '.ssh' ||
        normalized.startsWith('.ssh/') ||
        normalized.includes('/.ssh/') ||
        normalized === 'secrets' ||
        normalized.startsWith('secrets/') ||
        normalized.includes('/secrets/') ||
        normalized === '.env' ||
        normalized.startsWith('.env.') ||
        normalized.includes('/.env') ||
        normalized.includes('/.env.') ||
        normalized === 'node_modules/.cache' ||
        normalized.startsWith('node_modules/.cache/') ||
        normalized.includes('/node_modules/.cache/'));
}
function isSafeRepoPath(cwd, inputPath, options = {}) {
    const { allowDirectory = false, requireExisting = true } = options;
    if (!inputPath) {
        return false;
    }
    // Literal git toplevel (no submodule→superproject climb) so the containment
    // boundary stays the actual repo the path lives in (#3349 / PR #3350).
    const worktreeRoot = getGitTopLevel(cwd);
    if (!worktreeRoot) {
        return false;
    }
    const resolvedPath = path.resolve(cwd, inputPath);
    let canonicalPath = resolvedPath;
    const exists = fs.existsSync(resolvedPath);
    if (exists) {
        try {
            canonicalPath = fs.realpathSync(resolvedPath);
        }
        catch {
            return false;
        }
    }
    else if (requireExisting) {
        return false;
    }
    const relativePath = path.relative(worktreeRoot, canonicalPath);
    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
        return false;
    }
    if (!relativePath || relativePath === '.') {
        return allowDirectory;
    }
    if (isSensitiveRepoRelativePath(relativePath)) {
        return false;
    }
    if (!allowDirectory && exists) {
        try {
            if (fs.statSync(resolvedPath).isDirectory()) {
                return false;
            }
        }
        catch {
            return false;
        }
    }
    return true;
}
function areSafeRepoPaths(cwd, args, options = {}) {
    const pathArgs = args.filter(arg => arg !== '--');
    return pathArgs.length > 0 && pathArgs.every(arg => !arg.startsWith('-') && isSafeRepoPath(cwd, arg, options));
}
function isSafeCatCommand(tokens, cwd) {
    return tokens[0] === 'cat' && areSafeRepoPaths(cwd, tokens.slice(1));
}
function isSafeHeadOrTailCommand(tokens, cwd) {
    if (tokens[0] !== 'head' && tokens[0] !== 'tail') {
        return false;
    }
    let index = 1;
    if (tokens[index] === '-n') {
        index += 2;
    }
    else if (/^-n\d+$/.test(tokens[index] ?? '')) {
        index += 1;
    }
    return areSafeRepoPaths(cwd, tokens.slice(index));
}
function isSafeSedInspectionCommand(tokens, cwd) {
    if (tokens[0] !== 'sed' || tokens[1] !== '-n') {
        return false;
    }
    const script = tokens[2];
    if (!script || !/^\d+(,\d+)?p$/.test(script)) {
        return false;
    }
    return areSafeRepoPaths(cwd, tokens.slice(3));
}
function isSafeRipgrepInspectionCommand(tokens, cwd) {
    if (tokens[0] !== 'rg') {
        return false;
    }
    let index = 1;
    while (index < tokens.length) {
        const token = tokens[index];
        if (token === '--') {
            index += 1;
            break;
        }
        if (!token.startsWith('-')) {
            break;
        }
        if (!SAFE_RIPGREP_FLAGS.has(token)) {
            return false;
        }
        index += 1;
    }
    const pattern = tokens[index];
    if (!pattern || pattern.startsWith('-')) {
        return false;
    }
    const searchPaths = tokens.slice(index + 1);
    return areSafeRepoPaths(cwd, searchPaths, { allowDirectory: false });
}
function isSafeTargetedVitestCommand(tokens, cwd) {
    const supportedPrefixes = [
        ['vitest', 'run'],
        ['pnpm', 'vitest', 'run'],
        ['yarn', 'vitest', 'run'],
    ];
    const matchedPrefix = supportedPrefixes.find(prefix => prefix.every((part, index) => tokens[index] === part));
    if (!matchedPrefix) {
        return false;
    }
    const remaining = tokens.slice(matchedPrefix.length);
    return remaining.length === 1 && isSafeRepoPath(cwd, remaining[0], { allowDirectory: false });
}
function isSafeTargetedPackageManagerTestCommand(tokens, cwd) {
    const supportedPrefixes = [
        ['npm', 'test', '--', '--run'],
        ['npm', 'run', 'test', '--', '--run'],
        ['pnpm', 'test', '--', '--run'],
        ['pnpm', 'run', 'test', '--', '--run'],
        ['yarn', 'test', '--run'],
    ];
    const matchedPrefix = supportedPrefixes.find(prefix => prefix.every((part, index) => tokens[index] === part));
    if (!matchedPrefix) {
        return false;
    }
    const remaining = tokens.slice(matchedPrefix.length);
    return remaining.length === 1 && isSafeRepoPath(cwd, remaining[0], { allowDirectory: false });
}
function isSafeTargetedNodeTestCommand(tokens, cwd) {
    return tokens[0] === 'node'
        && tokens[1] === '--test'
        && tokens.length === 3
        && isSafeRepoPath(cwd, tokens[2], { allowDirectory: false });
}
export function isSafeRepoInspectionCommand(command, cwd) {
    const trimmed = command.trim();
    if (!trimmed || DANGEROUS_SHELL_CHARS.test(trimmed)) {
        return false;
    }
    const tokens = tokenizeShellCommand(trimmed);
    if (!tokens) {
        return false;
    }
    return isSafeCatCommand(tokens, cwd)
        || isSafeHeadOrTailCommand(tokens, cwd)
        || isSafeSedInspectionCommand(tokens, cwd)
        || isSafeRipgrepInspectionCommand(tokens, cwd);
}
export function isSafeTargetedLocalTestCommand(command, cwd) {
    const trimmed = command.trim();
    if (!trimmed || DANGEROUS_SHELL_CHARS.test(trimmed)) {
        return false;
    }
    const tokens = tokenizeShellCommand(trimmed);
    if (!tokens) {
        return false;
    }
    return isSafeTargetedVitestCommand(tokens, cwd)
        || isSafeTargetedPackageManagerTestCommand(tokens, cwd)
        || isSafeTargetedNodeTestCommand(tokens, cwd);
}
export function isSafeAutoApprovedCommand(command, cwd, shellDialect = 'posix') {
    if (shellDialect === 'powershell') {
        return isSafePowerShellCommand(command);
    }
    return isSafeCommand(command)
        || isSafeRepoInspectionCommand(command, cwd)
        || isSafeTargetedLocalTestCommand(command, cwd)
        || isHeredocWithSafeBase(command);
}
function normalizePowerShellExecutable(token) {
    const normalized = token.toLowerCase();
    if (normalized.endsWith('.exe') || normalized.endsWith('.cmd')) {
        return normalized.slice(0, -4);
    }
    return /^[a-z][a-z0-9-]*$/.test(normalized)
        ? normalized
        : undefined;
}
function isSafePowerShellPackageCommand(executable, tokens) {
    const firstArgument = tokens[1]?.toLowerCase();
    const secondArgument = tokens[2]?.toLowerCase();
    if (executable === 'npm') {
        return tokens.length === 3
            && firstArgument === 'run'
            && secondArgument !== undefined
            && SAFE_POWERSHELL_PACKAGE_SCRIPTS.has(secondArgument);
    }
    if (executable !== 'pnpm' && executable !== 'yarn') {
        return false;
    }
    if (tokens.length === 2) {
        return firstArgument !== undefined
            && SAFE_POWERSHELL_PACKAGE_SCRIPTS.has(firstArgument);
    }
    return tokens.length === 3
        && firstArgument === 'run'
        && secondArgument !== undefined
        && SAFE_POWERSHELL_PACKAGE_SCRIPTS.has(secondArgument);
}
function hasOnlySafePowerShellGitArguments(arguments_, safeFlags, safeOptions, numericValueFlags) {
    for (let index = 0; index < arguments_.length; index += 1) {
        const argument = arguments_[index];
        if (!argument) {
            return false;
        }
        if (numericValueFlags?.has(argument)) {
            const value = arguments_[index + 1];
            if (!value || !SAFE_POWERSHELL_GIT_NUMERIC_VALUE.test(value)) {
                return false;
            }
            index += 1;
            continue;
        }
        if (safeFlags.has(argument)
            || safeOptions.some(pattern => pattern.test(argument))
            || !argument.startsWith('-')) {
            continue;
        }
        return false;
    }
    return true;
}
function isSafePowerShellGitBranch(arguments_) {
    let listMode = false;
    for (const argument of arguments_) {
        if (argument === '--list' || argument === '-l') {
            listMode = true;
            continue;
        }
        if (SAFE_POWERSHELL_GIT_BRANCH_FLAGS.has(argument)
            || SAFE_POWERSHELL_GIT_BRANCH_OPTIONS.some(pattern => pattern.test(argument))) {
            continue;
        }
        if (listMode && SAFE_POWERSHELL_GIT_BRANCH_PATTERN.test(argument)) {
            continue;
        }
        return false;
    }
    return true;
}
function isSafePowerShellGitCommand(tokens) {
    const subcommand = tokens[1]?.toLowerCase();
    const arguments_ = tokens.slice(2);
    switch (subcommand) {
        case 'status':
            return hasOnlySafePowerShellGitArguments(arguments_, SAFE_POWERSHELL_GIT_STATUS_FLAGS, SAFE_POWERSHELL_GIT_STATUS_OPTIONS);
        case 'diff':
            return hasOnlySafePowerShellGitArguments(arguments_, SAFE_POWERSHELL_GIT_DIFF_FLAGS, SAFE_POWERSHELL_GIT_DIFF_OPTIONS, SAFE_POWERSHELL_GIT_DIFF_NUMERIC_FLAGS);
        case 'log':
            return hasOnlySafePowerShellGitArguments(arguments_, SAFE_POWERSHELL_GIT_LOG_FLAGS, SAFE_POWERSHELL_GIT_LOG_OPTIONS, SAFE_POWERSHELL_GIT_LOG_NUMERIC_FLAGS);
        case 'branch':
            return isSafePowerShellGitBranch(arguments_);
        case 'show':
            return hasOnlySafePowerShellGitArguments(arguments_, SAFE_POWERSHELL_GIT_SHOW_FLAGS, SAFE_POWERSHELL_GIT_SHOW_OPTIONS, SAFE_POWERSHELL_GIT_SHOW_NUMERIC_FLAGS);
        case 'fetch':
            return false;
        default:
            return false;
    }
}
/**
 * Match a deliberately small set of external executable invocations using
 * PowerShell token semantics. Aliases, providers, expressions, and shell
 * composition remain on the native permission path.
 */
export function isSafePowerShellCommand(command) {
    const trimmed = command.trim();
    if (!trimmed || DANGEROUS_POWERSHELL_CHARS.test(trimmed)) {
        return false;
    }
    const tokens = tokenizeShellCommand(trimmed);
    if (!tokens
        || tokens.some(token => !SAFE_POWERSHELL_TOKEN.test(token)
            || POWERSHELL_PROVIDER_PATH.test(token))) {
        return false;
    }
    const firstToken = tokens[0];
    if (!firstToken) {
        return false;
    }
    const executable = normalizePowerShellExecutable(firstToken);
    if (!executable) {
        return false;
    }
    if (executable === 'git') {
        return isSafePowerShellGitCommand(tokens);
    }
    if (isSafePowerShellPackageCommand(executable, tokens)) {
        return true;
    }
    if (executable === 'tsc') {
        return tokens.length === 1
            || (tokens.length === 2 && tokens[1] === '--noEmit');
    }
    if (executable === 'eslint') {
        return tokens.length === 2 && tokens[1] === '.';
    }
    if (executable === 'prettier') {
        return tokens.length === 3
            && (tokens[1] === '--check' || tokens[1] === '-c')
            && tokens[2] === '.';
    }
    return false;
}
/**
 * Check if a command matches safe patterns
 */
export function isSafeCommand(command) {
    const trimmed = command.trim();
    // SECURITY: Reject ANY command with shell metacharacters
    // These allow command chaining that bypasses safe pattern checks
    if (DANGEROUS_SHELL_CHARS.test(trimmed)) {
        return false;
    }
    return SAFE_PATTERNS.some(pattern => pattern.test(trimmed));
}
/**
 * Check if a command is a heredoc command with a safe base command.
 * Issue #608: Heredoc commands contain shell metacharacters (<<, \n, $, etc.)
 * that cause isSafeCommand() to reject them. When they fall through to Claude
 * Code's native permission flow and the user approves "Always allow", the entire
 * heredoc body (potentially hundreds of lines) gets stored in settings.local.json.
 *
 * The opener must terminate the first command line, the base command is limited
 * to a non-chained git commit/tag invocation, and the delimiter must be followed
 * only by the command-substitution close. Anything after that remains native.
 */
export function isHeredocWithSafeBase(command) {
    const trimmed = command.trim();
    const lines = trimmed.split(/\r?\n/);
    if (lines.length < 3) {
        return false;
    }
    const opener = lines[0].trim().match(SAFE_POSIX_HEREDOC_FIRST_LINE);
    if (!opener) {
        return false;
    }
    const stripsTabs = opener[1] === '-';
    const delimiter = opener[3];
    if (!delimiter) {
        return false;
    }
    let closingIndex = -1;
    for (let index = 1; index < lines.length; index += 1) {
        const line = stripsTabs ? lines[index].replace(/^\t*/, '') : lines[index];
        if (line === delimiter) {
            closingIndex = index;
            break;
        }
    }
    return closingIndex > 0
        && closingIndex === lines.length - 2
        && lines[closingIndex + 1].trim() === ')"';
}
/**
 * Check if an active mode (autopilot/ultrawork/ralph/team) is running
 */
export function isActiveModeRunning(directory) {
    const stateDir = path.join(getOmcRoot(directory), 'state');
    if (!fs.existsSync(stateDir)) {
        return false;
    }
    const activeStateFiles = [
        'autopilot-state.json',
        'ralph-state.json',
        'ultrawork-state.json',
        'team-state.json',
        'omc-teams-state.json',
    ];
    for (const stateFile of activeStateFiles) {
        const statePath = path.join(stateDir, stateFile);
        if (fs.existsSync(statePath)) {
            // JSON state files: check active/status fields
            try {
                const content = fs.readFileSync(statePath, 'utf-8');
                const state = JSON.parse(content);
                // Check if mode is active
                if (state.active === true || state.status === 'running' || state.status === 'active') {
                    return true;
                }
            }
            catch (_error) {
                // Ignore parse errors, continue checking
                continue;
            }
        }
    }
    return false;
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function canonicalShellRequest(input) {
    const nativeToolName = input.nativeToolName?.replace(/^proxy_/, '');
    const isClaudeShell = input.host === 'claude'
        && input.contract === 'claude-single'
        && nativeToolName === 'Bash'
        && input.shellDialect === 'posix';
    const isCopilotBash = input.host === 'copilot'
        && input.contract === 'copilot-1.0.72-1'
        && nativeToolName?.toLowerCase() === 'bash'
        && input.shellDialect === 'posix';
    const isCopilotPowerShell = input.host === 'copilot'
        && input.contract === 'copilot-1.0.72-1'
        && nativeToolName?.toLowerCase() === 'powershell'
        && input.shellDialect === 'powershell';
    if (input.canonicalToolName !== 'Bash'
        || (!isClaudeShell && !isCopilotBash && !isCopilotPowerShell)
        || typeof input.directory !== 'string'
        || input.directory.length === 0
        || !isRecord(input.toolInput)
        || typeof input.toolInput.command !== 'string'
        || input.toolInput.command.length === 0) {
        return undefined;
    }
    return {
        cwd: input.directory,
        command: input.toolInput.command,
        shellDialect: isClaudeShell || isCopilotBash ? 'posix' : 'powershell',
    };
}
function legacyShellRequest(input) {
    if (typeof input.tool_name !== 'string'
        || input.tool_name.replace(/^proxy_/, '') !== 'Bash'
        || typeof input.cwd !== 'string'
        || input.cwd.length === 0
        || !isRecord(input.tool_input)
        || typeof input.tool_input.command !== 'string'
        || input.tool_input.command.length === 0) {
        return undefined;
    }
    return {
        cwd: input.cwd,
        command: input.tool_input.command,
        shellDialect: 'posix',
    };
}
/**
 * Process permission request and decide whether to auto-allow.
 */
export function processPermissionRequest(input) {
    const isCopilotRequest = 'host' in input && input.host === 'copilot';
    const shellRequest = 'host' in input
        ? canonicalShellRequest(input)
        : legacyShellRequest(input);
    if (!shellRequest) {
        return { continue: true };
    }
    if (isCopilotRequest) {
        return { continue: true };
    }
    const { cwd, command, shellDialect } = shellRequest;
    const shouldAskBashPermission = hasClaudePermissionAsk(cwd, 'Bash', command);
    const isSafeHeredoc = shellDialect === 'posix'
        && isHeredocWithSafeBase(command);
    if (!shouldAskBashPermission
        && isSafeAutoApprovedCommand(command, cwd, shellDialect)) {
        const reason = isSafeHeredoc
            ? 'Safe command with heredoc content'
            : 'Safe read-only or test command';
        return {
            continue: true,
            hookSpecificOutput: {
                hookEventName: 'PermissionRequest',
                decision: {
                    behavior: 'allow',
                    reason,
                },
            },
        };
    }
    // Default: let normal permission flow handle it
    return { continue: true };
}
/**
 * Main hook entry point
 */
export async function handlePermissionRequest(input) {
    return processPermissionRequest(input);
}
//# sourceMappingURL=index.js.map