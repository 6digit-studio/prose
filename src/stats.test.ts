/**
 * Tests for stats — exercises the pure aggregation core (mergeIntervals,
 * computeStats, localDayKey, renderCsv) against synthetic stamp fixtures.
 * Disk-level discovery and parsing are out of scope here; they're covered by
 * smoke runs against the real vault.
 *
 * Day bucketing uses LOCAL time, so fixtures construct timestamps via the
 * local-time Date constructor (year, month, day, h, m) — never ISO strings —
 * to stay timezone-independent.
 */
import { describe, expect, test } from 'bun:test';
import {
  cachePathFor,
  computeStats,
  localDayKey,
  mergeIntervals,
  readCacheEntry,
  renderCsv,
  writeCacheEntry,
  type MessageStamp,
  type StampCacheEntry,
} from './stats.js';

/** Local-time timestamp helper: local(2026, 6, 4, 22, 30) → epoch ms. */
function local(year: number, month: number, day: number, hour = 0, minute = 0): number {
  return new Date(year, month - 1, day, hour, minute).getTime();
}

function stamp(
  t: number,
  role: 'user' | 'assistant' = 'user',
  overrides: Partial<MessageStamp> = {}
): MessageStamp {
  return {
    t,
    role,
    sourceType: 'claude-code',
    sessionId: 'session-a',
    cwd: '/Users/larsde/src/prose',
    ...overrides,
  };
}

const MIN = 60_000;
const GAP = 15 * MIN;

describe('mergeIntervals', () => {
  test('empty input yields no intervals', () => {
    expect(mergeIntervals([], GAP)).toEqual([]);
  });

  test('a lone stamp is a zero-width interval', () => {
    expect(mergeIntervals([1000], GAP)).toEqual([[1000, 1000]]);
  });

  test('stamps within the gap merge into one interval', () => {
    const t0 = local(2026, 6, 4, 10, 0);
    const times = [t0, t0 + 5 * MIN, t0 + 12 * MIN];
    expect(mergeIntervals(times, GAP)).toEqual([[t0, t0 + 12 * MIN]]);
  });

  test('a gap larger than the cutoff splits intervals', () => {
    const t0 = local(2026, 6, 4, 10, 0);
    const t1 = t0 + 60 * MIN;
    expect(mergeIntervals([t0, t0 + 5 * MIN, t1, t1 + 3 * MIN], GAP)).toEqual([
      [t0, t0 + 5 * MIN],
      [t1, t1 + 3 * MIN],
    ]);
  });

  test('a gap of exactly the cutoff still merges', () => {
    const t0 = local(2026, 6, 4, 10, 0);
    expect(mergeIntervals([t0, t0 + GAP], GAP)).toEqual([[t0, t0 + GAP]]);
  });
});

