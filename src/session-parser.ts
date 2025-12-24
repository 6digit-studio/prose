/**
 * Session Parser for Claude Code JSONL format
 *
 * Parses Claude Code session files and extracts structured conversation data
 * with temporal ordering and source links for provenance.
 */

import { readFileSync, readdirSync, existsSync, statSync, openSync, readSync, closeSync } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';
import {
  loadProjectMemory,
  saveProjectMemory,
  createProjectMemory,
  updateProjectMemory,
  updateCurrentFragments,
  sessionNeedsProcessing,
  sessionNeedsProcessingFast,
  getSessionProcessingState,
  searchMemory,
  getMemoryStats,
  getMemoryDir,
  generateContextMarkdown,
  writeContextFile,
  writeVerbatimSessionArtifact,
  sanitizePath,
} from './memory.js';

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
  processedBytes: number;
}

export type SourceType = 'claude-code' | 'git' | 'antigravity';

export interface SessionFile {
  path: string;
  sessionId: string;
  project: string;
  modifiedTime: Date;
  /** File size in bytes (for fast append-only change detection) */
  fileSize: number;
  /** Type of source */
  sourceType?: SourceType;
}

// Raw JSONL line types (as they appear in the file)
interface RawUserMessage {
  type: 'user';
  message: {
    role: 'user';
    content: string | Array<{ type: string; text?: string;[key: string]: unknown }>;
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
    content: Array<{ type: 'text'; text: string } | { type: 'tool_use';[key: string]: unknown }>;
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
 * Discover all session files for a given project.
 * If currentCwd is provided, it will also scan for recent sessions in other project directories
 * where the internal CWD matches (to catch sessions misappropriated by Claude Code).
 */
export function discoverSessionFiles(projectPath?: string, currentCwd?: string): SessionFile[] {
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
      const normalizedProjectPath = sanitizePath(projectPath);
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
      .filter(f => f.isFile() && f.name.endsWith('.jsonl'));

    for (const file of files) {
      const filePath = join(projectDirPath, file.name);
      const stats = statSync(filePath);

      sessionFiles.push({
        path: filePath,
        sessionId: file.name.replace('.jsonl', ''),
        project: projectDir.name,
        modifiedTime: stats.mtime,
        fileSize: stats.size,
        sourceType: 'claude-code',
      });
    }

    // Optimization: If we found no matches in this directory, but it's NOT the primary projectFilter's directory,
    // we could skip scanning if currentCwd is provided. But for now, we scan all dirs if currentCwd is provided.
  }

  // CWD-based secondary discovery (Digital Archaeology of misfiled sessions)
  if (currentCwd) {
    const twelveHoursAgo = Date.now() - 12 * 60 * 60 * 1000;

    for (const projectDir of projectDirs) {
      const projectDirPath = join(projectsDir, projectDir.name);

      // If we already searched this as the primary projectPath, skip it here
      if (projectPath) {
        const normalizedProjectPath = sanitizePath(projectPath);
        if (projectDir.name.replace(/^-/, '') === normalizedProjectPath) continue;
      }

      const files = readdirSync(projectDirPath, { withFileTypes: true })
        .filter(f => f.isFile() && f.name.endsWith('.jsonl'));

      for (const file of files) {
        const filePath = join(projectDirPath, file.name);
        const stats = statSync(filePath);

        // Only scan RECENT files in other directories (to keep it fast)
        if (stats.mtime.getTime() < twelveHoursAgo) continue;

        // Skip if we already found this session via primary scan (shouldn't happen with above skip but safe)
        if (sessionFiles.some(sf => sf.path === filePath)) continue;

        try {
          // Peek at the first few lines to find 'cwd'
          const fd = openSync(filePath, 'r');
          const buffer = Buffer.alloc(4096); // Read first 4KB
          readSync(fd, buffer, 0, buffer.length, 0);
          closeSync(fd);

          const content = buffer.toString('utf-8');
          const firstLine = content.split('\n')[0];
          if (firstLine && firstLine.includes(currentCwd)) {
            sessionFiles.push({
              path: filePath,
              sessionId: file.name.replace('.jsonl', ''),
              project: projectDir.name,
              modifiedTime: stats.mtime,
              fileSize: stats.size,
              sourceType: 'claude-code',
            });
          }
        } catch (e) {
          // Error reading/peeking, skip
        }
      }
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
function extractTextContent(content: string | Array<{ type: string; text?: string;[key: string]: unknown }>): string {
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
  const buffer = Buffer.from(content, 'utf-8');

  // We need to track exact byte offsets for append-only partial line safety.
  // Instead of simple split('\n'), we'll find newlines and track offsets.
  const messages: Message[] = [];
  let sessionId = '';
  let project = '';
  let lastSuccessfulOffset = 0;
  let currentOffset = 0;

  while (currentOffset < buffer.length) {
    let nextNewline = buffer.indexOf(10, currentOffset); // 10 is '\n'
    if (nextNewline === -1) nextNewline = buffer.length;

    const lineBuffer = buffer.subarray(currentOffset, nextNewline);
    const line = lineBuffer.toString('utf-8').trim();

    if (line) {
      try {
        const parsed = JSON.parse(line) as RawLine;

        // If we got here, it's valid JSON.
        // Process the line as before...
        if (parsed.type !== 'file-history-snapshot') {
          if (!sessionId && 'sessionId' in parsed) sessionId = parsed.sessionId;
          if (!project && 'cwd' in parsed && parsed.cwd) project = parsed.cwd;

          if (parsed.type === 'user') {
            const text = extractTextContent(parsed.message.content);
            if (text.trim()) {
              messages.push({
                role: 'user',
                content: text,
                timestamp: new Date(parsed.timestamp),
                source: { sessionId: parsed.sessionId, messageUuid: parsed.uuid, timestamp: new Date(parsed.timestamp), filePath },
              });
            }
          } else if (parsed.type === 'assistant') {
            const text = extractTextContent(parsed.message.content);
            if (text.trim()) {
              messages.push({
                role: 'assistant',
                content: text,
                timestamp: new Date(parsed.timestamp),
                source: { sessionId: parsed.sessionId, messageUuid: parsed.uuid, timestamp: new Date(parsed.timestamp), filePath },
              });
            }
          }
        }

        // Mark this line as successfully processed
        lastSuccessfulOffset = nextNewline === buffer.length ? buffer.length : nextNewline + 1;
      } catch (e) {
        // Malformed line - likely partial. Stop parsing here to prevent skipping it permanently.
        break;
      }
    } else {
      // Empty line - just skip and move past the newline
      lastSuccessfulOffset = nextNewline === buffer.length ? buffer.length : nextNewline + 1;
    }
    currentOffset = nextNewline + 1;
  }

  // Sort by timestamp
  messages.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  return {
    sessionId: sessionId || basename(filePath, '.jsonl'),
    project,
    messages,
    startTime: messages[0]?.timestamp || new Date(),
    endTime: messages[messages.length - 1]?.timestamp || new Date(),
    processedBytes: lastSuccessfulOffset,
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
): { messages: Message[]; processedBytes: number } {
  const stats = statSync(filePath);
  if (startOffset >= stats.size) {
    return { messages: [], processedBytes: startOffset }; // No new content
  }

  // Read only new bytes
  const fd = openSync(filePath, 'r');
  const buffer = Buffer.alloc(stats.size - startOffset);
  readSync(fd, buffer, 0, buffer.length, startOffset);
  closeSync(fd);

  const content = buffer.toString('utf-8');

  // Similar to parseSessionFile, we track successful offsets
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

    if (line) {
      try {
        const parsed = JSON.parse(line) as RawLine;

        if (parsed.type !== 'file-history-snapshot') {
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
        }
        // Match found (or skipped), successful line
        lastSuccessfulOffset = startOffset + (nextNewline === buffer.length ? buffer.length : nextNewline + 1);
      } catch (e) {
        // Partial line - stop here
        break;
      }
    } else {
      // Empty line
      lastSuccessfulOffset = startOffset + (nextNewline === buffer.length ? buffer.length : nextNewline + 1);
    }
    currentOffset = nextNewline + 1;
  }

  messages.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  return { messages, processedBytes: lastSuccessfulOffset };
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
