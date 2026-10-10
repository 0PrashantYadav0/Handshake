// 06 "One per webhook event" (every row), "SB-7 duplicate webhook", receiver semantics of 02 section 6.8, SB-6 (E8),
// and the confirm_approval vs PAYMENT.AUTHORIZATION.CREATED race from "Concurrency". Statuses T-10 reaches by command
// (proof_submitted, in_review, captured, paid) are set by hand with their C6 event so the chain stays unbroken.
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { applyPaypalEvent, handle, toFact } from "@/lib/deal";
import { authKey, payoutBatchId, strayVoidKey, voidKey } from "@/lib/deal/keys";
import type { DealStatus, EventActor, PaypalWebhookEvent } from "@/lib/deal/types";
import { assertEventsInC6, dealBuilder, dealRow, events, parties, resetDb, testDeps, webhookEvent, type Parties, type TestDeps } from "./helpers";

let deps: TestDeps;
let p: Parties;
let build: ReturnType<typeof dealBuilder>;
const EXP = "2026-11-18T10:00:00Z";
const OUTCOMES = ["unverified", "already_processed", "applied", "noop", "unknown_deal"];

beforeEach(async () => {
  await resetDb();
  deps = testDeps();
  p = await parties();
  build = dealBuilder(deps, p);
});
afterEach(assertEventsInC6);

const deliver = (e: PaypalWebhookEvent) => applyPaypalEvent(e, deps);
const calls = (op: string) => deps.paypal.calls.filter((c) => c.op === op);
const whRow = (id: string) => deps.db.webhookEvent.findUniqueOrThrow({ where: { paypal_event_id: id } });
const facts = async (code: string, cause: string) => (await events(code)).filter((e) => e.cause === cause);
const cap = (code: string) => `CAP-${code}`; // payments.capture_id is unique across deals
const knowAuth = (id: string) => deps.paypal.authorizations.set(id, { status: "CREATED" });

const orderRes = (id: string, code: string) => ({ id, status: "APPROVED", purchase_units: [{ custom_id: code }] });
const authRes = (id: string, code: string, status = "CREATED") => ({ id, status, custom_id: code, expiration_time: EXP });
const capRes = (id: string, code: string, reason?: string) => ({ id, custom_id: code, ...(reason ? { status_details: { reason } } : {}) });
const payoutRes = (sender_item_id: string, extra: Record<string, unknown> = {}) =>
  ({ payout_item_id: `ITEM-${sender_item_id}`, payout_batch_id: `BATCH-${sender_item_id}`, transaction_status: "SUCCESS", payout_item: { sender_item_id }, ...extra });

/** A status T-10 reaches by command, written as its C6 transition so assertEventsInC6 stays green. */
async function moveTo(code: string, to: DealStatus, cause: string, actor: EventActor): Promise<void> {
  const d = await dealRow(code);
  await deps.db.deal.update({ where: { id: d.id }, data: { status: to } });
  await deps.db.dealEvent.create({ data: { deal_id: d.id, from_status: d.status, to_status: to, actor, cause, payload: {} } });
}
const proofSubmitted = async () => { const code = await build.held(); await moveTo(code, "proof_submitted", "submit_evidence", "seller"); return code; };
const inReview = async () => { const code = await proofSubmitted(); await moveTo(code, "in_review", "decision:buyer_review", "system"); return code; };
/** captured by the API path: CAP-1 stored; with status captured the attempt-1 payouts row exists too. */
async function captured(status: "captured" | "capture_pending" = "captured"): Promise<string> {
  const code = await proofSubmitted();
  await moveTo(code, "captured", "decision:capture", "system");
  const d = await dealRow(code);
  await deps.db.payment.update({ where: { id: d.payment!.id }, data: { capture_id: cap(code), status } });
  if (status === "captured") {
    await deps.db.payout.create({ data: { deal_id: d.id, attempt: 1, sender_batch_id: payoutBatchId(code, 1), recipient_email: "seller-pp@test", amount_minor: 8000, status: "pending", paypal_batch_id: `BATCH-${code}` } });
  }
  return code;
}
async function paid(): Promise<string> {
  const code = await captured();
  await deps.db.payout.update({ where: { sender_batch_id: payoutBatchId(code, 1) }, data: { status: "success", paypal_item_id: `ITEM-${code}` } });
  await moveTo(code, "paid", "fact:payout_succeeded", "paypal");
  return code;
}

