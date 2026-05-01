/**
 * Standup — cross-cwd, time-windowed compression of recent activity.
 *
 * Where `whisper` is "what's happening here," `standup` is "what have I been
 * doing across all my work." Crawls every Claude Code session JSONL whose
 * last message falls inside the time window, groups by working directory,
 * and runs a single streaming LLM pass to produce a project-by-project
 * narrative. No persistence.
 */

import { openSync, readSync, closeSync } from 'fs';
import { createOpenAI } from '@ai-sdk/openai';
import { streamText } from 'ai';

import { discoverSessionFiles, parseSessionFile, type Message } from './session-parser.js';
import {
  discoverCodexSessionFiles,
  parseCodexSessionFile,
} from './codex-session-parser.js';

export interface StandupOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  temperature?: number;
  /** Time window expressed as e.g. "4h", "30m", "1d", "2h30m". Default "4h". */
  since?: string;
  /** Last N messages per session that lands in the window. Default 6. */
  turnsPerSession?: number;
  /** Per-session byte cap on the rendered tail. Default 1500. */
  bytesPerSession?: number;
  /** Total byte cap on the assembled LLM input. Default 24000. */
  totalBytes?: number;
  /** Max sessions across all projects. Default 30. */
  maxSessions?: number;
  /** Skip sessions whose last message is within this many ms (live session). Default 60_000. */
  liveSessionWindowMs?: number;
  /** Include the actively-written session. Default false. */
  includeCurrent?: boolean;
  /** Stream destination. Defaults to process.stdout. */
  out?: NodeJS.WritableStream;
}

export interface StandupProjectMeta {
  cwd: string;
  sessionCount: number;
  messageCount: number;
}

export interface StandupResult {
  windowMs: number;
  sessionsIncluded: number;
  projects: StandupProjectMeta[];
  promptBytes: number;
  text: string;
  emitted: boolean;
}

const SYSTEM_PROMPT = `You are giving a quick standup — a project-by-project readout of the user's recent Claude Code activity across multiple working directories. Verbatim tails are provided below, grouped by cwd.

Produce a project-by-project narrative. For each project that had real activity:
  - One header line: "**<short project name>**" (derive from the cwd path; just the basename)
  - 2–4 sentences: what was being worked on, what landed, anything open or pending

Skip projects with only trivial activity. Do not restate session IDs or timestamps. No preamble, no closing summary. Voice: direct, daily-standup register — what changed, what's next.`;

const DURATION_RE = /(\d+)([smhd])/g;

export function parseDuration(input: string): number {
  let total = 0;
  let any = false;
  for (const m of input.matchAll(DURATION_RE)) {
    any = true;
    const n = parseInt(m[1], 10);
    switch (m[2]) {
      case 's': total += n * 1000; break;
      case 'm': total += n * 60_000; break;
      case 'h': total += n * 3_600_000; break;
      case 'd': total += n * 86_400_000; break;
    }
  }
  if (!any && /^\d+$/.test(input.trim())) {
    return parseInt(input.trim(), 10) * 3_600_000;
  }
  if (total <= 0) {
    throw new Error(`Could not parse duration: "${input}". Try "4h", "30m", "1d", or "2h30m".`);
  }
  return total;
}

/**
 * Scan the first chunk of a session JSONL file for a line carrying a cwd field
 * (user/assistant messages have it; meta lines like `queue-operation` don't).
 * Falls back to deriving a path from the project dir name if no line yields one,
 * which is lossy when basenames contain dashes — the JSONL cwd is authoritative.
 */
function readSessionCwd(filePath: string, projectDirName: string): string {
  try {
    const fd = openSync(filePath, 'r');
    const buf = Buffer.alloc(16384);
    readSync(fd, buf, 0, buf.length, 0);
    closeSync(fd);

    for (const line of buf.toString('utf-8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed);
        if (typeof parsed.cwd === 'string' && parsed.cwd.length > 0) {
          return parsed.cwd;
        }
      } catch {
        // partial line at end of buffer is expected; keep scanning previous lines
      }
    }
  } catch {
    // fall through to dashy-name fallback
  }
  return '/' + projectDirName.replace(/^-/, '').replace(/-/g, '/');
}

function basenameOf(path: string): string {
  const trimmed = path.replace(/\/+$/, '');
  const idx = trimmed.lastIndexOf('/');
  return idx === -1 ? trimmed : trimmed.slice(idx + 1);
}

function renderMessage(msg: Message): string {
  const ts = msg.timestamp.toISOString();
  return `[${ts}] ${msg.role.toUpperCase()}:\n${msg.content}\n`;
}

function renderTail(messages: Message[], byteCap: number): string {
  const blocks = messages.map(renderMessage);
  let out = '';
  let bytes = 0;
  for (const b of blocks) {
    const bn = Buffer.byteLength(b, 'utf-8');
    if (bytes + bn > byteCap && out.length > 0) break;
    out += b + '\n';
    bytes += bn + 1;
  }
  return out;
}

