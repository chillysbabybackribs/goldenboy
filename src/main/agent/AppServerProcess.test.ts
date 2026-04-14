import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { mergeTomlMcpEntry, parseListeningPort, AppServerProcess } from './AppServerProcess';

describe('parseListeningPort', () => {
  it('parses port from listening line', () => {
    expect(parseListeningPort('listening on: ws://127.0.0.1:54321')).toBe(54321);
  });
  it('returns null for non-matching line', () => {
    expect(parseListeningPort('some other output')).toBeNull();
  });
});

describe('AppServerProcess.stop() clears config', () => {
  const CODEX_CONFIG_PATH = path.join(os.homedir(), '.codex', 'config.toml');
  let originalConfig: string | null = null;

  beforeEach(() => {
    originalConfig = fs.existsSync(CODEX_CONFIG_PATH)
      ? fs.readFileSync(CODEX_CONFIG_PATH, 'utf-8')
      : null;
  });

  afterEach(() => {
    if (originalConfig !== null) {
      fs.writeFileSync(CODEX_CONFIG_PATH, originalConfig, 'utf-8');
    } else if (fs.existsSync(CODEX_CONFIG_PATH)) {
      fs.unlinkSync(CODEX_CONFIG_PATH);
    }
  });

  it('removes v2-tools section from config.toml on stop()', () => {
    const staleConfig = [
      'model = "gpt-5.4"',
      '',
      '[mcp_servers.v2-tools]',
      'command = "node"',
      'args = ["/some/shim.js"]',
      '',
      '[mcp_servers.v2-tools.env]',
      'V2_BRIDGE_PORT = "99999"',
      'V2_TOOL_CONTEXT_PATH = "/tmp/stale.json"',
    ].join('\n') + '\n';

    fs.mkdirSync(path.dirname(CODEX_CONFIG_PATH), { recursive: true });
    fs.writeFileSync(CODEX_CONFIG_PATH, staleConfig, 'utf-8');

    const proc = new AppServerProcess(99999, '/some/shim.js', '/tmp/stale.json');
    proc.stop();

    const after = fs.readFileSync(CODEX_CONFIG_PATH, 'utf-8');
    expect(after).not.toContain('[mcp_servers.v2-tools]');
    expect(after).not.toContain('V2_BRIDGE_PORT');
    expect(after).toContain('model = "gpt-5.4"');
  });

  it('does not fail when config.toml does not exist', () => {
    if (fs.existsSync(CODEX_CONFIG_PATH)) fs.unlinkSync(CODEX_CONFIG_PATH);
    const proc = new AppServerProcess(1234, '/some/shim.js', '/tmp/ctx.json');
    expect(() => proc.stop()).not.toThrow();
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

  it('removes legacy local-agent sections so Codex does not route through Claude-Browser', () => {
    const existing = [
      '[mcp_servers.local-agent]',
      'command = "node"',
      'args = ["/home/dp/Desktop/Claude-Browser/tools/mcp/local-agent-server/dist/server.js"]',
      '',
      '[mcp_servers.local-agent.env]',
      'CLAUDE_BROWSER_APP_DIR = "/home/dp/Desktop/Claude-Browser"',
      '',
      '[mcp_servers.v2-tools]',
      'command = "node"',
      'args = ["/old/shim.js"]',
      '',
    ].join('\n');
    const result = mergeTomlMcpEntry(existing, '/shim.js', 4000, '/tmp/ctx.json');
    expect(result).not.toContain('[mcp_servers.local-agent]');
    expect(result).not.toContain('Claude-Browser');
    expect(result).toContain('[mcp_servers.v2-tools]');
    expect(result).toContain('/shim.js');
  });
});
