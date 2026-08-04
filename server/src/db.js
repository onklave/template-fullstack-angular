// PostgreSQL access for the `api` service.
//
// The connection string comes from DATABASE_URL and nowhere else. Onklave
// injects it per environment as a secret (see `env` in onklave.yaml). It is
// never hard-coded, never committed, and never logged — connection strings
// carry the password inline, so logging one leaks the database.

import pg from 'pg';

/**
 * Read DATABASE_URL or fail loudly.
 *
 * Deliberately no in-memory fallback: a store that quietly forgets everything
 * on restart looks healthy while losing data. Refusing to start is the honest
 * failure, and the platform will surface it as a failed rollout.
 */
export function requireDatabaseUrl(env = process.env) {
  const url = env['DATABASE_URL'];
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. This service requires PostgreSQL and will not start without it. ' +
        'Onklave injects it per environment; locally, export it before `npm start`.',
    );
  }
  return url;
}

/**
 * The only shape the HTTP layer knows about. Swapping this for a fake is what
 * lets the route tests run without a live PostgreSQL.
 *
 * @typedef {object} ItemStore
 * @property {() => Promise<Array<{id: string, name: string, createdAt: string}>>} list
 * @property {(name: string) => Promise<{id: string, name: string, createdAt: string}>} create
 */

const toItem = (row) => ({
  // node-postgres returns int8/BIGINT as a STRING, not a number: a bigint can
  // exceed JS's safe integer range, so parsing it would silently lose precision.
  // The id stays a string all the way to the client — see Item in items.service.ts.
  id: String(row.id),
  name: row.name,
  createdAt: new Date(row.created_at).toISOString(),
});

/** @returns {{ pool: import('pg').Pool, store: ItemStore, ensureSchema: () => Promise<void> }} */
export function createPostgresStore(connectionString) {
  const pool = new pg.Pool({
    connectionString,
    max: Number(process.env['PGPOOL_MAX']) || 10,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
  });

  // A pool error (server restart, network blip) is emitted on the pool, not on
  // a query. Without this listener Node treats it as an unhandled 'error' event
  // and kills the process.
  pool.on('error', (err) => console.error('postgres pool error:', err.message));

  return {
    pool,

    // Migrations-lite. The container is replaced on every deploy and has no
    // writable disk, so schema has to be asserted at startup rather than kept
    // in a local migration state file. Swap this for a real migration tool
    // once the schema stops being one table.
    async ensureSchema() {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS items (
          id         BIGSERIAL PRIMARY KEY,
          name       TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
    },

    store: {
      async list() {
        const { rows } = await pool.query(
          'SELECT id, name, created_at FROM items ORDER BY id DESC LIMIT 100',
        );
        return rows.map(toItem);
      },
      async create(name) {
        const { rows } = await pool.query(
          'INSERT INTO items (name) VALUES ($1) RETURNING id, name, created_at',
          [name],
        );
        return toItem(rows[0]);
      },
    },
  };
}
