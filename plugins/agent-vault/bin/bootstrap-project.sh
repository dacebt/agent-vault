#!/usr/bin/env bash
# bootstrap-project.sh — create a project's Agent Vault/OKF v0.2 project bundle.
# Idempotent: existing files/dirs are left alone.
#
# Usage: bootstrap-project.sh [<project-path>]
#   If <project-path> is omitted, derives it from cwd via resolve-project.sh.

set -euo pipefail

PLUGIN_ROOT="${PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}}"
readme_template="$PLUGIN_ROOT/templates/project-README.md"
index_template="$PLUGIN_ROOT/templates/bundle-index.md"
task_db="$PLUGIN_ROOT/bin/task-db.py"
for required in "$readme_template" "$index_template" "$task_db"; do
  [[ -f "$required" ]] || {
    echo "agent-vault: missing required plugin file at $required" >&2
    exit 1
  }
done

project_path="${1:-}"
if [[ -z "$project_path" ]]; then
  vault="$("$PLUGIN_ROOT/bin/find-vault.sh")" || {
    echo "agent-vault: no vault found at \${AGENT_VAULT:-\$HOME/agent-vault}" >&2
    exit 1
  }
  project_path="$("$PLUGIN_ROOT/bin/resolve-project.sh" "$vault")" || {
    echo "agent-vault: could not resolve project name from cwd" >&2
    exit 1
  }
fi

project_name="$(basename "$project_path")"
case "$project_name" in
  *$'\n'*)
    echo "agent-vault: project name cannot contain a newline" >&2
    exit 1
    ;;
esac
project_name_sed="$(printf '%s' "$project_name" | sed 's/[&|\\]/\\&/g')"

mkdir -p \
  "$project_path/tasks" \
  "$project_path/docs" \
  "$project_path/docs/decisions" \
  "$project_path/knowledge" \
  "$project_path/journal" \
  "$project_path/handoffs" \
  "$project_path/views"

if find "$project_path/tasks" -type f -name '*.md' \
  ! -path "$project_path/tasks/index.md" ! -path "$project_path/tasks/log.md" \
  -print -quit 2>/dev/null | grep -q .; then
  echo "agent-vault: legacy Markdown tasks require migrate-task-markdown.py before bootstrap" >&2
  exit 1
fi

if [[ ! -f "$project_path/tasks/tasks.sqlite3" ]]; then
  python3 "$task_db" init "$project_path" >/dev/null
fi

readme="$project_path/README.md"
if [[ ! -f "$readme" ]]; then
  sed "s|{{PROJECT_NAME}}|$project_name_sed|g; s|{{CREATED}}|$(date +%Y-%m-%d)|g; s|{{TIMESTAMP}}|$(date -u +%Y-%m-%dT%H:%M:%SZ)|g" \
    "$readme_template" > "$readme"
fi

# Root OKF bundle index — declares okf_version and gives an agent its on-ramp.
bundle_index="$project_path/index.md"
if [[ ! -f "$bundle_index" ]]; then
  sed "s|{{PROJECT_NAME}}|$project_name_sed|g" "$index_template" > "$bundle_index"
fi

echo "$project_path"
