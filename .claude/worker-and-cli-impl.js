export const meta = {
  name: 'worker-fix-and-cli-2-7',
  description: 'Fix the Worker-lifecycle hang (lazy parentPort wiring) + implement CLI surgery concerns #2-7 (signal-exit, nubx-print, watch-env, lifecycle-hooks, run-flags, upgrade-tarball). Serial, fast-gated, judicious tests.',
  phases: [
    { title: 'Worker-fix', detail: 'lazy parentPort wiring in worker-polyfill.mjs + validate against the hanging corpus sample' },
    { title: 'Gate-W', detail: 'cargo test (fast) + clippy + worker-sample exits' },
    { title: 'CLI-2-7', detail: 'serial concerns on cli.rs/nub-core, build + ad-hoc verify each' },
    { title: 'Gate-CLI', detail: 'cargo test + clippy' },
    { title: 'Verify', detail: 'behavioral repro matrix + worker sample + clippy/fmt' },
  ],
}

const ROOT = process.env.CLAUDE_PROJECT_DIR ?? process.cwd()
const SUITE = `${ROOT}/tests/node-suite/test`

const ORIENT = `
You are implementing fixes for **Nub** (a Rust CLI at ${ROOT} that augments the user's Node via Node's own extension surfaces — module.registerHooks / --import preload / N-API / flag injection; NOT a fork). You are on git branch \`v0.1-launch-fixes\`; edit the real working tree. Earlier work is already COMMITTED (8 commits): the clap flag-routing fix (concern #1), the corpus-test-infra fix, glob discovery, the ErrorEvent shim, and preload feature work. CLI concerns #2-7 are NOT yet done.

READ FIRST: ${ROOT}/epics/v0.1-launch/todo.md (the ledger) and ${ROOT}/AGENTS.md (brand boundary + testing philosophy + "quality over velocity").

GROUND TRUTH: \`cargo test\` is now FAST (~7s) — the heavyweight node-suite corpus is #[ignore]'d (runs only via \`-- --ignored\`). The prebuilt binary is \`${ROOT}/target/release/nub\`; rebuild with \`cargo build --release\` after Rust edits. DO NOT run the full corpus (\`--ignored\`) — it's 25 min; use the targeted worker-sample below instead.

TESTING DISCIPLINE (the user is emphatic about this — follow it exactly):
- **Verify EXHAUSTIVELY but AD HOC.** Prove every behavior by running \`${ROOT}/target/release/nub ...\` on real cases (build /tmp fixtures) and QUOTING the output. This ad-hoc exhaustive verification is how you confirm correctness — not by piling up tests.
- **Add a test ONLY when it locks a durable contract worth regression-protecting.** One good test per behavior, contract-named (describe the guarantee, not the implementation), self-debugging on failure. NO bloat: no near-identical assertions, no per-input parametrization where one assertion suffices, no "should handle X" names, no test that paraphrases the code. A reviewer should skim the test in 30s and know the contract. If you're tempted to add a 4th similar test, stop.
- **Where behavior is genuinely hard to test** (watch-mode timing, upgrade network/tarball, signal delivery, OS-specific corners): do NOT write ceremonial fake tests. Instead make the code excellent — DRY, efficient, minimal, clearly correct — and document the untestable gap in a short comment. A keen eye for quality substitutes for an impossible test.
- Match surrounding style. Markdown is never hard-wrapped. Honest status: if something is partial/unverifiable, say so.
`

const SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['concern', 'status', 'files_changed', 'what_changed', 'adhoc_verification', 'tests_added', 'build_ok'],
  properties: {
    concern: { type: 'string' },
    status: { type: 'string', enum: ['done', 'partial', 'blocked'] },
    files_changed: { type: 'array', items: { type: 'string' } },
    what_changed: { type: 'string', description: 'precise — name the actual change, not "implemented X".' },
    adhoc_verification: { type: 'string', description: 'the real commands you ran against the binary + the quoted outputs proving it works.' },
    tests_added: { type: 'string', description: 'which test(s) you added and the contract each locks — OR an explicit justification for adding none (hard-to-test → quality instead).' },
    build_ok: { type: 'boolean' },
    notes: { type: 'string' },
  },
}

