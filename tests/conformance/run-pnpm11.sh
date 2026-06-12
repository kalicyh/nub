#!/usr/bin/env bash
# pnpm-11 conformance leg for the drop-in PM conformance harness.
#
# pnpm 10→11 changed the lockfile format (lockfileVersion bumped), so this
# leg re-runs the same two directions as run.sh but with pnpm 11 as the
# reference PM.
#
# Directions covered:
#   Direction A (pnpm 11 → nub): pnpm 11 writes pnpm-lock.yaml →
#     nub (host binary) --frozen-lockfile installs from it.
#
#   Direction B (nub → pnpm 11): nub writes a pnpm-format lockfile →
#     pnpm 11 --frozen-lockfile accepts it without rewriting (zero churn).
#
# pnpm 11 strategy — the host has pnpm 10.  We use one of:
#   1. (Default) npx pnpm@latest-11 — runs the current pnpm 11.x release
#      via npx, no global install required.  Works as long as npm is on PATH.
#   2. (Explicit) PNPM11_BIN=<path> — use an already-installed binary.
#   3. (Docker) PNPM11_USE_DOCKER=1 — pull node:22-slim, install pnpm 11
#      inside, and run pnpm ops via `docker run`.  Fallback for environments
#      where npm/npx is absent.  Skips silently if Docker daemon is unreachable.
#
# Usage:
#   tests/conformance/run-pnpm11.sh [<path-to-nub>]
#
# Env:
#   SANDBOX_ROOT=<dir>         reuse/inspect the sandbox (implies KEEP)
#   KEEP=1                     keep sandbox on success
#   PNPM11_VERSION=<ver>       pnpm 11 version spec (default: latest-11)
#   PNPM11_BIN=<path>          explicit pnpm 11 binary (skips npx)
#   PNPM11_USE_DOCKER=1        force Docker mode (useful if npx unavailable)
#   DOCKER_IMAGE=<image>       Docker base image (default: node:22-slim)
#   DOCKER=<path>              Docker binary override
#
# Exit: 0 = all legs pass; 1 = at least one FAIL; 2 = configuration error.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"

# ── Host nub binary ──
NUB_HOST="${1:-}"
if [ -z "$NUB_HOST" ]; then
  for candidate in \
    "$REPO_ROOT/target/release/nub" \
    "$REPO_ROOT/target/debug/nub"; do
    [ -x "$candidate" ] && { NUB_HOST="$candidate"; break; }
  done
fi
shift 2>/dev/null || true
NUB_HOST="$(cd "$(dirname "$NUB_HOST")" && pwd)/$(basename "$NUB_HOST")"
[ -x "$NUB_HOST" ] || { echo "error: nub binary not found/executable: $NUB_HOST" >&2; exit 2; }
NUB_HOST_VERSION="$("$NUB_HOST" --version 2>/dev/null || echo '?')"

PNPM11_VERSION="${PNPM11_VERSION:-latest-11}"
DOCKER_IMAGE="${DOCKER_IMAGE:-node:22-slim}"
ALL_FIXTURES=(simple peers)

# ── Sandbox ──
CREATED_SANDBOX=0
if [ -z "${SANDBOX_ROOT:-}" ]; then
  SANDBOX_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/nub-pnpm11.XXXXXX")"
  CREATED_SANDBOX=1
fi
mkdir -p "$SANDBOX_ROOT/home" "$SANDBOX_ROOT/runs" "$SANDBOX_ROOT/logs"

# Hermetic: redirect HOME + XDG like run.sh does.
export HOME="$SANDBOX_ROOT/home"
export XDG_DATA_HOME="$HOME/.local/share"
export XDG_CACHE_HOME="$HOME/.cache"
export XDG_CONFIG_HOME="$HOME/.config"
export XDG_STATE_HOME="$HOME/.local/state"
mkdir -p "$XDG_DATA_HOME" "$XDG_CACHE_HOME" "$XDG_CONFIG_HOME" "$XDG_STATE_HOME"
unset npm_config_default_lockfile_format NPM_CONFIG_DEFAULT_LOCKFILE_FORMAT 2>/dev/null || true

# ── Resolve how to invoke pnpm 11 ──
# Strategy 1: explicit binary
PNPM11_CMD=""
PNPM11_MODE=""

if [ -n "${PNPM11_BIN:-}" ] && [ -x "${PNPM11_BIN}" ]; then
  PNPM11_CMD="$PNPM11_BIN"
  PNPM11_MODE="explicit-bin"

elif [ "${PNPM11_USE_DOCKER:-0}" != "1" ] && command -v npx >/dev/null 2>&1; then
  # Strategy 2: npx pnpm@<version> — runs pnpm 11 from npm registry without
  # disturbing the globally-installed pnpm 10.  We pre-cache it here and run
  # via a wrapper function below.
  PNPM11_CMD="npx --yes pnpm@${PNPM11_VERSION}"
  PNPM11_MODE="npx"
  # Verify it works (also caches the package)
  echo "Verifying pnpm 11 via npx ..."
  _p11ver="$(npx --yes "pnpm@${PNPM11_VERSION}" --version 2>/dev/null)" \
    || { echo "error: npx pnpm@${PNPM11_VERSION} failed" >&2; exit 2; }
  echo "  pnpm $PNPM11_VERSION resolved → $_p11ver"

