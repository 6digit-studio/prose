import { createOpenAI } from '@ai-sdk/openai';
import { streamText } from 'ai';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import * as readline from 'readline';
import type { ProjectMemory } from './memory.js';

interface Message {
    role: 'user' | 'assistant' | 'system';
    content: string;
}

/**
 * Start an interactive design session to refine project memory
 */
export async function startDesignSession(
    projectName: string,
    memory: ProjectMemory,
    config: { apiKey: string; baseUrl?: string; model?: string }
): Promise<void> {
    const openai = createOpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseUrl || 'https://openrouter.ai/api/v1',
    });

    const model = openai(config.model || 'google/gemini-3-flash-preview');

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: true
    });

    const messages: Message[] = [
        {
            role: 'system',
            content: `You are the **Memory Clerk** for project "${projectName}". 
Your sole purpose is to capture **direct corrections** and **ground-truth state updates** from the project designer.

Current State:
- Focus: ${memory.current.focus?.current_goal || 'None'}
- Decisions: ${(memory.current.decisions?.decisions || []).length} recorded
- Gotchas: ${(memory.current.insights?.gotchas || []).length} recorded

Guidelines:
1. **Be extremely terse.** Do not use pleasantries or provide proactive "insights".
2. **Confirm Deltas.** After each user input, state exactly what correction or update you have recorded.
3. **Format for Evolution.** Your responses will be used as a high-priority steering signal for the project's semantic evolution.
4. **Zero Noise.** If the user provides a fact, acknowledge it and wait. If they ask a question, answer it directly from the memory provided, then stop.`
        }
    ];

    console.log('\n🗄️  Intelligent Design: Memory Correction Mode');
    console.log('-------------------------------------------');
    console.log('State your corrections. Type "done" to save and exit.\n');

    while (true) {
        const userInput = await new Promise<string>((resolve) => {
            rl.question('👤 (Designer) > ', resolve);
        });

        if (['exit', 'done', 'quit'].includes(userInput.toLowerCase().trim())) {
            break;
        }

        if (!userInput.trim()) continue;

        messages.push({ role: 'user', content: userInput });

        process.stdout.write('📝 (Clerk) > ');

        let fullResponse = '';
        const result = await streamText({
            model,
            messages: messages as any,
        });

        for await (const textPart of result.textStream) {
            process.stdout.write(textPart);
            fullResponse += textPart;
        }
        process.stdout.write('\n\n');

        messages.push({ role: 'assistant', content: fullResponse });
    }

    rl.close();

    // Save the design session
    if (messages.length > 1) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const sessionId = `design-${timestamp}`;
        const designArtifact = {
            type: 'design-session',
            projectName,
            timestamp: new Date(),
            messages: messages.filter(m => m.role !== 'system'),
        };

        const proseDir = join(process.cwd(), '.claude', 'prose');
        if (!existsSync(proseDir)) {
            mkdirSync(proseDir, { recursive: true });
        }

        const filePath = join(proseDir, `${sessionId}.json`);
        writeFileSync(filePath, JSON.stringify(designArtifact, null, 2));

        console.log(`✅ Design session saved to: ${filePath}`);
        console.log('Run `claude-prose evolve` to integrate these corrections into the project memory.');
    }
}
