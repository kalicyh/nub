# Cross-format lockfile conversion harness

This harness proves that `nub pm use <target>` produces a lockfile that the real target PM accepts frozen. It is the standing proof that cross-format lockfile migration actually works — not just "nub pm use exits 0" but "the real PM is satisfied."

## The conversion matrix

For each ordered pair (source, target) over {npm, pnpm, bun, yarn}:

1. **Generate** — the source PM installs into a clean fixture copy, writing its native lockfile.
2. **Convert** — `nub pm use <target>[@<pin>]` reads the source lockfile and writes the target format.
3. **Judge** — the target PM frozen-installs from the converted lockfile (the real PM is the honest judge).
4. **Assert** — every direct dep from `package.json` exists in `node_modules`.

**yarn-as-target** is a special leg: `nub pm use yarn` from any non-yarn source must refuse (non-zero exit) because yarn write fidelity is unproven in the engine. This is tested and the refusal is asserted as the PASS condition.

**yarn-as-source→yarn-as-target** exercises the "lockfile kept as-is" path — nub should succeed without converting anything.

Same-format pairs (npm→npm etc.) are skipped since no conversion occurs — those are tested by `tests/conformance/`.

## Result matrix (as of 2026-06-11, nub v0.0.33)

| fixture | conversion | result | notes |
| --- | --- | --- | --- |
| simple | npm→pnpm | **FAIL** | BUG-1: importer block empty in converted lockfile |
| simple | npm→bun | **FAIL** | BUG-2: packages block empty in converted bun.lock |
| simple | npm→yarn | PASS | (refusal assertion — nub correctly refuses) |
| simple | pnpm→npm | PASS | |
| simple | pnpm→bun | PASS | |
| simple | pnpm→yarn | PASS | (refusal assertion) |
| simple | bun→npm | PASS | |
| simple | bun→pnpm | PASS | |
| simple | bun→yarn | PASS | (refusal assertion) |
| simple | yarn→npm | PASS | |
| simple | yarn→pnpm | PASS | |
| simple | yarn→bun | PASS | |
| simple | yarn→yarn | PASS | (lockfile kept as-is) |
| peers | npm→pnpm | **FAIL** | BUG-1: same importer-empty bug |
| peers | npm→bun | **FAIL** | BUG-2: same packages-empty bug |
| peers | npm→yarn | PASS | (refusal assertion) |
| peers | pnpm→npm | PASS | |
| peers | pnpm→bun | PASS | |
| peers | pnpm→yarn | PASS | (refusal assertion) |
| peers | bun→npm | PASS | |
| peers | bun→pnpm | PASS | |
| peers | bun→yarn | PASS | (refusal assertion) |
| peers | yarn→npm | PASS | |
| peers | yarn→pnpm | PASS | |
| peers | yarn→bun | PASS | |
| peers | yarn→yarn | PASS | (lockfile kept as-is) |

Tool/version matrix: nub v0.0.33, npm 11.13.0, pnpm 10.15.1, yarn 1.13.0, bun 1.3.14.

## Findings (do NOT fix here — separate landing work)

### BUG-1: npm→pnpm — importer block written empty, pnpm rejects with ERR_PNPM_OUTDATED_LOCKFILE

When converting from `package-lock.json` to `pnpm-lock.yaml`, the converter writes an empty importer block (`.: {}`), omitting the `dependencies` and `devDependencies` specifiers. pnpm's frozen-lockfile check compares these specifiers against `package.json` and errors:

```
ERR_PNPM_OUTDATED_LOCKFILE  Cannot install with "frozen-lockfile" because pnpm-lock.yaml is not up to date with package.json
  Failure reason:
  specifiers in the lockfile don't match specifiers in package.json:
* 4 dependencies were added: type-fest@^4.0.0, debug@^4.4.0, kleur@^4.1.5, ms@^2.1.3
```

**What nub writes (converted from package-lock.json):**
```yaml
importers:
  .: {}
```

**What pnpm requires:**
```yaml
importers:
  .:
    dependencies:
      kleur:
        specifier: ^4.1.5
        version: 4.1.5
      ms:
        specifier: ^2.1.3
        version: 2.1.3
    devDependencies:
      type-fest:
        specifier: ^4.0.0
        version: 4.41.0
```

