#!/usr/bin/env bash
# find-vault.sh — print the absolute path to the vault, or exit nonzero.
#
# The vault lives at a fixed location: $HOME/agent-vault. Override with
# the AGENT_VAULT environment variable (an absolute path to the vault directory).
# The old walk-up-from-cwd discovery is gone — the vault is shared machine-wide,
# so its location doesn't depend on where the session starts.
#
# Designed for silent no-op behavior: a missing vault is a normal state, not an
# error. Callers should treat a nonzero exit as "no vault here" rather than a
# failure.

set -euo pipefail

vault="${AGENT_VAULT:-$HOME/agent-vault}"

[[ -d "$vault" ]] || exit 1
(cd "$vault" && pwd)
