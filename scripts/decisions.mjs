#!/usr/bin/env node
// Tool-call-managed "decisions awaiting the maintainer" store.
// Mutations write .fray/decisions.json and ALWAYS print the FULL rendered list,
// so the maintainer sees the complete, untruncated list inline in chat. The
// statusline (scripts/statusline-decisions.sh) reads the same JSON for the
// ambient count. .fray/ is gitignored runtime state; JSON (not .md) so the fray
// board never parses it as a thread.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const store = join(root, '.fray', 'decisions.json');

function load() {
  if (!existsSync(store)) return [];
  try {
    const v = JSON.parse(readFileSync(store, 'utf8'));
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function save(items) {
  mkdirSync(dirname(store), { recursive: true });
  writeFileSync(store, JSON.stringify(items, null, 2) + '\n');
}

function nextId(items) {
  return items.reduce((m, d) => Math.max(m, d.id | 0), 0) + 1;
}

function render(items) {
  if (items.length === 0) return '✓ No decisions awaiting you.';
  const lines = [`⚖ Decisions awaiting you (${items.length}):`];
  items.forEach((d, i) => {
    const ref = d.ref ? `[${d.ref}] ` : '';
    lines.push(`   ${i + 1}. ${ref}${d.text}`);
  });
  return lines.join('\n');
}

const usage = `usage: node scripts/decisions.mjs <verb>
  add "<text>" [--ref <slug-or-#PR>]   append a decision, print the list
  resolve <id>                          remove a decided item, print the list
  update <id> "<text>"                  edit an item's text, print the list
  list                                  print the list (no mutation)`;

function parseRef(args) {
  const i = args.indexOf('--ref');
  if (i === -1) return { ref: undefined, rest: args };
  const ref = args[i + 1];
  return { ref, rest: args.slice(0, i).concat(args.slice(i + 2)) };
}

function main() {
  const [verb, ...args] = process.argv.slice(2);
  const items = load();

  switch (verb) {
    case 'add': {
      const { ref, rest } = parseRef(args);
      const text = rest.join(' ').trim();
      if (!text) {
        console.error('error: add requires "<text>"');
        process.exit(1);
      }
      items.push({ id: nextId(items), text, ...(ref ? { ref } : {}), ts: new Date().toISOString() });
      save(items);
      console.log(render(items));
      break;
    }
    case 'resolve': {
      const id = Number(args[0]);
      if (!Number.isInteger(id)) {
        console.error('error: resolve requires a numeric <id>');
        process.exit(1);
      }
      const next = items.filter((d) => d.id !== id);
      if (next.length === items.length) {
        console.error(`error: no decision with id ${id}`);
        process.exit(1);
      }
      save(next);
      console.log(render(next));
      break;
    }
    case 'update': {
      const id = Number(args[0]);
      const text = args.slice(1).join(' ').trim();
      if (!Number.isInteger(id) || !text) {
        console.error('error: update requires <id> "<text>"');
        process.exit(1);
      }
      const item = items.find((d) => d.id === id);
      if (!item) {
        console.error(`error: no decision with id ${id}`);
        process.exit(1);
      }
      item.text = text;
      save(items);
      console.log(render(items));
      break;
    }
    case 'list':
      console.log(render(items));
      break;
    default:
      console.log(usage);
      console.log('');
      console.log(render(items));
  }
}

main();
