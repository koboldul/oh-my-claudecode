---
name: setup
description: Use first for install/update routing — sends setup, doctor, or MCP requests to the correct OMC setup flow
level: 2
---

# Setup

Use `/oh-my-claudecode:setup` as the unified setup/configuration entrypoint.

## Usage

```bash
/oh-my-claudecode:setup                # full setup wizard
/oh-my-claudecode:setup doctor         # installation diagnostics
/oh-my-claudecode:setup mcp            # MCP server configuration
/oh-my-claudecode:setup wizard --local # explicit wizard path
```

## Routing

Process the request by the **first argument only** so install/setup questions land on the right flow immediately:

- No argument, `wizard`, `local`, `global`, or `--force` -> route to `/oh-my-claudecode:omc-setup` with the same remaining args. Under Copilot CLI, that skill applies its Copilot Host Guard rather than assuming Claude Code setup is required.
- `doctor` -> route to `/oh-my-claudecode:omc-doctor` with everything after the `doctor` token
- `mcp` -> route to `/oh-my-claudecode:mcp-setup` with everything after the `mcp` token

Examples:

```bash
/oh-my-claudecode:setup --local          # => /oh-my-claudecode:omc-setup --local
/oh-my-claudecode:setup doctor --json    # => /oh-my-claudecode:omc-doctor --json
/oh-my-claudecode:setup mcp github       # => /oh-my-claudecode:mcp-setup github
```

## Notes

- `/oh-my-claudecode:omc-setup`, `/oh-my-claudecode:omc-doctor`, and `/oh-my-claudecode:mcp-setup` remain valid compatibility entrypoints.
- Prefer `/oh-my-claudecode:setup` in new documentation and user guidance.
- In a Copilot session, plugin installation is sufficient — verify with `/env`, diagnose with `/oh-my-claudecode:setup doctor`, and update with `copilot plugin update oh-my-claudecode` (then restart Copilot CLI). Do not run `/oh-my-claudecode:omc-setup`'s Claude-only phases (CLAUDE.md, HUD/statusLine) unless the user explicitly asks to configure Claude Code too.

Task: {{ARGUMENTS}}
