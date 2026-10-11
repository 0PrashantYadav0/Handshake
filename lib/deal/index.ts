// The whole public surface of lib/deal (02 section 3.1). Routes call these and nothing else in this directory.
import { loadDeal, requireRole } from "./access";
import { openDealRow } from "./sealed";
import type { Actor, DealEvent, DealPreview, DealView, Deps, LedgerRow } from "./types";
import { buildDealPreview, buildDealView, buildLedgerRow, toEvent } from "./views";

export { addFile, createDeal, handle } from "./commands";
export { getEvidencePack } from "./pack";
export { tick } from "./tick";
export { applyPaypalEvent, toFact, type WebhookOutcome } from "./webhooks";
export { DealError, HTTP_STATUS, type DealErrorCode } from "./errors";
export { openFile } from "./sealed"; // the file route opens the bytes it selects
export type * from "./types";

/** DealPreview for a signed-in non-party on a joinable draft (F4), DealView for a party, not_a_party otherwise. */
export async function getDeal(code: string, actor: Actor, deps: Deps): Promise<DealView | DealPreview> {
  const loaded = await loadDeal(deps.db, code, actor);
  return loaded.role === "preview" ? buildDealPreview(loaded.deal) : buildDealView(loaded.deal, loaded.role, deps.clock.now());
}

/** Every deal where the caller is buyer or seller, newest last event first (04 section 6.2). */
export async function listDeals(actor: Actor, deps: Deps): Promise<LedgerRow[]> {
  const deals = (await deps.db.deal.findMany({
    where: { OR: [{ buyer_id: actor.user_id }, { seller_id: actor.user_id }] },
    include: { buyer: true, seller: true, verdicts: true, events: { orderBy: { id: "desc" }, take: 1 } },
  })).map(openDealRow);
  const at = (d: (typeof deals)[number]) => (d.events[0]?.created_at ?? d.updated_at).getTime();
  const id = (d: (typeof deals)[number]) => d.events[0]?.id ?? 0n;
  return deals.sort((a, b) => at(b) - at(a) || Number(id(b) - id(a))).map((d) => buildLedgerRow(d, actor.user_id));
}

export async function getEvents(code: string, actor: Actor, deps: Deps): Promise<DealEvent[]> {
  const loaded = await loadDeal(deps.db, code, actor);
  requireRole(loaded, "buyer", "seller");
  return loaded.deal.events.map(toEvent);
}
