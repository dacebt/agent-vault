#!/usr/bin/env bash
# vault-index.sh — produce a structured listing of a project's vault state.
#
# Usage: vault-index.sh <project-path> [--preamble|--full]
#
# Modes:
#   --preamble  Read-only resource map with a journal excerpt and recent handoff
#               references for SessionStart; does not query tasks or audit the graph.
#   --full      Verbose listing for the agent-vault:orient skill. All statuses listed,
#               with mtime per task, plus recent journal entries and recent decisions.

set -euo pipefail

project_path="${1:?usage: vault-index.sh <project-path> [--preamble|--full]}"
mode="${2:---preamble}"

task_db="$(dirname "$0")/task-db.py"
journal_dir="$project_path/journal"
handoffs_dir="$project_path/handoffs"
docs_dir="$project_path/docs"
decisions_dir="$docs_dir/decisions"
knowledge_dir="$project_path/knowledge"

project_name="$(basename "$project_path")"

# Portable mtime in YYYY-MM-DD (BSD stat on mac, GNU stat on linux).
mtime() {
  stat -f '%Sm' -t '%Y-%m-%d' "$1" 2>/dev/null || stat -c '%y' "$1" 2>/dev/null | cut -d' ' -f1
}

# SQLite-backed tasks as JSON. A missing or invalid database is a broken project
# contract, so orientation fails closed instead of reporting an empty board.
task_json() {
  local status="$1"
  if [[ "$status" == "in-progress" ]]; then
    python3 "$task_db" list "$project_path" --status in-progress --status blocked
  else
    python3 "$task_db" list "$project_path" --status "$status"
  fi
}

task_count() {
  task_json "$1" | jq 'length'
}

task_lines() {
  task_json "$1" | jq -r '.[] | [.generated_at[0:10], .task_key, .title, .task_status] | @tsv'
}

portable_days_ago() {
  local days="$1"
  date -v-"${days}"d +%Y-%m-%d 2>/dev/null || date -d "$days days ago" +%Y-%m-%d
}

recent_done_count() {
  local days="$1" since
  since="$(portable_days_ago "$days")"
  task_json "done" | jq --arg since "$since" '[.[] | select(.completed_at[0:10] >= $since)] | length'
}

recent_done_lines() {
  local days="$1" since
  since="$(portable_days_ago "$days")"
  task_json "done" | jq -r --arg since "$since" \
    '.[] | select(.completed_at[0:10] >= $since) | [.completed_at[0:10], .task_key, .title, .task_status] | @tsv'
}

task_title() {
  local f="$1"
  awk '/^# / { sub(/^# /, ""); print; exit }' "$f" 2>/dev/null || true
}

# Read a single key out of a leading YAML frontmatter block. Empty if no
# frontmatter or no such key. Supports plain scalars and the folded/literal
# block scalars used by templates for YAML-safe human text.
fm_field() {
  local f="$1" key="$2"
  awk -v k="$key" '
    NR == 1 { if ($0 !~ /^---[[:space:]]*$/) exit; next }
    /^---[[:space:]]*$/ { exit }
    block {
      if ($0 !~ /^[[:space:]]+/) exit
      line=$0
      sub(/^[[:space:]]+/, "", line)
      if (line != "") {
        if (seen) printf " "
        printf "%s", line
        seen=1
      }
      next
    }
    index($0, k ":") == 1 {
      sub("^" k ":[[:space:]]*", "")
      if ($0 ~ /^[>|][+-]?$/) { block=1; next }
      print
      exit
    }
    END { if (block && seen) print "" }
  ' "$f" 2>/dev/null || true
}

# Read the v0.2 handoff workflow field, with an explicit v0.1 compatibility
# fallback while existing bundles are being upgraded. Lifecycle `status` is
# never treated as workflow state in a v0.2 handoff.
handoff_state() {
  local f="$1" state version
  state="$(fm_field "$f" handoff_status)"
  if [[ -n "$state" ]]; then
    echo "$state"
    return
  fi
  version="$(fm_field "$project_path/index.md" okf_version)"
  if [[ "$version" == '"0.1"' || "$version" == "0.1" || -z "$version" ]]; then
    state="$(fm_field "$f" status)"
    case "$state" in live|spent) echo "$state"; return ;; esac
  fi
}

# First substantive body line — skips frontmatter, headings, rules, blanks.
body_snippet() {
  awk '
    NR == 1 && /^---[[:space:]]*$/ { fm = 1; next }
    fm && /^---[[:space:]]*$/ { fm = 0; next }
    fm { next }
    /^#/ || /^---/ || !/[^[:space:]]/ { next }
    { print; exit }
  ' "$1" 2>/dev/null || true
}

# Age of a file in whole days, portable across BSD/GNU stat.
age_days() {
  local f="$1" m
  m="$(stat -f '%m' "$f" 2>/dev/null || stat -c '%Y' "$f" 2>/dev/null)" || { echo 0; return; }
  echo $(( ( $(date +%s) - m ) / 86400 ))
}