describe("toFact", () => {
  test("maps every E5 type; non-CREATED authorizations, unknown types and v1-shaped resources are noop", () => {
    const wh = (t: string, r: Record<string, unknown>) => toFact(webhookEvent(t, r));
    expect(wh("CHECKOUT.ORDER.APPROVED", orderRes("ORD-1", "HS-AAAA"))).toEqual({ lookup: { kind: "order_custom_id", value: "HS-AAAA" }, approved_order_id: "ORD-1" });
    expect(wh("PAYMENT.AUTHORIZATION.CREATED", authRes("AUTH-1", "HS-AAAA"))).toEqual({ lookup: { kind: "custom_id", value: "HS-AAAA" }, fact: { type: "authorization_created", authorization_id: "AUTH-1", auth_expires_at: EXP } });
    expect(wh("PAYMENT.AUTHORIZATION.CREATED", authRes("AUTH-1", "HS-AAAA", "PENDING"))).toEqual({ noop: true });
    expect(wh("PAYMENT.AUTHORIZATION.VOIDED", authRes("AUTH-1", "HS-AAAA", "VOIDED"))).toMatchObject({ fact: { type: "authorization_voided", authorization_id: "AUTH-1" } });
    expect(wh("PAYMENT.CAPTURE.COMPLETED", capRes("CAP-1", "HS-AAAA"))).toMatchObject({ fact: { type: "capture_completed", capture_id: "CAP-1" } });
    expect(wh("PAYMENT.CAPTURE.PENDING", capRes("CAP-1", "HS-AAAA", "PENDING_REVIEW"))).toMatchObject({ fact: { type: "capture_pending", capture_id: "CAP-1", reason: "PENDING_REVIEW" } });
    expect(wh("PAYMENT.CAPTURE.DECLINED", capRes("CAP-1", "HS-AAAA"))).toMatchObject({ fact: { type: "capture_declined", capture_id: "CAP-1", reason: null } });
    expect(wh("PAYMENT.PAYOUTS-ITEM.SUCCEEDED", payoutRes("payout-HS-AAAA-1"))).toEqual({ lookup: { kind: "sender_item_id", value: "payout-HS-AAAA-1" }, fact: { type: "payout_succeeded", sender_item_id: "payout-HS-AAAA-1", payout_batch_id: "BATCH-payout-HS-AAAA-1", payout_item_id: "ITEM-payout-HS-AAAA-1" } });
    expect(wh("PAYMENT.PAYOUTS-ITEM.FAILED", payoutRes("payout-HS-AAAA-1", { errors: { name: "RECEIVER_ACCOUNT_INVALID" } }))).toMatchObject({ fact: { type: "payout_failed", failure_reason: "RECEIVER_ACCOUNT_INVALID", payout_item_id: "ITEM-payout-HS-AAAA-1" } });
    expect(wh("PAYMENT.PAYOUTS-ITEM.BLOCKED", payoutRes("payout-HS-AAAA-1"))).toMatchObject({ fact: { failure_reason: "BLOCKED" } });
    expect(wh("PAYMENT.PAYOUTS-ITEM.RETURNED", payoutRes("payout-HS-AAAA-1"))).toMatchObject({ fact: { failure_reason: "RETURNED" } });
    expect(wh("PAYMENT.PAYOUTS-ITEM.UNCLAIMED", payoutRes("payout-HS-AAAA-1", { errors: { name: "SOMETHING" } }))).toMatchObject({ fact: { failure_reason: "UNCLAIMED", payout_item_id: "ITEM-payout-HS-AAAA-1" } });
    expect(wh("PAYMENT.CAPTURE.REFUNDED", capRes("CAP-1", "HS-AAAA"))).toEqual({ noop: true });
    expect(wh("PAYMENT.CAPTURE.COMPLETED", { id: "CAP-1" })).toEqual({ noop: true }); // simulator payloads carry no custom_id
    expect(wh("PAYMENT.PAYOUTS-ITEM.SUCCEEDED", { payout_item_id: "ITEM-1" })).toEqual({ noop: true });
  });
});

