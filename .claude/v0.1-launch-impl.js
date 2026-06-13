export const meta = {
  name: 'v0.1-launch-impl',
  description: 'Implement the v0.1-launch epic: 6 blockers + 10 should-fix + full nub run flag set + 4 scope decisions. Phased, build/test-gated, behaviorally verified. Writes to the v0.1-launch-fixes branch.',
  phases: [
    { title: 'Foundation', detail: 'CI gate, docs, preload.mjs, worker-polyfill, filter.rs — file-disjoint, parallel' },
    { title: 'Gate-1', detail: 'cargo build + test after Foundation' },
    { title: 'CLI-surgery', detail: 'cli.rs / nub-core — serial, build between each concern' },
    { title: 'Gate-2', detail: 'cargo build + test after CLI surgery' },
    { title: 'Verify', detail: 'behavioral repro matrix against the freshly-built binary' },
  ],
}

const ROOT = '/Users/user/Documents/projects/dun'
const ORIENT = `
You are implementing fixes for **Nub** (a Rust CLI that augments the user's Node via extension surfaces — module.registerHooks/--import/N-API/flags; NOT a fork). You are on git branch \`v0.1-launch-fixes\`; edit the real working tree at ${ROOT}.

READ FIRST: ${ROOT}/epics/v0.1-launch/todo.md (the authoritative ledger — your items, with file:line pointers and verify criteria) and ${ROOT}/AGENTS.md (brand-boundary rules + "quality over velocity": NEVER mark an item done without verifying behavior end-to-end; never ship a stub and call it parity; name what you actually built).

HARD RULES:
- Brand boundary is absolute: no globalThis.nub / __nub_* leaks, no nub:* specifiers, no @nub/* scope (org is @nubjs), no NUB_* env vars, no package.json "nub" field, no Node source patches.
- Markdown in this repo is NEVER hard-wrapped — one long line per paragraph.
- Match surrounding code style. Add a test where the ledger asks for one; tests describe the contract, are comprehensive-not-exhaustive, self-debugging on failure.
- This machine runs Node 26; some behavior only manifests on the Node 22.15 floor. Implement + unit-test the logic; note in your return where true validation needs Node 22 / CI.
- Report HONESTLY: if something is partial or unverifiable locally, say so in status/notes. Do not claim "done" for "scaffolded".
`

const IMPL_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['items', 'build_ok', 'summary'],
  properties: {
    summary: { type: 'string' },
    build_ok: { type: 'boolean', description: 'did the code you touched compile / parse (cargo check for Rust, node --check for JS) — or N/A for pure docs (set true).' },
    items: { type: 'array', items: {
      type: 'object', additionalProperties: false,
      required: ['item', 'status', 'files_changed', 'what_changed', 'verified_how'],
      properties: {
        item: { type: 'string' },
        status: { type: 'string', enum: ['done', 'partial', 'blocked'] },
        files_changed: { type: 'array', items: { type: 'string' } },
        what_changed: { type: 'string', description: 'precise, names the actual change — not "implemented X".' },
        verified_how: { type: 'string', description: 'the repro you ran + result, or why it can only be verified in CI/Node22.' },
        notes: { type: 'string' },
      },
    } },
  },
}

