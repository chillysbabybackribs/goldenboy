import http from 'http';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./AgentToolExecutor', () => ({
  agentToolExecutor: {
    list: vi.fn(),
    execute: vi.fn(),
  },
}));

vi.mock('../chatKnowledge/ChatKnowledgeStore', () => ({
  chatKnowledgeStore: {
    recordToolMessage: vi.fn(),
  },
}));

vi.mock('./ConstraintValidator', () => ({
  formatValidationForModel: vi.fn(() => ''),
}));

import { V2ToolBridge } from './V2ToolBridge';
import { agentToolExecutor } from './AgentToolExecutor';
import fs from 'fs';
import os from 'os';
import path from 'path';

function httpPost(port: number, route: string, body: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      { hostname: '127.0.0.1', port, path: route, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } },
      (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
        res.on('end', () => { try { resolve(JSON.parse(data)); } catch { reject(new Error('bad json')); } });
      },
    );
    req.on('error', reject);
    req.end(payload);
  });
}

describe('V2ToolBridge', () => {
  let bridge: V2ToolBridge;
  let contextPath: string;

  beforeEach(async () => {
    contextPath = path.join(os.tmpdir(), `v2-ctx-test-${Date.now()}.json`);
    fs.writeFileSync(contextPath, JSON.stringify({
      runId: 'run-1', agentId: 'gpt-5.4', taskId: 'task-1', mode: 'unrestricted-dev',
    }));
    bridge = new V2ToolBridge(contextPath);
    await bridge.start();
  });

  afterEach(async () => {
    await bridge.stop();
    try { fs.unlinkSync(contextPath); } catch { /* ok */ }
  });

  it('tools/list returns tools with __ separators', async () => {
    (agentToolExecutor.list as ReturnType<typeof vi.fn>).mockReturnValue([
      { name: 'filesystem.list', description: 'List files', inputSchema: { type: 'object', properties: {} } },
    ]);
    const result = await httpPost(bridge.getPort(), '/tools/list', {}) as { tools: Array<{ name: string }> };
    expect(result.tools[0].name).toBe('filesystem__list');
  });

  it('tools/call translates __ name back and executes', async () => {
    (agentToolExecutor.execute as ReturnType<typeof vi.fn>).mockResolvedValue({
      summary: 'listed', data: { entries: [] },
    });
    const result = await httpPost(bridge.getPort(), '/tools/call', {
      name: 'filesystem__list', arguments: { path: '/tmp' }, contextPath,
    }) as { content: Array<{ type: string; text: string }> };
    expect(agentToolExecutor.execute).toHaveBeenCalledWith(
      'filesystem.list', { path: '/tmp' },
      expect.objectContaining({ runId: 'run-1', taskId: 'task-1' }),
    );
    expect(result.content[0].type).toBe('text');
  });

  it('getPort() returns a non-zero port after start()', () => {
    expect(typeof bridge.getPort()).toBe('number');
    expect(bridge.getPort()).toBeGreaterThan(0);
  });
});
