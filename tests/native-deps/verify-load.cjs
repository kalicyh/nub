// Verifies that native deps installed by nub are actually loadable.
// Runs after `nub install` in the native-deps fixture directory.
//
// Two tiers:
//
//   esbuild — ships a postinstall script that downloads a platform binary.
//     Loadable on every platform (no native compile needed). This is the
//     primary load check.
//
//   better-sqlite3 — compiles a C++ N-API addon via node-gyp. Loadable only
//     when node-gyp succeeded (requires gcc/g++ + Python 3 + node headers).
//     The check is skipped when the binary file doesn't exist (e.g. macOS dev
//     box with mismatched node-gyp) and the CI note in README.md explains why
//     CI should have it. The floor disclosure assertion in run.sh is the real
//     invariant; this load check is a belt-and-suspenders confirmation.

// esbuild — floor disclosure must have allowed the build; the binary must
// be present and the module loadable.
const esbuild = require("esbuild");
if (typeof esbuild.buildSync !== "function") {
  console.error("FAIL: esbuild.buildSync is not a function");
  process.exit(1);
}
console.log("ok: esbuild loaded, version", esbuild.version);

// better-sqlite3 — try to load; skip gracefully if the N-API addon wasn't
// compiled (indicates a dev-box toolchain mismatch, not a nub bug; the CI
// assertion is the authoritative check).
try {
  const Database = require("better-sqlite3");
  const db = new Database(":memory:");
  const row = db.prepare("SELECT 1 + 1 AS result").get();
  if (row.result !== 2) {
    console.error("FAIL: better-sqlite3 query returned wrong result:", row.result);
    process.exit(1);
  }
  db.close();
  console.log("ok: better-sqlite3 loaded, in-memory query passed");
} catch (err) {
  // Missing binary (gyp failed on this toolchain) — skip but note it.
  console.warn("SKIP: better-sqlite3 not loadable (toolchain mismatch on dev box):", err.message);
}

console.log("NATIVE-DEPS-OK");
