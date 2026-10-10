// The fact-applied-once rule, pure (decisions C3, C4; 02 section 5.3). The caller (T-09) locks the row, applies the
// returned patches, writes the event (a transition when detailOnly is false, a from_status = to_status event when
// true) and runs sendPayout after commit when triggerPayout is true. Never throws.
import type { DealStatus, PaymentStatus, PayoutStatus } from "./types";

export type PaypalFact =
  | { type: "authorization_created"; authorization_id: string; auth_expires_at: string }
  | { type: "capture_completed"; capture_id: string }
  | { type: "capture_pending"; capture_id: string; reason: string | null }
  | { type: "capture_declined"; capture_id: string; reason: string | null }
  | { type: "authorization_voided"; authorization_id: string }
  | { type: "payout_succeeded"; sender_item_id: string; payout_batch_id: string; payout_item_id: string }
  | { type: "payout_failed"; sender_item_id: string; payout_batch_id: string | null; payout_item_id: string | null; failure_reason: string };

export type PaymentSnapshot = { authorization_id: string | null; capture_id: string | null; status: PaymentStatus; capture_attempts: number };
export type PayoutSnapshot = { attempt: number; sender_batch_id: string; status: PayoutStatus; paypal_item_id: string | null };
export type DealSnapshot = { status: DealStatus; payment: PaymentSnapshot | null; payouts: PayoutSnapshot[] };

export type PayoutUpdate = {
  sender_batch_id: string;
  status: PayoutStatus;
  paypal_batch_id: string | null;
  paypal_item_id: string | null;
  failure_reason?: string;
};

export type FactResult =
  | { changed: false }
  | {
      changed: true;
      next: DealStatus;
      payment: Partial<PaymentSnapshot & { auth_expires_at: string }>;
      payoutUpdate?: PayoutUpdate;
      triggerPayout: boolean; // first sight of capture COMPLETED on a captured deal with no payouts row (E7)
      detailOnly: boolean; // next === status: an event with from_status = to_status, not a transition
      /** authorization_created outside terms_agreed (02 section 5.3): "stored" voids with void-{code}, "stray" with void-{authorization_id}. */
      lateAuthorization?: "stored" | "stray";
    };

type Applied = Extract<FactResult, { changed: true }>;

const NO_PAYMENT: PaymentSnapshot = { authorization_id: null, capture_id: null, status: "created", capture_attempts: 0 };
const UNCHANGED: FactResult = { changed: false };
const PRE_CAPTURE: readonly DealStatus[] = ["draft", "terms_agreed", "held", "proof_submitted", "in_review"];

export function applyFact(snapshot: DealSnapshot, fact: PaypalFact): FactResult {
  const { status } = snapshot;
  const p = snapshot.payment ?? NO_PAYMENT;
  const done = (next: DealStatus, payment: Applied["payment"], extra: Partial<Applied> = {}): FactResult =>
    ({ changed: true, next, payment, triggerPayout: false, detailOnly: next === status, ...extra });

  switch (fact.type) {
    case "authorization_created": {
      // a PENDING authorization is stored with status approved and is NOT seen: its CREATED webhook must still move the deal to held
      if (p.authorization_id === fact.authorization_id && p.status !== "approved") return UNCHANGED;
      const stored = { authorization_id: fact.authorization_id, auth_expires_at: fact.auth_expires_at };
      if (status === "terms_agreed" && (p.authorization_id === null || p.authorization_id === fact.authorization_id)) {
        return done("held", { ...stored, status: "authorized" });
      }
      if (p.authorization_id === null) return done(status, { ...stored, status: "voided" }, { lateAuthorization: "stored" });
      return done(status, {}, { lateAuthorization: "stray" }); // the stored id is never replaced (E3)
    }
    case "capture_completed": {
      if (p.capture_id === fact.capture_id && p.status === "captured") return UNCHANGED;
      const next: DealStatus = status === "proof_submitted" || status === "in_review" || status === "captured" ? "captured" : status;
      return done(next, { capture_id: fact.capture_id, status: "captured" }, { triggerPayout: next === "captured" && snapshot.payouts.length === 0 });
    }
    case "capture_pending": {
      if (p.capture_id === fact.capture_id && (p.status === "capture_pending" || p.status === "captured" || p.status === "declined")) return UNCHANGED;
      const next: DealStatus = status === "proof_submitted" || status === "in_review" ? "captured" : status;
      return done(next, { capture_id: fact.capture_id, status: "capture_pending" });
    }
    case "capture_declined": {
      if (p.capture_id === fact.capture_id && p.status === "declined") return UNCHANGED;
      const next: DealStatus = status === "captured" ? "in_review" : status;
      return done(next, { capture_id: fact.capture_id, status: "declined", capture_attempts: p.capture_attempts + 1 }); // E4: only a decline advances n
    }
    case "authorization_voided": {
      if (p.status === "voided") return UNCHANGED;
      const next: DealStatus = PRE_CAPTURE.includes(status) && p.capture_id === null ? "voided" : status;
      return done(next, { status: "voided" });
    }
    case "payout_succeeded": {
      const row = snapshot.payouts.find((r) => r.sender_batch_id === fact.sender_item_id);
      if (!row || row.status === "success") return UNCHANGED;
      const latest = row.attempt === Math.max(...snapshot.payouts.map((r) => r.attempt));
      const next: DealStatus = status === "captured" && latest ? "paid" : status;
      return done(next, {}, {
        payoutUpdate: { sender_batch_id: row.sender_batch_id, status: "success", paypal_batch_id: fact.payout_batch_id, paypal_item_id: fact.payout_item_id },
      });
    }
    case "payout_failed": {
      const row = snapshot.payouts.find((r) => r.sender_batch_id === fact.sender_item_id);
      if (!row || row.status !== "pending") return UNCHANGED;
      return done(status, {}, {
        payoutUpdate: { sender_batch_id: row.sender_batch_id, status: "failed", paypal_batch_id: fact.payout_batch_id, paypal_item_id: fact.payout_item_id, failure_reason: fact.failure_reason },
      });
    }
  }
}
