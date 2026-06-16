export const meta = {
  name: 'nub-v0.1-prod-readiness',
  description: 'Production-readiness audit of Nub v0.1: doc↔impl drift, bugs, perf, missing features, tests, release. Adversarially verified, synthesized into a go/no-go.',
  phases: [
    { title: 'Audit', detail: '9 parallel dimension auditors produce structured findings' },
    { title: 'Verify', detail: 'adversarially refute each material finding' },
    { title: 'Synthesize', detail: 'go/no-go verdict from verified findings' },
  ],
}

// ─────────────────────────────────────────────────────────────────────
// Shared orientation prepended to every dimension auditor. Establishes
// ground truth so agents don't re-derive it (and don't flail).
// ─────────────────────────────────────────────────────────────────────
const ORIENT = `
You are auditing **Nub** for v0.1 production readiness. Nub is a Rust CLI that AUGMENTS the user's installed Node (it is NOT a fork). Mechanism: Node's own extension surfaces — module.registerHooks(), --import preload, env vars, N-API addon, V8 flag injection. Compatibility with vanilla Node is paramount; augmentation must be additive.

GROUND TRUTH (already established — do not re-verify the build):
- The workspace builds clean in release: \`target/release/nub\` exists and is current. DO NOT run \`cargo build\` (wastes time, locks the build). To exercise behavior, run the prebuilt binary: \`./target/release/nub ...\`. You MAY run \`cargo test\` ONLY if you are the test-coverage dimension.
- Implementation tree (~6.5k Rust LOC + a JS runtime layer):
  - crates/nub-cli/src/cli.rs (1730 lines — argv0 dispatch nub/nubx/node, flag parsing, run/watch/exec/upgrade, env-file, SIGINT)
  - crates/nub-cli/src/main.rs
  - crates/nub-core/src/node/{discovery,spawn,version,flags}.rs (Node discovery, child spawn, version floor, V8/experimental flag injection)
  - crates/nub-core/src/workspace/{detect,scripts,filter,env,shell_escape}.rs (workspace detection, package.json scripts, -r/--filter, npm_* env, arg escaping)
  - crates/nub-native/src/lib.rs (N-API: parse_yaml/toml/json5/jsonc)
  - runtime/preload.mjs (THE HEART — module.registerHooks resolve+load: TS/JSX transpile via oxc-transform, data loaders, tsconfig-paths, extensionless probing, .js→.ts swap, package clobbering, transpile cache, module-format detection)
  - runtime/polyfills.mjs, runtime/worker-polyfill.mjs, runtime/navigator-locks.mjs, runtime/cache-evict.mjs
- Tests: crates/nub-cli/tests/{integration,node_compat,resolution_compat}.rs; tests/node-suite/ (vendored Node test corpus, run black-box); tests/run-node-compat.sh; tests/node-compat-config.jsonc; tests/node-compat-failures/*.md (categorized divergences).
- Distribution: npm/ (9 packages — @nubjs/nub + 8 @nubjs/nub-<platform>), npm/nub/postinstall.js, install.sh, install.ps1, Makefile (version mgmt), .github/workflows/release.yml.

KEY SCOPE DOCS (authoritative): wiki/PLAN.md (§"v0.1 manifest" and §"Explicitly NOT in v0.1" are canonical scope), wiki/whitepaper.md (user-facing framing), wiki/architecture.md (augmenter-not-fork, compat mode), wiki/philosophy.md (additivity, brand boundary). Per-feature docs: wiki/runtime/*.md and wiki/commands/*.md. Run \`node wiki/scripts/index.mjs\` for the doc index by status.

BRAND-BOUNDARY RULES (absolute, from AGENTS.md): no globalThis.nub (or globalThis.__nub_*), no nub:* module namespace, no @nub/* npm scope (the org is @nubjs), no NUB_* environment variables (EVER — including internal), no "nub" field in package.json, no vendored Node patches. A violation is a release BLOCKER.

YOUR JOB: audit your assigned dimension for **production readiness of v0.1**. Find real, evidence-backed issues in these categories:
- drift: docs claim a behavior the implementation doesn't deliver (or vice-versa — impl does something undocumented/contradicting docs)
- bug: a correctness defect in the implementation (compat break, wrong output, crash, race, resource leak, edge case)
- perf: a real performance problem vs the doc's stated goals (startup cost, redundant syscalls/spawns, wasted work)
- missing-feature: something the v0.1 manifest commits to that isn't actually implemented, or a gap that undermines the v0.1 value prop
- scope-decision: a feature the docs go back-and-forth on, where a ship/defer call is genuinely unresolved and needs maintainer sign-off
- test-gap: a behavior in the v0.1 surface with no/weak test coverage that matters (per the repo's "comprehensive not exhaustive" testing philosophy)
- release: a packaging/distribution/install/CI problem that would break or embarrass a real \`npm install -g @nubjs/nub\`

RULES OF EVIDENCE:
- Cite file:line for code claims and the doc path for doc claims. If you assert a behavior, prefer to PROVE it by running \`./target/release/nub\` on a tiny fixture (create temp files under /tmp). Quote the actual output.
- Distinguish "the doc is aspirational/wrong" from "the code is buggy" — say which side you believe is correct.
- Do NOT report style nits, hypotheticals you didn't check, or things already correctly documented as out-of-scope/known-divergence. The repo already has categorized compat divergences in tests/node-compat-failures/ — don't re-report those as bugs.
- Severity calibration: blocker = must fix before any public v0.1 (data loss, crash on common path, brand-boundary violation, broken install, silent wrong output on common code); high = real bug/gap hit by realistic usage; medium = edge case or notable drift; low = minor; info = observation/context for the synthesis.
- Be skeptical and concrete. A vague "could be improved" is worthless. We want a tight, true list.
`

