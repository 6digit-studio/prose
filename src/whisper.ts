/**
 * Whisper — light semantic compression of recent activity in the current cwd.
 *
 * Sits between `snap` (verbatim, no LLM) and `evolve` (multi-pass, persistent
 * vault writes). One streaming LLM pass over snap's verbatim window, no
 * persistence. Output is a short prose paragraph — what's being worked on,
 * what's pending, what's notable — soft and low-volume, like its name.
 */

import { createOpenAI } from '@ai-sdk/openai';
import { streamText } from 'ai';

import { snap, type SnapOptions, type SnapResult } from './snap.js';

export interface WhisperOptions extends SnapOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  temperature?: number;
  /** Stream destination. Defaults to process.stdout. */
  out?: NodeJS.WritableStream;
}

export interface WhisperResult {
  /** The snap result that fed the LLM. */
  source: SnapResult;
  /** Whisper text emitted by the LLM. */
  text: string;
  /** Whether anything was actually whispered (false if no sessions found). */
  emitted: boolean;
}

const SYSTEM_PROMPT = `You are whispering — quietly catching the user up on their own recent work in this project directory. The verbatim tail of recent Claude Code sessions is provided below.

Produce ONE short paragraph (3–5 sentences). Capture:
  - what's actively being worked on
  - any open thread, blocker, or decision in flight

No bullet points. No headers. No preamble like "Here's a summary". No restating session IDs or timestamps — the reader already sees those. Voice: direct, low-volume, like a colleague catching them up over coffee. If the sessions look incoherent or empty, say so plainly in one sentence.`;

export async function whisper(opts: WhisperOptions): Promise<WhisperResult> {
  const out = opts.out ?? process.stdout;

  const source = snap({
    cwd: opts.cwd,
    bytes: opts.bytes,
    turnsPerSession: opts.turnsPerSession,
    maxSessions: opts.maxSessions,
    liveSessionWindowMs: opts.liveSessionWindowMs,
    includeCurrent: opts.includeCurrent,
  });

  if (source.sessionsIncluded === 0) {
    return { source, text: '', emitted: false };
  }

  const client = createOpenAI({
    apiKey: opts.apiKey,
    baseURL: opts.baseUrl || 'https://openrouter.ai/api/v1',
  });

  const model = client(opts.model || 'google/gemini-3-flash-preview');

  const result = await streamText({
    model,
    temperature: opts.temperature ?? 0.4,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: source.text },
    ],
  });

  let text = '';
  for await (const chunk of result.textStream) {
    out.write(chunk);
    text += chunk;
  }
  out.write('\n');

  return { source, text, emitted: true };
}
