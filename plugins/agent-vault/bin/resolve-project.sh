#!/usr/bin/env bash
# resolve-project.sh — print the project subfolder path inside the vault.
#
# Project name derivation (in priority order):
#   1. If cwd is inside the vault itself, the first path segment after the vault root.
#   2. Basename of the enclosing git repository (most common case).
#   3. Basename of cwd (no-git fallback).
#
# Does NOT create the directory — callers (bootstrap, task-add) decide whether to
# scaffold. A nonzero exit means "couldn't identify a project from this cwd."

set -euo pipefail

vault="${1:-}"
script_dir="$(cd "$(dirname "$0")" && pwd)"

if [[ -z "$vault" ]]; then
  vault="$("$script_dir/find-vault.sh")" || exit 1
fi

vault_basename="$(basename "$vault")"

# Case 1: cwd is inside the vault — derive project from path segment.
if [[ "$PWD/" == "$vault/"* ]]; then
  rel="${PWD#$vault}"
  rel="${rel#/}"
  if [[ -z "$rel" ]]; then
    # cwd IS the vault root, not a project.
    exit 1
  fi
  project_name="${rel%%/*}"
  echo "$vault/$project_name"
  exit 0
fi

# Case 2: enclosing git repo, take its top-level dir name.
if git_root="$(git rev-parse --show-toplevel 2>/dev/null)"; then
  project_name="$(basename "$git_root")"
else
  project_name="$(basename "$PWD")"
fi

# Guard: never treat the vault dir itself as a project.
if [[ "$project_name" == "$vault_basename" ]]; then
  exit 1
fi

echo "$vault/$project_name"
