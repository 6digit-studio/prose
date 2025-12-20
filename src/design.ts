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
            content: `You are the **Lead Architect** of the project "${projectName}". 
You are having an "Intelligent Design" session with the Lead Developer to refine the project's semantic memory and consciousness.

Current Project Summary:
${memory.current.focus?.current_goal || 'No active focus'}

Active Decisions:
${(memory.current.decisions?.decisions || []).map(d => `- ${d.what}: ${d.why}`).join('\n') || 'None recorded'}

Active Gotchas:
${(memory.current.insights?.gotchas || []).map(g => `- ${g.issue}: ${g.solution}`).join('\n') || 'None recorded'}

Your goal is to help the developer clarify, correct, and expand this memory. 
Listen carefully to their corrections and confirm how you will update the project's state. 
Once the conversation is finished, the transcript will be used to update the project's evolved memory.

Be professional, insightful, and proactive in identifying potential contradictions in the current memory.`
        }
    ];

    console.log('\n🧠 Starting Intelligent Design Session');
    console.log('------------------------------------');
    console.log('Type your message to the Architect. Type "exit" or "done" to finish and save.\n');

    while (true) {
        const userInput = await new Promise<string>((resolve) => {
            rl.question('👤 (Designer) > ', resolve);
        });

        if (['exit', 'done', 'quit'].includes(userInput.toLowerCase().trim())) {
            break;
        }

        if (!userInput.trim()) continue;

        messages.push({ role: 'user', content: userInput });

        process.stdout.write('🤖 (Architect) > ');

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