else
  # Strategy 3: Docker (last resort)
  PNPM11_MODE="docker"
  DOCKER="${DOCKER:-/usr/local/bin/docker}"
  [ -x "$DOCKER" ] || DOCKER="$(command -v docker 2>/dev/null || true)"
  # Daemon check via socket (avoids hanging docker info/ps under load)
  _docker_ok=0
  if [ -n "$DOCKER" ] && [ -x "$DOCKER" ]; then
    for _sock in \
      "$HOME/.docker/run/docker.sock" \
      "/Users/$(whoami)/.docker/run/docker.sock" \
      "/var/run/docker.sock"; do
      [ -S "$_sock" ] && { _docker_ok=1; break; }
    done
  fi
  if [ "$_docker_ok" -ne 1 ]; then
    echo ""
    echo "NOTE: pnpm 11 not available (npx absent and Docker daemon unreachable)"
    echo "  — pnpm-11 legs SKIPPED."
    echo "  To run this leg: ensure npm/npx is on PATH (npx pnpm@11 is the default),"
    echo "  set PNPM11_BIN=<path> to an explicit pnpm 11 binary, or start Docker"
    echo "  Desktop and set PNPM11_USE_DOCKER=1."
    echo "  This is a coverage gap: pnpm 10→11 changed the lockfile format."
    echo ""
    exit 0
  fi
fi

echo "=== nub pnpm-11 conformance ==="
echo "host nub:     $NUB_HOST ($NUB_HOST_VERSION)"
echo "pnpm 11:      mode=$PNPM11_MODE  spec=$PNPM11_VERSION"
echo "sandbox:      $SANDBOX_ROOT"
echo ""

# ── Helpers ──
wipe_node_modules() {
  find "$1" -name node_modules -type d -prune -exec rm -rf {} +
}

stage_fixture() {
  local fixture="$1" proj="$2"
  rm -rf "$proj"
  mkdir -p "$proj"
  cp -R "$HERE/fixtures/$fixture/." "$proj/"
}

# pnpm11 <args...> — invoke pnpm 11 (current dir must be the project)
pnpm11() {
  case "$PNPM11_MODE" in
    explicit-bin|npx)
      $PNPM11_CMD "$@"
      ;;
    docker)
      # Mount the current directory as /fixture, run pnpm 11 there.
      local cwd
      cwd="$(pwd)"
      "$DOCKER" run --rm \
        --platform linux/arm64 \
        -v "$cwd:/fixture" \
        -w /fixture \
        "$DOCKER_IMAGE" \
        bash -c "npm install -g pnpm@${PNPM11_VERSION} --quiet 2>&1 >/dev/null; pnpm $*"
      ;;
  esac
}

