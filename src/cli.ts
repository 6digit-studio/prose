#!/usr/bin/env node
/**
 * Claude Prose CLI - Semantic memory for AI development sessions
 *
 * Commands:
 *   evolve   - Process sessions and evolve fragments
 *   search   - Semantic search through memory (alias: grep)
 *   status   - Show memory statistics
 *   show     - Display current fragments for a project
 */

import { Command } from 'commander';
import { discoverSessionFiles, parseSessionFile, getSessionStats } from './session-parser.js';
import { evolveAllFragments } from './evolve.js';
import { emptyFragments } from './schemas.js';
import {
  loadMemoryIndex,
  saveMemoryIndex,
  loadProjectMemory,
  saveProjectMemory,
  createProjectMemory,
  updateProjectMemory,
  sessionNeedsProcessing,
  getSessionProcessingState,
  searchMemory,
  getMemoryStats,
  getMemoryDir,
  generateContextMarkdown,
  writeContextFile,
} from './memory.js';

const program = new Command();

program
  .name('claude-prose')
  .description('Semantic memory for AI development sessions - extract, evolve, and query the meaning of your collaboration')
  .version('0.1.0');

// ============================================================================
// evolve - Process sessions and evolve fragments
// ============================================================================

program
  .command('evolve')
  .description('Process Claude Code sessions and evolve semantic fragments')
  .option('-p, --project <path>', 'Filter to specific project path')
  .option('-l, --limit <n>', 'Limit number of sessions to process', '10')
  .option('-f, --force', 'Reprocess already-processed sessions')
  .option('--dry-run', 'Show what would be processed without making changes')
  .option('-v, --verbose', 'Show detailed progress')
  .action(async (options) => {
    const apiKey = process.env.LLM_API_KEY || process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      console.error('❌ No API key found. Set LLM_API_KEY or OPENROUTER_API_KEY');
      process.exit(1);
    }

    console.log('🧬 Claude Prose - Evolving semantic memory\n');

    // Discover sessions - sort OLDEST first for proper temporal evolution
    const sessions = discoverSessionFiles(options.project);
    // Reverse to get oldest first (discoverSessionFiles returns newest first)
    const sessionsOldestFirst = [...sessions].reverse();
    const limit = parseInt(options.limit, 10);
    const sessionsToProcess = sessionsOldestFirst.slice(0, limit);

    if (options.verbose) {
      console.log(`📁 Found ${sessions.length} sessions, processing ${sessionsToProcess.length}`);
    }

    // Load memory index
    const index = loadMemoryIndex();

    let processed = 0;
    let skipped = 0;
    let totalTokens = 0;

    for (const session of sessionsToProcess) {
      const projectName = session.project;

      // Load or create project memory
      let memory = loadProjectMemory(projectName) || createProjectMemory(projectName);

      // Parse session first to get message count
      const conversation = parseSessionFile(session.path);

      // Skip if already fully processed (unless --force)
      if (!options.force && !sessionNeedsProcessing(
        memory,
        session.sessionId,
        conversation.messages.length,
        session.modifiedTime
      )) {
        if (options.verbose) {
          console.log(`⏭️  Skipping ${session.sessionId.slice(0, 8)}... (already processed, ${conversation.messages.length} messages)`);
        }
        skipped++;
        continue;
      }

      // Check if this is an incremental update
      const prevState = getSessionProcessingState(memory, session.sessionId);
      const isIncremental = prevState && prevState.messageCount < conversation.messages.length;

      if (isIncremental) {
        console.log(`📖 Updating ${session.sessionId.slice(0, 8)}... (+${conversation.messages.length - prevState.messageCount} new messages)`);
      } else {
        console.log(`📖 Processing ${session.sessionId.slice(0, 8)}... (${projectName.slice(-30)})`);
      }

      if (conversation.messages.length === 0) {
        console.log('   ⚠️  No messages, skipping');
        continue;
      }

      if (options.dryRun) {
        console.log('   [dry-run] Would evolve fragments');
        continue;
      }

      // Window size for evolution - Gemini 2.5 Flash has 1M context, so we can go big
      // Process whole session at once unless it's huge (>500 messages)
      const windowSize = 500;
      const windows = [];
      for (let i = 0; i < conversation.messages.length; i += windowSize) {
        windows.push(conversation.messages.slice(i, i + windowSize));
      }

      // Evolve through windows
      let currentFragments = memory.current;
      let allSourceLinks: typeof conversation.messages[0]['source'][] = [];

      for (let i = 0; i < windows.length; i++) {
        const window = windows[i];

        if (options.verbose) {
          console.log(`   🔄 Window ${i + 1}/${windows.length} (${window.length} messages)`);
        }

        const result = await evolveAllFragments(
          currentFragments,
          {
            messages: window,
            allFragments: currentFragments,
            project: conversation.project,
            sessionId: conversation.sessionId,
          },
          { apiKey }
        );

        if (result.errors.length > 0 && options.verbose) {
          for (const error of result.errors) {
            console.log(`   ⚠️  ${error}`);
          }
        }

        currentFragments = result.fragments;
        allSourceLinks.push(...result.sourceLinks);
        totalTokens += result.tokensUsed;
      }

      // Update memory with message count for incremental tracking
      memory = updateProjectMemory(
        memory,
        currentFragments,
        session.sessionId,
        allSourceLinks,
        conversation.messages.length,
        session.modifiedTime
      );
      saveProjectMemory(memory);

      // Update index
      index.projects[projectName] = {
        lastUpdated: new Date().toISOString() as unknown as Date,
      } as any;

      processed++;
      console.log(`   ✅ Evolved (${windows.length} windows, ${totalTokens} tokens total)`);
    }

    // Save index
    if (!options.dryRun) {
      saveMemoryIndex(index);
    }

    console.log('\n📊 Summary:');
    console.log(`   Processed: ${processed} sessions`);
    console.log(`   Skipped: ${skipped} sessions (already processed)`);
    console.log(`   Tokens used: ${totalTokens}`);
    console.log(`   Memory stored: ${getMemoryDir()}`);
  });

