#!/usr/bin/env npx ts-node
/**
 * Quick test of the session parser against real Claude Code sessions
 */

import { discoverSessionFiles, parseSessionFile, getSessionStats, formatConversation } from './session-parser.js';

console.log('=== Claude Prose Session Parser Test ===\n');

// Get overall stats
console.log('📊 Session Statistics:');
const stats = getSessionStats();
console.log(`   Total sessions: ${stats.totalSessions}`);
console.log(`   Total messages: ${stats.totalMessages}`);
console.log(`   Projects: ${stats.projects.length}`);
if (stats.dateRange.earliest && stats.dateRange.latest) {
  console.log(`   Date range: ${stats.dateRange.earliest.toLocaleDateString()} - ${stats.dateRange.latest.toLocaleDateString()}`);
}
console.log('');

// List some recent sessions
console.log('📁 Recent Sessions:');
const sessions = discoverSessionFiles();
const recentSessions = sessions.slice(0, 5);

for (const session of recentSessions) {
  console.log(`   ${session.sessionId.slice(0, 8)}... | ${session.project.slice(-30)} | ${session.modifiedTime.toLocaleDateString()}`);
}
console.log('');

// Parse one session in detail
if (sessions.length > 0) {
  console.log('📖 Parsing most recent session...');
  const conversation = parseSessionFile(sessions[0].path);
  console.log(`   Session: ${conversation.sessionId}`);
  console.log(`   Project: ${conversation.project}`);
  console.log(`   Messages: ${conversation.messages.length}`);
  console.log(`   Duration: ${conversation.startTime.toLocaleTimeString()} - ${conversation.endTime.toLocaleTimeString()}`);
  console.log('');

  // Show first few messages
  console.log('📝 First 3 message excerpts:');
  for (const msg of conversation.messages.slice(0, 3)) {
    const role = msg.role === 'user' ? '👤 User' : '🤖 Claude';
    const excerpt = msg.content.slice(0, 100).replace(/\n/g, ' ');
    console.log(`   ${role}: ${excerpt}...`);
  }
  console.log('');

  // Test source linking
  if (conversation.messages.length > 0) {
    const firstMsg = conversation.messages[0];
    console.log('🔗 Source Link (first message):');
    console.log(`   Session: ${firstMsg.source.sessionId}`);
    console.log(`   UUID: ${firstMsg.source.messageUuid}`);
    console.log(`   File: ${firstMsg.source.filePath}`);
  }
}

console.log('\n✅ Parser test complete!');
