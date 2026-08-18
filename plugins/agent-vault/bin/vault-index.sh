#!/usr/bin/env bash
# vault-index.sh — produce a structured listing of a project's vault state.
#
# Usage: vault-index.sh <project-path> [--preamble|--full]
#
# Modes:
#   --preamble  Compact orientation block intended for SessionStart context injection.
#               Names in-progress tasks, counts the kanban, surfaces the last journal
#               entry and last decision. Token-budget conscious.
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

# OKF reserved files (index.md / log.md) are not concepts — exclude them from all
# concept counts and listings, or the preamble miscounts notes and surfaces a MOC
# as the "last decision".
count_md() {
  local dir="$1"
  if [[ -d "$dir" ]]; then
    find "$dir" -maxdepth 1 -name '*.md' -type f ! -name 'index.md' ! -name 'log.md' 2>/dev/null | wc -l | tr -d ' '
  else
    echo 0
  fi
}

count_recent_md() {
  local dir="$1" days="$2"
  if [[ -d "$dir" ]]; then
    find "$dir" -maxdepth 1 -name '*.md' -type f ! -name 'index.md' ! -name 'log.md' -mtime "-$days" 2>/dev/null | wc -l | tr -d ' '
  else
    echo 0
  fi
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

# First task a handoff links that is now done — the strongest
# "this resume-point is spent" signal. Parses both OKF-native markdown links
# ([text](/tasks/.../id.md)) and legacy [[wikilinks]] so it keeps working
# across the migration.
linked_done_task() {
  local f="$1" uri task
  grep -oE 'task:[0-9a-fA-F-]{36}' "$f" 2>/dev/null | while IFS= read -r uri; do
    [[ -n "$uri" ]] || continue
    task="$(python3 "$task_db" show "$project_path" "$uri" 2>/dev/null)" || continue
    if [[ "$(printf '%s' "$task" | jq -r '.task_status')" == "done" ]]; then
      printf '%s\n' "$(printf '%s' "$task" | jq -r '.task_key')"
      break
    fi
  done
  return 0
}

emit_preamble() {
  local bk td ip done7
  bk="$(task_count backlog)"
  td="$(task_count todo)"
  ip="$(task_count in-progress)"
  done7="$(recent_done_count 7)"

  echo "**Agent Vault online** — project \`$project_name\`"
  echo "Path: $project_path"
  echo

  if [[ "$ip" != "0" ]]; then
    echo "In-progress ($ip):"
    task_lines in-progress | while IFS=$'\t' read -r touched id title status; do
      label=""; [[ "$status" == "blocked" ]] && label=" [blocked]"
      echo "- \`$id\`${label} — ${title:-(no title)} (touched $touched)"
    done
    echo
  fi

  # Handoff index: name + description one-liners, not pre-loaded content. The
  # agent decides which (if any) handoff is the live resume-point and reads it
  # in full via agent-vault:handoff. Spent handoffs are excluded; staleness signals
  # (age, closed linked task) are surfaced so a dead resume-point isn't trusted
  # just for being newest.
  if [[ -d "$handoffs_dir" ]]; then
    local hlines="" shown=0 f
    while IFS= read -r f; do
      [[ -n "$f" ]] || continue
      (( shown >= 3 )) && break
      [[ "$(handoff_state "$f")" == "spent" ]] && continue
      local hname hdesc hsess hage flags=""
      hname="$(basename "$f" .md)"
      hdesc="$(fm_field "$f" description)"
      [[ -n "$hdesc" ]] || hdesc="$(body_snippet "$f" | head -c 120)"
      hsess="$(fm_field "$f" session | cut -c1-8)"
      hage="$(age_days "$f")"
      (( hage > 14 )) && flags=", stale?"
      local done_task
      done_task="$(linked_done_task "$f")"
      if [[ -n "$done_task" ]]; then
        # Strongest spent-signal: this still-live handoff links a task now done.
        # Flip it to spent now (surgical, file preserved) so it stops surfacing after this
        # session — then show it once here with the action taken. Only this closed-task
        # case auto-marks; age-only staleness (below) stays a flag, since it's weaker.
        if "$(dirname "$0")/mark-handoff-spent.sh" "$project_path" "$hname" >/dev/null 2>&1; then
          flags="$flags, task \`$done_task\` closed — marked spent"
        else
          flags="$flags, task \`$done_task\` closed — upgrade/repair required before marking spent"
        fi
      fi
      hlines+="- \`$hname\` (${hsess:-session?}, ${hage}d old${flags}) — ${hdesc:-(no description)}"$'\n'
      shown=$((shown + 1))
    done < <(find "$handoffs_dir" -maxdepth 1 -name '*.md' -type f 2>/dev/null | sort -r)
    if [[ -n "$hlines" ]]; then
      echo "Handoffs — unfinished-work resume-points, newest first. Index only; read the relevant one in full (agent-vault:handoff) and verify against current state before acting:"
      printf '%s' "$hlines"
      echo
    fi
  fi

  echo "Backlog: $bk  •  Todo: $td  •  Done last 7d: $done7"

  local kn
  kn="$(count_md "$knowledge_dir")"
  if [[ "$kn" != "0" ]]; then
    local knames
    knames="$("$(dirname "$0")/list-newest.sh" "$knowledge_dir" 2>/dev/null | head -6 \
      | while IFS= read -r f; do printf '%s ' "\`$(basename "$f" .md)\`"; done)"
    echo "Knowledge: $kn note$([[ "$kn" == "1" ]] || echo s) — ${knames%% }"
  fi

  local last_journal
  last_journal="$(find "$journal_dir" -maxdepth 1 -name '*.md' -type f 2>/dev/null | sort -r | head -1)"
  if [[ -n "$last_journal" ]]; then
    local jdate jsnip
    jdate="$(basename "$last_journal" .md)"
    jsnip="$(awk '!/^#/ && !/^---/ && /[^[:space:]]/ { print; exit }' "$last_journal" 2>/dev/null | head -c 100)"
    echo "Last journal: $jdate — ${jsnip:-(empty)}"
  fi

  local last_decision
  last_decision="$(find "$decisions_dir" -maxdepth 1 -name '*.md' -type f ! -name 'index.md' ! -name 'log.md' 2>/dev/null | sort -r | head -1)"
  if [[ -n "$last_decision" ]]; then
    local dname dtitle
    dname="$(basename "$last_decision" .md)"
    dtitle="$(task_title "$last_decision")"
    echo "Last decision: $dname — ${dtitle:-(untitled)}"
  fi

  # Graph health signal: run the sibling auditor in --quick mode (skips the
  # expensive unlinked-mentions scan) and read its machine-readable SUMMARY line.
  # Emit a single nudge ONLY when there's something to fix — orphans, dangling
  # links, or legacy links — keeping the preamble lean (ADR-005). Fail silent on
  # any error so a missing/broken auditor never breaks SessionStart.
  local graph_summary
  graph_summary="$("$(dirname "$0")/graph-audit.sh" --quick "$project_path" 2>/dev/null | grep '^SUMMARY:' | head -1)" || true
  if [[ -n "$graph_summary" ]]; then
    local g_concepts g_orphans g_dangling g_legacy
    g_concepts="$(echo "$graph_summary" | sed -E 's/.*concepts=([0-9]+).*/\1/')"
    g_orphans="$(echo "$graph_summary" | sed -E 's/.*orphans=([0-9]+).*/\1/')"
    g_dangling="$(echo "$graph_summary" | sed -E 's/.*dangling=([0-9]+).*/\1/')"
    g_legacy="$(echo "$graph_summary" | sed -E 's/.*legacy=([0-9]+).*/\1/')"
    # Guard against non-numeric extraction (malformed SUMMARY) before arithmetic
    # AND before interpolating g_concepts into the emitted line.
    if [[ "$g_concepts" =~ ^[0-9]+$ ]] && [[ "$g_orphans" =~ ^[0-9]+$ ]] && [[ "$g_dangling" =~ ^[0-9]+$ ]] && [[ "$g_legacy" =~ ^[0-9]+$ ]]; then
      if (( g_orphans + g_dangling + g_legacy > 0 )); then
        echo "Graph: ${g_concepts} concepts · ${g_orphans} orphan(s) · ${g_dangling} dangling · ${g_legacy} legacy-link(s) — run agent-vault:weave"
      fi
    fi
  fi

  echo
  echo "Knowledge layer is yours to maintain silently — when the user says \"update the project docs\" or mentions something worth recording, write to knowledge/, docs/, decisions/, or journal/ from observation; do not interview the user about layers."
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
