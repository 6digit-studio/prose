/**
 * Snap — verbatim readout of recent activity in the current cwd.
 *
 * Reads Claude Code session JSONL for the current cwd, returns the tail of
 * the most-recent N sessions (excluding any actively-being-written session)
 * up to a byte budget. Output is verbatim turn-pairs, chronological within
 * each session, sessions ordered newest-first.
 */

import { discoverSessionFiles, parseSessionFile, type Message } from './session-parser.js';
import {
  discoverCodexSessionFiles,
  parseCodexSessionFile,
} from './codex-session-parser.js';
import {
  discoverOpencodeSessionFiles,
  parseOpencodeSessionFile,
} from './opencode-session-parser.js';

export interface SnapOptions {
  cwd?: string;
  /** Total byte budget for the assembled text (default 4000). */
  bytes?: number;
  /** Last N messages per session (default 4 → ~2 turn-pairs). */
  turnsPerSession?: number;
  /** Cap on how many sessions to include (default 5). */
  maxSessions?: number;
  /** Skip sessions whose JSONL was written within this many ms (default 60_000). */
  liveSessionWindowMs?: number;
  /** Include the actively-written session (default false). */
  includeCurrent?: boolean;
}

export interface SnapSessionMeta {
  sessionId: string;
  /** ISO timestamp of the last message inside the session (content-based recency). */
  lastMessageTime: string;
  /** ISO timestamp of the file's last modification (filesystem recency, can be touched by indexers). */
  modifiedTime: string;
  ageMs: number;
  messageCount: number;
}

export interface SnapResult {
  cwd: string;
  text: string;
  bytes: number;
  sessionsIncluded: number;
  turnsIncluded: number;
  truncated: boolean;
  sessions: SnapSessionMeta[];
}

function formatAge(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}

function renderSessionBlock(
  sessionId: string,
  sourceLabel: string,
  lastMessageTime: Date,
  ageLabel: string,
  tail: Message[]
): string {
  const lines: string[] = [];
  lines.push(
    `=== ${sourceLabel} session ${sessionId.slice(0, 8)} (${ageLabel}, last message ${lastMessageTime.toISOString()}) ===`
  );
  for (const msg of tail) {
    lines.push(`[${msg.timestamp.toISOString()}] ${msg.role.toUpperCase()}:`);
    lines.push(msg.content);
    lines.push('');
  }
  return lines.join('\n') + '\n';
}

export function snap(opts: SnapOptions = {}): SnapResult {
  const cwd = opts.cwd ?? process.cwd();
  const bytesBudget = opts.bytes ?? 4000;
  const turnsPerSession = opts.turnsPerSession ?? 4;
  const maxSessions = opts.maxSessions ?? 5;
  const liveWindowMs = opts.liveSessionWindowMs ?? 60_000;
  const includeCurrent = opts.includeCurrent ?? false;

  // Pass cwd as both projectPath and currentCwd so we hit the cwd-match
  // primary scan AND the misfiled-session secondary scan.
  const claudeFiles = discoverSessionFiles(cwd, cwd);
  const codexFiles = discoverCodexSessionFiles(cwd);
  const opencodeFiles = discoverOpencodeSessionFiles(cwd);
  const now = Date.now();

  // Parse a wider set of candidates than maxSessions so we can re-sort by
  // content recency (mtime can be skewed by indexers/touches). Take a per-
  // source slice so a noisy source can't crowd the others out — without this,
  // a project with hundreds of Claude Code JSONLs starves Codex sessions
  // from ever reaching the parse stage.
  const perSourceCap = Math.max(maxSessions * 3, 15);
  const candidatePool = [
    ...claudeFiles.slice(0, perSourceCap),
    ...codexFiles.slice(0, perSourceCap),
    ...opencodeFiles.slice(0, perSourceCap),
  ].sort((a, b) => b.modifiedTime.getTime() - a.modifiedTime.getTime());

  type Parsed = {
    file: typeof candidatePool[number];
    conv: ReturnType<typeof parseSessionFile>;
    lastMessageTime: Date;
    contentAgeMs: number;
  };

  const parsed: Parsed[] = [];
  for (const f of candidatePool) {
    const conv =
      f.sourceType === 'codex'
        ? parseCodexSessionFile(f.path)
        : f.sourceType === 'opencode'
        ? parseOpencodeSessionFile(f.path)
        : parseSessionFile(f.path);
    if (conv.messages.length === 0) continue;
    const lastMessageTime = conv.messages[conv.messages.length - 1].timestamp;
    const contentAgeMs = now - lastMessageTime.getTime();
    if (!includeCurrent && contentAgeMs < liveWindowMs) continue;
    parsed.push({ file: f, conv, lastMessageTime, contentAgeMs });
  }

  parsed.sort((a, b) => b.lastMessageTime.getTime() - a.lastMessageTime.getTime());

  const sections: string[] = [];
  const sessionsMeta: SnapSessionMeta[] = [];
  let bytes = 0;
  let turnsIncluded = 0;
  let truncated = false;

  for (const p of parsed) {
    if (sessionsMeta.length >= maxSessions) {
      truncated = true;
      break;
    }

    const tail = p.conv.messages.slice(-turnsPerSession);
    const sourceLabel =
      p.file.sourceType === 'codex'
        ? 'Codex'
        : p.file.sourceType === 'opencode'
        ? 'opencode'
        : 'Claude Code';
    const block = renderSessionBlock(
      p.conv.sessionId,
      sourceLabel,
      p.lastMessageTime,
      formatAge(p.contentAgeMs),
      tail
    );
    const blockBytes = Buffer.byteLength(block, 'utf-8');

    if (bytes + blockBytes > bytesBudget && sections.length > 0) {
      truncated = true;
      break;
    }

    sections.push(block);
    bytes += blockBytes;
    turnsIncluded += tail.length;
    sessionsMeta.push({
      sessionId: p.conv.sessionId,
      lastMessageTime: p.lastMessageTime.toISOString(),
      modifiedTime: p.file.modifiedTime.toISOString(),
      ageMs: p.contentAgeMs,
      messageCount: tail.length,
    });
  }

  return {
    cwd,
    text: sections.join('\n'),
    bytes,
    sessionsIncluded: sessionsMeta.length,
    turnsIncluded,
    truncated,
    sessions: sessionsMeta,
  };
}
