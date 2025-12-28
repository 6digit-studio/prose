# Prose User Guide 🧠

Welcome to the technical guide for **Prose**, the semantic memory layer for AI development. This document covers setup, vault management, and advanced retrieval strategies.

## 🛠️ Setup & Configuration

### API Keys
Prose is backend-agnostic. It uses the [Vercel AI SDK](https://sdk.vercel.ai/) to support multiple providers.

Configure your environment variables:
- `PROSE_API_KEY`: **(Required)** Primary key for LLM reasoning and evolution.
- `PROSE_JINA_API_KEY`: **(Required)** Dedicated key for semantic embeddings and retrieval.
- `LLM_BASE_URL`: (Optional) Set for OpenAI-compatible proxies/providers.

> [!IMPORTANT]
> Prose no longer falls back to `PROSE_API_KEY` for Jina services. You MUST provide `PROSE_JINA_API_KEY` for semantic search features to work.

### Installation
```bash
npm install -g @6digit-studio/prose
```

---

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

### Indexing Existing History
If you have a backlog of project memory, you can backfill the vector index:
```bash
prose index backfill
```

### Searching the Vault
- **Local Search**: `prose search "query"` (Searches current project and linked projects).
- **Global Search**: `prose search --all "query"` (Searches your entire history across all repos).

---

## 🔗 Project Linking & Merging

### Linking Repositories
If Project B depends on architectural decisions in Project A, you can link them:
```bash
prose link /path/to/project-a
```
When you evolve Project B, Prose will automatically pull relevant context from Project A.

### Merging Context
To manually fold technical insights from one project into another:
```bash
prose merge --from /path/to/source-project
```

---

## 🌐 The Dashboard
Visualize your project's consciousness with the local web interface:
```bash
prose web
```
This serves a "Digital Archaeology" view, letting you browse story beats, decisions, and memorabile quotes in a beautiful chronicle layout.