describe('computeStats', () => {
  test('empty input yields no days and zero totals', () => {
    const { days, totals, hourHistogram } = computeStats([], GAP);
    expect(days).toEqual([]);
    expect(totals.activeMs).toBe(0);
    expect(totals.userMessages).toBe(0);
    expect(totals.sessions).toBe(0);
    expect(totals.peakDay).toBeNull();
    expect(hourHistogram).toEqual(new Array(24).fill(0));
  });

  test('averages run over closed days only — the current day is excluded', () => {
    const now = local(2026, 6, 10, 14, 0);
    const stamps = [
      // closed day 06-09: 60 minutes
      stamp(local(2026, 6, 9, 10, 0)),
      stamp(local(2026, 6, 9, 11, 0)),
      // today 06-10 (partial): 10 minutes — must not dilute the average
      stamp(local(2026, 6, 10, 9, 0)),
      stamp(local(2026, 6, 10, 9, 10)),
    ];
    const { totals } = computeStats(stamps, 90 * MIN, now);
    expect(totals.activeDays).toBe(2); // both days still count as active
    expect(totals.averages).toEqual({
      activeMsPerDay: 60 * MIN,
      humanMsPerDay: 60 * MIN,
      closedActiveDays: 1,
    });
  });

  test('averages are null when the window holds only the current day', () => {
    const now = local(2026, 6, 10, 14, 0);
    const stamps = [stamp(local(2026, 6, 10, 9, 0)), stamp(local(2026, 6, 10, 9, 30))];
    const { totals } = computeStats(stamps, GAP, now);
    expect(totals.averages).toBeNull();
    expect(totals.activeDays).toBe(1);
  });

  test('peak day is the busiest day by active time', () => {
    const stamps = [
      // 06-03: 30 minutes of activity
      stamp(local(2026, 6, 3, 10, 0)),
      stamp(local(2026, 6, 3, 10, 30)),
      // 06-04: 70 minutes (two 35m bursts split by a 3h gap)
      stamp(local(2026, 6, 4, 9, 0)),
      stamp(local(2026, 6, 4, 9, 35)),
      stamp(local(2026, 6, 4, 13, 0)),
      stamp(local(2026, 6, 4, 13, 35)),
    ];
    const { totals } = computeStats(stamps, 60 * MIN);
    expect(totals.peakDay).toEqual({
      day: '2026-06-04',
      activeMs: 70 * MIN,
      humanMs: 70 * MIN,
    });
  });

  test('one continuous burst lands on one day with the right span', () => {
    const t0 = local(2026, 6, 4, 10, 0);
    const stamps = [
      stamp(t0, 'user'),
      stamp(t0 + 2 * MIN, 'assistant'),
      stamp(t0 + 10 * MIN, 'user'),
      stamp(t0 + 11 * MIN, 'assistant'),
    ];
    const { days, totals } = computeStats(stamps, GAP);
    expect(days).toHaveLength(1);
    expect(days[0].day).toBe('2026-06-04');
    expect(days[0].activeMs).toBe(11 * MIN);
    // Human intervals anchor on user messages only: 10:00 → 10:10.
    expect(days[0].humanMs).toBe(10 * MIN);
    expect(days[0].userMessages).toBe(2);
    expect(days[0].assistantMessages).toBe(2);
    expect(totals.activeDays).toBe(1);
  });

  test('an interval spanning local midnight splits across both days', () => {
    const t0 = local(2026, 6, 4, 23, 50);
    const stamps: MessageStamp[] = [];
    // Continuous activity 23:50 → 00:20, one stamp per 5 minutes.
    for (let i = 0; i <= 6; i++) stamps.push(stamp(t0 + i * 5 * MIN));
    const { days } = computeStats(stamps, GAP);
    expect(days.map(d => d.day)).toEqual(['2026-06-04', '2026-06-05']);
    expect(days[0].activeMs).toBe(10 * MIN);
    expect(days[1].activeMs).toBe(20 * MIN);
  });

  test('parallel sessions in the same window do not double-count active time', () => {
    const t0 = local(2026, 6, 4, 14, 0);
    const stamps = [
      stamp(t0, 'user', { sessionId: 'session-a' }),
      stamp(t0 + 1 * MIN, 'user', { sessionId: 'session-b' }),
      stamp(t0 + 9 * MIN, 'assistant', { sessionId: 'session-a' }),
      stamp(t0 + 10 * MIN, 'assistant', { sessionId: 'session-b' }),
    ];
    const { days, totals } = computeStats(stamps, GAP);
    expect(days[0].activeMs).toBe(10 * MIN); // union, not 19m sum
    expect(days[0].sessions).toBe(2);
    expect(totals.sessions).toBe(2);
  });

  test('distinct cwds and sources are counted per day and in totals', () => {
    const t0 = local(2026, 6, 4, 9, 0);
    const stamps = [
      stamp(t0, 'user', { cwd: '/a', sourceType: 'claude-code' }),
      stamp(t0 + MIN, 'user', { cwd: '/b', sourceType: 'cursor', sessionId: 'session-b' }),
      stamp(t0 + 2 * MIN, 'user', { cwd: '/a', sourceType: 'claude-code' }),
    ];
    const { days, totals } = computeStats(stamps, GAP);
    expect(days[0].projects).toBe(2);
    expect(days[0].sources).toEqual({ 'claude-code': 2, cursor: 1 });
    expect(totals.projects).toBe(2);
    expect(totals.sources).toEqual({ 'claude-code': 2, cursor: 1 });
  });

  test('hour histogram counts user messages only, by local hour', () => {
    const stamps = [
      stamp(local(2026, 6, 4, 22, 15), 'user'),
      stamp(local(2026, 6, 4, 22, 45), 'user'),
      stamp(local(2026, 6, 4, 22, 50), 'assistant'),
      stamp(local(2026, 6, 4, 3, 10), 'user'),
    ];
    const { hourHistogram } = computeStats(stamps, GAP);
    expect(hourHistogram[22]).toBe(2);
    expect(hourHistogram[3]).toBe(1);
    expect(hourHistogram.reduce((a, b) => a + b, 0)).toBe(3);
  });

  test('unsorted input is handled', () => {
    const t0 = local(2026, 6, 4, 10, 0);
    const { days } = computeStats([stamp(t0 + 10 * MIN), stamp(t0)], GAP);
    expect(days[0].activeMs).toBe(10 * MIN);
  });
});

