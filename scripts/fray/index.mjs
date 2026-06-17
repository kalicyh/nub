#!/usr/bin/env node
// @ts-check
/**
 * fray — the board + validator. There is NO stored board file: the board/status
 * view is COMPUTED ON DEMAND from the independent per-thread `.fray/<slug>.md`
 * files (the filename slug IS the thread id — the filesystem guarantees uniqueness,
 * so there is no `id` frontmatter field and nothing to dedupe) plus `.fray/config.yml`
 * (globals). Each thread's frontmatter is validated against the schema; the
 * `fray-reminder` hook runs `--validate` every turn so malformed frontmatter surfaces
 * to the orchestrator immediately.
 *
 * Usage:
 *   node scripts/fray/index.mjs               # print the board (grouped by status) + any validation errors
 *   node scripts/fray/index.mjs --status todo # print only threads in one status
 *   node scripts/fray/index.mjs --validate    # print ONLY validation errors; exit 1 if any (for the hook / CI). --check is an alias.
 *   node scripts/fray/index.mjs --json        # machine-readable {config, threads, errors}
 *
 * Thread DEPENDENCIES are expressed entirely in per-thread frontmatter — an optional
 * `depends_on: [slug, ...]` array naming OTHER THREAD SLUGS (the same files the board
 * already scans; NOT an external registry). When every target is terminal (done/
 * dismissed) the board prints `▶ READY — dependencies clear, dispatch now`; otherwise
 * it lists the outstanding blockers. Computed on demand from the scanned statuses —
 * there is no stored dependency graph.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, STATUS, TERMINAL } from './config.mjs';

const PROJECT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FRAY_DIR = join(PROJECT_DIR, '.fray');

// STATUS/TERMINAL are imported from ./config.mjs — the single shared source the hooks
// also use, so the vocab can never drift between the tool and the reminder hook.
const REQUIRED = ['title', 'status']; // created / last_update are optional.

/**
 * Parse a YAML inline-array value (`[a, b, c]` or empty `[]`) into a string list.
 * Bare scalars (`a` / `"a"`) are tolerated and wrapped as a single-element list.
 * Self-contained by design: each entry is a THREAD SLUG that the board already
 * scans — `depends_on` references other thread files, never an external registry.
 * @param {string | undefined} raw
 * @returns {string[]}
 */
function parseList(raw) {
  if (!raw) return [];
  const inner = raw.trim().replace(/^\[|\]$/g, '');
  return inner
    .split(',')
    .map((s) => s.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);
}

/**
 * Parse a top-of-file `--- … ---` YAML frontmatter block (flat `key: value` only).
 * @param {string} src
 * @returns {Record<string, string> | null}
 */
