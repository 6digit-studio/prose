#!/usr/bin/env node
/**
 * Prose CLI - Semantic memory for AI development
 *
 * Commands:
 *   evolve   - Process sessions and evolve fragments
 *   search   - Semantic search through memory (alias: grep)
 *   status   - Show memory statistics
 *   show     - Display current fragments for a project
 */

// Load .env file if present (check multiple locations)
import { config } from 'dotenv';
import { homedir } from 'os';
import { join, basename, dirname } from 'path';
import { existsSync, mkdirSync, writeFileSync, readdirSync, appendFileSync, symlinkSync, readFileSync } from 'fs';
import { execSync } from 'child_process';
config({ quiet: true });  // Load from current directory
config({ path: join(homedir(), '.config', 'prose', '.env'), quiet: true });  // Global config

import { Command } from 'commander';
import { discoverSessionFiles, parseSessionFile, parseSessionFileFromOffset, getSessionStats, getClaudeProjectsDir, type Message, type SessionFile } from './session-parser.js';
import { evolveAllFragments } from './evolve.js';
import { emptyFragments, type AllFragments } from './schemas.js';
import {
  loadMemoryIndex,
  saveMemoryIndex,
  loadProjectMemory,
  saveProjectMemory,
  createProjectMemory,
  updateProjectMemory,
  updateCurrentFragments,
  sessionNeedsProcessing,
  sessionNeedsProcessingFast,
  getSessionProcessingState,
  searchMemory,
  getMemoryStats,
  generateContextMarkdown,
  writeContextFile,
  writeVerbatimSessionArtifact,
  sanitizePath,
  getMemoryDir,
  isVaultRepo,
  commitToVault,
  loadProjectVectors,
  saveProjectVectors,
  calculateFragmentHash,
  getGlobalConfig,
  saveGlobalConfig,
  loadSourceManifest,
  getApiKey,
} from './memory.js';
import { getJinaEmbeddings, cosineSimilarity } from './jina.js';
import { evolveHorizontal } from './horizontal.js';
import { generateWebsite } from './web.js';
import { indexProjectSource } from './source-indexer.js';
import { getGitCommits, isGitRepo, getAntigravityBrains, getAntigravityArtifacts, parseAntigravityArtifact, matchBrainToProject, getLatestGitCommitDate, getDesignSessions, parseDesignSession } from './source-parsers.js';
import { startServer } from './server.js';
import { injectMemory, ensureTemplate, initSkillFile, writeSkillFile } from './injector.js';
import { startDesignSession } from './design.js';
import * as logger from './logger.js';

const program = new Command();

program
  .name('prose')
  .description('Semantic memory for AI development - extract, evolve, and query the meaning of your collaboration')
  .version('0.1.0-alpha.3')
  .option('--api-key <key>', 'Override LLM API key')
  .option('-v, --verbose', 'Show detailed progress')
  .option('-q, --quiet', 'Suppress unnecessary output')
  .option('--trace', 'Show extremely detailed debugging logs')
  .on('option:verbose', () => logger.setLogLevel(logger.LogLevel.VERBOSE))
  .on('option:quiet', () => logger.setLogLevel(logger.LogLevel.ERROR))
  .on('option:trace', () => logger.setLogLevel(logger.LogLevel.TRACE));

/**
 * Helper to detect the current project based on CWD
 */
function detectProjectFromCwd(): string | undefined {
  const cwd = process.cwd();
  const cwdSanitized = sanitizePath(cwd);

  // 1. Check evolved memory index
  const index = loadMemoryIndex();
  const indexMatch = Object.keys(index.projects).find(p =>
    p === cwdSanitized || p.endsWith(cwdSanitized) || cwdSanitized.endsWith(p.replace(/^-/, ''))
  );
  if (indexMatch) return indexMatch;

  // 2. Check Claude's projects directory for recent sessions
  const projectsDir = getClaudeProjectsDir();
  if (existsSync(projectsDir)) {
    const projectDirs = readdirSync(projectsDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);

    const match = projectDirs.find(p => {
      const dirName = p.replace(/^-/, '');
      return dirName === cwdSanitized ||
        dirName.endsWith(cwdSanitized) ||
        cwdSanitized.endsWith(dirName);
    });
    if (match) return match;
  }

  // 3. Fallback: check session files discovered across all projects
  const sessions = discoverSessionFiles();
  const projectNames = [...new Set(sessions.map(s => s.project))];
  return projectNames.find(p =>
    p === cwdSanitized || p.endsWith(cwdSanitized) || cwdSanitized.endsWith(p.replace(/^-/, ''))
  );
}

/**
 * Format a project name for display
 */
function formatProjectName(name: string | undefined): string {
  if (!name) return 'Unknown';
  return name.replace(/^-Users-[^-]+-src-/, '').replace(/^-/, '');
}

// ============================================================================
// init - Set up prose in a project
// ============================================================================

program
  .command('init')
  .description('Initialize prose in the current project')
  .argument('[subcommand]', 'Subcommand: "hooks" to install PreCompact hook')
  .action((subcommand) => {
    const cwd = process.cwd();
    const projectName = basename(cwd);

    if (subcommand === 'hooks') {
      // Install PreCompact hook
      console.log(`🔧 Installing PreCompact hook for: ${projectName}\n`);

      const claudeDir = '.claude';
      const settingsPath = `${claudeDir}/settings.local.json`;

      // Check if settings.local.json already exists
      if (existsSync(settingsPath)) {
        console.log(`⚠️  ${settingsPath} already exists.`);
        console.log('');
        console.log('To add the hook manually, add this to your settings.local.json:');
        console.log('');
        console.log(`  "hooks": {
    "PreCompact": [
      {
        "matcher": "manual",
        "hooks": [
          {
            "type": "command",
            "command": "prose evolve &",
            "timeout": 10
          }
        ]
      }
    ]
  }`);
        return;
      }

      // Create .claude directory if needed
      if (!existsSync(claudeDir)) {
        mkdirSync(claudeDir, { recursive: true });
      }

      // Create settings.local.json with PreCompact hook
      const settings = {
        hooks: {
          PreCompact: [
            {
              matcher: 'manual',
              hooks: [
                {
                  type: 'command',
                  command: 'prose evolve &',
                  timeout: 10,
                },
              ],
            },
          ],
        },
      };

      writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

      logger.info(`✅ Created ${settingsPath}`);
      logger.info('');
      logger.info('Now when you run /compact in Claude Code, prose will');
      logger.info('automatically evolve your session memory in the background.');
      console.log('');
      console.log('💡 Note: settings.local.json is gitignored - each developer opts in individually.');
      return;
    }

    // Default init behavior
    logger.info(`🧠 Initializing prose for: ${projectName}\n`);

    // 1. Create the flash skill (idempotent)
    initSkillFile(cwd, projectName);

    // 2. .gitignore protection for local prose data
    const gitignorePath = join(cwd, '.gitignore');
    const proseIgnore = '.claude/prose/';
    const skillIgnore = '.claude/skills/flash/';

    if (existsSync(gitignorePath)) {
      let gitignoreContent = readFileSync(gitignorePath, 'utf-8');
      let modified = false;

      if (!gitignoreContent.includes(proseIgnore)) {
        gitignoreContent += `\n# Prose local data\n${proseIgnore}\n`;
        modified = true;
      }
      if (!gitignoreContent.includes(skillIgnore)) {
        gitignoreContent += `# Prose skill (auto-generated)\n${skillIgnore}\n`;
        modified = true;
      }

      if (modified) {
        writeFileSync(gitignorePath, gitignoreContent);
        logger.info(`🛡️  Updated .gitignore with prose entries`);
      } else {
        logger.info(`ℹ️  .gitignore already has prose entries`);
      }
    } else if (isGitRepo(cwd)) {
      writeFileSync(gitignorePath, `# Prose local data\n${proseIgnore}\n# Prose skill (auto-generated)\n${skillIgnore}\n`);
      logger.info(`🛡️  Created .gitignore with prose entries`);
    }

    // 3. Create local mirror directory (optional, for session artifacts)
    const localMirrorDir = join(cwd, '.claude', 'prose');
    if (!existsSync(localMirrorDir)) {
      mkdirSync(localMirrorDir, { recursive: true });
    }

    const vaultDir = getMemoryDir();
    const vaultMirrorPath = join(vaultDir, 'mirrors', projectName);
    const localSymlinkPath = join(localMirrorDir, 'mirrors');

    if (!existsSync(localSymlinkPath)) {
      try {
        if (!existsSync(vaultMirrorPath)) {
          mkdirSync(vaultMirrorPath, { recursive: true });
        }
        symlinkSync(vaultMirrorPath, localSymlinkPath, 'dir');
        logger.info(`🔗 Linked .claude/prose/mirrors -> Vault`);
      } catch (e) {
        // Symlinks may fail on some systems - not critical
      }
    }

    console.log('');
    console.log('📝 Next steps:');
    logger.info('   1. Run: prose evolve');
    logger.info('   2. Run: prose init hooks  (optional: auto-evolve on /compact)');
    logger.info('');
    logger.info('💡 The flash skill will auto-activate when Claude needs project context.');
  });

