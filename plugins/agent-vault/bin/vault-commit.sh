#!/usr/bin/env bash
# vault-commit.sh — durability-commit a vault change.
#
# Usage: vault-commit.sh <message> <file>...
#   <message>   one-line conventional commit message (no co-author trailer — none is added).
#   <file>...   the exact path(s) the calling write skill just created or modified.
#
# The vault is a git repo but nothing else commits it, so journals/handoffs/ADRs pile up
# as uncommitted working state and an external brain that can't be restored isn't durable.
# Write skills end their silent path here to keep the vault committed.
#
# Discipline:
#   - Commits ONLY the given paths (`git add -- <files>` then `git commit -- <files>`),
#     never `git add -A` — unrelated dirty state in the vault is left exactly as it was.
#   - Silent no-op (exit 0) if git is missing, the target isn't inside a git repo, or
#     nothing among the given paths actually changed.

set -euo pipefail

msg="${1:?usage: vault-commit.sh <message> <file>...}"; shift
[[ $# -gt 0 ]] || { echo "vault-commit: no files given" >&2; exit 2; }

command -v git >/dev/null 2>&1 || exit 0

# Derive the repo from the first path's directory (works for a path that was just deleted
# too — its parent dir still resolves).
anchor="$1"; [[ -e "$anchor" ]] || anchor="$(dirname "$1")"
repo="$(git -C "$(dirname "$anchor")" rev-parse --show-toplevel 2>/dev/null)" || exit 0

git -C "$repo" add -- "$@" 2>/dev/null || exit 0
# Nothing staged among these paths → nothing to commit (keeps re-writes idempotent).
git -C "$repo" diff --cached --quiet -- "$@" 2>/dev/null && exit 0
git -C "$repo" commit -q -m "$msg" -- "$@" 2>/dev/null || exit 0
exit 0
