import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  mergeTomlMcpEntry,
  parseListeningPort,
  AppServerProcess,
  codexConfigDirForHome,
  codexConfigPathForHome,
} from './AppServerProcess';

describe('parseListeningPort', () => {
  it('parses port from listening line', () => {
    expect(parseListeningPort('listening on: ws://127.0.0.1:54321')).toBe(54321);
  });
  it('returns null for non-matching line', () => {
    expect(parseListeningPort('some other output')).toBeNull();
  });
});

describe('AppServerProcess.stop() clears config', () => {
  let realHomeDir = '';
  let isolatedHomeDir = '';
  let realConfigPath = '';
  let isolatedConfigPath = '';

  beforeEach(() => {
    realHomeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-real-home-'));
    isolatedHomeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-isolated-home-'));
    realConfigPath = codexConfigPathForHome(realHomeDir);
    isolatedConfigPath = codexConfigPathForHome(isolatedHomeDir);
  });

  afterEach(() => {
    fs.rmSync(realHomeDir, { recursive: true, force: true });
    fs.rmSync(isolatedHomeDir, { recursive: true, force: true });
  });

  it('clears the isolated config.toml on stop() without touching the real home config', () => {
    const realConfig = [
      'model = "gpt-5.4"',
      '',
      '[mcp_servers.real-only]',
      'command = "keep-me"',
    ].join('\n') + '\n';
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

    fs.mkdirSync(codexConfigDirForHome(realHomeDir), { recursive: true });
    fs.mkdirSync(codexConfigDirForHome(isolatedHomeDir), { recursive: true });
    fs.writeFileSync(realConfigPath, realConfig, 'utf-8');
    fs.writeFileSync(isolatedConfigPath, staleConfig, 'utf-8');

    const proc = new AppServerProcess(99999, '/some/shim.js', '/tmp/stale.json', {
      homeDir: realHomeDir,
      isolatedHomeDir,
    });
    proc.stop();

    const realAfter = fs.readFileSync(realConfigPath, 'utf-8');
    expect(realAfter).toContain('[mcp_servers.real-only]');
    expect(realAfter).not.toContain('[mcp_servers.v2-tools]');
    expect(fs.existsSync(isolatedHomeDir)).toBe(false);
  });

  it('does not fail when the isolated config.toml does not exist', () => {
    const proc = new AppServerProcess(1234, '/some/shim.js', '/tmp/ctx.json', {
      homeDir: realHomeDir,
      isolatedHomeDir,
    });
    expect(() => proc.stop()).not.toThrow();
  });

  it('copies only auth/bootstrap files into the isolated Codex home', () => {
    const realCodexDir = codexConfigDirForHome(realHomeDir);
    fs.mkdirSync(realCodexDir, { recursive: true });
    fs.writeFileSync(realConfigPath, [
      'model = "gpt-5.4"',
      '',
      '[mcp_servers.real-only]',
      'command = "keep-me"',
    ].join('\n') + '\n', 'utf-8');
    fs.writeFileSync(path.join(realCodexDir, 'auth.json'), '{"token":"ok"}', 'utf-8');
    fs.writeFileSync(path.join(realCodexDir, 'config.json'), '{"profile":"ok"}', 'utf-8');
    fs.writeFileSync(path.join(realCodexDir, 'installation_id'), 'install-1', 'utf-8');
    fs.writeFileSync(path.join(realCodexDir, 'version.json'), '{"version":"1"}', 'utf-8');
    fs.writeFileSync(path.join(realCodexDir, 'state.json'), '{"persisted":true}', 'utf-8');
    fs.mkdirSync(path.join(realCodexDir, 'plugins'), { recursive: true });
    fs.writeFileSync(path.join(realCodexDir, 'plugins', 'tool.txt'), 'should-not-copy', 'utf-8');

    const proc = new AppServerProcess(1234, '/some/shim.js', '/tmp/ctx.json', {
      homeDir: realHomeDir,
      isolatedHomeDir,
    });

    (proc as any).writeConfig();

    const isolatedConfig = fs.readFileSync(isolatedConfigPath, 'utf-8');
    expect(isolatedConfig).toContain('[mcp_servers.v2-tools]');
    expect(isolatedConfig).not.toContain('[mcp_servers.real-only]');
    expect(fs.readFileSync(path.join(codexConfigDirForHome(isolatedHomeDir), 'auth.json'), 'utf-8')).toContain('"token":"ok"');
    expect(fs.readFileSync(path.join(codexConfigDirForHome(isolatedHomeDir), 'config.json'), 'utf-8')).toContain('"profile":"ok"');
    expect(fs.readFileSync(path.join(codexConfigDirForHome(isolatedHomeDir), 'installation_id'), 'utf-8')).toContain('install-1');
    expect(fs.readFileSync(path.join(codexConfigDirForHome(isolatedHomeDir), 'version.json'), 'utf-8')).toContain('"version":"1"');
    expect(fs.existsSync(path.join(codexConfigDirForHome(isolatedHomeDir), 'state.json'))).toBe(false);
    expect(fs.existsSync(path.join(codexConfigDirForHome(isolatedHomeDir), 'plugins'))).toBe(false);
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
