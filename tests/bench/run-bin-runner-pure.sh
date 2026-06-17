#!/usr/bin/env bash
# Bin-runner DISPATCH benchmark — PURE-SHELL local .bin (no node invocation).
#
# What it measures: how long each tool takes to locate a binary in
# node_modules/.bin and dispatch it. This is the `nubx <tool>` / `nub exec`
# path vs `pnpm exec` / `npm exec` / `bun x` for a LOCALLY-INSTALLED bin.
# To isolate the RUNNER's overhead, the .bin script itself MUST be pure-shell
# (`exit 0`), NEVER `node -e ...` — Node's ~40ms cold startup would swamp the
# few-ms dispatch overhead and dilute the very thing being measured. This is the
# bin-runner sibling of run-script-runner-pure.sh and uses the same harness.
#
# Tools: nub exec (== nubx) / pnpm exec / npm exec; bun x optional.
#
# Requires: hyperfine, pnpm, npm; bun optional; NUB env var or target/release/nub.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
NUB="${NUB:-$REPO_ROOT/target/release/nub}"
# Resolve NUB to an absolute path: every dispatch runs in a subshell that cd's
# into the fixture dir, so a relative NUB= must still resolve there.
case "$NUB" in /*) ;; *) NUB="$(cd "$(dirname "$NUB")" 2>/dev/null && pwd)/$(basename "$NUB")" ;; esac
RESULTS_DIR="$REPO_ROOT/tests/bench/results"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"

WARMUP=5
RUNS=30
while [[ $# -gt 0 ]]; do
  case "$1" in
    --warmup) WARMUP="$2"; shift 2 ;;
    --runs)   RUNS="$2";   shift 2 ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

[[ -x "$NUB" ]] || { echo "ERROR: nub not found at $NUB" >&2; exit 1; }
command -v hyperfine &>/dev/null || { echo "ERROR: hyperfine not found." >&2; exit 1; }
command -v pnpm &>/dev/null || { echo "ERROR: pnpm not found." >&2; exit 1; }
command -v npm &>/dev/null || { echo "ERROR: npm not found." >&2; exit 1; }
HAS_BUN=0; command -v bun &>/dev/null && HAS_BUN=1

# Fixture: a project with a single LOCALLY-INSTALLED pure-shell bin in
# node_modules/.bin. No real dependency; we hand-build the .bin so the dispatch
# never touches node or the network.
FIXTURE="$(mktemp -d /tmp/nub-bin-runner-pure-XXXXXX)"
trap 'rm -rf "$FIXTURE"' EXIT
cat > "$FIXTURE/package.json" <<'EOF'
{
  "name": "bin-runner-pure-bench",
  "version": "1.0.0"
}
EOF
mkdir -p "$FIXTURE/node_modules/.bin"
# A pure-shell bin: exits 0 immediately, no node, no I/O.
cat > "$FIXTURE/node_modules/.bin/noopbin" <<'EOF'
#!/bin/sh
exit 0
EOF
chmod +x "$FIXTURE/node_modules/.bin/noopbin"

# Verify each runner can dispatch the bin (cwd must be project root).
( cd "$FIXTURE" && "$NUB" exec noopbin >/dev/null 2>&1 ) || { echo "nub exec failed" >&2; exit 1; }
( cd "$FIXTURE" && pnpm exec noopbin >/dev/null 2>&1 )    || { echo "pnpm exec failed" >&2; exit 1; }
( cd "$FIXTURE" && npm exec noopbin >/dev/null 2>&1 )     || { echo "npm exec failed" >&2; exit 1; }

echo "================================================================"
echo "  Bin-runner DISPATCH benchmark — PURE-SHELL local .bin ('exit 0')"
echo "  (no node invocation — isolates nubx/exec dispatch overhead)"
echo "  nub:  $("$NUB" --version 2>&1 | head -1)"
echo "  pnpm: $(pnpm --version)   npm: $(npm --version)"
echo "  bun:  $([[ $HAS_BUN -eq 1 ]] && bun --version || echo '(absent)')"
echo "  warmup: $WARMUP  runs: $RUNS"
echo "  date: $(date)   load: $(uptime | sed 's/.*load averages*: //')"
echo "================================================================"

OUTFILE="$RESULTS_DIR/bin-runner-pure-${TIMESTAMP}.json"
mkdir -p "$RESULTS_DIR"

HF_ARGS=(
  --warmup "$WARMUP" --runs "$RUNS" --export-json "$OUTFILE"
  --command-name "nub exec"  "cd '$FIXTURE' && '$NUB' exec noopbin"
  --command-name "pnpm exec" "cd '$FIXTURE' && pnpm exec noopbin"
  --command-name "npm exec"  "cd '$FIXTURE' && npm exec noopbin"
)
if [[ $HAS_BUN -eq 1 ]]; then
  ( cd "$FIXTURE" && bun x noopbin >/dev/null 2>&1 ) \
    && HF_ARGS+=( --command-name "bun x" "cd '$FIXTURE' && bun x noopbin" )
fi

hyperfine "${HF_ARGS[@]}"
echo ""
echo "  [results saved → $OUTFILE]"
echo "================================================================"
