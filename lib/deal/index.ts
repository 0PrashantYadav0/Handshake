// The whole public surface of lib/deal (02 section 3.1). Routes call these and nothing else in this directory.
import { DEAL_INCLUDE, loadDeal, requireRole } from "./access";
import { openDealRow } from "./sealed";
import type { Actor, DealEvent, DealPreview, DealView, Deps, LedgerRow } from "./types";
import { buildDealPreview, buildDealView, buildLedgerRow, toEvent } from "./views";
import { buildSummary, buildWallet, WALLET_INCLUDE, type AccountSummary, type Wallet } from "./summary";

export { addFile, createDeal, handle } from "./commands";
export { getEvidencePack } from "./pack";
export { tick } from "./tick";
export { applyPaypalEvent, toFact, type WebhookOutcome } from "./webhooks";
export { DealError, HTTP_STATUS, type DealErrorCode } from "./errors";
export { openFile } from "./sealed"; // the file route opens the bytes it selects
export type * from "./types";
export type { AccountSummary, DealLine, Figures, NeedsYou, Wallet, WalletCapture, WalletHold, WalletPayout } from "./summary";

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

const mine = (actor: Actor) => ({ OR: [{ buyer_id: actor.user_id }, { seller_id: actor.user_id }] });
const payoutEmail = async (actor: Actor, deps: Deps) => {
  const u = await deps.db.user.findUnique({ where: { id: actor.user_id }, select: { paypal_email: true, paypal_email_verified_at: true } });
  return { paypal_email: u?.paypal_email ?? null, paypal_email_verified: !!u?.paypal_email && !!u.paypal_email_verified_at };
};

/** /dashboard (trust spec §10): every deal of the caller as a DealView, folded into figures, "Needs you" and the two tables.
 *  ponytail: loads every deal in full; page it or narrow the include if one account ever holds thousands. */
export async function getAccountSummary(actor: Actor, deps: Deps): Promise<AccountSummary> {
  const [me, rows] = await Promise.all([payoutEmail(actor, deps), deps.db.deal.findMany({ where: mine(actor), include: DEAL_INCLUDE })]);
  const now = deps.clock.now();
  const deals = rows.map(openDealRow).map((d) => ({ ...buildDealView(d, d.buyer_id === actor.user_id ? "buyer" : "seller", now), events: d.events.map(toEvent) }));
  return buildSummary(deals, me, now);
}

/** /wallet (trust spec §10): holds, captures and payouts with their PayPal ids. */
export async function getWallet(actor: Actor, deps: Deps): Promise<Wallet> {
  const [me, rows] = await Promise.all([payoutEmail(actor, deps), deps.db.deal.findMany({ where: mine(actor), include: WALLET_INCLUDE })]);
  return buildWallet(rows.map(openDealRow), actor.user_id, me.paypal_email_verified);
}
