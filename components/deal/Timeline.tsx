"use client";
// Timeline card (08 section 7.11): rows from GET /api/deals/{code}/events, oldest first, refetched whenever the deal view changes.
import { useEffect, useState } from "react";
import type { DealEvent } from "@/lib/deal/types";
import { api } from "@/lib/client-api";
import { ACTOR_LABEL, timelineSentence } from "@/lib/deal-copy";
import { when } from "@/lib/ledger-columns";
import { STATUS_LABEL } from "@/lib/status-labels";

/** Empty until fetched; an empty `updatedAt` (preview) fetches nothing. A failed fetch keeps the last rows. */
export function useEvents(code: string, updatedAt: string): DealEvent[] {
  const [events, setEvents] = useState<DealEvent[]>([]);
  useEffect(() => {
    if (!updatedAt) return;
    let on = true;
    api<DealEvent[]>(`/api/deals/${code}/events`).then((rows) => on && setEvents(rows)).catch(() => {});
    return () => { on = false; };
  }, [code, updatedAt]);
  return events;
}

export function Timeline({ events }: { events: DealEvent[] }) {
  return (
    <section className="hs-card min-w-0 text-sm">
      <h2 className="font-semibold">Timeline</h2>
      {events.length === 0 && <p className="hs-help mt-2">No events yet.</p>}
      <ol className="mt-3 grid gap-3">
        {events.map((e) => (
          <li key={e.id} className="grid min-w-0 gap-1 border-l-2 border-[var(--hs-border)] pl-3">
            <p className="hs-help"><time title={e.created_at}>{when(e.created_at)}</time> · <span className="hs-badge">{ACTOR_LABEL[e.actor]}</span></p>
            <p>{timelineSentence(e)}</p>
            {e.from_status !== e.to_status && <p className="hs-help">{e.from_status ? STATUS_LABEL[e.from_status] : "—"} → {STATUS_LABEL[e.to_status]}</p>}
            <details className="min-w-0" open={e.actor === "paypal" && !e.payload.seeded}>
              <summary className="hs-help cursor-pointer">Details</summary>
              <pre className="mt-1 overflow-x-auto rounded bg-[var(--hs-bg)] p-2 text-xs">{JSON.stringify(e.payload, null, 2)}</pre>
            </details>
          </li>
        ))}
      </ol>
    </section>
  );
}
