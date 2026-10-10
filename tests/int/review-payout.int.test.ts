// 06 "One per command": review approve / reject, retry_payout cases (a) to (d) and the buyer; "SB-10 payout failure" (both variants);
// the two-simultaneous-approve case of "Concurrency".
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { applyPaypalEvent, handle } from "@/lib/deal";
import { captureKey, payoutBatchId, voidKey } from "@/lib/deal/keys";
import { assertEventsInC6, dealBuilder, dealRow, events, expectError, parties, resetDb, testDeps, webhookEvent, type Parties, type TestDeps } from "./helpers";

let deps: TestDeps;
let p: Parties;
let build: ReturnType<typeof dealBuilder>;

beforeEach(async () => {
  await resetDb();
  deps = testDeps();
  p = await parties();
  build = dealBuilder(deps, p);
});
afterEach(assertEventsInC6);

const calls = (op: string) => deps.paypal.calls.filter((c) => c.op === op);
const review = (code: string, decision: "approve" | "reject", note: string | null = null, actor = p.asBuyer) => handle(code, actor, { type: "review", decision, note }, deps);
const retry = (code: string, actor = p.asSeller) => handle(code, actor, { type: "retry_payout" }, deps);
const payouts = (code: string) => deps.db.payout.findMany({ where: { deal: { public_code: code } }, orderBy: { attempt: "asc" } });
const payoutItem = (type: string, sender_item_id: string, extra: Record<string, unknown> = {}) =>
  applyPaypalEvent(webhookEvent(type, { payout_item_id: "ITEM-1", payout_batch_id: "BATCH-1", payout_item: { sender_item_id }, ...extra }), deps);

