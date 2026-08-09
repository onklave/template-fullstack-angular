import { createApp } from './app.js';
import { createPostgresStore, requireDatabaseUrl } from './db.js';
import { initOnklave } from './onklave.js';

// Platform wiring first: per-environment secrets (DATABASE_URL included) land
// in process.env and error tracking starts. A no-op off-platform (local dev).
await initOnklave(process.env['APP_NAME'] || 'template-fullstack-angular-api');

const port = Number(process.env['PORT']) || 8080;

// Fail fast and loudly if the database is not configured. Starting anyway and
// degrading to memory would lose every write on the next deploy.
let connectionString;
try {
  connectionString = requireDatabaseUrl();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

const { pool, store, ensureSchema } = createPostgresStore(connectionString);

try {
  await ensureSchema();
} catch (err) {
  // Log the reason, never the connection string.
  console.error('failed to reach PostgreSQL or create the schema:', err.message);
  process.exit(1);
}

const server = createApp({ store }).listen(port, () => {
  console.log(`api: listening on port ${port}, routes mounted under /api`);
});

// Explicit timeouts: without them a client can hold sockets open by dribbling
// out a request (slowloris). Order matters: keepAlive < headers < request.
server.keepAliveTimeout = 10_000;
server.headersTimeout = 20_000;
server.requestTimeout = 30_000;

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    server.close(() => pool.end().then(() => process.exit(0)));
  });
}
