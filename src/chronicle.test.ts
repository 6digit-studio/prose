/**
 * Tests for chronicle — the pure helpers (content rendering, config loading,
 * append-only storage). Discord network emission is out of scope here; the
 * truncation guard inside emitToDiscord is the one pure branch worth pinning,
 * so it's tested without touching the network.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  buildContent,
  loadChronicleConfig,
  getChronicleConfigPath,
  emitToDiscord,
} from './sinks.js';

describe('buildContent', () => {
  test('emoji + title + body', () => {
    expect(buildContent('💡', 'found it', 'the bug was in the parser')).toBe(
      '**💡 found it**\nthe bug was in the parser'
    );
  });

  test('header alone when no body', () => {
    expect(buildContent('🔥', 'it compiles')).toBe('**🔥 it compiles**');
  });

  test('no emoji', () => {
    expect(buildContent(undefined, 'plain beat')).toBe('**plain beat**');
  });

  test('trims title and body', () => {
    expect(buildContent('✅', '  done  ', '  shipped  ')).toBe('**✅ done**\nshipped');
  });

  test('empty/whitespace body collapses to header only', () => {
    expect(buildContent('🐛', 'title', '   ')).toBe('**🐛 title**');
  });
});

describe('loadChronicleConfig', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'prose-chronicle-'));
    delete process.env.PROSE_CHRONICLE_DISCORD_WEBHOOK;
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.PROSE_CHRONICLE_DISCORD_WEBHOOK;
  });

  test('returns null when no config file and no env', () => {
    expect(loadChronicleConfig(dir)).toBeNull();
  });

  test('reads the per-repo config file', () => {
    const path = getChronicleConfigPath(dir);
    mkdirSync(join(dir, '.claude', 'prose'), { recursive: true });
    writeFileSync(path, JSON.stringify({
      about: 'charter',
      enthusiasm: 'high',
      sinks: { discord: { webhook: 'https://file', channel: '#x' } },
    }));
    const config = loadChronicleConfig(dir);
    expect(config?.about).toBe('charter');
    expect(config?.sinks?.discord?.webhook).toBe('https://file');
  });

  test('env webhook overrides the file webhook but keeps other fields', () => {
    const path = getChronicleConfigPath(dir);
    mkdirSync(join(dir, '.claude', 'prose'), { recursive: true });
    writeFileSync(path, JSON.stringify({
      sinks: { discord: { webhook: 'https://file', channel: '#x', username: 'lars' } },
    }));
    process.env.PROSE_CHRONICLE_DISCORD_WEBHOOK = 'https://env';
    const config = loadChronicleConfig(dir);
    expect(config?.sinks?.discord?.webhook).toBe('https://env');
    expect(config?.sinks?.discord?.channel).toBe('#x');
    expect(config?.sinks?.discord?.username).toBe('lars');
  });

  test('env webhook alone synthesizes a config when no file exists', () => {
    process.env.PROSE_CHRONICLE_DISCORD_WEBHOOK = 'https://env';
    const config = loadChronicleConfig(dir);
    expect(config?.sinks?.discord?.webhook).toBe('https://env');
  });
});

describe('emitToDiscord', () => {
  test('refuses to truncate over the 2000-char ceiling', async () => {
    const oversize = 'x'.repeat(2001);
    await expect(
      emitToDiscord({ webhook: 'https://example/invalid' }, oversize)
    ).rejects.toThrow(/Refusing to truncate/);
  });
});
