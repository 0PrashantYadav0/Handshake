// reconcile() (trust-and-accounts spec section 9; decision E12): the tick step for late or lost webhooks. It asks PayPal
// about payments and payouts still waiting on a webhook past a threshold and applies the fact that webhook would have
// carried, through applyFactTx with source "reconcile" under the row lock, so whichever of the two arrives second is a
// no-op (C3). Each deal in its own transaction; a PayPal error on one lands in errors and the run goes on. Seeded deals
// have no PayPal objects (F6) and are skipped.
import { afterCommit, applyFactTx, captureFact, lockAndLoad, payoutItemFact, rethrowPaypal, type PaypalFact } from "./facts-db";
import { DEAL_INCLUDE } from "./access";
import { recordContractFailure, verifyContract } from "./contract";
import { strayVoidKey } from "./keys";
import { openDealRow } from "./sealed";
import { TX_OPTIONS } from "./transition";
import type { Deps, TickReport } from "./types";

export const CAPTURE_PENDING_MS = 10 * 60_000; // payments capture_pending: GET the capture
export const APPROVED_HOLD_MS = 10 * 60_000; // payments approved with a PENDING authorization stored: GET the authorization
export const PAYOUT_PENDING_MS = 30 * 60_000; // payouts pending with a batch id: GET the batch

export async function reconcile(now: Date, deps: Deps): Promise<Pick<TickReport, "reconciled" | "errors">> {
  const report: Pick<TickReport, "reconciled" | "errors"> = { reconciled: [], errors: [] };
  const before = (ms: number) => ({ lt: new Date(now.getTime() - ms) });
  const code = { select: { public_code: true } } as const;

  const captures = await deps.db.payment.findMany({
    where: { status: "capture_pending", capture_id: { not: null }, updated_at: before(CAPTURE_PENDING_MS), deal: { seeded: false } },
    select: { deal_id: true, capture_id: true, deal: code },
  });
  const holds = await deps.db.payment.findMany({
    where: { status: "approved", authorization_id: { not: null }, updated_at: before(APPROVED_HOLD_MS), deal: { seeded: false, status: "terms_agreed" } },
    select: { deal_id: true, authorization_id: true, deal: code },
  });
  const payouts = await deps.db.payout.findMany({
    where: { status: "pending", paypal_batch_id: { not: null }, updated_at: before(PAYOUT_PENDING_MS), deal: { seeded: false } },
    select: { deal_id: true, sender_batch_id: true, paypal_batch_id: true, deal: code },
  });

  const attempt = async (row: { deal_id: string; deal: { public_code: string } }, ask: () => Promise<PaypalFact | null>) => {
    try {
      const fact = await ask().catch((e) => rethrowPaypal(e, "read")); // the message carries the PayPal name and debug_id
      if (fact && (await apply(row.deal_id, fact, deps))) report.reconciled.push(row.deal.public_code);
    } catch (e) {
      report.errors.push({ code: row.deal.public_code, message: e instanceof Error ? e.message : String(e) });
    }
  };

  for (const p of captures) await attempt(p, async () => captureFact(await deps.paypal.getCapture(p.capture_id!)));
  for (const p of holds) {
    await attempt(p, async () => {
      const a = await deps.paypal.getAuthorization(p.authorization_id!);
      if (a.status === "CREATED") {
        // trust spec §7, review finding 4: a hold on a contract that no longer verifies is released instead of recorded.
        const deal = openDealRow(await deps.db.deal.findUniqueOrThrow({ where: { id: p.deal_id }, include: DEAL_INCLUDE }));
        const problem = await verifyContract(deal);
        if (!problem) return { type: "authorization_created", authorization_id: a.authorization_id, auth_expires_at: a.expiration_time };
        await deps.paypal.voidAuthorization(a.authorization_id, strayVoidKey(a.authorization_id));
        await recordContractFailure(deal.id, deps, "confirm_approval", problem);
        return { type: "authorization_voided", authorization_id: a.authorization_id };
      }
      // DENIED has no webhook and will never hold money: read as a void, so the deal ends instead of blocking start_payment and cancel (E12)
      if (a.status === "VOIDED" || a.status === "DENIED") return { type: "authorization_voided", authorization_id: a.authorization_id };
      return null; // still PENDING review
    });
  }
  for (const r of payouts) {
    await attempt(r, async () => {
      const batch = await deps.paypal.getPayoutBatch(r.paypal_batch_id!);
      const item = batch.items.find((i) => i.sender_item_id === r.sender_batch_id);
      if (!item) return null;
      const word = item.transaction_status === "SUCCESS" ? "SUCCEEDED" : item.transaction_status;
      return payoutItemFact(word, { sender_item_id: r.sender_batch_id, payout_batch_id: batch.payout_batch_id, payout_item_id: item.payout_item_id, error_name: item.error_name });
    });
  }
  return report;
}

/** The fact under the row lock, then its after-commit effects (the payout on a first COMPLETED, the declined notice). true when applied. */
async function apply(dealId: string, fact: PaypalFact, deps: Deps): Promise<boolean> {
  const done = await deps.db.$transaction(async (tx) => {
    const deal = await lockAndLoad(tx, dealId);
    return { deal, result: await applyFactTx(tx, deps, deal, fact, { source: "reconcile" }) };
  }, TX_OPTIONS);
  await afterCommit(deps, done.deal, done.result);
  return done.result.outcome === "applied";
}
