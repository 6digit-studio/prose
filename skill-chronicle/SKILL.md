---
name: prose-chronicle
description: Arm the current coding session as a live dev-feed — post freeform "beats" (breakthroughs, ugly bugs, "oh shit it compiles" moments) to a durable log and any configured sink (Discord first). Fire when the user says "chronicle this", "chronicle this session", "let's chronicle", "arm chronicle", "post that as a beat", or otherwise asks to narrate what we're doing right now as a feed. This is a SIGN OF LIFE, not a commit log — the agent decides which moments are worth a beat, and the bar lives in the repo's charter, not in code.
---

# prose-chronicle — Narrate the session as a live feed

`prose chronicle` is a live dev-feed for a coding session. While you work, you
post terse, emoji-forward **beats** — the kind of thing a developer live-coding
on Discord would type when something lands. Each beat appends to a durable local
log (`~/.prose/projects/<name>.chronicle.json`) and, if a sink is configured,
emits to it (Discord first).

A beat is a **vibe, not a schema.** It's freeform prose — a title, optionally a
body and an emoji. It is NOT a structured fragment, it is never touched by
`prose evolve`, and it never gets reconciled or aged out. It's a discrete,
timestamped sign of life that you were here and something happened.

## When to arm

Arm chronicling when the user asks for it — "chronicle this session," "let's
chronicle," "arm chronicle," or when they react to a moment with "post that."
Once armed, **you** decide which moments earn a beat for the rest of the session.

**First thing after arming:** read the charter.

```bash
prose chronicle about
```

The charter tells you what this repo is chronicling and in what voice, plus the
**enthusiasm** dial that sets your bar. If there's no charter yet
(`No chronicle config yet`), don't build a backfill feature and don't guess —
just ask the user conversationally: *"What are we chronicling today, and in what
voice?"* The feed stays honest: it only contains beats that happened while it
was live.

## The bar — the enthusiasm dial

The CLI never gates posting; it dumbly records whatever you hand it. The
judgment — how excited is "excited enough" — is **yours**, set by the charter's
`enthusiasm`:

- **reserved** — only genuine milestones. A feature works end-to-end; a hard bug
  is finally understood. A handful of beats per session.
- **balanced** — milestones plus notable turns: a nasty bug found, an approach
  abandoned, a surprising discovery.
- **high** — the default vibe. Breakthroughs, ugly bugs, "oh shit it compiles,"
  the moment a test goes green, a clever workaround. Frequent, but every one is
  a real moment.
- **unhinged** — narrate the rollercoaster. Near-misses, false starts, the
  swearing, the relief. Still real beats — never filler, never "starting now,"
  never a beat-per-commit.

**Never post on an artificial cadence** — not every commit, not on a timer, not
"checking in." A beat is posted because something genuinely happened. If nothing
did, post nothing.

## How to post a beat

```bash
prose chronicle "<title>" --emoji <e> --body "<the story, one or two lines>"
```

- Title is the headline. Keep it short — it's a tweet, not a paragraph.
- `--emoji` is a hint: 💡 found it · 🐛 bug · ✅ done/green · 🔥 shipped/hot ·
  🤯 surprise · 🧱 hit a wall · 🎉 win.
- `--body` is optional; it falls back to stdin if omitted. The body is where the
  flavor lives — terse, a little unhinged, emoji-forward.
- Add `--dry-run` to see exactly what would be recorded and where, without
  writing or posting. Useful the first time in a repo to confirm the sink.

Voice: write like you're live-coding on Discord. Terse. Present tense. A little
unhinged. The reader is a teammate watching the feed, not reading a changelog.

Examples:

```bash
prose chronicle "it compiles" --emoji 🔥 --body "first clean tsc in two hours. the generic was the problem the whole time."
prose chronicle "found the dangling symlink" --emoji 💡 --body "global prose pointed at the old prose-memory path. npm link fixed it."
prose chronicle "CORDIAL has no HTTP ingest" --emoji 🤯 --body "it's file-watch only. so the 'sink' is just pointing it at the durable log. cleaner than a push API."
```

## Sinks, secrecy, multi-user

- The **durable log is always written**; the sink is optional. Chronicling works
  locally before any webhook is wired — "no sink" is not an error.
- The sink config lives in `.claude/prose/chronicle.json` (gitignored — the
  Discord webhook is a secret; never commit it). Scaffold it with
  `prose chronicle init`, then fill in the webhook.
- **Multi-user is emergent**, not built: multiple authors point their own local
  config at one shared Discord channel. Each author sets their own `username` in
  the Discord sink so their beats are attributed automatically. The product
  never knows about teams — the channel is the integration point.

## Run it yourself

You have a `Bash` tool. Post beats yourself the moment they happen — don't ask
the user to run the command, and don't batch beats up to post at the end. The
feed is live; a beat posted three turns late isn't a sign of life.

## Common mistakes

- **Posting on a cadence instead of on genuine moments.** A beat-per-commit is
  noise. Wait for the real thing.
- **Writing a changelog entry instead of a beat.** It's a Discord message, not a
  release note. Terse and human, not formal.
- **Treating it as a fragment.** Chronicle beats live outside `evolve`/`search`.
  Don't expect them in semantic memory — they're a feed, not memory.
- **Committing the webhook.** `.claude/prose/chronicle.json` is gitignored for a
  reason. The webhook is a secret.
- **Truncating a long beat to fit.** The CLI refuses to truncate (2000-char
  Discord ceiling). That's the signal to shorten the beat, not to cut it.
