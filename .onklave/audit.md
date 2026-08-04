# Template audit

- **Last audited:** 2026-08-04
- **Audited by:** Onklave platform maintenance (automated, Claude Code)
- **Next review due:** 2026-11-04 (quarterly, or sooner on a dependency alert)

## Why this file exists
So we know when this template was last deliberately checked, and what was true at
the time. Apps are generated from this repo — stale or vulnerable dependencies
here propagate to every app created from it.

## Scope of this audit
This is the **initial audit**, run as the template was created, so it covers
construction as well as currency.

- Clean install, build, test and typecheck of both services.
- Docker build of both images, plus runtime verification against a throwaway
  PostgreSQL 17 container.
- End-to-end verification of the **multi-service contract**: two images, two
  workloads, path-based routing on one host, `/api` prefix not stripped, database
  bound to `api` only.
- Dependency currency and vulnerability status (`npm audit`, `npm outdated`) for
  both services.
- Container security: base image currency, non-root execution, read-only root
  filesystem, `.dockerignore` correctness, image contents.
- Secret hygiene: committed secrets, secrets in logs, secrets reachable from the
  browser bundle.
- Not in scope: no OS-package CVE scan of the built images (see Findings #4);
  no load or soak testing.

## Verification run
Every row below was executed; results are the real observed output.

**Build and test**

| Check | Command | Result |
|---|---|---|
| Client clean install | `npm install` (client) | Pass — 373 packages, 3 moderate (dev-only, Finding #1) |
| Client production build | `npm run build` | Pass — 137.94 kB initial, 41.00 kB transferred, 1.8 s → `dist/browser` |
| Client typecheck | `npm run typecheck` | Pass — clean, `strict: true` + `strictTemplates: true` |
| Client tests | `npm test` (vitest + jsdom) | Pass — 2 files, **5/5**, 582 ms, no browser required |
| API clean install | `npm install` (server) | Pass — 81 packages, **0 vulnerabilities** |
| API tests | `npm test` (node:test) | Pass — **10/10**, 4 suites, 86 ms, no live PostgreSQL |
| API lint | `npm run lint` | Pass — `node --check` clean on all three source files |

**Images**

| Check | Command | Result |
|---|---|---|
| Web image build | `docker build -f client/Dockerfile client` | Pass — 230 MB |
| API image build | `docker build -f server/Dockerfile server` | Pass — 236 MB |
| Web image contents | `docker exec … ls -a /app /app/dist` | Pass — only `serve.js` + `dist/browser`. **No `node_modules`**, no `src`, no `package.json`, no `.git` |
| API image contents | `docker run --rm … ls /app` | Pass — only `node_modules`, `package.json`, `src`. No `test/`, no `.git`, no Angular code |
| Non-root (both) | `docker exec … id` | Pass — `uid=1000(node) gid=1000(node)` on both |
| Node version (both) | `docker exec … node -v` | Pass — v24.19.0 (Active LTS) |
| Read-only rootfs | `docker run --read-only …` | Pass — both serve normally; `web` `/health` 200, `api` `/api/healthz` 200, `/api/items` 200 |

**The multi-service contract** — an nginx container was used to stand in for the
platform ingress: one host, `location /api` → api:8080 and `location /` →
web:3000, with no trailing slash on `proxy_pass` so the prefix is *not* stripped
(the platform's behaviour).

| Check | Command | Result |
|---|---|---|
| Postgres round-trip | `docker run postgres:17-alpine` + `POST/GET /api/items` | Pass — row written and read back; `psql \d items` confirms the startup `CREATE TABLE IF NOT EXISTS` ran |
| API health | `curl :8099/api/healthz` | Pass — 200 `{"status":"ok"}` |
| Prefix not stripped | `curl :8099/healthz` (unprefixed) | Pass — **404**, as required; asserted in `server/test/app.test.js` too |
| Web health | `curl :3099/health` | Pass — 200 `{"status":"ok"}` |
| One host, both services | `curl :8090/` and `curl :8090/api/items` | Pass — `/` 200 `text/html`, `/api/items` 200 JSON, **same origin** |
| Same-origin write | `POST :8090/api/items` through the shared host | Pass — 201, row persisted to PostgreSQL |
| CORS headers | `curl -D - :8090/api/items \| grep -i access-control` | Pass — **none**. No CORS config exists in the repo and none is needed |
| Framework fingerprint | same response headers | Pass — no `X-Powered-By` |
| Fail-fast without config | `docker run` api with no `DATABASE_URL` | Pass — exits **1** with `DATABASE_URL is not set…`; no in-memory fallback |
| Secret not logged | `docker logs tfa-api \| grep -c <password>` | Pass — **0** occurrences; the only log line is the listen message |
| Error hygiene | broken-store test + live 500 | Pass — body is `{"error":"Internal Server Error"}`; SQL, host and password absent (asserted in tests) |
| State survives replacement | destroy + recreate the api container | Pass — both rows still returned; nothing was held on local disk |
| Path traversal (web) | `/../../etc/passwd`, `%2e%2e%2f…`, `/../serve.js` | Pass — all three return `index.html` (SPA fallback); no file outside `dist/browser` is reachable |
| Cache headers | `curl -D -` on hashed asset vs `/` | Pass — `immutable, max-age=31536000` on the fingerprinted bundle, `no-cache` on `index.html`, `X-Content-Type-Options: nosniff` on both |
| Secret scan | `git grep -E '(api_key\|secret\|password\|token\|PRIVATE KEY)'` over tracked files | Pass — only the placeholder in `.env.example` and prose in comments; no real credential |
| Image OS CVE scan | `docker scout cves …` | **Not run** — requires a Docker Hub login unavailable in this environment (Finding #4) |

## Dependency status

**`server` (api)** — 0 vulnerabilities, nothing outdated.

| Package | Version | Notes |
|---|---|---|
| express | ^5.2.1 | current major |
| pg | ^8.22.0 | current |

**`client` (web)** — 3 moderate advisories, all in a **devDependency-only** chain
(see Finding #1). Runtime image contains no `node_modules` at all.

| Package | Version | Notes |
|---|---|---|
| @angular/* | ^22.1.0 | current major |
| @angular/build, @angular/cli | ^22.1.2 | current |
| rxjs | ~7.8.0 | current |
| vitest | ^4.0.8 | current |
| jsdom | ^28.0.0 | 30.0.1 available — see below |
| typescript | ~6.0.2 | 7.0.2 available — see below |

**Deliberately not upgraded:**
- `jsdom` 28 → 30 and `typescript` 6 → 7. Both are pinned by what Angular 22.1
  scaffolds and supports; TypeScript in particular must stay inside the range
  `@angular/compiler-cli` accepts. Moving either ahead of Angular's own support
  matrix would be a self-inflicted break. They should move when Angular does.
- Base images are floating tags (`node:24-alpine`) rather than digest pins — see
  Finding #5.

## Findings

1. **(moderate, not fixed — deliberate) Three advisories in the Angular CLI's
   dev-time dependency chain.** `@angular/cli` → `@modelcontextprotocol/sdk` →
   `@hono/node-server` `<2.0.5`, a path-traversal in `serve-static` on Windows via
   an encoded backslash (GHSA-frvp-7c67-39w9). `npm audit fix --force` resolves it
   only by *downgrading* to `@angular/cli@21`, which is a breaking change and a
   worse outcome. Assessed as not exploitable here: the package is a
   `devDependency`, it is never installed in the runtime stage, and the `web`
   image ships **zero** `node_modules` (verified by listing `/app` in the running
   container). **Recommended:** clear it by upgrading `@angular/cli` when Angular
   ships an SDK bump; re-check at the next quarterly audit.

2. **(low, fixed during construction) Item ids were typed as `number` and are
   actually strings.** The column is `BIGSERIAL`; node-postgres returns `int8` as
   a *string* so it cannot lose precision above 2^53. The first live round-trip
   returned `{"id":"1",…}` against a TypeScript interface declaring
   `id: number` — a type that lies compiles fine and misleads every app generated
   from the template. **Action taken:** `Item.id` is `string` end to end,
   `toItem` coerces with `String(row.id)`, both test suites assert it, and the
   README calls it out.

3. **(low, fixed during construction) SPA fallback masks missing assets.** Any
   unknown path under `web` returns `index.html` with a 200, which is correct for
   client-side routes but means a typo'd asset URL yields HTML rather than a 404.
   This is also what contains the traversal attempts (all three probes returned
   `index.html`, never file content). **Action taken:** accepted as the right
   default for a single-page app and documented; the traversal guard in
   `resolveInRoot` is independent of it and refuses anything resolving outside
   `dist/browser`.

4. **(low, not fixed) No OS-package vulnerability scan of the built images.**
   `docker scout` requires a Docker Hub login not available in this environment,
   so the Alpine base layers were not scanned. Node-level dependencies are clean
   for `api` and dev-only for `web`. **Recommended:** wire an authenticated image
   scan (Docker Scout, Trivy or Grype) into whatever pipeline builds template
   images.

5. **(low, not fixed — deliberate) Base images are floating tags, not digest
   pinned.** `node:24-alpine` picks up patched bases automatically, which is right
   for a template, but builds are not byte-reproducible. **Recommended:** pin by
   digest only if a generated app needs reproducible builds for compliance.

6. **(low, not fixed — deliberate) `npm ci` runs dependency lifecycle scripts at
   build time.** Neither Dockerfile passes `--ignore-scripts`. Adding it is safe
   for this template's own dependencies but would break any generated app that
   adds a package needing a native build step. **Recommended:** treat as a per-app
   decision; revisit if Onklave gains a build-time supply-chain policy.

7. **(informational) The API has no authentication of its own.** It relies
   entirely on the Onklave gate in front of the shared host — which is the point
   of the same-origin design, and correct as long as both services stay behind
   one gate. An app that later exposes `api` on its own host, or sets
   `expose.auth` differently on the two services, breaks that assumption and must
   add its own authorization. Called out here because it is the failure mode this
   architecture makes easiest to walk into.

**Verified clean (no action needed):**
- **No secrets committed.** No `.env` is tracked; `.env.example` carries an
  obvious placeholder. `DATABASE_URL` is *declared* in `onklave.yaml` and its
  value never appears in the repo.
- **No secret reaches the browser.** The `web` service declares no `env` at all,
  and the client bundle contains no credential — the only API knowledge it has is
  the relative path `/api`.
- **`DATABASE_URL` is never logged.** Verified against live container logs; the
  error path logs `err.message` only, never the connection string.
- **Both containers run non-root on a read-only root filesystem.** Verified at
  runtime, not assumed.
- **`.dockerignore` is correct on both services.** Verified by listing the image
  contents: no `.git`, no `test/`, no `Dockerfile`, no `.env*`, no host
  `node_modules`.
- **No CORS anywhere.** Verified by response inspection through a single shared
  host. There is no `cors` package in either `package.json`.
- **HTTP timeouts set on both services.** `keepAliveTimeout` 10 s,
  `headersTimeout` 20 s, `requestTimeout` 30 s.
- **No `.github/` directory.** Deployment is driven solely by `onklave.yaml`.

## Changes made in this audit
This template was created in this pass, so everything is new. Changes made *in
response to verification*:

- `Item.id` corrected from `number` to `string` across `client/src/app/items.service.ts`,
  `server/src/db.js` and both test suites, after a live round-trip showed
  node-postgres returning `int8` as a string (Finding #2).
- `client/.dockerignore`: stopped excluding `proxy.conf.json`, since `angular.json`
  references it and excluding it risked a schema-resolution failure inside the
  build stage.
- Everything else was verified as written: no fixes were needed to the routing,
  the `/api` prefixing, the fail-fast path or the container hardening.

## Open items
1. **Re-check the `@angular/cli` advisory chain** (Finding #1) at the next audit;
   it should clear on an upstream SDK bump without a downgrade.
2. **Add an authenticated image CVE scan** to the template pipeline (Finding #4) —
   this audit could only clear npm-level dependencies, not the Alpine base layer.
3. **Decide whether the platform should validate `healthPath` against
   `expose.path`.** Nothing today stops a service declaring `expose.path: /api`
   with `healthPath: /healthz`; the probe would 404 and the rollout would fail
   with no hint that the prefix was the cause. A schema-level check would catch
   the single most likely multi-service mistake before deploy.
4. **Decide whether `resources` should be set here.** The schema allows
   `resources{cpu,memory}` and this template omits it, so both services take
   platform defaults. Fine for a template; a human should confirm the defaults
   suit an Angular static server (tiny) and a pg-pooled API (small) equally.
5. **Consider a shared root-level `npm` entry point.** Today each service is
   installed and tested from its own directory. If the platform ever runs a single
   repo-wide test command, this template needs a root `package.json` with
   workspaces — deliberately not added, since it would imply a shared lockfile the
   two independent build contexts do not want.
