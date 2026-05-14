/**
 * Whisper — neighborhood-aware verbatim readout.
 *
 * Sits between `snap` (single cwd, verbatim) and `gossip` (LLM compaction over
 * whisper). Resolves the cwd into its conceptual sibling family and snaps each
 * member with a per-member byte budget. Output is the combined verbatim text,
 * grouped by repo. No LLM in the path — pure read.
 */

import { snap, type SnapOptions, type SnapResult } from './snap.js';
import { resolveNeighborhood, type NeighborhoodEntry } from './neighborhood.js';

export interface WhisperOptions extends SnapOptions {
  /**
   * If true, skip neighborhood expansion and only collect the cwd itself.
   * Default false — whisper resolves cwd into its conceptual sibling family
   * (e.g. `6digit-studio` brings the full `6digit-*` cluster) and treats the
   * neighborhood as one project family.
   */
  cwdOnly?: boolean;
}

export interface WhisperBlock {
  member: NeighborhoodEntry;
  source: SnapResult;
}

export interface WhisperResult {
  /** The cwd whisper was anchored on. */
  cwd: string;
  /** Combined verbatim text, grouped by repo with `## <name>` headers. */
  text: string;
  /** Total bytes of the combined text. */
  bytes: number;
  /** Sum of sessionsIncluded across contributing members. */
  sessionsIncluded: number;
  /** Sum of turnsIncluded across contributing members. */
  turnsIncluded: number;
  /** True if any member's snap was budget-truncated, or the total budget was exhausted. */
  truncated: boolean;
  /** Neighborhood resolved for the cwd (self first). */
  neighborhood: NeighborhoodEntry[];
  /** Per-member snap results in the order they were collected. */
  blocks: WhisperBlock[];
  /** True if at least one member contributed sessions. */
  emitted: boolean;
}

export function whisper(opts: WhisperOptions = {}): WhisperResult {
  const cwd = opts.cwd ?? process.cwd();
  const totalBytes = opts.bytes ?? 4000;

  const neighborhood = opts.cwdOnly
    ? [{ path: cwd, name: cwd.split('/').pop() ?? cwd, score: Infinity, matchedTokens: [] }]
    : resolveNeighborhood(cwd);

  const self = neighborhood[0]; // resolveNeighborhood guarantees self first

  // Per-member budget. Floor so a tiny share still yields one usable session.
  // Self gets a 2× multiplier so the cwd itself stays the gravitational center.
  const memberCount = neighborhood.length;
  const perMemberBudget = Math.max(800, Math.floor(totalBytes / Math.max(memberCount, 1)));

  const blocks: WhisperBlock[] = [];
  let collectedBytes = 0;

  for (const member of neighborhood) {
    const isSelf = member.path === self.path;
    const memberBytes = Math.min(
      isSelf ? perMemberBudget * 2 : perMemberBudget,
      Math.max(0, totalBytes - collectedBytes)
    );
    if (memberBytes < 400) break; // not enough budget left to bother

    const memberSource = snap({
      cwd: member.path,
      bytes: memberBytes,
      turnsPerSession: opts.turnsPerSession,
      maxSessions: opts.maxSessions ?? (isSelf ? 5 : 2),
      maxMessageBytes: opts.maxMessageBytes,
      liveSessionWindowMs: opts.liveSessionWindowMs,
      includeCurrent: opts.includeCurrent,
      includeSdkCli: opts.includeSdkCli,
    });
    if (memberSource.sessionsIncluded === 0) continue;
    blocks.push({ member, source: memberSource });
    collectedBytes += memberSource.bytes;
  }

  const combinedText = blocks
    .map((b) => `## ${b.member.name}\n\n${b.source.text}`)
    .join('\n');

  return {
    cwd,
    text: combinedText,
    bytes: Buffer.byteLength(combinedText, 'utf-8'),
    sessionsIncluded: blocks.reduce((sum, b) => sum + b.source.sessionsIncluded, 0),
    turnsIncluded: blocks.reduce((sum, b) => sum + b.source.turnsIncluded, 0),
    truncated: blocks.some((b) => b.source.truncated) || collectedBytes >= totalBytes,
    neighborhood,
    blocks,
    emitted: blocks.length > 0,
  };
}
