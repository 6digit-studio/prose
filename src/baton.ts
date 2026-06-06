/**
 * Baton service — prose-native "you are here" markers.
 *
 * A baton is a small, typed, persisted record written at the end of a stretch
 * of work to orient the *next* session: position, an advisory next move, the
 * freeform "you are here." This is the one deliberately STATEFUL corner of
 * prose — every other verb is pure-read. Batons are written via `prose baton
 * set` and persisted to `~/.prose/batons.json`, which rides the vault's git
 * history, so batons sync across machines for free.
 *
 * Decoupled from any one methodology. A baton carries a free-form TYPE label
 * (`handoff`, `baton`, `decision`, …) rendered as `↪ <LABEL>: <content>`.
 * Arbiter-Driven Development's `↪ HANDOFF` is simply `type: 'handoff'` — one
 * consumer among many, with no special status in here.
 *
 * "You are here," NOT a backlog. `listBatons` returns the LATEST baton per
 * (project, type) by default; history exists but is never the default surface,
 * so batons orient the next walk without accumulating into a to-do list.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { randomUUID } from 'crypto';
import { getMemoryDir } from './memory.js';

export interface Baton {
  /** Stable unique id. */
  id: string;
  /** Free-form label, lowercased (`handoff`, `baton`, `decision`, …). */
  type: string;
  /** Absolute cwd the baton belongs to — the "garden" it orients. */
  project: string;
  /** Freeform body (e.g. `position — what merged · next: X · or pivot`). */
  content: string;
  /** ISO timestamp of when the baton was set. */
  timestamp: string;
  /**
   * Hidden correlation keys — terminal/multiplexer identifiers captured from the
   * environment at set-time (e.g. `ZMX_SESSION`, `TMUX_PANE`). Purely a behind-
   * the-scenes correlation tool: never rendered, never shown. On read, a baton
   * sharing any one (name,value) pair with the current environment is bumped
   * ahead of the plain latest-per-(project,type) pick, so a terminal recovers
   * *its own* handoff even when several terminals work the same project at once.
   * Absent when nothing identifying was in the environment — and that's fine.
   */
  keys?: Record<string, string>;
}

/**
 * Environment variables that identify a *terminal / multiplexer session* — a
 * value that stays constant across a Claude Code `/clear` (which resets only the
 * conversation, not the surrounding shell) and typically across detach/reattach
 * too. We capture whatever subset is present; the more we can grab, the more
 * robust the later correlation. Listed best-first by uniqueness, but matching
 * treats them all equally.
 */
const CORRELATION_ENV_VARS = [
  'ZMX_SESSION', // zmx (Zig session server) — opaque per-session GUID, never recycled
  'TMUX', // tmux server: socket,pid,session
  'TMUX_PANE', // tmux pane id (%N)
  'ZELLIJ_SESSION_NAME', // zellij session
  'ZELLIJ_PANE_ID', // zellij pane
  'STY', // GNU screen session
  'WEZTERM_PANE', // WezTerm pane
  'KITTY_WINDOW_ID', // kitty window
  'TERM_SESSION_ID', // Apple Terminal
  'ITERM_SESSION_ID', // iTerm2
] as const;

/**
 * Snapshot the correlation keys present in `env` (defaults to the real process
 * environment). Empty/whitespace values are skipped. Returns `{}` when nothing
 * identifying is present — a perfectly valid "no anchor" state.
 */
export function captureCorrelationKeys(
  env: Record<string, string | undefined> = process.env
): Record<string, string> {
  const keys: Record<string, string> = {};
  for (const name of CORRELATION_ENV_VARS) {
    const v = env[name];
    if (v && v.trim()) keys[name] = v;
  }
  return keys;
}

/** True iff `a` and `b` share at least one identical (name, value) pair. */
export function correlationKeysMatch(
  a: Record<string, string> | undefined,
  b: Record<string, string> | undefined
): boolean {
  if (!a || !b) return false;
  for (const name of Object.keys(a)) {
    if (b[name] !== undefined && b[name] === a[name]) return true;
  }
  return false;
}

