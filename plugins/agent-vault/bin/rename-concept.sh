#!/usr/bin/env bash
# rename-concept.sh — rename a concept file AND rewrite every inbound link so
# nothing dangles. This is the relink-on-rename behavior a graph consumer needs
# the vault otherwise can't: move /old/path.md to /new/path.md, then walk every
# file that links to the old concept and rewrite the bundle-relative markdown
# link target so backlinks survive the move.
#
# Usage: rename-concept.sh <project-path> <old> <new>
#   <old>/<new> are bundle-relative paths (e.g. knowledge/foo.md) or bare ids.
#   A bare-id <new> lands in the same directory as <old>; a path moves the file.
#
# Behavior:
#   1. Resolve old/new to real paths under the project (errors if old is missing
#      or new already exists).
#   2. Move the file with `git mv` when the file is tracked, else plain `mv`.
#   3. For every backlink (from backlinks.sh), rewrite the old bundle-relative
#      link target /old/path.md -> /new/path.md in markdown-link target form
#      ](...) only, preserving link display text and any #anchor.
#   4. A directory index.md that lists the old entry is rewritten by the same
#      pass (index.md is itself a backlink source).
#   5. Print the move and, per file, the count of links rewritten.
#
# Scope: only the canonical bundle-absolute markdown target — ](/old/path.md) and
# its #anchor form — is rewritten. Relative links (](foo.md)) and legacy [[id]]
# wikilinks are NOT rewritten (the doctrine discourages both forms); where a
# backlinked file carries only such a link it is reported as a warning, not
# silently skipped, so the operator can fix it by hand.
#
# bash 3.2-safe (macOS default): no mapfile, no associative arrays.

set -euo pipefail

project="${1:?usage: rename-concept.sh <project-path> <old> <new>}"
old_arg="${2:?usage: rename-concept.sh <project-path> <old> <new>}"
new_arg="${3:?usage: rename-concept.sh <project-path> <old> <new>}"

here="$(cd "$(dirname "$0")" && pwd)"

cd "$project" 2>/dev/null || { echo "rename-concept: no such project: $project" >&2; exit 1; }
project_abs="$(pwd)"

# --- resolve <old> to a bundle-relative path (no leading slash) ----------------
# Accept: bundle-relative path (knowledge/foo.md or knowledge/foo), bare id (foo).
resolve_old() {
  local a="$1" c
  c="${a#/}"                                  # tolerate a leading slash
  if [[ -f "$c" ]]; then printf '%s\n' "$c"; return 0; fi
  if [[ -f "$c.md" ]]; then printf '%s\n' "$c.md"; return 0; fi
  # Bare id (or basename) — search the bundle for a single matching <id>.md.
  local id hits
  id="$(basename "$c")"; id="${id%.md}"
  hits="$(find . -name "${id}.md" -type f 2>/dev/null | sed 's|^\./||')"
  if [[ -z "$hits" ]]; then return 1; fi
  if [[ "$(printf '%s\n' "$hits" | grep -c .)" -gt 1 ]]; then
    echo "rename-concept: '$a' is ambiguous; matches:" >&2
    printf '  %s\n' $hits >&2
    exit 1
  fi
  printf '%s\n' "$hits"
}

oldrel="$(resolve_old "$old_arg" || true)"
[[ -n "$oldrel" && -f "$oldrel" ]] || { echo "rename-concept: old concept not found: $old_arg" >&2; exit 1; }

