#!/usr/bin/env node
// merge-cascade — drive the orchestrator's merge-queue: for each enqueued PR,
// wait for CI to go green, squash-merge, fast-forward the shared tree, and sync
// the vendor/aube submodule if the PR bumped its pin. Automates the manual
// watch → merge → pull → next-PR loop.
//
// Runs under BOTH plain Node (type-stripping) and nub:
//   node scripts/merge-cascade.ts [--dry-run] [--queue <path>] [--shared-tree <dir>]
//   nub  scripts/merge-cascade.ts [--dry-run] [--queue <path>] [--shared-tree <dir>]
//
// Erasable TypeScript only (no enums/namespaces/parameter-properties) so plain
// modern `node` runs it with no build step.
//
// ORCHESTRATOR tooling — NOT run in CI. Reads .fray/merge-queue.jsonl (one JSON
// object per line: {pr, branch?, thread?, note?, hold?}). For each entry, in
// order:
//   1. Skip if held — `"hold": true`, OR a note containing HELD / "do NOT
//      merge" / "DON'T MERGE" (the live queue marks holds in prose).
//   2. Skip if the PR is already merged/closed.
//   3. Watch the PR's CI: poll `gh pr view --json statusCheckRollup` with
//      exponential backoff (capped) until every required check has a terminal
//      conclusion.
//   4. SAFETY: merge ONLY if every check concluded SUCCESS/NEUTRAL/SKIPPED and
//      the PR is mergeable (no conflicts). Any FAILURE/cancelled/timed-out, or
//      an un-mergeable (CONFLICTING) PR, is reported and SKIPPED — never merged.
//   5. `gh pr merge <pr> --squash --admin`.
//   6. `git -C <shared-tree> pull --ff-only`; if the PR touched vendor/aube,
//      `git -C <shared-tree> submodule update --init vendor/aube`.
//
// --dry-run reports the decision for every entry (held / would-merge / blocked)
// and merges nothing. Default is --dry-run-safe: it WILL merge on green unless
// --dry-run is passed; pass --dry-run to preview.

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const REPO = "nubjs/nub";

// ---- args -------------------------------------------------------------------

function parseArgs(argv: string[]) {
  let dryRun = false;
  let queue = join(REPO_ROOT, ".fray", "merge-queue.jsonl");
  let sharedTree = REPO_ROOT;
  let pollMaxMinutes = 60;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") dryRun = true;
    else if (a === "--queue") queue = resolve(argv[++i]);
    else if (a === "--shared-tree") sharedTree = resolve(argv[++i]);
    else if (a === "--max-minutes") pollMaxMinutes = Number(argv[++i]);
    else if (a === "-h" || a === "--help") {
      printHelp();
      process.exit(0);
    } else {
      console.error(`merge-cascade: unknown arg ${a}`);
      process.exit(2);
    }
  }
  return { dryRun, queue, sharedTree, pollMaxMinutes };
}

function printHelp() {
  console.log(`merge-cascade — drain .fray/merge-queue.jsonl: watch CI, merge on green, ff-pull

Usage:
  node scripts/merge-cascade.ts [flags]
  nub  scripts/merge-cascade.ts [flags]

Flags:
  --dry-run             Report the decision per PR (held/would-merge/blocked); merge nothing.
  --queue <path>        Queue file (default .fray/merge-queue.jsonl).
  --shared-tree <dir>   Tree to ff-pull after each merge (default repo root).
  --max-minutes <n>     Cap CI watch per PR (default 60).
  -h, --help            Show this help.

Safe by construction: never merges a PR with a failing/cancelled check or a
merge conflict; honors holds (\"hold\": true or a HELD / do-not-merge note).`);
}

// ---- shelling out -----------------------------------------------------------

