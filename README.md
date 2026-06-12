# Prose 🧠

### **Your AI agents already write a journal. Prose reads it — so you catch up in seconds, not scrollback.**

> [!WARNING]
> **EXPERIMENTAL**: Some operations run LLM passes over your session history. Defaults are designed to be cheap (Gemini Flash, byte-budgeted), but be deliberate before automating aggressive multi-pass workflows.

Prose is a **universal semantic memory layer** for AI-driven engineering. It reads the journals your agents already write — Claude Code (CLI + ACP), Codex, opencode, and Cursor — and gives you three surfaces on top of them:

- **👁️‍🗨️ Sensory Verbs** — stateless, instant inspection of recent agent activity. Six pure read verbs (no LLM, no API key), two LLM-compaction verbs (one cheap pass, pennies), one deliberately stateful baton. These are the daily drivers.
- **📡 Chronicle** — a live dev-feed: post freeform "beats" from a coding session to a durable log and any configured sink.
- **🧬 Evolution** — opt-in long-term compression: turn months of session logs into structured **Decisions**, **Insights**, and **Narrative**, searchable semantically. ([How Evolution Works ↓](#-evolution--long-term-memory))

---

## 👁️‍🗨️ Sensory Verbs — Cheap, Stateless Inspection

|                                 | verbatim      | LLM compaction |
|---------------------------------|---------------|----------------|
| 1 cwd                           | **`snap`**    | —              |
| neighborhood (project family)   | **`whisper`** | **`gossip`**   |
| all cwds, time-windowed         | —             | **`standup`**  |
| all cwds, regex-targeted        | **`grep`**    | —              |
| all cwds, quantitative          | **`stats`**   | —              |
| 1 session by id                 | **`session`** | —              |
| 1 session, live (follow)        | **`tail`**    | —              |

- **`prose snap`** — Verbatim tail of recent sessions in the current cwd. The raw sensory input.
- **`prose whisper`** — Verbatim tail across the cwd **and its conceptual sibling repos** (a "project family"). Just `snap` widened to the whole family. Use this as the verbatim source for your own pipelines.
- **`prose gossip`** — One short LLM paragraph over a `whisper`. Casual register — colleague catching you up over coffee. Pennies per call.
- **`prose standup`** — Cross-project standup. 7-day window by default, grouped by project. A single LLM pass gives you a tight project-by-project narrative of your week. Formal register — "what changed / what's next."
- **`prose grep`** — Regex search across the **parsed session stream** — the words your agents actually said, not files on disk. Multiple patterns OR-alternate; output is grep-style with line numbers and ±N context lines. Global by default; `--cwd`, `--source`, `--since` to narrow.
- **`prose stats`** — Per-day activity metrics across every session: active hours (message timestamps merged with an idle-gap cutoff), "human" hours (user messages only), message volumes, distinct sessions and projects, and an hour-of-day histogram. `--csv` emits day rows for plotting; answers "how much am I actually doing this?"
- **`prose session <id>`** — Full verbatim readout of one session. Any unique id prefix works — the 8-char ids printed in snap/whisper/grep headers are direct handles.
- **`prose tail [id]`** — Follow a live session as it grows: initial backlog, then each new message as it lands. With an id prefix it pins that session; with none it picks the most recent session for the cwd (`--cwd` to point elsewhere, `--any` for globally newest). The observation deck for watching another agent work.
- **`prose baton`** — The one deliberately *stateful* verb: leave a typed "you are here" marker at sign-off (`prose baton set "↪ HANDOFF: …"`), read it back next session. Batons ride snap/whisper output as a header for free.

Every verb supports `--json` for machine-readable output: the verbatim verbs return structured objects (text + per-session metadata + per-member blocks); the LLM verbs return the same plus the emitted paragraph as a field instead of streaming.

The pure read verbs need **no API key and no setup** — `npm install`, `cd` into any project your agents have touched, and `prose snap` works.

### Project-Family Discovery (whisper / gossip)

`whisper` (and `gossip`, which builds on it) auto-resolves your cwd into its conceptual neighborhood by **tokenizing the directory name** and **substring-matching against sibling directories** in the parent, weighted by token rarity. So:

- `~/src/6digit-studio` → the full `6digit-*` family (app, satellite, membrane, sidetrack, …)
- `~/src/koru` → every `koru-*` and `koru_*` repo, plus things like `korulang_org` (substring match) and `monaco-koru-mode` (token in the middle)
- A repo whose name shares no rare tokens with any sibling → just itself

No config, no manifest. The structure you've already encoded in your parent directory *is* the project graph. Pass `--cwd-only` to opt out and operate on a single directory.

### Stateless by Design
These verbs hold **zero state** — no cursors, no caches, no last-run timestamps (the lone exception, `baton`, is stateful on purpose). Call them from anywhere — terminal, CI, an agent's tool fan-out, a brain persona's toolset — and always get a current answer. Statelessness is what lets multiple consumers read the same journal without coordination overhead, and it's what makes the verbs safe to embed anywhere.

### Multi-Agent at the Inspection Layer
Because these verbs read the same persistent journals every agent surface writes to, they automatically include:
- Terminal Claude Code sessions (`~/.claude/projects/...`)
- Brain-persona ACP sessions (via claude-agent-acp — same JSONL format, same path)
- Codex sessions (`~/.codex/sessions/`)
- opencode sessions (`~/.local/share/opencode/opencode.db`)
- Cursor agent transcripts (`~/.cursor/projects/<cwd>/agent-transcripts/`)

`whisper` (or `gossip`) a directory and you see what *all* your agents — across surfaces — have been doing there. The boundary between "I typed it in a terminal" and "a brain persona ran an ACP turn" mostly disappears.

---

## 📡 Chronicle — a Live Dev-Feed

Arm a repo with a charter (`prose chronicle init`), then post freeform beats as the work happens:

```bash
prose chronicle "it compiles. IT COMPILES." --emoji 🔥
```

Beats append to a durable log and emit to any configured sink (Discord first). `prose chronicle about` prints the repo's charter — what's being chronicled, and in what voice. A sign of life, not a commit log.

---

## 🧬 Evolution — Long-Term Memory

The opt-in deeper layer: `prose evolve` runs LLM passes over your session history and distills it into persistent, searchable memory.

### How it works
1. **Vertical Evolution (The Scribe)** — after a session, raw noisy logs become structured fragments: **⚖️ Decisions** (the "why" behind pivots), **💡 Insights** (hard-won learnings and gotchas), **📖 Narrative** (beats, breakthroughs, quotes).
2. **Horizontal Evolution (The Sage)** — across sessions, months of work get synthesized into a high-density baseline: stale data ages out, conflicting insights get reconciled, and architectural constraints from **Linked Projects** (`prose link`) integrate in.

Evolution also ingests **git history**, **Antigravity artifacts**, and dedicated `prose design` sessions — interactive sittings with an AI architect that the engine treats as ground truth.

### What you get
- **🔎 Hybrid Semantic Search** — `prose search` queries your history with Jina Embeddings v4: meaning + recency + exact keyword matching. `prose index source` additionally vectorizes your codebase (code-aware chunking on function/class boundaries, git-HEAD staleness detection) so `prose search --source` finds the "how," not just the "why."
- **🧠 CLAUDE.md injection** — evolved memory lands in your agent's environment, so it wakes up already knowing what you decided yesterday and why. (`prose context` generates the markdown directly.)
- **🌎 The Personal Vault** — a Git-backed memory store at `~/.prose` (`prose vault init/status/sync`). Verbatim session mirrors live in `~/.prose/mirrors/`, out of your project repos; search spans every project you've ever touched.
- **🖥️ A browsable timeline** — `prose serve` starts an interactive dashboard over your evolved memory; `prose web` exports it as a static HTML site; `prose artifacts` dumps session fragments as Markdown.

### Sidecar economics
Evolution runs alongside your flow, not inside it. Because it operates on snapshots and logs, it's suited to fast, hyper-cheap models like **Gemini 3 Flash** — deep multi-pass synthesis for pennies.

### 🛡️ Security by Design
- **Centralized Vault**: Verbatim mirrors stay in `~/.prose/mirrors/`, out of project repositories by default.
- **Redaction**: Common secrets (API keys, tokens) are scrubbed from session records before storage.
- **Gitignore Safety**: `prose init` protects your project from accidental session leakage.

---

## 🚀 Quick Start

### 1. Install
```bash
npm install -g @6digit/prose
```

### 2. Orient — no keys needed
```bash
prose snap      # what just happened here?
prose whisper   # ...and in the sibling repos?
prose stats     # how much am I actually doing this?
```

### 3. (Recommended) Install the Claude Code skill
```bash
prose skill install
```
This drops a `SKILL.md` into `~/.claude/skills/prose/`. Claude Code auto-loads it, so future agent sessions reach for `prose snap`/`whisper`/`gossip`/`standup` themselves instead of asking you to paste session logs.

### 4. Add keys for the LLM verbs
```bash
# For gossip / standup / evolve / design (any OpenRouter-compatible key)
export PROSE_API_KEY="your-llm-key"      # OPENROUTER_API_KEY also works

# For semantic search & source indexing
export PROSE_JINA_API_KEY="your-jina-key"
```
Or store them globally: `prose config set openrouter-api-key <key>` / `prose config set jina-api-key <key>`.

### 5. Opt into long-term memory
```bash
prose init          # initialize prose in the project
prose evolve        # distill session history into memory
prose index source  # vectorize the codebase

prose search "why did we switch to gemini?"
prose search "how do we handle secret redaction?" --source
```

---

## 📖 Command Reference

| Command | What it does |
|---------|--------------|
| **Orient** (pure reads — no LLM, no key) | |
| `prose snap` | Verbatim tail of recent sessions in the cwd |
| `prose whisper` | Verbatim tail across the project family |
| `prose grep <pattern...>` | Regex search over the parsed session stream |
| `prose stats` | Per-day activity metrics, `--csv` for plotting |
| `prose session <id>` | Full verbatim readout of one session by id prefix |
| `prose tail [id]` | Follow a live session as it grows |
| `prose baton set/list/clear` | Persisted "you are here" handoff markers |
| **Compact** (one cheap LLM pass) | |
| `prose gossip` | Casual catch-up paragraph over a whisper |
| `prose standup` | Cross-project standup, grouped by repo |
| **Chronicle** | |
| `prose chronicle [title]` | Post a dev beat to the log and sinks |
| `prose chronicle init/about` | Scaffold / print the repo's charter |
| **Memory & evolution** | |
| `prose init` | Initialize prose in the project (`init hooks` for PreCompact) |
| `prose evolve` | Distill session history into structured memory |
| `prose search <query>` | Hybrid semantic search (`--source` for code) |
| `prose add <type> <content>` | Add a fragment directly (decision, gotcha, insight, focus) |
| `prose design` | Interactive session with the AI architect |
| `prose merge --from <project>` | Import memory fragments from another project |
| `prose link [target]` | Persistent cross-project context links |
| `prose status` | Memory statistics (`status global` for all projects) |
| `prose show [project]` | Display current fragments |
| `prose context [project]` | Generate context markdown for injection |
| `prose artifacts` | Export session fragments as Markdown |
| `prose web` | Generate a static HTML site from memory |
| `prose serve` | Interactive dashboard server for browsing the timeline |
| `prose index backfill/source` | Generate embeddings for fragments / source code |
| **Infrastructure** | |
| `prose vault init/status/sync` | Git-backed personal memory vault at `~/.prose` |
| `prose config set/show` | Global configuration (API keys, defaults) |
| `prose skill install/uninstall/show/path` | Manage the Claude Code skill |

---

## 🛠️ CLI-First & Agent-Native

Prose is built on a "No-MCP" philosophy. There's no need to configure complex Model Context Protocols or middleware.

- **For Agents**: AI models (like Claude) interact with Prose directly via standard `bash` commands. With the skill installed, your agent becomes self-sufficient — running `prose snap` or `prose search` whenever it needs context.
- **For Humans**: The CLI is designed for ergonomics. It's fast, colorful, and intuitive. Whether you're doing "Digital Archaeology" or just checking the current goal, you have raw power at your fingertips.

---

## 🐶 Dogfooding in Action

We use Prose to build Prose.
Check out our [**CLAUDE.md**](CLAUDE.md) for a live example of an evolved Project Consciousness, distilled from the sessions that created this tool.

---

## 📚 Documentation
For detailed setup, Vault management, and advanced features, see:
- [📖 User Guide](GUIDE.md) - Deep dive into usage and configuration.

## ⚖️ License
MIT — © 2025-2026 [6digit.studio](https://github.com/6digit-studio)
