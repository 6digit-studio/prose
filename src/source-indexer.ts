/**
 * Semantic Source Indexer
 * 
 * Responsible for:
 * 1. Discovering files in a project (respecting .gitignore)
 * 2. Chunking code into semantic units (functions, classes)
 * 3. Hashing and staleness detection
 * 4. Vectorizing chunks via Jina
 */

import { execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { join, relative } from 'path';
import { createHash } from 'crypto';
import { getJinaEmbeddings } from './jina.js';
import * as logger from './logger.js';

export interface SourceChunk {
    filePath: string;
    content: string;
    type: 'function' | 'class' | 'block';
    startLine: number;
    endLine: number;
    hash: string;
}

export interface SourceFileMetadata {
    hash: string;
    chunks: SourceChunk[];
    lastIndexed: string;
}

export interface SourceManifest {
    version: number;
    project: string;
    gitHead?: string;
    files: Record<string, SourceFileMetadata>;
}

/**
 * Walk project directory using git ls-files for efficient filtering
 */
export function getProjectFiles(dir: string, extensions: string[] = ['.ts', '.js', '.py', '.go']): string[] {
    try {
        const extFilter = extensions.map(e => `*${e}`).join(' ');
        // --cached: tracked files, --others --exclude-standard: untracked non-ignored files
        const output = execSync(`git -C "${dir}" ls-files --cached --others --exclude-standard ${extFilter}`, { encoding: 'utf-8' });
        return output.split('\n').filter(Boolean).map(f => join(dir, f));
    } catch (error) {
        // Fallback if not a git repo (simple but less robust)
        logger.warn('Not a git repository or git failed, source indexing might include ignored files.');
        return [];
    }
}

/**
 * Calculate file hash used for staleness detection
 */
export function calculateFileHash(content: string): string {
    return createHash('sha256').update(content).digest('hex');
}

/**
 * Split code into semantic chunks (Initial version: Regex-based)
 */
export function chunkCode(filePath: string, content: string): SourceChunk[] {
    const lines = content.split('\n');
    const chunks: SourceChunk[] = [];
    const ext = filePath.split('.').pop();

    if (['ts', 'js', 'tsx', 'jsx', 'mjs', 'cjs'].includes(ext || '')) {
        // Regex for: function, class, async function, arrow function assignments
        // Matches: export function foo(), const bar = () =>, class Baz
        const patterns = [
            { type: 'class', regex: /^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/ },
            { type: 'function', regex: /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/ },
            { type: 'function', regex: /^(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/ }
        ];

        let currentChunk: Partial<SourceChunk> | null = null;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            let matched = false;

            for (const p of patterns) {
                if (p.regex.test(line)) {
                    // If we were in a chunk, close it (naïve approach: any new signature starts a new chunk)
                    if (currentChunk) {
                        currentChunk.endLine = i;
                        currentChunk.content = lines.slice(currentChunk.startLine! - 1, i).join('\n');
                        currentChunk.hash = calculateFileHash(currentChunk.content);
                        chunks.push(currentChunk as SourceChunk);
                    }

                    currentChunk = {
                        filePath,
                        type: p.type as any,
                        startLine: i + 1,
                    };
                    matched = true;
                    break;
                }
            }
        }

        // Close last chunk
        if (currentChunk) {
            currentChunk.endLine = lines.length;
            currentChunk.content = lines.slice(currentChunk.startLine! - 1).join('\n');
            currentChunk.hash = calculateFileHash(currentChunk.content!);
            chunks.push(currentChunk as SourceChunk);
        }
    }

    // If no chunks were found (no signatures), or for other languages, use whole file as one block
    if (chunks.length === 0) {
        chunks.push({
            filePath,
            content,
            type: 'block',
            startLine: 1,
            endLine: lines.length,
            hash: calculateFileHash(content),
        });
    }

    return chunks;
}

import {
    loadSourceManifest,
    saveSourceManifest,
    loadSourceVectors,
    saveSourceVectors,
    commitToVault
} from './memory.js';

/**
 * Get current Git HEAD hash
 */
export function getGitHead(dir: string): string | undefined {
    try {
        return execSync(`git -C "${dir}" rev-parse HEAD`, { encoding: 'utf-8' }).trim();
    } catch {
        return undefined;
    }
}

/**
 * Orchestrate the source indexing process
 */
export async function indexProjectSource(projectName: string, dir: string, apiKey: string): Promise<{
    filesIndexed: number,
    chunksCreated: number,
    tokensUsed: number
}> {
    const currentHead = getGitHead(dir);
    const existingManifest = loadSourceManifest(projectName) as SourceManifest;
    const existingVectorData = loadSourceVectors(projectName); // Should return { vectors: number[][], hashes: string[] }

    // Reconstruct vector map from storage
    const vectorMap = new Map<string, number[]>();
    if (existingVectorData && (existingVectorData as any).vectors) {
        const data = existingVectorData as any;
        for (let i = 0; i < data.hashes.length; i++) {
            vectorMap.set(data.hashes[i], data.vectors[i]);
        }
    }

    const allFiles = getProjectFiles(dir);
    const manifest: SourceManifest = {
        version: 1,
        project: projectName,
        gitHead: currentHead,
        files: {}
    };

    const chunksToEmbed: SourceChunk[] = [];

    let filesIndexed = 0;
    let tokensUsed = 0;

    for (const filePath of allFiles) {
        const relativePath = relative(dir, filePath);
        const content = readFileSync(filePath, 'utf-8');
        const fileHash = calculateFileHash(content);

        // Check if file is unchanged in manifest
        const existingFile = existingManifest?.files[relativePath];
        if (existingFile && existingFile.hash === fileHash) {
            manifest.files[relativePath] = existingFile;
            // Ensure all chunks for this file are in our vector map
            let allChunksFound = true;
            for (const chunk of existingFile.chunks) {
                if (!vectorMap.has(chunk.hash)) {
                    allChunksFound = false;
                    break;
                }
            }
            if (allChunksFound) continue;
        }

        // File changed or new: Chunk it
        const chunks = chunkCode(filePath, content);
        manifest.files[relativePath] = {
            hash: fileHash,
            chunks: chunks.map(c => ({ ...c, content: '' })), // Store metadata, clear content
            lastIndexed: new Date().toISOString()
        };

        // Find chunks that actually need embedding
        for (const chunk of chunks) {
            if (!vectorMap.has(chunk.hash)) {
                chunksToEmbed.push(chunk);
            }
        }
        filesIndexed++;
    }

    if (chunksToEmbed.length > 0) {
        logger.info(`🧬 Embedding ${chunksToEmbed.length} new code chunks for ${projectName}...`);

        const batchSize = 16;
        for (let i = 0; i < chunksToEmbed.length; i += batchSize) {
            const batch = chunksToEmbed.slice(i, i + batchSize);
            const batchVectors = await getJinaEmbeddings(
                batch.map(c => `FILE: ${relative(dir, c.filePath)}\nTYPE: ${c.type}\nCODE:\n${c.content}`),
                apiKey,
                { task: 'retrieval.passage' }
            );

            for (let j = 0; j < batch.length; j++) {
                vectorMap.set(batch[j].hash, batchVectors[j]);
            }
        }
    }

    // 4. Save manifest and reconciled vector store
    const finalHashes: string[] = [];
    const finalVectors: number[][] = [];

    // We only save vectors that are actually referenced in the current manifest
    const activeHashes = new Set<string>();
    for (const file of Object.values(manifest.files)) {
        for (const chunk of file.chunks) {
            activeHashes.add(chunk.hash);
        }
    }

    for (const [hash, vector] of vectorMap.entries()) {
        if (activeHashes.has(hash)) {
            finalHashes.push(hash);
            finalVectors.push(vector);
        }
    }

    saveSourceManifest(manifest);
    saveSourceVectors(projectName, { vectors: finalVectors, hashes: finalHashes } as any);

    // Commit if in Vault
    commitToVault(`Source Index Update: ${projectName} (${filesIndexed} files affected)`);

    return {
        filesIndexed,
        chunksCreated: chunksToEmbed.length,
        tokensUsed // TODO: Approximate from Jina response if needed
    };
}
