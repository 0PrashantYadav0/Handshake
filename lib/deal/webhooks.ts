// The webhook path (02 sections 5.5 and 6.8; 04 section 11): toFact() is the pure event -> fact mapping, applyPaypalEvent()
// stores the event once, finds the deal, applies the fact through facts-db under the row lock and sets processed_at.
// CHECKOUT.ORDER.APPROVED (E8) is the one event with a PayPal call in the middle and uses the two-transaction pattern of 8.2.
import { PayPalError } from "@/lib/paypal/types";
import { DEAL_INCLUDE, type DealRow } from "./access";
import type { PaypalFact } from "./facts";
import { afterCommit, applyFactTx, type FactResult, type FactSource } from "./facts-db";
import { authKey, strayVoidKey } from "./keys";
import { openDealRow } from "./sealed";
import { lockDeal, TX_OPTIONS, writeEvent, type Tx } from "./transition";
import type { Deps, PaypalWebhookEvent } from "./types";

export type Lookup = { kind: "custom_id" | "order_custom_id" | "sender_item_id"; value: string };
export type Mapped = { lookup: Lookup; fact: PaypalFact } | { lookup: Lookup; approved_order_id: string } | { noop: true };
export type WebhookOutcome = "unverified" | "already_processed" | "applied" | "noop" | "unknown_deal";

const NOOP: Mapped = { noop: true };
const PAYOUT_PREFIX = "PAYMENT.PAYOUTS-ITEM.";
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

/** 02 section 5.5, pure. A resource without the field the lookup needs is a noop (simulator payloads are v1-shaped). */
export function toFact(event: PaypalWebhookEvent): Mapped {
  const r = event.resource;
  const type = event.event_type;
  const id = str(r.id);
  if (type === "CHECKOUT.ORDER.APPROVED") {
    const units = Array.isArray(r.purchase_units) ? (r.purchase_units as unknown[]) : [];
    const code = str(obj(units[0]).custom_id);
    return id && code ? { lookup: { kind: "order_custom_id", value: code }, approved_order_id: id } : NOOP;
  }
  if (type.startsWith(PAYOUT_PREFIX)) {
    const sender_item_id = str(obj(r.payout_item).sender_item_id);
    if (!sender_item_id) return NOOP;
    const lookup: Lookup = { kind: "sender_item_id", value: sender_item_id };
    const payout_batch_id = str(r.payout_batch_id);
    const payout_item_id = str(r.payout_item_id);
    const word = type.slice(PAYOUT_PREFIX.length);
    if (word === "SUCCEEDED") {
      return payout_batch_id && payout_item_id ? { lookup, fact: { type: "payout_succeeded", sender_item_id, payout_batch_id, payout_item_id } } : NOOP;
    }
    if (word === "FAILED" || word === "BLOCKED" || word === "RETURNED" || word === "UNCLAIMED") {
      const failure_reason = word === "UNCLAIMED" ? word : (str(obj(r.errors).name) ?? word);
      return { lookup, fact: { type: "payout_failed", sender_item_id, payout_batch_id, payout_item_id, failure_reason } };
    }
    return NOOP;
  }
  const code = str(r.custom_id);
  if (!id || !code) return NOOP;
  const lookup: Lookup = { kind: "custom_id", value: code };
  const reason = str(obj(r.status_details).reason);
  switch (type) {
    case "PAYMENT.AUTHORIZATION.CREATED": {
      const auth_expires_at = str(r.expiration_time);
      return r.status === "CREATED" && auth_expires_at ? { lookup, fact: { type: "authorization_created", authorization_id: id, auth_expires_at } } : NOOP;
    }
    case "PAYMENT.AUTHORIZATION.VOIDED": return { lookup, fact: { type: "authorization_voided", authorization_id: id } };
    case "PAYMENT.CAPTURE.COMPLETED": return { lookup, fact: { type: "capture_completed", capture_id: id } };
    case "PAYMENT.CAPTURE.PENDING": return { lookup, fact: { type: "capture_pending", capture_id: id, reason } };
    case "PAYMENT.CAPTURE.DECLINED": return { lookup, fact: { type: "capture_declined", capture_id: id, reason } };
    default: return NOOP;
  }
}

/** 02 section 6.8 step 3. Any throw after the upsert leaves processed_at null (last_error set best-effort) and propagates. */
export async function applyPaypalEvent(event: PaypalWebhookEvent, deps: Deps): Promise<{ outcome: WebhookOutcome }> {
  const { db } = deps;
  await db.$executeRaw`INSERT INTO "webhook_events" ("paypal_event_id", "event_type", "verified", "body")
    VALUES (${event.id}, ${event.event_type}, ${event.verified}, ${JSON.stringify(event.body)}::jsonb)
    ON CONFLICT ("paypal_event_id") DO UPDATE SET "verified" = EXCLUDED."verified" WHERE "webhook_events"."processed_at" IS NULL`;
  if (!event.verified) return { outcome: "unverified" };
  const row = await db.webhookEvent.findUniqueOrThrow({ where: { paypal_event_id: event.id }, select: { processed_at: true } });
  if (row.processed_at) return { outcome: "already_processed" };
  try {
    return { outcome: await process(event, deps) };
  } catch (e) {
    const last_error = e instanceof Error ? e.message : String(e);
    await db.webhookEvent.update({ where: { paypal_event_id: event.id }, data: { last_error } }).catch(() => {});
    throw e;
  }
}

