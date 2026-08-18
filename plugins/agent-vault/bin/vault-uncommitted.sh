#!/usr/bin/env bash
# vault-uncommitted.sh — the durability floor: list vault changes left uncommitted for a
# while. Used by agent-vault:groom to catch the "external brain that was never saved" smell.
#
# Usage: vault-uncommitted.sh <project-path> [min-age-days]
#   min-age-days defaults to 3 — fresh edits (you may commit them momentarily) are not a
#   smell; content written days ago and never committed is.
#
# Prints one repo-relative path per line for each uncommitted change whose working-tree
# file is at least min-age-days old (a deletion is always reported — the record is already
# gone). Empty output means the vault is clean, only-recently-touched, or not a git repo.

set -euo pipefail

project_path="${1:?usage: vault-uncommitted.sh <project-path> [min-age-days]}"
min_age="${2:-3}"

command -v git >/dev/null 2>&1 || exit 0
repo="$(git -C "$project_path" rev-parse --show-toplevel 2>/dev/null)" || exit 0

now="$(date +%s)"
git -C "$repo" status --porcelain 2>/dev/null | while IFS= read -r line; do
  # Porcelain line: two status columns, a space, then the path. Renames are "old -> new".
  path="${line:3}"
  path="${path##* -> }"
  path="${path%\"}"; path="${path#\"}"
  [[ -n "$path" ]] || continue
  f="$repo/$path"
  if [[ ! -e "$f" ]]; then
    echo "$path"   # deletion — the content is already gone, always a durability concern
    continue
  fi
  m="$(stat -f '%m' "$f" 2>/dev/null || stat -c '%Y' "$f" 2>/dev/null)" || continue
  (( (now - m) / 86400 >= min_age )) && echo "$path"
done
