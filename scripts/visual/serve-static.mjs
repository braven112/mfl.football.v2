#!/usr/bin/env node
/**
 * Serve a built Storybook (or any static directory) on localhost.
 *
 *   node scripts/visual/serve-static.mjs [dir=storybook-static] [port=6007]
 *
 * Zero dependencies on purpose: the visual-test workflow only needs to hand
 * Playwright a URL, and a dev dependency for that is one more thing to pin.
 */
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
};

export function serveStatic(dir = 'storybook-static', port = 6007) {
  const root = resolve(dir);
  const server = createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    let file = normalize(join(root, pathname));
    if (!file.startsWith(root)) {
      res.writeHead(403).end();
      return;
    }
    try {
      if (statSync(file).isDirectory()) file = join(file, 'index.html');
      statSync(file);
    } catch {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream' });
    createReadStream(file).pipe(res);
  });
  return new Promise((ok) => server.listen(port, '127.0.0.1', () => ok(server)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [dir, port] = process.argv.slice(2);
  await serveStatic(dir, Number(port ?? 6007));
  console.log(`serving ${dir ?? 'storybook-static'} on http://127.0.0.1:${port ?? 6007}`);
}
