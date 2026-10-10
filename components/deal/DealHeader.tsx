"use client";
// Deal header (08 section 7.2 item 2): title, code + Copy, pill with the secondary status, parties, amount, deadline.
import type { DealPreview, DealView } from "@/lib/deal/types";
import { deadlineLine, partyName, paymentLine } from "@/lib/deal-copy";
import { money } from "@/lib/ledger-columns";
import { StatusPill } from "@/components/StatusPill";
import { CopyButton } from "./Controls";

type Props = { deal: DealView | DealPreview; onRefresh: () => void; refreshLabel: string };

export function DealHeader({ deal, onRefresh, refreshLabel }: Props) {
  const view = deal.role === "preview" ? null : deal;
  const secondary = view && paymentLine(view.payment, view.updated_at);
  const deadline = deadlineLine(view ?? { status: "draft", deadline_days: deal.deadline_days, deadline_at: null });
  return (
    <header className="grid gap-2">
      <h1 className="text-2xl font-semibold leading-tight md:text-3xl">{deal.item_title}</h1>
      <p className="text-sm text-[var(--hs-muted)]">
        Deal <span data-testid="deal-code" className="font-mono text-[var(--hs-ink)]">{deal.code}</span> <CopyButton text={deal.code} />
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill status={view?.status ?? "draft"} />
        {view?.seeded && <span className="hs-badge">Sample deal</span>}
        <button type="button" className="hs-link text-sm" onClick={onRefresh}>{refreshLabel}</button>
      </div>
      {secondary && <p className="hs-help">{secondary}</p>}
      <p className="text-sm">
        Buyer {partyName(deal.buyer, "unknown")} · Seller {view?.seller ? partyName(view.seller, "unknown") : "not joined yet"}
      </p>
      <p className="text-3xl font-semibold">{money(deal.amount_minor)}</p>
      {deadline && <p className="text-sm text-[var(--hs-muted)]" title={view?.deadline_at ?? undefined}>{deadline}</p>}
    </header>
  );
}
