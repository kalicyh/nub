# Bin-runner dispatch benchmark

Measures local binary dispatch overhead for `nub exec` / `nubx` against `pnpm exec`, `npm exec`, and optionally `bun x`.

## Quick run

```bash
cd /path/to/dun
cargo build --release -p nub-cli
bash tests/bench/bin-runner/run-pure.sh
```

Benchmark a different binary:

```bash
NUB="$PWD/target/release/nub" bash tests/bench/bin-runner/run-pure.sh --runs 50 --warmup 10
```

## Fixture

The harness creates a temporary package with one hand-built pure-shell local bin:

```bash
node_modules/.bin/noopbin
```

The bin is:

```sh
#!/bin/sh
exit 0
```

No Node process runs inside the fixture. That isolates the runner's own lookup and dispatch overhead.

## Results

By default, the script writes JSON to a temp directory. Pass `--save` to update checked-in JSON under `tests/bench/bin-runner/results/`.

## Requirements

- `hyperfine`
- `npm`
- `pnpm`
- Rust / Cargo
- Bun, optional
