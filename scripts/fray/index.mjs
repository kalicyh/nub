#!/usr/bin/env node
/**
 * fray — the board + validator. There is NO stored board file: the board/status
 * view is COMPUTED ON DEMAND from the independent per-thread `.fray/<slug>.md`
 * files (the filename slug IS the thread id — the filesystem guarantees uniqueness,
 * so there is no `id` frontmatter field and nothing to dedupe) plus `.fray/config.yml`
 * (globals). Each thread's frontmatter is validated against the schema; the
 * `iw-reminder` hook runs `--validate` every turn so malformed frontmatter surfaces
 * to the orchestrator immediately.
 *
 * Usage:
 *   node scripts/fray/index.mjs               # print the board (grouped by status) + any validation errors
 *   node scripts/fray/index.mjs --status todo # print only threads in one status
 *   node scripts/fray/index.mjs --validate    # print ONLY validation errors; exit 1 if any (for the hook / CI)
 *   node scripts/fray/index.mjs --json        # machine-readable {config, threads, errors}
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const FRAY_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '.fray');

// The thread-status vocabulary. Keep in sync with the copy in .claude/hooks/iw-reminder.ts.
export const STATUS = ['todo', 'active', 'blocked', 'needs-decision', 'done'];
const REQUIRED = ['title', 'status']; // created / last_update are optional.

// Parse a top-of-file `--- … ---` YAML frontmatter block (flat `key: value` only).
function frontmatter(src) {
  const m = src.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return null; // no frontmatter at all
  const out = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^(\w[\w-]*):\s*(.*)$/);
    if (kv) out[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

// First non-blank line under `## Next step`, collapsed to one cell.
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

// Read .fray/config.yml globals (flat keys + a `state:` block). Tolerant: missing → {}.
function config() {
  try {
    const src = readFileSync(join(FRAY_DIR, 'config.yml'), 'utf8');
    const flat = {};
    for (const line of src.split('\n')) {
      const kv = line.match(/^(\w[\w-]*):\s*(\S.*)$/); // top-level scalars only
      if (kv) flat[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, '');
    }
    return flat;
  } catch {
    return {};
  }
}

const threads = readdirSync(FRAY_DIR)
  .filter((f) => f.endsWith('.md') && !f.startsWith('_')) // `_`-prefixed = non-thread meta (e.g. a stray _board.md)
  .sort()
  .map((f) => {
    const id = f.replace(/\.md$/, ''); // the filename slug IS the id
    const src = readFileSync(join(FRAY_DIR, f), 'utf8');
    const fm = frontmatter(src);
    const errors = [];
    if (!fm) {
      errors.push('no YAML frontmatter');
    } else {
      for (const k of REQUIRED) if (!fm[k]) errors.push(`missing required field: ${k}`);
      if (fm.status && !STATUS.includes(fm.status))
        errors.push(`invalid status "${fm.status}" (expected one of: ${STATUS.join(', ')})`);
    }
    return { id, title: fm?.title ?? '', status: fm?.status ?? '?', next: nextStep(src), errors };
  });

const allErrors = threads.filter((t) => t.errors.length).map((t) => `  ${t.id}.md: ${t.errors.join('; ')}`);

if (process.argv.includes('--validate')) {
  if (allErrors.length) {
    console.error(`fray frontmatter validation FAILED:\n${allErrors.join('\n')}`);
    process.exit(1);
  }
  console.log('fray frontmatter OK');
  process.exit(0);
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ config: config(), threads, errors: allErrors }, null, 2));
  process.exit(0);
}

// Default: the board. `--status <s>` narrows to one status.
const si = process.argv.indexOf('--status');
const only = si !== -1 ? process.argv[si + 1] : null;
if (only && !STATUS.includes(only)) {
  console.error(`unknown status "${only}" (expected one of: ${STATUS.join(', ')})`);
  process.exit(2);
}
const cfg = config();
const out = [];
out.push(`fray board — autonomous_mode: ${cfg.autonomous_mode ?? '?'}${only ? ` — status:${only}` : ''}`);
if (allErrors.length) out.push(`\n⚠ VALIDATION ERRORS:\n${allErrors.join('\n')}`);
for (const s of only ? [only] : STATUS) {
  const group = threads.filter((t) => t.status === s);
  if (!group.length) continue;
  out.push(`\n## ${s} (${group.length})`);
  for (const t of group) out.push(`- ${t.id} — ${t.title}\n    → ${t.next}`);
}
const unknown = threads.filter((t) => !STATUS.includes(t.status));
if (unknown.length) out.push(`\n## (invalid status) (${unknown.length})\n${unknown.map((t) => `- ${t.id} [${t.status}]`).join('\n')}`);
console.log(out.join('\n'));
