#!/usr/bin/env bash
# graph-audit.sh — report link-graph health in an OKF knowledge bundle.
#
# Usage: graph-audit.sh [--quick] <project-path>
#
# Sections (each printed only when it has findings):
#   ORPHANS                  concepts with no inbound and no outbound concept links
#   DANGLING LINKS           markdown links whose target file does not exist
#   LEGACY WIKILINKS         [[...]] links not yet migrated to OKF markdown links
#   MISSING INDEX            a knowledge/doc directory with concepts but no index.md
#   INDEX GAPS               a concept not listed in its directory's index.md
#   UNLINKED MENTIONS        bare text naming an existing concept id/alias, not linked
#
# --quick skips ONLY the UNLINKED MENTIONS computation+section. Every other
# section, and the machine-readable SUMMARY line, still runs. <project-path>
# and --quick may appear in either order.
#
# Always prints, LAST, exactly one machine-readable line (both modes):
#   SUMMARY: concepts=<n> orphans=<n> dangling=<n> legacy=<n> missing_index=<n> index_gaps=<n>
#
# This reports graph health only; it does not validate document metadata or edit files.

set -euo pipefail

quick=0
project=""
for arg in "$@"; do
  case "$arg" in
    --quick) quick=1 ;;
    *) project="$arg" ;;
  esac
done
[[ -n "$project" ]] || { echo "usage: graph-audit.sh [--quick] <project-path>" >&2; exit 1; }
project="$(cd "$project" 2>/dev/null && pwd)" || { echo "graph-audit: no such project: $project" >&2; exit 1; }
plugin_root="${PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}}"
task_graph_json="$(python3 "$plugin_root/bin/task-graph.py" "$project")" || exit 1
task_count="$(printf '%s' "$task_graph_json" | jq -r '.task_count')"
task_ids="$(printf '%s' "$task_graph_json" | jq -r '.task_ids[]')"
task_file_targets="$(printf '%s' "$task_graph_json" | jq -r '.file_targets[]')"
cd "$project" 2>/dev/null || { echo "graph-audit: no such project: $project" >&2; exit 1; }

# For graph-health purposes, audit non-reserved knowledge concepts and exclude
# generated views plus README.md (bundle identity). OKF format validation still
# validates every non-reserved Markdown file, including README.md and views.
is_concept_find=( find . -type f -name '*.md'
  ! -name 'index.md' ! -name 'log.md' ! -name 'README.md'
  ! -path './views/*' )

esc() { printf '%s' "$1" | sed 's/[][\.*^$/+?(){}|]/\\&/g'; }

# Does any OTHER md file link to concept <id>? (markdown link or wikilink;
# index.md membership counts, so reserved files are in scope here.) The `[)#]`
# after .md catches anchored links (/dir/id.md#section) too — without it a concept
# linked only via anchored links would be falsely reported as an orphan.
has_inbound() {
  local id="$1" rel="$2" e; e="$(esc "$id")"
  if grep -rlE --include='*.md' "\]\([^)]*${e}\.md[)#]|\[\[${e}(\||\])" . 2>/dev/null \
    | sed 's|^\./||' | grep -vx "$(printf '%s' "$rel")" >/dev/null 2>&1; then
    return 0
  fi
  printf '%s\n' "$task_file_targets" | grep -qxF "/$rel"
}

# Outbound markdown-link targets (raw, ending in .md), one per line.
outbound_targets() {
  grep -oE '\]\([^)]+\)' "$1" 2>/dev/null \
    | sed -E 's/^\]\(//; s/\)$//' || true
}

