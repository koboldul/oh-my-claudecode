# Copilot CLI 1.0.72-1 hook fixtures

The JSON files in this directory preserve sanitized hook stdin contracts for
Copilot CLI 1.0.72-1. Observed prompts, paths, IDs, tool output, agent metadata,
and user data are replaced with deterministic placeholders.

`_provenance.json` distinguishes fixture evidence:

- `observed` means a Copilot CLI 1.0.72-1 `hook.start.data.input` record was
  found, with a SHA-256 fingerprint and line number recorded without storing a
  session ID or user path.
- `provisional` is reserved for a documented schema that has not yet been
  observed live. No shipped hook fixture in this snapshot is provisional.

The original live capture supplied the first nine event records. A search of
local Copilot session event logs found version-matched live records for
`preCompact` and `sessionEnd`, so both terminal lifecycle fixtures are now
marked `observed`. Their stable session-start and event-record fingerprints are
stored in `_provenance.json`; no append-sensitive whole-file hash is used.

## Phase 5 prerequisite: `statusLine.json`

The available live session contained no `statusLine` invocation, and the user's
persistent Copilot settings were not modified to manufacture one. Do not infer
or invent a status-line payload.

Phase 5 must capture the exact JSON stdin from a real Copilot CLI 1.0.72-1
`statusLine` command configured in a disposable repository-local or otherwise
isolated setup. After sanitizing the same sensitive fields as the hook fixtures,
add that payload as `statusLine.json` and add its contract assertions.
