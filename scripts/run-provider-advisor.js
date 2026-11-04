#!/usr/bin/env node
import { hardenWindowsExeSearch } from './lib/windows-search.mjs';
import { spawnSync } from 'child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { mkdir, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import process from 'process';
import { resolveOmcStateRoot } from './lib/state-root.mjs';

hardenWindowsExeSearch();

const PROVIDER_BINARIES = {
  claude: 'claude',
  codex: 'codex',
  gemini: 'gemini',
  antigravity: 'agy',
  grok: 'grok',
  cursor: 'cursor-agent',
  copilot: 'copilot',
  muse: 'muse',
};

// muse and grok parse a prompt value that begins with `-` (e.g. the YAML
// frontmatter `---` that every `--agent-prompt` role file starts with) as an
// option and abort before calling the model, and grok reserves stdin for ACP
// JSON-RPC. Both accept `--prompt-file`, so hand them the prompt in a private
// temp file instead of argv or stdin.
const PROMPT_FILE_PROVIDERS = new Set(['muse', 'grok']);
const SHOULD_USE_WINDOWS_SHELL = process.platform === 'win32';
const COPILOT_DEFAULT_MODEL = 'gpt-5.6-sol';
const COPILOT_DEFAULT_REASONING_EFFORT = 'max';
const COPILOT_REASONING_EFFORTS = new Set([
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]);

function nonEmpty(value) {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function resolveCopilotModel(env = process.env) {
  return nonEmpty(env.OMC_EXTERNAL_MODELS_DEFAULT_COPILOT_MODEL)
    ?? nonEmpty(env.OMC_COPILOT_DEFAULT_MODEL)
    ?? COPILOT_DEFAULT_MODEL;
}

function resolveCopilotReasoningEffort(env = process.env) {
  const raw = nonEmpty(env.OMC_COPILOT_REASONING_EFFORT)
    ?? COPILOT_DEFAULT_REASONING_EFFORT;
  const normalized = raw.toLowerCase();
  if (!COPILOT_REASONING_EFFORTS.has(normalized)) {
    throw new Error(
      `Copilot reasoning effort: invalid value "${raw}". Allowed: ${Array.from(COPILOT_REASONING_EFFORTS).join(', ')}`,
    );
  }
  return normalized;
}

// Antigravity (`agy`) headless print mode has a known upstream non-TTY bug
// (google-antigravity/antigravity-cli#76) that, beyond the empty-exit-0 case,
// can hang indefinitely — and agy's own `--print-timeout` flag is non-functional.
// Bound the subprocess ourselves so a hang fails cleanly instead of blocking the
// whole `omc ask` / `/ccg` flow forever. Generous so it never trips a real answer.
// The kill MUST be SIGKILL: spawnSync does not return until the child exits, so a
// catchable SIGTERM would let a signal-trapping agy hang past the timeout.
const ANTIGRAVITY_TIMEOUT_DEFAULT_MS = 300000;
const ANTIGRAVITY_TIMEOUT_KILL_SIGNAL = 'SIGKILL';
const ANTIGRAVITY_TIMEOUT_MS = (() => {
  const raw = process.env.OMC_ANTIGRAVITY_TIMEOUT_MS;
  if (raw === undefined || raw === '') {
    return ANTIGRAVITY_TIMEOUT_DEFAULT_MS;
  }
  const parsed = Number(raw);
  // Require a finite, integer, >=1000ms value; clamp to <=1h. Otherwise warn and
  // fall back to the default so a bad override can't disable or distort the bound.
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 1000) {
    console.error(`[ask-antigravity] Ignoring invalid OMC_ANTIGRAVITY_TIMEOUT_MS="${raw}" (need an integer >= 1000); using ${ANTIGRAVITY_TIMEOUT_DEFAULT_MS}ms.`);
    return ANTIGRAVITY_TIMEOUT_DEFAULT_MS;
  }
  return Math.min(parsed, 3600000);
})();

