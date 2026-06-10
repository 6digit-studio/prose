# Prose 🧠

### **Your AI agent forgets the "Why". Prose helps it remember — and helps you catch up in seconds.**

> [!WARNING]
> **EXPERIMENTAL**: Some operations run LLM passes over your session history. Defaults are designed to be cheap (Gemini Flash, byte-budgeted), but be deliberate before automating aggressive multi-pass workflows.

Prose is a **universal semantic memory layer** for AI-driven engineering. It reads the journal your agents already write — Claude Code (CLI + ACP), Codex, and more — and gives you two complementary surfaces on top of it:

### 🧬 Evolution — long-term compression
Turn months of session logs into structured **Decisions**, **Insights**, and **Narrative** fragments. Persistent, searchable, distilled. The "why" behind everything you've built. ([How Evolution Works ↓](#-how-evolution-works))

### 👁️‍🗨️ Sensory Verbs — short-term, stateless inspection

Five pure read verbs (no LLM, instant, free) and two LLM-compaction verbs (one cheap pass, pennies):

|                                | verbatim      | LLM compaction |
|--------------------------------|---------------|----------------|
| 1 cwd                          | **`snap`**    | —              |
| neighborhood (project family)  | **`whisper`** | **`gossip`**   |
| all cwds, time-windowed        | —             | **`standup`**  |
| all cwds, regex-targeted       | **`grep`**    | —              |
| all cwds, quantitative         | **`stats`**   | —              |
| 1 session by id                | **`session`** | —              |

- **`prose snap`** — verbatim tail of recent sessions in this cwd. No LLM.
- **`prose whisper`** — verbatim tail across this repo and its conceptual sibling repos (auto-detected by name — e.g. `6digit-studio` brings the entire `6digit-*` family). No LLM.
- **`prose gossip`** — one short paragraph over a `whisper`. Casual register, like a colleague catching you up.
- **`prose standup`** — cross-project standup of your week, grouped by repo. Formal daily-standup register.
- **`prose grep`** — regex search across the parsed session stream (not files on disk). Grep-style context lines.
- **`prose stats`** — per-day activity metrics: active hours, message volumes, sessions, projects, hour-of-day histogram. `--csv` for plotting.
- **`prose session <id>`** — full verbatim readout of one session by id prefix (the ids printed in snap/whisper/grep headers).

