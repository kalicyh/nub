// A passthrough async ESM loader (the tsx / ts-node/esm shape). Its mere presence
// must make nub leave the native-CJS handoff intact (no commonjs-sync relabel).
export async function resolve(spec, ctx, next) { return next(spec, ctx); }
export async function load(url, ctx, next) { return next(url, ctx); }
