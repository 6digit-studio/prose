/**
 * Fragment Schemas - The structured types that evolve over time
 *
 * Each fragment captures a different aspect of the development conversation.
 * They stay small (injectable into context) and evolve (not restart) as
 * new messages are processed.
 */

import { z } from 'zod';

// ============================================================================
// Decision Fragment - "What was decided and why"
// ============================================================================

export const DecisionSchema = z.object({
  decisions: z.array(z.object({
    what: z.string().describe('What was decided'),
    why: z.string().describe('The reasoning behind the decision'),
    when: z.string().describe('Approximate timestamp or session reference'),
    alternatives: z.array(z.string()).optional().describe('Alternatives that were considered'),
    confidence: z.enum(['certain', 'tentative', 'revisiting']).describe('How settled is this decision'),
  })).describe('Architectural and design decisions made during development'),
  musings: z.string().optional().describe('Your thoughts on this evolution - what patterns do you see? What would you do differently? Roast us if needed.'),
});

export type DecisionFragment = z.infer<typeof DecisionSchema>;

// ============================================================================
// Insight Fragment - "What was learned"
// ============================================================================

export const InsightSchema = z.object({
  insights: z.array(z.object({
    learning: z.string().describe('What was learned or discovered'),
    context: z.string().describe('The situation that led to this insight'),
    applies_to: z.array(z.string()).optional().describe('What this insight applies to'),
  })).describe('Key learnings and discoveries'),

  gotchas: z.array(z.object({
    issue: z.string().describe('The tricky issue or pitfall'),
    solution: z.string().optional().describe('How to avoid or handle it'),
  })).optional().describe('Gotchas and pitfalls discovered'),
});

export type InsightFragment = z.infer<typeof InsightSchema>;

// ============================================================================
// Focus Fragment - "What are we working on right now"
// ============================================================================

export const FocusSchema = z.object({
  current_goal: z.string().describe('The main objective of the current work'),
  active_tasks: z.array(z.string()).describe('Tasks currently in progress'),
  blockers: z.array(z.string()).optional().describe('What is blocking progress'),
  next_steps: z.array(z.string()).optional().describe('Planned next actions'),
});

export type FocusFragment = z.infer<typeof FocusSchema>;

// ============================================================================
// Narrative Fragment - "The story of what happened"
// ============================================================================

export const NarrativeSchema = z.object({
  story_beats: z.array(z.object({
    beat_type: z.enum(['setup', 'conflict', 'breakthrough', 'pivot', 'resolution', 'cliffhanger']),
    summary: z.string().describe('What happened in this beat'),
    emotional_tone: z.enum(['frustrated', 'curious', 'excited', 'determined', 'satisfied']).optional(),
  })).describe('The narrative arc of the development session'),

  memorable_quotes: z.array(z.object({
    speaker: z.enum(['human', 'claude']),
    quote: z.string(),
    context: z.string().optional(),
  })).optional().describe('Lines worth preserving verbatim'),

  themes: z.array(z.string()).optional().describe('Recurring themes in this session'),
});

export type NarrativeFragment = z.infer<typeof NarrativeSchema>;

// ============================================================================
// Vocabulary Fragment - For semantic search
// ============================================================================

export const VocabularySchema = z.object({
  terms: z.record(z.number()).describe('Term frequency map'),
  concepts: z.array(z.string()).describe('Key concepts mentioned'),
  technologies: z.array(z.string()).describe('Technologies, libraries, tools mentioned'),
  files: z.array(z.string()).describe('Files that were discussed or modified'),
});

export type VocabularyFragment = z.infer<typeof VocabularySchema>;

// ============================================================================
// All Fragments Combined
// ============================================================================

export interface AllFragments {
  decisions: DecisionFragment | null;
  insights: InsightFragment | null;
  focus: FocusFragment | null;
  narrative: NarrativeFragment | null;
  vocabulary: VocabularyFragment | null;
}

export const FRAGMENT_SCHEMAS = {
  decisions: DecisionSchema,
  insights: InsightSchema,
  focus: FocusSchema,
  narrative: NarrativeSchema,
  vocabulary: VocabularySchema,
} as const;

export type FragmentType = keyof typeof FRAGMENT_SCHEMAS;

// ============================================================================
// Empty/Default States
// ============================================================================

export function emptyFragments(): AllFragments {
  return {
    decisions: null,
    insights: null,
    focus: null,
    narrative: null,
    vocabulary: null,
  };
}

export function emptyDecisions(): DecisionFragment {
  return { decisions: [] };
}

export function emptyInsights(): InsightFragment {
  return { insights: [], gotchas: [] };
}

export function emptyFocus(): FocusFragment {
  return { current_goal: '', active_tasks: [], blockers: [], next_steps: [] };
}

export function emptyNarrative(): NarrativeFragment {
  return { story_beats: [], memorable_quotes: [], themes: [] };
}

export function emptyVocabulary(): VocabularyFragment {
  return { terms: {}, concepts: [], technologies: [], files: [] };
}
