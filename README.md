# Prose 🧠

### **Your AI agent forgets the "Why". Prose helps it remember.**

> [!WARNING]
> **ALPHA / EXPERIMENTAL**: This tool is in early development. It automates high-token LLM operations to build project memory. Use with awareness.

Prose is a **universal semantic memory layer** for engineering. It doesn't just log sessions; it evolves them into a persistent, searchable **Project Consciousness**.

By transforming noisy development logs into refined architectural fragments, Prose ensures your AI agent knows as much about your project's trajectory as you do.

---

## 🧬 How Evolution Works

Prose uses a unique two-stage evolution process to turn ephemeral chat history into consolidated technical wisdom.

### 1. Vertical Evolution (The Scribe)
Immediately after a development session, Prose performs **Vertical Evolution**. It transitions from raw, noisy chat logs into structured **Fragments**:
- **⚖️ Decisions**: The "why" behind architectural pivots and design choices.
- **💡 Insights**: Hard-won learnings, library "gotchas," and contextual patterns.
- **📖 Narrative**: The human story of the development arc—beats, breakthroughs, and quotes.
- **🎯 Focus**: The ephemeral state of current goals and active blockers.

*Every vertical pass is a forward move: It looks at the previous state and "evolves" it with the latest session data.*

### 2. Horizontal Evolution (The Sage)
As you move across sessions, Prose performs **Horizontal Evolution**. It synthesizes months of work into a sharp, high-density baseline:
- **Noise Reduction**: Old, stale data ages out naturally.
- **Conflict Resolution**: Reconciles conflicting insights from different sessions.
- **Global Context**: Integrates architectural constraints from **Linked Projects**.

---

## ✨ Why Prose?

### 🧠 Stop Explaining, Start Building
Prose automatically injects your project's evolved memory into your agent's environment (via `CLAUDE.md`). Your agent wakes up every session already knowing what we decided yesterday and why.

### 🌎 The Global Brain (Vault)
Your wisdom shouldn't be repo-locked. Prose maintains a Git-backed **Personal Memory Vault** at `~/.claude-prose`. You can search across every project you've ever touched to recall a specific solution or a forgotten refactor.

### 🔎 Hybrid Semantic Search
Powered by **Jina Embeddings v4**, search queries your history using a sophisticated hybrid engine:
- **Meaning**: Finds results semantically similar to your query.
- **Recency**: Prioritizes the latest contexts so your trajectory stays sharp.
- **Keyword**: Exact term matching for technical precision.

### 🎨 Intelligent Design
Prose is "Human-in-the-Loop." You can steer the consciousness directly by dedicating a session to "Manual Correction." The evolution engine treats these human-authored sessions as absolute ground truth.

---

## 🚀 Quick Start

### 1. Install
```bash
npm install -g @6digit-studio/prose
```

### 2. Configure
Set your universal API key ([OpenRouter](https://openrouter.ai/) is the recommended provider):
```bash
export PROSE_API_KEY="your-key-here"
```

### 3. Initialize & Evolve
Start your project's consciousness:
```bash
prose init
prose evolve
```

---

## 📚 Documentation
For detailed setup, Vault management, and advanced features, see:
- [📖 User Guide](GUIDE.md) - Deep dive into usage and configuration.
- [🧪 Walkthrough](https://github.com/6digit-studio/prose/blob/main/walkthrough.md) - Real-world examples of evolution in action.

## ⚖️ License
MIT
