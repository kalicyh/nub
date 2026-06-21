---
title: "start.md adoption flow: offer to add a GENERAL nub skill (not a migration skill)"
status: needs-decision
last_update: 2026-06-21
status_text: "PR #55 open (sha a19d088) — step 7 now coding-agent-AGNOSTIC: agent writes the `nub agent skill` content per ITS OWN conventions (Claude/.claude one example among several). Durable agent-agnostic rule added to AGENTS.md. `nub agent skill` confirmed to emit a complete skill doc with valid frontmatter. Colin reviews final wording before merge."
---

## Goal
Colin (2026-06-21): the `start.md` adoption flow (reworked into a permission-gated flow in #45) should ask the user whether they want a **general nub skill** added to their project (a Claude Code skill teaching agents the nub CLI surface). Explicitly NOT a migration skill — "what a dumb thing to add to a repo"; migration is covered by start.md itself + the /guides/bun-to-nub guide. So: a GENERAL nub skill offer, migration stays skill-free.

## Scope
1. Read the current `start.md` (reworked in #45 — find it under `site/`; it drives the permission-gated adoption flow). Understand its step structure.
2. Add a step that ASKS (permission-gated, like the rest of the flow) whether to add a general nub skill to the user's project (`.claude/skills/nub/` or wherever skills live), and if yes, writes it.
3. AUTHOR the general nub skill: concise, teaches an agent the nub CLI surface — `nub <file>` (TS-just-works runner), `nub run`, `nubx`, the pnpm-compatible PM (`install`/`add`/`remove`/`run`), `--node`/`NODE_COMPAT` compat mode, the incumbent behavior (reads existing PM config). Ground it in the real CLI surface (crates/nub-cli/src/cli.rs + the docs). Brand-clean, factual, no aspirational claims.
4. NOT a migration skill — do not create one; migration is start.md + the guide.

## Decisions
- General nub skill offer in start.md = greenlit-concept (Colin). Build as a REVIEWABLE prototype PR — the exact skill content + the offer wording are Colin's to approve before it's the live default (product/UX surface).
- No migration skill.

## Open questions
- Exact skill content + where the offer sits in the flow — Colin reviews the prototype.

## Steps / follow-up queue
- [x] Locate + read start.md (#45's reworked flow) — `site/public/start.md`.
- [x] Add the permission-gated "add a general nub skill?" step (new step 7, after step 6, before Notes).
- [x] Skill content is the existing `site/public/skill.md` (already comprehensive; what `nub agent skill` outputs). No new skill file authored — the offer wires to the existing one.
- [x] PR #55 opened, enqueued.
- [x] Refinement (sha 9c7d3fc): step 7 shows the pipe form. Verified in `crates/nub-cli/src/agent/mod.rs` that `nub agent skill` prints `site/public/skill.md` verbatim (`print!("{SKILL_MD}")`), and that file leads with valid `name`/`description` YAML frontmatter (a unit test asserts it). So the content is a complete, valid skill doc needing no post-edit.
- [x] Correction (sha a19d088): step 7 made coding-agent-AGNOSTIC — do NOT overfit to Claude. The running agent writes the `nub agent skill` content per ITS OWN standing-instructions conventions and the user's repo layout (Claude Code → `.claude/skills/nub/SKILL.md`; Cursor → `.cursor/rules/`; Codex/Copilot → `AGENTS.md`/`.github/copilot-instructions.md`; any other → its equivalent). Claude path is now one example among several, not the sole target. Recorded the durable principle in `AGENTS.md` (user-facing copy section): user-facing agent instructions must be coding-agent-agnostic. `nub agent skill` / `https://nubjs.com/skill.md` kept as the neutral content source.

## Next step
Colin reviews PR #55 — final wording + step placement. Once approved/adjusted, merge. No further agent work needed unless wording changes are requested.
