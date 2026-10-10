// 08 sections 2, 7.2, 7.4, 7.9, 7.11 and 7.13 copy and the pure rules behind the deal page.
import { describe, expect, it } from "vitest";
import type { DealEvent, DealView, Payout, Submission } from "@/lib/deal/types";
import { cancellable, canRetryPayout, deadlineLine, decisionLine, evidenceChip, modelLine, paymentLine, payoutCopy, primaryAction, timelineSentence, voidEvent, whatNext } from "@/lib/deal-copy";

const base: DealView = {
  code: "HS-TEST", role: "buyer", status: "draft", item_title: "mug", source_text: "", amount_minor: 1800, currency: "USD",
  deadline_days: 5, deadline_at: null, terms_version: 1, buyer_accepted_version: null, seller_accepted_version: null, fix_attempts_used: 0,
  buyer: { display_name: "Demo Buyer", email: "b@x" }, seller: null, conditions: [], reference_files: [], submissions: [], payment: null,
  payouts: [], seeded: false, created_at: "2026-10-10T00:00:00Z", updated_at: "2026-10-10T00:00:00Z",
};
const seller = { display_name: "Demo Seller", email: "s@x", has_paypal_email: true, paypal_email: null };
const payment = { status: "authorized" as const, paypal_order_id: "o", authorization_id: "a", authorized_at: "2026-10-10T00:00:00Z", auth_expires_at: null, capture_id: null };
const payout = (over: Partial<Payout>): Payout => ({ attempt: 1, status: "pending", amount_minor: 1800, sender_batch_id: "payout-HS-TEST-1", paypal_batch_id: "B1", paypal_item_id: null, failure_reason: null, created_at: base.created_at, ...over });
const verdict = (result: "pass" | "fail" | "unclear", confidence = 0.95) => ({ condition_id: "c", result, confidence, reason: "r", evidence_used: [], model: "claude-x", prompt_version: "judge-v1" });
const sub = (over: Partial<Submission>): Submission => ({ submission_no: 1, submitted_at: base.created_at, files: [], tracking_number: null, carrier_status: null, note: null, verdicts: [], decision: null, decision_reason: null, decided_at: null, ...over });
const ev = (cause: string, actor: DealEvent["actor"], payload: Record<string, unknown> = {}, to: DealEvent["to_status"] = "draft", from: DealEvent["from_status"] = null): DealEvent =>
  ({ id: "1", from_status: from, to_status: to, actor, cause, payload, created_at: base.created_at });

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
  it("held and proof_submitted per role", () => {
    const d: DealView = { ...base, status: "held", seller, deadline_at: "2026-10-15T00:00:00Z" };
    expect(whatNext(d).heading).toBe("Money held. Waiting for proof.");
    expect(whatNext({ ...d, role: "seller" }).heading).toBe("Ship it, then add your proof");
    expect(whatNext({ ...d, role: "seller", fix_attempts_used: 1 }).heading).toBe("One more try");
    expect(whatNext({ ...d, fix_attempts_used: 1, submissions: [sub({ verdicts: [verdict("fail"), verdict("pass")] })] }).helper).toMatch(/^1 condition\(s\) failed\./);
    expect(whatNext({ ...d, status: "proof_submitted" }).heading).toBe("Checking the seller's proof…");
    expect(whatNext({ ...d, status: "proof_submitted", role: "seller" }).heading).toBe("Checking your proof…");
  });
  it("in_review: keyed by decision_reason, then by a declined capture", () => {
    const d: DealView = { ...base, status: "in_review", seller, payment, conditions: [{ id: "c", position: 1, text: "t", evidence_type: "photo", system: false }], deadline_at: "2026-10-15T00:00:00Z" };
    const w = (reason: Submission["decision_reason"], verdicts = [verdict("unclear")]) => whatNext({ ...d, submissions: [sub({ decision: "buyer_review", decision_reason: reason, verdicts })] });
    expect(w("unclear")).toMatchObject({ heading: "Your decision: Claude couldn't decide", helper: expect.stringMatching(/^1 of 1 conditions came back unclear\./) });
    expect(w("low_confidence").heading).toBe("Your decision: confidence was too low");
    expect(w("fail", [verdict("fail", 0.5)]).helper).toMatch(/^1 condition\(s\) failed on the second try/);
    expect(w("amount_over_limit").heading).toBe("Your decision: this deal is over the auto-release limit");
    expect(whatNext({ ...d, payment: { ...payment, status: "declined" } }).heading).toBe("PayPal declined the capture");
    expect(whatNext({ ...d, role: "seller" }).heading).toBe("Waiting for Demo Buyer to decide");
    expect(whatNext({ ...d, role: "seller", payment: { ...payment, status: "declined" } }).heading).toBe("PayPal declined the capture. Waiting for Demo Buyer.");
  });
  it("paid and voided (reason from the first closing event, money line from the payment)", () => {
    const d: DealView = { ...base, status: "paid", seller: { ...seller, paypal_email: "s@pp" }, payment };
    expect(whatNext(d).helper).toMatch(/^Demo Seller was paid \$18\.00 on /);
    expect(whatNext({ ...d, role: "seller" })).toMatchObject({ heading: "Paid", helper: expect.stringMatching(/^\$18\.00 was sent to s@pp on /) });
    const voided: DealView = { ...d, status: "voided" };
    const events = [ev("cancel", "seller", {}, "voided", "held"), ev("fact:authorization_voided", "paypal", {}, "voided", "voided")];
    expect(whatNext(voided, { events })).toEqual({ heading: "Deal voided", helper: "The seller cancelled the deal. The hold of $18.00 was released. Nothing was charged." });
    expect(whatNext({ ...voided, payment: null }, { events: [ev("cancel", "buyer", {}, "voided", "draft")] }).helper).toBe("The buyer cancelled the deal. No money was ever held.");
    expect(whatNext(voided, { events: [ev("tick:deadline", "system", {}, "voided", "held")] }).helper).toMatch(/^The deadline passed with no passing proof\./);
    expect(whatNext(voided, { events: [ev("decision:void", "system", {}, "voided", "proof_submitted")] }).helper).toMatch(/^The proof failed twice\./);
    expect(whatNext(voided, { events: [ev("review:reject", "buyer", {}, "voided", "in_review")] }).helper).toMatch(/^The buyer rejected the proof\./);
    expect(whatNext(voided, { events: [] }).helper).toMatch(/^The deal was closed\./);
    expect(voidEvent(events)?.cause).toBe("cancel");
  });
});

