/**
 * Memory Bank - Persistent storage for evolved fragments
 *
 * Stores fragments with:
 * - Temporal metadata (when evolved, from which sessions)
 * - Source links (provenance to exact messages)
 * - Searchable index for fractal-grep
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';

import type { SourceLink, Message, Conversation } from './session-parser.js';
import type { AllFragments, DecisionFragment, InsightFragment, NarrativeFragment, VocabularyFragment } from './schemas.js';
import { emptyFragments } from './schemas.js';

// ============================================================================
// Types
// ============================================================================

export interface MemoryEntry {
  /** When this entry was created/updated */
  timestamp: Date;
  /** Which sessions contributed to this entry */
  sessionIds: string[];
  /** Source links for provenance */
  sourceLinks: SourceLink[];
  /** The evolved fragments */
  fragments: AllFragments;
}

export interface MemoryIndex {
  /** Version for future migrations */
  version: number;
  /** When the index was last updated */
  lastUpdated: Date;
  /** Per-project memory entries */
  projects: Record<string, ProjectMemory>;
  /** Global vocabulary across all projects */
  globalVocabulary: VocabularyFragment | null;
  /** Cursor: timestamp of oldest unprocessed session */
  processingCursor?: Date;
}

export interface SessionProcessingState {
  sessionId: string;
  /** Number of messages processed */
  messageCount: number;
  /** File modification time when last processed */
  modifiedTime: Date;
  /** File size in bytes when last processed (for fast append-only check) */
  fileSize?: number;
}

export interface ProjectMemory {
  /** Project path/name */
  project: string;
  /** Current evolved fragments for this project (result of horizontal evolution) */
  current: AllFragments;
  /** When last updated */
  lastUpdated: Date;
  /** Sessions that have been processed (with state for incremental updates) */
  processedSessions: SessionProcessingState[];
  /** Absolute path to project root */
  rootPath?: string;
  /** Per-session fragment snapshots (for horizontal evolution) */
  sessionSnapshots: Array<{
    sessionId: string;
    timestamp: Date;
    fragments: AllFragments;
  }>;
  /** All source links for this project */
  sourceLinks: SourceLink[];
  /** Historical snapshots (optional, for time travel) */
  history?: MemorySnapshot[];
}

export interface MemorySnapshot {
  timestamp: Date;
  fragments: AllFragments;
  sessionId: string;
}

// ============================================================================
// Storage Paths
// ============================================================================

/**
 * Get the default memory storage directory
 */
export function getMemoryDir(): string {
  return join(homedir(), '.claude-prose');
}

/**
 * Get the path to the memory index file
 */
export function getIndexPath(): string {
  return join(getMemoryDir(), 'memory-index.json');
}

/**
 * Sanitize a file path into a project name string.
 * Replaces both / and \ with - and removes leading dash.
 */
export function sanitizePath(path: string): string {
  return path.replace(/[/\\]/g, '-').replace(/^-+/, '');
}

/**
 * Get the path to a project's memory file
 */
export function getProjectMemoryPath(projectName: string): string {
  const sanitized = projectName.replace(/[^a-zA-Z0-9-_]/g, '_');
  return join(getMemoryDir(), 'projects', `${sanitized}.json`);
}

// ============================================================================
// Loading & Saving
// ============================================================================

/**
 * Load the memory index
 */
export function loadMemoryIndex(): MemoryIndex {
  const indexPath = getIndexPath();

  if (!existsSync(indexPath)) {
    return {
      version: 1,
      lastUpdated: new Date(),
      projects: {},
      globalVocabulary: null,
    };
  }

  try {
    const content = readFileSync(indexPath, 'utf-8');
    const parsed = JSON.parse(content);

    // Convert date strings back to Date objects
    return {
      ...parsed,
      lastUpdated: new Date(parsed.lastUpdated),
    };
  } catch (error) {
    console.error('Failed to load memory index:', error);
    return {
      version: 1,
      lastUpdated: new Date(),
      projects: {},
      globalVocabulary: null,
    };
  }
}

/**
 * Save the memory index
 */