describe("CHECKOUT.ORDER.APPROVED (E8, SB-6)", () => {
  test("terms_agreed with the order created: authorizeOrder with auth-{code}, held, fact with source webhook; the AUTHORIZATION.CREATED and confirm_approval after it are no-ops", async () => {
    const code = await build.agreed();
    await handle(code, p.asBuyer, { type: "start_payment" }, deps);
    const n = (await events(code)).length;
    const e = webhookEvent("CHECKOUT.ORDER.APPROVED", orderRes("ORD-1", code));
    expect(await deliver(e)).toEqual({ outcome: "applied" });
    expect(calls("authorizeOrder")).toEqual([{ op: "authorizeOrder", requestId: authKey(code), args: { paypal_order_id: "ORD-1" } }]);
    const row = await dealRow(code);
    expect(row.status).toBe("held");
    expect(row.deadline_at).not.toBeNull();
    expect(row.payment).toMatchObject({ status: "authorized", authorization_id: "AUTH-1" });
    const ev = await events(code);
    expect(ev).toHaveLength(n + 1);
    expect(ev.at(-1)).toMatchObject({ from_status: "terms_agreed", to_status: "held", actor: "paypal", cause: "fact:authorization_created", payload: { authorization_id: "AUTH-1", source: "webhook", paypal_event_id: e.id } });
    expect(await whRow(e.id)).toMatchObject({ verified: true, event_type: "CHECKOUT.ORDER.APPROVED", last_error: null });
    expect((await whRow(e.id)).processed_at).not.toBeNull();

    expect(await deliver(webhookEvent("PAYMENT.AUTHORIZATION.CREATED", authRes("AUTH-1", code)))).toEqual({ outcome: "noop" });
    const v = await handle(code, p.asBuyer, { type: "confirm_approval", order_id: "ORD-1" }, deps);
    expect(v.status).toBe("held");
    expect(calls("authorizeOrder")).toHaveLength(1);
    expect(await facts(code, "fact:authorization_created")).toHaveLength(1);
  });
  test("held (browser won), voided after a cancel, another order id: noop, no call, no event", async () => {
    const held = await build.held();
    const n = (await events(held)).length;
    expect(await deliver(webhookEvent("CHECKOUT.ORDER.APPROVED", orderRes("ORD-1", held)))).toEqual({ outcome: "noop" });
    expect(calls("authorizeOrder")).toHaveLength(1); // the browser's
    expect(await events(held)).toHaveLength(n);

    const cancelled = await build.agreed();
    await handle(cancelled, p.asBuyer, { type: "start_payment" }, deps);
    await handle(cancelled, p.asSeller, { type: "cancel" }, deps);
    expect(await deliver(webhookEvent("CHECKOUT.ORDER.APPROVED", orderRes("ORD-2", cancelled)))).toEqual({ outcome: "noop" });
    expect((await dealRow(cancelled))).toMatchObject({ status: "voided", payment: { status: "created" } });

    const other = await build.agreed();
    await handle(other, p.asBuyer, { type: "start_payment" }, deps);
    const e = webhookEvent("CHECKOUT.ORDER.APPROVED", orderRes("ORD-9", other));
    expect(await deliver(e)).toEqual({ outcome: "noop" });
    expect(calls("authorizeOrder")).toHaveLength(1);
    expect((await whRow(e.id)).processed_at).not.toBeNull();
  });
  test("ORDER_ALREADY_AUTHORIZED / ORDER_COMPLETED_OR_VOIDED from PayPal: noop and processed; a 500 rethrows, processed_at stays null, redelivery applies once", async () => {
    const code = await build.agreed();
    await handle(code, p.asBuyer, { type: "start_payment" }, deps);
    deps.paypal.failNext("authorizeOrder", { status: 422, name: "ORDER_ALREADY_AUTHORIZED" });
    const e1 = webhookEvent("CHECKOUT.ORDER.APPROVED", orderRes("ORD-1", code));
    expect(await deliver(e1)).toEqual({ outcome: "noop" });
    expect((await whRow(e1.id)).processed_at).not.toBeNull();
    expect((await dealRow(code))).toMatchObject({ status: "terms_agreed", payment: { status: "approved" } });

    deps.paypal.failNext("authorizeOrder", { status: 422, name: "ORDER_COMPLETED_OR_VOIDED" });
    expect(await deliver(webhookEvent("CHECKOUT.ORDER.APPROVED", orderRes("ORD-1", code)))).toEqual({ outcome: "noop" });

    deps.paypal.failNext("authorizeOrder", { status: 500, name: "INTERNAL_SERVER_ERROR" });
    const e2 = webhookEvent("CHECKOUT.ORDER.APPROVED", orderRes("ORD-1", code));
    await expect(deliver(e2)).rejects.toMatchObject({ name: "PayPalError" });
    expect(await whRow(e2.id)).toMatchObject({ processed_at: null, last_error: "INTERNAL_SERVER_ERROR" });
    expect((await dealRow(code)).status).toBe("terms_agreed");

    expect(await deliver(e2)).toEqual({ outcome: "applied" });
    expect((await dealRow(code)).status).toBe("held");
    expect(await facts(code, "fact:authorization_created")).toHaveLength(1);
    expect((await whRow(e2.id)).processed_at).not.toBeNull();
  });
  test("a PENDING authorization: ids stored with status approved, noop; its CREATED webhook then moves the deal to held", async () => {
    const code = await build.agreed();
    await handle(code, p.asBuyer, { type: "start_payment" }, deps);
    deps.paypal.authorizeStatus = "PENDING";
    expect(await deliver(webhookEvent("CHECKOUT.ORDER.APPROVED", orderRes("ORD-1", code)))).toEqual({ outcome: "noop" });
    expect((await dealRow(code))).toMatchObject({ status: "terms_agreed", payment: { status: "approved", authorization_id: "AUTH-1" } });
    expect(await deliver(webhookEvent("PAYMENT.AUTHORIZATION.CREATED", authRes("AUTH-1", code)))).toEqual({ outcome: "applied" });
    expect((await dealRow(code))).toMatchObject({ status: "held", payment: { status: "authorized", authorization_id: "AUTH-1" } });
  });
});

