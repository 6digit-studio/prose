# `prose chronicle` — design

> Status: BUILT — shipped in v0.8.0 (`src/sinks.ts`, `src/memory.ts` chronicle
> storage, the `chronicle` command group in `src/cli.ts`, `skill-chronicle/`).
> This doc is retained as the design record / rationale; it began as the handoff
> spec for the build. Everything below is grounded in reads of the real code
> (file:line references are to this repo at the time of writing).

## What it is

A live dev-feed for a coding session. The agent, while working, posts freeform
beats — breakthroughs, ugly bugs, "oh shit it compiles" moments — to a durable
local log and (optionally) to a Discord channel. It's a sign of life, not a
commit log. The vibe is a dev live-coding on Discord / a feed on X: terse, a
little unhinged, emoji-forward. **Not structured data.** A note is a vibe, not a
schema.

This is a faithful generalization of Koru's hand-run practice
(`koru/scripts/post-dev-note.js`): during sessions we called that script by hand
whenever something interesting happened. The cadence lived in the *practice*,
not the code. Chronicle ports that — the emitter is battle-tested, we're porting
it, not inventing it.

### Explicitly NOT in scope
- No structured fragment type. Chronicle entries are **not** part of
  `AllFragments` (`schemas.ts`) and are **never** touched by evolution. The
  horizontal "Sage" reconciles/compresses/ages-out fragments over time
  (`horizontal.ts`); a chronicle is the opposite — discrete, timestamped,
  append-only, never overwritten.
- No automation / interval timer / "post on every commit". Beats are posted when
  the agent is genuinely excited. The bar is a prompt-level dial, not code.
- No cross-user / team features. Multi-user is an emergent property of where the
  webhook points — multiple authors write one sink without coordination. The
  product never knows about teams. (This mirrors prose's own README philosophy:
  "multiple consumers read the same journal without coordination" — pushed one
  layer out to multiple *authors*.)
- No backfill. If the agent needs context at session start, it asks
  conversationally ("what are we chronicling today?"). Keeps the feed honest: it
  only contains beats that happened while it was live.

## Architecture (three layers)

```
SKILL  /prose-chronicle   — arms the session: reads the charter, then posts
                            beats as genuine discoveries happen. The agent
                            decides the beats. This is the soul of the practice.
        ↓ during the session, on each real beat ↓
CLI    prose chronicle "💡 found it" --emoji 💡   [--body|stdin] [--dry-run]
        ├─ 1. append to ~/.prose/projects/<name>.chronicle.json   (durable, never evolved)
        └─ 2. if a sink is configured, emit to it (Discord first)
```

The CLI **never gates posting** — it dumbly records whatever it's handed. The
bar (how excited is "excited enough") lives entirely in the skill/agent reading
the charter. Keeps the code stupid and the judgment where it belongs.

## Layer 1 — CLI (`src/cli.ts`)

New `chronicle` command group, same `commander` pattern as every other command
(`program.command(...).description(...).action(...)`, registered before the
final `program.parse()` at `cli.ts:2447`).

```
prose chronicle "<title>" [--emoji <e>] [--body <text>] [--dry-run]
    Record a beat. Body falls back to stdin if --body omitted (matches Koru).
    Appends to the durable log AND emits to the sink if one is configured.
    --dry-run prints the payload, writes nothing, posts nothing.

prose chronicle about
    Print the charter (the configured "about"/voice/enthusiasm) so the agent /
    user can see what this repo is chronicling and in what voice.

prose chronicle init
    Scaffold .claude/prose/chronicle.json with a commented template (charter +
    enthusiasm + empty sinks). Does not overwrite an existing file.
```

Content rendering is ported verbatim from `post-dev-note.js:72-77`:
`**<emoji> <title>**` then newline then trimmed body (header alone if no body).

## Layer 2 — Storage (`src/memory.ts`)

Append-only JSON log, one per project, living beside the existing per-project
files in `~/.prose/projects/`. New functions, modeled on the existing
`getProjectMemoryPath` / `getProjectVectorPath` family (`memory.ts:176-205`):

```ts
getChroniclePath(projectName: string): string
    // join(getMemoryDir(), 'projects', `${sanitized}.chronicle.json`)
    // same sanitize rule as siblings: replace(/[^a-zA-Z0-9-_]/g, '_')

loadChronicle(projectName: string): ChronicleEntry[]   // [] if absent
appendChronicleEntry(projectName: string, entry: ChronicleEntry): void
```

Entry envelope — the ONLY structure; the post itself is freeform prose:

```ts
interface ChronicleEntry {
  ts: string;       // ISO timestamp
  emoji?: string;
  title: string;
  body?: string;
}
```

This sits in the vault (`~/.prose/`), so it's git-backed and survives via the
existing `commitToVault` path (`memory.ts:149`) — but it is a standalone file,
NOT folded into `memory-index.json` and NOT a `ProjectMemory` field. It must not
go anywhere near `loadMemoryIndex` / evolution.

