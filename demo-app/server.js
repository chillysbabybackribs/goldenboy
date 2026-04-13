const http = require('http');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const PORT = 3000;

// Store logs, terminal output, and tasks
let logs = [];
let terminalOutput = [];
let tasks = [];
let openTabs = [{ id: 'tab-1', title: 'New Tab', url: 'about:blank' }];
let activeTabId = 'tab-1';

function addLog(message, type = 'info') {
  logs.push({ message, type, timestamp: new Date().toISOString() });
}

const server = http.createServer((req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // Route handling
  if (req.url === '/' && req.method === 'GET') {
    const indexPath = path.join(__dirname, 'public', 'index.html');
    fs.readFile(indexPath, 'utf8', (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('Page not found');
      } else {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(data);
      }
    });
    return;
  }

  // API: Get logs
  if (req.url === '/api/logs' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ logs }));
    return;
  }

  // API: Add log
  if (req.url === '/api/logs' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', () => {
      const { message, type } = JSON.parse(body);
      logs.push({ message, type: type || 'info', timestamp: new Date().toISOString() });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    });
    return;
  }

  // API: Execute terminal command
  if (req.url === '/api/terminal/exec' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', () => {
      const { command } = JSON.parse(body);
      const addLog = (msg, type = 'info') => {
        logs.push({ message: msg, type, timestamp: new Date().toISOString() });
        terminalOutput.push({ text: msg, type, timestamp: new Date().toISOString() });
      };

      addLog(`$ ${command}`, 'command');
      
      // Execute the command
      const proc = spawn('sh', ['-c', command], { 
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: true 
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
        terminalOutput.push({ text: data.toString(), type: 'stdout' });
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
        terminalOutput.push({ text: data.toString(), type: 'stderr' });
      });

      proc.on('close', (code) => {
        addLog(`Exit code: ${code}`, code === 0 ? 'success' : 'error');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          exitCode: code,
          stdout,
          stderr,
          command
        }));
      });
    });
    return;
  }

  // API: Get terminal output
  if (req.url === '/api/terminal' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ output: terminalOutput }));
    return;
  }

  // API: Get browser tabs
  if (req.url === '/api/browser/tabs' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ tabs: openTabs, activeTabId }));
    return;
  }

  // API: Create new tab
  if (req.url === '/api/browser/tabs' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', () => {
      const tabId = `tab-${Date.now()}`;
      const newTab = { id: tabId, title: 'New Tab', url: 'about:blank' };
      openTabs.push(newTab);
      activeTabId = tabId;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ tab: newTab, activeTabId }));
    });
    return;
  }

  // API: Navigate to URL
  if (req.url.startsWith('/api/browser/navigate') && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', () => {
      const { url } = JSON.parse(body);
      const tab = openTabs.find(t => t.id === activeTabId);
      if (tab) {
        tab.url = url;
        tab.title = new URL(url).hostname || 'Page';
        addLog(`Navigated to ${url}`, 'info');
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, url, activeTabId }));
    });
    return;
  }

  // API: Close tab
  if (req.url.startsWith('/api/browser/tabs/') && req.method === 'DELETE') {
    const tabId = req.url.split('/').pop();
    openTabs = openTabs.filter(t => t.id !== tabId);
    if (activeTabId === tabId && openTabs.length > 0) {
      activeTabId = openTabs[0].id;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, activeTabId }));
    return;
  }

  // API: Get or create tasks
  if (req.url === '/api/tasks' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ tasks }));
    return;
  }

  // API: Create task
  if (req.url === '/api/tasks' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', () => {
      const { title, description } = JSON.parse(body);
      const taskId = `task-${Date.now()}`;
      const task = {
        id: taskId,
        title,
        description,
        status: 'pending',
        createdAt: new Date().toISOString()
      };
      tasks.push(task);
      addLog(`Created task: ${title}`, 'info');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ task }));
    });
    return;
  }

  // Download endpoint with Content-Disposition: attachment
  if (req.url === '/download/test-file.txt' && req.method === 'GET') {
    const fileContent = 'This is a test download file.\nGenerated at ' + new Date().toISOString() + '\nContent is deterministic.';
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': 'attachment; filename="test-file.txt"',
      'Content-Length': Buffer.byteLength(fileContent)
    });
    res.end(fileContent);
    return;
  }

  // Download HTML page with download link
  if (req.url === '/download-test' && req.method === 'GET') {
    const html = `<!DOCTYPE html>
<html>
<head>
  <title>Download Test</title>
  <style>
    body { font-family: sans-serif; margin: 40px; }
    .download-link { display: inline-block; padding: 10px 20px; background: #007bff; color: white; text-decoration: none; border-radius: 4px; margin: 10px 0; }
    .download-link:hover { background: #0056b3; }
  </style>
</head>
<body>
  <h1>Download Test Page</h1>
  <p>Click the link below to download a test file with Content-Disposition: attachment header.</p>
  <a href="/download/test-file.txt" class="download-link" id="download-link">Download test-file.txt</a>
  <p>File will be downloaded with the proper Content-Disposition header set by the server.</p>
</body>
</html>`;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  // Static files
  const filePath = path.join(__dirname, 'public', req.url);
  if (req.url.startsWith('/')) {
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('Not found');
      } else {
        const ext = path.extname(filePath);
        const contentType =
          ext === '.css' ? 'text/css' :
          ext === '.js' ? 'application/javascript' :
          ext === '.json' ? 'application/json' :
          'text/html';
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(data);
      }
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`[demo-app] Server running on http://localhost:${PORT}`);
  console.log(`[demo-app] Command Center with browser + terminal + logs`);
});