All of them support `--json` for machine-readable output. Pure read-side, zero state, callable from anywhere. ([Sensory Verbs ↓](#%EF%B8%8F%EF%B8%8F-sensory-verbs--cheap-stateless-inspection))

Every verb works over the **same journal** — so a `gossip` shows what your terminal CLI, your editor's ACP integration, and your Codex sessions have all been doing across the family, in one go.

---

## 🧬 How Evolution Works

Prose uses a unique two-stage evolution process to turn ephemeral chat history into consolidated technical wisdom.

### 1. Vertical Evolution (The Scribe)
Immediately after a development session, Prose performs **Vertical Evolution**. It transitions from raw, noisy logs into structured **Fragments**:
- **⚖️ Decisions**: The "why" behind architectural pivots and design choices.
- **💡 Insights**: Hard-won learnings, library "gotchas," and contextual patterns.
- **📖 Narrative**: The human story of the development arc—beats, breakthroughs, and quotes.

### 2. Horizontal Evolution (The Sage)
As you move across sessions, Prose performs **Horizontal Evolution**. It synthesizes months of work into a sharp, high-density baseline:
- **Noise Reduction**: Old, stale data ages out naturally.
- **Conflict Resolution**: Reconciles conflicting insights from different sessions.
- **Global Context**: Integrates architectural constraints from **Linked Projects**.

---

## ⚡ Sidecar Evolution Architecture

Prose is designed as a **Sidecar Evolution** engine. It doesn't interfere with your main development flow, but runs alongside it. 

Because it operates on snapshots and logs, it is perfectly suited for **fast, low-latency, and hyper-cheap models** like **Gemini 3 Flash**. This allows Prose to perform deep, multi-pass synthesis for pennies, making "infinite" project memory commercially viable.

### 🔌 Multi-Source Agnostic
Prose isn't just for Claude Code. It already features deep integration with:
- **Claude Code (CLI)**: Native session log parsing.
- **Claude Code (ACP)**: Brain personas and editor integrations that drive Claude through the Agent Client Protocol write the same JSONL format to the same path — so they're surfaced for free.
- **Codex**: Native parsing of Codex CLI session rollouts (`~/.codex/sessions/`).
- **Antigravity**: Intelligent artifact and plan discovery.
- **Extensible**: We are committed to adding more sources (PRs welcome!) to feed the evolution loop.

---

## ✨ Why Prose?

### 🧠 Stop Explaining, Start Building
Prose automatically injects your project's evolved memory into your agent's environment (via `CLAUDE.md`). Your agent wakes up every session already knowing what we decided yesterday and why.

### 🌎 The Global Brain (Vault)
Your wisdom shouldn't be repo-locked. Prose maintains a Git-backed **Personal Memory Vault** at `~/.prose`. You can search across every project you've ever touched to recall a specific solution or a forgotten refactor.

### 🔎 Hybrid Semantic Search
Powered by **Jina Embeddings v4**, search queries your history using a sophisticated hybrid engine:
- **Meaning**: Finds results semantically similar to your query.
- **Recency**: Prioritizes the latest contexts so your trajectory stays sharp.
- **Keyword**: Exact term matching for technical precision.

### 💻 Source-Aware Intelligence
Prose doesn't just remember what you said; it understands what you **built**:
- **Semantic Source Indexing**: Use `prose index source` to vectorize your actual codebase.
- **Code-Aware Chunking**: Chunks are generated based on function/class boundaries for higher-precision retrieval.
- **Dedicated Storage**: Implementation vectors live in `.source-vectors.json`, keeping your architectural memory clean.
- **Staleness Detection**: Uses Git HEAD tracking and content hashing to ensure you only spend tokens when code actually changes.

### 🎨 Intelligent Design
Prose is "Human-in-the-Loop." You can steer the consciousness directly by dedicating a session to "Manual Correction." The evolution engine treats these human-authored sessions as absolute ground truth.

### 🛡️ Security by Design
Prose takes your security seriously:
- **Centralized Vault**: Verbatim session mirrors live in `~/.prose/mirrors/`, kept out of your project repositories by default.
- **Redaction**: Common secrets (API keys, tokens) are automatically scrubbed from session records before storage.
- **Gitignore Safety**: `prose init` automatically protects your local project from accidental session leakage.

---

## 👁️‍🗨️ Sensory Verbs — Cheap, Stateless Inspection

Beyond evolution, Prose ships a family of read-side verbs for orienting on recent activity without retracing. Five are pure reads (no LLM, no API key, instant); two layer one cheap LLM pass on top:

- **`prose snap`** — Verbatim tail of recent sessions in the current cwd. No LLM. JSON or plain text. Cheap, instant. The raw sensory input.
- **`prose whisper`** — Verbatim tail across the cwd **and its conceptual sibling repos** (a "project family"). No LLM — just `snap` widened to the whole family. Use this as the verbatim source for your own pipelines.
- **`prose gossip`** — One short LLM paragraph over a `whisper`. Casual register — colleague catching you up over coffee. Pennies per call.
- **`prose standup`** — Cross-project standup. 7-day window by default, last 10 messages per active session, grouped by project. A single LLM pass gives you a tight project-by-project narrative of your week. Formal register — daily-standup tone, "what changed / what's next."
- **`prose grep`** — Regex search across the **parsed session stream** — the words your agents actually said, not files on disk. Multiple patterns OR-alternate; output is grep-style with line numbers and ±N context lines. Global by default; `--cwd`, `--source`, `--since` to narrow.
- **`prose stats`** — Per-day activity metrics across every session: active hours (message timestamps merged with an idle-gap cutoff), "human" hours (user messages only), message volumes, distinct sessions and projects, and an hour-of-day histogram. `--csv` emits day rows for plotting; answers "how much am I actually doing this?"
- **`prose session <id>`** — Full verbatim readout of one session. Any unique id prefix works — the 8-char ids printed in snap/whisper/grep headers are direct handles.
- **`prose baton`** — The one deliberately *stateful* verb: leave a typed "you are here" marker at sign-off (`prose baton set "↪ HANDOFF: …"`), read it back next session. Batons ride snap/whisper output as a header for free.

Every verb supports `--json` for machine-readable output: the verbatim verbs return structured snap/whisper objects (text + per-session metadata + per-member blocks); the LLM verbs return the same plus the emitted paragraph as a field instead of streaming.

### Project-Family Discovery (whisper / gossip)

`whisper` (and `gossip`, which builds on it) auto-resolves your cwd into its conceptual neighborhood by **tokenizing the directory name** and **substring-matching against sibling directories** in the parent, weighted by token rarity. So:

- `~/src/6digit-studio` → the full `6digit-*` family (app, satellite, membrane, sidetrack, …)
- `~/src/koru` → every `koru-*` and `koru_*` repo, plus things like `korulang_org` (substring match) and `monaco-koru-mode` (token in the middle)
- A repo whose name shares no rare tokens with any sibling → just itself

No config, no manifest. The structure you've already encoded in your parent directory *is* the project graph. Pass `--cwd-only` to opt out and operate on a single directory.

### Stateless by Design
These verbs hold **zero state** — no cursors, no caches, no last-run timestamps. Call them from anywhere — terminal, CI, an agent's tool fan-out, a brain persona's toolset — and always get a current answer. Statelessness is what lets multiple consumers read the same journal without coordination overhead, and it's what makes the verbs safe to embed anywhere.

### Multi-Agent at the Inspection Layer
Because these verbs read the same persistent journal that every Claude Code surface writes to (`~/.claude/projects/...`), they automatically include:
- Terminal Claude Code sessions
- Brain-persona ACP sessions (via claude-agent-acp)
- Codex sessions (`~/.codex/sessions/`)
- opencode sessions (`~/.local/share/opencode/opencode.db`)
- Cursor agent transcripts (`~/.cursor/projects/<cwd>/agent-transcripts/`)

`whisper` (or `gossip`) a directory and you see what *all* your agents — across surfaces — have been doing there. The boundary between "I typed it in a terminal" and "a brain persona ran an ACP turn" mostly disappears.

---

## 🛠️ CLI-First & Agent-Native

Prose is built on a "No-MCP" philosophy. There's no need to configure complex Model Context Protocols or middle-ware.

- **For Agents**: AI models (like Claude) can interact with Prose directly via standard `bash` commands. By injecting instructions into `CLAUDE.md`, your agent becomes self-sufficient—running `prose search` or `prose status` whenever it needs context.
- **For Humans**: The CLI is designed for ergonomics. It's fast, colorful, and intuitive. Whether you're doing "Digital Archaeology" or just checking the current goal, you have raw power at your fingertips.

---

## 🐶 Dogfooding in Action

We use Prose to build Prose. 
Check out our [**CLAUDE.md**](CLAUDE.md) for a live example of an evolved Project Consciousness, distilled from the sessions that created this tool.

---

## 🚀 Quick Start

### 1. Install
```bash
npm install -g @6digit-studio/prose
```

### 2. Configure
Set your API keys. Prose decouples project reasoning from semantic search to prevent service interference.

```bash
# Required: For project reasoning & evolution
export PROSE_API_KEY="your-llm-key"

# Required: For semantic search & memory recall
export PROSE_JINA_API_KEY="your-jina-key"
```

### 3. Initialize & Evolve
Start your project's consciousness:
```bash
prose init
prose evolve
prose index source # NEW: Vectorize your codebase
```

### 4. (Recommended) Install the Claude Code skill
If you use Claude Code, install the prose skill so future sessions know how and when to reach for it:
```bash
prose skill install
```
This drops a `SKILL.md` into `~/.claude/skills/prose/`. Claude Code auto-loads it, so future agent sessions will use `prose snap`/`whisper`/`gossip`/`standup` for orientation instead of asking you to copy-paste session logs.

### 5. Search Implementation
Find the "Why" (decisions) or the "How" (code) semantically:
```bash
# Search decisions and insights
prose search "why did we switch to gemini?"

# Search actual code implementations
prose search "how do we handle secret redaction?" --source
```

---

## 📚 Documentation
For detailed setup, Vault management, and advanced features, see:
- [📖 User Guide](GUIDE.md) - Deep dive into usage and configuration.
- [🧪 Walkthrough](https://github.com/6digit-studio/prose/blob/main/walkthrough.md) - Real-world examples of evolution in action.

## ⚖️ License
MIT
