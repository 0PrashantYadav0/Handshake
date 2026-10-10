"use client";
// The AG Studio dashboard (09 sections 5.3 to 5.5): three sources from /api/dashboard/data, nine widgets on the
// 24-column canvas, one theme bound to the --hs-* tokens. Loaded only through next/dynamic from StudioDashboard.
// Studio API names verified against ag-studio 3.0.0 types: relationships use { id, source: { tableId, fieldId },
// target }, widget sort is AgSortConfig[] with field: { id }, the grid maps `cols`, the layout key is `widgetLayout`.
import { useState } from "react";
import { createFormats, enableStudioDevValidations, studioTheme, type AgDataSourcesDefinition, type AgReportState } from "ag-studio";
import { AgStudio, AgStudioProvider } from "ag-studio-react";
import type { DashboardData } from "@/lib/dashboard-rows";

if (process.env.NODE_ENV !== "production") enableStudioDevValidations();

const date = (iso: string | null) => (iso ? new Date(iso) : null);
const title = (text: string) => ({ title: { enabled: true, text } });

// ---------- 5.5 theme: every colour is a CSS token, so dark mode (if added) is the tokens swapped ----------
const theme = studioTheme.withParams({
  fontFamily: "var(--hs-font)",
  accentColor: "var(--hs-accent)",
  backgroundColor: "var(--hs-surface)",
  foregroundColor: "var(--hs-ink)",
  borderColor: "var(--hs-border)",
  borderRadius: 6,
  spacing: 6,
  studioCanvasBackgroundColor: "var(--hs-bg)",
  studioWidgetBackgroundColor: "var(--hs-surface)",
  studioWidgetBorderRadius: 10,
  studioPanelContainerBackgroundColor: "var(--hs-surface)",
  // Palette in state-machine order so "Deals by status" shares the pill colours.
  chartPaletteFills1Color: "var(--hs-status-draft)",
  chartPaletteFills2Color: "var(--hs-status-terms_agreed)",
  chartPaletteFills3Color: "var(--hs-status-held)",
  chartPaletteFills4Color: "var(--hs-status-proof_submitted)",
  chartPaletteFills5Color: "var(--hs-status-in_review)",
  chartPaletteFills6Color: "var(--hs-status-captured)",
  chartPaletteFills7Color: "var(--hs-status-paid)",
  chartPaletteFills8Color: "var(--hs-status-voided)",
});

// ---------- 5.3 sources: descriptions are written for the agents' schema() context ----------
function toSources(d: DashboardData): AgDataSourcesDefinition {
  return {
    description:
      'Handshake "pay on proof" deals for the signed-in user. PayPal holds the buyer\'s money (status held); ' +
      "the seller submits photo and tracking evidence; Claude judges each condition pass/fail/unclear; a fixed " +
      "decision function in code then captures (money released to the seller), requests one fix, voids " +
      "(money returned to the buyer) or sends the deal to the buyer for review. Amounts are US dollars.",
    sources: [
      {
        id: "deals",
        name: "Deals",
        description: "One row per deal. held_usd, released_usd and voided_usd hold the amount in exactly one bucket by status, so summing them gives money held, released and returned.",
        data: d.deals.map((r) => ({ ...r, created_at: date(r.created_at), deadline_at: date(r.deadline_at) })),
        fields: [
          { id: "code", name: "Deal code", format: "textFormat" },
          { id: "item_title", name: "Item", format: "textFormat" },
          { id: "role", name: "My role", format: "textFormat", description: "buyer or seller" },
          { id: "status", name: "Status", format: "textFormat", description: "draft, terms_agreed, held, proof_submitted, in_review, captured, paid, voided" },
          { id: "amount_usd", name: "Amount", format: "currencyFormat" },
          { id: "held_usd", name: "Held", format: "currencyFormat" },
          { id: "released_usd", name: "Released", format: "currencyFormat" },
          { id: "voided_usd", name: "Returned", format: "currencyFormat" },
          { id: "created_at", name: "Created", format: "dateTimeFormat" },
          { id: "deadline_at", name: "Deadline", format: "dateTimeFormat" },
          { id: "decision", name: "AI decision", format: "textFormat", description: "capture, request_fix, buyer_review, void, or empty if no proof was judged yet" },
          { id: "lowest_confidence", name: "Lowest verdict confidence", format: "percentageFormat" },
          { id: "fix_attempts_used", name: "Fix attempts used", format: "integerFormat" },
          { id: "seeded", name: "Seeded demo deal", format: "booleanFormat", hide: true },
        ],
      },
      {
        id: "verdicts",
        name: "Verdicts",
        description: "One row per condition judged by Claude. confidence_band buckets confidence; 0.85 is the pass threshold.",
        data: d.verdicts,
        fields: [
          { id: "deal_code", name: "Deal code", format: "textFormat" },
          { id: "condition_text", name: "Condition", format: "textFormat" },
          { id: "submission_no", name: "Submission", format: "integerFormat" },
          { id: "result", name: "Result", format: "textFormat", description: "pass, fail or unclear" },
          { id: "confidence", name: "Confidence", format: "percentageFormat" },
          { id: "confidence_band", name: "Confidence band", format: "textFormat" },
        ],
      },
      {
        id: "decisions",
        name: "Decisions",
        description: "One row per decision the fixed decision function made after a proof submission.",
        data: d.decisions.map((r) => ({ ...r, decided_at: date(r.decided_at) })),
        fields: [
          { id: "deal_code", name: "Deal code", format: "textFormat" },
          { id: "decision", name: "Decision", format: "textFormat" },
          { id: "decided_at", name: "Decided at", format: "dateTimeFormat" },
          { id: "decided_on", name: "Decided on (day)", format: "textFormat" },
          { id: "amount_usd", name: "Amount", format: "currencyFormat" },
          { id: "is_capture", name: "Capture", format: "integerFormat" },
          { id: "is_request_fix", name: "Fix requested", format: "integerFormat" },
          { id: "is_buyer_review", name: "Buyer review", format: "integerFormat" },
          { id: "is_void", name: "Void", format: "integerFormat" },
        ],
      },
    ],
    relationships: [
      { id: "verdicts-deal", source: { tableId: "verdicts", fieldId: "deal_code" }, target: { tableId: "deals", fieldId: "code" }, type: "many-to-one" },
      { id: "decisions-deal", source: { tableId: "decisions", fieldId: "deal_code" }, target: { tableId: "deals", fieldId: "code" }, type: "many-to-one" },
    ],
    formats: createFormats({ overrides: { currencyFormat: { formatOptions: { format: "$#,##0.00" } } } }),
  };
}

