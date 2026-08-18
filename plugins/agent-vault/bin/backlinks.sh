#!/usr/bin/env bash
# backlinks.sh — find every concept in a bundle that links to a target concept.
#
# Usage: backlinks.sh <project-path> <target>
#   <target> is a concept path, filename, or bare id (with or without .md).
#
# This is the "who points at X" query plain grep does not provide. It matches
# file-backed OKF links, task URIs, and legacy wikilinks
# ([text](/dir/id.md)) and legacy [[id]] wikilinks, across the whole bundle,
# excluding the target file itself. Reserved files (index.md) are included on
# purpose — being listed in a directory's index.md counts as a backlink.
#
# Output: one "relpath:linenum: matched-line" per backlink, or nothing.

set -euo pipefail

project="${1:?usage: backlinks.sh <project-path> <target>}"
target="${2:?usage: backlinks.sh <project-path> <target>}"
plugin_root="${PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}}"

cd "$project" 2>/dev/null || { echo "backlinks: no such project: $project" >&2; exit 1; }
project="$(pwd)"

if [[ "$target" == task:* ]]; then
  python3 "$plugin_root/bin/task-backlinks.py" "$project" "$target"
  exit $?
fi

# Reduce the target to its bare id (basename, no .md).
id="$(basename "$target")"
id="${id%.md}"
[[ -n "$id" ]] || { echo "backlinks: empty target" >&2; exit 1; }

# Escape regex metacharacters in the id so ids like "ADR-005" are literal.
esc_id="$(printf '%s' "$id" | sed 's/[][\.*^$/+?(){}|]/\\&/g')"

engine="grep"
command -v rg >/dev/null 2>&1 && engine="rg"

# Match either  ](....<id>.md)  or  ](....<id>.md#anchor)  or  [[<id>]]  (optionally
# [[<id>|alias]]). The `[)#]` after .md is load-bearing: a bundle-absolute link can
# carry a #anchor (the canonical, encouraged form), and requiring a bare `)` would
# silently miss every anchored inbound link — both here and for callers like
# rename-concept.sh that rely on this to find what to relink.
pattern="\]\([^)]*${esc_id}\.md[)#]|\[\[${esc_id}(\||\])"

if [[ "$engine" == "rg" ]]; then
  rg --no-heading --line-number --glob '*.md' -e "$pattern" . 2>/dev/null \
    | sed 's|^\./||' | grep -v "/${id}\.md:" | grep -v "^${id}\.md:" || true
else
  grep -rnE --include='*.md' "$pattern" . 2>/dev/null \
    | sed 's|^\./||' | grep -v "/${id}\.md:" | grep -v "^${id}\.md:" || true
fi

python3 "$plugin_root/bin/task-backlinks.py" "$project" "$target"