/**
 * Where batons live. Honors `PROSE_BATON_STORE` (used by tests to avoid
 * touching the real vault); otherwise the vault's `batons.json`.
 */
export function getBatonStorePath(): string {
  return process.env.PROSE_BATON_STORE || join(getMemoryDir(), 'batons.json');
}

function loadBatons(): Baton[] {
  const path = getBatonStorePath();
  if (!existsSync(path)) return []; // first use — legitimately empty
  // A corrupt store is a real problem; let it fail loudly rather than silently
  // discarding someone's batons and starting fresh.
  const raw = readFileSync(path, 'utf-8').trim();
  if (!raw) return [];
  const parsed = JSON.parse(raw) as Baton[];
  if (!Array.isArray(parsed)) {
    throw new Error(`Baton store at ${path} is not a JSON array.`);
  }
  return parsed;
}

function saveBatons(batons: Baton[]): void {
  const path = getBatonStorePath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(batons, null, 2) + '\n', 'utf-8');
}

/**
 * Parse the canonical `↪ <LABEL>: <content>` rendered form back into a type +
 * content. Returns null if the string isn't in that form. The sigil is
 * optional slack: `HANDOFF: foo` parses the same as `↪ HANDOFF: foo`.
 */
export function parseBatonLine(line: string): { type: string; content: string } | null {
  const m = line.trim().match(/^(?:↪\s*)?([A-Za-z][\w-]*)\s*:\s*([\s\S]*)$/);
  if (!m) return null;
  const content = m[2].trim();
  if (!content) return null;
  return { type: m[1].toLowerCase(), content };
}

export interface SetBatonOptions {
  /** Raw content; may itself carry a `↪ LABEL:` prefix, which sets the type. */
  content: string;
  /** Explicit type override. Wins over any prefix parsed from `content`. */
  type?: string;
  /** Project the baton belongs to. Defaults to `process.cwd()`. */
  cwd?: string;
  /**
   * Correlation keys to embed. Defaults to a live snapshot of the environment
   * (`captureCorrelationKeys()`). Exposed mainly so tests can inject a known
   * set without touching `process.env`.
   */
  keys?: Record<string, string>;
}

/**
 * Write a baton. If `content` is in `↪ LABEL: body` form and no explicit
 * `type` is given, the label becomes the type and the body becomes the content.
 */
export function setBaton(opts: SetBatonOptions): Baton {
  const cwd = opts.cwd ?? process.cwd();
  let type = opts.type?.trim().toLowerCase();
  let content = opts.content.trim();

  const parsed = parseBatonLine(content);
  if (parsed) {
    if (!type) type = parsed.type;
    content = parsed.content;
  }
  if (!type) type = 'baton';
  if (!content) throw new Error('Refusing to set an empty baton.');

  const keys = opts.keys ?? captureCorrelationKeys();

  const baton: Baton = {
    id: randomUUID(),
    type,
    project: cwd,
    content,
    timestamp: new Date().toISOString(),
  };
  // Only persist the field when there's something to correlate on.
  if (Object.keys(keys).length > 0) baton.keys = keys;

  const all = loadBatons();
  all.push(baton);
  saveBatons(all);
  return baton;
}

export interface ListBatonOptions {
  /** Scope to one project (exact cwd match). */
  cwd?: string;
  /** Filter to one type. */
  type?: string;
  /** Return full history instead of latest-per-(project,type). */
  history?: boolean;
  /** Cap the number of returned batons (after sorting/dedup). */
  limit?: number;
  /**
   * Correlation keys for the *current* terminal. Defaults to a live environment
   * snapshot. In the collapsed (non-history) view, a baton sharing any key with
   * these wins its (project,type) slot over a newer non-matching one. No match
   * (or no keys) → plain latest-wins, unchanged.
   */
  correlationKeys?: Record<string, string>;
}

