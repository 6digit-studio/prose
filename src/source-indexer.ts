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

// Jina's token limit is 8192, ~4 chars per token = ~32KB
// We use 24KB to leave room for the FILE/TYPE/CODE prefix
const MAX_CHUNK_CHARS = 24000;

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
        // Quote each glob pattern to prevent shell expansion - let git handle the globs
        const extFilter = extensions.map(e => `'*${e}'`).join(' ');
        const cmd = `git -C "${dir}" ls-files --cached --others --exclude-standard ${extFilter}`;
        logger.verbose(`Running: ${cmd}`);
        // --cached: tracked files, --others --exclude-standard: untracked non-ignored files
        const output = execSync(cmd, { encoding: 'utf-8' });
        const files = output.split('\n').filter(Boolean).map(f => join(dir, f));
        logger.verbose(`git ls-files returned ${files.length} files`);
        return files;
    } catch (error: any) {
        // Fallback if not a git repo (simple but less robust)
        logger.warn(`Not a git repository or git failed: ${error.message}`);
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

        // Process chunks one at a time to handle truncation per-chunk
        // (batching can cause issues if combined content exceeds limits)
        for (const chunk of chunksToEmbed) {
            const relativePath = relative(dir, chunk.filePath);
            let content = chunk.content;

            // Truncate oversized chunks to stay under Jina's token limit
            if (content.length > MAX_CHUNK_CHARS) {
                logger.verbose(`✂️  Truncating ${relativePath} chunk (${content.length} -> ${MAX_CHUNK_CHARS} chars)`);
                content = content.slice(0, MAX_CHUNK_CHARS) + '\n// ... truncated for embedding';
            }

            const textToEmbed = `FILE: ${relativePath}\nTYPE: ${chunk.type}\nCODE:\n${content}`;

            try {
                const [vector] = await getJinaEmbeddings([textToEmbed], apiKey, { task: 'retrieval.passage' });
                vectorMap.set(chunk.hash, vector);
            } catch (error: any) {
                logger.warn(`⚠️  Failed to embed ${relativePath}: ${error.message}`);
                // Continue with other chunks
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