// A handful of the worker tests that hang today — cheap to re-run, decisive for the fix.
const WORKER_SAMPLE = [
  'parallel/test-worker-relative-path.js',
  'parallel/test-worker-stdio.js',
  'parallel/test-worker-exit-code.js',
  'parallel/test-worker-process-argv.js',
  'parallel/test-worker-non-fatal-uncaught-exception.js',
  'parallel/test-worker-messaging.js',
]

// ── Phase 1: Worker-lifecycle fix ──────────────────────────────────────
phase('Worker-fix')
const workerFix = await agent(`${ORIENT}

CONCERN: Fix the Worker-lifecycle hang. ROOT CAUSE (already bisected — do not re-derive): \`runtime/worker-polyfill.mjs\` lines ~119-169 run inside EVERY worker (nub's --import preload is inherited via execArgv). At ~155-160 it EAGERLY does \`parentPort.on("message", …)\` / \`parentPort.on("messageerror", …)\` to back \`self.onmessage\`. An active parentPort listener refs the MessagePort and keeps the worker's event loop alive, so the worker never exits → the parent's \`worker.on("exit")\` never fires → hang. Proven: \`node parallel/test-worker-relative-path.js\` exits in 0s; \`node --import <preload>\` on the same test hangs 15s; bisected to this file. ~33 node-suite worker tests hang because of this. It breaks Node's "worker exits when its loop drains" semantics for any worker that doesn't explicitly exit — which is most real worker_threads usage (Vitest/Jest/Piscina/tinypool).

THE FIX — make the worker-scope message wiring LAZY:
- Do NOT add the \`parentPort.on("message"/"messageerror")\` listeners at import time.
- Wire them only when the worker's code first opts into the browser message API: i.e. on the first \`self.onmessage = fn\` / \`self.onmessageerror = fn\` assignment OR the first \`self.addEventListener("message"|"messageerror", …)\`. Once opted in, the worker SHOULD stay alive (that is correct browser DedicatedWorkerGlobalScope behavior).
- A worker that never touches the browser message API must then exit per Node semantics (no hang). Native worker_threads workers (which use \`require("worker_threads").parentPort\` directly, never \`self.onmessage\`) must be completely unaffected.
- IMPORTANT correctness check: a worker that DOES set \`self.onmessage\` at top level must still receive messages the parent sent before/at startup — Node's MessagePort buffers messages until a "message" listener is added, so lazy wiring preserves delivery, but VERIFY this (the parent→worker round-trip must not regress). Keep \`self\`, \`postMessage\`, \`close\`, \`addEventListener\` semantics intact. Keep the main-thread Worker constructor unchanged.
- Keep it DRY and minimal — this is a surgical change to one block. Add the lazy wiring once and route both onmessage-setter and addEventListener through it.

VERIFY (ad hoc, decisive):
1. Build: \`cd ${ROOT} && cargo build --release\`.
2. The hanging sample must now EXIT (not 124). For each of these, run \`cd ${SUITE} && NODE_TEST_KNOWN_GLOBALS=0 timeout 20 ${ROOT}/target/release/nub <test>\` and report exit code + seconds: ${WORKER_SAMPLE.join(', ')}.
3. The round-trip must NOT regress: \`cargo test --release -p nub-cli --test integration worker\` (the worker_message_roundtrip / worker_transpiles_ts_entry / worker_throw_surfaces_to_parent_onerror tests must still pass). Also build a tiny /tmp worker that sets \`self.onmessage\` and confirm a parent→worker→parent round-trip still works.
4. Add ONE focused regression test (Rust integration test): a worker that finishes its synchronous work and is expected to EXIT — assert the parent observes the worker's exit (today it hangs). This is the contract that was broken; it's worth locking. Do NOT add a pile of worker tests — one decisive exit-semantics test plus the existing round-trip coverage is the right amount.

Return structured results (concern="worker-lifecycle").`, { label: 'fix:worker-lifecycle', phase: 'Worker-fix', schema: SCHEMA })

