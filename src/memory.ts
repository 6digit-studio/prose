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

import type { SourceLink } from './session-parser.js';
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
}

export interface ProjectMemory {
  /** Project path/name */
  project: string;
  /** Current evolved fragments for this project */
  current: AllFragments;
  /** When last updated */
  lastUpdated: Date;
  /** Sessions that have been processed (with state for incremental updates) */
  processedSessions: SessionProcessingState[];
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
    sourceLinks: [],
    history: [],
  };
}

/**
 * Update project memory with new evolved fragments
 */
export function updateProjectMemory(
  memory: ProjectMemory,
  fragments: AllFragments,
  sessionId: string,
  sourceLinks: SourceLink[],
  messageCount: number,
  modifiedTime: Date
): ProjectMemory {
  // Create a snapshot of the current state before updating
  const snapshot: MemorySnapshot = {
    timestamp: new Date(),
    fragments: memory.current,
    sessionId,
  };

  // Keep last 10 snapshots for time travel
  const history = [snapshot, ...(memory.history || [])].slice(0, 10);

  // Update or add session processing state
  const existingIndex = memory.processedSessions.findIndex(s => s.sessionId === sessionId);
  const newState: SessionProcessingState = {
    sessionId,
    messageCount,
    modifiedTime,
  };

  const processedSessions = existingIndex >= 0
    ? [
        ...memory.processedSessions.slice(0, existingIndex),
        newState,
        ...memory.processedSessions.slice(existingIndex + 1),
      ]
    : [...memory.processedSessions, newState];

  return {
    ...memory,
    current: fragments,
    lastUpdated: new Date(),
    processedSessions,
    sourceLinks: [...memory.sourceLinks, ...sourceLinks],
    history,
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
  return memory.processedSessions.find(s => s.sessionId === sessionId) || null;
}

/**
 * Check if a session needs (re)processing
 * Returns true if: never processed, or has new messages since last processing
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

  // Check if file was modified (fallback)
  if (currentModifiedTime > state.modifiedTime) return true;

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
  sourceLink?: SourceLink;
}

/**
 * Search across all project memories
 */
export function searchMemory(query: string, options?: {
  projects?: string[];
  types?: SearchResult['type'][];
  limit?: number;
}): SearchResult[] {
  const index = loadMemoryIndex();
  const results: SearchResult[] = [];

  const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);
  const projectFilter = options?.projects;
  const typeFilter = options?.types;

  for (const [projectName, _projectInfo] of Object.entries(index.projects)) {
    if (projectFilter && !projectFilter.includes(projectName)) {
      continue;
    }

    const memory = loadProjectMemory(projectName);
    if (!memory) continue;

    // Search decisions
    if (!typeFilter || typeFilter.includes('decision')) {
      for (const decision of memory.current.decisions?.decisions || []) {
        const score = scoreMatch(queryTerms, `${decision.what} ${decision.why}`);
        if (score > 0) {
          results.push({
            project: projectName,
            type: 'decision',
            content: decision.what,
            context: decision.why,
            score,
          });
        }
      }
    }

    // Search insights
    if (!typeFilter || typeFilter.includes('insight')) {
      for (const insight of memory.current.insights?.insights || []) {
        const score = scoreMatch(queryTerms, `${insight.learning} ${insight.context}`);
        if (score > 0) {
          results.push({
            project: projectName,
            type: 'insight',
            content: insight.learning,
            context: insight.context,
            score,
          });
        }
      }
    }

    // Search gotchas
    if (!typeFilter || typeFilter.includes('gotcha')) {
      for (const gotcha of memory.current.insights?.gotchas || []) {
        const score = scoreMatch(queryTerms, `${gotcha.issue} ${gotcha.solution || ''}`);
        if (score > 0) {
          results.push({
            project: projectName,
            type: 'gotcha',
            content: gotcha.issue,
            context: gotcha.solution,
            score,
          });
        }
      }
    }

    // Search narrative
    if (!typeFilter || typeFilter.includes('narrative')) {
      for (const beat of memory.current.narrative?.story_beats || []) {
        const score = scoreMatch(queryTerms, beat.summary);
        if (score > 0) {
          results.push({
            project: projectName,
            type: 'narrative',
            content: beat.summary,
            context: beat.beat_type,
            score,
          });
        }
      }
    }

    // Search quotes
    if (!typeFilter || typeFilter.includes('quote')) {
      for (const quote of memory.current.narrative?.memorable_quotes || []) {
        const score = scoreMatch(queryTerms, quote.quote);
        if (score > 0) {
          results.push({
            project: projectName,
            type: 'quote',
            content: quote.quote,
            context: quote.speaker,
            score,
          });
        }
      }
    }
  }

  // Sort by score descending
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