type Db = Deps["db"] | Tx;
const inTx = <T>(deps: Deps, fn: (tx: Tx) => Promise<T>) => deps.db.$transaction(fn, TX_OPTIONS);
const markProcessed = (db: Db, deps: Deps, eventId: string) =>
  db.webhookEvent.update({ where: { paypal_event_id: eventId }, data: { processed_at: deps.clock.now() } });

/** The live deal behind the lookup, locked and fully loaded; null when unknown or seeded (02 section 5.5). */
async function lockAndLoad(tx: Tx, lookup: Lookup): Promise<DealRow | null> {
  const found =
    lookup.kind === "sender_item_id"
      ? (await tx.payout.findUnique({ where: { sender_batch_id: lookup.value }, select: { deal: { select: { id: true, seeded: true } } } }))?.deal
      : await tx.deal.findUnique({ where: { public_code: lookup.value }, select: { id: true, seeded: true } });
  if (!found || found.seeded) return null;
  await lockDeal(tx, found.id);
  return openDealRow(await tx.deal.findUniqueOrThrow({ where: { id: found.id }, include: DEAL_INCLUDE }));
}

async function process(event: PaypalWebhookEvent, deps: Deps): Promise<WebhookOutcome> {
  const m = toFact(event);
  if ("noop" in m) {
    await markProcessed(deps.db, deps, event.id);
    return "noop";
  }
  if ("approved_order_id" in m) return applyApprovedOrder(m.lookup, m.approved_order_id, event.id, deps);
  const src: FactSource = { source: "webhook", paypal_event_id: event.id };
  const done = await inTx(deps, async (tx) => {
    const deal = await lockAndLoad(tx, m.lookup);
    const result = deal ? await applyFactTx(tx, deps, deal, m.fact, src) : null;
    await markProcessed(tx, deps, event.id);
    return deal && result ? { deal, result } : null;
  });
  if (!done) return "unknown_deal";
  await afterCommit(deps, done.deal, done.result);
  return done.result.outcome;
}

/** E8 (02 sections 5.5, 6.7, 8.2): Tx 1 writes the intent (approved), authorizeOrder with auth-{code}, Tx 2 applies the fact. */
async function applyApprovedOrder(lookup: Lookup, order_id: string, eventId: string, deps: Deps): Promise<WebhookOutcome> {
  const code = lookup.value;
  const src: FactSource = { source: "webhook", paypal_event_id: eventId };
  const intent = await inTx(deps, async (tx) => {
    const deal = await lockAndLoad(tx, lookup);
    const p = deal?.payment;
    const wanted = deal?.status === "terms_agreed" && p?.paypal_order_id === order_id && (p.status === "created" || p.status === "approved");
    if (!deal) await markProcessed(tx, deps, eventId);
    else if (wanted) await tx.payment.update({ where: { id: p.id }, data: { status: "approved" } });
    else await markProcessed(tx, deps, eventId); // voided after a cancel, already held, another order: a stale popup places no hold
    return !deal ? "unknown_deal" : wanted ? "proceed" : "noop";
  });
  if (intent !== "proceed") return intent;

  const key = authKey(code);
  let auth;
  try {
    auth = await deps.paypal.authorizeOrder(order_id, key);
  } catch (e) {
    if (e instanceof PayPalError && (e.name_ === "ORDER_ALREADY_AUTHORIZED" || e.name_ === "ORDER_COMPLETED_OR_VOIDED")) {
      await markProcessed(deps.db, deps, eventId); // the authorization event carries the fact
      return "noop";
    }
    throw e; // PayPal retries the delivery
  }

  const done = await inTx(deps, async (tx) => {
    const deal = (await lockAndLoad(tx, lookup))!;
    const p = deal.payment;
    let result: FactResult = { outcome: "noop" };
    if (auth.status === "CREATED") {
      if (p?.paypal_order_id !== order_id) {
        // the order was superseded by a second start_payment: a stray hold, voided with its own key (02 section 5.3)
        await deps.paypal.voidAuthorization(auth.authorization_id, strayVoidKey(auth.authorization_id));
        await writeEvent(tx, deal, "paypal", "fact:late_authorization_voided", { authorization_id: auth.authorization_id, auth_expires_at: auth.expiration_time, ...src });
      } else {
        const fact: PaypalFact = { type: "authorization_created", authorization_id: auth.authorization_id, auth_expires_at: auth.expiration_time };
        result = await applyFactTx(tx, deps, deal, fact, src);
      }
    } else if (auth.status === "PENDING" && p?.paypal_order_id === order_id) {
      // the hold is not placed yet: keep the ids so cancel can void it and its CREATED webhook can finish it (02 section 7)
      await tx.payment.update({
        where: { id: p.id },
        data: { authorization_id: auth.authorization_id, authorized_at: deps.clock.now(), auth_expires_at: new Date(auth.expiration_time), status: "approved" },
      });
    }
    await markProcessed(tx, deps, eventId);
    return { deal, result };
  });
  await afterCommit(deps, done.deal, done.result);
  return done.result.outcome;
}