describe("payoutCopy / canRetryPayout", () => {
  const d: DealView = { ...base, status: "captured", role: "seller", seller: { ...seller, paypal_email: "s@pp" }, payment: { ...payment, status: "captured" } };
  it("seller: no payout or pending with a batch -> sending; pending without a batch -> not confirmed; failed -> reason, UNCLAIMED adds the cancel sentence", () => {
    expect(payoutCopy(d)).toEqual({ heading: "Payment released to you", helper: "PayPal is sending $18.00 to s@pp. This usually takes a minute." });
    expect(payoutCopy({ ...d, payouts: [payout({})] }).heading).toBe("Payment released to you");
    expect(payoutCopy({ ...d, payouts: [payout({ paypal_batch_id: null })] })).toEqual({ heading: "Payout not confirmed", helper: "We didn't hear back from PayPal. Retry to send the payout again." });
    expect(payoutCopy({ ...d, payouts: [payout({ status: "failed", failure_reason: "RECEIVER_ACCOUNT_INVALID" })] }))
      .toEqual({ heading: "Payout failed", helper: "PayPal couldn't pay s@pp: RECEIVER_ACCOUNT_INVALID. Check your PayPal email on your profile, then retry." });
    expect(payoutCopy({ ...d, payouts: [payout({ status: "failed", failure_reason: "UNCLAIMED" })] }).helper)
      .toMatch(/UNCLAIMED\. Check your PayPal email on your profile, then retry\. That address has no PayPal account yet\. Retrying cancels the unclaimed payment first\.$/);
  });
  it("buyer: released, or released with a failed payout; never the email", () => {
    expect(payoutCopy({ ...d, role: "buyer" })).toEqual({ heading: "Payment released", helper: "$18.00 is being charged to your PayPal and paid to Demo Seller. The deal is complete once the payout lands." });
    expect(payoutCopy({ ...d, role: "buyer", payouts: [payout({ status: "failed", failure_reason: "UNCLAIMED" })] })).toEqual({ heading: "Payment released. Payout to the seller failed.", helper: "The seller has been asked to check their PayPal email and retry. You've already paid." });
    expect(whatNext(d).heading).toBe("Payment released to you");
  });
  it("retry exactly when the latest row is failed, or pending without a batch id", () => {
    expect(canRetryPayout([])).toBe(false);
    expect(canRetryPayout([payout({})])).toBe(false);
    expect(canRetryPayout([payout({ paypal_batch_id: null })])).toBe(true);
    expect(canRetryPayout([payout({ status: "failed" })])).toBe(true);
    expect(canRetryPayout([payout({ status: "failed" }), payout({ attempt: 2 })])).toBe(false);
    expect(canRetryPayout([payout({ status: "success" })])).toBe(false);
  });
});

