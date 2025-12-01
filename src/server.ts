/**
 * Claude Prose Dashboard Server
 *
 * Interactive web UI for browsing semantic memory
 */

import express from 'express';
import { loadMemoryIndex, loadProjectMemory, searchMemory, getMemoryStats } from './memory.js';
import { discoverSessionFiles } from './session-parser.js';
import crypto from 'crypto';

const app = express();
app.use(express.json());

// Generate short IDs for fragments
function shortId(content: string): string {
  return crypto.createHash('md5').update(content).digest('hex').slice(0, 8);
}

// ============================================================================
// API Endpoints
// ============================================================================

// List all projects
app.get('/api/projects', (req, res) => {
  const index = loadMemoryIndex();
  const projects = Object.keys(index.projects).map(p => {
    const memory = loadProjectMemory(p);
    const shortName = p.replace(/^-Users-[^-]+-src-/, '');
    return {
      id: p,
      name: shortName,
      decisions: memory?.current.decisions?.decisions?.length || 0,
      insights: memory?.current.insights?.insights?.length || 0,
      gotchas: memory?.current.insights?.gotchas?.length || 0,
      lastUpdated: memory?.lastUpdated,
    };
  });
  res.json(projects);
});

// Get project details with all fragments
app.get('/api/projects/:id', (req, res) => {
  const projectId = req.params.id;
  const memory = loadProjectMemory(projectId);

  if (!memory) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const decisions = (memory.current.decisions?.decisions || []).map(d => ({
    id: shortId(d.what),
    type: 'decision',
    what: d.what,
    why: d.why,
    confidence: d.confidence,
  }));

  const insights = (memory.current.insights?.insights || []).map(i => ({
    id: shortId(i.learning),
    type: 'insight',
    learning: i.learning,
    context: i.context,
  }));

  const gotchas = (memory.current.insights?.gotchas || []).map(g => ({
    id: shortId(g.issue),
    type: 'gotcha',
    issue: g.issue,
    solution: g.solution,
  }));

  const quotes = (memory.current.narrative?.memorable_quotes || []).map(q => ({
    id: shortId(q.quote),
    type: 'quote',
    quote: q.quote,
    speaker: q.speaker,
  }));

  res.json({
    id: projectId,
    name: projectId.replace(/^-Users-[^-]+-src-/, ''),
    lastUpdated: memory.lastUpdated,
    musings: memory.current.decisions?.musings,
    focus: memory.current.focus,
    decisions,
    insights,
    gotchas,
    quotes,
  });
});

// Search across all or specific project
app.get('/api/search', (req, res) => {
  const query = req.query.q as string;
  const project = req.query.project as string | undefined;

  if (!query) {
    return res.status(400).json({ error: 'Query required' });
  }

  const results = searchMemory(query, {
    projects: project ? [project] : undefined,
    types: ['decision', 'insight', 'gotcha', 'quote'],
    limit: 50,
  });

  res.json(results.map(r => ({
    ...r,
    id: shortId(r.content),
    project: r.project.replace(/^-Users-[^-]+-src-/, ''),
  })));
});

// Get stats
app.get('/api/stats', (req, res) => {
  const stats = getMemoryStats();
  res.json(stats);
});

// ============================================================================
// Dashboard HTML
// ============================================================================

const dashboardHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Claude Prose Dashboard</title>
  <style>
    :root {
      --bg: #0d1117;
      --bg-secondary: #161b22;
      --bg-tertiary: #21262d;
      --border: #30363d;
      --text: #c9d1d9;
      --text-muted: #8b949e;
      --accent: #58a6ff;
      --green: #3fb950;
      --yellow: #d29922;
      --red: #f85149;
      --purple: #a371f7;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      height: 100vh;
      display: flex;
      flex-direction: column;
    }

    header {
      background: var(--bg-secondary);
      border-bottom: 1px solid var(--border);
      padding: 0.75rem 1rem;
      display: flex;
      align-items: center;
      gap: 1rem;
    }

    .logo {
      font-size: 1.25rem;
      font-weight: 600;
      background: linear-gradient(135deg, var(--accent), var(--purple));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    .search-box {
      flex: 1;
      max-width: 400px;
    }

    .search-box input {
      width: 100%;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 0.5rem 0.75rem;
      color: var(--text);
      font-size: 0.9rem;
    }

    .search-box input:focus {
      outline: none;
      border-color: var(--accent);
    }

    .main-container {
      display: flex;
      flex: 1;
      overflow: hidden;
    }

    .sidebar {
      width: 200px;
      background: var(--bg-secondary);
      border-right: 1px solid var(--border);
      overflow-y: auto;
      padding: 0.5rem;
    }

    .sidebar h3 {
      font-size: 0.7rem;
      text-transform: uppercase;
      color: var(--text-muted);
      padding: 0.5rem;
      letter-spacing: 0.05em;
    }

    .project-item {
      padding: 0.5rem 0.75rem;
      border-radius: 6px;
      cursor: pointer;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 0.9rem;
    }

    .project-item:hover { background: var(--bg-tertiary); }
    .project-item.active { background: var(--accent); color: #000; }

    .project-count {
      font-size: 0.75rem;
      background: var(--bg);
      padding: 0.1rem 0.4rem;
      border-radius: 10px;
      color: var(--text-muted);
    }

    .project-item.active .project-count {
      background: rgba(0,0,0,0.2);
      color: #000;
    }

    .content {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .tabs {
      display: flex;
      background: var(--bg-secondary);
      border-bottom: 1px solid var(--border);
      padding: 0 1rem;
    }

    .tab {
      padding: 0.75rem 1rem;
      cursor: pointer;
      border-bottom: 2px solid transparent;
      color: var(--text-muted);
      font-size: 0.9rem;
    }

    .tab:hover { color: var(--text); }
    .tab.active { color: var(--accent); border-bottom-color: var(--accent); }

    .tab-badge {
      font-size: 0.7rem;
      background: var(--bg);
      padding: 0.1rem 0.4rem;
      border-radius: 10px;
      margin-left: 0.5rem;
    }

    .fragments-container {
      flex: 1;
      overflow-y: auto;
      padding: 1rem;
    }

    .fragment {
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 1rem;
      margin-bottom: 0.75rem;
    }

    .fragment:hover { border-color: var(--accent); }

    .fragment-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 0.5rem;
    }

    .fragment-id {
      font-family: monospace;
      font-size: 0.75rem;
      color: var(--text-muted);
      background: var(--bg);
      padding: 0.2rem 0.4rem;
      border-radius: 4px;
      cursor: pointer;
      transition: background 0.2s;
    }

    .fragment-id:hover { background: var(--accent); color: #000; }
    .fragment-id.copied { background: var(--green); color: #000; }

    .fragment-content {
      font-size: 0.95rem;
      line-height: 1.5;
    }

    .fragment-context {
      color: var(--text-muted);
      font-size: 0.85rem;
      margin-top: 0.5rem;
    }

    .fragment-badge {
      display: inline-block;
      font-size: 0.7rem;
      padding: 0.15rem 0.5rem;
      border-radius: 4px;
      margin-right: 0.5rem;
    }

    .badge-certain { background: var(--green); color: #000; }
    .badge-tentative { background: var(--yellow); color: #000; }
    .badge-revisiting { background: var(--red); color: #fff; }

    .musings-box {
      background: linear-gradient(135deg, rgba(88, 166, 255, 0.1), rgba(163, 113, 247, 0.1));
      border: 1px solid var(--purple);
      border-radius: 8px;
      padding: 1rem;
      margin-bottom: 1rem;
      font-style: italic;
    }

    .empty-state {
      text-align: center;
      color: var(--text-muted);
      padding: 3rem;
    }

    .search-results {
      padding: 1rem;
    }

    .search-result {
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 1rem;
      margin-bottom: 0.75rem;
    }

    .search-result-meta {
      display: flex;
      gap: 0.5rem;
      margin-bottom: 0.5rem;
      font-size: 0.8rem;
    }

    .type-icon {
      font-size: 1rem;
      margin-right: 0.25rem;
    }

    .quote-text {
      font-style: italic;
      font-size: 1.1rem;
    }

    .quote-speaker {
      color: var(--text-muted);
      margin-top: 0.5rem;
    }
  </style>
</head>
<body>
  <header>
    <div class="logo">claude-prose</div>
    <div class="search-box">
      <input type="text" id="search" placeholder="Search decisions, insights, gotchas...">
    </div>
  </header>

  <div class="main-container">
    <aside class="sidebar">
      <h3>Projects</h3>
      <div id="projects-list"></div>
    </aside>

    <main class="content">
      <div class="tabs" id="tabs">
        <div class="tab active" data-tab="decisions">Decisions <span class="tab-badge" id="decisions-count">0</span></div>
        <div class="tab" data-tab="insights">Insights <span class="tab-badge" id="insights-count">0</span></div>
        <div class="tab" data-tab="gotchas">Gotchas <span class="tab-badge" id="gotchas-count">0</span></div>
        <div class="tab" data-tab="quotes">Quotes <span class="tab-badge" id="quotes-count">0</span></div>
      </div>

      <div class="fragments-container" id="fragments">
        <div class="empty-state">Select a project to view fragments</div>
      </div>
    </main>
  </div>

  <script>
    let currentProject = null;
    let currentTab = 'decisions';
    let projectData = null;

    // Load projects
    async function loadProjects() {
      const res = await fetch('/api/projects');
      const projects = await res.json();

      const list = document.getElementById('projects-list');
      list.innerHTML = projects.map(p => \`
        <div class="project-item" data-id="\${p.id}">
          <span>\${p.name}</span>
          <span class="project-count">\${p.decisions + p.insights + p.gotchas}</span>
        </div>
      \`).join('');

      // Click handlers
      list.querySelectorAll('.project-item').forEach(el => {
        el.addEventListener('click', () => selectProject(el.dataset.id));
      });
    }

    // Select project
    async function selectProject(id) {
      currentProject = id;

      // Update UI
      document.querySelectorAll('.project-item').forEach(el => {
        el.classList.toggle('active', el.dataset.id === id);
      });

      // Load project data
      const res = await fetch(\`/api/projects/\${encodeURIComponent(id)}\`);
      projectData = await res.json();

      // Update counts
      document.getElementById('decisions-count').textContent = projectData.decisions.length;
      document.getElementById('insights-count').textContent = projectData.insights.length;
      document.getElementById('gotchas-count').textContent = projectData.gotchas.length;
      document.getElementById('quotes-count').textContent = projectData.quotes.length;

      renderFragments();
    }

    // Render fragments for current tab
    function renderFragments() {
      const container = document.getElementById('fragments');

      if (!projectData) {
        container.innerHTML = '<div class="empty-state">Select a project to view fragments</div>';
        return;
      }

      let html = '';

      // Show musings if on decisions tab
      if (currentTab === 'decisions' && projectData.musings) {
        html += \`<div class="musings-box">\${projectData.musings}</div>\`;
      }

      const items = projectData[currentTab] || [];

      if (items.length === 0) {
        html += '<div class="empty-state">No ' + currentTab + ' found</div>';
      } else {
        for (const item of items) {
          html += renderFragment(item);
        }
      }

      container.innerHTML = html;

      // Add copy handlers
      container.querySelectorAll('.fragment-id').forEach(el => {
        el.addEventListener('click', () => copyId(el));
      });
    }

    function renderFragment(item) {
      const typeIcons = { decision: '⚖️', insight: '💡', gotcha: '⚠️', quote: '💬' };
      const icon = typeIcons[item.type] || '';

      if (item.type === 'decision') {
        const badgeClass = 'badge-' + (item.confidence || 'tentative');
        return \`
          <div class="fragment">
            <div class="fragment-header">
              <span><span class="type-icon">\${icon}</span> <span class="fragment-badge \${badgeClass}">\${item.confidence}</span></span>
              <span class="fragment-id" data-id="\${item.id}">\${item.id}</span>
            </div>
            <div class="fragment-content">\${item.what}</div>
            <div class="fragment-context">\${item.why}</div>
          </div>
        \`;
      } else if (item.type === 'insight') {
        return \`
          <div class="fragment">
            <div class="fragment-header">
              <span class="type-icon">\${icon}</span>
              <span class="fragment-id" data-id="\${item.id}">\${item.id}</span>
            </div>
            <div class="fragment-content">\${item.learning}</div>
            \${item.context ? \`<div class="fragment-context">\${item.context}</div>\` : ''}
          </div>
        \`;
      } else if (item.type === 'gotcha') {
        return \`
          <div class="fragment">
            <div class="fragment-header">
              <span class="type-icon">\${icon}</span>
              <span class="fragment-id" data-id="\${item.id}">\${item.id}</span>
            </div>
            <div class="fragment-content">\${item.issue}</div>
            \${item.solution ? \`<div class="fragment-context">💡 \${item.solution}</div>\` : ''}
          </div>
        \`;
      } else if (item.type === 'quote') {
        return \`
          <div class="fragment">
            <div class="fragment-header">
              <span class="type-icon">\${icon}</span>
              <span class="fragment-id" data-id="\${item.id}">\${item.id}</span>
            </div>
            <div class="quote-text">"\${item.quote}"</div>
            <div class="quote-speaker">— \${item.speaker}</div>
          </div>
        \`;
      }
      return '';
    }

    function copyId(el) {
      const id = el.dataset.id;
      navigator.clipboard.writeText(id);
      el.classList.add('copied');
      el.textContent = 'copied!';
      setTimeout(() => {
        el.classList.remove('copied');
        el.textContent = id;
      }, 1000);
    }

    // Tab switching
    document.getElementById('tabs').addEventListener('click', (e) => {
      const tab = e.target.closest('.tab');
      if (!tab) return;

      currentTab = tab.dataset.tab;
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      renderFragments();
    });

    // Search
    let searchTimeout;
    document.getElementById('search').addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      const query = e.target.value.trim();

      if (!query) {
        renderFragments();
        return;
      }

      searchTimeout = setTimeout(async () => {
        const url = currentProject
          ? \`/api/search?q=\${encodeURIComponent(query)}&project=\${encodeURIComponent(currentProject)}\`
          : \`/api/search?q=\${encodeURIComponent(query)}\`;

        const res = await fetch(url);
        const results = await res.json();

        const container = document.getElementById('fragments');
        if (results.length === 0) {
          container.innerHTML = '<div class="empty-state">No results found</div>';
          return;
        }

        container.innerHTML = results.map(r => {
          const typeIcons = { decision: '⚖️', insight: '💡', gotcha: '⚠️', quote: '💬' };
          return \`
            <div class="search-result">
              <div class="search-result-meta">
                <span>\${typeIcons[r.type] || ''} \${r.type}</span>
                <span>•</span>
                <span>\${r.project}</span>
                <span class="fragment-id" data-id="\${r.id}">\${r.id}</span>
              </div>
              <div class="fragment-content">\${r.content}</div>
              \${r.context ? \`<div class="fragment-context">\${r.context}</div>\` : ''}
            </div>
          \`;
        }).join('');

        container.querySelectorAll('.fragment-id').forEach(el => {
          el.addEventListener('click', () => copyId(el));
        });
      }, 300);
    });

    // Init
    loadProjects();
  </script>
</body>
</html>
`;

// Serve dashboard
app.get('/', (req, res) => {
  res.send(dashboardHtml);
});

// ============================================================================
// Server start function
// ============================================================================

export function startServer(port: number = 3000): void {
  app.listen(port, () => {
    console.log(`\n🧠 Claude Prose Dashboard`);
    console.log(`   http://localhost:${port}\n`);
  });
}