describe("PAYMENT.AUTHORIZATION.CREATED", () => {
  test("terms_agreed with order ORD-1: held, authorization stored, deadline set; a later confirm_approval is a no-op; same id again is a no-op", async () => {
    const code = await build.agreed();
    await handle(code, p.asBuyer, { type: "start_payment" }, deps);
    const e = webhookEvent("PAYMENT.AUTHORIZATION.CREATED", authRes("AUTH-77", code));
    expect(await deliver(e)).toEqual({ outcome: "applied" });
    const row = await dealRow(code);
    expect(row.status).toBe("held");
    expect(row.deadline_at).not.toBeNull();
    expect(row.payment).toMatchObject({ status: "authorized", authorization_id: "AUTH-77", auth_expires_at: new Date(EXP) });
    expect((await events(code)).at(-1)).toMatchObject({ from_status: "terms_agreed", to_status: "held", actor: "paypal", cause: "fact:authorization_created", payload: { authorization_id: "AUTH-77", auth_expires_at: EXP, source: "webhook", paypal_event_id: e.id } });

    expect((await handle(code, p.asBuyer, { type: "confirm_approval", order_id: "ORD-1" }, deps)).status).toBe("held");
    expect(calls("authorizeOrder")).toHaveLength(0);
    expect(await deliver(e)).toEqual({ outcome: "already_processed" });
    expect(await deliver(webhookEvent("PAYMENT.AUTHORIZATION.CREATED", authRes("AUTH-77", code)))).toEqual({ outcome: "noop" });
    expect(await facts(code, "fact:authorization_created")).toHaveLength(1);
    expect(await deps.db.webhookEvent.count()).toBe(2);
  });
  test("status other than CREATED: noop, stored and processed", async () => {
    const code = await build.agreed();
    await handle(code, p.asBuyer, { type: "start_payment" }, deps);
    const e = webhookEvent("PAYMENT.AUTHORIZATION.CREATED", authRes("AUTH-77", code, "PENDING"));
    expect(await deliver(e)).toEqual({ outcome: "noop" });
    expect((await whRow(e.id)).processed_at).not.toBeNull();
    expect((await dealRow(code)).status).toBe("terms_agreed");
  });
  test("voided (cancelled before PayPal answered), no stored id: void-{code} on the new id, payment voided, voided -> voided event", async () => {
    const code = await build.agreed();
    await handle(code, p.asBuyer, { type: "start_payment" }, deps);
    await handle(code, p.asBuyer, { type: "cancel" }, deps);
    knowAuth("AUTH-7");
    const e = webhookEvent("PAYMENT.AUTHORIZATION.CREATED", authRes("AUTH-7", code));
    expect(await deliver(e)).toEqual({ outcome: "applied" });
    expect(calls("voidAuthorization")).toEqual([{ op: "voidAuthorization", requestId: voidKey(code), args: { authorization_id: "AUTH-7" } }]);
    expect((await dealRow(code))).toMatchObject({ status: "voided", payment: { status: "voided", authorization_id: "AUTH-7" } });
    expect((await events(code)).at(-1)).toMatchObject({ from_status: "voided", to_status: "voided", actor: "paypal", cause: "fact:late_authorization_voided", payload: { authorization_id: "AUTH-7", source: "webhook", paypal_event_id: e.id } });
  });
  test("held with AUTH-1, event carries AUTH-2 (stray): void-AUTH-2, payments untouched, held -> held event; a later cancel still voids AUTH-1 with void-{code}", async () => {
    const code = await build.held();
    knowAuth("AUTH-2");
    const e = webhookEvent("PAYMENT.AUTHORIZATION.CREATED", authRes("AUTH-2", code));
    expect(await deliver(e)).toEqual({ outcome: "applied" });
    expect(calls("voidAuthorization")).toEqual([{ op: "voidAuthorization", requestId: strayVoidKey("AUTH-2"), args: { authorization_id: "AUTH-2" } }]);
    expect((await dealRow(code))).toMatchObject({ status: "held", payment: { status: "authorized", authorization_id: "AUTH-1" } });
    expect((await events(code)).at(-1)).toMatchObject({ from_status: "held", to_status: "held", actor: "paypal", cause: "fact:late_authorization_voided", payload: { authorization_id: "AUTH-2", source: "webhook", paypal_event_id: e.id } });

    await handle(code, p.asBuyer, { type: "cancel" }, deps);
    expect(calls("voidAuthorization").at(-1)).toEqual({ op: "voidAuthorization", requestId: voidKey(code), args: { authorization_id: "AUTH-1" } });
    expect((await dealRow(code)).status).toBe("voided");
  });
});

