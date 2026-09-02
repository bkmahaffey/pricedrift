import http from 'node:http'; import { promises as fs } from 'node:fs'; import path from 'node:path';
const root = path.resolve('dist'); const base = (JSON.parse(await fs.readFile('config/site.json', 'utf8')).basePath || '');
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.xml': 'application/xml', '.svg': 'image/svg+xml', '.png': 'image/png', '.csv': 'text/csv', '.txt': 'text/plain' };
http.createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (base && p.startsWith(base)) p = p.slice(base.length) || '/';
  if (p.endsWith('/')) p += 'index.html';
  let file = path.join(root, p);
  try { const data = await fs.readFile(file); res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' }); res.end(data); }
  catch { res.writeHead(404, { 'content-type': 'text/html' }); res.end(await fs.readFile(path.join(root, '404.html')).catch(() => 'not found')); }
}).listen(Number(process.env.PORT || 4321), () => console.log(`serving dist at http://localhost:${process.env.PORT || 4321}${base}/`));
