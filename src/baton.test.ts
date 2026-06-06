import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { join } from 'path';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import {
  setBaton,
  listBatons,
  clearBatons,
  parseBatonLine,
  renderBatonLine,
  getBatonStorePath,
  captureCorrelationKeys,
} from './baton.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'prose-baton-'));
  process.env.PROSE_BATON_STORE = join(dir, 'batons.json');
});

afterEach(() => {
  delete process.env.PROSE_BATON_STORE;
  rmSync(dir, { recursive: true, force: true });
});

describe('parseBatonLine', () => {
  test('parses the canonical ↪ LABEL: body form', () => {
    expect(parseBatonLine('↪ HANDOFF: position · next: ship it')).toEqual({
      type: 'handoff',
      content: 'position · next: ship it',
    });
  });

  test('the sigil is optional', () => {
    expect(parseBatonLine('DECISION: chose option B')).toEqual({
      type: 'decision',
      content: 'chose option B',
    });
  });

  test('returns null for a plain line with no label', () => {
    expect(parseBatonLine('just some prose, no marker')).toBeNull();
  });

  test('returns null when the body is empty', () => {
    expect(parseBatonLine('↪ HANDOFF:')).toBeNull();
  });
});

describe('setBaton', () => {
  test('stores a typed baton and persists it', () => {
    const b = setBaton({ content: 'wired up cursor', type: 'handoff', cwd: '/proj/a' });
    expect(b.type).toBe('handoff');
    expect(b.project).toBe('/proj/a');
    expect(b.content).toBe('wired up cursor');
    expect(b.id).toBeTruthy();
    expect(existsSync(getBatonStorePath())).toBe(true);
  });

  test('derives the type from a ↪ LABEL: prefix when --type is absent', () => {
    const b = setBaton({ content: '↪ DECISION: store, not scrape', cwd: '/proj/a' });
    expect(b.type).toBe('decision');
    expect(b.content).toBe('store, not scrape');
  });

  test('explicit type wins over the parsed prefix', () => {
    const b = setBaton({ content: '↪ DECISION: foo', type: 'handoff', cwd: '/proj/a' });
    expect(b.type).toBe('handoff');
    expect(b.content).toBe('foo');
  });

  test('defaults the type to "baton" for plain content', () => {
    const b = setBaton({ content: 'no label here', cwd: '/proj/a' });
    expect(b.type).toBe('baton');
    expect(b.content).toBe('no label here');
  });

  test('refuses an empty baton', () => {
    expect(() => setBaton({ content: '   ', cwd: '/proj/a' })).toThrow();
  });
});

describe('listBatons', () => {
  test('returns the latest baton per (project, type) by default — not a backlog', () => {
    setBaton({ content: 'first', type: 'handoff', cwd: '/proj/a' });
    setBaton({ content: 'second', type: 'handoff', cwd: '/proj/a' });
    setBaton({ content: 'third', type: 'handoff', cwd: '/proj/a' });

    const latest = listBatons({ cwd: '/proj/a' });
    expect(latest).toHaveLength(1);
    expect(latest[0].content).toBe('third');
  });

  test('keeps distinct types and distinct projects separate', () => {
    setBaton({ content: 'a-handoff', type: 'handoff', cwd: '/proj/a' });
    setBaton({ content: 'a-decision', type: 'decision', cwd: '/proj/a' });
    setBaton({ content: 'b-handoff', type: 'handoff', cwd: '/proj/b' });

    expect(listBatons()).toHaveLength(3); // 2 types in a, 1 in b
    expect(listBatons({ cwd: '/proj/a' })).toHaveLength(2);
    expect(listBatons({ cwd: '/proj/a', type: 'handoff' })).toHaveLength(1);
  });

  test('history mode returns every baton', () => {
    setBaton({ content: 'first', type: 'handoff', cwd: '/proj/a' });
    setBaton({ content: 'second', type: 'handoff', cwd: '/proj/a' });
    expect(listBatons({ cwd: '/proj/a', history: true })).toHaveLength(2);
  });

  test('is newest-first', () => {
    setBaton({ content: 'older', type: 'handoff', cwd: '/proj/a' });
    setBaton({ content: 'newer', type: 'decision', cwd: '/proj/a' });
    const all = listBatons({ cwd: '/proj/a' });
    expect(all[0].content).toBe('newer');
  });
});

