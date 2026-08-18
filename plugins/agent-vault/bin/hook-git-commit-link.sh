#!/usr/bin/env bash
# hook-git-commit-link.sh — PostToolUse hook on the Bash tool.
#
# When a Bash command results in a new git commit, append the new commit's short
# SHA + subject to the most-recently-touched SQLite task in progress. Builds a
# self-maintaining trail from task → commits without the agent having to remember.
#
# Detection strategy: compare the project repo's current HEAD against the last
# observed HEAD (cached per-repo). HEAD moving is the definitive signal a commit
# happened — far more reliable than parsing the command string (which may look
# like `git -c user.email=x commit`, `git -C foo commit`, `... && git commit`,
# etc.). A coarse "command mentions commit" filter runs first to skip the 99% of
# Bash calls that aren't commit-adjacent.
#
# Multiple in-progress tasks: the most recently modified one wins. Imperfect (a
# stray housekeeping commit will link to whatever task you last touched) but the
# noise is acceptable — much better than missing the real links.
#
# Silent on any miss: no vault, no project, no in-progress tasks, no HEAD change
# all exit 0 quietly.

set -euo pipefail

PLUGIN_ROOT="${PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}}"

command -v jq >/dev/null 2>&1 || exit 0

input="$(cat)"
[[ -n "$input" ]] || exit 0

cmd="$(echo "$input" | jq -r '.tool_input.command // .input.command // .command // empty' 2>/dev/null)"
[[ -n "$cmd" ]] || exit 0

# Cheap pre-filter: skip anything that doesn't even mention commit.
echo "$cmd" | grep -qE '\bcommit\b' || exit 0

# Locate the project repo via git.
git_root="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0

sha_full="$(git -C "$git_root" rev-parse HEAD 2>/dev/null)" || exit 0

# Per-repo cache of the last HEAD we observed.
cache_dir="${TMPDIR:-/tmp}/agent-vault-cache"
mkdir -p "$cache_dir" 2>/dev/null || exit 0
repo_key="$(printf '%s' "$git_root" | shasum 2>/dev/null | cut -c1-12)"
[[ -n "$repo_key" ]] || exit 0
cache_file="$cache_dir/head-$repo_key"

prev_sha="$(cat "$cache_file" 2>/dev/null || true)"
[[ "$prev_sha" == "$sha_full" ]] && exit 0  # HEAD didn't move; not a commit event.
printf '%s' "$sha_full" > "$cache_file"

# If the cache was missing (no SessionStart priming in this session and no prior
# observation), prev_sha is empty — we still proceed to link. The pre-filter on
# "command mentions commit" keeps the false-positive rate acceptable: the worst
# case is a `git log --grep=commit` style command linking the existing HEAD once
# per session, which is rare and harmless (just delete the line in the task).

# Confirmed: a new commit landed. Find vault + project.
vault="$("$PLUGIN_ROOT/bin/find-vault.sh" 2>/dev/null)" || exit 0
project_path="$("$PLUGIN_ROOT/bin/resolve-project.sh" "$vault" 2>/dev/null)" || exit 0
task_db="$PLUGIN_ROOT/bin/task-db.py"
database="$project_path/tasks/tasks.sqlite3"
[[ -f "$database" ]] || exit 0

# Most recently modified in-progress task.
active_id="$(python3 "$task_db" list "$project_path" --status in-progress --status blocked 2>/dev/null \
  | jq -r 'sort_by(.generated_at) | last | .id // empty')"
[[ -n "$active_id" ]] || exit 0

sha="$(git -C "$git_root" rev-parse --short HEAD 2>/dev/null)" || exit 0
subject="$(git -C "$git_root" log -1 --pretty=%s 2>/dev/null)" || exit 0
date="$(date +%Y-%m-%d)"

new_line="- ${date} — \`${sha}\` ${subject}"

task_json="$(python3 "$task_db" show "$project_path" "$active_id" 2>/dev/null)" || exit 0
body_file="$(mktemp "${TMPDIR:-/tmp}/agent-vault-task-body.XXXXXX")" || exit 0
trap 'rm -f "$body_file" "$body_file.next"' EXIT
printf '%s' "$task_json" | jq -r '.body_markdown' > "$body_file"

# Idempotency: don't re-add a SHA that's already linked.
if grep -qF "\`${sha}\`" "$body_file" 2>/dev/null; then
  exit 0
fi

if grep -q '^## Commits' "$body_file"; then
  awk -v new="$new_line" '
    /^## Commits/ && !done { print; print new; done=1; next }
    { print }
  ' "$body_file" > "$body_file.next" && mv "$body_file.next" "$body_file"
else
  printf '\n## Commits\n%s\n' "$new_line" >> "$body_file"
fi

python3 "$task_db" update "$project_path" "$active_id" --body-file "$body_file" >/dev/null 2>&1 || exit 0
"$PLUGIN_ROOT/bin/vault-commit.sh" "docs(vault): link commit $sha" "$database" >/dev/null 2>&1 || exit 0

exit 0
