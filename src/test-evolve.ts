#!/usr/bin/env node
/**
 * Test fragment evolution against real Claude Code sessions
 */

import { discoverSessionFiles, parseSessionFile } from './session-parser.js';
import { evolveAllFragments, type EvolutionContext } from './evolve.js';
import { emptyFragments } from './schemas.js';
import { getApiKey } from './memory.js';

async function main() {
  console.log('=== Claude Prose Fragment Evolution Test ===\n');

  // Check for API key
  const apiKey = getApiKey('llm');
  if (!apiKey) {
    console.log('❌ No LLM API key found. Set OPENROUTER_API_KEY env var or use "prose config set openrouter-api-key <key>"');
    process.exit(1);
  }

  // Find a session to test with
  const sessions = discoverSessionFiles();
  if (sessions.length === 0) {
    console.log('❌ No sessions found');
    process.exit(1);
  }

  // Use the most recent session
  const sessionFile = sessions[0];
  console.log(`📁 Testing with session: ${sessionFile.sessionId.slice(0, 8)}...`);
  console.log(`   Project: ${sessionFile.project}`);

  const conversation = parseSessionFile(sessionFile.path);
  console.log(`   Messages: ${conversation.messages.length}`);

  // Take a window of messages (not the whole conversation)
  const windowSize = 10;
  const messageWindow = conversation.messages.slice(0, windowSize);
  console.log(`   Using first ${messageWindow.length} messages as test window\n`);

  // Show the messages we're processing
  console.log('📝 Messages in window:');
  for (const msg of messageWindow) {
    const role = msg.role === 'user' ? '👤' : '🤖';
    const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
    const excerpt = content.slice(0, 80).replace(/\n/g, ' ');
    console.log(`   ${role} ${excerpt}...`);
  }
  console.log('');

  // Run evolution
  console.log('🧬 Evolving fragments...');
  const startTime = Date.now();

  const context: EvolutionContext = {
    messages: messageWindow,
    allFragments: emptyFragments(),
    project: conversation.project,
    sessionId: conversation.sessionId,
  };

  const result = await evolveAllFragments(
    emptyFragments(),
    context,
    { apiKey }
  );

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`   Done in ${elapsed}s, ${result.tokensUsed} tokens used\n`);

  if (result.errors.length > 0) {
    console.log('⚠️  Errors:');
    for (const error of result.errors) {
      console.log(`   ${error}`);
    }
    console.log('');
  }

  // Display results
  console.log('📊 Evolved Fragments:\n');

  if (result.fragments.focus) {
    console.log('🎯 FOCUS:');
    console.log(`   Goal: ${result.fragments.focus.current_goal}`);
    console.log(`   Tasks: ${result.fragments.focus.active_tasks.join(', ')}`);
    if (result.fragments.focus.blockers?.length) {
      console.log(`   Blockers: ${result.fragments.focus.blockers.join(', ')}`);
    }
    console.log('');
  }

  if (result.fragments.decisions) {
    console.log('⚖️  DECISIONS:');
    for (const decision of result.fragments.decisions.decisions.slice(0, 3)) {
      console.log(`   • ${decision.what}`);
      console.log(`     Why: ${decision.why}`);
      console.log(`     Confidence: ${decision.confidence}`);
    }
    if (result.fragments.decisions.decisions.length > 3) {
      console.log(`   ... and ${result.fragments.decisions.decisions.length - 3} more`);
    }
    console.log('');
  }

  if (result.fragments.insights) {
    console.log('💡 INSIGHTS:');
    for (const insight of result.fragments.insights.insights.slice(0, 3)) {
      console.log(`   • ${insight.learning}`);
    }
    if (result.fragments.insights.gotchas?.length) {
      console.log('   Gotchas:');
      for (const gotcha of result.fragments.insights.gotchas.slice(0, 2)) {
        console.log(`   ⚠️  ${gotcha.issue}`);
      }
    }
    console.log('');
  }

  if (result.fragments.narrative) {
    console.log('📖 NARRATIVE:');
    for (const beat of result.fragments.narrative.story_beats.slice(0, 3)) {
      const tone = beat.emotional_tone ? ` (${beat.emotional_tone})` : '';
      console.log(`   [${beat.beat_type}]${tone}: ${beat.summary}`);
    }
    if (result.fragments.narrative.memorable_quotes?.length) {
      console.log('   Quotes:');
      for (const quote of result.fragments.narrative.memorable_quotes.slice(0, 2)) {
        console.log(`   "${quote.quote.slice(0, 60)}..." - ${quote.speaker}`);
      }
    }
    console.log('');
  }

  if (result.fragments.vocabulary) {
    console.log('📚 VOCABULARY:');
    const topTerms = Object.entries(result.fragments.vocabulary.terms)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([term, count]) => `${term}(${count})`);
    console.log(`   Top terms: ${topTerms.join(', ')}`);
    if (result.fragments.vocabulary.technologies.length) {
      console.log(`   Technologies: ${result.fragments.vocabulary.technologies.join(', ')}`);
    }
    if (result.fragments.vocabulary.files.length) {
      console.log(`   Files: ${result.fragments.vocabulary.files.slice(0, 5).join(', ')}`);
    }
    console.log('');
  }

  console.log('✅ Evolution test complete!');
}

main().catch(console.error);
