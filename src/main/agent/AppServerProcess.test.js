"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const AppServerProcess_1 = require("./AppServerProcess");
(0, vitest_1.describe)('parseListeningPort', () => {
    (0, vitest_1.it)('parses port from listening line', () => {
        (0, vitest_1.expect)((0, AppServerProcess_1.parseListeningPort)('listening on: ws://127.0.0.1:54321')).toBe(54321);
    });
    (0, vitest_1.it)('returns null for non-matching line', () => {
        (0, vitest_1.expect)((0, AppServerProcess_1.parseListeningPort)('some other output')).toBeNull();
    });
});
(0, vitest_1.describe)('AppServerProcess.stop() clears config', () => {
    const CODEX_CONFIG_PATH = path.join(os.homedir(), '.codex', 'config.toml');
    let originalConfig = null;
    (0, vitest_1.beforeEach)(() => {
        originalConfig = fs.existsSync(CODEX_CONFIG_PATH)
            ? fs.readFileSync(CODEX_CONFIG_PATH, 'utf-8')
            : null;
    });
    (0, vitest_1.afterEach)(() => {
        if (originalConfig !== null) {
            fs.writeFileSync(CODEX_CONFIG_PATH, originalConfig, 'utf-8');
        }
        else if (fs.existsSync(CODEX_CONFIG_PATH)) {
            fs.unlinkSync(CODEX_CONFIG_PATH);
        }
    });
    (0, vitest_1.it)('removes v2-tools section from config.toml on stop()', () => {
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
        const proc = new AppServerProcess_1.AppServerProcess(99999, '/some/shim.js', '/tmp/stale.json');
        proc.stop();
        const after = fs.readFileSync(CODEX_CONFIG_PATH, 'utf-8');
        (0, vitest_1.expect)(after).not.toContain('[mcp_servers.v2-tools]');
        (0, vitest_1.expect)(after).not.toContain('V2_BRIDGE_PORT');
        (0, vitest_1.expect)(after).toContain('model = "gpt-5.4"');
    });
    (0, vitest_1.it)('does not fail when config.toml does not exist', () => {
        if (fs.existsSync(CODEX_CONFIG_PATH))
            fs.unlinkSync(CODEX_CONFIG_PATH);
        const proc = new AppServerProcess_1.AppServerProcess(1234, '/some/shim.js', '/tmp/ctx.json');
        (0, vitest_1.expect)(() => proc.stop()).not.toThrow();
    });
});
(0, vitest_1.describe)('mergeTomlMcpEntry', () => {
    (0, vitest_1.it)('adds v2-tools section to empty toml', () => {
        const result = (0, AppServerProcess_1.mergeTomlMcpEntry)('', '/path/to/shim.js', 3000, '/tmp/ctx.json');
        (0, vitest_1.expect)(result).toContain('[mcp_servers.v2-tools]');
        (0, vitest_1.expect)(result).toContain('command = "node"');
        (0, vitest_1.expect)(result).toContain('/path/to/shim.js');
        (0, vitest_1.expect)(result).toContain('V2_BRIDGE_PORT = "3000"');
        (0, vitest_1.expect)(result).toContain('V2_TOOL_CONTEXT_PATH = "/tmp/ctx.json"');
    });
    (0, vitest_1.it)('replaces existing v2-tools section, preserves other content', () => {
        const existing = '[other_server]\ncommand = "foo"\n\n[mcp_servers.v2-tools]\ncommand = "old"\n';
        const result = (0, AppServerProcess_1.mergeTomlMcpEntry)(existing, '/shim.js', 4000, '/tmp/ctx.json');
        (0, vitest_1.expect)(result).toContain('[other_server]');
        (0, vitest_1.expect)(result).toContain('command = "foo"');
        (0, vitest_1.expect)(result).not.toContain('command = "old"');
        (0, vitest_1.expect)(result).toContain('V2_BRIDGE_PORT = "4000"');
    });
    (0, vitest_1.it)('removes legacy local-agent sections so Codex does not route through Claude-Browser', () => {
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
        const result = (0, AppServerProcess_1.mergeTomlMcpEntry)(existing, '/shim.js', 4000, '/tmp/ctx.json');
        (0, vitest_1.expect)(result).not.toContain('[mcp_servers.local-agent]');
        (0, vitest_1.expect)(result).not.toContain('Claude-Browser');
        (0, vitest_1.expect)(result).toContain('[mcp_servers.v2-tools]');
        (0, vitest_1.expect)(result).toContain('/shim.js');
    });
});
//# sourceMappingURL=AppServerProcess.test.js.map