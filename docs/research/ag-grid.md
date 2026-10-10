# AG Grid / AG Studio research (as of 2026-10-09)

Scope: what Handshake needs to know to ship a ledger plus a dashboard on AG Grid / AG Studio, and to compete for the AG Grid sponsor prize. Primary sources only. Facts I could not confirm are marked **UNVERIFIED**.

How the sources were read:
- ag-grid.com returns 403 to plain fetchers. It serves every docs page as Markdown when you append `.md` (e.g. `https://www.ag-grid.com/studio/react/quick-start.md`), and those Markdown pages were the source here. Blog posts were read as HTML/Markdown with `Accept: text/markdown`. Live example source files (`/studio/examples/...`) are still blocked.
- I ran `npm pack` on `ag-studio@3.0.0`, `ag-studio-react@3.0.0`, `ag-grid-*@36.2.0` and `ag-charts-*@14.2.0` into `/tmp` (nothing was installed into the repo) and read the shipped code. These claims are cited as **[pkg: file]**.
- I read the boilerplate repo with `gh api`, across all five of its branches.

---

## Summary

- **The prize is really about AG Studio, not the plain grid.** The hackathon page says: "Show us polish: custom widgets, theming, and layout tools, **not just AG Grid or AG Charts on their own**. Take Studio Agent Framework for a spin: a custom agent talking to Studio's built-in agents, or a swapped-in harness." ([devpost/aggrid](https://paypalaihackathon.devpost.com/details/aggrid)). A ledger built only on AG Grid Community would probably not place.
- **Three products, one version train.** AG Studio `3.0.0` (commercial) requires AG Grid `36.2` and AG Charts `14.2` ([compatibility](https://www.ag-grid.com/studio/react/compatibility.md)). `ag-studio` depends on `ag-grid-enterprise ~36.2.0` and `ag-charts-enterprise ~14.2.0` (`npm view ag-studio@3.0.0 dependencies`).
- **The trial is 45 days, so its timing decides whether the key is valid during judging.** A Studio trial requested today (2026-10-09) expires around 2026-11-23, before judging (Dec 1-15). Request it on or after **2026-11-01** (expiry around Dec 16) and ask AG Grid on the PayPal Discord for a key that runs through judging. ([license-pricing](https://www.ag-grid.com/studio/license-pricing/), [devpost](https://paypalaihackathon.devpost.com/details/aggrid))
- **A missing or expired key is cosmetic, not fatal.** The shipped code prints a console banner and shows a watermark that fades after about 5s, only on non-localhost hosts. With no key the banner says "All AG Studio features are unlocked for trial". I found no feature gating. [pkg: `ag-studio/dist/package/main.esm.mjs`]
- **AI needs the "Pro with AI" licence tier.** `AgStudioAiModule` registers licence type `PRO-AI`. A Core or Pro key would be reported as "Incompatible License Key". [pkg] The blog says the trial includes the Agent Framework ([blog](https://www.ag-grid.com/blog/introducing-the-ag-studio-agent-framework/)).
- **The Studio Agent Framework works with any provider, but AG Grid ships no adapters.** "AG Studio does not provide any adapters. Our examples contain an adapter for OpenAI's Responses API" ([ai](https://www.ag-grid.com/studio/react/ai.md)). To use Claude we write one `AgLlmAdapter` with a single `executeTurn` method ([direct-llm-runner](https://www.ag-grid.com/studio/react/ai-direct-llm-runner.md)), plus a server proxy so the key stays on the server.
- **Five built-in agents** (Lead, Planning, Data, Page, Widget) and around 20 built-in tools (`execute_query`, `add_widget`, `add_page_filter`, ...) already answer "show my voided deals this month" once an adapter exists ([builtin-agents](https://www.ag-grid.com/studio/react/ai-builtin-agents.md), [tools-builtin](https://www.ag-grid.com/studio/react/ai-tools-builtin.md)).
- **A custom widget is a plain React component.** It reads `dataMapping` and calls `widgetApi.getData()` and `setDisplayState()`. It is registered with `createWidgets({ additionalTypes })` ([custom-widgets](https://www.ag-grid.com/studio/react/custom-widgets.md), [88-seconds blog](https://www.ag-grid.com/blog/1-prompt-88-seconds-i-added-a-new-chart-type-to-ag-studio-dashboard/)).
- **The boilerplate's `main` branch has no AG Studio code.** Studio lives on the `dashboard`, `dashboard-api` (Studio, theme and OpenAI assistant) and `prototype` branches. The repo has **no licence** (`license: null`), so copy patterns, not code ([repo](https://github.com/paypaldev/hackathon-paypal-ag-grid-boilerplate)).
- **Plain AG Grid v36 for the ledger** uses `<AgGridProvider modules={[AllCommunityModule]}>` (since v35.1) or `ModuleRegistry.registerModules`. The theme is a JS object: `themeQuartz.withParams({...})`. Community is MIT and needs no key ([getting-started](https://www.ag-grid.com/react-data-grid/getting-started.md), [modules](https://www.ag-grid.com/react-data-grid/modules.md), [community-vs-enterprise](https://www.ag-grid.com/react-data-grid/community-vs-enterprise.md)).
- **Bundle cost is large.** The minified, gzipped ESM bundles of the Studio stack add up to about 2 MB before tree-shaking (upper bound). Keep Studio on its own route.
- **There is a live session on Oct 12:** "Build a payments dashboard without building a dashboard" with PayPal's Eddie Jaoude and AG Grid's James Swinton-Bland ([hackathon blog](https://www.ag-grid.com/blog/hackathon-paypal-and-ag-studio/)). The blog post's author, Sylwia Vargas, is AG Grid's Senior Technical Community Manager, which is the judge role mentioned in our brief.

---

## 1. AG Studio vs AG Grid vs AG Charts

| Product | What it is | npm packages (latest = version used here) | Licence |
|---|---|---|---|
| **AG Grid** | Data grid component | `ag-grid-community` 36.2.0, `ag-grid-react` 36.2.0, `ag-grid-enterprise` 36.2.0 | Community: MIT. Enterprise: Commercial (`npm view <pkg> license`) |
| **AG Charts** | Charting library | `ag-charts-community` 14.2.0, `ag-charts-react` 14.2.0, `ag-charts-enterprise` 14.2.0 | Community: MIT. Enterprise: Commercial |
| **AG Studio** | "Embedded analytics component for building interactive dashboards": a drag-and-drop canvas of grid, chart, KPI and filter widgets, with a built-in data engine, cross-filtering and the Agent Framework ([quick-start](https://www.ag-grid.com/studio/react/quick-start.md), [devpost](https://paypalaihackathon.devpost.com/details/aggrid)) | `ag-studio` 3.0.0, `ag-studio-react` 3.0.0 (released 2026-09-16, `npm view ag-studio time`) | Commercial. "Every deployment requires a licence" ([enterprise-licence](https://www.ag-grid.com/studio/react/enterprise-licence.md)) |

Facts about Studio:
- Installing `ag-studio-react` also installs `ag-studio`. The two versions must be identical ([installation](https://www.ag-grid.com/studio/react/installation.md)).
- `ag-studio` depends on `ag-stack ~36.2.0`, `ag-grid-enterprise ~36.2.0` and `ag-charts-enterprise ~14.2.0`.
- `ag-studio-react` depends on `ag-grid-react ~36.2.0`. Its peer dependencies are `react`/`react-dom` `^17 || ^18 || ^19` (npm view).
- Compatibility: React 17-19+ for Studio 2-3+. **TypeScript >= 5.8.3**. Studio 3.0 requires AG Grid 36.2 and AG Charts 14.2 ([compatibility](https://www.ag-grid.com/studio/react/compatibility.md)).
- Standalone AG Grid on the same page as Studio must use the Theming API (no legacy CSS themes) ([compatibility](https://www.ag-grid.com/studio/react/compatibility.md)).
- Release cadence: 1.0 on 03-26, 1.1 on 05-13, 2.0 on 06-25, 2.1 on 08-05, 3.0 on 09-16 (`npm view ag-studio time`). A 3.1 could land before judging, so **pin exact versions**.

Next.js / SSR:
- The docs examples all start with `"use client"`. `ag-studio-react/dist/package/index.esm.mjs` has no `"use client"` directive and uses a React class `Component` [pkg], so Studio must be imported from a client component.
- The boilerplate renders `<AgStudio>` from a `'use client'` file and passes the data as props from an async server page (no `next/dynamic`). See `app/dashboard/studio-dashboard.tsx` on the `dashboard` branch ([repo](https://github.com/paypaldev/hackathon-paypal-ag-grid-boilerplate/tree/dashboard)). That suggests server rendering of the client component works. **UNVERIFIED**: I did not run it. Fallback: `dynamic(() => import('./studio'), { ssr: false })` inside a client component.
- AG Grid: "If using server-side rendering, ensure modules are registered in the client side of your application" ([modules](https://www.ag-grid.com/react-data-grid/modules.md)). AG Grid's own Next.js article uses a `"use client"` component with `ModuleRegistry.registerModules([AllCommunityModule])` ([blog](https://www.ag-grid.com/blog/using-ag-grid-with-next-js-to-build-a-react-table/)).

AG Grid also offers AI skills for coding agents: `npx skills add ag-grid/skills` (`ag-dev`, `ag-update`; the repo is MIT) ([skills](https://www.ag-grid.com/studio/react/skills.md), [github](https://github.com/ag-grid/skills)). This is worth installing for whoever writes the Studio code.

---

## 2. Licensing

### What needs a licence
- **AG Grid Community:** "Free for everyone, including production use - no licence required" ([community-vs-enterprise](https://www.ag-grid.com/react-data-grid/community-vs-enterprise.md)). It covers sorting, filtering, pagination, cell renderers, themes and the quick filter. That is everything the ledger needs.
- **AG Grid Enterprise** is needed for the server-side row model, Excel export, pivot/aggregation, range selection, integrated charts, master/detail, row grouping, clipboard, tool panels and context menus (same page).
- **AG Studio:** commercial; every deployment needs a licence. "An AG Studio licence covers AG Studio and its built-in grid and charts widgets only. It does not extend to AG Grid Enterprise or AG Charts Enterprise used outside of AG Studio, **including in custom widgets**" ([enterprise-licence](https://www.ag-grid.com/studio/react/enterprise-licence.md)). The same rule appears in [custom-widgets](https://www.ag-grid.com/studio/react/custom-widgets.md). So custom widgets and the ledger must use **Community** modules only, even though `ag-grid-enterprise` is in `node_modules` as a transitive dependency.
- **Studio licence tiers** found in code: `STUDIO-CORE`, `STUDIO-PRO`, `STUDIO-PRO-AI`.
  - `AgStudioAiModule` declares `license: "PRO-AI"`.
  - `validLicense()` accepts a PRO-AI key for everything, a PRO key for anything except AI, and a CORE key for core only. [pkg]
  - The trial "includes the Studio Agent Framework" ([blog](https://www.ag-grid.com/blog/introducing-the-ag-studio-agent-framework/)). **UNVERIFIED** that the trial key is typed PRO-AI; check the console after installing it.

### Trial
- **AG Studio: a 45-day trial.** "Start your 45-day enterprise trial. Explore the full enterprise capabilities of AG Studio with no restrictions or watermarks. Full enterprise features. 45 days of access. Engineering support." It is a form (first name, last name, email) on [studio/license-pricing](https://www.ag-grid.com/studio/license-pricing/). Devpost links the same "free 45-day trial license" ([devpost](https://paypalaihackathon.devpost.com/details/aggrid)).
- **UNVERIFIED:** how fast the key arrives. It presumably comes by email.
- AG Grid / AG Charts Enterprise use a **30-day** Enterprise Bundle trial instead ([community-vs-enterprise](https://www.ag-grid.com/react-data-grid/community-vs-enterprise.md)). We should not need it.
- **No hackathon or open-source licence is published.** Devpost says: "For any trial issues or hackathon questions: Connect with the AG Grid team via the PayPal Discord" ([devpost](https://paypalaihackathon.devpost.com/details/aggrid)). Whether they will issue a key that lasts through judging is **UNVERIFIED**. Ask early.

### Setting the key
Studio, v3 ([licence-install](https://www.ag-grid.com/studio/react/licence-install.md)):
```tsx
import { AgStudio, AgStudioProvider } from 'ag-studio-react';

<AgStudioProvider licenseKey={licenseKey} modules={[AgStudioAiModule] /* only if AI */}>
  <AgStudio /* ... */ />
</AgStudioProvider>
// Older style, still exported: import { AgStudioLicenseManager } from 'ag-studio'; AgStudioLicenseManager.setLicenseKey(key);
```
AG Grid Enterprise, which we should not need ([license-install](https://www.ag-grid.com/react-data-grid/license-install.md)): `<AgGridProvider modules={[AllEnterpriseModule]} licenseKey="...">`. Before 35.1 it was `LicenseManager.setLicenseKey()` from `ag-grid-enterprise`. AG Charts uses `LicenseManager.setLicenseKey` from `ag-charts-enterprise` ([charts license-install](https://www.ag-grid.com/charts/react/license-install.md)).

Boilerplate pattern: the server page reads `process.env.AG_STUDIO` and passes it as a prop to the client component (`app/dashboard/page.tsx`, `dashboard` branch). The key is validated in the browser, so it always ends up client-side. That makes it equivalent to a `NEXT_PUBLIC_` variable. Keep it out of git, but it is not a server secret.

### What happens with no key, an expired trial or a wrong key
From [pkg: `ag-studio@3.0.0/dist/package/main.esm.mjs`, `LicenseManager`], the same logic as `ag-grid-enterprise@36.2.0`:

| Situation | Console | Watermark | Features |
|---|---|---|---|
| No key | Banner: "License Key Not Found ... All AG Studio features are unlocked for trial" | Text "For Trial Use Only" | All work |
| Trial key past expiry | Banner: "Trial Period Expired. Your trial only license ... expired on <date>" | "Trial Period Expired" | All work (no gating code found) |
| Invalid key, or wrong tier (e.g. Core key plus AI module) | "Invalid License Key" / "Incompatible License Key" | Yes | All work (no gating code found) |
| Valid key | None | None | All work |

How the watermark behaves:
- It only shows when the host is **not localhost** (`isDisplayWatermark = forceWatermark || (!isLocalhost && !isWebsiteUrl && message)`).
- It is rendered, set to opacity 0 on the next tick, and hidden after 5 s (`setTimeout(() => this.setDisplayed(false), 5e3)`).
- So on Render, judges would see a watermark that fades out on each Studio mount, plus a red console banner. That is not breaking, but it looks careless to a sponsor judge.
- **UNVERIFIED:** exact visual prominence. I did not render it.
- The docs agree: "You can test AG Studio locally without a licence. To test in production, access support, and remove the watermark and console warnings, Request a Trial Licence" ([installation](https://www.ag-grid.com/studio/react/installation.md)).

Trial expiry is checked against the browser clock (`trialExpired = expiry < new Date()`), so nothing on the server can extend it.

---

## 3. AG Studio quick start (React)

Minimal setup: `npm install ag-studio-react`. Each array of plain objects becomes a data source. Render `AgStudio` in a sized parent. `mode` is `'edit' | 'view'` ([quick-start](https://www.ag-grid.com/studio/react/quick-start.md), [pkg types `AgStudioMode`]).

Docs guidance for references ([react-best-practices](https://www.ag-grid.com/studio/react/react-best-practices.md)):
- Hold `data` in `useState`. New object references cause re-renders and recalculation.
- Use `useMemo` or `useState` for object props (`panels`, `layout`, `overrides`).
- Use `useCallback` for function props.
- Call `enableStudioDevValidations()` only in development ([installation](https://www.ag-grid.com/studio/react/installation.md)).

Data sources ([data-setup](https://www.ag-grid.com/studio/react/data-setup.md), [loading-data](https://www.ag-grid.com/studio/react/loading-data.md), boilerplate `dashboard` branch):
- `sources[]` entries have the shape `{ id, name?, description?, data, fields: [{ id, name, format, hide?, description? }] }`.
- Built-in formats: `textFormat`, `integerFormat`, `decimalFormat`, `booleanFormat`, `percentageFormat`, `currencyFormat`, `dateFormat`, `dateTimeFormat` ([formatting](https://www.ag-grid.com/studio/react/formatting.md)).
- `relationships[]` joins tables (`many-to-one`). `expressions[]` adds calculated measures. Formats can be overridden, e.g. `createFormats({ overrides: { currencyFormat: { formatOptions: { format: '$#,##0.00' } } } })`.
- The top-level `description` and the table descriptions feed the agents' `schema()` context ([ai-context](https://www.ag-grid.com/studio/react/ai-context.md)). Write them for the LLM.
- Async and server-side data engines exist ([server-side-data](https://www.ag-grid.com/studio/react/server-side-data.md)). Sync arrays are enough at hackathon scale.

Initial dashboard: the `initialState: AgReportState` contains pages and widgets.
- Each widget has `type`, `format`, `dataMapping` and an optional `sort`. Layout is set per widget with `xTrack/yTrack/xSpan/ySpan`. The canvas is 24 columns wide with 16 px rows (boilerplate `app/dashboard/initial-state.ts`).
- Persist state with `api.getState()` / `api.setState()` / `onStateUpdated` ([state](https://www.ag-grid.com/studio/react/state.md)). The boilerplate's `dashboard-api` branch saves reports to `localStorage`.

Built-in widget types (`type` values in [widget-catalogue](https://www.ag-grid.com/studio/react/widget-catalogue.md)):
- KPI and tables: `value`, `grid`, `pivot-grid`.
- Column and bar charts: `column-chart-grouped|stacked|stacked-100`, `bar-chart-*`.
- Line and area charts: `line-chart`, `area-chart*`.
- Proportional, polar and progression charts: `pie-chart`, `donut-chart`, `funnel-chart`, `radial-gauge`, `linear-gauge`.
- Hierarchical charts: `treemap-chart`, `sunburst-chart`.
- Scatter and bubble: `scatter-chart`, `bubble-chart`.
- Combo charts: `combo-chart-*`.
- Filters: `button-filter`, `list-filter`, `date-filter`.
- Static content: `text`, `image`.

Theming ([theming](https://www.ag-grid.com/studio/react/theming.md), boilerplate `dashboard-api` `config/theme.ts`):
- `studioTheme.withParams({...})` passed to `<AgStudio theme={...}>`.
- One set of params covers the Studio chrome (`studioCanvas*`, `studioWidget*`, `studioPanel*`), grid widgets (`grid*`) and charts (`chart*`, `chartPaletteFills1..10Color`).
- The boilerplate points every param at CSS variables (`var(--pp-ink)`), so Tailwind tokens and Studio stay in sync.
- For dark mode, swap the `theme` prop.

Sketch for Handshake (adapted from the boilerplate `dashboard` branch and quick-start; not run):
```tsx
// app/(platform)/dashboard/handshake-studio.tsx
'use client';
import { useState } from 'react';
import { createFormats, enableStudioDevValidations, studioTheme,
  type AgDataSourcesDefinition, type AgReportState } from 'ag-studio';
import { AgStudio, AgStudioProvider } from 'ag-studio-react';

if (process.env.NODE_ENV !== 'production') enableStudioDevValidations();

export type DealRow = {
  code: string; item: string; status: 'OPEN'|'FUNDED'|'IN_REVIEW'|'CAPTURED'|'VOIDED';
  amountUsd: number;            // minor units / 100, computed on the server (display only)
  createdAt: string; deadline: string; verdict: 'RELEASE'|'VOID'|'ESCALATE'|null;
  confidence: number | null;    // 0..1
};

const theme = studioTheme.withParams({
  fontFamily: 'var(--hs-font)', accentColor: 'var(--hs-accent)',
  studioWidgetBorderRadius: 8, studioCanvasBackgroundColor: 'var(--hs-canvas)',
});

const initialState: AgReportState = {
  version: '3.0.0',
  selectedPageId: 'money',
  pages: [{
    id: 'money',
    widgets: {
      held:     { type: 'value', format: { title: { enabled: true, text: 'Held' } },
                  dataMapping: { value: [{ id: 'deals.amountUsd', aggregation: 'sum' }] } },
      byStatus: { type: 'column-chart-grouped', format: { title: { enabled: true, text: 'Deals by status' } },
                  dataMapping: { categoryKey: [{ id: 'deals.status' }],
                                 valueKey: [{ id: 'deals.code', aggregation: 'count' }] } },
      status:   { type: 'button-filter', format: { title: { enabled: true, text: 'Status' } },
                  dataMapping: { value: [{ id: 'deals.status' }] } },
    },
    // widgetLayout: { held: { xTrack: 0, yTrack: 0, xSpan: 6, ySpan: 8 }, ... }
  }],
};

export function HandshakeStudio({ deals, licenseKey }: { deals: DealRow[]; licenseKey?: string }) {
  const [data] = useState<AgDataSourcesDefinition>(() => ({
    description: 'Handshake pay-on-proof deals. PayPal holds the buyer\'s money; an AI verdict releases (capture) or voids it.',
    sources: [{
      id: 'deals',
      description: 'One row per deal. amountUsd is the held amount in US dollars.',
      data: deals,
      fields: [
        { id: 'code', name: 'Deal code', format: 'textFormat' },
        { id: 'item', name: 'Item', format: 'textFormat' },
        { id: 'status', name: 'Status', format: 'textFormat' },
        { id: 'amountUsd', name: 'Amount', format: 'currencyFormat' },
        { id: 'createdAt', name: 'Created', format: 'dateTimeFormat' },
        { id: 'deadline', name: 'Deadline', format: 'dateTimeFormat' },
        { id: 'verdict', name: 'AI verdict', format: 'textFormat' },
        { id: 'confidence', name: 'Verdict confidence', format: 'percentageFormat' },
      ],
    }],
    formats: createFormats({ overrides: { currencyFormat: { formatOptions: { format: '$#,##0.00' } } } }),
  }));
  return (
    <AgStudioProvider licenseKey={licenseKey}>
      <AgStudio data={data} theme={theme} initialState={initialState} mode="view"
                style={{ height: '100vh', width: '100%' }} />
    </AgStudioProvider>
  );
}
```
Note: Studio dates. The boilerplate passes `Date` objects from a server page into the client component. Next serialises them across the RSC boundary. **UNVERIFIED** whether Studio accepts ISO strings for `dateTimeFormat` fields; test both.

### Custom widgets
Sources: [custom-widgets](https://www.ag-grid.com/studio/react/custom-widgets.md) and [blog](https://www.ag-grid.com/blog/1-prompt-88-seconds-i-added-a-new-chart-type-to-ag-studio-dashboard/).
- **Definition:** `{ id, label, icon?, dataMapping, form, comp, defaultSize, minSize, ai?, formatShape? }`, passed to `createWidgets()` from **`ag-studio-react`**, then to `<AgStudio widgets={...}>`.
- **AI:** for agents to place and configure the widget, both `formatShape` and `ai` must be set.
- **Component props:** `AgWidgetParams` carries `{ api, widgetApi, dataMapping, format, sort, config, widgetId, context }`.
- **widgetApi:** `getData()`, `setDisplayState('loading'|'displayed'|'noData'|'incompleteDataMapping')`, `toggleCrossFilter()`, `getSchema()`, `formatFieldValue()`, `exportCsv()` [pkg types `AgWidgetApi`].
- **Filters:** page filters, widget filters and cross-filters are applied to `getData` automatically.
- **Theming:** inside a widget, use `studioGridTheme` for AG Grid and `getChartTheme(api)` for AG Charts so they match the report theme.

```tsx
// Widget component pattern, from the AG Grid blog (React function component)
export function VerdictBand(params: AgWidgetParams<VerdictBandDef>) {
  const { widgetApi, dataMapping } = params;
  const verdict = dataMapping.verdict?.[0];
  const amount = dataMapping.amount?.[0];
  const [rows, setRows] = useState<{ verdict: string; amount: number }[] | null>(null);
  useEffect(() => {
    if (!verdict || !amount) { widgetApi.setDisplayState('incompleteDataMapping'); return; }
    widgetApi.setDisplayState('loading');
    let cancelled = false;
    widgetApi.getData({ fields: [verdict, amount] }).then(({ results }) => {
      if (cancelled) return;
      setRows(results.rows.map((r) => ({ verdict: String(r[verdict.key]), amount: Number(r[amount.key]) })));
      widgetApi.setDisplayState('displayed');
    });
    return () => { cancelled = true; };
  }, [widgetApi, verdict, amount]);
  if (!rows) return null;
  return <EscrowFlowSvg rows={rows} />;   // plain SVG/CSS: no extra licence, no extra dependency
}
// Registration: createWidgets({ additionalTypes: [{ id: 'escrow-flow', label: 'Escrow flow',
//   dataMapping: { verdict: { type: 'field', supportedRoles: ['category'], requires: { cardinality: 'many' }, required: true },
//                  amount:  { type: 'field', supportedRoles: ['numeric'],  requires: { per: 'dataMapping.verdict', cardinality: 'one' }, required: true } },
//   form: (p) => p.createDefaults({ dataMappingItems: [{ key: 'verdict', label: 'Verdict' }, { key: 'amount', label: 'Amount' }] }),
//   comp: VerdictBand, defaultSize: { width: 600, height: 300 },
//   ai: { description: 'Shows how held money flowed to released (captured) or voided.' } }],
//   menu: [...defaults.menu, { label: 'Handshake', widgetIds: ['escrow-flow'] }] })
```
**UNVERIFIED:** whether `results.rows` / `field.key` are the exact property names for the default flat query in 3.0.0. They come from the blog snippet. Check them against `AgWidgetDataResponse` in `ag-studio/dist/types` when coding.

---

## 4. Studio Agent Framework

What it is, per the [ai docs](https://www.ag-grid.com/studio/react/ai.md) and the [blog](https://www.ag-grid.com/blog/introducing-the-ag-studio-agent-framework/):
- "Lets users explore data and build or modify dashboards using natural language and an LLM supplied by your application."
- AG Studio provides no models, servers or backends: "No Model, No Servers, No per-query bill".
- It is opt-in through `AgStudioAiModule`. Agents and users share the same powers, so a user can finish what the agent started.

Its pieces:
- **Harness:** `createAiHarness`. It runs in the browser, keeps the conversation and renders the built-in chat panel. You can replace it ([ai-custom-harness](https://www.ag-grid.com/studio/react/ai-custom-harness.md)).
- **Agents:** five are built in. The Lead is primary and delegates to Planning, Data, Page and Widget through `delegate_to` ([builtin-agents](https://www.ag-grid.com/studio/react/ai-builtin-agents.md)).
- **Runners** ([ai-agents](https://www.ag-grid.com/studio/react/ai-agents.md)):
  - `directLlmRunner`: you bring an adapter; Studio runs the loop and the tools.
  - `clientToolRunner`: you bring a server request; Studio executes the tools you leave unresolved.
  - Custom `{...def, run}`: your own loop, e.g. CopilotKit or the AI SDK.
- **Events:** structurally compatible with AG-UI.
- **Tools:**
  - Reading: `view_schema`, `view_report`, `view_page`, `view_widget`, `execute_query`.
  - Page changes: `add_widget`, `position_widget`, `remove_widget`, `configure_widget`.
  - Expressions: `create|update|delete_expression`.
  - Filters: `add|remove_page_filter`, `add|remove_widget_filter`.
  - Harness: `create_plan`, `delegate_to`, `rename_thread`, ...
  - Custom tools: `api.defineAiTool({ name, description, params: s => s.object(...), execute })` ([custom-tools](https://www.ag-grid.com/studio/react/ai-custom-tools.md)).
- **WebMCP:** the same tools are exposed over WebMCP, so an external harness can drive Studio ([ai-webmcp](https://www.ag-grid.com/studio/react/ai-webmcp.md), [who-owns-the-harness](https://www.ag-grid.com/blog/who-owns-the-harness/)).
- **What leaves the browser:** only what the adapter sends. That is the conversation, the instructions and the tool schemas (which include field ids). Row values leave only through tool results such as `execute_query` ([ai](https://www.ag-grid.com/studio/react/ai.md)).

**Does it work with Claude?** Yes, by design: it is provider-agnostic. But "AG Studio does not provide any adapters"; the only example adapter targets OpenAI's Responses API. The boilerplate's `dashboard-api` branch copies that adapter verbatim and proxies it through `app/api/ai/responses/route.ts` with the OpenAI key on the server. We write a Claude adapter ourselves. That is in fact a good story for the judges: "swapped-in provider".

The adapter contract ([direct-llm-runner](https://www.ag-grid.com/studio/react/ai-direct-llm-runner.md), [pkg types `agLlmAdapter.d.ts`, `agAiMessage.d.ts`, `agAiProtocol.d.ts`]):

**Interface**
```ts
interface AgLlmAdapter { executeTurn(request: AgLlmRequest, options?: { signal?: AbortSignal }): AgLlmResponseHandler }
```

**Request fields**
- `input: AgAiConversationItem[]`: input messages, output messages, `function_call` items `{callId, name, arguments}`, `function_call_output` items `{callId, output}`, and reasoning.
- `instructions`.
- `tools: AgAiToolSchema[]`: `{name, description, parameters: JSONSchema, kind}`.
- `toolChoice`.
- `responseFormat`: the built-in code only uses `{type:'text'}` [pkg].
- `model?`.

**Return value**
- `{ stream: AsyncIterable<AgAiEvent>, complete: Promise<AgLlmResponse> }`.
- Stream events: `TEXT_MESSAGE_START|CONTENT|END`, `REASONING_MESSAGE_*`, `TOOL_CALL_START{toolCallId, toolCallName}|ARGS{delta}|END`, plus `*_CHUNK` shorthands.
- `complete` resolves to `{ id, createdAt, status, output: AgAiOutputItem[], usage?, error? }`.

**Rules**
- The adapter **does not execute tools**. It relays them, and Studio executes them.
- Keep keys off the client: point `executeTurn` at your own backend ([direct-llm-runner](https://www.ag-grid.com/studio/react/ai-direct-llm-runner.md)).

Proposed design. It is my design, not from the AG docs, and **UNVERIFIED** until built.
- **Client:** `claudeAdapter({ endpoint: '/api/studio-ai' })`. It POSTs the `AgLlmRequest` and reads NDJSON lines that are already `AgAiEvent`s. The last line is `{type:'CUSTOM', name:'complete', value: AgLlmResponse}`, which resolves `complete`.
- **Server:** `app/api/studio-ai/route.ts`. It uses `@anthropic-ai/sdk` and the model id from `docs/research/claude-api.md`.
  - Map `instructions` to `system`.
  - Map `input` to Anthropic `messages`: `function_call` becomes an assistant `tool_use{ id: callId, name, input: JSON.parse(arguments) }`, and `function_call_output` becomes a user `tool_result{ tool_use_id: callId, content: output }`.
  - Map `tools` to `{ name, description, input_schema: parameters }`.
  - Stream the response and translate: `content_block_start(text)` to `TEXT_MESSAGE_START`, `text_delta` to `TEXT_MESSAGE_CONTENT`, `content_block_start(tool_use)` to `TOOL_CALL_START`, `input_json_delta` to `TOOL_CALL_ARGS`, `content_block_stop` to the matching `*_END`.
  - Build `output[]`, then emit the final `complete` line.
  - Enforce a model allowlist and a `max_tokens` cap, and rate-limit. The boilerplate route caps output tokens at 32k and checks models against `OPENAI_MODELS`.
- **Risks:**
  - Extended thinking blocks must be passed back verbatim on Claude 5.5 models (see `docs/research/claude-api.md`), and `AgAiReasoningItem` has no signature field. So **run the Studio agent with thinking disabled**, on Sonnet or Haiku. **UNVERIFIED**.
  - Built-in tool schemas were written with OpenAI strict mode in mind. The OpenAI adapter has to transform them; Anthropic should accept plain JSON Schema. **UNVERIFIED**.

Wiring it up ([ai-quickstart](https://www.ag-grid.com/studio/react/ai-quickstart.md), [builtin-agents](https://www.ag-grid.com/studio/react/ai-builtin-agents.md), boilerplate `ag-studio-paypal.tsx`):
```tsx
import { AgStudioAiModule, createAiHarness, directLlmRunner, type AgAiHarnessSetup } from 'ag-studio';
import { claudeAdapter } from './claude-adapter';

const adapter = claudeAdapter({ endpoint: '/api/studio-ai' });

const ai: AgAiHarnessSetup = ({ api }) => createAiHarness(api, ({ builtIn, tools: { studio } }) => ({
  agents: [
    ...Object.values(builtIn).map((d) => directLlmRunner({ ...d, adapter })),
    directLlmRunner({                      // "custom agent talking to Studio's built-in agents"
      id: 'auditor', name: 'Deal auditor', adapter,
      description: 'Explains why a deal was released or voided, citing the AI verdict and evidence summary.',
      instructions: () => 'You audit Handshake deals. Use explain_verdict, then view_schema/execute_query for context.',
      tools: () => [studio.viewSchema(), studio.executeQuery(), explainVerdict(api)],
    }),
  ],
  primary: 'lead',
}));
// explainVerdict = api.defineAiTool({ name: 'explain_verdict', params: s => s.object({ code: s.string() }),
//   execute: async ({ code }, ctx) => ctx.success('ok', await fetch(`/api/deals/${code}/verdict`, { signal: ctx.signal }).then(r => r.json())) })

<AgStudioProvider licenseKey={key} modules={[AgStudioAiModule]}>
  <AgStudio data={data} ai={ai} mode="edit" /* promptStarters/models via createAiHarness options */ />
</AgStudioProvider>
```
Prompt starters and model pickers are options on `createAiHarness(api, { adapter, promptStarters, models })` (boilerplate). **UNVERIFIED:** how to combine `promptStarters` with the function form `createAiHarness(api, (cfg) => ({...}))`. See [ai-builtin-harness](https://www.ag-grid.com/studio/react/ai-builtin-harness.md).

**"Show my voided deals this month"?** Yes, as long as the date field is typed `dateTimeFormat` and the descriptions are good. The Lead delegates to the Data agent (`view_schema`, `execute_query`) and the Widget agent (`add_widget`, `configure_widget`, `add_page_filter`). This is the built-in flow, and AG Grid's own suggested idea is the same pattern ("show PayPal revenue by customer segment this month generates a live widget", [devpost](https://paypalaihackathon.devpost.com/details/aggrid)).

**Effort:**
- Claude adapter plus proxy route: 5-8 h.
- Built-in harness wiring and prompt starters: 1-2 h.
- Custom agent plus one custom tool: 2-4 h.
- Eval and prompt tuning on our data: 2-3 h.
- **Total about 10-16 h.**

---

## 5. AG Grid React for the ledger

Sources:
- [getting-started](https://www.ag-grid.com/react-data-grid/getting-started.md): `AgGridProvider`, `AllCommunityModule`, parent `div` with a height.
- [modules](https://www.ag-grid.com/react-data-grid/modules.md): v33+ requires modules. Since 35.1 use `AgGridProvider`; `ModuleRegistry.registerModules` still works globally. Register on the client.
- [themes](https://www.ag-grid.com/react-data-grid/themes.md): Quartz is the default. `theme={themeBalham}` etc.
- [theming-api](https://www.ag-grid.com/react-data-grid/theming-parameters.md): `themeQuartz.withParams({ accentColor, spacing, fontFamily, ... })`.
- [theming-colors](https://www.ag-grid.com/react-data-grid/theming-colors.md): `themeQuartz.withPart(colorSchemeDark)`.
- [filter-quick](https://www.ag-grid.com/react-data-grid/filter-quick.md): `quickFilterText` prop plus `QuickFilterModule` (included in `AllCommunityModule`).
- [grid-events](https://www.ag-grid.com/react-data-grid/grid-events.md): `rowClicked`.
- Symbols confirmed in 36.2.0 type definitions: `AgGridProvider`, `CustomCellRendererProps` (ag-grid-react), `themeQuartz`, `colorSchemeDark`, `QuickFilterModule` (ag-grid-community) [pkg].

```tsx
// app/deals/ledger-grid.tsx: AG Grid Community only (MIT, no key)
'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AllCommunityModule, themeQuartz, type ColDef, type ValueFormatterParams } from 'ag-grid-community';
import { AgGridProvider, AgGridReact, type CustomCellRendererProps } from 'ag-grid-react';

export type LedgerRow = {
  code: string; item: string; counterparty: string;
  amountMinor: number; currency: string;            // integer minor units from Postgres
  status: 'OPEN'|'FUNDED'|'IN_REVIEW'|'CAPTURED'|'VOIDED';
  deadline: string; lastEvent: string; confidence: number | null;
};

const modules = [AllCommunityModule];               // ponytail: whole Community bundle; pick modules if bundle matters
const theme = themeQuartz.withParams({ accentColor: 'var(--hs-accent)', fontFamily: 'inherit', spacing: 6 });

const money = (p: ValueFormatterParams<LedgerRow, number>) =>
  p.value == null || !p.data ? '' :
  new Intl.NumberFormat('en-US', { style: 'currency', currency: p.data.currency }).format(p.value / 100);
// ponytail: /100 assumes 2-decimal currencies (USD); use per-currency exponent if JPY etc. appear

function StatusPill({ value }: CustomCellRendererProps<LedgerRow, LedgerRow['status']>) {
  return <span className={`pill pill-${value?.toLowerCase()}`}>{value}</span>;
}
function CodeLink({ value }: CustomCellRendererProps<LedgerRow, string>) {
  return <Link href={`/deals/${value}`}>{value}</Link>;  // keyboard-accessible path to the deal
}

export function LedgerGrid({ rows }: { rows: LedgerRow[] }) {
  const router = useRouter();
  const [quick, setQuick] = useState('');
  const columnDefs = useMemo<ColDef<LedgerRow>[]>(() => [
    { field: 'code', cellRenderer: CodeLink, pinned: 'left', width: 120 },
    { field: 'item', flex: 1 },
    { field: 'counterparty' },
    { field: 'amountMinor', headerName: 'Amount', valueFormatter: money, filter: 'agNumberColumnFilter', type: 'rightAligned' },
    { field: 'status', cellRenderer: StatusPill, filter: true },
    { field: 'deadline', valueFormatter: (p) => p.value ? new Date(p.value).toLocaleString() : '', sort: 'asc' },
    { field: 'lastEvent', headerName: 'Last event' },
    { field: 'confidence', headerName: 'Verdict confidence',
      valueFormatter: (p) => p.value == null ? '-' : `${Math.round(p.value * 100)}%` },
  ], []);
  return (
    <AgGridProvider modules={modules}>
      <input type="search" placeholder="Search deals" value={quick} onChange={(e) => setQuick(e.target.value)} />
      <div style={{ height: 560 }}>
        <AgGridReact<LedgerRow>
          theme={theme}
          rowData={rows}
          columnDefs={columnDefs}
          defaultColDef={{ sortable: true, filter: true, resizable: true }}
          quickFilterText={quick}
          getRowId={(p) => p.data.code}
          onRowClicked={(e) => e.data && router.push(`/deals/${e.data.code}`)}
        />
      </div>
    </AgGridProvider>
  );
}
```
How the page uses it:
- `app/deals/page.tsx` is a server component. It runs the Prisma query and maps rows to plain JSON (`BigInt` to `number`, `Date` to ISO string), then renders `<LedgerGrid rows={rows} />`.
- Sorting on `amountMinor` sorts the raw integers, which is correct.
- The quick filter matches the raw value, not the formatted one, unless a column sets `getQuickFilterText` ([filter-quick](https://www.ag-grid.com/react-data-grid/filter-quick.md)).

To match Studio's look in a standalone grid, use `studioGridTheme` from `ag-studio` ([custom-widgets](https://www.ag-grid.com/studio/react/custom-widgets.md)). Importing it would pull Studio into the ledger route, though, so mirror the params with `themeQuartz.withParams` instead.

---

## 6. PayPal's boilerplate

Sources: [repo](https://github.com/paypaldev/hackathon-paypal-ag-grid-boilerplate), `gh api`.

**Repo facts**
- Created 2026-09-25; last pushed 2026-10-08.
- `license: null`: **there is no licence file, so all rights are reserved by default.** Reuse ideas and patterns; do not copy files wholesale.
- The `openai-adapter.ts` in it says "Copied verbatim from the AG Studio 3.0.0 docs example". **UNVERIFIED** under what licence AG's docs example code is offered.

**Branches**

| Branch | What it is | Pins |
|---|---|---|
| `main` (4 commits, latest 2026-10-02 "docs: hackathon") | **No AG Studio.** Server pages read PayPal sandbox data through `@paypal/paypal-server-sdk` (`lib/paypal.ts`: `TransactionSearchController.searchTransactions`, `SubscriptionsController.listBillingPlans`, `searchBalances`) and render plain HTML tables (`app/data-table.tsx`). `await connection()` forces per-request rendering | `next 16.3.6`, `react 19.2.8`, `@paypal/paypal-server-sdk ^2.5.0`, Tailwind 4 |
| `dashboard` (2026-10-02) | Adds an AG Studio dashboard. The server page (`app/dashboard/page.tsx`) calls `getDashboardData()` and passes `licenseKey={process.env.AG_STUDIO}` to a `'use client'` `StudioDashboard`. That component has 7 data sources with descriptions, `relationships` (a `manyToOne` helper), an `expressions` count measure, `createFormats` currency override, `initialState` (KPIs, button filters, bar/column charts, pivot grid) and `mode="edit"` | `ag-studio 3.0.0`, `ag-studio-react 3.0.0` (exact) |
| `dashboard-api` (WIP, 2026-10-08) | Full app shell around Studio. `theme.ts` maps every param to CSS variables. Saved reports live in `localStorage` with undo/redo through `api.getHistory()`. **AI assistant:** `createAiHarness(api, { adapter: openaiAdapter({ endpoint: '/api/ai' }), promptStarters, models })` plus `AgStudioAiModule`. Server proxy `app/api/ai/responses/route.ts` adds the key, enforces a model allowlist (`OPENAI_MODELS`), caps `max_output_tokens` at 32k and streams SSE back. `env.example`: `PAYPAL_CLIENT_ID`, `PAYPAL_SECRET`, `AG_STUDIO_OPENAI_API_KEY`, `OPENAI_MODELS` | same |
| `prototype` (2026-09-23) | Earlier experiment: seeding scripts, an AG Studio dashboard, and a generic `json-grid.tsx` using `ag-grid-community` with `ModuleRegistry.registerModules([AllCommunityModule])` | `ag-grid-community ^36.2.0`, `ag-studio ^3.0.0` |
| `rest-api` | Swaps the SDK for direct REST calls | none |

**Patterns to reuse**
- A server page fetches data and passes plain rows plus `licenseKey` to a `'use client'` Studio component.
- Write data-source descriptions for the AI.
- A theme built from CSS tokens.
- An AI proxy route with the key on the server, a model allowlist, a token cap and abort-signal passthrough.
- Saved state through `getState`/`onStateUpdated`.

**How it wires PayPal:** read-only server-side reporting through the PayPal Server SDK (sandbox `Client` with client-credentials). It has **no** checkout or JS SDK buttons. So it shows nothing about orders, authorize or capture flows; those are covered in our PayPal research.

---

## 7. Hackathon AG Grid page

Source: [devpost/aggrid](https://paypalaihackathon.devpost.com/details/aggrid).

**Judging guidance (verbatim)**
"Best Use of AG Grid: This award covers both what your dashboard looks like and how you build it. Show us polish: custom widgets, theming, and layout tools, not just AG Grid or AG Charts on their own. Take Studio Agent Framework for a spin: a custom agent talking to Studio's built-in agents, or a swapped-in harness."

**Required usage**
- Nothing is stated as mandatory beyond using the product to qualify.
- The page speaks almost entirely about **AG Studio**.
- AG Grid's own blog calls the prize "**Best Use of AG Studio**: $5,000 for 1st, $2,000 for 2nd, $1,000 each for three more" ([hackathon blog](https://www.ag-grid.com/blog/hackathon-paypal-and-ag-studio/)). Our brief says $5k/$2k/$1k. Per the blog there are 5 winners.

**Ideas listed** ("not a list of our expectations")
- Storefront analytics.
- An anomaly-alert agent that auto-builds widgets.
- A nonprofit donation dashboard.
- A natural-language finance agent ("show PayPal revenue by customer segment this month generates a live widget").
- A nudge-bot with a scoreboard-style widget.

**Resources**
- Quick Start, Custom Widgets & Theming, and Agent Framework docs.
- The agent framework blog and the "vibecoding a widget" blog.
- Recorded session "Self-serve dashboards in 30 lines of code".
- Support: "For any trial issues or hackathon questions: Connect with the AG Grid team via the PayPal Discord."

---

## 8. Bundle size / performance in Next.js

Minified, gzipped ESM bundles, measured with `gzip -9` on `dist/package/main.esm.min.mjs` from the packed tarballs. These are upper bounds; tree-shaking and deduplication will lower them.

| Package | min+gz |
|---|---|
| ag-studio 3.0.0 | ~512 KB |
| ag-grid-enterprise 36.2.0 | ~416 KB |
| ag-grid-community 36.2.0 | ~358 KB |
| ag-charts-community 14.2.0 | ~370 KB |
| ag-charts-enterprise 14.2.0 | ~292 KB |
| ag-charts-core 14.2.0 | ~71 KB |
| ag-stack 36.2.0 | ~36 KB |
| ag-studio-react 3.0.0 | ~4 KB |

What this means:
- **The Studio route ships roughly 1.5-2 MB gz of JS** (upper bound). Keep Studio only on `/dashboard` (route-level code splitting is automatic in the App Router). Never import `ag-studio` from shared layouts or the ledger. Consider `next/dynamic` with a skeleton, as the boilerplate does with `skeleton.tsx` / `loading.tsx`.
- **Ledger route:** `ag-grid-community` with `AllCommunityModule` comes to at most about 360 KB gz plus React wrappers. To trim it, list modules explicitly: `ClientSideRowModelModule`, `QuickFilterModule`, `TextFilterModule`, `NumberFilterModule`, `DateFilterModule`, `CellStyleModule`, `ValidationModule` (dev only) ([modules](https://www.ag-grid.com/react-data-grid/modules.md)).
- **Data:** Studio's sync data runs in the browser data engine, so every row is shipped to the client. For a user's ledger or dashboard, send only that user's deals. For a platform dashboard, aggregate or anonymise on the server (no emails or names). Server-side and async engines exist for scale ([server-side-data](https://www.ag-grid.com/studio/react/server-side-data.md)).
- **References:** keep `data`, `initialState`, `theme`, `widgets` and `ai` stable (`useState`/`useMemo`). Otherwise Studio resets state or recalculates ([react-best-practices](https://www.ag-grid.com/studio/react/react-best-practices.md)).
- **Version alignment:** `ag-grid-community`/`ag-grid-react` must match the `~36.2.0` that `ag-studio` resolves, or you get two grid copies plus theme conflicts ([compatibility](https://www.ag-grid.com/studio/react/compatibility.md)).
- **CSP:** Studio documents the `style-src`, `img-src` and `font-src` needs ([security](https://www.ag-grid.com/studio/react/security.md)). Check them if we add a CSP header.
- **TypeScript >= 5.8.3** is required for Studio 3 types ([compatibility](https://www.ag-grid.com/studio/react/compatibility.md)).

---

## Recommendation for Handshake

**Packages (pin exact versions)**
```
ag-studio@3.0.0  ag-studio-react@3.0.0  ag-grid-community@36.2.0  ag-grid-react@36.2.0
```
Do not import from `ag-grid-enterprise` or `ag-charts-enterprise` anywhere outside Studio's own widgets. Studio's licence does not cover them in custom widgets or the ledger.

**What to build, in order** (each step is shippable on its own)

| # | Piece | Product | Why | Hours |
|---|---|---|---|---|
| 1 | **Ledger** at `/deals`: the grid in section 5 (code link, item, counterparty, amount from minor units, status pill, deadline, last event, confidence; sort/filter; quick search; row click opens the deal) | AG Grid Community | Core UX; free forever, no key | 3-4 |
| 2 | **Platform dashboard** at `/dashboard`, read-only (`mode="view"`) for judges. Sources: `deals`, `events`, `verdicts` with relationships. Widgets: KPIs held / released / voided ($), deals by status, verdict confidence distribution (column chart over a binned field or expression), AI outcomes (RELEASE/VOID/ESCALATE) by week, a status `button-filter`, a `date-filter`. Theme built from our CSS tokens | AG Studio | What the prize asks for: layout plus theming | 5-7 |
| 3 | **One custom widget**, e.g. "Escrow flow": held money flowing to released vs voided, plain SVG, cross-filter on click | AG Studio | Named explicitly in the judging guidance | 3-5 |
| 4 | **Agent Framework with Claude**: our `claudeAdapter` plus `/api/studio-ai` proxy, the built-in 5 agents, prompt starters ("Show my voided deals this month", "Which deals did the AI escalate?", "Chart held vs released by week"), and a **custom `auditor` agent** with an `explain_verdict` tool that reads our verdict reasoning | AG Studio | Covers both "custom agent talking to built-in agents" and a swapped-in provider (Claude; AG ships only OpenAI) | 10-16 |
| 5 | (Optional) A per-user dashboard tab built from the same component with only that user's rows | AG Studio | Reuses step 2 | 1-2 |

**Total: about 22-34 h.** If time runs short, cut step 4 down to the built-in harness only (about 7-10 h) before cutting step 3.

**Licence strategy that survives Dec 1-15 judging**
1. Build steps 1-4 with **no Studio key** on localhost. There is no watermark on localhost; only a console banner appears.
2. **Request the 45-day Studio trial on 2026-11-01 or later** (expires about 2026-12-16 or later). Then confirm in the console that it is accepted with `AgStudioAiModule` registered, i.e. that it is a PRO-AI tier key.
3. **Ask the AG Grid team on the PayPal Discord now** whether they will issue a hackathon key valid through 2026-12-15, given that judges test the hosted app until then. If they say yes, step 2 becomes moot.
4. Store it as the `AG_STUDIO` env var on Render, passed from the server page as a prop (boilerplate pattern). Do not commit it.
5. If everything fails, the dashboard still works. Judges see a fading "Trial Period Expired" watermark and a console banner. The ledger (Community) is unaffected.

**Guardrails for the public AI route:** use a model allowlist, cap `max_tokens`, rate-limit per IP or session, run without extended thinking, and expose only aggregate or anonymised platform rows to Studio. Rows reach Claude through `execute_query`.

---

## Open risks

1. **Trial timing.** 45 days from any date before Oct 31 expires before judging ends. Whether a hackathon extension exists is **UNVERIFIED**.
2. **Claude adapter is unbuilt and untested.** These points are **UNVERIFIED**: round-tripping thinking blocks, Anthropic accepting the built-in tool JSON schemas, and parallel tool calls mapping onto Studio's loop. Plan an early spike (2-3 h) before committing to step 4.
3. **Boilerplate has no licence.** Copy patterns, not files. We write our own adapter anyway.
4. **Version drift.** Studio ships about every 6-8 weeks, and `ag-studio` uses `~36.2.0` for grid and charts. Pin exact versions and commit the lockfile.
5. **Bundle weight** on `/dashboard` is roughly 1.5-2 MB gz. The first load on Render's free tier may feel slow to judges. Show a skeleton and keep Studio off other routes.
6. **SSR of `<AgStudio>`** inside a client component: the boilerplate does it, but I did not verify it works. Fallback is `next/dynamic({ ssr: false })`.
7. **Data exposure.** Studio's sync data is fully client-side. A platform dashboard must not ship other users' PII.
8. **Unverified API details:**
   - The `results.rows` / `field.key` names in custom-widget `getData`.
   - ISO strings vs `Date` for Studio date fields.
   - How to combine `promptStarters` with the function form of `createAiHarness`.
   - Check each against `node_modules/ag-studio/dist/types`, or use the `ag-dev` skill, when coding.
9. **Prize naming mismatch** ("Best Use of AG Grid" on Devpost vs "Best Use of AG Studio" on AG's blog). This is harmless, but both point at Studio.
10. **Docs access.** Live example source files are blocked for scripts. Use the `.md` pages, `https://www.ag-grid.com/studio/llms.txt` and the `ag-grid/skills` package.
