# Claude Prose - Development Guide

## Project Awareness
Decouple Jina and LLM API keys and improve repository security regarding the .claude/prose/ directory.

## Critical Decisions
- **Rebranded project from 'claude-prose' to 'prose'.**: To transition from a tool-specific extension to a universal semantic memory layer.
- **Renamed storage directory from ~/.claude-prose to ~/.prose with automatic migration.**: To align with rebranding while ensuring zero-config transitions for existing users via renameSync.
- **Integrated Jina AI (v3/v4) for semantic retrieval and hybrid search.**: To enable deep conceptual search using a combination of Cosine Similarity, Recency, and Keyword matching.
- **Adopted Git as the 'Personal Vault' storage engine for ~/.prose.**: Provides built-in versioning, synchronization, and audit trails for semantic history without custom sync logic.
- **Implemented Persistent Cross-Project Links via `prose link`.**: Allows architectural alignment across workspaces by injecting state from linked projects into the evolution context.
- **Broadened evolution triggers to include 'stale' projects with linked dependencies.**: Ensures projects reflect changes in dependencies even when no new local sessions exist, using a fallback window of existing snapshots.
- **Implemented 'Intelligent Design' CLI for manual memory refinement.**: Provides a 'sudo' for project context, allowing human-dictated ground truth to override automated LLM summaries.
- **Implemented Verbatim Session Mirroring to permanent Markdown files.**: Prevents context loss from Claude Code's log pruning and preserves the nuance of original developer intent.
- **Refactored session-parser.ts and added LLM timeouts (60s).**: To fix infinite loops in parsing and prevent the CLI from hanging on network/API delays.
- **Included 'agent-' sessions and broadened CWD-based project detection.**: To ensure the tool learns from its own agentic actions and finds sessions even when directory names don't match perfectly.
- **Decouple Jina API key from LLM API key (PROSE_JINA_API_KEY).**: The keys belong to incompatible services; falling back to an LLM key for a Jina request is a logical error and leads to confusing API failures.
- **Implement .gitignore safety checks for the .claude/prose/ directory.**: To prevent accidental leakage of mirrored project data or internal tool state into version control.
- **Update CLI error messages to explicitly request PROSE_JINA_API_KEY for semantic operations.**: Improves DX by providing clear instructions on which specific service key is missing during search or indexing.

## Project Insights
- Automatic migration should be handled at the initialization layer (e.g., getMemoryDir) to ensure zero-config transitions for existing users.
- Hybrid search scoring should combine Cosine Similarity with Recency and Keyword bonuses; 'new' is often as important as 'relevant' in development.
- Human-directed corrections (Design Sessions) must be treated as absolute ground truth and prioritized over automated LLM summaries to prevent semantic drift.
- Treating the central storage directory as a Git repository provides built-in versioning, audit trails, and synchronization without custom sync logic.
- Evolution should be triggered by 'staleness' (linked project updates) even without local sessions, using the last N snapshots as a context fallback.
- CWD-awareness reduces friction; if detection fails, the CLI should transition to 'discovery mode' by listing available valid projects.
- Service-specific API keys should never fall back to a global or generic key if the services are incompatible, as this leads to cryptic authentication errors rather than clear configuration errors.
- A CLI tool that manages local state should proactively manage or warn about version control (e.g., .gitignore) to prevent users from leaking internal tool data or large indices.
- When introducing breaking changes to environment variables, error messages in the CLI must be updated to explicitly name the required variable to minimize user friction during the transition.

## Active Gotchas
- **Directly renaming directories with `renameSync` can fail across different partitions or filesystems.**: Use a copy-and-delete fallback if `renameSync` fails, though `~` migrations usually succeed with rename.
- **Infinite loops in session parsing when 'continue' statements bypass the offset increment logic.**: Ensure `currentOffset` is incremented at the very end of the loop body, regardless of conditional skips.
- **LLM API calls hanging indefinitely, blocking CLI execution.**: Implement `AbortSignal.timeout(60000)` (60s) for all generation calls to ensure a fail-safe exit.
- **Stalled evolution caused by filtering out 'agent-' prefixed session files.**: Include 'agent-' sessions in discovery to allow the tool to learn from its own automated actions.
- **Claude Code prunes session logs, leading to permanent loss of historical context.**: Implement Verbatim Session Mirroring to permanent Markdown files during the evolution loop.
- **Implicit fallback between unrelated service API keys (LLM vs. Jina) creates confusing failure modes.**: Enforce strict 1:1 mapping between environment variables and their respective services; remove all fallbacks to generic 'API_KEY' variables.
- **Local tool state (like .claude/prose/) can be accidentally committed to version control if not explicitly ignored.**: Implement a 'safety check' during initialization and execution to verify .gitignore contains the tool's data directory.

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
> Last updated: 12/28/2025, 2:12:50 AM