# --- resolve <new> to a bundle-relative path (no leading slash) ----------------
newrel="${new_arg#/}"
if [[ "$newrel" != */* ]]; then
  # Bare id: keep it in the same directory as <old>.
  olddir="$(dirname "$oldrel")"
  if [[ "$olddir" == "." ]]; then newrel="$newrel"; else newrel="$olddir/$newrel"; fi
fi
[[ "$newrel" == *.md ]] || newrel="$newrel.md"

if [[ "$newrel" == "$oldrel" ]]; then
  echo "rename-concept: old and new resolve to the same path: $oldrel" >&2
  exit 1
fi
if [[ -e "$newrel" ]]; then
  echo "rename-concept: new concept already exists: $newrel" >&2
  exit 1
fi

# Bare id of <old> drives the backlink query (matches the basename, no .md).
old_id="$(basename "$oldrel")"; old_id="${old_id%.md}"

# Bundle-relative link targets (with the leading slash links actually carry).
old_target="/$oldrel"
new_target="/$newrel"

# --- move the file -------------------------------------------------------------
newdir="$(dirname "$newrel")"
[[ "$newdir" == "." ]] || mkdir -p "$newdir"

is_git=0
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then is_git=1; fi

if [[ "$is_git" -eq 1 ]] && git ls-files --error-unmatch "$oldrel" >/dev/null 2>&1; then
  git mv "$oldrel" "$newrel"
  move_how="git mv"
else
  mv "$oldrel" "$newrel"
  move_how="mv"
fi

echo "moved: $oldrel -> $newrel ($move_how)"

# --- rewrite inbound links -----------------------------------------------------
# Portable in-place sed: BSD/macOS needs an explicit empty suffix after -i.
sed_inplace() {
  if sed --version >/dev/null 2>&1; then sed -i "$@"; else sed -i '' "$@"; fi
}

# Escape regex metacharacters for the search side ('|' included — it is our
# sed delimiter). Same class backlinks.sh uses, plus the delimiter.
esc_re() { printf '%s' "$1" | sed 's/[][\.*^$/+?(){}|]/\\&/g'; }
# Escape backslash, '&', and '|' for the replacement side.
esc_rep() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/[&|]/\\\&/g'; }

old_re="$(esc_re "$old_target")"
new_rep="$(esc_rep "$new_target")"

# backlinks.sh emits "relpath:linenum: matched-line"; we only need the relpath.
# It is included on the same hub; resolve via the script's own directory.
# Collect the unique set of files that link to the old id.
backlink_files="$(
  "$here/backlinks.sh" "$project_abs" "$old_id" 2>/dev/null \
    | sed 's/:[0-9][0-9]*:.*$//' \
    | sort -u || true
)"

# Feed the file list via a heredoc (not a pipe) so the loop runs in THIS shell
# and the counters survive — bash-3.2-safe, and read -r tolerates spaces.
total_files=0
total_links=0
while IFS= read -r f; do
  [[ -n "$f" && -f "$f" ]] || continue
  # Count occurrences of the markdown target form ]( <old_target> followed by
  # ')' or '#' in this file BEFORE rewriting, so the report is the real number.
  n="$(grep -oE "\]\(${old_re}[)#]" "$f" 2>/dev/null | grep -c . || true)"
  if [[ "$n" -eq 0 ]]; then
    # backlinks.sh surfaced this file, but it carries no canonical bundle-absolute
    # "$old_target" target — likely a relative ](foo.md) or legacy [[id]] link, which
    # we deliberately don't rewrite. Warn rather than skip silently so the operator
    # knows a link was left behind to fix by hand, instead of trusting "nothing dangles".
    printf '  warning: %s references this concept but not via the canonical %s target (relative or legacy link?) — left unchanged, fix by hand\n' "$f" "$old_target" >&2
    continue
  fi
  # Rewrite ]( <old_target> followed by ')' or '#anchor' — \1 keeps that char,
  # so display text and anchors are preserved and longer paths don't match.
  sed_inplace -E "s|\]\(${old_re}([)#])|](${new_rep}\1|g" "$f"
  suffix=s; [[ "$n" -eq 1 ]] && suffix=
  printf '  relinked: %s (%s link%s)\n' "$f" "$n" "$suffix"
  total_files=$((total_files + 1))
  total_links=$((total_links + n))
done <<EOF
$backlink_files
EOF

echo "done: $total_links link(s) rewritten across $total_files file(s)"
