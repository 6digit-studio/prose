/**
 * Claude Prose Dashboard Server
 *
 * Interactive web UI for browsing semantic memory
 */

import express from 'express';
import { loadMemoryIndex, loadProjectMemory, searchMemory, getMemoryStats } from './memory.js';
import { discoverSessionFiles } from './session-parser.js';
import { join } from 'path';
import { existsSync } from 'fs';
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

// Get session snapshots for a project
app.get('/api/projects/:id/sessions', (req, res) => {
  const projectId = req.params.id;
  const memory = loadProjectMemory(projectId);

  if (!memory) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const sessions = (memory.sessionSnapshots || [])
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .map(s => {
      const decisions = s.fragments.decisions?.decisions || [];
      const insights = s.fragments.insights?.insights || [];
      const gotchas = s.fragments.insights?.gotchas || [];
      const quotes = s.fragments.narrative?.memorable_quotes || [];
      const beats = s.fragments.narrative?.story_beats || [];

      return {
        id: s.sessionId.slice(0, 8),
        fullId: s.sessionId,
        timestamp: s.timestamp,
        focus: s.fragments.focus?.current_goal,
        hasArtifact: memory.rootPath && existsSync(join(memory.rootPath, '.claude', 'prose', `session-${s.sessionId.slice(0, 8)}.md`)),
        stats: {
          decisions: decisions.length,
          insights: insights.length,
          gotchas: gotchas.length,
          quotes: quotes.length,
          beats: beats.length,
        },
        decisions: decisions.map(d => ({
          id: shortId(d.what),
          type: 'decision',
          what: d.what,
          why: d.why,
          confidence: d.confidence,
        })),
        insights: insights.map(i => ({
          id: shortId(i.learning),
          type: 'insight',
          learning: i.learning,
          context: i.context,
        })),
        gotchas: gotchas.map(g => ({
          id: shortId(g.issue),
          type: 'gotcha',
          issue: g.issue,
          solution: g.solution,
        })),
        quotes: quotes.map(q => ({
          id: shortId(q.quote),
          type: 'quote',
          quote: q.quote,
          speaker: q.speaker,
        })),
        beats: beats.map(b => ({
          type: b.beat_type,
          summary: b.summary,
          mood: b.emotional_tone,
        })),
        musings: s.fragments.decisions?.musings,
      };
    });

  res.json(sessions);
});

