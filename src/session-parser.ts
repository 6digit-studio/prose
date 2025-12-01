/**
 * Session Parser for Claude Code JSONL format
 *
 * Parses Claude Code session files and extracts structured conversation data
 * with temporal ordering and source links for provenance.
 */

import { readFileSync, readdirSync, existsSync, statSync, openSync, readSync, closeSync } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';

// ============================================================================
// Types
// ============================================================================

export interface SourceLink {
  sessionId: string;
  messageUuid: string;
  timestamp: Date;
  filePath: string;
}

export interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  source: SourceLink;
}

export interface Conversation {
  sessionId: string;
  project: string;
  messages: Message[];
  startTime: Date;
  endTime: Date;
}

export interface SessionFile {
  path: string;
  sessionId: string;
  project: string;
  modifiedTime: Date;
  /** File size in bytes (for fast append-only change detection) */
  fileSize: number;
}

// Raw JSONL line types (as they appear in the file)
interface RawUserMessage {
  type: 'user';
  message: {
    role: 'user';
    content: string | Array<{ type: string; text?: string; [key: string]: unknown }>;
  };
  uuid: string;
  timestamp: string;
  sessionId: string;
  cwd?: string;
  project?: string;
}

interface RawAssistantMessage {
  type: 'assistant';
  message: {
    role: 'assistant';
    content: Array<{ type: 'text'; text: string } | { type: 'tool_use'; [key: string]: unknown }>;
  };
  uuid: string;
  parentUuid: string;
  timestamp: string;
  sessionId: string;
}

interface RawFileHistorySnapshot {
  type: 'file-history-snapshot';
  [key: string]: unknown;
}

type RawLine = RawUserMessage | RawAssistantMessage | RawFileHistorySnapshot;

// ============================================================================
// Discovery
// ============================================================================

/**
 * Get the Claude projects directory path
 */
export function getClaudeProjectsDir(): string {
  return join(homedir(), '.claude', 'projects');
}

/**
 * Discover all session files for a given project
 */
export function discoverSessionFiles(projectPath?: string): SessionFile[] {
  const projectsDir = getClaudeProjectsDir();

  if (!existsSync(projectsDir)) {
    return [];
  }

  const sessionFiles: SessionFile[] = [];
  const projectDirs = readdirSync(projectsDir, { withFileTypes: true })
    .filter(d => d.isDirectory());

  for (const projectDir of projectDirs) {
    // Project dirs are named like: -Users-larsde-src-koru
    const projectDirPath = join(projectsDir, projectDir.name);

    // If a specific project path is given, filter to match
    if (projectPath) {
      const normalizedProjectPath = projectPath.replace(/\//g, '-').replace(/^-/, '');
      const dirName = projectDir.name.replace(/^-/, '');

      // Exact match (full path) or exact project name match (ends with -projectname)
      const isExactMatch = dirName === normalizedProjectPath;
      const isProjectNameMatch = dirName.endsWith(`-${normalizedProjectPath}`) ||
                                  dirName === normalizedProjectPath;

      if (!isExactMatch && !isProjectNameMatch) {
        continue;
      }
    }

    const files = readdirSync(projectDirPath, { withFileTypes: true })
      .filter(f => f.isFile() && f.name.endsWith('.jsonl') && !f.name.startsWith('agent-'));

    for (const file of files) {
      const filePath = join(projectDirPath, file.name);
      const stats = statSync(filePath);

      sessionFiles.push({
        path: filePath,
        sessionId: file.name.replace('.jsonl', ''),
        project: projectDir.name,
        modifiedTime: stats.mtime,
        fileSize: stats.size,
      });
    }
  }

  // Sort by modification time, newest first
  return sessionFiles.sort((a, b) => b.modifiedTime.getTime() - a.modifiedTime.getTime());
}

// ============================================================================
// Parsing
// ============================================================================

/**
 * Extract text content from message content (handles both string and array formats)
 */
function extractTextContent(content: string | Array<{ type: string; text?: string; [key: string]: unknown }>): string {
  // If it's already a string, return it
  if (typeof content === 'string') {
    return content;
  }

  // If it's an array, extract text blocks
  if (Array.isArray(content)) {
    return content
      .filter((block): block is { type: 'text'; text: string } =>
        block.type === 'text' && typeof block.text === 'string'
      )
      .map(block => block.text)
      .join('\n\n');
  }

  return '';
}

/**
 * Parse a single session file into a Conversation
 */
export function parseSessionFile(filePath: string): Conversation {
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.trim().split('\n').filter(line => line.trim());

  const messages: Message[] = [];
  let sessionId = '';
  let project = '';

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as RawLine;

      // Skip file history snapshots
      if (parsed.type === 'file-history-snapshot') {
        continue;
      }

      // Extract session metadata from first valid message
      if (!sessionId && 'sessionId' in parsed) {
        sessionId = parsed.sessionId;
      }
      if (!project && 'cwd' in parsed && parsed.cwd) {
        project = parsed.cwd;
      }

      if (parsed.type === 'user') {
        const text = extractTextContent(parsed.message.content);
        if (text.trim()) {  // Only include if there's actual text content
          messages.push({
            role: 'user',
            content: text,
            timestamp: new Date(parsed.timestamp),
            source: {
              sessionId: parsed.sessionId,
              messageUuid: parsed.uuid,
              timestamp: new Date(parsed.timestamp),
              filePath,
            },
          });
        }
      } else if (parsed.type === 'assistant') {
        const text = extractTextContent(parsed.message.content);
        if (text.trim()) {  // Only include if there's actual text content
          messages.push({
            role: 'assistant',
            content: text,
            timestamp: new Date(parsed.timestamp),
            source: {
              sessionId: parsed.sessionId,
              messageUuid: parsed.uuid,
              timestamp: new Date(parsed.timestamp),
              filePath,
            },
          });
        }
      }
    } catch (e) {
      // Skip malformed lines
      continue;
    }
  }

  // Sort by timestamp
  messages.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  return {
    sessionId: sessionId || basename(filePath, '.jsonl'),
    project,
    messages,
    startTime: messages[0]?.timestamp || new Date(),
    endTime: messages[messages.length - 1]?.timestamp || new Date(),
  };
}