// ─────────────────────────────────────────────────────────────────────
const FINDINGS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['dimension', 'readiness', 'summary', 'findings'],
  properties: {
    dimension: { type: 'string' },
    readiness: {
      type: 'string',
      enum: ['ready', 'minor-gaps', 'major-gaps', 'blocked'],
      description: 'your overall read on this dimension for v0.1 release',
    },
    summary: { type: 'string', description: '3-6 sentences: what you examined, the headline state, and the single most important thing the synthesis must know.' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'title', 'category', 'severity', 'evidence', 'claim', 'recommendation'],
        properties: {
          id: { type: 'string', description: 'short stable id, e.g. "transpile-3"' },
          title: { type: 'string' },
          category: { type: 'string', enum: ['drift', 'bug', 'perf', 'missing-feature', 'scope-decision', 'test-gap', 'release'] },
          severity: { type: 'string', enum: ['blocker', 'high', 'medium', 'low', 'info'] },
          evidence: { type: 'string', description: 'file:line refs, doc paths, and/or a quoted repro from running the binary. Concrete.' },
          claim: { type: 'string', description: 'the precise factual claim — what is wrong and why it matters for v0.1.' },
          recommendation: { type: 'string', description: 'the concrete fix or decision needed.' },
        },
      },
    },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'verdict', 'reasoning', 'corrected_severity'],
  properties: {
    id: { type: 'string' },
    verdict: { type: 'string', enum: ['confirmed', 'refuted', 'partial'], description: 'confirmed = real & as-described; refuted = not a real issue / auditor misread; partial = real but mis-scoped or mis-severitied.' },
    reasoning: { type: 'string', description: 'what you actually checked (cite file:line or quote a repro you ran) and the conclusion.' },
    corrected_severity: { type: 'string', enum: ['blocker', 'high', 'medium', 'low', 'info', 'not-an-issue'] },
    notes: { type: 'string', description: 'optional: correction to the claim, or a sharper recommendation.' },
  },
}

