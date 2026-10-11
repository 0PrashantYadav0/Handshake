// The effectful fact writer (02 section 5.3) on top of the pure applyFact() in facts.ts: payment and payout rows, the
// attempt-1 payouts insert, the late-authorization voids, the event, and what runs after commit (sendPayout, the notice).
// Shared by confirm_approval and cancel (T-08), the webhook path (T-09) and the verdict/review/tick paths (T-10).
import type { Payout } from "@/generated/prisma/client";
import { PayPalError } from "@/lib/paypal/types";
import { DEAL_INCLUDE, type DealRow } from "./access";
import { deadlineAt } from "./dates";
import { DealError } from "./errors";
import { applyFact, type PaypalFact } from "./facts";
import { captureKey, payoutBatchId, strayVoidKey, voidKey } from "./keys";
import { notifyCaptureDeclined } from "./notify";
import { openDealRow } from "./sealed";
import { lockDeal, transition, TX_OPTIONS, writeEvent, type Tx } from "./transition";
import type { Deps } from "./types";

export type { PaypalFact } from "./facts";
export type FactSource = { source: "api"; paypal_request_id: string } | { source: "webhook"; paypal_event_id: string } | { source: "reconcile" };

/** What the caller must do once the transaction has committed (8.2): the payout call, the capture_declined notice. */
export type AfterCommit = { payout: Payout | null; declined: boolean };
export type FactResult = { outcome: "noop" } | { outcome: "applied"; after: AfterCommit };

/** The fact a captureAuthorization answer carries; FAILED is treated as DECLINED (04 section 9.1 step 9); null for refunds. */
export function captureFact(r: { capture_id: string; status: string; reason: string | null }): PaypalFact | null {
  if (r.status === "COMPLETED") return { type: "capture_completed", capture_id: r.capture_id };
  if (r.status === "PENDING") return { type: "capture_pending", capture_id: r.capture_id, reason: r.reason };
  if (r.status === "DECLINED" || r.status === "FAILED") return { type: "capture_declined", capture_id: r.capture_id, reason: r.reason };
  return null;
}

/** The fact a payout item status carries (02 section 5.5, E5): `word` is the PAYMENT.PAYOUTS-ITEM.* suffix, or a GET item's
 *  transaction_status with SUCCESS read as SUCCEEDED. null for every other status (pending, on hold, refunded, ...). */
export function payoutItemFact(
  word: string,
  i: { sender_item_id: string; payout_batch_id: string | null; payout_item_id: string | null; error_name: string | null },
): PaypalFact | null {
  const { sender_item_id, payout_batch_id, payout_item_id } = i;
  if (word === "SUCCEEDED") return payout_batch_id && payout_item_id ? { type: "payout_succeeded", sender_item_id, payout_batch_id, payout_item_id } : null;
  if (word === "FAILED" || word === "BLOCKED" || word === "RETURNED" || word === "UNCLAIMED") {
    return { type: "payout_failed", sender_item_id, payout_batch_id, payout_item_id, failure_reason: word === "UNCLAIMED" ? word : (i.error_name ?? word) };
  }
  return null;
}

/** PayPalError -> paypal_error with the debug id (02 section 3.3); anything else propagates as internal_error. */
export function rethrowPaypal(e: unknown, what: string): never {
  if (e instanceof PayPalError) {
    const detail = `${e.name_ ?? `HTTP ${e.status}`}${e.debug_id ? ` (debug_id ${e.debug_id})` : ""}`;
    throw new DealError("paypal_error", `PayPal ${what} failed: ${detail}`, e.debug_id ?? undefined);
  }
  throw e;
}

const inTx = <T>(deps: Deps, fn: (tx: Tx) => Promise<T>) => deps.db.$transaction(fn, TX_OPTIONS);

/** The deal locked and reloaded inside the caller's transaction (8.2 Tx-after). */
export async function lockAndLoad(tx: Tx, id: string): Promise<DealRow> {
  await lockDeal(tx, id);
  return openDealRow(await tx.deal.findUniqueOrThrow({ where: { id }, include: DEAL_INCLUDE }));
}

export type Captured = { key: string; cap: { capture_id: string; status: string; reason: string | null }; fact: PaypalFact };

