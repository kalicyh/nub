# @nubjs/types

TypeScript ambient declarations for code authored against the Nub runtime — global `Worker`, `Temporal`, `reportError`, data-format wildcard imports (`*.yaml`, `*.toml`, etc.), and `import.meta.hot`.

## Usage

```
npm i -D @nubjs/types @types/node
```

Then in `tsconfig.json`:

```json
{ "compilerOptions": { "types": ["node", "@nubjs/types"] } }
```

**Recommended: `@types/node@26` (or at minimum `@types/node@25.9.3`).** This package requires `@types/node>=25` — earlier versions lack the global `MessageEvent`, `ErrorEvent`, and `MessagePort` that the `Worker` declaration depends on. Upgrade once `@types/node@26` ships.
