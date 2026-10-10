"use client";
// The /ledger grid on AG Grid Community (08 section 8; 09 section 4.3). Rows come from the server page.
import { useMemo, useRef, useState } from "react";
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
});

type P<V> = CustomCellRendererProps<LedgerRow, V>;
// stopPropagation: the link is the keyboard path; onRowClicked handles the mouse, so avoid a double navigation.
const CodeLink = ({ value }: P<string>) => (
  <Link href={`/deal/${value}`} className="font-mono text-[var(--hs-accent)] underline-offset-2 hover:underline" onClick={(e) => e.stopPropagation()}>
    {value}
  </Link>
);
const StatusCell = ({ value }: P<DealStatus>) => (value ? <StatusPill status={value} /> : null);
const SampleCell = ({ value }: P<boolean>) => (value ? <span className="hs-badge">Sample</span> : null);
const Time = ({ value }: P<string | null>) => <span title={value ?? undefined}>{when(value)}</span>;
const Rel = ({ value }: P<string | null>) => <span title={value ?? undefined}>{relTime(value)}</span>;

const columnDefs: ColDef<LedgerRow>[] = [
  { field: "code", headerName: "Code", cellRenderer: CodeLink, width: 110, pinned: "left" },
  { field: "item_title", headerName: "Item", flex: 1, minWidth: 180 },
  { field: "role", headerName: "Role", width: 100, valueFormatter: (p) => roleLabel(p.value) },
  { field: "counterparty", headerName: "Counterparty", minWidth: 140, valueFormatter: (p) => p.value ?? "—" },
  { field: "amount_minor", headerName: "Amount", width: 120, type: "rightAligned", valueFormatter: (p) => money(p.value), filter: "agNumberColumnFilter" },
  { field: "status", headerName: "Status", width: 180, cellRenderer: StatusCell, getQuickFilterText: (p) => (p.data ? STATUS_LABEL[p.data.status] : "") },
  { field: "deadline_at", headerName: "Deadline", width: 180, cellRenderer: Time, filter: false },
  { field: "last_event_cause", headerName: "Last event", width: 240, valueFormatter: (p) => eventSentence(p.value) },
  { field: "lowest_confidence", headerName: "Confidence", width: 120, type: "rightAligned", valueFormatter: (p) => pct(p.value), filter: "agNumberColumnFilter" },
  { field: "last_event_at", headerName: "Last activity", width: 150, cellRenderer: Rel, filter: false, sort: "desc" },
  { field: "seeded", headerName: "Sample", width: 100, cellRenderer: SampleCell, filter: false, getQuickFilterText: (p) => (p.value ? "sample" : "") },
];

export function Ledger({ rows }: { rows: LedgerRow[] }) {
  const router = useRouter();
  const grid = useRef<AgGridReact<LedgerRow>>(null);
  const [quick, setQuick] = useState("");
  const [statuses, setStatuses] = useState<Set<DealStatus>>(new Set());
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
          columnDefs={columnDefs}
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
