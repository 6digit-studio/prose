/**
 * Session Parser for Codex CLI sessions
 *
 * Supports both JSON (legacy) and JSONL (current) session formats.
 */

import { readFileSync, readdirSync, existsSync, statSync, openSync, readSync, closeSync, type Dirent } from 'fs';
import { join, basename, extname } from 'path';
import { homedir } from 'os';
import type { Message, SessionFile, Conversation } from './session-parser.js';
import { sanitizePath } from './memory.js';

type CodexRole = 'user' | 'assistant' | 'developer' | 'system';

const CODEX_EXTENSIONS = new Set(['.json', '.jsonl']);

function getCodexProjectName(cwd?: string): string | null {
  if (!cwd || typeof cwd !== 'string') return null;
  return `-${sanitizePath(cwd)}`;
}

function matchesProjectFilter(projectName: string, projectPath: string): boolean {
  const normalizedProjectPath = sanitizePath(projectPath);
  const normalizedProjectName = projectName.replace(/^-/, '');
  return normalizedProjectName === normalizedProjectPath ||
    normalizedProjectName.endsWith(`-${normalizedProjectPath}`);
}

function extractTextFromBlocks(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  return content
    .map(block => {
      if (!block || typeof block !== 'object') return '';
      const maybeText = (block as { text?: unknown }).text;
      return typeof maybeText === 'string' ? maybeText : '';
    })
    .filter(Boolean)
    .join('\n\n');
}

function readCodexJsonlMeta(filePath: string): { sessionId: string; cwd?: string } | null {
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

    const parsed = JSON.parse(line) as { type?: string; payload?: { id?: string; cwd?: string } };
    if (parsed.type !== 'session_meta') return null;

    return {
      sessionId: parsed.payload?.id || basename(filePath, '.jsonl'),
      cwd: parsed.payload?.cwd,
    };
  } catch {
    return null;
  }
}

function readCodexJsonMeta(filePath: string): { sessionId: string; cwd?: string } | null {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(content) as { session?: { id?: string; cwd?: string } };
    return {
      sessionId: parsed.session?.id || basename(filePath, '.json'),
      cwd: parsed.session?.cwd,
    };
  } catch {
    return null;
  }
}

