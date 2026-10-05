#!/usr/bin/env bash
# hook-user-prompt-wrapup.sh — UserPromptSubmit hook.
#
# When the user's prompt looks like they're ending the session, inject a *reminder*
# (not a command) that journaling exists. The reminder deliberately defers the
# is-this-worth-writing judgment to the agent-vault:journal skill — being reminded is
# never itself a reason to write. The match is tight to the user's actual wrap-up
# phrasing ("wrap up", "end the session"); a stray reminder the orchestrator
# ignores is harmless, so there is no gating beyond the phrase + tracked-project check.
#
# Silent no-op (exit 0) when the prompt isn't a wrap-up, or when cwd doesn't
# resolve to a tracked project — sessions outside the vault never see plugin output.

set -euo pipefail

PLUGIN_ROOT="${PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}}"

command -v jq >/dev/null 2>&1 || exit 0

input="$(cat)"
[[ -n "$input" ]] || exit 0

if ! printf '%s' "$input" | jq -e 'type == "object"' >/dev/null 2>&1; then
  echo 'agent-vault wrapup: hook input must be a JSON object' >&2
  exit 1
fi

cwd_key="$(printf '%s' "$input" | jq -r 'if has("cwd") then "cwd" elif has("current_working_directory") then "current_working_directory" else empty end')"
if [[ -n "$cwd_key" ]]; then
  cwd="$(printf '%s' "$input" | jq -r --arg key "$cwd_key" '.[$key] | if type == "string" then . else empty end')"
  [[ "$cwd" == /* && -d "$cwd" ]] || exit 0
  cd "$cwd" 2>/dev/null || exit 0
fi

prompt="$(printf '%s' "$input" | jq -r '.prompt // .user_prompt // empty | if type == "string" then . else empty end')"
[[ -n "$prompt" ]] || exit 0

# Tight wrap-up match, keyed on the two roots the user actually types:
# "wrap up" and "end … session".
printf '%s\n' "$prompt" | grep -qiE \
  "wrap[[:space:]-]*up( the)?( session)?|(end|ending|end of) (the )?session" \
  || exit 0

# Only speak inside a tracked project.
vault="$("$PLUGIN_ROOT/bin/find-vault.sh" 2>/dev/null)" || exit 0
project_path="$("$PLUGIN_ROOT/bin/resolve-project.sh" "$vault" 2>/dev/null)" || exit 0
[[ -d "$project_path" ]] || exit 0

read -r -d '' reminder <<'EOF' || true
The user may be wrapping up this session. Consider the agent-vault:journal skill for substantive work, findings, or outcomes worth preserving. Let that skill judge whether an entry is useful; a reminder alone is not a reason to write one. Continue to follow the user's actual request.
EOF

jq -n --arg ctx "$reminder" '{
  hookSpecificOutput: {
    hookEventName: "UserPromptSubmit",
    additionalContext: $ctx
  }
}'