/** capture-{code}-{n} on the stored authorization (8.2). A 422 AUTHORIZATION_EXPIRED / AUTHORIZATION_VOIDED applies authorization_voided
 *  and returns null (02 section 7); any other failure is paypal_error with nothing written. The caller writes Tx-after. */
export async function captureHold(deal: DealRow, deps: Deps): Promise<Captured | null> {
  const p = deal.payment!;
  const key = captureKey(deal.public_code, p.capture_attempts);
  try {
    const cap = await deps.paypal.captureAuthorization(p.authorization_id!, deal.amount_minor!, key);
    return { key, cap, fact: captureFact(cap) ?? { type: "capture_declined", capture_id: cap.capture_id, reason: cap.reason } };
  } catch (e) {
    if (!(e instanceof PayPalError && e.status === 422 && (e.name_ === "AUTHORIZATION_EXPIRED" || e.name_ === "AUTHORIZATION_VOIDED"))) rethrowPaypal(e, "capture");
    const done = await inTx(deps, async (tx) => {
      const d = await lockAndLoad(tx, deal.id);
      return { deal: d, result: await applyFactTx(tx, deps, d, { type: "authorization_voided", authorization_id: p.authorization_id! }, { source: "api", paypal_request_id: key }) };
    });
    await afterCommit(deps, done.deal, done.result);
    return null;
  }
}

/** void-{code} on the stored authorization; PREVIOUSLY_VOIDED resolves in the adapter. "captured" is C4: the void was refused because the
 *  money is captured, capture-{code}-{n} was re-sent and its fact applied; the caller then stops. Any other failure is paypal_error. */
export async function voidHold(deal: DealRow, deps: Deps): Promise<"voided" | "captured"> {
  const p = deal.payment!;
  try {
    await deps.paypal.voidAuthorization(p.authorization_id!, voidKey(deal.public_code));
    return "voided";
  } catch (e) {
    if (!(e instanceof PayPalError && e.status === 422 && e.name_ !== "PREVIOUSLY_VOIDED")) rethrowPaypal(e, "void");
    const key = captureKey(deal.public_code, p.capture_attempts);
    const cap = await deps.paypal.captureAuthorization(p.authorization_id!, deal.amount_minor!, key).catch(() => rethrowPaypal(e, "void")); // the re-sent capture also failed: the original void error
    const fact = captureFact(cap);
    if (fact) {
      const done = await inTx(deps, async (tx) => {
        const d = await lockAndLoad(tx, deal.id);
        return { deal: d, result: await applyFactTx(tx, deps, d, fact, { source: "api", paypal_request_id: key }) };
      });
      await afterCommit(deps, done.deal, done.result);
    }
    return "captured";
  }
}

