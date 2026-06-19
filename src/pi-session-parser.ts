/**
 * Session Parser for pi coding-agent sessions (badlogic/pi-mono).
 *
 * pi writes one JSONL file per session under
 *   ~/.pi/agent/sessions/<project-slug>/<timestamp>_<uuid>.jsonl
 *
 * The format is the cleanest of all the harnesses prose reads: a `session`
 * header line carries the cwd directly, and each `message` line carries a
 * stable id, an ISO timestamp, and a `message.content` block array. We extract
 * only `text` blocks — thinking, toolCall, and toolResult blocks are noise for
 * semantic memory, matching how the Codex/Claude Code parsers drop tool dumps.
 */

import { readFileSync, readdirSync, existsSync, statSync, openSync, readSync, closeSync, type Dirent } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';
import type { Message, SessionFile, Conversation } from './session-parser.js';
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

/** Read the first line of a pi session file to recover its id and cwd. */
function readPiMeta(filePath: string): { sessionId: string; cwd?: string } | null {
  try {
    const stats = statSync(filePath);
    const fd = openSync(filePath, 'r');
    const maxBytes = Math.min(stats.size, 512 * 1024);
    const chunks: Buffer[] = [];
    let offset = 0;

    try {
      while (offset < maxBytes) {
        const toRead = Math.min(4096, maxBytes - offset);
        const buffer = Buffer.alloc(toRead);
        const bytesRead = readSync(fd, buffer, 0, toRead, offset);
        if (bytesRead <= 0) break;

        const slice = buffer.subarray(0, bytesRead);
        const newlineIndex = slice.indexOf(10);
        if (newlineIndex !== -1) {
          chunks.push(slice.subarray(0, newlineIndex));
          break;
        }

        chunks.push(slice);
        offset += bytesRead;
        if (bytesRead < toRead) break;
      }
    } finally {
      closeSync(fd);
    }

    if (chunks.length === 0) return null;

    const line = Buffer.concat(chunks).toString('utf-8').trim();
    if (!line) return null;

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

function parsePiJsonlBuffer(
  buffer: Buffer,
  filePath: string,
  startOffset: number,
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
    project: project || 'pi',
  };
}

// ============================================================================
// Discovery
// ============================================================================

export function getPiSessionsDir(): string {
  return join(homedir(), '.pi', 'agent', 'sessions');
}

/**
 * Discover all pi session files, optionally filtered to a project.
 */
export function discoverPiSessionFiles(projectPath?: string): SessionFile[] {
  const sessionsDir = getPiSessionsDir();
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
        project: projectName || 'pi',
        modifiedTime: stats.mtime,
        fileSize: stats.size,
        sourceType: 'pi',
        cwd: meta.cwd,
      });
    }
  }

  return sessionFiles.sort((a, b) => b.modifiedTime.getTime() - a.modifiedTime.getTime());
}

// ============================================================================
// Parsing
// ============================================================================

export function parsePiSessionFile(filePath: string): Conversation {
  const content = readFileSync(filePath, 'utf-8');
  const buffer = Buffer.from(content, 'utf-8');
  const parsed = parsePiJsonlBuffer(buffer, filePath, 0);

  return {
    sessionId: parsed.sessionId,
    project: parsed.project,
    messages: parsed.messages,
    startTime: parsed.messages[0]?.timestamp || new Date(),
    endTime: parsed.messages[parsed.messages.length - 1]?.timestamp || new Date(),
    processedBytes: parsed.processedBytes,
    sourceType: 'pi',
  };
}

export function parsePiSessionFileFromOffset(
  filePath: string,
  startOffset: number,
  existingSessionId?: string,
  existingProject?: string
): { messages: Message[]; processedBytes: number } {
  const stats = statSync(filePath);
  if (startOffset >= stats.size) {
    return { messages: [], processedBytes: startOffset };
  }

  const fd = openSync(filePath, 'r');
  const buffer = Buffer.alloc(stats.size - startOffset);
  readSync(fd, buffer, 0, buffer.length, startOffset);
  closeSync(fd);

  const parsed = parsePiJsonlBuffer(buffer, filePath, startOffset, existingSessionId, existingProject);
  return { messages: parsed.messages, processedBytes: parsed.processedBytes };
}