// ── Phase 1: Foundation — file-disjoint, parallel ──────────────────────
phase('Foundation')
const foundationTasks = [
  { label: 'ci-gate', files: '.github/workflows/ci.yml, .github/workflows/release.yml, crates/nub-cli/tests/node_compat.rs, crates/nub-cli/tests/resolution_compat.rs', body: `Implement Phase 0 of the ledger: (1) ci.yml checkout gets \`submodules: recursive\` (bound cost with a path/label filter if sensible); resolve the .gitmodules-vs-.gitignore:29 contradiction for tests/node-suite. (2) Make node_compat.rs + resolution_compat.rs skip LOUDLY (panic or visible skip) instead of \`return;\` (silent pass) when the suite is absent. (3) release.yml must run \`cargo test\` (+ the compat gate, or at least the integration suite) before publish. (4) Add a Node-22.15 leg to the CI test matrix alongside a current LTS. Do NOT run cargo here (other agents may be building). Validate YAML by reading carefully; for the Rust test-guard change, you may \`cargo build -p nub-cli --tests\` only if no other build is obviously running — otherwise leave it to the gate.` },
  { label: 'docs-name', files: 'README.md, wiki/whitepaper.md, wiki/faq.md, wiki/architecture.md, wiki/PLAN.md, tests/fixtures/nubx-test/node_modules/.bin/hello', body: `Implement the doc/fixture items: (1) BLOCKER — replace every \`npm install -g nub\`/\`npm i -g nub\` with \`@nubjs/nub\` across README.md:6, whitepaper.md (incl ~:600), faq.md (×2), architecture.md:240. Binary stays \`nub\`; ONLY the install package specifier changes. Verify with \`grep -rn "install -g nub\\b" README.md wiki/\` returning empty. (2) \`git add -f tests/fixtures/nubx-test/node_modules/.bin/hello\` (mirror argecho); grep the integration test for other gitignored-fixture deps and force-add them. (3) README perf table → a pointer to benchmarks/results.md (kill the stale hardcoded ms). (4) Phase 6: whitepaper.md:207-221 currently LEADS the Decorators section with a Stage-3 example that crashes — rewrite to lead with the working legacy \`experimentalDecorators\` case and state Stage 3 isn't supported yet. (5) Reconcile PLAN.md §365 (it says nubx 'delegates to the PM' but the decision is print-and-exit per exec.md) — update PLAN.md §365 to match exec.md. Markdown stays one-line-per-paragraph.` },
  { label: 'preload-js', files: 'runtime/preload.mjs', body: `Implement the preload.mjs items (single file — do all four, then \`node --check runtime/preload.mjs\`): (1) BLOCKER \`using\` downlevel — pass \`target\` (es2022 for the 22.15 floor) into the transformSync opts (~510-532); confirm the vendored usingCtx helper resolves via VENDORED_PACKAGES and SuppressedError degrades on Node 22. (2) SHOULD Temporal clobber — CLOBBER_MAP['@js-temporal/polyfill'] (~:49) must also export \`Intl\` (= globalThis.Intl) and \`toTemporalInstant\` (= Date.prototype.toTemporalInstant), not just default + Temporal. (3) SHOULD Stage-3 decorator diagnostic — oxc returns errors:[] for Stage-3 decorators so the check at ~535 never fires; when compilerOptions.experimentalDecorators is off AND decorator syntax is present, throw the documented Option-A diagnostic (see wiki/runtime/stage3-decorators.md + non-erasable-syntax.md) instead of letting a raw V8 SyntaxError through. (4) DECISION watch reload — the dep reporting at ~676-682 runs at preload top-level before user modules load (tsconfigCache empty), so process.send never fires; defer it to fire AFTER modules load and include .env*/package.json paths. Verify each with a tiny /tmp fixture run through ./target/release/nub where the Node-26 machine allows; note Node-22-only checks.` },
  { label: 'worker-js', files: 'runtime/worker-polyfill.mjs', body: `BLOCKER: worker-polyfill.mjs:49 does \`new ErrorEvent('error', {...})\`; ErrorEvent is not a global below Node 26, so a throwing worker crashes the PARENT on the entire 22/24 floor. Feature-detect ErrorEvent at load; when absent, install a minimal Event subclass carrying message/error/filename/lineno/colno (or dispatch a plain Event with those fields). Add an integration test (Rust integration.rs or a fixture) that spawns a throwing Worker and asserts the parent's onerror fires and the parent does NOT crash. \`node --check runtime/worker-polyfill.mjs\`. Note that the real floor validation is Node 22/24 in CI.` },
  { label: 'filter-rs', files: 'crates/nub-core/src/workspace/filter.rs', body: `SHOULD: member discovery (filter.rs:163-187) trims \`/*\`,\`/**\` then read_dirs one level — so an explicit non-glob path ("libs/core") is never discovered and \`packages/**\` finds zero. Replace the trim-and-read_dir heuristic with real glob expansion (glob-match is already a dep): a bare path ⇒ the member itself; single \`*\` ⇒ one level; \`**\` ⇒ recursive. Add discovery fixtures/tests for an explicit path and a \`**\` pattern. You may \`cargo build -p nub-core\` to check (cargo lock may serialize with another agent — that's fine).` },
]
const foundation = await parallel(foundationTasks.map((t) => () =>
  agent(`${ORIENT}\n\nTASK [${t.label}] — files: ${t.files}\n\n${t.body}\n\nReturn structured results.`, { label: `impl:${t.label}`, phase: 'Foundation', schema: IMPL_SCHEMA })
    .then((r) => ({ label: t.label, r })).catch((e) => ({ label: t.label, r: null, error: String(e) }))))

// ── Gate 1 ─────────────────────────────────────────────────────────────
phase('Gate-1')
const gate1 = await agent(`${ORIENT}\n\nGATE. The Foundation phase edited: CI yaml + compat-test guards, docs, runtime/preload.mjs, runtime/worker-polyfill.mjs, filter.rs. Run \`cd ${ROOT} && cargo build --release 2>&1 | tail -20\` then \`cargo test --release 2>&1 | tail -40\`. Also \`node --check runtime/preload.mjs && node --check runtime/worker-polyfill.mjs\`. Report exact pass/fail counts and any compile error verbatim. If something is broken, FIX it (it's a regression from this phase) and re-run. Return a summary with build_ok reflecting the final state and one item per check.`, { label: 'gate-1', phase: 'Gate-1', schema: IMPL_SCHEMA })

