// applyFact(): every bullet of 06 "Facts applied once" (C3, C4; 02 section 5.3).
import { describe, expect, it } from "vitest";
import { applyFact, type DealSnapshot, type PaymentSnapshot, type PayoutSnapshot } from "@/lib/deal/facts";
import type { DealStatus } from "@/lib/deal/types";

const pay = (p: Partial<PaymentSnapshot> = {}): PaymentSnapshot => ({ authorization_id: "AUTH-1", capture_id: null, status: "authorized", capture_attempts: 0, ...p });
const snap = (status: DealStatus, payment: PaymentSnapshot | null = pay(), payouts: PayoutSnapshot[] = []): DealSnapshot => ({ status, payment, payouts });
const payout = (attempt: number, status: PayoutSnapshot["status"] = "pending"): PayoutSnapshot => ({ attempt, sender_batch_id: `payout-HS-7K2Q-${attempt}`, status, paypal_item_id: null });
const applied = (r: ReturnType<typeof applyFact>) => {
  if (!r.changed) throw new Error("expected changed: true");
  return r;
};
const completed = (id: string) => ({ type: "capture_completed" as const, capture_id: id });
const pending = (id: string) => ({ type: "capture_pending" as const, capture_id: id, reason: "PENDING_REVIEW" });
const declined = (id: string) => ({ type: "capture_declined" as const, capture_id: id, reason: "DECLINED" });
const voided = { type: "authorization_voided" as const, authorization_id: "AUTH-1" };
const succeeded = (n: number) => ({ type: "payout_succeeded" as const, sender_item_id: `payout-HS-7K2Q-${n}`, payout_batch_id: "B1", payout_item_id: `I${n}` });
const failed = (n: number) => ({ type: "payout_failed" as const, sender_item_id: `payout-HS-7K2Q-${n}`, payout_batch_id: "B1", payout_item_id: `I${n}`, failure_reason: "FAILED" });

describe("applyFact(): authorization_created", () => {
  const fact = { type: "authorization_created" as const, authorization_id: "AUTH-1", auth_expires_at: "2026-11-18T10:00:00Z" };
  it("AUTH-1 on terms_agreed -> held; again on held -> unchanged", () => {
    const r = applied(applyFact(snap("terms_agreed", pay({ authorization_id: null, status: "approved" })), fact));
    expect(r.next).toBe("held");
    expect(r.payment).toEqual({ authorization_id: "AUTH-1", auth_expires_at: fact.auth_expires_at, status: "authorized" });
    expect(r.detailOnly).toBe(false);
    expect(applyFact(snap("held", pay({ authorization_id: "AUTH-1" })), fact)).toEqual({ changed: false });
  });
  it("a PENDING authorization stored as approved is not seen: its CREATED webhook still moves the deal to held", () => {
    expect(applied(applyFact(snap("terms_agreed", pay({ authorization_id: "AUTH-1", status: "approved" })), fact)).next).toBe("held");
  });
  it("late authorization on a cancelled deal with no stored id -> status unchanged, payment voided, void-{code}", () => {
    const r = applied(applyFact(snap("voided", pay({ authorization_id: null, status: "voided" })), fact));
    expect(r).toMatchObject({ next: "voided", detailOnly: true, lateAuthorization: "stored", payment: { authorization_id: "AUTH-1", status: "voided" } });
  });
  it("stray second authorization on a deal that stores another id -> payment untouched, void-{authorization_id}", () => {
    const r = applied(applyFact(snap("held", pay({ authorization_id: "AUTH-0" })), fact));
    expect(r).toMatchObject({ next: "held", detailOnly: true, lateAuthorization: "stray", payment: {} });
  });
  it("never throws on a snapshot without a payments row", () => {
    expect(applyFact(snap("draft", null), fact).changed).toBe(true);
  });
});

describe("applyFact(): capture_completed / capture_pending", () => {
  it("CAP-1 on captured with capture_id null -> changed, capture_id set, payments.status captured, triggerPayout; again -> unchanged", () => {
    const r = applied(applyFact(snap("captured"), completed("CAP-1")));
    expect(r).toMatchObject({ next: "captured", detailOnly: true, triggerPayout: true, payment: { capture_id: "CAP-1", status: "captured" } });
    expect(applyFact(snap("captured", pay({ capture_id: "CAP-1", status: "captured" }), [payout(1)]), completed("CAP-1"))).toEqual({ changed: false });
  });
  it("CAP-1 on proof_submitted or in_review with capture_id null -> captured, triggerPayout (requested by a dead attempt)", () => {
    for (const s of ["proof_submitted", "in_review"] as const) {
      expect(applied(applyFact(snap(s), completed("CAP-1")))).toMatchObject({ next: "captured", detailOnly: false, triggerPayout: true });
    }
  });
  it("capture_pending there -> captured, payments.status capture_pending, no payout", () => {
    for (const s of ["proof_submitted", "in_review"] as const) {
      expect(applied(applyFact(snap(s), pending("CAP-1")))).toMatchObject({ next: "captured", triggerPayout: false, payment: { capture_id: "CAP-1", status: "capture_pending" } });
    }
  });
  it("capture_pending CAP-1 then capture_completed CAP-1 -> second changes payments.status to captured and triggers the payout once", () => {
    const first = applied(applyFact(snap("captured"), pending("CAP-1")));
    expect(first.triggerPayout).toBe(false);
    const afterPending = snap("captured", pay({ ...first.payment }));
    const second = applied(applyFact(afterPending, completed("CAP-1")));
    expect(second).toMatchObject({ triggerPayout: true, payment: { status: "captured" } });
    expect(applyFact(snap("captured", pay({ capture_id: "CAP-1", status: "captured" }), [payout(1)]), completed("CAP-1"))).toEqual({ changed: false });
    expect(applyFact(snap("captured", pay({ capture_id: "CAP-1", status: "captured" }), [payout(1)]), pending("CAP-1"))).toEqual({ changed: false });
  });
  it("no second payout when a payouts row already exists", () => {
    expect(applied(applyFact(snap("captured", pay({ capture_id: "CAP-1", status: "capture_pending" }), [payout(1)]), completed("CAP-1"))).triggerPayout).toBe(false);
  });
});

