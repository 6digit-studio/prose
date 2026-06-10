/**
 * Claude Prose Dashboard Server
 *
 * Interactive web UI for browsing semantic memory
 */

import express from 'express';
import { loadMemoryIndex, loadProjectMemory, searchMemory, getMemoryStats, getApiKey, getMemoryDir } from './memory.js';
import { discoverSessionFiles } from './session-parser.js';
import { stats } from './stats.js';
import { parseDuration } from './standup.js';
import { join } from 'path';
import { existsSync, readdirSync, readFileSync } from 'fs';
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
app.get('/api/search', async (req, res) => {
  const query = req.query.q as string;
  const project = req.query.project as string;

  if (!query) {
    return res.status(400).json({ error: 'Query required' });
  }

  const jinaApiKey = getApiKey('jina');

  const results = await searchMemory(query, {
    projects: project ? [project] : undefined,
    types: ['decision', 'insight', 'gotcha', 'quote'],
    limit: 50,
    jinaApiKey
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

// Activity metrics over the session journals (the `prose stats` verb).
// Global across all cwds; ?since=7d / ?idleGap=15m / ?cwd=/abs/path to tune.
app.get('/api/activity', (req, res) => {
  try {
    const since = (req.query.since as string) || '30d';
    const idleGap = req.query.idleGap as string | undefined;
    const result = stats({
      sinceMs: parseDuration(since),
      idleGapMs: idleGap ? parseDuration(idleGap) : undefined,
      cwd: (req.query.cwd as string) || undefined,
      cache: req.query.refresh !== '1',
    });
    // The text field is the terminal rendering — the dashboard draws its own charts.
    const { text, ...payload } = result;
    res.json(payload);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
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
        hasArtifact: existsSync(join(getMemoryDir(), 'mirrors', projectId, `session-${s.sessionId.slice(0, 8)}.md`)),
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

// Get all verbatim artifacts from vault (independent of session snapshots)
app.get('/api/projects/:id/vault-artifacts', (req, res) => {
  const projectId = req.params.id;
  const vaultArtifactsDir = join(getMemoryDir(), 'mirrors', projectId);

  if (!existsSync(vaultArtifactsDir)) {
    return res.json([]);
  }

  try {
    const files = readdirSync(vaultArtifactsDir)
      .filter(f => f.startsWith('session-') && f.endsWith('.md'))
      .sort()
      .reverse();

    res.json(files);
  } catch (e) {
    res.json([]);
  }
});

// Serve session artifacts from vault
app.get('/api/projects/:id/artifacts/:filename', (req, res) => {
  const projectId = req.params.id;
  const filename = req.params.filename;
  const memory = loadProjectMemory(projectId);

  if (!memory) {
    return res.status(404).json({ error: 'Project not found' });
  }

  // Look in vault mirrors directory
  const artifactPath = join(getMemoryDir(), 'mirrors', projectId, filename);

  if (!existsSync(artifactPath)) {
    console.error(`Artifact not found: ${artifactPath}`);
    return res.status(404).json({ error: `Artifact not found: ${artifactPath}` });
  }

  try {
    const content = readFileSync(artifactPath, 'utf-8');
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.send(content);
  } catch (err: any) {
    console.error(`Error reading artifact ${artifactPath}:`, err);
    res.status(500).json({ error: `Error reading artifact: ${err.message}` });
  }
});

// View artifact as beautiful rendered HTML
app.get('/artifacts/:projectId/:sessionId', (req, res) => {
  const { projectId, sessionId } = req.params;
  const artifactPath = join(getMemoryDir(), 'mirrors', projectId, `session-${sessionId}.md`);

  if (!existsSync(artifactPath)) {
    return res.status(404).send(`
      <!DOCTYPE html>
      <html>
        <body style="font-family: sans-serif; padding: 2rem; color: #333;">
          <h1>404 - Artifact Not Found</h1>
          <p>Could not find artifact at: ${artifactPath}</p>
          <a href="/">← Back to Dashboard</a>
        </body>
      </html>
    `);
  }

  try {
    const content = readFileSync(artifactPath, 'utf-8');

    // Parse the markdown to extract metadata and messages
    const lines = content.split('\n');
    let metadata = { title: '', date: '', projectName: '', sessionId: '' };
    let messages: Array<{ role: string; content: string }> = [];
    let inMessage = false;
    let currentRole = '';
    let currentContent: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.startsWith('# Session:')) {
        metadata.title = line.replace('# Session: ', '').trim();
      } else if (line.startsWith('**Date:**')) {
        metadata.date = line.replace('**Date:** ', '').trim();
      } else if (line.startsWith('**Project:**')) {
        metadata.projectName = line.replace('**Project:** ', '').trim();
      } else if (line.startsWith('**Session ID:**')) {
        metadata.sessionId = line.replace('**Session ID:** `', '').replace('`', '').trim();
      } else if (line.startsWith('**Designer:**') || line.startsWith('**Claude:**')) {
        // Detect new role from this line
        const newRole = line.includes('Designer') ? 'Designer' : 'Claude';

        // Only save previous message if ROLE is changing (not same role marker again)
        if (inMessage && currentContent.length > 0 && newRole !== currentRole) {
          messages.push({
            role: currentRole,
            content: currentContent.join('\n').trim()
          });
          currentContent = [];
        }

        // Set role and mark as in message
        currentRole = newRole;
        inMessage = true;
      } else if (line === '---' || line === '') {
        // Skip separators and empty lines at message boundaries
        if (inMessage && currentContent.length > 0 && line === '---') {
          messages.push({
            role: currentRole,
            content: currentContent.join('\n').trim()
          });
          inMessage = false;
          currentContent = [];
        }
      } else if (inMessage) {
        currentContent.push(line);
      }
    }

    // Save last message
    if (inMessage && currentContent.length > 0) {
      messages.push({
        role: currentRole,
        content: currentContent.join('\n').trim()
      });
    }

    // Render as HTML
    const messagesHtml = messages.map((msg, i) => {
      const isDesigner = msg.role === 'Designer';
      const bgColor = isDesigner ? 'var(--bg)' : 'var(--bg-secondary)';
      const borderColor = isDesigner ? 'var(--accent)' : 'var(--green)';
      const roleColor = isDesigner ? 'var(--accent)' : 'var(--green)';

      return `
        <div style="margin: 1.5rem 0; padding: 1.5rem; background: ${bgColor}; border-left: 3px solid ${borderColor}; border-radius: 4px;">
          <div style="font-weight: 600; color: ${roleColor}; margin-bottom: 0.75rem; font-size: 0.9rem; text-transform: uppercase;">
            ${msg.role}
          </div>
          <div class="message-content markdown-body" style="color: #c9d1d9; line-height: 1.6; word-wrap: break-word;">
            ${escapeHtml(msg.content)
              .split('\n\n')
              .map(para => `<p>${para.split('\n').join('<br>')}</p>`)
              .join('')}
          </div>
        </div>
      `;
    }).join('');

    const html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Session ${metadata.title}</title>
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Sora:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
        <style>
          /* Intranquil violet theme — matches the dashboard */
          :root {
            --bg: oklch(0.17 0.075 312);
            --bg-secondary: oklch(0.225 0.09 312);
            --text: oklch(0.98 0.02 320);
            --text-muted: oklch(0.79 0.07 320);
            --accent: oklch(0.62 0.28 330);
            --green: oklch(0.74 0.16 158);
            --border: oklch(0.82 0.14 330 / 22%);
            --font-display: 'Space Grotesk', 'Sora', sans-serif;
            --font-sans: 'Sora', sans-serif;
            --font-mono: 'JetBrains Mono', ui-monospace, monospace;
          }

          * { box-sizing: border-box; margin: 0; padding: 0; }

          body {
            font-family: var(--font-sans);
            background: var(--bg);
            color: var(--text);
            line-height: 1.6;
          }

          header {
            background: var(--bg-secondary);
            border-bottom: 1px solid var(--border);
            padding: 1.5rem;
            sticky: top;
            top: 0;
            z-index: 100;
          }

          .header-content {
            max-width: 900px;
            margin: 0 auto;
          }

          .breadcrumb {
            font-size: 0.85rem;
            color: var(--text-muted);
            margin-bottom: 1rem;
          }

          .breadcrumb a {
            color: var(--accent);
            text-decoration: none;
          }

          .breadcrumb a:hover { text-decoration: underline; }

          h1 {
            font-family: var(--font-display);
            font-size: 1.4rem;
            letter-spacing: -0.02em;
            margin-bottom: 0.5rem;
            color: var(--text);
          }

          .meta {
            display: flex;
            gap: 2rem;
            font-family: var(--font-mono);
            font-size: 0.8rem;
            color: var(--text-muted);
            flex-wrap: wrap;
          }

          .meta-item {
            display: flex;
            align-items: center;
            gap: 0.5rem;
          }

          .container {
            max-width: 900px;
            margin: 2rem auto;
            padding: 0 1.5rem;
          }

          .conversation {
            background: var(--bg);
          }

          footer {
            text-align: center;
            padding: 2rem 1.5rem;
            color: var(--text-muted);
            font-size: 0.85rem;
            border-top: 1px solid var(--border);
            margin-top: 3rem;
          }

          code {
            background: var(--bg-secondary);
            padding: 0.2em 0.4em;
            border-radius: 3px;
            font-family: var(--font-mono);
            font-size: 0.9em;
          }

          pre {
            background: var(--bg-secondary);
            padding: 1rem;
            border-radius: 4px;
            overflow-x: auto;
            margin: 1rem 0;
            border: 1px solid var(--border);
          }

          pre code {
            background: none;
            padding: 0;
          }
        </style>
      </head>
      <body>
        <header>
          <div class="header-content">
            <div class="breadcrumb">
              <a href="/">🏛️ Claude Prose</a> / Vault Artifact
            </div>
            <h1>📄 Session ${metadata.title}</h1>
            <div class="meta">
              <div class="meta-item">📅 ${metadata.date}</div>
              <div class="meta-item">🆔 ${metadata.sessionId}</div>
              <div class="meta-item">📦 ${metadata.projectName}</div>
              <div class="meta-item">💬 ${messages.length} messages</div>
            </div>
          </div>
        </header>

        <div class="container">
          <div class="conversation">
            ${messagesHtml}
          </div>
        </div>

        <footer>
          <p>✨ Preserved by <strong>Claude Prose</strong> — Digital Archaeology 🏛️</p>
          <p style="margin-top: 0.5rem; font-size: 0.8rem;">
            <a href="/" style="color: var(--accent); text-decoration: none;">← Back to Dashboard</a>
          </p>
        </footer>
      </body>
      </html>
    `;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err: any) {
    console.error(`Error rendering artifact:`, err);
    res.status(500).send(`
      <!DOCTYPE html>
      <html>
        <body style="font-family: sans-serif; padding: 2rem; color: #333;">
          <h1>500 - Error Rendering Artifact</h1>
          <p>${err.message}</p>
          <a href="/">← Back to Dashboard</a>
        </body>
      </html>
    `);
  }
});

function escapeHtml(text: string): string {
  const map: { [key: string]: string } = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, m => map[m]);
}

// ============================================================================
// Dashboard HTML
// ============================================================================

const dashboardHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>prose — dashboard</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Sora:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
  <style>
    /* Intranquil design language (violet theme), translated for the dashboard.
       Type roles: display (Space Grotesk) → wordmark; sans (Sora) → prose;
       mono (JetBrains Mono) → tabular readouts; micro (Inter) → small
       uppercase chrome. Token NAMES kept from the old theme so all markup
       keeps working; VALUES are the Intranquil violet palette. */
    :root {
      --bg: oklch(0.17 0.075 312);
      --bg-secondary: oklch(0.225 0.09 312);
      --bg-tertiary: oklch(0.3 0.085 312);
      --bg-active: oklch(0.35 0.11 312);
      --border: oklch(0.82 0.14 330 / 22%);
      --grid: oklch(0.82 0.14 330 / 9%);
      --text: oklch(0.98 0.02 320);
      --text-muted: oklch(0.79 0.07 320);
      --accent: oklch(0.62 0.28 330);
      --accent-foreground: oklch(0.99 0.01 330);
      --brand-bg: linear-gradient(135deg, oklch(0.6 0.27 292), oklch(0.66 0.28 352));
      --wave: oklch(0.68 0.28 350);
      --green: oklch(0.74 0.16 158);
      --green-foreground: oklch(0.16 0.04 158);
      --yellow: oklch(0.8 0.15 85);
      --yellow-foreground: oklch(0.2 0.05 85);
      --red: oklch(0.72 0.2 18);
      --purple: oklch(0.6 0.27 292);
      --radius: 0.625rem;
      --font-display: 'Space Grotesk', 'Sora', sans-serif;
      --font-sans: 'Sora', sans-serif;
      --font-mono: 'JetBrains Mono', ui-monospace, monospace;
      --font-micro: 'Inter', 'Sora', sans-serif;
      /* Chart series tokens (canvas can't read gradients; flat + alpha fills) */
      --chart-active: oklch(0.68 0.28 350);
      --chart-active-fill: oklch(0.68 0.28 350 / 16%);
      --chart-human: oklch(0.6 0.27 292);
      --chart-human-fill: oklch(0.6 0.27 292 / 22%);
      --chart-user: oklch(0.74 0.16 158);
      --chart-user-fill: oklch(0.74 0.16 158 / 16%);
      --chart-asst: oklch(0.79 0.07 320 / 70%);
      --chart-asst-fill: oklch(0.79 0.07 320 / 10%);
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: var(--font-sans);
      background: var(--bg);
      color: var(--text);
      height: 100vh;
      display: flex;
      flex-direction: column;
    }

    header {
      position: sticky;
      top: 0;
      z-index: 30;
      background: color-mix(in oklab, var(--bg) 85%, transparent);
      backdrop-filter: blur(12px);
      border-bottom: 1px solid var(--border);
      padding: 0 1.25rem;
      height: 3.5rem;
      display: flex;
      align-items: center;
      gap: 1.5rem;
      flex-shrink: 0;
    }

    .logo {
      font-family: var(--font-display);
      font-size: 1.15rem;
      font-weight: 600;
      letter-spacing: -0.02em;
      background: var(--brand-bg);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    .search-box {
      flex: 1;
      max-width: 360px;
      margin-left: auto;
    }

    .search-box input {
      width: 100%;
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: calc(var(--radius) * 0.8);
      padding: 0.45rem 0.75rem;
      color: var(--text);
      font-family: var(--font-micro);
      font-size: 0.85rem;
    }

    .search-box input::placeholder { color: var(--text-muted); opacity: 0.7; }

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
      width: 220px;
      background: var(--bg-secondary);
      border-right: 1px solid var(--border);
      overflow-y: auto;
      padding: 0.75rem 0.6rem;
      flex-shrink: 0;
    }

    .sidebar h3 {
      font-family: var(--font-micro);
      font-size: 0.68rem;
      font-weight: 600;
      text-transform: uppercase;
      color: var(--text-muted);
      opacity: 0.7;
      padding: 0.5rem;
      letter-spacing: 0.18em;
    }

    .project-item {
      padding: 0.45rem 0.75rem;
      border-radius: calc(var(--radius) * 0.8);
      cursor: pointer;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-family: var(--font-micro);
      font-size: 0.85rem;
      color: var(--text-muted);
      transition: color 0.15s, background 0.15s;
    }

    .project-item:hover { background: var(--bg-tertiary); color: var(--text); }
    .project-item.active { background: var(--bg-active); color: var(--text); }

    .project-count {
      font-family: var(--font-mono);
      font-variant-numeric: tabular-nums;
      font-size: 0.7rem;
      background: var(--bg);
      padding: 0.1rem 0.45rem;
      border-radius: 10px;
      color: var(--text-muted);
    }

    .project-item.active .project-count {
      background: oklch(0 0 0 / 25%);
      color: var(--text);
    }

    .content {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .tabs {
      display: flex;
      gap: 0.25rem;
      border-bottom: 1px solid var(--border);
      padding: 0.5rem 1.25rem;
      flex-shrink: 0;
    }

    .tab {
      padding: 0.4rem 0.85rem;
      cursor: pointer;
      border-radius: calc(var(--radius) * 0.8);
      color: var(--text-muted);
      font-family: var(--font-micro);
      font-size: 0.85rem;
      font-weight: 500;
      transition: color 0.15s, background 0.15s;
    }

    .tab:hover { color: var(--text); }
    .tab.active { background: var(--bg-active); color: var(--text); }

    .tab-badge {
      font-family: var(--font-mono);
      font-variant-numeric: tabular-nums;
      font-size: 0.68rem;
      background: var(--bg-secondary);
      padding: 0.1rem 0.4rem;
      border-radius: 10px;
      margin-left: 0.4rem;
    }

    .fragments-container {
      flex: 1;
      overflow-y: auto;
      padding: 1.25rem;
      /* center content at a readable width; scrollbar stays at the window edge */
      padding-inline: max(1.25rem, calc((100% - 1280px) / 2));
    }

    .fragment {
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: calc(var(--radius) * 1.4);
      padding: 1.1rem 1.25rem;
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
      font-family: var(--font-mono);
      font-size: 0.72rem;
      color: var(--text-muted);
      background: var(--bg);
      padding: 0.2rem 0.45rem;
      border-radius: calc(var(--radius) * 0.6);
      cursor: pointer;
      transition: background 0.2s;
    }

    .fragment-id:hover { background: var(--accent); color: var(--accent-foreground); }
    .fragment-id.copied { background: var(--green); color: var(--green-foreground); }

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

    .badge-certain { background: var(--green); color: var(--green-foreground); }
    .badge-tentative { background: var(--yellow); color: var(--yellow-foreground); }
    .badge-revisiting { background: var(--red); color: var(--accent-foreground); }

    .musings-box {
      background: linear-gradient(135deg, oklch(0.6 0.27 292 / 12%), oklch(0.66 0.28 352 / 12%));
      border: 1px solid oklch(0.82 0.14 330 / 35%);
      border-radius: calc(var(--radius) * 1.4);
      padding: 1rem 1.25rem;
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
      border-radius: calc(var(--radius) * 1.4);
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
      font-family: var(--font-mono);
      font-size: 0.78rem;
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
      font-family: var(--font-micro);
      font-size: 0.72rem;
      font-weight: 600;
      color: var(--text-muted);
      opacity: 0.8;
      text-transform: uppercase;
      letter-spacing: 0.18em;
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
      font-family: var(--font-mono);
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

    /* Activity view — sized so cards + both day-series graphs fit one screen */
    .activity-toolbar {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      margin-bottom: 0.85rem;
    }

    .activity-scope {
      font-family: var(--font-micro);
      color: var(--text-muted);
      opacity: 0.8;
      font-size: 0.78rem;
      margin-left: auto;
    }

    .range-btn {
      background: transparent;
      border: 1px solid var(--border);
      border-radius: calc(var(--radius) * 0.8);
      color: var(--text-muted);
      padding: 0.3rem 0.7rem;
      font-family: var(--font-micro);
      font-size: 0.8rem;
      font-weight: 500;
      cursor: pointer;
      transition: color 0.15s, background 0.15s, border-color 0.15s;
    }

    .range-btn:hover { color: var(--text); border-color: var(--accent); }
    .range-btn.active { background: var(--accent); color: var(--accent-foreground); border-color: var(--accent); }

    .stat-cards {
      display: grid;
      grid-template-columns: repeat(8, 1fr);
      gap: 0.6rem;
      margin-bottom: 0.85rem;
    }

    @media (max-width: 1100px) {
      .stat-cards { grid-template-columns: repeat(4, 1fr); }
    }

    .stat-card {
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: calc(var(--radius) * 1.4);
      padding: 0.7rem 0.9rem;
    }

    .stat-card-value {
      font-family: var(--font-mono);
      font-variant-numeric: tabular-nums;
      font-size: 1.25rem;
      font-weight: 600;
      color: var(--wave);
    }

    .stat-card-value.purple { color: var(--purple); }
    .stat-card-value.green { color: var(--green); }
    .stat-card-value.plain { color: var(--text); }

    .stat-card-label {
      font-family: var(--font-micro);
      font-size: 0.62rem;
      font-weight: 600;
      color: var(--text-muted);
      opacity: 0.75;
      text-transform: uppercase;
      letter-spacing: 0.16em;
      margin-top: 0.2rem;
    }

    .chart-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.6rem;
    }

    .chart-box {
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: calc(var(--radius) * 1.4);
      padding: 0.85rem 1rem;
    }

    .chart-box.wide { grid-column: 1 / -1; }

    .chart-title {
      font-family: var(--font-micro);
      font-size: 0.68rem;
      font-weight: 600;
      color: var(--text-muted);
      opacity: 0.75;
      text-transform: uppercase;
      letter-spacing: 0.18em;
      margin-bottom: 0.6rem;
    }

    /* Fixed chart heights — Chart.js runs with maintainAspectRatio: false */
    .chart-canvas { position: relative; height: 215px; }
    .chart-canvas.short { height: 150px; }
    .chart-canvas.small { height: 185px; }

    /* Activity is global — the per-project sidebar is dead weight there */
    body.activity-view .sidebar { display: none; }

    /* Recently touched projects */
    .recent-projects { padding-bottom: 0.4rem; }

    .recent-row {
      display: grid;
      grid-template-columns: minmax(180px, 1.4fr) 5.5rem 4.5rem 7.5rem 4.5rem 1fr;
      gap: 0.75rem;
      align-items: center;
      padding: 0.4rem 0.5rem;
      margin: 0 -0.5rem;
      border-top: 1px solid var(--grid);
      border-radius: calc(var(--radius) * 0.6);
      font-size: 0.82rem;
      cursor: pointer;
      transition: background 0.15s;
    }

    .recent-row:hover { background: var(--bg-tertiary); }
    .recent-row:first-of-type { border-top: none; }
    .recent-row.copied .recent-age { color: var(--green); }

    .recent-name {
      font-family: var(--font-micro);
      font-weight: 500;
      color: var(--text);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .recent-path {
      color: var(--text-muted);
      opacity: 0.7;
      font-weight: 400;
    }

    .recent-num {
      font-family: var(--font-mono);
      font-variant-numeric: tabular-nums;
      font-size: 0.75rem;
      color: var(--text-muted);
      text-align: right;
      white-space: nowrap;
    }

    .recent-num.bright { color: var(--text); }

    .recent-bar-track {
      height: 4px;
      border-radius: 2px;
      background: var(--grid);
      overflow: hidden;
    }

    .recent-bar-fill {
      height: 100%;
      border-radius: 2px;
      background: var(--brand-bg);
    }
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
        <div class="tab active" data-tab="activity">Activity</div>
        <div class="tab" data-tab="decisions">Decisions <span class="tab-badge" id="decisions-count">0</span></div>
        <div class="tab" data-tab="insights">Insights <span class="tab-badge" id="insights-count">0</span></div>
        <div class="tab" data-tab="gotchas">Gotchas <span class="tab-badge" id="gotchas-count">0</span></div>
        <div class="tab" data-tab="quotes">Quotes <span class="tab-badge" id="quotes-count">0</span></div>
        <div class="tab" data-tab="sessions">Sessions <span class="tab-badge" id="sessions-count">0</span></div>
      </div>

      <div class="fragments-container" id="fragments">
        <div class="empty-state">Loading activity…</div>
      </div>
    </main>
  </div>

  <script>
    let currentProject = null;
    let currentTab = 'activity';
    let projectData = null;
    let sessionsData = [];
    let vaultArtifacts = [];
    let activityRange = '30d';
    let activityCharts = [];

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

      // Load project data, sessions, and vault artifacts in parallel
      const [projectRes, sessionsRes, vaultRes] = await Promise.all([
        fetch(\`/api/projects/\${encodeURIComponent(id)}\`),
        fetch(\`/api/projects/\${encodeURIComponent(id)}/sessions\`),
        fetch(\`/api/projects/\${encodeURIComponent(id)}/vault-artifacts\`)
      ]);
      projectData = await projectRes.json();
      sessionsData = await sessionsRes.json();
      vaultArtifacts = await vaultRes.json();

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

      // Activity is global — no project selection required, and the
      // per-project sidebar is irrelevant there.
      document.body.classList.toggle('activity-view', currentTab === 'activity');
      if (currentTab === 'activity') {
        renderActivity(container);
        return;
      }

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

    // Activity view — charts over /api/activity (the \`prose stats\` verb)
    const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

    function fmtAge(ms) {
      if (ms < 60000) return Math.round(ms / 1000) + 's ago';
      if (ms < 3600000) return Math.round(ms / 60000) + 'm ago';
      if (ms < 86400000) return Math.round(ms / 3600000) + 'h ago';
      return Math.round(ms / 86400000) + 'd ago';
    }

    // The 10 most recently touched projects, with activity share bars.
    function renderRecentProjects(projects) {
      const recent = projects.slice(0, 10);
      if (!recent.length) return '<div class="empty-state">No projects in this window</div>';
      const maxActive = Math.max(...recent.map(p => p.activeMs), 1);
      const now = Date.now();
      return recent.map(p => {
        const name = p.cwd.split('/').filter(Boolean).pop() || p.cwd;
        const parent = p.cwd.slice(0, p.cwd.length - name.length);
        return \`
          <div class="recent-row" data-cwd="\${p.cwd}" title="Click to copy: cd \${p.cwd}">
            <div class="recent-name"><span class="recent-path">\${parent}</span>\${name}</div>
            <div class="recent-num bright recent-age">\${fmtAge(now - new Date(p.lastActivity).getTime())}</div>
            <div class="recent-num bright">\${(p.activeMs / 3600000).toFixed(1)}h</div>
            <div class="recent-num">\${p.userMessages.toLocaleString()}u / \${p.assistantMessages.toLocaleString()}a</div>
            <div class="recent-num">\${p.sessions} sess</div>
            <div class="recent-bar-track"><div class="recent-bar-fill" style="width: \${Math.max(2, Math.round((p.activeMs / maxActive) * 100))}%"></div></div>
          </div>
        \`;
      }).join('');
    }

    // Click a project row → "cd /path/to/project" lands on the clipboard.
    function bindRecentProjectRows(container) {
      container.querySelectorAll('.recent-row').forEach(row => {
        row.addEventListener('click', () => {
          navigator.clipboard.writeText('cd ' + row.dataset.cwd);
          const age = row.querySelector('.recent-age');
          if (!row.dataset.origAge) row.dataset.origAge = age.textContent;
          row.classList.add('copied');
          age.textContent = 'copied!';
          setTimeout(() => {
            row.classList.remove('copied');
            age.textContent = row.dataset.origAge;
          }, 1200);
        });
      });
    }

    async function renderActivity(container) {
      container.innerHTML = '<div class="empty-state">Crunching session journals…</div>';

      const res = await fetch(\`/api/activity?since=\${activityRange}\`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        container.innerHTML = \`<div class="empty-state">Activity failed: \${err.error || res.status}</div>\`;
        return;
      }
      const data = await res.json();

      const ranges = ['7d', '14d', '30d', '90d'];
      const toolbar = \`
        <div class="activity-toolbar">
          \${ranges.map(r => \`<button class="range-btn \${r === activityRange ? 'active' : ''}" data-range="\${r}">\${r}</button>\`).join('')}
          <span class="activity-scope">all projects, all sources · idle gap \${Math.round(data.idleGapMs / 60000)}m</span>
        </div>
      \`;

      if (!data.days.length) {
        container.innerHTML = toolbar + '<div class="empty-state">No session activity in this window</div>';
        bindRangeButtons(container);
        return;
      }

      const t = data.totals;
      const hrs = (ms) => (ms / 3600000).toFixed(1);
      container.innerHTML = \`
        \${toolbar}
        <div class="stat-cards">
          <div class="stat-card"><div class="stat-card-value">\${hrs(t.activeMs)}h</div><div class="stat-card-label">active</div></div>
          <div class="stat-card"><div class="stat-card-value purple">\${hrs(t.humanMs)}h</div><div class="stat-card-label">human</div></div>
          <div class="stat-card" title="Average over closed days only — today is still accruing"><div class="stat-card-value plain">\${t.averages ? hrs(t.averages.activeMsPerDay) + 'h' : '—'}</div><div class="stat-card-label">avg / day</div></div>
          <div class="stat-card"><div class="stat-card-value">\${t.peakDay ? hrs(t.peakDay.activeMs) + 'h' : '—'}</div><div class="stat-card-label">peak \${t.peakDay ? t.peakDay.day.slice(5) : 'day'}</div></div>
          <div class="stat-card"><div class="stat-card-value green">\${t.userMessages.toLocaleString()}</div><div class="stat-card-label">user msgs</div></div>
          <div class="stat-card"><div class="stat-card-value plain">\${t.assistantMessages.toLocaleString()}</div><div class="stat-card-label">asst msgs</div></div>
          <div class="stat-card"><div class="stat-card-value plain">\${t.sessions}</div><div class="stat-card-label">sessions</div></div>
          <div class="stat-card"><div class="stat-card-value plain">\${t.projects}</div><div class="stat-card-label">projects</div></div>
        </div>
        <div class="chart-grid">
          <div class="chart-box wide"><div class="chart-title">Hours per day</div><div class="chart-canvas"><canvas id="chart-hours"></canvas></div></div>
          <div class="chart-box wide"><div class="chart-title">Messages per day</div><div class="chart-canvas short"><canvas id="chart-messages"></canvas></div></div>
          <div class="chart-box"><div class="chart-title">User messages by hour of day</div><div class="chart-canvas small"><canvas id="chart-hourhist"></canvas></div></div>
          <div class="chart-box"><div class="chart-title">Messages by source</div><div class="chart-canvas small"><canvas id="chart-sources"></canvas></div></div>
          <div class="chart-box wide recent-projects">
            <div class="chart-title">Recently touched projects</div>
            \${renderRecentProjects(data.projects)}
          </div>
        </div>
      \`;
      bindRangeButtons(container);
      bindRecentProjectRows(container);

      const wave = cssVar('--chart-active'), waveFill = cssVar('--chart-active-fill'),
            violet = cssVar('--chart-human'), violetFill = cssVar('--chart-human-fill'),
            green = cssVar('--chart-user'), greenFill = cssVar('--chart-user-fill'),
            mutedLine = cssVar('--chart-asst'), mutedFill = cssVar('--chart-asst-fill'),
            accent = cssVar('--accent'), muted = cssVar('--text-muted'),
            grid = cssVar('--grid'), yellow = cssVar('--yellow');

      Chart.defaults.color = muted;
      Chart.defaults.borderColor = grid;
      Chart.defaults.font.family = getComputedStyle(document.documentElement).getPropertyValue('--font-micro');
      Chart.defaults.font.size = 10;

      activityCharts.forEach(c => c.destroy());
      activityCharts = [];

      const labels = data.days.map(d => d.day.slice(5)); // MM-DD
      const line = (label, points, color, fillColor) => ({
        label,
        data: points,
        borderColor: color,
        backgroundColor: fillColor,
        fill: true,
        tension: 0.35,
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 3,
        pointHitRadius: 12,
      });
      const baseOpts = {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { labels: { usePointStyle: true, pointStyle: 'circle', boxWidth: 5, boxHeight: 5 } } },
        scales: {
          x: { grid: { color: grid }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 16 } },
          y: { grid: { color: grid }, beginAtZero: true },
        },
      };

      activityCharts.push(new Chart(document.getElementById('chart-hours'), {
        type: 'line',
        data: {
          labels,
          datasets: [
            line('active (any agent)', data.days.map(d => d.activeMs / 3600000), wave, waveFill),
            line('human (you at the keys)', data.days.map(d => d.humanMs / 3600000), violet, violetFill),
          ],
        },
        options: {
          ...baseOpts,
          scales: {
            ...baseOpts.scales,
            // A day has 24 hours — pin the scale so a 16h day reads as 2/3 of
            // a day, not as a full-height peak.
            y: { ...baseOpts.scales.y, max: 24, ticks: { stepSize: 6 } },
          },
        },
      }));

      activityCharts.push(new Chart(document.getElementById('chart-messages'), {
        type: 'line',
        data: {
          labels,
          datasets: [
            line('user', data.days.map(d => d.userMessages), green, greenFill),
            line('assistant', data.days.map(d => d.assistantMessages), mutedLine, mutedFill),
          ],
        },
        options: baseOpts,
      }));

      activityCharts.push(new Chart(document.getElementById('chart-hourhist'), {
        type: 'line',
        data: {
          labels: Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0')),
          datasets: [line('user messages', data.hourHistogram, wave, waveFill)],
        },
        options: { ...baseOpts, plugins: { legend: { display: false } } },
      }));

      const sourceEntries = Object.entries(t.sources).sort((a, b) => b[1] - a[1]);
      activityCharts.push(new Chart(document.getElementById('chart-sources'), {
        type: 'doughnut',
        data: {
          labels: sourceEntries.map(([s]) => s),
          datasets: [{
            data: sourceEntries.map(([, n]) => n),
            backgroundColor: [wave, violet, green, yellow],
            borderColor: cssVar('--bg-secondary'),
            borderWidth: 2,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: '68%',
          plugins: { legend: { position: 'right', labels: { usePointStyle: true, pointStyle: 'circle', boxWidth: 5, boxHeight: 5 } } },
        },
      }));
    }

    function bindRangeButtons(container) {
      container.querySelectorAll('.range-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          activityRange = btn.dataset.range;
          renderActivity(document.getElementById('fragments'));
        });
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
                  <a href="/artifacts/\${encodeURIComponent(currentProject)}/\${session.id}" style="color: var(--accent); font-size: 0.8rem; text-decoration: none; border: 1px solid var(--accent); padding: 0.25rem 0.5rem; border-radius: 4px; transition: all 0.2s; display: inline-block; cursor: pointer;"
                     onmouseover="this.style.background='var(--accent)'; this.style.color='#000'"
                     onmouseout="this.style.background='transparent'; this.style.color='var(--accent)'">
                    📄 View Artifact
                  </a>
                </div>
              \` : ''}
            </div>
          </div>
        \`;
      }

      // Add vault artifacts section
      if (vaultArtifacts && vaultArtifacts.length > 0) {
        html += \`
          <div style="margin-top: 2rem; padding-top: 2rem; border-top: 1px solid var(--border);">
            <h3 style="color: var(--accent); margin-bottom: 1rem;">📚 Verbatim Artifacts (\${vaultArtifacts.length})</h3>
            <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 0.75rem;">
              \${vaultArtifacts.map(artifact => {
                const sessionId = artifact.replace('session-', '').replace('.md', '');
                return \`
                  <a href="/artifacts/\${encodeURIComponent(currentProject)}/\${sessionId}"
                     style="display: block; padding: 0.75rem; background: var(--bg-tertiary); border: 1px solid var(--border); border-radius: 6px; color: var(--accent); text-decoration: none; font-size: 0.85rem; text-align: center; transition: all 0.2s; cursor: pointer;"
                     onmouseover="this.style.background='var(--bg-secondary)'; this.style.borderColor='var(--accent)'"
                     onmouseout="this.style.background='var(--bg-tertiary)'; this.style.borderColor='var(--border)'">
                    📄 \${sessionId}
                  </a>
                \`;
              }).join('')}
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
    renderFragments();
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
