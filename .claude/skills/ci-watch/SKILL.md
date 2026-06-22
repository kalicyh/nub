---
name: ci-watch
description: >-
  Watch GitHub Actions CI correctly with the gh CLI — block until a run / PR
  check rollup is TRULY terminal, then trust the exit code. Invoke (via the Skill
  tool) whenever you need to wait on CI after a push, tag, or PR-open and act on
  the result (merge-on-green, release-on-green, fail-fast on red). Encodes the
  premature-exit pitfall (raw `gh run watch` / `gh pr checks --watch` exit 0
  while the run is still QUEUED with no jobs registered, and exit non-zero on a
  transient API blip) and the blessed fix: `scripts/ci-watch.ts`, which waits for
  the target to EXIST, polls authoritative terminal status, fails fast on the
  first failing check, and exits with a status the orchestrator can trust. Run it
  as a detached run_in_background task.
---

# Watching CI with the GitHub CLI

## The pitfall: raw watchers exit early

`gh run watch <id> --exit-status` and `gh pr checks <pr> --watch` are NOT safe to arm right after a `git push` / tag / PR-open:

- **Premature exit while QUEUED.** Armed immediately after a push, the run has no jobs registered yet. gh sees "nothing in progress" and returns **exit 0** — even though the run is still queued/in_progress. (Observed on the v0.1.11 release: the watcher exited 0 while the Test gate job was still running.)
- **Transient errors read as failure.** A mid-watch `HTTP 401: Bad credentials` (token refresh) or a 5xx makes the watcher exit **non-zero**, indistinguishable from a real CI failure. (Also observed on v0.1.11.)
- **No native fix.** There is no `gh run watch` flag that waits-for-existence or tolerates transient errors (`--interval` only tunes the poll cadence). The script below is the fix.

## The rule

**Never trust a raw watcher's exit code alone. Always re-verify terminal status** with `gh run view <id> --json status,conclusion` (a run is done only when `status == "completed"`) or `gh pr view <pr> --json statusCheckRollup` (done only when every item is terminal). And **always fail-fast** — act on the first failing check, never wait for all checks to finish (AGENTS.md fail-fast discipline).

The blessed tool bakes all of this in — prefer it over a hand-rolled watcher.

## The blessed tool: `scripts/ci-watch.ts`

Blocks until the target is truly terminal, then exits with a trustworthy status. Dogfoods nub; runs under plain Node too.

```bash
nub  scripts/ci-watch.ts --run <run-id> [--repo o/r] [--timeout <min>]
node scripts/ci-watch.ts --pr  <number> [--repo o/r] [--timeout <min>]
```

- `--run <run-id>` — watch a workflow run (polls `gh run view --json status,conclusion,jobs`).
- `--pr <number>` — watch a PR's check rollup (polls `gh pr view --json statusCheckRollup,…`).
- `--repo <owner/repo>` — defaults to the current repo.
- `--timeout <minutes>` — wall-clock cap before giving up as pending (default 45).

What it fixes: **waits for the target to EXIST** (a not-found / no-jobs-yet target is "keep polling," never "done"); polls **authoritative** terminal state (`status == "completed"` / all rollup items terminal); **fails fast** on the first FAILURE/CANCELLED/TIMED_OUT/STARTUP_FAILURE; **tolerates transient** gh/API errors (retried with backoff, not treated as a run failure); uses gh's stored token implicitly (high rate limit) with exponential jittered backoff (10s → cap 60s, 90s if unauthenticated).

### Exit-code contract

| code | meaning |
| ---- | ------- |
| 0 | completed AND all green |
| 1 | a check/job failed (the summary names which + the URL) |
| 2 | still pending after `--timeout` |
| 3 | usage / target-unresolvable / unrecoverable error |

The final stdout line is a single self-describing summary, e.g. `CI-WATCH run 27972328590: SUCCESS (25 job(s) green)` or `CI-WATCH pr 73: FAILURE — check "Test (ubuntu-latest, node 22.13)" → FAILURE (https://…)`.

### Run it detached

It's designed to run as a detached `run_in_background` Bash task that re-invokes the orchestrator on exit — read the outcome from the tail (the `CI-WATCH …` line) and gate on the exit code:

```bash
nub scripts/ci-watch.ts --run "$RUN_ID" --repo nubjs/nub   # run_in_background: true
```

For a merge-queue drain, prefer `scripts/merge-cascade.ts` (it gates positively and merges on green); reach for `ci-watch.ts` when you just need to block on one run/PR and branch on the result.
