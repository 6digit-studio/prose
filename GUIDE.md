# Prose User Guide 🧠

Welcome to the technical guide for **Prose**, the semantic memory layer for AI development. This document covers setup, the sensory verbs, vault management, and advanced retrieval strategies.

## 🛠️ Setup & Configuration

### Installation
```bash
npm install -g @6digit/prose
```

### API Keys

**The pure read verbs (`snap`, `whisper`, `grep`, `stats`, `session`, `tail`, `baton`) need no keys at all.** Keys come into play for the LLM verbs and semantic search:

- **LLM reasoning** (`gossip`, `standup`, `evolve`, `design`, `merge`): calls go through OpenRouter's OpenAI-compatible endpoint. The key resolves through a fallback chain — first match wins:
  1. `PROSE_API_KEY` (env)
  2. `LLM_API_KEY` (env)
  3. `OPENROUTER_API_KEY` (env)
  4. `OPENAI_API_KEY` (env)
  5. `llm-api-key` / `openrouter-api-key` (global config)
- **Semantic embeddings** (`search`, `index`): `PROSE_JINA_API_KEY` (env), falling back to `jina-api-key` (global config).

> [!IMPORTANT]
> Prose does not fall back to `PROSE_API_KEY` for Jina services. You MUST provide a Jina key for semantic search features to work.

### Global Configuration

Instead of per-project `.env` duplication, store settings once in `~/.prose`:

```bash
prose config set openrouter-api-key <key>
prose config set jina-api-key <key>
prose config show
```

Valid keys: `artifacts`, `mirror-mode` (`vault` or `local`), `source-extensions`, `auto-index-source`, `vector-threshold`, `jina-api-key`, `openrouter-api-key`, `llm-api-key`. Environment variables always take priority over global config.

---

## 👁️‍🗨️ The Sensory Verbs

Stateless, read-side inspection of recent agent activity. All of them support `--json` for machine-readable output.

| Verb | Scope | Key flags |
|------|-------|-----------|
| `prose snap` | current cwd | `--bytes <n>` (text budget, default 4000) |
| `prose whisper` | project family | `--bytes <n>`, `--cwd-only` |
| `prose gossip` | project family, 1 LLM pass | `--bytes <n>` |
| `prose standup` | all cwds, 1 LLM pass | `--since <duration>` (default 7d) |
| `prose grep <pattern...>` | all cwds | `-C <n>` context lines, `--cwd`, `--source`, `--since` |
| `prose stats` | all cwds | `--since <duration>` (default 30d), `--csv` |
| `prose session <id>` | one session by id prefix | `--turns <n>` (tail last N messages) |
| `prose tail [id]` | one live session, follows | `--turns <n>` backlog, `--cwd`, `--any` |
| `prose baton` | per-project markers | `set`, `list` (`--global`), `clear` (`--all`) |

Durations accept compound forms: `30m`, `4h`, `1d`, `2h30m`.

