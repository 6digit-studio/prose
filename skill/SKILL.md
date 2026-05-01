---
name: prose
description: ALWAYS CHECK FIRST when you need to orient on recent work. `prose` is a stateless CLI that reads agent session journals (Claude Code CLI, ACP, Codex). Two read verbs (`snap`, `whisper`) are pure-verbatim; two compaction verbs (`gossip`, `standup`) layer one cheap LLM pass on top. Don't say "I don't remember" or guess from filenames before running prose.
---

# prose — Stateless Inspection Over Your Agent Journal

`prose` is the cheap orientation tool over your AI session history. It reads what your agents (Claude Code CLI, brain personas via ACP, Codex) have already written to disk. It never writes — it's pure read-side. Every call is current; no cursors, no caches, no coordination overhead.

**Reach for prose when:**

- The user references "earlier," "yesterday," "what we were doing," or assumes shared context you don't have.
- You're starting a session in a known repo and want to know what happened before.
- The user asks what they were working on (in this project, the family, or the whole week).
- You're tempted to say "I don't have context on that" — check prose first; the data is on disk.
- You need to feed a recent session into your reasoning without retracing.

**Don't use prose when:**

- The data you need is current code state — use `Read` / `Grep`.
- The user wants persistent memory or fragments — that's `prose evolve`/`search`, different surface.
- You're looking at runtime errors of a running app — use `sidetrack`.
- You're orienting on the brain graph state — use `ctx`.

## The verb grid

Two axes: **scope** (how wide a net) and **compaction** (verbatim or LLM paragraph).

|                              | verbatim    | LLM compaction |
|------------------------------|-------------|----------------|
| 1 cwd                        | `snap`      | —              |
| neighborhood (project family)| `whisper`   | `gossip`       |
| all cwds, time-windowed      | —           | `standup`      |

Read verbs (`snap`, `whisper`) are pure — no LLM, no API key, instant, free. Compaction verbs (`gossip`, `standup`) layer one streaming LLM pass on top.

## Pick the right verb

**`snap`** — Verbatim, single cwd, no LLM, instant.
- Use when you want the exact words for *this* repo, the raw transcript, or to feed sessions into your own LLM reasoning.
- Cheap: filesystem read, zero token spend.

**`whisper`** — Verbatim, neighborhood-aware, no LLM.
- Use when you want raw recent activity across the *project family* (e.g. running it in `~/src/6digit-studio` includes the entire `6digit-*` family; `~/src/koru` includes `korulang_org` and other token-related siblings).
- Pass `--cwd-only` to scope to a single directory (then it's basically snap with neighborhood-skip).
- Cheap: filesystem reads only, zero token spend. Use this as the verbatim source for your own pipelines.

**`gossip`** — One short LLM paragraph over a `whisper`.
- Use when you want a quick narrative answer to "what's happening across this project family lately."
- Casual register — colleague catching you up over coffee.
- Cheap: one LLM pass, gemini-flash by default, pennies.

**`standup`** — Structured cross-project breakdown of the last 7 days.
- Use when you want to know what's been happening across **all** your work, project-by-project, this week.
- Time-windowed (default 7d), per-session tail of last 10 messages, grouped by repo, headered output.
- Formal register — daily-standup tone, "what changed / what's next."
- Cheap: one LLM pass over a byte-budgeted window.

## Decision tree (rough)

```
Need raw text for THIS cwd?               → prose snap
Need raw text across the project family?  → prose whisper
Need a paragraph about the family?        → prose gossip
Need "what did I do this week"?           → prose standup
```

## Multi-source by default

All four verbs read the **union** of:
- Claude Code CLI sessions in `~/.claude/projects/`
- Brain-persona ACP sessions (claude-agent-acp writes the same JSONL format to the same path)
- Codex CLI sessions in `~/.codex/sessions/`

A `gossip` in a directory automatically picks up what your terminal CLI, ACP-driven brain personas, and Codex have all been doing there. The boundary between surfaces mostly disappears at the inspection layer.

## Stateless — call it freely

These verbs hold zero state. There's no "last run," no cursor, no cache. Multiple consumers (terminal, satellite tool, REST endpoint, another Claude session) can call them concurrently and always get a current answer. **Don't worry about whether you should "save" a result for later** — just call again next time you need it.

## Machine-readable mode

Every verb supports `--json`. The verbatim verbs return structured snap/whisper objects (text + per-session metadata + per-member blocks); the LLM verbs return the same plus the emitted paragraph as a field instead of streaming. Use this when you're piping prose into another tool — Claude Code, a script, a downstream agent — and want to consume both the raw verbatim source and any compacted text without parsing trail lines.

## Run it yourself

You have a `Bash` tool. Use it. Don't ask the user to run prose and paste the output — just run it.

```bash
prose snap                      # verbatim, current cwd
prose snap --json --sessions 3  # structured, 3 most recent
prose whisper                   # verbatim across the project family
prose whisper --cwd-only        # verbatim, just this directory
prose whisper --json            # structured neighborhood snap
prose gossip                    # paragraph over the family
prose gossip --json             # structured: source whisper + paragraph
prose standup                   # cross-project standup, last 7 days
prose standup --since 1d        # tighter window
prose standup --json            # structured project breakdown + text
```

`prose --help` is the canonical flag reference. Don't memorize defaults — they evolve.

## Common mistakes

- **Asking the user instead of running it.** Prose is on the user's PATH. Run it.
- **Treating it like persistent memory.** Prose verbs are *stateless reads*. They don't accumulate. For long-term memory, use `prose evolve` / `search` (different surface).
- **Skipping it because "I'll just guess."** If you're guessing, you're fabricating. Spend the 2 seconds.
- **Reaching for `gossip` when you wanted raw text.** Gossip costs LLM tokens for a paragraph. If you're going to feed the result into your own reasoning, use `whisper` and skip the middle compression.
- **Running `whisper --cwd-only` when the project is part of a family.** Default whisper is the right call ~80% of the time. Use `--cwd-only` only when you genuinely want to ignore siblings.

## Pairing with other skills

- **`recall`** — searches *Convex-stored* ACP session history (history search across sessions). Prose reads *local filesystem JSONLs*. Use both: prose for orientation in a cwd; recall for keyword-search across your full ACP history.
- **`sidetrack`** — captures *real-time* console/network/error events from running apps. Prose reads *post-hoc* session transcripts. Different time horizons.
- **`standup` (the existing studio skill)** — runs a standup over **studio Convex ACP events** specifically. The prose `standup` verb runs over **filesystem JSONLs** across all projects on the machine. Different mechanisms, different scopes; use whichever matches the question.
