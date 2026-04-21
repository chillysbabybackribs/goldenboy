import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentProviderRequest } from './AgentTypes';
import { EventEmitter } from 'events';

const { requestMock } = vi.hoisted(() => ({
  requestMock: vi.fn(),
}));

vi.mock('https', () => ({
  request: requestMock,
}));

vi.mock('../chatKnowledge/ChatKnowledgeStore', () => ({
  chatKnowledgeStore: {
    recordToolMessage: vi.fn(),
  },
}));

import { GeminiProvider } from './GeminiProvider';
import { routeGeminiModel } from './GeminiModelRouter';
import { agentToolExecutor } from './AgentToolExecutor';

function buildRequest(overrides: Partial<AgentProviderRequest> = {}): AgentProviderRequest {
  return {
    runId: 'run-1',
    agentId: 'gemini',
    mode: 'unrestricted-dev',
    taskId: 'task-1',
    systemPrompt: 'You are a helpful assistant.',
    task: 'Summarize the result.',
    contextPrompt: '',
    tools: [],
    maxToolTurns: 2,
    ...overrides,
  };
}

describe('GeminiProvider', () => {
  beforeEach(() => {
    requestMock.mockReset();
    delete process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_MODEL_DEFAULT;
    delete process.env.GEMINI_MODEL_COMPLEX;
    delete process.env.GEMINI_MODEL_FAST;
    delete process.env.GEMINI_MODEL_LITE;
    delete process.env.GEMINI_ROUTER_STRATEGY;
  });

  it('requires a Gemini API key', () => {
    expect(() => new GeminiProvider('')).toThrow('GEMINI_API_KEY is not configured.');
  });

  it('accepts an explicit model override', () => {
    process.env.GEMINI_API_KEY = 'test-key';
    const provider = new GeminiProvider({ modelId: 'gemini-2.5-pro' });
    expect(provider.modelId).toBe('gemini-2.5-pro');
  });

  it('returns a final response when Gemini answers without tool calls', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    requestMock.mockImplementation((_options: unknown, callback: (response: EventEmitter & { statusCode?: number }) => void) => {
      const response = new EventEmitter() as EventEmitter & { statusCode?: number };
      response.statusCode = 200;
      callback(response);
      queueMicrotask(() => {
        response.emit('data', Buffer.from(JSON.stringify({
          candidates: [
            {
              content: {
                role: 'model',
                parts: [{ text: 'Hello from Gemini.' }],
              },
            },
          ],
          usageMetadata: {
            promptTokenCount: 12,
            candidatesTokenCount: 5,
          },
        })));
        response.emit('end');
      });
      return {
        on: vi.fn().mockReturnThis(),
        write: vi.fn(),
        end: vi.fn(),
      };
    });

    const tokens: string[] = [];
    const itemEvents: string[] = [];
    const provider = new GeminiProvider();
    const result = await provider.invoke(buildRequest({
      onToken: (text) => {
        tokens.push(text);
      },
      onItem: ({ eventType }) => {
        itemEvents.push(eventType);
      },
    }));

    expect(requestMock).toHaveBeenCalledTimes(1);
    // Gemini's REST API has no delta streaming, so the final text is emitted
    // as a single `onToken` call. The renderer's typewriter reveals it
    // progressively, matching the streaming UX of Haiku and Codex.
    expect(tokens).toEqual(['Hello from Gemini.']);
    expect(itemEvents).toEqual(['item.completed']);
    expect(result).toEqual({
      output: 'Hello from Gemini.',
      codexItems: [
        {
          id: expect.any(String),
          type: 'agent_message',
          text: 'Hello from Gemini.',
        },
      ],
      usage: {
        inputTokens: 12,
        cachedInputTokens: 0,
        outputTokens: 5,
        durationMs: expect.any(Number),
      },
    });
  });

  it('includes thoughtsTokenCount in the reported output token total', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    requestMock.mockImplementation((_options: unknown, callback: (response: EventEmitter & { statusCode?: number }) => void) => {
      const response = new EventEmitter() as EventEmitter & { statusCode?: number };
      response.statusCode = 200;
      callback(response);
      queueMicrotask(() => {
        response.emit('data', Buffer.from(JSON.stringify({
          candidates: [
            {
              content: {
                role: 'model',
                parts: [{ text: 'Reasoned answer.' }],
              },
            },
          ],
          usageMetadata: {
            promptTokenCount: 50,
            cachedContentTokenCount: 0,
            candidatesTokenCount: 8,
            thoughtsTokenCount: 42,
          },
        })));
        response.emit('end');
      });
      return {
        on: vi.fn().mockReturnThis(),
        write: vi.fn(),
        end: vi.fn(),
      };
    });

    const provider = new GeminiProvider();
    const result = await provider.invoke(buildRequest());

    // Gemini bills thoughts as output; they must flow into the footer's
    // "out" column instead of being silently dropped.
    expect(result.usage?.outputTokens).toBe(50);
    expect(result.usage?.inputTokens).toBe(50);
  });

  it('passes the routed thinking budget to Gemini generation requests', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    const writes: string[] = [];
    requestMock.mockImplementation((_options: unknown, callback: (response: EventEmitter & { statusCode?: number }) => void) => {
      const response = new EventEmitter() as EventEmitter & { statusCode?: number };
      response.statusCode = 200;
      callback(response);
      queueMicrotask(() => {
        response.emit('data', Buffer.from(JSON.stringify({
          candidates: [
            {
              content: {
                role: 'model',
                parts: [{ text: 'Budget applied.' }],
              },
              finishReason: 'STOP',
            },
          ],
          usageMetadata: {
            promptTokenCount: 12,
            candidatesTokenCount: 5,
          },
        })));
        response.emit('end');
      });
      return {
        on: vi.fn().mockReturnThis(),
        write: vi.fn((payload: string) => {
          writes.push(payload);
        }),
        end: vi.fn(),
      };
    });

    const provider = new GeminiProvider();
    await provider.invoke(buildRequest({
      task: 'Investigate the failing CI, review the repo changes, and synthesize the root cause.',
      tools: [{
        name: 'filesystem.read',
        description: 'Read a file',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string' },
          },
        },
      }],
    }));

    const requestBody = JSON.parse(writes[0]) as {
      generationConfig?: { thinkingConfig?: { thinkingBudget?: number } };
    };
    expect(requestBody.generationConfig?.thinkingConfig?.thinkingBudget).toBe(-1);
  });

  it('marks usable MAX_TOKENS Gemini output as incomplete so a higher layer can continue it', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    requestMock.mockImplementation((_options: unknown, callback: (response: EventEmitter & { statusCode?: number }) => void) => {
      const response = new EventEmitter() as EventEmitter & { statusCode?: number };
      response.statusCode = 200;
      callback(response);
      queueMicrotask(() => {
        response.emit('data', Buffer.from(JSON.stringify({
          candidates: [
            {
              content: {
                role: 'model',
                parts: [{ text: 'Gemini partial answer.' }],
              },
              finishReason: 'MAX_TOKENS',
            },
          ],
          usageMetadata: {
            promptTokenCount: 12,
            candidatesTokenCount: 5,
          },
        })));
        response.emit('end');
      });
      return {
        on: vi.fn().mockReturnThis(),
        write: vi.fn(),
        end: vi.fn(),
      };
    });

    const provider = new GeminiProvider();
    const result = await provider.invoke(buildRequest());

    expect(result.output).toBe('Gemini partial answer.');
    expect(result.completion).toEqual({
      completed: false,
      reason: 'max_tokens',
      canContinue: true,
    });
  });

  it('reuses cached Gemini prefix content for repeated generation calls', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    const writes: string[] = [];
    let generateCallCount = 0;
    requestMock.mockImplementation((options: { path?: string }, callback: (response: EventEmitter & { statusCode?: number }) => void) => {
      const response = new EventEmitter() as EventEmitter & { statusCode?: number };
      response.statusCode = 200;
      callback(response);
      queueMicrotask(() => {
        if (String(options?.path || '').includes('/cachedContents')) {
          response.emit('data', Buffer.from(JSON.stringify({
            name: 'cachedContents/prefix-1',
          })));
        } else {
          generateCallCount += 1;
          if (generateCallCount === 1) {
            response.emit('data', Buffer.from(JSON.stringify({
              candidates: [
                {
                  content: {
                    role: 'model',
                    parts: [{
                      functionCall: {
                        name: 'filesystem__read',
                        args: { path: 'README.md' },
                      },
                    }],
                  },
                  finishReason: 'STOP',
                },
              ],
              usageMetadata: {
                promptTokenCount: 30,
                cachedContentTokenCount: 18,
                candidatesTokenCount: 4,
              },
            })));
          } else {
            response.emit('data', Buffer.from(JSON.stringify({
              candidates: [
                {
                  content: {
                    role: 'model',
                    parts: [{ text: 'Used cached prefix.' }],
                  },
                  finishReason: 'STOP',
                },
              ],
              usageMetadata: {
                promptTokenCount: 20,
                cachedContentTokenCount: 18,
                candidatesTokenCount: 3,
              },
            })));
          }
        }
        response.emit('end');
      });
      return {
        on: vi.fn().mockReturnThis(),
        write: vi.fn((payload: string) => {
          writes.push(payload);
        }),
        end: vi.fn(),
      };
    });

    const provider = new GeminiProvider();
    const existingTools = agentToolExecutor.list();
    try {
      agentToolExecutor.register({
        name: 'filesystem.read',
        description: 'Read a file',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string' },
          },
          required: ['path'],
        },
        execute: async () => ({
          summary: 'Read file',
          data: { path: 'README.md', text: 'hello' },
        }),
      });

      const result = await provider.invoke(buildRequest({
        systemPrompt: 'X'.repeat(3200),
        task: 'Inspect README and summarize it.',
        tools: [{
          name: 'filesystem.read',
          description: 'Read a file',
          inputSchema: {
            type: 'object',
            properties: {
              path: { type: 'string' },
            },
            required: ['path'],
          },
        }],
        onItem: () => {},
      }));

      const cacheCreateBody = JSON.parse(writes[0]) as { model?: string };
      const firstGenerateBody = JSON.parse(writes[1]) as { cachedContent?: string; tools?: unknown; systemInstruction?: unknown };
      const secondGenerateBody = JSON.parse(writes[2]) as { cachedContent?: string; tools?: unknown; systemInstruction?: unknown };
      expect(cacheCreateBody.model).toContain('models/');
      expect(firstGenerateBody.cachedContent).toBe('cachedContents/prefix-1');
      expect(firstGenerateBody.tools).toBeUndefined();
      expect(firstGenerateBody.systemInstruction).toBeUndefined();
      expect(secondGenerateBody.cachedContent).toBe('cachedContents/prefix-1');
      expect(result.output).toBe('Used cached prefix.');
      expect(result.usage?.cachedInputTokens).toBe(36);
    } finally {
      for (const tool of existingTools) {
        agentToolExecutor.register(tool);
      }
    }
  });

  it('strips unsupported additionalProperties fields from Gemini tool schemas', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    const writes: string[] = [];
    requestMock.mockImplementation((_options: unknown, callback: (response: EventEmitter & { statusCode?: number }) => void) => {
      const response = new EventEmitter() as EventEmitter & { statusCode?: number };
      response.statusCode = 200;
      callback(response);
      queueMicrotask(() => {
        response.emit('data', Buffer.from(JSON.stringify({
          candidates: [
            {
              content: {
                role: 'model',
                parts: [{ text: 'Schema accepted.' }],
              },
            },
          ],
          usageMetadata: {
            promptTokenCount: 12,
            candidatesTokenCount: 5,
          },
        })));
        response.emit('end');
      });
      return {
        on: vi.fn().mockReturnThis(),
        write: vi.fn((payload: string) => {
          writes.push(payload);
        }),
        end: vi.fn(),
      };
    });

    const provider = new GeminiProvider();
    await provider.invoke(buildRequest({
      tools: [
        {
          name: 'filesystem.read',
          description: 'Read a file',
          inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              path: { type: 'string' },
              nested: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  value: { type: 'string' },
                },
              },
            },
          },
        },
      ],
    }));

    const requestBody = JSON.parse(writes[0]) as {
      tools?: Array<{ functionDeclarations: Array<{ parameters?: Record<string, unknown> }> }>;
    };
    expect(requestBody.tools?.[0]?.functionDeclarations?.[0]?.parameters).toEqual({
      type: 'object',
      properties: {
        path: { type: 'string' },
        nested: {
          type: 'object',
          properties: {
            value: { type: 'string' },
          },
        },
      },
    });
  });

  it('retries transient Gemini transport failures once', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    let attempts = 0;
    requestMock.mockImplementation((_options: unknown, callback: (response: EventEmitter & { statusCode?: number }) => void) => {
      attempts += 1;
      if (attempts === 1) {
        return {
          on(event: string, handler: (error?: Error) => void) {
            if (event === 'error') {
              queueMicrotask(() => handler(new Error('Gemini request timed out')));
            }
            return this;
          },
          write: vi.fn(),
          end: vi.fn(),
        };
      }

      const response = new EventEmitter() as EventEmitter & { statusCode?: number };
      response.statusCode = 200;
      callback(response);
      queueMicrotask(() => {
        response.emit('data', Buffer.from(JSON.stringify({
          candidates: [
            {
              content: {
                role: 'model',
                parts: [{ text: 'Recovered after retry.' }],
              },
            },
          ],
          usageMetadata: {
            promptTokenCount: 12,
            candidatesTokenCount: 5,
          },
        })));
        response.emit('end');
      });
      return {
        on: vi.fn().mockReturnThis(),
        write: vi.fn(),
        end: vi.fn(),
      };
    });

    const provider = new GeminiProvider();
    const result = await provider.invoke(buildRequest());

    expect(attempts).toBe(2);
    expect(result.output).toBe('Recovered after retry.');
  });

  it('fails when Gemini returns a non-usable finish reason without output', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    requestMock.mockImplementation((_options: unknown, callback: (response: EventEmitter & { statusCode?: number }) => void) => {
      const response = new EventEmitter() as EventEmitter & { statusCode?: number };
      response.statusCode = 200;
      callback(response);
      queueMicrotask(() => {
        response.emit('data', Buffer.from(JSON.stringify({
          candidates: [
            {
              content: {
                role: 'model',
                parts: [],
              },
              finishReason: 'SAFETY',
            },
          ],
          usageMetadata: {
            promptTokenCount: 12,
            candidatesTokenCount: 0,
          },
        })));
        response.emit('end');
      });
      return {
        on: vi.fn().mockReturnThis(),
        write: vi.fn(),
        end: vi.fn(),
      };
    });

    const provider = new GeminiProvider();
    await expect(provider.invoke(buildRequest())).rejects.toThrow(
      'Gemini stopped with finishReason=SAFETY without usable output.',
    );
  });

  it('compacts older Gemini conversation turns into a rolling summary', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    const writes: string[] = [];
    let generateCallCount = 0;

    requestMock.mockImplementation((options: { path?: string }, callback: (response: EventEmitter & { statusCode?: number }) => void) => {
      const response = new EventEmitter() as EventEmitter & { statusCode?: number };
      response.statusCode = 200;
      callback(response);
      queueMicrotask(() => {
        if (String(options?.path || '').includes('/cachedContents')) {
          response.emit('data', Buffer.from(JSON.stringify({ error: { message: 'skip cache' } })));
        } else {
          generateCallCount += 1;
          if (generateCallCount <= 5) {
            response.emit('data', Buffer.from(JSON.stringify({
              candidates: [
                {
                  content: {
                    role: 'model',
                    parts: [{
                      functionCall: {
                        name: 'filesystem__read',
                        args: { path: `file-${generateCallCount}.ts` },
                      },
                    }],
                  },
                  finishReason: 'STOP',
                },
              ],
              usageMetadata: {
                promptTokenCount: 10,
                candidatesTokenCount: 2,
              },
            })));
          } else {
            response.emit('data', Buffer.from(JSON.stringify({
              candidates: [
                {
                  content: {
                    role: 'model',
                    parts: [{ text: 'Done.' }],
                  },
                  finishReason: 'STOP',
                },
              ],
              usageMetadata: {
                promptTokenCount: 10,
                candidatesTokenCount: 2,
              },
            })));
          }
        }
        response.emit('end');
      });
      return {
        on: vi.fn().mockReturnThis(),
        write: vi.fn((payload: string) => {
          writes.push(payload);
        }),
        end: vi.fn(),
      };
    });

    const provider = new GeminiProvider();
    const existingTools = agentToolExecutor.list();
    try {
      agentToolExecutor.register({
        name: 'filesystem.read',
        description: 'Read a file',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string' },
          },
          required: ['path'],
        },
        execute: async (input: { path: string }) => ({
          summary: `Read ${input.path}`,
          data: { path: input.path, text: `contents for ${input.path}` },
        }),
      });

      await provider.invoke(buildRequest({
        maxToolTurns: 6,
        task: 'Inspect several files, then summarize the findings.',
        tools: [{
          name: 'filesystem.read',
          description: 'Read a file',
          inputSchema: {
            type: 'object',
            properties: {
              path: { type: 'string' },
            },
            required: ['path'],
          },
        }],
        onItem: () => {},
      }));

      const finalGenerateBody = JSON.parse(writes[writes.length - 1]) as {
        contents?: Array<{ parts?: Array<{ text?: string }> }>;
      };
      const summaryText = finalGenerateBody.contents?.[0]?.parts?.[0]?.text || '';
      expect(summaryText).toContain('Earlier conversation summary.');
      expect(summaryText).toContain('filesystem.read');
    } finally {
      for (const tool of existingTools) {
        agentToolExecutor.register(tool);
      }
    }
  });
});