describe("PAYMENT.AUTHORIZATION.VOIDED", () => {
  test("held -> voided with no PayPal call; proof_submitted and in_review -> voided in place", async () => {
    for (const [code, from] of [[await build.held(), "held"], [await proofSubmitted(), "proof_submitted"], [await inReview(), "in_review"]] as const) {
      const e = webhookEvent("PAYMENT.AUTHORIZATION.VOIDED", authRes("AUTH-1", code, "VOIDED"));
      expect(await deliver(e)).toEqual({ outcome: "applied" });
      expect((await dealRow(code))).toMatchObject({ status: "voided", payment: { status: "voided" } });
      expect((await events(code)).at(-1)).toMatchObject({ from_status: from, to_status: "voided", actor: "paypal", cause: "fact:authorization_voided", payload: { authorization_id: "AUTH-1", source: "webhook", paypal_event_id: e.id } });
    }
    expect(calls("voidAuthorization")).toHaveLength(0);
  });
  test("captured or paid with capture_id set: status unchanged, payment voided, from_status = to_status", async () => {
    for (const [code, status] of [[await captured(), "captured"], [await paid(), "paid"]] as const) {
      expect(await deliver(webhookEvent("PAYMENT.AUTHORIZATION.VOIDED", authRes("AUTH-1", code, "VOIDED")))).toEqual({ outcome: "applied" });
      expect((await dealRow(code))).toMatchObject({ status, payment: { status: "voided", capture_id: cap(code) } });
      expect((await events(code)).at(-1)).toMatchObject({ from_status: status, to_status: status, cause: "fact:authorization_voided" });
    }
  });
  test("voided after our own cancel: no-op, no event", async () => {
    const code = await build.held();
    await handle(code, p.asBuyer, { type: "cancel" }, deps);
    const n = (await events(code)).length;
    expect(await deliver(webhookEvent("PAYMENT.AUTHORIZATION.VOIDED", authRes("AUTH-1", code, "VOIDED")))).toEqual({ outcome: "noop" });
    expect(await events(code)).toHaveLength(n);
  });
});

describe("PAYMENT.CAPTURE.COMPLETED", () => {
  test("proof_submitted or in_review (the capture was requested and the process died): captured, one payout created and sent", async () => {
    for (const [code, from] of [[await proofSubmitted(), "proof_submitted"], [await inReview(), "in_review"]] as const) {
      const e = webhookEvent("PAYMENT.CAPTURE.COMPLETED", capRes(cap(code), code));
      expect(await deliver(e)).toEqual({ outcome: "applied" });
      const row = await dealRow(code);
      expect(row.status).toBe("captured");
      expect(row.payment).toMatchObject({ capture_id: cap(code), status: "captured" });
      expect(row.payouts).toHaveLength(1);
      expect(row.payouts[0]).toMatchObject({ attempt: 1, sender_batch_id: payoutBatchId(code, 1), status: "pending", amount_minor: 8000, recipient_email: "seller-pp@test" });
      expect(row.payouts[0]!.paypal_batch_id).not.toBeNull(); // sendPayout ran after commit
      expect(calls("createPayout").at(-1)).toMatchObject({ requestId: payoutBatchId(code, 1), args: { sender_batch_id: payoutBatchId(code, 1), receiver: "seller-pp@test", amount_minor: 8000 } });
      expect((await events(code)).at(-1)).toMatchObject({ from_status: from, to_status: "captured", actor: "paypal", cause: "fact:capture_completed", payload: { capture_id: cap(code), source: "webhook", paypal_event_id: e.id, payout: { attempt: 1 } } });
    }
  });
  test("captured with payments.status capture_pending: payment captured, one payout; a second delivery and a second event for the same capture create no second payout", async () => {
    const code = await captured("capture_pending");
    const e = webhookEvent("PAYMENT.CAPTURE.COMPLETED", capRes(cap(code), code));
    expect(await deliver(e)).toEqual({ outcome: "applied" });
    expect((await dealRow(code))).toMatchObject({ status: "captured", payment: { status: "captured" } });
    expect((await events(code)).at(-1)).toMatchObject({ from_status: "captured", to_status: "captured", cause: "fact:capture_completed" });
    expect(await deliver(e)).toEqual({ outcome: "already_processed" });
    expect(await deliver(webhookEvent("PAYMENT.CAPTURE.COMPLETED", capRes(cap(code), code)))).toEqual({ outcome: "noop" });
    expect((await dealRow(code)).payouts).toHaveLength(1);
    expect(calls("createPayout")).toHaveLength(1);
  });
  test("captured already from the API response, or paid with the same capture id: no-op, no event, payout count stays 1", async () => {
    for (const code of [await captured(), await paid()]) {
      const n = (await events(code)).length;
      expect(await deliver(webhookEvent("PAYMENT.CAPTURE.COMPLETED", capRes(cap(code), code)))).toEqual({ outcome: "noop" });
      expect(await events(code)).toHaveLength(n);
      expect((await dealRow(code)).payouts).toHaveLength(1);
    }
    expect(calls("createPayout")).toHaveLength(0);
  });
  test("SB-7: the same event delivered twice -> one webhook_events row, one payout, one fact event, applied then already_processed", async () => {
    const code = await proofSubmitted();
    const e = webhookEvent("PAYMENT.CAPTURE.COMPLETED", capRes(cap(code), code));
    expect(await deliver(e)).toEqual({ outcome: "applied" });
    expect(await deliver(e)).toEqual({ outcome: "already_processed" });
    expect(await deps.db.webhookEvent.count({ where: { paypal_event_id: e.id } })).toBe(1);
    expect((await dealRow(code)).payouts).toHaveLength(1);
    expect(await facts(code, "fact:capture_completed")).toHaveLength(1);
    expect(calls("createPayout")).toHaveLength(1);
  });
});