assert_node_modules() {
  local proj="$1" log="$2"
  local pkg="$proj/package.json"
  local failed=0
  local deps
  deps=$(node -e "
    const p = require('$pkg');
    const all = Object.keys({...p.dependencies, ...p.devDependencies});
    all.forEach(d => console.log(d));
  " 2>/dev/null) || { echo "FAILED: could not parse package.json" >>"$log"; return 1; }
  while IFS= read -r dep; do
    [ -z "$dep" ] && continue
    if [ ! -d "$proj/node_modules/$dep" ]; then
      echo "FAILED: node_modules/$dep missing after frozen install" >>"$log"
      failed=1
    fi
  done <<< "$deps"
  return $failed
}

RESULTS=()
FAILS=0

record() {
  local label="$1" ok="$2" log="$3"
  if [ "$ok" -eq 0 ]; then
    echo "    PASS"
    RESULTS+=("$label|PASS")
  else
    FAILS=$((FAILS + 1))
    echo "    FAIL — log: $log"
    tail -n 30 "$log" | sed 's/^/    | /'
    RESULTS+=("$label|FAIL")
  fi
}

# ── Direction A: pnpm 11 writes lockfile → nub frozen-installs ───────────────
dir_a_pnpm11() {
  local fixture="$1" proj="$2" log="$3"

  { echo; echo "### Direction A: pnpm 11 install (write lockfile)"; } >>"$log"
  ( cd "$proj" && pnpm11 install --no-frozen-lockfile ) >>"$log" 2>&1 \
    || { echo "FAILED: pnpm 11 install failed" >>"$log"; return 1; }

  [ -f "$proj/pnpm-lock.yaml" ] \
    || { echo "FAILED: pnpm 11 wrote no pnpm-lock.yaml" >>"$log"; return 1; }

  { echo; echo "### pnpm-lock.yaml header (first 8 lines):"; head -8 "$proj/pnpm-lock.yaml"; } >>"$log"

  # Record the lockfile format version for the report
  local lf_ver
  lf_ver="$(head -3 "$proj/pnpm-lock.yaml" | grep -o 'lockfileVersion:.*' || echo 'unknown')"
  echo "  lockfile: $lf_ver" | tee -a "$log"

  wipe_node_modules "$proj"

  { echo; echo "### Direction A: nub install --frozen-lockfile"; } >>"$log"
  ( cd "$proj" && "$NUB_HOST" install --frozen-lockfile ) >>"$log" 2>&1 \
    || { echo "FAILED: nub install --frozen-lockfile failed" >>"$log"; return 1; }

  assert_node_modules "$proj" "$log" || return 1
  return 0
}

# ── Direction B: nub writes pnpm lockfile → pnpm 11 frozen-accepts ───────────
dir_b_pnpm11() {
  local fixture="$1" proj="$2" log="$3"

  { echo; echo "### Direction B: nub install (write pnpm lockfile)"; } >>"$log"
  ( cd "$proj" && \
    env npm_config_default_lockfile_format=pnpm "$NUB_HOST" install \
  ) >>"$log" 2>&1 \
    || { echo "FAILED: nub install failed" >>"$log"; return 1; }

  [ -f "$proj/pnpm-lock.yaml" ] \
    || { echo "FAILED: nub wrote no pnpm-lock.yaml" >>"$log"; return 1; }

  # Capture baseline for zero-churn check
  cp "$proj/pnpm-lock.yaml" "$log.lock-before"

  { echo; echo "### nub-written pnpm-lock.yaml header (first 8 lines):"; head -8 "$proj/pnpm-lock.yaml"; } >>"$log"

  local lf_ver
  lf_ver="$(head -3 "$proj/pnpm-lock.yaml" | grep -o 'lockfileVersion:.*' || echo 'unknown')"
  echo "  nub lockfile: $lf_ver" | tee -a "$log"

  wipe_node_modules "$proj"

  { echo; echo "### Direction B: pnpm 11 install --frozen-lockfile"; } >>"$log"
  ( cd "$proj" && pnpm11 install --frozen-lockfile ) >>"$log" 2>&1 \
    || { echo "FAILED: pnpm 11 rejected nub's lockfile (--frozen-lockfile)" >>"$log"; return 1; }

  # Zero-churn check
  cmp -s "$log.lock-before" "$proj/pnpm-lock.yaml" || {
    echo "FAILED: pnpm 11 rewrote the lockfile after frozen install (churn)" >>"$log"
    { echo; echo "### Lockfile diff (before vs after pnpm 11):"; } >>"$log"
    diff -u "$log.lock-before" "$proj/pnpm-lock.yaml" >>"$log" || true
    return 1
  }

  return 0
}

# ── Run legs ──────────────────────────────────────────────────────────────────
for fixture in "${ALL_FIXTURES[@]}"; do
  [ -d "$HERE/fixtures/$fixture" ] || { echo "error: unknown fixture '$fixture'" >&2; exit 2; }

  # Direction A
  label="$fixture × dir-A × pnpm@$PNPM11_VERSION"
  echo "--- $label"
  proj_a="$SANDBOX_ROOT/runs/$fixture--A--pnpm11"
  log_a="$SANDBOX_ROOT/logs/$fixture--A--pnpm11.log"
  : >"$log_a"
  stage_fixture "$fixture" "$proj_a"
  ok_a=0
  dir_a_pnpm11 "$fixture" "$proj_a" "$log_a" || ok_a=$?
  record "$label" "$ok_a" "$log_a"

  # Direction B
  label="$fixture × dir-B × pnpm@$PNPM11_VERSION"
  echo "--- $label"
  proj_b="$SANDBOX_ROOT/runs/$fixture--B--pnpm11"
  log_b="$SANDBOX_ROOT/logs/$fixture--B--pnpm11.log"
  : >"$log_b"
  stage_fixture "$fixture" "$proj_b"
  ok_b=0
  dir_b_pnpm11 "$fixture" "$proj_b" "$log_b" || ok_b=$?
  record "$label" "$ok_b" "$log_b"

done

echo ""
echo "=== pnpm-11 conformance results ==="
printf '%-48s %s\n' "leg" "result"
for row in "${RESULTS[@]}"; do
  IFS='|' read -r lbl s <<<"$row"
  printf '%-48s %s\n' "$lbl" "$s"
done
echo ""

if [ "$FAILS" -gt 0 ]; then
  echo "RESULT: FAIL ($FAILS failure(s))"
  echo "sandbox kept for forensics: $SANDBOX_ROOT"
  exit 1
fi

echo "RESULT: OK"
if [ "$CREATED_SANDBOX" -eq 1 ] && [ "${KEEP:-0}" != "1" ]; then
  rm -rf "$SANDBOX_ROOT"
else
  echo "sandbox kept: $SANDBOX_ROOT"
fi
