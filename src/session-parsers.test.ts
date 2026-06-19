import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import { join } from 'path';
import { statSync, mkdtempSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { parseSessionFile, parseSessionFileFromOffset } from './session-parser.js';
import { parseCodexSessionFile, parseCodexSessionFileFromOffset } from './codex-session-parser.js';
import { parsePiSessionFile } from './pi-session-parser.js';
import { parseCursorSessionFile, decodeCursorCwd } from './cursor-session-parser.js';
import { parseAntigravityArtifact } from './source-parsers.js';
import type { Conversation } from './session-parser.js';

const FIXTURES_DIR = join(import.meta.dir, '..', 'tests', 'fixtures');

describe('Claude Code Parser Correctness', () => {
  const normalPath = join(FIXTURES_DIR, 'claude-code-normal.jsonl');
  const syntheticPath = join(FIXTURES_DIR, 'claude-code-synthetic.jsonl');
  const truncatedPath = join(FIXTURES_DIR, 'claude-code-truncated.jsonl');

  test('parses a normal Claude Code session correctly with sourceType', () => {
    const conv = parseSessionFile(normalPath);
    expect(conv.sessionId).toBe('cc-session-1');
    expect(conv.sourceType).toBe('claude-code');
    expect(conv.project).toBe('-Users-larsde-src-6digit-cordial');
    expect(conv.messages).toHaveLength(4);

    expect(conv.messages[0]).toEqual({
      role: 'user',
      content: 'Hello!',
      timestamp: new Date('2026-05-31T10:00:00.000Z'),
      source: {
        sessionId: 'cc-session-1',
        messageUuid: 'u1',
        timestamp: new Date('2026-05-31T10:00:00.000Z'),
        filePath: normalPath,
      },
    });

    expect(conv.messages[1].role).toBe('assistant');
    expect(conv.messages[1].content).toBe('Hi there! How can I help you today?');
    expect(conv.messages[2].content).toBe('What is the capital of France?');
    expect(conv.messages[3].content).toBe('The capital of France is Paris.');
  });

  test('excludes tool_result content from user messages (clean text content)', () => {
    const conv = parseSessionFile(syntheticPath);
    expect(conv.sessionId).toBe('cc-session-2');
    expect(conv.messages).toHaveLength(3);

    // Turn 1: User request
    expect(conv.messages[0].role).toBe('user');
    expect(conv.messages[0].content).toBe('Execute list_dir');

    // Turn 2: Assistant response (has text block and tool block; only text is extracted)
    expect(conv.messages[1].role).toBe('assistant');
    expect(conv.messages[1].content).toBe('Let me look at the files.');

    // Turn 3: User response carrying tool result (only clean text is extracted, tool result content excluded)
    expect(conv.messages[2].role).toBe('user');
    expect(conv.messages[2].content).toBe('System reminder: keep comments short.');
  });

  test('handles truncated files gracefully by recovering up to last successful line', () => {
    const conv = parseSessionFile(truncatedPath);
    expect(conv.messages).toHaveLength(2);
    expect(conv.messages[0].content).toBe('Hello!');
    expect(conv.messages[1].content).toBe('Hi');

    // The third truncated line should be ignored, and processedBytes should stop precisely
    // at the end of the second valid line.
    const fileStats = statSync(truncatedPath);
    expect(conv.processedBytes).toBeLessThan(fileStats.size);
    expect(conv.processedBytes).toBeGreaterThan(0);
  });

  test('parses incrementally using parseSessionFileFromOffset', () => {
    const firstPass = parseSessionFile(truncatedPath);
    expect(firstPass.messages).toHaveLength(2);

    // Parsing starting from the end of the second valid line
    const secondPass = parseSessionFileFromOffset(truncatedPath, firstPass.processedBytes);
    expect(secondPass.messages).toHaveLength(0);
    expect(secondPass.processedBytes).toBe(firstPass.processedBytes);
  });
});

describe('Codex Parser Correctness', () => {
  const codexPath = join(FIXTURES_DIR, 'codex-normal.jsonl');

  test('parses Codex JSONL streaming sessions correctly with sourceType', () => {
    const conv = parseCodexSessionFile(codexPath);
    expect(conv.sessionId).toBe('codex-session-1');
    expect(conv.sourceType).toBe('codex');
    expect(conv.project).toBe('-Users-larsde-src-6digit-cordial');
    expect(conv.messages).toHaveLength(2);

    expect(conv.messages[0].role).toBe('user');
    expect(conv.messages[0].content).toBe('Howdy Codex');

    expect(conv.messages[1].role).toBe('assistant');
    expect(conv.messages[1].content).toBe('Hello user! I am Codex.');
  });
});

describe('pi Parser Correctness', () => {
  const piPath = join(FIXTURES_DIR, 'pi-normal.jsonl');

  test('parses pi JSONL sessions, extracting text and dropping thinking/toolCall', () => {
    const conv = parsePiSessionFile(piPath);
    expect(conv.sessionId).toBe('pi-session-1');
    expect(conv.sourceType).toBe('pi');
    // cwd from the session header line drives the project slug.
    expect(conv.project).toBe('-Users-larsde-src-6digit-cordial');

    // The empty error message (no text blocks) is dropped; only the two
    // real turns survive.
    expect(conv.messages).toHaveLength(2);

    expect(conv.messages[0].role).toBe('user');
    expect(conv.messages[0].content).toBe('Howdy pi');
    expect(conv.messages[0].timestamp).toEqual(new Date('2026-06-17T08:05:07.614Z'));
    // pi's stable per-message id becomes the messageUuid.
    expect(conv.messages[0].source.messageUuid).toBe('c8a66cf4');

    // thinking and toolCall blocks are excluded; only the text block survives.
    expect(conv.messages[1].role).toBe('assistant');
    expect(conv.messages[1].content).toBe('Hello user! I am pi.');
    expect(conv.messages.some((m) => m.content.includes('internal reasoning'))).toBe(false);
    expect(conv.messages.some((m) => m.content.includes('toolCall'))).toBe(false);
  });
});

describe('Cursor Parser Correctness', () => {
  const cursorPath = join(FIXTURES_DIR, 'cursor-normal.jsonl');

  test('parses Cursor JSONL transcripts, extracting text and skipping tool_use', () => {
    const conv = parseCursorSessionFile(cursorPath);
    expect(conv.sourceType).toBe('cursor');

    // The all-tool_use assistant line carries no visible text and is dropped.
    expect(conv.messages).toHaveLength(4);
    expect(conv.messages.map((m) => m.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
    ]);
    expect(conv.messages[0].content).toBe('Howdy Cursor');
    // tool_use block in the same message is excluded; only the text survives.
    expect(conv.messages[1].content).toBe('Hello! Let me look at the files.');
    expect(conv.messages[2].content).toBe('What is the capital of France?');
    expect(conv.messages[3].content).toBe('The capital of France is Paris.');
    expect(conv.messages.some((m) => m.content.includes('tool_use'))).toBe(false);
  });

  test('synthesizes ordered timestamps anchored at file mtime (no source timestamps)', () => {
    const conv = parseCursorSessionFile(cursorPath);
    const mtime = statSync(cursorPath).mtime.getTime();
    // Last message anchored exactly at mtime; earlier messages strictly before it.
    expect(conv.messages[conv.messages.length - 1].timestamp.getTime()).toBe(mtime);
    for (let i = 1; i < conv.messages.length; i++) {
      expect(conv.messages[i].timestamp.getTime()).toBeGreaterThan(
        conv.messages[i - 1].timestamp.getTime()
      );
    }
    expect(conv.endTime.getTime()).toBe(mtime);
  });
});

describe('Cursor cwd decoding', () => {
  // Cursor collapses '/', '-', and '_' all to '-' in its project dir names, so
  // decode must consult the real filesystem to invert it. We build a temp tree
  // and decode against it via the `root` test seam.
  let tmp: string;

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'cursor-decode-'));
    // /<tmp>/src/koru, /src/6digit, /src/6digit-cordial, /src/korulang_org
    mkdirSync(join(tmp, 'src', 'koru'), { recursive: true });
    mkdirSync(join(tmp, 'src', '6digit'), { recursive: true });
    mkdirSync(join(tmp, 'src', '6digit-cordial'), { recursive: true });
    mkdirSync(join(tmp, 'src', 'korulang_org'), { recursive: true });
  });

  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  test('decodes a plain leaf directory', () => {
    expect(decodeCursorCwd('src-koru', tmp)).toBe(join(tmp, 'src', 'koru'));
  });

  test('decodes a hyphenated leaf without splitting on the hyphen', () => {
    expect(decodeCursorCwd('src-6digit-cordial', tmp)).toBe(
      join(tmp, 'src', '6digit-cordial')
    );
  });

  test('disambiguates a plain sibling from its hyphenated longer sibling', () => {
    expect(decodeCursorCwd('src-6digit', tmp)).toBe(join(tmp, 'src', '6digit'));
  });

  test('decodes an underscored leaf (Cursor renders the underscore as a dash)', () => {
    // Regression: `korulang_org` on disk encodes to `korulang-org`; a naive
    // dash-split mis-decodes it to `.../korulang/org`.
    expect(decodeCursorCwd('src-korulang-org', tmp)).toBe(
      join(tmp, 'src', 'korulang_org')
    );
  });

  test('falls back to a naive decode when nothing matches on disk', () => {
    expect(decodeCursorCwd('does-not-exist', tmp)).toBe(
      join(tmp, 'does', 'not', 'exist')
    );
  });
});

describe('Antigravity Parser Correctness', () => {
  const antiPath = join(FIXTURES_DIR, 'antigravity-transcript.jsonl');

  test('parses Antigravity JSONL session transcripts correctly', () => {
    const messages = parseAntigravityArtifact(antiPath, 'anti-session-1', 'test-project');
    expect(messages).toHaveLength(2);

    expect(messages[0].role).toBe('user');
    expect(messages[0].content).toBe('Hello Antigravity!');
    expect(messages[0].timestamp).toEqual(new Date('2026-05-31T14:00:00.000Z'));

    expect(messages[1].role).toBe('assistant');
    expect(messages[1].content).toBe('I am Antigravity. I am your agent.');
    expect(messages[1].timestamp).toEqual(new Date('2026-05-31T14:00:05.000Z'));
  });
});