/**
 * Build CLI args for a given provider.
 * - claude: `claude -p <prompt>` (or `claude -p` reading the prompt from stdin)
 * - codex: `codex exec --dangerously-bypass-approvals-and-sandbox <prompt>`
 * - gemini: `gemini -p <prompt> --yolo`
 * - antigravity: `agy --dangerously-skip-permissions -p <prompt>` (Antigravity CLI;
 *   `-p` takes the prompt as its value and cannot read it from stdin, so the
 *   prompt is always passed as an arg with approval flags first)
 * - grok: `grok --prompt-file <file> --always-approve` (single-turn headless
 *   mode; grok's stdin is reserved for ACP JSON-RPC, never the prompt)
 * - cursor: `cursor-agent --print --force --trust --sandbox disabled <prompt>`
 * - copilot: deterministic, autonomous prompt mode with configurable model and effort defaults
 * - muse: `muse exec --prompt-file <file> --approval-mode never --user-input-auto-resolve`
 *   (headless; preserves Muse's configured sandbox behavior)
 */
function buildProviderArgs(provider, prompt, { pipePromptViaStdin = false, promptFile } = {}) {
  if (provider === 'codex') {
    return ['exec', '--dangerously-bypass-approvals-and-sandbox', pipePromptViaStdin ? '-' : prompt];
  }
  if (provider === 'gemini') {
    return pipePromptViaStdin ? ['--yolo'] : ['-p', prompt, '--yolo'];
  }
  if (provider === 'antigravity') {
    // Antigravity (`agy`): `-p`/`--print` takes the prompt as its VALUE (next
    // token), not as a boolean, and it does NOT read the prompt from stdin
    // (`agy -p` with no value errors "flag needs an argument"). So always pass
    // the prompt as the `-p` value with approval flags first.
    // Verified on agy 1.0.10.
    return ['--dangerously-skip-permissions', '-p', prompt];
  }
  if (provider === 'grok') {
    // Grok's stdin is for ACP JSON-RPC, not the prompt, and `-p <prompt>` rejects
    // a dash-leading prompt, so the prompt always arrives via --prompt-file.
    return ['--prompt-file', promptFile, '--always-approve'];
  }
  if (provider === 'muse') {
    return ['exec', '--prompt-file', promptFile, '--approval-mode', 'never', '--user-input-auto-resolve'];
  }
  if (provider === 'cursor') {
    // Cursor Agent's print mode takes the prompt as a positional arg. Keep stdin
    // closed so it cannot interpret advisor prompt bytes as interactive input.
    return ['--print', '--force', '--trust', '--sandbox', 'disabled', prompt];
  }
  if (provider === 'copilot') {
    return [
      '--model', resolveCopilotModel(),
      '--effort', resolveCopilotReasoningEffort(),
      '--allow-all',
      '--no-ask-user',
      '--silent',
      '--stream=off',
      '-p', prompt,
    ];
  }
  // claude: `claude -p` reads the prompt from stdin when no prompt arg is given.
  return pipePromptViaStdin ? ['-p'] : ['-p', prompt];
}

function shouldPipePromptViaStdin(provider, prompt) {
  if (provider === 'codex' || provider === 'gemini') {
    if (typeof prompt === 'string' && (prompt.includes('\n') || prompt.length > 500)) {
      return true;
    }

    return SHOULD_USE_WINDOWS_SHELL;
  }

  // antigravity (`agy`): `-p` requires its prompt as an arg value and errors if
  // the prompt is piped via stdin, so it never uses the stdin pipe path. Long /
  // multiline prompts are safe as a single argv value (spawn without a shell).

  // #3221: long/multiline/frontmatter prompts must not be passed to Claude as a
  // raw argv value. Claude's CLI parses a leading `-`/`--`/`---` (YAML
  // frontmatter) token as an option and either errors out or drops the prompt.
  // Route those over stdin (`claude -p` reads the prompt from stdin). Short,
  // single-line, non-option prompts keep the existing `-p <prompt>` behavior.
  if (provider === 'claude') {
    if (typeof prompt !== 'string') {
      return false;
    }

    return prompt.includes('\n') || prompt.length > 500 || /^\s*-/.test(prompt);
  }

  // grok and muse (prompt file), cursor-agent (interactive stdin), Copilot
  // (`-p` argv), and any other provider never pipe the prompt.
  return false;
}

