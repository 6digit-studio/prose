/**
 * Source Parsers - Ingest data from external sources (Git, Antigravity)
 */

import { execSync } from 'child_process';
import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';
import type { Message, SessionFile } from './session-parser.js';

// ============================================================================
// Git Integration
// ============================================================================

/**
 * Get the latest git commits as "messages"
 */
export function getGitCommits(repoPath: string, limit: number = 50): Message[] {
    try {
        const output = execSync(
            `git -C "${repoPath}" log -n ${limit} --pretty=format:"commit|%H|%at|%an|%s%n%b%n---"`,
            { encoding: 'utf-8' }
        );

        const commits = output.split('\n---\n').filter(Boolean);
        const messages: Message[] = [];

        for (const commit of commits) {
            const lines = commit.split('\n');
            const header = lines[0].split('|');
            if (header[0] !== 'commit') continue;

            const hash = header[1];
            const timestamp = new Date(parseInt(header[2], 10) * 1000);
            const author = header[3];
            const subject = header[4];
            const body = lines.slice(1).join('\n').trim();

            messages.push({
                role: 'user', // Commits are user intent
                content: `GIT COMMIT: ${subject}\n\n${body}`,
                timestamp,
                source: {
                    sessionId: `git-${hash.slice(0, 8)}`,
                    messageUuid: hash,
                    timestamp,
                    filePath: repoPath,
                },
            });
        }

        return messages;
    } catch (error) {
        return [];
    }
}

/**
 * Check if a directory is a git repository
 */
export function isGitRepo(path: string): boolean {
    try {
        execSync(`git -C "${path}" rev-parse --is-inside-work-tree`, { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

// ============================================================================
// Antigravity Integration
// ============================================================================

/**
 * Discover Antigravity brain directories
 */
export function getAntigravityBrains(): string[] {
    const metaDir = join(homedir(), '.gemini', 'antigravity', 'brain');
    if (!existsSync(metaDir)) return [];

    try {
        return readdirSync(metaDir, { withFileTypes: true })
            .filter(d => d.isDirectory())
            .map(d => join(metaDir, d.name));
    } catch {
        return [];
    }
}

/**
 * Parse Antigravity artifacts as pseudo-sessions
 */
export function getAntigravityArtifacts(brainPath: string): SessionFile[] {
    if (!existsSync(brainPath)) return [];

    const artifacts: SessionFile[] = [];
    const files = readdirSync(brainPath, { withFileTypes: true })
        .filter(f => f.isFile() && f.name.endsWith('.md'));

    for (const file of files) {
        const filePath = join(brainPath, file.name);
        const stats = statSync(filePath);
        const sessionId = `anti-${basename(brainPath)}-${file.name.replace('.md', '')}`;

        artifacts.push({
            path: filePath,
            sessionId,
            project: `antigravity-${basename(brainPath)}`,
            modifiedTime: stats.mtime,
            fileSize: stats.size,
        });
    }

    return artifacts;
}

/**
 * Read and format an Antigravity artifact as a message
 */
export function parseAntigravityArtifact(filePath: string, sessionId: string, project: string): Message[] {
    try {
        const content = readFileSync(filePath, 'utf-8');
        const stats = statSync(filePath);

        return [{
            role: 'assistant', // Artifacts are agent output
            content: `ANTIGRAVITY ARTIFACT:\n\n${content}`,
            timestamp: stats.mtime,
            source: {
                sessionId,
                messageUuid: sessionId, // Use session ID as UUID for artifacts
                timestamp: stats.mtime,
                filePath,
            },
        }];
    } catch {
        return [];
    }
}

/**
 * Fuzzy match a brain to a project name by checking its task.md
 */
export function matchBrainToProject(brainPath: string, projectFilter: string): boolean {
    const taskPath = join(brainPath, 'task.md');
    if (!existsSync(taskPath)) return false;

    try {
        const content = readFileSync(taskPath, 'utf-8').toLowerCase();
        const sanitizedFilter = projectFilter.replace(/^-Users-[^-]+-src-/, '').toLowerCase();

        return content.includes(sanitizedFilter) ||
            sanitizedFilter.includes(basename(brainPath).toLowerCase());
    } catch {
        return false;
    }
}

/**
 * Get the date of the latest git commit
 */
export function getLatestGitCommitDate(repoPath: string): Date {
    try {
        const output = execSync(`git -C "${repoPath}" log -1 --format=%at`, { encoding: 'utf-8' });
        return new Date(parseInt(output.trim(), 10) * 1000);
    } catch {
        return new Date();
    }
}
