#!/usr/bin/env bash
# Regenerate the committed lockfiles from scratch using pnpm.
# Run this when you change a fixture's package.json.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
FIXTURE_DIR="$REPO_ROOT/tests/bench/fixtures"

echo "=== Regenerating simple fixture lockfile ==="
(
  cd "$FIXTURE_DIR/simple"
  rm -rf node_modules pnpm-lock.yaml
  pnpm install --no-frozen-lockfile
  rm -rf node_modules
)

echo "=== Regenerating monorepo fixture lockfile ==="
(
  cd "$FIXTURE_DIR/monorepo"
  rm -rf node_modules packages/*/node_modules pnpm-lock.yaml
  pnpm install --no-frozen-lockfile
  rm -rf node_modules packages/*/node_modules
)

echo "Done. Commit the updated lockfiles."