/**
 * Batons newest-first. By default collapses to the LATEST baton per
 * (project, type) pair — the "you are here" surface. `history: true` returns
 * every baton instead.
 */
export function listBatons(opts: ListBatonOptions = {}): Baton[] {
  let all = loadBatons();
  if (opts.cwd) all = all.filter((b) => b.project === opts.cwd);
  if (opts.type) {
    const t = opts.type.toLowerCase();
    all = all.filter((b) => b.type === t);
  }
  // Sort newest-first. The store is append-only, so its insertion order is the
  // true temporal order — use it as a tiebreaker for batons that share a
  // millisecond-granular timestamp (which ISO strings alone can't separate).
  const ordered = all
    .map((b, i) => ({ b, i }))
    .sort((x, y) => y.b.timestamp.localeCompare(x.b.timestamp) || y.i - x.i);

  if (opts.history) {
    let res = ordered.map((x) => x.b);
    if (opts.limit && opts.limit > 0) res = res.slice(0, opts.limit);
    return res;
  }

  // Collapse to one baton per (project, type). Default pick is the newest
  // (ordered is newest-first, so first-seen wins). A baton whose correlation
  // keys match the current terminal overrides that newest pick — but only the
  // first such match per slot, so a correlated baton never loses to an older
  // correlated one.
  const current = opts.correlationKeys ?? captureCorrelationKeys();
  const chosen = new Map<string, { b: Baton; i: number; matched: boolean }>();
  for (const { b, i } of ordered) {
    const slot = `${b.project} ${b.type}`;
    const matched = correlationKeysMatch(b.keys, current);
    const existing = chosen.get(slot);
    if (!existing) {
      chosen.set(slot, { b, i, matched });
    } else if (matched && !existing.matched) {
      chosen.set(slot, { b, i, matched });
    }
  }

  let res = [...chosen.values()]
    .sort((x, y) => y.b.timestamp.localeCompare(x.b.timestamp) || y.i - x.i)
    .map((x) => x.b);

  if (opts.limit && opts.limit > 0) res = res.slice(0, opts.limit);
  return res;
}

export interface ClearBatonOptions {
  cwd?: string;
  type?: string;
  /** Nuke the entire store. Required when neither `cwd` nor `type` is given. */
  all?: boolean;
}

/**
 * Remove batons matching the filters. Returns the count removed. Refuses to
 * delete everything unless `all` is explicitly set — an unscoped clear is
 * almost always a mistake.
 */
export function clearBatons(opts: ClearBatonOptions): number {
  if (!opts.all && !opts.cwd && !opts.type) {
    throw new Error('clearBatons needs a cwd, a type, or all: true — refusing an unscoped wipe.');
  }
  const all = loadBatons();
  if (opts.all) {
    saveBatons([]);
    return all.length;
  }
  const type = opts.type?.toLowerCase();
  const keep = all.filter((b) => {
    const matchCwd = opts.cwd ? b.project === opts.cwd : true;
    const matchType = type ? b.type === type : true;
    return !(matchCwd && matchType); // drop the ones matching every given filter
  });
  const removed = all.length - keep.length;
  saveBatons(keep);
  return removed;
}

/** The canonical one-line rendering of a baton. */
export function renderBatonLine(b: Baton): string {
  return `↪ ${b.type.toUpperCase()}: ${b.content}`;
}

function formatAge(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}

/**
 * Compact header block of batons for a single cwd — what `snap`/`whisper`
 * prepend so orientation carries the last "you are here" for free. Returns ''
 * when there are no batons (caller prepends nothing).
 */
export function renderBatonHeader(batons: Baton[], now: number = Date.now()): string {
  if (batons.length === 0) return '';
  const lines = ['=== ↪ batons (you are here) ==='];
  for (const b of batons) {
    const age = formatAge(now - new Date(b.timestamp).getTime());
    lines.push(`${renderBatonLine(b)}   (${age})`);
  }
  return lines.join('\n') + '\n\n';
}
