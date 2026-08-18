#!/usr/bin/env bash
# hook-session-start.sh — SessionStart hook.
#
# Silently injects a vault orientation preamble when the current working directory
# resolves to a project tracked by Agent Vault. Otherwise exits 0 with no
# output — sessions outside the vault must never see plugin behavior.

set -euo pipefail

PLUGIN_ROOT="${PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}}"

# Hook stdin carries the session id; skills can't see it, so stash it in the
# cache dir for agent-vault:handoff / agent-vault:journal to tag what they write.
hook_input="$(cat 2>/dev/null || true)"
session_id=""
if command -v jq >/dev/null 2>&1 && [[ -n "$hook_input" ]]; then
  session_id="$(printf '%s' "$hook_input" | jq -r '.session_id // empty' 2>/dev/null)" || session_id=""
fi

vault="$("$PLUGIN_ROOT/bin/find-vault.sh" 2>/dev/null)" || exit 0
project_path="$("$PLUGIN_ROOT/bin/resolve-project.sh" "$vault" 2>/dev/null)" || exit 0

# Project hasn't been bootstrapped in the vault — silent skip. The agent can run
# agent-vault:bootstrap when it actually wants to start tracking this project.
[[ -d "$project_path" ]] || exit 0

context="$("$PLUGIN_ROOT/bin/vault-index.sh" "$project_path" --preamble 2>/dev/null)" || exit 0
[[ -n "$context" ]] || exit 0

# Prime the git-commit-link hook's HEAD cache so the very first commit of this
# session is correctly detected. Without priming, the first commit-mentioning
# Bash call would be treated as a cold-start and either eaten (old behavior) or
# falsely linked (new behavior). Priming sidesteps both.
if git_root="$(git rev-parse --show-toplevel 2>/dev/null)" \
   && sha_full="$(git -C "$git_root" rev-parse HEAD 2>/dev/null)"; then
  cache_dir="${TMPDIR:-/tmp}/agent-vault-cache"
  mkdir -p "$cache_dir" 2>/dev/null && {
    repo_key="$(printf '%s' "$git_root" | shasum 2>/dev/null | cut -c1-12)"
    [[ -n "$repo_key" ]] && printf '%s' "$sha_full" > "$cache_dir/head-$repo_key"
    # Last-writer-wins per repo: concurrent sessions on the same checkout will
    # clobber each other's stash, so skills prefer $CLAUDE_SESSION_ID when set.
    if [[ -n "$repo_key" && -n "$session_id" ]]; then
      printf '%s' "$session_id" > "$cache_dir/session-$repo_key"
    fi
  }
fi

# Emit additionalContext via JSON so Claude Code injects it as context, not a transcript message.
if command -v jq >/dev/null 2>&1; then
  jq -n --arg ctx "$context" '{
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: $ctx
    }
  }'
else
  # Fallback: plain stdout still surfaces in transcript mode, just less elegantly.
  printf '%s\n' "$context"
fi