const ASK_ORIGINAL_TASK_ENV = 'OMC_ASK_ORIGINAL_TASK';
const ASK_ORIGINAL_TASK_ENV_ALIAS = 'OMX_ASK_ORIGINAL_TASK';

function usage() {
  console.error('Usage: omc ask <claude|codex|gemini|antigravity|grok|cursor|copilot|muse> "<prompt>"');
  console.error('Legacy direct usage: node scripts/run-provider-advisor.js <claude|codex|gemini|antigravity|grok|cursor|copilot|muse> <prompt...>');
  console.error('                 or: node scripts/run-provider-advisor.js claude --print "<prompt>"');
  console.error('                 or: node scripts/run-provider-advisor.js gemini --prompt "<prompt>"');
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'task';
}

function timestampToken(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

function parseArgs(argv) {
  const [providerRaw, ...rest] = argv;
  const provider = (providerRaw || '').toLowerCase();

  if (!provider || !(provider in PROVIDER_BINARIES)) {
    usage();
    process.exit(1);
  }

  if (rest.length === 0) {
    usage();
    process.exit(1);
  }

  if (rest[0] === '-p' || rest[0] === '--print' || rest[0] === '--prompt') {
    const prompt = rest.slice(1).join(' ').trim();
    if (!prompt) {
      usage();
      process.exit(1);
    }
    return { provider, prompt };
  }

  return { provider, prompt: rest.join(' ').trim() };
}

// Strip host session markers so provider advisors never inherit the active parent agent session.
const HOST_SESSION_STRIPPED_ENV_VARS = new Set([
  'CLAUDECODE',
  'CLAUDE_SESSION_ID',
  'CLAUDECODE_SESSION_ID',
  'CLAUDE_CODE_ENTRYPOINT',
  'COPILOT_CLI',
  'COPILOT_AGENT_SESSION_ID',
  'OMC_HOST',
]);
const CODEX_STRIPPED_ENV_VARS = new Set(['RUST_LOG', 'RUST_BACKTRACE', 'RUST_LIB_BACKTRACE']);

function buildProviderEnv(provider, env = process.env) {
  const strippedEnvVars = provider === 'codex'
    ? new Set([...HOST_SESSION_STRIPPED_ENV_VARS, ...CODEX_STRIPPED_ENV_VARS])
    : HOST_SESSION_STRIPPED_ENV_VARS;

  return Object.fromEntries(
    Object.entries(env).filter(([key]) => !strippedEnvVars.has(key)),
  );
}

function resolveWindowsBinary(binary, env) {
  const result = spawnSync('where', [binary], {
    encoding: 'utf8',
    env,
  });
  if (result.status !== 0) return undefined;
  const candidates = result.stdout
    ?.split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean) ?? [];
  return candidates.find(candidate => /\.(exe|com|cmd|bat)$/i.test(candidate));
}

function spawnProvider(provider, binary, args, options) {
  if (SHOULD_USE_WINDOWS_SHELL && /\.(cmd|bat)$/i.test(binary)) {
    const ps1Shim = binary.replace(/\.(cmd|bat)$/i, '.ps1');
    if (!existsSync(ps1Shim)) {
      throw new Error(
        `ENOENT: Cannot safely launch ${provider} CLI at ${binary}: sibling PowerShell shim not found at ${ps1Shim}. Reinstall the current ${provider} CLI.`,
      );
    }

    const run = spawnSync(
      'pwsh.exe',
      ['-NoProfile', '-NonInteractive', '-File', ps1Shim, ...args],
      {
        ...options,
        shell: false,
      },
    );
    if (run.error?.code === 'ENOENT') {
      throw new Error(
        `PowerShell 7 (pwsh.exe) is required to safely launch an npm-installed ${provider} CLI on Windows.`,
      );
    }
    return run;
  }
  return spawnSync(binary, args, options);
}