describe("review", () => {
  test("approve: capture-{code}-0, captured, payout created; review:approve then fact:capture_completed (source api)", async () => {
    const code = await build.inReview();
    const v = await review(code, "approve", "Photos match, releasing.");
    expect(v).toMatchObject({ status: "captured", payment: { status: "captured", capture_id: "CAP-1" } });
    expect(v.submissions[0]).toMatchObject({ decision: "buyer_review", decision_reason: "unclear" }); // the review does not rewrite the decision
    expect(calls("captureAuthorization")).toEqual([{ op: "captureAuthorization", requestId: captureKey(code, 0), args: { authorization_id: "AUTH-1", amount_minor: 8000 } }]);
    expect(await payouts(code)).toEqual([expect.objectContaining({ attempt: 1, status: "pending", paypal_batch_id: "BATCH-1", recipient_email: "seller-pp@test" })]);
    const tail = (await events(code)).slice(-2);
    expect(tail[0]).toMatchObject({ from_status: "in_review", to_status: "captured", actor: "buyer", cause: "review:approve", payload: { note: "Photos match, releasing.", capture_id: "CAP-1", capture_status: "COMPLETED" } });
    expect(tail[1]).toMatchObject({ from_status: "captured", to_status: "captured", actor: "paypal", cause: "fact:capture_completed", payload: { capture_id: "CAP-1", source: "api", paypal_request_id: captureKey(code, 0) } });
  });

  test("reject: void-{code}, voided; review:reject then fact:authorization_voided; no capture ever", async () => {
    const code = await build.inReview();
    const v = await review(code, "reject", "Not the item.");
    expect(v).toMatchObject({ status: "voided", payment: { status: "voided" } });
    expect(calls("captureAuthorization")).toHaveLength(0);
    expect(calls("voidAuthorization")).toEqual([{ op: "voidAuthorization", requestId: voidKey(code), args: { authorization_id: "AUTH-1" } }]);
    const tail = (await events(code)).slice(-2);
    expect(tail[0]).toMatchObject({ from_status: "in_review", to_status: "voided", actor: "buyer", cause: "review:reject", payload: { note: "Not the item.", authorization_id: "AUTH-1" } });
    expect(tail[1]).toMatchObject({ from_status: "voided", to_status: "voided", actor: "paypal", cause: "fact:authorization_voided", payload: { authorization_id: "AUTH-1", source: "api" } });
  });

  test("seller -> not_a_party; not in_review -> invalid_state; capture 5xx -> paypal_error with the deal still in_review; DECLINED -> back to in_review with n + 1", async () => {
    const code = await build.inReview();
    await expectError(review(code, "approve", null, p.asSeller), "not_a_party");
    await expectError(review(await build.held(), "approve"), "invalid_state");
    await expectError(review(code, "approve", ""), "invalid_input");

    deps.paypal.failNext("captureAuthorization", { status: 500, name: "INTERNAL_SERVER_ERROR" });
    const n = (await events(code)).length;
    await expectError(review(code, "approve"), "paypal_error");
    expect((await dealRow(code)).status).toBe("in_review");
    expect(await events(code)).toHaveLength(n);

    deps.paypal.failNext("captureAuthorization", "declined");
    const v = await review(code, "approve");
    expect(v).toMatchObject({ status: "in_review", payment: { status: "declined", capture_id: "CAP-1" } });
    expect((await dealRow(code)).payment!.capture_attempts).toBe(1);
    expect((await events(code)).slice(-2).map((e) => [e.cause, e.from_status, e.to_status])).toEqual([["review:approve", "in_review", "captured"], ["fact:capture_declined", "captured", "in_review"]]);
    expect(deps.email.sent.map((m) => m.to).sort()).toEqual(["buyer@test", "buyer@test", "seller@test"]); // the in_review notice, then "PayPal declined" to both
    expect(await payouts(code)).toEqual([]);

    const v2 = await review(code, "approve");
    expect(v2).toMatchObject({ status: "captured", payment: { status: "captured", capture_id: "CAP-2" } });
    expect(calls("captureAuthorization").map((c) => c.requestId)).toEqual([captureKey(code, 0), captureKey(code, 0), captureKey(code, 1)]);
  });

  test("void refused as already captured (C4): the capture is re-sent and applied, the review answers invalid_state", async () => {
    const code = await build.inReview();
    deps.paypal.failNext("voidAuthorization", { status: 422, name: "AUTHORIZATION_ALREADY_CAPTURED" });
    await expectError(review(code, "reject"), "invalid_state");
    expect(calls("captureAuthorization").map((c) => c.requestId)).toEqual([captureKey(code, 0)]);
    expect((await dealRow(code))).toMatchObject({ status: "captured", payment: { status: "captured" } });
    expect((await events(code)).at(-1)).toMatchObject({ cause: "fact:capture_completed", from_status: "in_review", to_status: "captured" });
  });

  test("concurrency: two simultaneous approves -> one capture, one 200 and one invalid_state, one payout", async () => {
    const code = await build.inReview();
    const results = await Promise.allSettled([review(code, "approve"), review(code, "approve")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(failed).toHaveLength(1);
    expect((failed[0]!.reason as { code: string }).code).toBe("invalid_state");
    expect(new Set(calls("captureAuthorization").map((c) => c.requestId))).toEqual(new Set([captureKey(code, 0)]));
    expect(deps.paypal.captures.size).toBe(1);
    expect((await events(code)).filter((e) => e.cause === "fact:capture_completed")).toHaveLength(1);
    expect(await payouts(code)).toHaveLength(1);
  });
});

describe("retry_payout", () => {
  test("(a) failed -> attempt 2 with payout-{code}-2 and the seller's current paypal_email; event retry_payout", async () => {
    const code = await build.captured();
    await payoutItem("PAYMENT.PAYOUTS-ITEM.FAILED", payoutBatchId(code, 1), { errors: { name: "RECEIVER_ACCOUNT_INVALID" } });
    expect((await payouts(code))[0]).toMatchObject({ status: "failed", failure_reason: "RECEIVER_ACCOUNT_INVALID" });
    await deps.db.user.update({ where: { id: p.seller.id }, data: { paypal_email: "fixed@test" } });

    const v = await retry(code);
    expect(v.status).toBe("captured");
    expect(await payouts(code)).toMatchObject([
      { attempt: 1, status: "failed" },
      { attempt: 2, sender_batch_id: payoutBatchId(code, 2), status: "pending", recipient_email: "fixed@test", paypal_batch_id: "BATCH-2", amount_minor: 8000 },
    ]);
    expect(calls("cancelPayoutItem")).toHaveLength(0);
    expect(calls("createPayout").at(-1)).toMatchObject({ requestId: payoutBatchId(code, 2), args: { sender_batch_id: payoutBatchId(code, 2), sender_item_id: payoutBatchId(code, 2), receiver: "fixed@test", amount_minor: 8000 } });
    expect((await events(code)).at(-1)).toMatchObject({
      from_status: "captured", to_status: "captured", actor: "seller", cause: "retry_payout",
      payload: { attempt: 2, sender_batch_id: payoutBatchId(code, 2), paypal_batch_id: null, status: "pending", failure_reason: null, cancelled_item_id: null },
    });
  });

  test("(b) UNCLAIMED: cancelPayoutItem first, cancelled_item_id in the payload; a failing cancel -> paypal_error and nothing written", async () => {
    const code = await build.captured();
    await payoutItem("PAYMENT.PAYOUTS-ITEM.UNCLAIMED", payoutBatchId(code, 1));
    expect((await payouts(code))[0]).toMatchObject({ status: "failed", failure_reason: "UNCLAIMED", paypal_item_id: "ITEM-1" });

    deps.paypal.failNext("cancelPayoutItem", { status: 500, name: "INTERNAL_ERROR" });
    const n = (await events(code)).length;
    await expectError(retry(code), "paypal_error");
    expect(await payouts(code)).toHaveLength(1);
    expect((await payouts(code))[0]!.status).toBe("failed");
    expect(await events(code)).toHaveLength(n);

    await retry(code);
    const ops = deps.paypal.calls.map((c) => c.op);
    expect(ops.indexOf("cancelPayoutItem", ops.lastIndexOf("createPayout") - 1)).toBeLessThan(ops.lastIndexOf("createPayout"));
    expect(calls("cancelPayoutItem").map((c) => c.args)).toEqual([{ payout_item_id: "ITEM-1" }, { payout_item_id: "ITEM-1" }]);
    expect((await events(code)).at(-1)!.payload).toMatchObject({ attempt: 2, cancelled_item_id: "ITEM-1" });
    expect(await payouts(code)).toHaveLength(2);
  });

  test("(c) pending without a batch id (the crash case): the same payout-{code}-1 is re-sent, no new row, event with attempt 1", async () => {
    deps.paypal.failNext("createPayout", "timeout");
    const code = await build.captured();
    expect((await payouts(code))[0]).toMatchObject({ status: "pending", paypal_batch_id: null });
    expect(calls("createPayout")).toHaveLength(1);

    await retry(code);
    expect(calls("createPayout").map((c) => c.requestId)).toEqual([payoutBatchId(code, 1), payoutBatchId(code, 1)]);
    expect(await payouts(code)).toMatchObject([{ attempt: 1, status: "pending", paypal_batch_id: "BATCH-1" }]);
    expect((await events(code)).at(-1)).toMatchObject({ cause: "retry_payout", payload: { attempt: 1, sender_batch_id: payoutBatchId(code, 1), paypal_batch_id: null, status: "pending", cancelled_item_id: null } });
  });

  test("(d) pending with a batch id or success -> invalid_state; buyer -> not_a_party; no paypal_email -> paypal_email_required", async () => {
    const code = await build.captured();
    await expectError(retry(code), "invalid_state");
    await expectError(retry(code, p.asBuyer), "not_a_party");
    await payoutItem("PAYMENT.PAYOUTS-ITEM.FAILED", payoutBatchId(code, 1));
    await deps.db.user.update({ where: { id: p.seller.id }, data: { paypal_email: null } });
    await expectError(retry(code), "paypal_email_required");
    await deps.db.user.update({ where: { id: p.seller.id }, data: { paypal_email: "seller-pp@test" } });
    await retry(code);
    await payoutItem("PAYMENT.PAYOUTS-ITEM.SUCCEEDED", payoutBatchId(code, 2), { payout_item_id: "ITEM-2", payout_batch_id: "BATCH-2" });
    expect((await dealRow(code)).status).toBe("paid");
    await expectError(retry(code), "invalid_state");
    expect(await payouts(code)).toHaveLength(2);
  });
});

describe("SB-10 payout failure", () => {
  test("FAILED -> failed, no email; seller fixes the address; retry -> attempt 2 -> SUCCEEDED -> paid; a late SUCCEEDED for attempt 1 updates its row only", async () => {
    const code = await build.captured();
    await payoutItem("PAYMENT.PAYOUTS-ITEM.FAILED", payoutBatchId(code, 1), { errors: { name: "RECEIVER_ACCOUNT_INVALID" } });
    expect(await dealRow(code)).toMatchObject({ status: "captured", payouts: [expect.objectContaining({ status: "failed", failure_reason: "RECEIVER_ACCOUNT_INVALID" })] });
    expect(deps.email.sent).toEqual([]);

    await deps.db.user.update({ where: { id: p.seller.id }, data: { paypal_email: "fixed@test" } });
    await retry(code);
    expect((await payouts(code))[1]).toMatchObject({ attempt: 2, sender_batch_id: payoutBatchId(code, 2), recipient_email: "fixed@test", status: "pending" });
    expect(calls("cancelPayoutItem")).toHaveLength(0);

    await applyPaypalEvent(webhookEvent("PAYMENT.PAYOUTS-ITEM.SUCCEEDED", { payout_item_id: "ITEM-2", payout_batch_id: "BATCH-2", payout_item: { sender_item_id: payoutBatchId(code, 2) } }), deps);
    expect((await dealRow(code)).status).toBe("paid");
    expect((await events(code)).at(-1)).toMatchObject({ from_status: "captured", to_status: "paid", cause: "fact:payout_succeeded", payload: { attempt: 2, source: "webhook" } });

    await payoutItem("PAYMENT.PAYOUTS-ITEM.SUCCEEDED", payoutBatchId(code, 1));
    expect(await payouts(code)).toMatchObject([{ attempt: 1, status: "success" }, { attempt: 2, status: "success" }]);
    expect((await events(code)).at(-1)).toMatchObject({ from_status: "paid", to_status: "paid", cause: "fact:payout_succeeded", payload: { attempt: 1 } });
    expect(deps.email.sent).toEqual([]);
  });

  test("UNCLAIMED variant: failed with UNCLAIMED and ITEM-1 kept; retry cancels ITEM-1 before createPayout", async () => {
    const code = await build.captured();
    await payoutItem("PAYMENT.PAYOUTS-ITEM.UNCLAIMED", payoutBatchId(code, 1));
    expect((await payouts(code))[0]).toMatchObject({ status: "failed", failure_reason: "UNCLAIMED", paypal_item_id: "ITEM-1" });
    await deps.db.user.update({ where: { id: p.seller.id }, data: { paypal_email: "fixed@test" } });
    await retry(code);
    const ops = deps.paypal.calls.map((c) => c.op);
    expect(ops.slice(-2)).toEqual(["cancelPayoutItem", "createPayout"]);
    expect((await events(code)).at(-1)!.payload).toMatchObject({ attempt: 2, cancelled_item_id: "ITEM-1" });
    expect(deps.paypal.payouts.get("BATCH-1")!.cancelled).toBe(true);
  });
});
