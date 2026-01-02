# Claude Prose - Development Guide

## Project Awareness
Finalize the release of the latest alpha version of the prose tool on npm while ensuring memory indexing and configuration systems are robust.

## Critical Decisions
- **Rebranded project from 'claude-prose' to 'prose'.**: To transition from a tool-specific extension to a universal semantic memory layer.
- **Renamed storage directory from ~/.claude-prose to ~/.prose with automatic migration.**: To align with rebranding while ensuring zero-config transitions for existing users via renameSync.
- **Integrated Jina AI (v3/v4) for semantic retrieval and hybrid search.**: To enable deep conceptual search using a combination of Cosine Similarity, Recency, and Keyword matching.
- **Adopted Git as the 'Personal Vault' storage engine for ~/.prose.**: Provides built-in versioning, synchronization, and audit trails for semantic history without custom sync logic.
- **Implemented Persistent Cross-Project Links via `prose link`.**: Allows architectural alignment across workspaces by injecting state from linked projects into the evolution context.
- **Implemented Verbatim Session Mirroring to permanent Markdown files.**: Prevents context loss from Claude Code's log pruning and preserves the nuance of original developer intent.
- **Decouple Jina API key from LLM API key (PROSE_JINA_API_KEY).**: The keys belong to incompatible services; falling back to an LLM key for a Jina request is a logical error.
- **Replace the /flash slash command with a Claude Code 'skill' that teaches Claude how to use prose search.**: Skills are auto-discovered by Claude Code, reducing friction and ensuring context is always fresh compared to static data dumps.
- **Pivot CLAUDE.md injection to be opt-in/pruned and use the skill as the primary context delivery mechanism.**: Auto-modifying CLAUDE.md with dense context was too heavy for smaller projects; skills allow for progressive disclosure.
- **Skill file structure: Directory-based with a mandatory SKILL.md containing YAML frontmatter and Markdown instructions.**: Allows for multi-file skills and easy version control within repositories.
- **Hierarchical Skill discovery: Enterprise > Personal (~/.claude/skills/) > Project (.claude/skills/) > Plugin.**: Enables scoping of capabilities from individual preferences to team-wide standards.
- **Use code-aware chunking based on function/class boundaries via regex or light AST parsing.**: Ensures chunks represent conceptual units of code, improving the relevance of semantic search results.
- **Implement staleness detection using Git HEAD tracking and file content hashing for automatic re-indexing.**: Minimizes Jina token usage and ensures semantic memory stays synchronized with the codebase without manual intervention.
- **Adopt a 'Slow and Steady' development philosophy and 'No silent pivots' rule.**: To ensure higher quality results, transparency, and alignment with explicit project instructions.
- **Use --tag alpha for npm publishing and require manual OTP for 2FA.**: Prevents prerelease versions from being tagged as 'latest' and accommodates account security constraints.
- **Implemented global API key storage in ~/.prose/memory-index.json with Env Var > Global Config priority.**: Removes the friction of per-project .env duplication while allowing local overrides. Uses the existing vault structure for security.
- **Enabled automatic architectural memory backfilling during 'prose evolve'.**: Ensures the 'evolved' state of the project (decisions, insights) is always searchable without manual indexing steps.
- **Expanded indexing and search to include 'current' fragments, gotchas, and quotes.**: The 'current' state is the deduplicated ground truth; excluding it from search made the tool's primary output invisible to itself.
- **Redesigned 'prose status global' to use a formatted table with per-project statistics.**: Improves professional presentation and provides immediate clarity on memory density across the entire workspace.

## Project Insights
- Skills are superior to manual slash commands because they are model-invoked via semantic discovery. A skill should teach the AI how to use tools (like 'prose search') for on-demand retrieval rather than acting as a static data dump.
- Injecting all decisions and insights into CLAUDE.md by default is too heavy. Use a 'Progressive Disclosure' approach: keep critical Gotchas in the skill/CLAUDE.md but offload historical decisions to semantic search.
- Skills can enforce safety by restricting Claude to specific tools (e.g., read-only) or command patterns (e.g., git-only bash) when that specific skill is active.
- The 'init' command must be idempotent to allow users to safely re-run it to update configurations or fix missing files without side effects.
- Automatic re-indexing should cover both source code (via git HEAD changes) and architectural memory (via the evolve loop) to ensure the semantic memory stays synchronized with the codebase state.
- The project follows a 'Slow and Steady' and 'No silent pivots' philosophy, prioritizing transparency and explicit confirmation over development speed.
- A hierarchical configuration system (Env Var > Global Config in ~/.prose/) significantly improves DX for cross-project tools by providing global defaults with per-project overrides.
- In an evolving memory system, the 'merged' or 'current' state is often more relevant for search than raw historical snapshots; both must be indexed for complete coverage.
- Tabular formatting for multi-project statistics provides immediate clarity on indexing health and memory density across a workspace compared to plain text lists.

## Active Gotchas
- **Claude Code Skills are not automatically reloaded while a session is active.**: You must exit and restart Claude Code to load new or modified Skills.
- **Skills may fail to trigger if the description is too vague or lacks specific trigger terms.**: Include specific actions (e.g., 'Extract text') and keywords (e.g., 'PDF') in the YAML description field of the SKILL.md frontmatter.
- **Subagents do not inherit Skills from the main conversation by default.**: Explicitly list required skills in the subagent's AGENT.md file under the 'skills' key.
- **npm publish fails on prerelease versions without an explicit --tag, and 'latest' can point to old versions if tags are inconsistent.**: Always include --tag [tagname] (e.g., --tag alpha) when publishing. If 'latest' is out of sync, manually fix it with `npm dist-tag add <pkg>@<version> latest`.
- **Automated publishing flows are interrupted by npm 2FA (Two-Factor Authentication).**: Instruct the user to provide the OTP or run the command manually with the --otp flag when 2FA is enabled.
- **Architectural memory (decisions, insights) and 'current' ground-truth fragments were previously invisible to semantic search.**: Ensure the `evolve` command automatically triggers vector backfilling for both raw snapshots and the merged 'current' state.
- **Orphaned artifact IDs or deleted project directories clutter the global memory index.**: Perform periodic manual or automated cleanup of the memory index to prevent 'ghost' entries in global status reports.

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
> Last updated: 1/2/2026, 4:42:00 AM
