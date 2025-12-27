/**
 * Web Viewer - Generate HTML to browse project memory
 */

import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { loadMemoryIndex, loadProjectMemory, type ProjectMemory } from './memory.js';

// ============================================================================
// HTML Generation
// ============================================================================

function escapeHtml(text: string): string {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function generateChronicleSection(memory: ProjectMemory, projectName: string): string {
  const snapshots = memory.sessionSnapshots || [];
  if (snapshots.length === 0) return '';

  // Sort chronologically (oldest first for narrative flow)
  const sorted = [...snapshots].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  const sessionEntries = sorted.map((snapshot) => {
    const date = new Date(snapshot.timestamp);
    const dateStr = date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
    const timeStr = date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    });

    const beats = snapshot.fragments.narrative?.story_beats || [];
    const focus = snapshot.fragments.focus?.current_goal;
    const decisions = snapshot.fragments.decisions?.decisions || [];
    const insights = snapshot.fragments.insights?.insights || [];

    // Create a summary from the first beat or focus
    const summary = beats[0]?.summary || focus || 'Development session';
    const truncatedSummary = summary.length > 100 ? summary.slice(0, 97) + '...' : summary;

    // Stats for the entry
    const statParts = [];
    if (decisions.length) statParts.push(`${decisions.length} decisions`);
    if (insights.length) statParts.push(`${insights.length} insights`);
    const stats = statParts.join(', ');

    return `
    <a href="./${projectName}-session-${snapshot.sessionId.slice(0, 8)}.html" class="session-link">
      <div class="session-entry">
        <div class="session-meta">
          <span class="session-date">${dateStr} ${timeStr}</span>
          <span class="session-id">#${snapshot.sessionId.slice(0, 8)}</span>
        </div>
        <div class="session-summary">${escapeHtml(truncatedSummary)}</div>
        ${stats ? `<div class="session-stats">${stats}</div>` : ''}
      </div>
    </a>
    `;
  });

  return `
  <section class="chronicle">
    <h2><span class="icon">📅</span> Chronicle (${sorted.length} sessions)</h2>
    <div class="timeline">
      ${sessionEntries.join('')}
    </div>
  </section>
  `;
}