// ── Gate W ─────────────────────────────────────────────────────────────
phase('Gate-W')
const gateW = await agent(`${ORIENT}

GATE. The worker-lifecycle fix just landed. Run, from ${ROOT}: \`cargo build --release 2>&1 | tail -5\`, then \`cargo test --release 2>&1 | tail -15\` (must be green, ~fast), then \`cargo clippy --all-targets 2>&1 | tail -15\` (CI gate is -D warnings — must be clean). Then re-confirm the worker sample exits: for ${WORKER_SAMPLE.join(', ')} run \`cd ${SUITE} && NODE_TEST_KNOWN_GLOBALS=0 timeout 20 ${ROOT}/target/release/nub <test>; echo $?\`. Report exact pass/fail/exit numbers. If anything is broken (test regression, clippy warning, a worker still hanging), DIAGNOSE and FIX it, then re-run. Return concern="gate-W" with build_ok = final state and the numbers in adhoc_verification.`, { label: 'gate-W', phase: 'Gate-W', schema: SCHEMA })

// ── Phase 2: CLI surgery #2-7 (serial on cli.rs / nub-core) ─────────────
phase('CLI-2-7')
const cliConcerns = [
  { label: 'signal-exit-code', body: `Concern #2. \`nub-core/src/node/spawn.rs\` \`exit_code()\` uses \`status.code().unwrap_or(1)\` → on Unix a signal-killed child returns None → reports 1 instead of 128+signo (SIGTERM should be 143, SIGSEGV 139). Fix \`exit_code\` (Unix: when code() is None, use \`std::os::unix::process::ExitStatusExt::signal()\` => 128 + signo) and route ALL call sites through it (audit found cli.rs sites at ~1244/1307/1385/1418/1442/1587/1595 still doing \`status.code().unwrap_or(1)\` — centralize them on spawn::exit_code). VERIFY: spawn a child that kills itself with SIGTERM via nub, assert exit 143. Add ONE #[cfg(unix)] test locking 128+signo. Keep DRY (single helper, all paths through it).` },
  { label: 'nubx-print-exit', body: `Concern #3. \`run_exec\` (cli.rs ~1395-1418) runs \`sh -c "<pm> dlx <bin>"\` on a local-bin miss — the exec.md 2026-05-26 decision REMOVED that (CI-hostile: network fetch + stdin block). Replace with the documented two-line suggestion ("<bin> is not installed locally. Install it (<pm> add -D <bin>) or run ad-hoc with: <pm> dlx <bin>") printed to stderr + a NON-ZERO exit. Do NOT spawn anything. VERIFY: \`nub exec <missing-bin>\` in a /tmp project prints the suggestion and exits non-zero without spawning a PM (confirm no network). Add ONE test asserting non-zero exit + the suggestion text + that no child is spawned.` },
  { label: 'watch-env-file', body: `Concern #4. \`run_watch\` injects .env via \`cmd.env(k,v)\` so Node's --watch never watches/re-reads .env across restarts. Build \`--env-file=<path>\` args for each loaded .env* file and pass them to the watched Node instead (Node then watches + re-reads them; shell env still wins). This is TIMING-hard to unit-test — verify ad hoc (start \`nub watch\` on a fixture, edit .env, confirm a restart picks up the new value) and QUOTE it; if a reliable automated test isn't worth the flake, DON'T force one — instead make the code clean/DRY and add a one-line comment documenting the manual-verification gap. Keep the .env precedence (shell > .env > defaults) intact.` },
  { label: 'workspace-lifecycle-hooks', body: `Concern #5. The default streamed/concurrent \`nub run -r <script>\` path (cli.rs ~1021-1032 \`run_one_workspace_pkg\` / the concurrent worker ~928-949) calls \`spawn_script_prefixed\` directly — running ONLY the main script, skipping pre<x>/post<x> (which only the non-streamed branch via \`run_single_script\` runs). This is the exact failure run.md says killed \`node --run\`; a monorepo with prebuild/postbuild is silently mis-built. Route the streamed/parallel path through the same pre→main→post sequencing (keep the per-line stream prefixing). VERIFY ad hoc: a /tmp pnpm workspace with a member having pre/main/post scripts — \`nub run -r build\` must run all three in order (compare to pnpm). Add ONE workspace-mode lifecycle test locking "pre/main/post all run in order under default -r".` },
  { label: 'run-full-flags', body: `Concern #6. Add the full run-flag set to \`Command::Run\` (cli.rs ~137-189) AND wire behavior, per the already-updated wiki/commands/run.md (follow it exactly): aliases \`-F\`(=--filter), \`-s\`(=--silent), \`--workspaces\`(=--recursive), accept explicit \`--bail\`(default no-op); \`--workspace <name>\` (LONG-ONLY, repeatable, = --filter <name> — do NOT bind -w; -w stays pnpm --workspace-root which already ships); \`--include-workspace-root\` (ADD root pkg to the recursive set; distinct from --workspace-root); \`--fail-if-no-match\` (explicit form of the existing zero-match error); \`--ignore-scripts\` (skip pre/post hooks — real affordance, NOT just an alias); \`--script-shell <path>\` (override the script shell; thread through the spawn/shell_escape path); \`--aggregate-output\` (buffer per-package output, flush on finish — also the CI/non-TTY default); \`--resume-from <pkg>\` (skip topological predecessors of <pkg>). Keep --reverse/--no-sort.
  CRITICAL COUPLING (audit flagged, breadcrumb at cli.rs ~510-512): the clap-routing manual split uses a \`value_consuming_flags("run")\` list to know which flags take a separate-token value. You are ADDING separate-token value flags — \`--workspace <name>\`, \`--resume-from <pkg>\`, \`--script-shell <path>\` — and they MUST be added to that list, or the positional-split will mis-bind their values as the script name. Verify \`nub run --workspace foo build\` selects member foo and runs \`build\` (not: script=foo).
  VERIFY ad hoc EXHAUSTIVELY (a /tmp pnpm workspace + a fake .bin): every flag in run.md runs without "unexpected argument"; --ignore-scripts skips pre/post; --resume-from skips predecessors; --aggregate-output buffers (no interleave); --fail-if-no-match errors on a zero-match filter; --workspace <name> selects the member; -F/-s/--workspaces aliases work. Add tests JUDICIOUSLY — lock the non-trivial CONTRACTS (--ignore-scripts, --resume-from, --aggregate-output, --workspace-selection, and the value_consuming coupling); do NOT add a test per alias (one assertion that aliases map correctly is enough). This is the largest concern — keep the flag plumbing DRY.` },
  { label: 'upgrade-package-and-tarball', body: `Concern #7. (a) \`run_upgrade\` (cli.rs ~1581 + ~1601) emits bare \`nub@{target}\` — change to \`@nubjs/nub@{target}\` (bare \`nub\` is an unrelated 3rd-party package — clobbering a working install). (b) Implement the self-owned ~/.nub / curl-install upgrade channel: detect a ~/.nub-style install, download the GitHub release tarball for {target, platform}, SHA-256 verify, atomic-rename into place (install.sh already defines the layout — match it). Keep npm + Homebrew detection; defer pnpm/yarn/bun-global sniffing (out of v0.1). The download/swap is network-hard to unit-test — verify the LOGIC ad hoc via \`nub upgrade --dry-run\` (must print the correct channel + tarball URL + sha for a simulated ~/.nub install, and route npm installs to @nubjs/nub) and keep the download/verify/rename code DRY + clearly correct with a documented manual-verification note. Add ONE test asserting the npm-channel command targets @nubjs/nub (cheap, high-value — it's a blocker regression guard).` },
]
const cliResults = []
for (const c of cliConcerns) {
  const r = await agent(`${ORIENT}

CLI-SURGERY (serial — the tree has all prior concerns applied; READ the CURRENT cli.rs/spawn.rs before editing). CONCERN [${c.label}].

${c.body}

You MUST \`cd ${ROOT} && cargo build --release\` and confirm it compiles before returning (you are serial — no lock contention). If your change breaks the build or an existing test, fix it before returning. Apply the TESTING DISCIPLINE above. Return structured results (concern="${c.label}").`, { label: `cli:${c.label}`, phase: 'CLI-2-7', schema: SCHEMA })
  cliResults.push({ label: c.label, r })
  log(`[cli:${c.label}] status=${r?.status} build_ok=${r?.build_ok}`)
}

