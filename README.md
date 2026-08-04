# template-fullstack-angular

An Onklave project template for a **two-service** app: an Angular client and an
Express + PostgreSQL API, deployed as two separate workloads behind one host.

```
                      https://<your-app>.onklave.app
                                   │
                   ┌───────────────┴───────────────┐
              path /                          path /api
                   │                               │
        ┌──────────▼──────────┐        ┌───────────▼──────────┐
        │  web                │        │  api                 │
        │  Angular → static   │        │  Express + pg        │
        │  port 3000          │        │  port 8080           │
        │  /health            │        │  /api/healthz        │
        └─────────────────────┘        └───────────┬──────────┘
             image: client/                        │ DATABASE_URL
                                        ┌──────────▼──────────┐
                                        │  PostgreSQL         │
                                        └─────────────────────┘
                                             image: server/
```

## The shape, and why it matters

**Two services, two images, one host.** `client/` and `server/` are built
independently — separate build contexts, separate Dockerfiles, separate
rollouts. They are joined only at request time, by `expose.path` in
[`onklave.yaml`](./onklave.yaml). That file is the entire deployment contract.

**Calls to the API are same-origin.** Because both services answer on the same
host, the Angular bundle fetches `/api/items` as a relative URL. The browser
sends the session it already has. Consequences worth internalising:

- **No CORS configuration anywhere.** Not in the API, not in the client. There
  is no `cors` package in `server/package.json`. If you ever feel the need for
  one, the routing is wrong — check `expose.path` before loosening origin policy.
- **No API key in the client.** Nothing secret can live in a browser bundle,
  because a browser bundle is public. The `web` service deliberately declares no
  `env` at all.
- **One auth gate.** Both services sit behind the same Onklave gate, so the
  page load and the API call are authenticated by the same session.

**The route prefix is not stripped.** A request to `/api/items` arrives at the
`api` container as `/api/items`, not `/items`. So *every* route in the API is
mounted under `/api` — including its health check, `/api/healthz`. This is the
single easiest thing to get wrong: an API mounted at `/` works perfectly on
localhost and 404s on everything in production. `server/test/app.test.js`
asserts that unprefixed paths are 404s, so the mistake fails a test rather than
a deploy.

**`DATABASE_URL` belongs to `api` alone.** It is declared in `onklave.yaml` as
`required: true, secret: true`; its *value* is injected per environment by the
platform and never appears in this repo. The API reads it from the environment,
never logs it (a connection string carries the password inline), and **exits
non-zero with a clear message if it is missing** rather than falling back to
in-memory storage — a store that silently forgets on restart looks healthy while
losing data.

**Nothing is written to local disk.** Containers are replaced on every deploy,
so all state lives in PostgreSQL. Both images run non-root on a read-only root
filesystem. The API asserts its schema at startup with `CREATE TABLE IF NOT
EXISTS`; swap that for a real migration tool once the schema is more than one
table.

**There is no `.github/` directory, on purpose.** Onklave builds, tests and
deploys in-cluster from `onklave.yaml`. A workflow file here would be inert, and
the platform's credential cannot push one.

## Layout

```
onklave.yaml            the deployment contract — the only file the platform reads
client/                 the `web` service
  Dockerfile            build context is client/
  serve.js              dependency-free static server: /health + SPA fallback
  proxy.conf.json       DEV ONLY (see below)
  src/app/
    app.ts|.html|.css   the page
    items.service.ts    HttpClient calls to the relative path /api
    *.spec.ts           vitest + jsdom
server/                 the `api` service
  Dockerfile            build context is server/
  src/app.js            Express routes, all mounted under /api
  src/db.js             DATABASE_URL + the pg pool + the ItemStore seam
  src/server.js         startup, fail-fast, timeouts, graceful shutdown
  test/app.test.js      node:test, no live PostgreSQL required
```

## Local development

```bash
# 1. A database.
docker run -d --name dev-pg -p 5432:5432 \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=app postgres:17-alpine

# 2. The API on :8080.
cd server && npm install
DATABASE_URL=postgres://postgres:postgres@localhost:5432/app npm start

# 3. The client on :4200, in another shell.
cd client && npm install && npm start
```

`ng serve` reads [`client/proxy.conf.json`](./client/proxy.conf.json), which
forwards `/api` to `localhost:8080`. **That file is dev-only.** It exists purely
because `ng serve` runs on a different port from the API; production needs
nothing equivalent, since the platform already routes both paths to one host.
Note that the proxy has no `pathRewrite` — the platform does not strip the
prefix either, so dev and production agree on the URLs.

To run the production static server locally instead of `ng serve`:

```bash
cd client && npm run build && npm run serve   # :3000, serving dist/browser
```

## Tests

```bash
cd server && npm test    # node:test — routes, /api prefixing, validation, error hygiene
cd client && npm test    # vitest + jsdom — service URL shape, component render, error path
```

The client uses **vitest with jsdom**, which is Angular 22's CLI default
(`@angular/build:unit-test`). It replaces the old Karma + real-Chrome setup, so
the suite runs headless in a couple of seconds and needs no browser installed —
which matters because Onklave runs these in-cluster with no display.

The API tests use a fake `ItemStore` and never open a database connection. The
seam is `createApp({ store })` in `server/src/app.js`: the HTTP layer only knows
`list()` and `create()`, so route behaviour is testable without PostgreSQL.

## Adding a third service

1. Create its directory with its own `Dockerfile` and `.dockerignore`.
2. Append an entry to `services` in `onklave.yaml`:

```yaml
  - name: worker
    build:
      context: worker
      dockerfile: worker/Dockerfile
    runtime:
      port: 8081
      healthPath: /healthz
    expose:
      enabled: false        # no ingress; not reachable from the internet
    env:
      - name: DATABASE_URL
        required: true
        secret: true
```

Rules that bite:

- **Exactly one service may claim `path: /`.** Everything else needs a distinct
  prefix, and must serve its routes *under* that prefix.
- **A service with `expose.enabled: false` gets no route at all.** Use it for
  workers and consumers.
- **Declare `env` only on the services that need it.** Anything declared on a
  browser-facing service ends up public.

The only valid fields are `services[].{name, build{context,dockerfile},
runtime{port,healthPath,command}, resources{cpu,memory},
expose{enabled,auth,path}, env[]{name,required,secret}}`.

## Notes for whoever grows this

- Item ids are **strings**, not numbers. The column is `BIGINT` and
  node-postgres returns `int8` as a string so it cannot lose precision above
  2^53. Keep them strings end to end.
- `client/serve.js` has no dependencies, and the runtime image contains no
  `node_modules` at all — none of the Angular toolchain reaches production.
- The API returns `{"error": "Internal Server Error"}` on failure and logs the
  detail server-side only. Do not echo `err.message` to the client: a failed
  query would leak SQL and a failed connection would leak the connection string.
- `@angular/router` is not installed; this is a single page. Add it when you
  need routing (`serve.js` already falls back to `index.html` for unknown paths).
