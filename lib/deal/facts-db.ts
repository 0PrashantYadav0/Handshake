// The effectful fact writer (02 section 5.3) on top of the pure applyFact() in facts.ts: payment and payout rows, the
// attempt-1 payouts insert, the late-authorization voids, the event, and what runs after commit (sendPayout, the notice).
// Shared by confirm_approval and cancel (T-08), the webhook path (T-09) and the verdict/review/tick paths (T-10).
import type { Payout } from "@/generated/prisma/client";
import { PayPalError } from "@/lib/paypal/types";
import type { DealRow } from "./access";
import { deadlineAt } from "./dates";
import { applyFact, type PaypalFact } from "./facts";
import { payoutBatchId, strayVoidKey, voidKey } from "./keys";
import { notifyCaptureDeclined } from "./notify";
import { transition, writeEvent, type Tx } from "./transition";
import type { Deps } from "./types";

export type { PaypalFact } from "./facts";
export type FactSource = { source: "api"; paypal_request_id: string } | { source: "webhook"; paypal_event_id: string };

/** What the caller must do once the transaction has committed (8.2): the payout call, the capture_declined notice. */
export type AfterCommit = { payout: Payout | null; declined: boolean };
export type FactResult = { outcome: "noop" } | { outcome: "applied"; after: AfterCommit };

/** The fact a captureAuthorization answer carries; null for a status no C2 row names (FAILED, refunds). */
export function captureFact(r: { capture_id: string; status: string; reason: string | null }): PaypalFact | null {
  if (r.status === "COMPLETED") return { type: "capture_completed", capture_id: r.capture_id };
  if (r.status === "PENDING") return { type: "capture_pending", capture_id: r.capture_id, reason: r.reason };
  if (r.status === "DECLINED") return { type: "capture_declined", capture_id: r.capture_id, reason: r.reason };
  return null;
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
    payout = await tx.payout.create({
      data: {
        deal_id: deal.id, attempt: 1, sender_batch_id: payoutBatchId(code, 1), recipient_email: deal.seller?.paypal_email ?? "",
        amount_minor: deal.amount_minor!, status: "pending",
      },
    });
    payload.payout = { attempt: 1, sender_batch_id: payout.sender_batch_id, paypal_batch_id: null, status: "pending" };
  }

  const cause = `fact:${type}`;
  if (r.detailOnly) await writeEvent(tx, deal, "paypal", cause, payload);
  else await transition(tx, deal, r.next, "paypal", cause, payload);
  return { outcome: "applied", after: { payout, declined: type === "capture_declined" && !r.detailOnly } };
}

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
