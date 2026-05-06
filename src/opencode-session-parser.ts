/**
 * Session Parser for opencode (sst/opencode) sessions.
 *
 * opencode stores its data in SQLite at ~/.local/share/opencode/opencode.db
 * rather than per-session JSONL files. Three relevant tables:
 *
 *   session(id, directory, title, time_created, time_updated, ...)
 *   message(id, session_id, time_created, data)   -- data is JSON: {role, ...}
 *   part   (id, message_id, session_id, time_created, data) -- data is JSON: {type, text?, ...}
 *
 * A "message" is a logical turn; its visible content is assembled from the
 * `text`-typed parts attached to it. Other part types (`reasoning`, `tool`,
 * `step-start`/`step-finish`, `patch`, `file`, `snapshot`, `compaction`) are
 * skipped — we want the visible verbatim text, not the internal trace.
 *
 * We expose the same shape as the JSONL parsers: `SessionFile` rows with a
 * synthetic `opencode://ses_xxx` path, and a `parseOpencodeSessionFile(path)`
 * that returns a `Conversation`. Discovery and parsing both shell out to the
 * `sqlite3` CLI to avoid pulling in a native dependency.
 */

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { Message, SessionFile, Conversation } from './session-parser.js';

const OPENCODE_DB = join(homedir(), '.local', 'share', 'opencode', 'opencode.db');
const SEP = '\x1f'; // ASCII unit separator — safe row delimiter

const OPENCODE_PATH_PREFIX = 'opencode://';

export function isOpencodeSyntheticPath(p: string): boolean {
  return p.startsWith(OPENCODE_PATH_PREFIX);
}

function sessionIdFromSyntheticPath(p: string): string {
  return p.slice(OPENCODE_PATH_PREFIX.length);
}

function syntheticPath(sessionId: string): string {
  return OPENCODE_PATH_PREFIX + sessionId;
}