/**
 * Parse only NEW content from a session file, starting from a byte offset.
 * For append-only JSONL files, this reads only the bytes added since last processing.
 */
export function parseSessionFileFromOffset(
  filePath: string,
  startOffset: number,
  existingSessionId?: string,
  existingProject?: string
): Message[] {
  const stats = statSync(filePath);
  if (startOffset >= stats.size) {
    return []; // No new content
  }

  // Read only new bytes
  const fd = openSync(filePath, 'r');
  const buffer = Buffer.alloc(stats.size - startOffset);
  readSync(fd, buffer, 0, buffer.length, startOffset);
  closeSync(fd);

  const content = buffer.toString('utf-8');
  const lines = content.split('\n').filter(line => line.trim());

  // First line might be partial if we seeked mid-line, so try to parse and skip if invalid
  const messages: Message[] = [];
  let sessionId = existingSessionId || '';
  let project = existingProject || '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    try {
      const parsed = JSON.parse(line) as RawLine;

      if (parsed.type === 'file-history-snapshot') continue;

      if (!sessionId && 'sessionId' in parsed) sessionId = parsed.sessionId;
      if (!project && 'cwd' in parsed && parsed.cwd) project = parsed.cwd;

      if (parsed.type === 'user') {
        const text = extractTextContent(parsed.message.content);
        if (text.trim()) {
          messages.push({
            role: 'user',
            content: text,
            timestamp: new Date(parsed.timestamp),
            source: {
              sessionId: parsed.sessionId,
              messageUuid: parsed.uuid,
              timestamp: new Date(parsed.timestamp),
              filePath,
            },
          });
        }
      } else if (parsed.type === 'assistant') {
        const text = extractTextContent(parsed.message.content);
        if (text.trim()) {
          messages.push({
            role: 'assistant',
            content: text,
            timestamp: new Date(parsed.timestamp),
            source: {
              sessionId: parsed.sessionId,
              messageUuid: parsed.uuid,
              timestamp: new Date(parsed.timestamp),
              filePath,
            },
          });
        }
      }
    } catch (e) {
      // Skip malformed lines (including partial first line from seeking)
      continue;
    }
  }

  messages.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  return messages;
}

/**
 * Parse multiple session files, optionally filtering by date range
 */
export function parseSessions(options: {
  projectPath?: string;
  since?: Date;
  until?: Date;
  limit?: number;
}): Conversation[] {
  const sessionFiles = discoverSessionFiles(options.projectPath);

  let filtered = sessionFiles;

  if (options.since) {
    filtered = filtered.filter(f => f.modifiedTime >= options.since!);
  }
  if (options.until) {
    filtered = filtered.filter(f => f.modifiedTime <= options.until!);
  }
  if (options.limit) {
    filtered = filtered.slice(0, options.limit);
  }

  return filtered.map(f => parseSessionFile(f.path));
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Format a conversation as readable text (for debugging/preview)
 */
export function formatConversation(conversation: Conversation): string {
  const lines: string[] = [
    `# Session: ${conversation.sessionId}`,
    `Project: ${conversation.project}`,
    `Time: ${conversation.startTime.toISOString()} - ${conversation.endTime.toISOString()}`,
    `Messages: ${conversation.messages.length}`,
    '',
    '---',
    '',
  ];

  for (const msg of conversation.messages) {
    const role = msg.role === 'user' ? '**User**' : '**Claude**';
    const time = msg.timestamp.toLocaleTimeString();
    lines.push(`${role} (${time}):`);
    lines.push(msg.content.slice(0, 500) + (msg.content.length > 500 ? '...' : ''));
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Get statistics about available sessions
 */
export function getSessionStats(projectPath?: string): {
  totalSessions: number;
  totalMessages: number;
  projects: string[];
  dateRange: { earliest: Date | null; latest: Date | null };
} {
  const sessionFiles = discoverSessionFiles(projectPath);
  const projects = [...new Set(sessionFiles.map(f => f.project))];

  let totalMessages = 0;
  let earliest: Date | null = null;
  let latest: Date | null = null;

  for (const file of sessionFiles) {
    const conversation = parseSessionFile(file.path);
    totalMessages += conversation.messages.length;

    if (!earliest || conversation.startTime < earliest) {
      earliest = conversation.startTime;
    }
    if (!latest || conversation.endTime > latest) {
      latest = conversation.endTime;
    }
  }

  return {
    totalSessions: sessionFiles.length,
    totalMessages,
    projects,
    dateRange: { earliest, latest },
  };
}