// ─────────────────────────────────────────────────────────────────────
const DIMENSIONS = [
  {
    key: 'transpile-loaders',
    prompt: `DIMENSION: Transpile pipeline & built-in loaders.
Focus files: runtime/preload.mjs (load hook, loadTranspile, loadData, moduleFormatFor, hasEsmSyntax, stripEmptyExportMarker, the transpile-cache fns cacheKey/cacheGet/cacheSet, maybeSweepCache), runtime/cache-evict.mjs, crates/nub-native/src/lib.rs (data parsers).
Compare against docs: wiki/runtime/{ts-transpilation,jsx-transpilation,non-erasable-syntax,explicit-resource-management,source-maps,transpile-cache,data-loaders,module-format,stage3-decorators,emit-decorator-metadata,auto-accessor}.md.
Questions to answer with evidence (run the binary on tiny /tmp fixtures):
- Does \`nub\` correctly run .ts/.tsx/.mts/.cts/.jsx? Decorators (legacy via tsconfig experimentalDecorators) and emitDecoratorMetadata? Stage-3 decorators — does it error clearly as the doc claims, or miscompile?
- \`using\`/\`await using\` downleveling correct? Source maps: do thrown stack traces point at original TS lines?
- Module-format detection (moduleFormatFor / hasEsmSyntax): is the CJS-vs-ESM call correct for ambiguous .ts with no package.json type? Any case where a CJS-syntax .ts wrongly runs as ESM or vice-versa?
- Transpile cache: correctness of the key (does it bust on tsconfig change, ext change, type change, version change?), the atomic write, the eviction sweep. Any staleness or corruption hole? Any cross-process race?
- Data loaders: .jsonc/.json5/.toml/.yaml/.yml/.txt. YAML→JSON conversion in nub-native (lib.rs yaml_to_json) — does it lose data (floats, big ints, anchors/aliases return Null!, duplicate keys)? Named-export emission for invalid-identifier keys.
- The JS fallback path (when nub-native.node is absent) — does it actually work, and do the fallback packages exist in the distribution?`,
  },
  {
    key: 'resolution',
    prompt: `DIMENSION: Module resolution augmentation.
Focus: runtime/preload.mjs resolve hook + tryResolveFile + getProbeOrder + readPackageMain + tsconfig-paths handling + CLOBBER_MAP + VENDORED_PACKAGES + barePkg/isNodeModules. Test: crates/nub-cli/tests/resolution_compat.rs.
Compare against docs: wiki/runtime/{tsconfig-paths,extensionless-probing,package-clobbering,native-resolver,package-maps,import-maps,commonjs-handling}.md and wiki/research/{esm-resolver-final-sweep,resolution-conformance,ts-extension-precedence}.md.
Questions (prove with /tmp fixtures):
- tsconfig paths: does the matcher fire only for bare specifiers, respect baseUrl, handle nested tsconfigs, and NOT fire inside node_modules? Any case where it shadows a real package?
- extensionless probing + probe order (getProbeOrder): correct precedence (.ts before .js etc.)? .js→.ts / .mjs→.mts / .cjs→.cts / .jsx→.tsx swaps — correct and matching tsc? Any case it resolves something Node wouldn't and breaks compat?
- directory main resolution (readPackageMain): the doc says exports is deliberately NOT consulted — is that actually Node-correct? Any case it diverges from Node 24's LOAD_AS_DIRECTORY?
- package clobbering: the CLOBBER_MAP (@js-temporal/polyfill, urlpattern-polyfill, abort-controller). Is clobbering correctly skipped when parent is in node_modules? Could it break a user who legitimately wants the userland package? Is the data: URL synthetic module correct (named + default exports)?
- Does the resolve hook degrade gracefully (call nextResolve) in every non-matching branch? Any path where it throws and breaks a resolve that Node would satisfy?`,
  },
  {
    key: 'cli-spawn-flags',
    prompt: `DIMENSION: CLI orchestration, Node discovery, spawn, flag injection, env loading, compat mode.
Focus: crates/nub-cli/src/cli.rs, crates/nub-cli/src/main.rs, crates/nub-core/src/node/{discovery,spawn,version,flags}.rs.
Compare against docs: wiki/runtime/{auto-flag-injection,env-loading,hijack-by-default,node-version-discovery,target-version,preload-ordering,permission-passthrough}.md, wiki/commands/node.md, wiki/PLAN.md §"Compat mode".
Questions (prove with the binary):
- argv0 dispatch (nub / nubx / node): does the PATH-shim "node" path actually behave as augmented Node? Is the shim per-invocation as documented (never touches the user's shell node)?
- Node discovery: how is the user's node found? PATH walk, version floor (22.15?) enforcement — what happens if node is too old or absent? Clear error?
- Flag injection (flags.rs): which experimental flags get auto-injected (vm-modules, eventsource, webstorage)? Is the \`--no-experimental-*\` opt-out honored? Does it correctly merge with the user's NODE_OPTIONS and not clobber it? Any flag injected that the floor Node doesn't accept (→ startup crash)?
- env loading: .env auto-discovery precedence vs shell env vs --env-file. Is shell env correctly winning? Is .env disabled under --node compat mode as documented? Any var leakage across spawns (the A19 set_var→Command::env fix)?
- --node compat flag on run/exec: does it actually disable augmentation (no preload, no flag injection, no .env) while keeping standard orchestration (npm_* env, .bin PATH, exit codes)? Prove the two-bucket split matches PLAN.md.
- SIGINT/signal forwarding to the child (A20). Exit-code propagation. Any zombie/leak.

KNOWN SEED BUG (already confirmed empirically — do NOT just re-report it; CHARACTERIZE its full blast radius and find SIBLINGS): \`nub exec <bin>\` and \`nub run <script>\` steal nub's own flags from the tool when the flag is the FIRST token after the bin/script name. Confirmed stolen: --help/-h (prints nub's help), --silent, --color, --verbose, --cwd. NOT stolen: --version/-v. \`nubx <bin> --help\` correctly FORWARDS (run_nubx bypasses clap) — so there is a nubx≢exec divergence despite docs saying they're identical. Root cause is the SECOND parse: \`rest\` is handed to clap, and clap's auto --help + the global=true flags (cli.rs:104-117) match in the leading position before trailing_var_arg engages. A leading positional "unlocks" forwarding. Your job: (a) confirm the exact set of stolen flags/positions; (b) check whether \`nub watch <file> --flag\` has the same hole; (c) check whether \`--node\` position matters; (d) assess severity for the headline verbs; (e) propose the minimal robust fix (mirror nubx's manual split, or disable_help_flag + non-global). Then look for OTHER arg-parsing edge cases (e.g. \`nub exec --silent bin\` where nub's flag legitimately precedes the bin; \`nub -- script\`; flags with \`=\`; clustered short flags).`,
  },
  {
    key: 'workspace-run',
    prompt: `DIMENSION: \`nub run\` + workspace orchestration (-r / --filter / --parallel / streaming / topological / npm_* env / lifecycle).
Focus: crates/nub-core/src/workspace/{detect,scripts,filter,env,shell_escape}.rs, plus the run dispatch in crates/nub-cli/src/cli.rs.
Compare against docs: wiki/commands/run.md, wiki/research/{pnpm-filter-grammar,pm-run-compat-scope,cli-parity,pnpm-specific-behavior}.md. PLAN.md claims "full workspace orchestration ... work-stealing concurrency / pnpm-style streaming — already done".
CRITICAL: the AGENTS.md "Implementation quality discipline" section explicitly warns prior agents shipped stubs as "parity". VERIFY claims, don't trust them. Build a tiny pnpm workspace fixture in /tmp and compare \`./target/release/nub run\` behavior to \`pnpm run\` where you can.
Questions:
- script resolution from package.json#scripts; pre/post lifecycle hooks; passing args after \`--\`; the bareword-script hint.
- workspace detection (detect.rs): pnpm-workspace.yaml / workspaces field. Walk-up. Does it find the root correctly?
- --filter grammar (filter.rs, 778 lines): which pnpm filter selectors are actually supported (name globs, path, \`...\` dependency/dependent traversal, \`[since]\` git ranges)? Which are stubs or missing? Does repeated --filter union (A29)?
- --parallel / topological ordering / concurrency: is it real work-stealing or fixed batching (the AGENTS.md callout)? Name what's actually implemented.
- streaming output prefixing: real per-line prefixing like pnpm --stream, or just inherited stdio with a header? Quote actual output.
- npm_* env injection, INIT_CWD, npm_lifecycle_event, npm_config_*. shell_escape.rs correctness (arg escaping like npm — A42).`,
  },
  {
    key: 'polyfills-globals',
    prompt: `DIMENSION: Injected globals & polyfills (the v0.1 polyfill set).
Focus: runtime/polyfills.mjs, runtime/worker-polyfill.mjs, runtime/navigator-locks.mjs, and the preload.mjs preamble that feature-detects/preloads urlpattern, float16, temporal.
Compare against docs: wiki/runtime/{temporal,url-pattern,websocket,web-worker,navigator-shim,web-locks-polyfill,float16array-polyfill,regexp-escape-polyfill,error-iserror-polyfill,promise-try-polyfill,min-common-api-globals,iterator-helpers-polyfill}.md and PLAN.md §"Trivially-polyfillable injected globals" + §"Stage 4 ... bridges".
v0.1 committed set: reportError (Min-Common-API gap), URLPattern, WebSocket (Node <22.5), Temporal, Worker, navigator shim (UA=Node.js/<version>), Web Locks (navigator.locks), RegExp.escape, Error.isError, Promise.try, Float16Array (+DataView.getFloat16/setFloat16 + Math.f16round).
Questions (prove on the binary — check \`./target/release/nub -e "console.log(typeof X)"\` style, and on the actual floor + on Node 24 if available):
- Does EVERY committed global actually get installed? Run an inventory: for each, print typeof / a spec probe.
- Feature-detect-for-native-takeover: on Node 24 (URLPattern, Float16Array, WebSocket native), does the polyfill correctly STEP ASIDE and not clobber the native one? On the 22.x floor, does it install? Any case where it overwrites a native global (additivity violation)?
- Spec alignment of the Worker polyfill (worker-polyfill.mjs) and navigator.locks (navigator-locks.mjs) — are these real or thin stubs? Name what's actually implemented; flag missing methods/semantics that realistic code hits.
- The lazy Temporal getter (defineProperty accessor) — correctness when user does \`globalThis.Temporal = x\` or imports @js-temporal/polyfill (clobber path).
- navigator shim: does it set ONLY what's documented (UA string) or clobber a partially-native navigator? Worker-thread propagation of polyfills (do workers get the same globals via execArgv inheritance)?`,
  },
  {
    key: 'exec-watch-upgrade',
    prompt: `DIMENSION: \`nubx\`/\`nub exec\`, \`nub watch\`, \`nub upgrade\`.
Focus: the exec, watch, and upgrade dispatch in crates/nub-cli/src/cli.rs (and any helpers in nub-core).
Compare against docs: wiki/commands/{exec,watch,upgrade}.md, wiki/runtime/hot-mode.md (confirm --hot is NOT in v0.1 and the base watch IS), wiki/research/{watch-mode-scope-thesis,nubx-dlx-fetch-feasibility}.md.
Questions (prove with the binary):
- exec/nubx: local-bin resolution from node_modules/.bin (shebang/extension-aware per A40). When a bin is NOT local, PLAN.md says dlx was REMOVED (2026-05-26) and nubx delegates to the user's PM (pnpm dlx / yarn dlx / bunx / npx). Verify that delegation actually exists and picks the right PM. Is there any leftover dead dlx code or doc that still claims native dlx in v0.1?
- watch: PLAN.md says v0.1 = restart-mode on top of Node's --watch engine; --hot is v0.x. Verify \`nub watch\` and \`nub --watch\` work, that tsconfig + .env* changes trigger reload (WATCH_REPORT_DEPENDENCIES path in preload.mjs), and that --hot is NOT silently half-implemented. Is the watch UX (clear-screen, restart banner) sane?
- upgrade: PLAN.md says self-upgrade delegates to the install channel (npm / Homebrew / install-script tarball). Verify the channel detection logic exists and is correct; check it won't run a destructive or wrong-channel upgrade. Does it handle "installed via npm -g" vs "installed via install.sh" distinctly?
- Confirm the v0.1 verb surface matches AGENTS.md: nub <file>, nub run, nub watch, nubx, nub upgrade — and NO nub install/add/remove, NO nub inspect/compile/init/create/serve as shipping verbs. Flag any verb that's wired up but supposed to be deferred.`,
  },
  {
    key: 'release-packaging',
    prompt: `DIMENSION: Release, packaging, distribution, install experience.
Focus: npm/ (all 9 package.json files), npm/nub/postinstall.js, npm/build-local.sh, install.sh, install.ps1, Makefile, .github/workflows/release.yml, root package.json, pnpm-lock.yaml, the checked-in .tgz files (npm/nub/nubjs-nub-0.1.0.tgz, npm/nub-darwin-arm64/*.tgz).
Compare against docs: AGENTS.md §"Releasing", PLAN.md version regime ("stay in 0.0.x until launch"), wiki/architecture.md distribution model.
Questions:
- Version consistency: \`make version-check\` — run it (or read the Makefile + grep versions). preload.mjs hardcodes NUB_VERSION="0.0.6"; npm packages say 0.1.0 (per the .tgz names) — is there a version SKEW between the Rust/Cargo version, the NUB_VERSION cache-key constant, and the npm package versions? This is a real correctness issue (cache key + upgrade). Pin it down precisely.
- postinstall.js: does it correctly select the platform package, copy the binary + the nub-native.node addon + the runtime/ JS + vendored node_modules into place, and fail loudly (not silently) when the platform isn't supported? What happens on \`npm install\` when the optionalDependency for the platform is missing?
- The runtime layer (oxc-transform, get-tsconfig, polyfill packages, @oxc-project/runtime) must be reachable at runtime via NODE_PATH (commit A30/A31). Verify the distribution actually bundles these and the path wiring is correct — a missing dep here means \`nub script.ts\` fails on a clean install.
- install.sh / install.ps1: correctness, checksum/verification, PATH setup, idempotency, failure modes. Do they match what \`nub upgrade\` expects?
- release.yml: OIDC trusted publishing, 8-platform matrix, does it build the N-API addon per platform, does \`make version\`/version-check gate the publish? Any obvious way the release ships a broken/empty platform package.
- Should those .tgz build artifacts be checked into git at all? Flag if they're stale/committed by accident.`,
  },
  {
    key: 'tests',
    prompt: `DIMENSION: Test coverage & the Node-compat harness. You MAY run \`cargo test\` (you are the only dimension allowed to — others use the prebuilt binary). If a background run is already available, check it; otherwise, run \`cargo test --release 2>&1 | tail -40\` yourself and report pass/fail counts.
Focus: crates/nub-cli/tests/{integration,node_compat,resolution_compat}.rs, tests/run-node-compat.sh, tests/node-compat-config.jsonc, tests/node-compat-failures/*.md, and the testing philosophy in AGENTS.md §"Testing philosophy".
Questions:
- Do the cargo tests actually PASS right now? Report the real numbers. Any ignored/flaky tests?
- Coverage vs the v0.1 surface: map each v0.1 capability (transpile, data loaders, resolution, run/filter, flag injection, env loading, exec, watch, upgrade, each polyfill) to whether it has a real test. Name the BIGGEST untested-but-shippable surfaces. (Per philosophy: comprehensive-not-exhaustive — so don't demand bloat; demand that each contract is covered once, well.)
- The node-suite black-box harness: is it actually runnable/wired into CI (run-node-compat.sh + release.yml / a CI workflow)? Are the documented divergences (node-compat-failures/*.md) honest and current, or stale? Are any of the "expected divergences" actually real bugs in disguise?
- Are there tests that are ceremonial/bloated/agent-smell per the philosophy (identical assertions, paraphrase-the-impl names)? Flag the worst offenders briefly — but this is secondary to coverage gaps.
- Is there a CI workflow that runs cargo test + the compat suite on every push, across the platform matrix? Or only the release workflow?`,
  },
  {
    key: 'docs-scope-brand',
    prompt: `DIMENSION: Doc consistency, scope coherence, and brand-boundary compliance.
Focus: wiki/PLAN.md, wiki/whitepaper.md, wiki/architecture.md, wiki/philosophy.md, the front-matter index (run \`node wiki/scripts/index.mjs\` and \`node wiki/scripts/index.mjs --check\`), and a brand-boundary grep across runtime/ and crates/.
Also note the uncommitted/new docs in git status: wiki/research/{astral-suite,embedded-node-proposal,zygote-prefork-v8}.md and wiki/runtime/node-version-management.md — are these coherent with the shipped scope or stray?
Questions:
- v0.1 scope coherence: do PLAN.md §"v0.1 manifest", the whitepaper, and the per-feature doc front-matter (status: v0.1) AGREE on what ships? Find contradictions where one doc says a feature is v0.1 and another says v0.x/deferred. The known back-and-forth features to scrutinize: connect-sockets, hot mode, sqlite-unflag, the polyfill set, dlx, watch engine. For each genuine unresolved fork, flag a scope-decision.
- Brand-boundary scan (BLOCKER severity if violated): grep the actual implementation (runtime/*.mjs, crates/**/*.rs, npm/**) for: \`globalThis.nub\`, \`globalThis.__nub\`, a \`nub:\` synthetic module specifier, \`@nub/\` (non-@nubjs) scope, any \`NUB_*\` environment variable read/written, a "nub" field read from package.json, vendored Node source patches. Note: globalThis.__nubPreloaded and globalThis.__nubRequire-style internal markers ARE brand leaks per AGENTS.md ("a globalThis.__nub_* sentinel is the same brand leak") — check whether preload.mjs's \`globalThis.__nubPreloaded\` (set then deleted) counts as a violation and how exposed it is.
- whitepaper claims vs reality: does the whitepaper promise anything (benchmarks, features, "zero config") the v0.1 implementation doesn't deliver? PLAN.md says do NOT quote benchmark numbers until measured — does the whitepaper or README quote unmeasured numbers?
- Does \`node wiki/scripts/index.mjs --check\` pass (all docs have valid front matter)? Any dangling depends_on/research refs?
- README.md accuracy vs shipped CLI.`,
  },
]