// ── Phase 3: CLI surgery — SERIAL on cli.rs/nub-core ───────────────────
phase('CLI-surgery')
const cliConcerns = [
  { label: 'clap-flag-routing', body: `BLOCKER, do this FIRST (others build on the routing). \`nub run\`/\`exec\`/\`watch\` steal leading flags (--help/--silent/--color/--cwd/--verbose/--node) when the flag is the first token after the positional, because cli.rs:456-459 re-parses the remainder through clap (globals + auto-help match before trailing_var_arg engages). \`nubx\` (run_nubx, cli.rs:547-567) is immune because it splits manually. Mirror that: once the subcommand's positional (script/bin/file) is bound, push the ENTIRE remainder verbatim to the script/bin without re-parsing through clap. Preserve: nub's own flags BEFORE the positional still work (\`nub run --filter x build\`, \`nub run --node build\` = compat); the auto-\`--\` and explicit \`--\` still work. After the fix: \`nub run build --node\` forwards --node to the script (position 3), \`nub run --node build\` enables compat (position 2) — that's correct per the three-position rule. Build (\`cargo build --release\`). Add regression tests for exec/run/watch leading-flag forwarding + nubx≡exec.` },
  { label: 'signal-exit-code', body: `SHOULD: spawn.rs:491-493 and cli.rs:1131/1272/1329 use status.code().unwrap_or(1) — None on Unix signal death → SIGTERM exits 1 not 143. On Unix, when code() is None, use std::os::unix::process::ExitStatusExt::signal() ⇒ 128 + signo. Centralize in nub_core::node::spawn::exit_code and route run/watch/exec/nubx through it. Build. Add a test (spawn a child that kills itself with SIGTERM, assert 143) — gate it #[cfg(unix)].` },
  { label: 'nubx-print-exit', body: `DECISION (the maintainer: honor exec.md): cli.rs:1283-1305 currently runs \`sh -c "<pm> dlx <bin>"\` on a local-bin miss. Replace with the documented two-line suggestion (\`<bin> is not installed locally. Install it (<pm> add -D <bin>) or run it ad-hoc with: <pm> dlx <bin>\`) and exit NON-ZERO — no network, no stdin block. (PLAN.md §365 reconciliation is handled by the docs agent.) Build. Add a test asserting a bin-miss prints the suggestion + non-zero exit and does NOT spawn a PM.` },
  { label: 'watch-env-file', body: `DECISION: run_watch injects .env via cmd.env() so Node's --watch never watches/re-reads .env. Pass the loaded .env* file paths to Node as \`--env-file=<path>\` (so Node both watches them and re-reads on restart). Keep shell-env precedence (shell wins). Build. Add/adjust a watch test if feasible (note: watch is timing-sensitive — a logic-level test or a documented manual repro is acceptable per the testing philosophy).` },
  { label: 'workspace-lifecycle-hooks', body: `SHOULD: the default streamed/concurrent workspace path (cli.rs:830/908-919, spawn_script_prefixed) bypasses run_single_script where pre<x>/post<x> resolution lives, so \`nub run -r build\` runs only MAIN (pnpm runs prebuild/build/postbuild). Route the streamed/parallel path through the same pre→main→post sequencing as run_single_script (keep the prefixed streaming). Build. Add a workspace-mode lifecycle test: a member with pre/main/post, assert all three run in order under default -r.` },
  { label: 'run-full-flags', body: `DECISION (ship the full 20-flag set; run.md is already updated to match — follow it exactly). Add to the Run subcommand (cli.rs ~137-189) + wire behavior: aliases \`-F\`(=--filter), \`-s\`(=--silent global), \`--workspaces\`(=--recursive), accept explicit \`--bail\`(default, no-op toggle); \`--workspace <name>\` LONG-ONLY (repeatable, = --filter <name>) — do NOT bind -w to it; \`-w\` stays pnpm \`--workspace-root\` (already shipped); \`--include-workspace-root\` (ADD root pkg to the recursive set, distinct from --workspace-root which targets only root); \`--fail-if-no-match\` (explicit form of the existing default zero-match error); \`--ignore-scripts\` (skip pre/post hooks — real CI/security affordance, NOT just an alias); \`--script-shell <path>\` (override the shell in scripts::; thread through spawn); \`--aggregate-output\` (buffer per-package output, flush on finish — also the CI/non-TTY default per run.md Defaults); \`--resume-from <pkg>\` (skip topological predecessors of <pkg>). Keep --reverse/--no-sort (already ship). Build. Behavioral checks (use a /tmp pnpm workspace + a fake .bin): every flag runs without 'unexpected argument'; --ignore-scripts skips hooks; --resume-from skips predecessors; --aggregate-output buffers; --fail-if-no-match errors on zero match; --workspace <name> selects the member. Add tests for the non-trivial ones (--ignore-scripts, --resume-from, --aggregate-output, --workspace).` },
  { label: 'upgrade-package-and-tarball', body: `BLOCKER+DECISION: (1) cli.rs:1468 + :1488 emit bare \`nub@{target}\` → \`@nubjs/nub@{target}\` (upgrade.md updated separately). (2) Implement the self-owned ~/.nub / curl-install upgrade channel: detect a ~/.nub-style install, download the GitHub release tarball for the target version + platform, SHA-256 verify, atomic-rename into place (install.sh already defines the layout — match it). Keep the npm + Homebrew detection; defer pnpm/yarn/bun-global sniffing (out of v0.1 scope). Build. Add a test asserting (a) the npm-channel command targets @nubjs/nub, and (b) --dry-run on a simulated ~/.nub install reports the correct channel + tarball URL without performing the swap.` },
]
const cliResults = []
for (const c of cliConcerns) {
  const r = await agent(`${ORIENT}\n\nCLI-SURGERY (serial; the tree already has prior concerns applied — read the CURRENT cli.rs before editing). CONCERN [${c.label}].\n\n${c.body}\n\nYou MUST \`cargo build --release\` and confirm it compiles before returning (you are serial — no lock contention). If your change breaks the build, fix it before returning. Return structured results.`, { label: `cli:${c.label}`, phase: 'CLI-surgery', schema: IMPL_SCHEMA })
  cliResults.push({ label: c.label, r })
  log(`[cli:${c.label}] build_ok=${r?.build_ok} — ${(r?.items || []).map((i) => i.status).join(',')}`)
}