function ensureBinary(provider, binary) {
  const providerEnv = buildProviderEnv(provider);
  const probeOptions = {
    stdio: 'ignore',
    encoding: 'utf8',
    env: providerEnv,
    shell: false,
  };
  let resolvedBinary = binary;
  let probe = spawnProvider(provider, resolvedBinary, ['--version'], probeOptions);
  let resolvedWindowsBinary;

  if (SHOULD_USE_WINDOWS_SHELL && (probe.error || probe.status !== 0)) {
    resolvedWindowsBinary = resolveWindowsBinary(binary, providerEnv);
    if (resolvedWindowsBinary) {
      resolvedBinary = resolvedWindowsBinary;
      probe = spawnProvider(provider, resolvedBinary, ['--version'], probeOptions);
    }
  }

  const isMissing = probe.error?.code === 'ENOENT'
    || probe.error?.code === 'EINVAL'
    || (SHOULD_USE_WINDOWS_SHELL && probe.status !== 0 && !resolvedWindowsBinary);
  if (isMissing) {
    const verify = `${binary} --version`;
    console.error(`[ask-${binary}] Missing required local CLI binary: ${binary}`);
    console.error(`[ask-${binary}] Install/configure ${binary} CLI, then verify with: ${verify}`);
    process.exit(1);
  }
  return resolvedBinary;
}

function buildSummary(exitCode, output) {
  if (exitCode === 0) {
    return 'Provider completed successfully. Review the raw output for details.';
  }

  const firstLine = output
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean);

  return firstLine
    ? `Provider command failed (exit ${exitCode}): ${firstLine}`
    : `Provider command failed with exit code ${exitCode}.`;
}

function buildActionItems(exitCode) {
  if (exitCode === 0) {
    return [
      'Review the response and extract decisions you want to apply.',
      'Capture follow-up implementation tasks if needed.',
    ];
  }

  return [
    'Inspect the raw output error details.',
    'Fix CLI/auth/environment issues and rerun the command.',
  ];
}

function resolveOriginalTask(prompt) {
  const canonical = process.env[ASK_ORIGINAL_TASK_ENV];
  if (canonical && canonical.trim()) {
    return canonical;
  }

  const alias = process.env[ASK_ORIGINAL_TASK_ENV_ALIAS];
  if (alias && alias.trim()) {
    console.error(`[ask] DEPRECATED: ${ASK_ORIGINAL_TASK_ENV_ALIAS} is deprecated; use ${ASK_ORIGINAL_TASK_ENV} instead.`);
    return alias;
  }

  return prompt;
}

async function writeArtifact({ provider, originalTask, finalPrompt, rawOutput, exitCode }) {
  const root = process.cwd();
  const artifactDir = join(await resolveOmcStateRoot(root), 'artifacts', 'ask');
  const slug = slugify(originalTask);
  const timestamp = timestampToken();
  const artifactPath = join(artifactDir, `${provider}-${slug}-${timestamp}.md`);

  const summary = buildSummary(exitCode, rawOutput);
  const actionItems = buildActionItems(exitCode);

  const body = [
    `# ${provider} advisor artifact`,
    '',
    `- Provider: ${provider}`,
    `- Exit code: ${exitCode}`,
    `- Created at: ${new Date().toISOString()}`,
    '',
    '## Original task',
    '',
    originalTask,
    '',
    '## Final prompt',
    '',
    finalPrompt,
    '',
    '## Raw output',
    '',
    '```text',
    rawOutput || '(no output)',
    '```',
    '',
    '## Concise summary',
    '',
    summary,
    '',
    '## Action items',
    '',
    ...actionItems.map((item) => `- ${item}`),
    '',
  ].join('\n');

  await mkdir(artifactDir, { recursive: true });
  await writeFile(artifactPath, body, 'utf8');
  return artifactPath;
}

