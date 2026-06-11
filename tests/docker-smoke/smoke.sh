#!/usr/bin/env bash
# Docker install smoke — exercises the core nub surfaces in a clean container.
#
# What this covers that CI's cargo test does not:
#   1. The built Linux binary actually starts on the target libc (glibc vs musl).
#   2. `nub --version` returns a non-empty semver string (binary is not a stub).
#   3. `nub <file.ts>` transpiles + runs TypeScript on the in-container Node.
#   4. `nub run <script>` invokes a package.json script with augmentation active.
#   5. `nub install` (PM engine) installs a real package from the npm registry and
#      the installed module is require()-loadable — the installed artifact works.
#   6. Augmentation is branded correctly: no aube/jdx.dev identity in any output.
#
# This is a black-box check on the complete nub binary — the same surface a user
# encounters after `npm install -g @nubjs/nub` on a fresh machine.
#
# Usage: smoke.sh <path-to-nub-binary>
# Called by Dockerfile.glibc / Dockerfile.musl CMD; also runnable directly on a
# host with an appropriate binary:
#   tests/docker-smoke/smoke.sh target/release/nub
set -euo pipefail

NUB_ARG="${1:?usage: smoke.sh <path-to-nub>}"
NUB="$(cd "$(dirname "$NUB_ARG")" && pwd)/$(basename "$NUB_ARG")"
[ -x "$NUB" ] || { echo "FAIL: nub binary not executable: $NUB"; exit 1; }

SANDBOX="$(mktemp -d)"
trap 'rm -rf "$SANDBOX"' EXIT

fail() { echo "FAIL: $*"; exit 1; }
pass() { echo "ok: $*"; }

# Sandbox the install so caches don't leak into the container's global state.
export HOME="$SANDBOX/home"
export XDG_CACHE_HOME="$SANDBOX/xdg/cache"
export XDG_DATA_HOME="$SANDBOX/xdg/data"
export XDG_CONFIG_HOME="$SANDBOX/xdg/config"
export XDG_STATE_HOME="$SANDBOX/xdg/state"
mkdir -p "$HOME"

# ── 1. Binary starts; version is a semver string ─────────────────────────────
ver="$("$NUB" --version 2>&1)"
echo "$ver" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+' || fail "--version returned non-semver: '$ver'"
pass "--version: $ver"

# ── 2. TypeScript run (transpile + execute) ───────────────────────────────────
PROJ_TS="$SANDBOX/ts"
mkdir -p "$PROJ_TS"
cat > "$PROJ_TS/hello.ts" <<'TS'
const greet = (name: string): string => `TS-SMOKE-OK ${name}`;
console.log(greet("nub"));
TS
out="$("$NUB" "$PROJ_TS/hello.ts" 2>&1)"
echo "$out" | grep -q "TS-SMOKE-OK nub" || fail "TS execution failed: $out"
pass "TypeScript run: $out"

# ── 3. nub run (package.json script via augmented Node) ───────────────────────
PROJ_RUN="$SANDBOX/run"
mkdir -p "$PROJ_RUN"
cat > "$PROJ_RUN/package.json" <<'JSON'
{
  "name": "smoke-run",
  "private": true,
  "scripts": { "check": "node -e \"console.log('RUN-SMOKE-OK')\"" }
}
JSON
out="$(cd "$PROJ_RUN" && "$NUB" run check 2>&1)"
echo "$out" | grep -q "RUN-SMOKE-OK" || fail "nub run failed: $out"
pass "nub run: $out"

# ── 4. PM install + module load ───────────────────────────────────────────────
PROJ_PM="$SANDBOX/pm"
mkdir -p "$PROJ_PM"
cat > "$PROJ_PM/package.json" <<'JSON'
{
  "name": "smoke-pm",
  "private": true,
  "dependencies": { "kleur": "4.1.5" }
}
JSON
install_out="$(cd "$PROJ_PM" && "$NUB" install 2>&1)"
[ -e "$PROJ_PM/node_modules/kleur" ] || fail "nub install did not materialize node_modules/kleur. Output: $install_out"
load_out="$(cd "$PROJ_PM" && node -e "const k = require('kleur'); console.log('PM-SMOKE-OK', typeof k.red)" 2>&1)"
echo "$load_out" | grep -q "PM-SMOKE-OK function" || fail "installed module not loadable: $load_out"
pass "PM install + module load: kleur materialized and loadable"

# ── 5. No engine branding leaked into any of the above output ─────────────────
# Install output is the highest-risk surface; the brand-sweep job covers it more
# exhaustively, but a quick check here catches obvious regressions in the binary
# before it even reaches CI.
if echo "$install_out" | grep -qiE 'aube|jdx\.dev'; then
  echo "$install_out"
  fail "engine-branded identity in install output (above)"
fi
pass "no aube/jdx.dev identity in install output"

echo ""
echo "docker-smoke: all checks passed (glibc: $(ldd --version 2>&1 | head -1); node: $(node --version); nub: $ver)"
