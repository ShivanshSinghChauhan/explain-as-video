// Tiny static server for E2E fixture pages (http://localhost:4610).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('./fixtures/', import.meta.url));
createServer(async (req, res) => {
  const name = (new URL(req.url, 'http://x').pathname.slice(1) || 'article.html').replace(/[^a-z0-9.-]/gi, '');
  try {
    const body = await readFile(dir + name);
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(4610, () => console.log('fixtures on http://localhost:4610'));
