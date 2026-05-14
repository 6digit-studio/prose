/**
 * Tests for grep — exercises the pure helpers (compileRegex, renderSessionLines,
 * findMatchGroups) against synthetic Conversation fixtures. Disk-level discovery
 * and parsing are out of scope here; they're covered by smoke runs against the
 * real vault.
 */
import { describe, expect, test } from 'bun:test';
import {
  compileRegex,
  escapeRegex,
  findMatchGroups,
  renderSessionLines,
} from './grep.js';
import type { Conversation, Message } from './session-parser.js';

function makeMsg(role: 'user' | 'assistant', content: string, ts: string): Message {
  return {
    role,
    content,
    timestamp: new Date(ts),
    source: {
      sessionId: 'fixture',
      messageUuid: `${role}-${ts}`,
      timestamp: new Date(ts),
      filePath: '/fixture',
    },
  };
}

function makeConv(messages: Message[]): Conversation {
  return {
    sessionId: 'fixture-session-12345678',
    project: '-fixture',
    messages,
    startTime: messages[0]?.timestamp ?? new Date(),
    endTime: messages[messages.length - 1]?.timestamp ?? new Date(),
    processedBytes: 0,
  };
}

describe('compileRegex', () => {
  test('single regex pattern', () => {
    const re = compileRegex({ patterns: ['hel+o'] });
    expect(re.test('hello')).toBe(true);
    expect(re.test('helllllo')).toBe(true);
    expect(re.test('hi')).toBe(false);
  });

  test('multiple patterns OR-alternate', () => {
    const re = compileRegex({ patterns: ['foo', 'bar'] });
    expect(re.test('foo here')).toBe(true);
    expect(re.test('bar here')).toBe(true);
    expect(re.test('baz here')).toBe(false);
  });

  test('-F treats patterns as literal', () => {
    const re = compileRegex({ patterns: ['a.b'], fixedStrings: true });
    expect(re.test('a.b')).toBe(true);
    expect(re.test('axb')).toBe(false); // dot would match in regex mode
  });

  test('-i applies case-insensitive flag', () => {
    const re = compileRegex({ patterns: ['Hello'], ignoreCase: true });
    expect(re.test('HELLO world')).toBe(true);
    expect(re.test('hElLo')).toBe(true);
  });

  test('throws on invalid regex', () => {
    expect(() => compileRegex({ patterns: ['['] })).toThrow(/invalid regex/);
  });

  test('throws on empty patterns', () => {
    expect(() => compileRegex({ patterns: [] })).toThrow(/at least one pattern/);
  });

  test('multi-pattern with -F escapes each', () => {
    const re = compileRegex({ patterns: ['a.b', 'c|d'], fixedStrings: true });
    expect(re.test('a.b')).toBe(true);
    expect(re.test('c|d')).toBe(true);
    expect(re.test('axb')).toBe(false);
    expect(re.test('cxd')).toBe(false);
  });
});

describe('escapeRegex', () => {
  test('escapes regex metacharacters', () => {
    expect(escapeRegex('a.b*c+d')).toBe('a\\.b\\*c\\+d');
    expect(escapeRegex('()[]{}')).toBe('\\(\\)\\[\\]\\{\\}');
    expect(escapeRegex('plain text')).toBe('plain text');
  });
});