The packages block (resolution + snapshots) is written correctly; only the importer specifier map is missing. Note this only affects npm→pnpm; the inverse (pnpm→npm, pnpm→bun, bun→pnpm, yarn→pnpm) all pass, meaning the pnpm reader correctly populates the graph and the npm/bun writers write correct output. The npm lockfile reader is not propagating specifier data into the `LockfileGraph` importers.

Affected paths: npm→pnpm only (both fixtures).

### BUG-2: npm→bun — packages block written empty, bun rejects with InvalidPackageInfo

When converting from `package-lock.json` to `bun.lock`, the converter writes an empty `packages` block. Bun tries to resolve the root workspace's dev dependency (`type-fest`) but finds no package entry:

```
error: Failed to resolve root dev dependency 'type-fest'
    at bun.lock:5:9
InvalidPackageInfo: failed to parse lockfile: 'bun.lock'
```

**What nub writes (converted from package-lock.json):**
```json
{
  "workspaces": { "": { "dependencies": {...}, "devDependencies": {...} } },
  "packages": {}
}
```

**What bun requires:** a package entry per resolved package, e.g.:
```json
"packages": {
  "kleur": ["kleur@4.1.5", "", {}, "sha512-..."],
  "ms": ["ms@2.1.3", "", {}, "sha512-..."]
}
```

Same root cause pattern as BUG-1: the npm lockfile reader is not populating the graph data that the bun writer needs. The workspace dep/devDep lists are written (the metadata from `package.json` comes through), but the resolved package versions + integrity hashes are lost.

Affected paths: npm→bun only (both fixtures). Note that bun→npm, pnpm→bun, yarn→bun all pass — meaning the bun writer works when reading from non-npm graphs.

### Fidelity note: resolved URL loss in →npm conversions

When converting to `package-lock.json` (from pnpm or bun), the `resolved` field (tarball URL) is absent from each package entry — only `integrity` is written. npm `ci` still passes because npm re-derives the registry URL from the package name + version + registry config. This means the converted npm lockfile does not reproduce the source PM's pinned registry URL, which could be a problem for projects using a private registry without a matching `.npmrc`. npm accepts it for public registry packages; document as a known limitation.

Example diff (from pnpm→npm, simple fixture):
- Native npm lockfile: `"resolved": "https://registry.npmjs.org/ms/-/ms-2.1.3.tgz", "integrity": "sha512-..."`
- Converted lockfile: only `"integrity": "sha512-..."` — `resolved` key absent.

## How to run

```sh
tests/conversion/run.sh                          # auto-detect target/release/nub
tests/conversion/run.sh target/debug/nub         # explicit binary
tests/conversion/run.sh target/release/nub peers # one fixture
KEEP=1 tests/conversion/run.sh                   # keep sandbox for forensics
SANDBOX_ROOT=/tmp/my-sandbox tests/conversion/run.sh  # fixed sandbox path
SKIP_YARN=1 tests/conversion/run.sh              # skip yarn legs
PNPM_PIN=10.15.1 tests/conversion/run.sh         # override pnpm pin
```

Requirements: network access to the npm registry (real installs — that is the point), `node` on PATH, and each source/target PM on PATH. Missing PMs print a `NOTE:` line and their legs are skipped. The sandbox redirects `HOME` and all `XDG_*` dirs to a fresh temp root so no dev-box config leaks in or out. On failure the sandbox is kept and per-leg logs (`logs/<fixture>--<src>-to-<tgt>.log`) plus staged runs (`runs/<fixture>--<src>-to-<tgt>/`) are available.

## Fixtures

| fixture | what it exercises |
| --- | --- |
| `simple` | plain registry deps, direct + transitive overlap (`debug`→`ms` and `ms` direct), devDep |
| `peers` | peer dependencies — `react-dom@18` with a peerDep on `react@18`, exercising peer resolution across formats |

Both are adapted from `tests/conformance/fixtures/` and kept small for fast iteration.

## Relation to other harnesses

- `tests/conformance/` — bidirectional drop-in: real PM writes → nub frozen-reads (Dir A); nub writes → real PM frozen-reads (Dir B). Does not test cross-format conversion.
- `tests/aube-conformance/` — nub writes → real PM judges, plus the `pm use nub` / `pm use pnpm` round-trip within pnpm format. Does not test npm or bun as conversion source.
- **This harness** adds the cross-format dimension: every (source, target) combination over {npm, pnpm, bun, yarn}.
