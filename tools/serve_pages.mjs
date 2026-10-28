// Static server for the production build (dist/). Serves it under a sub-path, the way GitHub Pages
// serves a project site, or at the root ("/") for sharing through a tunnel.
// Usage: node tools/serve_pages.mjs [subpath|/] [port] [distDir]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const raw = (process.argv[2] ?? 'boltgun').replace(/^\/+|\/+$/g, '');
const sub = raw ? '/' + raw + '/' : '/';
const port = Number(process.argv[3] ?? 4180);
const root = path.resolve(process.argv[4] ?? 'dist');
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8', '.glb': 'model/gltf-binary', '.jpg': 'image/jpeg',
};

http.createServer((req, res) => {
  const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
  if (sub !== '/' && (url === '/' || url === sub.slice(0, -1))) { res.writeHead(302, { Location: sub }); return res.end(); }
  if (!url.startsWith(sub)) { res.writeHead(404); return res.end('not found (site lives under ' + sub + ')'); }
  let file = path.join(root, url.slice(sub.length));
  if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { res.writeHead(404); return res.end('404'); }
  // hashed bundle files never change; index.html must always be fresh so updates show up
  const cache = file.endsWith('index.html') ? 'no-cache' : 'public, max-age=86400';
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': cache });
  fs.createReadStream(file).pipe(res);
}).listen(port, '127.0.0.1', () => console.log(`serving ${root} at http://127.0.0.1:${port}${sub}`));
