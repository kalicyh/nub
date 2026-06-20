// @ts-check
/**
 * fray — agent-liveness helper for the Stop hook.
 *
 * The orchestrator dispatches background sub-agents and records their bindings in
 * each thread's frontmatter (`agents: [...]`). Today it manually liveness-checks
 * `tasks/<agentId>.output` mtimes every turn to notice agents that have gone IDLE
 * (frozen / stuck) or that finished but whose thread was never reconciled
 * (UNREAPED). This module automates that into the Stop reminder: it DETECTS those
 * states and returns reminder LINES for the Stop hook to surface. Hooks cannot call
 * SendMessage/Agent, so this is detect-and-remind only — exactly the ask.
 *
 * Mechanism, all on disk + cheap (a handful of stat/readFile):
 *   1. Derive the session tasks dir from the Stop payload's `transcript_path`
 *      (`~/.claude/projects/<slug>/<session>.jsonl`). The per-agent activity files
 *      live at `<tmp>/claude-<uid>/<slug>/<session>/tasks/<agentId>.output`, where
 *      `<tmp>` is `/tmp` or `/private/tmp` and `<uid>` varies — so we GLOB the
 *      `claude-*` dirs under both bases rather than hard-code the uid. The `.output`
 *      entries are SYMLINKS to the subagent transcript jsonl; we `statSync` (follows
 *      the link) so the age reflects the TARGET's real last-write, not the stale
 *      symlink mtime.
 *   2. Parse every `.fray/*.md` frontmatter `agents:` list. Two shapes are supported:
 *      structured `[{id, label, status}, ...]` and the bare `[id1, id2, ...]` list.
 *   3. For each agent whose recorded per-agent status is non-terminal (or absent),
 *      stat its `.output` and compute age. Emit:
 *        - IDLE  (age > IDLE_MIN):   poke (SendMessage) or check if frozen.
 *        - FROZEN (age > FROZEN_MIN): stronger "likely frozen" wording.
 *        - UNREAPED: the agent rested (present in .rested-agents.jsonl) OR is FROZEN-
 *          stale, AND the THREAD's overall status is still non-terminal → reconcile.
 *
 * Thresholds (minutes), tunable via env for experimentation:
 *   FRAY_IDLE_MIN   (default 10) — no activity this long → flag as idle/poke.
 *   FRAY_FROZEN_MIN (default 25) — this long → call it likely-frozen. Deliberately
 *      generous: a real agent can sit silent inside a long `cargo build`/CI watch for
 *      many minutes, and a release build of THIS repo runs ~5-15 min, so 25 min gives
 *      headroom before we cry "frozen" and risk a false poke.
 *
 * FAIL-OPEN ABSOLUTELY: any error (no tasks dir, unparseable frontmatter, no agents:,
 * unreadable file) → return [] (no lines). This must NEVER throw or block end-of-turn.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const IDLE_MIN = parseInt(process.env.FRAY_IDLE_MIN || '', 10) || 10;
const FROZEN_MIN = parseInt(process.env.FRAY_FROZEN_MIN || '', 10) || 25;

// Per-agent statuses that mean "don't bother liveness-checking this one". A bare-id
// agent (no recorded status) is treated as non-terminal (we DO check it). Matched as
// a substring so `stopped-release-pulled`, `done (CI green)`, etc. all count.
const TERMINAL_AGENT_RE = /\b(done|dismissed|rested|stopped|killed|complete|reaped|merged|landed)\b/i;
// Thread-level terminal statuses (frontmatter `status:`), matching scripts/fray TERMINAL.
const TERMINAL_THREAD = new Set(['done', 'dismissed']);

/**
 * Derive the session tasks dir from a Stop payload's transcript_path.
 * @param {string|undefined|null} transcriptPath
 * @returns {string|null}
 */
export function deriveTasksDir(transcriptPath) {
  try {
    if (!transcriptPath || typeof transcriptPath !== 'string') return null;
    const parts = transcriptPath.split('/');
    const sessionFile = parts.pop(); // <session>.jsonl
    const slug = parts.pop(); // <project-slug>
    if (!sessionFile || !slug) return null;
    const session = sessionFile.replace(/\.jsonl$/, '');
    if (!session) return null;
    for (const base of ['/tmp', '/private/tmp']) {
      let dirs;
      try {
        dirs = readdirSync(base).filter((d) => d.startsWith('claude-'));
      } catch {
        continue;
      }
      for (const d of dirs) {
        const cand = join(base, d, slug, session, 'tasks');
        if (existsSync(cand)) return cand;
      }
    }
  } catch {
    /* fail-open */
  }
  return null;
}

/**
 * Extract `{id, label, status}` records from a thread's frontmatter `agents:` list.
 * Tolerates both the structured object form and the bare-id-list form. Best-effort
 * regex parse (the file is hand-authored YAML-ish; no YAML dep by design).
 * @param {string} src
 * @returns {{id:string,label:string|null,status:string|null}[]}
 */