// ---------- 5.4 widgets and layout on the 24-column canvas ----------
const initialState: AgReportState = {
  version: "3.0.0",
  selectedPageId: "overview",
  pages: [
    {
      id: "overview",
      widgets: {
        held: { type: "value", format: title("Money held"), dataMapping: { value: [{ id: "deals.held_usd", aggregation: "sum" }] } },
        released: { type: "value", format: title("Released to sellers"), dataMapping: { value: [{ id: "deals.released_usd", aggregation: "sum" }] } },
        voided: { type: "value", format: title("Returned to buyers"), dataMapping: { value: [{ id: "deals.voided_usd", aggregation: "sum" }] } },
        statusFilter: { type: "button-filter", format: title("Status"), dataMapping: { value: [{ id: "deals.status" }] } },
        // T-37 slot: the custom `deal-pipeline` widget replaces this built-in funnel (09 section 5.6; cut 5 fallback).
        pipeline: { type: "funnel-chart", format: title("Deal pipeline"), dataMapping: { categoryKey: [{ id: "deals.status" }], valueKey: [{ id: "deals.code", aggregation: "count" }] } },
        byStatus: { type: "donut-chart", format: title("Deals by status"), dataMapping: { categoryKey: [{ id: "deals.status" }], valueKey: [{ id: "deals.code", aggregation: "count" }] } },
        confidence: {
          type: "column-chart-grouped",
          format: title("Verdict confidence"),
          dataMapping: { categoryKey: [{ id: "verdicts.confidence_band" }], valueKey: [{ id: "verdicts.deal_code", aggregation: "count" }] },
          sort: [{ field: { id: "verdicts.confidence_band" }, direction: "asc" }],
        },
        overTime: {
          type: "column-chart-stacked",
          format: title("Decisions over time"),
          dataMapping: {
            categoryKey: [{ id: "decisions.decided_on" }],
            valueKey: [
              { id: "decisions.is_capture", aggregation: "sum" },
              { id: "decisions.is_request_fix", aggregation: "sum" },
              { id: "decisions.is_buyer_review", aggregation: "sum" },
              { id: "decisions.is_void", aggregation: "sum" },
            ],
          },
          sort: [{ field: { id: "decisions.decided_on" }, direction: "asc" }],
        },
        dealsGrid: {
          type: "grid",
          format: title("Deals"),
          dataMapping: {
            cols: ["code", "item_title", "status", "amount_usd", "decision", "lowest_confidence", "deadline_at"].map((f) => ({ id: `deals.${f}` })),
          },
        },
      },
      widgetLayout: {
        held: { xTrack: 0, yTrack: 0, xSpan: 6, ySpan: 8 },
        released: { xTrack: 6, yTrack: 0, xSpan: 6, ySpan: 8 },
        voided: { xTrack: 12, yTrack: 0, xSpan: 6, ySpan: 8 },
        statusFilter: { xTrack: 18, yTrack: 0, xSpan: 6, ySpan: 8 },
        pipeline: { xTrack: 0, yTrack: 8, xSpan: 24, ySpan: 14 },
        byStatus: { xTrack: 0, yTrack: 22, xSpan: 8, ySpan: 18 },
        confidence: { xTrack: 8, yTrack: 22, xSpan: 8, ySpan: 18 },
        overTime: { xTrack: 16, yTrack: 22, xSpan: 8, ySpan: 18 },
        dealsGrid: { xTrack: 0, yTrack: 40, xSpan: 24, ySpan: 22 },
      },
    },
  ],
};

export function StudioCanvas({ data, licenseKey }: { data: DashboardData; licenseKey?: string }) {
  const [sources] = useState(() => toSources(data)); // stable reference: Studio reads `data` once
  // T-37: widgets={createWidgets({ additionalTypes: [dealPipelineWidget], menu: [...] })} and `pipeline` becomes type "deal-pipeline".
  // T-38/39: modules={[AgStudioAiModule]} on the provider and ai={harness} on AgStudio, backed by POST /api/studio/agent.
  return (
    <AgStudioProvider licenseKey={licenseKey || undefined}>
      <AgStudio data={sources} theme={theme} initialState={initialState} mode="edit" style={{ height: "calc(100vh - 64px)", width: "100%" }} />
    </AgStudioProvider>
  );
}