function parseCodexJsonlBuffer(
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
          timestamp?: string;
          type?: string;
          payload?: {
            type?: string;
            role?: CodexRole;
            content?: unknown;
            id?: string;
            cwd?: string;
          };
        };

        if (parsed.type === 'session_meta') {
          if (parsed.payload?.id) sessionId = parsed.payload.id;
          if (parsed.payload?.cwd) {
            const derived = getCodexProjectName(parsed.payload.cwd);
            if (derived) project = derived;
          }
        } else if (parsed.type === 'turn_context' && parsed.payload?.cwd && !project) {
          const derived = getCodexProjectName(parsed.payload.cwd);
          if (derived) project = derived;
        } else if (parsed.type === 'response_item' && parsed.payload?.type === 'message') {
          const role = parsed.payload.role;
          if (role === 'user' || role === 'assistant') {
            const text = extractTextFromBlocks(parsed.payload.content);
            if (text.trim()) {
              const timestamp = parsed.timestamp ? new Date(parsed.timestamp) : new Date();
              const stableSessionId = sessionId || basename(filePath, '.jsonl');
              messages.push({
                role,
                content: text,
                timestamp,
                source: {
                  sessionId: stableSessionId,
                  messageUuid: `${stableSessionId}:${lineOffset}`,
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
    project: project || 'codex',
  };
}

function parseCodexJson(filePath: string): Conversation {
  const content = readFileSync(filePath, 'utf-8');
  const buffer = Buffer.from(content, 'utf-8');
  const parsed = JSON.parse(content) as {
    session?: { id?: string; timestamp?: string; cwd?: string };
    items?: Array<{ type?: string; role?: CodexRole; content?: unknown }>;
  };

  const sessionId = parsed.session?.id || basename(filePath, '.json');
  const project = getCodexProjectName(parsed.session?.cwd) || 'codex';
  const baseTimestamp = parsed.session?.timestamp ? new Date(parsed.session.timestamp) : statSync(filePath).mtime;

  const messages: Message[] = [];
  let messageIndex = 0;

  for (const item of parsed.items || []) {
    if (item.type !== 'message') continue;
    if (item.role !== 'user' && item.role !== 'assistant') continue;

    const text = extractTextFromBlocks(item.content);
    if (!text.trim()) continue;

    const timestamp = new Date(baseTimestamp.getTime() + messageIndex * 1000);
    messages.push({
      role: item.role,
      content: text,
      timestamp,
      source: {
        sessionId,
        messageUuid: `${sessionId}:${messageIndex}`,
        timestamp,
        filePath,
      },
    });
    messageIndex += 1;
  }

  return {
    sessionId,
    project,
    messages,
    startTime: messages[0]?.timestamp || baseTimestamp,
    endTime: messages[messages.length - 1]?.timestamp || baseTimestamp,
    processedBytes: buffer.length,
  };
}

function parseCodexJsonl(filePath: string): Conversation {
  const content = readFileSync(filePath, 'utf-8');
  const buffer = Buffer.from(content, 'utf-8');
  const parsed = parseCodexJsonlBuffer(buffer, filePath, 0);

  return {
    sessionId: parsed.sessionId,
    project: parsed.project,
    messages: parsed.messages,
    startTime: parsed.messages[0]?.timestamp || new Date(),
    endTime: parsed.messages[parsed.messages.length - 1]?.timestamp || new Date(),
    processedBytes: parsed.processedBytes,
  };
}

// ============================================================================
// Discovery
// ============================================================================

export function getCodexSessionsDir(): string {
  return join(homedir(), '.codex', 'sessions');
}

/**
 * Discover all Codex session files for a given project.
 */
export function discoverCodexSessionFiles(projectPath?: string): SessionFile[] {
  const sessionsDir = getCodexSessionsDir();
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

      const extension = extname(entry.name);
      if (!CODEX_EXTENSIONS.has(extension)) continue;

      const stats = statSync(entryPath);
      const meta = extension === '.jsonl' ? readCodexJsonlMeta(entryPath) : readCodexJsonMeta(entryPath);
      if (!meta) continue;

      const projectName = meta.cwd ? getCodexProjectName(meta.cwd) : null;
      if (projectPath) {
        if (!projectName) continue;
        if (!matchesProjectFilter(projectName, projectPath)) continue;
      }

      sessionFiles.push({
        path: entryPath,
        sessionId: meta.sessionId,
        project: projectName || 'codex',
        modifiedTime: stats.mtime,
        fileSize: stats.size,
        sourceType: 'codex',
        cwd: meta.cwd,
      });
    }
  }

  return sessionFiles.sort((a, b) => b.modifiedTime.getTime() - a.modifiedTime.getTime());
}

// ============================================================================
// Parsing
// ============================================================================

export function parseCodexSessionFile(filePath: string): Conversation {
  const extension = extname(filePath);
  if (extension === '.jsonl') {
    return parseCodexJsonl(filePath);
  }
  return parseCodexJson(filePath);
}

export function parseCodexSessionFileFromOffset(
  filePath: string,
  startOffset: number,
  existingSessionId?: string,
  existingProject?: string
): { messages: Message[]; processedBytes: number } {
  const extension = extname(filePath);
  if (extension !== '.jsonl') {
    return { messages: [], processedBytes: startOffset };
  }

  const stats = statSync(filePath);
  if (startOffset >= stats.size) {
    return { messages: [], processedBytes: startOffset };
  }

  const fd = openSync(filePath, 'r');
  const buffer = Buffer.alloc(stats.size - startOffset);
  readSync(fd, buffer, 0, buffer.length, startOffset);
  closeSync(fd);

  const parsed = parseCodexJsonlBuffer(buffer, filePath, startOffset, existingSessionId, existingProject);
  return { messages: parsed.messages, processedBytes: parsed.processedBytes };
}