export function saveMemoryIndex(index: MemoryIndex): void {
  const indexPath = getIndexPath();
  const dir = dirname(indexPath);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  index.lastUpdated = new Date();
  writeFileSync(indexPath, JSON.stringify(index, null, 2));
}

/**
 * Load a project's memory
 */
export function loadProjectMemory(projectName: string): ProjectMemory | null {
  const memoryPath = getProjectMemoryPath(projectName);

  if (!existsSync(memoryPath)) {
    return null;
  }

  try {
    const content = readFileSync(memoryPath, 'utf-8');
    const parsed = JSON.parse(content);

    // Convert date strings back to Date objects
    return {
      ...parsed,
      lastUpdated: new Date(parsed.lastUpdated),
      sourceLinks: parsed.sourceLinks?.map((sl: SourceLink) => ({
        ...sl,
        timestamp: new Date(sl.timestamp),
      })) || [],
    };
  } catch (error) {
    console.error(`Failed to load project memory for ${projectName}:`, error);
    return null;
  }
}

/**
 * Save a project's memory
 */
export function saveProjectMemory(memory: ProjectMemory): void {
  const memoryPath = getProjectMemoryPath(memory.project);
  const dir = dirname(memoryPath);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  memory.lastUpdated = new Date();
  writeFileSync(memoryPath, JSON.stringify(memory, null, 2));
}

// ============================================================================
// Memory Operations
// ============================================================================

/**
 * Create a new project memory
 */
export function createProjectMemory(project: string): ProjectMemory {
  return {
    project,
    current: emptyFragments(),
    lastUpdated: new Date(),
    processedSessions: [],
    sessionSnapshots: [],
    sourceLinks: [],
    history: [],
  };
}

/**
 * Update project memory with new evolved fragments from a session
 * This stores the session's fragments as a snapshot for horizontal evolution
 */
export function updateProjectMemory(
  memory: ProjectMemory,
  fragments: AllFragments,
  sessionId: string,
  sourceLinks: SourceLink[],
  messageCount: number,
  modifiedTime: Date,
  fileSize?: number,
  rootPath?: string
): ProjectMemory {
  // Update or add session processing state
  const existingIndex = memory.processedSessions.findIndex(s => typeof s === 'object' && s !== null && 'sessionId' in s && (s as any).sessionId === sessionId);
  const newState: SessionProcessingState = {
    sessionId,
    messageCount,
    modifiedTime,
    fileSize,
  };

  const processedSessions = existingIndex >= 0
    ? [
      ...memory.processedSessions.slice(0, existingIndex),
      newState,
      ...memory.processedSessions.slice(existingIndex + 1),
    ]
    : [...memory.processedSessions, newState];

  // Update or add session snapshot
  const snapshotIndex = memory.sessionSnapshots?.findIndex(s => s.sessionId === sessionId) ?? -1;
  const newSnapshot = {
    sessionId,
    timestamp: modifiedTime,
    fragments,
  };

  const sessionSnapshots = snapshotIndex >= 0
    ? [
      ...(memory.sessionSnapshots || []).slice(0, snapshotIndex),
      newSnapshot,
      ...(memory.sessionSnapshots || []).slice(snapshotIndex + 1),
    ]
    : [...(memory.sessionSnapshots || []), newSnapshot];

  return {
    ...memory,
    // Don't update current directly - that's done by horizontal evolution
    lastUpdated: new Date(),
    processedSessions,
    sessionSnapshots,
    sourceLinks: [...memory.sourceLinks, ...sourceLinks],
    rootPath: rootPath || memory.rootPath,
  };
}

/**
 * Update the current (horizontally evolved) fragments
 */
export function updateCurrentFragments(
  memory: ProjectMemory,
  current: AllFragments
): ProjectMemory {
  return {
    ...memory,
    current,
    lastUpdated: new Date(),
  };
}

/**
 * Check if a session needs processing (new or has new messages)
 */
export function getSessionProcessingState(
  memory: ProjectMemory | null,
  sessionId: string
): SessionProcessingState | null {
  if (!memory) return null;
  return (memory.processedSessions.find(s => typeof s === 'object' && s !== null && 'sessionId' in s && (s as any).sessionId === sessionId) as SessionProcessingState) || null;
}

