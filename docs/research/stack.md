# Stack research (as of 2026-10-09)

Scope: platform and library facts Handshake needs before coding starts. Sources are primary (vendor docs, npm registry, GitHub). Items marked **UNVERIFIED** could not be confirmed in a primary source.

---

## Summary: facts we'll rely on

1. **Next.js 16.4.0** is current stable (released 2026-10-06). Requires Node >= 20.9 and TS >= 5.1. `middleware.ts` is renamed to `proxy.ts`. `next lint` was removed. Turbopack is the default bundler. ([npm](https://www.npmjs.com/package/next), [v16 upgrade guide](https://nextjs.org/docs/app/guides/upgrading/version-16))
2. **Prisma trap:** `npm i prisma` installs **8.0.0-rc.22**, because the `latest` dist-tag points at a Prisma 8 RC. Prisma 8 is a ground-up rewrite with a new CLI. `@prisma/client@latest` is **7.10.0**, so unpinned installs give you mismatched majors. Prisma's docs say to install v7 as `prisma@prev` + `@prisma/client@7`. **We pin 7.10.0 everywhere.** (`npm view prisma dist-tags`, [Prisma llms.txt](https://www.prisma.io/docs/llms.txt), [v7 quickstart](https://www.prisma.io/docs/v7/prisma-orm/quickstart/postgresql))
3. Prisma 7 changes we must follow: the `prisma-client` generator has a **required `output`**; you pass a **driver adapter** (`@prisma/adapter-pg`) to `new PrismaClient({ adapter })`; config lives in a TS config file (7.10 generates `prisma7.config.ts`); `.env` is not auto-loaded; `migrate dev` no longer runs `generate` or seed. ([generators](https://www.prisma.io/docs/orm/v7/prisma-schema/overview/generators), [quickstart](https://www.prisma.io/docs/v7/prisma-orm/quickstart/postgresql), [CLI ref](https://www.prisma.io/docs/orm/v7/reference/prisma-cli-reference))
4. Prisma `Bytes` maps to Postgres `bytea` and comes back as **`Uint8Array`** (it was `Buffer` before v6). ([schema ref](https://www.prisma.io/docs/orm/v7/reference/prisma-schema-reference), [fields & types](https://www.prisma.io/docs/orm/v7/prisma-client/special-fields-and-types))
5. **Next.js documents no body-size limit for Route Handlers.** The 1 MB default applies only to Server Actions (`serverActions.bodySizeLimit`). If a `proxy.ts` matches a route, Next buffers the body up to **10 MB** (`proxyClientMaxBodySize`) and **silently truncates** anything beyond that. ([serverActions](https://nextjs.org/docs/app/api-reference/config/next-config-js/serverActions), [proxyClientMaxBodySize](https://nextjs.org/docs/app/api-reference/config/next-config-js/proxyClientMaxBodySize))
6. Webhook raw body: call `await request.text()` in the Route Handler. That is the documented pattern. ([route.js > Webhooks](https://nextjs.org/docs/app/api-reference/file-conventions/route))
7. `runtime` already defaults to `'nodejs'` (edge is deprecated). Under `next start`, `maxDuration` is "set by deployment platform", so it does nothing on Render. ([route segment config](https://nextjs.org/docs/app/api-reference/file-conventions/route-segment-config), [maxDuration](https://nextjs.org/docs/app/api-reference/file-conventions/route-segment-config/maxDuration))
8. **Render renamed its plans.** Web `starter` is now `0.5c-512mb` (**$7/mo**). Postgres `basic-256mb` is now `0.1c-256mb` (**$6/mo**). Cron `0.5c-512mb` costs $0.00016/min, with a **$1/mo minimum per cron service**. The Hobby workspace is $0. ([pricing](https://render.com/pricing), [compute plans](https://render.com/docs/compute-plans), [cron](https://render.com/docs/cronjobs))
9. If you omit `diskSizeGB` on a paid Basic-tier Render Postgres, it defaults to **15 GB** ($0.30/GB/mo). Set it explicitly to `1` or a multiple of 5. ([blueprint spec](https://render.com/docs/blueprint-spec), [pricing](https://render.com/pricing))
10. Free Render web services **spin down after 15 min idle**, and spin-up takes "about one minute". Paid plans do not spin down. **Free Postgres expires 30 days after creation**, has a 14-day grace period, is then deleted, and has no backups. Do not use free tiers for the judged demo. ([free](https://render.com/docs/free))
11. `preDeployCommand` (where `prisma migrate deploy` goes) is available on **paid** web services only. It runs on a separate instance after build and before start, with a 30 min timeout. ([deploys](https://render.com/docs/deploys))
12. Render's default Node is **24.21.0** for services created on or after 2026-09-17. Precedence for overriding it: `NODE_VERSION` env, then `.node-version`, then `.nvmrc`, then `engines` (always give `engines` an upper bound). ([node-version](https://render.com/docs/node-version)) Node 24 is LTS until 2028-04-30. Node 26 becomes LTS on 2026-10-28. ([nodejs/Release schedule](https://github.com/nodejs/Release/blob/main/schedule.json))
13. Render's `fromDatabase.property: connectionString` gives the **internal (private network) URL**. ([blueprint spec](https://render.com/docs/blueprint-spec)) Render sets `NODE_ENV=production` at **runtime only**, so devDependencies are installed at build. ([llms-full: Node env vars](https://render.com/llms-full.txt)) Native runtimes include `curl`. ([llms-full: native runtimes](https://render.com/llms-full.txt))
14. **Render's docs do not state an HTTP request timeout for web services.** A 20-30 s request is very likely fine (community reports say 100 min), but this is **UNVERIFIED**.
15. **Resend free tier:** 100 emails/day and 3,000/month. The `onboarding@resend.dev` sender can only send to **your own account email** (403 `validation_error` otherwise). Sending to judges' arbitrary addresses needs a verified domain. ([quotas](https://resend.com/docs/knowledge-base/account-quotas-and-limits), [errors](https://resend.com/docs/api-reference/errors))
16. Auth.js is now part of Better Auth. `next-auth` v5 is **still beta** (5.0.0-beta.32), and its email provider needs a DB adapter. We use **jose** instead, which is what the Next.js auth guide uses. ([authjs email](https://authjs.dev/getting-started/authentication/email), `npm view next-auth dist-tags`, [Next auth guide](https://nextjs.org/docs/app/guides/authentication))
17. TypeScript `latest` is **7.0.2** (native port). Next 16.4 supports it through the `tsc` CLI, but **typescript-eslint requires `<6.1.0`** and create-next-app still scaffolds `typescript@^5`. **Pin 5.9.3.** ([Next TS docs](https://nextjs.org/docs/app/api-reference/config/typescript), `npm view typescript-eslint peerDependencies`)
18. Vite 8 has native `resolve.tsconfigPaths: true`, so Vitest 5 doesn't need the `vite-tsconfig-paths` plugin (the Next guide still shows the plugin). ([vite shared options](https://vite.dev/config/shared-options), [Next vitest guide](https://nextjs.org/docs/app/guides/testing/vitest))

---

## Pinned versions

All versions come from `npm view <pkg> version` / dist-tags on 2026-10-09, unless noted.

| Package | Pin | Notes / source |
|---|---|---|
| node | **24.21.0** (`.node-version`) | Render default; LTS "Krypton" until 2028-04-30 ([render](https://render.com/docs/node-version), [schedule](https://github.com/nodejs/Release/blob/main/schedule.json)). Local Node 26.8.2 also satisfies every engines range below. |
| next | **16.4.0** | engines `node >=20.9.0` |
| react / react-dom | **19.3.0** | next peer `^18.2 \|\| ^19` |
| @types/react / @types/react-dom | 19.3.0 / 19.3.0 | |
| typescript | **5.9.3** | Not 7.0.2: typescript-eslint peer is `<6.1.0`; create-next-app uses `^5` |
| @types/node | `^24` | match runtime major (latest is 26.6.4) |
| prisma (CLI, dev) | **7.10.0** (exact; `prisma@prev`) | **Do not** `npm i prisma` unpinned: you'd get 8.0.0-rc.22 |
| @prisma/client | **7.10.0** | engines `^20.19 \|\| ^22.12 \|\| >=24.0`, peer `typescript >=5.4` |
| @prisma/adapter-pg | **7.10.0** | depends on `pg ^8.16.3` |
| pg / @types/pg | 8.23.1 / 8.23.1 | |
| dotenv (dev) | 18.0.6 | only for the prisma config file. Next loads `.env` itself. |
| zod | **4.6.5** | |
| jose | **6.2.12** | zero deps ([README](https://github.com/panva/jose)) |
| iron-session | 9.0.1 | alternative only; not chosen |
| resend | **6.32.1** | engines `node >=20` |
| vitest | **5.0.3** | engines `^22.12 \|\| ^24 \|\| >=26`; peer vite `^6.4 \|\| ^7 \|\| ^8` (vite latest 8.3.4) |
| @playwright/test | **1.64.0** | engines `node >=20` |
| eslint / eslint-config-next | 10.12.0 / 16.4.0 | `next lint` removed; run eslint directly |
| tsx (dev) | 4.23.15 | for seed/scripts |
| server-only | 0.0.1 | Next auth guide uses it |
| Postgres (Render + Docker + CI) | **18** | Render default is 18 ([blueprint spec](https://render.com/docs/blueprint-spec)) |
| actions/checkout, actions/setup-node | v7 (7.0.1), v7 (7.1.0) | GitHub releases API. Docs examples still show `@v6`; both work. |

Install commands:
```bash
npm i next@16.4.0 react@19.3.0 react-dom@19.3.0 @prisma/client@7.10.0 @prisma/adapter-pg@7.10.0 pg@8.23.1 zod@4.6.5 jose@6.2.12 resend@6.32.1 server-only
npm i -D -E prisma@7.10.0 typescript@5.9.3 @types/node@24 @types/react @types/react-dom @types/pg dotenv tsx vitest@5.0.3 @playwright/test@1.64.0 eslint eslint-config-next@16.4.0
```

---

## 1. Versions and Node pinning

- See the table. Node: put `24.21.0` in `.node-version`. Optionally add `"engines": {"node": ">=24 <27"}`; Render requires an upper bound in ranges, or the range resolves to the latest Node. ([render node-version](https://render.com/docs/node-version))
- Render precedence: `NODE_VERSION` env > `.node-version` > `.nvmrc` > `package.json engines`. Aliases like `lts` are resolved via `node-version-alias`. ([render node-version](https://render.com/docs/node-version))
- Node 24 enters maintenance LTS on 2026-10-20 and stays supported until 2028-04-30, which comfortably covers the judging window. ([schedule.json](https://github.com/nodejs/Release/blob/main/schedule.json))

## 2. Next.js App Router details

**Body size**
- Server Actions: 1 MB default, configurable via `experimental.serverActions.bodySizeLimit`. Multipart boundaries count toward the limit. ([serverActions](https://nextjs.org/docs/app/api-reference/config/next-config-js/serverActions))
- Route Handlers: the docs state no limit. Read uploads with `await request.formData()`. ([route.js > Request Body FormData](https://nextjs.org/docs/app/api-reference/file-conventions/route))
- If `proxy.ts` (formerly middleware) matches the request, the body is buffered up to `experimental.proxyClientMaxBodySize` (default **10 MB**). Past that limit Next logs a warning and the handler gets a **truncated** body. ([proxyClientMaxBodySize](https://nextjs.org/docs/app/api-reference/config/next-config-js/proxyClientMaxBodySize)) Consequences: (a) don't match upload routes in `proxy.ts`, or don't use a proxy at all; (b) enforce our own limit in the handler.

```ts
// app/api/deals/[id]/evidence/route.ts
export async function POST(req: Request, ctx: RouteContext<'/api/deals/[id]/evidence'>) {
  const { id } = await ctx.params;                       // params is a Promise in v15+/16
  if (Number(req.headers.get('content-length') ?? 0) > 8_000_000) return new Response('Too large', { status: 413 });
  const form = await req.formData();
  const files = form.getAll('photos').filter((f): f is File => f instanceof File);
  if (files.length > 6 || files.some(f => f.size > 1_500_000 || f.type !== 'image/jpeg'))
    return new Response('Bad photos', { status: 400 });
  const bytes = await Promise.all(files.map(async f => new Uint8Array(await f.arrayBuffer())));
  // prisma.photoBlob.create({ data: { data: bytes[0], ... } })
}
```
`RouteContext<'/path'>` is the Route Context Helper type described in [route.js](https://nextjs.org/docs/app/api-reference/file-conventions/route).

**Webhook raw body.** Read the raw string once, verify it, then parse:
```ts
export async function POST(req: Request) {
  const raw = await req.text();               // documented webhook pattern
  // verify signature (PayPal verify-webhook-signature API / headers) using raw + req.headers
  const event = JSON.parse(raw);
  return new Response(null, { status: 200 });
}
```
([route.js > Webhooks](https://nextjs.org/docs/app/api-reference/file-conventions/route))

**Runtime / duration**
- `runtime` defaults to `'nodejs'`; `'edge'` is deprecated. No export is needed. ([segment config](https://nextjs.org/docs/app/api-reference/file-conventions/route-segment-config))
- `maxDuration` is honored only by platforms that read build output. Under `next start` on Render it is a no-op. ([maxDuration](https://nextjs.org/docs/app/api-reference/file-conventions/route-segment-config/maxDuration)) Put an explicit `AbortSignal.timeout(30_000)` on Anthropic calls instead.

**Dynamic rendering.** `await connection()` (from `next/server`) forces request-time rendering when a page doesn't already use cookies/headers. ([connection](https://nextjs.org/docs/app/api-reference/functions/connection)) Pages that read our session cookie are already dynamic. `cookies()` is **async** (`await cookies()`) and can `.set()`/`.delete()` inside Route Handlers. ([cookies](https://nextjs.org/docs/app/api-reference/functions/cookies), [route.js > Cookies](https://nextjs.org/docs/app/api-reference/file-conventions/route))

**`output: 'standalone'`?** Not needed. Standalone builds `.next/standalone/server.js`, but `public/` and `.next/static` must then be copied in manually. ([output](https://nextjs.org/docs/app/api-reference/config/next-config-js/output)) Render installs `node_modules` anyway, so plain `next start` is simpler. `next start` honors the `PORT` env (Render sets 10000) and binds `0.0.0.0` by default. ([next CLI](https://nextjs.org/docs/app/api-reference/cli/next), [render web services](https://render.com/docs/web-services))

**Other v16 changes that bite** ([upgrade guide](https://nextjs.org/docs/app/guides/upgrading/version-16)):
- Turbopack is the default for dev and build.
- Request APIs (`params`, `cookies()`, `headers()`) are async.
- `middleware` is renamed to `proxy`, and the proxy runtime is always nodejs.
- `next build` no longer lints.

## 3. Prisma 7.10

**Setup** ([v7 quickstart](https://www.prisma.io/docs/v7/prisma-orm/quickstart/postgresql)):
```prisma
// prisma/schema.prisma
generator client {
  provider = "prisma-client"          // ESM-first; "prisma-client-js" is deprecated
  output   = "../src/generated/prisma" // REQUIRED
}
datasource db {
  provider = "postgresql"              // url lives in the config file, not here
}
```
```ts
// prisma.config.ts  (7.10 `prisma init` names it prisma7.config.ts; the v7 CLI discovers either name)
import 'dotenv/config';
import { defineConfig } from 'prisma/config';
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations', seed: 'tsx prisma/seed.ts' },
  datasource: { url: process.env.DATABASE_URL },   // NOT env('DATABASE_URL'): env() throws when unset, breaking `prisma generate` in CI/build
});
```
([config ref: env() throws](https://www.prisma.io/docs/orm/v7/reference/prisma-config-reference))

```ts
// src/lib/db.ts
import 'server-only';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/prisma/client';
const g = globalThis as unknown as { prisma?: PrismaClient };
export const prisma = g.prisma ?? new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
if (process.env.NODE_ENV !== 'production') g.prisma = prisma;   // avoid hot-reload connection leaks
```
([Next.js troubleshooting: singleton](https://www.prisma.io/docs/orm/v7/more/troubleshooting/nextjs))

- Generator defaults: `engineType = "client"` (no Rust binary) and `runtime = "nodejs"`. With `tsx`, `importFileExtension = "ts"` may be needed. ([generators](https://www.prisma.io/docs/orm/v7/prisma-schema/overview/generators))
- Add `src/generated/` to `.gitignore`. In v7, `prisma generate` does not run on postinstall or on `migrate dev`, so put it in the build: `"build": "prisma generate && next build"` (plus `"postinstall": "prisma generate"` for local dev). ([CLI ref](https://www.prisma.io/docs/orm/v7/reference/prisma-cli-reference))
- **Pooling:** with adapter-pg the `pg` Pool defaults apply: `max: 10`, no connect timeout, idle timeout 10 s. ([connection pool](https://www.prisma.io/docs/orm/v7/prisma-client/setup-and-configuration/databases-connections/connection-pool)) Render `0.1c-256mb` allows 100 connections ([pricing](https://render.com/pricing)), and 1 web instance at 10 is fine. Render's built-in PgBouncer (transaction mode) is optional and **not available on free** ([pooling](https://render.com/docs/postgresql-connection-pooling), [free](https://render.com/docs/free)). Skip it. Pass `connectionTimeoutMillis: 5000` so a dead DB fails fast.
- **Migrations:** run `prisma migrate dev --name x` locally (creates the SQL plus the `_prisma_migrations` entry). Run `prisma migrate deploy` in CI/prod. Use `migrate dev --create-only` to hand-edit SQL (triggers etc.) before applying. ([deploy changes](https://www.prisma.io/docs/orm/v7/prisma-client/deployment/deploy-database-changes-with-prisma-migrate), [customizing migrations](https://www.prisma.io/docs/orm/v7/prisma-migrate/workflows/customizing-migrations))
- **Enum vs text for status:** Prisma enums map to native Postgres enums ([schema ref](https://www.prisma.io/docs/orm/v7/reference/prisma-schema-reference)) and give TS union types for free. Use enums. Adding a value later requires a migration.
- **BigInt autoincrement:** `id BigInt @id @default(autoincrement())` becomes `bigserial` ([schema ref](https://www.prisma.io/docs/orm/v7/reference/prisma-schema-reference)). The value is a JS `bigint`, and `JSON.stringify` throws "Do not know how to serialize a BigInt" ([fields & types](https://www.prisma.io/docs/orm/v7/prisma-client/special-fields-and-types)). **Recommendation:** plain `Int @default(autoincrement())` is plenty for a hackathon audit log. If you use BigInt, map it to a string at the API edge.
- **Bytes:** `data Bytes` (bytea) returns `Uint8Array`. Prisma selects all scalars by default, so **keep blobs in their own table** (`PhotoBlob { id, mime, data Bytes }`) or use global `omit` ([excluding fields](https://www.prisma.io/docs/orm/v7/prisma-client/queries/excluding-fields)). That way deal/evidence list queries never pull MBs. Serve with `new Response(blob.data, { headers: { 'content-type': blob.mime, 'cache-control': 'private, max-age=600' } })`.
- **Append-only audit log.** Enforce it in the DB with a trigger added via a `--create-only` migration:
  ```sql
  CREATE FUNCTION audit_log_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN RAISE EXCEPTION 'audit_log is append-only'; END $$;
  CREATE TRIGGER audit_log_no_update_delete BEFORE UPDATE OR DELETE ON "AuditLog"
    FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();
  ```
  `REVOKE` won't help because the Render app user owns the tables. Row-level DELETE triggers do **not** fire on `TRUNCATE` ([TRUNCATE docs](https://www.postgresql.org/docs/current/sql-truncate.html)), so test resets still work.
- **Test DB pattern** (adapted from [integration testing](https://www.prisma.io/docs/orm/v7/prisma-client/testing/integration-testing) + [TRUNCATE](https://www.prisma.io/docs/orm/v7/prisma-client/queries/crud)):
  - Use a separate database, `handshake_test`, on the same local Postgres container.
  - Vitest `globalSetup` runs `prisma migrate deploy` against `DATABASE_URL=...handshake_test` once.
  - `beforeEach` runs `TRUNCATE TABLE "A","B",... RESTART IDENTITY CASCADE` via `$executeRawUnsafe`.
  - Run integration files serially (`--no-file-parallelism`).

## 4. Postgres bytea for ~1 MB photos

- Max size of one TOAST-able value is **1 GB**. ([TOAST](https://www.postgresql.org/docs/current/storage-toast.html), [limits](https://www.postgresql.org/docs/current/limits.html))
- TOAST kicks in when a row exceeds ~**2 kB**. The value is compressed (pglz by default via `default_toast_compression`), then split out-of-line into ~2000-byte chunks in the table's TOAST relation. Out-of-line values are **only read if the column is selected**. ([TOAST](https://www.postgresql.org/docs/current/storage-toast.html))
- JPEGs don't compress, so the compression attempt is wasted CPU. `ALTER TABLE "PhotoBlob" ALTER COLUMN data SET STORAGE EXTERNAL;` stores out-of-line without compression. ([TOAST: EXTERNAL strategy](https://www.postgresql.org/docs/current/storage-toast.html)) This is optional; at our volume it doesn't matter.
- Performance at ~1 MB per row with a few hundred rows is fine. node-postgres moves bytea as text (hex) by default, roughly 2x on the wire. **UNVERIFIED** for the adapter-pg path, and irrelevant at our scale.
- **Storage math:** 10 photos per deal at ~600 KB is about 6 MB per deal, so 100 demo deals is about 600 MB. Free 1 GB is tight. Use `diskSizeGB: 5` ($1.50/mo). Disk can grow but never shrink. ([blueprint spec](https://render.com/docs/blueprint-spec), [pg create](https://render.com/docs/postgresql-creating-connecting))
- Bandwidth: Hobby includes 5 GB/mo outbound, then $0.15/GB ([pricing](https://render.com/pricing)). Use `Cache-Control: private, max-age=...` on photo responses.

## 5. Render

### (a) Blueprint (`render.yaml` at repo root)

Field facts, all from the [blueprint spec](https://render.com/docs/blueprint-spec):
- `type: web|cron`, `runtime: node`, and `buildCommand` (required for native runtimes).
- `startCommand`, `preDeployCommand`, `healthCheckPath`, `schedule` (cron only), and `plan`.
- Env vars can use `value`, `generateValue: true` (random base64 256-bit), `sync: false` (prompted only on initial Blueprint creation and ignored on later syncs), `fromDatabase: {name, property: connectionString}`, or `fromService: {name, type, envVarKey}`.
- `databases:` takes `name`, `plan`, `diskSizeGB`, and `postgresMajorVersion` (default 18; can't change later).
- Omitting `previews` leaves PR previews disabled.

### (b) Free tier limits ([free](https://render.com/docs/free))

- **Web:** spins down after 15 min without inbound traffic, and spin-up takes about 1 min. 750 free instance hours per workspace per month. Can be restarted at any time. No pre-deploy command, no SSH, no one-off jobs. Outbound SMTP ports are blocked (irrelevant, since Resend uses HTTPS).
- **Postgres:** 1 GB, one per workspace, **expires 30 days after creation**, then a 14-day grace period, then **deleted**. No backups, no PITR, no pooling.
- **Cron:** there is **no free plan**. Cron is billed per minute with a $1/mo minimum. ([pricing](https://render.com/pricing), [cron](https://render.com/docs/cronjobs))

### (c) Cheapest paid plans and budget ([pricing](https://render.com/pricing))

| Resource | Plan ID (legacy) | Monthly |
|---|---|---|
| Hobby workspace | n/a | $0 (+5 GB bandwidth, 500 pipeline min) |
| Web service | `0.5c-512mb` (`starter`) | $7 |
| Postgres | `0.1c-256mb` (`basic-256mb`), 100 conns | $6 |
| Postgres disk | `diskSizeGB: 5` @ $0.30/GB | $1.50 (pricing page also says "1 GB SSD storage included"; exact free-GB credit **UNVERIFIED**) |
| Cron | `0.5c-512mb`, ~5 s/day | $1 minimum |
| **Total** | | **~$15.50/mo** |

Oct 9 to Dec 15 is 67 days, about 2.2 months. Web $15.40 + PG $13.20 + disk $3.30 + cron $3 (three calendar months at the $1 minimum) comes to **about $35, under the $50 credit**. Billing is prorated per second. Whether the hackathon credit applies to every line item is **UNVERIFIED**; check the dashboard Billing page after the first day.

### (d) Request timeout

Not documented on Render's web-services, deploys, or FAQ pages, nor in llms-full.txt. **UNVERIFIED** (community reports say 100 min). Health checks must answer 2xx/3xx within 5 s. An instance is pulled from rotation after 15 s of consecutive failures and restarted after 60 s ([health checks](https://render.com/docs/health-checks)). Keep `/api/health` trivial: no DB, no AI.

### (e) Previews

Leave `previews` out of the Blueprint (disabled by default). Full-stack preview environments require the Pro workspace anyway. ([blueprint spec](https://render.com/docs/blueprint-spec), [pricing](https://render.com/pricing))

### (f) Node version

Use `.node-version` = `24.21.0` (see section 1).

### (g) Migrations

Use `preDeployCommand: npx prisma migrate deploy`. It needs a paid web service (we have one), runs after build on a separate instance, times out after 30 min, and a failure aborts the deploy while the old version keeps serving. ([deploys](https://render.com/docs/deploys)) Prisma's own Render guide uses the same pattern ([prisma: deploy to Render](https://www.prisma.io/docs/orm/v7/prisma-client/deployment/traditional/deploy-to-render)). Deploys are zero-downtime, so migrations must stay backward compatible with the previous running build. Don't run migrations in `buildCommand`: a failed deploy would have already migrated the DB.

## 6. Sessions and magic links

**Recommendation: `jose` (HS256 JWT) + `cookies()`. No auth framework.**
- The Next.js auth guide's stateless-session example uses exactly this: `SignJWT().setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('7d').sign(key)`, `jwtVerify(token, key, {algorithms:['HS256']})`, and cookie flags `httpOnly: true, secure: true, sameSite: 'lax', path: '/', expires`. ([Next auth guide](https://nextjs.org/docs/app/guides/authentication))
- Magic link: a second JWT with `purpose: 'login'`, `sub: email`, and 15 min expiry, emailed as `/api/auth/callback?token=...`. The handler verifies it, upserts the user, and sets the session cookie.
- Stateless tokens can be replayed until they expire. For one-time use, store the `jti` in a tiny table and reject repeats (optional for the demo).
- Demo personas: `POST /api/auth/demo {persona}` sets the session cookie directly.
- `secure: process.env.NODE_ENV === 'production'` keeps local http dev working.

```ts
import 'server-only';
import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
const key = new TextEncoder().encode(process.env.SESSION_SECRET);   // Render: generateValue: true
export const sign = (claims: Record<string, unknown>, exp: string) =>
  new SignJWT(claims).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime(exp).sign(key);
export const verify = async (t?: string) => { try { return (await jwtVerify(t ?? '', key, { algorithms: ['HS256'] })).payload; } catch { return null; } };
export async function setSession(userId: string) {
  (await cookies()).set('hs_session', await sign({ sub: userId }, '7d'), {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 7,
  });
}
```

Alternatives:
- **iron-session 9** (`getIronSession(await cookies(), {password, cookieName})`): encrypted rather than just signed. Password must be at least 32 chars. TTL defaults to 14 days. ([README](https://github.com/vvo/iron-session)) It's not needed because our payload is just a user id.
- **Auth.js / next-auth v5:** still beta, and the project has joined Better Auth. The email provider *requires* a database adapter for verification tokens, plus the Resend provider. ([authjs email](https://authjs.dev/getting-started/authentication/email)) That means more tables and config for no gain here. Rejected.

## 7. Resend

```ts
import { Resend } from 'resend';
const resend = new Resend(process.env.RESEND_API_KEY);
const { data, error } = await resend.emails.send({
  from: 'Handshake <onboarding@resend.dev>',
  to: [email],
  subject: 'Your Handshake sign-in link',
  html: `<a href="${url}">Sign in</a>`,
});
```
([send with Next.js](https://resend.com/docs/send-with-nextjs))

- **Free:** 100/day (UTC day) and 3,000/month. Each To/CC/BCC counts separately. 3 domains. **10 req/s** rate limit. ([quotas](https://resend.com/docs/knowledge-base/account-quotas-and-limits), [pricing](https://resend.com/pricing))
- **Sandbox sender:** without a verified domain you get 403 `validation_error`: *"You can only send testing emails to your own email address"*. ([errors](https://resend.com/docs/api-reference/errors)) Judges cannot receive magic links unless we verify a domain we own, which takes DNS records ([domains](https://resend.com/docs/dashboard/domains/introduction)).
- **Fallback:** demo personas are the primary judge path. The magic link is a bonus that works for the team email. Optionally, in non-prod, show "link sent" with the link printed to server logs. Test addresses like `delivered@resend.dev` work and count against quota ([test emails](https://resend.com/docs/dashboard/emails/send-test-emails)).

## 8. HMAC-signed expiring photo URLs

Node `crypto.timingSafeEqual` throws if the lengths differ, so check length first. ([Node crypto docs](https://nodejs.org/api/crypto.html#cryptotimingsafeequala-b))
```ts
import { createHmac, timingSafeEqual } from 'node:crypto';
const KEY = process.env.MEDIA_URL_SECRET!;   // Render: generateValue: true
const mac = (id: string, exp: string) => createHmac('sha256', KEY).update(`${id}.${exp}`).digest('base64url');
export function signedPhotoUrl(id: string, ttlSec = 600) {
  const exp = String(Math.floor(Date.now() / 1000) + ttlSec);
  return `/api/photos/${id}?exp=${exp}&sig=${mac(id, exp)}`;
}
export function verifyPhotoUrl(id: string, exp: string | null, sig: string | null) {
  if (!exp || !sig || !/^\d+$/.test(exp) || Number(exp) < Date.now() / 1000) return false;
  const a = Buffer.from(sig), b = Buffer.from(mac(id, exp));
  return a.length === b.length && timingSafeEqual(a, b);
}
```

## 9. Browser image downscale

`createImageBitmap(file, { imageOrientation: 'from-image' })` applies EXIF orientation, and `from-image` is the default ([MDN createImageBitmap](https://developer.mozilla.org/en-US/docs/Web/API/Window/createImageBitmap)). CSS `image-orientation: from-image` is also the default for `<img>` ([MDN image-orientation](https://developer.mozilla.org/en-US/docs/Web/CSS/image-orientation)). `toBlob(cb, 'image/jpeg', quality)` falls back to PNG if the type is unsupported ([MDN toBlob](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toBlob)).
```ts
export async function downscale(file: File, max = 1600, quality = 0.85): Promise<Blob> {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });   // throws on undecodable input (e.g. HEIC in Chrome)
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return new Promise((ok, fail) => c.toBlob(b => (b ? ok(b) : fail(new Error('encode failed'))), 'image/jpeg', quality));
}
```
- Re-encoding through canvas drops EXIF, including GPS. That is good for privacy, but if we want capture time, read `file.lastModified` before encoding. That canvas output carries no EXIF is standard behavior but **UNVERIFIED** in a spec citation here.
- **HEIC:** whether iOS Safari transcodes HEIC to JPEG for `<input type="file" accept="image/*">` is **UNVERIFIED** (no primary Apple/WebKit doc found). Mitigation: wrap `downscale` in try/catch and show "Please choose a JPEG or PNG photo". Since the server only accepts `image/jpeg`, every client output becomes JPEG anyway.

## 10. Test and CI config

**`vitest.config.mts`.** The Next guide uses `vite-tsconfig-paths` ([Next vitest](https://nextjs.org/docs/app/guides/testing/vitest)); Vite 8's native option replaces it ([vite](https://vite.dev/config/shared-options)).
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({
  resolve: { tsconfigPaths: true },          // @/* aliases from tsconfig.json
  test: {
    projects: [                               // Vitest 5: inline projects inherit root config by default
      { test: { name: 'unit', include: ['src/**/*.test.ts'], exclude: ['src/**/*.int.test.ts'] } },
      { test: { name: 'int', include: ['src/**/*.int.test.ts'], globalSetup: ['test/global-setup.ts'] } },
    ],
  },
});
```
Scripts: `"test": "vitest run --project unit"`, `"test:int": "vitest run --project int --no-file-parallelism"`. `--no-file-parallelism` is documented ([fileParallelism](https://vitest.dev/config/fileparallelism)). Vitest 5 breaking changes worth knowing ([migration](https://vitest.dev/guide/migration)): inline projects inherit the root config by default, `clearMocks` is on by default, and unawaited async assertions fail. Async Server Components can't be unit-tested in Vitest; use e2e for those ([Next vitest](https://nextjs.org/docs/app/guides/testing/vitest)).

```ts
// test/global-setup.ts
import { execSync } from 'node:child_process';
export function setup() {
  execSync('npx prisma migrate deploy', { stdio: 'inherit', env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL } });
}
```

**`playwright.config.ts`** ([webServer](https://playwright.dev/docs/test-webserver)):
```ts
import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'e2e',
  use: { baseURL: 'http://localhost:3000' },
  webServer: { command: 'npm run build && npm run start', url: 'http://localhost:3000', reuseExistingServer: !process.env.CI, timeout: 180_000 },
});
```

**`.github/workflows/ci.yml`.** Service container per [GitHub docs](https://docs.github.com/en/actions/tutorials/use-containerized-services/create-postgresql-service-containers); browser install per [Playwright CI](https://playwright.dev/docs/ci-intro).
```yaml
name: ci
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:18-alpine
        env: { POSTGRES_PASSWORD: postgres, POSTGRES_DB: handshake_test }
        options: >-
          --health-cmd pg_isready --health-interval 10s --health-timeout 5s --health-retries 5
        ports: ['5432:5432']
    env:
      DATABASE_URL: postgresql://postgres:postgres@localhost:5432/handshake_test
      TEST_DATABASE_URL: postgresql://postgres:postgres@localhost:5432/handshake_test
      SESSION_SECRET: ci-only-secret-at-least-32-chars-long!!
      MEDIA_URL_SECRET: ci-only-media-secret
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v6
        with: { node-version-file: .node-version, cache: npm }
      - run: npm ci
      - run: npx prisma generate
      - run: npx tsc --noEmit
      - run: npm test
      - run: npm run test:int
      - run: npx playwright install --with-deps chromium
      - run: npx prisma migrate deploy && npx playwright test
```

## 11. Local dev

**Postgres via Docker.** On PG 18+ the image's `PGDATA` is `/var/lib/postgresql/18/docker`, so mount the volume at `/var/lib/postgresql`, not `.../data` ([docker-library postgres docs](https://github.com/docker-library/docs/blob/master/postgres/content.md)):
```yaml
# compose.yaml
services:
  db:
    image: postgres:18-alpine
    environment: { POSTGRES_USER: postgres, POSTGRES_PASSWORD: postgres, POSTGRES_DB: handshake }
    ports: ['5432:5432']
    volumes: ['pgdata:/var/lib/postgresql']
volumes: { pgdata: {} }
```
Create the test DB once: `docker compose exec db createdb -U postgres handshake_test`. Postgres.app works too; just use PG 18 to match Render.

**Webhook tunnel.**
- **cloudflared quick tunnel** (recommended): no account, no domain. Run `brew install cloudflared` (formula 2026.10.0), then `cloudflared tunnel --url http://localhost:3000`, and use the printed `*.trycloudflare.com` URL. Limits: 200 in-flight requests, no SSE, and the URL dies when the process stops (so re-register the PayPal sandbox webhook URL each session). ([Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/))
- **ngrok free:** requires an account. Gives one stable dev domain (`*.ngrok-free.app`), 20k HTTP requests/month, and 1 GB/month out. ([ngrok free limits](https://ngrok.com/docs/pricing-limits/free-plan-limits)) Its stable URL is nicer for PayPal sandbox webhook registration, if the team doesn't mind signing up.
- Alternative: point the PayPal sandbox webhook at the deployed Render URL and skip local tunnels for most work.

## 12. License

Put `LICENSE` at the repo root containing the standard MIT text (from [GitHub licenses API](https://api.github.com/licenses/mit)), with `Copyright (c) 2026 <names>`. GitHub detects it with Licensee by comparing the root `LICENSE` file against known licenses. Keep the file unmodified apart from the year and name. ([GitHub: licensing a repository](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository))

---

## Implications for Handshake

**Render: three resources, ~$15.50/mo, ~$35 through Dec 15.**
```yaml
# render.yaml
services:
  - type: web
    name: handshake
    runtime: node
    plan: 0.5c-512mb                 # $7/mo, never spins down
    buildCommand: npm ci && npm run build          # build = prisma generate && next build
    preDeployCommand: npx prisma migrate deploy
    startCommand: npm run start                    # next start, PORT=10000 from Render
    healthCheckPath: /api/health
    envVars:
      - { key: DATABASE_URL, fromDatabase: { name: handshake-db, property: connectionString } }
      - { key: SESSION_SECRET, generateValue: true }
      - { key: MEDIA_URL_SECRET, generateValue: true }
      - { key: CRON_SECRET, generateValue: true }
      - { key: ANTHROPIC_API_KEY, sync: false }
      - { key: PAYPAL_CLIENT_ID, sync: false }
      - { key: PAYPAL_CLIENT_SECRET, sync: false }
      - { key: PAYPAL_WEBHOOK_ID, sync: false }
      - { key: RESEND_API_KEY, sync: false }
  - type: cron
    name: handshake-daily
    runtime: node
    plan: 0.5c-512mb                 # $1/mo minimum
    schedule: '0 9 * * *'            # UTC
    buildCommand: 'true'
    startCommand: >-
      curl -fsS --max-time 120 --retry 3 -X POST
      -H "Authorization: Bearer $CRON_SECRET" https://$APP_HOST/api/cron/daily
    envVars:
      - { key: APP_HOST, fromService: { name: handshake, type: web, envVarKey: RENDER_EXTERNAL_HOSTNAME } }
      - { key: CRON_SECRET, fromService: { name: handshake, type: web, envVarKey: CRON_SECRET } }
databases:
  - name: handshake-db
    plan: 0.1c-256mb                 # $6/mo, 100 connections
    diskSizeGB: 5                    # omit it and you get 15 GB
    postgresMajorVersion: '18'
```
- `.node-version` = `24.21.0`.
- Keep web and DB in the same region (default oregon) so the internal URL works. ([pg connect](https://render.com/docs/postgresql-creating-connecting))
- `sync: false` values are prompted **only at first Blueprint creation**. Secrets added later must be entered in the dashboard. ([blueprint spec](https://render.com/docs/blueprint-spec))
- Cron hits the protected endpoint over HTTPS. That reuses app code and needs no second full build. The endpoint compares the bearer token with `timingSafeEqual`, and must be idempotent because a run can be retried or triggered manually.

**Prisma:**
- Pin `prisma`, `@prisma/client`, and `@prisma/adapter-pg` at exactly `7.10.0`.
- Use the `prisma-client` generator with output `src/generated/prisma` (gitignored), `prisma.config.ts` with `process.env.DATABASE_URL`, and the adapter-pg singleton.
- Use enums for statuses and `Int` autoincrement ids (avoid BigInt JSON pain).
- Put photos in a dedicated `PhotoBlob` table.
- Make the audit log append-only with a trigger in a `--create-only` migration.

**Sessions:**
- Use jose HS256 for both the 7-day `hs_session` cookie (httpOnly, sameSite=lax, secure in prod) and the 15-minute magic-link token.
- Demo personas are a one-click POST that sets the cookie. They are the judges' path, because Resend's sandbox only delivers to our own address.

**Uploads:**
- The client downscales to 1600px JPEG at 0.85.
- Upload with `multipart/form-data` to a Route Handler using `request.formData()`. Allow at most 6 files at 1.5 MB each, reject `content-length` over 8 MB, and accept `image/jpeg` only.
- Keep `proxy.ts` off upload routes (or don't use a proxy).
- Serve photos via `/api/photos/[id]?exp&sig` with HMAC verification and `Cache-Control: private`.

**CI:** GitHub Actions with a `postgres:18-alpine` service. Steps: `npm ci`, then `prisma generate`, `tsc --noEmit`, unit tests, integration tests (serial), and Playwright with chromium only.

---

## Open risks

1. **Render HTTP request timeout is undocumented (UNVERIFIED).** Measure a 30 s AI call on the deployed service early. If it's a problem, move the AI call to a background step and poll.
2. **Prisma dist-tag trap.** Any `npm i prisma` or `npx prisma@latest` pulls the 8 RC. Always pin, and use `npx prisma` only after a local install. Also, prisma.io docs now default to v8, so always read the `/orm/v7/` pages.
3. **Render plan names changed** (`starter` is now `0.5c-512mb`, `basic-256mb` is now `0.1c-256mb`). Older tutorials and AI suggestions will use legacy names. Legacy names still appear in docs as aliases; whether the Blueprint still accepts them is **UNVERIFIED**.
4. **Judges and email.** Magic links won't reach judges without a verified domain. Make personas prominent on the sign-in page.
5. **HEIC uploads from iPhone are UNVERIFIED.** Test on a real iPhone early. Chrome desktop can't decode HEIC, so the client-side error path is needed.
6. **$50 credit scope is UNVERIFIED** (workspace plan vs compute vs bandwidth). Check Billing after day 1. Do not upgrade the workspace to Pro ($25/mo).
7. **Zero-downtime deploys plus preDeploy migrations.** The old build keeps serving while the new schema is applied. Avoid destructive column renames during judging (2026-12-01 to 12-15). Freeze deploys then.
8. **Proxy body truncation.** A broad `proxy.ts` matcher could silently cut uploads over 10 MB (and Next marks the option experimental).
9. **TypeScript 7.** Don't let tooling bump to TS 7; typescript-eslint breaks.
10. **512 MB web instance.** Next.js plus in-memory buffering of 6 MB uploads should fit. Actual RSS under `next start` is **UNVERIFIED**; watch Render metrics.
11. **Disk can't shrink.** Choose 5 GB once. Storage autoscaling isn't needed.
