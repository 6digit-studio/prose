/**
 * Session Parser for Cursor (the AI editor / `cursor-agent` CLI).
 *
 * Cursor stores each agent session as a JSONL transcript at:
 *
 *   ~/.cursor/projects/<ENCODED-CWD>/agent-transcripts/<uuid>/<uuid>.jsonl
 *
 * <ENCODED-CWD> is `sanitizePath(cwd)` — the absolute path with the leading
 * slash dropped and every `/` turned into `-` (e.g. `Users-larsde-src-koru`).
 * We reverse it back into a real cwd with a filesystem-aware walk so that
 * hyphenated leaf directories (`6digit-cordial`, `korulang-org`) decode
 * correctly rather than splitting on the dash.
 *
 * Each line is `{ role: 'user' | 'assistant', message: { content: [...] } }`.
 * Content is an array of blocks; `type: 'text'` blocks hold the visible prose
 * and `type: 'tool_use'` blocks are the internal trace — we keep the former
 * and skip the latter, matching every other parser here.
 *
 * IMPORTANT: Cursor transcripts carry NO per-message timestamps. The only
 * temporal signal is the file's mtime. We anchor the LAST message at mtime and
 * space earlier messages 1s apart going backwards, so ordering is preserved,
 * `since`/tail slicing works, and the session's content-recency matches its
 * filesystem-recency (which is what snap/standup key off). These timestamps are
 * synthetic and approximate by construction — there is no truer source.
 *
 * Each session directory may also contain a `subagents/` subdir of nested
 * transcripts. Those are Cursor's internal sub-agent runs (the analog of Claude
 * Code's sdk-cli noise); we discover only the top-level transcript per session.
 */

import { readFileSync, readdirSync, existsSync, statSync, type Dirent } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';
import type { Message, SessionFile, Conversation } from './session-parser.js';
import { sanitizePath } from './memory.js';

export function getCursorProjectsDir(): string {
  return join(homedir(), '.cursor', 'projects');
}

/**
 * Cursor's project-dir encoding collapses MULTIPLE distinct path characters to
 * `-`: a real `/Users/larsde/src/korulang_org` and `/Users/larsde/src/6digit-cordial`
 * both become `...-<leaf>` with the `_` / `-` rendered as `-`. So a single `-`
 * in the encoded name can stand for `/`, `-`, `_`, or any other non-alphanumeric
 * separator. We can't invert that from the string alone — but the filesystem
 * disambiguates it.
 *
 * `normalizeSep` maps a real directory name into the same lossy space Cursor
 * encodes into, so we can compare a real child dir against the encoded tokens.
 */
function normalizeSep(name: string): string {
  return name.replace(/[^A-Za-z0-9]/g, '-');
}

/**
 * Reverse Cursor's project-dir encoding back into an absolute cwd by walking
 * the real filesystem. At each level we list the actual child directories and
 * pick the one whose `normalizeSep` form matches the longest prefix of the
 * remaining encoded string at a separator boundary. Longest-match resolves the
 * `6digit` vs `6digit-cordial` sibling ambiguity. Falls back to the naive
 * `/`-for-`-` decode for the unresolved remainder (deleted project, or a
 * non-path encoding like `empty-window` / a `var-folders` temp dir).
 *
 * `root` is exposed for testing against a temp tree; production always walks
 * from the filesystem root.
 */
export function decodeCursorCwd(encoded: string, root: string = '/'): string {
  let current = root;
  let remaining = encoded;

  while (remaining.length > 0) {
    let children: Dirent[];
    try {
      children = readdirSync(current, { withFileTypes: true }) as Dirent[];
    } catch {
      break;
    }

    let best: string | null = null;
    let bestNorm = '';
    for (const child of children) {
      if (!child.isDirectory()) continue;
      const norm = normalizeSep(child.name);
      const isPrefix = remaining === norm || remaining.startsWith(`${norm}-`);
      if (isPrefix && norm.length > bestNorm.length) {
        best = child.name;
        bestNorm = norm;
      }
    }

    if (best === null) break;

    current = join(current, best);
    remaining = remaining === bestNorm ? '' : remaining.slice(bestNorm.length + 1);
  }

  if (remaining.length > 0) {
    // No on-disk match for the rest — deterministic naive decode of the tail.
    current = join(current, remaining.split('-').join('/'));
  }

  return current;
}

function projectNameFromCwd(cwd: string): string {
  return `-${sanitizePath(cwd)}`;
}

function matchesProjectFilter(projectName: string, projectPath: string): boolean {
  const normalizedProjectPath = sanitizePath(projectPath);
  const normalizedProjectName = projectName.replace(/^-/, '');
  return (
    normalizedProjectName === normalizedProjectPath ||
    normalizedProjectName.endsWith(`-${normalizedProjectPath}`)
  );
}

/**
 * The visible transcript for a session lives directly inside the session's
 * uuid directory (typically `<uuid>.jsonl`). `subagents/` nested transcripts
 * are intentionally skipped.
 */