recent_excerpt() {
  local file="$1" limit="$2" excerpt
  excerpt="$(fm_field "$file" description)"
  if [[ -z "$excerpt" ]]; then
    excerpt="$(awk '
      NR == 1 && /^---[[:space:]]*$/ { fm = 1; next }
      fm && /^---[[:space:]]*$/ { fm = 0; next }
      fm { next }
      /^#/ || /^---/ || !/[^[:space:]]/ { if (seen) exit; next }
      { printf "%s%s", (seen ? " " : ""), $0; seen=1 }
    ' "$file")"
  fi
  excerpt="$(printf '%s' "$excerpt" | tr '\n\r\t' '   ')"
  if (( ${#excerpt} > limit )); then
    printf '%s…' "${excerpt:0:limit}"
  else
    printf '%s' "$excerpt"
  fi
}

emit_preamble() {
  local plugin_root route purpose last_journal excerpt
  plugin_root="$(cd "$(dirname "$0")/.." && pwd)"
  echo "Project vault: $project_name"
  echo "Root: $project_path"
  echo
  echo "Where to find information — paths relative to the vault root:"
  if [[ -f "$knowledge_dir/index.md" ]]; then
    echo "- knowledge/index.md — project knowledge and topic navigation"
  elif [[ -d "$knowledge_dir" ]]; then
    echo "- knowledge/ — project knowledge and topic notes"
  fi
  for route in docs/decisions journal handoffs; do
    [[ -d "$project_path/$route" ]] || continue
    case "$route" in
      docs/decisions) purpose="recorded choices and their rationale" ;;
      journal) purpose="dated history of work, findings, and outcomes" ;;
      handoffs) purpose="unfinished-work context and resume points" ;;
    esac
    echo "- $route/ — $purpose"
  done
  echo "- $plugin_root/reference/task-commands.md — finding, creating, editing, and moving tasks"

  if [[ -d "$journal_dir" ]]; then
    last_journal="$(find "$journal_dir" -maxdepth 1 -name '*.md' -type f ! -name 'index.md' ! -name 'log.md' | sort -r | head -1)"
    if [[ -n "$last_journal" ]]; then
      echo
      echo "Latest journal: journal/$(basename "$last_journal")"
      excerpt="$(recent_excerpt "$last_journal" 400)"
      [[ -z "$excerpt" ]] || printf '%s\n' "$excerpt"
    fi
  fi

  if [[ -d "$handoffs_dir" ]]; then
    local shown=0 file
    while IFS= read -r file; do
      [[ "$(handoff_state "$file")" == "spent" ]] && continue
      if (( shown == 0 )); then
        echo
        echo "Recent handoffs:"
      fi
      excerpt="$(recent_excerpt "$file" 200)"
      printf -- '- handoffs/%s' "$(basename "$file")"
      [[ -z "$excerpt" ]] || printf ' — %s' "$excerpt"
      printf '\n'
      shown=$((shown + 1))
      (( shown < 3 )) || break
    done < <(find "$handoffs_dir" -maxdepth 1 -name '*.md' -type f ! -name 'index.md' ! -name 'log.md' | sort -r)
  fi

  echo
  echo "Use these references when relevant to the current request. Recent records provide continuity; verify their current relevance before treating them as work to resume."
}

emit_full() {
  echo "# $project_name"
  echo
  echo "Path: \`$project_path\`"
  echo

  for status in in-progress todo backlog; do
    local count
    count="$(task_count "$status")"
    echo "## tasks/$status ($count)"
    if [[ "$count" != "0" ]]; then
      task_lines "$status" | while IFS=$'\t' read -r touched id title task_status; do
        label=""; [[ "$task_status" == "blocked" ]] && label=" [blocked]"
        echo "- [$touched] \`$id\`${label} — ${title:-(no title)}"
      done
    fi
    echo
  done

  local done_count
  done_count="$(recent_done_count 14)"
  echo "## done tasks — last 14 days ($done_count)"
  if [[ "$done_count" != "0" ]]; then
    recent_done_lines 14 | while IFS=$'\t' read -r completed id title _status; do
      echo "- [$completed] \`$id\` — ${title:-(no title)}"
    done
  fi
  echo

  echo "## journal — last 5 entries"
  if [[ -d "$journal_dir" ]]; then
    find "$journal_dir" -maxdepth 1 -name '*.md' -type f 2>/dev/null | sort -r | head -5 | while read -r f; do
      jdate="$(basename "$f" .md)"
      jsnip="$(body_snippet "$f" | head -c 120)"
      echo "- $jdate — ${jsnip:-(empty)}"
    done
  fi
  echo

  echo "## handoffs — last 5 (resume-points for unfinished work)"
  if [[ -d "$handoffs_dir" ]]; then
    find "$handoffs_dir" -maxdepth 1 -name '*.md' -type f 2>/dev/null | sort -r | head -5 | while read -r f; do
      hname="$(basename "$f" .md)"
      hdesc="$(fm_field "$f" description)"
      [[ -n "$hdesc" ]] || hdesc="$(body_snippet "$f" | head -c 120)"
      hsess="$(fm_field "$f" session | cut -c1-8)"
      hstatus="$(handoff_state "$f")"
      echo "- $hname [${hstatus:-live}] (${hsess:-session?}, $(age_days "$f")d old) — ${hdesc:-(empty)}"
    done
  fi
  echo

  echo "## decisions — last 5"
  if [[ -d "$decisions_dir" ]]; then
    find "$decisions_dir" -maxdepth 1 -name '*.md' -type f ! -name 'index.md' ! -name 'log.md' 2>/dev/null | sort -r | head -5 | while read -r f; do
      dname="$(basename "$f" .md)"
      dtitle="$(task_title "$f")"
      echo "- \`$dname\` — ${dtitle:-(untitled)}"
    done
  fi
  echo

  echo "## knowledge — most-recently-edited 8 (the second brain)"
  if [[ -d "$knowledge_dir" ]]; then
    "$(dirname "$0")/list-newest.sh" "$knowledge_dir" | head -8 | while read -r f; do
      kname="$(basename "$f" .md)"
      ktitle="$(task_title "$f")"
      echo "- [$(mtime "$f")] \`$kname\` — ${ktitle:-(untitled)}"
    done
  fi
}

case "$mode" in
  --preamble) emit_preamble ;;
  --full)     emit_full ;;
  *) echo "unknown mode: $mode" >&2; exit 2 ;;
esac
