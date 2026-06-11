# benchmarks/pm — nub package-manager benchmarks

Assets relocated from `vendor/aube` (branch `nub-integration`) to keep the fork diff review-ready for upstreaming.

## What's here

- **`add-dep.mjs`** — benchmark scenario driver for add-dependency runs (the "ci-loop / add-dep / branch-switch" scenarios that measure cells nobody else benchmarks).
- **`fixture-b.package.json`** — alternate root package fixture used by add-dep scenarios alongside the existing upstream `fixture.package.json`.
- **`fixtures/workspace-descript/`** — 5-member peer-heavy pnpm workspace fixture (app / service / ui-core / ui-widgets / tooling). Represents a realistic mid-size monorepo install baseline.
- **`fixtures/workspace-descript-b/`** — variant of the workspace-descript fixture used for branch-switch / add-dep delta benchmarks.
- **`nub-bench-patches.diff`** — the nub-specific changes to the upstream `bench.sh`, `hermetic.bash`, and `generate-results.js` files. These modifications register `nub` as an opt-in benchmark tool via `BENCH_NUB_BIN` and `BENCH_NUB_ENGINE_VERSION`, fix the per-tool taper (equal runs for statistical symmetry), and wire nub scenarios. Apply on top of aube's upstream bench scripts when running nub comparisons.

## What is benchmarked

nub (embedding aube's install engine) vs standalone aube vs pnpm, across cold-install, warm-install, add-dep, and branch-switch scenarios on the workspace-descript fixtures.

## Running

Set `BENCH_NUB_BIN` to the nub binary path, add `nub` to `BENCH_TOOLS`, then run `bench.sh` from `vendor/aube/benchmarks/`. The patch file above documents every nub-specific flag and env var the runner understands.
