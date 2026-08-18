#!/usr/bin/env bash
# mark-handoff-spent.sh — deprecate a spent handoff in OKF v0.2 frontmatter.
#
# Usage: mark-handoff-spent.sh <project-path> <handoff-id>
#   <handoff-id> is the filename with or without .md (e.g. 2026-06-25-1918).
#
# A spent handoff is preserved on disk. The helper sets OKF lifecycle `status:
# deprecated` and workflow `handoff_status: spent`; the body stays byte-identical.
#
# Handoffs predating `handoff_status` are upgraded when their legacy status is
# `live` or `spent`. A file with no frontmatter block is left untouched (exit 2).
#
# Idempotent: a handoff already `spent` is rewritten to the same bytes. Exit 0 on success
# (changed or already-spent), 2 if the target can't be found or has no frontmatter.

set -euo pipefail

project_path="${1:?usage: mark-handoff-spent.sh <project-path> <handoff-id>}"
handoff_id="${2:?usage: mark-handoff-spent.sh <project-path> <handoff-id>}"
handoff_id="${handoff_id%.md}"

file="$project_path/handoffs/$handoff_id.md"
[[ -f "$file" ]] || { echo "mark-handoff-spent: no such handoff: $file" >&2; exit 2; }

# Rewrite through awk inside the first frontmatter block only.
tmp="$(mktemp "${TMPDIR:-/tmp}/mark-handoff-spent.XXXXXX")"
trap 'rm -f "$tmp"' EXIT

awk '
  BEGIN { infm = 0; opened = 0; lifecycle = 0; workflow = 0 }
  NR == 1 && $0 ~ /^---[[:space:]]*$/ { print; infm = 1; opened = 1; next }
  infm == 1 && $0 ~ /^---[[:space:]]*$/ {
    if (!lifecycle) print "status: deprecated"
    if (!workflow) print "handoff_status: spent"
    print; infm = 0; next
  }
  infm == 1 && $0 ~ /^status:[[:space:]]*/ {
    print "status: deprecated"; lifecycle = 1; next
  }
  infm == 1 && $0 ~ /^handoff_status:[[:space:]]*/ {
    print "handoff_status: spent"; workflow = 1; next
  }
  { print }
  END { if (!opened) exit 3 }
' "$file" > "$tmp" || { echo "mark-handoff-spent: no frontmatter in $file — left untouched" >&2; exit 2; }

# Only touch the real file if something actually changed, so mtime/bytes stay stable on
# a no-op (an already-spent handoff must not churn the file or the SessionStart index).
if cmp -s "$file" "$tmp"; then
  exit 0
fi
cat "$tmp" > "$file"
exit 0
