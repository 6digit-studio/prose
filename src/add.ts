/**
 * Direct fragment addition - mutate current memory without evolution
 *
 * Usage:
 *   prose add decision "What was decided" --why "Reasoning"
 *   prose add gotcha "The issue" --solution "How to fix"
 *   prose add insight "What was learned" --context "Situation"
 *   prose add focus "Current goal"
 */

import { loadProjectMemory, saveProjectMemory, createProjectMemory, loadMemoryIndex, saveMemoryIndex, sanitizePath } from './memory.js';
import { emptyDecisions, emptyInsights, emptyFocus } from './schemas.js';
import * as logger from './logger.js';

export type FragmentType = 'decision' | 'gotcha' | 'insight' | 'focus';

export interface AddOptions {
  why?: string;
  solution?: string;
  context?: string;
}

/**
 * Add a fragment directly to the current project memory
 */
export function addFragment(
  projectName: string,
  type: FragmentType,
  content: string,
  options: AddOptions = {}
): void {
  let memory = loadProjectMemory(projectName);

  // Create project memory if it doesn't exist
  if (!memory) {
    logger.info(`Creating new project memory for: ${projectName}`);
    memory = createProjectMemory(projectName);

    // Register in index
    const index = loadMemoryIndex();
    index.projects[projectName] = memory;
    saveMemoryIndex(index);
  }

  const timestamp = new Date().toISOString();

  switch (type) {
    case 'decision':
      memory.current.decisions ??= emptyDecisions();
      memory.current.decisions.decisions.push({
        what: content,
        why: options.why || 'Added via prose add',
        when: timestamp,
        confidence: 'certain',
      });
      logger.success(`Added decision: "${content}"`);
      break;

    case 'gotcha':
      memory.current.insights ??= emptyInsights();
      memory.current.insights.gotchas ??= [];
      memory.current.insights.gotchas.push({
        issue: content,
        solution: options.solution,
      });
      logger.success(`Added gotcha: "${content}"`);
      break;

    case 'insight':
      memory.current.insights ??= emptyInsights();
      memory.current.insights.insights.push({
        learning: content,
        context: options.context || 'Added via prose add',
      });
      logger.success(`Added insight: "${content}"`);
      break;

    case 'focus':
      memory.current.focus ??= emptyFocus();
      memory.current.focus.current_goal = content;
      logger.success(`Updated focus: "${content}"`);
      break;

    default:
      throw new Error(`Unknown fragment type: ${type}`);
  }

  saveProjectMemory(memory);
}

/**
 * Detect project from current working directory
 */
export function detectProject(cwd: string): string | null {
  const index = loadMemoryIndex();
  const cwdSanitized = sanitizePath(cwd);

  return Object.keys(index.projects).find(p =>
    p === cwdSanitized ||
    p.endsWith(cwdSanitized) ||
    cwdSanitized.endsWith(p.replace(/^-/, ''))
  ) || null;
}