function topLevelTranscript(sessionDir: string): string | null {
  let entries: Dirent[];
  try {
    entries = readdirSync(sessionDir, { withFileTypes: true }) as Dirent[];
  } catch {
    return null;
  }
  // Prefer `<dirname>.jsonl`; otherwise the first top-level `.jsonl` file.
  const dirName = basename(sessionDir);
  const preferred = entries.find(
    (e) => e.isFile() && e.name === `${dirName}.jsonl`
  );
  if (preferred) return join(sessionDir, preferred.name);
  const any = entries.find((e) => e.isFile() && e.name.endsWith('.jsonl'));
  return any ? join(sessionDir, any.name) : null;
}

/**
 * Discover all Cursor session transcripts, optionally scoped to a project.
 */
export function discoverCursorSessionFiles(projectPath?: string): SessionFile[] {
  const projectsDir = getCursorProjectsDir();
  if (!existsSync(projectsDir)) return [];

  const sessionFiles: SessionFile[] = [];

  let projectDirs: Dirent[];
  try {
    projectDirs = readdirSync(projectsDir, { withFileTypes: true }) as Dirent[];
  } catch {
    return [];
  }

  for (const projectDir of projectDirs) {
    if (!projectDir.isDirectory()) continue;

    const cwd = decodeCursorCwd(projectDir.name);
    const projectName = projectNameFromCwd(cwd);
    if (projectPath && !matchesProjectFilter(projectName, projectPath)) continue;

    const transcriptsDir = join(projectsDir, projectDir.name, 'agent-transcripts');
    if (!existsSync(transcriptsDir)) continue;

    let sessionDirs: Dirent[];
    try {
      sessionDirs = readdirSync(transcriptsDir, { withFileTypes: true }) as Dirent[];
    } catch {
      continue;
    }

    for (const sessionDir of sessionDirs) {
      if (!sessionDir.isDirectory()) continue;
      const transcriptPath = topLevelTranscript(join(transcriptsDir, sessionDir.name));
      if (!transcriptPath) continue;

      let stats;
      try {
        stats = statSync(transcriptPath);
      } catch {
        continue;
      }

      sessionFiles.push({
        path: transcriptPath,
        sessionId: sessionDir.name,
        project: projectName,
        modifiedTime: stats.mtime,
        fileSize: stats.size,
        sourceType: 'cursor',
        cwd,
      });
    }
  }

  return sessionFiles.sort((a, b) => b.modifiedTime.getTime() - a.modifiedTime.getTime());
}

interface CursorContentBlock {
  type?: string;
  text?: string;
}

interface CursorLine {
  role?: 'user' | 'assistant';
  message?: { content?: CursorContentBlock[] | string };
}

function extractTextContent(content: CursorContentBlock[] | string | undefined): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block) =>
      block && block.type === 'text' && typeof block.text === 'string' ? block.text : null
    )
    .filter((t): t is string => t !== null && t.trim() !== '')
    .join('\n\n');
}

export function parseCursorSessionFile(filePath: string): Conversation {
  const sessionId = basename(filePath, '.jsonl');

  let content = '';
  let mtime = new Date();
  try {
    content = readFileSync(filePath, 'utf-8');
    mtime = statSync(filePath).mtime;
  } catch {
    return {
      sessionId,
      project: 'cursor',
      messages: [],
      startTime: mtime,
      endTime: mtime,
      processedBytes: 0,
      sourceType: 'cursor',
    };
  }

  // First pass: collect (role, text) in file order, skipping empties.
  const raw: Array<{ role: 'user' | 'assistant'; text: string }> = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed: CursorLine;
    try {
      parsed = JSON.parse(trimmed) as CursorLine;
    } catch {
      // Partial trailing line on an actively-written transcript — stop here.
      break;
    }
    if (parsed.role !== 'user' && parsed.role !== 'assistant') continue;
    const text = extractTextContent(parsed.message?.content);
    if (!text.trim()) continue;
    raw.push({ role: parsed.role, text });
  }

  // Second pass: anchor the last message at mtime, space earlier ones 1s apart
  // backwards. No per-message timestamps exist in the source.
  const count = raw.length;
  const messages: Message[] = raw.map((m, i) => {
    const timestamp = new Date(mtime.getTime() - (count - 1 - i) * 1000);
    return {
      role: m.role,
      content: m.text,
      timestamp,
      source: {
        sessionId,
        messageUuid: `${sessionId}:${i}`,
        timestamp,
        filePath,
      },
    };
  });

  return {
    sessionId,
    project: 'cursor',
    messages,
    startTime: messages[0]?.timestamp ?? mtime,
    endTime: messages[messages.length - 1]?.timestamp ?? mtime,
    processedBytes: Buffer.byteLength(content, 'utf-8'),
    sourceType: 'cursor',
  };
}