async function main() {
  const { provider, prompt } = parseArgs(process.argv.slice(2));
  const binaryName = PROVIDER_BINARIES[provider];

  const binary = ensureBinary(provider, binaryName);

  const pipePromptViaStdin = shouldPipePromptViaStdin(provider, prompt);
  const promptDir = PROMPT_FILE_PROVIDERS.has(provider) ? mkdtempSync(join(tmpdir(), 'omc-ask-')) : null;
  let run;
  try {
    let promptFile;
    if (promptDir) {
      promptFile = join(promptDir, 'prompt.md');
      writeFileSync(promptFile, prompt, { encoding: 'utf8', mode: 0o600 });
    }
    const providerArgs = buildProviderArgs(provider, prompt, { pipePromptViaStdin, promptFile });
    try {
      run = spawnProvider(provider, binary, providerArgs, {
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024,
        env: buildProviderEnv(provider),
        shell: false,
        // Bound antigravity so an upstream non-TTY hang (#76) fails cleanly instead of
        // blocking forever; agy's own --print-timeout does not work. SIGKILL (not a
        // catchable SIGTERM) guarantees spawnSync returns even if agy traps signals.
        ...(provider === 'antigravity' ? { timeout: ANTIGRAVITY_TIMEOUT_MS, killSignal: ANTIGRAVITY_TIMEOUT_KILL_SIGNAL } : {}),
        ...(pipePromptViaStdin ? { input: prompt } : { stdio: ['ignore', 'pipe', 'pipe'] }),
      });
    } catch (error) {
      run = {
        status: null,
        signal: null,
        stdout: '',
        stderr: '',
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  } finally {
    if (promptDir) {
      rmSync(promptDir, { recursive: true, force: true });
    }
  }

  const stdout = run.stdout || '';
  const stderr = run.stderr || '';
  const rawOutput = [stdout, stderr].filter(Boolean).join(stdout && stderr ? '\n\n' : '');
  let exitCode = typeof run.status === 'number' ? run.status : 1;

  // Antigravity (#76): the headless non-TTY bug surfaces two ways — a clean
  // zero-exit with NO output (output dropped on flush), or an indefinite hang.
  // The timeout above turns a hang into a killed/non-zero run; here we also turn
  // a zero-exit empty result into a failure, so the advisor never records
  // "(no output)" and reports success. (Empirically agy 1.0.10 returns output
  // under pipe capture; this surfaces the regression/refusal cases instead of
  // masking them.) No silent success, no infinite wait — see #76 for why neither
  // a PTY wrapper nor agy's --print-timeout is a usable workaround.
  if (provider === 'antigravity' && (run.error?.code === 'ETIMEDOUT' || run.signal === ANTIGRAVITY_TIMEOUT_KILL_SIGNAL)) {
    console.error(`[ask-antigravity] agy timed out after ${ANTIGRAVITY_TIMEOUT_MS}ms with no completed response (see antigravity-cli#76).`);
    console.error('[ask-antigravity] agy headless print mode can hang on non-TTY; verify interactively with: agy -p "<prompt>"');
    exitCode = exitCode === 0 ? 1 : exitCode;
  } else if (provider === 'antigravity' && exitCode === 0 && rawOutput.trim() === '') {
    console.error('[ask-antigravity] agy exited 0 but produced no output under pipe capture.');
    console.error('[ask-antigravity] Treating as failure (see google-antigravity/antigravity-cli#76).');
    console.error('[ask-antigravity] Re-run, or verify interactively with: agy -p "<prompt>"');
    exitCode = 1;
  }

  const artifactPath = await writeArtifact({
    provider,
    originalTask: resolveOriginalTask(prompt),
    finalPrompt: prompt,
    rawOutput,
    exitCode,
  });

  console.log(artifactPath);

  if (run.error) {
    console.error(`[ask-${provider}] ${run.error.message}`);
  }

  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}

main().catch((error) => {
  console.error(`[run-provider-advisor] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
