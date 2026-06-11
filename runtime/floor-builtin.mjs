// Compat-tier floor bootstrap: threads `node:module`'s `createRequire` into the
// modules that fetch their `node:` builtins via `process.getBuiltinModule`
// (transform-core.mjs, worker-polyfill.mjs) on the narrow FLOOR where that API is
// absent — WITHOUT any globalThis surface.
//
// WHY those modules can't fetch the builtin themselves: both are loaded on the fast
// tier via Node's `require(esm)`, which instantiates an ES module by walking its
// STATIC IMPORT graph through whatever ESM loader chain is registered — including the
// USER's `--experimental-loader` / `module.register` hooks. A static `import {
// createRequire } from "node:module"` in either file therefore routed the builtin
// through the user chain, and a user resolve/load hook that rejects or rewrites
// `node:module` exploded nub's own load (observed against es-module/test-esm-example-
// loader and the loader-chaining corpus). So they fetch builtins via
// `process.getBuiltinModule` (synchronous, OFF the loader chain, no static import).
//
// `process.getBuiltinModule` only exists from Node 22.3 / 20.16 / 18.20.4. On the
// narrow FLOOR below that (18.19.x, 20.11–20.15, 22.0–22.2) it is `undefined`, so the
// floor needs another way to reach `node:module`'s `createRequire`. This file is that
// fallback: it holds the LONE static `import { createRequire } from "node:module"`
// and hands the value to transform-core / worker-polyfill through their module-scoped
// SETTERS (no globalThis surface — a `globalThis.__nub*` sentinel is the same brand
// leak as a NUB_* env var, enumerable in user code AND worker realms, so it is
// forbidden; this threading honors the same enumeration-invisibility contract every
// other nub polyfill keeps).
//
// WHY THIS IS LEAK-SAFE WHERE the static import in transform-core/worker-polyfill WAS
// NOT: this module is imported ONLY by the compat-tier entries (preload.mjs and
// preload-async-hooks.mjs), AHEAD of transform-core/worker-polyfill in their source
// order. The FAST tier (preload.cjs) loads those via `require(esm)` directly and never
// touches preload.mjs / preload-async-hooks.mjs — so this file's static `node:module`
// import never enters the fast-tier `require(esm)` graph, and the user loader chain
// can never observe it. On the compat tier the loader hooks run in nub's OWN worker
// (preload-async-hooks) or on the main thread before any user `--loader` could
// intercept a bare `node:` builtin, both off the user chain — so the static import is
// harmless exactly where it's reachable.
//
// IMPORT ORDERING (load-bearing): the compat entries import this file BEFORE
// transform-core/worker-polyfill, but ES modules evaluate the importEE before the
// importer's body — so transform-core's body has ALREADY run by the time the setter
// calls below fire (during THIS module's evaluation). That is fine: transform-core
// acquires its floor builtins lazily and `setBootstrapCreateRequire` triggers that
// acquisition immediately, so every binding is ready before the entry body and long
// before any hook fires. On Node WITH getBuiltinModule this file is a near no-op (the
// setters are called but those modules never consult `_bootstrapCreateRequire`).
import { createRequire } from "node:module";
import { setBootstrapCreateRequire as setTransformCoreCreateRequire } from "./transform-core.mjs";

// The floor's `createRequire`, exported so the compat entries (and any future floor
// consumer) can thread it elsewhere without re-importing `node:module` into their own
// static graph.
export { createRequire };

// Thread it into transform-core unconditionally (the setter no-ops the floor branch
// on Node WITH getBuiltinModule). worker-polyfill's setter is wired by the entries
// themselves, AFTER they import worker-polyfill, since worker-polyfill is loaded later
// in the entry's flow (via dynamic import) than this static import runs.
setTransformCoreCreateRequire(createRequire);
