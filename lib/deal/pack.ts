// The evidence pack (04 section 10.2; 03 "Evidence pack assembly"): rebuilt from the database on every call.
import { loadDeal, requireRole } from "./access";
import { toIso } from "./dates";
import type { Actor, Deps, EvidencePack } from "./types";
import { buildDealView, buildSubmissions, toCondition, toEvent, toPayment, toPayout } from "./views";

const DEAL_KEYS = [
  "code", "status", "item_title", "source_text", "amount_minor", "currency", "deadline_days", "deadline_at", "terms_version",
  "buyer_accepted_version", "seller_accepted_version", "fix_attempts_used", "seeded", "created_at", "updated_at",
] as const;

export async function getEvidencePack(code: string, actor: Actor, deps: Deps): Promise<EvidencePack> {
  const loaded = await loadDeal(deps.db, code, actor);
  const role = requireRole(loaded, "buyer", "seller");
  const { deal } = loaded;
  const now = deps.clock.now();
  const view = buildDealView(deal, role, now);
  const dealPart = Object.fromEntries(DEAL_KEYS.map((k) => [k, view[k]])) as EvidencePack["deal"];

  const eventIds = deal.events.map((e) => (e.payload as Record<string, unknown>).paypal_event_id).filter((x): x is string => typeof x === "string");
  const webhooks = eventIds.length ? await deps.db.webhookEvent.findMany({ where: { paypal_event_id: { in: eventIds } }, orderBy: { created_at: "asc" } }) : [];
  const create = deal.events.find((e) => e.cause === "create");
  const cp = create ? (create.payload as Record<string, unknown>) : null;

  return {
    format: "handshake-evidence-pack/1",
    generated_at: toIso(now),
    generated_for: role,
    deal: dealPart,
    parties: {
      buyer: view.buyer,
      seller: deal.seller && { display_name: deal.seller.display_name, email: deal.seller.email, paypal_email: role === "seller" ? deal.seller.paypal_email : null },
    },
    conditions: deal.conditions.map(toCondition),
    reference_files: view.reference_files,
    submissions: buildSubmissions(deal, now, true) as EvidencePack["submissions"],
    payment: toPayment(deal),
    payouts: deal.payouts.map((p) => ({ ...toPayout(p), recipient_email: role === "seller" ? p.recipient_email : "" })),
    events: deal.events.map(toEvent),
    webhook_events: webhooks.map((w) => ({
      paypal_event_id: w.paypal_event_id, event_type: w.event_type, verified: w.verified,
      processed_at: w.processed_at ? toIso(w.processed_at) : null, created_at: toIso(w.created_at),
    })),
    extraction: cp && !deal.seeded
      ? { model: String(cp.model), prompt_version: String(cp.prompt_version), rejected: (cp.rejected as { text: string; suggestion: string }[] | undefined) ?? [] }
      : null,
  };
}
