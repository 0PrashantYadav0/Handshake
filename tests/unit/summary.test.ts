// Trust spec §10: the dashboard figures, "Needs you" and the Buying/Selling rows on fixture deals in every state for both roles.
import { describe, expect, it } from "vitest";
import type { DealView, Payment, Payout, Role } from "@/lib/deal/types";
import { buildFigures, buildNeedsYou, buildSummary, inMonth, onHold, releasedAt, type SummaryDeal } from "@/lib/deal/summary";

const NOW = new Date("2026-10-15T12:00:00Z");
const buyer = { display_name: "Demo Buyer", email: "b@x" };
const seller = { display_name: "Demo Seller", email: "s@x", has_paypal_email: true, payout_email_verified: true, paypal_email: "s-pp@x" };
const base: SummaryDeal = {
  code: "HS-0000", role: "buyer", status: "draft", item_title: "mug", source_text: "", amount_minor: 1000, currency: "USD",
  deadline_days: 5, deadline_at: null, terms_version: 1, buyer_accepted_version: null, seller_accepted_version: null, fix_attempts_used: 0,
  buyer, seller, conditions: [], reference_files: [], submissions: [], payment: null, payouts: [], contract: null, seeded: false,
  created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z", events: [],
};
const pay = (status: Payment["status"], over: Partial<Payment> = {}): Payment => ({
  status, paypal_order_id: "O-1", authorization_id: status === "created" || status === "approved" ? null : "AUTH-1",
  authorized_at: "2026-10-02T00:00:00Z", auth_expires_at: "2026-10-31T00:00:00Z", capture_id: ["captured", "capture_pending", "declined"].includes(status) ? "CAP-1" : null, ...over,
});
const payout = (over: Partial<Payout>): Payout => ({
  attempt: 1, status: "pending", amount_minor: 1000, sender_batch_id: "payout-HS-1", paypal_batch_id: "B-1", paypal_item_id: "I-1", failure_reason: null,
  created_at: "2026-10-03T00:00:00Z", ...over,
});
const captureEvent = (at: string) => ({ id: "9", from_status: "captured" as const, to_status: "captured" as const, actor: "paypal" as const, cause: "fact:capture_completed", payload: {}, created_at: at });
let n = 0;
const deal = (role: Role, status: DealView["status"], over: Partial<SummaryDeal> = {}): SummaryDeal =>
  ({ ...base, code: `HS-${++n}`, role, status, ...over });
const released = (role: Role, amount: number, at: string, over: Partial<SummaryDeal> = {}) =>
  deal(role, "captured", { amount_minor: amount, payment: pay("captured"), events: [captureEvent(at)], ...over });
const verified: { paypal_email: string | null; paypal_email_verified: boolean } = { paypal_email: "s-pp@x", paypal_email_verified: true };

describe("helpers", () => {
  it("onHold: an authorization in held, proof_submitted and in_review; declined still holds; nothing else does", () => {
    for (const s of ["held", "proof_submitted", "in_review"] as const) expect(onHold(s, pay("authorized"))).toBe(true);
    expect(onHold("in_review", pay("declined"))).toBe(true);
    expect(onHold("captured", pay("capture_pending"))).toBe(false);
    expect(onHold("captured", pay("captured"))).toBe(false);
    expect(onHold("voided", pay("voided"))).toBe(false);
    expect(onHold("terms_agreed", pay("approved"))).toBe(false);
    expect(onHold("held", null)).toBe(false);
    expect(onHold("held", pay("authorized", { authorization_id: null }))).toBe(false);
  });
  it("inMonth: UTC calendar month, both edges", () => {
    expect(inMonth("2026-10-01T00:00:00Z", NOW)).toBe(true);
    expect(inMonth("2026-10-31T23:59:59.999Z", NOW)).toBe(true);
    expect(inMonth("2026-09-30T23:59:59.999Z", NOW)).toBe(false);
    expect(inMonth("2026-11-01T00:00:00Z", NOW)).toBe(false);
    expect(inMonth("2026-09-30T23:30:00-01:00", NOW)).toBe(true); // 00:30 UTC on 1 Oct
    expect(inMonth(null, NOW)).toBe(false);
    expect(inMonth("2026-12-31T23:00:00Z", new Date("2026-12-05T00:00:00Z"))).toBe(true); // year end
  });
  it("releasedAt: the first fact:capture_completed", () => {
    expect(releasedAt([{ cause: "review:approve", created_at: "a" }, captureEvent("b"), captureEvent("c")])).toBe("b");
    expect(releasedAt([])).toBeNull();
  });
});

