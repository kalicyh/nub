#!/usr/bin/env node
// Seam-swap shim for pnpm's own black-box test suite (CommonJS form).
//
// pnpm/test/utils/execPnpm.ts spawns every command under test as
// `process.execPath [pnpmBinLocation, ...args]`, where pnpmBinLocation is the
// pnpm package's bin entry (pnpm/bin/pnpm.cjs on older pnpm, pnpm.mjs on newer).
// The conformance runner copies THIS file over that path so every test that
// "runs pnpm" instead runs the nub binary, identified as pnpm (nub picks its
// package-manager identity from argv[0]'s basename — Argv0::detect in
// crates/nub-cli/src/cli.rs). nub-as-pnpm is exactly the drop-in surface the
// suite asserts on (stdout/stderr/exit/lockfile/node_modules).
//
// Written as .cjs so it loads regardless of the package's "type" field. The path
// to the nub binary is read from NUB_BIN (the runner exports it).
'use strict'
const { spawnSync } = require('node:child_process')

// The runner replaces __NUB_BIN__ with the absolute nub path at swap time. This
// MUST be baked in (not read from process.env) because pnpm's test harness
// rebuilds a clean env in createEnv() that copies only PATH/COLORTERM/APPDATA —
// any NUB_BIN we export would be stripped before the shim is spawned. The env
// fallback is kept for direct/manual invocation.
const BAKED_NUB_BIN = '__NUB_BIN__'
const nubBin = BAKED_NUB_BIN.startsWith('__NUB') ? process.env.NUB_BIN : BAKED_NUB_BIN
if (!nubBin) {
  console.error('nub-pnpm-shim: nub binary path is not set (neither baked nor NUB_BIN)')
  process.exit(2)
}

// Re-exec the nub binary with argv[0] basename "pnpm" so nub adopts the pnpm
// identity, forwarding the suite's args verbatim and inheriting stdio so the
// suite captures stdout/stderr exactly as pnpm would emit them.
const res = spawnSync(nubBin, process.argv.slice(2), {
  stdio: 'inherit',
  argv0: 'pnpm',
  env: process.env,
})

if (res.error) {
  console.error(`nub-pnpm-shim: failed to exec nub (${nubBin}): ${res.error.message}`)
  process.exit(2)
}
process.exit(res.status != null ? res.status : res.signal ? 1 : 0)
