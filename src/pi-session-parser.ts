/**
 * Session Parser for pi coding-agent sessions (badlogic/pi-mono) and for omp,
 * the pi descendant Lars runs as `omp`.
 *
 * Both harnesses write one JSONL file per session, in the same `version: 3`
 * format, under a per-harness root:
 *   ~/.pi/agent/sessions/<project-slug>/<timestamp>_<uuid>.jsonl
 *   ~/.omp/agent/sessions/<project-slug>/<timestamp>_<uuid>.jsonl
 * so one parser serves both; only the root dir and the stamped `sourceType`
 * differ.
 *
 * The format is the cleanest of all the harnesses prose reads: a `session`
 * header line carries the cwd directly, and each `message` line carries a
 * stable id, an ISO timestamp, and a `message.content` block array. We extract
 * only `text` blocks — thinking, toolCall, and toolResult blocks are noise for
 * semantic memory, matching how the Codex/Claude Code parsers drop tool dumps.
 *
 * One delta between the two: pi always writes the `session` header on line 1,
 * omp may emit a `{"type":"title",...}` line ahead of it. So we scan for the
 * header rather than assuming it is the first line.
 */

import { readFileSync, readdirSync, existsSync, statSync, openSync, readSync, closeSync, type Dirent } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';
import type { Message, SessionFile, Conversation, SourceType } from './session-parser.js';
import { sanitizePath } from './memory.js';

type PiRole = 'user' | 'assistant' | 'system';

function getPiProjectName(cwd?: string): string | null {
  if (!cwd || typeof cwd !== 'string') return null;
  return `-${sanitizePath(cwd)}`;
}

function matchesProjectFilter(projectName: string, projectPath: string): boolean {
  const normalizedProjectPath = sanitizePath(projectPath);
  const normalizedProjectName = projectName.replace(/^-/, '');
  return normalizedProjectName === normalizedProjectPath ||
    normalizedProjectName.endsWith(`-${normalizedProjectPath}`);
}

/**
 * Extract visible text from a pi content array. Only `{type:'text', text}`
 * blocks survive; thinking/toolCall/toolResult blocks are excluded.
 */
function extractTextFromBlocks(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  return content
    .map((block) => {
      if (!block || typeof block !== 'object') return '';
      const b = block as { type?: unknown; text?: unknown };
      if (b.type !== 'text') return '';
      return typeof b.text === 'string' ? b.text : '';
    })
    .filter(Boolean)
    .join('\n\n');
}

/** Parse one JSONL line, yielding session meta only if it is the header line. */
function readSessionHeaderLine(
  lineBuffer: Buffer,
  filePath: string
): { sessionId: string; cwd?: string } | null {
  const line = lineBuffer.toString('utf-8').trim();
  if (!line) return null;
  try {
    const parsed = JSON.parse(line) as { type?: string; id?: string; cwd?: string };
    if (parsed.type !== 'session') return null;
    return {
      sessionId: parsed.id || basename(filePath, '.jsonl'),
      cwd: parsed.cwd,
    };
  } catch {
    return null;
  }
}

/**
 * Scan the head of a session file for its `session` header to recover id and
 * cwd. pi puts the header on line 1; omp may precede it with a `title` line,
 * so we walk lines until we hit it, bounded by the same 512 KiB head window.
 */
function readPiMeta(filePath: string): { sessionId: string; cwd?: string } | null {
  try {
    const stats = statSync(filePath);
    const fd = openSync(filePath, 'r');
    const maxBytes = Math.min(stats.size, 512 * 1024);
    let pending = Buffer.alloc(0);
    let offset = 0;

    try {
      while (offset < maxBytes) {
        const toRead = Math.min(4096, maxBytes - offset);
        const buffer = Buffer.alloc(toRead);
        const bytesRead = readSync(fd, buffer, 0, toRead, offset);
        if (bytesRead <= 0) break;
        offset += bytesRead;

        const slice = buffer.subarray(0, bytesRead);
        pending = pending.length === 0 ? slice : Buffer.concat([pending, slice]);

        let newlineIndex = pending.indexOf(10);
        while (newlineIndex !== -1) {
          const meta = readSessionHeaderLine(pending.subarray(0, newlineIndex), filePath);
          if (meta) return meta;
          pending = pending.subarray(newlineIndex + 1);
          newlineIndex = pending.indexOf(10);
        }

        if (bytesRead < toRead) break;
      }

      // Trailing line with no terminating newline (single-line file).
      return readSessionHeaderLine(pending, filePath);
    } finally {
      closeSync(fd);
    }
  } catch {
    return null;
  }
}