function gh(args: string[]): string {
  return execFileSync("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();
}
function git(args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---- queue parsing ----------------------------------------------------------

interface QueueEntry {
  pr: number;
  branch?: string;
  thread?: string;
  note?: string;
  hold?: boolean;
}

function readQueue(path: string): QueueEntry[] {
  if (!existsSync(path)) {
    console.error(`merge-cascade: queue not found: ${path}`);
    process.exit(2);
  }
  const out: QueueEntry[] = [];
  const raw = readFileSync(path, "utf8");
  // Support both JSONL (one object per line — the live format) and a JSON array.
  const trimmed = raw.trim();
  if (trimmed.startsWith("[")) {
    for (const e of JSON.parse(trimmed)) out.push(e);
  } else {
    for (const line of trimmed.split("\n")) {
      const l = line.trim();
      if (!l) continue;
      out.push(JSON.parse(l));
    }
  }
  return out;
}

function isHeld(e: QueueEntry): boolean {
  if (e.hold === true) return true;
  const note = (e.note || "").toLowerCase();
  return note.includes("held") || note.includes("do not merge") || note.includes("don't merge");
}

// ---- CI status --------------------------------------------------------------

type RollupItem = {
  name?: string;
  status?: string; // CheckRun: QUEUED | IN_PROGRESS | COMPLETED
  conclusion?: string; // CheckRun: SUCCESS | FAILURE | NEUTRAL | SKIPPED | CANCELLED | TIMED_OUT | ...
  state?: string; // StatusContext: SUCCESS | PENDING | FAILURE | ERROR
};

function prState(pr: number): { state: string; mergeable: string; rollup: RollupItem[] } {
  const json = gh([
    "pr",
    "view",
    String(pr),
    "--repo",
    REPO,
    "--json",
    "state,mergeable,statusCheckRollup",
  ]);
  const d = JSON.parse(json);
  return { state: d.state, mergeable: d.mergeable, rollup: d.statusCheckRollup || [] };
}

// Classify a rollup into pending / failed / all-green.
function classifyRollup(rollup: RollupItem[]): {
  pending: string[];
  failed: string[];
} {
  const pending: string[] = [];
  const failed: string[] = [];
  for (const it of rollup) {
    const name = it.name || "(unnamed)";
    if (it.status !== undefined) {
      // CheckRun
      if (it.status !== "COMPLETED") {
        pending.push(name);
      } else {
        const c = (it.conclusion || "").toUpperCase();
        if (c === "SUCCESS" || c === "NEUTRAL" || c === "SKIPPED") {
          /* ok */
        } else {
          failed.push(`${name} (${c || "no-conclusion"})`);
        }
      }
    } else if (it.state !== undefined) {
      // StatusContext (legacy commit status)
      const s = (it.state || "").toUpperCase();
      if (s === "PENDING" || s === "") pending.push(name);
      else if (s !== "SUCCESS") failed.push(`${name} (${s})`);
    }
  }
  return { pending, failed };
}

// Whether the PR touched the vendor/aube submodule gitlink (a pin bump).
function touchesAube(pr: number): boolean {
  try {
    const files = gh(["pr", "view", String(pr), "--repo", REPO, "--json", "files", "--jq", ".files[].path"]);
    return files.split("\n").some((p) => p.trim() === "vendor/aube");
  } catch {
    return false;
  }
}

// ---- main -------------------------------------------------------------------

async function watchUntilTerminal(
  pr: number,
  maxMinutes: number,
): Promise<{ ok: boolean; reason: string }> {
  const deadline = Date.now() + maxMinutes * 60_000;
  let delay = 15_000; // start at 15s
  const maxDelay = 120_000; // cap at 2min
  for (;;) {
    const { state, mergeable, rollup } = prState(pr);
    if (state !== "OPEN") return { ok: false, reason: `PR is ${state}, not OPEN` };
    if (rollup.length === 0) {
      // No checks reported yet — keep waiting (CI may not have registered).
    } else {
      const { pending, failed } = classifyRollup(rollup);
      if (failed.length > 0) return { ok: false, reason: `failing checks: ${failed.join(", ")}` };
      if (pending.length === 0) {
        if (mergeable === "CONFLICTING") return { ok: false, reason: "merge conflict (CONFLICTING)" };
        return { ok: true, reason: "all checks green" };
      }
      console.log(`    … ${pending.length} check(s) pending: ${pending.slice(0, 4).join(", ")}${pending.length > 4 ? " …" : ""}`);
    }
    if (Date.now() > deadline) return { ok: false, reason: `timed out after ${maxMinutes}min` };
    await sleep(delay);
    delay = Math.min(delay * 1.5, maxDelay);
  }
}

async function main() {
  const { dryRun, queue, sharedTree, pollMaxMinutes } = parseArgs(process.argv.slice(2));
  const entries = readQueue(queue);
  console.log(`merge-cascade: ${entries.length} queued PR(s)  (${dryRun ? "DRY-RUN" : "LIVE"})  queue=${queue}\n`);

  let merged = 0;
  let skipped = 0;
  for (const e of entries) {
    const tag = `PR #${e.pr}${e.branch ? ` (${e.branch})` : ""}`;
    if (isHeld(e)) {
      console.log(`  ${tag}: HELD — skipping. ${e.note ? `note: ${e.note}` : ""}`);
      skipped++;
      continue;
    }

    let st: { state: string; mergeable: string; rollup: RollupItem[] };
    try {
      st = prState(e.pr);
    } catch (err) {
      console.log(`  ${tag}: could not read PR state — skipping. (${(err as Error).message.split("\n")[0]})`);
      skipped++;
      continue;
    }
    if (st.state !== "OPEN") {
      console.log(`  ${tag}: already ${st.state} — skipping.`);
      skipped++;
      continue;
    }

    if (dryRun) {
      const { pending, failed } = classifyRollup(st.rollup);
      let verdict: string;
      if (failed.length) verdict = `BLOCKED — failing: ${failed.join(", ")}`;
      else if (st.mergeable === "CONFLICTING") verdict = "BLOCKED — merge conflict";
      else if (pending.length) verdict = `WAIT — ${pending.length} check(s) pending`;
      else verdict = "WOULD MERGE — all green";
      console.log(`  ${tag}: ${verdict}`);
      continue;
    }

    // LIVE: watch then merge.
    console.log(`  ${tag}: watching CI…`);
    const res = await watchUntilTerminal(e.pr, pollMaxMinutes);
    if (!res.ok) {
      console.log(`  ${tag}: NOT merged — ${res.reason}.`);
      skipped++;
      continue;
    }

    const aube = touchesAube(e.pr);
    console.log(`  ${tag}: green — squash-merging${aube ? " (bumps vendor/aube)" : ""}…`);
    gh(["pr", "merge", String(e.pr), "--repo", REPO, "--squash", "--admin"]);
    merged++;

    // Fast-forward the shared tree; sync the submodule on a pin bump.
    try {
      git(["-C", sharedTree, "pull", "--ff-only"]);
      if (aube) git(["-C", sharedTree, "submodule", "update", "--init", "vendor/aube"]);
      console.log(`  ${tag}: merged + shared tree fast-forwarded${aube ? " + aube synced" : ""}.`);
    } catch (err) {
      console.log(`  ${tag}: merged, but shared-tree update failed: ${(err as Error).message.split("\n")[0]}`);
    }
  }

  console.log(`\nmerge-cascade: merged ${merged}, skipped ${skipped}.`);
}

main();