export async function standup(opts: StandupOptions): Promise<StandupResult> {
  const out = opts.out ?? process.stdout;
  // 7d default: a project rhythm window, not an "in the last few hours"
  // window. The byte cap controls volume; the window only decides which
  // sessions are recent enough to be worth surfacing.
  const windowMs = parseDuration(opts.since ?? '7d');
  const turnsPerSession = opts.turnsPerSession ?? 10;
  const bytesPerSession = opts.bytesPerSession ?? 1500;
  const totalBytes = opts.totalBytes ?? 60000;
  const maxSessions = opts.maxSessions ?? 80;
  const liveWindowMs = opts.liveSessionWindowMs ?? 60_000;
  const includeCurrent = opts.includeCurrent ?? false;

  const cutoff = Date.now() - windowMs;
  const claudeFiles = discoverSessionFiles();
  const codexFiles = discoverCodexSessionFiles();
  // No per-source cap here: standup is already time-windowed by mtime, so
  // Claude Code can't structurally crowd Codex out the way snap's flat
  // candidate slice did. Sort by mtime, drop everything below the cutoff
  // in the parse loop.
  const allFiles = [...claudeFiles, ...codexFiles].sort(
    (a, b) => b.modifiedTime.getTime() - a.modifiedTime.getTime()
  );

  type Kept = {
    cwd: string;
    sessionId: string;
    sourceType: 'claude-code' | 'codex';
    messages: Message[];
    lastMessageTime: Date;
  };

  const kept: Kept[] = [];
  for (const f of allFiles) {
    if (kept.length >= maxSessions) break;
    if (f.modifiedTime.getTime() < cutoff) {
      // mtime can be touched, but if it's well before the cutoff we can skip
      // the parse safely — content time is bounded above by mtime for append-only logs.
      continue;
    }
    const isCodex = f.sourceType === 'codex';
    const conv = isCodex ? parseCodexSessionFile(f.path) : parseSessionFile(f.path);
    if (conv.messages.length === 0) continue;
    const last = conv.messages[conv.messages.length - 1];
    // Window controls inclusion (did this session do anything recently?),
    // not which messages we surface. A session that drifted into the window
    // for a few messages should still get its full tail of context, even if
    // most of that tail predates the cutoff.
    if (last.timestamp.getTime() < cutoff) continue;
    if (!includeCurrent && Date.now() - last.timestamp.getTime() < liveWindowMs) continue;

    const tail = conv.messages.slice(-turnsPerSession);
    const cwd = f.cwd ?? readSessionCwd(f.path, f.project);
    kept.push({
      cwd,
      sessionId: conv.sessionId,
      sourceType: isCodex ? 'codex' : 'claude-code',
      messages: tail,
      lastMessageTime: last.timestamp,
    });
  }

  if (kept.length === 0) {
    return {
      windowMs,
      sessionsIncluded: 0,
      projects: [],
      promptBytes: 0,
      text: '',
      emitted: false,
    };
  }

  // Group by cwd, sessions newest-first within each project.
  const byCwd = new Map<string, Kept[]>();
  for (const k of kept) {
    const arr = byCwd.get(k.cwd) ?? [];
    arr.push(k);
    byCwd.set(k.cwd, arr);
  }
  for (const arr of byCwd.values()) {
    arr.sort((a, b) => b.lastMessageTime.getTime() - a.lastMessageTime.getTime());
  }

  // Assemble prompt body, project sections newest-activity-first.
  const projectSections = [...byCwd.entries()]
    .map(([cwd, sessions]) => ({
      cwd,
      sessions,
      mostRecent: Math.max(...sessions.map(s => s.lastMessageTime.getTime())),
    }))
    .sort((a, b) => b.mostRecent - a.mostRecent);

  const lines: string[] = [];
  let promptBytes = 0;
  const projectsMeta: StandupProjectMeta[] = [];

  for (const p of projectSections) {
    const header = `## ${p.cwd}\n`;
    let sectionBody = '';
    let sessionCount = 0;
    let messageCount = 0;

    for (const s of p.sessions) {
      const block = `--- session ${s.sessionId.slice(0, 8)} (last: ${s.lastMessageTime.toISOString()}) ---\n` +
        renderTail(s.messages, bytesPerSession);
      const blockBytes = Buffer.byteLength(block, 'utf-8');
      if (promptBytes + Buffer.byteLength(header, 'utf-8') + blockBytes > totalBytes && lines.length > 0) {
        break;
      }
      sectionBody += block + '\n';
      sessionCount += 1;
      messageCount += s.messages.length;
    }

    if (sessionCount === 0) continue;

    const section = header + sectionBody;
    const sectionBytes = Buffer.byteLength(section, 'utf-8');
    if (promptBytes + sectionBytes > totalBytes && lines.length > 0) break;

    lines.push(section);
    promptBytes += sectionBytes;
    projectsMeta.push({ cwd: p.cwd, sessionCount, messageCount });
  }

  const promptBody = lines.join('\n');

  const client = createOpenAI({
    apiKey: opts.apiKey,
    baseURL: opts.baseUrl || 'https://openrouter.ai/api/v1',
  });
  const model = client(opts.model || 'google/gemini-3-flash-preview');

  const result = await streamText({
    model,
    temperature: opts.temperature ?? 0.4,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: promptBody },
    ],
  });

  let text = '';
  for await (const chunk of result.textStream) {
    out.write(chunk);
    text += chunk;
  }
  out.write('\n');

  return {
    windowMs,
    sessionsIncluded: kept.length,
    projects: projectsMeta,
    promptBytes,
    text,
    emitted: true,
  };
}

// Used by the CLI to derive a short project label without re-importing path utils.
export const __internal = { basenameOf };
