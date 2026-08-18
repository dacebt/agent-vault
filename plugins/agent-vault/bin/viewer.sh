#!/usr/bin/env bash
# viewer.sh — run and manage the bundled Agent Vault Viewer.
#
# Usage: viewer.sh [start|status|stop|run|session]
#   start   Start one background viewer owned by this launcher (default).
#   status  Report the owned viewer process, URL, vault, and log path.
#   stop    Stop only the process recorded and verified as launcher-owned.
#   run     Run the viewer in the foreground.
#   session Run under a persistent agent terminal session and own its child.

set -euo pipefail

PLUGIN_ROOT="${PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}}"
viewer_server="$PLUGIN_ROOT/viewer/server.mjs"
vault="${AGENT_VAULT:-$HOME/agent-vault}"
port="${PORT:-7373}"
state_dir="${AGENT_VAULT_VIEWER_STATE_DIR:-${TMPDIR:-/tmp}/agent-vault-viewer-${UID:-user}}"
pid_file="$state_dir/viewer.pid"
port_file="$state_dir/viewer.port"
vault_file="$state_dir/viewer.vault"
server_file="$state_dir/viewer.server"
log_file="$state_dir/viewer.log"
operation="${1:-start}"

fail() {
  printf 'agent-vault viewer: %s\n' "$*" >&2
  exit 1
}

clear_state() {
  rm -f -- "$pid_file" "$port_file" "$vault_file" "$server_file"
}

clear_state_for_pid() {
  local expected_pid="$1" recorded_pid=""
  [[ -f "$pid_file" ]] || return 0
  IFS= read -r recorded_pid < "$pid_file" || return 0
  if [[ "$recorded_pid" == "$expected_pid" ]]; then
    clear_state
  fi
  return 0
}

write_state() {
  local child_pid="$1"
  printf '%s\n' "$child_pid" > "$pid_file"
  printf '%s\n' "$port" > "$port_file"
  printf '%s\n' "$vault" > "$vault_file"
  printf '%s\n' "$viewer_server" > "$server_file"
}

require_runtime() {
  [[ -f "$viewer_server" ]] || fail "bundled server not found: $viewer_server"
  command -v node >/dev/null 2>&1 || fail "Node.js is required"
  node --input-type=module -e \
    "import { DatabaseSync } from 'node:sqlite'; const db = new DatabaseSync(':memory:'); db.close();" \
    >/dev/null 2>&1 || fail "Node.js with node:sqlite support is required (use Node 22.13 or newer)"
}

validate_inputs() {
  case "$vault" in
    /*) ;;
    *) fail "AGENT_VAULT must be an absolute path" ;;
  esac
  [[ -d "$vault" ]] || fail "vault root not found: $vault"
  case "$port" in
    ''|*[!0-9]*) fail "PORT must be an integer from 1 through 65535" ;;
  esac
  ((port >= 1 && port <= 65535)) || fail "PORT must be an integer from 1 through 65535"
}

pid_visible_without_signal() {
  local candidate_pid="$1"
  [[ -d "/proc/$candidate_pid" ]] && return 0
  if command -v lsof >/dev/null 2>&1; then
    lsof -a -p "$candidate_pid" -d txt >/dev/null 2>&1 && return 0
  fi
  return 1
}

read_instance() {
  instance_pid=""
  instance_server=""
  [[ -f "$pid_file" && -f "$server_file" ]] || return 1
  IFS= read -r instance_pid < "$pid_file" || return 1
  IFS= read -r instance_server < "$server_file" || return 1
  case "$instance_pid" in
    ''|*[!0-9]*) return 1 ;;
  esac
  if ! kill -0 "$instance_pid" 2>/dev/null; then
    pid_visible_without_signal "$instance_pid" && return 2
    return 1
  fi
  [[ "$instance_server" == */viewer/server.mjs ]] || return 2
  command_line="$(ps -p "$instance_pid" -o command= 2>/dev/null)" || return 2
  [[ "$command_line" == *"$instance_server"* ]] || return 2
  return 0
}

stored_value() {
  local file="$1" fallback="$2" value=""
  if [[ -f "$file" ]]; then
    IFS= read -r value < "$file" || value=""
  fi
  printf '%s' "${value:-$fallback}"
}

health_check() {
  local url="$1"
  node -e \
    "fetch(process.argv[1]).then(async response => { const body = await response.json(); if (!response.ok || body.ok !== true) process.exit(1); }).catch(() => process.exit(1));" \
    "$url" >/dev/null 2>&1
}

print_status() {
  local active_port active_vault url
  active_port="$(stored_value "$port_file" "$port")"
  active_vault="$(stored_value "$vault_file" "$vault")"
  url="http://127.0.0.1:$active_port"
  printf 'viewer running\npid: %s\nurl: %s\nvault: %s\nlog: %s\n' \
    "$instance_pid" "$url" "$active_vault" "$log_file"
}

