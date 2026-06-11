#!/usr/bin/env bash
# globalThis brand-boundary sweep for nub's runtime augmentation.
#
# The NON-NEGOTIABLE rule (AGENTS.md): nub never puts a nub-named key on the user's
# `globalThis` — not `globalThis.nub`, and not an internal-only `globalThis.__nub*`
# sentinel either (the same brand leak in a worse disguise). Every nub polyfill that
# defines a global does so NON-ENUMERABLE so `Object.keys(globalThis)` can't see it;
# any internal value nub needs to thread between its own modules rides MODULE SCOPE,
# never the global object.
#
# This is the regression guard for the floor-tier `globalThis.__nubFloorCreateRequire`
# leak (an ENUMERABLE nub-named key parked on globalThis to thread node:module's
# createRequire into transform-core / worker-polyfill on Node < 22.3, where
# process.getBuiltinModule is absent). It was observable in BOTH user code and worker
# realms via `Object.keys(globalThis)`; the fix threads the value through module-scope
# setters with zero globalThis surface. So this sweep asserts, under `nub <file>`:
#
#   - the MAIN realm's globalThis has NO key matching /nub/i, by either
#     Object.keys (enumerable) or Object.getOwnPropertyNames (incl. non-enumerable);
#   - a worker_threads.Worker realm's globalThis has NO key matching /nub/i, same
#     two predicates — the floor leak re-set the global per-realm via the preload
#     re-run, so the worker realm is a distinct, load-bearing assertion.
#
# It is FLOOR-CRITICAL: the leak only existed where getBuiltinModule is absent (Node
# 18.19.x, 20.11–20.15, 22.0–22.2). So the script sweeps every floor Node it finds
# under ~/.nvm and ALSO runs once on whatever Node is on PATH (fast tier in CI/dev),
# so the contract is checked on both tiers. A floor Node is one whose
# `typeof process.getBuiltinModule !== 'function'`.
#
# Usage: tests/brand-global/run.sh <path-to-nub>
# CI: a step on the `test` job (any single leg — the contract is OS-independent).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

NUB_ARG="${1:?usage: run.sh <path-to-nub>}"
NUB="$(cd "$(dirname "$NUB_ARG")" && pwd)/$(basename "$NUB_ARG")"
{ [ -x "$NUB" ] || ! [ -x "$NUB.exe" ]; } || NUB="$NUB.exe"
[ -x "$NUB" ] || { echo "error: nub binary not executable: $NUB" >&2; exit 2; }

SANDBOX="$(mktemp -d "${TMPDIR:-/tmp}/nub-brand-global.XXXXXX")"
trap 'rm -rf "$SANDBOX"' EXIT

fail() { echo "FAIL: $*"; exit 1; }
pass() { echo "ok: $*"; }

# The worker entry: report any nub-named globalThis key from inside a worker realm
# (the per-realm preload re-run is where the floor leak re-appeared). Both predicates
# — enumerable (Object.keys) and own-property (getOwnPropertyNames) — so a
# non-enumerable nub key wouldn't slip through either.
cat > "$SANDBOX/worker.ts" <<'EOF'
import { parentPort } from "node:worker_threads";
const enumerable = Object.keys(globalThis).filter((k) => /nub/i.test(k));
const own = Object.getOwnPropertyNames(globalThis).filter((k) => /nub/i.test(k));
const tag: string = "worker"; // a TS annotation so the worker entry is transpiled too
parentPort!.postMessage({ tag, enumerable, own });
EOF

# The main entry: assert the main realm is clean, spawn the worker, assert its realm is
# clean too, then print a single PASS/FAIL line the harness greps. A TS annotation
# (`: string`) forces the augmented transpile path to run on the entry itself.
cat > "$SANDBOX/main.ts" <<'EOF'
const realm: string = "main";
const mainEnumerable = Object.keys(globalThis).filter((k) => /nub/i.test(k));
const mainOwn = Object.getOwnPropertyNames(globalThis).filter((k) => /nub/i.test(k));

const w = new Worker(new URL("./worker.ts", import.meta.url));
w.onmessage = (e: MessageEvent) => {
  const { enumerable: wEnum, own: wOwn } = e.data as {
    enumerable: string[];
    own: string[];
  };
  const leaks = [
    ...mainEnumerable.map((k) => `main/enumerable:${k}`),
    ...mainOwn.map((k) => `main/own:${k}`),
    ...wEnum.map((k) => `worker/enumerable:${k}`),
    ...wOwn.map((k) => `worker/own:${k}`),
  ];
  if (leaks.length === 0) {
    console.log("BRAND_GLOBAL_OK realm=" + realm);
  } else {
    console.log("BRAND_GLOBAL_LEAK " + JSON.stringify(leaks));
  }
  w.terminate();
};
EOF

# Run `nub main.ts` on one Node and assert the clean line. A leak prints the offending
# key list; a transpile/Worker crash surfaces the raw output for diagnosis.
check_one() {
  local node_bin_dir="$1" label="$2"
  local out
  if ! out="$(cd "$SANDBOX" && PATH="$node_bin_dir:$PATH" "$NUB" main.ts 2>&1)"; then
    echo "--- nub main.ts output ($label) ---"
    echo "$out"
    fail "[$label] nub exited non-zero (transpile/Worker path broke)"
  fi
  if echo "$out" | grep -q "BRAND_GLOBAL_LEAK"; then
    echo "$out" | grep "BRAND_GLOBAL_LEAK"
    fail "[$label] a nub-named key reached globalThis (above)"
  fi
  echo "$out" | grep -q "BRAND_GLOBAL_OK" \
    || { echo "$out"; fail "[$label] expected BRAND_GLOBAL_OK, got the above"; }
  pass "[$label] globalThis carries no nub-named key (main + worker realms)"
}

is_floor_node() {
  # A floor Node is one nub's COMPAT TIER supports — i.e. it has async
  # `module.register` (the compat-tier hook mechanism; present from 18.19 / 20.6, the
  # augmentation floor) AND lacks `process.getBuiltinModule` (< 22.3 / 20.16 /
  # 18.20.4, the exact tier where the leak lived). The `module.register` gate doubles
  # as the support filter: it excludes both sub-floor Nodes (< 18.19, no register)
  # and odd non-LTS lines like 19.x/21.x that never got the register backport — nub
  # doesn't augment those, so they're out of scope here.
  "$1/node" -e '
    const m = require("module");
    const hasRegister = typeof m.register === "function";
    const noGetBuiltin = typeof process.getBuiltinModule !== "function";
    process.exit(hasRegister && noGetBuiltin ? 0 : 1);
  ' >/dev/null 2>&1
}

# 1. Whatever Node is on PATH (fast tier in CI/dev) — the contract holds on every tier.
path_node_dir="$(dirname "$(command -v node)")"
check_one "$path_node_dir" "PATH node $("$path_node_dir/node" -v 2>/dev/null)"

# 2. Every floor Node under ~/.nvm — the tier where the leak actually existed. If none
# are installed (a minimal CI image), the PATH leg above still ran; note the gap.
floor_ran=0
if [ -d "$HOME/.nvm/versions/node" ]; then
  for d in "$HOME"/.nvm/versions/node/*/bin; do
    [ -d "$d" ] || continue
    [ -x "$d/node" ] || continue
    if is_floor_node "$d"; then
      check_one "$d" "floor node $("$d/node" -v 2>/dev/null)"
      floor_ran=1
    fi
  done
fi
[ "$floor_ran" = 1 ] || echo "note: no floor Node (< 22.3) found under ~/.nvm — floor-tier leg skipped"

echo "brand-global: all assertions passed"