// ============================================================================
// search - Semantic search through memory
// ============================================================================

program
  .command('search <query>')
  .alias('grep')
  .description('Semantic search through evolved memory')
  .option('-p, --project <name>', 'Filter to specific project')
  .option('-t, --type <types>', 'Filter by type: decision,insight,gotcha,narrative,quote', 'decision,insight,gotcha')
  .option('-l, --limit <n>', 'Limit results', '10')
  .option('--json', 'Output as JSON')
  .action((query, options) => {
    const types = options.type.split(',') as any[];
    const limit = parseInt(options.limit, 10);

    const results = searchMemory(query, {
      projects: options.project ? [options.project] : undefined,
      types,
      limit,
    });

    if (options.json) {
      console.log(JSON.stringify(results, null, 2));
      return;
    }

    if (results.length === 0) {
      console.log(`❌ No results found for "${query}"`);
      return;
    }

    console.log(`🔍 Found ${results.length} results for "${query}":\n`);

    for (const result of results) {
      const typeIcon = {
        decision: '⚖️ ',
        insight: '💡',
        gotcha: '⚠️ ',
        narrative: '📖',
        quote: '💬',
      }[result.type];

      const project = result.project.replace(/^-Users-[^-]+-src-/, '');
      console.log(`${typeIcon} [${result.type}] (${project})`);
      console.log(`   ${result.content}`);
      if (result.context) {
        console.log(`   → ${result.context}`);
      }
      console.log('');
    }
  });

// ============================================================================
// status - Show memory statistics
// ============================================================================

program
  .command('status')
  .description('Show memory statistics')
  .action(() => {
    const stats = getMemoryStats();
    const sessionStats = getSessionStats();

    console.log('📊 Claude Prose Memory Status\n');

    console.log('📁 Available Sessions:');
    console.log(`   Total sessions: ${sessionStats.totalSessions}`);
    console.log(`   Total messages: ${sessionStats.totalMessages}`);
    console.log(`   Projects: ${sessionStats.projects.length}`);
    if (sessionStats.dateRange.earliest && sessionStats.dateRange.latest) {
      console.log(`   Date range: ${sessionStats.dateRange.earliest.toLocaleDateString()} - ${sessionStats.dateRange.latest.toLocaleDateString()}`);
    }

    console.log('\n🧠 Evolved Memory:');
    console.log(`   Projects: ${stats.totalProjects}`);
    console.log(`   Sessions processed: ${stats.totalSessions}`);
    console.log(`   Decisions captured: ${stats.totalDecisions}`);
    console.log(`   Insights captured: ${stats.totalInsights}`);
    if (stats.lastUpdated) {
      console.log(`   Last updated: ${stats.lastUpdated.toLocaleString()}`);
    }

    console.log(`\n📂 Memory location: ${getMemoryDir()}`);
  });

// ============================================================================
// show - Display current fragments for a project
// ============================================================================

