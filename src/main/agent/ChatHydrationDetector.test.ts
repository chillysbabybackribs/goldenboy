import { describe, expect, it } from 'vitest';

import { ChatHydrationDetector } from './ChatHydrationDetector';

describe('ChatHydrationDetector', () => {
  const detector = new ChatHydrationDetector();

  it('detects phrase-based follow-ups like "go ahead"', () => {
    expect(detector.detectNeed({
      userMessage: 'go ahead',
      taskId: 'task-1',
      priorTaskExists: true,
      conversationMode: true,
    })).toBe('recent');
  });

  it('detects multi-word recap requests', () => {
    expect(detector.detectNeed({
      userMessage: 'what did we decide about the install path',
      taskId: 'task-1',
      priorTaskExists: true,
      conversationMode: true,
    })).toBe('full');
  });
});
