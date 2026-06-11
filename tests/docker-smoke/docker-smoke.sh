#!/usr/bin/env bash
# Run the Docker install smoke against all libc variants: glibc (node:22-slim)
# and musl (node:22-alpine). Each variant builds a fresh Linux nub from source
# and verifies it in a clean container — the honest first-run environment.
#
# Usage: tests/docker-smoke/docker-smoke.sh [glibc|musl ...]
# Defaults to both. Requires Docker.
#
# What each variant tests:
#   glibc  — node:22-slim (Debian bookworm) + glibc nub binary
#   musl   — node:22-alpine + musl nub binary (rust:alpine builder)
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
VARIANTS=("$@")
[ ${#VARIANTS[@]} -gt 0 ] || VARIANTS=(glibc musl)

if ! docker version >/dev/null 2>&1; then echo "error: Docker not available" >&2; exit 1; fi

fails=0
for v in "${VARIANTS[@]}"; do
  echo "── $v ────────────────────────────────────────────────────────────────"
  dockerfile="$SCRIPT_DIR/Dockerfile.$v"
  if [ ! -f "$dockerfile" ]; then
    echo "error: no Dockerfile for variant '$v' at $dockerfile" >&2
    fails=$((fails+1))
    continue
  fi
  tag="nub-smoke:$v"
  if docker build -f "$dockerfile" -t "$tag" "$REPO_DIR"; then
    docker run --rm "$tag" || fails=$((fails+1))
  else
    echo "FAIL: Docker build for $v failed" >&2
    fails=$((fails+1))
  fi
done

echo ""
[ "$fails" -eq 0 ] \
  && echo "docker-smoke: all variants passed." \
  || { echo "docker-smoke: $fails variant(s) FAILED."; exit "$fails"; }