function parsePiJsonlBuffer(
  buffer: Buffer,
  filePath: string,
  startOffset: number,
  sourceType: SourceType,
  existingSessionId?: string,
  existingProject?: string
): { messages: Message[]; processedBytes: number; sessionId: string; project: string } {
  const messages: Message[] = [];
  let sessionId = existingSessionId || '';
  let project = existingProject || '';
  let lastSuccessfulOffset = startOffset;
  let currentOffset = 0;

  while (currentOffset < buffer.length) {
    let nextNewline = buffer.indexOf(10, currentOffset);
    if (nextNewline === -1) nextNewline = buffer.length;

    const lineBuffer = buffer.subarray(currentOffset, nextNewline);
    const line = lineBuffer.toString('utf-8').trim();
    const lineOffset = startOffset + currentOffset;

    if (line) {
      try {
        const parsed = JSON.parse(line) as {
          type?: string;
          timestamp?: string;
          id?: string;
          cwd?: string;
          message?: {
            role?: PiRole;
            content?: unknown;
          };
        };

        if (parsed.type === 'session') {
          if (parsed.id) sessionId = parsed.id;
          if (parsed.cwd) {
            const derived = getPiProjectName(parsed.cwd);
            if (derived) project = derived;
          }
        } else if (parsed.type === 'message' && parsed.message) {
          const role = parsed.message.role;
          if (role === 'user' || role === 'assistant') {
            const text = extractTextFromBlocks(parsed.message.content);
            if (text.trim()) {
              const timestamp = parsed.timestamp ? new Date(parsed.timestamp) : new Date();
              const stableSessionId = sessionId || basename(filePath, '.jsonl');
              messages.push({
                role,
                content: text,
                timestamp,
                source: {
                  sessionId: stableSessionId,
                  messageUuid: parsed.id || `${stableSessionId}:${lineOffset}`,
                  timestamp,
                  filePath,
                },
              });
            }
          }
        }

        lastSuccessfulOffset = startOffset + (nextNewline === buffer.length ? buffer.length : nextNewline + 1);
      } catch {
        break;
      }
    } else {
      lastSuccessfulOffset = startOffset + (nextNewline === buffer.length ? buffer.length : nextNewline + 1);
    }

    currentOffset = nextNewline + 1;
  }

  messages.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  return {
    messages,
    processedBytes: lastSuccessfulOffset,
    sessionId: sessionId || basename(filePath, '.jsonl'),
    project: project || sourceType,
  };
}

// ============================================================================
// Discovery
// ============================================================================

export function getPiSessionsDir(): string {
  return join(homedir(), '.pi', 'agent', 'sessions');
}

export function getOmpSessionsDir(): string {
  return join(homedir(), '.omp', 'agent', 'sessions');
}

/**
 * Walk one harness root for session files. pi and omp share this body; only
 * the root and the stamped `sourceType` differ. A missing root is a silent
 * no-op — not every machine runs both harnesses.
 */
function discoverSessionFilesUnder(
  sessionsDir: string,
  sourceType: SourceType,
  projectPath?: string
): SessionFile[] {
  if (!existsSync(sessionsDir)) return [];

  const sessionFiles: SessionFile[] = [];
  const stack = [sessionsDir];

  while (stack.length > 0) {
    const currentDir = stack.pop()!;
    let entries: Dirent[];
    try {
      entries = readdirSync(currentDir, { withFileTypes: true }) as Dirent[];
    } catch {
      continue;
    }

    for (const entry of entries) {
      const entryPath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith('.jsonl')) continue;

      const meta = readPiMeta(entryPath);
      if (!meta) continue;

      const stats = statSync(entryPath);
      const projectName = meta.cwd ? getPiProjectName(meta.cwd) : null;
      if (projectPath) {
        if (!projectName) continue;
        if (!matchesProjectFilter(projectName, projectPath)) continue;
      }

      sessionFiles.push({
        path: entryPath,
        sessionId: meta.sessionId,
        project: projectName || sourceType,
        modifiedTime: stats.mtime,
        fileSize: stats.size,
        sourceType,
        cwd: meta.cwd,
      });
    }
  }

  return sessionFiles.sort((a, b) => b.modifiedTime.getTime() - a.modifiedTime.getTime());
}

/**
 * Discover all pi session files, optionally filtered to a project.
 */
export function discoverPiSessionFiles(projectPath?: string): SessionFile[] {
  return discoverSessionFilesUnder(getPiSessionsDir(), 'pi', projectPath);
}

/**
 * Discover all omp session files, optionally filtered to a project.
 */
export function discoverOmpSessionFiles(projectPath?: string): SessionFile[] {
  return discoverSessionFilesUnder(getOmpSessionsDir(), 'omp', projectPath);
}

// ============================================================================
// Parsing
// ============================================================================

/**
 * Parse a pi-format session file. `sourceType` names which harness wrote it —
 * the on-disk format is identical, so it only rides through to the returned
 * Conversation and the project fallback.
 */
export function parsePiSessionFile(filePath: string, sourceType: SourceType = 'pi'): Conversation {
  const content = readFileSync(filePath, 'utf-8');
  const buffer = Buffer.from(content, 'utf-8');
  const parsed = parsePiJsonlBuffer(buffer, filePath, 0, sourceType);

  return {
    sessionId: parsed.sessionId,
    project: parsed.project,
    messages: parsed.messages,
    startTime: parsed.messages[0]?.timestamp || new Date(),
    endTime: parsed.messages[parsed.messages.length - 1]?.timestamp || new Date(),
    processedBytes: parsed.processedBytes,
    sourceType,
  };
}

export function parsePiSessionFileFromOffset(
  filePath: string,
  startOffset: number,
  existingSessionId?: string,
  existingProject?: string,
  sourceType: SourceType = 'pi'
): { messages: Message[]; processedBytes: number } {
  const stats = statSync(filePath);
  if (startOffset >= stats.size) {
    return { messages: [], processedBytes: startOffset };
  }

  const fd = openSync(filePath, 'r');
  const buffer = Buffer.alloc(stats.size - startOffset);
  readSync(fd, buffer, 0, buffer.length, startOffset);
  closeSync(fd);

  const parsed = parsePiJsonlBuffer(buffer, filePath, startOffset, sourceType, existingSessionId, existingProject);
  return { messages: parsed.messages, processedBytes: parsed.processedBytes };
}
