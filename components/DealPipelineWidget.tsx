"use client";
// The `deal-pipeline` custom widget (09 section 5.6; T-37): the eight statuses as a horizontal stage bar with the
// count and dollars in each, voided set apart as the sink. Plain React, no ag-charts / ag-grid-enterprise (trap 8).
// Clicking a stage calls widgetApi.toggleCrossFilter so every other widget narrows to that status; the widget asks
// for its own data with crossFilter: "highlight" so its bar stays whole and dims the stages outside the selection.
// Studio API names verified against ag-studio 3.0.0 types: AgWidgetParams { widgetApi, dataMapping }, widgetApi.getData
// (flat query, rows keyed by field.key), setDisplayState, toggleCrossFilter({ type: "value", field, value, group, reset }),
// getCrossFilterSelections; the definition's form uses createDefaults({ supportsCrossHighlight, dataMappingItems }).
import { useEffect, useState, type MouseEvent } from "react";
import type { AgWidgetData, AgWidgetDataFormat, AgWidgetFieldReference, AgWidgetParams } from "ag-studio";
import type { AgWidgetDefinition } from "ag-studio-react";
import { STATUS_LABEL, STATUS_ORDER, type DealStatus } from "@/lib/status-labels";

export type Stage = { status: DealStatus; deals: number; money: number };
export interface DealPipelineState
  extends AgWidgetData<{ status: AgWidgetFieldReference[]; deals: AgWidgetFieldReference[]; money: AgWidgetFieldReference[] }, AgWidgetDataFormat<unknown>> {
  type: "deal-pipeline";
}

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
export const formatMoney = (n: number): string => usd.format(n);

/** One stage per STATUS_ORDER entry, zero-filled; rows outside the eight statuses are ignored. Pure, unit-tested. */
export function toStages(rows: Record<string, unknown>[], keys: { status: string; deals: string; money: string }): Stage[] {
  const by = new Map<string, Stage>(STATUS_ORDER.map((status) => [status, { status, deals: 0, money: 0 }]));
  for (const r of rows) {
    const s = by.get(String(r[keys.status]));
    if (!s) continue;
    s.deals += Number(r[keys.deals]) || 0;
    s.money += Number(r[keys.money]) || 0;
  }
  return STATUS_ORDER.map((status) => by.get(status)!);
}

// Studio hands the component a fresh `params` object on every refresh (filter, cross-filter, data or schema change)
// while the field objects inside dataMapping keep their identity, so the query effect keys on `params` itself.
export function DealPipeline(params: AgWidgetParams<DealPipelineState>) {
  const { widgetApi, dataMapping } = params;
  const status = dataMapping.status?.[0];
  const [stages, setStages] = useState<Stage[]>([]);
  const [lit, setLit] = useState<Set<string> | null>(null); // statuses inside the cross-filter; null = no selection

  useEffect(() => {
    const { widgetApi, dataMapping } = params;
    const status = dataMapping.status?.[0];
    const deals = dataMapping.deals?.[0];
    const money = dataMapping.money?.[0];
    if (!status || !deals || !money) {
      widgetApi.setDisplayState("incompleteDataMapping");
      return;
    }
    widgetApi.setDisplayState("loading", { prominent: false });
    let live = true;
    const keys = { status: status.key, deals: deals.key, money: money.key };
    widgetApi.getData({ fields: [status, deals, money] }, { crossFilter: "highlight" }).then(({ results, crossFilter }) => {
      if (!live) return;
      const next = toStages(results.rows, keys);
      setStages(next);
      const selected = widgetApi.getCrossFilterSelections()?.length ? crossFilter?.rows : undefined;
      setLit(selected ? new Set(selected.map((r) => String(r[keys.status]))) : null);
      widgetApi.setDisplayState(next.some((s) => s.deals > 0) ? "displayed" : "noData");
    });
    return () => {
      live = false;
    };
  }, [params]);

  const pick = (s: DealStatus, e: MouseEvent) =>
    status && widgetApi.toggleCrossFilter({ type: "value", field: status, value: s, group: 0, reset: !(e.metaKey || e.ctrlKey) });
  const max = Math.max(1, ...stages.map((s) => s.deals));

  return (
    <div style={{ display: "flex", gap: 6, alignItems: "stretch", height: "100%", overflowX: "auto", padding: 8, fontFamily: "var(--hs-font)" }}>
      {stages.map((s) => (
        <button
          key={s.status}
          type="button"
          data-stage={s.status}
          onClick={(e) => pick(s.status, e)}
          aria-pressed={lit?.has(s.status) ?? false}
          title={`${STATUS_LABEL[s.status]}: ${s.deals} deals, ${formatMoney(s.money)}. Click to filter the other widgets.`}
          style={{
            flex: "1 0 96px", minWidth: 96, display: "flex", flexDirection: "column", gap: 6, padding: 8, textAlign: "left",
            border: "1px solid var(--hs-border)", borderRadius: 8, background: "var(--hs-surface)", color: "var(--hs-ink)", cursor: "pointer",
            marginLeft: s.status === "voided" ? 18 : 0, // the sink sits apart from the happy path
            opacity: lit && !lit.has(s.status) ? 0.35 : 1,
          }}
        >
          <span style={{ height: 6, borderRadius: 3, background: `var(--hs-status-${s.status})`, width: `${Math.round((100 * s.deals) / max)}%`, minWidth: 6 }} />
          <span className="hs-pill" data-status={s.status} style={{ whiteSpace: "normal", alignSelf: "flex-start" }}>{STATUS_LABEL[s.status]}</span>
          <strong style={{ fontSize: "1.25rem", lineHeight: 1 }}>{s.deals}</strong>
          <span style={{ fontSize: "0.8rem", color: "var(--hs-muted)" }}>{formatMoney(s.money)}</span>
        </button>
      ))}
    </div>
  );
}

export const dealPipelineWidget: AgWidgetDefinition<"deal-pipeline", DealPipelineState> = {
  id: "deal-pipeline",
  label: "Deal pipeline",
  dataMapping: {
    status: { type: "field", supportedRoles: ["category"], requires: { cardinality: "many" }, required: true, intent: "category", aiDescription: "The deal status; map deals.status." },
    deals: { type: "field", supportedRoles: ["numeric"], requires: { per: "dataMapping.status", cardinality: "one" }, required: true, intent: "value", aiDescription: "Deals per stage; map a count of deals.code." },
    money: { type: "field", supportedRoles: ["numeric"], requires: { per: "dataMapping.status", cardinality: "one" }, required: true, intent: "value", aiDescription: "Dollars per stage; map a sum of deals.amount_usd." },
  },
  form: (p) =>
    p.createDefaults({
      supportsCrossHighlight: true,
      dataMappingItems: [{ key: "status", label: "Status" }, { key: "deals", label: "Deal count" }, { key: "money", label: "Amount" }],
    }),
  comp: DealPipeline,
  defaultSize: { width: 960, height: 240 },
  minSize: { width: 320, height: 160 },
  ai: {
    description: "Shows how many deals and how much money sit in each stage of the Handshake state machine, with voided deals as a sink.",
    usage: "Use when asked for the pipeline, funnel or stage breakdown of deals. Clicking a stage cross-filters the page.",
  },
};
