# Prose 🧠

**Semantic memory for AI development.**

> [!WARNING]
> **ALPHA / EXPERIMENTAL**: This tool is currently in early development and is largely untested. Use at your own risk.
>
> **COST & TOKENS**: Prose performs multiple LLM passes for every evolution. It is **highly recommended** to use a limited API key or monitor your usage closely.

Prose is a universal semantic memory layer for your AI coding interactions. It extracts decisions, insights, and narrative beats from session logs and evolves them into a persistent, searchable project consciousness.

## 🤖 LLM Providers

Prose is built using the [Vercel AI SDK](https://sdk.vercel.ai/) and is currently optimized/defaulted for **OpenRouter**. 

- Defaults to `https://openrouter.ai/api/v1`
- Requires `PROSE_API_KEY` (or fallback to `OPENROUTER_API_KEY`, `OPENAI_API_KEY`, or use the `--api-key` flag).
- `PROSE_API_KEY` is also used for Jina Semantic Retrieval unless `PROSE_JINA_API_KEY` is specifically set.
- Override the base URL via `LLM_BASE_URL` for custom OpenAI-compatible providers.

## 🏛️ Personal Memory Vault

Prose can turn your central memory storage into a **Personal Memory Vault** backed by Git. This allows you to version, sync, and protect your semantic history across all your projects.

### Setup
To initialize your vault:
```bash
prose vault init [remote-url]
```

### Features
- **Auto-Commit**: Once initialized, `prose` will automatically commit changes to your vault after every `evolve` or `design` session.
- **Synchronization**: Keep your memory updated across multiple machines:
  ```bash
  prose vault sync
  ```
- **Status Checks**: Monitor your vault state:
  ```bash
  prose vault status
  ```

## ✨ Features

- **Semantic Memory**: Automatically evolves a project-wide record of *why* things were done, not just *what* code changed.
- **Cross-Project Merge**: Seamlessly integrate evolved memory from one project into another—ideal for multi-repo workflows.
- **Digital Archaeology**: Mirror binary session logs into human-readable Markdown for permanent archival.
- **Agent Integration**: Automatically injects project context into `CLAUDE.md` to keep AI agents aligned.
- **Interactive Chronicles**: Browse your development timeline with an interactive web dashboard.
- **Semantic Retrieval**: Powered by Jina Embeddings v4 for state-of-the-art hybrid search (Vector + Keyword + Recency).

## 🚀 Quick Start

### Installation

```bash
npm install -g @6digit/prose
```

### Initialize a Project

Run this in your repository root:

```bash
prose init
```

### Evolve Memory

Process your latest sessions and update the project memory:

```bash
prose evolve
```

```bash
prose search "why did we choose the named-branch model?"
```

### Jina Semantic Search (Optional)

To enable advanced semantic retrieval, ensure your `PROSE_API_KEY` (or `PROSE_JINA_API_KEY`) is valid for Jina's services.
- **Index Backfill**: `prose index backfill` to vectorize existing memory.
- **Global Search**: `prose search --all "query"` to traverse your entire vault.

## 🧬 Core Philosophy

Evolution is a forward move based on the latest delta. Prose doesn't just summarize your history; it uses your previous semantic baseline to evolve your project's understanding with every new interaction.

## ⚖️ License

MIT