status_viewer() {
  local state
  if read_instance; then
    print_status
    return 0
  else
    state=$?
  fi
  if [[ "$state" == "2" ]]; then
    fail "recorded PID is live but cannot be verified as the recorded viewer server; refusing to claim it"
  fi
  clear_state
  printf 'viewer stopped\nlog: %s\n' "$log_file"
}

start_viewer() {
  local state child_pid url attempt
  if read_instance; then
    print_status
    return 0
  else
    state=$?
  fi
  if [[ "$state" == "2" ]]; then
    fail "recorded PID is live but cannot be verified as the recorded viewer server; refusing to replace it"
  fi
  clear_state
  require_runtime
  validate_inputs
  mkdir -p "$state_dir"
  chmod 700 "$state_dir"
  : > "$log_file"
  nohup env AGENT_VAULT="$vault" PORT="$port" node "$viewer_server" \
    </dev/null >>"$log_file" 2>&1 &
  child_pid=$!
  write_state "$child_pid"
  url="http://127.0.0.1:$port/api/health"

  for ((attempt = 1; attempt <= 50; attempt += 1)); do
    if ! kill -0 "$child_pid" 2>/dev/null; then
      tail -n 20 "$log_file" >&2 || true
      clear_state_for_pid "$child_pid"
      fail "viewer exited before becoming healthy"
    fi
    if health_check "$url"; then
      instance_pid="$child_pid"
      print_status
      return 0
    fi
    sleep 0.1
  done

  if read_instance; then
    kill "$instance_pid" 2>/dev/null || true
  fi
  tail -n 20 "$log_file" >&2 || true
  clear_state_for_pid "$child_pid"
  fail "viewer did not become healthy within 5 seconds"
}

stop_viewer() {
  local state attempt
  if read_instance; then
    :
  else
    state=$?
    if [[ "$state" == "2" ]]; then
      fail "recorded PID is live but cannot be verified as the recorded viewer server; refusing to stop it"
    fi
    clear_state
    printf 'viewer stopped\nlog: %s\n' "$log_file"
    return 0
  fi

  kill "$instance_pid"
  for ((attempt = 1; attempt <= 50; attempt += 1)); do
    if ! kill -0 "$instance_pid" 2>/dev/null; then
      clear_state_for_pid "$instance_pid"
      printf 'viewer stopped\nlog: %s\n' "$log_file"
      return 0
    fi
    sleep 0.1
  done
  fail "viewer PID $instance_pid did not stop after SIGTERM"
}

run_viewer() {
  require_runtime
  validate_inputs
  exec env AGENT_VAULT="$vault" PORT="$port" node "$viewer_server"
}

session_cleanup() {
  trap - EXIT HUP INT TERM
  if [[ -n "${child_pid:-}" ]] && kill -0 "$child_pid" 2>/dev/null; then
    kill "$child_pid" 2>/dev/null || true
    wait "$child_pid" 2>/dev/null || true
  fi
  clear_state_for_pid "$child_pid"
}

session_viewer() {
  local state url attempt exit_code
  if read_instance; then
    print_status
    return 0
  else
    state=$?
  fi
  if [[ "$state" == "2" ]]; then
    fail "recorded PID is live but cannot be verified as the recorded viewer server; refusing to replace it"
  fi
  clear_state
  require_runtime
  validate_inputs
  mkdir -p "$state_dir"
  chmod 700 "$state_dir"
  : > "$log_file"
  env AGENT_VAULT="$vault" PORT="$port" node "$viewer_server" \
    </dev/null >>"$log_file" 2>&1 &
  child_pid=$!
  write_state "$child_pid"
  trap session_cleanup EXIT HUP INT TERM
  url="http://127.0.0.1:$port/api/health"

  for ((attempt = 1; attempt <= 50; attempt += 1)); do
    if ! kill -0 "$child_pid" 2>/dev/null; then
      tail -n 20 "$log_file" >&2 || true
      fail "viewer exited before becoming healthy"
    fi
    if health_check "$url"; then
      instance_pid="$child_pid"
      print_status
      set +e
      wait "$child_pid"
      exit_code=$?
      set -e
      trap - EXIT HUP INT TERM
      clear_state_for_pid "$child_pid"
      return "$exit_code"
    fi
    sleep 0.1
  done

  tail -n 20 "$log_file" >&2 || true
  fail "viewer did not become healthy within 5 seconds"
}

case "$operation" in
  start) start_viewer ;;
  status) status_viewer ;;
  stop) stop_viewer ;;
  run) run_viewer ;;
  session) session_viewer ;;
  *) fail "usage: viewer.sh [start|status|stop|run|session]" ;;
esac
