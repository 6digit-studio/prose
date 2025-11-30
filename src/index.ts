/**
 * Claude Prose - Semantic memory for AI development sessions
 *
 * Export all modules for library use
 */

// Session parsing
export {
  type SourceLink,
  type Message,
  type Conversation,
  type SessionFile,
  discoverSessionFiles,
  parseSessionFile,
  parseSessions,
  formatConversation,
  getSessionStats,
  getClaudeProjectsDir,
} from './session-parser.js';

// Fragment schemas
export {
  type AllFragments,
  type FragmentType,
  type DecisionFragment,
  type InsightFragment,
  type FocusFragment,
  type NarrativeFragment,
  type VocabularyFragment,
  DecisionSchema,
  InsightSchema,
  FocusSchema,
  NarrativeSchema,
  VocabularySchema,
  FRAGMENT_SCHEMAS,
  emptyFragments,
  emptyDecisions,
  emptyInsights,
  emptyFocus,
  emptyNarrative,
  emptyVocabulary,
} from './schemas.js';

// Evolution engine
export {
  type EvolutionContext,
  type EvolutionResult,
  type EvolutionConfig,
  type BatchEvolutionResult,
  evolveDecisions,
  evolveInsights,
  evolveFocus,
  evolveNarrative,
  evolveVocabulary,
  evolveAllFragments,
} from './evolve.js';

// Memory bank
export {
  type MemoryEntry,
  type MemoryIndex,
  type ProjectMemory,
  type MemorySnapshot,
  type SessionProcessingState,
  type SearchResult,
  getMemoryDir,
  getIndexPath,
  getProjectMemoryPath,
  loadMemoryIndex,
  saveMemoryIndex,
  loadProjectMemory,
  saveProjectMemory,
  createProjectMemory,
  updateProjectMemory,
  isSessionProcessed,
  sessionNeedsProcessing,
  getSessionProcessingState,
  searchMemory,
  getMemoryStats,
  generateContextMarkdown,
  writeContextFile,
  updateCurrentFragments,
} from './memory.js';

// Horizontal evolution
export {
  type SessionSnapshot,
  type HorizontalEvolutionConfig,
  type HorizontalEvolutionResult,
  evolveHorizontal,
} from './horizontal.js';
