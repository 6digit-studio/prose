# Claude Prose - Development Guide

## Project Awareness
Verify artifact regeneration and data integrity locally to ensure 'digital archaeology' features are production-ready before NPM publishing.

## Critical Decisions
- **Rebranded project from 'claude-prose' to 'prose'.**: To transition from a tool-specific extension to a universal semantic memory layer.
- **Renamed storage directory from ~/.claude-prose to ~/.prose with automatic migration.**: To align with rebranding while ensuring zero-config transitions for existing users via renameSync.
- **Integrated Jina AI (v3/v4) for semantic retrieval and hybrid search.**: To enable deep conceptual search using a combination of Cosine Similarity, Recency, and Keyword matching.
- **Adopted Git as the 'Personal Vault' storage engine for ~/.prose.**: Provides built-in versioning, synchronization, and audit trails for semantic history without custom sync logic.
- **Excluded derived vector and source files from the vault's Git tracking via .gitignore.**: Vector files are large and non-compressible; they can be regenerated from source JSON. Reduced vault size from 2.1GB to 19MB.
- **Performed a 'fresh start' on the vault history by nuking the .git folder and re-initializing.**: The existing history was bloated with large JSON vectors and unused provenance metadata; disk space savings outweighed the value of automated commit history.
- **Implemented Persistent Cross-Project Links via `prose link`.**: Allows architectural alignment across workspaces by injecting state from linked projects into the evolution context.
- **Implemented Verbatim Session Mirroring to permanent Markdown files in ~/.prose/mirrors/[project]/.**: Prevents context loss from Claude Code's log pruning and supports 'digital archaeology' by preserving conversation nuance across projects.
- **Reverted message extraction to exclude 'tool_result' content from archives and evolution.**: Tool results (e.g., large file dumps) pollute the archive with noise and increase embedding costs without adding semantic value to the human-AI intent.
- **Replace the /flash slash command with a Claude Code 'skill' that teaches Claude how to use prose search.**: Skills are auto-discovered by Claude Code, reducing friction and ensuring context is always fresh.
- **Pivot CLAUDE.md injection to be opt-in/pruned and use the skill as the primary context delivery mechanism.**: Auto-modifying CLAUDE.md with dense context was too heavy for smaller projects; skills allow for progressive disclosure.
- **Skill file structure: Directory-based with a mandatory SKILL.md containing YAML frontmatter and Markdown instructions.**: Allows for multi-file skills and easy version control within repositories.
- **Hierarchical Skill discovery: Enterprise > Personal (~/.claude/skills/) > Project (.claude/skills/) > Plugin.**: Enables scoping of capabilities from individual preferences to team-wide standards.
- **Implemented global API key storage in ~/.prose/memory-index.json with Env Var > Global Config priority.**: Removes the friction of per-project .env duplication while allowing local overrides.
- **Enabled automatic architectural memory backfilling during 'prose evolve'.**: Ensures the 'evolved' state of the project (decisions, insights) is always searchable without manual indexing steps.
- **Removed sourceLinks from project memory and evolution results.**: The sourceLinks array was write-only provenance metadata that caused massive JSON file bloat (21MB+ per project) without being queried.
- **Implemented a parallel parser pattern for Codex sessions (codex-session-parser.ts) to handle .json (legacy) and .jsonl (streaming) formats.**: Codex uses different data structures than Claude Code; specialized handling is required to unify them under the 'prose' umbrella.
- **Implemented a dedicated HTML artifact viewer in the web UI with speaker color-coding and dark theme styling.**: Raw markdown is difficult to read for long sessions; a styled UI improves the experience of browsing 'digital archaeology'.
- **Adopted a strict 'Test-Show-Confirm' workflow before any NPM publish or Git commit.**: Premature publishing without local verification leads to broken releases; artifacts must be inspected locally to ensure logic (like tool_result exclusion) actually worked.
- **Released version 0.1.0-alpha.8 and updated 'latest' npm tag.**: To distribute critical vault bloat fixes and incremental processing for design sessions.

