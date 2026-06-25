#!/usr/bin/env bash
# Statusline: glanceable LIST of decisions awaiting the maintainer.
# Reads .fray/decisions.json (tool-managed by scripts/decisions.mjs), prints a
# header + one row per decision. Claude Code statuslines render each printed line
# as a separate row. Pure file read, no network — must stay fast. stdin JSON is
# ignored. Mutations go through scripts/decisions.mjs; this only reads the store.
set -euo pipefail

# Resolve repo root relative to this script so the statusline works from any cwd.
dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
file="$dir/.fray/decisions.json"

# Drain stdin (Claude pipes session JSON in) without blocking.
cat >/dev/null 2>&1 || true

if [ ! -s "$file" ]; then
  printf '✓ no pending decisions\n'
  exit 0
fi

width="${COLUMNS:-100}"
[ "$width" -ge 24 ] 2>/dev/null || width=100

# One line per decision: "[ref] text" (ref omitted when absent). Prefer jq, fall
# back to node — either way the JSON parse lives in one tool, not shell hacks.
if command -v jq >/dev/null 2>&1; then
  decisions=$(jq -r '.[] | (if .ref then "[" + .ref + "] " else "" end) + .text' "$file" 2>/dev/null) || true
elif command -v node >/dev/null 2>&1; then
  decisions=$(node -e '
    const fs=require("fs");
    let a=[];try{a=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));}catch{}
    if(!Array.isArray(a))a=[];
    for(const d of a)process.stdout.write((d.ref?`[${d.ref}] `:"")+d.text+"\n");
  ' "$file" 2>/dev/null) || true
else
  printf '✓ no pending decisions\n'
  exit 0
fi

if [ -z "$decisions" ]; then
  printf '✓ no pending decisions\n'
  exit 0
fi

n=$(printf '%s\n' "$decisions" | grep -c .)

printf '⚖ %s decision(s) awaiting you:\n' "$n"

cap=10
printf '%s\n' "$decisions" | awk -v w="$width" -v cap="$cap" -v total="$n" '
  NR <= cap {
    line = " • " $0
    if (length(line) > w) line = substr(line, 1, w - 1) "…"
    print line
  }
  END {
    if (total > cap) printf " …(+%d more)\n", total - cap
  }
'