describe("cancellable / evidenceChip / decisionLine / timelineSentence", () => {
  it("cancel in draft, terms_agreed and held only", () => {
    expect((["draft", "terms_agreed", "held", "proof_submitted", "in_review", "captured", "paid", "voided"] as const).map(cancellable)).toEqual([true, true, true, false, false, false, false, false]);
  });
  it("chip labels map to positions, tracking, note; anything else is null", () => {
    expect(evidenceChip("e1")).toEqual({ kind: "evidence", index: 0 });
    expect(evidenceChip("r4")).toEqual({ kind: "reference", index: 3 });
    expect(evidenceChip("tracking")).toEqual({ kind: "tracking" });
    expect(evidenceChip("note")).toEqual({ kind: "note" });
    expect(evidenceChip("x9")).toBeNull();
    expect(evidenceChip("e0")).toBeNull();
  });
  it("decision line per decision, reason and role; model line", () => {
    const vs = [verdict("fail"), verdict("fail"), verdict("unclear")];
    expect(decisionLine(sub({ decision: "capture", decision_reason: "all_pass", verdicts: [verdict("pass")] }), "buyer")).toMatch(/released the payment\.$/);
    expect(decisionLine(sub({ decision: "request_fix", decision_reason: "fail", verdicts: vs }), "seller")).toBe("2 condition(s) failed. You can fix and resubmit once.");
    expect(decisionLine(sub({ decision: "request_fix", decision_reason: "fail", verdicts: vs }), "buyer")).toBe("2 condition(s) failed. The seller has one chance to fix them.");
    expect(decisionLine(sub({ decision: "void", decision_reason: "fail", verdicts: vs }), "buyer")).toMatch(/^2 condition\(s\) clearly failed on the second attempt/);
    expect(decisionLine(sub({ decision: "buyer_review", decision_reason: "unclear", verdicts: vs }), "buyer")).toBe("Claude couldn't decide on 1 condition(s), so the buyer decides.");
    expect(decisionLine(sub({ decision: "buyer_review", decision_reason: "low_confidence" }), "buyer")).toMatch(/^Claude's confidence was below/);
    expect(decisionLine(sub({ decision: "buyer_review", decision_reason: "fail", verdicts: vs }), "buyer")).toMatch(/^2 condition\(s\) failed on the second attempt, but/);
    expect(decisionLine(sub({ decision: "buyer_review", decision_reason: "amount_over_limit" }), "buyer")).toMatch(/^Every condition passed\./);
    expect(decisionLine(sub({}), "buyer")).toBeNull();
    expect(modelLine(sub({ verdicts: [verdict("pass")] }))).toMatch(/^The result and confidence come from Claude \(claude-x\)\./);
    expect(modelLine(sub({}))).toMatch(/^The result and confidence come from Claude\. /);
  });
  it("timeline sentences fill the payload and actor; unknown causes show raw", () => {
    expect(timelineSentence(ev("create", "buyer"))).toBe("Buyer created the deal from one sentence.");
    expect(timelineSentence(ev("accept", "seller", { terms_version: 2 }))).toBe("Seller accepted version 2.");
    expect(timelineSentence(ev("edit_terms", "buyer", { terms_version: 3 }))).toBe("Buyer edited the terms (now version 3).");
    expect(timelineSentence(ev("start_payment", "buyer", { order_attempt: 1 }))).toBe("Buyer started PayPal checkout (order attempt 1).");
    expect(timelineSentence(ev("submit_evidence", "seller", { submission_no: 2 }))).toBe("Seller submitted proof (attempt 2).");
    expect(timelineSentence(ev("decision:buyer_review", "system", { reason: "unclear" }))).toBe("Rule: ask the buyer to decide (unclear).");
    expect(timelineSentence(ev("cancel", "buyer"))).toBe("Buyer cancelled the deal.");
    expect(timelineSentence(ev("retry_payout", "seller", { attempt: 2 }))).toBe("Seller retried the payout (attempt 2).");
    expect(timelineSentence(ev("fact:payout_failed", "paypal", { failure_reason: "UNCLAIMED" }))).toBe("The payout failed (UNCLAIMED).");
    expect(timelineSentence(ev("fact:capture_declined", "paypal"))).toBe("PayPal declined the capture.");
    expect(timelineSentence(ev("made-up", "system"))).toBe("made-up");
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

describe("primaryAction (sticky bar, 7.2)", () => {
  it("one label per role and state, none once the viewer has nothing to do", () => {
    expect(primaryAction({ role: "preview", code: "HS-TEST", item_title: "mug", amount_minor: 1800, currency: "USD", deadline_days: 5, conditions: [], buyer: { display_name: "B" } })).toBe("Join as seller");
    expect(primaryAction(base)).toBe("Accept terms");
    expect(primaryAction({ ...base, buyer_accepted_version: 1 })).toBeNull();
    expect(primaryAction({ ...base, role: "seller", seller, seller_accepted_version: null })).toBe("Accept terms");
    expect(primaryAction({ ...base, status: "terms_agreed", seller })).toBe("Pay with PayPal");
    expect(primaryAction({ ...base, status: "terms_agreed", seller, payment: { ...payment, status: "approved", authorization_id: null } })).toBeNull();
    expect(primaryAction({ ...base, status: "terms_agreed", role: "seller", seller })).toBeNull();
    expect(primaryAction({ ...base, status: "held", role: "seller", seller, payment })).toBe("Submit proof for checking");
    expect(primaryAction({ ...base, status: "held", seller, payment })).toBeNull();
    expect(primaryAction({ ...base, status: "in_review", seller, payment, submissions: [sub({ decision: "buyer_review" })] })).toBe("Release payment");
    expect(primaryAction({ ...base, status: "in_review", role: "seller", seller, payment, submissions: [sub({})] })).toBeNull();
    expect(primaryAction({ ...base, status: "paid", seller, payment })).toBeNull();
    expect(primaryAction({ ...base, seeded: true })).toBeNull();
  });
});