// ─────────────────────────────────────────────────────────────────────
// Phase 1+2: pipeline — each dimension audits, then its material findings
// are adversarially verified as soon as that audit completes.
// ─────────────────────────────────────────────────────────────────────
const VERIFY_SEVERITIES = new Set(['blocker', 'high', 'medium'])

const audited = await pipeline(
  DIMENSIONS,
  (d) =>
    agent(`${ORIENT}\n\n${d.prompt}\n\nReturn structured findings. Set dimension="${d.key}". Be exhaustive within this dimension but report only real, evidence-backed issues.`, {
      label: `audit:${d.key}`,
      phase: 'Audit',
      schema: FINDINGS_SCHEMA,
    }),
  async (report, d) => {
    if (!report) return null
    const toVerify = (report.findings || []).filter((f) => VERIFY_SEVERITIES.has(f.severity))
    log(`[${d.key}] ${(report.findings || []).length} findings, verifying ${toVerify.length} material (readiness=${report.readiness})`)
    const verdicts = await parallel(
      toVerify.map((f) => () =>
        agent(
          `${ORIENT}\n\nYou are an ADVERSARIAL VERIFIER. A prior auditor of the "${d.key}" dimension reported this finding. Your job is to REFUTE it if you can — assume it may be wrong, a misread, already-handled, or out-of-scope. Only confirm what you independently verify by reading the cited code/docs or running ./target/release/nub yourself.\n\nFINDING:\n- title: ${f.title}\n- category: ${f.category}\n- claimed severity: ${f.severity}\n- claim: ${f.claim}\n- evidence cited: ${f.evidence}\n- recommendation: ${f.recommendation}\n\nCheck it independently. Quote what you found (file:line or a repro you ran). Then return your verdict. If the auditor overstated severity (e.g. called a documented known-divergence a bug, or a deferred-feature a missing-feature), say partial/refuted and correct it.`,
          { label: `verify:${d.key}:${f.id}`, phase: 'Verify', schema: VERDICT_SCHEMA },
        ).then((v) => ({ finding: f, verdict: v })).catch(() => ({ finding: f, verdict: null })),
      ),
    )
    const verdictById = new Map()
    for (const vv of verdicts.filter(Boolean)) if (vv.verdict) verdictById.set(vv.verdict.id, vv.verdict)
    return {
      dimension: d.key,
      readiness: report.readiness,
      summary: report.summary,
      findings: (report.findings || []).map((f) => ({
        ...f,
        verification: verdictById.get(f.id) || (VERIFY_SEVERITIES.has(f.severity) ? { verdict: 'unverified', reasoning: 'verifier did not return', corrected_severity: f.severity } : { verdict: 'not-verified-by-design', corrected_severity: f.severity }),
      })),
    }
  },
)

