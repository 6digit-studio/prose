# Claude Prose - Development Guide

## Project Awareness
Implement Semantic Source Indexing for the prose tool to enable natural language code search and context-aware RAG.

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
- **Use code-aware chunking based on function/class boundaries via regex or light AST parsing.**: Ensures chunks represent conceptual units of code, improving the relevance of semantic search results.
- **Use Jina Embeddings v4 for vectorization.**: Jina v4 is optimized for code and long-context retrieval; consistent with existing project preferences.
- **Store source metadata and vectors in dedicated files ([projectName].source.json and [projectName].source-vectors.json) separate from architectural memory.**: Keeps high-density architectural memory clean and efficient; prevents bloat in the primary project memory.
- **Implement staleness detection using Git HEAD tracking and file content hashing.**: Minimizes Jina token usage and improves performance by only re-indexing changed files.
- **Introduce explicit CLI commands: 'prose index source' and 'prose search --source'.**: Provides user control over resource-intensive indexing tasks and allows targeted searching.

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
- Separating high-density architectural memory from raw source code chunks is necessary to maintain search efficiency and clarity.
- Source indexing must respect .gitignore and support configurable file extensions to avoid indexing noise (node_modules, build artifacts, etc.).
- A dedicated '--source' flag in the search command allows users to explicitly toggle between searching architectural memory and raw implementation code.

## Active Gotchas
- **Directly renaming directories with `renameSync` can fail across different partitions or filesystems.**: Use a copy-and-delete fallback if `renameSync` fails, though `~` migrations usually succeed with rename.
- **Infinite loops in session parsing when 'continue' statements bypass the offset increment logic.**: Ensure `currentOffset` is incremented at the very end of the loop body, regardless of conditional skips.
- **LLM API calls hanging indefinitely, blocking CLI execution.**: Implement `AbortSignal.timeout(60000)` (60s) for all generation calls to ensure a fail-safe exit.
- **Stalled evolution caused by filtering out 'agent-' prefixed session files.**: Include 'agent-' sessions in discovery to allow the tool to learn from its own automated actions.
- **Claude Code prunes session logs, leading to permanent loss of historical context.**: Implement Verbatim Session Mirroring to permanent Markdown files during the evolution loop.
- **Implicit fallback between unrelated service API keys (LLM vs. Jina) creates confusing failure modes.**: Enforce strict 1:1 mapping between environment variables and their respective services; remove all fallbacks to generic 'API_KEY' variables.
- **Local tool state (like .claude/prose/) can be accidentally committed to version control if not explicitly ignored.**: Implement a 'safety check' during initialization and execution to verify .gitignore contains the tool's data directory.
- **Naive text splitting for code chunks often breaks conceptual units (like splitting a function in half), leading to poor RAG performance.**: Implement a 'Code-Aware' chunker that respects function/class boundaries using regex or AST parsing.
- **Frequent re-indexing of large codebases can lead to high token costs and latency with embedding APIs.**: Implement staleness detection using Git HEAD hashes and per-file content hashing to enable incremental indexing.

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
> Last updated: 12/28/2025, 5:40:56 AM
