# Changelog

All notable changes to `@6digit/prose` are documented here.

The format is loosely based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project follows [Semantic Versioning](https://semver.org/), with the caveat that pre-1.0 minor bumps may include breaking changes.

## [0.7.0] — 2026-05-06

### Added

- **opencode (sst/opencode) source.** All four verbs (`snap`, `whisper`, `gossip`, `standup`) now read opencode sessions alongside Claude Code, ACP, and Codex. opencode stores conversation data in SQLite at `~/.local/share/opencode/opencode.db` (tables: `session`, `message`, `part`); the parser shells out to the `sqlite3` CLI to discover sessions by `directory` (cwd) and assemble per-message visible text from `text`-typed parts (skipping reasoning, tool calls, and step-bookkeeping events).
- New `'opencode'` member of the `SourceType` union.
- `discoverOpencodeSessionFiles(projectPath?)` and `parseOpencodeSessionFile(syntheticPath)` exports. Synthetic paths use the `opencode://ses_xxx` scheme since opencode is db-backed rather than file-backed.
- Output labels render as `=== opencode session ses_xxx (...) ===` to disambiguate from Claude Code and Codex blocks.

### Rationale

opencode is the most prose-shaped non-Anthropic harness in the wild — same "agent-with-tools writing turn pairs to disk" model, just SQLite-backed instead of JSONL. Adding it costs ~190 lines and unlocks the entire opencode user base. Failure is silent: users without opencode installed get an empty discovery and never notice the source exists, mirroring how Codex behaves when `~/.codex` is missing.

## [0.6.1] — 2026-05-06

### Changed

- **Neighborhood resolver gates siblings on recent git activity.** Non-self matches must have a git commit within the last 14 days to stay in the family; non-git or commit-less repos are dropped. Self always passes through.
- `NeighborhoodOptions.maxAgeMs` is the new knob (default `14 * 86_400_000`; pass `Infinity` to disable).
- `getLatestGitCommitDate` no longer leaks `fatal: not a git repository` to stderr when probing non-git siblings.

### Rationale

Pure name-based matching pulled in coincidental siblings — `caption-studio`, `beist-studio`, `koru-studio` were appearing in the `6digit-studio` neighborhood because they shared the generic `studio` suffix, even though they live in unrelated project families and hadn't been touched in months. The IDF weighting alone wasn't enough to suppress generic suffix tokens. A recency gate is cheap (one `git log -1` per candidate), self-cleaning (no hand-curated stoplist to rot), and cuts the resolved family from 21 repos to 3–4 in the typical case — sharpening `whisper` and `gossip` output without changing their public surface.

## [0.6.0] — 2026-05-04

### Added

- **Git commit injection in `standup`.** Each project section now includes a `### Commits in window` block listing the project's git log oneline within the time window, alongside the existing session tails. The system prompt teaches the LLM to weight commits as ground truth for what shipped, and to treat session tails as biased toward end-of-session "noted for later" framings.
- New `StandupOptions` fields: `bytesPerCommitBlock` (per-project byte cap on the commit block, default 800) and `commitsPerProject` (max commits surfaced per project, default 30). Commit bytes are accounted for in the existing `totalBytes` budget.
- `StandupProjectMeta.commitCount` reports how many commits were surfaced per project.
- New `getCommitsSince(repoPath, since, limit)` and `GitCommitSummary` exports in `source-parsers`.
- CLI trail line for `standup` now reports total commits and per-project commit counts (`Ns/Mm/Cc`).

### Rationale

`standup` was reconstructing project state from the *last 10 messages* of each session — a window that biases heavily toward "what we said we'd do next" and can't tell whether an open thread was resolved in a later session. Cross-referencing against the actual git log gives the LLM a verifiable record of what landed, lets it correctly classify "open thread" vs "shipped," and grounds factual claims in concrete commits the user can cite.

## [0.5.0] — 2026-05-01

### Added

- **`prose gossip`** — new LLM-compaction verb that runs one streaming Gemini-Flash pass over a `whisper` to produce a short paragraph (3–5 sentences) in casual, "colleague catching you up over coffee" register. Pairs with `standup` on a tone axis: gossip = casual neighborhood, standup = formal cross-project.
- **`--json`** on `whisper`, `gossip`, and `standup`. All four sensory verbs now have a machine-readable mode for piping into downstream tools. The verbatim verbs return structured snap/whisper objects (text + per-session metadata + per-member blocks); the LLM verbs return the same plus the emitted paragraph as a field instead of streaming.
- Library exports for `snap`, `whisper`, `gossip`, `standup` (plus their option/result types) from `@6digit/prose`.

### Changed (BREAKING)

- **`prose whisper` no longer calls an LLM.** It is now a pure verbatim read across the project family — effectively `snap` widened to the conceptual neighborhood. The previous LLM-paragraph behavior now lives in `prose gossip`.
- The `whisper(...)` library function dropped its `apiKey` / `model` / `temperature` / `out` options and changed return shape: `{ cwd, text, bytes, sessionsIncluded, turnsIncluded, truncated, neighborhood, blocks, emitted }`. Migration: most callers want `gossip(...)` instead, which preserves the old whisper signature exactly.
- `prose whisper` CLI no longer requires `OPENROUTER_API_KEY` / `--api-key`.

### Rationale

`whisper` was doing two distinct jobs — multi-cwd verbatim collection AND LLM compaction — and the collection job was inaccessible without paying the LLM cost or intercepting `result.source` in JS. Splitting them gives composability: you can pipe `whisper` into your own LLM, into a different downstream tool, into membrane evolve, etc., without burning tokens on a paragraph you'll throw away. The new four-verb grid is orthogonal on two axes: scope (1 cwd / neighborhood / all-cwds) × compaction (verbatim / LLM).

### Skill

- `prose skill install` now ships an updated `SKILL.md` that documents the four-verb grid and the `--json` mode.

## [0.4.0] — unreleased

This version was bumped in working tree but never published. Its contents ship as part of 0.5.0:

- **Sensory verbs** (`snap`, `whisper`, `standup`) introduced as a first-class surface alongside fragment evolution.
- **Codex session parsing** — native parsing of Codex CLI session rollouts in `~/.codex/sessions/`.
- **ACP session inclusion** — Claude-Code-via-ACP sessions surface alongside terminal CLI sessions automatically (same JSONL format, same path).
- **Project-family neighborhood discovery** — `whisper` auto-resolves the cwd into its conceptual sibling repos by tokenizing the directory name and substring-matching against siblings, weighted by token rarity.
- README rewritten around the dual surface (evolution + sensory verbs).
- Dropped the "ALPHA" tag from package description.

## [0.1.0-alpha.13] — earlier

Last published alpha. Prose was a single-surface tool focused on fragment evolution from Claude Code session logs.
