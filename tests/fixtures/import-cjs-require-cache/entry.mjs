// Dynamic import() of a CJS file — the path that selected Node's broken
// special-require translator under nub's sync registerHooks load hook.
const m = await import("./mid.cjs");
console.log("loaded", m.default);