// Serve session artifacts
app.get('/api/projects/:id/artifacts/:filename', (req, res) => {
  const projectId = req.params.id;
  const filename = req.params.filename;
  const memory = loadProjectMemory(projectId);

  if (!memory || !memory.rootPath) {
    return res.status(404).json({ error: 'Project or root path not found' });
  }

  const artifactPath = join(memory.rootPath, '.claude', 'prose', filename);
  if (!existsSync(artifactPath)) {
    return res.status(404).json({ error: 'Artifact not found' });
  }

  res.sendFile(artifactPath);
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
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
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

    /* Session styles */
    .session-card {
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: 8px;
      margin-bottom: 0.75rem;
      overflow: hidden;
    }

    .session-card.expanded { border-color: var(--accent); }

    .session-header {
      padding: 1rem;
      cursor: pointer;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .session-header:hover { background: var(--bg-tertiary); }

    .session-date {
      font-weight: 600;
      color: var(--accent);
    }

    .session-id {
      font-family: monospace;
      font-size: 0.8rem;
      color: var(--text-muted);
      margin-left: 0.75rem;
    }

    .session-focus {
      color: var(--text);
      font-size: 0.9rem;
      margin-top: 0.25rem;
      max-width: 500px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .session-stats {
      display: flex;
      gap: 0.75rem;
      font-size: 0.8rem;
      color: var(--text-muted);
    }

    .session-stat { display: flex; align-items: center; gap: 0.25rem; }

    .session-body {
      display: none;
      padding: 0 1rem 1rem 1rem;
      border-top: 1px solid var(--border);
    }

    .session-card.expanded .session-body { display: block; }

    .session-section {
      margin-top: 1rem;
    }

    .session-section-title {
      font-size: 0.8rem;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 0.5rem;
    }

    .session-fragment {
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 0.75rem;
      margin-bottom: 0.5rem;
      font-size: 0.9rem;
    }

    .session-beat {
      padding: 0.5rem 0;
      border-bottom: 1px solid var(--border);
    }

    .session-beat:last-child { border-bottom: none; }

    .beat-type {
      display: inline-block;
      font-size: 0.7rem;
      padding: 0.1rem 0.4rem;
      border-radius: 3px;
      background: var(--purple);
      color: #fff;
      margin-right: 0.5rem;
    }

    .expand-icon {
      transition: transform 0.2s;
    }

    .session-card.expanded .expand-icon { transform: rotate(90deg); }

    /* Markdown styles */
    .markdown-content code {
      background: var(--bg);
      padding: 0.15rem 0.35rem;
      border-radius: 4px;
      font-family: 'SF Mono', Monaco, monospace;
      font-size: 0.85em;
    }

    .markdown-content pre {
      background: var(--bg);
      padding: 0.75rem 1rem;
      border-radius: 6px;
      overflow-x: auto;
      margin: 0.5rem 0;
    }

    .markdown-content pre code {
      padding: 0;
      background: none;
    }

    .markdown-content p { margin: 0.5rem 0; }
    .markdown-content p:first-child { margin-top: 0; }
    .markdown-content p:last-child { margin-bottom: 0; }

    .markdown-content ul, .markdown-content ol {
      margin: 0.5rem 0;
      padding-left: 1.5rem;
    }

    .markdown-content li { margin: 0.25rem 0; }

    .markdown-content a {
      color: var(--accent);
      text-decoration: none;
    }

    .markdown-content a:hover { text-decoration: underline; }

    .markdown-content blockquote {
      border-left: 3px solid var(--purple);
      padding-left: 1rem;
      margin: 0.5rem 0;
      color: var(--text-muted);
    }

    .markdown-content strong { color: var(--text); }
  </style>
</head>
<body>
  <header>
    <div class="logo">prose</div>
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
        <div class="tab" data-tab="sessions">Sessions <span class="tab-badge" id="sessions-count">0</span></div>
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
    let sessionsData = [];

    // Markdown helper - renders inline markdown safely
    function md(text) {
      if (!text) return '';
      return marked.parse(text, { breaks: true });
    }

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

      // Load project data and sessions in parallel
      const [projectRes, sessionsRes] = await Promise.all([
        fetch(\`/api/projects/\${encodeURIComponent(id)}\`),
        fetch(\`/api/projects/\${encodeURIComponent(id)}/sessions\`)
      ]);
      projectData = await projectRes.json();
      sessionsData = await sessionsRes.json();

      // Update counts
      document.getElementById('decisions-count').textContent = projectData.decisions.length;
      document.getElementById('insights-count').textContent = projectData.insights.length;
      document.getElementById('gotchas-count').textContent = projectData.gotchas.length;
      document.getElementById('quotes-count').textContent = projectData.quotes.length;
      document.getElementById('sessions-count').textContent = sessionsData.length;

      renderFragments();
    }

    // Render fragments for current tab
    function renderFragments() {
      const container = document.getElementById('fragments');

      if (!projectData) {
        container.innerHTML = '<div class="empty-state">Select a project to view fragments</div>';
        return;
      }

      // Special handling for sessions tab
      if (currentTab === 'sessions') {
        renderSessions(container);
        return;
      }

      let html = '';

      // Show musings if on decisions tab
      if (currentTab === 'decisions' && projectData.musings) {
        html += \`<div class="musings-box markdown-content">\${md(projectData.musings)}</div>\`;
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

    function renderSessions(container) {
      if (sessionsData.length === 0) {
        container.innerHTML = '<div class="empty-state">No sessions found</div>';
        return;
      }

      let html = '';
      for (const session of sessionsData) {
        const date = new Date(session.timestamp);
        const dateStr = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
        const timeStr = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        const total = session.stats.decisions + session.stats.insights + session.stats.gotchas;

        html += \`
          <div class="session-card" data-session-id="\${session.id}">
            <div class="session-header">
              <div>
                <span class="session-date">\${dateStr} \${timeStr}</span>
                <span class="session-id">#\${session.id}</span>
                \${session.focus ? \`<div class="session-focus">\${session.focus}</div>\` : ''}
              </div>
              <div class="session-stats">
                <span class="session-stat">⚖️ \${session.stats.decisions}</span>
                <span class="session-stat">💡 \${session.stats.insights}</span>
                <span class="session-stat">⚠️ \${session.stats.gotchas}</span>
                <span class="session-stat">💬 \${session.stats.quotes}</span>
                <span class="expand-icon">▶</span>
              </div>
            </div>
            <div class="session-body">
              \${session.musings ? \`<div class="musings-box markdown-content">\${md(session.musings)}</div>\` : ''}

              \${session.beats.length ? \`
                <div class="session-section">
                  <div class="session-section-title">Story</div>
                  \${session.beats.map(b => \`
                    <div class="session-beat">
                      <span class="beat-type">\${b.type}</span>
                      \${b.summary}
                    </div>
                  \`).join('')}
                </div>
              \` : ''}

              \${session.decisions.length ? \`
                <div class="session-section">
                  <div class="session-section-title">Decisions</div>
                  \${session.decisions.map(d => \`
                    <div class="session-fragment markdown-content">
                      <strong>\${md(d.what)}</strong>
                      <div style="color: var(--text-muted); margin-top: 0.25rem;">\${md(d.why)}</div>
                    </div>
                  \`).join('')}
                </div>
              \` : ''}

              \${session.insights.length ? \`
                <div class="session-section">
                  <div class="session-section-title">Insights</div>
                  \${session.insights.map(i => \`
                    <div class="session-fragment markdown-content">\${md(i.learning)}</div>
                  \`).join('')}
                </div>
              \` : ''}

              \${session.gotchas.length ? \`
                <div class="session-section">
                  <div class="session-section-title">Gotchas</div>
                  \${session.gotchas.map(g => \`
                    <div class="session-fragment markdown-content">
                      <strong>\${md(g.issue)}</strong>
                      \${g.solution ? \`<div style="color: var(--green); margin-top: 0.25rem;">💡 \${md(g.solution)}</div>\` : ''}
                    </div>
                  \`).join('')}
                </div>
              \` : ''}

              \${session.quotes.length ? \`
                <div class="session-section">
                  <div class="session-section-title">Quotes</div>
                  \${session.quotes.map(q => \`
                    <div class="session-fragment">
                      <em>"\${q.quote}"</em>
                      <div style="color: var(--text-muted);">— \${q.speaker}</div>
                    </div>
                  \`).join('')}
                </div>
              \` : ''}

              \${session.hasArtifact ? \`
                <div class="session-section" style="margin-top: 1.5rem; text-align: right;">
                  <a href="/api/projects/\${encodeURIComponent(currentProject)}/artifacts/session-\${session.id}.md" target="_blank" style="color: var(--accent); font-size: 0.8rem; text-decoration: none; border: 1px solid var(--accent); padding: 0.25rem 0.5rem; border-radius: 4px;">
                    📄 View Markdown Artifact
                  </a>
                </div>
              \` : ''}
            </div>
          </div>
        \`;
      }

      container.innerHTML = html;

      // Add click handlers for expanding sessions
      container.querySelectorAll('.session-header').forEach(el => {
        el.addEventListener('click', () => {
          el.closest('.session-card').classList.toggle('expanded');
        });
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
            <div class="fragment-content markdown-content">\${md(item.what)}</div>
            <div class="fragment-context markdown-content">\${md(item.why)}</div>
          </div>
        \`;
      } else if (item.type === 'insight') {
        return \`
          <div class="fragment">
            <div class="fragment-header">
              <span class="type-icon">\${icon}</span>
              <span class="fragment-id" data-id="\${item.id}">\${item.id}</span>
            </div>
            <div class="fragment-content markdown-content">\${md(item.learning)}</div>
            \${item.context ? \`<div class="fragment-context markdown-content">\${md(item.context)}</div>\` : ''}
          </div>
        \`;
      } else if (item.type === 'gotcha') {
        return \`
          <div class="fragment">
            <div class="fragment-header">
              <span class="type-icon">\${icon}</span>
              <span class="fragment-id" data-id="\${item.id}">\${item.id}</span>
            </div>
            <div class="fragment-content markdown-content">\${md(item.issue)}</div>
            \${item.solution ? \`<div class="fragment-context markdown-content">💡 \${md(item.solution)}</div>\` : ''}
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
              <div class="fragment-content markdown-content">\${md(r.content)}</div>
              \${r.context ? \`<div class="fragment-context markdown-content">\${md(r.context)}</div>\` : ''}
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