function parseAgents(src) {
  /** @type {{id:string,label:string|null,status:string|null}[]} */
  const out = [];
  try {
    const m = src.match(/^agents:\s*\[([\s\S]*?)\]\s*$/m);
    if (!m) return out;
    const body = m[1];
    // Structured form: one {...} object per agent.
    const objs = body.match(/\{[^}]*\}/g);
    if (objs && objs.length) {
      for (const o of objs) {
        const id = o.match(/\bid:\s*([^,}\s]+)/)?.[1];
        if (!id) continue;
        const label = o.match(/\blabel:\s*"([^"]*)"/)?.[1] ?? o.match(/\blabel:\s*([^,}]+)/)?.[1]?.trim() ?? null;
        const status = o.match(/\bstatus:\s*"?([^,"}]+)"?/)?.[1]?.trim() ?? null;
        out.push({ id, label, status });
      }
      return out;
    }
    // Bare-id-list form: `[a1b2, c3d4, ...]` — no per-agent status.
    for (const raw of body.split(',')) {
      const id = raw.trim().replace(/^["']|["']$/g, '');
      if (id) out.push({ id, label: null, status: null });
    }
  } catch {
    /* fail-open → whatever we parsed so far */
  }
  return out;
}

/** Set of agent ids recorded as having rested (by id) in .rested-agents.jsonl. */
function restedAgentIds(frayDir) {
  /** @type {Set<string>} */
  const ids = new Set();
  try {
    const lines = readFileSync(join(frayDir, '.rested-agents.jsonl'), 'utf8').split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const rec = JSON.parse(line);
        const id = rec.agent_id || rec.agentId || rec.id;
        if (id) ids.add(String(id));
      } catch {
        /* skip malformed */
      }
    }
  } catch {
    /* no log */
  }
  return ids;
}

/**
 * Compute idle/frozen/unreaped reminder lines for all dispatched agents.
 * @param {{transcriptPath?: string|null, projectDir: string, now?: number}} args
 * @returns {string[]} reminder lines (possibly empty)
 */
export function agentLivenessLines({ transcriptPath, projectDir, now = Date.now() }) {
  /** @type {string[]} */
  const lines = [];
  try {
    const tasksDir = deriveTasksDir(transcriptPath);
    if (!tasksDir) return lines; // can't locate activity files → fail-open, say nothing
    const frayDir = join(projectDir, '.fray');
    const rested = restedAgentIds(frayDir);

    let files;
    try {
      files = readdirSync(frayDir).filter((f) => f.endsWith('.md') && !f.startsWith('_'));
    } catch {
      return lines;
    }

    for (const f of files) {
      let src;
      try {
        src = readFileSync(join(frayDir, f), 'utf8');
      } catch {
        continue;
      }
      const slug = f.replace(/\.md$/, '');
      const threadStatus = src.match(/^status:\s*(\S+)/m)?.[1] ?? '';
      const threadTerminal = TERMINAL_THREAD.has(threadStatus);
      const agents = parseAgents(src);

      for (const a of agents) {
        // Skip agents whose own recorded status is terminal.
        if (a.status && TERMINAL_AGENT_RE.test(a.status)) continue;
        // Only real activity-file ids are checkable; placeholders (`current`) just miss.
        let ageMin = null;
        try {
          const st = statSync(join(tasksDir, `${a.id}.output`)); // follows the symlink → target mtime
          ageMin = (now - st.mtimeMs) / 60000;
        } catch {
          ageMin = null; // no activity file → can't judge idleness (fail-open per agent)
        }
        const who = `${a.label ? `${a.label} ` : ''}[${a.id.slice(0, 9)}] (thread ${slug})`;
        const isRested = rested.has(a.id);

        // UNREAPED: agent looks finished (rested, or frozen-stale) but the THREAD is
        // not terminal → the orchestrator never reconciled it.
        const frozenStale = ageMin != null && ageMin > FROZEN_MIN;
        if (!threadTerminal && (isRested || frozenStale)) {
          const why = isRested ? 'recorded rested' : `no output for ${Math.round(ageMin)}m`;
          lines.push(`⚠ UNREAPED: agent ${who} ${why} but thread status is "${threadStatus || '?'}" (non-terminal) — reconcile (fold findings, drain queue, flip terminal or confirm still running).`);
          continue; // don't also emit a plain IDLE line for the same agent
        }

        if (ageMin == null) continue; // nothing to say without an activity file
        if (ageMin > FROZEN_MIN) {
          lines.push(`⚠ FROZEN?: agent ${who} — no output for ${Math.round(ageMin)}m (> ${FROZEN_MIN}m). Likely stuck; check it, then poke (SendMessage) to continue or kill+re-dispatch only if truly dead.`);
        } else if (ageMin > IDLE_MIN) {
          lines.push(`⚠ IDLE: agent ${who} — no output for ${Math.round(ageMin)}m. Poke (SendMessage) to continue, or check if it's mid-long-build (then leave it).`);
        }
      }
    }
  } catch {
    /* fail-open: return whatever we have (typically []) */
  }
  return lines;
}
