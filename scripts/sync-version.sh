#!/usr/bin/env bash
# sync-version.sh — called by npm "version" lifecycle hook
# Syncs the version from package.json to all satellite files:
#   - .claude-plugin/plugin.json
#   - plugin.json (Copilot/Open Plugin manifest)
#   - .claude-plugin/marketplace.json
#   - docs/CLAUDE.md (OMC:VERSION marker)
#   - CLAUDE.md (synchronized from docs/CLAUDE.md — canonical guidance source)
#
# Usage: automatically invoked by `npm version <bump>`
#        or manually: ./scripts/sync-version.sh [version]

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="${1:-$(node -p "require('$ROOT/package.json').version")}"

echo "🔄 Syncing version $VERSION to satellite files..."

# 1. .claude-plugin/plugin.json
PLUGIN="$ROOT/.claude-plugin/plugin.json"
if [ -f "$PLUGIN" ]; then
  perl -i -pe "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" "$PLUGIN"
  echo "  ✓ plugin.json → $VERSION"
fi

# 2. plugin.json (Copilot/Open Plugin manifest)
COPILOT_PLUGIN="$ROOT/plugin.json"
if [ -f "$COPILOT_PLUGIN" ]; then
  perl -i -pe "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" "$COPILOT_PLUGIN"
  echo "  ✓ root plugin.json → $VERSION"
fi

# 3. .claude-plugin/marketplace.json (has 2 version fields)
MARKET="$ROOT/.claude-plugin/marketplace.json"
if [ -f "$MARKET" ]; then
  perl -i -pe "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/g" "$MARKET"
  echo "  ✓ marketplace.json → $VERSION"
fi

# 4. docs/CLAUDE.md version marker
CLAUDE_MD="$ROOT/docs/CLAUDE.md"
if [ -f "$CLAUDE_MD" ]; then
  perl -i -pe "s/<!-- OMC:VERSION:[^ ]* -->/<!-- OMC:VERSION:$VERSION -->/" "$CLAUDE_MD"
  echo "  ✓ docs/CLAUDE.md → $VERSION"
fi

# 5. Root CLAUDE.md — must always be identical to docs/CLAUDE.md (the
#    canonical guidance source). Copying the whole file (not just the version
#    marker) prevents root CLAUDE.md from drifting out of sync with content
#    changes made to docs/CLAUDE.md between releases.
ROOT_CLAUDE_MD="$ROOT/CLAUDE.md"
if [ -f "$CLAUDE_MD" ]; then
  cp "$CLAUDE_MD" "$ROOT_CLAUDE_MD"
  echo "  ✓ CLAUDE.md → synchronized from docs/CLAUDE.md ($VERSION)"
fi

# Stage the changed files so they're included in the version commit
git add "$PLUGIN" "$COPILOT_PLUGIN" "$MARKET" "$CLAUDE_MD" "$ROOT_CLAUDE_MD" 2>/dev/null || true

echo "✅ Version sync complete: $VERSION"
