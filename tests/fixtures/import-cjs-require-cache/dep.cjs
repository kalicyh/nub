// Touches require.cache at module-eval — exactly what next's bundled `conf` does
// (`delete require.cache[__filename]`). Under nub's sync load hook on Node 22.15–25,
// import()-of-CJS used to route through a synthetic `require` with no `.cache`,
// crashing with "Cannot convert undefined or null to object" (#18).
if (typeof require.cache !== "object" || require.cache === null) {
  throw new Error("require.cache is " + typeof require.cache + " (expected object)");
}
delete require.cache[__filename];
module.exports = 42;
