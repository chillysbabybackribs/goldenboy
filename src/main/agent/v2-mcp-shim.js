#!/usr/bin/env node
// v2-mcp-shim.js — stdio↔HTTP bridge for codex app-server MCP integration
// Zero npm dependencies. Spawned by codex app-server as the v2-tools MCP server.
'use strict';
const http = require('http');

const BRIDGE_PORT = Number(process.env.V2_BRIDGE_PORT);
const CONTEXT_PATH = process.env.V2_TOOL_CONTEXT_PATH || '/tmp/v2-tool-context.json';

if (!BRIDGE_PORT) {
  process.stderr.write('v2-mcp-shim: V2_BRIDGE_PORT not set\n');
  process.exit(1);
}

function postBridge(route, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      { hostname: '127.0.0.1', port: BRIDGE_PORT, path: route, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch { reject(new Error('invalid bridge response')); }
        });
      },
    );
    req.on('error', reject);
    req.end(payload);
  });
}

function respond(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
}

function respondError(id, code, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n');
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  const lines = buf.split('\n');
  buf = lines.pop();
  for (const line of lines) {
    if (!line.trim()) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    const { id, method, params } = msg;
    if (method === 'initialize') {
      respond(id, { protocolVersion: '2024-11-05', capabilities: { tools: {} },
        serverInfo: { name: 'v2-tools', version: '1.0.0' } });
    } else if (method === 'notifications/initialized') {
      // no response needed for notifications
    } else if (method === 'tools/list') {
      postBridge('/tools/list', {})
        .then((r) => respond(id, r))
        .catch((e) => respondError(id, -32000, e.message));
    } else if (method === 'tools/call') {
      postBridge('/tools/call', { ...params, contextPath: CONTEXT_PATH })
        .then((r) => respond(id, r))
        .catch((e) => respondError(id, -32000, e.message));
    } else {
      respondError(id, -32601, 'Method not found');
    }
  }
});
process.stdin.on('end', () => process.exit(0));