program
  .command('show <project>')
  .description('Display current fragments for a project')
  .option('--decisions', 'Show only decisions')
  .option('--insights', 'Show only insights')
  .option('--narrative', 'Show only narrative')
  .option('--json', 'Output as JSON')
  .action((project, options) => {
    // Try to match project by partial name
    const index = loadMemoryIndex();
    const projectNames = Object.keys(index.projects);

    const matchedProject = projectNames.find(p =>
      p.toLowerCase().includes(project.toLowerCase())
    );

    if (!matchedProject) {
      console.error(`❌ Project "${project}" not found`);
      console.log('Available projects:');
      for (const p of projectNames) {
        console.log(`  - ${p.replace(/^-Users-[^-]+-src-/, '')}`);
      }
      process.exit(1);
    }

    const memory = loadProjectMemory(matchedProject);
    if (!memory) {
      console.error(`❌ No memory found for project "${matchedProject}"`);
      process.exit(1);
    }

    if (options.json) {
      console.log(JSON.stringify(memory.current, null, 2));
      return;
    }

    const shortName = matchedProject.replace(/^-Users-[^-]+-src-/, '');
    console.log(`🧠 Memory for: ${shortName}\n`);
    console.log(`   Sessions processed: ${memory.processedSessions.length}`);
    console.log(`   Last updated: ${memory.lastUpdated.toLocaleString()}\n`);

    const showAll = !options.decisions && !options.insights && !options.narrative;

    if (showAll || options.decisions) {
      console.log('⚖️  DECISIONS:');
      for (const decision of memory.current.decisions?.decisions || []) {
        console.log(`   • ${decision.what}`);
        console.log(`     Why: ${decision.why}`);
        console.log(`     Confidence: ${decision.confidence}`);
        console.log('');
      }
    }

    if (showAll || options.insights) {
      console.log('💡 INSIGHTS:');
      for (const insight of memory.current.insights?.insights || []) {
        console.log(`   • ${insight.learning}`);
        if (insight.context) {
          console.log(`     Context: ${insight.context}`);
        }
        console.log('');
      }

      if (memory.current.insights?.gotchas?.length) {
        console.log('⚠️  GOTCHAS:');
        for (const gotcha of memory.current.insights.gotchas) {
          console.log(`   • ${gotcha.issue}`);
          if (gotcha.solution) {
            console.log(`     Solution: ${gotcha.solution}`);
          }
          console.log('');
        }
      }
    }

    if (showAll || options.narrative) {
      console.log('📖 NARRATIVE:');
      for (const beat of memory.current.narrative?.story_beats || []) {
        const tone = beat.emotional_tone ? ` (${beat.emotional_tone})` : '';
        console.log(`   [${beat.beat_type}]${tone}: ${beat.summary}`);
      }
      console.log('');

      if (memory.current.narrative?.memorable_quotes?.length) {
        console.log('💬 QUOTES:');
        for (const quote of memory.current.narrative.memorable_quotes) {
          console.log(`   "${quote.quote}" - ${quote.speaker}`);
        }
      }
    }
  });

// ============================================================================
// context - Generate markdown for slash command injection
// ============================================================================

program
  .command('context <project>')
  .description('Generate context markdown for slash command injection')
  .option('-o, --output <path>', 'Output file path (default: stdout)')
  .option('--install', 'Install as Claude Code slash command in current project')
  .action((project, options) => {
    // Try to match project by partial name
    const index = loadMemoryIndex();
    const projectNames = Object.keys(index.projects);

    const matchedProject = projectNames.find(p =>
      p.toLowerCase().includes(project.toLowerCase())
    );

    if (!matchedProject) {
      console.error(`❌ Project "${project}" not found`);
      console.log('Available projects:');
      for (const p of projectNames) {
        console.log(`  - ${p.replace(/^-Users-[^-]+-src-/, '')}`);
      }
      process.exit(1);
    }

    const markdown = generateContextMarkdown(matchedProject);
    if (!markdown) {
      console.error(`❌ No memory found for project "${matchedProject}"`);
      process.exit(1);
    }

    if (options.install) {
      // Install as slash command in .claude/commands/
      const commandsDir = '.claude/commands';
      const commandPath = `${commandsDir}/memory.md`;

      writeContextFile(matchedProject, commandPath);
      console.log(`✅ Installed as slash command: /memory`);
      console.log(`   File: ${commandPath}`);
      console.log('\n   Use in Claude Code: /memory');
    } else if (options.output) {
      writeContextFile(matchedProject, options.output);
      console.log(`✅ Context written to: ${options.output}`);
    } else {
      // Output to stdout
      console.log(markdown);
    }
  });

// ============================================================================
// Parse and run
// ============================================================================

program.parse();