# Resolve a raw link target (relative to concept file <relpath>) to a bundle path.
resolve_target() {
  local raw="$1" from_dir="$2" p
  case "$raw" in
    /*)  p="${raw#/}" ;;                       # bundle-relative absolute
    *)   p="${from_dir%/}/$raw" ;;             # relative to the linking file
  esac
  # Normalise ./ and ../ cheaply via a subshell + cd is overkill; use awk-free path collapse.
  printf '%s' "$p" | sed -E 's|/\./|/|g; s|^\./||'
}

section() { printf '\n## %s\n' "$1"; }

# Count findings (one per line) in an accumulator; 0 when empty.
count_findings() { if [[ -n "$1" ]]; then printf '%s' "$1" | grep -c '^'; else echo 0; fi; }

# ---- ORPHANS + DANGLING + LEGACY (single pass over concepts) ----
orphans=""; dangling=""; legacy=""
while IFS= read -r f; do
  rel="${f#./}"
  dir="$(dirname "$rel")"; [[ "$dir" == "." ]] && dir=""
  id="$(basename "$rel" .md)"

  # outbound resolvable concept links?
  out=0
  while IFS= read -r t; do
    [[ -n "$t" ]] || continue
    if [[ "$t" == task:* ]]; then
      task_id="${t#task:}"
      if printf '%s\n' "$task_ids" | grep -qxF "$task_id"; then
        out=1
      else
        dangling+="- \`$rel\` → \`$t\` (task missing)"$'\n'
      fi
    elif [[ "${t%%#*}" == *.md ]]; then
      rp="$(resolve_target "${t%%#*}" "$dir")"
      if [[ -f "$rp" ]]; then
        out=1
      else
        dangling+="- \`$rel\` → \`$t\` (target missing)"$'\n'
      fi
    fi
  done < <(outbound_targets "$f")

  # legacy wikilinks present?
  if grep -q '\[\[' "$f" 2>/dev/null; then
    legacy+="- \`$rel\` still has [[wikilinks]] — migrate to markdown links"$'\n'
  fi

  # orphan = no outbound AND no inbound
  if [[ "$out" == "0" ]] && ! has_inbound "$id" "$rel"; then
    orphans+="- \`$rel\` — no links in or out (add a See also link and list it in the directory index.md)"$'\n'
  fi
done < <("${is_concept_find[@]}" 2>/dev/null | sort)

while IFS= read -r finding; do
  [[ -n "$finding" ]] && orphans+="- $finding"$'\n'
done < <(printf '%s' "$task_graph_json" | jq -r '.orphans[]')
while IFS= read -r finding; do
  [[ -n "$finding" ]] && dangling+="- $finding"$'\n'
done < <(printf '%s' "$task_graph_json" | jq -r '.dangling[]')

# ---- MISSING INDEX + INDEX GAPS (the MOC'd layers) ----
missing_index=""; index_gaps=""
for d in knowledge docs docs/decisions; do
  [[ -d "$d" ]] || continue
  # concepts directly in this dir (not subdirs)
  cnt="$(find "$d" -maxdepth 1 -type f -name '*.md' ! -name 'index.md' ! -name 'log.md' 2>/dev/null | wc -l | tr -d ' ')"
  [[ "$cnt" == "0" ]] && continue
  if [[ ! -f "$d/index.md" ]]; then
    missing_index+="- \`$d/\` has $cnt concept(s) but no index.md (MOC on-ramp missing)"$'\n'
    continue
  fi
  while IFS= read -r c; do
    cid="$(basename "$c" .md)"
    grep -qF "$cid.md" "$d/index.md" 2>/dev/null || \
      index_gaps+="- \`$d/index.md\` is missing an entry for \`$cid\`"$'\n'
  done < <(find "$d" -maxdepth 1 -type f -name '*.md' ! -name 'index.md' ! -name 'log.md' 2>/dev/null | sort)
done

# ---- UNLINKED MENTION CANDIDATES ----
mentions=""
if [[ "$quick" == "0" ]]; then
  mentions="$(python3 "$plugin_root/bin/unlinked-mentions.py" "$project")"
  if [[ -n "$mentions" ]]; then
    mentions+=$'\n'
  fi
fi

# ---- emit ----
found=0
# Note: must return 0 even when the section is empty — a bare `[[ -n ]] && {...}`
# returns 1 on an empty body, and under `set -e` that would kill the script
# right after the header on a healthy bundle. The `if` form returns 0.
emit() { local title="$1" body="$2"; if [[ -n "$body" ]]; then section "$title"; printf '%s' "$body"; found=1; fi; }
echo "# graph audit — $(basename "$project")"
emit "ORPHANS" "$orphans"
emit "DANGLING LINKS" "$dangling"
emit "LEGACY WIKILINKS" "$legacy"
emit "MISSING INDEX" "$missing_index"
emit "INDEX GAPS" "$index_gaps"
emit "UNLINKED MENTIONS" "$mentions"
[[ "$found" == "0" ]] && echo $'\nGraph is healthy — no orphans, dangling links, legacy wikilinks, missing indexes, or unlinked mentions found.'

# ---- machine-readable summary (LAST line, both modes) ----
markdown_concepts_count="$("${is_concept_find[@]}" 2>/dev/null | wc -l | tr -d ' ')"
concepts_count=$((markdown_concepts_count + task_count))
printf 'SUMMARY: concepts=%s orphans=%s dangling=%s legacy=%s missing_index=%s index_gaps=%s\n' \
  "$concepts_count" \
  "$(count_findings "$orphans")" \
  "$(count_findings "$dangling")" \
  "$(count_findings "$legacy")" \
  "$(count_findings "$missing_index")" \
  "$(count_findings "$index_gaps")"
exit 0
