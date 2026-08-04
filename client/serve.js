// Static file server for the built Angular bundle — the `web` service.
//
// Deliberately dependency-free: the runtime image ships this file plus dist/
// and NO node_modules, so nothing in the Angular toolchain reaches production.
// It only ever reads from disk; nothing is written, which is what lets the
// container run non-root on a read-only root filesystem.
//
// It knows nothing about the API. Requests to /api never arrive here — the
// platform routes them to the `api` service by path.

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PORT) || 3000;
const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  process.env.STATIC_ROOT || 'dist/browser',
);

const CONTENT_TYPES = new Map(
  Object.entries({
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.webp': 'image/webp',
    '.avif': 'image/avif',
    '.woff2': 'font/woff2',
    '.map': 'application/json; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
  }),
);

/** Resolve a URL path to a file inside ROOT, or null if it escapes ROOT. */
function resolveInRoot(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const candidate = path.resolve(ROOT, '.' + path.posix.normalize(decoded));
  // path.resolve collapses `..`; anything landing outside ROOT is refused.
  return candidate === ROOT || candidate.startsWith(ROOT + path.sep) ? candidate : null;
}

async function sendFile(res, filePath, { immutable }) {
  const stat = await fsp.stat(filePath);
  res.writeHead(200, {
    'Content-Type': CONTENT_TYPES.get(path.extname(filePath)) || 'application/octet-stream',
    'Content-Length': stat.size,
    // Angular fingerprints asset filenames in a production build, so those are
    // safe to cache forever. index.html is the mutable entry point and must not be.
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  });
  fs.createReadStream(filePath).pipe(res);
}

export const handler = async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }

  const url = req.url || '/';

  // Liveness/readiness probe. Onklave polls this (see onklave.yaml healthPath).
  if (url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  const filePath = resolveInRoot(url);
  if (!filePath) {
    res.writeHead(400).end();
    return;
  }

  try {
    const stat = await fsp.stat(filePath);
    if (stat.isFile()) {
      await sendFile(res, filePath, { immutable: url !== '/' && url !== '/index.html' });
      return;
    }
  } catch {
    // Fall through to the SPA entry point below.
  }

  // Single-page app: unknown paths are client-side routes, not 404s.
  try {
    await sendFile(res, path.join(ROOT, 'index.html'), { immutable: false });
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
  }
};

const server = http.createServer((req, res) => {
  handler(req, res).catch((err) => {
    console.error(err);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  });
});

// Explicit timeouts: without them a client can hold sockets open by dribbling
// out a request (slowloris). Order matters: keepAlive < headers < request.
server.keepAliveTimeout = 10_000;
server.headersTimeout = 20_000;
server.requestTimeout = 30_000;

server.listen(PORT, () => {
  console.log(`web: serving ${ROOT} on port ${PORT}`);
});
