const m = await import("./cjs-uses-builtin.cjs");
console.log("counter", m.default);