// ── Gate 2 ─────────────────────────────────────────────────────────────
phase('Gate-2')
const gate2 = await agent(`${ORIENT}\n\nGATE. CLI surgery is complete. Run \`cd ${ROOT} && cargo build --release 2>&1 | tail -20\` then \`cargo test --release 2>&1 | tail -50\`. Report exact pass/fail counts + any failure verbatim. If a test fails, diagnose: is it a real regression to FIX, or a test that codified now-fixed-wrong behavior and should be updated? Fix/update as appropriate and re-run. Return build_ok = final state + one item per check.`, { label: 'gate-2', phase: 'Gate-2', schema: IMPL_SCHEMA })

// ── Phase 5: Verify — behavioral repro matrix ──────────────────────────
phase('Verify')
const VERIFY_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['overall', 'rows', 'cargo_test', 'remaining_risks'],
  properties: {
    overall: { type: 'string', enum: ['all-green', 'mostly-green', 'problems'] },
    cargo_test: { type: 'string', description: 'exact pass/fail count from cargo test --release.' },
    rows: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['check', 'result', 'evidence'], properties: { check: { type: 'string' }, result: { type: 'string', enum: ['pass', 'fail', 'needs-node22', 'n/a'] }, evidence: { type: 'string' } } } },
    remaining_risks: { type: 'array', items: { type: 'string' } },
  },
}
const verify = await agent(`${ORIENT}\n\nVERIFICATION. All implementation is done. Build is gated green. Run the repro matrix from the bottom of epics/v0.1-launch/todo.md against ${ROOT}/target/release/nub, using /tmp fixtures (a pnpm workspace with pre/main/post + members via explicit-path and ** ; a fake node_modules/.bin echo bin; TS files with using/decorators; a throwing Worker). For EACH matrix row run the actual command and quote the output. Flag-forwarding rows, run-flag rows, Temporal exports, signal exit, workspace hooks, member discovery, upgrade --dry-run, the install grep, and the CI changes (read the yaml to confirm). Mark using/worker-error/anything floor-only as needs-node22 if this Node 26 box can't prove them (but DO confirm the code path exists). Also run \`cargo test --release\` and report the count. Be a skeptic: if a fix doesn't actually work end-to-end, mark it fail with the evidence. Return the structured matrix.`, { label: 'verify', phase: 'Verify', schema: VERIFY_SCHEMA })

return {
  foundation: foundation.map((f) => ({ label: f.label, build_ok: f.r?.build_ok, items: (f.r?.items || []).map((i) => ({ item: i.item, status: i.status })), error: f.error })),
  gate1: { build_ok: gate1?.build_ok, summary: gate1?.summary },
  cli: cliResults.map((c) => ({ label: c.label, build_ok: c.r?.build_ok, items: (c.r?.items || []).map((i) => ({ item: i.item, status: i.status })) })),
  gate2: { build_ok: gate2?.build_ok, summary: gate2?.summary },
  verify,
}