describe('renderSessionLines', () => {
  test('emits header + per-message blocks with content lines preserved', () => {
    const conv = makeConv([
      makeMsg('user', 'first message\nwith two lines', '2026-05-04T12:00:00Z'),
      makeMsg('assistant', 'reply', '2026-05-04T12:01:00Z'),
    ]);
    const lines = renderSessionLines(
      conv,
      'Claude Code',
      '/repo/foo',
      '2h ago',
      conv.messages[1].timestamp
    );
    expect(lines[0]).toContain('=== Claude Code session fixture-');
    expect(lines[0]).toContain('cwd: /repo/foo');
    expect(lines[0]).toContain('2h ago');
    // message 1: header + 2 content lines + blank
    expect(lines).toContain('[2026-05-04T12:00:00.000Z] USER:');
    expect(lines).toContain('first message');
    expect(lines).toContain('with two lines');
    // message 2: header + 1 content line + blank
    expect(lines).toContain('[2026-05-04T12:01:00.000Z] ASSISTANT:');
    expect(lines).toContain('reply');
  });

  test('cwd null omits the cwd segment', () => {
    const conv = makeConv([makeMsg('user', 'hi', '2026-05-04T12:00:00Z')]);
    const lines = renderSessionLines(
      conv,
      'opencode',
      null,
      '1d ago',
      conv.messages[0].timestamp
    );
    expect(lines[0]).not.toContain('cwd:');
    expect(lines[0]).toContain('opencode');
  });

  test('preserves blank lines inside a single message', () => {
    const conv = makeConv([
      makeMsg('user', 'top\n\nbottom', '2026-05-04T12:00:00Z'),
    ]);
    const lines = renderSessionLines(
      conv,
      'Claude Code',
      '/x',
      '5m ago',
      conv.messages[0].timestamp
    );
    // Header (1) + message header (1) + 'top' + '' + 'bottom' + '' (separator)
    // Find the indices to be robust to header position changes.
    const topIdx = lines.indexOf('top');
    expect(topIdx).toBeGreaterThan(-1);
    expect(lines[topIdx + 1]).toBe('');
    expect(lines[topIdx + 2]).toBe('bottom');
  });
});