describe('clearBatons', () => {
  test('clears by project', () => {
    setBaton({ content: 'a', type: 'handoff', cwd: '/proj/a' });
    setBaton({ content: 'b', type: 'handoff', cwd: '/proj/b' });
    const removed = clearBatons({ cwd: '/proj/a' });
    expect(removed).toBe(1);
    expect(listBatons({ history: true })).toHaveLength(1);
    expect(listBatons()[0].project).toBe('/proj/b');
  });

  test('clears by type across projects', () => {
    setBaton({ content: 'a', type: 'handoff', cwd: '/proj/a' });
    setBaton({ content: 'b', type: 'decision', cwd: '/proj/a' });
    setBaton({ content: 'c', type: 'handoff', cwd: '/proj/b' });
    expect(clearBatons({ type: 'handoff' })).toBe(2);
    expect(listBatons({ history: true })).toHaveLength(1);
  });

  test('--all wipes everything', () => {
    setBaton({ content: 'a', type: 'handoff', cwd: '/proj/a' });
    setBaton({ content: 'b', type: 'handoff', cwd: '/proj/b' });
    expect(clearBatons({ all: true })).toBe(2);
    expect(listBatons({ history: true })).toHaveLength(0);
  });

  test('refuses an unscoped clear without --all', () => {
    setBaton({ content: 'a', type: 'handoff', cwd: '/proj/a' });
    expect(() => clearBatons({})).toThrow();
    expect(listBatons({ history: true })).toHaveLength(1); // untouched
  });
});

describe('renderBatonLine', () => {
  test('renders the canonical form, uppercasing the label', () => {
    const b = setBaton({ content: 'position · next: X', type: 'handoff', cwd: '/proj/a' });
    expect(renderBatonLine(b)).toBe('↪ HANDOFF: position · next: X');
  });
});

describe('correlation keys', () => {
  test('captures known terminal/multiplexer env vars and ignores the rest', () => {
    const keys = captureCorrelationKeys({
      ZMX_SESSION: 'supa-abc',
      TMUX_PANE: '%3',
      HOME: '/home/x', // not a correlation var — ignored
      ZELLIJ_SESSION_NAME: '', // present but empty — ignored
    });
    expect(keys).toEqual({ ZMX_SESSION: 'supa-abc', TMUX_PANE: '%3' });
  });

  test('setBaton embeds captured keys on the baton (hidden metadata)', () => {
    const b = setBaton({
      content: 'x',
      type: 'handoff',
      cwd: '/proj/a',
      keys: { ZMX_SESSION: 'supa-1' },
    });
    expect(b.keys).toEqual({ ZMX_SESSION: 'supa-1' });
    // keys are never part of the rendered line
    expect(renderBatonLine(b)).toBe('↪ HANDOFF: x');
  });

  test('a key-matching baton wins over a newer non-matching one in the same (project,type)', () => {
    // older, but from THIS terminal
    setBaton({ content: 'mine', type: 'handoff', cwd: '/proj/a', keys: { ZMX_SESSION: 'supa-A' } });
    // newer, but a different terminal working the same project
    setBaton({ content: 'theirs', type: 'handoff', cwd: '/proj/a', keys: { ZMX_SESSION: 'supa-B' } });

    const top = listBatons({ cwd: '/proj/a', correlationKeys: { ZMX_SESSION: 'supa-A' } });
    expect(top).toHaveLength(1);
    expect(top[0].content).toBe('mine');
  });

  test('correlates on ANY shared key, not all of them', () => {
    setBaton({
      content: 'mine',
      type: 'handoff',
      cwd: '/proj/a',
      keys: { TMUX_PANE: '%1', ZMX_SESSION: 'supa-A' },
    });
    setBaton({ content: 'theirs', type: 'handoff', cwd: '/proj/a', keys: { ZMX_SESSION: 'supa-B' } });

    // current env shares only TMUX_PANE with the older baton
    const top = listBatons({
      cwd: '/proj/a',
      correlationKeys: { TMUX_PANE: '%1', ZMX_SESSION: 'supa-X' },
    });
    expect(top[0].content).toBe('mine');
  });

  test('falls back to newest-per-(project,type) when nothing matches', () => {
    setBaton({ content: 'old', type: 'handoff', cwd: '/proj/a', keys: { ZMX_SESSION: 'supa-A' } });
    setBaton({ content: 'new', type: 'handoff', cwd: '/proj/a', keys: { ZMX_SESSION: 'supa-B' } });
    const top = listBatons({ cwd: '/proj/a', correlationKeys: { ZMX_SESSION: 'supa-Z' } });
    expect(top[0].content).toBe('new');
  });

  test('no correlation keys at all behaves exactly like latest-wins', () => {
    setBaton({ content: 'first', type: 'handoff', cwd: '/proj/a', keys: { ZMX_SESSION: 'supa-A' } });
    setBaton({ content: 'second', type: 'handoff', cwd: '/proj/a', keys: { ZMX_SESSION: 'supa-B' } });
    const top = listBatons({ cwd: '/proj/a', correlationKeys: {} });
    expect(top[0].content).toBe('second');
  });
});
