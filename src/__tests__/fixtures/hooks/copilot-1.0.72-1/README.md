# Copilot CLI 1.0.72-1 hook fixtures

The JSON and JSONL files in this directory preserve sanitized hook and
transcript contracts for Copilot CLI 1.0.72-1. Observed prompts, paths, IDs,
tool output, agent metadata, and user data are replaced with deterministic
placeholders.

`_provenance.json` distinguishes fixture evidence:

- `observed` means a Copilot CLI 1.0.72-1 `hook.start.data.input` record was
  found, with a SHA-256 fingerprint and line number recorded without storing a
  session ID or user path.
- `observed-shape-sanitized` means the event type and relevant field placement
  were observed in version-matched local `events.jsonl` files, but the committed
  JSONL is a minimal deterministic sequence rather than a byte-identical record.
- `provisional` is reserved for a documented schema that has not yet been
  observed live. No shipped hook fixture in this snapshot is provisional.

The original live capture supplied the first nine event records. A search of
local Copilot session event logs found version-matched live records for
`preCompact` and `sessionEnd`, so both terminal lifecycle fixtures are now
marked `observed`. Their stable session-start and event-record fingerprints are
stored in `_provenance.json`; no append-sensitive whole-file hash is used.

`agentStop-transcript.jsonl` records the observed
`assistant.message.data.content` placement used when native `agentStop` omits
assistant fields. `context-events.jsonl` records the observed
`session.compaction_start.data.conversationTokens` placement and the absence of
a paired active-model context-limit field; it must not be treated as a
Stop-time context percentage.

## `statusLine.json`

`statusLine.json` is a non-hook fixture: it captures the stdin contract for the
Copilot CLI 1.0.72-1 `statusLine` command rather than a hook event, so it is
excluded from the `HOOK_CONTRACTS` list in `hook-contract-fixtures.test.ts` and
has no Claude-side counterpart.

The payload was captured live from a real Copilot CLI 1.0.72-1 `statusLine`
invocation, configured with a `statusLine` command pointed at an isolated
`COPILOT_HOME`/`settings.json` stored alongside a disposable git repository
(source label `isolated-status-line-command`).
The user's persistent Copilot settings were never modified to produce this
capture. The record is the third line (first record after model metadata
resolved) of the raw capture JSONL; only the SHA-256 fingerprint and byte
length of that raw record are stored in `_provenance.json` — the raw capture
itself is not committed anywhere in this repository.

`cwd`, `session_id`, `transcript_path`, and `model` are replaced with deterministic
placeholders consistent with the hook-fixture sanitization policy. The model
placeholders are new and did not previously exist in the fixture standard.
Numeric fields (token counts, durations, percentages) are left as the host
reported them, including zeroes: Copilot's live statusLine record reports zero
for several metrics (e.g. token usage, added/removed lines) and those zeroes are
preserved as-is rather than treated as sensitive or omitted.
