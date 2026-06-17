#!/usr/bin/env bash
# Script-runner dispatch benchmark — nub run vs `node --run` (and npm / pnpm).
#
# This measures package.json script dispatch overhead. `node --run` starts Node
# before it can read package.json and dispatch the script. `nub run` does the
# dispatch path in Rust, then pays Node startup only if the script body invokes
# Node.
#
# Methodology: every command reads package.json, dispatches the same script, is
# warmed before measurement, and is exit-0-verified before timing.
#
# Two fixtures isolate two layers:
#   - `true`        : PURE dispatch. Both runners spawn `true` (no node body).
#                     The ONLY difference timed is whether the runner itself had
#                     to boot V8 to get there. This is the cleanest signal.
#   - `node -e ""`  : dispatch + a real (empty) node body. Both pay one node
#                     startup for the body; nub additionally avoids a SECOND
#                     node startup for the dispatch, node --run does not.
#
# This is a canonical checked-in benchmark harness. Results are written as
# hyperfine JSON under tests/bench/results/.
#
# Requires: hyperfine, node (>=22 for `node --run`), npm, pnpm; NUB env var or
# target/release/nub.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
NUB="${NUB:-$REPO_ROOT/target/release/nub}"
# Resolve NUB to an absolute path: every run happens in a subshell that cd's into
# a fixture dir, so a relative NUB= would fail to resolve there.
case "$NUB" in
  /*) ;;
  */*) NUB="$(cd "$(dirname "$NUB")" 2>/dev/null && pwd)/$(basename "$NUB")" ;;
  *) NUB="$(command -v "$NUB" 2>/dev/null || true)" ;;
esac
RESULTS_DIR="$REPO_ROOT/tests/bench/results"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"

# Default to a high-sample run; lower these for smoke tests.
WARMUP=10
RUNS=100
MAX_LOAD=2.0   # refuse to time on a noisy box; wait until 1-min load drops below this
while [[ $# -gt 0 ]]; do
  case "$1" in
    --warmup)   WARMUP="$2";   shift 2 ;;
    --runs)     RUNS="$2";     shift 2 ;;
    --max-load) MAX_LOAD="$2"; shift 2 ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

[[ -x "$NUB" ]] || { echo "ERROR: nub not found at $NUB" >&2; exit 1; }
command -v hyperfine &>/dev/null || { echo "ERROR: hyperfine not found." >&2; exit 1; }
command -v node &>/dev/null      || { echo "ERROR: node not found." >&2; exit 1; }
command -v npm  &>/dev/null      || { echo "ERROR: npm not found." >&2; exit 1; }
command -v pnpm &>/dev/null      || { echo "ERROR: pnpm not found." >&2; exit 1; }

# `node --run` landed in Node 22. Hard-fail with a clear message if absent.
node --run >/dev/null 2>&1 || true   # `node --run` with no arg prints usage (exit !=0); presence-check below
if ! node --help 2>&1 | grep -q -- '--run'; then
  echo "ERROR: this node ($(node --version)) does not support 'node --run' (needs >=22)." >&2
  exit 1
fi

# --- Idle-machine discipline -------------------------------------------------
one_min_load() { uptime | sed -E 's/.*load averages?: *([0-9.]+).*/\1/'; }
WAITED=0
while :; do
  L="$(one_min_load)"
  awk -v l="$L" -v m="$MAX_LOAD" 'BEGIN{exit !(l<m)}' && break
  if [[ $WAITED -ge 120 ]]; then
    echo "WARNING: 1-min load=$L still >= $MAX_LOAD after ${WAITED}s; proceeding but flagging." >&2
    break
  fi
  echo "  [load=$L >= $MAX_LOAD — waiting 15s for the box to quiet down...]" >&2
  sleep 15; WAITED=$((WAITED+15))
done
LOAD_AT_RUN="$(one_min_load)"

# --- Fixtures ----------------------------------------------------------------
# Each is a no-dep project; the script body is what differs.
make_fixture() {  # $1 = body command string
  local d; d="$(mktemp -d /tmp/nub-vs-node-XXXXXX)"
  cat > "$d/package.json" <<EOF
{
  "name": "vs-node-bench",
  "version": "1.0.0",
  "scripts": {
    "noop": $(printf '%s' "$1" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))')
  }
}
EOF
  printf '%s' "$d"
}

FIX_TRUE="$(make_fixture 'true')"
FIX_NODE="$(make_fixture 'node -e ""')"
trap 'rm -rf "$FIX_TRUE" "$FIX_NODE"' EXIT

# --- Exit-0 verification: every command must actually RUN the script ---------
# `node --run` errors on a missing script with a DIFFERENT exit path, so we must
# confirm exit 0 (script genuinely dispatched), not merely "ran without crash".
verify() {  # $1=label $2=dir $3...=command
  local label="$1" dir="$2"; shift 2
  if ( cd "$dir" && "$@" >/dev/null 2>&1 ); then
    echo "  [verify] $label → exit 0 ✓"
  else
    echo "ERROR: '$label' did not exit 0 in $dir (got $?). Aborting — refuse to time an error path." >&2
    exit 1
  fi
}

echo "================================================================"
echo "  nub run  vs  node --run  — script DISPATCH benchmark"
echo "  nub:  $("$NUB" --version 2>&1 | head -1)"
echo "  node: $(node --version)   npm: $(npm --version)   pnpm: $(pnpm --version)"
echo "  warmup: $WARMUP  runs: $RUNS"
echo "  date: $(date)"
echo "  load@run (1-min): $LOAD_AT_RUN   full uptime: $(uptime)"
echo "================================================================"
echo "  Exit-0 verification (each command must dispatch the script):"
for FIX in "$FIX_TRUE" "$FIX_NODE"; do
  verify "nub run"   "$FIX" "$NUB" run noop
  verify "node --run" "$FIX" node --run noop
  verify "npm run"   "$FIX" npm run noop
  verify "pnpm run"  "$FIX" pnpm run noop
done
echo "================================================================"

mkdir -p "$RESULTS_DIR"

run_fixture() {  # $1=tag $2=dir
  local tag="$1" dir="$2"
  local out="$RESULTS_DIR/script-runner-vs-node-${tag}-${TIMESTAMP}.json"
  echo ""
  echo "---- fixture: $tag  (script body: $(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["scripts"]["noop"])' "$dir/package.json")) ----"
  hyperfine \
    --warmup "$WARMUP" --runs "$RUNS" --export-json "$out" \
    --command-name "nub run"    "cd '$dir' && '$NUB' run noop" \
    --command-name "node --run" "cd '$dir' && node --run noop" \
    --command-name "npm run"    "cd '$dir' && npm run noop" \
    --command-name "pnpm run"   "cd '$dir' && pnpm run noop"
  echo "  [results saved → $out]"
}

run_fixture "true"    "$FIX_TRUE"
run_fixture "node-e"  "$FIX_NODE"

echo ""
echo "================================================================"
echo "  Done. Canonical results in $RESULTS_DIR/script-runner-vs-node-*-${TIMESTAMP}.json"
echo "  load@run was: $LOAD_AT_RUN"
echo "================================================================"