const dimensions = audited.filter(Boolean)

// Build the corpus the synthesizer reasons over. Keep confirmed/partial/low/info;
// demote refuted findings into a separate bucket (don't silently drop — the
// synthesis should know what was checked and dismissed).
const surviving = []
const dismissed = []
for (const dim of dimensions) {
  for (const f of dim.findings) {
    const v = f.verification || {}
    const rec = { dimension: dim.dimension, ...f }
    if (v.verdict === 'refuted' || v.corrected_severity === 'not-an-issue') dismissed.push(rec)
    else surviving.push(rec)
  }
}

log(`Audit complete: ${dimensions.length} dimensions, ${surviving.length} surviving findings, ${dismissed.length} refuted/dismissed.`)

// ─────────────────────────────────────────────────────────────────────
// Phase 3: synthesis — the go/no-go.
// ─────────────────────────────────────────────────────────────────────
const SYNTH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'one_liner', 'blockers', 'should_fix_before_launch', 'scope_decisions_for_colin', 'nice_to_have', 'dimension_readiness', 'narrative'],
  properties: {
    verdict: { type: 'string', enum: ['ship-it', 'ship-after-blockers', 'not-ready'], description: 'overall go/no-go for a public v0.1.' },
    one_liner: { type: 'string', description: 'one-sentence launch readiness verdict.' },
    blockers: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['title', 'dimension', 'why', 'fix'], properties: { title: { type: 'string' }, dimension: { type: 'string' }, why: { type: 'string' }, fix: { type: 'string' } } }, description: 'must-fix before any public v0.1. Empty if none.' },
    should_fix_before_launch: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['title', 'dimension', 'why', 'fix'], properties: { title: { type: 'string' }, dimension: { type: 'string' }, why: { type: 'string' }, fix: { type: 'string' } } } },
    scope_decisions_for_maintainer: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['question', 'context', 'recommendation'], properties: { question: { type: 'string' }, context: { type: 'string' }, recommendation: { type: 'string' } } }, description: 'genuine ship/defer forks only the maintainer can resolve.' },
    nice_to_have: { type: 'array', items: { type: 'string' } },
    dimension_readiness: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['dimension', 'readiness', 'note'], properties: { dimension: { type: 'string' }, readiness: { type: 'string' }, note: { type: 'string' } } } },
    narrative: { type: 'string', description: 'the honest 2-4 paragraph assessment: is v0.1 ready, what is the true state, what is the shortest path to a confident launch. No hedging, no false reassurance.' },
  },
}