describe("applyFact(): capture_declined", () => {
  it("CAP-1 on captured -> in_review, payments.capture_attempts 1; CAP-2 later on captured -> applied", () => {
    const r = applied(applyFact(snap("captured", pay({ capture_id: "CAP-1", status: "captured" })), declined("CAP-1")));
    expect(r).toMatchObject({ next: "in_review", detailOnly: false, payment: { capture_id: "CAP-1", status: "declined", capture_attempts: 1 } });
    expect(applyFact(snap("in_review", pay({ capture_id: "CAP-1", status: "declined", capture_attempts: 1 })), declined("CAP-1"))).toEqual({ changed: false });
    const again = applied(applyFact(snap("captured", pay({ capture_id: "CAP-1", status: "declined", capture_attempts: 1 })), completed("CAP-2")));
    expect(again).toMatchObject({ next: "captured", triggerPayout: true, payment: { capture_id: "CAP-2", status: "captured" } });
  });
});

describe("applyFact(): authorization_voided", () => {
  it("on voided -> unchanged", () => {
    expect(applyFact(snap("voided", pay({ status: "voided" })), voided)).toEqual({ changed: false });
  });
  it("on proof_submitted or in_review with capture_id null -> voided (not deferred to tick)", () => {
    for (const s of ["proof_submitted", "in_review"] as const) {
      expect(applied(applyFact(snap(s), voided))).toMatchObject({ next: "voided", detailOnly: false, payment: { status: "voided" } });
    }
  });
  it("on captured or paid with capture_id set -> status unchanged, payments.status voided, event from_status = to_status", () => {
    for (const s of ["captured", "paid"] as const) {
      expect(applied(applyFact(snap(s, pay({ capture_id: "CAP-1", status: "captured" })), voided))).toMatchObject({ next: s, detailOnly: true, payment: { status: "voided" } });
    }
  });
});

describe("applyFact(): payout_succeeded / payout_failed", () => {
  it("payout-HS-7K2Q-1 on captured -> paid; again -> unchanged; payout_failed after it -> unchanged", () => {
    const r = applied(applyFact(snap("captured", pay({ capture_id: "CAP-1", status: "captured" }), [payout(1)]), succeeded(1)));
    expect(r).toMatchObject({ next: "paid", detailOnly: false, payoutUpdate: { sender_batch_id: "payout-HS-7K2Q-1", status: "success", paypal_batch_id: "B1", paypal_item_id: "I1" } });
    const paid = snap("paid", pay({ capture_id: "CAP-1", status: "captured" }), [payout(1, "success")]);
    expect(applyFact(paid, succeeded(1))).toEqual({ changed: false });
    expect(applyFact(paid, failed(1))).toEqual({ changed: false });
  });
  it("payout_failed on captured -> row failed with reason, status unchanged; a second failure is unchanged", () => {
    const r = applied(applyFact(snap("captured", pay(), [payout(1)]), failed(1)));
    expect(r).toMatchObject({ next: "captured", detailOnly: true, payoutUpdate: { status: "failed", failure_reason: "FAILED", paypal_item_id: "I1" } });
    expect(applyFact(snap("captured", pay(), [payout(1, "failed")]), failed(1))).toEqual({ changed: false });
  });
  it("payout_succeeded for attempt 1 on paid whose latest attempt is 2 -> row 1 success, event paid -> paid", () => {
    const r = applied(applyFact(snap("paid", pay(), [payout(1, "failed"), payout(2, "success")]), succeeded(1)));
    expect(r).toMatchObject({ next: "paid", detailOnly: true, payoutUpdate: { sender_batch_id: "payout-HS-7K2Q-1", status: "success" } });
  });
  it("payout_succeeded for an earlier attempt on captured -> row only, no transition", () => {
    const r = applied(applyFact(snap("captured", pay(), [payout(1, "failed"), payout(2)]), succeeded(1)));
    expect(r).toMatchObject({ next: "captured", detailOnly: true });
  });
  it("payout fact for an unknown sender_item_id -> unchanged, never throws", () => {
    expect(applyFact(snap("captured", pay(), []), succeeded(3))).toEqual({ changed: false });
  });
});

describe("applyFact(): a fact matching no row", () => {
  it("capture_completed CAP-1 on paid -> unchanged when CAP-1 is stored; detail-only paid -> paid when the id is new; never invalid_state", () => {
    const stored = pay({ capture_id: "CAP-1", status: "captured" });
    expect(applyFact(snap("paid", stored, [payout(1, "success")]), completed("CAP-1"))).toEqual({ changed: false });
    expect(applied(applyFact(snap("paid", stored, [payout(1, "success")]), completed("CAP-9")))).toMatchObject({ next: "paid", detailOnly: true, triggerPayout: false });
  });
  it("payout_succeeded on held -> detail-only or unchanged, never a transition", () => {
    const r = applyFact(snap("held", pay(), [payout(1)]), succeeded(1));
    expect(r.changed && r.next).toBe("held");
  });
});