// ============================================================================
// evolve - Process sessions and evolve fragments
// ============================================================================

program
  .command('evolve')
  .description('Process Claude Code sessions and evolve semantic fragments')
  .option('-p, --project <path>', 'Filter to specific project path')
  .option('-l, --limit <n>', 'Limit number of sessions to process', '50')
  .option('-f, --force', 'Reprocess already-processed sessions')
  .option('--dry-run', 'Show what would be processed without making changes')
  .option('-v, --verbose', 'Show detailed progress')
  .option('--trace', 'Show detailed decision tracing for debugging')
  .option('--git', 'Include git commits in evolution', true)
  .option('--no-git', 'Exclude git commits')
  .option('--antigravity', 'Include Antigravity artifacts in evolution', true)
  .option('--no-antigravity', 'Exclude Antigravity artifacts')
  .option('--artifacts', 'Export per-session Markdown artifacts', true)
  .option('--no-artifacts', 'Disable per-session artifact export')
  .action(async (options) => {
    const config = getGlobalConfig();
    const apiKey = options.apiKey || getApiKey('llm');
    const jinaApiKey = getApiKey('jina');
    if (!apiKey) {
      logger.error('No LLM API key found. Set OPENROUTER_API_KEY env var or use "prose config set openrouter-api-key <key>"');
      process.exit(1);
    }

    // Resolve artifacts preference (Option > Global Config)
    const shouldMirror = options.artifacts !== undefined ? options.artifacts : config.artifacts;

    logger.info('🧬 Prose - Evolving semantic memory');
    logger.warn('⚠️  ALPHA / EXPERIMENTAL: This tool is largely untested. Use at your own risk.');
    logger.warn('💸 COST NOTICE: Evolution performs multiple LLM passes. Monitor token usage.\n');

    // Auto-detect project from current directory if not specified
    let projectFilter = options.project;
    if (!projectFilter) {
      projectFilter = detectProjectFromCwd();
      if (projectFilter) {
        logger.info(`📁 Evolving: ${formatProjectName(projectFilter)}\n`);
      }
    }

    // Discover sessions
    const sessions = discoverSessionFiles(projectFilter, process.cwd());

    // Add Git if requested
    if (options.git) {
      const cwd = process.cwd();
      if (isGitRepo(cwd)) {
        const repoName = cwd.split('/').pop() || 'repo';
        const project = projectFilter || sanitizePath(cwd);
        const latestCommitDate = getLatestGitCommitDate(cwd);
        sessions.push({
          path: cwd,
          sessionId: `git-${repoName}`,
          project,
          modifiedTime: latestCommitDate || new Date(),
          fileSize: 1000, // Placeholder
          sourceType: 'git',
        });
      }
    }

    // Add Antigravity if requested
    if (options.antigravity && projectFilter) {
      const brains = getAntigravityBrains();
      const matchingBrains = brains.filter(b => matchBrainToProject(b, projectFilter!));

      for (const brain of matchingBrains) {
        const artifacts = getAntigravityArtifacts(brain, projectFilter!);
        for (const art of artifacts) {
          // Tag as antigravity sourceType
          sessions.push({ ...art, sourceType: 'antigravity' });
        }
      }

      // Add Intelligent Design sessions
      if (projectFilter) {
        const designSessions = getDesignSessions(process.cwd(), projectFilter);
        for (const ds of designSessions) {
          sessions.push({ ...ds, sourceType: 'design' as any });
        }
      }
    }

    const limit = parseInt(options.limit, 10);

    // Load memory index
    const index = loadMemoryIndex();

    // First pass: FAST check using file size (no parsing!)
    // Separate into: needs actual work vs just needs fileSize backfill
    const sessionsNeedingWork: typeof sessions = [];
    const trace = options.trace;

    for (const session of sessions) {
      // Skip zero-size files
      if (session.fileSize === 0) {
        logger.trace(`${session.sessionId.slice(0, 8)}: skip (zero-size file)`);
        continue;
      }

      // Load project memory for fast check
      const memory = loadProjectMemory(session.project);
      const state = getSessionProcessingState(memory, session.sessionId);
      if (!state) {
        logger.trace(`${session.sessionId.slice(0, 8)}: NEW (no prior state)`);
        sessionsNeedingWork.push(session);
      } else if (state.fileSize === undefined) {
        logger.trace(`${session.sessionId.slice(0, 8)}: baseline (has messageCount=${state.messageCount}, no fileSize)`);
        sessionsNeedingWork.push(session);
      } else if (options.force || session.fileSize > state.fileSize) {
        logger.trace(`${session.sessionId.slice(0, 8)}: ${options.force ? 'FORCE' : 'UPDATED'} (fileSize ${state.fileSize} -> ${session.fileSize})`);
        sessionsNeedingWork.push(session);
      } else {
        if (trace) logger.trace(`  [TRACE] ${session.sessionId.slice(0, 8)}: skip (up to date)`);
      }
    }

    // Sort actual work oldest-first for temporal evolution, then apply limit
    const sessionsOldestFirst = [...sessionsNeedingWork].sort((a, b) =>
      a.modifiedTime.getTime() - b.modifiedTime.getTime()
    );
    const sessionsToProcess = sessionsOldestFirst.slice(0, limit);

    if (options.verbose) {
      logger.info(`📁 Found ${sessions.length} sessions, ${sessionsNeedingWork.length} need work, processing ${sessionsToProcess.length}`);
    }

    let processed = 0;
    let totalTokens = 0;

    for (const session of sessionsToProcess) {
      const projectName = session.project;

      // Load or create project memory
      let memory = loadProjectMemory(projectName) || createProjectMemory(projectName);
      const prevState = getSessionProcessingState(memory, session.sessionId);

      // Use offset-based parsing if we have a stored fileSize (append-only optimization)
      let messagesToProcess: Message[] = [];
      let totalMessageCount: number;
      let lastProcessedBytes: number = prevState?.fileSize || 0;
      let isIncremental = false;

      if (trace) {
        logger.trace(`=== Processing ${session.sessionId.slice(0, 8)} ===`);
        logger.trace(`prevState: ${prevState ? `messageCount=${prevState.messageCount}, fileSize=${prevState.fileSize ?? 'undefined'}` : 'null'}`);
        logger.trace(`session: fileSize=${session.fileSize}`);
      }

      if (session.sourceType === 'git') {
        logger.info(`📖 Syncing git log... (${session.sessionId})`);
        messagesToProcess = getGitCommits(session.path, 10);
        totalMessageCount = messagesToProcess.length; // Assuming getGitCommits returns all relevant commits
      } else if (session.sourceType === ('design' as any)) {
        logger.info(`📖 Syncing design session... (${session.sessionId})`);
        messagesToProcess = parseDesignSession(session.path, session.sessionId);
        totalMessageCount = messagesToProcess.length;
      } else if (session.sourceType === 'antigravity') {
        const artifactMessages = parseAntigravityArtifact(session.path, session.sessionId, projectName);
        totalMessageCount = artifactMessages.length;
        messagesToProcess = prevState ? artifactMessages.slice(prevState.messageCount) : artifactMessages;
        if (messagesToProcess.length > 0) {
          console.log(`📖 Ingesting Antigravity artifact: ${basename(session.path)}...`);
        }
      } else if (prevState?.fileSize && prevState.fileSize < session.fileSize) {
        // FAST PATH: Only read new bytes from the file
        if (trace) console.log(`  [TRACE] -> FAST PATH: byte-offset read from ${prevState.fileSize}`);
        const result = parseSessionFileFromOffset(
          session.path,
          prevState.fileSize,
          session.sessionId,
          projectName
        );
        messagesToProcess = result.messages;
        totalMessageCount = prevState.messageCount + result.messages.length;
        lastProcessedBytes = result.processedBytes;
        isIncremental = true;
        console.log(`📖 Updating ${session.sessionId.slice(0, 8)}... (+${result.messages.length} new messages, read ${result.processedBytes - prevState.fileSize} bytes)`);
      } else {
        // FULL PARSE: New session or no stored fileSize
        if (trace) console.log(`  [TRACE] -> FULL PARSE: ${prevState?.fileSize ? 'fileSize unchanged or smaller' : 'no stored fileSize'}`);
        const conversation = parseSessionFile(session.path);
        totalMessageCount = conversation.messages.length;
        lastProcessedBytes = conversation.processedBytes;
        if (trace) console.log(`  [TRACE] parsed ${totalMessageCount} messages from file, processedBytes=${lastProcessedBytes}`);

        if (prevState && prevState.messageCount < conversation.messages.length) {
          // Had previous state but no fileSize - slice from message count
          if (trace) console.log(`  [TRACE] -> INCREMENTAL: prevState.messageCount(${prevState.messageCount}) < parsed(${totalMessageCount})`);
          messagesToProcess = conversation.messages.slice(prevState.messageCount);
          isIncremental = true;
          console.log(`📖 Updating ${session.sessionId.slice(0, 8)}... (+${messagesToProcess.length} new messages)`);
        } else if (prevState && prevState.messageCount >= conversation.messages.length) {
          // No new messages - but backfill fileSize for fast check optimization
          if (trace) console.log(`  [TRACE] -> SKIP: prevState.messageCount(${prevState.messageCount}) >= parsed(${totalMessageCount})`);
          if (!prevState.fileSize || !memory.rootPath) {
            if (trace) console.log(`  [TRACE] -> backfilling fileSize=${session.fileSize}, rootPath=${process.cwd()}`);
            prevState.fileSize = session.fileSize;
            memory.rootPath = process.cwd();
            saveProjectMemory(memory);
          }
          console.log(`📖 Processing ${session.sessionId.slice(0, 8)}... (no new messages, skipping)`);
          continue;
        } else {
          // New session
          if (trace) console.log(`  [TRACE] -> NEW SESSION: no prevState`);
          messagesToProcess = conversation.messages;
          console.log(`📖 Processing ${session.sessionId.slice(0, 8)}... (${projectName.slice(-30)})`);
        }
      }

      if (messagesToProcess.length === 0) {
        if (trace) console.log('  [TRACE] -> NO MESSAGES: updating metadata to skip next time');
        // Update metadata anyway so we don't keep picking this session up as "new/unprocessed"
        memory = updateProjectMemory(
          memory,
          emptyFragments(), // Start with empty if it's new and empty
          session.sessionId,
          [],
          totalMessageCount,
          session.modifiedTime,
          lastProcessedBytes
        );
        saveProjectMemory(memory);
        continue;
      }

      if (options.dryRun) {
        console.log('   [dry-run] Would evolve fragments');
        continue;
      }

      // Update artifacts if requested
      if (shouldMirror && !['git', 'antigravity', 'design'].includes(session.sourceType as string)) {
        const fullConversation = parseSessionFile(session.path);

        // Security check: If writing to repo, ensure it's ignored
        if (config.mirrorMode === 'local' && isGitRepo(process.cwd())) {
          try {
            execSync('git check-ignore -q .claude/prose/', { stdio: 'ignore' });
          } catch (e) {
            console.log('⚠️  SECURITY WARNING: .claude/prose/ is not gitignored. Sessions may be committed accidentally.');
            console.log('   Run: prose init  (to fix .gitignore automatically)');
          }
        }

        const outputDir = config.mirrorMode === 'local' ? join(process.cwd(), '.claude', 'prose') : undefined;
        writeVerbatimSessionArtifact(fullConversation, outputDir);
      }

      // Window size for evolution - Gemini Flash has a huge context, we can process 2000 messages at once
      const windowSize = 2000;

      const windows = [];
      for (let i = 0; i < messagesToProcess.length; i += windowSize) {
        windows.push(messagesToProcess.slice(i, i + windowSize));
      }

      // Rolling window: feed old fragments + new messages → evolved fragments
      // For incremental: load previous session snapshot
      // For new session: start empty
      const existingSnapshot = memory.sessionSnapshots?.find(s => s.sessionId === session.sessionId);
      let currentFragments = existingSnapshot?.fragments || emptyFragments();
      let allSourceLinks: typeof messagesToProcess[0]['source'][] = [];

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
            project: projectName,
            sessionId: session.sessionId,
          },
          { apiKey, jinaApiKey }
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

      // Update memory with message count and file size for incremental tracking
      memory = updateProjectMemory(
        memory,
        currentFragments,
        session.sessionId,
        allSourceLinks,
        totalMessageCount,
        session.modifiedTime,
        lastProcessedBytes,
        process.cwd()
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
    console.log(`   Found: ${sessions.length} sessions, ${sessionsNeedingWork.length} need updates`);
    console.log(`   Processed: ${processed} sessions`);
    if (sessionsNeedingWork.length > sessionsToProcess.length) {
      console.log(`   ⏳ Remaining: ${sessionsNeedingWork.length - sessionsToProcess.length} sessions need work (limit reached)`);
    }
    console.log(`   Tokens used: ${totalTokens}`);

    // Run horizontal evolution if we processed any sessions OR if the target project is stale relative to its links
    const targetProjectName = projectFilter;
    const targetMemory = targetProjectName ? loadProjectMemory(targetProjectName) : null;
    let isStale = false;
    if (targetMemory && (targetMemory.linkedProjects || []).length > 0) {
      for (const link of targetMemory.linkedProjects!) {
        const linkedMemory = loadProjectMemory(link);
        if (linkedMemory && linkedMemory.lastUpdated > targetMemory.lastUpdated) {
          isStale = true;
          break;
        }
      }
    }

    if ((processed > 0 || isStale) && !options.dryRun) {
      if (isStale && processed === 0) {
        logger.info(`🔄 Link Update: Project ${formatProjectName(targetProjectName)} is stale relative to its links. Re-evolving...`);
      } else {
        console.log('\n🔄 Running horizontal evolution...');
      }

      // Get all unique projects that were processed, plus the target if it's stale
      const projectsProcessed = [...new Set(sessionsToProcess.map(s => s.project))];
      if (targetProjectName && isStale && !projectsProcessed.includes(targetProjectName)) {
        projectsProcessed.push(targetProjectName);
      }

      for (const projectName of projectsProcessed) {
        const memory = loadProjectMemory(projectName);
        if (!memory || !memory.sessionSnapshots?.length) continue;

        // "Old data is the OPPOSITE of evolution"
        // Feed only what we JUST processed into the horizontal evolution step.
        const currentProject = projectName;
        const newSessionIds = new Set(sessionsToProcess
          .filter(s => s.project === currentProject)
          .map(s => s.sessionId));

        const newSnapshots = memory.sessionSnapshots.filter(s => newSessionIds.has(s.sessionId));

        let snapshotsToUse = newSnapshots;
        if (snapshotsToUse.length === 0) {
          if (projectName === targetProjectName && isStale) {
            // Use the last 3 snapshots as context for re-evolution with new links
            snapshotsToUse = memory.sessionSnapshots
              .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
              .slice(0, 3);

            if (options.verbose) {
              logger.info(`   🔄 Using ${snapshotsToUse.length} existing snapshots for re-contextualization`);
            }
          }
        }

        if (snapshotsToUse.length === 0) {
          if (options.verbose) {
            console.log(`   ⏭️ Skipping horizontal evolution for ${projectName}: No snapshots found`);
          }
          continue;
        }

        // Load linked projects
        const linkedFragments: Array<{ projectName: string; fragments: AllFragments }> = [];
        for (const linkedName of (memory.linkedProjects || [])) {
          const linkedMemory = loadProjectMemory(linkedName);
          if (linkedMemory) {
            linkedFragments.push({
              projectName: linkedName,
              fragments: linkedMemory.current
            });
          }
        }

        const result = await evolveHorizontal(
          snapshotsToUse,
          {
            apiKey,
            windowSize: Math.max(snapshotsToUse.length, 3),
            currentFragments: memory.current,
            externalFragments: linkedFragments
          }
        );

        const updated = updateCurrentFragments(memory, result.current);
        saveProjectMemory(updated);

        // Update skill file and CLAUDE.md (if template exists) for cwd project
        const cwdSanitized = sanitizePath(process.cwd());
        if (projectName === cwdSanitized || projectName.endsWith(`-${cwdSanitized}`)) {
          writeSkillFile(process.cwd(), updated, projectName);
          injectMemory(process.cwd(), updated);
        }

        console.log(`   ${formatProjectName(projectName)}: ${result.sessionsIncluded} sessions → current`);
        if (result.musings) {
          console.log(`   💭 ${result.musings.slice(0, 100)}...`);
        }
        totalTokens += result.tokensUsed;
      }
    }

    console.log(`   Total tokens: ${totalTokens}`);
    console.log(`   Memory stored: ${getMemoryDir()}`);

    // Auto-backfill vectors for architectural memory (decisions, insights, etc.)
    if (!options.dryRun && jinaApiKey && processed > 0) {
      const detectedProject = projectFilter || detectProjectFromCwd();
      if (detectedProject) {
        const memory = loadProjectMemory(detectedProject);
        if (memory) {
          const vectors = loadProjectVectors(detectedProject);
          const toEmbed: { hash: string; text: string }[] = [];

          // Helper to collect fragments
          const collectFragments = (fragments: any) => {
            for (const d of fragments.decisions?.decisions || []) {
              const hash = calculateFragmentHash('decision', d.what, d.why);
              if (!vectors[hash]) toEmbed.push({ hash, text: `${d.what} ${d.why}` });
            }
            for (const i of fragments.insights?.insights || []) {
              const hash = calculateFragmentHash('insight', i.learning, i.context);
              if (!vectors[hash]) toEmbed.push({ hash, text: `${i.learning} ${i.context}` });
            }
            for (const g of fragments.insights?.gotchas || []) {
              const hash = calculateFragmentHash('gotcha', g.issue, g.solution);
              if (!vectors[hash]) toEmbed.push({ hash, text: `${g.issue} ${g.solution}` });
            }
            for (const b of fragments.narrative?.story_beats || []) {
              const hash = calculateFragmentHash('narrative', b.summary, b.beat_type);
              if (!vectors[hash]) toEmbed.push({ hash, text: b.summary });
            }
            for (const q of fragments.narrative?.memorable_quotes || []) {
              const hash = calculateFragmentHash('quote', q.quote, q.speaker);
              if (!vectors[hash]) toEmbed.push({ hash, text: `${q.quote} - ${q.speaker}` });
            }
          };

          // Collect from session snapshots and current
          for (const snapshot of memory.sessionSnapshots || []) {
            collectFragments(snapshot.fragments);
          }
          if (memory.current) {
            collectFragments(memory.current);
          }

          if (toEmbed.length > 0) {
            console.log(`\n🧠 Backfilling ${toEmbed.length} memory vectors...`);
            try {
              const batchSize = 50;
              for (let i = 0; i < toEmbed.length; i += batchSize) {
                const batch = toEmbed.slice(i, i + batchSize);
                const embeddings = await getJinaEmbeddings(batch.map(b => b.text), jinaApiKey);
                batch.forEach((item, idx) => { vectors[item.hash] = embeddings[idx]; });
              }
              saveProjectVectors(detectedProject, vectors);
              console.log(`   ✅ Memory vectors up to date`);
            } catch (e: any) {
              console.log(`   ⚠️  Memory backfill failed: ${e.message}`);
            }
          }
        }
      }
    }

    // Auto-index source code if git HEAD has changed (respects config.autoIndexSource)
    if (!options.dryRun && jinaApiKey && config.autoIndexSource !== false) {
      const cwd = process.cwd();
      const detectedProject = projectFilter || detectProjectFromCwd();

      if (detectedProject && isGitRepo(cwd)) {
        const { getGitHead, indexProjectSource } = await import('./source-indexer.js');
        const currentHead = getGitHead(cwd);
        const manifest = loadSourceManifest(detectedProject);

        if (!manifest || manifest.gitHead !== currentHead) {
          // Use configured extensions for the diff check
          const extGlobs = (config.sourceExtensions || ['.ts', '.js']).map(ext => `'*${ext}'`).join(' ');
          const changedFiles = manifest?.gitHead
            ? (() => {
              try {
                const diff = execSync(`git diff --name-only ${manifest.gitHead}..${currentHead} -- ${extGlobs}`, { encoding: 'utf-8', cwd });
                return diff.split('\n').filter(Boolean).length;
              } catch { return '?'; }
            })()
            : 'all';

          console.log(`\n🔍 Source index outdated (${changedFiles} files changed), re-indexing...`);
          try {
            const stats = await indexProjectSource(detectedProject, cwd, jinaApiKey);
            console.log(`   ✅ Indexed ${stats.filesIndexed} files, ${stats.chunksCreated} new chunks`);
          } catch (e: any) {
            console.log(`   ⚠️  Source indexing failed: ${e.message}`);
          }
        } else {
          if (options.verbose) {
            console.log(`\n🔍 Source index up to date (HEAD unchanged)`);
          }
        }
      }
    }

    // Always update skill file (and CLAUDE.md if template exists) for current project
    if (!options.dryRun) {
      const cwd = process.cwd();
      const cwdSanitized = sanitizePath(cwd);
      const index = loadMemoryIndex();
      const detectedProject = Object.keys(index.projects).find(p =>
        p === cwdSanitized || p.endsWith(cwdSanitized) || cwdSanitized.endsWith(p.replace(/^-/, ''))
      );
      if (detectedProject) {
        const memory = loadProjectMemory(detectedProject);
        if (memory) {
          writeSkillFile(cwd, memory, detectedProject);
          injectMemory(cwd, memory);
        }
      }
    }
  });

// ============================================================================
// merge - Integrate memory from another project
// ============================================================================

program
  .command('merge')
  .description('Integrate memory fragments from another project')
  .requiredOption('--from <project>', 'Source project to import from')
  .option('--to <project>', 'Target project (defaults to current)')
  .option('--dry-run', 'Show what would be merged without making changes')
  .action(async (options) => {
    const apiKey = options.apiKey || getApiKey('llm');
    if (!apiKey) {
      logger.error('No LLM API key found. Set OPENROUTER_API_KEY env var or use "prose config set openrouter-api-key <key>"');
      process.exit(1);
    }

    const index = loadMemoryIndex();

    // Resolve source project
    const sourceQuery = options.from;
    const sourceProject = Object.keys(index.projects).find(p =>
      p === sourceQuery || p.endsWith(`-${sourceQuery}`) || p.includes(sourceQuery)
    );

    if (!sourceProject) {
      logger.error(`Source project not found: ${sourceQuery}`);
      process.exit(1);
    }

    // Resolve target project
    let targetProjectQuery = options.to;
    let targetProject;
    if (!targetProjectQuery) {
      const cwd = process.cwd();
      const cwdSanitized = sanitizePath(cwd);
      targetProject = Object.keys(index.projects).find(p =>
        p === cwdSanitized || p.endsWith(cwdSanitized) || cwdSanitized.endsWith(p.replace(/^-/, ''))
      );
    } else {
      targetProject = Object.keys(index.projects).find(p =>
        p === targetProjectQuery || p.endsWith(`-${targetProjectQuery}`) || p.includes(targetProjectQuery)
      );
    }

    if (!targetProject) {
      console.error(`❌ Target project not found. Set --to or run from a project directory.`);
      process.exit(1);
    }

    if (sourceProject === targetProject) {
      console.error(`❌ Cannot merge a project into itself.`);
      process.exit(1);
    }

    console.log(`🧬 Merging: ${formatProjectName(sourceProject)} → ${formatProjectName(targetProject)}\n`);

    const sourceMemory = loadProjectMemory(sourceProject);
    const targetMemory = loadProjectMemory(targetProject);

    if (!sourceMemory) {
      console.error(`❌ Could not load source memory for ${sourceProject}`);
      process.exit(1);
    }
    if (!targetMemory) {
      console.error(`❌ Could not load target memory for ${targetProject}`);
      process.exit(1);
    }

    if (options.dryRun) {
      console.log('🧪 Dry run - would merge current fragments from source into target.');
      return;
    }

    console.log('🔄 Running integration evolution...');

    // Wrap source's current fragments as a pseudo-snapshot
    const integrationSnapshot = {
      sessionId: `integration-${sourceProject.replace(/^-/, '')}-${Date.now()}`,
      timestamp: new Date(),
      fragments: sourceMemory.current
    };

    const result = await evolveHorizontal(
      [integrationSnapshot],
      {
        apiKey,
        windowSize: 1,
        currentFragments: targetMemory.current
      }
    );

    const updated = updateCurrentFragments(targetMemory, result.current);
    saveProjectMemory(updated);

    // Update index for target
    index.projects[targetProject] = {
      ...index.projects[targetProject],
      lastUpdated: new Date()
    };
    saveMemoryIndex(index);

    // Update skill file and CLAUDE.md if target matches CWD
    const cwd = process.cwd();
    const cwdSanitized = cwd.replace(/\//g, '-').replace(/^-/, '');
    if (targetProject === cwdSanitized || targetProject.endsWith(`-${cwdSanitized}`)) {
      writeSkillFile(cwd, updated, targetProject);
      injectMemory(cwd, updated);
    }

    console.log('\n✅ Integration complete.');
    if (result.musings) {
      console.log(`💭 ${result.musings}`);
    }
  });

// ============================================================================
// link - Manage persistent cross-project links
// ============================================================================

program
  .command('link [target-project]')
  .description('Manage persistent cross-project links for integrated context')
  .option('--remove', 'Remove a link')
  .option('--list', 'List all linked projects')
  .action((targetProject, options) => {
    const currentProject = detectProjectFromCwd();
    if (!currentProject) {
      logger.error('Could not detect current project from directory');
      process.exit(1);
    }

    const memory = loadProjectMemory(currentProject);
    if (!memory) {
      logger.error(`No memory found for ${currentProject}. Run evolve first.`);
      process.exit(1);
    }

    if (options.list || !targetProject) {
      const links = memory.linkedProjects || [];
      if (links.length === 0) {
        logger.info(`Project ${formatProjectName(currentProject)} has no linked projects.`);
      } else {
        logger.info(`Linked projects for ${formatProjectName(currentProject)}:`);
        links.forEach(l => console.log(`  - ${formatProjectName(l)}`));
      }
      return;
    }

    // Direct match or partial match for target
    const index = loadMemoryIndex();
    const projectNames = Object.keys(index.projects);
    const matchedTarget = projectNames.find(p => p.toLowerCase().includes(targetProject.toLowerCase()));

    if (!matchedTarget) {
      logger.error(`Target project "${targetProject}" not found in memory index.`);
      process.exit(1);
    }

    if (options.remove) {
      const initialCount = (memory.linkedProjects || []).length;
      memory.linkedProjects = (memory.linkedProjects || []).filter(p => p !== matchedTarget);
      if ((memory.linkedProjects || []).length < initialCount) {
        saveProjectMemory(memory);
        logger.success(`Removed link: ${matchedTarget}`);
      } else {
        logger.info(`Project ${matchedTarget} was not linked.`);
      }
    } else {
      if (!memory.linkedProjects) memory.linkedProjects = [];
      if (!memory.linkedProjects.includes(matchedTarget)) {
        memory.linkedProjects.push(matchedTarget);
        saveProjectMemory(memory);
        logger.success(`Linked ${matchedTarget} -> ${currentProject}`);
      } else {
        logger.info(`Project ${matchedTarget} is already linked.`);
      }
    }
  });

// ============================================================================
// design - Start an interactive design session to shape memory
// ============================================================================

program
  .command('design')
  .description('Interactive session with the AI Architect to shape project memory')
  .option('-p, --project <path>', 'Filter to specific project path')
  .option('--model <name>', 'Model to use', 'google/gemini-3-flash-preview')
  .action(async (options) => {
    const apiKey = options.apiKey || getApiKey('llm');
    if (!apiKey) {
      logger.error('No LLM API key found. Set OPENROUTER_API_KEY env var or use "prose config set openrouter-api-key <key>"');
      process.exit(1);
    }

    let projectFilter = options.project;
    const cwd = process.cwd();
    const cwdSanitized = sanitizePath(cwd);

    if (!projectFilter) {
      const index = loadMemoryIndex();
      projectFilter = Object.keys(index.projects).find(p =>
        p === cwdSanitized || p.endsWith(cwdSanitized) || cwdSanitized.endsWith(p.replace(/^-/, ''))
      );
    }

    if (!projectFilter) {
      logger.error('Could not detect project. Please run `prose evolve` first or specify --project');
      process.exit(1);
    }

    const memory = loadProjectMemory(projectFilter);
    if (!memory) {
      console.error(`❌ No memory found for project: ${projectFilter}`);
      process.exit(1);
    }

    await startDesignSession(projectFilter, memory, {
      apiKey,
      model: options.model,
    });
  });

// ============================================================================
// search - Semantic search through memory
// ============================================================================

program
  .command('search <query>')
  .alias('grep')
  .description('Semantic search through evolved memory')
  .option('-p, --project <name>', 'Filter to specific project (auto-detects from cwd if not specified)')
  .option('-a, --all', 'Search all projects (ignore cwd auto-detection)')
  .option('-t, --type <types>', 'Filter by type: decision,insight,gotcha,narrative,quote,source', 'decision,insight,gotcha,source')
  .option('-l, --limit <n>', 'Limit results', '10')
  .option('--json', 'Output as JSON')
  .action(async (query, options) => {
    const types = options.type.split(',') as any[];
    const limit = parseInt(options.limit, 10);

    // Auto-detect project from current directory unless --all is specified
    let projectFilter: string[] | undefined;
    if (options.project) {
      projectFilter = [options.project];
    } else if (!options.all) {
      // Try to match cwd to a project
      const cwd = process.cwd();
      const cwdSanitized = sanitizePath(cwd);
      const index = loadMemoryIndex();
      const matchingProject = Object.keys(index.projects).find(p =>
        p === cwdSanitized || p.endsWith(cwdSanitized) || cwdSanitized.endsWith(p.replace(/^-/, ''))
      );
      if (matchingProject) {
        projectFilter = [matchingProject];
        console.log(`📁 Searching in: ${formatProjectName(matchingProject)} (use --all for global search)\n`);
      }
    }

    const jinaApiKey = getApiKey('jina');

    const results = await searchMemory(query, {
      projects: projectFilter,
      types,
      limit,
      jinaApiKey,
      all: options.all,
    });

    if (options.json) {
      console.log(JSON.stringify(results, null, 2));
      return;
    }

    if (results.length === 0) {
      logger.info(`No results found for "${query}"`);
      return;
    }

    logger.info(`🔍 Found ${results.length} results for "${query}":\n`);

    for (const result of results) {
      const typeIcon = {
        decision: '⚖️ ',
        insight: '💡',
        gotcha: '⚠️ ',
        narrative: '📖',
        quote: '💬',
        source: '💻', // NEW: Source code icon
      }[result.type];

      const project = formatProjectName(result.project);
      const dateStr = result.timestamp
        ? new Date(result.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        : '';
      logger.info(`${typeIcon} [${result.type}] (${project}) ${dateStr}`);
      logger.info(`   ${result.content}`);
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
  .description('Show memory statistics (CWD-aware, use "status global" for all projects)')
  .argument('[scope]', '"global" for all projects, otherwise auto-detects from cwd')
  .action((scope) => {
    const isGlobal = scope === 'global';

    // Try to detect project from CWD
    let detectedProject: string | undefined;
    if (!isGlobal) {
      detectedProject = detectProjectFromCwd();
    }

    if (detectedProject && !isGlobal) {
      // Project-specific status
      const shortName = formatProjectName(detectedProject);
      logger.info(`📊 ${shortName}\n`);

      // Raw session files for this project
      const sessions = discoverSessionFiles(detectedProject);
      let totalMessages = 0;
      let earliestDate: Date | null = null;
      let latestDate: Date | null = null;

      for (const session of sessions) {
        const conversation = parseSessionFile(session.path);
        totalMessages += conversation.messages.length;

        if (!earliestDate || session.modifiedTime < earliestDate) {
          earliestDate = session.modifiedTime;
        }
        if (!latestDate || session.modifiedTime > latestDate) {
          latestDate = session.modifiedTime;
        }
      }

      console.log('📁 Raw Sessions:');
      console.log(`   Files: ${sessions.length}`);
      console.log(`   Messages: ${totalMessages.toLocaleString()}`);
      if (earliestDate && latestDate) {
        const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        console.log(`   Date range: ${fmt(earliestDate)} - ${fmt(latestDate)}`);
      }

      // Evolved memory for this project
      const memory = loadProjectMemory(detectedProject);
      if (memory) {
        const decisions = memory.current.decisions?.decisions?.length || 0;
        const insights = memory.current.insights?.insights?.length || 0;
        const gotchas = memory.current.insights?.gotchas?.length || 0;
        const processedCount = memory.processedSessions?.length || 0;

        console.log('\n🧠 Evolved Memory:');
        console.log(`   Sessions: ${processedCount}/${sessions.length} processed`);
        console.log(`   Decisions: ${decisions}`);
        console.log(`   Insights: ${insights}`);
        console.log(`   Gotchas: ${gotchas}`);
        console.log(`   Last evolved: ${memory.lastUpdated.toLocaleString()}`);
      } else {
        console.log('\n🧠 Evolved Memory:');
        logger.info('   Not yet evolved. Run: prose evolve');
      }

      logger.info(`\n💡 Tip: Use "prose status global" for all projects`);
    } else {
      // Global status (original behavior)
      const stats = getMemoryStats();
      const sessionStats = getSessionStats();

      logger.info('📊 Prose - Global Status\n');

      console.log('📁 Available Sessions:');
      console.log(`   Total sessions: ${sessionStats.totalSessions}`);
      console.log(`   Total messages: ${sessionStats.totalMessages.toLocaleString()}`);
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
    }
  });

// ============================================================================
// show - Display current fragments for a project
// ============================================================================

program
  .command('show [project]')
  .description('Display current fragments for a project')
  .option('--decisions', 'Show only decisions')
  .option('--insights', 'Show only insights')
  .option('--narrative', 'Show only narrative')
  .option('--json', 'Output as JSON')
  .action((project, options) => {
    // Try to detect project if not specified
    let matchedProject: string | undefined;
    const index = loadMemoryIndex();
    const projectNames = Object.keys(index.projects);

    if (project) {
      // Direct match or partial match
      matchedProject = projectNames.find(p =>
        p.toLowerCase().includes(project.toLowerCase())
      );
    } else {
      // CWD detection
      matchedProject = detectProjectFromCwd();
    }

    if (!matchedProject) {
      if (project) {
        logger.error(`Project "${project}" not found`);
      } else {
        logger.error('Could not detect project from current directory');
      }

      if (projectNames.length > 0) {
        console.log('Available projects:');
        for (const p of projectNames) {
          console.log(`  - ${formatProjectName(p)}`);
        }
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

    const shortName = formatProjectName(matchedProject);
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
  .command('context [project]')
  .description('Generate context markdown for slash command injection')
  .option('-o, --output <path>', 'Output file path (default: stdout)')
  .option('--install', 'Install as Claude Code slash command in current project')
  .action((project, options) => {
    // Try to detect project if not specified
    let matchedProject: string | undefined;
    const index = loadMemoryIndex();
    const projectNames = Object.keys(index.projects);

    if (project) {
      matchedProject = projectNames.find(p =>
        p.toLowerCase().includes(project.toLowerCase())
      );
    } else {
      matchedProject = detectProjectFromCwd();
    }

    if (!matchedProject) {
      if (project) {
        logger.error(`Project "${project}" not found`);
      } else {
        logger.error('Could not detect project from current directory');
      }

      if (projectNames.length > 0) {
        console.log('Available projects:');
        for (const p of projectNames) {
          console.log(`  - ${formatProjectName(p)}`);
        }
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
// web - Generate browsable HTML website
// ============================================================================

program
  .command('web')
  .description('Generate a browsable HTML website from project memory')
  .option('-o, --output <dir>', 'Output directory', './prose-web')
  .option('--open', 'Open in browser after generating')
  .action((options) => {
    logger.info('🌐 Generating Prose website...\n');

    generateWebsite(options.output);

    if (options.open) {
      const indexPath = `${options.output}/index.html`;
      import('child_process').then(({ exec }) => {
        exec(`open "${indexPath}"`);
      });
    }
  });

// ============================================================================
// serve - Interactive dashboard
// ============================================================================

program
  .command('serve')
  .description('Start interactive dashboard server')
  .option('-p, --port <port>', 'Port to run on', '3000')
  .option('--open', 'Open browser automatically')
  .action(async (options) => {
    const { startServer } = await import('./server.js');
    const port = parseInt(options.port, 10);

    startServer(port);

    if (options.open) {
      setTimeout(() => {
        import('child_process').then(({ exec }) => {
          exec(`open "http://localhost:${port}"`);
        });
      }, 500);
    }
  });

// ============================================================================
// artifacts - Export per-session artifacts
// ============================================================================

program
  .command('artifacts')
  .description('Export all session fragments as Markdown artifacts')
  .option('-p, --project <path>', 'Project name or path')
  .option('--local', 'Export to local .claude/prose directory instead of Vault')
  .action(async (options) => {
    let projectName = options.project;
    if (!projectName) {
      projectName = detectProjectFromCwd();
      if (!projectName) {
        logger.error('Could not detect project from current directory');
        process.exit(1);
      }
    }

    const config = getGlobalConfig();
    const mirrorMode = options.local ? 'local' : config.mirrorMode;

    logger.info(`📦 Exporting verbatim artifacts for ${projectName} (Mode: ${mirrorMode})...`);

    const artifactsDir = mirrorMode === 'local'
      ? join(process.cwd(), '.claude', 'prose')
      : undefined; // Defaults to vault in writeVerbatimSessionArtifact

    const sessions = discoverSessionFiles(projectName);
    let count = 0;
    for (const session of sessions) {
      const conv = parseSessionFile(session.path);
      writeVerbatimSessionArtifact(conv, artifactsDir);
      count++;
    }

    const targetPath = artifactsDir || join(getMemoryDir(), 'mirrors', projectName);
    logger.success(`Exported ${count} verbatim artifacts to ${targetPath}`);
  });

// ============================================================================
// config - Manage global configuration
// ============================================================================

const configCmd = program.command('config').description('Manage global configuration settings');

configCmd
  .command('set <key> <value...>')
  .description('Set a global configuration value (use space-separated values for arrays)')
  .action((key, values) => {
    const value = values.length === 1 ? values[0] : values;

    if (key === 'artifacts') {
      saveGlobalConfig({ artifacts: value === 'true' });
      logger.success(`Set artifacts to: ${value === 'true'}`);
    } else if (key === 'mirror-mode') {
      if (value !== 'vault' && value !== 'local') {
        logger.error('mirror-mode must be "vault" or "local"');
        process.exit(1);
      }
      saveGlobalConfig({ mirrorMode: value as any });
      logger.success(`Set mirror-mode to: ${value}`);
    } else if (key === 'source-extensions') {
      // Accept space-separated extensions: prose config set source-extensions .ts .js .svelte
      const extensions = Array.isArray(value) ? value : [value];
      // Ensure each extension starts with a dot
      const normalized = extensions.map(ext => ext.startsWith('.') ? ext : `.${ext}`);
      saveGlobalConfig({ sourceExtensions: normalized });
      logger.success(`Set source-extensions to: ${normalized.join(', ')}`);
    } else if (key === 'auto-index-source') {
      saveGlobalConfig({ autoIndexSource: value === 'true' });
      logger.success(`Set auto-index-source to: ${value === 'true'}`);
    } else if (key === 'vector-threshold') {
      const threshold = parseFloat(value as string);
      if (isNaN(threshold) || threshold < 0 || threshold > 1) {
        logger.error('vector-threshold must be a number between 0.0 and 1.0');
        process.exit(1);
      }
      saveGlobalConfig({ vectorThreshold: threshold });
      logger.success(`Set vector-threshold to: ${threshold}`);
    } else if (key === 'jina-api-key') {
      saveGlobalConfig({ jinaApiKey: value as string });
      logger.success(`Set jina-api-key (${(value as string).length} chars)`);
    } else if (key === 'openrouter-api-key') {
      saveGlobalConfig({ openRouterApiKey: value as string });
      logger.success(`Set openrouter-api-key (${(value as string).length} chars)`);
    } else if (key === 'llm-api-key') {
      saveGlobalConfig({ llmApiKey: value as string });
      logger.success(`Set llm-api-key (${(value as string).length} chars)`);
    } else {
      logger.error(`Unknown configuration key: ${key}`);
      logger.info('Valid keys: artifacts, mirror-mode, source-extensions, auto-index-source, vector-threshold, jina-api-key, openrouter-api-key, llm-api-key');
      process.exit(1);
    }
  });

configCmd
  .command('show')
  .description('Show current global configuration')
  .action(() => {
    const config = getGlobalConfig();
    const maskKey = (key: string | undefined) => {
      if (!key) return '(not set)';
      if (key.length <= 8) return '****';
      return key.slice(0, 4) + '...' + key.slice(-4);
    };

    logger.info('📊 Prose - Global Configuration\n');
    console.log('   General:');
    console.log(`     artifacts: ${config.artifacts}`);
    console.log(`     mirror-mode: ${config.mirrorMode}`);
    console.log('\n   Source Indexing:');
    console.log(`     source-extensions: ${config.sourceExtensions?.join(', ') || '(none)'}`);
    console.log(`     auto-index-source: ${config.autoIndexSource}`);
    console.log(`     vector-threshold: ${config.vectorThreshold}`);
    console.log('\n   API Keys:');
    console.log(`     jina-api-key: ${maskKey(config.jinaApiKey)}`);
    console.log(`     openrouter-api-key: ${maskKey(config.openRouterApiKey)}`);
    console.log(`     llm-api-key: ${maskKey(config.llmApiKey)}`);
    console.log(`\n📂 Vault location: ${getMemoryDir()}`);
  });

// ============================================================================
// vault - Manage the personal memory storage repository
// ============================================================================

const vault = program.command('vault').description('Manage the personal memory vault (Git-backed storage)');

vault
  .command('init [remote]')
  .description('Initialize the memory directory as a Git repository')
  .action(async (remote) => {
    const memoryDir = getMemoryDir();
    if (!existsSync(memoryDir)) {
      mkdirSync(memoryDir, { recursive: true });
    }

    if (isVaultRepo()) {
      logger.info('🏛️  Vault already initialized.');
    } else {
      try {
        const { execSync } = await import('child_process');
        execSync(`git -C "${memoryDir}" init`, { stdio: 'inherit' });

        // Add a .gitignore for common temp files if needed
        const gitignorePath = join(memoryDir, '.gitignore');
        if (!existsSync(gitignorePath)) {
          writeFileSync(gitignorePath, '*.tmp\n*.bak\n');
        }

        execSync(`git -C "${memoryDir}" add .`, { stdio: 'inherit' });
        execSync(`git -C "${memoryDir}" commit -m "Initialize Personal Memory Vault"`, { stdio: 'inherit' });
        logger.info('✅ Vault initialized successfully.');
      } catch (error: any) {
        logger.error(`⚠️  Failed to initialize vault: ${error.message}`);
        return;
      }
    }

    if (remote) {
      try {
        const { execSync } = await import('child_process');
        execSync(`git -C "${memoryDir}" remote add origin "${remote}"`, { stdio: 'inherit' });
        logger.info(`🔗 Remote added: ${remote}`);
      } catch (error: any) {
        logger.error(`⚠️  Failed to add remote: ${error.message}`);
      }
    }
  });

vault
  .command('status')
  .description('Show the status of the memory vault')
  .action(async () => {
    if (!isVaultRepo()) {
      logger.error('❌ Vault not initialized. Run "prose vault init" first.');
      return;
    }

    try {
      const { execSync } = await import('child_process');
      const memoryDir = getMemoryDir();
      const output = execSync(`git -C "${memoryDir}" status`, { encoding: 'utf-8' });
      console.log(output);
    } catch (error: any) {
      logger.error(`⚠️  Failed to get vault status: ${error.message}`);
    }
  });

vault
  .command('sync')
  .description('Synchronize the vault with the remote repository')
  .action(async () => {
    if (!isVaultRepo()) {
      logger.error('❌ Vault not initialized. Run "prose vault init" first.');
      return;
    }

    try {
      const { execSync } = await import('child_process');
      const memoryDir = getMemoryDir();

      logger.info('🔄 Syncing vault...');

      // 1. Detect current branch
      const currentBranch = execSync(`git -C "${memoryDir}" rev-parse --abbrev-ref HEAD`, { encoding: 'utf-8' }).trim();

      // 2. Check if remote has this branch
      const remoteRefs = execSync(`git -C "${memoryDir}" ls-remote origin ${currentBranch}`, { encoding: 'utf-8' }).trim();

      if (remoteRefs) {
        // Branch exists on remote, try to pull
        logger.trace(`Pulling ${currentBranch} from origin...`);
        execSync(`git -C "${memoryDir}" pull --rebase origin ${currentBranch}`, { stdio: 'inherit' });
      } else {
        logger.info(`✨ First sync for branch "${currentBranch}" - skipping pull.`);
      }

      // 3. Push current branch
      logger.trace(`Pushing ${currentBranch} to origin...`);
      execSync(`git -C "${memoryDir}" push origin ${currentBranch}`, { stdio: 'inherit' });

      logger.info('✅ Vault synchronized.');
    } catch (error: any) {
      logger.error(`⚠️  Sync failed: ${error.message}`);
    }
  });

// ============================================================================
// index - Manage semantic search vectors
// ============================================================================

const indexCmd = program.command('index').description('Manage semantic search vectors');

indexCmd
  .command('backfill')
  .description('Generate missing embeddings for all existing project fragments')
  .option('-p, --project <name>', 'Filter to specific project')
  .action(async (options) => {
    const apiKey = getApiKey('jina');
    if (!apiKey) {
      logger.error('No Jina API key found. Set PROSE_JINA_API_KEY env var or use "prose config set jina-api-key <key>"');
      process.exit(1);
    }

    const index = loadMemoryIndex();
    const projectsToProcess = options.project
      ? Object.keys(index.projects).filter(p => p === options.project)
      : Object.keys(index.projects);

    if (projectsToProcess.length === 0) {
      logger.info('No projects found to backfill.');
      return;
    }

    for (const projectName of projectsToProcess) {
      logger.info(`🧠 Backfilling vectors for ${projectName}...`);
      const memory = loadProjectMemory(projectName);
      if (!memory) continue;

      const vectors = loadProjectVectors(projectName);
      const toEmbed: { hash: string; text: string }[] = [];

      // Helper to collect fragments from an AllFragments object
      const collectFragments = (fragments: any) => {
        // Decisions
        for (const d of fragments.decisions?.decisions || []) {
          const hash = calculateFragmentHash('decision', d.what, d.why);
          if (!vectors[hash]) toEmbed.push({ hash, text: `${d.what} ${d.why}` });
        }
        // Insights
        for (const i of fragments.insights?.insights || []) {
          const hash = calculateFragmentHash('insight', i.learning, i.context);
          if (!vectors[hash]) toEmbed.push({ hash, text: `${i.learning} ${i.context}` });
        }
        // Gotchas
        for (const g of fragments.insights?.gotchas || []) {
          const hash = calculateFragmentHash('gotcha', g.issue, g.solution);
          if (!vectors[hash]) toEmbed.push({ hash, text: `${g.issue} ${g.solution}` });
        }
        // Story beats
        for (const b of fragments.narrative?.story_beats || []) {
          const hash = calculateFragmentHash('narrative', b.summary, b.beat_type);
          if (!vectors[hash]) toEmbed.push({ hash, text: b.summary });
        }
        // Quotes
        for (const q of fragments.narrative?.memorable_quotes || []) {
          const hash = calculateFragmentHash('quote', q.quote, q.speaker);
          if (!vectors[hash]) toEmbed.push({ hash, text: `${q.quote} - ${q.speaker}` });
        }
      };

      // Collect from session snapshots (historical)
      for (const snapshot of memory.sessionSnapshots) {
        collectFragments(snapshot.fragments);
      }

      // Collect from current (evolved/merged) - these are the ground truth
      if (memory.current) {
        collectFragments(memory.current);
      }

      if (toEmbed.length === 0) {
        logger.info(`✅ ${projectName} is already up to date.`);
        continue;
      }

      logger.info(`📡 Requesting ${toEmbed.length} embeddings from Jina...`);
      try {
        // Process in batches of 50 to avoid Jina API limits
        const batchSize = 50;
        for (let i = 0; i < toEmbed.length; i += batchSize) {
          const batch = toEmbed.slice(i, i + batchSize);
          const embeddings = await getJinaEmbeddings(batch.map(b => b.text), apiKey);
          batch.forEach((item, index) => {
            vectors[item.hash] = embeddings[index];
          });
          logger.info(`   Progress: ${Math.min(i + batchSize, toEmbed.length)}/${toEmbed.length}`);
        }
        saveProjectVectors(projectName, vectors);
        logger.success(`✅ ${projectName} backfill complete.`);
      } catch (error: any) {
        logger.error(`❌ Failed to backfill ${projectName}: ${error.message}`);
      }
    }
  });

indexCmd
  .command('source')
  .description('Index project source code for semantic implementation search')
  .option('-p, --project <name>', 'Project name or path')
  .option('-a, --all', 'Index all known projects (backfill)')
  .action(async (options) => {
    const apiKey = getApiKey('jina');
    if (!apiKey) {
      logger.error('No Jina API key found. Set PROSE_JINA_API_KEY env var or use "prose config set jina-api-key <key>"');
      process.exit(1);
    }

    // Backfill all projects
    if (options.all) {
      const index = loadMemoryIndex();
      const projects = Object.keys(index.projects);

      logger.info(`🔍 Backfilling source index for ${projects.length} projects...\n`);

      let totalFiles = 0;
      let totalChunks = 0;
      let indexed = 0;
      let skipped = 0;

      for (const projectName of projects) {
        const memory = loadProjectMemory(projectName);
        const rootPath = memory?.rootPath;

        if (!rootPath || !existsSync(rootPath)) {
          logger.verbose(`⏭️  ${formatProjectName(projectName)}: no rootPath or path doesn't exist`);
          skipped++;
          continue;
        }

        if (!isGitRepo(rootPath)) {
          logger.verbose(`⏭️  ${formatProjectName(projectName)}: not a git repo`);
          skipped++;
          continue;
        }

        try {
          logger.info(`📂 ${formatProjectName(projectName)}`);
          const stats = await indexProjectSource(projectName, rootPath, apiKey);
          logger.info(`   ✅ ${stats.filesIndexed} files, ${stats.chunksCreated} new chunks`);
          totalFiles += stats.filesIndexed;
          totalChunks += stats.chunksCreated;
          indexed++;
        } catch (error: any) {
          logger.warn(`   ⚠️  Failed: ${error.message}`);
        }
      }

      logger.info(`\n📊 Summary:`);
      logger.info(`   Projects indexed: ${indexed}`);
      logger.info(`   Projects skipped: ${skipped}`);
      logger.info(`   Total files: ${totalFiles}`);
      logger.info(`   Total new chunks: ${totalChunks}`);
      return;
    }

    // Single project mode
    let projectName = options.project;
    if (!projectName) {
      projectName = detectProjectFromCwd();
      if (!projectName) {
        logger.error('Could not detect project from current directory');
        process.exit(1);
      }
    }

    try {
      const stats = await indexProjectSource(projectName, process.cwd(), apiKey);
      logger.success(`✅ ${projectName} source indexing complete.`);
      logger.info(`   Files indexed: ${stats.filesIndexed}`);
      logger.info(`   Chunks created: ${stats.chunksCreated}`);
    } catch (error: any) {
      logger.error(`❌ Failed to index source: ${error.message}`);
    }
  });

program.parse();
