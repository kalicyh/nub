// Parent spawns a worker that throws at top level. The parent's `onerror` must
// fire with the error's message exposed via the ErrorEvent shape, and the
// parent process must survive (exit 0) rather than crash with a ReferenceError
// from the polyfill's `new ErrorEvent(...)` on the < Node 26 floor.
const w = new Worker(new URL("./throwing-worker.ts", import.meta.url));

// The success path is event-driven, not deadline-gated: as soon as `onerror`
// fires we print both proof lines and exit. That the parent reaches this handler
// AT ALL — instead of crashing on `new ErrorEvent(...)` — is the whole point of
// the test, so "parent-alive:true" is emitted from inside the handler. There is
// no race against a fixed timer; a cold .ts-transpiling worker on a slow CI
// runner takes as long as it needs.
w.onerror = (e: { message?: string; error?: { message?: string } }) => {
  const msg = e.message ?? e.error?.message ?? "";
  console.log("parent-onerror:" + msg);
  console.log("parent-alive:true");
  (w as { terminate(): void }).terminate();
  process.exit(0);
};

// Generous backstop: only fires if `onerror` NEVER arrives (a real propagation
// regression) — it prints the failure state and exits so the test fails loudly
// instead of hanging the suite. On the success path the handler above has
// already exited long before this fires.
setTimeout(() => {
  console.log("parent-alive:false");
  process.exit(0);
}, 10000);
