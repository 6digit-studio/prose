import { describe, expect, test } from 'bun:test';
import { renderSessionWithinBudget } from './snap.js';
import type { Message } from './session-parser.js';

function message(sessionId: string, index: number): Message {
  const timestamp = new Date(`2026-08-28T${String(index).padStart(2, '0')}:00:00.000Z`);
  return {
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `${sessionId} substantive tail ${'x'.repeat(2000)}`,
    timestamp,
    source: { sessionId, messageUuid: `${sessionId}-${index}`, timestamp, filePath: `${sessionId}.jsonl` },
  };
}

describe('renderSessionWithinBudget', () => {
  test('keeps every verbose session representable within its fair share', () => {
    const rendered = Array.from({ length: 10 }, (_, index) => {
      const sessionId = `s${String(index).padStart(7, '0')}`;
      return renderSessionWithinBudget(
        sessionId,
        'opencode',
        new Date('2026-08-29T00:00:00.000Z'),
        '1d ago',
        Array.from({ length: 20 }, (_, messageIndex) => message(sessionId, messageIndex)),
        4,
        1500,
        400
      );
    });

    expect(rendered.every(Boolean)).toBe(true);
    expect(rendered.reduce((bytes, result) => bytes + Buffer.byteLength(result!.block), 0)).toBeLessThanOrEqual(4000);
    expect(rendered.map((result) => result!.block)).toEqual(
      expect.arrayContaining(Array.from({ length: 10 }, (_, index) => expect.stringContaining(`s${String(index).padStart(7, '0')}`)))
    );
  });
});