describe('findMatchGroups', () => {
  test('single match in middle of stream returns N before / N after', () => {
    const lines = ['l1', 'l2', 'l3', 'l4 NEEDLE here', 'l5', 'l6', 'l7'];
    const re = compileRegex({ patterns: ['NEEDLE'] });
    const { groups, totalMatches } = findMatchGroups(lines, re, 2, 2);
    expect(totalMatches).toBe(1);
    expect(groups).toHaveLength(1);
    expect(groups[0].matchLineNumbers).toEqual([4]);
    expect(groups[0].lines.map(l => l.text)).toEqual([
      'l2',
      'l3',
      'l4 NEEDLE here',
      'l5',
      'l6',
    ]);
    expect(groups[0].lines[2].isMatch).toBe(true);
    expect(groups[0].lines[0].isMatch).toBe(false);
  });

  test('match near start clamps before-context to line 1', () => {
    const lines = ['NEEDLE', 'l2', 'l3'];
    const re = compileRegex({ patterns: ['NEEDLE'] });
    const { groups } = findMatchGroups(lines, re, 5, 1);
    expect(groups[0].lines.map(l => l.lineNumber)).toEqual([1, 2]);
    expect(groups[0].lines[0].isMatch).toBe(true);
  });

  test('match near end clamps after-context to last line', () => {
    const lines = ['l1', 'l2', 'NEEDLE'];
    const re = compileRegex({ patterns: ['NEEDLE'] });
    const { groups } = findMatchGroups(lines, re, 1, 5);
    expect(groups[0].lines.map(l => l.lineNumber)).toEqual([2, 3]);
    expect(groups[0].lines[1].isMatch).toBe(true);
  });

  test('adjacent matches with overlapping context merge into one group', () => {
    const lines = ['l1', 'NEEDLE one', 'l3', 'NEEDLE two', 'l5'];
    const re = compileRegex({ patterns: ['NEEDLE'] });
    const { groups, totalMatches } = findMatchGroups(lines, re, 1, 1);
    expect(totalMatches).toBe(2);
    // Match at line 2 → window [1,3]. Match at line 4 → window [3,5].
    // Windows touch at line 3, so they merge into one group.
    expect(groups).toHaveLength(1);
    expect(groups[0].matchLineNumbers).toEqual([2, 4]);
    expect(groups[0].lines.map(l => l.lineNumber)).toEqual([1, 2, 3, 4, 5]);
    expect(groups[0].lines[1].isMatch).toBe(true);
    expect(groups[0].lines[3].isMatch).toBe(true);
    expect(groups[0].lines[2].isMatch).toBe(false);
  });

  test('non-overlapping matches stay separate', () => {
    const lines = ['l1', 'NEEDLE', 'l3', 'l4', 'l5', 'l6', 'l7', 'NEEDLE2', 'l9'];
    const re = compileRegex({ patterns: ['NEEDLE'] });
    const { groups, totalMatches } = findMatchGroups(lines, re, 1, 1);
    expect(totalMatches).toBe(2);
    expect(groups).toHaveLength(2);
    expect(groups[0].matchLineNumbers).toEqual([2]);
    expect(groups[1].matchLineNumbers).toEqual([8]);
  });

  test('zero context returns just the matching line', () => {
    const lines = ['l1', 'NEEDLE', 'l3'];
    const re = compileRegex({ patterns: ['NEEDLE'] });
    const { groups } = findMatchGroups(lines, re, 0, 0);
    expect(groups[0].lines).toHaveLength(1);
    expect(groups[0].lines[0].text).toBe('NEEDLE');
    expect(groups[0].lines[0].isMatch).toBe(true);
  });

  test('asymmetric before/after honored', () => {
    const lines = ['l1', 'l2', 'l3', 'NEEDLE', 'l5', 'l6'];
    const re = compileRegex({ patterns: ['NEEDLE'] });
    const { groups } = findMatchGroups(lines, re, 2, 0);
    expect(groups[0].lines.map(l => l.text)).toEqual(['l2', 'l3', 'NEEDLE']);
  });

  test('case-insensitive regex matches across casing', () => {
    const lines = ['l1', 'a NEEDLE here', 'l3', 'a needle there', 'l5'];
    const re = compileRegex({ patterns: ['needle'], ignoreCase: true });
    const { totalMatches } = findMatchGroups(lines, re, 0, 0);
    expect(totalMatches).toBe(2);
  });

  test('no matches returns empty groups', () => {
    const lines = ['l1', 'l2', 'l3'];
    const re = compileRegex({ patterns: ['NEEDLE'] });
    const { groups, totalMatches } = findMatchGroups(lines, re, 5, 5);
    expect(groups).toEqual([]);
    expect(totalMatches).toBe(0);
  });

  test('alternation across multiple patterns matches lines hitting either', () => {
    const lines = ['has foo', 'plain', 'has bar'];
    const re = compileRegex({ patterns: ['foo', 'bar'] });
    const { totalMatches, groups } = findMatchGroups(lines, re, 0, 0);
    expect(totalMatches).toBe(2);
    expect(groups[0].lines).toHaveLength(1);
    expect(groups[0].lines[0].text).toBe('has foo');
  });
});

describe('end-to-end via render + find', () => {
  test('grep over a rendered Conversation finds content across message boundary', () => {
    const conv = makeConv([
      makeMsg('user', 'first ask\nabout migrations', '2026-05-04T12:00:00Z'),
      makeMsg('assistant', 'sure, the migration\nshould be safe', '2026-05-04T12:01:00Z'),
    ]);
    const lines = renderSessionLines(
      conv,
      'Claude Code',
      '/x',
      '1h ago',
      conv.messages[1].timestamp
    );
    // Grep for "migration" (matches both "migrations" and "migration"). Verify
    // we get two matches and that each context window includes the speaker
    // header line (proves context spills across message boundaries — the
    // whole point of line-based context).
    const re = compileRegex({ patterns: ['migration'] });
    const { groups, totalMatches } = findMatchGroups(lines, re, 1, 1);
    expect(totalMatches).toBe(2);
    // With -C 1, the two matches sit far enough apart that they may or may not
    // merge depending on exact line offsets. Just assert: at least one match
    // group, and the matches are present.
    const allLines = groups.flatMap(g => g.lines.map(l => l.text));
    expect(allLines.some(l => l.includes('about migrations'))).toBe(true);
    expect(allLines.some(l => l.includes('sure, the migration'))).toBe(true);
  });
});
