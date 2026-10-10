// 08 sections 2, 7.2 and 7.4 copy for the first-pass states.
import { describe, expect, it } from "vitest";
import type { DealView } from "@/lib/deal/types";
import { deadlineLine, paymentLine, whatNext } from "@/lib/deal-copy";

const base: DealView = {
  code: "HS-TEST", role: "buyer", status: "draft", item_title: "mug", source_text: "", amount_minor: 1800, currency: "USD",
  deadline_days: 5, deadline_at: null, terms_version: 1, buyer_accepted_version: null, seller_accepted_version: null, fix_attempts_used: 0,
  buyer: { display_name: "Demo Buyer", email: "b@x" }, seller: null, conditions: [], reference_files: [], submissions: [], payment: null,
  payouts: [], seeded: false, created_at: "2026-10-10T00:00:00Z", updated_at: "2026-10-10T00:00:00Z",
};
const seller = { display_name: "Demo Seller", email: "s@x", has_paypal_email: true, paypal_email: null };

describe("whatNext", () => {
  it("draft: buyer without a seller shares; seller reviews; preview invites", () => {
    expect(whatNext(base).heading).toBe("Share the link with your seller");
    expect(whatNext({ ...base, seller }).heading).toBe("Waiting for Demo Seller to accept");
    expect(whatNext({ ...base, seller, seller_accepted_version: 1 }).heading).toBe("Demo Seller accepted. Accept to continue.");
    expect(whatNext({ ...base, role: "seller", seller }).heading).toBe("Review the terms");
    expect(whatNext({ ...base, role: "seller", seller, seller_accepted_version: 1 }).heading).toBe("You accepted version 1");
    expect(whatNext({ role: "preview", code: "HS-TEST", item_title: "mug", amount_minor: 1800, currency: "USD", deadline_days: 5, conditions: [], buyer: { display_name: null } }).heading)
      .toBe("The buyer invited you to a deal");
  });
  it("terms_agreed: the money sentence, the recovery, reviewing and hold-failed panels", () => {
    const d: DealView = { ...base, status: "terms_agreed", seller, buyer_accepted_version: 1, seller_accepted_version: 1 };
    expect(whatNext(d)).toEqual({ heading: "Approve the hold with PayPal", helper: "PayPal holds $18.00 on your account. Nothing is charged until the proof passes or you release it yourself. If the deal is voided or the deadline passes, the hold is released." });
    const p = { status: "approved" as const, paypal_order_id: "o", authorization_id: null, authorized_at: null, auth_expires_at: null, capture_id: null };
    expect(whatNext({ ...d, payment: p }).heading).toBe("Approved. Confirming the hold…");
    expect(whatNext({ ...d, payment: p }, { holdFailed: true }).heading).toBe("The hold wasn't confirmed");
    expect(whatNext({ ...d, payment: { ...p, authorization_id: "a" } }, { holdFailed: true }).heading).toBe("PayPal is reviewing the payment");
    expect(whatNext({ ...d, role: "seller" }).heading).toBe("Waiting for Demo Buyer to approve the hold");
  });
  it("held: buyer waits, seller ships; later states get the placeholder", () => {
    const d: DealView = { ...base, status: "held", seller, deadline_at: "2026-10-15T00:00:00Z" };
    expect(whatNext(d).heading).toBe("Money held. Waiting for proof.");
    expect(whatNext({ ...d, role: "seller" }).heading).toBe("Ship it, then add your proof");
    expect(whatNext({ ...d, role: "seller", fix_attempts_used: 1 }).heading).toBe("One more try");
    expect(whatNext({ ...d, status: "paid" }).heading).toBe("Proof step comes next");
  });
});

describe("paymentLine / deadlineLine", () => {
  it("secondary status and the deadline sentence", () => {
    expect(paymentLine(null, base.updated_at)).toBeNull();
    expect(paymentLine({ status: "created", paypal_order_id: "o", authorization_id: null, authorized_at: null, auth_expires_at: null, capture_id: null }, base.updated_at)).toBe("Approval pending");
    expect(deadlineLine(base)).toBe("Seller has 5 days after the hold is placed");
    expect(deadlineLine({ status: "held", deadline_days: 5, deadline_at: "2026-10-15T00:00:00Z" }, Date.parse("2026-10-10T00:00:00Z"))).toMatch(/^Proof due .* \(in 5 days\)$/);
    expect(deadlineLine({ status: "paid", deadline_days: 5, deadline_at: "2026-10-15T00:00:00Z" })).toBeNull();
  });
});