function generateSessionPage(
  snapshot: { sessionId: string; timestamp: Date | string; fragments: any },
  projectName: string,
  shortName: string,
  prevSession: { sessionId: string } | null,
  nextSession: { sessionId: string } | null,
  sessionIndex: number,
  totalSessions: number
): string {
  const date = new Date(snapshot.timestamp);
  const dateStr = date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  const timeStr = date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });

  const decisions = snapshot.fragments.decisions?.decisions || [];
  const insights = snapshot.fragments.insights?.insights || [];
  const gotchas = snapshot.fragments.insights?.gotchas || [];
  const beats = snapshot.fragments.narrative?.story_beats || [];
  const quotes = snapshot.fragments.narrative?.memorable_quotes || [];
  const focus = snapshot.fragments.focus;
  const musings = snapshot.fragments.decisions?.musings;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Session ${sessionIndex + 1} - ${escapeHtml(shortName)}</title>
  <style>
    :root {
      --bg: #0d1117;
      --bg-secondary: #161b22;
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
      line-height: 1.7;
      padding: 2rem;
      max-width: 800px;
      margin: 0 auto;
    }

    .nav {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 2rem;
      padding-bottom: 1rem;
      border-bottom: 1px solid var(--border);
    }

    .nav a {
      color: var(--accent);
      text-decoration: none;
      font-size: 0.9rem;
    }

    .nav a:hover { text-decoration: underline; }

    .nav-disabled {
      color: var(--text-muted);
      font-size: 0.9rem;
    }

    .session-number {
      color: var(--text-muted);
      font-size: 0.9rem;
    }

    h1 {
      font-size: 1.5rem;
      margin-bottom: 0.5rem;
      color: var(--text);
    }

    .meta {
      color: var(--text-muted);
      margin-bottom: 2rem;
      font-size: 0.95rem;
    }

    .meta .session-id {
      font-family: monospace;
      background: var(--bg-secondary);
      padding: 0.1rem 0.4rem;
      border-radius: 3px;
      margin-left: 0.5rem;
    }

    section {
      margin-bottom: 2.5rem;
    }

    h2 {
      font-size: 1.1rem;
      color: var(--accent);
      margin-bottom: 1rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .focus-box {
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-left: 3px solid var(--accent);
      border-radius: 8px;
      padding: 1rem 1.25rem;
      margin-bottom: 1rem;
    }

    .focus-goal {
      font-size: 1.1rem;
      font-weight: 500;
      margin-bottom: 0.75rem;
    }

    .focus-tasks {
      list-style: none;
      color: var(--text-muted);
    }

    .focus-tasks li {
      padding: 0.25rem 0;
    }

    .focus-tasks li::before {
      content: "→ ";
      color: var(--accent);
    }

    .beat {
      margin-bottom: 1rem;
      padding-left: 1rem;
      border-left: 2px solid var(--border);
    }

    .beat-type {
      display: inline-block;
      font-size: 0.7rem;
      padding: 0.15rem 0.5rem;
      border-radius: 3px;
      background: var(--purple);
      color: #fff;
      margin-bottom: 0.25rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .beat-mood {
      font-size: 0.8rem;
      color: var(--text-muted);
      margin-left: 0.5rem;
    }

    .beat-text {
      color: var(--text);
    }

    .decision {
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 1rem;
      margin-bottom: 0.75rem;
    }

    .decision-what {
      font-weight: 600;
      margin-bottom: 0.5rem;
    }

    .decision-why {
      color: var(--text-muted);
      font-size: 0.9rem;
    }

    .badge {
      display: inline-block;
      font-size: 0.7rem;
      padding: 0.15rem 0.4rem;
      border-radius: 3px;
      margin-left: 0.5rem;
    }

    .badge-certain { background: var(--green); color: #000; }
    .badge-tentative { background: var(--yellow); color: #000; }
    .badge-revisiting { background: var(--red); color: #fff; }

    .insight {
      padding: 0.75rem 0;
      border-bottom: 1px solid var(--border);
    }

    .insight:last-child { border-bottom: none; }

    .insight-learning {
      font-weight: 500;
      margin-bottom: 0.25rem;
    }

    .insight-context {
      color: var(--text-muted);
      font-size: 0.9rem;
    }

    .gotcha {
      background: rgba(248, 81, 73, 0.1);
      border: 1px solid rgba(248, 81, 73, 0.3);
      border-radius: 8px;
      padding: 1rem;
      margin-bottom: 0.75rem;
    }

    .gotcha-issue {
      font-weight: 500;
      margin-bottom: 0.5rem;
    }

    .gotcha-solution {
      color: var(--green);
      font-size: 0.9rem;
    }

    .quote {
      margin-bottom: 1.5rem;
    }

    .quote blockquote {
      font-style: italic;
      font-size: 1.1rem;
      border-left: 3px solid var(--purple);
      padding-left: 1rem;
      margin-bottom: 0.5rem;
      color: var(--text);
    }

    .quote-speaker {
      color: var(--text-muted);
      font-size: 0.85rem;
      padding-left: 1rem;
    }

    .musings {
      background: linear-gradient(135deg, rgba(88, 166, 255, 0.1), rgba(163, 113, 247, 0.1));
      border: 1px solid var(--purple);
      border-radius: 8px;
      padding: 1.25rem;
      font-style: italic;
    }

    footer {
      text-align: center;
      color: var(--text-muted);
      margin-top: 3rem;
      padding-top: 1rem;
      border-top: 1px solid var(--border);
      font-size: 0.85rem;
    }

    footer a {
      color: var(--accent);
      text-decoration: none;
    }
  </style>
</head>
<body>
  <nav class="nav">
    ${prevSession
      ? `<a href="./${projectName}-session-${prevSession.sessionId.slice(0, 8)}.html">← Previous</a>`
      : `<span class="nav-disabled">← Previous</span>`
    }
    <span class="session-number">Session ${sessionIndex + 1} of ${totalSessions}</span>
    ${nextSession
      ? `<a href="./${projectName}-session-${nextSession.sessionId.slice(0, 8)}.html">Next →</a>`
      : `<span class="nav-disabled">Next →</span>`
    }
  </nav>

  <header>
    <h1>${escapeHtml(shortName)}</h1>
    <div class="meta">
      ${dateStr} at ${timeStr}
      <span class="session-id">#${snapshot.sessionId.slice(0, 8)}</span>
      <br>
      <a href="./${projectName}.html">← Back to project overview</a>
    </div>
  </header>

  ${focus?.current_goal ? `
  <section>
    <h2>🎯 Focus</h2>
    <div class="focus-box">
      <div class="focus-goal">${escapeHtml(focus.current_goal)}</div>
      ${focus.active_tasks?.length ? `
      <ul class="focus-tasks">
        ${focus.active_tasks.map((t: string) => `<li>${escapeHtml(t)}</li>`).join('')}
      </ul>
      ` : ''}
    </div>
  </section>
  ` : ''}

  ${musings ? `
  <div class="musings">
    ${escapeHtml(musings)}
  </div>
  ` : ''}

  ${beats.length ? `
  <section>
    <h2>📖 The Story</h2>
    ${beats.map((b: any) => `
    <div class="beat">
      <span class="beat-type">${b.beat_type}</span>
      ${b.mood ? `<span class="beat-mood">(${b.mood})</span>` : ''}
      <p class="beat-text">${escapeHtml(b.summary)}</p>
    </div>
    `).join('')}
  </section>
  ` : ''}

  ${quotes.length ? `
  <section>
    <h2>💬 Memorable Quotes</h2>
    ${quotes.map((q: any) => `
    <div class="quote">
      <blockquote>"${escapeHtml(q.quote)}"</blockquote>
      <div class="quote-speaker">— ${q.speaker}</div>
    </div>
    `).join('')}
  </section>
  ` : ''}

  ${decisions.length ? `
  <section>
    <h2>⚖️ Decisions Made</h2>
    ${decisions.map((d: any) => `
    <div class="decision">
      <div class="decision-what">
        ${escapeHtml(d.what)}
        <span class="badge badge-${d.confidence}">${d.confidence}</span>
      </div>
      <div class="decision-why">${escapeHtml(d.why)}</div>
    </div>
    `).join('')}
  </section>
  ` : ''}

  ${insights.length ? `
  <section>
    <h2>💡 Insights</h2>
    ${insights.map((i: any) => `
    <div class="insight">
      <div class="insight-learning">${escapeHtml(i.learning)}</div>
      ${i.context ? `<div class="insight-context">${escapeHtml(i.context)}</div>` : ''}
    </div>
    `).join('')}
  </section>
  ` : ''}

  ${gotchas.length ? `
  <section>
    <h2>⚠️ Gotchas Discovered</h2>
    ${gotchas.map((g: any) => `
    <div class="gotcha">
      <div class="gotcha-issue">${escapeHtml(g.issue)}</div>
      ${g.solution ? `<div class="gotcha-solution">💡 ${escapeHtml(g.solution)}</div>` : ''}
    </div>
    `).join('')}
  </section>
  ` : ''}

  <footer>
    <a href="./${projectName}.html">${escapeHtml(shortName)}</a> •
    Generated by <a href="https://github.com/6digit-studio/prose">prose</a>
  </footer>
</body>
</html>
`;
}

function generateProjectHtml(projectName: string): string {
  const memory = loadProjectMemory(projectName);
  if (!memory) return '';

  const shortName = projectName.replace(/^-Users-[^-]+-src-/, '');
  const decisions = memory.current.decisions?.decisions || [];
  const insights = memory.current.insights?.insights || [];
  const gotchas = memory.current.insights?.gotchas || [];
  const narrative = memory.current.narrative?.story_beats || [];
  const quotes = memory.current.narrative?.memorable_quotes || [];
  const musings = memory.current.decisions?.musings;
  const focus = memory.current.focus;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(shortName)} - Project Memory</title>
  <style>
    :root {
      --bg: #0d1117;
      --bg-secondary: #161b22;
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
      line-height: 1.6;
      padding: 2rem;
      max-width: 1200px;
      margin: 0 auto;
    }

    h1 {
      font-size: 2.5rem;
      margin-bottom: 0.5rem;
      background: linear-gradient(135deg, var(--accent), var(--purple));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }

    .subtitle {
      color: var(--text-muted);
      margin-bottom: 2rem;
    }

    .stats {
      display: flex;
      gap: 2rem;
      margin-bottom: 2rem;
      flex-wrap: wrap;
    }

    .stat {
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 1rem 1.5rem;
    }

    .stat-value {
      font-size: 2rem;
      font-weight: bold;
      color: var(--accent);
    }

    .stat-label {
      color: var(--text-muted);
      font-size: 0.875rem;
    }

    section {
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 1.5rem;
      margin-bottom: 1.5rem;
    }

    h2 {
      font-size: 1.25rem;
      margin-bottom: 1rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    h2 .icon { font-size: 1.5rem; }

    .decision, .insight, .gotcha, .beat, .quote {
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 1rem;
      margin-bottom: 0.75rem;
    }

    .decision:last-child, .insight:last-child, .gotcha:last-child, 
    .beat:last-child, .quote:last-child { margin-bottom: 0; }

    .decision-what, .insight-learning, .gotcha-issue {
      font-weight: 600;
      margin-bottom: 0.5rem;
    }

    .decision-why, .insight-context, .gotcha-solution {
      color: var(--text-muted);
      font-size: 0.9rem;
    }

    .badge {
      display: inline-block;
      font-size: 0.75rem;
      padding: 0.2rem 0.5rem;
      border-radius: 4px;
      margin-left: 0.5rem;
    }

    .badge-certain { background: var(--green); color: #000; }
    .badge-tentative { background: var(--yellow); color: #000; }
    .badge-revisiting { background: var(--red); color: #fff; }

    .beat-type {
      display: inline-block;
      font-size: 0.75rem;
      padding: 0.2rem 0.5rem;
      border-radius: 4px;
      background: var(--purple);
      color: #fff;
      margin-right: 0.5rem;
    }

    .quote blockquote {
      font-style: italic;
      border-left: 3px solid var(--accent);
      padding-left: 1rem;
      margin-bottom: 0.5rem;
    }

    .quote-speaker {
      color: var(--text-muted);
      font-size: 0.85rem;
    }

    .musings {
      background: linear-gradient(135deg, rgba(88, 166, 255, 0.1), rgba(163, 113, 247, 0.1));
      border: 1px solid var(--purple);
    }

    .musings-content {
      font-style: italic;
      color: var(--text);
    }

    .focus-goal {
      font-size: 1.1rem;
      font-weight: 600;
      margin-bottom: 1rem;
    }

    .focus-tasks {
      list-style: none;
    }

    .focus-tasks li {
      padding: 0.5rem 0;
      border-bottom: 1px solid var(--border);
    }

    .focus-tasks li:last-child { border-bottom: none; }

    .focus-tasks li::before {
      content: "→ ";
      color: var(--accent);
    }

    footer {
      text-align: center;
      color: var(--text-muted);
      margin-top: 3rem;
      padding-top: 1rem;
      border-top: 1px solid var(--border);
    }

    footer a {
      color: var(--accent);
      text-decoration: none;
    }

    /* Chronicle/Timeline styles */
    .chronicle {
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 1.5rem;
      margin-bottom: 1.5rem;
    }

    .timeline {
      position: relative;
      padding-left: 2rem;
    }

    .timeline::before {
      content: '';
      position: absolute;
      left: 0.5rem;
      top: 0;
      bottom: 0;
      width: 2px;
      background: linear-gradient(to bottom, var(--accent), var(--purple));
    }

    .session-link {
      text-decoration: none;
      color: inherit;
      display: block;
    }

    .session-entry {
      position: relative;
      margin-bottom: 0.75rem;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 0.75rem 1rem;
      transition: border-color 0.2s, transform 0.2s;
    }

    .session-entry::before {
      content: '';
      position: absolute;
      left: -1.5rem;
      top: 1rem;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: var(--accent);
      border: 2px solid var(--bg);
    }

    .session-link:hover .session-entry {
      border-color: var(--accent);
      transform: translateX(4px);
    }

    .session-meta {
      display: flex;
      gap: 0.75rem;
      align-items: center;
      margin-bottom: 0.25rem;
    }

    .session-date {
      color: var(--accent);
      font-weight: 600;
      font-size: 0.85rem;
    }

    .session-id {
      color: var(--text-muted);
      font-size: 0.7rem;
      font-family: monospace;
    }

    .session-summary {
      color: var(--text);
      font-size: 0.9rem;
      line-height: 1.4;
    }

    .session-stats {
      color: var(--text-muted);
      font-size: 0.75rem;
      margin-top: 0.25rem;
    }
  </style>
</head>
<body>
  <h1>🧠 ${escapeHtml(shortName)}</h1>
  <p class="subtitle">Project Memory • Last updated: ${memory.lastUpdated.toLocaleString()}</p>

  <div class="stats">
    <div class="stat">
      <div class="stat-value">${memory.sessionSnapshots?.length || 0}</div>
      <div class="stat-label">Sessions</div>
    </div>
    <div class="stat">
      <div class="stat-value">${decisions.length}</div>
      <div class="stat-label">Decisions</div>
    </div>
    <div class="stat">
      <div class="stat-value">${insights.length}</div>
      <div class="stat-label">Insights</div>
    </div>
    <div class="stat">
      <div class="stat-value">${gotchas.length}</div>
      <div class="stat-label">Gotchas</div>
    </div>
  </div>

  ${focus?.current_goal ? `
  <section>
    <h2><span class="icon">🎯</span> Current Focus</h2>
    <div class="focus-goal">${escapeHtml(focus.current_goal)}</div>
    ${focus.active_tasks?.length ? `
    <ul class="focus-tasks">
      ${focus.active_tasks.map(t => `<li>${escapeHtml(t)}</li>`).join('')}
    </ul>
    ` : ''}
  </section>
  ` : ''}

  ${musings ? `
  <section class="musings">
    <h2><span class="icon">💭</span> LLM Musings</h2>
    <p class="musings-content">${escapeHtml(musings)}</p>
  </section>
  ` : ''}

  ${decisions.length ? `
  <section>
    <h2><span class="icon">⚖️</span> Key Decisions</h2>
    ${decisions.map(d => `
    <div class="decision">
      <div class="decision-what">
        ${escapeHtml(d.what)}
        <span class="badge badge-${d.confidence}">${d.confidence}</span>
      </div>
      <div class="decision-why">${escapeHtml(d.why)}</div>
    </div>
    `).join('')}
  </section>
  ` : ''}

  ${insights.length ? `
  <section>
    <h2><span class="icon">💡</span> Insights</h2>
    ${insights.map(i => `
    <div class="insight">
      <div class="insight-learning">${escapeHtml(i.learning)}</div>
      ${i.context ? `<div class="insight-context">${escapeHtml(i.context)}</div>` : ''}
    </div>
    `).join('')}
  </section>
  ` : ''}

  ${gotchas.length ? `
  <section>
    <h2><span class="icon">⚠️</span> Gotchas & Pitfalls</h2>
    ${gotchas.map(g => `
    <div class="gotcha">
      <div class="gotcha-issue">${escapeHtml(g.issue)}</div>
      ${g.solution ? `<div class="gotcha-solution">💡 ${escapeHtml(g.solution)}</div>` : ''}
    </div>
    `).join('')}
  </section>
  ` : ''}

  ${narrative.length ? `
  <section>
    <h2><span class="icon">📖</span> Narrative</h2>
    ${narrative.map(b => `
    <div class="beat">
      <span class="beat-type">${b.beat_type}</span>
      ${escapeHtml(b.summary)}
    </div>
    `).join('')}
  </section>
  ` : ''}

  ${quotes.length ? `
  <section>
    <h2><span class="icon">💬</span> Memorable Quotes</h2>
    ${quotes.map(q => `
    <div class="quote">
      <blockquote>${escapeHtml(q.quote)}</blockquote>
      <div class="quote-speaker">— ${q.speaker}</div>
    </div>
    `).join('')}
  </section>
  ` : ''}

  ${generateChronicleSection(memory, projectName)}

  <footer>
    Generated by <a href="https://github.com/6digit-studio/prose">prose</a> •
    Semantic memory for AI development sessions
  </footer>
</body>
</html>
`;
}

function generateIndexHtml(): string {
  const index = loadMemoryIndex();
  const projects = Object.keys(index.projects);

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Prose - Project Memory Index</title>
  <style>
    :root {
      --bg: #0d1117;
      --bg-secondary: #161b22;
      --border: #30363d;
      --text: #c9d1d9;
      --text-muted: #8b949e;
      --accent: #58a6ff;
      --purple: #a371f7;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.6;
      padding: 2rem;
      max-width: 800px;
      margin: 0 auto;
    }

    h1 {
      font-size: 3rem;
      margin-bottom: 0.5rem;
      background: linear-gradient(135deg, var(--accent), var(--purple));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }

    .subtitle {
      color: var(--text-muted);
      margin-bottom: 3rem;
      font-size: 1.2rem;
    }

    .projects {
      display: grid;
      gap: 1rem;
    }

    .project {
      display: block;
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 1.5rem;
      text-decoration: none;
      color: var(--text);
      transition: border-color 0.2s, transform 0.2s;
    }

    .project:hover {
      border-color: var(--accent);
      transform: translateY(-2px);
    }

    .project-name {
      font-size: 1.25rem;
      font-weight: 600;
      margin-bottom: 0.25rem;
    }

    .project-path {
      color: var(--text-muted);
      font-size: 0.875rem;
    }

    footer {
      text-align: center;
      color: var(--text-muted);
      margin-top: 3rem;
      padding-top: 1rem;
      border-top: 1px solid var(--border);
    }
  </style>
</head>
<body>
  <h1>🧠 Prose</h1>
  <p class="subtitle">Semantic memory for AI development sessions</p>

  <div class="projects">
    ${projects.map(p => {
    const shortName = p.replace(/^-Users-[^-]+-src-/, '');
    return `
    <a href="./${p}.html" class="project">
      <div class="project-name">${escapeHtml(shortName)}</div>
      <div class="project-path">${escapeHtml(p)}</div>
    </a>
      `;
  }).join('')}
  </div>

  <footer>
    ${projects.length} projects with semantic memory
  </footer>
</body>
</html>
`;
}

// ============================================================================
// Export functions
// ============================================================================

export function generateWebsite(outputDir: string): void {
  const index = loadMemoryIndex();
  const projects = Object.keys(index.projects);

  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  // Generate index
  writeFileSync(join(outputDir, 'index.html'), generateIndexHtml());
  console.log(`📄 Generated index.html`);

  // Generate project pages and session pages
  for (const project of projects) {
    const html = generateProjectHtml(project);
    if (html) {
      writeFileSync(join(outputDir, `${project}.html`), html);
      console.log(`📄 Generated ${project.replace(/^-Users-[^-]+-src-/, '')}.html`);

      // Generate individual session pages
      const memory = loadProjectMemory(project);
      if (memory?.sessionSnapshots?.length) {
        const shortName = project.replace(/^-Users-[^-]+-src-/, '');
        const sorted = [...memory.sessionSnapshots].sort(
          (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        );

        for (let i = 0; i < sorted.length; i++) {
          const snapshot = sorted[i];
          const prevSession = i > 0 ? sorted[i - 1] : null;
          const nextSession = i < sorted.length - 1 ? sorted[i + 1] : null;

          const sessionHtml = generateSessionPage(
            snapshot,
            project,
            shortName,
            prevSession,
            nextSession,
            i,
            sorted.length
          );

          const sessionFilename = `${project}-session-${snapshot.sessionId.slice(0, 8)}.html`;
          writeFileSync(join(outputDir, sessionFilename), sessionHtml);
        }
        console.log(`   📝 Generated ${sorted.length} session pages`);
      }
    }
  }

  console.log(`\n✅ Website generated at: ${outputDir}`);
}
