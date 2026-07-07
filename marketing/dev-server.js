#!/usr/bin/env node
// marketing/dev-server.js
// Local development server that mimics Vercel: serves public/ statically and mounts each
// api/*.js handler at /api/<name>. Not used in production — Vercel does this natively.
//
// Usage: node dev-server.js   (http://localhost:4100)

require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.DEV_PORT || 4100;
const PUBLIC_DIR = path.join(__dirname, 'public');
const API_DIR = path.join(__dirname, 'api');

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

// Wrap node's req/res with the tiny Vercel-style helpers the handlers use.
function decorate(req, res, body) {
  req.body = body;
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (obj) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(obj)); };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // API routes
  if (url.pathname.startsWith('/api/')) {
    const name = url.pathname.slice(5).replace(/[^a-z0-9_-]/gi, '');
    const file = path.join(API_DIR, `${name}.js`);
    if (!name || name.startsWith('_') || !fs.existsSync(file)) {
      res.statusCode = 404; res.end(JSON.stringify({ error: 'Not found' })); return;
    }
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', async () => {
      let body = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch { /* leave empty */ }
      decorate(req, res, body);
      try {
        await require(file)(req, res);
      } catch (err) {
        console.error(`[dev] ${name} crashed:`, err);
        if (!res.writableEnded) res.status(500).json({ error: err.message });
      }
    });
    return;
  }

  // Static files
  let filePath = path.join(PUBLIC_DIR, url.pathname === '/' ? 'index.html' : url.pathname);
  if (!filePath.startsWith(PUBLIC_DIR)) { res.statusCode = 403; res.end(); return; }
  if (!fs.existsSync(filePath)) { res.statusCode = 404; res.end('Not found'); return; }
  res.setHeader('content-type', MIME[path.extname(filePath)] || 'application/octet-stream');
  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, () => console.log(`DSP Marketing Studio dev server → http://localhost:${PORT}`));
