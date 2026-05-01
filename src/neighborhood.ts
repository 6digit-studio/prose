/**
 * Neighborhood resolver — answers "which sibling repos belong to the same
 * conceptual project as cwd?"
 *
 * Mechanism:
 *   1. Tokenize cwd basename on `-`, `_`, `.` (case-insensitive, min length 3)
 *   2. For each sibling in the parent directory, count how many cwd tokens
 *      appear as case-insensitive substrings in the sibling's name
 *   3. Weight each match by inverse-document-frequency over siblings — rare
 *      tokens (e.g. `6digit`, `koru`) are strong signal; common tokens
 *      (e.g. `test`, `app`) approach zero
 *   4. Sum scores per sibling; include those above a threshold
 *
 * Catches `korulang_org` for `koru`, the full `6digit-*` family for
 * `6digit-studio`, etc., without any config or manifest — just by reading
 * the structure the user already encoded into their parent directory.
 */

import { readdirSync, statSync } from 'fs';
import { dirname, basename, join } from 'path';

const MIN_TOKEN_LEN = 3;

export interface NeighborhoodEntry {
  /** Absolute path to the sibling repo directory. */
  path: string;
  /** Basename — what we'd display in headers. */
  name: string;
  /** Total IDF-weighted score. Higher = more strongly related. */
  score: number;
  /** Cwd tokens that hit this sibling (for explainability). */
  matchedTokens: string[];
}

export interface NeighborhoodOptions {
  /**
   * Minimum score for a sibling to be included. The cwd itself always
   * scores against itself (every cwd token matches), so the threshold is
   * applied to *non-self* siblings; self is always included.
   *
   * Default 0.05 — empirically keeps strong-token families together while
   * filtering out incidental name collisions on common tokens.
   */
  minScore?: number;
  /** Cap the neighborhood size (after self). Default 30. */
  maxSiblings?: number;
}

/**
 * Tokenize a basename: lowercase, split on `-`, `_`, `.`, drop tokens
 * shorter than MIN_TOKEN_LEN. Pure-numeric tokens are kept (e.g. `6digit`
 * tokenizes to ["6digit"], but "1" alone would be dropped by length).
 */
export function tokenize(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[-_.]+/)
    .filter((t) => t.length >= MIN_TOKEN_LEN);
}

/**
 * For each token, count how many siblings contain it as a substring.
 * Used as the denominator in IDF weighting.
 */
function buildSubstringFrequency(tokens: string[], siblings: string[]): Map<string, number> {
  const freq = new Map<string, number>();
  for (const t of tokens) {
    let n = 0;
    for (const s of siblings) {
      if (s.toLowerCase().includes(t)) n++;
    }
    freq.set(t, Math.max(n, 1)); // floor at 1 so log/inv math doesn't explode
  }
  return freq;
}

/**
 * Resolve the neighborhood for a cwd. Returns the cwd itself plus any
 * sibling whose IDF-weighted match score exceeds `minScore`. Empty array
 * if cwd has no readable parent directory.
 */
export function resolveNeighborhood(
  cwd: string,
  opts: NeighborhoodOptions = {}
): NeighborhoodEntry[] {
  const minScore = opts.minScore ?? 0.05;
  const maxSiblings = opts.maxSiblings ?? 30;

  const parent = dirname(cwd);
  const selfName = basename(cwd);
  if (!parent || parent === cwd) {
    return [{ path: cwd, name: selfName, score: Infinity, matchedTokens: [] }];
  }

  let siblingNames: string[];
  try {
    siblingNames = readdirSync(parent).filter((entry) => {
      try {
        return statSync(join(parent, entry)).isDirectory();
      } catch {
        return false;
      }
    });
  } catch {
    // Parent unreadable — fall back to self-only.
    return [{ path: cwd, name: selfName, score: Infinity, matchedTokens: [] }];
  }

  const cwdTokens = tokenize(selfName);
  if (cwdTokens.length === 0) {
    return [{ path: cwd, name: selfName, score: Infinity, matchedTokens: [] }];
  }

  const substringFreq = buildSubstringFrequency(cwdTokens, siblingNames);
  const totalSiblings = siblingNames.length || 1;

  type Scored = NeighborhoodEntry & { isSelf: boolean };
  const scored: Scored[] = [];

  for (const name of siblingNames) {
    if (name === selfName) {
      scored.push({
        path: join(parent, name),
        name,
        score: Infinity,
        matchedTokens: cwdTokens,
        isSelf: true,
      });
      continue;
    }
    const lower = name.toLowerCase();
    const matched: string[] = [];
    let score = 0;
    for (const t of cwdTokens) {
      if (lower.includes(t)) {
        matched.push(t);
        // IDF: rare tokens (small freq) → big weight; common tokens → small weight.
        // Use log(N/df) so it's bounded and well-behaved as freq → 1.
        const df = substringFreq.get(t)!;
        score += Math.log(1 + totalSiblings / df);
      }
    }
    if (matched.length === 0) continue;
    scored.push({
      path: join(parent, name),
      name,
      score,
      matchedTokens: matched,
      isSelf: false,
    });
  }

  // Self first, then non-self by descending score, threshold + cap applied
  // only to non-self entries.
  const self = scored.find((s) => s.isSelf);
  const others = scored
    .filter((s) => !s.isSelf && s.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxSiblings);

  const out: NeighborhoodEntry[] = [];
  if (self) out.push({ path: self.path, name: self.name, score: self.score, matchedTokens: self.matchedTokens });
  for (const o of others) out.push({ path: o.path, name: o.name, score: o.score, matchedTokens: o.matchedTokens });
  return out;
}
