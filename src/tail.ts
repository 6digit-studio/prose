/**
 * Tail — follow a live session as it grows.
 *
 * `prose tail [id]` resolves like `session` (any unique id prefix); with no
 * id it picks the most recently modified session for the given cwd (default:
 * the current directory), which is the "watch the agent working over there"
 * move — point it at a worktree and observe the session from outside.
 *
 * Renders the same verbatim format as `session`/`snap`: an initial backlog
 * (last N messages), then each new message as it lands. Pure read, no LLM.
 * Polls by mtime/size; reparses the file on change (the offset-parser is the
 * upgrade path for claude-code journals if polling ever gets heavy).
 */

import { statSync } from 'node:fs';
import { sanitizePath } from './memory.js';
import type { SessionFile } from './session-parser.js';
import {
  collectAllSessionFiles,
  parseByType,
  resolveSessionId,
  SessionAmbiguousError,
  SessionNotFoundError,
  type SessionMatch,
} from './session.js';

export interface TailOptions {
  /** Initial backlog: print the last N messages before following (default 10). */
  turns?: number;
  /** Poll interval in milliseconds (default 2000). */
  intervalMs?: number;
  /**
   * Per-message byte cap (default 4096 — tailing is a glance surface; pass 0
   * for the full firehose).
   */
  maxMessageBytes?: number;
  /** Cwd filter for the no-id newest-session pick (default process.cwd()). */
  cwd?: string;
  /** With no id, pick the globally newest session instead of cwd-filtered. */
  any?: boolean;
  /** Stream target (default process.stdout). */
  write?: (chunk: string) => void;
  /** Status/meta target (default process.stderr). */
  writeMeta?: (chunk: string) => void;
}

export class NoSessionForCwdError extends Error {
  constructor(public readonly cwd: string) {
    super(
      `No session found for cwd '${cwd}'.\n` +
        `  (pass an id prefix, or --any for the globally newest session)`
    );
    this.name = 'NoSessionForCwdError';
  }
}

function clip(content: string, maxBytes: number): string {
  if (maxBytes <= 0) return content;
  const buf = Buffer.from(content, 'utf-8');
  if (buf.length <= maxBytes) return content;
  const head = buf.subarray(0, maxBytes).toString('utf-8');
  return `${head}\n... [${buf.length - maxBytes} bytes elided]`;
}

function pickTarget(idPrefix: string | undefined, opts: TailOptions): SessionFile {
  if (idPrefix) {
    const matches = resolveSessionId(idPrefix);
    if (matches.length === 0) throw new SessionNotFoundError(idPrefix);
    if (matches.length > 1) {
      const sorted = [...matches].sort(
        (a, b) => b.modifiedTime.getTime() - a.modifiedTime.getTime()
      );
      throw new SessionAmbiguousError(
        idPrefix,
        sorted.map(
          (m): SessionMatch => ({
            sessionId: m.sessionId,
            sourceType: m.sourceType ?? 'claude-code',
            path: m.path,
            modifiedTime: m.modifiedTime.toISOString(),
            cwd: m.cwd,
          })
        )
      );
    }
    return matches[0];
  }

  const cwd = opts.cwd ?? process.cwd();
  // Claude Code journals don't carry cwd at discover time (it's per-message,
  // resolved on parse) — but their `project` field is the sanitized cwd, so
  // match either. Without this, every claude-code session is silently
  // dropped and stale other-source transcripts win by forfeit.
  const munged = `-${sanitizePath(cwd)}`;
  const all = collectAllSessionFiles();
  const pool = opts.any
    ? all
    : all.filter((f) => f.cwd === cwd || f.project === munged);
  if (pool.length === 0) throw new NoSessionForCwdError(cwd);
  return pool.reduce((a, b) => (a.modifiedTime > b.modifiedTime ? a : b));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Follow one session until the process is interrupted (or `signal` aborts —
 * tests use that; the CLI just lets Ctrl-C end the process).
 */
export async function tail(
  idPrefix: string | undefined,
  opts: TailOptions = {},
  signal?: AbortSignal
): Promise<void> {
  const turns = opts.turns ?? 10;
  const intervalMs = opts.intervalMs ?? 2000;
  const maxMessageBytes = opts.maxMessageBytes ?? 4096;
  const write = opts.write ?? ((s: string) => process.stdout.write(s));
  const writeMeta = opts.writeMeta ?? ((s: string) => process.stderr.write(s));

  const file = pickTarget(idPrefix, opts);
  let conv = parseByType(file);

  writeMeta(
    `# tailing ${conv.sessionId.slice(0, 8)} (${file.sourceType ?? 'claude-code'}` +
      `${file.cwd ? `, cwd ${file.cwd}` : ''}) — every ${intervalMs}ms, Ctrl-C to stop\n` +
      `# path: ${file.path}\n\n`
  );

  const render = (from: number): number => {
    for (const msg of conv.messages.slice(from)) {
      write(`[${msg.timestamp.toISOString()}] ${msg.role.toUpperCase()}:\n`);
      write(clip(msg.content, maxMessageBytes) + '\n\n');
    }
    return conv.messages.length;
  };

  let printed = render(Math.max(0, conv.messages.length - turns));
  let lastSize = file.fileSize ?? 0;
  let lastMtime = file.modifiedTime.getTime();

  while (!signal?.aborted) {
    await sleep(intervalMs);
    let st;
    try {
      st = statSync(file.path);
    } catch {
      writeMeta(`# session file vanished: ${file.path}\n`);
      return;
    }
    if (st.size === lastSize && st.mtimeMs === lastMtime) continue;
    lastSize = st.size;
    lastMtime = st.mtimeMs;
    conv = parseByType(file);
    if (conv.messages.length < printed) {
      // Truncated/rewritten upstream — restart honestly rather than guess.
      writeMeta(`# session file shrank (${printed} -> ${conv.messages.length} messages); re-rendering tail\n`);
      printed = render(Math.max(0, conv.messages.length - turns));
      continue;
    }
    printed = render(printed);
  }
}
