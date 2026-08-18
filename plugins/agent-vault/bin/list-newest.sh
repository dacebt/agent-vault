#!/usr/bin/env bash
# list-newest.sh — print .md files in <dir>, newest first, one path per line.
#
# Usage: list-newest.sh <dir>
#
# Uses tab-separated mtime+path then sort+cut so filenames with spaces survive.
# Portable stat invocation: BSD (-f '%m') on macOS, GNU (-c '%Y') on Linux.
# Empty / missing directory: exits 0 with no output (no error).

set -euo pipefail

dir="${1:?usage: list-newest.sh <dir>}"
[[ -d "$dir" ]] || exit 0

# Exclude OKF reserved files — index.md / log.md are not concepts and must never
# be listed as one (e.g. as a "knowledge note" or the "last decision").
find "$dir" -maxdepth 1 -name '*.md' -type f \
     ! -name 'index.md' ! -name 'log.md' 2>/dev/null \
  | while read -r f; do
      m="$(stat -f '%m' "$f" 2>/dev/null || stat -c '%Y' "$f")"
      printf '%s\t%s\n' "$m" "$f"
    done \
  | sort -rn \
  | cut -f2-
