// Serves the repo for working on the panel in an ordinary browser, with a fake
// CEP and After Effects (tests/ui/fakeCep.js) injected into client/index.html.
//   node scripts/serve.mjs [port]   then open http://localhost:8090/client/index.html
// CEP 12 runs Chromium 99, so keep to what Chrome 99 supports.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.argv[2] || 8090);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

http.createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const file = path.join(repo, url);
  if (!file.startsWith(repo) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end('Not found');
    return;
  }
  let body = fs.readFileSync(file);
  if (url === '/client/index.html') {
    body = body.toString().replace('<script src="lib/cep.js"></script>', '<script src="/tests/ui/fakeCep.js"></script>\n  <script src="lib/cep.js"></script>');
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(body);
}).listen(port, () => console.log(`Panel with a fake After Effects: http://localhost:${port}/client/index.html`));
