/**
 * Jina API Client - Deep Semantic Embeddings
 *
 * Integrates jina-embeddings-v4 for conceptual search and semantic evolution.
 * Supports task-specific adapters and Matryoshka dimension reduction.
 */

import * as logger from './logger.js';

const JINA_API_URL = 'https://api.jina.ai/v1/embeddings';

export type JinaTask = 'retrieval.query' | 'retrieval.passage' | 'text-matching' | 'classification' | 'separation';

export interface JinaEmbeddingResponse {
    model: string;
    data: {
        object: 'embedding';
        index: number;
        embedding: number[];
    }[];
    usage: {
        total_tokens: number;
        prompt_tokens: number;
    };
}

/**
 * Get embeddings for a list of texts using Jina Embeddings v4
 *
 * @param texts Array of strings to embed
 * @param apiKey Jina API key
 * @param task The task adapter to use (defaults to retrieval.passage)
 * @param dimensions Dimensionality of the output (Matryoshka supported)
 */
export async function getJinaEmbeddings(
    texts: string[],
    apiKey: string,
    options: {
        task?: JinaTask;
        dimensions?: number;
        model?: string;
    } = {}
): Promise<number[][]> {
    const {
        task = 'retrieval.passage',
        dimensions = 512, // Matryoshka default for Prose
        model = 'jina-embeddings-v4',
    } = options;

    if (texts.length === 0) return [];

    try {
        const response = await fetch(JINA_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model,
                task,
                dimensions,
                input: texts,
                embedding_type: 'float',
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Jina API error (${response.status}): ${errorText}`);
        }

        const json = (await response.json()) as JinaEmbeddingResponse;

        // Sort by index to ensure order matches input
        return json.data
            .sort((a, b) => a.index - b.index)
            .map(item => item.embedding);

    } catch (error: any) {
        logger.error(`❌ Jina Embedding failed: ${error.message}`);
        throw error;
    }
}

/**
 * Calculate cosine similarity between two vectors
 */
export function cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
        dotProduct += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }

    const result = dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    return isNaN(result) ? 0 : result;
}
