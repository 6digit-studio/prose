/**
 * Chronicle sinks — where a beat goes once it's recorded.
 *
 * The durable log (memory.ts) is always written; sinks are optional, additive
 * push targets. Discord is the first sink, ported in behavior from Koru's
 * scripts/post-dev-note.js (the battle-tested emitter we're generalizing).
 *
 * Each sink type is a standalone function so adding the next one (CORDIAL,
 * Slack, …) is a new function, not a fork of the CLI action. The CLI never
 * gates posting — it dumbly records and emits whatever it's handed; the bar
 * for "excited enough" lives in the skill/agent reading the charter.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const DISCORD_LIMIT = 2000;
const ENV_DISCORD_WEBHOOK = 'PROSE_CHRONICLE_DISCORD_WEBHOOK';

export type Enthusiasm = 'reserved' | 'balanced' | 'high' | 'unhinged';

export interface DiscordSink {
  webhook: string;
  channel?: string;   // human label only; the webhook already targets a channel
  username?: string;  // overrides the webhook's display name — how an author IDs themselves
}

export interface ChronicleConfig {
  /** Freeform charter — read by the skill to set voice + the bar for posting. */
  about?: string;
  /** How low the bar is to post. Prompt-level dial, not enforced in code. */
  enthusiasm?: Enthusiasm;
  sinks?: {
    discord?: DiscordSink;
  };
}

/** Path to the per-repo chronicle config (gitignored — it carries the secret webhook). */
export function getChronicleConfigPath(cwd: string): string {
  return join(cwd, '.claude', 'prose', 'chronicle.json');
}

/**
 * Load the per-repo chronicle config. Returns null when there's no config file
 * — chronicling works locally before any sink is wired, so "no config" is not
 * an error. The Discord webhook can also come from the environment (CI /
 * headless), which takes precedence over the file.
 */
export function loadChronicleConfig(cwd: string): ChronicleConfig | null {
  const path = getChronicleConfigPath(cwd);
  let config: ChronicleConfig | null = null;
  if (existsSync(path)) {
    config = JSON.parse(readFileSync(path, 'utf-8')) as ChronicleConfig;
  }

  const envWebhook = process.env[ENV_DISCORD_WEBHOOK];
  if (envWebhook) {
    config = config ?? {};
    config.sinks = config.sinks ?? {};
    config.sinks.discord = { ...config.sinks.discord, webhook: envWebhook };
  }

  return config;
}

/**
 * Render a beat into Discord message content. Ported verbatim in behavior from
 * post-dev-note.js:72-77 — `**<emoji> <title>**`, then the trimmed body on the
 * next line (header alone if there's no body).
 */
export function buildContent(emoji: string | undefined, title: string, body?: string): string {
  const prefix = emoji ? `${emoji} ` : '';
  const header = `**${prefix}${title.trim()}**`;
  const trimmed = (body ?? '').trim();
  return trimmed ? `${header}\n${trimmed}` : header;
}

/**
 * Emit content to a Discord webhook.
 *
 * Refuses to truncate: Discord's 2000-char ceiling is the enforced design
 * constraint, not a thing to silently cut around — over-limit throws and tells
 * you to shorten. Fails loudly on non-2xx with the actual status + body. No
 * silent swallow. (post-dev-note.js:98-124)
 */
export async function emitToDiscord(sink: DiscordSink, content: string): Promise<void> {
  if (content.length > DISCORD_LIMIT) {
    throw new Error(
      `Beat is ${content.length} chars; Discord limit is ${DISCORD_LIMIT}. ` +
      `Refusing to truncate — shorten the beat.`
    );
  }

  const url = new URL(sink.webhook);
  url.searchParams.set('wait', 'true');

  const payload: Record<string, unknown> = { content };
  if (sink.username) payload.username = sink.username;

  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Discord webhook failed: ${res.status} ${text}`);
  }
}
