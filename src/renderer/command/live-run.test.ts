import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import {
  appendThought,
  appendToken,
  appendToolStatus,
  createLiveRunCard,
  migrateBufferedOutputToThoughts,
  replaceWithError,
  replaceWithResult,
} from './live-run.ts';

describe('live run chat stream', () => {
  let dom: JSDOM;
  let container: HTMLElement;
  let updateLastAgentResponseText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    dom = new JSDOM('<!doctype html><html><body><div id="chat"></div></body></html>', {
      pretendToBeVisual: true,
    });
    Object.assign(globalThis, {
      window: dom.window,
      document: dom.window.document,
      HTMLElement: dom.window.HTMLElement,
      HTMLDetailsElement: dom.window.HTMLDetailsElement,
    });
    container = dom.window.document.getElementById('chat') as HTMLElement;
    updateLastAgentResponseText = vi.fn();
  });

  afterEach(() => {
    dom.window.close();
  });

  function createCard(taskId = 'task-1'): void {
    createLiveRunCard(taskId, 'provider', container, {
      renderMarkdown: (text) => `<p>${text}</p>`,
      updateLastAgentResponseText,
      scheduleChatScrollToBottom: () => {},
      disableChatAutoPin: () => {},
    });
  }

  it('renders an initial status inside a single stream container', () => {
    createCard('task-thinking');

    const root = container.querySelector('[data-task-id="task-thinking"]') as HTMLElement;
    const stream = root.querySelector('.chat-stream') as HTMLElement;
    const status = root.querySelector('.chat-live-status-text') as HTMLElement;

    expect(stream).not.toBeNull();
    expect(status.textContent).toBe('Thinking...');
    expect(root.querySelector('.chat-live-panel')).toBeNull();
  });

  it('appends thoughts, tool cards, and final response in one continuous sequence', () => {
    createCard('task-sequence');

    appendThought('task-sequence', 'Inspecting the renderer order.');
    appendToolStatus('task-sequence', 'tool-start:Open live renderer');
    appendToolStatus('task-sequence', 'tool-done:Open live renderer');
    appendThought('task-sequence', 'Applying the stream patch.');
    appendToken('task-sequence', 'Final answer is streaming here.');

    const stream = container.querySelector('[data-task-id="task-sequence"] .chat-stream') as HTMLElement;
    const entries = Array.from(stream.children).map((el) => ({
      tag: el.tagName.toLowerCase(),
      className: el.className,
      text: el.textContent?.trim() || '',
    }));

    expect(entries.map((entry) => entry.className)).toEqual([
      'chat-thought-line',
      'chat-tool-stack',
      'chat-thought-line',
      'chat-msg-text chat-markdown chat-final-response chat-msg-streaming',
    ]);
    expect(entries[1]?.text).toContain('Open live renderer');
    expect(entries[3]?.text).toContain('Final answer is streaming here.');
  });

  it('keeps the final response inline at the end of the stream when completed', () => {
    createCard('task-final');

    appendThought('task-final', 'Checking the current renderer order.');
    appendToolStatus('task-final', 'tool-start:Inspect stream node');
    appendToolStatus('task-final', 'tool-done:Inspect stream node');
    replaceWithResult('task-final', {
      success: true,
      output: 'The response remains inline after the tool card.',
    });

    const root = container.querySelector('[data-task-id="task-final"]') as HTMLElement;
    const stream = root.querySelector('.chat-stream') as HTMLElement;
    const lastChild = stream.lastElementChild as HTMLElement;

    expect(root.classList.contains('chat-msg-done')).toBe(true);
    expect(root.querySelector('.chat-process-details')).toBeNull();
    expect(lastChild.className).toBe('chat-msg-text chat-markdown chat-final-response chat-msg-streaming chat-response-complete');
    expect(lastChild.textContent).toContain('The response remains inline after the tool card.');
  });

  it('renders errors inline in the stream without legacy panels', () => {
    createCard('task-error');

    replaceWithError('task-error', 'Something failed');

    const root = container.querySelector('[data-task-id="task-error"]') as HTMLElement;
    const error = root.querySelector('.chat-msg-error') as HTMLElement;

    expect(error).not.toBeNull();
    expect(error.textContent).toBe('Something failed');
    expect(root.querySelector('.chat-live-panel')).toBeNull();
  });

  it('moves migrated streamed output back into a thought line', () => {
    createCard('task-migrate');

    appendToken('task-migrate', 'Interim response text');
    expect(updateLastAgentResponseText).toHaveBeenLastCalledWith('Interim response text');

    migrateBufferedOutputToThoughts('task-migrate');

    const stream = container.querySelector('[data-task-id="task-migrate"] .chat-stream') as HTMLElement;
    const entries = Array.from(stream.children).map((el) => el.textContent?.trim());

    expect(entries).toEqual(['Interim response text']);
    expect(updateLastAgentResponseText).toHaveBeenLastCalledWith('');
  });

  it('keeps earlier chat rows visible while a live response streams', () => {
    const priorMessage = dom.window.document.createElement('div');
    priorMessage.className = 'chat-msg chat-msg-user';
    priorMessage.textContent = 'Original prompt';
    container.appendChild(priorMessage);

    createCard('task-history');
    appendToken('task-history', 'Streaming reply');

    expect(priorMessage.isConnected).toBe(true);
    expect(container.children).toHaveLength(2);
  });
});
