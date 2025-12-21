/**
 * Horizontal Evolution - Evolve across sessions
 *
 * Takes fragments from the last N sessions and evolves them into
 * a compressed current state. The window naturally prevents crud
 * buildup - old sessions age out, no algorithmic pruning needed.
 */

import { createOpenAI } from '@ai-sdk/openai';
import { generateObject } from 'ai';
import { z } from 'zod';

import type { AllFragments } from './schemas.js';
import {
  DecisionSchema,
  InsightSchema,
  FocusSchema,
  NarrativeSchema,
  emptyFragments,
} from './schemas.js';

// ============================================================================
// Types
// ============================================================================

export interface SessionSnapshot {
  sessionId: string;
  timestamp: Date;
  fragments: AllFragments;
}

export interface HorizontalEvolutionConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  windowSize?: number;  // How many sessions to include (default: 5)
}

export interface HorizontalEvolutionResult {
  current: AllFragments;
  tokensUsed: number;
  sessionsIncluded: number;
  musings?: string;
}

// ============================================================================
// LLM Client
// ============================================================================

function createLLMClient(config: HorizontalEvolutionConfig) {
  return createOpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl || 'https://openrouter.ai/api/v1',
  });
}

// ============================================================================
// Format helpers
// ============================================================================

function formatFragmentsForEvolution(snapshots: SessionSnapshot[]): string {
  return snapshots
    .map((s, i) => {
      const age = i === 0 ? '(most recent)' : `(${i} sessions ago)`;
      return `## Session ${s.sessionId.slice(0, 8)} ${age}

### Decisions
${JSON.stringify(s.fragments.decisions, null, 2)}

### Insights
${JSON.stringify(s.fragments.insights, null, 2)}

### Focus
${JSON.stringify(s.fragments.focus, null, 2)}
`;
    })
    .join('\n---\n\n');
}

// ============================================================================
// Horizontal Evolution
// ============================================================================

/**
 * Evolve decisions horizontally across sessions
 */
async function evolveDecisionsHorizontal(
  snapshots: SessionSnapshot[],
  config: HorizontalEvolutionConfig
) {
  const client = createLLMClient(config);

  const prompt = `You are evolving a project's decision memory across multiple sessions.

Below are the decisions from the last ${snapshots.length} sessions, ordered from most recent to oldest.
Synthesize these into a CURRENT state - what decisions are still active and relevant NOW?

${formatFragmentsForEvolution(snapshots)}

Below are the decisions from the last ${snapshots.length} sessions, ordered from most recent to oldest.
Sessions prefixed with "INTELLIGENT DESIGN SESSION" are direct human corrections and must be treated as absolute ground truth, overriding any conflicting automated summaries from regular sessions.
Synthesize these into the CURRENT set of active project decisions.

${formatFragmentsForEvolution(snapshots)}

Evolve these into the current state. The schema describes what we need.`;

  const { object, usage } = await generateObject({
    model: client(config.model || 'google/gemini-3-flash-preview'),
    schema: DecisionSchema,
    prompt,
    temperature: 0.3,
  });

  return { data: object, tokensUsed: usage.totalTokens };
}

/**
 * Evolve insights horizontally across sessions
 */
async function evolveInsightsHorizontal(
  snapshots: SessionSnapshot[],
  config: HorizontalEvolutionConfig
) {
  const client = createLLMClient(config);

  const prompt = `Below are the insights from the last ${snapshots.length} sessions, ordered from most recent to oldest.
Sessions prefixed with "INTELLIGENT DESIGN SESSION" are direct human corrections and must be treated as absolute ground truth.
Synthesize these into what's CURRENTLY valuable to know.

${formatFragmentsForEvolution(snapshots)}

Evolve these into the current state. The schema describes what we need.`;

  const { object, usage } = await generateObject({
    model: client(config.model || 'google/gemini-3-flash-preview'),
    schema: InsightSchema,
    prompt,
    temperature: 0.3,
  });

  return { data: object, tokensUsed: usage.totalTokens };
}

/**
 * Evolve focus horizontally - this should just be the most recent
 */
async function evolveFocusHorizontal(
  snapshots: SessionSnapshot[],
  config: HorizontalEvolutionConfig
) {
  const client = createLLMClient(config);

  const prompt = `You are determining the CURRENT focus of a project based on recent sessions.

Below is the focus from the last ${snapshots.length} sessions.
Determine what the project is CURRENTLY focused on.

${formatFragmentsForEvolution(snapshots)}

The most recent session's focus is likely most relevant, but synthesize if needed.`;

  const { object, usage } = await generateObject({
    model: client(config.model || 'google/gemini-3-flash-preview'),
    schema: FocusSchema,
    prompt,
    temperature: 0.3,
  });

  return { data: object, tokensUsed: usage.totalTokens };
}

/**
 * Evolve narrative horizontally
 */
async function evolveNarrativeHorizontal(
  snapshots: SessionSnapshot[],
  config: HorizontalEvolutionConfig
) {
  const client = createLLMClient(config);

  const prompt = `You are synthesizing the narrative arc across multiple development sessions.

Below are the story beats from the last ${snapshots.length} sessions.
Create a cohesive narrative that spans these sessions.

${formatFragmentsForEvolution(snapshots)}

Focus on the overall arc, key moments, and memorable quotes.`;

  const { object, usage } = await generateObject({
    model: client(config.model || 'google/gemini-3-flash-preview'),
    schema: NarrativeSchema,
    prompt,
    temperature: 0.5,
  });

  return { data: object, tokensUsed: usage.totalTokens };
}

// ============================================================================
// Main horizontal evolution
// ============================================================================

/**
 * Perform horizontal evolution across session snapshots
 */
export async function evolveHorizontal(
  snapshots: SessionSnapshot[],
  config: HorizontalEvolutionConfig
): Promise<HorizontalEvolutionResult> {
  const windowSize = config.windowSize || 5;

  // Take only the most recent N sessions
  const window = snapshots
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, windowSize);

  if (window.length === 0) {
    return {
      current: emptyFragments(),
      tokensUsed: 0,
      sessionsIncluded: 0,
    };
  }

  // If only one session, just return its fragments
  if (window.length === 1) {
    return {
      current: window[0].fragments,
      tokensUsed: 0,
      sessionsIncluded: 1,
    };
  }

  // Evolve each fragment type in parallel
  const [decisions, insights, focus, narrative] = await Promise.all([
    evolveDecisionsHorizontal(window, config),
    evolveInsightsHorizontal(window, config),
    evolveFocusHorizontal(window, config),
    evolveNarrativeHorizontal(window, config),
  ]);

  const totalTokens =
    decisions.tokensUsed +
    insights.tokensUsed +
    focus.tokensUsed +
    narrative.tokensUsed;

  return {
    current: {
      decisions: decisions.data,
      insights: insights.data,
      focus: focus.data,
      narrative: narrative.data,
      vocabulary: null, // Vocabulary can be merged algorithmically later
    },
    tokensUsed: totalTokens,
    sessionsIncluded: window.length,
    musings: (decisions.data as any).musings,
  };
}
