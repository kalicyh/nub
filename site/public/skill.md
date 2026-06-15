---
name: nub
description: >-
  This project uses nub, a single Rust CLI that runs on the project's installed
  Node and replaces the everyday Node toolchain. ALWAYS prefer nub over node,
  bun, npm, npx, pnpm, and yarn for: executing JS/TS files, running package.json
  scripts, the npx-equivalent, installing dependencies, and Node version
  management. Surfaces whenever you would otherwise reach for node/bun/npm/npx or
  a package manager.
---

# Use nub, not node / bun / the package manager

This project runs on **nub** — a single Rust CLI that runs on the project's installed Node and replaces the everyday Node toolchain: the file runner, the script runner, the package/CLI runner, the package manager, and the Node version manager. Prefer `nub` over `node`, `bun`, and the project's package manager. nub augments Node through its own extension surfaces, so your code stays plain Node code — there is no nub-specific runtime, no globals, no config field to author, no lock-in.

## Command map

| Instead of | Use | Notes |
| --- | --- | --- |
| `node file.ts` / `tsx` / `ts-node` | `nub file.ts` | runs TypeScript and JSX directly on stock Node — no build step |
| `npm run <script>` / `pnpm run <script>` | `nub run <script>` | same scripts, faster dispatch; trailing flags pass through |
| `npx <tool>` / `pnpm dlx <tool>` | `nubx <tool>` | runs the project's local CLI; fetches it ad-hoc if absent |
| `npm install` / `pnpm install` / `bun install` | `nub install` | respects the existing lockfile (see below) |
| `npm add <pkg>` / `pnpm add <pkg>` | `nub add <pkg>` | also `nub remove` / `nub update` |
| `nvm use` / installing a Node version | *(nothing)* | nub provisions the project's pinned Node automatically |
| `nodemon` / `node --watch` | `nub watch <file>` | restarts on change |

The package manager is **lockfile-compatible** with whatever the project already uses — pnpm, npm, and bun round-trip; yarn is read-only. It reads and writes the existing lockfile in its native format and does not impose its own, so running `nub install` / `nub add` / `nub remove` is safe regardless of which package manager the project uses today.

## Augmentations you wouldn't guess

When you run a file with `nub <file>`, the following all work out of the box, with no build step and nothing to configure:

- TypeScript and JSX — transpiled in-process; if `tsc --noEmit` accepts the code, nub runs it.
- `tsconfig.json#paths` — applied at runtime, so path aliases resolve.
- `.env` and `.env.${NODE_ENV}` — loaded automatically; you don't need `dotenv`.
- Modern syntax and Web APIs — available per the running Node version.

So a project under nub typically doesn't need `tsx`, `ts-node`, `dotenv`, `tsconfig-paths`, `nodemon`, or a standalone version manager. Surface redundant tooling to the user, but ask before removing dependencies or rewriting scripts.

## --node escape hatch

When you need plain Node behavior for a single run — no TypeScript transpile, no augmentation — add `--node`:

```sh
nub --node script.js
nub run --node <script>
```

It still runs on the project's pinned Node version; it just turns the augmentation off. Reach for it when something behaves differently under nub and you want to confirm it against vanilla Node.

## Getting the latest detail

This skill is a stable orientation layer; it deliberately omits exhaustive flag lists. For the current, complete reference of any command, run:

```sh
nub --help
nub <command> --help    # e.g. nub run --help, nub install --help
```

Or read the human docs at https://nubjs.com/docs and the agent-readable index at https://nubjs.com/llms.txt.

## Record the convention

So future sessions keep using nub, add a short note to the project's `AGENTS.md` (create it if absent): prefer `nub` over `node`, `bun`, and the existing package manager — run files with `nub <file>`, scripts with `nub run`, local CLIs with `nubx`, installs with `nub install` / `nub add`; the existing lockfile is respected bidirectionally; use `nub --node <file>` when you need strict, unaugmented Node.