describe("buildFigures", () => {
  it("adds holds per role, releases this month per role, successful payouts; skips seeded deals", () => {
    const deals = [
      deal("buyer", "held", { amount_minor: 1000, payment: pay("authorized") }),
      deal("buyer", "proof_submitted", { amount_minor: 500, payment: pay("authorized") }),
      deal("buyer", "in_review", { amount_minor: 2000, payment: pay("declined") }),
      deal("buyer", "terms_agreed", { amount_minor: 4444, payment: pay("approved") }), // approved, not yet held
      deal("buyer", "held", { amount_minor: 9999, payment: pay("authorized"), seeded: true }),
      deal("seller", "held", { amount_minor: 700, payment: pay("authorized") }),
      deal("seller", "in_review", { amount_minor: 300, payment: pay("authorized") }),
      deal("seller", "voided", { amount_minor: 800, payment: pay("voided") }),
      released("seller", 4000, "2026-10-01T00:00:00Z", { payouts: [payout({ status: "failed", amount_minor: 4000 }), payout({ attempt: 2, status: "success", amount_minor: 4000 })] }),
      released("seller", 5000, "2026-09-30T23:59:59Z", { status: "paid", payouts: [payout({ status: "success", amount_minor: 5000 })] }),
      deal("seller", "captured", { amount_minor: 6000, payment: pay("capture_pending") }), // not released until PayPal completes it
      released("seller", 7000, "2026-10-10T00:00:00Z", { seeded: true, payouts: [payout({ status: "success", amount_minor: 7000 })] }),
      released("buyer", 600, "2026-10-14T00:00:00Z", { status: "paid" }),
      released("buyer", 900, "2026-09-14T00:00:00Z", { status: "paid" }),
    ];
    expect(buildFigures(deals, NOW)).toEqual({ on_hold_as_buyer: 3500, held_for_you_as_seller: 1000, released_to_you: 4000, you_paid: 600, paid_out_to_you: 9000 });
  });
  it("a new account is all zeros", () => {
    expect(buildFigures([], NOW)).toEqual({ on_hold_as_buyer: 0, held_for_you_as_seller: 0, released_to_you: 0, you_paid: 0, paid_out_to_you: 0 });
  });
});