/**
 * Check if a session needs (re)processing
 * Returns true if: never processed, or has new messages since last processing
 */
/**
 * Fast check using file size (no parsing needed for append-only JSONL)
 */
export function sessionNeedsProcessingFast(
  memory: ProjectMemory | null,
  sessionId: string,
  currentFileSize: number
): boolean {
  const state = getSessionProcessingState(memory, sessionId);
  if (!state) return true; // Never processed
  if (!state.fileSize) return true; // No file size stored, need to process

  // Append-only: if file grew, there's new content
  return currentFileSize > state.fileSize;
}

/**
 * Full check (requires parsing - use sessionNeedsProcessingFast first)
 */
export function sessionNeedsProcessing(
  memory: ProjectMemory | null,
  sessionId: string,
  currentMessageCount: number,
  currentModifiedTime: Date
): boolean {
  const state = getSessionProcessingState(memory, sessionId);
  if (!state) return true; // Never processed

  // Check if file has grown (new messages)
  if (currentMessageCount > state.messageCount) return true;

  // Check if file was modified (fallback) - convert to timestamps for reliable comparison
  const currentTime = new Date(currentModifiedTime).getTime();
  const storedTime = new Date(state.modifiedTime).getTime();
  if (currentTime > storedTime) return true;

  return false;
}

/**
 * Legacy check - kept for backwards compatibility
 */
export function isSessionProcessed(memory: ProjectMemory | null, sessionId: string): boolean {
  if (!memory) return false;
  return memory.processedSessions.some(s => s.sessionId === sessionId);
}

// ============================================================================
// Search / Query
// ============================================================================

export interface SearchResult {
  project: string;
  type: 'decision' | 'insight' | 'gotcha' | 'narrative' | 'quote';
  content: string;
  context?: string;
  score: number;
  timestamp?: Date;
  sourceLink?: SourceLink;
}

/**
 * Search across all project memories
 * Searches sessionSnapshots for temporal awareness - newer results score higher
 */