// ── Gate CLI ───────────────────────────────────────────────────────────
phase('Gate-CLI')
const gateCli = await agent(`${ORIENT}

GATE. CLI concerns #2-7 are done. From ${ROOT}: \`cargo build --release 2>&1 | tail -5\`, \`cargo test --release 2>&1 | tail -20\`, \`cargo clippy --all-targets 2>&1 | tail -20\`, \`cargo fmt --check 2>&1 | tail -5\`. Report exact numbers. If a test fails, decide: real regression to FIX, or a test that codified now-fixed-wrong behavior and must be updated? Fix/update and re-run. Clippy must be clean (-D warnings gate). Return concern="gate-CLI", build_ok=final state.`, { label: 'gate-CLI', phase: 'Gate-CLI', schema: SCHEMA })

// ── Phase 3: Verify ────────────────────────────────────────────────────
phase('Verify')
const VERIFY_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['overall', 'rows', 'cargo_test', 'clippy', 'remaining_risks'],
  properties: {
    overall: { type: 'string', enum: ['all-green', 'mostly-green', 'problems'] },
    cargo_test: { type: 'string' },
    clippy: { type: 'string' },
    rows: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['check', 'result', 'evidence'], properties: { check: { type: 'string' }, result: { type: 'string', enum: ['pass', 'fail', 'needs-node22'] }, evidence: { type: 'string' } } } },
    remaining_risks: { type: 'array', items: { type: 'string' } },
  },
}
const verify = await agent(`${ORIENT}

FINAL VERIFICATION. Everything is implemented + gated. Run the behavioral repro matrix against ${ROOT}/target/release/nub using /tmp fixtures, and QUOTE outputs. Cover: (1) the worker sample [${WORKER_SAMPLE.join(', ')}] all EXIT (not 124); (2) signal exit: SIGTERM-killed child via nub => 143; (3) nubx miss prints suggestion + non-zero, no spawn; (4) every run.md flag runs (no "unexpected argument"); --ignore-scripts skips hooks; --resume-from skips predecessors; --aggregate-output buffers; --workspace <name> selects member; --fail-if-no-match errors; (5) workspace -r runs pre/main/post; (6) upgrade --dry-run targets @nubjs/nub and shows the ~/.nub tarball channel; (7) the clap-routing didn't regress (nub run build --help forwards; nub run --node build = compat). Also run \`cargo test --release\` + \`cargo clippy --all-targets\` and report counts. Be a skeptic — if a fix doesn't actually work end-to-end, mark it fail with evidence. Mark anything floor-only (needs Node 22) as needs-node22 but confirm the code path exists. Return the structured matrix.`, { label: 'verify', phase: 'Verify', schema: VERIFY_SCHEMA })

return {
  worker_fix: { status: workerFix?.status, build_ok: workerFix?.build_ok, verification: workerFix?.adhoc_verification },
  gate_W: { build_ok: gateW?.build_ok, summary: gateW?.what_changed },
  cli: cliResults.map((c) => ({ concern: c.label, status: c.r?.status, build_ok: c.r?.build_ok, tests: c.r?.tests_added })),
  gate_CLI: { build_ok: gateCli?.build_ok },
  verify,
}
