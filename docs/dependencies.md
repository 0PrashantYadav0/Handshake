# Dependencies

This document fixes the runtime, every npm package and every outside account Handshake uses, each at an exact version, so that `npm install` runs once and nothing drifts before judging ends on 2026-12-15.

As of 2026-10-09. Every version below was checked today with `npm view <pkg> version` (npm 11.19.1) or comes from a research file in `docs/research/`. The whole set was resolved today with `npm install --package-lock-only` in a scratch directory: 718 packages, lockfile version 3, exit code 0, peer-dependency warnings only (see [Known traps](#known-traps)). Decisions that name these packages are in [decisions.md](decisions.md) sections D1, E1, E9, G2, G3, I5 and J1.

## Runtime

Node 24.21.0 runs the app everywhere; npm is the only package manager.

| Item | Value | Why | Source |
| --- | --- | --- | --- |
| Node | `24.21.0` | Render's default for services created on or after 2026-09-17. LTS "Krypton", supported until 2028-04-30, which covers judging. | [stack.md](research/stack.md) "Pinned versions", section 1 |
| npm | `11.19.0` ships inside Node 24.21.0; any npm 11.x works | Lockfile version 3; `npm ci` in CI and on Render | nodejs.org/dist/index.json (fetched today: `v24.21.0`, `npm: 11.19.0`) |
| Local Node | 24.21.0 preferred; 26.8.2 (the developer's machine today) also satisfies every `engines` range in this document | | [stack.md](research/stack.md) "Pinned versions" |
| Postgres | 18 (`postgres:18-alpine` locally and in CI; `postgresMajorVersion: '18'` on Render) | Render default; cannot be changed after creation | [stack.md](research/stack.md) section 5(a), 11 |

How the Node version is pinned, in the order Render reads it (`NODE_VERSION` env var, then `.node-version`, then `.nvmrc`, then `engines`; [stack.md](research/stack.md) section 1):

```
# .node-version
24.21.0
```

```json
// package.json (fragment)
"engines": { "node": ">=24 <27" }
```

The `engines` range has an upper bound because Render resolves an open-ended range to the newest Node. GitHub Actions reads the same file with `actions/setup-node@v7` and `node-version-file: .node-version`. No `packageManager` field and no Corepack: npm comes with Node.

```
# .npmrc
save-exact=true
```

`save-exact=true` makes every future `npm i <pkg>` write an exact version instead of `^x.y.z`, which is how the Prisma 8 release candidate would otherwise sneak in.

## Production dependencies

Seventeen packages ship to Render; every one is pinned exactly.

| Package | Pin | Purpose | Licence | Source | Alternatives rejected |
| --- | --- | --- | --- | --- | --- |
| `next` | 16.4.0 | App Router pages, Route Handlers, `next start` on Render (B1). Engines `node >=20.9.0`. | MIT | [npm](https://www.npmjs.com/package/next/v/16.4.0) | Separate SPA + API server: two services to host and deploy; B1 says one app. |
| `react` | 19.3.0 | UI runtime, peer of Next (`^18.2 \|\| ^19`). | MIT | [npm](https://www.npmjs.com/package/react/v/19.3.0) | None; required by Next. |
| `react-dom` | 19.3.0 | DOM renderer for React. | MIT | [npm](https://www.npmjs.com/package/react-dom/v/19.3.0) | None; required by Next. |
| `@prisma/client` | 7.10.0 | Typed queries for the 15 models in `prisma/schema.prisma`; Prisma enums for statuses; `Bytes` for `files.bytes`. Engines `^20.19 \|\| ^22.12 \|\| >=24`, peer `typescript >=5.4`. | Apache-2.0 | [npm](https://www.npmjs.com/package/@prisma/client/v/7.10.0) | Prisma 8.0.0-rc.22: release candidate with a new CLI, not for a judged demo. Drizzle: the brief, the research and I5 are written for Prisma; migrations and enum mapping are known. |
| `@prisma/adapter-pg` | 7.10.0 | Prisma 7 has no built-in driver; this wraps `pg` for `new PrismaClient({ adapter })`. | Apache-2.0 | [npm](https://www.npmjs.com/package/@prisma/adapter-pg/v/7.10.0) | Render's PgBouncer: optional, not on free, not needed at 10 connections ([stack.md](research/stack.md) section 3). |
| `pg` | 8.23.1 | The Postgres driver `@prisma/adapter-pg` depends on (`^8.16.3`). Pinned directly so the lockfile cannot float it. | MIT | [npm](https://www.npmjs.com/package/pg/v/8.23.1) | `postgres` (postgres.js): the adapter requires `pg`. |
| `zod` | 4.6.5 | Validates every request body (B4) and every model output after the API's schema check (D2). Optional peer of `@anthropic-ai/sdk` (`^3.25 \|\| ^4`). | MIT | [npm](https://www.npmjs.com/package/zod/v/4.6.5) | Valibot, ArkType: the Anthropic SDK's peer range names Zod; one validation library for both jobs. |
| `jose` | 6.2.12 | HS256 JWT for the `hs_session` cookie and the 15-minute magic-link token (F1, F2). Zero dependencies. | MIT | [npm](https://www.npmjs.com/package/jose/v/6.2.12) | `next-auth` 5.0.0-beta.32: beta, and its email provider needs a DB adapter. `iron-session` 9.0.1: encrypted cookies are more than a user id needs. ([stack.md](research/stack.md) section 6) |
| `resend` | 6.32.1 | Sends magic-link email over HTTPS (F2). Engines `node >=20`. Its `@react-email/render` peer is optional and not installed. | MIT | [npm](https://www.npmjs.com/package/resend/v/6.32.1) | SMTP + nodemailer: Render's free tier blocks outbound SMTP and Resend's API needs no domain for the team address ([stack.md](research/stack.md) section 7). |
| `server-only` | 0.0.1 | Import marker that fails the build if `lib/db.ts`, `lib/paypal/*` or `lib/ai/*` is pulled into a client bundle. Also a dependency of `@paypal/react-paypal-js`. | MIT | [npm](https://www.npmjs.com/package/server-only/v/0.0.1) | None; it is one empty module. |
| `@anthropic-ai/sdk` | 0.132.1 | `messages.create` with `output_config.format` JSON schema, typed errors, per-request `timeout` and `maxRetries` (D1 to D4). Dependencies: `standardwebhooks`, `json-schema-to-ts`. | MIT | [npm](https://www.npmjs.com/package/@anthropic-ai/sdk/v/0.132.1) | Raw `fetch`: loses the typed error classes the verdict path branches on ([claude-api.md](research/claude-api.md) "Error classes"). Vercel AI SDK: an extra layer over the one `output_config` field we need. |
| `@paypal/paypal-server-sdk` | 2.5.0 | Create order (intent `AUTHORIZE`), authorize order, capture authorization, void authorization, with `paypalRequestId` and its own OAuth token cache (E1). Engines `node >=14.17.0`. Uses axios through `@apimatic/axios-client-adapter`, not `fetch`. | MIT | [npm](https://www.npmjs.com/package/@paypal/paypal-server-sdk/v/2.5.0) | `@paypal/checkout-server-sdk`: deprecated on npm. `@paypal/payouts-sdk` 1.1.1: its repo returns 404. Raw `fetch` for everything: still needed for Payouts and webhook verification (the SDK has neither), but the typed controllers and token cache are worth keeping for Orders and Payments. ([paypal.md](research/paypal.md) section 7) |
| `@paypal/react-paypal-js` | 10.6.0 | Legacy `PayPalScriptProvider` + `PayPalButtons` from the package root with `intent: "authorize"` (E9). Peer `react ^16.8 \|\| ^17 \|\| ^18 \|\| ^19`. Depends on `@paypal/paypal-js` 11.2.1. | Apache-2.0 | [npm](https://www.npmjs.com/package/@paypal/react-paypal-js/v/10.6.0) | The package's `sdk-v6` entry point (`PayPalProvider`): has no `intent` option and its authorize flow is UNVERIFIED ([paypal.md](research/paypal.md) section 8). Hand-written `<script>` tag: the provider already handles script loading and React lifecycle. |
| `ag-grid-community` | 36.2.0 | The `/ledger` grid: sorting, filtering, quick filter, cell renderers, Theming API (G3). No licence key. | MIT | [npm](https://www.npmjs.com/package/ag-grid-community/v/36.2.0) | TanStack Table: the sponsor prize is judged on AG products. `ag-grid-enterprise`: not needed by the ledger, and the Studio licence does not cover it outside Studio ([ag-grid.md](research/ag-grid.md) section 2). |
| `ag-grid-react` | 36.2.0 | React wrapper (`AgGridReact`, `AgGridProvider`). Depends on `ag-grid-community` 36.2.0 exactly. | MIT | [npm](https://www.npmjs.com/package/ag-grid-react/v/36.2.0) | None. |
| `ag-studio` | 3.0.0 | The `/dashboard` analytics canvas, custom theme, custom widget, and the Agent Framework types (G3). Depends on `ag-stack ~36.2.0`, `ag-grid-enterprise ~36.2.0`, `ag-charts-enterprise ~14.2.0`. | Commercial (45-day trial) | [npm](https://www.npmjs.com/package/ag-studio/v/3.0.0) | A hand-built dashboard on `ag-charts-community`: the AG Grid prize text says "not just AG Grid or AG Charts on their own" ([hackathon.md](hackathon.md)). |
| `ag-studio-react` | 3.0.0 | `AgStudio`, `AgStudioProvider`, `createWidgets`. Must be the same version as `ag-studio`. Peer `react ^17 \|\| ^18 \|\| ^19`. | Commercial (45-day trial) | [npm](https://www.npmjs.com/package/ag-studio-react/v/3.0.0) | None. |

## Dev dependencies

Fourteen packages are needed to build, lint, test and migrate; Render installs them too, because it sets `NODE_ENV=production` only at runtime ([stack.md](research/stack.md) "Summary" item 13).

| Package | Pin | Purpose | Licence | Source | Alternatives rejected |
| --- | --- | --- | --- | --- | --- |
| `typescript` | 5.9.3 | `tsc --noEmit` typecheck; Next's build-time type check; Studio 3 needs `>= 5.8.3`. | Apache-2.0 | [npm](https://www.npmjs.com/package/typescript/v/5.9.3) | 7.0.2 (`latest`, the native port): `typescript-eslint` 8.71.1 declares peer `typescript >=4.8.4 <6.1.0`, and `create-next-app` still scaffolds `^5` ([stack.md](research/stack.md) item 17). |
| `prisma` | 7.10.0 | CLI: `generate`, `migrate dev`, `migrate deploy` (Render `preDeployCommand`), `migrate reset` in tests. Installed as the `prev` dist-tag. | Apache-2.0 | [npm](https://www.npmjs.com/package/prisma/v/7.10.0) | 8.0.0-rc.22 (`latest`): see [Known traps](#known-traps). |
| `vitest` | 5.0.3 | Unit tests (`lib/deal/`, `decide()`, schemas, signed URLs, webhook verification) and integration tests against Postgres, as two projects. Engines `^22.12 \|\| ^24 \|\| >=26`. | MIT | [npm](https://www.npmjs.com/package/vitest/v/5.0.3) | Jest: ESM and TypeScript need transform config; the Next guide documents Vitest ([stack.md](research/stack.md) section 10). `node:test`: J1 names Vitest. |
| `vite` | 8.3.4 | Required (non-optional) peer of Vitest 5 (`^6.4 \|\| ^7 \|\| ^8`). Its native `resolve.tsconfigPaths` resolves `@/*`. Engines `^20.19 \|\| >=22.12`. | MIT | [npm](https://www.npmjs.com/package/vite/v/8.3.4) | `vite-tsconfig-paths` plugin: replaced by Vite 8's built-in option ([stack.md](research/stack.md) item 18). |
| `@playwright/test` | 1.64.0 | The one happy-path browser test (A5), Chromium only. Engines `node >=20`. Also an optional peer of Next. | Apache-2.0 | [npm](https://www.npmjs.com/package/@playwright/test/v/1.64.0) | Cypress: J1 names Playwright; one test does not justify a second runner. |
| `eslint` | 10.12.0 | `eslint .` with flat config; `next lint` no longer exists in Next 16. | MIT | [npm](https://www.npmjs.com/package/eslint/v/10.12.0) | Biome: Next ships its rule set only as an ESLint config. ESLint 9.39.5: fallback if the peer warnings in [Known traps](#known-traps) ever become errors. |
| `eslint-config-next` | 16.4.0 | `eslint-config-next/core-web-vitals` and `eslint-config-next/typescript` (bundles `typescript-eslint ^8.56`, `@next/eslint-plugin-next` 16.4.0, React and hooks plugins). Peer `eslint >=9`. | MIT | [npm](https://www.npmjs.com/package/eslint-config-next/v/16.4.0) | Installing `typescript-eslint` directly: already inside this package. |
| `tailwindcss` | 4.3.3 | Utility CSS (G2). v4 has no `tailwind.config.js`; theme tokens live in CSS. | MIT | [npm](https://www.npmjs.com/package/tailwindcss/v/4.3.3) | A component library: G2 says none. CSS Modules alone: slower to style a mobile-first seller flow. |
| `@tailwindcss/postcss` | 4.3.3 | The PostCSS plugin Next runs at build. Depends on `tailwindcss` 4.3.3, `@tailwindcss/oxide` 4.3.3, `postcss ^8.5.16`. | MIT | [npm](https://www.npmjs.com/package/@tailwindcss/postcss/v/4.3.3) | `@tailwindcss/vite`: Next uses PostCSS, not the Vite pipeline. |
| `postcss` | 8.5.29 | Peer of the Tailwind plugin; pinned so the plugin's `^8.5.16` range does not float. Next bundles its own nested 8.5.23 and that is fine. | MIT | [npm](https://www.npmjs.com/package/postcss/v/8.5.29) | None. |
| `tsx` | 4.23.15 | Runs `prisma/seed.ts` (Prisma config `migrations.seed`) and `eval/run.ts` with `@/*` path aliases. Depends on `esbuild ~0.28.0`. | MIT | [npm](https://www.npmjs.com/package/tsx/v/4.23.15) | `ts-node`: ESM friction. Node's built-in type stripping: does not resolve tsconfig `paths`. |
| `@types/node` | 24.19.1 | Types for the runtime major (latest 24.x today). Peer of Vitest (`^22 \|\| >=24`). | MIT | [npm](https://www.npmjs.com/package/@types/node/v/24.19.1) | 26.6.4 (`latest`): types for APIs Node 24 does not have. |
| `@types/react` | 19.3.0 | React 19 types. | MIT | [npm](https://www.npmjs.com/package/@types/react/v/19.3.0) | None. |
| `@types/react-dom` | 19.3.0 | React DOM 19 types. | MIT | [npm](https://www.npmjs.com/package/@types/react-dom/v/19.3.0) | None. |

### Not installed, on purpose

| Package | Why not |
| --- | --- |
| `dotenv` | `prisma.config.ts`, `prisma/seed.ts` and `eval/run.ts` call `try { process.loadEnvFile(); } catch {}` (the file is absent on Render and in CI, where env vars are injected). `next dev` and `next build` load `.env` themselves. That `process.loadEnvFile()` exists on Node 24.21.0 is UNVERIFIED: no file in `docs/research/` documents it; [stack.md](research/stack.md) section 3 documents `dotenv` 18.0.6 with `import 'dotenv/config'` instead. Day-1 check: `node -e "process.loadEnvFile()"` with a `.env` present must exit 0. If it fails, `npm i -D dotenv@18.0.6` and replace the three `try` lines with `import 'dotenv/config'`. |
| `@types/pg` | A regular dependency of `@prisma/adapter-pg` (resolved 8.23.1). Add `@types/pg@8.23.1` only if app code imports `pg` directly. |
| `jsdom`, `@testing-library/react`, `@vitejs/plugin-react` | No React component unit tests. Pure modules run in Vitest's default Node environment; the UI is covered by the single Playwright test. |
| `@vitest/coverage-v8` | No coverage gate. |
| `prettier` | No formatter; ESLint only. |
| `vite-tsconfig-paths` | Vite 8 has `resolve.tsconfigPaths: true`. |
| `buffer-crc32` | PayPal's webhook sample uses it; Node's `zlib.crc32` returns the same value (E6, [paypal.md](research/paypal.md) section 6). |
| `next-auth`, `iron-session` | See `jose` above. |
| `@paypal/checkout-server-sdk`, `@paypal/payouts-sdk` | Deprecated and dead, respectively. |
| `@paypal/agent-toolkit`, `@paypal/mcp` | Agentic Commerce is not a target (A4). |
| `ag-grid-enterprise`, `ag-charts-enterprise`, `ag-charts-community`, `ag-stack` | Installed transitively by `ag-studio` (36.2.0 / 14.2.0 / 14.2.0 / 36.2.0). Never imported outside Studio: the Studio licence does not cover them in custom widgets or the ledger. |

### Transitive packages worth knowing

| Package | Resolved | Why it matters |
| --- | --- | --- |
| `axios` 1.20.0 | via `@apimatic/axios-client-adapter` in the PayPal server SDK | The SDK does not use `fetch`. A test that stubs `globalThis.fetch` does not intercept it; use the in-memory PayPal fake (B3). |
| `@paypal/paypal-js` 11.2.1 | via `@paypal/react-paypal-js` | Loads the browser JS SDK script. |
| `typescript-eslint` 8.71.1 | via `eslint-config-next` | The package whose `<6.1.0` peer range forbids TypeScript 7. |
| `postcss` 8.5.23 | nested under `next` | A second copy; harmless. |
| `esbuild` 0.28.2 | via `tsx` | Downloads a platform binary at install. |
| `playwright` 1.64.0 | via `@playwright/test` | Browsers are a separate download (see install). |
| `mysql2`, `deepmerge-ts` | via `prisma` CLI | Source of the `npm audit` noise; never loaded by the app. |

## Install

One `package.json`, one `npm install`, one browser download.

```json
{
  "name": "handshake",
  "private": true,
  "engines": { "node": ">=24 <27" },
  "scripts": {
    "dev": "next dev",
    "build": "prisma generate && next build",
    "start": "next start",
    "postinstall": "prisma generate",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run --project unit",
    "test:int": "vitest run --project int --no-file-parallelism",
    "test:e2e": "playwright test",
    "seed": "tsx prisma/seed.ts",
    "eval": "tsx eval/run.ts"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "0.132.1",
    "@paypal/paypal-server-sdk": "2.5.0",
    "@paypal/react-paypal-js": "10.6.0",
    "@prisma/adapter-pg": "7.10.0",
    "@prisma/client": "7.10.0",
    "ag-grid-community": "36.2.0",
    "ag-grid-react": "36.2.0",
    "ag-studio": "3.0.0",
    "ag-studio-react": "3.0.0",
    "jose": "6.2.12",
    "next": "16.4.0",
    "pg": "8.23.1",
    "react": "19.3.0",
    "react-dom": "19.3.0",
    "resend": "6.32.1",
    "server-only": "0.0.1",
    "zod": "4.6.5"
  },
  "devDependencies": {
    "@playwright/test": "1.64.0",
    "@tailwindcss/postcss": "4.3.3",
    "@types/node": "24.19.1",
    "@types/react": "19.3.0",
    "@types/react-dom": "19.3.0",
    "eslint": "10.12.0",
    "eslint-config-next": "16.4.0",
    "postcss": "8.5.29",
    "prisma": "7.10.0",
    "tailwindcss": "4.3.3",
    "tsx": "4.23.15",
    "typescript": "5.9.3",
    "vite": "8.3.4",
    "vitest": "5.0.3"
  }
}
```

Add `"postinstall": "prisma generate"` only once `prisma/schema.prisma` exists; before that it fails every install.

The same set as commands, for a repo that already has `.npmrc` with `save-exact=true`:

```bash
npm i next@16.4.0 react@19.3.0 react-dom@19.3.0 \
  @prisma/client@7.10.0 @prisma/adapter-pg@7.10.0 pg@8.23.1 \
  zod@4.6.5 jose@6.2.12 resend@6.32.1 server-only@0.0.1 \
  @anthropic-ai/sdk@0.132.1 @paypal/paypal-server-sdk@2.5.0 @paypal/react-paypal-js@10.6.0 \
  ag-grid-community@36.2.0 ag-grid-react@36.2.0 ag-studio@3.0.0 ag-studio-react@3.0.0

npm i -D typescript@5.9.3 prisma@7.10.0 vitest@5.0.3 vite@8.3.4 @playwright/test@1.64.0 \
  eslint@10.12.0 eslint-config-next@16.4.0 \
  tailwindcss@4.3.3 @tailwindcss/postcss@4.3.3 postcss@8.5.29 \
  tsx@4.23.15 @types/node@24.19.1 @types/react@19.3.0 @types/react-dom@19.3.0

npx playwright install --with-deps chromium     # browser binary; not an npm package
```

Fresh clone, CI and Render all use `npm ci` (requires the committed `package-lock.json`). What a correct install looks like:

| Check | Expected |
| --- | --- |
| `npm ci` exit code | 0, with `npm warn ERESOLVE overriding peer dependency` lines (ESLint 10; see traps) |
| `npm ls --depth=0` | The 31 packages above, no `invalid` or `missing` |
| `npm ls prisma @prisma/client @prisma/adapter-pg` | All `7.10.0` |
| `npm ls typescript` | `5.9.3` |
| `npm ls ag-studio ag-studio-react ag-grid-community ag-grid-react` | `3.0.0`, `3.0.0`, `36.2.0`, `36.2.0` |
| `npm audit` | 9 high findings, all under `prisma` or `eslint-config-next` (dev-tool chains). Leave them. |

Config files these packages need (Tailwind, Next and Prisma snippets are from the vendor pages named in the comments). `vitest.config.mts` is owned by [06-test-plan.md](06-test-plan.md) "Layout and commands" and is not repeated here: it aliases `server-only` to `tests/stubs/empty.ts` so route handlers import under Vitest, and sets `DATABASE_URL` for the `int` project from `TEST_DATABASE_URL`.

```js
// postcss.config.mjs  (Tailwind: https://tailwindcss.com/docs/installation/framework-guides/nextjs)
const config = { plugins: { "@tailwindcss/postcss": {} } };
export default config;
```

```css
/* app/globals.css */
@import "tailwindcss";
```

```js
// eslint.config.mjs  (Next: https://nextjs.org/docs/app/api-reference/config/eslint)
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "generated/**"]),
]);
```

```ts
// prisma.config.ts  (Prisma 7: https://www.prisma.io/docs/orm/v7/reference/prisma-config-reference)
import { defineConfig } from "prisma/config";
try { process.loadEnvFile(); } catch {}            // .env is optional; Render and CI inject env vars. UNVERIFIED on 24.21.0: see "Not installed, on purpose"
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations", seed: "tsx prisma/seed.ts" },
  datasource: { url: process.env.DATABASE_URL },    // not env(): env() throws when unset and breaks `prisma generate`
});
```

## Known traps

Each of these has bitten someone on this stack; each has a one-line defence.

| # | Trap | What happens | Defence | Source |
| --- | --- | --- | --- | --- |
| 1 | `npm i prisma` | Installs `8.0.0-rc.22`: the `latest` dist-tag is a Prisma 8 release candidate with a new CLI, while `@prisma/client@latest` is 7.10.0. Mixed majors. | Pin all three Prisma packages at `7.10.0`; `save-exact=true`; never `npx prisma@latest`; read only `/orm/v7/` docs pages. | [stack.md](research/stack.md) item 2; `npm view prisma dist-tags` today: `latest: 8.0.0-rc.22`, `prev: 7.10.0` |
| 2 | `npm audit fix --force` | The 9 high findings sit in `prisma` (via `@prisma/config` -> `deepmerge-ts`, and `mysql2`) and `eslint-config-next` (via `@next/eslint-plugin-next` -> `fast-glob` -> `micromatch` -> `braces`). The suggested "fix" downgrades `prisma` to 6.19.3 and `eslint-config-next` to 14.2.35, breaking the project. | Never run `npm audit fix --force`. Do not make `npm audit` a CI gate. None of the flagged code runs in the app. | Scratch resolution today |
| 3 | TypeScript 7 | `npm i -D typescript` gives 7.0.2; `typescript-eslint` 8.71.1 requires `<6.1.0`, so `eslint .` fails. | Pin `typescript@5.9.3`; editors must use the workspace TypeScript. | [stack.md](research/stack.md) item 17; `npm view typescript-eslint peerDependencies` today |
| 4 | ESLint 10 peer warnings | `eslint-plugin-react` 7.37.5, `eslint-plugin-import` 2.32.0 and `eslint-plugin-jsx-a11y` 6.10.2 (inside `eslint-config-next`) declare peer `eslint` up to `^9`. npm 11 prints `ERESOLVE overriding peer dependency` and continues. | Expected; exit code is 0. Do not add `--legacy-peer-deps` or `--force` to scripts. If a future npm turns this into an error, drop to `eslint@9.39.5`. | Next ESLint docs ("Good to know", fetched today); scratch resolution |
| 5 | `@paypal/react-paypal-js` default docs are V6 | The README and `sdk-v6` entry point show `PayPalProvider` + `PayPalOneTimePaymentButton`, which have no `intent` option; whether they work with an `AUTHORIZE` order is UNVERIFIED. | Import `PayPalScriptProvider` and `PayPalButtons` from the package root and pass `intent: "authorize"` (E9). Never import from `@paypal/react-paypal-js/sdk-v6`. | [paypal.md](research/paypal.md) section 8 |
| 6 | AG Studio version pairing | Studio 3.0.0 pins `ag-grid-enterprise ~36.2.0` and `ag-charts-enterprise ~14.2.0`; `ag-studio` and `ag-studio-react` must be identical; a mismatched `ag-grid-community` gives two grid copies and theme conflicts. Studio ships about every 6 to 8 weeks, so a 3.1 may appear before judging. | Pin `ag-studio@3.0.0`, `ag-studio-react@3.0.0`, `ag-grid-community@36.2.0`, `ag-grid-react@36.2.0`; do not upgrade after 2026-11-08. Import `ag-studio` only from `/dashboard` (about 1.5 to 2 MB gzipped). | [ag-grid.md](research/ag-grid.md) sections 1, 8 |
| 7 | AG Studio trial timing | The trial lasts 45 days and is checked against the browser clock. A key requested today expires about 2026-11-23, before judging. Expired or missing key: console banner plus a watermark that fades after 5 s on non-localhost hosts; features keep working. | Build with no key on localhost. Request the trial on or after 2026-11-01; ask on the PayPal Discord now for a key through 2026-12-15 (G3). | [ag-grid.md](research/ag-grid.md) section 2 |
| 8 | AG Studio licence scope | The Studio licence does not cover `ag-grid-enterprise` or `ag-charts-enterprise` used outside Studio, including inside custom widgets. | The ledger and the custom widget import only `ag-grid-community`, `ag-grid-react`, or plain SVG. Add an ESLint `no-restricted-imports` rule for the two enterprise packages. | [ag-grid.md](research/ag-grid.md) section 2 |
| 9 | Next.js `proxy.ts` body limit | If a `proxy.ts` (the renamed middleware) matches a request, Next buffers the body up to 10 MB (`experimental.proxyClientMaxBodySize`) and silently truncates the rest. Route Handlers themselves have no documented limit. | No `proxy.ts` at all, or a matcher that excludes `/api/deals/:code/files` and `/api/webhooks/paypal`. Enforce the 2 MB per-file limit (H3) in the handler with `content-length` and `File.size`. | [stack.md](research/stack.md) item 5, section 2 |
| 10 | Postgres 18 Docker volume path | On the `postgres:18` images `PGDATA` is `/var/lib/postgresql/18/docker`. Mounting a volume at `/var/lib/postgresql/data` (the pre-18 path) loses the data on every container restart. | `volumes: ['pgdata:/var/lib/postgresql']` in `compose.yaml`. | [stack.md](research/stack.md) section 11 |
| 11 | Prisma 7 config | `env("DATABASE_URL")` in `prisma.config.ts` throws when the variable is unset, which breaks `prisma generate` during `npm ci` on Render and in CI. `.env` is not auto-loaded. `migrate dev` no longer runs `generate` or the seed. The `prisma-client` generator requires `output`. | Config file as shown above; `output = "../generated/prisma"` (repo root `generated/prisma`, imported as `@/generated/prisma/client`) and `generated/` in `.gitignore`; `postinstall` and `build` both run `prisma generate`; `npm run seed` is explicit. | [stack.md](research/stack.md) section 3 |
| 12 | Prisma `Bytes` is `Uint8Array` | `files.bytes` comes back as `Uint8Array`, not `Buffer`, and Prisma selects all scalars by default, so a `findMany` on `files` pulls every photo. | `omit: { bytes: true }` on every query except `GET /api/files/{id}`; `new Response(bytes, ...)` accepts `Uint8Array`. | [stack.md](research/stack.md) item 4, section 3 |
| 13 | Vitest 5 needs `vite` | `vite` is a non-optional peer (`peerDependenciesMeta.vite.optional: false`). An unpinned install resolves it silently; a pinned one must list it. | `vite@8.3.4` in devDependencies. | `npm view vitest@5.0.3 peerDependenciesMeta` today |
| 14 | `zodOutputFormat()` drops enums | The SDK helper moves `enum` and `const` into the field description, so the API no longer enforces them. | Hand-written JSON schemas for both jobs (D2); Zod validates after. Leave a code comment so nobody "simplifies" back to the helper. | [claude-api.md](research/claude-api.md) item 7 |
| 15 | `NODE_ENV=production` as a build env var on Render | `npm ci` would skip devDependencies; `next build` (needs `typescript`, `tailwindcss`) and `preDeployCommand: npx prisma migrate deploy && npm run seed` (needs `prisma` and `tsx`) fail. Render sets it at runtime only. | Do not set `NODE_ENV` in `render.yaml` or the dashboard. | [stack.md](research/stack.md) item 13 |
| 16 | Node `engines` without an upper bound | Render resolves `>=24` to the newest Node release. | `">=24 <27"` plus `.node-version`. | [stack.md](research/stack.md) section 1 |
| 17 | Resend test sender | `onboarding@resend.dev` delivers only to the account owner's address; anything else is a 403 `validation_error`. | Demo personas (F3) are the judges' path; magic links are a bonus for the team address. | [stack.md](research/stack.md) section 7 |
| 18 | PayPal SDK gaps | `@paypal/paypal-server-sdk` has no Payouts controller and no webhook verification, and its cached token is not exposed. Its `timeout` defaults to 0 (none). | Raw `fetch` with a small token cache for `/v1/payments/payouts` and signature verification (E1, E6); construct the client with `timeout: 10_000` ([02-system-design.md](02-system-design.md) section 8.2, [04-api-spec.md](04-api-spec.md) Assumption 27). | [paypal.md](research/paypal.md) section 7 |

## External services and accounts

Eight outside accounts; the only money leaves through Render (inside the $50 credit) and Anthropic (a few dollars).

| Service | Account to create | Used for | Env vars (J3) | Cost | Free-tier limits that matter | Source |
| --- | --- | --- | --- | --- | --- | --- |
| PayPal Developer sandbox | developer.paypal.com: one REST app (type Merchant), `handshake`, on the business account, with a Render webhook and a tunnel webhook on `/api/webhooks/paypal`, each subscribed to the eleven E5 events ([paypal.md](research/paypal.md) section 11; [07-setup-deployment.md](07-setup-deployment.md) section 3.1); three sandbox accounts (custom-balance business, custom-balance buyer, payout receiver) | Orders v2 `AUTHORIZE`, authorize, capture, void, Payouts v1, webhooks, negative testing | `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_API_BASE` (`https://api-m.sandbox.paypal.com`), `PAYPAL_WEBHOOK_ID`, `NEXT_PUBLIC_PAYPAL_CLIENT_ID` | $0 | No published general rate limit; 429 `RATE_LIMIT_REACHED` on unusual traffic; Payouts 400 POST/min; holds valid 29 days, honor period 3 days; webhooks retried up to 25 times over 3 days; webhook URL must be HTTPS on port 443. Whether Payouts needs a feature enabled on the sandbox app is UNVERIFIED (E11). | [paypal.md](research/paypal.md) "Summary", sections 9, 11 |
| Anthropic Console | API key in a new organisation | Term extraction and photo verdicts on `claude-sonnet-5-5`; the 30-case eval; optional Studio agent | `ANTHROPIC_API_KEY`, `AI_MODEL` | Pay as you go. Sonnet 5.5: $2 per MTok in, $10 per MTok out. About $0.08 per deal (extraction + a 10-photo verdict), about $2.40 per 30-case eval run, $30 to $35 for a three-way model comparison with 3 repeats. | Start tier: 1,000 RPM, 2,000,000 input TPM, 400,000 output TPM per model, $500 monthly spend cap. New organisations may start in an Evaluation tier with lower, unpublished limits (UNVERIFIED); check the Console after creating the key. Run the eval at concurrency 3 to 5. | [claude-api.md](research/claude-api.md) sections 1, 9 |
| Render | Hobby workspace ($0); claim the hackathon credit link; Blueprint `render.yaml` | Web service `0.5c-512mb`, Postgres `0.1c-256mb` with `diskSizeGB: 5`, cron `*/10 * * * *` hitting `POST /api/jobs/tick` (J2) | `DATABASE_URL` (from the database), `APP_URL`, `SESSION_SECRET`, `FILE_URL_SECRET`, `CRON_SECRET` (`generateValue: true`), the rest `sync: false` | Web $7/mo, Postgres $6/mo, disk $1.50/mo, cron $1/mo minimum: about $15.50/mo, about $35 from 2026-10-09 to 2026-12-15, inside the $50 credit. Whether the credit covers every line item is UNVERIFIED; check Billing after day 1. | Free web services sleep after 15 min idle and take about 1 min to wake; free Postgres expires 30 days after creation and is deleted 14 days later; no free cron; `preDeployCommand` needs a paid web service. None of the free tiers are used. Hobby includes 5 GB/mo outbound bandwidth, then $0.15/GB. | [stack.md](research/stack.md) section 5 |
| Resend | Account on the team email; API key; no domain verified | Magic-link email (F2) | `RESEND_API_KEY`, `EMAIL_FROM` (`Handshake <onboarding@resend.dev>`) | $0 | 100 emails per UTC day, 3,000 per month, 10 requests/s, 3 domains. The test sender delivers only to the account owner's address; judges cannot receive magic links unless a domain is verified (a "could"). | [stack.md](research/stack.md) section 7 |
| AG Grid | Community: nothing. AG Studio: the 45-day trial form at ag-grid.com/studio/license-pricing, submitted on or after 2026-11-01; a Discord request now for a key through 2026-12-15 | `/ledger` (Community) and `/dashboard` (Studio with custom theme, custom widget, optional Claude agent) | `AG_GRID_LICENSE_KEY` (passed from the server page to the client component; it is validated in the browser, so it is not a secret, but it stays out of git) | $0 | Community is free for production. Studio with no key or an expired key: console banner plus a watermark that fades after about 5 s on non-localhost hosts; nothing is disabled. The AI module needs a PRO-AI tier key; whether the trial key is that tier is UNVERIFIED. | [ag-grid.md](research/ag-grid.md) section 2; [hackathon.md](hackathon.md) |
| Cloudflare quick tunnel | None. `brew install cloudflared` (formula 2026.10.0) | HTTPS URL for the tunnel webhook during local development: `cloudflared tunnel --url http://localhost:3000` | none | $0 | 200 in-flight requests, no server-sent events, and the `*.trycloudflare.com` URL changes every run, so the tunnel webhook's URL is edited each session ([07-setup-deployment.md](07-setup-deployment.md) section 4 step 11). The Render webhook is never edited. | [stack.md](research/stack.md) section 11 |
| GitHub | Public repository `0PrashantYadav0/Handshake` (private today; must be public with `LICENSE` at the root before submission); GitHub Actions enabled | Source, issues in milestones W1 to W5 (J5), CI on every push with a `postgres:18-alpine` service container: `npm ci`, `prisma generate`, `tsc --noEmit`, unit, integration, build | CI secrets: `SESSION_SECRET`, `FILE_URL_SECRET` (test values), `DATABASE_URL` pointing at the service container | $0 | "GitHub Actions usage is free for self-hosted runners and for public repositories that use standard GitHub-hosted runners." While the repo is still private, the Free plan includes 2,000 minutes and 500 MB artifact storage per month. Actions: `actions/checkout@v7`, `actions/setup-node@v7`. | GitHub billing docs (fetched today); [stack.md](research/stack.md) section 10; [hackathon.md](hackathon.md) |
| Docker (local Postgres) | Docker Desktop or any Docker engine | `compose.yaml` running `postgres:18-alpine` with databases `handshake` and `handshake_test` | `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/handshake` | $0 | Volume must mount at `/var/lib/postgresql` (trap 10). Postgres.app with PG 18 is an alternative. | [stack.md](research/stack.md) section 11 |

Not an account, but needed for submission: a YouTube upload of the demo video under 3 minutes ([hackathon.md](hackathon.md)).

## Licence compatibility

The repository is MIT and nothing in this list prevents that.

| Licence | Packages | Compatibility with an MIT repo |
| --- | --- | --- |
| MIT | `next`, `react`, `react-dom`, `pg`, `zod`, `jose`, `resend`, `server-only`, `@anthropic-ai/sdk`, `@paypal/paypal-server-sdk`, `ag-grid-community`, `ag-grid-react`, `vitest`, `vite`, `eslint`, `eslint-config-next`, `tailwindcss`, `@tailwindcss/postcss`, `postcss`, `tsx`, `@types/node`, `@types/react`, `@types/react-dom` | Same licence. No obligation beyond keeping their notices, which stay inside `node_modules`. |
| Apache-2.0 | `@prisma/client`, `@prisma/adapter-pg`, `prisma`, `@paypal/react-paypal-js`, `typescript`, `@playwright/test` | Permissive and compatible with MIT for an application that depends on them. They are consumed unmodified from npm at install time; nothing from them is copied into the repo, so no NOTICE text needs to be reproduced in ours. |
| Commercial | `ag-studio`, `ag-studio-react`, and their transitive `ag-grid-enterprise`, `ag-charts-enterprise`, `ag-stack` | Used under AG Grid's 45-day trial terms, fetched from npm at install. The repo contains only `import` statements and our own widget, theme and agent code, so the repo's MIT licence is unaffected. The trial does not cover `ag-grid-enterprise` or `ag-charts-enterprise` outside Studio; the code never imports them. |

Three more rules keep the repo clean:

- `LICENSE` at the root is the standard MIT text with `Copyright (c) 2026 Prashant Kumar Yadav`, unmodified otherwise, so GitHub's Licensee detects it ([stack.md](research/stack.md) section 12). This is a pass/fail submission requirement (A3).
- PayPal's `hackathon-paypal-ag-grid-boilerplate` has no licence file, so all rights are reserved: patterns may be reused, files may not be copied ([ag-grid.md](research/ag-grid.md) section 6). The licence of AG Grid's documentation example code is UNVERIFIED; the Claude adapter for the Studio agent is written from scratch.
- `node_modules/`, `generated/` (the Prisma client output) and `.env` are git-ignored; `package-lock.json` is committed.

## Assumptions

Choices made here that [decisions.md](decisions.md) does not make explicitly:

1. `vite@8.3.4` is an explicit devDependency because Vitest 5 declares it as a required peer.
2. `dotenv` is not installed; `process.loadEnvFile()` does the job in `prisma.config.ts`, `prisma/seed.ts` and `eval/run.ts`. No research file documents that API, so it is UNVERIFIED until the day-1 check in "Not installed, on purpose" passes on 24.21.0; the research-backed fallback is `dotenv` 18.0.6 with `import 'dotenv/config'` ([stack.md](research/stack.md) section 3). [03-database-schema.md](03-database-schema.md) and [07-setup-deployment.md](07-setup-deployment.md) section 4 step 4 carry the same marker.
3. `@types/pg` is not a direct dependency; it ships with `@prisma/adapter-pg`.
4. No React component unit tests, so no `jsdom`, `@testing-library/react` or `@vitejs/plugin-react`; Vitest runs in the Node environment and the Playwright happy path covers the UI.
5. No coverage tool and no Prettier.
6. `@types/node` is pinned to `24.19.1`, the newest 24.x today, rather than the `^24` range in [stack.md](research/stack.md).
7. ESLint stays at 10.12.0 with peer warnings from three plugins inside `eslint-config-next`; the scratch resolution succeeded with npm 11.19.1. ESLint 9.39.5 is the fallback.
8. Tailwind 4.3.3, `@tailwindcss/postcss` 4.3.3 and `postcss` 8.5.29 come from `npm view` today and Tailwind's Next.js guide, since no research file covers Tailwind. All three are devDependencies.
9. `.npmrc` contains `save-exact=true` and nothing else.
10. Scripts: `build` is `prisma generate && next build`, `postinstall` is `prisma generate`, `lint` is `eslint .`, `typecheck` is `tsc --noEmit`, `test` and `test:int` are the two Vitest projects, `test:e2e` is `playwright test`, `seed` and `eval` run through `tsx`.
11. The Vitest projects are named `unit` and `int`; integration test files end in `.int.test.ts` and run serially.
12. GitHub Actions cost comes from GitHub's billing page fetched today; the repo will be public before judging, so Actions minutes are free.
13. The Prisma client is generated into `generated/prisma` at the repo root (the layout has `app/` and `lib/` at the root, no `src/`), imported as `@/generated/prisma/client` with `paths: { "@/*": ["./*"] }`; the folder is git-ignored and ESLint-ignored.
14. `EMAIL_FROM` is `Handshake <onboarding@resend.dev>` until a domain is verified.
15. Integration tests run `prisma migrate deploy` once from `tests/int/global-setup.ts` against `TEST_DATABASE_URL` (default `postgresql://postgres:postgres@localhost:5432/handshake_test`), and `vitest.config.mts` sets `DATABASE_URL` for the `int` project from the same variable; both files are defined in [06-test-plan.md](06-test-plan.md) "Layout and commands". `TEST_DATABASE_URL` is a test-only variable and is not part of the J3 list.
