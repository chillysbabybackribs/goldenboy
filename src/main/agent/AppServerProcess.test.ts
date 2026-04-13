import { describe, it, expect } from 'vitest';
import { mergeTomlMcpEntry, parseListeningPort } from './AppServerProcess';

describe('parseListeningPort', () => {
  it('parses port from listening line', () => {
    expect(parseListeningPort('listening on: ws://127.0.0.1:54321')).toBe(54321);
  });
  it('returns null for non-matching line', () => {
    expect(parseListeningPort('some other output')).toBeNull();
  });
});

describe('mergeTomlMcpEntry', () => {
  it('adds v2-tools section to empty toml', () => {
    const result = mergeTomlMcpEntry('', '/path/to/shim.js', 3000, '/tmp/ctx.json');
    expect(result).toContain('[mcp_servers.v2-tools]');
    expect(result).toContain('command = "node"');
    expect(result).toContain('/path/to/shim.js');
    expect(result).toContain('V2_BRIDGE_PORT = "3000"');
    expect(result).toContain('V2_TOOL_CONTEXT_PATH = "/tmp/ctx.json"');
  });

  it('replaces existing v2-tools section, preserves other content', () => {
    const existing = '[other_server]\ncommand = "foo"\n\n[mcp_servers.v2-tools]\ncommand = "old"\n';
    const result = mergeTomlMcpEntry(existing, '/shim.js', 4000, '/tmp/ctx.json');
    expect(result).toContain('[other_server]');
    expect(result).toContain('command = "foo"');
    expect(result).not.toContain('command = "old"');
    expect(result).toContain('V2_BRIDGE_PORT = "4000"');
  });
});