describe("buildNeedsYou", () => {
  const actions = (deals: SummaryDeal[], me = verified) => buildNeedsYou(deals, me, NOW).map((x) => [x.code, x.action, x.href]);

  it("every status for both roles: only the caller's own move shows up", () => {
    const cases: [SummaryDeal, string | null][] = [
      [deal("buyer", "draft", { seller: null }), null], // share the link first
      [deal("buyer", "draft"), "Sign contract"],
      [deal("buyer", "draft", { buyer_accepted_version: 1 }), null],
      [deal("seller", "draft"), "Sign contract"],
      [deal("seller", "draft", { seller_accepted_version: 1 }), null],
      [deal("buyer", "terms_agreed"), "Pay with PayPal"],
      [deal("buyer", "terms_agreed", { payment: pay("approved") }), null],
      [deal("seller", "terms_agreed"), null],
      [deal("buyer", "held", { payment: pay("authorized") }), null],
      [deal("seller", "held", { payment: pay("authorized") }), "Submit proof for checking"],
      [deal("buyer", "proof_submitted"), null],
      [deal("seller", "proof_submitted"), null],
      [deal("buyer", "in_review", { payment: pay("authorized"), submissions: [{ submission_no: 1, submitted_at: "", files: [], tracking_number: null, carrier_status: null, note: null, verdicts: [], decision: "buyer_review", decision_reason: "unclear", decided_at: null }] }), "Review proof"],
      [deal("seller", "in_review"), null],
      [deal("buyer", "captured", { payouts: [payout({ status: "failed" })] }), null],
      [deal("seller", "captured", { payouts: [payout({ status: "pending" })] }), null],
      [deal("seller", "captured", { payouts: [payout({ status: "failed", failure_reason: "RECEIVER_ACCOUNT_INVALID" })] }), "Retry payout"],
      [deal("seller", "captured", { payouts: [payout({ status: "pending", paypal_batch_id: null })] }), "Retry payout"],
      [deal("buyer", "paid"), null],
      [deal("seller", "paid", { payouts: [payout({ status: "success" })] }), null],
      [deal("buyer", "voided"), null],
      [deal("seller", "voided"), null],
      [deal("seller", "held", { seeded: true }), null],
      [deal("seller", "captured", { seeded: true, payouts: [payout({ status: "failed" })] }), null],
    ];
    for (const [d, want] of cases) expect(actions([d])[0]?.[1] ?? null, `${d.role} ${d.status}`).toBe(want);
    expect(buildNeedsYou([cases[1]![0]], verified, NOW)[0]).toEqual({ code: cases[1]![0].code, item_title: "mug", action: "Sign contract", detail: "Sign the contract", href: `/deal/${cases[1]![0].code}` });
  });

  it("an unverified-email payout failure sends the seller to verify, then back to the deal; once verified it is a retry", () => {
    const d = deal("seller", "captured", { payouts: [payout({ status: "failed", paypal_batch_id: null, failure_reason: "PAYOUT_EMAIL_UNVERIFIED" })] });
    const unverified = { paypal_email: "s-pp@x", paypal_email_verified: false };
    expect(buildNeedsYou([d], unverified, NOW)).toEqual([
      { code: d.code, item_title: "mug", action: "Verify PayPal email", detail: "Verify your PayPal email", href: `/me?next=${encodeURIComponent(`/deal/${d.code}`)}` },
    ]);
    expect(actions([d])).toEqual([[d.code, "Retry payout", `/deal/${d.code}`]]);
  });

  it("a seller with open deals and no verified payout email is asked to add or verify one", () => {
    const d = deal("seller", "terms_agreed");
    expect(actions([d], { paypal_email: null, paypal_email_verified: false })).toEqual([[null, "Add PayPal email", "/me?next=%2Fdashboard"]]);
    expect(actions([d], { paypal_email: "s-pp@x", paypal_email_verified: false })).toEqual([[null, "Verify PayPal email", "/me?next=%2Fdashboard"]]);
    expect(actions([d])).toEqual([]);
    expect(actions([deal("seller", "paid"), deal("seller", "voided"), deal("buyer", "terms_agreed", { payment: pay("approved") })], { paypal_email: null, paypal_email_verified: false })).toEqual([]);
  });
});

describe("buildSummary", () => {
  it("splits Buying and Selling, newest first, with the other party, next step and open deadline; seeded deals are listed", () => {
    const a = deal("buyer", "held", { payment: pay("authorized"), deadline_at: "2026-10-20T00:00:00Z", updated_at: "2026-10-05T00:00:00Z" });
    const b = deal("buyer", "draft", { seller: null, updated_at: "2026-10-06T00:00:00Z" });
    const c = deal("seller", "paid", { seeded: true, deadline_at: "2026-10-09T00:00:00Z", updated_at: "2026-10-04T00:00:00Z" }); // closed: no deadline shown
    const s = buildSummary([a, b, c], verified, NOW);
    expect(s.buying).toEqual([
      { code: b.code, item_title: "mug", other_party: null, amount_minor: 1000, status: "draft", next: "Share the link with your seller", deadline_at: null, seeded: false },
      { code: a.code, item_title: "mug", other_party: "Demo Seller", amount_minor: 1000, status: "held", next: "Money held. Waiting for proof.", deadline_at: "2026-10-20T00:00:00Z", seeded: false },
    ]);
    expect(s.selling).toEqual([{ code: c.code, item_title: "mug", other_party: "Demo Buyer", amount_minor: 1000, status: "paid", next: "Paid", deadline_at: null, seeded: true }]);
    expect(s.figures.on_hold_as_buyer).toBe(1000);
    expect(s.needs_you).toEqual([]);
  });
});