describe("PAYMENT.CAPTURE.PENDING and DECLINED", () => {
  test("PENDING: proof_submitted -> captured with payments.status capture_pending and no payout; same id on captured -> no-op", async () => {
    const code = await proofSubmitted();
    expect(await deliver(webhookEvent("PAYMENT.CAPTURE.PENDING", capRes(cap(code), code, "PENDING_REVIEW")))).toEqual({ outcome: "applied" });
    const row = await dealRow(code);
    expect(row).toMatchObject({ status: "captured", payment: { status: "capture_pending", capture_id: cap(code) } });
    expect(row.payouts).toHaveLength(0);
    expect((await events(code)).at(-1)).toMatchObject({ from_status: "proof_submitted", to_status: "captured", cause: "fact:capture_pending", payload: { reason: "PENDING_REVIEW" } });
    expect(await deliver(webhookEvent("PAYMENT.CAPTURE.PENDING", capRes(cap(code), code, "PENDING_REVIEW")))).toEqual({ outcome: "noop" });
    expect(calls("createPayout")).toHaveLength(0);
  });
  test("DECLINED on captured: in_review, payment declined, capture_attempts 1, both parties emailed", async () => {
    const code = await captured("capture_pending");
    expect(await deliver(webhookEvent("PAYMENT.CAPTURE.DECLINED", capRes(cap(code), code, "DECLINED")))).toEqual({ outcome: "applied" });
    expect((await dealRow(code))).toMatchObject({ status: "in_review", payment: { status: "declined", capture_attempts: 1 } });
    expect((await events(code)).at(-1)).toMatchObject({ from_status: "captured", to_status: "in_review", cause: "fact:capture_declined", payload: { reason: "DECLINED" } });
    expect(deps.email.sent.map((m) => m.to).sort()).toEqual(["buyer@test", "seller@test"]);
    expect(deps.email.sent[0]!.subject).toBe("PayPal declined the capture");
  });
});

describe("PAYMENT.PAYOUTS-ITEM.*", () => {
  test("SUCCEEDED on captured with the payout pending: row success with ids, paid, event with attempt 1", async () => {
    const code = await captured();
    const e = webhookEvent("PAYMENT.PAYOUTS-ITEM.SUCCEEDED", payoutRes(payoutBatchId(code, 1)));
    expect(await deliver(e)).toEqual({ outcome: "applied" });
    const row = await dealRow(code);
    expect(row.status).toBe("paid");
    expect(row.payouts[0]).toMatchObject({ status: "success", paypal_item_id: `ITEM-${payoutBatchId(code, 1)}`, paypal_batch_id: `BATCH-${payoutBatchId(code, 1)}` });
    expect((await events(code)).at(-1)).toMatchObject({ from_status: "captured", to_status: "paid", actor: "paypal", cause: "fact:payout_succeeded", payload: { attempt: 1, sender_item_id: payoutBatchId(code, 1), source: "webhook", paypal_event_id: e.id } });
    expect(await deliver(webhookEvent("PAYMENT.PAYOUTS-ITEM.SUCCEEDED", payoutRes(payoutBatchId(code, 1))))).toEqual({ outcome: "noop" });
    expect(deps.email.sent).toHaveLength(0);
  });
  test("SUCCEEDED for attempt 1 on paid with attempt 2 success: row 1 success, paid -> paid event", async () => {
    const code = await captured();
    const d = await dealRow(code);
    await deps.db.payout.update({ where: { sender_batch_id: payoutBatchId(code, 1) }, data: { status: "failed", failure_reason: "UNCLAIMED", paypal_item_id: "ITEM-1" } });
    await deps.db.payout.create({ data: { deal_id: d.id, attempt: 2, sender_batch_id: payoutBatchId(code, 2), recipient_email: "fixed@test", amount_minor: 8000, status: "success", paypal_batch_id: "BATCH-2", paypal_item_id: "ITEM-2" } });
    await moveTo(code, "paid", "fact:payout_succeeded", "paypal");
    await deps.db.payout.update({ where: { sender_batch_id: payoutBatchId(code, 1) }, data: { status: "pending" } }); // claimed late: PayPal reports it now
    expect(await deliver(webhookEvent("PAYMENT.PAYOUTS-ITEM.SUCCEEDED", payoutRes(payoutBatchId(code, 1))))).toEqual({ outcome: "applied" });
    const row = await dealRow(code);
    expect(row.status).toBe("paid");
    expect(row.payouts.map((x) => x.status)).toEqual(["success", "success"]);
    expect((await events(code)).at(-1)).toMatchObject({ from_status: "paid", to_status: "paid", cause: "fact:payout_succeeded", payload: { attempt: 1 } });
  });
  test("FAILED with errors.name, BLOCKED and RETURNED without: row failed with the reason, deal stays captured, no email", async () => {
    for (const [type, extra, reason] of [
      ["PAYMENT.PAYOUTS-ITEM.FAILED", { errors: { name: "RECEIVER_ACCOUNT_INVALID" } }, "RECEIVER_ACCOUNT_INVALID"],
      ["PAYMENT.PAYOUTS-ITEM.BLOCKED", {}, "BLOCKED"],
      ["PAYMENT.PAYOUTS-ITEM.RETURNED", {}, "RETURNED"],
    ] as const) {
      const code = await captured();
      expect(await deliver(webhookEvent(type, payoutRes(payoutBatchId(code, 1), extra)))).toEqual({ outcome: "applied" });
      const row = await dealRow(code);
      expect(row.status).toBe("captured");
      expect(row.payouts[0]).toMatchObject({ status: "failed", failure_reason: reason, paypal_item_id: `ITEM-${payoutBatchId(code, 1)}` });
      expect((await events(code)).at(-1)).toMatchObject({ from_status: "captured", to_status: "captured", cause: "fact:payout_failed", payload: { failure_reason: reason, attempt: 1 } });
    }
    expect(deps.email.sent).toHaveLength(0);
  });
  test("UNCLAIMED: failed with failure_reason UNCLAIMED and paypal_item_id kept", async () => {
    const code = await captured();
    expect(await deliver(webhookEvent("PAYMENT.PAYOUTS-ITEM.UNCLAIMED", payoutRes(payoutBatchId(code, 1), { payout_item_id: "ITEM-9" })))).toEqual({ outcome: "applied" });
    expect((await dealRow(code)).payouts[0]).toMatchObject({ status: "failed", failure_reason: "UNCLAIMED", paypal_item_id: "ITEM-9" });
    expect(deps.email.sent).toHaveLength(0);
  });
  test("a fact matching no C2 row (SUCCEEDED while held, for a real payouts row): status unchanged, row updated, one held -> held event; again -> no event", async () => {
    const code = await build.held();
    const d = await dealRow(code);
    await deps.db.payout.create({ data: { deal_id: d.id, attempt: 1, sender_batch_id: payoutBatchId(code, 1), recipient_email: "seller-pp@test", amount_minor: 8000, status: "pending" } });
    const n = (await events(code)).length;
    const e = webhookEvent("PAYMENT.PAYOUTS-ITEM.SUCCEEDED", payoutRes(payoutBatchId(code, 1)));
    expect(await deliver(e)).toEqual({ outcome: "applied" });
    expect((await whRow(e.id)).processed_at).not.toBeNull();
    const row = await dealRow(code);
    expect(row.status).toBe("held");
    expect(row.payouts[0]).toMatchObject({ status: "success", paypal_item_id: `ITEM-${payoutBatchId(code, 1)}` });
    const ev = await events(code);
    expect(ev).toHaveLength(n + 1);
    expect(ev.at(-1)).toMatchObject({ from_status: "held", to_status: "held", cause: "fact:payout_succeeded" });
    expect(await deliver(webhookEvent("PAYMENT.PAYOUTS-ITEM.SUCCEEDED", payoutRes(payoutBatchId(code, 1))))).toEqual({ outcome: "noop" });
    expect(await events(code)).toHaveLength(n + 1);
  });
});