### Project-name resolution (grounded correction to the dump)

`detectProjectFromCwd()` (`cli.ts:90`) returns `undefined` when a repo has no
evolved memory and no discovered sessions. Chronicle's whole point is to work
from the first beat in a fresh repo, so it **must not** depend on that. Resolve:

```ts
const project = detectProjectFromCwd() ?? sanitizePath(process.cwd());
```

`sanitizePath` (`memory.ts:172`) gives the same key shape the index uses, so a
later `evolve` lands on the same project key. Display with `formatProjectName`
(`cli.ts:134`) for human-facing output.

## Layer 3 — Sinks / charter (per-repo config) — NEW capability

**Grounded fact:** prose has NO per-repo config today. All config is global, in
`memory-index.json` under the `config` key (`GlobalConfig`, `memory.ts:49-66`;
`getGlobalConfig`/`saveGlobalConfig`, `memory.ts:265-290`). The only keys that
exist are artifacts / mirrorMode / sourceExtensions / autoIndexSource /
vectorThreshold / API keys. None of that is a home for a per-repo webhook.

So chronicle introduces the first per-repo config file. This is deliberate and
mirrors how Koru actually split it: the committed script declared the *behavior*;
the secret webhook URL lived in `koru/.env.local` — per-repo and secret. We
generalize that split.

File: `.claude/prose/chronicle.json` (the `.claude/prose/` dir is already the
gitignored per-repo dir prose creates — see `cli.ts:223,251`). Shape:

```jsonc
{
  // the charter — freeform, read by the skill to set voice + bar
  "about": "Live-coding the Koru language. Post breakthroughs, ugly bugs, and 'oh shit it compiles' moments. Voice: terse, a little unhinged, emoji-forward.",

  // the enthusiasm dial — gates how low the bar is to post (prompt-level, not code)
  "enthusiasm": "high",   // reserved | balanced | high | unhinged

  "sinks": {
    "discord": { "webhook": "https://...", "channel": "#koru-dev-notes" }
  }
}
```

Rules:
- The **log is always written**; the sink is optional. Chronicling works locally
  before any webhook is wired. "No sink" is NOT an error.
- The webhook is a secret. `.claude/prose/` is already gitignored
  (`cli.ts:223` writes `.claude/prose/` into the ignore). Keep it that way; the
  charter+sink file carries the secret and must never be committed.
- Optional env override for the webhook (`PROSE_CHRONICLE_DISCORD_WEBHOOK`) so CI
  / headless runs can post without a file — same spirit as Koru reading the env
  first. Decide at build time; not required for MVP.

## Layer 4 — Emitter (port of `post-dev-note.js`)

Port the Discord emitter verbatim in behavior:
- `fetch` the webhook with `?wait=true` (`post-dev-note.js:114-120`).
- **Refuse to truncate.** 2000-char Discord ceiling is the enforced design
  constraint — over-limit errors and tells you to shorten
  (`post-dev-note.js:98-103`). This is load-bearing: it keeps notes short by
  construction. Do NOT add truncation. (Also aligns with the global rule: never
  truncate data.)
- On non-2xx, throw with the actual status + body (`post-dev-note.js:121-124`).
  Fail loudly — no silent swallow.

Put the emitter in its own module (e.g. `src/sinks.ts`) so adding a second sink
type later is a new function, not a fork of the CLI action.

## Layer 5 — `prose serve` render lane (PHASE 2, not MVP)

The web dashboard already has a Chronicle timeline (`web.ts` / `server.ts`).
A new "live feed" lane that renders `*.chronicle.json` as an X-style timeline is
the obvious phase-2 payoff. NOT yet read in detail, so not promised here. The
CLI + Discord loop is the MVP that delivers the actual joy; the web view is
gravy. Treat as a follow-up.

## Build order (MVP)

1. `memory.ts`: `ChronicleEntry`, `getChroniclePath`, `loadChronicle`,
   `appendChronicleEntry`. (Pure, testable.)
2. `sinks.ts`: `emitToDiscord(webhook, content)` ported from Koru, + a
   `loadChronicleConfig(cwd)` reader for `.claude/prose/chronicle.json`.
3. `cli.ts`: `chronicle` command group (`""`, `about`, `init`), wired to 1 + 2.
   Content rendering ported from `post-dev-note.js:72-77`.
4. `skill/` (or `/prose-chronicle`): a SKILL that arms the session — reads the
   charter, posts beats on genuine discoveries, voice/bar from `enthusiasm`.
   Model it on the existing `skill/SKILL.md`.
5. Verify end to end with `--dry-run` first, then a real post to a test webhook.

Koru is untouched. Its script stays as-is; we ported the mechanism, not the repo.