export function searchMemory(query: string, options?: {
  projects?: string[];
  types?: SearchResult['type'][];
  limit?: number;
}): SearchResult[] {
  const index = loadMemoryIndex();
  const results: SearchResult[] = [];
  const seen = new Set<string>(); // Dedupe by content hash

  const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);
  const projectFilter = options?.projects;
  const typeFilter = options?.types;

  // Find the time range for recency scoring
  let oldestTime = Date.now();
  let newestTime = 0;

  for (const projectName of Object.keys(index.projects)) {
    const memory = loadProjectMemory(projectName);
    if (!memory?.sessionSnapshots) continue;
    for (const snapshot of memory.sessionSnapshots) {
      const time = new Date(snapshot.timestamp).getTime();
      if (time < oldestTime) oldestTime = time;
      if (time > newestTime) newestTime = time;
    }
  }

  const timeRange = newestTime - oldestTime || 1; // Avoid division by zero

  for (const [projectName, _projectInfo] of Object.entries(index.projects)) {
    if (projectFilter && !projectFilter.includes(projectName)) {
      continue;
    }

    const memory = loadProjectMemory(projectName);
    if (!memory?.sessionSnapshots) continue;

    // Search through sessionSnapshots for temporal awareness
    for (const snapshot of memory.sessionSnapshots) {
      const timestamp = new Date(snapshot.timestamp);
      const recencyBonus = ((timestamp.getTime() - oldestTime) / timeRange) * 10; // 0-10 bonus for recency

      // Search decisions
      if (!typeFilter || typeFilter.includes('decision')) {
        for (const decision of snapshot.fragments.decisions?.decisions || []) {
          const contentHash = `decision:${decision.what}`;
          if (seen.has(contentHash)) continue;

          const keywordScore = scoreMatch(queryTerms, `${decision.what} ${decision.why}`);
          if (keywordScore > 0) {
            seen.add(contentHash);
            results.push({
              project: projectName,
              type: 'decision',
              content: decision.what,
              context: decision.why,
              score: keywordScore + recencyBonus,
              timestamp,
            });
          }
        }
      }

      // Search insights
      if (!typeFilter || typeFilter.includes('insight')) {
        for (const insight of snapshot.fragments.insights?.insights || []) {
          const contentHash = `insight:${insight.learning}`;
          if (seen.has(contentHash)) continue;

          const keywordScore = scoreMatch(queryTerms, `${insight.learning} ${insight.context}`);
          if (keywordScore > 0) {
            seen.add(contentHash);
            results.push({
              project: projectName,
              type: 'insight',
              content: insight.learning,
              context: insight.context,
              score: keywordScore + recencyBonus,
              timestamp,
            });
          }
        }
      }

      // Search gotchas
      if (!typeFilter || typeFilter.includes('gotcha')) {
        for (const gotcha of snapshot.fragments.insights?.gotchas || []) {
          const contentHash = `gotcha:${gotcha.issue}`;
          if (seen.has(contentHash)) continue;

          const keywordScore = scoreMatch(queryTerms, `${gotcha.issue} ${gotcha.solution || ''}`);
          if (keywordScore > 0) {
            seen.add(contentHash);
            results.push({
              project: projectName,
              type: 'gotcha',
              content: gotcha.issue,
              context: gotcha.solution,
              score: keywordScore + recencyBonus,
              timestamp,
            });
          }
        }
      }

      // Search narrative
      if (!typeFilter || typeFilter.includes('narrative')) {
        for (const beat of snapshot.fragments.narrative?.story_beats || []) {
          const contentHash = `narrative:${beat.summary.slice(0, 50)}`;
          if (seen.has(contentHash)) continue;

          const keywordScore = scoreMatch(queryTerms, beat.summary);
          if (keywordScore > 0) {
            seen.add(contentHash);
            results.push({
              project: projectName,
              type: 'narrative',
              content: beat.summary,
              context: beat.beat_type,
              score: keywordScore + recencyBonus,
              timestamp,
            });
          }
        }
      }

      // Search quotes
      if (!typeFilter || typeFilter.includes('quote')) {
        for (const quote of snapshot.fragments.narrative?.memorable_quotes || []) {
          const contentHash = `quote:${quote.quote.slice(0, 50)}`;
          if (seen.has(contentHash)) continue;

          const keywordScore = scoreMatch(queryTerms, quote.quote);
          if (keywordScore > 0) {
            seen.add(contentHash);
            results.push({
              project: projectName,
              type: 'quote',
              content: quote.quote,
              context: quote.speaker,
              score: keywordScore + recencyBonus,
              timestamp,
            });
          }
        }
      }
    }
  }

  // Sort by score descending (now includes recency)
  results.sort((a, b) => b.score - a.score);

  // Apply limit
  if (options?.limit) {
    return results.slice(0, options.limit);
  }

  return results;
}

/**
 * Score a match against query terms
 */
function scoreMatch(queryTerms: string[], text: string): number {
  const textLower = text.toLowerCase();
  let score = 0;

  for (const term of queryTerms) {
    if (textLower.includes(term)) {
      score += 10;
      // Bonus for exact word match
      if (new RegExp(`\\b${term}\\b`).test(textLower)) {
        score += 5;
      }
    }
  }

  return score;
}

// ============================================================================
// Markdown Generation (for slash command injection)
// ============================================================================

/**
 * Generate a Markdown context file from project memory
 * This can be symlinked as a Claude Code slash command
 */
