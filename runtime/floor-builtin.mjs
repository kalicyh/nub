// Compat-tier floor bootstrap for transform-core.mjs's `node:` builtin fetch.
//
// transform-core.mjs fetches every node: builtin via `process.getBuiltinModule`
// (synchronous, OFF the ESM loader chain) so that nub's `require(esm)` of
// transform-core on the FAST tier (Node 22.15+) never routes a builtin through a
// user's registered `--experimental-loader` / `module.register` hook. (It once
// carried a static `import { createRequire } from "node:module"`; that import sat
// in transform-core's static graph, and Node's `require(esm)` instantiates by
// walking that graph through the user loader chain — so a user resolve hook that
// rejects/rewrites `node:module` exploded nub's own load. Observed against
// es-module/test-esm-example-loader and the loader-chaining corpus.)
//
// `process.getBuiltinModule` only exists from Node 22.3 / 20.16 / 18.20.4. On the
// narrow FLOOR below that (18.19.x, 20.11–20.15, 22.0–22.2) it is `undefined`, so
// transform-core needs another way to reach `node:module`'s `createRequire`. This
// file is that fallback: a single static `import { createRequire } from
// "node:module"`, stashed on a module-scoped global so transform-core can read it
// without itself carrying the static import.
//
// WHY THIS IS LEAK-SAFE WHERE transform-core's OWN static import WAS NOT: this
// module is imported ONLY by the compat-tier entries (preload.mjs and
// preload-async-hooks.mjs), and ONLY ahead of transform-core in their source
// order. The FAST tier (preload.cjs) loads transform-core via `require(esm)`
// directly and never touches preload.mjs / preload-async-hooks.mjs — so this
// file's static `node:module` import never enters the fast-tier `require(esm)`
// graph, and the user loader chain can never observe it. On the compat tier the
// loader hooks run in nub's OWN worker (preload-async-hooks) or on the main thread
// before any user `--loader` could intercept a bare `node:` builtin, both off the
// user chain — so the static import is harmless exactly where it's reachable.
//
// transform-core reads `globalThis.__nubFloorCreateRequire` only on the floor
// (when `process.getBuiltinModule` is absent); on every other Node it uses
// getBuiltinModule and this module is never imported.
import { createRequire } from "node:module";

if (typeof process.getBuiltinModule !== "function") {
  globalThis.__nubFloorCreateRequire = createRequire;
}
