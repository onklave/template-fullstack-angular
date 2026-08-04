import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../src/app.js';
import { requireDatabaseUrl } from '../src/db.js';

/**
 * In-memory stand-in for the PostgreSQL store. The route tests assert HTTP
 * behaviour, so they must not need a live database to run.
 */
function fakeStore(initial = []) {
  let nextId = initial.length + 1;
  const rows = [...initial];
  return {
    rows,
    async list() {
      return [...rows].reverse();
    },
    async create(name) {
      const item = { id: String(nextId++), name, createdAt: new Date(0).toISOString() };
      rows.push(item);
      return item;
    },
  };
}

/** A store whose every call fails, for the error-path test. */
const brokenStore = {
  async list() {
    throw new Error('connection to server at "10.0.0.5" failed: password authentication failed');
  },
  async create() {
    throw new Error('nope');
  },
};

function request(app, { method = 'GET', path = '/', body } = {}) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, () => {
      const { port } = server.address();
      const payload = body === undefined ? null : JSON.stringify(body);
      const req = http.request(
        {
          host: '127.0.0.1',
          port,
          method,
          path,
          headers: payload ? { 'Content-Type': 'application/json' } : {},
        },
        (res) => {
          let text = '';
          res.on('data', (chunk) => (text += chunk));
          res.on('end', () => {
            server.close();
            resolve({ status: res.statusCode, text, json: text ? JSON.parse(text) : null });
          });
        },
      );
      req.on('error', (err) => {
        server.close();
        reject(err);
      });
      if (payload) req.write(payload);
      req.end();
    });
  });
}

describe('every route is mounted under /api', () => {
  test('GET /api/healthz returns 200 { status: "ok" }', async () => {
    const res = await request(createApp({ store: fakeStore() }), { path: '/api/healthz' });
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { status: 'ok' });
  });

  // The contract this template exists to prove: Onklave does NOT strip the
  // route prefix, so an unprefixed route would 404 in production. These two
  // assertions fail loudly if someone re-mounts the router at '/'.
  test('GET /healthz (unprefixed) is a 404, not the health endpoint', async () => {
    const res = await request(createApp({ store: fakeStore() }), { path: '/healthz' });
    assert.equal(res.status, 404);
    assert.deepEqual(res.json, { error: 'Not Found' });
  });

  test('GET /items (unprefixed) is a 404', async () => {
    const res = await request(createApp({ store: fakeStore() }), { path: '/items' });
    assert.equal(res.status, 404);
  });
});

describe('GET /api/items', () => {
  test('returns the stored items as JSON, newest first', async () => {
    const store = fakeStore([
      { id: '1', name: 'first', createdAt: '1970-01-01T00:00:00.000Z' },
      { id: '2', name: 'second', createdAt: '1970-01-01T00:00:00.000Z' },
    ]);
    const res = await request(createApp({ store }), { path: '/api/items' });
    assert.equal(res.status, 200);
    assert.deepEqual(
      res.json.map((i) => i.name),
      ['second', 'first'],
    );
  });

  test('a store failure yields a 500 that leaks neither SQL nor the connection string', async () => {
    const res = await request(createApp({ store: brokenStore }), { path: '/api/items' });
    assert.equal(res.status, 500);
    assert.deepEqual(res.json, { error: 'Internal Server Error' });
    assert.ok(!res.text.includes('password'));
    assert.ok(!res.text.includes('10.0.0.5'));
  });
});

describe('POST /api/items', () => {
  test('creates an item and returns 201 with the persisted row', async () => {
    const store = fakeStore();
    const res = await request(createApp({ store }), {
      method: 'POST',
      path: '/api/items',
      body: { name: '  a thing  ' },
    });
    assert.equal(res.status, 201);
    assert.equal(res.json.name, 'a thing');
    // Ids are strings on the wire: the column is BIGINT and node-postgres
    // returns int8 as a string rather than lose precision.
    assert.equal(typeof res.json.id, 'string');
    assert.equal(store.rows.length, 1);
  });

  test('rejects an empty name with 400 and stores nothing', async () => {
    const store = fakeStore();
    const res = await request(createApp({ store }), {
      method: 'POST',
      path: '/api/items',
      body: { name: '   ' },
    });
    assert.equal(res.status, 400);
    assert.equal(store.rows.length, 0);
  });

  test('rejects an over-long name with 400', async () => {
    const store = fakeStore();
    const res = await request(createApp({ store }), {
      method: 'POST',
      path: '/api/items',
      body: { name: 'x'.repeat(201) },
    });
    assert.equal(res.status, 400);
    assert.equal(store.rows.length, 0);
  });
});

describe('requireDatabaseUrl', () => {
  test('returns the value when set', () => {
    assert.equal(
      requireDatabaseUrl({ DATABASE_URL: 'postgres://u:p@h/db' }),
      'postgres://u:p@h/db',
    );
  });

  test('throws rather than falling back to in-memory storage when absent', () => {
    assert.throws(() => requireDatabaseUrl({}), /DATABASE_URL is not set/);
  });
});