function escapeSqlLiteral(s: string): string {
  return s.replace(/'/g, "''");
}

/**
 * Run a SQL statement against the opencode db. Returns rows as SEP-separated
 * lines. Empty array on any failure (db missing, sqlite3 not on PATH, etc.) —
 * opencode parsing is best-effort, never fatal.
 */
function runSql(sql: string): string[] {
  if (!existsSync(OPENCODE_DB)) return [];
  try {
    const output = execSync(`sqlite3 -bail -separator $'\\x1f' '${OPENCODE_DB}'`, {
      input: sql,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore'],
      shell: '/bin/bash',
      maxBuffer: 64 * 1024 * 1024,
    });
    return output.split('\n').filter((l) => l.length > 0);
  } catch {
    return [];
  }
}

interface SessionRow {
  id: string;
  directory: string;
  title: string;
  timeCreated: number;
  timeUpdated: number;
}

function querySessions(cwdFilter?: string): SessionRow[] {
  const where = cwdFilter ? `WHERE directory = '${escapeSqlLiteral(cwdFilter)}'` : '';
  // Cap broadly here — downstream callers further filter and slice.
  const sql = `SELECT id, directory, COALESCE(title, ''), time_created, time_updated FROM session ${where} ORDER BY time_updated DESC LIMIT 500;`;
  const out: SessionRow[] = [];
  for (const line of runSql(sql)) {
    const parts = line.split(SEP);
    if (parts.length < 5) continue;
    const tc = parseInt(parts[3], 10);
    const tu = parseInt(parts[4], 10);
    if (!Number.isFinite(tc) || !Number.isFinite(tu)) continue;
    out.push({
      id: parts[0],
      directory: parts[1],
      title: parts[2],
      timeCreated: tc,
      timeUpdated: tu,
    });
  }
  return out;
}

/**
 * Discover opencode sessions. With `projectPath` set, return only sessions
 * whose `directory` matches the path. Without it, return all sessions across
 * cwds — used by `standup`'s cross-project crawl.
 */
export function discoverOpencodeSessionFiles(projectPath?: string): SessionFile[] {
  const rows = querySessions(projectPath);
  return rows.map((r) => ({
    path: syntheticPath(r.id),
    sessionId: r.id,
    project: r.directory, // best label we have; real cwd comes from `cwd` field
    modifiedTime: new Date(r.timeUpdated),
    fileSize: 0, // unknown for sqlite-backed sources; not used for opencode
    sourceType: 'opencode' as const,
    cwd: r.directory,
  }));
}

interface PartData {
  type?: string;
  text?: string;
}

interface MessageData {
  role?: 'user' | 'assistant' | 'system' | 'tool';
}

/**
 * Extract visible text from one part's data blob. Returns empty string for
 * part types we deliberately skip (reasoning, tool, step-start/finish, etc.).
 */
function extractPartText(partDataJson: string): string {
  if (!partDataJson) return '';
  let parsed: PartData;
  try {
    parsed = JSON.parse(partDataJson) as PartData;
  } catch {
    return '';
  }
  if (parsed.type !== 'text') return '';
  return typeof parsed.text === 'string' ? parsed.text : '';
}

function extractRole(messageDataJson: string): 'user' | 'assistant' | null {
  if (!messageDataJson) return null;
  try {
    const parsed = JSON.parse(messageDataJson) as MessageData;
    if (parsed.role === 'user' || parsed.role === 'assistant') return parsed.role;
  } catch {
    // fall through
  }
  return null;
}

export function parseOpencodeSessionFile(filePath: string): Conversation {
  const sessionId = isOpencodeSyntheticPath(filePath)
    ? sessionIdFromSyntheticPath(filePath)
    : filePath;

  const sessionRows = querySessions(undefined).filter((r) => r.id === sessionId);
  // Direct lookup by id avoids the `WHERE directory =` filter and survives
  // missing/empty session metadata.
  const sessionMeta = sessionRows[0];

  // Pull messages and their parts in one ordered scan. Empty session_data
  // shouldn't happen but is defensively tolerated.
  const escapedId = escapeSqlLiteral(sessionId);
  const sql =
    `SELECT m.id, m.time_created, m.data, ` +
    `       COALESCE(p.id, ''), COALESCE(p.time_created, 0), COALESCE(p.data, '') ` +
    `FROM message m ` +
    `LEFT JOIN part p ON p.message_id = m.id ` +
    `WHERE m.session_id = '${escapedId}' ` +
    `ORDER BY m.time_created ASC, p.time_created ASC;`;

  const lines = runSql(sql);

  // Group rows by message_id, preserving order of first appearance.
  type MsgAccum = {
    id: string;
    time: number;
    role: 'user' | 'assistant' | null;
    pieces: string[];
  };
  const order: string[] = [];
  const byMsg = new Map<string, MsgAccum>();

  for (const line of lines) {
    const parts = line.split(SEP);
    if (parts.length < 6) continue;
    const [mid, mtimeStr, mdata, , , pdata] = parts;
    let acc = byMsg.get(mid);
    if (!acc) {
      const mtime = parseInt(mtimeStr, 10);
      acc = {
        id: mid,
        time: Number.isFinite(mtime) ? mtime : 0,
        role: extractRole(mdata),
        pieces: [],
      };
      byMsg.set(mid, acc);
      order.push(mid);
    }
    const text = extractPartText(pdata);
    if (text) acc.pieces.push(text);
  }

  const messages: Message[] = [];
  for (const id of order) {
    const acc = byMsg.get(id)!;
    if (!acc.role) continue;
    const content = acc.pieces.join('\n\n').trim();
    if (!content) continue; // skip turns whose visible content is all reasoning/tool
    const ts = new Date(acc.time);
    messages.push({
      role: acc.role,
      content,
      timestamp: ts,
      source: {
        sessionId,
        messageUuid: id,
        timestamp: ts,
        filePath,
      },
    });
  }

  const startTime = messages[0]?.timestamp ?? new Date(sessionMeta?.timeCreated ?? Date.now());
  const endTime =
    messages[messages.length - 1]?.timestamp ?? new Date(sessionMeta?.timeUpdated ?? Date.now());

  return {
    sessionId,
    project: sessionMeta?.directory ?? 'opencode',
    messages,
    startTime,
    endTime,
    processedBytes: 0,
  };
}