function frontmatter(src) {
  const m = src.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return null; // no frontmatter at all
  /** @type {Record<string, string>} */
  const out = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^(\w[\w-]*):\s*(.*)$/);
    if (kv) out[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

/**
 * First non-blank line under `## Next step`, collapsed to one cell.
 * @param {string} src
 * @returns {string}
 */
function nextStep(src) {
  const lines = src.split('\n');
  const i = lines.findIndex((l) => /^##\s+Next step\s*$/i.test(l));
  if (i === -1) return '';
  for (let j = i + 1; j < lines.length; j++) {
    if (/^#{1,6}\s/.test(lines[j])) break;
    if (lines[j].trim()) return lines[j].trim();
  }
  return '';
}

// .fray/config.yml globals — parsed by the shared, type-safe loadConfig.
const cfg = loadConfig(PROJECT_DIR);

const threads = readdirSync(FRAY_DIR)
  .filter((f) => f.endsWith('.md') && !f.startsWith('_')) // `_`-prefixed = non-thread meta (e.g. a stray _board.md)
  .sort()
  .map((f) => {
    const id = f.replace(/\.md$/, ''); // the filename slug IS the id
    const src = readFileSync(join(FRAY_DIR, f), 'utf8');
    const fm = frontmatter(src);
    /** @type {string[]} */
    const errors = [];
    if (!fm) {
      errors.push('no YAML frontmatter');
    } else {
      for (const k of REQUIRED) if (!fm[k]) errors.push(`missing required field: ${k}`);
      if (fm.status && !STATUS.includes(fm.status))
        errors.push(`invalid status "${fm.status}" (expected one of: ${STATUS.join(', ')})`);
    }
    const dependsOn = parseList(fm?.depends_on);
    return { id, title: fm?.title ?? '', status: fm?.status ?? '?', next: nextStep(src), dependsOn, text: src, errors };
  });

// `depends_on` references other THREAD SLUGS — validate they resolve. A dangling
// slug (no matching `.fray/<slug>.md`) is a warning, surfaced like any frontmatter
// error so the orchestrator notices the stale dependency. Everything is COMPUTED
// from the scanned set; there is no external registry to consult.
const slugs = new Set(threads.map((t) => t.id));
const statusOf = new Map(threads.map((t) => [t.id, t.status]));
for (const t of threads) {
  for (const dep of t.dependsOn) {
    if (!slugs.has(dep)) t.errors.push(`depends_on references unknown thread "${dep}"`);
  }
}

/**
 * A thread's blockers: the subset of its `depends_on` targets not yet terminal.
 * Empty ⇒ all dependencies clear. Unknown slugs are skipped here (already an error).
 * @param {{ dependsOn: string[] }} t
 * @returns {string[]}
 */
function blockers(t) {
  return t.dependsOn.filter((dep) => slugs.has(dep) && !TERMINAL.includes(statusOf.get(dep) ?? '?'));
}

const allErrors = threads.filter((t) => t.errors.length).map((t) => `  ${t.id}.md: ${t.errors.join('; ')}`);

if (process.argv.includes('--validate') || process.argv.includes('--check')) {
  if (allErrors.length) {
    console.error(`fray frontmatter validation FAILED:\n${allErrors.join('\n')}`);
    process.exit(1);
  }
  console.log('fray frontmatter OK');
  process.exit(0);
}

if (process.argv.includes('--json')) {
  const dump = threads.map(({ text, ...t }) => {
    const b = blockers(t);
    return { ...t, blockers: b, ready: t.dependsOn.length > 0 && b.length === 0 };
  });
  console.log(JSON.stringify({ config: cfg, threads: dump, errors: allErrors }, null, 2));
  process.exit(0);
}

// Substring search across id + title + body — find a thread when you can't recall its slug.
const qi = process.argv.indexOf('--search');
if (qi !== -1) {
  const q = (process.argv[qi + 1] ?? '').toLowerCase();
  const hits = threads.filter((t) => `${t.id} ${t.title} ${t.text}`.toLowerCase().includes(q));
  console.log(
    hits.length
      ? hits.map((t) => `${t.id} [${t.status}] — ${t.title}`).join('\n')
      : `no threads match "${q}"`,
  );
  process.exit(0);
}

// Default: the board. `--status <s>` narrows to one status.
const si = process.argv.indexOf('--status');
const only = si !== -1 ? process.argv[si + 1] : null;
if (only && !STATUS.includes(only)) {
  console.error(`unknown status "${only}" (expected one of: ${STATUS.join(', ')})`);
  process.exit(2);
}
const out = [];
out.push(`fray board — autonomous_mode: ${cfg.autonomousMode ? 'on' : 'off'}${only ? ` — status:${only}` : ''}`);
if (allErrors.length) out.push(`\n⚠ VALIDATION ERRORS:\n${allErrors.join('\n')}`);
for (const s of only ? [only] : STATUS) {
  const group = threads.filter((t) => t.status === s);
  if (!group.length) continue;
  out.push(`\n## ${s} (${group.length})`);
  for (const t of group) {
    out.push(`- ${t.id} — ${t.title}\n    → ${t.next}`);
    if (t.dependsOn.length) {
      const b = blockers(t);
      out.push(b.length
        ? `    ⏳ blocked on: ${b.join(', ')}`
        : `    ▶ READY — dependencies clear, dispatch now`);
    }
  }
}
const unknown = threads.filter((t) => !STATUS.includes(t.status));
if (unknown.length) out.push(`\n## (invalid status) (${unknown.length})\n${unknown.map((t) => `- ${t.id} [${t.status}]`).join('\n')}`);
console.log(out.join('\n'));
