"use client";
// The /ledger grid on AG Grid Community (08 section 8; 09 section 4.3). Rows come from the server page.
import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AllCommunityModule, themeQuartz, type ColDef } from "ag-grid-community";
import { AgGridProvider, AgGridReact, type CustomCellRendererProps } from "ag-grid-react";
import type { LedgerRow } from "@/lib/deal/types";
import { eventSentence, money, pct, relTime, roleLabel, when } from "@/lib/ledger-columns";
import { STATUS_LABEL, STATUS_ORDER, type DealStatus } from "@/lib/status-labels";
import { StatusPill } from "@/components/StatusPill";

// ponytail: AllCommunityModule is the whole Community bundle; list the explicit modules if /ledger size ever matters.
const modules = [AllCommunityModule];

const theme = themeQuartz.withParams({
  accentColor: "var(--hs-accent)",
  backgroundColor: "var(--hs-surface)",
  foregroundColor: "var(--hs-ink)",
  borderColor: "var(--hs-border)",
  fontFamily: "var(--hs-font)",
  spacing: 6,
  borderRadius: 6,
  cellHorizontalPadding: 12,
});

type P<V> = CustomCellRendererProps<LedgerRow, V>;
// stopPropagation: the link is the keyboard path; onRowClicked handles the mouse, so avoid a double navigation.
const CodeLink = ({ value }: P<string>) => (
  <Link href={`/deal/${value}`} className="font-mono text-[var(--hs-accent)] underline-offset-2 hover:underline" onClick={(e) => e.stopPropagation()}>
    {value}
  </Link>
);
const StatusCell = ({ value }: P<DealStatus>) => (value ? <StatusPill status={value} /> : null);
const ItemCell = ({ value, data }: P<string>) => (
  <span className="flex items-center gap-1"><span className="truncate">{value}</span>{data?.seeded && <span className="hs-badge shrink-0">Sample</span>}</span>
);
const Time = ({ value }: P<string | null>) => <span title={value ?? undefined}>{when(value)}</span>;
const Rel = ({ value }: P<string | null>) => <span title={value ?? undefined}>{relTime(value)}</span>;

const code: ColDef<LedgerRow> = { field: "code", headerName: "Code", cellRenderer: CodeLink, width: 90, pinned: "left" };
const item: ColDef<LedgerRow> = {
  field: "item_title", headerName: "Item", flex: 1, minWidth: 140, cellRenderer: ItemCell,
  getQuickFilterText: (p) => (p.data?.seeded ? `${p.value} sample` : p.value), // "sample" finds the seeded deals
};
const amount: ColDef<LedgerRow> = { field: "amount_minor", headerName: "Amount", width: 100, type: "rightAligned", valueFormatter: (p) => money(p.value), filter: "agNumberColumnFilter" };
const status: ColDef<LedgerRow> = { field: "status", headerName: "Status", width: 172, cellRenderer: StatusCell, getQuickFilterText: (p) => (p.data ? STATUS_LABEL[p.data.status] : "") };
const lastActivity: ColDef<LedgerRow> = { field: "last_event_at", headerName: "Last activity", width: 125, cellRenderer: Rel, filter: false, sort: "desc" };

const columnDefs: ColDef<LedgerRow>[] = [
  code,
  item,
  { field: "role", headerName: "Role", width: 72, valueFormatter: (p) => roleLabel(p.value) },
  { field: "counterparty", headerName: "Other party", width: 125, valueFormatter: (p) => p.value ?? "—" },
  amount,
  status,
  { field: "deadline_at", headerName: "Deadline", width: 160, cellRenderer: Time, filter: false },
  { field: "last_event_cause", headerName: "Last event", flex: 1, minWidth: 225, valueFormatter: (p) => eventSentence(p.value) },
  { field: "lowest_confidence", headerName: "Confidence", width: 120, hide: true, type: "rightAligned", valueFormatter: (p) => pct(p.value), filter: "agNumberColumnFilter" },
  lastActivity,
];

// Phones: Item, Amount and Status fit on screen. Tapping a row opens the deal, which carries the code and the sample badge.
const phoneColumnDefs: ColDef<LedgerRow>[] = [
  { ...item, minWidth: 100, cellRenderer: undefined },
  { ...amount, width: 80, suppressHeaderFilterButton: true },
  { ...status, suppressHeaderFilterButton: true },
  { ...lastActivity, hide: true },
];
const subscribePhone = (fn: () => void) => { const m = matchMedia("(max-width: 639px)"); m.addEventListener("change", fn); return () => m.removeEventListener("change", fn); };

export function Ledger({ rows }: { rows: LedgerRow[] }) {
  const router = useRouter();
  const grid = useRef<AgGridReact<LedgerRow>>(null);
  const [quick, setQuick] = useState("");
  const [statuses, setStatuses] = useState<Set<DealStatus>>(new Set());
  const phone = useSyncExternalStore(subscribePhone, () => matchMedia("(max-width: 639px)").matches, () => false);
  const shown = useMemo(() => (statuses.size ? rows.filter((r) => statuses.has(r.status)) : rows), [rows, statuses]);

  const toggle = (s: DealStatus) =>
    setStatuses((prev) => { const next = new Set(prev); if (!next.delete(s)) next.add(s); return next; });
  const clear = () => { setQuick(""); setStatuses(new Set()); grid.current?.api?.setFilterModel(null); };

  if (rows.length === 0)
    return (
      <div className="rounded-lg border border-[var(--hs-border)] bg-[var(--hs-surface)] p-10 text-center">
        <p className="text-[var(--hs-muted)]">No deals yet.</p>
        <Link href="/new" className="hs-btn mt-4 inline-block">New deal</Link>
      </div>
    );

  return (
    <AgGridProvider modules={modules}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input type="search" className="hs-input w-full md:w-64" placeholder="Search deals" aria-label="Search deals" value={quick} onChange={(e) => setQuick(e.target.value)} />
        {STATUS_ORDER.map((s) => (
          <button key={s} type="button" className="hs-chip" aria-pressed={statuses.has(s)} onClick={() => toggle(s)}>{STATUS_LABEL[s]}</button>
        ))}
        <button type="button" className="text-sm text-[var(--hs-accent)] hover:underline" onClick={clear}>Clear filters</button>
      </div>
      <div className="h-[calc(100vh-16rem)] md:h-[560px]">
        <AgGridReact<LedgerRow>
          ref={grid}
          theme={theme}
          rowData={shown}
          columnDefs={phone ? phoneColumnDefs : columnDefs}
          defaultColDef={{ sortable: true, filter: true, resizable: true }}
          quickFilterText={quick}
          getRowId={(p) => p.data.code}
          onRowClicked={(e) => e.data && router.push(`/deal/${e.data.code}`)}
          overlayNoRowsTemplate="No deals match these filters."
        />
      </div>
      <p className="mt-2 text-sm text-[var(--hs-muted)] md:hidden">Tip: tap a row to open the deal.</p>
    </AgGridProvider>
  );
}
