# Claude Prose - Development Guide

## Project Awareness
Promote the release of prose alpha.5 via social media drips while maintaining the optimized vault architecture.

## Critical Decisions
- **Rebranded project from 'claude-prose' to 'prose'.**: To transition from a tool-specific extension to a universal semantic memory layer.
- **Renamed storage directory from ~/.claude-prose to ~/.prose with automatic migration.**: To align with rebranding while ensuring zero-config transitions for existing users via renameSync.
- **Integrated Jina AI (v3/v4) for semantic retrieval and hybrid search.**: To enable deep conceptual search using a combination of Cosine Similarity, Recency, and Keyword matching.
- **Adopted Git as the 'Personal Vault' storage engine for ~/.prose.**: Provides built-in versioning, synchronization, and audit trails for semantic history without custom sync logic.
- **Excluded derived vector and source files from the vault's Git tracking via .gitignore.**: Vector files are large and non-compressible; they can be regenerated from source JSON. Reduced vault size from 2.1GB to 19MB.
- **Performed a 'fresh start' on the vault history by nuking the .git folder and re-initializing.**: The existing history was bloated with large JSON vectors; disk space savings outweighed the value of automated commit history.
- **Implemented Persistent Cross-Project Links via `prose link`.**: Allows architectural alignment across workspaces by injecting state from linked projects into the evolution context.
- **Implemented Verbatim Session Mirroring to permanent Markdown files.**: Prevents context loss from Claude Code's log pruning and preserves the nuance of original developer intent.
- **Replace the /flash slash command with a Claude Code 'skill' that teaches Claude how to use prose search.**: Skills are auto-discovered by Claude Code, reducing friction and ensuring context is always fresh.
- **Pivot CLAUDE.md injection to be opt-in/pruned and use the skill as the primary context delivery mechanism.**: Auto-modifying CLAUDE.md with dense context was too heavy for smaller projects; skills allow for progressive disclosure.
- **Skill file structure: Directory-based with a mandatory SKILL.md containing YAML frontmatter and Markdown instructions.**: Allows for multi-file skills and easy version control within repositories.
- **Hierarchical Skill discovery: Enterprise > Personal (~/.claude/skills/) > Project (.claude/skills/) > Plugin.**: Enables scoping of capabilities from individual preferences to team-wide standards.
- **Implemented global API key storage in ~/.prose/memory-index.json with Env Var > Global Config priority.**: Removes the friction of per-project .env duplication while allowing local overrides.
- **Enabled automatic architectural memory backfilling during 'prose evolve'.**: Ensures the 'evolved' state of the project (decisions, insights) is always searchable without manual indexing steps.
- **Adopt a 'Slow and Steady' development philosophy and 'No silent pivots' rule.**: To ensure higher quality results, transparency, and alignment with explicit project instructions.
- **Released version 0.1.0-alpha.5 with --tag alpha and manual OTP.**: To package vault optimizations and global config fixes; prevents prerelease versions from being tagged as 'latest'.
- **Adopted a 'drip' marketing strategy for X (Twitter) with standalone, context-independent posts.**: Allows for modular information sharing that doesn't rely on users reading a full thread to understand the value proposition.

## Project Insights
- Distinguish between 'Source of Truth' (decisions, insights, mirrors) and 'Derived Data' (vectors, source chunks). Only the former belongs in version control; the latter should be backfilled on-demand to keep repositories lean.
- For developer tools, standalone 'drip' content focusing on specific utility (Search, Gotchas, Vault) is more effective than a single narrative thread, as it allows users to grasp value out-of-order.
- Skills are superior to manual slash commands because they are model-invoked via semantic discovery. A skill should teach the AI how to use tools for on-demand retrieval rather than acting as a static data dump.
- Injecting all decisions into CLAUDE.md is too heavy. Use 'Progressive Disclosure': keep critical Gotchas in CLAUDE.md but offload historical decisions to semantic search.
- A hierarchical configuration system (Env Var > Global Config in ~/.prose/) significantly improves DX for cross-project tools by providing global defaults with per-project overrides.
- In an evolving memory system, the 'merged' or 'current' state is often more relevant for search than raw historical snapshots; both must be indexed for complete coverage.
- Automatic re-indexing should cover both source code (via git HEAD changes) and architectural memory (via the evolve loop) to ensure semantic memory stays synchronized with codebase state.
- Tabular formatting for multi-project statistics provides immediate clarity on indexing health and memory density across a workspace compared to plain text lists.

## Active Gotchas
- **Storing large, derived vector/embedding files in Git causes massive repository bloat (e.g., 2.1GB for a small project).**: Exclude `*.vectors.json` and `*.source*.json` from Git via `.gitignore`. Treat these as derived artifacts to be backfilled on-demand from the primary JSON memory.
- **Git history remains bloated even after adding files to .gitignore if they were previously tracked.**: Nuke the `.git` directory and re-initialize if history isn't critical, or use `git filter-repo` to scrub large blobs.
- **Claude Code Skills are not automatically reloaded while a session is active.**: You must exit and restart Claude Code to load new or modified Skills.
- **Skills may fail to trigger if the description is too vague or lacks specific trigger terms.**: Include specific actions (e.g., 'Extract text') and keywords (e.g., 'PDF') in the YAML description field of the SKILL.md frontmatter.
- **Subagents do not inherit Skills from the main conversation by default.**: Explicitly list required skills in the subagent's AGENT.md file under the 'skills' key.
- **npm publish fails on prerelease versions without an explicit --tag, and 'latest' can point to old versions if tags are inconsistent.**: Always include --tag [tagname] (e.g., --tag alpha) when publishing. If 'latest' is out of sync, manually fix it with `npm dist-tag add <pkg>@<version> latest`.
- **Automated publishing flows are interrupted by npm 2FA (Two-Factor Authentication).**: Instruct the user to provide the OTP or run the command manually with the --otp flag when 2FA is enabled.
- **Architectural memory (decisions, insights) and 'current' ground-truth fragments were previously invisible to semantic search.**: Ensure the `evolve` command automatically triggers vector backfilling for both raw snapshots and the merged 'current' state.

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
> Last updated: 1/4/2026, 5:23:00 AM