- **`snap` / `whisper`** are verbatim tails — no LLM. `whisper` auto-discovers the cwd's "project family" by tokenizing the directory name and matching siblings in the parent directory, weighted by token rarity. No config; your directory layout is the project graph.
- **`gossip` / `standup`** layer exactly one cheap LLM pass over the verbatim window. `gossip` is casual (colleague over coffee); `standup` is formal (what changed / what's next, grouped by repo).
- **`grep`** searches the *parsed session stream* — what your agents actually said — not files on disk. Multiple patterns OR-alternate.
- **`stats`** merges message timestamps with an idle-gap cutoff to compute active hours; "human" hours count user messages only.
- **`session`** accepts any unique id prefix — the 8-char ids printed in snap/whisper/grep headers are direct handles.
- **`tail`** follows a session as it grows: backlog first, then each new message as it lands. The observation deck for watching another agent work.
- **`baton`** is the one deliberately stateful verb: `prose baton set "↪ HANDOFF: resume at the parser"` leaves a typed marker that rides snap/whisper output as a header until cleared.

### Session Sources

The read verbs scan every supported journal in one pass:

| Source | Location |
|--------|----------|
| Claude Code (CLI) | `~/.claude/projects/...` |
| Claude Code (ACP / brain personas) | same JSONL format, same path |
| Codex | `~/.codex/sessions/` |
| opencode | `~/.local/share/opencode/opencode.db` |
| Cursor | `~/.cursor/projects/<cwd>/agent-transcripts/` |

Evolution additionally ingests **git history**, **Antigravity artifacts**, and `prose design` sessions.

---

## 📡 Chronicle

Arm a repo as a live dev-feed:

```bash
prose chronicle init                      # scaffold .claude/prose/chronicle.json (charter + sinks)
prose chronicle "it compiles!" --emoji 🔥  # post a beat
prose chronicle about                     # print the charter
```

Beats append to a durable log and emit to any configured sink (Discord first). The charter — what's worth a beat, and in what voice — lives in the repo, not in code.

---

## 🤖 The Claude Code Skill

Teach your agent to reach for prose on its own:

```bash
prose skill install     # drops SKILL.md into ~/.claude/skills/prose/
prose skill show        # preview the contents before installing
prose skill path        # print the install path
prose skill uninstall   # remove it
```

Claude Code auto-loads the skill, so future sessions run `prose snap`/`whisper`/`gossip`/`standup` for orientation instead of asking you to paste logs. Note: Claude Code only discovers skills at startup — restart an active session to pick it up.

---

## 🏦 The Vault

The **Vault** is a central, Git-backed repository (stored at `~/.prose`) that version-controls your semantic history across all your projects.

### 🛡️ Secure Mirroring
By default, verbatim session history is stored in the Vault at `~/.prose/mirrors/[project]/`.
- **Redaction**: All stored sessions are automatically scrubbed of API keys and common secrets.
- **Gitignore**: Running `prose init` adds `.claude/prose/` to your `.gitignore` and creates a local symlink to the vault-locked mirrors.

### Initialization
To start versioning your "global brain":
```bash
prose vault init [remote-url]
```
If you provide a `remote-url`, Prose will configure it as the origin for synchronization.

### Daily Workflow
- **Auto-Commit**: Every time you run `prose evolve`, a new version of your memory is committed with a clear temporal timestamp.
- **Syncing**: Move between machines without losing context:
  ```bash
  prose vault sync
  ```
- **Audit**: View the status of your memory vault:
  ```bash
  prose vault status
  ```

---

## 🔍 Semantic Retrieval & Jina v4

Prose uses **Jina Embeddings v4** to power its hybrid search engine.

### Hybrid Search Strategy
When you run `prose search`, the system combines three scoring vectors:
1. **Semantic Similarity**: Vector-based match via Jina.
2. **Recency Weighting**: Prioritizes more recent insights to keep the "trajectory" sharp.
3. **Keyword Precision**: Traditional text matching for exact terms.

### Searching
```bash
prose search "why did we switch to gemini?"           # current project (auto-detected from cwd)
prose search --all "secret redaction"                 # entire history, all repos
prose search "chunking" -t insight,gotcha -l 20       # filter by fragment type, raise the limit
prose search "how do we parse codex sessions?" --source  # search indexed source code
```

### Indexing
- **Backfill fragments**: If you have a backlog of project memory, generate missing embeddings with `prose index backfill`.
- **Index source code**: `prose index source` vectorizes the codebase itself — code-aware chunking on function/class boundaries, with git-HEAD tracking and content hashing so re-runs only spend tokens on code that actually changed.

---

## 🔗 Project Linking & Merging

### Linking Repositories
If Project B depends on architectural decisions in Project A, you can link them:
```bash
prose link /path/to/project-a     # add a link (--remove to unlink)
```
When you evolve Project B, Prose will automatically pull relevant context from Project A.

### Merging Context
To manually fold technical insights from one project into another:
```bash
prose merge --from /path/to/source-project
```

---

## 🌐 Browsing Your Memory

Three ways to look at the evolved record:

- **`prose serve`** — start the interactive dashboard server (`-p <port>`, default 3000). The "Digital Archaeology" view: story beats, decisions, and memorable quotes in a chronicle layout, plus a styled HTML session viewer.
- **`prose web`** — export the same view as a static HTML site (`-o <dir>`, default `./prose-web`).
- **`prose artifacts`** — export session fragments as plain Markdown files.

---

## ⚙️ Evolve Hooks

`prose init hooks` installs a Claude Code **PreCompact hook**: when you run `/compact`, prose evolves the session in the background first, so nothing is lost to context pruning. The hook lands in `.claude/settings.local.json` — gitignored, so each developer opts in individually. If the file already exists, prose prints the hook JSON for you to merge manually instead of overwriting.
