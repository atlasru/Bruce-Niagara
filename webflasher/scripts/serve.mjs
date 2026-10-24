import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
const root = resolve('dist');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.bin': 'application/octet-stream', '.txt': 'text/plain' };
createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const path = resolve(root, `.${pathname.endsWith('/') ? pathname + 'index.html' : pathname}`);
    if (!path.startsWith(root + sep)) throw new Error('Path');
    const bytes = await readFile(path);
    response.writeHead(200, { 'Content-Type': mime[extname(path)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
    response.end(bytes);
  } catch { response.writeHead(404); response.end('Not found'); }
}).listen(4173, '127.0.0.1', () => console.log('Preview http://127.0.0.1:4173/'));