describe('computeStats projects', () => {
  test('projects are ordered by last activity, newest first', () => {
    const t0 = local(2026, 6, 4, 9, 0);
    const stamps = [
      stamp(t0, 'user', { cwd: '/old', sessionId: 's-old' }),
      stamp(t0 + 60 * MIN, 'user', { cwd: '/new', sessionId: 's-new' }),
      stamp(t0 + 30 * MIN, 'user', { cwd: '/mid', sessionId: 's-mid' }),
    ];
    const { projects } = computeStats(stamps, GAP);
    expect(projects.map(p => p.cwd)).toEqual(['/new', '/mid', '/old']);
    expect(projects[0].lastActivity).toBe(new Date(t0 + 60 * MIN).toISOString());
  });

  test('per-project active time merges within the project, not globally', () => {
    const t0 = local(2026, 6, 4, 9, 0);
    // /a is active 9:00–9:10; /b posts single messages interleaved — its
    // stamps are 20m apart, beyond the gap, so /b accrues zero width.
    const stamps = [
      stamp(t0, 'user', { cwd: '/a' }),
      stamp(t0 + 5 * MIN, 'user', { cwd: '/b', sessionId: 's-b' }),
      stamp(t0 + 10 * MIN, 'user', { cwd: '/a' }),
      stamp(t0 + 25 * MIN, 'user', { cwd: '/b', sessionId: 's-b' }),
    ];
    const { projects } = computeStats(stamps, GAP);
    const a = projects.find(p => p.cwd === '/a')!;
    const b = projects.find(p => p.cwd === '/b')!;
    expect(a.activeMs).toBe(10 * MIN);
    expect(b.activeMs).toBe(0);
    expect(b.userMessages).toBe(2);
  });

  test('per-project counts and sources accumulate', () => {
    const t0 = local(2026, 6, 4, 9, 0);
    const stamps = [
      stamp(t0, 'user', { cwd: '/a', sourceType: 'claude-code', sessionId: 's1' }),
      stamp(t0 + MIN, 'assistant', { cwd: '/a', sourceType: 'claude-code', sessionId: 's1' }),
      stamp(t0 + 2 * MIN, 'user', { cwd: '/a', sourceType: 'cursor', sessionId: 's2' }),
    ];
    const { projects } = computeStats(stamps, GAP);
    expect(projects).toHaveLength(1);
    expect(projects[0].userMessages).toBe(2);
    expect(projects[0].assistantMessages).toBe(1);
    expect(projects[0].sessions).toBe(2);
    expect(projects[0].sources).toEqual({ 'claude-code': 2, cursor: 1 });
  });
});

describe('stamp cache', () => {
  const FIXTURE_PATH = '/fixtures/fake-session-for-cache-test.jsonl';

  function entry(overrides: Partial<StampCacheEntry> = {}): StampCacheEntry {
    return {
      version: 1,
      size: 1234,
      mtimeMs: 1750000000000,
      sessionId: 'cache-fixture',
      cwd: '/fixtures',
      stamps: [{ t: 1750000000000, role: 'user' }],
      ...overrides,
    };
  }

  test('round-trips an entry keyed on size + mtime', () => {
    writeCacheEntry(FIXTURE_PATH, entry());
    const back = readCacheEntry(FIXTURE_PATH, 1234, 1750000000000);
    expect(back).not.toBeNull();
    expect(back!.sessionId).toBe('cache-fixture');
    expect(back!.stamps).toEqual([{ t: 1750000000000, role: 'user' }]);
  });

  test('misses when the file grew (size changed)', () => {
    writeCacheEntry(FIXTURE_PATH, entry());
    expect(readCacheEntry(FIXTURE_PATH, 9999, 1750000000000)).toBeNull();
  });

  test('misses when mtime changed', () => {
    writeCacheEntry(FIXTURE_PATH, entry());
    expect(readCacheEntry(FIXTURE_PATH, 1234, 1750000099999)).toBeNull();
  });

  test('misses on unknown file', () => {
    expect(readCacheEntry('/fixtures/never-written.jsonl', 1, 1)).toBeNull();
  });

  test('cache path is stable and collision-scoped by full path', () => {
    expect(cachePathFor(FIXTURE_PATH)).toBe(cachePathFor(FIXTURE_PATH));
    expect(cachePathFor('/a/session.jsonl')).not.toBe(cachePathFor('/b/session.jsonl'));
  });
});

describe('localDayKey', () => {
  test('formats local calendar day with zero padding', () => {
    expect(localDayKey(local(2026, 6, 4, 12, 0))).toBe('2026-06-04');
    expect(localDayKey(local(2026, 11, 30, 23, 59))).toBe('2026-11-30');
  });
});

describe('renderCsv', () => {
  test('emits header plus one row per day', () => {
    const t0 = local(2026, 6, 4, 10, 0);
    const { days } = computeStats(
      [stamp(t0, 'user'), stamp(t0 + 30 * MIN, 'assistant', { sessionId: 'session-b' })],
      GAP
    );
    const csv = renderCsv(days);
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe(
      'day,active_hours,human_hours,user_messages,assistant_messages,sessions,projects'
    );
    expect(lines).toHaveLength(2);
    expect(lines[1].startsWith('2026-06-04,')).toBe(true);
  });
});
