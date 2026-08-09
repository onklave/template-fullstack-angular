import express from 'express';
import { OnklaveErrors } from '@onklave/errors';

const MAX_NAME_LENGTH = 200;

/**
 * Build the API.
 *
 * EVERY route lives under /api. Onklave routes by path prefix and does NOT
 * strip it, so a request the browser makes to /api/items arrives here as
 * /api/items. Mounting the router at '/' would make every route a 404 in
 * production while working perfectly on localhost — mount it at '/api'.
 *
 * There is no CORS middleware here, on purpose. The client bundle and this API
 * are served from the same host behind the same auth gate, so calls are
 * same-origin. If you find yourself reaching for `cors`, the routing is wrong:
 * check expose.path in onklave.yaml before loosening the origin policy.
 *
 * @param {{ store: import('./db.js').ItemStore }} deps
 */
export function createApp({ store }) {
  const app = express();

  // Do not advertise the framework: it hands attackers a free fingerprint.
  app.disable('x-powered-by');

  const api = express.Router();

  api.use(express.json({ limit: '16kb' }));

  api.get('/healthz', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  api.get('/items', async (_req, res, next) => {
    try {
      res.json(await store.list());
    } catch (err) {
      next(err);
    }
  });

  api.post('/items', async (req, res, next) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (!name || name.length > MAX_NAME_LENGTH) {
      res.status(400).json({ error: `name must be 1-${MAX_NAME_LENGTH} characters` });
      return;
    }
    try {
      res.status(201).json(await store.create(name));
    } catch (err) {
      next(err);
    }
  });

  app.use('/api', api);

  // Anything outside /api is not ours — the platform sends those to the `web`
  // service — so an unprefixed path reaching here is a routing mistake.
  app.use((_req, res) => {
    res.status(404).json({ error: 'Not Found' });
  });

  // Errors are logged server-side only. The response carries no message or
  // stack: a failed query would otherwise echo SQL, and a failed connection
  // would echo the connection string. The capture reports to Onklave error
  // tracking (a no-op when not initialised).
  app.use((err, req, res, _next) => {
    console.error(err);
    OnklaveErrors.captureException(err, {
      request: { method: req.method, path: req.path, statusCode: 500 },
    });
    res.status(500).json({ error: 'Internal Server Error' });
  });

  return app;
}

export default createApp;
