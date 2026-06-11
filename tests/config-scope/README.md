# config-scope differential fixtures (CP-3)

Verifies nub's config-scoping policy ("mirror the active PM, never silently"):
under each PM role, nub applies exactly the role-native override field and
ignores (with a dim warning) the field that PM would silently ignore.

`run-matrix.sh` builds a fixture pinning a transitive dependency two
different ways (top-level `overrides` vs yarn `resolutions`), installs it
under nub with each role declared, and asserts which pin landed — diffed
against what the real PM does on the same fixture. The point is lockfile
round-trip stability: nub must not over-apply a pin the active PM ignores.

Transitive target: `ms` (a dep of `debug`). We pin `ms` to two distinct
versions via the two fields and check the materialized version.