describe('routeGeminiModel', () => {
  beforeEach(() => {
    delete process.env.GEMINI_MODEL_DEFAULT;
    delete process.env.GEMINI_MODEL_COMPLEX;
    delete process.env.GEMINI_MODEL_FAST;
    delete process.env.GEMINI_MODEL_LITE;
    delete process.env.GEMINI_ROUTER_STRATEGY;
  });

  it('uses the complex model for complex tasks', () => {
    process.env.GEMINI_MODEL_COMPLEX = 'gemini-complex';
    expect(routeGeminiModel({
      task: 'Investigate the failing CI, review the repo changes, and synthesize the root cause.',
      contextPrompt: '',
      canUseTools: true,
    })).toEqual({
      modelId: 'gemini-complex',
      reason: 'balanced-high-complexity',
      thinkingBudget: -1,
    });
  });

  it('uses the lite model for short general tasks', () => {
    process.env.GEMINI_MODEL_LITE = 'gemini-lite';
    expect(routeGeminiModel({
      task: 'Rename this variable.',
      contextPrompt: '',
    })).toEqual({
      modelId: 'gemini-lite',
      reason: 'short-general-task',
      thinkingBudget: null,
    });
  });

  it('uses the default model for normal implementation tasks with tools', () => {
    process.env.GEMINI_MODEL_DEFAULT = 'gemini-default';
    expect(routeGeminiModel({
      task: 'Update the command UI selection logic and patch the TypeScript implementation.',
      contextPrompt: '',
      canUseTools: true,
    })).toEqual({
      modelId: 'gemini-default',
      reason: 'balanced-standard',
      thinkingBudget: -1,
    });
  });

  it('avoids the complex model for medium-complexity prompts when the cheap strategy is enabled', () => {
    process.env.GEMINI_MODEL_DEFAULT = 'gemini-default';
    process.env.GEMINI_MODEL_FAST = 'gemini-fast';
    process.env.GEMINI_ROUTER_STRATEGY = 'cheap';
    expect(routeGeminiModel({
      task: [
        'Summarize these implementation notes for me and keep only the practical takeaways for the current task handoff.',
        'Focus on what changed, what is still risky, what should be validated next, and what the receiving engineer needs to know before touching the provider routing or browser research path.',
        'Do not rewrite the whole plan; compress it into a fast operational brief for a follow-up coding pass.',
      ].join(' '),
      contextPrompt: '',
      canUseTools: false,
    })).toEqual({
      modelId: 'gemini-2.5-flash-lite',
      reason: 'cheap-lite',
      thinkingBudget: null,
    });
  });

  it('biases browser-heavy validation-sensitive tasks up to the complex model', () => {
    process.env.GEMINI_MODEL_COMPLEX = 'gemini-complex';
    expect(routeGeminiModel({
      task: 'Research the failing login flow in the browser, inspect multiple tabs, verify the regression, and report what is deterministically confirmed.',
      contextPrompt: '',
      canUseTools: true,
    })).toEqual({
      modelId: 'gemini-complex',
      reason: 'balanced-high-complexity',
      thinkingBudget: -1,
    });
  });
});
