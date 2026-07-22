import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { MODE_CONFIRMATION_SKILL_MAP } from '../../lib/mode-names.js';
import { PRE_TOOL_EFFECT_PAYLOAD_VERSION, } from './types.js';
const BUILT_IN_TASK_LIST_TOOL_NAMES = new Set([
    'TaskCreate',
    'TaskUpdate',
    'TaskList',
    'TaskGet',
    'TaskOutput',
    'TaskStop',
]);
const AGENT_HEAVY_TOOLS = new Set(['Task', 'Agent']);
const FORCE_DELEGATION_RETENTION_SECONDS = 60 * 60;
const FORCE_DELEGATION_DEFAULT_WINDOW_SECONDS = 120;
const AWAITING_CONFIRMATION_TTL_MS = 2 * 60 * 1000;
const STATE_STALE_MS = 2 * 60 * 60 * 1000;
const TIER_ALIASES = new Set(['sonnet', 'opus', 'haiku', 'fable']);
const TIER_TO_DEFAULT_ENV_KEYS = {
    haiku: [
        'OMC_SUBAGENT_MODEL',
        'CLAUDE_CODE_BEDROCK_HAIKU_MODEL',
        'ANTHROPIC_DEFAULT_HAIKU_MODEL',
    ],
    sonnet: [
        'OMC_SUBAGENT_MODEL',
        'CLAUDE_CODE_BEDROCK_SONNET_MODEL',
        'ANTHROPIC_DEFAULT_SONNET_MODEL',
    ],
    opus: [
        'OMC_SUBAGENT_MODEL',
        'CLAUDE_CODE_BEDROCK_OPUS_MODEL',
        'ANTHROPIC_DEFAULT_OPUS_MODEL',
    ],
    fable: [
        'OMC_SUBAGENT_MODEL',
        'CLAUDE_CODE_BEDROCK_FABLE_MODEL',
        'ANTHROPIC_DEFAULT_FABLE_MODEL',
    ],
};
const SKILL_PROTECTION = {
    autopilot: 'none',
    autoresearch: 'none',
    ralph: 'none',
    ultragoal: 'none',
    ultrawork: 'none',
    team: 'none',
    'omc-teams': 'none',
    ultraqa: 'none',
    ralplan: 'none',
    'self-improve': 'none',
    cancel: 'none',
    trace: 'none',
    hud: 'none',
    'omc-doctor': 'none',
    'omc-help': 'none',
    'learn-about-omc': 'none',
    note: 'none',
    skill: 'light',
    ask: 'light',
    'configure-notifications': 'light',
    'omc-plan': 'medium',
    plan: 'medium',
    'deep-interview': 'heavy',
    review: 'medium',
    'external-context': 'medium',
    'ai-slop-cleaner': 'medium',
    sciomc: 'medium',
    skillify: 'medium',
    learner: 'medium',
    'omc-setup': 'medium',
    setup: 'medium',
    'mcp-setup': 'medium',
    'project-session-manager': 'medium',
    psm: 'medium',
    'writer-memory': 'medium',
    'ralph-init': 'medium',
    release: 'medium',
    ccg: 'medium',
    deepinit: 'heavy',
};
const SLOP_RISK_TOOL_NAMES = new Set([
    'Task',
    'TaskCreate',
    'TaskUpdate',
    'Agent',
    'Bash',
    'Edit',
    'MultiEdit',
    'Write',
    'NotebookEdit',
]);
const SLOP_FALLBACK_LANGUAGE_PATTERN = /\b(?:fallback|fall\s+back|workaround|work\s+around)\b/i;
const SLOP_FALLBACK_ACTION_PATTERNS = [
    /\b(?:add|build|create|implement|introduce|make|patch|use|using|write)\s+(?:an?\s+|the\s+)?(?:fallback|workaround)\b/i,
    /\b(?:fallback|workaround)\s+(?:layer|path|handler|shim|patch|implementation|mechanism|mode)\b/i,
    /\bworkaround\s+(?:it|this|that|the|a|an)\b/i,
    /\b(?:fall\s+back|fallback)\s+(?:to|on|onto)\b/i,
    /\bwork\s+around\s+(?:it|this|that|the|a|an)\b/i,
    /\bwork\s+around\s+(?!(?:it|this|that|the|a|an)\b)(?:[a-z0-9][\w-]*\s+){0,5}[a-z0-9][\w-]*\b/i,
    /(?:^|[\s"'`=:/\\])[\w.-]*(?:fallback|workaround)[\w.-]*\.(?:cjs|js|mjs|py|sh|ts|tsx)\b/i,
];
const SLOP_BENIGN_TECHNICAL_PATTERNS = [
    /\bfail[-\s]?soft\s+fallback(?:\s+(?:value|behavior|behaviour|result|semantics?))?\b/i,
    /\bfallback\s+(?:value|variable|parameter|argument|option|setting|config(?:uration)?|default)\b/i,
    /\bfallback\s+to\s+(?:the\s+)?default(?:\s+(?:config(?:uration)?|settings?|value|behavior|behaviour|option))?\b/i,
    /\b(?:workaround|work\s+around)\s+for\s+(?:commit|change|issue|bug|regression|version|release|pr|pull\s+request|#[0-9]+|[a-f0-9]{7,40}\b)/i,
    /\b(?:memory|sql|sqlite|mysql|postgres(?:ql)?|typescript|node|browser|runtime)\s+workaround\b/i,
];
const SLOP_DOC_CONTEXT_PATTERN = /(?:^|[/\\])(?:docs?|documentation|guides?|instructions?|prompts?|\.om[ctx])(?:[/\\]|$)|\.(?:md|mdx|txt|rst)$/i;
const SLOP_SELF_REFERENCE_PATH_PATTERN = /(?:^|[/\\])(?:pre-tool-enforcer(?:\.mjs)?|pre-tool-enforcer\.test\.ts)(?:$|[/\\])/i;
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function nonEmptyString(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function getAgentType(input) {
    return nonEmptyString(input.subagent_type)
        || nonEmptyString(input.agent_type);
}
function normalizeAgentType(agentType) {
    const normalized = agentType.replace(/^oh-my-claudecode:/, '');
    const aliases = {
        researcher: 'document-specialist',
        'tdd-guide': 'test-engineer',
        'api-reviewer': 'code-reviewer',
        'performance-reviewer': 'code-reviewer',
        'dependency-expert': 'document-specialist',
        'quality-strategist': 'code-reviewer',
        vision: 'document-specialist',
        'quality-reviewer': 'code-reviewer',
        'deep-executor': 'executor',
        'build-fixer': 'debugger',
        'harsh-critic': 'critic',
        reviewer: 'code-reviewer',
    };
    return aliases[normalized] ?? normalized;
}
function effectIntentId(snapshot, call, effectType, target) {
    return createHash('sha256')
        .update(snapshot.stateDir)
        .update('\0')
        .update(snapshot.sessionId)
        .update('\0')
        .update(snapshot.deliveryId)
        .update('\0')
        .update(call.id)
        .update('\0')
        .update(call.fingerprint)
        .update('\0')
        .update(effectType)
        .update('\0')
        .update(target)
        .digest('hex');
}
function hookEffect(call, type, payload, commitOn, critical = false) {
    return {
        type,
        payload,
        callId: call.id,
        commitOn,
        critical,
    };
}
function extractSkill(input) {
    if (!isRecord(input))
        return null;
    const rawSkillName = nonEmptyString(input.skill)
        || nonEmptyString(input.skill_name)
        || nonEmptyString(input.skillName)
        || nonEmptyString(input.command);
    if (!rawSkillName)
        return null;
    const skillName = rawSkillName.includes(':')
        ? rawSkillName.split(':').at(-1)?.toLowerCase() ?? ''
        : rawSkillName.toLowerCase();
    return skillName ? { skillName, rawSkillName } : null;
}
function skillProtection(skillName, rawSkillName) {
    if (!rawSkillName.toLowerCase().startsWith('oh-my-claudecode:')) {
        return 'none';
    }
    return SKILL_PROTECTION[skillName] ?? 'none';
}
function isBundledOmcSubagent(agentType) {
    return /^oh-my-claudecode:[a-zA-Z0-9_-]+$/.test(agentType);
}
function isProviderSpecificModelId(modelId) {
    if (/^((us|eu|ap|global)\.anthropic\.|anthropic\.claude)/i.test(modelId)) {
        return true;
    }
    if (/^arn:aws(-[^:]+)?:bedrock:/i.test(modelId))
        return true;
    return modelId.toLowerCase().startsWith('vertex_ai/');
}
function hasExtendedContextSuffix(modelId) {
    return /\[\d+[mk]\]$/i.test(modelId);
}
function isSubagentSafeModelId(modelId) {
    return isProviderSpecificModelId(modelId)
        && !hasExtendedContextSuffix(modelId);
}
function isTierAlias(modelId) {
    return TIER_ALIASES.has(modelId.toLowerCase());
}
function normalizeToCcAlias(model) {
    const lower = model.toLowerCase();
    if (lower.includes('opus'))
        return 'opus';
    if (lower.includes('sonnet'))
        return 'sonnet';
    if (lower.includes('haiku'))
        return 'haiku';
    if (lower.includes('fable'))
        return 'fable';
    return null;
}
function isBedrockProvider(snapshot) {
    if (snapshot.modelRouting.useBedrock)
        return true;
    const modelId = snapshot.modelRouting.claudeModel
        || snapshot.modelRouting.anthropicModel;
    if (/^((us|eu|ap|global)\.anthropic\.|anthropic\.claude)/i.test(modelId)) {
        return true;
    }
    return /^arn:aws(-[^:]+)?:bedrock:/i.test(modelId)
        && /:(inference-profile|application-inference-profile)\//i.test(modelId)
        && modelId.toLowerCase().includes('claude');
}
function isVertexProvider(snapshot) {
    if (snapshot.modelRouting.useVertex)
        return true;
    const modelId = snapshot.modelRouting.claudeModel
        || snapshot.modelRouting.anthropicModel;
    return modelId.toLowerCase().startsWith('vertex_ai/');
}
function isNonClaudeProvider(snapshot) {
    if (isBedrockProvider(snapshot) || isVertexProvider(snapshot))
        return true;
    const modelId = snapshot.modelRouting.claudeModel
        || snapshot.modelRouting.anthropicModel;
    if (modelId && !modelId.toLowerCase().includes('claude'))
        return true;
    if (snapshot.modelRouting.anthropicBaseUrl
        && !snapshot.modelRouting.anthropicBaseUrl.includes('anthropic.com')) {
        return true;
    }
    const activeModels = [
        snapshot.modelRouting.claudeModel,
        snapshot.modelRouting.anthropicModel,
    ].filter(Boolean);
    const hasNormalClaude = activeModels.some((model) => model.toLowerCase().includes('claude')
        && !isProviderSpecificModelId(model));
    return snapshot.modelRouting.forceInherit && !hasNormalClaude;
}
function resolveTierAliasToSafeModel(tierAlias, snapshot) {
    const keys = TIER_TO_DEFAULT_ENV_KEYS[tierAlias.toLowerCase()];
    if (!keys)
        return '';
    for (const key of keys) {
        const value = snapshot.modelRouting.tierEnvironment[key]?.trim() ?? '';
        const isAnthropicDefault = key.startsWith('ANTHROPIC_DEFAULT_');
        const isNativeClaudeCode = isAnthropicDefault || key.startsWith('CLAUDE_CODE_BEDROCK_');
        const valid = isNativeClaudeCode
            ? isProviderSpecificModelId(value)
                || (isAnthropicDefault
                    && value.length > 0
                    && isNonClaudeProvider(snapshot)
                    && !isBedrockProvider(snapshot)
                    && !isVertexProvider(snapshot))
            : isSubagentSafeModelId(value);
        if (value && valid)
            return value;
    }
    return '';
}
function formatPatchValue(value) {
    if (typeof value === 'string')
        return value;
    return JSON.stringify(value);
}
function requiredMutation(call, input, patch) {
    const instruction = `call ${call.id}: ${Object.entries(patch)
        .map(([key, value]) => `${key}=${formatPatchValue(value)}`)
        .join(', ')}`;
    return {
        input,
        requirement: 'required',
        retryHint: {
            instruction,
            patch,
        },
    };
}
/**
 * Pure model/default routing. All environment, config, and definition reads
 * are supplied by the immutable batch snapshot.
 */
export function evaluateModelRouting(call, envelope, snapshot) {
    if ((call.canonicalName !== 'Task' && call.canonicalName !== 'Agent')
        || !isRecord(call.input)) {
        return { warning: '' };
    }
    const input = call.input;
    const toolModel = nonEmptyString(input.model);
    const agentType = getAgentType(input);
    if (envelope.host === 'copilot' && isBundledOmcSubagent(agentType)) {
        const hasExplicitModel = Object.hasOwn(input, 'model')
            && input.model !== undefined
            && input.model !== null;
        const hasExplicitReasoning = (Object.hasOwn(input, 'reasoning_effort')
            && input.reasoning_effort !== undefined
            && input.reasoning_effort !== null)
            || (Object.hasOwn(input, 'reasoningEffort')
                && input.reasoningEffort !== undefined
                && input.reasoningEffort !== null);
        if (hasExplicitModel && hasExplicitReasoning)
            return { warning: '' };
        const updatedInput = { ...input };
        const patch = {};
        if (!hasExplicitModel) {
            updatedInput.model = snapshot.modelRouting.copilotDefaults.model;
            patch.model = snapshot.modelRouting.copilotDefaults.model;
        }
        if (!hasExplicitReasoning) {
            updatedInput.reasoning_effort =
                snapshot.modelRouting.copilotDefaults.reasoningEffort;
            patch.reasoning_effort =
                snapshot.modelRouting.copilotDefaults.reasoningEffort;
        }
        return {
            updatedInput,
            warning: hasExplicitReasoning
                ? ''
                : snapshot.modelRouting.copilotDefaults.warning,
        };
    }
    if (snapshot.modelRouting.forceInherit) {
        const claudeModel = snapshot.modelRouting.claudeModel;
        const anthropicModel = snapshot.modelRouting.anthropicModel;
        const sessionHasLmSuffix = hasExtendedContextSuffix(claudeModel)
            || hasExtendedContextSuffix(anthropicModel);
        const sessionModel = hasExtendedContextSuffix(claudeModel)
            ? claudeModel
            : hasExtendedContextSuffix(anthropicModel)
                ? anthropicModel
                : claudeModel || anthropicModel;
        if (toolModel) {
            if (!(isTierAlias(toolModel)
                && resolveTierAliasToSafeModel(toolModel, snapshot))
                && !isSubagentSafeModelId(toolModel)) {
                const tier = isTierAlias(toolModel)
                    ? toolModel.toUpperCase()
                    : (normalizeToCcAlias(toolModel) ?? '').toUpperCase();
                const guidance = tier
                    ? `Set ANTHROPIC_DEFAULT_${tier}_MODEL=<valid-bedrock-id> in settings.json env, or set OMC_SUBAGENT_MODEL as a global override.`
                    : 'Remove the `model` parameter, or set ANTHROPIC_DEFAULT_SONNET_MODEL=<valid-bedrock-id> in settings.json env.';
                return {
                    warning: '',
                    denyReason: `[MODEL ROUTING] This environment uses a non-standard provider (Bedrock/Vertex/proxy). ${guidance} `
                        + `The model "${toolModel}" is not valid for this provider.`,
                };
            }
        }
        else if (sessionHasLmSuffix) {
            const tierAlias = normalizeToCcAlias(sessionModel) || 'sonnet';
            const resolvedSafe = resolveTierAliasToSafeModel(tierAlias, snapshot);
            const suggestion = resolvedSafe
                ? `Pass model="${tierAlias}" explicitly on this ${call.canonicalName} call — tier aliases resolve cleanly on Bedrock.`
                : `Pass model="${tierAlias}" explicitly on this ${call.canonicalName} call, and set ANTHROPIC_DEFAULT_${tierAlias.toUpperCase()}_MODEL=<valid-bedrock-id> in settings.json env.`;
            return {
                warning: '',
                denyReason: `[MODEL ROUTING] Your session model "${sessionModel}" has a context-window suffix ([1m]) that sub-agents cannot inherit — `
                    + `the runtime strips it to a bare Anthropic model ID which is invalid on Bedrock. ${suggestion}`,
            };
        }
        if (!toolModel && nonEmptyString(input.subagent_type)) {
            const canonicalAgent = normalizeAgentType(nonEmptyString(input.subagent_type));
            const definitionModel = snapshot.modelRouting.agentDefinitionModels[canonicalAgent];
            const tierAlias = definitionModel
                ? normalizeToCcAlias(definitionModel)
                : null;
            const resolvedModel = tierAlias
                ? resolveTierAliasToSafeModel(tierAlias, snapshot)
                : '';
            if (definitionModel
                && !isSubagentSafeModelId(definitionModel)
                && !isTierAlias(definitionModel)
                && resolvedModel) {
                return {
                    warning: '',
                    denyReason: `[MODEL ROUTING] Agent type "${canonicalAgent}" has model "${definitionModel}" in its definition, `
                        + `which is not valid for this Bedrock/Vertex/proxy environment. `
                        + `Add model="${tierAlias}" to this ${call.canonicalName} call — tier aliases resolve to configured provider models (${resolvedModel}).`,
                };
            }
        }
        return { warning: '' };
    }
    if (!toolModel && agentType) {
        const canonicalAgent = normalizeAgentType(agentType);
        const configured = snapshot.modelRouting.configuredAgentModels[canonicalAgent];
        if (configured && configured !== 'inherit') {
            const normalizedModel = normalizeToCcAlias(configured);
            if (normalizedModel) {
                return {
                    updatedInput: { ...input, model: normalizedModel },
                    warning: '',
                };
            }
        }
    }
    return { warning: '' };
}
function normalizeText(value) {
    return nonEmptyString(value).replace(/\s+/g, ' ').toLowerCase();
}
function observedModeGeneration(state) {
    const meta = state && isRecord(state._meta) ? state._meta : null;
    const value = state?.generation ?? meta?.generation;
    return typeof value === 'number'
        && Number.isSafeInteger(value)
        && value >= 0
        ? value
        : null;
}
function observedModeOwnerSessionId(state) {
    const meta = state && isRecord(state._meta) ? state._meta : null;
    return nonEmptyString(meta?.sessionId)
        || nonEmptyString(state?.session_id);
}
function observedModeConfirmationTimestamp(state) {
    return state
        ? nonEmptyString(state.awaiting_confirmation_set_at)
            || nonEmptyString(state.started_at)
        : '';
}
function observedModeStateDigest(state) {
    return createHash('sha256')
        .update(JSON.stringify(state))
        .digest('hex');
}
function isAwaitingConfirmation(state, nowMs) {
    if (state.awaiting_confirmation !== true)
        return false;
    const timestamp = nonEmptyString(state.awaiting_confirmation_set_at)
        || nonEmptyString(state.started_at);
    if (!timestamp)
        return false;
    const timestampMs = new Date(timestamp).getTime();
    const age = nowMs - timestampMs;
    return Number.isFinite(age)
        && age >= 0
        && age < AWAITING_CONFIRMATION_TTL_MS;
}
function isStaleState(state, nowMs) {
    const timestamps = [
        state.last_checked_at,
        state.updated_at,
        state.started_at,
    ]
        .map((value) => new Date(nonEmptyString(value)).getTime())
        .filter(Number.isFinite);
    return timestamps.length === 0
        || nowMs - Math.max(...timestamps) > STATE_STALE_MS;
}
function isSingleShellCommand(command) {
    return command.trim().length > 0
        && !/[\n\r;&|`]|\$\(|<\(|>\(/.test(command);
}
function isCancelBootstrap(call) {
    const input = isRecord(call.input) ? call.input : {};
    if (call.canonicalName === 'Skill'
        && extractSkill(input)?.skillName === 'cancel') {
        return true;
    }
    if (call.canonicalName === 'ToolSearch')
        return true;
    if (call.canonicalName === 'Read') {
        const filePath = nonEmptyString(input.file_path) || nonEmptyString(input.path);
        const normalized = filePath.replace(/\\/g, '/');
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
    if (call.canonicalName !== 'Bash')
        return false;
    const command = nonEmptyString(input.command);
    return isSingleShellCommand(command)
        && /^(?:omc|oh-my-claudecode|gjc)\s+(?:state\s+(?:clear|read|write|list-active|get-status)|cancel)\b/.test(command);
}
function isUltragoalBootstrap(call) {
    const input = isRecord(call.input) ? call.input : {};
    if (call.canonicalName === 'Skill'
        && extractSkill(input)?.skillName === 'ultragoal') {
        return true;
    }
    if (call.canonicalName !== 'Bash')
        return false;
    const command = nonEmptyString(input.command);
    return isSingleShellCommand(command)
        && /^(?:omc|oh-my-claudecode)\s+ultragoal\s+(?:create(?:-goals)?|complete(?:-goals)?|next|start-next|status|checkpoint|record-review-blockers)\b/.test(command);
}
/**
 * Pure ultragoal gate using only the immutable state/goal snapshot.
 */
export function evaluateUltragoal(call, snapshot) {
    if (snapshot.environment.ALLOW_ULTRAGOAL_WITHOUT_GOAL === '1') {
        return undefined;
    }
    if (isUltragoalBootstrap(call) || isCancelBootstrap(call))
        return undefined;
    const state = snapshot.ultragoal.state;
    if (!state || state.active !== true)
        return undefined;
    if (isStaleState(state, snapshot.loadedAtMs))
        return undefined;
    const projectPath = nonEmptyString(state.project_path);
    if (projectPath
        && resolve(projectPath) !== resolve(snapshot.directory)) {
        return undefined;
    }
    if (snapshot.ultragoal.terminal)
        return undefined;
    if (isAwaitingConfirmation(state, snapshot.loadedAtMs))
        return undefined;
    const expected = snapshot.ultragoal.expectedObjective;
    const actual = snapshot.ultragoal.goal;
    const actualObjective = normalizeText(actual?.objective);
    const expectedObjective = normalizeText(expected);
    const status = normalizeText(actual?.status);
    const activeStatus = status === ''
        || status === 'active'
        || status === 'in_progress'
        || status === 'running';
    if (!expectedObjective && actualObjective && activeStatus)
        return undefined;
    if (actualObjective
        && expectedObjective
        && actualObjective === expectedObjective
        && activeStatus) {
        return undefined;
    }
    const mismatch = actualObjective
        ? `current Claude /goal appears unrelated: "${actual?.objective}".`
        : 'no active Claude /goal snapshot was visible to the hook.';
    return `[ULTRAGOAL /GOAL REQUIRED] Active ultragoal state requires the matching Claude /goal before tools run; ${mismatch} `
        + 'Activate /goal with the ultragoal objective, or set ALLOW_ULTRAGOAL_WITHOUT_GOAL=1 to bypass this guard intentionally. '
        + `Expected objective: ${expected || '<record one in ultragoal-state.json or .omc/ultragoal/goals.json>'}`;
}
function patternMatches(pattern, toolName) {
    if (!pattern)
        return false;
    try {
        return new RegExp(`^(?:${pattern})$`).test(toolName);
    }
    catch {
        return false;
    }
}
function forceDelegationReason(rule, observed, toolName, windowSeconds, count) {
    return rule.denyMessage
        || `[OMC] Force-agent-delegation: ${observed} ${toolName} in last ${windowSeconds}s `
            + `(threshold ${count}). Delegate to an Agent instead. `
            + `Bypass: ${rule.bypassEnv || 'ALLOW_RAW_READ'}=1.`;
}
/**
 * Pure force-delegation fold. The returned ledger includes the current call,
 * so later calls in the same batch observe preceding attempts in host order.
 */
export function evaluateForceDelegationPure(call, snapshot, ledger) {
    const config = snapshot.forceDelegation;
    if (!config?.enforce) {
        return { nextLedger: ledger };
    }
    const cutoff = snapshot.observedAtSec - FORCE_DELEGATION_RETENTION_SECONDS;
    const intentId = effectIntentId(snapshot, call, 'pretool.force-delegation-attempt.v1', call.canonicalName);
    const currentEvent = {
        toolName: call.canonicalName,
        observedAtSec: snapshot.observedAtSec,
        originalIndex: call.originalIndex,
        intentId,
    };
    const retainedEvents = ledger.events.filter((event) => event.observedAtSec > cutoff
        && event.observedAtSec <= snapshot.observedAtSec);
    const existingIndex = retainedEvents.findIndex((event) => event.intentId === intentId);
    const events = existingIndex >= 0
        ? retainedEvents
        : [...retainedEvents, currentEvent];
    const nextLedger = {
        events,
    };
    const payload = {
        version: PRE_TOOL_EFFECT_PAYLOAD_VERSION,
        intentId,
        originalIndex: call.originalIndex,
        stateDir: snapshot.stateDir,
        toolName: call.canonicalName,
        observedAtSec: snapshot.observedAtSec,
    };
    const effect = hookEffect(call, 'pretool.force-delegation-attempt.v1', payload, 'always');
    for (const rule of config.rules) {
        if (!patternMatches(rule.pattern, call.canonicalName))
            continue;
        if (rule.bypassEnv
            && snapshot.environment[rule.bypassEnv] === '1') {
            continue;
        }
        const count = Number.isFinite(rule.threshold?.count)
            ? Number(rule.threshold?.count)
            : 0;
        const windowSeconds = Number.isFinite(rule.threshold?.windowSeconds)
            ? Number(rule.threshold?.windowSeconds)
            : FORCE_DELEGATION_DEFAULT_WINDOW_SECONDS;
        if (count <= 0)
            continue;
        const windowCutoff = snapshot.observedAtSec - windowSeconds;
        const observed = nextLedger.events.filter((event) => event.observedAtSec > windowCutoff
            && patternMatches(rule.pattern, event.toolName)).length;
        if (observed >= count) {
            return {
                nextLedger,
                effect,
                denyReason: forceDelegationReason(rule, observed, call.canonicalName, windowSeconds, count),
            };
        }
    }
    return { nextLedger, effect };
}
function collectStringValues(value, output = [], depth = 0) {
    if (depth > 5 || output.length > 100)
        return output;
    if (typeof value === 'string') {
        output.push(value);
        return output;
    }
    if (Array.isArray(value)) {
        for (const item of value)
            collectStringValues(item, output, depth + 1);
        return output;
    }
    if (isRecord(value)) {
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
    if (depth > 5 || output.length > 100 || !isRecord(value))
        return output;
    for (const [key, child] of Object.entries(value)) {
        if (typeof child === 'string'
            && /(?:^|_)(?:file_?path|path|filename|target|command)$/i.test(key)) {
            output.push(child);
            continue;
        }
        if (Array.isArray(child)) {
            for (const item of child) {
                if (isRecord(item))
                    collectLikelyPathValues(item, output, depth + 1);
            }
        }
        else if (isRecord(child)) {
            collectLikelyPathValues(child, output, depth + 1);
        }
    }
    return output;
}
function stripSlopQuotedAndCodeContexts(text) {
    return text
        .replace(/```[\s\S]*?```/g, '\n')
        .replace(/`[^`\r\n]*`/g, ' ')
        .replace(/(["'])(?:\\.|(?!\1)[^\\\r\n])*\1/g, ' ');
}
function removeBenignSlopSpans(text) {
    return SLOP_BENIGN_TECHNICAL_PATTERNS.reduce((result, pattern) => {
        const flags = pattern.flags.includes('g')
            ? pattern.flags
            : `${pattern.flags}g`;
        return result.replace(new RegExp(pattern.source, flags), ' ');
    }, text);
}
function generateSlopWarning(call, envelope) {
    if (!SLOP_RISK_TOOL_NAMES.has(call.canonicalName))
        return '';
    const promptValues = [
        ...(envelope.eventPayload.promptAliases ?? []),
        envelope.eventPayload.message,
    ];
    const inspectedText = [
        ...collectStringValues(call.input),
        ...collectStringValues(promptValues),
    ].join('\n');
    if (!SLOP_FALLBACK_LANGUAGE_PATTERN.test(inspectedText))
        return '';
    const paths = collectLikelyPathValues(call.input);
    if (paths.some((value) => SLOP_SELF_REFERENCE_PATH_PATTERN.test(value))) {
        return '';
    }
    if (paths.some((value) => SLOP_DOC_CONTEXT_PATTERN.test(value)))
        return '';
    const hasAction = stripSlopQuotedAndCodeContexts(inspectedText)
        .split(/[\r\n!?;]+/)
        .map((segment) => segment.trim())
        .filter(Boolean)
        .some((segment) => SLOP_FALLBACK_ACTION_PATTERNS.some((pattern) => pattern.test(removeBenignSlopSpans(segment))));
    if (!hasAction)
        return '';
    return '[SLOP WARNING] Detected fallback/workaround language in this tool input. '
        + 'Do not make potential slop: avoid ad-hoc fallback layers, workaround shims, or environment-specific patches unless explicitly justified. '
        + 'For architecture concerns, consult the architect for a concrete design first. '
        + 'If this seems environment-specific, ask the user to confirm constraints before proceeding.';
}
function generateAgentMessage(input, snapshot) {
    if (!input) {
        return snapshot.quietLevel >= 2
            ? ''
            : `${snapshot.todo.label}Launch multiple agents in parallel when tasks are independent. Use run_in_background for long operations.`;
    }
    const agentType = getAgentType(input) || 'unknown';
    const model = nonEmptyString(input.model) || 'inherit';
    const description = nonEmptyString(input.description);
    const background = input.run_in_background === true || input.mode === 'background'
        ? ' [BACKGROUND]'
        : '';
    if (snapshot.team.active && !nonEmptyString(input.name)) {
        const teamName = snapshot.team.teamName || 'team';
        return `[TEAM ROUTING REQUIRED] Team "${teamName}" is active but you are spawning an unnamed subagent. `
            + `Claude Code 2.1.178+ uses the session's implicit native agent team; TeamCreate and TeamDelete are removed. `
            + `Spawn teammates directly with Agent/Task name="worker-N" and subagent_type="${agentType}". `
            + 'Do NOT rely on team_name for routing; native Claude Code accepts it only as ignored legacy metadata.';
    }
    if (snapshot.quietLevel >= 2)
        return '';
    const parts = [
        `${snapshot.todo.label}Spawning agent: ${agentType} (${model})${background}`,
    ];
    if (description)
        parts.push(`Task: ${description}`);
    if (snapshot.tracking.running > 0) {
        parts.push(`Active agents: ${snapshot.tracking.running}`);
    }
    return parts.join(' | ');
}
function generateToolMessage(toolName, snapshot) {
    if (snapshot.quietLevel >= 1
        && ['Bash', 'Edit', 'Write', 'Read', 'Grep', 'Glob'].includes(toolName)) {
        return '';
    }
    if (snapshot.quietLevel >= 2 && toolName === 'TodoWrite')
        return '';
    const prefix = snapshot.todo.label;
    const messages = {
        TodoWrite: `${prefix}Mark todos in_progress BEFORE starting, completed IMMEDIATELY after finishing.`,
        Bash: `${prefix}Use parallel execution for independent tasks. Use run_in_background for long operations (npm install, builds, tests).`,
        Edit: `${prefix}Verify changes work after editing. Test functionality before marking complete.`,
        Write: `${prefix}Verify changes work after editing. Test functionality before marking complete.`,
        Read: `${prefix}Read multiple files in parallel when possible for faster analysis.`,
        Grep: `${prefix}Combine searches in parallel when investigating multiple patterns.`,
        Glob: `${prefix}Combine searches in parallel when investigating multiple patterns.`,
    };
    if (messages[toolName])
        return messages[toolName];
    return snapshot.modeActive
        ? `${prefix}The boulder never stops. Continue until all tasks complete.`
        : '';
}
function combineMessages(...messages) {
    return messages.filter(Boolean).join('\n\n');
}
function extractAskUserQuestion(input) {
    if (!isRecord(input) || !Array.isArray(input.questions)) {
        return 'User input requested';
    }
    const questions = input.questions
        .map((question) => isRecord(question) ? nonEmptyString(question.question) : '')
        .filter(Boolean);
    return questions.join('; ') || 'User input requested';
}
/**
 * Build a typed advisory claim without reading or writing throttle state.
 */
export function buildAdvisoryCandidate(call, snapshot, message) {
    if (!message)
        return undefined;
    const messageHash = createHash('sha256').update(message).digest('hex');
    const intentId = effectIntentId(snapshot, call, 'pretool.advisory-claim.v1', messageHash);
    return {
        message,
        messageHash,
        intentId,
        effect: hookEffect(call, 'pretool.advisory-claim.v1', {
            version: PRE_TOOL_EFFECT_PAYLOAD_VERSION,
            intentId,
            originalIndex: call.originalIndex,
            stateDir: snapshot.stateDir,
            sessionId: snapshot.sessionId,
            message,
            messageHash,
            nowMs: snapshot.advisoryThrottle.nowMs,
            cooldownMs: snapshot.advisoryThrottle.cooldownMs,
        }, 'accepted'),
    };
}
function buildPreflightReason(snapshot) {
    return `[OMC] Preflight context guard: ${snapshot.transcript.contextPercent}% used `
        + `(threshold: ${snapshot.transcript.contextThreshold}%). Avoid spawning additional agent-heavy tasks `
        + 'until context is reduced. Safe recovery: (1) pause new Task fan-out, (2) run /compact now, '
        + '(3) if compact fails, open a fresh session and continue from .omc/state + .omc/notepad.md.';
}
function deniedCallPlan(call, reason, effects, nextLedger, presentationKind = 'hook-deny', mutation) {
    const evaluation = {
        callId: call.id,
        source: 'handler',
        decision: 'deny',
        reason,
        ...(mutation ? { mutation } : {}),
        contexts: [],
        effects,
    };
    const legacyPresentation = {
        kind: presentationKind,
        callId: call.id,
        reason,
    };
    return {
        call,
        evaluation,
        legacyPresentation,
        nextForceDelegationLedger: nextLedger,
    };
}
/**
 * Evaluate one canonical call without any filesystem, environment, clock,
 * subprocess, import, notification, or trace access.
 */
export function evaluatePreToolCall(call, envelope, snapshot, ledger) {
    if (snapshot.disabled) {
        return {
            call,
            evaluation: {
                callId: call.id,
                source: 'handler',
                decision: 'pass',
                contexts: [],
                effects: [],
            },
            legacyPresentation: { kind: 'continue', callId: call.id },
            nextForceDelegationLedger: ledger,
        };
    }
    const effects = [];
    if (call.canonicalName === 'Skill') {
        const skill = extractSkill(call.input);
        if (skill) {
            if (snapshot.directory && snapshot.sessionId) {
                const intentId = effectIntentId(snapshot, call, 'pretool.trace-skill-attempt.v1', skill.rawSkillName);
                const payload = {
                    version: PRE_TOOL_EFFECT_PAYLOAD_VERSION,
                    intentId,
                    originalIndex: call.originalIndex,
                    directory: snapshot.directory,
                    sessionId: snapshot.sessionId,
                    skillName: skill.skillName,
                    rawSkillName: skill.rawSkillName,
                    observedAt: snapshot.observedAt,
                    observedAtMs: snapshot.loadedAtMs,
                };
                effects.push(hookEffect(call, 'pretool.trace-skill-attempt.v1', payload, 'always'));
            }
            const protection = skillProtection(skill.skillName, skill.rawSkillName);
            if (protection !== 'none') {
                const intentId = effectIntentId(snapshot, call, 'pretool.support-skill-upsert.v1', skill.skillName);
                const payload = {
                    version: PRE_TOOL_EFFECT_PAYLOAD_VERSION,
                    intentId,
                    originalIndex: call.originalIndex,
                    directory: snapshot.directory,
                    sessionId: snapshot.sessionId,
                    skillName: skill.skillName,
                    rawSkillName: skill.rawSkillName,
                    protection,
                    observedAt: snapshot.observedAt,
                };
                effects.push(hookEffect(call, 'pretool.support-skill-upsert.v1', payload, 'accepted'));
            }
            for (const modeName of MODE_CONFIRMATION_SKILL_MAP[skill.skillName] ?? []) {
                const observation = snapshot.modeStates[modeName] ?? {
                    path: '',
                    state: null,
                };
                const intentId = effectIntentId(snapshot, call, 'pretool.mode-confirm.v1', modeName);
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
                    observedStateDigest: observedModeStateDigest(observation.state),
                };
                effects.push(hookEffect(call, 'pretool.mode-confirm.v1', payload, 'accepted', true));
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
    const mutation = modelRouting.updatedInput
        ? requiredMutation(call, modelRouting.updatedInput, Object.fromEntries(Object.entries(modelRouting.updatedInput).filter(([key, value]) => !isRecord(call.input) || call.input[key] !== value)))
        : undefined;
    if (call.canonicalName === 'AskUserQuestion') {
        const question = extractAskUserQuestion(call.input);
        const intentId = effectIntentId(snapshot, call, 'pretool.ask-user-notify.v1', question);
        const payload = {
            version: PRE_TOOL_EFFECT_PAYLOAD_VERSION,
            intentId,
            originalIndex: call.originalIndex,
            directory: snapshot.directory,
            sessionId: snapshot.sessionId,
            question,
        };
        effects.push(hookEffect(call, 'pretool.ask-user-notify.v1', payload, 'accepted'));
    }
    const forceDelegation = evaluateForceDelegationPure(call, snapshot, ledger);
    if (forceDelegation.effect)
        effects.push(forceDelegation.effect);
    if (forceDelegation.denyReason) {
        return deniedCallPlan(call, forceDelegation.denyReason, effects, forceDelegation.nextLedger, 'hook-deny', mutation);
    }
    if (AGENT_HEAVY_TOOLS.has(call.canonicalName)
        && snapshot.transcript.contextPercent >=
            snapshot.transcript.contextThreshold) {
        return deniedCallPlan(call, buildPreflightReason(snapshot), effects, forceDelegation.nextLedger, 'raw-block', mutation);
    }
    let advisoryCandidate;
    if (!BUILT_IN_TASK_LIST_TOOL_NAMES.has(call.canonicalName)) {
        const effectiveInput = modelRouting.updatedInput
            ?? (isRecord(call.input) ? call.input : null);
        const baseMessage = call.canonicalName === 'Task' || call.canonicalName === 'Agent'
            ? generateAgentMessage(effectiveInput, snapshot)
            : generateToolMessage(call.canonicalName, snapshot);
        const message = combineMessages(modelRouting.warning, generateSlopWarning(call, envelope), baseMessage);
        advisoryCandidate = buildAdvisoryCandidate(call, snapshot, message);
        if (advisoryCandidate)
            effects.push(advisoryCandidate.effect);
    }
    const evaluation = {
        callId: call.id,
        source: 'handler',
        decision: 'pass',
        ...(mutation ? { mutation } : {}),
        contexts: [],
        effects,
    };
    let legacyPresentation;
    if (advisoryCandidate) {
        legacyPresentation = {
            kind: 'context',
            callId: call.id,
            context: advisoryCandidate.message,
            ...(modelRouting.updatedInput
                ? { updatedInput: modelRouting.updatedInput }
                : {}),
            advisoryIntentId: advisoryCandidate.intentId,
        };
    }
    else if (modelRouting.updatedInput) {
        legacyPresentation = {
            kind: 'suppressed-with-mutation',
            callId: call.id,
            updatedInput: modelRouting.updatedInput,
        };
    }
    else {
        legacyPresentation = {
            kind: 'suppressed',
            callId: call.id,
        };
    }
    return {
        call,
        evaluation,
        legacyPresentation,
        nextForceDelegationLedger: forceDelegation.nextLedger,
        ...(advisoryCandidate ? { advisoryCandidate } : {}),
    };
}
function hasBatchSafetyIssue(envelope) {
    return envelope.issues.some((issue) => issue.batchSafety === true
        || (issue.scope === 'batch' && issue.severity === 'safety'));
}
/**
 * Fold canonical calls in original host order while threading the virtual
 * force-delegation ledger. Duplicate advisory messages are claimed once.
 */
export function planPreToolBatch(envelope, snapshot) {
    if (hasBatchSafetyIssue(envelope)) {
        return {
            envelope,
            snapshot,
            calls: [],
            evaluations: [],
            legacyPresentations: [],
            finalForceDelegationLedger: snapshot.forceDelegationLedger,
        };
    }
    let ledger = snapshot.forceDelegationLedger;
    const seenAdvisoryHashes = new Set();
    const calls = [];
    for (const call of [...envelope.toolCalls]
        .filter((candidate) => !candidate.malformed)
        .sort((left, right) => left.originalIndex - right.originalIndex)) {
        let plan = evaluatePreToolCall(call, envelope, snapshot, ledger);
        ledger = plan.nextForceDelegationLedger;
        const advisory = plan.advisoryCandidate;
        if (advisory && seenAdvisoryHashes.has(advisory.messageHash)) {
            const effects = (plan.evaluation.effects ?? []).filter((effect) => effect.type !== 'pretool.advisory-claim.v1');
            const updatedInput = plan.legacyPresentation.kind === 'context'
                ? plan.legacyPresentation.updatedInput
                : undefined;
            plan = {
                ...plan,
                evaluation: {
                    ...plan.evaluation,
                    effects,
                },
                legacyPresentation: updatedInput
                    ? {
                        kind: 'suppressed-with-mutation',
                        callId: call.id,
                        updatedInput,
                    }
                    : {
                        kind: 'suppressed',
                        callId: call.id,
                    },
                advisoryCandidate: undefined,
            };
        }
        else if (advisory) {
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
        finalForceDelegationLedger: ledger,
    };
}
//# sourceMappingURL=evaluate.js.map