## Project Insights
- Distinguish between 'Source of Truth' (decisions, insights, mirrors) and 'Derived Data' (vectors, source chunks). Only the former belongs in version control. Remove write-only provenance metadata (like sourceLinks) if it is never queried.
- Hybrid search (Keyword + Semantic) is necessary for developer tools because users alternate between conceptual queries and literal identifier lookups. Metadata-only indexing is a 'false optimization' if it breaks keyword matching.
- For developer tools, standalone 'drip' content focusing on specific utility (Search, Gotchas, Vault) is more effective than a single narrative thread, as it allows users to grasp value out-of-order.
- Skills are superior to manual slash commands because they are model-invoked via semantic discovery. A skill should teach the AI how to use tools for on-demand retrieval rather than acting as a static data dump.
- Injecting all decisions into CLAUDE.md is too heavy. Use 'Progressive Disclosure': keep critical Gotchas in CLAUDE.md but offload historical decisions to semantic search.
- A hierarchical configuration system (Env Var > Global Config in ~/.prose/) significantly improves DX for cross-project tools by providing global defaults with per-project overrides.
- In an evolving memory system, the 'merged' or 'current' state is often more relevant for search than raw historical snapshots; both must be indexed for complete coverage.
- Centralizing verbatim session artifacts in a vault (~/.prose/mirrors/) enables cross-project 'digital archaeology'. However, normalization is a recurring tax when unifying different tools (Codex vs Claude Code) under one semantic umbrella.
- Tabular formatting for stats and styled HTML viewers for session logs (with speaker color-coding) are essential for making high-density architectural data digestible.
- Strict adherence to the 'Run it, Show the output, Wait for confirmation' principle is critical. AI speed must not bypass local verification, especially for data extraction logic.
- Verification of data processing logic must include a check that the target artifacts were actually updated; presence of data does not equal success of the latest logic.

## Active Gotchas
- **Storing large, derived vector/embedding files in Git causes massive repository bloat (e.g., 2.1GB for a small project).**: Exclude `*.vectors.json` and `*.source*.json` from Git via `.gitignore`. Treat these as derived artifacts to be backfilled on-demand from the primary JSON memory.
- **Git history remains bloated even after adding files to .gitignore if they were previously tracked.**: Nuke the `.git` directory and re-initialize if history isn't critical, or use `git filter-repo` to scrub large blobs. Remember to re-add the remote URL after re-initializing.
- **Semantic search (vector similarity) is highly ineffective for short, literal keyword queries (e.g., 'tap').**: Implement a hybrid search strategy where short queries (1-2 words) trigger keyword matching, while longer queries use semantic vector similarity.
- **Indexing source code without storing the actual content (to save space) makes keyword-based search impossible.**: Store the full content in the source manifest. Since derived data is now excluded from Git, the disk space trade-off is acceptable for the gain in search utility.
- **Claude Code Skills are not automatically reloaded while a session is active.**: You must exit and restart Claude Code to load new or modified Skills.
- **npm publish fails on prerelease versions without an explicit --tag, and 'latest' can point to old versions if tags are inconsistent.**: Always include --tag [tagname] (e.g., --tag alpha) when publishing. If 'latest' is out of sync, manually fix it with `npm dist-tag add <pkg>@<version> latest`.
- **Automated publishing flows are interrupted by npm 2FA (Two-Factor Authentication).**: Instruct the user to provide the OTP or run the command manually with the --otp flag when 2FA is enabled.
- **Design sessions were missing incremental processing logic, causing full re-evolution of all messages every time.**: Implement a check against prevState.messageCount to slice the message array, matching the logic used for other session types.
- **Including 'tool_result' content (file dumps) in archives pollutes semantic memory with noise and misattributes data.**: Exclude tool_result content from verbatim archives and semantic evolution to focus on human-AI intent and reasoning.
- **Stale artifacts can lead to false positives during verification if the regeneration command wasn't actually executed or failed silently.**: Always check file timestamps or 'last modified' metadata when verifying if a change has been applied to generated data.
- **AI agents may attempt to publish to package managers (NPM) prematurely without verifying the fix locally.**: Enforce a strict 'Run, Show, Wait' protocol before any deployment or commit action. This is a core development principle.

## Usage Instructions
### 🧠 Semantic Memory & Search
This project uses `prose` to maintain a cross-session semantic memory of decisions, insights, and story beats.

- **Semantic Search**: If you're unsure about a past decision or need context on a feature, run:
  ```bash
  prose search "your question or keywords"
  ```
- **Project Status**: To see a summary of recent sessions and evolved memory, run:
  ```bash
  prose status
  ```
- **View Chronicles**: Run `prose serve` to browse the interactive development timeline in your browser.


## Tech Stack
- Bun (Runtime & Test)
- TypeScript
- Commander.js (CLI)
- Gemini 3 Flash (via AI SDK)

## Development Workflow
- Build: `npm run build`
- Evolve memory: `node dist/cli.js evolve`
- Test: `bun test`


> [!NOTE]
> This file is automatically generated from `CLAUDE.md.template` by `prose`.
> Last updated: 1/27/2026, 2:43:50 PM