describe("receiver semantics (02 section 6.8)", () => {
  test("unsubscribed type and unknown or seeded deal: stored, processed, deal untouched", async () => {
    const code = await captured();
    const n = (await events(code)).length;
    const e1 = webhookEvent("PAYMENT.CAPTURE.REFUNDED", capRes(cap(code), code));
    expect(await deliver(e1)).toEqual({ outcome: "noop" });
    const e2 = webhookEvent("PAYMENT.CAPTURE.COMPLETED", capRes("CAP-1", "HS-ZZZZ"));
    expect(await deliver(e2)).toEqual({ outcome: "unknown_deal" });
    const e3 = webhookEvent("PAYMENT.PAYOUTS-ITEM.SUCCEEDED", payoutRes("payout-HS-ZZZZ-1"));
    expect(await deliver(e3)).toEqual({ outcome: "unknown_deal" });
    await deps.db.deal.update({ where: { public_code: code }, data: { seeded: true } });
    const e4 = webhookEvent("PAYMENT.AUTHORIZATION.VOIDED", authRes("AUTH-1", code, "VOIDED"));
    expect(await deliver(e4)).toEqual({ outcome: "unknown_deal" });
    const e5 = webhookEvent("CHECKOUT.ORDER.APPROVED", orderRes("ORD-1", code));
    expect(await deliver(e5)).toEqual({ outcome: "unknown_deal" });
    for (const e of [e1, e2, e3, e4, e5]) expect((await whRow(e.id)).processed_at, e.id).not.toBeNull();
    expect(await events(code)).toHaveLength(n);
    expect((await dealRow(code))).toMatchObject({ status: "captured", payment: { status: "captured" } });
  });
  test("unverified: stored verified=false, not processed, deal untouched; a later verified delivery corrects the row and is processed", async () => {
    const code = await proofSubmitted();
    const e = webhookEvent("PAYMENT.CAPTURE.COMPLETED", capRes(cap(code), code));
    expect(await deliver({ ...e, verified: false })).toEqual({ outcome: "unverified" });
    expect(await whRow(e.id)).toMatchObject({ verified: false, processed_at: null });
    expect((await dealRow(code)).status).toBe("proof_submitted");
    expect(await deliver(e)).toEqual({ outcome: "applied" });
    expect((await whRow(e.id)).verified).toBe(true);
    expect((await dealRow(code)).status).toBe("captured");
    expect(await deliver({ ...e, verified: false })).toEqual({ outcome: "unverified" }); // a processed row is never touched
    expect((await whRow(e.id)).verified).toBe(true);
    expect(await deps.db.webhookEvent.count()).toBe(1);
  });
  test("processing throws (void 500 on a late authorization): nothing written, processed_at null, last_error set; redelivery processes it once", async () => {
    const code = await build.held();
    knowAuth("AUTH-2");
    const n = (await events(code)).length;
    deps.paypal.failNext("voidAuthorization", { status: 500, name: "INTERNAL_SERVER_ERROR" });
    const e = webhookEvent("PAYMENT.AUTHORIZATION.CREATED", authRes("AUTH-2", code));
    await expect(deliver(e)).rejects.toMatchObject({ name: "PayPalError" });
    expect(await whRow(e.id)).toMatchObject({ verified: true, processed_at: null, last_error: "INTERNAL_SERVER_ERROR" });
    expect(await events(code)).toHaveLength(n);
    expect(await deliver(e)).toEqual({ outcome: "applied" });
    expect((await whRow(e.id)).processed_at).not.toBeNull();
    expect(await facts(code, "fact:late_authorization_voided")).toHaveLength(1);
    expect(await deliver(e)).toEqual({ outcome: "already_processed" });
    expect(calls("voidAuthorization")).toHaveLength(2);
  });
  test("no webhook row ever throws invalid_state: every E5 type against every status resolves to an outcome", async () => {
    const agreed = async () => { const code = await build.agreed(); await handle(code, p.asBuyer, { type: "start_payment" }, deps); return code; };
    const voided = async () => { const code = await build.held(); await handle(code, p.asBuyer, { type: "cancel" }, deps); return code; };
    for (const make of [agreed, build.held, voided, proofSubmitted, inReview, captured, paid]) {
      const code = await make();
      knowAuth("AUTH-X");
      const order = (await dealRow(code)).payment!.paypal_order_id;
      const batch = payoutBatchId(code, 1);
      const list: [string, Record<string, unknown>][] = [
        ["CHECKOUT.ORDER.APPROVED", orderRes(order, code)],
        ["PAYMENT.AUTHORIZATION.CREATED", authRes("AUTH-X", code)],
        ["PAYMENT.CAPTURE.PENDING", capRes(`CAP-X-${code}`, code, "PENDING_REVIEW")],
        ["PAYMENT.CAPTURE.DECLINED", capRes(`CAP-X-${code}`, code, "DECLINED")],
        ["PAYMENT.CAPTURE.COMPLETED", capRes(`CAP-X-${code}`, code)],
        ["PAYMENT.CAPTURE.REFUNDED", capRes(`CAP-X-${code}`, code)],
        ["PAYMENT.PAYOUTS-ITEM.UNCLAIMED", payoutRes(batch)],
        ["PAYMENT.PAYOUTS-ITEM.FAILED", payoutRes(batch)],
        ["PAYMENT.PAYOUTS-ITEM.BLOCKED", payoutRes(batch)],
        ["PAYMENT.PAYOUTS-ITEM.RETURNED", payoutRes(batch)],
        ["PAYMENT.PAYOUTS-ITEM.SUCCEEDED", payoutRes(batch)],
        ["PAYMENT.AUTHORIZATION.VOIDED", authRes("AUTH-X", code, "VOIDED")],
      ];
      for (const [type, resource] of list) {
        const { outcome } = await deliver(webhookEvent(type, resource));
        expect(OUTCOMES, `${make.name} ${type}`).toContain(outcome);
      }
    }
    const rows = await deps.db.webhookEvent.findMany();
    expect(rows.every((r) => r.processed_at !== null && r.last_error === null)).toBe(true);
  });
});

describe("Concurrency", () => {
  test("confirm_approval and PAYMENT.AUTHORIZATION.CREATED at the same time: one fact:authorization_created, source api or webhook", async () => {
    const code = await build.agreed();
    await handle(code, p.asBuyer, { type: "start_payment" }, deps);
    const e = webhookEvent("PAYMENT.AUTHORIZATION.CREATED", authRes("AUTH-1", code));
    const [v, r] = await Promise.all([handle(code, p.asBuyer, { type: "confirm_approval", order_id: "ORD-1" }, deps), deliver(e)]);
    expect(v.status).toBe("held");
    expect(["applied", "noop"]).toContain(r.outcome);
    expect((await dealRow(code))).toMatchObject({ status: "held", payment: { status: "authorized", authorization_id: "AUTH-1" } });
    const f = await facts(code, "fact:authorization_created");
    expect(f).toHaveLength(1);
    expect(["api", "webhook"]).toContain((f[0]!.payload as { source: string }).source);
    expect(await facts(code, "fact:late_authorization_voided")).toHaveLength(0);
    expect(calls("voidAuthorization")).toHaveLength(0);
  });
});