export function generateContextMarkdown(projectName: string): string | null {
  const memory = loadProjectMemory(projectName);
  if (!memory) return null;

  const lines: string[] = [
    `# Project Memory: ${projectName.replace(/^-Users-[^-]+-src-/, '')}`,
    '',
    `> Auto-generated semantic memory from ${memory.processedSessions.length} sessions`,
    `> Last updated: ${memory.lastUpdated.toLocaleString()}`,
    '',
  ];

  // Current Focus
  if (memory.current.focus?.current_goal) {
    lines.push('## Current Focus');
    lines.push('');
    lines.push(`**Goal:** ${memory.current.focus.current_goal}`);
    if (memory.current.focus.active_tasks?.length) {
      lines.push('');
      lines.push('**Active tasks:**');
      for (const task of memory.current.focus.active_tasks) {
        lines.push(`- ${task}`);
      }
    }
    if (memory.current.focus.blockers?.length) {
      lines.push('');
      lines.push('**Blockers:**');
      for (const blocker of memory.current.focus.blockers) {
        lines.push(`- ⚠️ ${blocker}`);
      }
    }
    lines.push('');
  }

  // Decisions
  if (memory.current.decisions?.decisions?.length) {
    lines.push('## Key Decisions');
    lines.push('');
    for (const decision of memory.current.decisions.decisions) {
      lines.push(`### ${decision.what}`);
      lines.push('');
      lines.push(`**Why:** ${decision.why}`);
      if (decision.alternatives?.length) {
        lines.push('');
        lines.push(`**Alternatives considered:** ${decision.alternatives.join(', ')}`);
      }
      lines.push(`**Confidence:** ${decision.confidence}`);
      lines.push('');
    }
  }

  // Insights
  if (memory.current.insights?.insights?.length) {
    lines.push('## Insights');
    lines.push('');
    for (const insight of memory.current.insights.insights) {
      lines.push(`- **${insight.learning}**`);
      if (insight.context) {
        lines.push(`  - Context: ${insight.context}`);
      }
    }
    lines.push('');
  }

  // Gotchas
  if (memory.current.insights?.gotchas?.length) {
    lines.push('## Gotchas & Pitfalls');
    lines.push('');
    for (const gotcha of memory.current.insights.gotchas) {
      lines.push(`- ⚠️ **${gotcha.issue}**`);
      if (gotcha.solution) {
        lines.push(`  - Solution: ${gotcha.solution}`);
      }
    }
    lines.push('');
  }

  // Technologies & Files (from vocabulary)
  if (memory.current.vocabulary) {
    if (memory.current.vocabulary.technologies?.length) {
      lines.push('## Technologies');
      lines.push('');
      lines.push(memory.current.vocabulary.technologies.join(', '));
      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * Generate a verbatim Markdown record of a session
 */
export function generateVerbatimMarkdown(conversation: Conversation): string {
  const date = new Date(conversation.startTime || new Date());
  const dateStr = date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  const timeStr = date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });

  const lines: string[] = [
    `# Session: ${conversation.sessionId.slice(0, 8)}`,
    '',
    `**Date:** ${dateStr} at ${timeStr}`,
    `**Project:** ${conversation.project}`,
    `**Session ID:** \`${conversation.sessionId}\``,
    '',
    '---',
    '',
  ];

  for (const msg of conversation.messages) {
    const roleName = msg.role === 'user' ? 'Designer' : 'Claude';
    lines.push(`**${roleName}:**`);
    lines.push(msg.content);
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push(`*Generated by [prose](https://github.com/anthropics/claude-code) - Digital Archaeology Mode*`);

  return lines.join('\n');
}

/**
 * Write a verbatim session artifact to the prose directory
 */
export function writeVerbatimSessionArtifact(conversation: Conversation, outputDir?: string): string {
  const dir = outputDir || join(process.cwd(), '.claude', 'prose');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const filename = `session-${conversation.sessionId.slice(0, 8)}.md`;
  const outputPath = join(dir, filename);
  const markdown = generateVerbatimMarkdown(conversation);
  writeFileSync(outputPath, markdown);

  return outputPath;
}

/**
 * Generate a Markdown summary for a single session snapshot
 */
export function generateSessionMarkdown(snapshot: { sessionId: string; timestamp: Date | string; fragments: AllFragments }, projectName: string): string {
  const date = new Date(snapshot.timestamp);
  const dateStr = date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  const timeStr = date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });

  const lines: string[] = [
    `# Session Snapshot: ${snapshot.sessionId.slice(0, 8)}`,
    '',
    `**Project:** ${projectName.replace(/^-Users-[^-]+-src-/, '')}`,
    `**Date:** ${dateStr} at ${timeStr}`,
    `**Session ID:** \`${snapshot.sessionId}\``,
    '',
  ];

  // Focus
  const focus = snapshot.fragments.focus;
  if (focus?.current_goal) {
    const focusEmoji = focus.current_goal.toLowerCase().includes('fix') ? '🔧' :
      focus.current_goal.toLowerCase().includes('feat') ? '✨' : '🎯';
    lines.push(`## ${focusEmoji} Focus`);
    lines.push('');
    lines.push(`**Goal:** ${focus.current_goal}`);
    if (focus.active_tasks?.length) {
      lines.push('');
      lines.push('**Active tasks:**');
      for (const task of focus.active_tasks) {
        lines.push(`- ${task}`);
      }
    }
    if (focus.blockers?.length) {
      lines.push('');
      lines.push('**Blockers:**');
      for (const blocker of focus.blockers) {
        lines.push(`- ⚠️ ${blocker}`);
      }
    }
    lines.push('');
  }

  // Story Beats
  const beats = snapshot.fragments.narrative?.story_beats || [];
  if (beats.length) {
    lines.push('## 📖 The Story');
    lines.push('');
    for (const beat of beats) {
      const typeStr = beat.beat_type ? `[${beat.beat_type.toUpperCase()}] ` : '';
      lines.push(`- ${typeStr}${beat.summary}${beat.emotional_tone ? ` *(${beat.emotional_tone})*` : ''}`);
    }
    lines.push('');
  }

  // Quotes
  const quotes = snapshot.fragments.narrative?.memorable_quotes || [];
  if (quotes.length) {
    lines.push('## 💬 Memorable Quotes');
    lines.push('');
    for (const q of quotes) {
      lines.push(`> "${q.quote}"`);
      lines.push(`> — *${q.speaker}*`);
      lines.push('');
    }
  }

  // Decisions
  const decisions = snapshot.fragments.decisions?.decisions || [];
  if (decisions.length) {
    lines.push('## ⚖️ Decisions Made');
    lines.push('');
    for (const d of decisions) {
      lines.push(`### ${d.what}`);
      lines.push('');
      lines.push(`**Why:** ${d.why}`);
      lines.push(`**Confidence:** ${d.confidence}`);
      lines.push('');
    }
  }

  // Insights
  const insights = snapshot.fragments.insights?.insights || [];
  const gotchas = snapshot.fragments.insights?.gotchas || [];
  if (insights.length || gotchas.length) {
    lines.push('## 💡 Insights & Gotchas');
    lines.push('');
    for (const i of insights) {
      lines.push(`- **Learning:** ${i.learning}`);
      if (i.context) lines.push(`  - *Context:* ${i.context}`);
    }
    for (const g of gotchas) {
      lines.push(`- ⚠️ **Issue:** ${g.issue}`);
      if (g.solution) lines.push(`  - *Solution:* ${g.solution}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Export a session snapshot as a Markdown artifact (Summarized version)
 * Note: We are moving towards verbatim mirroring as the primary artifact.
 */
export function exportSessionSnapshotArtifact(snapshot: { sessionId: string; timestamp: Date | string; fragments: AllFragments }, projectName: string, outputDir: string): string {
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  const filename = `summary-${snapshot.sessionId.slice(0, 8)}.md`;
  const outputPath = join(outputDir, filename);
  const markdown = generateSessionMarkdown(snapshot, projectName);
  writeFileSync(outputPath, markdown);
  return outputPath;
}

/**
 * Write context markdown to a file (for slash command symlink)
 */
export function writeContextFile(projectName: string, outputPath: string): boolean {
  const markdown = generateContextMarkdown(projectName);
  if (!markdown) return false;

  const dir = dirname(outputPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(outputPath, markdown);
  return true;
}

/**
 * Get memory statistics
 */
export function getMemoryStats(): {
  totalProjects: number;
  totalDecisions: number;
  totalInsights: number;
  totalSessions: number;
  lastUpdated: Date | null;
} {
  const index = loadMemoryIndex();

  let totalDecisions = 0;
  let totalInsights = 0;
  let totalSessions = 0;

  for (const projectName of Object.keys(index.projects)) {
    const memory = loadProjectMemory(projectName);
    if (memory) {
      totalDecisions += memory.current.decisions?.decisions?.length || 0;
      totalInsights += memory.current.insights?.insights?.length || 0;
      totalSessions += memory.processedSessions.length;
    }
  }

  return {
    totalProjects: Object.keys(index.projects).length,
    totalDecisions,
    totalInsights,
    totalSessions,
    lastUpdated: index.lastUpdated,
  };
}