/** Deal row locked by the caller. Mutates deal.status on a transition. */
export async function applyFactTx(tx: Tx, deps: Deps, deal: DealRow, fact: PaypalFact, src: FactSource): Promise<FactResult> {
  const p = deal.payment;
  const r = applyFact(
    {
      status: deal.status,
      payment: p && { authorization_id: p.authorization_id, capture_id: p.capture_id, status: p.status, capture_attempts: p.capture_attempts },
      payouts: deal.payouts.map((x) => ({ attempt: x.attempt, sender_batch_id: x.sender_batch_id, status: x.status, paypal_item_id: x.paypal_item_id })),
    },
    fact,
  );
  if (!r.changed) return { outcome: "noop" };

  const { type, ...detail } = fact;
  const payload: Record<string, unknown> = { ...detail, ...src };
  const now = deps.clock.now();
  const code = deal.public_code;

  if (r.lateAuthorization && type === "authorization_created") {
    // the deal was cancelled (or the order superseded) before PayPal answered: void at once, status unchanged
    if (r.lateAuthorization === "stored" && p) {
      await tx.payment.update({
        where: { id: p.id },
        data: { authorization_id: fact.authorization_id, authorized_at: now, auth_expires_at: new Date(fact.auth_expires_at), status: "voided" },
      });
    }
    const key = r.lateAuthorization === "stored" ? voidKey(code) : strayVoidKey(fact.authorization_id);
    await deps.paypal.voidAuthorization(fact.authorization_id, key);
    await writeEvent(tx, deal, "paypal", "fact:late_authorization_voided", payload);
    return { outcome: "applied", after: { payout: null, declined: false } };
  }

  const { auth_expires_at, ...rest } = r.payment;
  if (p && Object.keys(r.payment).length > 0) {
    await tx.payment.update({
      where: { id: p.id },
      data: { ...rest, ...(auth_expires_at ? { auth_expires_at: new Date(auth_expires_at), authorized_at: now } : {}) },
    });
  }
  if (type === "authorization_created" && r.next === "held") {
    await tx.deal.update({ where: { id: deal.id }, data: { deadline_at: new Date(deadlineAt(now, deal.deadline_days!)) } });
  }
  if (r.payoutUpdate) {
    const { sender_batch_id, status, paypal_batch_id, paypal_item_id, failure_reason } = r.payoutUpdate;
    await tx.payout.update({
      where: { sender_batch_id },
      data: { status, paypal_batch_id: paypal_batch_id ?? undefined, paypal_item_id: paypal_item_id ?? undefined, failure_reason },
    });
    payload.attempt = deal.payouts.find((x) => x.sender_batch_id === sender_batch_id)?.attempt;
  }
  let payout: Payout | null = null;
  if (r.triggerPayout) {
    // trust spec §8: money goes only to a verified address. Otherwise the row is failed at once and PayPal is not called;
    // the seller verifies the address and uses retry_payout.
    const verified = !!deal.seller?.paypal_email && !!deal.seller.paypal_email_verified_at;
    const row = await tx.payout.create({
      data: {
        deal_id: deal.id, attempt: 1, sender_batch_id: payoutBatchId(code, 1), recipient_email: deal.seller?.paypal_email ?? "",
        amount_minor: deal.amount_minor!, status: verified ? "pending" : "failed", failure_reason: verified ? null : PAYOUT_EMAIL_UNVERIFIED,
      },
    });
    payload.payout = { attempt: 1, sender_batch_id: row.sender_batch_id, paypal_batch_id: null, status: row.status, failure_reason: row.failure_reason };
    if (verified) payout = row;
  }

  const cause = `fact:${type}`;
  if (r.detailOnly) await writeEvent(tx, deal, "paypal", cause, payload);
  else await transition(tx, deal, r.next, "paypal", cause, payload);
  return { outcome: "applied", after: { payout, declined: type === "capture_declined" && !r.detailOnly } };
}

/** failure_reason of a payout held back because the seller's PayPal email is not verified (trust spec §8). */
export const PAYOUT_EMAIL_UNVERIFIED = "PAYOUT_EMAIL_UNVERIFIED";

/** Runs the after-commit effects of applyFactTx. Never throws. */
export async function afterCommit(deps: Deps, deal: DealRow, result: FactResult): Promise<void> {
  if (result.outcome !== "applied") return;
  if (result.after.payout) await sendPayout(deps, result.after.payout, deal.public_code);
  if (result.after.declined) await notifyCaptureDeclined(deps, deal);
}

/** 02 section 5.3 sendPayout: the row is pending with paypal_batch_id null. 4xx with a PayPal name -> failed; else the row stays pending. */
export async function sendPayout(deps: Deps, row: Payout, code: string): Promise<void> {
  try {
    const r = await deps.paypal.createPayout(
      { sender_batch_id: row.sender_batch_id, sender_item_id: row.sender_batch_id, receiver: row.recipient_email, amount_minor: row.amount_minor, note: `Handshake deal ${code}` },
      row.sender_batch_id,
    );
    await deps.db.payout.updateMany({ where: { id: row.id, status: "pending" }, data: { paypal_batch_id: r.payout_batch_id } });
  } catch (e) {
    if (e instanceof PayPalError && e.status >= 400 && e.status < 500 && e.name_) {
      await deps.db.payout.updateMany({ where: { id: row.id, status: "pending" }, data: { status: "failed", failure_reason: e.name_ } }).catch(() => {});
    } else {
      console.error("[payout] not confirmed, row stays pending", row.sender_batch_id, e);
    }
  }
}