phase('Synthesize')
const synthesis = await agent(
  `${ORIENT}\n\nYou are the SYNTHESIZER. Nine dimension auditors examined Nub v0.1; each material finding was adversarially verified. Produce the production-readiness go/no-go.\n\nWrite for a technical audience: be blunt, no marketing. The question: "is v0.1 ready to release, and what's the true status quo?"\n\nHere is the verified corpus.\n\nSURVIVING FINDINGS (confirmed/partial/low/info — each carries its adversarial verdict in .verification):\n${JSON.stringify(surviving, null, 1)}\n\nDISMISSED (refuted by verification — listed so you know what was checked and ruled out; do NOT resurface these as issues):\n${JSON.stringify(dismissed.map((d) => ({ dimension: d.dimension, title: d.title, why_dismissed: d.verification?.reasoning })), null, 1)}\n\nPER-DIMENSION READINESS + SUMMARIES:\n${JSON.stringify(dimensions.map((d) => ({ dimension: d.dimension, readiness: d.readiness, summary: d.summary })), null, 1)}\n\nRULES:\n- Weight each finding by its CORRECTED severity (verification.corrected_severity), not the auditor's original. A finding marked partial/refuted should be downgraded or dropped.\n- A "blocker" is something that would break or embarrass a real public launch (data loss, crash on a common path, brand-boundary violation, broken install, silently wrong output). Be strict: don't inflate. If there are genuinely none, say so.\n- Separate "bugs to fix" from "scope calls needing maintainer sign-off" (the ship/defer forks). Don't put a judgment call in the blocker list.\n- The version-skew question (NUB_VERSION=0.0.6 vs npm 0.1.0 vs Cargo) — adjudicate it explicitly if it surfaced.\n- Be concrete about the SHORTEST PATH to a confident launch.\nReturn the structured verdict.`,
  { label: 'synthesize', phase: 'Synthesize', schema: SYNTH_SCHEMA },
)

return { synthesis, stats: { dimensions: dimensions.length, surviving: surviving.length, dismissed: dismissed.length }, surviving, dismissed }
